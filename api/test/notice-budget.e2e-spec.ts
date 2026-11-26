// Antes de importar AppModule: ConfigModule valida el entorno al cargarse.
// Cupo chico para no crear decenas de leads, y la IP de `X-Forwarded-For`
// para simular un spam desde muchas IP.
vi.hoisted(() => {
  process.env.NEW_LEAD_NOTICE_DAILY_LIMIT = '2';
  process.env.TRUST_PROXY_HOPS = '1';
});

import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { ValidatedEnv } from './../src/config/validate-env';
import { MAIL_PORT, MailMessage } from './../src/mail/mail.port';
import {
  NOTICE_BUDGET_THROTTLER,
  NoticeBudgetService,
} from './../src/notifications/notice-budget.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { deleteLeads } from './helpers/leads';

const LIMIT = 2;
const LEADS = LIMIT + 2;
const APPROVER_EMAIL = 'cupo-aprobador.e2e@example.com';
const RESET_EMAIL = 'cupo-recuperacion.e2e@example.com';

/**
 * Spam del formulario público desde muchas IP (PF-36): los leads se registran
 * todos, pero los avisos al equipo no pasan del cupo y los correos críticos
 * siguen saliendo.
 */
describe('Cupo de avisos de lead nuevo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sent: MailMessage[] = [];
  const leadIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PORT)
      .useValue({
        send: async (message: MailMessage) => {
          sent.push(message);
          return { sent: true, providerId: 'e2e' };
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.user.deleteMany({
      where: { email: { in: [APPROVER_EMAIL, RESET_EMAIL] } },
    });
    await prisma.user.createMany({
      data: [
        {
          name: 'Aprobador',
          email: APPROVER_EMAIL,
          passwordHash: 'x',
          role: 'ADMIN',
        },
        {
          name: 'Revisor',
          email: RESET_EMAIL,
          passwordHash: 'x',
          role: 'REVIEWER',
        },
      ],
    });
  });

  afterAll(async () => {
    if (leadIds.length > 0) {
      await deleteLeads(prisma, { id: { in: leadIds } });
    }
    await prisma.user.deleteMany({
      where: { email: { in: [APPROVER_EMAIL, RESET_EMAIL] } },
    });
    await app.close();
  });

  const noticeLogs = (action: string) =>
    prisma.auditLog.findMany({
      where: { entity: 'Lead', entityId: { in: leadIds }, action },
    });

  it('registra todos los leads, pero los avisos no pasan del cupo', async () => {
    for (let i = 0; i < LEADS; i++) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/leads/prequalification')
        .set('X-Forwarded-For', `203.0.113.${i + 1}`)
        .send({
          name: `Spam ${i}`,
          email: `spam-${i}.e2e@example.com`,
          family: 'CATALOG',
        })
        .expect(201);
      // La respuesta al sitio no cambia.
      expect(Object.keys(response.body).sort()).toEqual(['id', 'status']);
      leadIds.push(response.body.id);
    }

    await expect(
      prisma.lead.count({ where: { id: { in: leadIds } } }),
    ).resolves.toBe(LEADS);

    // Los avisos van en segundo plano: el orden entre leads no está garantizado.
    await vi.waitFor(async () => {
      const suppressed = await noticeLogs('EMAIL_SUPPRESSED');
      expect(suppressed).toHaveLength(LEADS - LIMIT);
    });
    const suppressed = await noticeLogs('EMAIL_SUPPRESSED');
    for (const log of suppressed) {
      expect(log.actorType).toBe('SYSTEM');
      expect(log.data).toEqual({
        type: 'NEW_LEAD_NOTICE',
        reason: 'DAILY_LIMIT',
      });
      expect(JSON.stringify(log.data)).not.toMatch(/Spam|example\.com/);
    }

    await vi.waitFor(async () => {
      const notified = new Set(
        (await noticeLogs('EMAIL_SENT')).map((log) => log.entityId),
      );
      expect(notified.size).toBe(LIMIT);
    });
    const notified = new Set(
      (await noticeLogs('EMAIL_SENT')).map((log) => log.entityId),
    );
    // Ningún lead tiene las dos cosas.
    for (const log of suppressed) {
      expect(notified.has(log.entityId)).toBe(false);
    }
  });

  it('pasado el cupo, la recuperación de contraseña sigue saliendo', async () => {
    const before = sent.length;

    await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/request')
      .send({ email: RESET_EMAIL })
      .expect(200);

    await vi.waitFor(() =>
      expect(
        sent.slice(before).some((message) => message.to === RESET_EMAIL),
      ).toBe(true),
    );
  });
});

/**
 * El contador en Postgres: se comparte entre instancias (cada servicio es una)
 * y la ventana vuelve a empezar al vencer.
 */
describe('Contador del cupo en Postgres (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const notice = `e2e-${randomUUID()}`;

  const instance = () =>
    new NoticeBudgetService(prisma, {
      get: () => 'postgres',
    } as unknown as ConfigService<ValidatedEnv, true>);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    const keys = [notice, `${notice}-paralelo`, `${notice}-ventana`].map(
      (name) => createHash('sha256').update(name).digest('hex'),
    );
    await prisma.throttleCounter.deleteMany({
      where: { throttler: NOTICE_BUDGET_THROTTLER, key: { in: keys } },
    });
    await app.close();
  });

  it('dos instancias suman sobre el mismo contador', async () => {
    const [a, b] = [instance(), instance()];

    await expect(a.consume(notice)).resolves.toBe(1);
    await expect(b.consume(notice)).resolves.toBe(2);
    await expect(a.consume(notice)).resolves.toBe(3);
  });

  it('los avisos simultáneos no se pierden', async () => {
    const key = `${notice}-paralelo`;
    const counts = await Promise.all(
      Array.from({ length: 10 }, (_, i) => instance().consume(key, 60_000 + i)),
    );

    expect([...counts].sort((x, y) => x - y)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('al vencer la ventana vuelve a empezar', async () => {
    const key = `${notice}-ventana`;
    const budget = instance();

    await budget.consume(key, 50);
    await expect(budget.consume(key, 50)).resolves.toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 80));

    await expect(budget.consume(key, 50)).resolves.toBe(1);
  });
});

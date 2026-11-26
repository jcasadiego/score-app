import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { INestApplication, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../generated/prisma/client';
import {
  CrmSyncErrorCode,
  CrmSyncEventStatus,
  CrmSyncEventType,
  DiagnosticFamily,
  UserRole,
} from '../generated/prisma/enums';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { CrmSyncService, MAX_ATTEMPTS } from './../src/crm/crm-sync.service';
import { CrmAdapter, CrmAdapterError } from './../src/crm/crm.port';
import { MAIL_PORT } from './../src/mail/mail.port';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Sincronización con el CRM (PF-80) contra un Postgres real: transacción,
 * reintentos, orden por lead y concurrencia del procesador. La bitácora es de
 * solo inserción: base propia, creada y borrada aquí.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const DATABASE = `score_crm_${process.pid}`;
const LEADS = '/api/v1/leads';
const PREQUALIFICATION = `${LEADS}/prequalification`;

function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${name}`;
  return url.toString();
}

describe('CRM (e2e, base propia)', () => {
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let app: INestApplication;
  let prisma: PrismaService;
  let sync: CrmSyncService;
  let adapter: CrmAdapter;
  let approver: { id: string; token: string };
  let reviewer: { id: string; token: string };
  let leadCount = 0;
  const logged: string[] = [];

  const server = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function signedIn(name: string, role: UserRole) {
    const user = await prisma.user.create({
      data: { name, email: `${name}@test.local`, passwordHash: 'x', role },
    });
    const session = await prisma.userSession.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const token = await app
      .get(JwtService)
      .signAsync(
        { sub: user.id, ver: user.sessionVersion, sid: session.id },
        { secret: process.env.JWT_SECRET, audience: 'panel-session' },
      );
    return { id: user.id, token };
  }

  function contact() {
    leadCount += 1;
    return {
      name: `Persona Privada ${leadCount}`,
      email: `privada${leadCount}@cliente.test`,
      phone: `+52 55 0000 ${String(leadCount).padStart(4, '0')}`,
      family: DiagnosticFamily.CATALOG,
      utmSource: 'instagram',
    };
  }

  /** Lead creado en la base, con los eventos dados en ese orden. */
  async function leadWithEvents(
    ...events: { type: CrmSyncEventType; status?: CrmSyncEventStatus }[]
  ) {
    const lead = await prisma.lead.create({ data: contact() });
    const ids: string[] = [];
    for (const [i, event] of events.entries()) {
      const failed = event.status === CrmSyncEventStatus.FAILED;
      const row = await prisma.crmSyncEvent.create({
        data: {
          leadId: lead.id,
          type: event.type,
          status: event.status,
          // Orden estable aunque se creen en el mismo milisegundo.
          createdAt: new Date(Date.now() - 60_000 + i * 1_000),
          // `SENT` necesita su fecha (CHECK en la base).
          ...(event.status === CrmSyncEventStatus.SENT && {
            sentAt: new Date(),
          }),
          ...(failed && {
            attempts: MAX_ATTEMPTS,
            lastErrorCode: CrmSyncErrorCode.PROVIDER_ERROR,
            lastHttpStatus: 503,
          }),
        },
      });
      ids.push(row.id);
    }
    return { lead, ids };
  }

  /** Espera a que la pasada en curso termine (la app la dispara sola). */
  async function settled() {
    await (sync as unknown as { running: Promise<void> | null }).running;
  }

  beforeAll(async () => {
    vi.spyOn(AppThrottlerGuard.prototype, 'canActivate').mockResolvedValue(
      true,
    );
    // Todo lo que escriben los logs, para comprobar que no llevan datos del lead.
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(
        (...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        },
      );
    }
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`,
    );
    await admin.$executeRawUnsafe(`CREATE DATABASE ${DATABASE}`);
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl(DATABASE) },
      stdio: 'pipe',
    });
    process.env.DATABASE_URL = databaseUrl(DATABASE);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_PORT)
      .useValue({ send: async () => ({ sent: true, providerId: 'e2e' }) })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    sync = app.get(CrmSyncService);
    adapter = (sync as unknown as { adapter: CrmAdapter }).adapter;
    approver = await signedIn('aprobador', UserRole.ADMIN);
    reviewer = await signedIn('revisor', UserRole.REVIEWER);
  }, 60_000);

  afterEach(async () => {
    await settled();
    vi.mocked(adapter.upsertContact).mockRestore?.();
  });

  afterAll(async () => {
    await app?.close();
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`,
    );
    await admin.$disconnect();
    vi.restoreAllMocks();
  });

  describe('permisos', () => {
    it.each([
      ['get', '/api/v1/crm/status'],
      ['get', `${LEADS}/x/crm-sync-events`],
      ['post', `${LEADS}/x/crm-sync-events/y/retry`],
    ] as const)('%s %s sin sesión responde 401', async (method, path) => {
      await server()[method](path).expect(401);
    });

    it('ambos roles ven el modo del CRM, sin token ni ids de la cuenta', async () => {
      for (const user of [approver, reviewer]) {
        const { body } = await server()
          .get('/api/v1/crm/status')
          .set(as(user.token))
          .expect(200);
        expect(body).toEqual({ provider: 'simulated', simulated: true });
      }
    });
  });

  describe('bandeja de salida', () => {
    it('el lead del formulario deja su evento y llega al CRM con su id de contacto', async () => {
      const { body } = await server()
        .post(PREQUALIFICATION)
        .send(contact())
        .expect(201);
      await settled();

      const [event] = await prisma.crmSyncEvent.findMany({
        where: { leadId: body.id },
      });
      expect(event).toMatchObject({
        type: CrmSyncEventType.LEAD_CREATED,
        status: CrmSyncEventStatus.SENT,
        attempts: 1,
      });
      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(lead.crmContactId).toMatch(/^sim_/);
    });

    it('si el evento no se puede guardar, tampoco queda el lead', async () => {
      const data = contact();
      const enqueue = vi
        .spyOn(sync, 'enqueue')
        .mockRejectedValueOnce(new Error('falla la bandeja'));

      await server().post(PREQUALIFICATION).send(data).expect(500);

      expect(await prisma.lead.count({ where: { email: data.email } })).toBe(0);
      enqueue.mockRestore();
    });

    it('si el CRM falla, el formulario responde igual y el evento se reprograma', async () => {
      vi.spyOn(adapter, 'upsertContact').mockRejectedValue(
        new CrmAdapterError(CrmSyncErrorCode.PROVIDER_ERROR, 503),
      );

      const { body } = await server()
        .post(PREQUALIFICATION)
        .send(contact())
        .expect(201);
      await settled();

      const event = await prisma.crmSyncEvent.findFirstOrThrow({
        where: { leadId: body.id },
      });
      expect(event).toMatchObject({
        status: CrmSyncEventStatus.PENDING,
        attempts: 1,
        lastErrorCode: CrmSyncErrorCode.PROVIDER_ERROR,
        lastHttpStatus: 503,
      });
      expect(event.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      // Todavía no toca: una pasada ahora no lo envía.
      await expect(sync.processDue()).resolves.toBe(0);

      // En el último intento queda fallido; el lead no cambia.
      await prisma.crmSyncEvent.update({
        where: { id: event.id },
        data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date() },
      });
      await sync.processDue();
      expect(
        await prisma.crmSyncEvent.findUniqueOrThrow({
          where: { id: event.id },
        }),
      ).toMatchObject({ status: CrmSyncEventStatus.FAILED });
      expect(
        await prisma.lead.findUniqueOrThrow({ where: { id: body.id } }),
      ).toMatchObject({ status: 'NEW', crmContactId: null });
    });

    it('un evento fallido detiene los siguientes del lead hasta que se reintenta', async () => {
      const { lead, ids } = await leadWithEvents(
        {
          type: CrmSyncEventType.LEAD_CREATED,
          status: CrmSyncEventStatus.FAILED,
        },
        { type: CrmSyncEventType.DIAGNOSTIC_ACTIVATED },
      );

      await sync.processDue();
      expect(
        await prisma.crmSyncEvent.findUniqueOrThrow({ where: { id: ids[1] } }),
      ).toMatchObject({ status: CrmSyncEventStatus.PENDING, attempts: 0 });

      const { body } = await server()
        .post(`${LEADS}/${lead.id}/crm-sync-events/${ids[0]}/retry`)
        .set(as(reviewer.token))
        .expect(202);
      expect(body.id).toBe(ids[0]);
      await settled();

      const events = await prisma.crmSyncEvent.findMany({
        where: { leadId: lead.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => e.status)).toEqual(['SENT', 'SENT']);
      expect(events[0].sentAt!.getTime()).toBeLessThanOrEqual(
        events[1].sentAt!.getTime(),
      );
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'CRM_SYNC_RETRIED', entityId: ids[0] },
      });
      expect(log).toMatchObject({
        actorType: 'PANEL_USER',
        actorId: reviewer.id,
      });
    });

    it('reintentar un evento que no está fallido da 409; uno de otro lead, 404', async () => {
      const first = await leadWithEvents({
        type: CrmSyncEventType.LEAD_CREATED,
        status: CrmSyncEventStatus.FAILED,
      });
      const other = await leadWithEvents({
        type: CrmSyncEventType.LEAD_CREATED,
        status: CrmSyncEventStatus.FAILED,
      });
      const retry = (leadId: string, eventId: string) =>
        server()
          .post(`${LEADS}/${leadId}/crm-sync-events/${eventId}/retry`)
          .set(as(approver.token));

      await retry(other.lead.id, first.ids[0]).expect(404);
      await retry(first.lead.id, first.ids[0]).expect(202);
      const { body } = await retry(first.lead.id, first.ids[0]).expect(409);
      expect(body.code).toBe('CRM_SYNC_EVENT_NOT_FAILED');
    });

    it('dos pasadas a la vez nunca envían el mismo evento', async () => {
      const leads = await Promise.all(
        Array.from({ length: 8 }, () =>
          leadWithEvents({ type: CrmSyncEventType.LEAD_CREATED }),
        ),
      );
      const upsert = vi.spyOn(adapter, 'upsertContact');

      const processed = await Promise.all([
        sync.processDue(),
        sync.processDue(),
        sync.processDue(),
      ]);

      expect(processed.reduce((a, b) => a + b, 0)).toBe(leads.length);
      expect(upsert).toHaveBeenCalledTimes(leads.length);
      expect(
        await prisma.crmSyncEvent.count({
          where: {
            leadId: { in: leads.map((l) => l.lead.id) },
            status: CrmSyncEventStatus.SENT,
            attempts: 1,
          },
        }),
      ).toBe(leads.length);
    });
  });

  describe('lo que ve el panel', () => {
    it('lista los eventos de un lead, del más reciente al más antiguo, paginados', async () => {
      const { lead, ids } = await leadWithEvents(
        {
          type: CrmSyncEventType.LEAD_CREATED,
          status: CrmSyncEventStatus.SENT,
        },
        { type: CrmSyncEventType.DIAGNOSTIC_ACTIVATED },
        { type: CrmSyncEventType.DIAGNOSTIC_STARTED },
      );

      const { body } = await server()
        .get(`${LEADS}/${lead.id}/crm-sync-events`)
        .query({ page: 1, pageSize: 2 })
        .set(as(reviewer.token))
        .expect(200);
      expect(body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(body.data.map((e: { id: string }) => e.id)).toEqual([
        ids[2],
        ids[1],
      ]);
      expect(Object.keys(body.data[0]).sort()).toEqual(
        [
          'attempts',
          'createdAt',
          'id',
          'lastErrorCode',
          'lastHttpStatus',
          'nextAttemptAt',
          'sentAt',
          'status',
          'type',
        ].sort(),
      );

      await server()
        .get(`${LEADS}/no-existe/crm-sync-events`)
        .set(as(reviewer.token))
        .expect(404);
    });

    it('el listado de leads filtra por envío fallido y el detalle trae el estado', async () => {
      const failed = await leadWithEvents({
        type: CrmSyncEventType.LEAD_CREATED,
        status: CrmSyncEventStatus.FAILED,
      });

      const { body } = await server()
        .get(LEADS)
        .query({ crmSyncStatus: 'FAILED', pageSize: 100 })
        .set(as(reviewer.token))
        .expect(200);
      const ids = body.data.map((l: { id: string }) => l.id);
      expect(ids).toContain(failed.lead.id);
      expect(
        body.data.every(
          (l: { crmSyncStatus: string }) => l.crmSyncStatus === 'FAILED',
        ),
      ).toBe(true);

      const { body: detail } = await server()
        .get(`${LEADS}/${failed.lead.id}`)
        .set(as(reviewer.token))
        .expect(200);
      expect(detail.crmSyncStatus).toBe('FAILED');

      await server()
        .get(LEADS)
        .query({ crmSyncStatus: 'ROTO' })
        .set(as(reviewer.token))
        .expect(400);
    });
  });

  it('ni los logs, ni la bitácora, ni los eventos guardan datos del lead', async () => {
    await settled();
    const leads = await prisma.lead.findMany({
      select: { name: true, email: true, phone: true },
    });
    const secrets = leads.flatMap((l) => [l.name, l.email, l.phone ?? '']);
    const audit = JSON.stringify(
      await prisma.auditLog.findMany({
        where: { action: { startsWith: 'CRM_' } },
      }),
    );
    const events = JSON.stringify(await prisma.crmSyncEvent.findMany());

    expect(audit).toContain('CRM_SYNC_SENT');
    for (const secret of secrets.filter(Boolean)) {
      expect(audit).not.toContain(secret);
      expect(events).not.toContain(secret);
      expect(logged.some((line) => line.includes(secret))).toBe(false);
    }
  });
});

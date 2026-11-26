// Antes de importar AppModule: ConfigModule valida el entorno al cargarse.
vi.hoisted(() => {
  process.env.SECURITY_ALERT_EMAIL = 'soporte-alertas.e2e@example.com';
});

import { createHash, randomInt } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './../src/app.module';
import { MAIL_PORT, MailMessage } from './../src/mail/mail.port';
import { PrismaService } from './../src/prisma/prisma.service';
import { ALERT_WINDOW_MS } from './../src/security-alerts/security-alert-rules';
import {
  SECURITY_ALERT_THROTTLER,
  SecurityAlertsService,
} from './../src/security-alerts/security-alerts.service';

/**
 * Alertas de seguridad (PF-55) contra la base: una ráfaga simulada en la
 * bitácora dispara una sola alerta al correo de soporte, aunque revisen dos
 * instancias. La ventana es una del pasado, distinta en cada corrida: la
 * bitácora es de solo inserción y no se puede limpiar.
 */
describe('Alertas de seguridad (e2e)', () => {
  const apps: INestApplication[] = [];
  const sent: MailMessage[] = [];
  let prisma: PrismaService;
  const windowStart =
    Date.UTC(2001, 0, 1) + randomInt(1_000_000) * ALERT_WINDOW_MS;
  // Un poco después de cerrar la ventana, pasado el margen.
  const now = windowStart + ALERT_WINDOW_MS + 30_000;
  const alertIds = ['AUTHENTICATION_FAILED', 'MFA_RESET'].map(
    (action) => `${action}:${new Date(windowStart).toISOString()}`,
  );

  async function startInstance(): Promise<INestApplication> {
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
    const app = moduleFixture.createNestApplication();
    await app.init();
    apps.push(app);
    return app;
  }

  beforeAll(async () => {
    prisma = (await startInstance()).get(PrismaService);
    await startInstance();

    const at = (offsetMs: number) => new Date(windowStart + offsetMs);
    await prisma.auditLog.createMany({
      data: [
        ...Array.from({ length: 20 }, (_, i) => ({
          actorType: 'PANEL_USER' as const,
          action: 'AUTHENTICATION_FAILED',
          entity: '/auth/login',
          data: { method: 'POST', status: 401 },
          createdAt: at(i * 1000),
        })),
        {
          actorType: 'PANEL_USER' as const,
          action: 'MFA_RESET',
          entity: 'User',
          createdAt: at(60_000),
        },
        // Debajo del umbral: no alerta.
        {
          actorType: 'PANEL_USER' as const,
          action: 'ACCOUNT_LOCKED',
          entity: 'User',
          createdAt: at(90_000),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.throttleCounter.deleteMany({
      where: {
        throttler: SECURITY_ALERT_THROTTLER,
        key: {
          in: alertIds.map((id) =>
            createHash('sha256').update(id).digest('hex'),
          ),
        },
      },
    });
    await Promise.all(apps.map((app) => app.close()));
  });

  it('con dos instancias revisando, cada alerta sale una sola vez y solo a soporte', async () => {
    const [a, b] = apps.map((app) => app.get(SecurityAlertsService));

    const results = await Promise.all([a.check(now), b.check(now)]);
    expect(results[0] + results[1]).toBe(2);
    // Una pasada más tarde no repite.
    await expect(a.check(now + 60_000)).resolves.toBe(0);

    const alerts = sent.filter((m) =>
      m.subject.startsWith('Alerta de seguridad'),
    );
    expect(alerts.map((m) => m.subject).sort()).toEqual([
      'Alerta de seguridad en SCORE: Muchos intentos fallidos de autenticación',
      'Alerta de seguridad en SCORE: Se restableció el segundo factor de un usuario',
    ]);
    for (const alert of alerts) {
      expect(alert.to).toBe('soporte-alertas.e2e@example.com');
    }

    const logs = await prisma.auditLog.findMany({
      where: { entity: 'SecurityAlert', entityId: { in: alertIds } },
    });
    expect(logs).toHaveLength(2);
    for (const log of logs) {
      expect(log.action).toBe('EMAIL_SENT');
      expect(JSON.stringify(log.data)).not.toContain('example.com');
    }
  });
});

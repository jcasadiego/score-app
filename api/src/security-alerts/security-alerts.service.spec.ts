import type { Mock } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnv } from '../config/validate-env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityAlertsService } from './security-alerts.service';

const NOW = Date.parse('2026-11-26T10:07:30Z');
const SUPPORT = 'soporte@example.com';

describe('SecurityAlertsService', () => {
  let groupBy: Mock;
  let claimed: Set<string>;
  let prisma: {
    auditLog: { groupBy: Mock };
    $queryRaw: Mock;
    throttleCounter: { deleteMany: Mock };
  };
  let mail: { sendSecurityAlert: Mock };
  let email: string | undefined;
  let service: SecurityAlertsService;

  /** Conteos por acción para la ventana que empieza en `start` (ISO). */
  function counts(byWindow: Record<string, Record<string, number>>) {
    groupBy.mockImplementation(async ({ where }) =>
      Object.entries(
        byWindow[(where.createdAt.gte as Date).toISOString()] ?? {},
      ).map(([action, n]) => ({ action, _count: { _all: n } })),
    );
  }

  beforeEach(() => {
    groupBy = vi.fn().mockResolvedValue([]);
    claimed = new Set();
    prisma = {
      auditLog: { groupBy },
      // La marca en Postgres: solo el primero que la inserta la obtiene.
      $queryRaw: vi.fn(async (_strings: TemplateStringsArray, key: string) => {
        if (claimed.has(key)) return [];
        claimed.add(key);
        return [{ key }];
      }),
      throttleCounter: {
        deleteMany: vi.fn(async ({ where }) => {
          claimed.delete(where.key);
          return { count: 1 };
        }),
      },
    };
    mail = {
      sendSecurityAlert: vi.fn().mockResolvedValue({ sent: true }),
    };
    email = SUPPORT;
    const config = { get: vi.fn(() => email) };
    service = new SecurityAlertsService(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
      config as unknown as ConfigService<ValidatedEnv, true>,
    );
  });

  it('alerta al correo de soporte cuando una ráfaga pasa el umbral', async () => {
    counts({
      '2026-11-26T10:00:00.000Z': { AUTHENTICATION_FAILED: 25 },
    });

    await expect(service.check(NOW)).resolves.toBe(1);

    expect(mail.sendSecurityAlert).toHaveBeenCalledWith(
      SUPPORT,
      {
        event: 'Muchos intentos fallidos de autenticación',
        count: 25,
        threshold: 20,
        windowStart: '2026-11-26T10:00:00.000Z',
        windowEnd: '2026-11-26T10:05:00.000Z',
      },
      {
        entity: 'SecurityAlert',
        entityId: 'AUTHENTICATION_FAILED:2026-11-26T10:00:00.000Z',
      },
    );
  });

  it('bajo el umbral no alerta', async () => {
    counts({
      '2026-11-26T10:00:00.000Z': {
        AUTHENTICATION_FAILED: 19,
        ACCOUNT_LOCKED: 2,
      },
    });

    await expect(service.check(NOW)).resolves.toBe(0);
    expect(mail.sendSecurityAlert).not.toHaveBeenCalled();
  });

  it('cada MFA restablecido genera una alerta', async () => {
    counts({ '2026-11-26T09:55:00.000Z': { MFA_RESET: 1 } });

    await expect(service.check(NOW)).resolves.toBe(1);
    expect(mail.sendSecurityAlert.mock.calls[0][1].event).toBe(
      'Se restableció el segundo factor de un usuario',
    );
  });

  it('la misma alerta no sale dos veces, aunque se revise de nuevo', async () => {
    counts({ '2026-11-26T10:00:00.000Z': { ACCESS_DENIED: 30 } });

    await service.check(NOW);
    // Un minuto después la ventana sigue entre las revisadas.
    await expect(service.check(NOW + 60_000)).resolves.toBe(0);
    expect(mail.sendSecurityAlert).toHaveBeenCalledOnce();
  });

  it('si el correo falla, suelta la marca y la próxima pasada reintenta', async () => {
    counts({ '2026-11-26T10:00:00.000Z': { REQUEST_FAILED: 12 } });
    mail.sendSecurityAlert.mockResolvedValueOnce({
      sent: false,
      reason: 'proveedor caído',
    });

    await expect(service.check(NOW)).resolves.toBe(0);
    await expect(service.check(NOW)).resolves.toBe(1);
    expect(mail.sendSecurityAlert).toHaveBeenCalledTimes(2);
  });

  it('sin correo de soporte no consulta ni envía nada', async () => {
    email = undefined;

    await expect(service.check(NOW)).resolves.toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('el correo de la alerta no lleva usuarios ni datos personales', async () => {
    counts({ '2026-11-26T10:00:00.000Z': { ACCOUNT_LOCKED: 4 } });

    await service.check(NOW);

    const [, data, context] = mail.sendSecurityAlert.mock.calls[0];
    expect(Object.keys(data).sort()).toEqual([
      'count',
      'event',
      'threshold',
      'windowEnd',
      'windowStart',
    ]);
    expect(context.entityId).toMatch(/^ACCOUNT_LOCKED:/);
  });
});

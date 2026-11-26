import type { Mock } from 'vitest';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MfaKeyRotationService } from './mfa-key-rotation.service';
import {
  currentMfaPrefix,
  decryptMfaSecret,
  encryptMfaSecret,
} from './secret-cipher';

const OLD_KEY = Buffer.alloc(32, 7).toString('base64');
const NEW_KEY = Buffer.alloc(32, 8).toString('base64');
const SECRET = Buffer.from('12345678901234567890');

describe('MfaKeyRotationService', () => {
  let rows: { id: string; mfaSecret: string | null }[];
  let prisma: { user: { findMany: Mock; updateMany: Mock } };
  let audit: { record: Mock };
  let service: MfaKeyRotationService;

  beforeEach(() => {
    process.env.MFA_ENCRYPTION_KEY = OLD_KEY;
    delete process.env.MFA_ENCRYPTION_PREVIOUS_KEYS;
    rows = [
      { id: 'u1', mfaSecret: encryptMfaSecret(SECRET, 'u1') },
      { id: 'u2', mfaSecret: encryptMfaSecret(SECRET, 'u2') },
    ];
    // Rota: la llave vieja pasa a las anteriores.
    process.env.MFA_ENCRYPTION_KEY = NEW_KEY;
    process.env.MFA_ENCRYPTION_PREVIOUS_KEYS = OLD_KEY;

    // Imita el filtro de la base: pendientes, por id, después del cursor.
    prisma = {
      user: {
        findMany: vi.fn(async ({ where, take, cursor }) => {
          const prefix = where.NOT.mfaSecret.startsWith;
          return rows
            .filter((r) => r.mfaSecret && !r.mfaSecret.startsWith(prefix))
            .filter((r) => !cursor || r.id > cursor.id)
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, take)
            .map((r) => ({ ...r }));
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          const row = rows.find(
            (r) => r.id === where.id && r.mfaSecret === where.mfaSecret,
          );
          if (!row) return { count: 0 };
          row.mfaSecret = data.mfaSecret;
          return { count: 1 };
        }),
      },
    };
    audit = { record: vi.fn().mockResolvedValue({}) };
    service = new MfaKeyRotationService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  afterAll(() => {
    delete process.env.MFA_ENCRYPTION_PREVIOUS_KEYS;
  });

  it('recifra con la llave actual sin cambiar el secreto de nadie', async () => {
    await expect(service.reencryptAll()).resolves.toEqual({
      reencrypted: 2,
      failed: 0,
    });

    for (const row of rows) {
      expect(row.mfaSecret!.startsWith(currentMfaPrefix())).toBe(true);
      // Ya sin la llave vieja, sigue descifrando: nadie pierde su MFA.
      delete process.env.MFA_ENCRYPTION_PREVIOUS_KEYS;
      expect(decryptMfaSecret(row.mfaSecret!, row.id)).toEqual(SECRET);
      process.env.MFA_ENCRYPTION_PREVIOUS_KEYS = OLD_KEY;
    }
    expect(audit.record).toHaveBeenCalledWith({
      actorType: 'SYSTEM',
      action: 'MFA_SECRETS_REENCRYPTED',
      entity: 'User',
      data: { reencrypted: 2, failed: 0 },
    });
  });

  it('una segunda pasada no hace nada ni deja constancia', async () => {
    await service.reencryptAll();
    audit.record.mockClear();

    await expect(service.reencryptAll()).resolves.toEqual({
      reencrypted: 0,
      failed: 0,
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('un secreto con llave desconocida queda como está y se cuenta', async () => {
    const unknown = rows[0].mfaSecret;
    delete process.env.MFA_ENCRYPTION_PREVIOUS_KEYS;
    rows[1].mfaSecret = encryptMfaSecret(SECRET, 'u2');

    await expect(service.reencryptAll()).resolves.toEqual({
      reencrypted: 0,
      failed: 1,
    });
    expect(rows[0].mfaSecret).toBe(unknown);
  });

  it('no pisa un MFA que cambió mientras se recifraba', async () => {
    prisma.user.updateMany.mockImplementationOnce(async () => ({ count: 0 }));

    await expect(service.reencryptAll()).resolves.toEqual({
      reencrypted: 1,
      failed: 0,
    });
  });

  it('al arrancar, un fallo de la base no impide levantar la API', async () => {
    prisma.user.findMany.mockRejectedValue(new Error('db caída'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});

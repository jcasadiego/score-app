// Antes de importar AppModule: ConfigModule valida el entorno al cargarse. La
// llave actual sigue siendo la de los tests (vitest.config.e2e.mts), así las
// otras suites, que corren en paralelo, no se ven afectadas.
vi.hoisted(() => {
  process.env.MFA_ENCRYPTION_PREVIOUS_KEYS = Buffer.alloc(32, 42).toString(
    'base64',
  );
});

import { createCipheriv, randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './../src/app.module';
import { MfaKeyRotationService } from './../src/auth/mfa/mfa-key-rotation.service';
import {
  currentMfaPrefix,
  decryptMfaSecret,
} from './../src/auth/mfa/secret-cipher';
import { PrismaService } from './../src/prisma/prisma.service';

const OLD_KEY = Buffer.alloc(32, 42);
const EMAIL = 'rotacion-mfa.e2e@example.com';
const SECRET = Buffer.from('rotacion-secreto-20b');

/** Como lo guardaba la versión anterior (v1), con la llave vieja. */
function encryptV1(secret: Buffer, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', OLD_KEY, iv);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(secret), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((part) =>
      typeof part === 'string' ? part : part.toString('base64url'),
    )
    .join('.');
}

/**
 * Rotación de `MFA_ENCRYPTION_KEY` (PF-57): un secreto cifrado con la llave
 * vieja queda recifrado con la actual al arrancar, sin que cambie el secreto.
 */
describe('Rotación de la llave MFA (e2e)', () => {
  const apps: INestApplication[] = [];
  let prisma: PrismaService;
  let userId: string;

  async function startInstance(): Promise<INestApplication> {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleFixture.createNestApplication();
    await app.init();
    apps.push(app);
    return app;
  }

  beforeAll(async () => {
    prisma = (await startInstance()).get(PrismaService);
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    const user = await prisma.user.create({
      data: {
        name: 'Rotación',
        email: EMAIL,
        passwordHash: 'x',
        role: 'ADMIN',
      },
    });
    userId = user.id;
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptV1(SECRET, userId) },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await Promise.all(apps.map((app) => app.close()));
  });

  it('al arrancar, recifra con la llave actual y el secreto no cambia', async () => {
    // Un despliegue nuevo, con la llave vieja entre las anteriores.
    await startInstance();

    const { mfaSecret } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(mfaSecret!.startsWith(currentMfaPrefix())).toBe(true);
    expect(decryptMfaSecret(mfaSecret!, userId)).toEqual(SECRET);

    const log = await prisma.auditLog.findFirst({
      where: { action: 'MFA_SECRETS_REENCRYPTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.actorType).toBe('SYSTEM');
    expect(JSON.stringify(log?.data)).not.toContain(EMAIL);
  });

  it('una segunda pasada ya no tiene nada que recifrar para este usuario', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    await apps[0].get(MfaKeyRotationService).reencryptAll();

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(after.mfaSecret).toBe(before.mfaSecret);
  });
});

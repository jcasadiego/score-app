import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { PrismaService } from './../src/prisma/prisma.service';
import { MAX_FAILED_LOGINS } from './../src/users/users.service';

const EMAIL = 'bloqueo.e2e@example.com';
const PASSWORD = 'clave-de-bloqueo-123';

describe('Bloqueo de cuenta por intentos fallidos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;

  const login = (password: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password });

  /** El conteo es en segundo plano: espera a que el intento quede registrado. */
  const attempts = (expected: number) =>
    vi.waitFor(async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(user.failedLoginAttempts).toBe(expected);
    });

  beforeAll(async () => {
    // Fuera el límite por IP: aquí se prueba el límite por cuenta. Con un espía
    // porque es un `APP_GUARD`, y a esos `overrideGuard` no los alcanza.
    vi.spyOn(AppThrottlerGuard.prototype, 'canActivate').mockResolvedValue(
      true,
    );
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    ({ id: userId } = await prisma.user.create({
      data: {
        name: 'Bloqueo',
        email: EMAIL,
        passwordHash: await argon2.hash(PASSWORD),
        role: 'ADMIN',
      },
    }));
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await app.close();
    vi.restoreAllMocks();
  });

  it('bloquea al llegar al máximo, incluso con la contraseña correcta', async () => {
    const since = new Date();
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      await login('contraseña-incorrecta').expect(401);
      await attempts(i);
    }
    await login('contraseña-incorrecta').expect(401);

    const log = await vi.waitFor(() =>
      prisma.auditLog
        .findFirst({
          where: {
            action: 'ACCOUNT_LOCKED',
            entityId: userId,
            createdAt: { gte: since },
          },
        })
        .then((r) => r ?? Promise.reject(new Error('sin registro aún'))),
    );
    expect(log.requestId).toMatch(/^[0-9a-f-]{36}$/);

    const blocked = await login(PASSWORD).expect(401);
    expect(blocked.body.detail).toBe('Credenciales inválidas');
  });

  it('la contraseña correcta sola no reinicia el contador', async () => {
    await login('contraseña-incorrecta').expect(401);
    await attempts(1);

    await login(PASSWORD).expect(200);

    await attempts(1);
  });
});

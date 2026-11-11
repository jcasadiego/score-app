import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { MAIL_PORT, MailMessage } from './../src/mail/mail.port';
import { PrismaService } from './../src/prisma/prisma.service';
import { MAX_FAILED_LOGINS } from './../src/users/users.service';

const EMAIL = 'bloqueo.e2e@example.com';
const PASSWORD = 'clave-de-bloqueo-123';

describe('Bloqueo de cuenta por intentos fallidos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;
  const sentMessages: MailMessage[] = [];
  let failMail = false;

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
    })
      // Captura el aviso de bloqueo en vez de mandarlo.
      .overrideProvider(MAIL_PORT)
      .useValue({
        send: async (message: MailMessage) => {
          if (failMail) throw new Error('proveedor caído');
          sentMessages.push(message);
          return { sent: true, providerId: 'e2e' };
        },
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  /** Agota los intentos con contraseñas incorrectas y espera el bloqueo. */
  async function lockAccount() {
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      await login('contraseña-incorrecta').expect(401);
      await attempts(i);
    }
    await login('contraseña-incorrecta').expect(401);
    await vi.waitFor(async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(user.lockedUntil).not.toBeNull();
    });
  }

  const mailAudit = (action: string, since: Date) =>
    prisma.auditLog.findFirst({
      where: { action, entityId: userId, createdAt: { gte: since } },
    });

  beforeEach(async () => {
    sentMessages.length = 0;
    failMail = false;
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

  it('avisa una sola vez al dueño, con el enlace para restablecer', async () => {
    await lockAccount();
    await vi.waitFor(() => expect(sentMessages).toHaveLength(1));

    // Los intentos durante el bloqueo no cuentan ni vuelven a avisar.
    await login('contraseña-incorrecta').expect(401);
    await login(PASSWORD).expect(401);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].to).toBe(EMAIL);
    expect(sentMessages[0].text).toContain('15 minutos');
    expect(sentMessages[0].text).toMatch(/https?:\/\/\S+\/forgot-password/);
  });

  it('el intento que bloquea responde igual que cualquier otro fallo', async () => {
    const normal = await login('contraseña-incorrecta').expect(401);
    await attempts(1);
    for (let i = 2; i < MAX_FAILED_LOGINS; i++) {
      await login('contraseña-incorrecta').expect(401);
      await attempts(i);
    }
    const locking = await login('contraseña-incorrecta').expect(401);
    // Todo igual salvo lo que identifica a cada petición.
    const comparable = (body: Record<string, unknown>) => ({
      ...body,
      instance: undefined,
      requestId: undefined,
    });

    expect(comparable(locking.body)).toEqual(comparable(normal.body));
  });

  it('si el correo falla, la cuenta se bloquea igual y queda en la bitácora', async () => {
    const since = new Date();
    failMail = true;

    await lockAccount();

    const failed = await vi.waitFor(() =>
      mailAudit('EMAIL_FAILED', since).then(
        (r) => r ?? Promise.reject(new Error('sin registro aún')),
      ),
    );
    expect(JSON.stringify(failed.data)).not.toContain(EMAIL);
    await login(PASSWORD).expect(401);
  });

  it('una cuenta desactivada no recibe el aviso', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { active: false },
    });

    await lockAccount();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(sentMessages).toHaveLength(0);
  });

  it('la contraseña correcta sola no reinicia el contador', async () => {
    await login('contraseña-incorrecta').expect(401);
    await attempts(1);

    await login(PASSWORD).expect(200);

    await attempts(1);
  });
});

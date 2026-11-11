import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AuthService } from './../src/auth/auth.service';
import { decryptMfaSecret } from './../src/auth/mfa/secret-cipher';
import { currentStep, totpAtStep } from './../src/auth/mfa/totp';
import { configureApp } from './../src/bootstrap';
import { AppThrottlerGuard } from './../src/common/app-throttler.guard';
import { PrismaService } from './../src/prisma/prisma.service';
import { LOGIN_LOCK_MS } from './../src/users/users.service';
import { hashToken } from './../src/password-reset/password-link.service';
import { PasswordResetService } from './../src/password-reset/password-reset.service';

const EMAIL = 'mfa.e2e@example.com';
const ADMIN_EMAIL = 'mfa.admin.e2e@example.com';
const PASSWORD = 'clave-de-mfa-e2e-123';
const AUTH = '/api/v1/auth';

describe('Segundo factor del panel (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;

  const server = () => request(app.getHttpServer());
  const login = () =>
    server()
      .post(`${AUTH}/login`)
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
  const challenge = async () => (await login()).body.mfaToken as string;

  /** Código del intervalo actual más `offset`, leyendo el secreto como la API. */
  async function codeFor(offset = 0): Promise<string> {
    const { mfaSecret } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const secret = decryptMfaSecret(mfaSecret as string, userId);
    return totpAtStep(secret, currentStep() + offset);
  }

  /** Configura el autenticador; el intervalo actual queda usado. */
  async function enroll() {
    const mfaToken = await challenge();
    await server()
      .post(`${AUTH}/mfa/enrollment`)
      .send({ mfaToken })
      .expect(200);
    const response = await server()
      .post(`${AUTH}/mfa/enrollment/confirmation`)
      .send({ mfaToken, code: await codeFor() })
      .expect(200);
    return response.body as { accessToken: string; recoveryCodes: string[] };
  }

  const auditCount = (action: string, since: Date) =>
    prisma.auditLog.count({
      where: { action, entityId: userId, createdAt: { gte: since } },
    });

  beforeAll(async () => {
    // Fuera el límite por IP: aquí se prueba el bloqueo por cuenta.
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
    await prisma.user.deleteMany({
      where: { email: { in: [EMAIL, ADMIN_EMAIL] } },
    });
    ({ id: userId } = await prisma.user.create({
      data: {
        name: 'Con MFA',
        email: EMAIL,
        passwordHash: await argon2.hash(PASSWORD),
        role: 'ADMIN',
      },
    }));
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [EMAIL, ADMIN_EMAIL] } },
    });
    await app.close();
    vi.restoreAllMocks();
  });

  it('la contraseña sola no da acceso: el reto no sirve como sesión', async () => {
    const response = await login();

    expect(response.body.mfaStatus).toBe('ENROLLMENT_REQUIRED');
    expect(response.body.accessToken).toBeUndefined();
    await server()
      .get(`${AUTH}/session`)
      .set('Authorization', `Bearer ${response.body.mfaToken}`)
      .expect(401);
  });

  it('un token de sesión no sirve como reto', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { accessToken } = await app.get(AuthService).completeLogin(user);

    const response = await server()
      .post(`${AUTH}/mfa/enrollment`)
      .send({ mfaToken: accessToken })
      .expect(401);

    expect(response.body.code).toBe('MFA_CHALLENGE_EXPIRED');
  });

  it('configura el autenticador y entrega 10 códigos de recuperación', async () => {
    const since = new Date();
    const { accessToken, recoveryCodes } = await enroll();

    expect(new Set(recoveryCodes).size).toBe(10);
    await server()
      .get(`${AUTH}/session`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.mfaEnabledAt).not.toBeNull();
    // Ni el secreto ni los códigos quedan en claro.
    const stored = await prisma.userRecoveryCode.findMany({
      where: { userId },
    });
    expect(stored).toHaveLength(10);
    expect(stored.map((r) => r.codeHash)).not.toContain(recoveryCodes[0]);
    expect(await auditCount('MFA_ENROLLED', since)).toBe(1);
  });

  it('el autenticador no se confirma con un código incorrecto', async () => {
    const mfaToken = await challenge();
    await server()
      .post(`${AUTH}/mfa/enrollment`)
      .send({ mfaToken })
      .expect(200);

    const response = await server()
      .post(`${AUTH}/mfa/enrollment/confirmation`)
      .send({
        mfaToken,
        code: '000000' === (await codeFor()) ? '111111' : '000000',
      })
      .expect(401);

    expect(response.body.code).toBe('INVALID_MFA_CODE');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.mfaEnabledAt).toBeNull();
    expect(user.failedLoginAttempts).toBe(1);
  });

  it('con MFA activo, la contraseña no permite reconfigurarlo', async () => {
    await enroll();
    const { body } = await login();

    expect(body.mfaStatus).toBe('CHALLENGE_REQUIRED');
    await server()
      .post(`${AUTH}/mfa/enrollment`)
      .send({ mfaToken: body.mfaToken })
      .expect(409);
  });

  it('entra con el código, y ese código no sirve dos veces', async () => {
    await enroll();
    const mfaToken = await challenge();
    const code = await codeFor(1);

    const response = await server()
      .post(`${AUTH}/mfa/verification`)
      .send({ mfaToken, code })
      .expect(200);
    expect(response.body.accessToken).toEqual(expect.any(String));

    const replay = await server()
      .post(`${AUTH}/mfa/verification`)
      .send({ mfaToken, code })
      .expect(401);
    expect(replay.body.code).toBe('INVALID_MFA_CODE');
  });

  it('un código de recuperación sirve una sola vez y se audita', async () => {
    const since = new Date();
    const { recoveryCodes } = await enroll();
    const send = async (recoveryCode: string) =>
      server()
        .post(`${AUTH}/mfa/recovery`)
        .send({ mfaToken: await challenge(), recoveryCode });

    // Sin guiones y en minúsculas también vale: se copia a mano.
    const typed = recoveryCodes[0].replace(/-/g, '').toLowerCase();
    expect((await send(typed)).status).toBe(200);
    expect(await auditCount('MFA_RECOVERY_CODE_USED', since)).toBe(1);

    const again = await send(recoveryCodes[0]);
    expect(again.status).toBe(401);
    expect(await auditCount('MFA_RECOVERY_CODE_USED', since)).toBe(1);
  });

  it('volver a poner la contraseña no permite seguir probando códigos', async () => {
    await enroll();
    const wrong = (await codeFor(5)) === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i++) {
      await server()
        .post(`${AUTH}/mfa/verification`)
        .send({ mfaToken: await challenge(), code: wrong })
        .expect(401);
    }
    const mfaToken = await challenge();
    await server()
      .post(`${AUTH}/mfa/verification`)
      .send({ mfaToken, code: wrong })
      .expect(401);

    // Bloqueada: ni la contraseña ni un código correcto abren sesión.
    await server()
      .post(`${AUTH}/login`)
      .send({ email: EMAIL, password: PASSWORD })
      .expect(401);
    await server()
      .post(`${AUTH}/mfa/verification`)
      .send({ mfaToken, code: await codeFor(1) })
      .expect(401);
  });

  /** Restablece la contraseña como lo haría el dueño con el enlace del correo. */
  async function resetPassword(password: string) {
    const token = `token-mfa-e2e-${Math.random()}`;
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await app.get(PasswordResetService).confirm(token, password);
  }

  const loginWith = (password: string) =>
    server().post(`${AUTH}/login`).send({ email: EMAIL, password });

  it('alternar restablecimientos y códigos erróneos no da más intentos de MFA', async () => {
    await enroll();
    const since = new Date();
    const wrong = (await codeFor(5)) === '000000' ? '111111' : '000000';
    let codesTried = 0;

    // Quien controla el buzón: restablece, entra con la contraseña nueva y
    // prueba códigos hasta que la API deja de darle retos.
    for (let round = 0; round < 4; round++) {
      const password = `clave-del-atacante-${round}-xyz`;
      await resetPassword(password);
      for (let i = 0; i < 5; i++) {
        const response = await loginWith(password);
        if (response.status !== 200) break;
        await server()
          .post(`${AUTH}/mfa/verification`)
          .send({ mfaToken: response.body.mfaToken, code: wrong })
          .expect(401);
        codesTried++;
      }
    }

    // Lo mismo que sin restablecer: una tanda de 5 y el bloqueo sigue en pie.
    expect(codesTried).toBe(5);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await auditCount('ACCOUNT_UNLOCKED', since)).toBe(0);
    // Cuatro restablecimientos y varios inicios de sesión: mucho argon2.
  }, 30_000);

  it('cerrar la tanda con una contraseña errónea tampoco deja restablecer el bloqueo', async () => {
    await enroll();
    const wrong = (await codeFor(5)) === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      await server()
        .post(`${AUTH}/mfa/verification`)
        .send({ mfaToken: await challenge(), code: wrong })
        .expect(401);
    }
    // El quinto fallo es de contraseña: el bloqueo no "parece" de MFA.
    await loginWith('contraseña-incorrecta').expect(401);
    await vi.waitFor(async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(user.lockedUntil).not.toBeNull();
    });

    await resetPassword('clave-nueva-de-mfa-456');

    await loginWith('clave-nueva-de-mfa-456').expect(401);
  });

  it('con códigos rechazados hace poco, restablecer tampoco reinicia el contador', async () => {
    await enroll();
    const wrong = (await codeFor(5)) === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      await server()
        .post(`${AUTH}/mfa/verification`)
        .send({ mfaToken: await challenge(), code: wrong })
        .expect(401);
    }

    await resetPassword('clave-nueva-de-mfa-456');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLoginAttempts).toBe(4);
    expect(user.mfaEnabledAt).not.toBeNull();
  });

  it('pasada la duración de un bloqueo desde el último código, restablecer sí lo levanta', async () => {
    await enroll();
    await prisma.user.update({
      where: { id: userId },
      data: {
        lockedUntil: new Date(Date.now() + 60_000),
        lastFailedMfaAt: new Date(Date.now() - LOGIN_LOCK_MS - 1_000),
      },
    });

    await resetPassword('clave-nueva-de-mfa-456');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.lockedUntil).toBeNull();
    await loginWith('clave-nueva-de-mfa-456').expect(200);
  });

  it('un reto en curso muere si la cuenta se desactiva', async () => {
    const mfaToken = await challenge();
    await prisma.user.update({
      where: { id: userId },
      data: { active: false },
    });

    const response = await server()
      .post(`${AUTH}/mfa/enrollment`)
      .send({ mfaToken })
      .expect(401);
    expect(response.body.code).toBe('MFA_CHALLENGE_EXPIRED');
  });

  describe('restablecer el MFA de otra cuenta', () => {
    async function adminToken() {
      const admin = await prisma.user.create({
        data: {
          name: 'Admin MFA',
          email: ADMIN_EMAIL,
          passwordHash: await argon2.hash(PASSWORD),
          role: 'ADMIN',
        },
      });
      const { accessToken } = await app.get(AuthService).completeLogin(admin);
      return { token: accessToken, id: admin.id };
    }

    it('lo quita, cierra sesiones y retos, y queda auditado con quién fue', async () => {
      const since = new Date();
      const { accessToken } = await enroll();
      const pending = await challenge();
      const admin = await adminToken();

      const response = await server()
        .patch(`/api/v1/users/${userId}/reset-mfa`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      expect(response.body.mfaEnabledAt).toBeNull();
      expect(response.body.mfaSecret).toBeUndefined();
      // También invalida la contraseña (PF-59): quien la supiera no puede
      // configurar su propio autenticador antes que el dueño.
      expect(response.body.passwordSetAt).toBeNull();
      await server()
        .post(`${AUTH}/login`)
        .send({ email: EMAIL, password: PASSWORD })
        .expect(401);
      await server()
        .get(`${AUTH}/session`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
      await server()
        .post(`${AUTH}/mfa/recovery`)
        .send({ mfaToken: pending, recoveryCode: 'AAAA-AAAA-AAAA-AAAA' })
        .expect(401);
      expect(await prisma.userRecoveryCode.count({ where: { userId } })).toBe(
        0,
      );
      const log = await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'MFA_RESET',
          entityId: userId,
          createdAt: { gte: since },
        },
      });
      expect(log.actorId).toBe(admin.id);
    });

    it('nadie puede restablecer el suyo', async () => {
      const admin = await adminToken();

      await server()
        .patch(`/api/v1/users/${admin.id}/reset-mfa`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(409);
    });

    it('sin sesión de ADMIN no se puede', async () => {
      await server().patch(`/api/v1/users/${userId}/reset-mfa`).expect(401);
    });
  });
});

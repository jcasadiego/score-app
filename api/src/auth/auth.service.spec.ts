import type { Mock } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { ValidatedEnv } from '../config/validate-env';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { UsersService } from '../users/users.service';
import { SessionsService } from './sessions.service';

vi.mock('argon2');

describe('AuthService', () => {
  const argon2VerifyMock = argon2.verify as Mock;
  let users: {
    findByEmail: Mock;
    registerFailedLogin: Mock;
    clearFailedLogins: Mock;
  };
  let audit: { record: Mock };
  let mfa: { issueChallenge: Mock };
  let sessions: { start: Mock; end: Mock };
  let mail: { sendAccountLocked: Mock };
  let service: AuthService;

  beforeEach(() => {
    process.env.JWT_SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres';
    process.env.JWT_EXPIRES_IN = '1d';
    process.env.JWT_MAX_SESSION_SECONDS = '604800';
    users = {
      findByEmail: vi.fn(),
      registerFailedLogin: vi.fn().mockResolvedValue(null),
      clearFailedLogins: vi.fn().mockResolvedValue(undefined),
    };
    audit = { record: vi.fn().mockResolvedValue({}) };
    mfa = {
      issueChallenge: vi.fn().mockResolvedValue({
        mfaToken: 'reto',
        mfaStatus: 'CHALLENGE_REQUIRED',
      }),
    };
    sessions = {
      start: vi.fn().mockResolvedValue('s1'),
      end: vi.fn().mockResolvedValue(undefined),
    };
    mail = {
      sendAccountLocked: vi
        .fn()
        .mockResolvedValue({ sent: true, providerId: 'em_1' }),
    };
    const config = {
      get: vi.fn().mockReturnValue('https://panel.example.com'),
    };
    argon2VerifyMock.mockReset();
    service = new AuthService(
      users as unknown as UsersService,
      new JwtService(),
      sessions as unknown as SessionsService,
      audit as unknown as AuditService,
      mfa as unknown as MfaService,
      mail as unknown as MailService,
      config as unknown as ConfigService<ValidatedEnv, true>,
    );
  });

  it('rechaza con el mismo mensaje si el usuario no existe', async () => {
    users.findByEmail.mockResolvedValue(null);
    argon2VerifyMock.mockResolvedValue(false);

    await expect(
      service.login('no-existe@test.local', 'cualquiera'),
    ).rejects.toThrow(UnauthorizedException);

    // Igual llama a argon2.verify aunque no exista el usuario, para que
    // el tiempo de respuesta no delate si el email existe o no.
    expect(argon2VerifyMock).toHaveBeenCalledTimes(1);
  });

  it('no abre sesión si las credenciales no son válidas', async () => {
    users.findByEmail.mockResolvedValue(null);
    argon2VerifyMock.mockResolvedValue(false);

    await expect(service.login('x@test.local', 'y')).rejects.toThrow(
      UnauthorizedException,
    );

    expect(sessions.start).not.toHaveBeenCalled();
  });

  it('rechaza si el usuario existe pero el password es incorrecto', async () => {
    users.findByEmail.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      passwordHash: 'hash-real',
      role: 'ADMIN',
      active: true,
    });
    argon2VerifyMock.mockResolvedValue(false);

    await expect(
      service.login('admin@test.local', 'incorrecta'),
    ).rejects.toThrow(UnauthorizedException);

    expect(argon2VerifyMock).toHaveBeenCalledWith('hash-real', 'incorrecta');
  });

  it('rechaza si el usuario existe, el password es correcto, pero está desactivado', async () => {
    users.findByEmail.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      passwordHash: 'hash-real',
      role: 'ADMIN',
      active: false,
    });
    argon2VerifyMock.mockResolvedValue(true);

    await expect(service.login('admin@test.local', 'correcta')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza una cuenta que espera que su dueño defina la contraseña', async () => {
    users.findByEmail.mockResolvedValue({
      id: '1',
      email: 'nueva@test.local',
      passwordHash: 'hash-aleatorio',
      role: 'REVIEWER',
      active: true,
      passwordSetAt: null,
    });
    // Aunque alguien acertara la contraseña aleatoria (PF-59).
    argon2VerifyMock.mockResolvedValue(true);

    await expect(service.login('nueva@test.local', 'x')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mfa.issueChallenge).not.toHaveBeenCalled();
  });

  it('con credenciales válidas pide el segundo factor y no abre sesión', async () => {
    const user = {
      id: '1',
      email: 'admin@test.local',
      passwordHash: 'hash-real',
      role: 'ADMIN',
      active: true,
      sessionVersion: 4,
      failedLoginAttempts: 2,
      lockedUntil: null,
      passwordSetAt: new Date(),
    };
    users.findByEmail.mockResolvedValue(user);
    argon2VerifyMock.mockResolvedValue(true);

    const result = await service.login('admin@test.local', 'correcta');

    expect(result).toEqual({
      mfaToken: 'reto',
      mfaStatus: 'CHALLENGE_REQUIRED',
    });
    expect(result).not.toHaveProperty('accessToken');
    expect(sessions.start).not.toHaveBeenCalled();
    // La contraseña sola no limpia el contador: si no, quien la tenga podría
    // probar códigos sin llegar nunca al bloqueo.
    expect(users.clearFailedLogins).not.toHaveBeenCalled();
  });

  it('al completar el acceso abre la sesión y emite el accessToken', async () => {
    const { accessToken } = await service.completeLogin({
      id: '1',
      email: 'admin@test.local',
      role: 'ADMIN',
      sessionVersion: 4,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({ sub: '1', ver: 4, sid: 's1' });
    expect(payload.authAt as number).toBeLessThanOrEqual(payload.iat as number);
    // La fila vence justo en el límite absoluto de la sesión.
    expect(sessions.start).toHaveBeenCalledWith(
      '1',
      new Date(((payload.authAt as number) + 604_800) * 1000),
    );
  });

  describe('refresh', () => {
    const DAY = 86_400;
    const now = () => Math.floor(Date.now() / 1000);
    const sessionUser = (authAt: number) => ({
      id: '1',
      email: 'admin@test.local',
      role: 'ADMIN',
      sessionVersion: 4,
      sessionId: 's1',
      authAt,
    });
    const decode = (token: string) =>
      JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

    it('emite otro token de 1 día y conserva el momento del login', async () => {
      const authAt = now() - DAY;

      const { accessToken } = await service.refresh(sessionUser(authAt));

      const payload = decode(accessToken);
      expect(payload).toMatchObject({ sub: '1', ver: 4, sid: 's1', authAt });
      expect(payload.exp - payload.iat).toBe(DAY);
    });

    it('recorta el token para que no pase del límite absoluto', async () => {
      const authAt = now() - 6.5 * DAY;

      const { accessToken } = await service.refresh(sessionUser(authAt));

      expect(decode(accessToken).exp).toBe(authAt + 7 * DAY);
    });

    it('rechaza renovar una sesión que ya llegó al límite absoluto', async () => {
      await expect(
        service.refresh(sessionUser(now() - 7 * DAY)),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  it('logout cierra solo la sesión del token', async () => {
    await service.logout({
      id: '1',
      email: 'admin@test.local',
      role: 'ADMIN',
      sessionVersion: 4,
      sessionId: 's1',
      authAt: 100,
    });

    expect(sessions.end).toHaveBeenCalledWith('s1');
  });

  describe('bloqueo por intentos fallidos', () => {
    const user = {
      id: 'u1',
      email: 'a@test.local',
      role: 'ADMIN',
      active: true,
      passwordHash: 'hash',
      sessionVersion: 0,
      failedLoginAttempts: 0,
      lockedUntil: null as Date | null,
      passwordSetAt: new Date(),
    };

    it('cuenta la contraseña incorrecta sin decir nada distinto', async () => {
      users.findByEmail.mockResolvedValue(user);
      argon2VerifyMock.mockResolvedValue(false);

      await expect(service.login(user.email, 'mala')).rejects.toThrow(
        'Credenciales inválidas',
      );

      expect(users.registerFailedLogin).toHaveBeenCalledWith('u1', 'PASSWORD');
      expect(mail.sendAccountLocked).not.toHaveBeenCalled();
    });

    const lockedUser = { name: 'Ana', email: 'ana@test.local', active: true };

    it('al bloquear audita y avisa al dueño con el enlace para restablecer', async () => {
      users.findByEmail.mockResolvedValue(user);
      users.registerFailedLogin.mockResolvedValue(lockedUser);
      argon2VerifyMock.mockResolvedValue(false);

      await expect(service.login(user.email, 'mala')).rejects.toThrow();

      await vi.waitFor(() =>
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'ACCOUNT_LOCKED',
            entityId: 'u1',
          }),
        ),
      );
      expect(mail.sendAccountLocked).toHaveBeenCalledTimes(1);
      expect(mail.sendAccountLocked).toHaveBeenCalledWith(
        'ana@test.local',
        {
          name: 'Ana',
          lockMinutes: 15,
          link: 'https://panel.example.com/forgot-password',
        },
        { entity: 'User', entityId: 'u1' },
      );
    });

    it('no espera el correo: un envío colgado no frena el registro del bloqueo', async () => {
      users.registerFailedLogin.mockResolvedValue(lockedUser);
      mail.sendAccountLocked.mockReturnValue(new Promise(() => undefined));

      await service.recordFailedAttempt('u1', 'MFA_CODE');

      expect(users.registerFailedLogin).toHaveBeenCalledWith('u1', 'MFA_CODE');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACCOUNT_LOCKED' }),
      );
    });

    it('si el correo falla, el bloqueo queda auditado igual', async () => {
      users.registerFailedLogin.mockResolvedValue(lockedUser);
      mail.sendAccountLocked.mockRejectedValue(new Error('proveedor caído'));

      await expect(
        service.recordFailedAttempt('u1', 'PASSWORD'),
      ).resolves.toBeUndefined();

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACCOUNT_LOCKED' }),
      );
    });

    it('una cuenta desactivada no recibe el aviso de bloqueo', async () => {
      users.registerFailedLogin.mockResolvedValue({
        ...lockedUser,
        active: false,
      });

      await service.recordFailedAttempt('u1', 'PASSWORD');

      expect(mail.sendAccountLocked).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACCOUNT_LOCKED' }),
      );
    });

    it('con la cuenta bloqueada rechaza la contraseña correcta, sin sesión', async () => {
      users.findByEmail.mockResolvedValue({
        ...user,
        lockedUntil: new Date(Date.now() + 60_000),
      });
      argon2VerifyMock.mockResolvedValue(true);

      await expect(service.login(user.email, 'buena')).rejects.toThrow(
        'Credenciales inválidas',
      );

      // Verifica igual, para que el tiempo no delate el bloqueo.
      expect(argon2VerifyMock).toHaveBeenCalledTimes(1);
      expect(sessions.start).not.toHaveBeenCalled();
    });

    it('un bloqueo vencido vuelve a pedir el segundo factor', async () => {
      users.findByEmail.mockResolvedValue({
        ...user,
        lockedUntil: new Date(Date.now() - 1_000),
      });
      argon2VerifyMock.mockResolvedValue(true);

      await expect(service.login(user.email, 'buena')).resolves.toHaveProperty(
        'mfaToken',
      );
    });

    it('completar el acceso limpia el contador', async () => {
      await service.completeLogin({ ...user, failedLoginAttempts: 3 });

      expect(users.clearFailedLogins).toHaveBeenCalledWith('u1');
    });
  });
});

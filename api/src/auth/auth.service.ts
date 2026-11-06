import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuditActorType } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import type { SessionUser } from './jwt.strategy';
import { MfaService } from './mfa.service';
import { SessionsService } from './sessions.service';

/**
 * Hash de un valor fijo que nunca corresponde a ningún usuario real. Se
 * usa solo para que `argon2.verify` tarde lo mismo cuando el email no
 * existe que cuando existe pero el password es incorrecto — evita que el
 * tiempo de respuesta de /auth/login permita enumerar emails válidos.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$dH7iJkavPNPh9KiRhrPJKQ$FfOCWWAr/yqjYGpgcrnwgndfrpqCnoqwCD5G7DLR2vA';

/** Lo que hace falta del usuario para abrirle una sesión. */
export interface LoginUser {
  id: string;
  email: string;
  role: string;
  sessionVersion: number;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sessionLimit(authAt: number): number {
  return authAt + Number(process.env.JWT_MAX_SESSION_SECONDS);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => MfaService)) private readonly mfa: MfaService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);

    const isPasswordValid = await argon2.verify(
      user?.passwordHash ?? DUMMY_HASH,
      password,
    );

    const isLocked = !!user?.lockedUntil && user.lockedUntil > new Date();

    // Mismo mensaje genérico también cuando la cuenta existe pero está
    // desactivada o bloqueada, por la misma razón que DUMMY_HASH: no delatar
    // el estado de una cuenta a quien no logró autenticarse.
    // Sin contraseña definida (PF-59), la cuenta espera el enlace de su dueño.
    // `passwordHash` ya es de una aleatoria; esto es una segunda barrera.
    const isPasswordSet = !!user?.passwordSetAt;

    if (
      !user ||
      !isPasswordValid ||
      !isPasswordSet ||
      !user.active ||
      isLocked
    ) {
      if (user && !isPasswordValid && !isLocked) {
        // Sin esperar: si la respuesta tardara más cuando el email existe, el
        // tiempo delataría qué cuentas hay.
        this.recordFailedAttempt(user.id).catch((error: unknown) =>
          this.logger.error(
            'No se pudo registrar el intento de inicio de sesión fallido',
            error instanceof Error ? error.stack : undefined,
          ),
        );
      }
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // El contador de intentos no se limpia aquí: la contraseña sola no completa
    // el acceso, y si no, quien la tenga podría probar códigos sin fin.
    return this.mfa.issueChallenge(user);
  }

  /** Último paso del acceso; solo se llega con el segundo factor ya comprobado. */
  async completeLogin(user: LoginUser) {
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.users.clearFailedLogins(user.id);
    }

    const authAt = nowInSeconds();
    const sessionId = await this.sessions.start(
      user.id,
      new Date(sessionLimit(authAt) * 1000),
    );

    const accessToken = await this.issueToken({
      id: user.id,
      email: user.email,
      role: user.role,
      sessionVersion: user.sessionVersion,
      sessionId,
      authAt,
    });

    // Aquí y no en el interceptor: en el login, `request.user` todavía no existe.
    this.audit
      .record({
        actorType: AuditActorType.PANEL_USER,
        actorId: user.id,
        action: 'LOGIN_SUCCEEDED',
        entity: 'User',
        entityId: user.id,
      })
      .catch((error: unknown) =>
        this.logger.error(
          'No se pudo registrar en Auditoría el inicio de sesión',
          error instanceof Error ? error.stack : undefined,
        ),
      );

    return { accessToken };
  }

  /** Contraseña o código incorrecto: cuenta para el bloqueo de la cuenta. */
  async recordFailedAttempt(userId: string): Promise<void> {
    const locked = await this.users.registerFailedLogin(userId);
    if (locked) {
      await this.audit.record({
        actorType: AuditActorType.SYSTEM,
        action: 'ACCOUNT_LOCKED',
        entity: 'User',
        entityId: userId,
      });
    }
  }

  /**
   * Token nuevo para una sesión en uso. `JwtAuthGuard` ya comprobó el token
   * y que la cuenta siga activa, así que una sesión revocada no llega aquí.
   * `authAt` no cambia: renovar no alarga el límite absoluto de la sesión.
   */
  async refresh(user: SessionUser) {
    if (nowInSeconds() >= sessionLimit(user.authAt)) {
      throw new UnauthorizedException('La sesión llegó a su límite');
    }
    return { accessToken: await this.issueToken(user) };
  }

  /**
   * Revoca solo esta sesión: el token deja de valer aunque no haya vencido,
   * y también cualquiera renovado a partir de él, porque todos nombran la
   * misma sesión.
   */
  logout(user: SessionUser): Promise<void> {
    return this.sessions.end(user.sessionId);
  }

  private async issueToken(user: SessionUser): Promise<string> {
    // Un solo reloj para todo el token: si no, cambiar de segundo entre dos
    // lecturas lo dejaría vencer 1 segundo después del límite.
    const now = nowInSeconds();
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      ver: user.sessionVersion,
      sid: user.sessionId,
      authAt: user.authAt,
      iat: now,
    };
    const sign = (expiresIn: string | number | undefined) =>
      this.jwt.signAsync(payload, {
        secret: process.env.JWT_SECRET,
        expiresIn,
      } as JwtSignOptions);

    const token = await sign(process.env.JWT_EXPIRES_IN);

    // El token nunca vive más allá del límite: ni siquiera uno robado se
    // puede estirar renovándolo.
    const limit = sessionLimit(user.authAt);
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    return exp <= limit ? token : sign(limit - now);
  }
}

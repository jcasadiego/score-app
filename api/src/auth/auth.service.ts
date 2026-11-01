import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';
import type { SessionUser } from './jwt.strategy';

/**
 * Hash de un valor fijo que nunca corresponde a ningún usuario real. Se
 * usa solo para que `argon2.verify` tarde lo mismo cuando el email no
 * existe que cuando existe pero el password es incorrecto — evita que el
 * tiempo de respuesta de /auth/login permita enumerar emails válidos.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$dH7iJkavPNPh9KiRhrPJKQ$FfOCWWAr/yqjYGpgcrnwgndfrpqCnoqwCD5G7DLR2vA';

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sessionLimit(authAt: number): number {
  return authAt + Number(process.env.JWT_MAX_SESSION_SECONDS);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);

    const isPasswordValid = await argon2.verify(
      user?.passwordHash ?? DUMMY_HASH,
      password,
    );

    // Mismo mensaje genérico también cuando la cuenta existe pero está
    // desactivada, por la misma razón que DUMMY_HASH: no delatar el
    // estado de una cuenta a quien no logró autenticarse.
    if (!user || !isPasswordValid || !user.active) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return {
      accessToken: await this.issueToken({
        id: user.id,
        email: user.email,
        role: user.role,
        sessionVersion: user.sessionVersion,
      }),
    };
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
    return { accessToken: await this.issueToken(user, user.authAt) };
  }

  private async issueToken(
    user: Pick<SessionUser, 'id' | 'email' | 'role' | 'sessionVersion'>,
    previousAuthAt?: number,
  ): Promise<string> {
    // Un solo reloj para todo el token: si no, cambiar de segundo entre dos
    // lecturas lo dejaría vencer 1 segundo después del límite.
    const now = nowInSeconds();
    const authAt = previousAuthAt ?? now;
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      ver: user.sessionVersion,
      authAt,
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
    const limit = sessionLimit(authAt);
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    return exp <= limit ? token : sign(limit - now);
  }
}

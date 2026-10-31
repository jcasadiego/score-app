import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';

/**
 * Hash de un valor fijo que nunca corresponde a ningún usuario real. Se
 * usa solo para que `argon2.verify` tarde lo mismo cuando el email no
 * existe que cuando existe pero el password es incorrecto — evita que el
 * tiempo de respuesta de /auth/login permita enumerar emails válidos.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$dH7iJkavPNPh9KiRhrPJKQ$FfOCWWAr/yqjYGpgcrnwgndfrpqCnoqwCD5G7DLR2vA';

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

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        ver: user.sessionVersion,
      },
      {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN,
      } as JwtSignOptions,
    );

    return { accessToken };
  }
}

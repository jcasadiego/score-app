import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UsuariosService } from '../usuarios/usuarios.service';

/**
 * Hash de un valor fijo que nunca corresponde a ningún usuario real. Se
 * usa solo para que `argon2.verify` tarde lo mismo cuando el email no
 * existe que cuando existe pero el password es incorrecto — evita que el
 * tiempo de respuesta de /auth/login permita enumerar emails válidos.
 */
const HASH_DUMMY =
  '$argon2id$v=19$m=65536,p=4,t=3$dH7iJkavPNPh9KiRhrPJKQ$FfOCWWAr/yqjYGpgcrnwgndfrpqCnoqwCD5G7DLR2vA';

@Injectable()
export class AuthService {
  constructor(
    private readonly usuarios: UsuariosService,
    private readonly jwt: JwtService,
  ) {}

  async iniciarSesion(email: string, password: string) {
    const usuario = await this.usuarios.buscarPorEmail(email);

    const passwordValido = await argon2.verify(
      usuario?.passwordHash ?? HASH_DUMMY,
      password,
    );

    if (!usuario || !passwordValido) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const accessToken = await this.jwt.signAsync(
      { sub: usuario.id, email: usuario.email, rol: usuario.rol },
      {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRACION,
      } as JwtSignOptions,
    );

    return { accessToken };
  }
}

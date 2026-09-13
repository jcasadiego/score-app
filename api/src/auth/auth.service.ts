import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UsuariosService } from '../usuarios/usuarios.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usuarios: UsuariosService,
    private readonly jwt: JwtService,
  ) {}

  async iniciarSesion(email: string, password: string) {
    const usuario = await this.usuarios.buscarPorEmail(email);

    if (!usuario || !(await argon2.verify(usuario.passwordHash, password))) {
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

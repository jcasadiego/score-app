import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsuariosService } from '../usuarios/usuarios.service';

interface JwtPayload {
  sub: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usuarios: UsuariosService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  /**
   * No confía ciegamente en el payload del token: vuelve a buscar el
   * usuario para que un usuario borrado o desactivado no siga teniendo
   * acceso con un token todavía válido — es lo que de verdad revoca el
   * acceso al desactivar una cuenta, no solo el login.
   */
  async validate(payload: JwtPayload) {
    const usuario = await this.usuarios.buscarPorId(payload.sub);
    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException();
    }
    return { id: usuario.id, email: usuario.email, rol: usuario.rol };
  }
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';

interface JwtPayload {
  sub: string;
  /** `User.sessionVersion` al emitir el token. */
  ver?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly users: UsersService) {
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
   * acceso al desactivar una cuenta, no solo el login. Igual con
   * `sessionVersion`: un cambio de contraseña la sube y deja sin valor los
   * tokens emitidos antes. Un token sin `ver` (emitido antes de que
   * existiera) cuenta como versión 0, para no cerrar todas las sesiones
   * al desplegar.
   */
  async validate(payload: JwtPayload) {
    const user = await this.users.findById(payload.sub);
    if (!user || !user.active || (payload.ver ?? 0) !== user.sessionVersion) {
      throw new UnauthorizedException();
    }
    return { id: user.id, email: user.email, role: user.role };
  }
}

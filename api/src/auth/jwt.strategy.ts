import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { SessionsService } from './sessions.service';

interface JwtPayload {
  sub: string;
  /** `User.sessionVersion` al emitir el token. */
  ver: number;
  /** `UserSession.id`; sin esa fila, el token no vale. */
  sid?: string;
  /** Momento del login, en segundos; se conserva al renovar el token. */
  authAt: number;
}

/** Lo que `JwtAuthGuard` deja en `request.user`. */
export interface SessionUser {
  id: string;
  email: string;
  role: string;
  sessionVersion: number;
  sessionId: string;
  authAt: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly sessions: SessionsService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  /**
   * No confía ciegamente en el payload del token: revisa en la base que la
   * sesión siga abierta (el logout la borra) y que el usuario siga activo
   * (desactivarlo corta el acceso de inmediato). Con `sessionVersion`, un
   * cambio de contraseña deja sin valor todas sus sesiones. Un token sin
   * `sid`, emitido antes de existir las sesiones, no se puede revocar, así
   * que se rechaza y pide volver a iniciar sesión.
   */
  async validate(payload: JwtPayload): Promise<SessionUser> {
    const session = payload.sid ? await this.sessions.find(payload.sid) : null;
    if (
      !session ||
      session.userId !== payload.sub ||
      !session.user.active ||
      payload.ver !== session.user.sessionVersion
    ) {
      throw new UnauthorizedException();
    }
    const { id, email, role, sessionVersion } = session.user;
    return {
      id,
      email,
      role,
      sessionVersion,
      sessionId: payload.sid as string,
      authAt: payload.authAt,
    };
  }
}

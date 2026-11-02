import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';

export interface AccessLinkPayload {
  sub: string;
  [key: string]: unknown;
}

/**
 * TODO(pendiente #2): esta pieza es deliberadamente stateless — firma y
 * verifica un JWT de vida corta, sin tabla de "enlaces de acceso" ni
 * invalidación de un solo uso. Esa persistencia depende de la forma de
 * `Diagnostic` (especificación del cuestionario), que todavía no está definida
 * — ver CLAUDE.md sección 3. Por eso el identificador es genérico
 * (`subjectId`, no `diagnosticId`): cuando exista `Diagnostic`, emitir un
 * enlace real es firmar con su id; falta agregar el registro de uso.
 */
/** Un token emitido para otra cosa no abre un enlace, aunque la firma coincida. */
const ACCESS_LINK_AUDIENCE = 'access-link';

@Injectable()
export class AccessLinkService {
  constructor(private readonly jwt: JwtService) {}

  async sign(subjectId: string, extraClaims: Record<string, unknown> = {}) {
    return this.jwt.signAsync({ sub: subjectId, ...extraClaims }, {
      secret: process.env.ACCESS_LINK_JWT_SECRET,
      expiresIn: process.env.ACCESS_LINK_JWT_EXPIRES_IN,
      audience: ACCESS_LINK_AUDIENCE,
    } as JwtSignOptions);
  }

  async verify(token: string): Promise<AccessLinkPayload> {
    try {
      return await this.jwt.verifyAsync<AccessLinkPayload>(token, {
        secret: process.env.ACCESS_LINK_JWT_SECRET,
        algorithms: ['HS256'],
        audience: ACCESS_LINK_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Enlace inválido o expirado');
    }
  }
}

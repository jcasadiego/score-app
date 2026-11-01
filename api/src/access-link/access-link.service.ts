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
 * `Case` (especificación del cuestionario), que todavía no está definida
 * — ver CLAUDE.md sección 3. Por eso el identificador es genérico
 * (`subjectId`, no `caseId`): cuando exista `Case`, emitir un
 * enlace real es firmar con su id; falta agregar el registro de uso.
 */
@Injectable()
export class AccessLinkService {
  constructor(private readonly jwt: JwtService) {}

  async sign(subjectId: string, extraClaims: Record<string, unknown> = {}) {
    return this.jwt.signAsync({ sub: subjectId, ...extraClaims }, {
      secret: process.env.ACCESS_LINK_JWT_SECRET,
      expiresIn: process.env.ACCESS_LINK_JWT_EXPIRES_IN,
    } as JwtSignOptions);
  }

  async verify(token: string): Promise<AccessLinkPayload> {
    try {
      return await this.jwt.verifyAsync<AccessLinkPayload>(token, {
        secret: process.env.ACCESS_LINK_JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Enlace inválido o expirado');
    }
  }
}

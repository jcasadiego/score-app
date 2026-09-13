import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';

export interface PayloadEnlace {
  sub: string;
  [clave: string]: unknown;
}

/**
 * TODO(pendiente #2): esta pieza es deliberadamente stateless — firma y
 * verifica un JWT de vida corta, sin tabla de "enlaces de acceso" ni
 * invalidación de un solo uso. Esa persistencia depende de la forma de
 * `Caso` (especificación del cuestionario), que todavía no está definida
 * — ver CLAUDE.md sección 3. Por eso el identificador es genérico
 * (`identificadorId`, no `casoId`): cuando exista `Caso`, emitir un
 * enlace real es firmar con su id; falta agregar el registro de uso.
 */
@Injectable()
export class TokenEnlaceService {
  constructor(private readonly jwt: JwtService) {}

  async firmar(
    identificadorId: string,
    claimsExtra: Record<string, unknown> = {},
  ) {
    return this.jwt.signAsync({ sub: identificadorId, ...claimsExtra }, {
      secret: process.env.ENLACE_JWT_SECRET,
      expiresIn: process.env.ENLACE_JWT_EXPIRACION,
    } as JwtSignOptions);
  }

  async verificar(token: string): Promise<PayloadEnlace> {
    try {
      return await this.jwt.verifyAsync<PayloadEnlace>(token, {
        secret: process.env.ENLACE_JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Enlace inválido o expirado');
    }
  }
}

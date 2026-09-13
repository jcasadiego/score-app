import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolUsuario } from '../../generated/prisma/enums';
import { ROLES_KEY } from './roles.decorator';

interface RequestConUsuario {
  user?: { rol: RolUsuario };
}

/**
 * Se aplica siempre después de `JwtAuthGuard` (`@UseGuards(JwtAuthGuard,
 * RolesGuard)`), porque depende de `request.user` ya resuelto.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rolesRequeridos = this.reflector.getAllAndOverride<RolUsuario[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!rolesRequeridos || rolesRequeridos.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestConUsuario>();

    return rolesRequeridos.includes(request.user?.rol as RolUsuario);
  }
}

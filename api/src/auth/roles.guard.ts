import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../generated/prisma/enums';
import { ROLES_KEY } from './roles.decorator';

interface RequestWithUser {
  user?: { role: UserRole };
}

/**
 * Se aplica siempre después de `JwtAuthGuard` (`@UseGuards(JwtAuthGuard,
 * RolesGuard)`), porque depende de `request.user` ya resuelto.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    return requiredRoles.includes(request.user?.role as UserRole);
  }
}

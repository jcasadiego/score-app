import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/enums';

export const ROLES_KEY = 'roles';

/**
 * Hoy `UserRole` solo tiene el valor `ADMIN` (ver
 * `prisma/schema.prisma`, TODO pendiente #3) — el decorador y el guard
 * quedan listos para cuando exista más de un rol, sin tener que tocar
 * esta pieza de infraestructura.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/enums';

export const ROLES_KEY = 'roles';

/** Roles que pueden usar la ruta, según la matriz de CLAUDE.md, sección 5.3. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

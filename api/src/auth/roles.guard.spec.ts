import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolUsuario } from '../../generated/prisma/enums';
import { RolesGuard } from './roles.guard';

function crearContextoConUsuario(rol?: RolUsuario): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: rol ? { rol } : undefined }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('deja pasar si la ruta no declara @Roles()', () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(crearContextoConUsuario())).toBe(true);
  });

  it('deja pasar si el rol del usuario está entre los requeridos', () => {
    const reflector = {
      getAllAndOverride: () => [RolUsuario.ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(crearContextoConUsuario(RolUsuario.ADMIN))).toBe(
      true,
    );
  });

  it('rechaza si el usuario no tiene ninguno de los roles requeridos', () => {
    const reflector = {
      getAllAndOverride: () => [RolUsuario.ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(crearContextoConUsuario(undefined))).toBe(false);
  });
});

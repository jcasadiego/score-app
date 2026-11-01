import type { Mock } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../users/users.service';

describe('JwtStrategy', () => {
  let users: { findById: Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    process.env.JWT_SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres';
    users = { findById: vi.fn() };
    strategy = new JwtStrategy(users as unknown as UsersService);
  });

  it('rechaza si el usuario del payload ya no existe', async () => {
    users.findById.mockResolvedValue(null);

    await expect(strategy.validate({ sub: '1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza si el usuario existe pero está desactivado', async () => {
    users.findById.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      role: 'ADMIN',
      active: false,
    });

    await expect(strategy.validate({ sub: '1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un token emitido antes del último cambio de contraseña', async () => {
    users.findById.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      role: 'ADMIN',
      active: true,
      sessionVersion: 2,
    });

    await expect(strategy.validate({ sub: '1', ver: 1 })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('un token sin versión vale como versión 0', async () => {
    users.findById.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      role: 'ADMIN',
      active: true,
      sessionVersion: 0,
    });

    await expect(strategy.validate({ sub: '1' })).resolves.toMatchObject({
      id: '1',
    });
  });

  it('devuelve el usuario si existe, está activo y la versión coincide', async () => {
    users.findById.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      role: 'ADMIN',
      active: true,
      sessionVersion: 3,
    });

    await expect(
      strategy.validate({ sub: '1', ver: 3, authAt: 100, iat: 200 }),
    ).resolves.toEqual({
      id: '1',
      email: 'admin@test.local',
      role: 'ADMIN',
      sessionVersion: 3,
      authAt: 100,
    });
  });

  it('un token sin momento de login cuenta desde su emisión', async () => {
    users.findById.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      role: 'ADMIN',
      active: true,
      sessionVersion: 0,
    });

    await expect(
      strategy.validate({ sub: '1', iat: 200 }),
    ).resolves.toMatchObject({ authAt: 200 });
  });
});

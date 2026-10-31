import type { Mock } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UsuariosService } from '../usuarios/usuarios.service';

describe('JwtStrategy', () => {
  let usuarios: { buscarPorId: Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    process.env.JWT_SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres';
    usuarios = { buscarPorId: vi.fn() };
    strategy = new JwtStrategy(usuarios as unknown as UsuariosService);
  });

  it('rechaza si el usuario del payload ya no existe', async () => {
    usuarios.buscarPorId.mockResolvedValue(null);

    await expect(strategy.validate({ sub: '1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza si el usuario existe pero está desactivado', async () => {
    usuarios.buscarPorId.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      rol: 'ADMIN',
      activo: false,
    });

    await expect(strategy.validate({ sub: '1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un token emitido antes del último cambio de contraseña', async () => {
    usuarios.buscarPorId.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      rol: 'ADMIN',
      activo: true,
      versionSesion: 2,
    });

    await expect(strategy.validate({ sub: '1', ver: 1 })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('un token sin versión vale como versión 0', async () => {
    usuarios.buscarPorId.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      rol: 'ADMIN',
      activo: true,
      versionSesion: 0,
    });

    await expect(strategy.validate({ sub: '1' })).resolves.toMatchObject({
      id: '1',
    });
  });

  it('devuelve el usuario si existe, está activo y la versión coincide', async () => {
    usuarios.buscarPorId.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      rol: 'ADMIN',
      activo: true,
      versionSesion: 3,
    });

    await expect(strategy.validate({ sub: '1', ver: 3 })).resolves.toEqual({
      id: '1',
      email: 'admin@test.local',
      rol: 'ADMIN',
    });
  });
});

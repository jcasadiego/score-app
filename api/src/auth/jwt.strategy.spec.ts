import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UsuariosService } from '../usuarios/usuarios.service';

describe('JwtStrategy', () => {
  let usuarios: { buscarPorId: jest.Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    process.env.JWT_SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres';
    usuarios = { buscarPorId: jest.fn() };
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

  it('devuelve el usuario si existe y está activo', async () => {
    usuarios.buscarPorId.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      rol: 'ADMIN',
      activo: true,
    });

    await expect(strategy.validate({ sub: '1' })).resolves.toEqual({
      id: '1',
      email: 'admin@test.local',
      rol: 'ADMIN',
    });
  });
});

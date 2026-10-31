import type { Mock } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { UsuariosService } from '../usuarios/usuarios.service';

vi.mock('argon2');

describe('AuthService', () => {
  const argon2VerifyMock = argon2.verify as Mock;
  let usuarios: { buscarPorEmail: Mock };
  let service: AuthService;

  beforeEach(() => {
    process.env.JWT_SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres';
    process.env.JWT_EXPIRACION = '1d';
    usuarios = { buscarPorEmail: vi.fn() };
    argon2VerifyMock.mockReset();
    service = new AuthService(
      usuarios as unknown as UsuariosService,
      new JwtService(),
    );
  });

  it('rechaza con el mismo mensaje si el usuario no existe', async () => {
    usuarios.buscarPorEmail.mockResolvedValue(null);
    argon2VerifyMock.mockResolvedValue(false);

    await expect(
      service.iniciarSesion('no-existe@test.local', 'cualquiera'),
    ).rejects.toThrow(UnauthorizedException);

    // Igual llama a argon2.verify aunque no exista el usuario, para que
    // el tiempo de respuesta no delate si el email existe o no.
    expect(argon2VerifyMock).toHaveBeenCalledTimes(1);
  });

  it('rechaza si el usuario existe pero el password es incorrecto', async () => {
    usuarios.buscarPorEmail.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      passwordHash: 'hash-real',
      role: 'ADMIN',
      active: true,
    });
    argon2VerifyMock.mockResolvedValue(false);

    await expect(
      service.iniciarSesion('admin@test.local', 'incorrecta'),
    ).rejects.toThrow(UnauthorizedException);

    expect(argon2VerifyMock).toHaveBeenCalledWith('hash-real', 'incorrecta');
  });

  it('rechaza si el usuario existe, el password es correcto, pero está desactivado', async () => {
    usuarios.buscarPorEmail.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      passwordHash: 'hash-real',
      role: 'ADMIN',
      active: false,
    });
    argon2VerifyMock.mockResolvedValue(true);

    await expect(
      service.iniciarSesion('admin@test.local', 'correcta'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('devuelve un accessToken si las credenciales son válidas', async () => {
    usuarios.buscarPorEmail.mockResolvedValue({
      id: '1',
      email: 'admin@test.local',
      passwordHash: 'hash-real',
      role: 'ADMIN',
      active: true,
      sessionVersion: 4,
    });
    argon2VerifyMock.mockResolvedValue(true);

    const resultado = await service.iniciarSesion(
      'admin@test.local',
      'correcta',
    );

    expect(resultado.accessToken).toEqual(expect.any(String));
    const payload = JSON.parse(
      Buffer.from(resultado.accessToken.split('.')[1], 'base64url').toString(),
    );
    expect(payload).toMatchObject({ sub: '1', ver: 4 });
  });
});

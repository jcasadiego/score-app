import { ConflictException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsuariosService } from './usuarios.service';

jest.mock('argon2');

function crearErrorPrisma(code: string) {
  return new Prisma.PrismaClientKnownRequestError('error de prueba', {
    code,
    clientVersion: '7.10.0',
  });
}

describe('UsuariosService', () => {
  const argon2HashMock = argon2.hash as jest.Mock;
  let prisma: {
    usuario: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let service: UsuariosService;

  beforeEach(() => {
    argon2HashMock.mockReset().mockResolvedValue('hash-generado');
    prisma = {
      usuario: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new UsuariosService(prisma as unknown as PrismaService);
  });

  describe('crear', () => {
    it('hashea el password y crea el usuario sin devolver passwordHash', async () => {
      prisma.usuario.create.mockResolvedValue({
        id: '1',
        nombre: 'Ana',
        email: 'ana@test.local',
        activo: true,
        rol: 'ADMIN',
      });

      const resultado = await service.crear({
        nombre: 'Ana',
        email: 'ana@test.local',
        password: 'password123',
      });

      expect(argon2HashMock).toHaveBeenCalledWith('password123');
      expect(prisma.usuario.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            nombre: 'Ana',
            email: 'ana@test.local',
            passwordHash: 'hash-generado',
          },
        }),
      );
      expect(resultado).not.toHaveProperty('passwordHash');
    });

    it('lanza ConflictException si el email ya está en uso', async () => {
      prisma.usuario.create.mockRejectedValue(crearErrorPrisma('P2002'));

      await expect(
        service.crear({
          nombre: 'Ana',
          email: 'ana@test.local',
          password: 'password123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('obtener', () => {
    it('lanza NotFoundException si el usuario no existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.obtener('no-existe')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('devuelve el usuario si existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        id: '1',
        nombre: 'Ana',
        email: 'ana@test.local',
        activo: true,
        rol: 'ADMIN',
      });

      await expect(service.obtener('1')).resolves.toMatchObject({
        id: '1',
        email: 'ana@test.local',
      });
    });
  });

  describe('desactivar / activar', () => {
    it('desactivar actualiza activo a false', async () => {
      prisma.usuario.update.mockResolvedValue({
        id: '1',
        nombre: 'Ana',
        email: 'ana@test.local',
        activo: false,
        rol: 'ADMIN',
      });

      const resultado = await service.desactivar('1');

      expect(prisma.usuario.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '1' },
          data: { activo: false },
        }),
      );
      expect(resultado.activo).toBe(false);
    });

    it('lanza NotFoundException si el usuario a desactivar no existe', async () => {
      prisma.usuario.update.mockRejectedValue(crearErrorPrisma('P2025'));

      await expect(service.desactivar('no-existe')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

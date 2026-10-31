import type { Mock } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

vi.mock('argon2');

function createPrismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('error de prueba', {
    code,
    clientVersion: '7.10.0',
  });
}

describe('UsersService', () => {
  const argon2HashMock = argon2.hash as Mock;
  let prisma: {
    $transaction: Mock;
    user: {
      count: Mock;
      create: Mock;
      findMany: Mock;
      findUnique: Mock;
      update: Mock;
    };
  };
  let service: UsersService;

  beforeEach(() => {
    argon2HashMock.mockReset().mockResolvedValue('hash-generado');
    prisma = {
      // El servicio usa la forma de arreglo: resuelve las promesas en orden.
      $transaction: vi.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
      user: {
        count: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('hashea el password y crea el usuario sin devolver passwordHash', async () => {
      prisma.user.create.mockResolvedValue({
        id: '1',
        name: 'Ana',
        email: 'ana@test.local',
        active: true,
        role: 'ADMIN',
      });

      const result = await service.create({
        name: 'Ana',
        email: 'ana@test.local',
        password: 'password123',
      });

      expect(argon2HashMock).toHaveBeenCalledWith('password123');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Ana',
            email: 'ana@test.local',
            passwordHash: 'hash-generado',
          },
        }),
      );
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('lanza ConflictException si el email ya está en uso', async () => {
      prisma.user.create.mockRejectedValue(createPrismaError('P2002'));

      await expect(
        service.create({
          name: 'Ana',
          email: 'ana@test.local',
          password: 'password123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('list', () => {
    it('pagina con skip/take y devuelve el total en la misma transacción', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: '21' }]);
      prisma.user.count.mockResolvedValue(41);

      const result = await service.list({ page: 2, pageSize: 20 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: 20, take: 20 }),
      );
      expect(result).toEqual({
        data: [{ id: '21' }],
        total: 41,
        page: 2,
        pageSize: 20,
      });
    });

    it('filtra por nombre o email sin distinguir mayúsculas, también en el conteo', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.list({ page: 1, pageSize: 20, search: 'ana' });

      const where = {
        OR: [
          { name: { contains: 'ana', mode: 'insensitive' } },
          { email: { contains: 'ana', mode: 'insensitive' } },
        ],
      };
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
      expect(prisma.user.count).toHaveBeenCalledWith({ where });
    });
  });

  describe('findOne', () => {
    it('lanza NotFoundException si el usuario no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('no-existe')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('devuelve el usuario si existe', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        name: 'Ana',
        email: 'ana@test.local',
        active: true,
        role: 'ADMIN',
      });

      await expect(service.findOne('1')).resolves.toMatchObject({
        id: '1',
        email: 'ana@test.local',
      });
    });
  });

  describe('update', () => {
    it('sin password no toca la contraseña ni las sesiones', async () => {
      prisma.user.update.mockResolvedValue({ id: '1' });

      await service.update('1', { name: 'Ana' });

      expect(argon2HashMock).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'Ana' } }),
      );
    });

    it('con password la hashea y sube sessionVersion para cerrar sesiones', async () => {
      prisma.user.update.mockResolvedValue({ id: '1' });

      await service.update('1', { name: 'Ana', password: 'nueva-clave' });

      expect(argon2HashMock).toHaveBeenCalledWith('nueva-clave');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Ana',
            passwordHash: 'hash-generado',
            sessionVersion: { increment: 1 },
          },
        }),
      );
    });
  });

  describe('deactivate / activate', () => {
    it('desactivar actualiza activo a false', async () => {
      prisma.user.update.mockResolvedValue({
        id: '1',
        name: 'Ana',
        email: 'ana@test.local',
        active: false,
        role: 'ADMIN',
      });

      const result = await service.deactivate('1');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '1' },
          data: { active: false },
        }),
      );
      expect(result.active).toBe(false);
    });

    it('lanza NotFoundException si el usuario a desactivar no existe', async () => {
      prisma.user.update.mockRejectedValue(createPrismaError('P2025'));

      await expect(service.deactivate('no-existe')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza ConflictException si el usuario intenta desactivarse a sí mismo', async () => {
      await expect(service.deactivate('1', '1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});

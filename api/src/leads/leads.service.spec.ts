import type { Mock } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { EstadoLead, FamiliaDiagnostico } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from './leads.service';

function crearErrorPrisma(code: string) {
  return new Prisma.PrismaClientKnownRequestError('error de prueba', {
    code,
    clientVersion: '7.10.0',
  });
}

describe('LeadsService', () => {
  let prisma: {
    $transaction: Mock;
    lead: {
      count: Mock;
      create: Mock;
      findMany: Mock;
      findUnique: Mock;
      update: Mock;
    };
  };
  let service: LeadsService;

  beforeEach(() => {
    prisma = {
      // El servicio usa la forma de arreglo: resuelve las promesas en orden.
      $transaction: vi.fn((consultas: Promise<unknown>[]) =>
        Promise.all(consultas),
      ),
      lead: {
        count: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    service = new LeadsService(prisma as unknown as PrismaService);
  });

  it('crea el lead y solo pide id y estado de vuelta', async () => {
    prisma.lead.create.mockResolvedValue({ id: 'lead-1', estado: 'NUEVO' });

    const resultado = await service.crear({
      nombre: 'Ana Pérez',
      email: 'ana@example.com',
      familia: FamiliaDiagnostico.B2B,
      utmSource: 'instagram',
    });

    expect(resultado).toEqual({ id: 'lead-1', estado: 'NUEVO' });
    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: {
        nombre: 'Ana Pérez',
        email: 'ana@example.com',
        telefono: undefined,
        familia: FamiliaDiagnostico.B2B,
        utmSource: 'instagram',
        utmMedium: undefined,
        utmCampaign: undefined,
      },
      select: { id: true, estado: true },
    });
  });

  describe('listar', () => {
    it('pagina y filtra en la base, más recientes primero', async () => {
      prisma.lead.findMany.mockResolvedValue([{ id: 'lead-1' }]);
      prisma.lead.count.mockResolvedValue(41);

      const resultado = await service.listar({
        pagina: 3,
        tamano: 20,
        q: 'ana',
        familia: FamiliaDiagnostico.CATALOGO,
        estado: EstadoLead.CONTACTADO,
      });

      const where = {
        familia: FamiliaDiagnostico.CATALOGO,
        estado: EstadoLead.CONTACTADO,
        OR: [
          { nombre: { contains: 'ana', mode: 'insensitive' } },
          { email: { contains: 'ana', mode: 'insensitive' } },
        ],
      };
      expect(prisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where,
          orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
          skip: 40,
          take: 20,
        }),
      );
      expect(prisma.lead.count).toHaveBeenCalledWith({ where });
      expect(resultado).toEqual({
        datos: [{ id: 'lead-1' }],
        total: 41,
        pagina: 3,
        tamano: 20,
      });
    });

    it('sin filtros no restringe nada', async () => {
      prisma.lead.findMany.mockResolvedValue([]);
      prisma.lead.count.mockResolvedValue(0);

      await service.listar({ pagina: 1, tamano: 20 });

      expect(prisma.lead.count).toHaveBeenCalledWith({
        where: { familia: undefined, estado: undefined },
      });
    });
  });

  describe('obtener', () => {
    it('lanza NotFound si el lead no existe', async () => {
      prisma.lead.findUnique.mockResolvedValue(null);

      await expect(service.obtener('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cambiarEstado', () => {
    it('actualiza solo el estado', async () => {
      prisma.lead.update.mockResolvedValue({
        id: 'lead-1',
        estado: 'CONVERTIDO',
      });

      await service.cambiarEstado('lead-1', EstadoLead.CONVERTIDO);

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-1' },
          data: { estado: EstadoLead.CONVERTIDO },
        }),
      );
    });

    it('traduce P2025 a NotFound', async () => {
      prisma.lead.update.mockRejectedValue(crearErrorPrisma('P2025'));

      await expect(
        service.cambiarEstado('nope', EstadoLead.CONTACTADO),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

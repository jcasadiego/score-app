import type { Mock } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { LeadStatus, DiagnosticFamily } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from './leads.service';

function createPrismaError(code: string) {
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
      $transaction: vi.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
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
    prisma.lead.create.mockResolvedValue({ id: 'lead-1', status: 'NEW' });

    const result = await service.create({
      name: 'Ana Pérez',
      email: 'ana@example.com',
      family: DiagnosticFamily.B2B,
      utmSource: 'instagram',
    });

    expect(result).toEqual({ id: 'lead-1', status: 'NEW' });
    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: {
        name: 'Ana Pérez',
        email: 'ana@example.com',
        phone: undefined,
        family: DiagnosticFamily.B2B,
        utmSource: 'instagram',
        utmMedium: undefined,
        utmCampaign: undefined,
      },
      select: { id: true, status: true },
    });
  });

  describe('list', () => {
    it('pagina y filtra en la base, más recientes primero', async () => {
      prisma.lead.findMany.mockResolvedValue([{ id: 'lead-1' }]);
      prisma.lead.count.mockResolvedValue(41);

      const result = await service.list({
        page: 3,
        pageSize: 20,
        search: 'ana',
        family: DiagnosticFamily.CATALOG,
        status: LeadStatus.CONTACTED,
      });

      const where = {
        family: DiagnosticFamily.CATALOG,
        status: LeadStatus.CONTACTED,
        OR: [
          { name: { contains: 'ana', mode: 'insensitive' } },
          { email: { contains: 'ana', mode: 'insensitive' } },
        ],
      };
      expect(prisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 40,
          take: 20,
        }),
      );
      expect(prisma.lead.count).toHaveBeenCalledWith({ where });
      expect(result).toEqual({
        data: [{ id: 'lead-1' }],
        total: 41,
        page: 3,
        pageSize: 20,
      });
    });

    it('sin filtros no restringe nada', async () => {
      prisma.lead.findMany.mockResolvedValue([]);
      prisma.lead.count.mockResolvedValue(0);

      await service.list({ page: 1, pageSize: 20 });

      expect(prisma.lead.count).toHaveBeenCalledWith({
        where: { family: undefined, status: undefined },
      });
    });
  });

  describe('findOne', () => {
    it('lanza NotFound si el lead no existe', async () => {
      prisma.lead.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateStatus', () => {
    it('actualiza solo el estado', async () => {
      prisma.lead.update.mockResolvedValue({
        id: 'lead-1',
        status: 'CONVERTED',
      });

      await service.updateStatus('lead-1', LeadStatus.CONVERTED);

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-1' },
          data: { status: LeadStatus.CONVERTED },
        }),
      );
    });

    it('traduce P2025 a NotFound', async () => {
      prisma.lead.update.mockRejectedValue(createPrismaError('P2025'));

      await expect(
        service.updateStatus('nope', LeadStatus.CONTACTED),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

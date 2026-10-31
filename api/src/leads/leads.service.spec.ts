import type { Mock } from 'vitest';
import { FamiliaDiagnostico } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from './leads.service';

describe('LeadsService', () => {
  let prisma: { lead: { create: Mock } };
  let service: LeadsService;

  beforeEach(() => {
    prisma = { lead: { create: vi.fn() } };
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
});

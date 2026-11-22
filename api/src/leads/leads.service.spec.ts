import type { Mock } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import {
  CrmSyncEventType,
  LeadStatus,
  DiagnosticFamily,
} from '../../generated/prisma/enums';
import { CrmSyncService } from '../crm/crm-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from './leads.service';

describe('LeadsService', () => {
  let prisma: {
    $transaction: Mock;
    lead: {
      count: Mock;
      create: Mock;
      findMany: Mock;
      findUnique: Mock;
    };
  };
  let notifications: { notifyNewLead: Mock };
  let crm: { enqueue: Mock; kick: Mock; syncStatusByLead: Mock };
  let service: LeadsService;

  beforeEach(() => {
    prisma = {
      // Arreglo: resuelve las promesas en orden. Función: la corre con el
      // mismo cliente como `tx`.
      $transaction: vi.fn(
        (arg: Promise<unknown>[] | ((tx: unknown) => unknown)) =>
          typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
      lead: {
        count: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
    };
    notifications = { notifyNewLead: vi.fn() };
    crm = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      kick: vi.fn(),
      syncStatusByLead: vi.fn(
        (ids: string[]) =>
          new Map(ids.map((id) => [id, id === 'lead-1' ? 'FAILED' : null])),
      ),
    };
    service = new LeadsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      crm as unknown as CrmSyncService,
    );
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
    expect(notifications.notifyNewLead).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'lead-1',
        name: 'Ana Pérez',
        family: DiagnosticFamily.B2B,
        utmSource: 'instagram',
      }),
    );
  });

  it('deja el evento del CRM en la misma transacción y avisa tras el commit', async () => {
    prisma.lead.create.mockResolvedValue({ id: 'lead-1', status: 'NEW' });

    await service.create({
      name: 'Ana Pérez',
      email: 'ana@example.com',
      family: DiagnosticFamily.B2B,
    });

    // `tx` es el mismo cliente que recibió la transacción.
    expect(crm.enqueue).toHaveBeenCalledWith(
      prisma,
      'lead-1',
      CrmSyncEventType.LEAD_CREATED,
    );
    expect(crm.kick).toHaveBeenCalled();
  });

  it('si no se pudo crear el lead, no avisa al equipo ni al CRM', async () => {
    prisma.lead.create.mockRejectedValue(new Error('db caída'));

    await expect(
      service.create({
        name: 'Ana Pérez',
        email: 'ana@example.com',
        family: DiagnosticFamily.B2B,
      }),
    ).rejects.toThrow('db caída');
    expect(notifications.notifyNewLead).not.toHaveBeenCalled();
    expect(crm.enqueue).not.toHaveBeenCalled();
    expect(crm.kick).not.toHaveBeenCalled();
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
        status: LeadStatus.NEW,
      });

      const where = {
        family: DiagnosticFamily.CATALOG,
        status: LeadStatus.NEW,
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
      // El estado del CRM de toda la página sale de una sola consulta.
      expect(crm.syncStatusByLead).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        data: [{ id: 'lead-1', crmSyncStatus: 'FAILED' }],
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

    it('filtra por envío fallido al CRM en la base', async () => {
      prisma.lead.findMany.mockResolvedValue([]);
      prisma.lead.count.mockResolvedValue(0);

      await service.list({ page: 1, pageSize: 20, crmSyncStatus: 'FAILED' });

      expect(prisma.lead.count).toHaveBeenCalledWith({
        where: {
          family: undefined,
          status: undefined,
          crmSyncEvents: { some: { status: 'FAILED' } },
        },
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

    it('incluye el estado del envío al CRM', async () => {
      prisma.lead.findUnique.mockResolvedValue({ id: 'lead-2' });

      await expect(service.findOne('lead-2')).resolves.toEqual({
        id: 'lead-2',
        crmSyncStatus: null,
      });
    });
  });
});

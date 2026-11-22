import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  CrmSyncEventType,
  DiagnosticFamily,
  LeadStatus,
} from '../../generated/prisma/enums';
import { CrmSyncService, leadSyncStatusWhere } from '../crm/crm-sync.service';
import type { CrmSyncStatus } from '../crm/crm.types';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';

/**
 * Lo único que vuelve al sitio: ni los datos enviados ni si el email ya
 * había precalificado antes, para no exponer datos personales en un
 * endpoint público.
 */
const PUBLIC_SELECT = {
  id: true,
  status: true,
} satisfies Prisma.LeadSelect;

export type CreatedLead = Prisma.LeadGetPayload<{
  select: typeof PUBLIC_SELECT;
}>;

/** Lo que ve el equipo en `apps/panel` (Revisor y Aprobador). */
const PANEL_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  family: true,
  utmSource: true,
  utmMedium: true,
  utmCampaign: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  // Para ofrecer "Ver diagnóstico" en vez de generar uno segundo (PF-18).
  diagnostic: { select: { id: true } },
} satisfies Prisma.LeadSelect;

/** Con el estado general del envío al CRM (PF-80), calculado de sus eventos. */
export type PanelLead = Prisma.LeadGetPayload<{
  select: typeof PANEL_SELECT;
}> & { crmSyncStatus: CrmSyncStatus | null };

interface ListLeadsParams {
  page: number;
  pageSize: number;
  search?: string;
  family?: DiagnosticFamily;
  status?: LeadStatus;
  crmSyncStatus?: CrmSyncStatus;
}

export interface LeadsPage {
  data: PanelLead[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly crm: CrmSyncService,
  ) {}

  /** El lead y su evento para el CRM en la misma transacción (PF-80). */
  async create(dto: CreateLeadDto): Promise<CreatedLead> {
    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          family: dto.family,
          utmSource: dto.utmSource,
          utmMedium: dto.utmMedium,
          utmCampaign: dto.utmCampaign,
        },
        select: PUBLIC_SELECT,
      });
      await this.crm.enqueue(tx, created.id, CrmSyncEventType.LEAD_CREATED);
      return created;
    });

    // Ni el CRM ni el correo hacen esperar al formulario.
    this.crm.kick();
    this.notifications.notifyNewLead({ ...dto, id: lead.id });

    return lead;
  }

  /**
   * Página de leads + total en una sola transacción, con los filtros
   * aplicados en la base. Los más recientes primero; `id` desempata para
   * que la paginación sea estable.
   */
  async list({
    page,
    pageSize,
    search,
    family,
    status,
    crmSyncStatus,
  }: ListLeadsParams): Promise<LeadsPage> {
    const where: Prisma.LeadWhereInput = {
      family,
      status,
      ...(crmSyncStatus && leadSyncStatusWhere(crmSyncStatus)),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        select: PANEL_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { data: await this.withSyncStatus(data), total, page, pageSize };
  }

  async findOne(id: string): Promise<PanelLead> {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      select: PANEL_SELECT,
    });

    if (!lead) {
      throw new NotFoundException(`Lead ${id} no encontrado`);
    }

    const [withStatus] = await this.withSyncStatus([lead]);
    return withStatus;
  }

  /** Una sola consulta más para toda la página, no una por lead. */
  private async withSyncStatus(
    leads: Omit<PanelLead, 'crmSyncStatus'>[],
  ): Promise<PanelLead[]> {
    const statuses = await this.crm.syncStatusByLead(leads.map((l) => l.id));
    return leads.map((lead) => ({
      ...lead,
      crmSyncStatus: statuses.get(lead.id) ?? null,
    }));
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { DiagnosticFamily, LeadStatus } from '../../generated/prisma/enums';
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

/** Lo que ve el equipo en `apps/panel` (solo ADMIN). */
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
} satisfies Prisma.LeadSelect;

export type PanelLead = Prisma.LeadGetPayload<{
  select: typeof PANEL_SELECT;
}>;

interface ListLeadsParams {
  page: number;
  pageSize: number;
  search?: string;
  family?: DiagnosticFamily;
  status?: LeadStatus;
}

export interface LeadsPage {
  data: PanelLead[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateLeadDto): Promise<CreatedLead> {
    return this.prisma.lead.create({
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
  }: ListLeadsParams): Promise<LeadsPage> {
    const where: Prisma.LeadWhereInput = {
      family,
      status,
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

    return { data, total, page, pageSize };
  }

  async findOne(id: string): Promise<PanelLead> {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      select: PANEL_SELECT,
    });

    if (!lead) {
      throw new NotFoundException(`Lead ${id} no encontrado`);
    }

    return lead;
  }

  async updateStatus(id: string, status: LeadStatus): Promise<PanelLead> {
    try {
      return await this.prisma.lead.update({
        where: { id },
        data: { status },
        select: PANEL_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Lead ${id} no encontrado`);
      }
      throw error;
    }
  }
}

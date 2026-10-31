import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { DiagnosticFamily, LeadStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CrearLeadDto } from './dto/crear-lead.dto';

/**
 * Lo único que vuelve al sitio: ni los datos enviados ni si el email ya
 * había precalificado antes, para no exponer datos personales en un
 * endpoint público.
 */
const SELECT_RESPUESTA = {
  id: true,
  status: true,
} satisfies Prisma.LeadSelect;

export type LeadCreado = Prisma.LeadGetPayload<{
  select: typeof SELECT_RESPUESTA;
}>;

/** Lo que ve el equipo en `apps/panel` (solo ADMIN). */
const SELECT_PANEL = {
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

export type LeadPanel = Prisma.LeadGetPayload<{
  select: typeof SELECT_PANEL;
}>;

interface ListarLeadsParams {
  page: number;
  pageSize: number;
  search?: string;
  family?: DiagnosticFamily;
  status?: LeadStatus;
}

export interface PaginaLeads {
  data: LeadPanel[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  crear(dto: CrearLeadDto): Promise<LeadCreado> {
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
      select: SELECT_RESPUESTA,
    });
  }

  /**
   * Página de leads + total en una sola transacción, con los filtros
   * aplicados en la base. Los más recientes primero; `id` desempata para
   * que la paginación sea estable.
   */
  async listar({
    page,
    pageSize,
    search,
    family,
    status,
  }: ListarLeadsParams): Promise<PaginaLeads> {
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
        select: SELECT_PANEL,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async obtener(id: string): Promise<LeadPanel> {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      select: SELECT_PANEL,
    });

    if (!lead) {
      throw new NotFoundException(`Lead ${id} no encontrado`);
    }

    return lead;
  }

  async cambiarEstado(id: string, status: LeadStatus): Promise<LeadPanel> {
    try {
      return await this.prisma.lead.update({
        where: { id },
        data: { status },
        select: SELECT_PANEL,
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

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { EstadoLead, FamiliaDiagnostico } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CrearLeadDto } from './dto/crear-lead.dto';

/**
 * Lo único que vuelve al sitio: ni los datos enviados ni si el email ya
 * había precalificado antes, para no exponer datos personales en un
 * endpoint público.
 */
const SELECT_RESPUESTA = {
  id: true,
  estado: true,
} satisfies Prisma.LeadSelect;

export type LeadCreado = Prisma.LeadGetPayload<{
  select: typeof SELECT_RESPUESTA;
}>;

/** Lo que ve el equipo en `apps/panel` (solo ADMIN). */
const SELECT_PANEL = {
  id: true,
  nombre: true,
  email: true,
  telefono: true,
  familia: true,
  utmSource: true,
  utmMedium: true,
  utmCampaign: true,
  estado: true,
  creadoEn: true,
  actualizadoEn: true,
} satisfies Prisma.LeadSelect;

export type LeadPanel = Prisma.LeadGetPayload<{
  select: typeof SELECT_PANEL;
}>;

interface ListarLeadsParams {
  pagina: number;
  tamano: number;
  q?: string;
  familia?: FamiliaDiagnostico;
  estado?: EstadoLead;
}

export interface PaginaLeads {
  datos: LeadPanel[];
  total: number;
  pagina: number;
  tamano: number;
}

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  crear(dto: CrearLeadDto): Promise<LeadCreado> {
    return this.prisma.lead.create({
      data: {
        nombre: dto.nombre,
        email: dto.email,
        telefono: dto.telefono,
        familia: dto.familia,
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
    pagina,
    tamano,
    q,
    familia,
    estado,
  }: ListarLeadsParams): Promise<PaginaLeads> {
    const where: Prisma.LeadWhereInput = {
      familia,
      estado,
      ...(q && {
        OR: [
          { nombre: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };

    const [datos, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        select: SELECT_PANEL,
        orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * tamano,
        take: tamano,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { datos, total, pagina, tamano };
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

  async cambiarEstado(id: string, estado: EstadoLead): Promise<LeadPanel> {
    try {
      return await this.prisma.lead.update({
        where: { id },
        data: { estado },
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

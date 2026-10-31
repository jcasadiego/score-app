import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
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
}

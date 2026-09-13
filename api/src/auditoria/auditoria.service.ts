import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ActorAuditoria } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

export interface RegistrarAuditoriaParams {
  actorTipo: ActorAuditoria;
  actorId?: string;
  accion: string;
  entidad: string;
  entidadId?: string;
  datos?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  registrar(params: RegistrarAuditoriaParams) {
    return this.prisma.registroAuditoria.create({
      data: {
        actorTipo: params.actorTipo,
        actorId: params.actorId,
        accion: params.accion,
        entidad: params.entidad,
        entidadId: params.entidadId,
        datos: params.datos,
      },
    });
  }

  /**
   * Historial de eventos de una entidad puntual (ej. un Caso), en orden
   * cronológico. Sin filtros ni paginación — para eso hace falta
   * reportería, que es deliberadamente parte de un módulo aparte.
   */
  listarPorEntidad(entidad: string, entidadId: string) {
    return this.prisma.registroAuditoria.findMany({
      where: { entidad, entidadId },
      orderBy: { creadoEn: 'asc' },
    });
  }
}

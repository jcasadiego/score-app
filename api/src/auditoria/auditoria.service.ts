import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AuditActorType } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

export interface RegistrarAuditoriaParams {
  actorType: AuditActorType;
  actorId?: string;
  action: string;
  entity: string;
  entityId?: string;
  data?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  registrar(params: RegistrarAuditoriaParams) {
    return this.prisma.auditLog.create({
      data: {
        actorType: params.actorType,
        actorId: params.actorId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        data: params.data,
      },
    });
  }

  /**
   * Historial de eventos de una entidad puntual (ej. un Caso), en orden
   * cronológico. Sin filtros ni paginación — para eso hace falta
   * reportería, que es deliberadamente parte de un módulo aparte.
   */
  listarPorEntidad(entity: string, entityId: string) {
    return this.prisma.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { createdAt: 'asc' },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AuditActorType } from '../../generated/prisma/enums';
import { currentRequestId } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordAuditParams {
  actorType: AuditActorType;
  actorId?: string;
  action: string;
  entity: string;
  entityId?: string;
  data?: Prisma.InputJsonValue;
  /** Por defecto, el de la petición en curso. */
  requestId?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Un evento crítico (aprobar, corregir, emitir o revocar un enlace) pasa el
   * `tx` de su `$transaction`: si falla el registro se revierte la operación, y
   * viceversa. Sin `tx`, escribe por su cuenta.
   */
  record(
    params: RecordAuditParams,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    return client.auditLog.create({
      data: {
        actorType: params.actorType,
        actorId: params.actorId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        data: params.data,
        requestId: params.requestId ?? currentRequestId(),
      },
    });
  }

  /**
   * Historial de eventos de una entidad puntual (ej. un Diagnostic), en orden
   * cronológico. Sin filtros ni paginación — para eso hace falta
   * reportería, que es deliberadamente parte de un módulo aparte.
   */
  listByEntity(entity: string, entityId: string) {
    return this.prisma.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { createdAt: 'asc' },
    });
  }
}

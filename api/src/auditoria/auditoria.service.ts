import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RegistrarAuditoriaParams {
  accion: string;
  entidad: string;
  entidadId?: string;
  usuarioId?: string;
  datos?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  registrar(params: RegistrarAuditoriaParams) {
    return this.prisma.registroAuditoria.create({
      data: {
        accion: params.accion,
        entidad: params.entidad,
        entidadId: params.entidadId,
        usuarioId: params.usuarioId,
        datos: params.datos,
      },
    });
  }
}

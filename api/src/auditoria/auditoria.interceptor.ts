import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { Prisma } from '../../generated/prisma/client';
import { AuditActorType } from '../../generated/prisma/enums';
import {
  AuditoriaService,
  RegistrarAuditoriaParams,
} from './auditoria.service';
import { redactarDatosSensibles } from './redactar-datos-sensibles';
import { CLAVES_REDACTAR_AUDITORIA } from './redactar-en-auditoria.decorator';

const METODOS_AUDITABLES = ['POST', 'PUT', 'PATCH', 'DELETE'];

interface RequestAuditable extends Request {
  user?: { id: string };
  enlace?: { sub: string };
}

/**
 * Deja registro de toda request mutante que pasa por la API. Es una traza
 * genérica por ruta/método mientras no existen entidades de dominio
 * (Caso, etc.) — cuando esas existan, los servicios pueden seguir usando
 * `AuditoriaService.registrar` directamente para un registro más rico.
 */
@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditoriaInterceptor.name);

  constructor(
    private readonly auditoria: AuditoriaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestAuditable>();

    if (!METODOS_AUDITABLES.includes(request.method)) {
      return next.handle();
    }

    const clavesExtra =
      this.reflector.getAllAndOverride<string[] | undefined>(
        CLAVES_REDACTAR_AUDITORIA,
        [context.getHandler(), context.getClass()],
      ) ?? [];

    return next.handle().pipe(
      tap(() => {
        this.auditoria
          .registrar({
            ...this.resolverActor(request),
            action: request.method,
            entity: request.path,
            data: {
              body: redactarDatosSensibles(request.body, clavesExtra),
              params: redactarDatosSensibles(request.params, clavesExtra),
              query: redactarDatosSensibles(request.query, clavesExtra),
            } as Prisma.InputJsonValue,
          })
          .catch((err: unknown) =>
            this.logger.error('No se pudo registrar la auditoría', err),
          );
      }),
    );
  }

  /**
   * `request.user` lo deja `JwtAuthGuard` (usuario del panel) y
   * `request.enlace` lo deja `TokenEnlaceGuard` (cliente final). Ninguno
   * de los dos es global, así que en rutas sin guard de auth (ej. antes
   * de un login) no hay actor autenticado y se registra como sistema.
   */
  private resolverActor(
    request: RequestAuditable,
  ): Pick<RegistrarAuditoriaParams, 'actorType' | 'actorId'> {
    if (request.user?.id) {
      return {
        actorType: AuditActorType.PANEL_USER,
        actorId: request.user.id,
      };
    }

    if (request.enlace?.sub) {
      return {
        actorType: AuditActorType.END_CLIENT,
        actorId: request.enlace.sub,
      };
    }

    return { actorType: AuditActorType.SYSTEM };
  }
}

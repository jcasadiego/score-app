import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { Prisma } from '../../generated/prisma/client';
import { ActorAuditoria } from '../../generated/prisma/enums';
import {
  AuditoriaService,
  RegistrarAuditoriaParams,
} from './auditoria.service';
import { redactarDatosSensibles } from './redactar-datos-sensibles';

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

  constructor(private readonly auditoria: AuditoriaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestAuditable>();

    if (!METODOS_AUDITABLES.includes(request.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        this.auditoria
          .registrar({
            ...this.resolverActor(request),
            accion: request.method,
            entidad: request.path,
            datos: {
              body: redactarDatosSensibles(request.body),
              params: redactarDatosSensibles(request.params),
              query: redactarDatosSensibles(request.query),
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
  ): Pick<RegistrarAuditoriaParams, 'actorTipo' | 'actorId'> {
    if (request.user?.id) {
      return {
        actorTipo: ActorAuditoria.USUARIO_PANEL,
        actorId: request.user.id,
      };
    }

    if (request.enlace?.sub) {
      return {
        actorTipo: ActorAuditoria.CLIENTE_FINAL,
        actorId: request.enlace.sub,
      };
    }

    return { actorTipo: ActorAuditoria.SISTEMA };
  }
}

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
import { AuditService, RecordAuditParams } from './audit.service';
import { redactSensitiveData } from './redact-sensitive-data';
import { AUDIT_REDACT_KEYS } from './redact-in-audit.decorator';

const AUDITABLE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

interface AuditableRequest extends Request {
  user?: { id: string };
  accessLink?: { sub: string };
}

/**
 * Deja registro de toda request mutante que pasa por la API. Es una traza
 * genérica por ruta/método mientras no existen entidades de dominio
 * (Caso, etc.) — cuando esas existan, los servicios pueden seguir usando
 * `AuditService.record` directamente para un registro más rico.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditableRequest>();

    if (!AUDITABLE_METHODS.includes(request.method)) {
      return next.handle();
    }

    const extraKeys =
      this.reflector.getAllAndOverride<string[] | undefined>(
        AUDIT_REDACT_KEYS,
        [context.getHandler(), context.getClass()],
      ) ?? [];

    return next.handle().pipe(
      tap(() => {
        this.audit
          .record({
            ...this.resolveActor(request),
            action: request.method,
            entity: request.path,
            data: {
              body: redactSensitiveData(request.body, extraKeys),
              params: redactSensitiveData(request.params, extraKeys),
              query: redactSensitiveData(request.query, extraKeys),
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
   * `request.accessLink` lo deja `AccessLinkGuard` (cliente final). Ninguno
   * de los dos es global, así que en rutas sin guard de auth (ej. antes
   * de un login) no hay actor autenticado y se registra como sistema.
   */
  private resolveActor(
    request: AuditableRequest,
  ): Pick<RecordAuditParams, 'actorType' | 'actorId'> {
    if (request.user?.id) {
      return {
        actorType: AuditActorType.PANEL_USER,
        actorId: request.user.id,
      };
    }

    if (request.accessLink?.sub) {
      return {
        actorType: AuditActorType.END_CLIENT,
        actorId: request.accessLink.sub,
      };
    }

    return { actorType: AuditActorType.SYSTEM };
  }
}

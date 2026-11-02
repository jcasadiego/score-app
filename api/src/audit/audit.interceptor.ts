import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { Prisma } from '../../generated/prisma/client';
import { AuditableRequest, resolveAuditActor } from './audit-actor';
import { AUDIT_ROUTE, AuditRouteOptions } from './audit-route.decorator';
import { AuditService } from './audit.service';
import { redactSensitiveData } from './redact-sensitive-data';

export const AUDITABLE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function pickFields(body: unknown, fields: string[]): Record<string, unknown> {
  const source = (body ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    fields.filter((field) => field in source).map((f) => [f, source[f]]),
  );
}

function resultId(result: unknown): string | undefined {
  const id = (result as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Registra cada request exitosa que cambia datos, con lo que declara su
 * `@AuditRoute()`. Los intentos fallidos o denegados los registra
 * `auditFailures`, y los eventos críticos, su servicio dentro de la misma
 * transacción (`AuditService.record`).
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
    const options = this.reflector.getAllAndOverride<
      AuditRouteOptions | undefined
    >(AUDIT_ROUTE, [context.getHandler(), context.getClass()]);

    if (
      !AUDITABLE_METHODS.includes(request.method) ||
      (options && 'byService' in options)
    ) {
      return next.handle();
    }

    // Sin declaración, se deja el rastro sin ningún dato del request.
    const route = options && !('byService' in options) ? options : undefined;

    return next.handle().pipe(
      tap((result) => {
        const body = pickFields(request.body, route?.fields ?? []);
        const id = request.params.id;
        this.audit
          .record({
            ...resolveAuditActor(request),
            action: route?.action ?? request.method,
            entity: route?.entity ?? request.path,
            entityId:
              (typeof id === 'string' ? id : undefined) ?? resultId(result),
            ...(Object.keys(body).length > 0 && {
              data: {
                body: redactSensitiveData(body),
              } as Prisma.InputJsonValue,
            }),
          })
          .catch((err: unknown) =>
            this.logger.error('No se pudo registrar la auditoría', err),
          );
      }),
    );
  }
}

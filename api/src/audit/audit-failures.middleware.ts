import { Logger } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { AuditableRequest, resolveAuditActor } from './audit-actor';
import { AUDITABLE_METHODS } from './audit.interceptor';
import { AuditService } from './audit.service';

const logger = new Logger('AuditFailures');

/**
 * Qué intento fallido se registra. Un 401 de lectura no entra: es lo normal al
 * vencer una sesión. Tampoco uno de validación o un 429: ya los frena la API, y
 * llenarían la bitácora ante un abuso.
 */
export function failureAction(method: string, status: number): string | null {
  if (status === 403) return 'ACCESS_DENIED';
  if (!AUDITABLE_METHODS.includes(method)) return null;
  if (status === 401) return 'AUTHENTICATION_FAILED';
  if (status === 409) return 'REQUEST_CONFLICT';
  if (status >= 500) return 'REQUEST_FAILED';
  return null;
}

/**
 * Middleware y no interceptor: los guards corren antes que los interceptores,
 * así que un 401 o 403 nunca llegaría a uno. No guarda nada del body: en un
 * intento fallido, ahí pueden venir la contraseña o datos del cliente.
 */
export function auditFailures(audit: AuditService) {
  return (
    request: AuditableRequest,
    response: Response,
    next: NextFunction,
  ) => {
    response.on('finish', () => {
      const action = failureAction(request.method, response.statusCode);
      // Sin ruta no hay nada que auditar: evita registrar URLs inventadas.
      const route = (request.route as { path?: string } | undefined)?.path;
      if (!action || !route) return;

      const id = request.params?.id;
      audit
        .record({
          ...resolveAuditActor(request),
          action,
          entity: route,
          entityId: typeof id === 'string' ? id : undefined,
          data: { method: request.method, status: response.statusCode },
          // Explícito: `finish` puede emitirse fuera del contexto de la petición.
          requestId: request.requestId,
        })
        .catch((err: unknown) =>
          logger.error('No se pudo registrar el intento fallido', err),
        );
    });
    next();
  };
}

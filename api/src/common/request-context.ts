import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { AuditableRequest, resolveAuditActor } from '../audit/audit-actor';

const storage = new AsyncLocalStorage<{ requestId: string }>();

/** Id de la petición en curso, también en trabajo que siguió en segundo plano. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Da a cada petición un id, lo devuelve en `X-Request-Id` y deja una línea de log
 * al terminar. El id se genera aquí y nunca se toma del cliente, para que no
 * pueda ensuciar el rastro. El log lleva el patrón de la ruta y no la URL: en la
 * URL pueden venir tokens, búsquedas con datos personales e ids.
 */
export function requestContext() {
  const logger = new Logger('HTTP');

  return (
    request: AuditableRequest,
    response: Response,
    next: NextFunction,
  ) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    response.on('finish', () => {
      const route = (request.route as { path?: string } | undefined)?.path;
      // El sondeo de salud llenaría el log sin decir nada.
      if (request.path === '/health') return;
      logger.log({
        requestId,
        method: request.method,
        route: route ?? null,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
        ...resolveAuditActor(request),
      });
    });

    storage.run({ requestId }, next);
  };
}

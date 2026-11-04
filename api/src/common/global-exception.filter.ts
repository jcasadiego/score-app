import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Request, Response } from 'express';
import { normalizeError, toProblemDetails } from './problem-details';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export function sendProblem(
  host: ArgumentsHost,
  exception: unknown,
  extensions: (error: ReturnType<typeof normalizeError>) => object = () => ({}),
): void {
  const http = host.switchToHttp();
  const error = normalizeError(exception);
  // Sin la query: podría traer datos que no deben volver en la respuesta.
  const [instance] = http.getRequest<Request>().originalUrl.split('?');
  const problem = toProblemDetails(error, instance);
  http
    .getResponse<Response>()
    .status(error.statusCode)
    .type(PROBLEM_CONTENT_TYPE)
    .json({ ...problem, ...extensions(error) });
}

/**
 * Forma de error única para toda la API (RFC 9457), para que
 * `apps/diagnostico` y `apps/panel` lean los errores de la misma manera sin
 * importar el endpoint.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    sendProblem(host, exception);
  }
}

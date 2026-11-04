import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

/** Un campo o condición que hizo fallar la petición. */
export interface ProblemError {
  field?: string;
  code?: string;
  message: string;
}

/** RFC 9457, con `code` y `errors` como extensiones propias. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  errors?: ProblemError[];
}

export interface NormalizedError {
  statusCode: number;
  /** Texto original de la excepción; una lista si es de validación. */
  message: string | string[];
  error: string;
  code: string;
  errors?: ProblemError[];
}

export const VALIDATION_FAILED_CODE = 'VALIDATION_FAILED';

const logger = new Logger('ExceptionFilter');

function statusPhrase(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}

/** `Too Many Requests` → `TOO_MANY_REQUESTS`. */
function defaultCode(status: number): string {
  return statusPhrase(status)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
}

/**
 * Lleva cualquier excepción a una forma común. Un error que no es
 * `HttpException` es un bug: va al log con su stack y al cliente solo le llega
 * un 500 genérico, sin detalles internos.
 */
export function normalizeError(exception: unknown): NormalizedError {
  if (!(exception instanceof HttpException)) {
    logger.error(
      'Error no controlado',
      exception instanceof Error ? exception.stack : String(exception),
    );
    const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    return {
      statusCode,
      message: 'Internal server error',
      error: statusPhrase(statusCode),
      code: 'INTERNAL_ERROR',
    };
  }

  const statusCode = exception.getStatus();
  const response = exception.getResponse();
  const body =
    typeof response === 'string'
      ? { message: response }
      : (response as {
          message?: string | string[];
          detail?: string;
          error?: string;
          code?: string;
          errors?: ProblemError[];
        });

  return {
    statusCode,
    message: body.message ?? body.detail ?? exception.message,
    // Sin `error` propio (ej. ThrottlerException), la frase HTTP estándar.
    error: body.error ?? statusPhrase(statusCode),
    code: body.code ?? defaultCode(statusCode),
    errors: body.errors,
  };
}

function problemDetail({ statusCode, message }: NormalizedError): string {
  // El texto del throttler nombra a la librería: no le sirve al cliente.
  if (statusCode === Number(HttpStatus.TOO_MANY_REQUESTS)) {
    return statusPhrase(statusCode);
  }
  // El 404 de Nest repite la URL completa, con la query que traiga.
  if (typeof message === 'string' && /^Cannot [A-Z]+ /.test(message)) {
    return statusPhrase(statusCode);
  }
  return Array.isArray(message)
    ? 'Los datos enviados no son válidos.'
    : message;
}

export function toProblemDetails(
  error: NormalizedError,
  instance: string,
): ProblemDetails {
  const errors =
    error.errors ??
    (Array.isArray(error.message)
      ? error.message.map((message) => ({ message }))
      : undefined);

  return {
    type: `urn:score:problem:${error.code.toLowerCase().replace(/_/g, '-')}`,
    title: statusPhrase(error.statusCode),
    status: error.statusCode,
    detail: problemDetail(error),
    instance,
    code: error.code,
    ...(errors && { errors }),
  };
}

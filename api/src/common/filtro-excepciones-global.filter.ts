import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

export interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

const logger = new Logger('ExceptionFilter');

/**
 * Forma estándar de NestJS (`{ statusCode, message, error }`). Un error
 * que no es `HttpException` es un bug: va al log con su stack y al
 * cliente solo le llega un 500 genérico, sin detalles internos.
 */
export function buildErrorResponse(exception: unknown): ErrorResponseBody {
  if (!(exception instanceof HttpException)) {
    logger.error(
      'Error no controlado',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }

  const statusCode = exception.getStatus();
  const body = exception.getResponse();
  const { message, error } =
    typeof body === 'string'
      ? { message: body, error: undefined }
      : (body as { message?: string | string[]; error?: string });

  return {
    statusCode,
    message: message ?? exception.message,
    error: error ?? exception.name.replace(/Exception$/, ''),
  };
}

/**
 * Forma de error única para toda la API, para que `apps/diagnostico` y
 * `apps/panel` parseen errores de la misma manera sin importar el
 * endpoint.
 */
@Catch()
export class FiltroExcepcionesGlobal implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const body = buildErrorResponse(exception);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(body.statusCode)
      .json(body);
  }
}

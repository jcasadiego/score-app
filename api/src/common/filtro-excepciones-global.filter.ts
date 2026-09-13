import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Forma de error única para toda la API, para que `apps/diagnostico` y
 * `apps/panel` parseen errores de la misma manera sin importar el
 * endpoint.
 */
@Catch()
export class FiltroExcepcionesGlobal implements ExceptionFilter {
  catch(excepcion: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const esHttpException = excepcion instanceof HttpException;
    const status = esHttpException
      ? excepcion.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const respuestaExcepcion = esHttpException
      ? excepcion.getResponse()
      : undefined;

    const mensaje =
      typeof respuestaExcepcion === 'string'
        ? respuestaExcepcion
        : ((respuestaExcepcion as { message?: string | string[] })?.message ??
          'Error interno del servidor');

    const detalle =
      !esHttpException && process.env.NODE_ENV !== 'production'
        ? String(excepcion)
        : undefined;

    response.status(status).json({
      statusCode: status,
      mensaje,
      detalle,
    });
  }
}

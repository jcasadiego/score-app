import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { normalizeError } from '../../common/problem-details';

/**
 * Forma de error del contrato viejo con `score-sitio`
 * (`{ statusCode, mensaje }`), solo para la ruta legacy.
 */
@Catch()
export class LegacyErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const { statusCode, message } = normalizeError(exception);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(statusCode)
      .json({ statusCode, mensaje: message });
  }
}

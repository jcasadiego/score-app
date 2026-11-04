import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { sendProblem } from '../common/global-exception.filter';

/**
 * TODO: borrar cuando `score-sitio` lea `errors` en vez de `message`
 * (`docs/contrato-precalificacion.md`). Mantiene `message` para no romper el
 * formulario durante la transición.
 */
@Catch()
export class PrequalificationErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    sendProblem(host, exception, ({ message }) => ({ message }));
  }
}

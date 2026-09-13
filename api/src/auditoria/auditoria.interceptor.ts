import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AuditoriaService } from './auditoria.service';

const METODOS_AUDITABLES = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Deja registro de toda request mutante que pasa por la API. Es una traza
 * genérica por ruta/método mientras no existen entidades de dominio
 * (Caso, etc.) — cuando esas existan, los servicios pueden seguir usando
 * `AuditoriaService.registrar` directamente para un registro más rico.
 */
@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  constructor(private readonly auditoria: AuditoriaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    if (!METODOS_AUDITABLES.includes(request.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        void this.auditoria.registrar({
          accion: request.method,
          entidad: request.path,
          usuarioId: (request as { usuarioId?: string }).usuarioId,
          datos: {
            body: request.body,
            params: request.params,
            query: request.query,
          },
        });
      }),
    );
  }
}

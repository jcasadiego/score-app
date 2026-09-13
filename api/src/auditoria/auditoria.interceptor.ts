import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { Prisma } from '../../generated/prisma/client';
import { AuditoriaService } from './auditoria.service';
import { redactarDatosSensibles } from './redactar-datos-sensibles';

const METODOS_AUDITABLES = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Deja registro de toda request mutante que pasa por la API. Es una traza
 * genérica por ruta/método mientras no existen entidades de dominio
 * (Caso, etc.) — cuando esas existan, los servicios pueden seguir usando
 * `AuditoriaService.registrar` directamente para un registro más rico.
 */
@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditoriaInterceptor.name);

  constructor(private readonly auditoria: AuditoriaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    if (!METODOS_AUDITABLES.includes(request.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        this.auditoria
          .registrar({
            accion: request.method,
            entidad: request.path,
            usuarioId: (request as { usuarioId?: string }).usuarioId,
            datos: {
              body: redactarDatosSensibles(request.body),
              params: redactarDatosSensibles(request.params),
              query: redactarDatosSensibles(request.query),
            } as Prisma.InputJsonValue,
          })
          .catch((err: unknown) =>
            this.logger.error('No se pudo registrar la auditoría', err),
          );
      }),
    );
  }
}

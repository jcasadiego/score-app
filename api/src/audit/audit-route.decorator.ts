import { SetMetadata } from '@nestjs/common';

export const AUDIT_ROUTE = 'auditRoute';

export type AuditRouteOptions =
  | {
      /** Nombre de negocio del evento (`USER_CREATED`). */
      action: string;
      entity: string;
      /**
       * Campos del body que se guardan. Lo no declarado no entra a la bitácora,
       * así que un campo nuevo con datos del cliente no se filtra por olvido.
       */
      fields?: string[];
    }
  /** El servicio ya registra el evento: el interceptor no lo repite. */
  | { byService: true };

/** Toda ruta que cambia datos declara cómo se audita. */
export const AuditRoute = (options: AuditRouteOptions) =>
  SetMetadata(AUDIT_ROUTE, options);

/**
 * Espejo de los enums del CRM en `api/prisma/schema.prisma` y del estado
 * general de `api/src/crm/crm.types.ts`. Si cambian allá, cambian acá.
 */
export const CRM_SYNC_STATUSES = ["FAILED", "PENDING", "SYNCED"] as const;
export type CrmSyncStatus = (typeof CRM_SYNC_STATUSES)[number];

export type CrmSyncEventType =
  | "LEAD_CREATED"
  | "DIAGNOSTIC_ACTIVATED"
  | "DIAGNOSTIC_STARTED"
  | "DIAGNOSTIC_COMPLETED"
  | "REPORT_DELIVERED";

export type CrmSyncEventStatus = "PENDING" | "SENT" | "FAILED";

export type CrmSyncErrorCode =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "INVALID_DATA"
  | "AUTH_FAILED";

export const CRM_SYNC_STATUS_LABELS: Record<CrmSyncStatus, string> = {
  SYNCED: "Sincronizado",
  PENDING: "Pendiente",
  FAILED: "Con error",
};

/** Colores preset de `Tag` de Ant Design (no hex: salen del tema). */
export const CRM_SYNC_STATUS_COLORS: Record<CrmSyncStatus, string> = {
  SYNCED: "green",
  PENDING: "gold",
  FAILED: "red",
};

export const CRM_EVENT_TYPE_LABELS: Record<CrmSyncEventType, string> = {
  LEAD_CREATED: "Lead recibido",
  DIAGNOSTIC_ACTIVATED: "Diagnóstico activado",
  DIAGNOSTIC_STARTED: "Diagnóstico iniciado",
  DIAGNOSTIC_COMPLETED: "Diagnóstico completado",
  REPORT_DELIVERED: "Informe entregado",
};

export const CRM_EVENT_STATUS_LABELS: Record<CrmSyncEventStatus, string> = {
  PENDING: "En cola",
  SENT: "Enviado",
  FAILED: "Con error",
};

export const CRM_EVENT_STATUS_COLORS: Record<CrmSyncEventStatus, string> = {
  PENDING: "gold",
  SENT: "green",
  FAILED: "red",
};

/**
 * Lo que ve el equipo cuando un envío falla: sin estado HTTP ni detalles
 * técnicos (PF-81), solo qué pasó y qué hacer.
 */
export const CRM_ERROR_MESSAGES: Record<CrmSyncErrorCode, string> = {
  TIMEOUT:
    "El CRM tardó demasiado en responder. Suele ser pasajero: reintenta en unos minutos.",
  RATE_LIMITED:
    "El CRM recibió demasiados envíos seguidos. Reintenta en unos minutos.",
  PROVIDER_ERROR:
    "El CRM tuvo un problema y no recibió los datos. Reintenta en unos minutos.",
  INVALID_DATA:
    "El CRM rechazó los datos de este lead. Pide al equipo técnico que lo revise y después reintenta.",
  AUTH_FAILED:
    "SCORE no pudo conectarse con el CRM. Pide al equipo técnico que revise la conexión y después reintenta.",
};

export const CRM_ERROR_FALLBACK =
  "El envío al CRM no se completó. Reintenta en unos minutos.";

export function crmErrorMessage(code: CrmSyncErrorCode | null): string {
  return (code && CRM_ERROR_MESSAGES[code]) ?? CRM_ERROR_FALLBACK;
}

export function isCrmSyncStatus(value: unknown): value is CrmSyncStatus {
  return CRM_SYNC_STATUSES.includes(value as CrmSyncStatus);
}

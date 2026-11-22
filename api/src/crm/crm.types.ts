import {
  CrmSyncEventStatus,
  CrmSyncEventType,
} from '../../generated/prisma/enums';
import type { CrmStatusUpdate } from './crm.port';

/** Etiqueta de todo contacto que llega desde SCORE (dispara las automatizaciones). */
export const LEAD_TAG = 'score-lead';
/** Etiqueta donde el proveedor engancha el seguimiento tras la entrega. */
export const REPORT_DELIVERED_TAG = 'score-informe-entregado';

/**
 * Valor del campo "Estado SCORE" y etiquetas de cada evento. Los textos son los
 * que ve el equipo comercial en el CRM.
 */
export const CRM_STATUS_BY_EVENT: Record<CrmSyncEventType, CrmStatusUpdate> = {
  [CrmSyncEventType.LEAD_CREATED]: { status: 'Lead', tags: [LEAD_TAG] },
  [CrmSyncEventType.DIAGNOSTIC_ACTIVATED]: { status: 'Cliente', tags: [] },
  [CrmSyncEventType.DIAGNOSTIC_STARTED]: { status: 'En curso', tags: [] },
  [CrmSyncEventType.DIAGNOSTIC_COMPLETED]: { status: 'Completado', tags: [] },
  [CrmSyncEventType.REPORT_DELIVERED]: {
    status: 'Entregado',
    tags: [REPORT_DELIVERED_TAG],
  },
};

/**
 * Estado general de la sincronización de un lead, calculado de sus eventos (no
 * se guarda): `FAILED` si alguno falló, `PENDING` si alguno espera, `SYNCED` si
 * todos salieron. `null` si nunca tuvo eventos (leads anteriores a PF-80).
 */
export type CrmSyncStatus = 'SYNCED' | 'PENDING' | 'FAILED';
export const CRM_SYNC_STATUSES = ['SYNCED', 'PENDING', 'FAILED'] as const;

export function syncStatusOf(
  counts: Partial<Record<CrmSyncEventStatus, number>>,
): CrmSyncStatus | null {
  if ((counts.FAILED ?? 0) > 0) return 'FAILED';
  if ((counts.PENDING ?? 0) > 0) return 'PENDING';
  if ((counts.SENT ?? 0) > 0) return 'SYNCED';
  return null;
}

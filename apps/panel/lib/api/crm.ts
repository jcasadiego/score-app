import "server-only";
import { callApi, type ResourceMessages } from "./client";
import type {
  CrmSyncErrorCode,
  CrmSyncEventStatus,
  CrmSyncEventType,
} from "@/lib/crm/labels";

/**
 * Un envío al CRM (PF-80). La API también manda `lastHttpStatus`; el panel no
 * lo declara ni lo muestra (PF-81: nada técnico en pantalla).
 */
export interface CrmSyncEvent {
  id: string;
  type: CrmSyncEventType;
  status: CrmSyncEventStatus;
  attempts: number;
  nextAttemptAt: string;
  lastErrorCode: CrmSyncErrorCode | null;
  createdAt: string;
  sentAt: string | null;
}

export interface PaginatedCrmSyncEvents {
  data: CrmSyncEvent[];
  total: number;
  page: number;
  pageSize: number;
}

/** Qué CRM está configurado, sin token ni ids de la cuenta. */
export interface CrmStatus {
  provider: string;
  simulated: boolean;
}

const LEAD_MESSAGES: ResourceMessages = {
  notFound: "No encontramos ese lead. Puede que ya no exista.",
};

const RETRY_MESSAGES: ResourceMessages = {
  notFound: "Este envío ya no existe.",
  conflict: "Este envío ya se está procesando.",
};

const STATUS_MESSAGES: ResourceMessages = {
  notFound: "No pudimos consultar el estado del CRM.",
};

export function getCrmStatus(token: string): Promise<CrmStatus> {
  return callApi<CrmStatus>(token, "/crm/status", STATUS_MESSAGES);
}

/** Envíos de un lead, del más reciente al más antiguo. */
export function listCrmSyncEvents(
  token: string,
  leadId: string,
  page: number,
  pageSize: number,
): Promise<PaginatedCrmSyncEvents> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  return callApi<PaginatedCrmSyncEvents>(
    token,
    `/leads/${encodeURIComponent(leadId)}/crm-sync-events?${params}`,
    LEAD_MESSAGES,
  );
}

/** Vuelve a poner en cola un envío fallido. 409 si ya no está fallido. */
export function retryCrmSyncEvent(
  token: string,
  leadId: string,
  eventId: string,
): Promise<CrmSyncEvent> {
  return callApi<CrmSyncEvent>(
    token,
    `/leads/${encodeURIComponent(leadId)}/crm-sync-events/${encodeURIComponent(eventId)}/retry`,
    RETRY_MESSAGES,
    { method: "POST" },
  );
}

import "server-only";
import { callApi, type ResourceMessages } from "./client";
import type { LeadStatus, DiagnosticFamily } from "@/lib/leads/labels";
import type { CrmSyncStatus } from "@/lib/crm/labels";

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  family: DiagnosticFamily;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  status: LeadStatus;
  /** El diagnóstico del lead, si ya se generó (uno por lead). */
  diagnostic: { id: string } | null;
  /** Estado general de sus envíos al CRM; `null` si nunca tuvo (PF-80). */
  crmSyncStatus: CrmSyncStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedLeads {
  data: Lead[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LeadFilters {
  page: number;
  pageSize: number;
  search?: string;
  family?: DiagnosticFamily;
  status?: LeadStatus;
  crmSyncStatus?: CrmSyncStatus;
}

const MESSAGES: ResourceMessages = {
  notFound: "No encontramos ese lead. Puede que ya no exista.",
};

/** Una página de leads; filtros, búsqueda y conteo los resuelve la API. */
export function listLeads(
  token: string,
  { page, pageSize, search, family, status, crmSyncStatus }: LeadFilters,
): Promise<PaginatedLeads> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search) params.set("search", search);
  if (family) params.set("family", family);
  if (status) params.set("status", status);
  if (crmSyncStatus) params.set("crmSyncStatus", crmSyncStatus);
  return callApi<PaginatedLeads>(token, `/leads?${params}`, MESSAGES);
}

export function getLead(token: string, id: string): Promise<Lead> {
  return callApi<Lead>(token, `/leads/${encodeURIComponent(id)}`, MESSAGES);
}

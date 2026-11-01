import "server-only";
import { callApi, type ResourceMessages } from "./client";
import type { LeadStatus, DiagnosticFamily } from "@/lib/leads/labels";

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
}

const MESSAGES: ResourceMessages = {
  notFound: "No encontramos ese lead. Puede que ya no exista.",
};

/** Una página de leads; filtros, búsqueda y conteo los resuelve la API. */
export function listLeads(
  token: string,
  { page, pageSize, search, family, status }: LeadFilters,
): Promise<PaginatedLeads> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search) params.set("search", search);
  if (family) params.set("family", family);
  if (status) params.set("status", status);
  return callApi<PaginatedLeads>(token, `/leads?${params}`, MESSAGES);
}

export function updateLeadStatus(
  token: string,
  id: string,
  status: LeadStatus,
): Promise<Lead> {
  return callApi<Lead>(
    token,
    `/leads/${encodeURIComponent(id)}/status`,
    MESSAGES,
    { method: "PATCH", body: JSON.stringify({ status }) },
  );
}

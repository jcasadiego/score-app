import "server-only";
import { llamarApi, type MensajesRecurso } from "./cliente";
import type { EstadoLead, FamiliaDiagnostico } from "@/lib/leads/etiquetas";

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  family: FamiliaDiagnostico;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  status: EstadoLead;
  createdAt: string;
  updatedAt: string;
}

export interface PaginaLeads {
  data: Lead[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FiltroLeads {
  page: number;
  pageSize: number;
  search?: string;
  family?: FamiliaDiagnostico;
  status?: EstadoLead;
}

const MENSAJES: MensajesRecurso = {
  noEncontrado: "No encontramos ese lead. Puede que ya no exista.",
};

/** Una página de leads; filtros, búsqueda y conteo los resuelve la API. */
export function listarLeads(
  token: string,
  { page, pageSize, search, family, status }: FiltroLeads,
): Promise<PaginaLeads> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search) params.set("search", search);
  if (family) params.set("family", family);
  if (status) params.set("status", status);
  return llamarApi<PaginaLeads>(token, `/leads?${params}`, MENSAJES);
}

export function cambiarEstadoLead(
  token: string,
  id: string,
  status: EstadoLead,
): Promise<Lead> {
  return llamarApi<Lead>(
    token,
    `/leads/${encodeURIComponent(id)}/status`,
    MENSAJES,
    { method: "PATCH", body: JSON.stringify({ status }) },
  );
}

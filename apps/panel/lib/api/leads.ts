import "server-only";
import { llamarApi, type MensajesRecurso } from "./cliente";
import type { EstadoLead, FamiliaDiagnostico } from "@/lib/leads/etiquetas";

export interface Lead {
  id: string;
  nombre: string;
  email: string;
  telefono: string | null;
  familia: FamiliaDiagnostico;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  estado: EstadoLead;
  creadoEn: string;
  actualizadoEn: string;
}

export interface PaginaLeads {
  datos: Lead[];
  total: number;
  pagina: number;
  tamano: number;
}

export interface FiltroLeads {
  pagina: number;
  tamano: number;
  q?: string;
  familia?: FamiliaDiagnostico;
  estado?: EstadoLead;
}

const MENSAJES: MensajesRecurso = {
  noEncontrado: "No encontramos ese lead. Puede que ya no exista.",
};

/** Una página de leads; filtros, búsqueda y conteo los resuelve la API. */
export function listarLeads(
  token: string,
  { pagina, tamano, q, familia, estado }: FiltroLeads,
): Promise<PaginaLeads> {
  const params = new URLSearchParams({
    pagina: String(pagina),
    tamano: String(tamano),
  });
  if (q) params.set("q", q);
  if (familia) params.set("familia", familia);
  if (estado) params.set("estado", estado);
  return llamarApi<PaginaLeads>(token, `/leads?${params}`, MENSAJES);
}

export function cambiarEstadoLead(
  token: string,
  id: string,
  estado: EstadoLead,
): Promise<Lead> {
  return llamarApi<Lead>(
    token,
    `/leads/${encodeURIComponent(id)}/estado`,
    MENSAJES,
    { method: "PATCH", body: JSON.stringify({ estado }) },
  );
}

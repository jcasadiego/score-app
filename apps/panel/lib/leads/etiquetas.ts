/**
 * Espejo de los enums `DiagnosticFamily` y `LeadStatus` de
 * `api/prisma/schema.prisma`. Si cambian allá, cambian acá.
 */
export const FAMILIAS = ["PROJECT", "B2B", "PROFESSIONAL", "CATALOG"] as const;
export type FamiliaDiagnostico = (typeof FAMILIAS)[number];

export const ESTADOS_LEAD = ["NEW", "CONTACTED", "CONVERTED"] as const;
export type EstadoLead = (typeof ESTADOS_LEAD)[number];

export const ETIQUETAS_FAMILIA: Record<FamiliaDiagnostico, string> = {
  PROJECT: "Proyecto",
  B2B: "B2B",
  PROFESSIONAL: "Profesional",
  CATALOG: "Catálogo",
};

export const ETIQUETAS_ESTADO_LEAD: Record<EstadoLead, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  CONVERTED: "Convertido",
};

/** Colores preset de `Tag` de Ant Design (no hex: salen del tema). */
export const COLORES_ESTADO_LEAD: Record<EstadoLead, string> = {
  NEW: "blue",
  CONTACTED: "gold",
  CONVERTED: "green",
};

export function esFamilia(valor: unknown): valor is FamiliaDiagnostico {
  return FAMILIAS.includes(valor as FamiliaDiagnostico);
}

export function esEstadoLead(valor: unknown): valor is EstadoLead {
  return ESTADOS_LEAD.includes(valor as EstadoLead);
}

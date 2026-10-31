/**
 * Espejo de los enums `FamiliaDiagnostico` y `EstadoLead` de
 * `api/prisma/schema.prisma`. Si cambian allá, cambian acá.
 */
export const FAMILIAS = ["PROYECTO", "B2B", "PROFESIONAL", "CATALOGO"] as const;
export type FamiliaDiagnostico = (typeof FAMILIAS)[number];

export const ESTADOS_LEAD = ["NUEVO", "CONTACTADO", "CONVERTIDO"] as const;
export type EstadoLead = (typeof ESTADOS_LEAD)[number];

export const ETIQUETAS_FAMILIA: Record<FamiliaDiagnostico, string> = {
  PROYECTO: "Proyecto",
  B2B: "B2B",
  PROFESIONAL: "Profesional",
  CATALOGO: "Catálogo",
};

export const ETIQUETAS_ESTADO_LEAD: Record<EstadoLead, string> = {
  NUEVO: "Nuevo",
  CONTACTADO: "Contactado",
  CONVERTIDO: "Convertido",
};

/** Colores preset de `Tag` de Ant Design (no hex: salen del tema). */
export const COLORES_ESTADO_LEAD: Record<EstadoLead, string> = {
  NUEVO: "blue",
  CONTACTADO: "gold",
  CONVERTIDO: "green",
};

export function esFamilia(valor: unknown): valor is FamiliaDiagnostico {
  return FAMILIAS.includes(valor as FamiliaDiagnostico);
}

export function esEstadoLead(valor: unknown): valor is EstadoLead {
  return ESTADOS_LEAD.includes(valor as EstadoLead);
}

/**
 * Espejo de los enums `DiagnosticFamily` y `LeadStatus` de
 * `api/prisma/schema.prisma`. Si cambian allá, cambian acá.
 */
export const FAMILIES = ["PROJECT", "B2B", "PROFESSIONAL", "CATALOG"] as const;
export type DiagnosticFamily = (typeof FAMILIES)[number];

export const LEAD_STATUSES = ["NEW", "CONTACTED", "CONVERTED"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const FAMILY_LABELS: Record<DiagnosticFamily, string> = {
  PROJECT: "Proyecto",
  B2B: "B2B",
  PROFESSIONAL: "Profesional",
  CATALOG: "Catálogo",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  CONVERTED: "Convertido",
};

/** Colores preset de `Tag` de Ant Design (no hex: salen del tema). */
export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  NEW: "blue",
  CONTACTED: "gold",
  CONVERTED: "green",
};

export function isFamily(value: unknown): value is DiagnosticFamily {
  return FAMILIES.includes(value as DiagnosticFamily);
}

export function isLeadStatus(value: unknown): value is LeadStatus {
  return LEAD_STATUSES.includes(value as LeadStatus);
}

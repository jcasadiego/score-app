/**
 * Espejo de `DiagnosticStatus` (más `ABANDONED`, que la API calcula),
 * `ExternalPlatform`, `QuestionType` y `AccessLinkOrigin` de
 * `api/prisma/schema.prisma`. Si cambian allá, cambian acá.
 */
export const DIAGNOSTIC_STATUSES = [
  "ACTIVE",
  "IN_PROGRESS",
  "ABANDONED",
  "COMPLETED",
] as const;
export type DiagnosticStatus = (typeof DIAGNOSTIC_STATUSES)[number];

export const DIAGNOSTIC_STATUS_LABELS: Record<DiagnosticStatus, string> = {
  ACTIVE: "Sin empezar",
  IN_PROGRESS: "En progreso",
  ABANDONED: "Abandonado",
  COMPLETED: "Completado",
};

/** Colores preset de `Tag` de Ant Design (no hex: salen del tema). */
export const DIAGNOSTIC_STATUS_COLORS: Record<DiagnosticStatus, string> = {
  ACTIVE: "default",
  IN_PROGRESS: "blue",
  ABANDONED: "orange",
  COMPLETED: "green",
};

export function isDiagnosticStatus(value: unknown): value is DiagnosticStatus {
  return DIAGNOSTIC_STATUSES.includes(value as DiagnosticStatus);
}

export type ExternalPlatform =
  | "SPOTIFY"
  | "YOUTUBE"
  | "INSTAGRAM"
  | "TIKTOK"
  | "WEBSITE";

export const PLATFORM_LABELS: Record<ExternalPlatform, string> = {
  SPOTIFY: "Spotify",
  YOUTUBE: "YouTube",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  WEBSITE: "Sitio web",
};

export type QuestionType = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "FREE_TEXT";

export type AccessLinkOrigin = "PANEL" | "RECOVERY";

export const ACCESS_LINK_ORIGIN_LABELS: Record<AccessLinkOrigin, string> = {
  PANEL: "Desde el panel",
  RECOVERY: "Recuperado por el cliente",
};

/** Espejo de `CREATION_REASON_MAX` de `api/src/diagnostics/dto/limits.ts`. */
export const CREATION_REASON_MIN = 3;
export const CREATION_REASON_MAX = 500;

/**
 * Espejo de `ReviewStatus` y de los límites de `api/src/reviews/dto/limits.ts`.
 * Si cambian allá, cambian acá.
 */
export const REVIEW_STATUSES = ["PENDING", "IN_REVIEW", "APPROVED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  PENDING: "Pendiente",
  IN_REVIEW: "En revisión",
  APPROVED: "Aprobado",
};

/** Colores preset de `Tag` de Ant Design (no hex: salen del tema). */
export const REVIEW_STATUS_COLORS: Record<ReviewStatus, string> = {
  PENDING: "default",
  IN_REVIEW: "blue",
  APPROVED: "green",
};

/** Filtros de la bandeja, en la URL como `view`. */
export const REVIEW_VIEWS = ["unassigned", "mine", "approved"] as const;
export type ReviewView = (typeof REVIEW_VIEWS)[number];

export const REVIEW_VIEW_LABELS: Record<ReviewView | "all", string> = {
  all: "Todos",
  unassigned: "Sin tomar",
  mine: "Mis casos",
  approved: "Aprobados",
};

export function isReviewView(value: unknown): value is ReviewView {
  return REVIEW_VIEWS.includes(value as ReviewView);
}

export const REVIEW_REASON_MAX = 500;
export const REVIEW_NOTE_BODY_MAX = 5000;
export const REVIEW_NOTE_DIMENSION_MAX = 64;

/** El único bloqueo que el Aprobador puede saltar, con motivo. */
export const AI_EXCEPTION_BLOCKER = "FLAG_ANALYSIS_NOT_SUCCEEDED";

export const VOID_CAUSE_LABELS: Record<string, string> = {
  RECALCULATED: "anulada por un recálculo",
  REOPENED: "reabierta",
};

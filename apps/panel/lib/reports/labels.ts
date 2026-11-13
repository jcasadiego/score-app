/**
 * Espejo de `ReportStatus`, `ReportPart` y de los límites de
 * `api/src/reports/dto/`. Si cambian allá, cambian acá.
 */
export const REPORT_STATUSES = ["DRAFT", "APPROVED", "DELIVERED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_PARTS = [
  "FINDING",
  "IMPLICATION",
  "RECOMMENDATION",
  "NEXT_STEP",
] as const;
export type ReportPart = (typeof REPORT_PARTS)[number];

export const REPORT_PART_LABELS: Record<ReportPart, string> = {
  FINDING: "Hallazgo",
  IMPLICATION: "Implicación",
  RECOMMENDATION: "Recomendación",
  NEXT_STEP: "Próximo paso",
};

export const REPORT_SECTION_BODY_MAX = 4000;
export const REPORT_REOPEN_REASON_MAX = 500;

/** Cómo se muestra el estado del informe; `redeliveryPending` manda sobre el resto. */
export function reportStatusView(
  report: { status: ReportStatus; redeliveryPending: boolean } | null,
): { label: string; color: string } {
  if (!report) return { label: "Sin informe", color: "default" };
  if (report.redeliveryPending) {
    return { label: "Pendiente de reenvío", color: "orange" };
  }
  switch (report.status) {
    case "DRAFT":
      return { label: "Borrador", color: "blue" };
    case "APPROVED":
      return { label: "Aprobado, sin entregar", color: "gold" };
    case "DELIVERED":
      return { label: "Entregado", color: "green" };
  }
}

export function reportHref(reviewId: string) {
  return `/reviews/${encodeURIComponent(reviewId)}/report`;
}

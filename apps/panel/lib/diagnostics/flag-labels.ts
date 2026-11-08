/** Espejos de los enums de flags de `api/prisma/schema.prisma`. */
export type FlagSource = "ENGINE" | "AI";
export type FlagSeverity = "HIGH" | "MEDIUM" | "LOW";
export type FlagStatus = "OPEN" | "REVIEWED" | "DISMISSED";
export type FlagAnalysisStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export const FLAG_SOURCE_LABELS: Record<FlagSource, string> = {
  ENGINE: "Motor",
  AI: "IA",
};

export const FLAG_SEVERITY_LABELS: Record<FlagSeverity, string> = {
  HIGH: "Alta",
  MEDIUM: "Media",
  LOW: "Baja",
};

/** Colores preset de `Tag` de Ant Design (no hex: salen del tema). */
export const FLAG_SEVERITY_COLORS: Record<FlagSeverity, string> = {
  HIGH: "red",
  MEDIUM: "orange",
  LOW: "gold",
};

export const FLAG_SEVERITY_ORDER: Record<FlagSeverity, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

export const FLAG_STATUS_LABELS: Record<FlagStatus, string> = {
  OPEN: "Abierta",
  REVIEWED: "Revisada",
  DISMISSED: "Descartada",
};

export const FLAG_STATUS_COLORS: Record<FlagStatus, string> = {
  OPEN: "processing",
  REVIEWED: "green",
  DISMISSED: "default",
};

/** Así se presenta todo flag de la IA: algo a verificar, nunca un hecho. */
export const AI_FLAG_TITLE = "Posible contradicción — verificar";

export function isAnalysisInProgress(status: FlagAnalysisStatus): boolean {
  return status === "PENDING" || status === "RUNNING";
}

/** Por qué falló el análisis (`failureReason` de la API), en palabras. */
export const ANALYSIS_FAILURE_LABELS: Record<string, string> = {
  disabled: "la IA está desactivada",
  timeout: "la IA tardó demasiado en responder",
  rate_limited: "la IA recibió demasiadas peticiones",
  provider_error: "el proveedor de IA devolvió un error",
  refused: "la IA no quiso analizar las respuestas",
  invalid_output: "la respuesta de la IA no tenía el formato esperado",
  invalid_question: "la IA citó una pregunta que no es de este cuestionario",
};

/** Mismo límite que `REVIEW_NOTE_MAX` de la API. */
export const REVIEW_NOTE_MAX = 1000;

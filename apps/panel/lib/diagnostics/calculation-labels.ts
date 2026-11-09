/** Espejo de `CalculationStatus` de `api/prisma/schema.prisma`. */
export type CalculationStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export const CALCULATION_STATUS_LABELS: Record<CalculationStatus, string> = {
  PENDING: "Pendiente",
  RUNNING: "En curso",
  SUCCEEDED: "Exitoso",
  FAILED: "Fallido",
};

/** Colores preset de `Tag` de Ant Design (no hex: salen del tema). */
export const CALCULATION_STATUS_COLORS: Record<CalculationStatus, string> = {
  PENDING: "default",
  RUNNING: "processing",
  SUCCEEDED: "green",
  FAILED: "red",
};

export function isCalculationInProgress(status: CalculationStatus): boolean {
  return status === "PENDING" || status === "RUNNING";
}

/**
 * Nombres legibles de lo que devuelve el motor. Hoy es la forma del brief que
 * imita el adapter simulado; lo que no esté aquí se muestra con su clave.
 */
export const OUTPUT_LABELS: Record<string, string> = {
  potential: "Potencial (0–100)",
  maturity: "Madurez (1–4)",
  confidence: "Confianza (0–1)",
  dimensions: "Dimensiones",
};

/** Claves internas que no se muestran como dato del resultado. */
export const HIDDEN_OUTPUT_KEYS = new Set(["simulated"]);

/** Mensaje acordado (Jira PF-25) para el motor desactivado. */
export const ENGINE_DISABLED_MESSAGE =
  "Motor de cálculo desactivado: este diagnóstico se calculará cuando se active.";

/** Filas del historial por página. */
export const CALCULATIONS_PAGE_SIZE = 10;

/**
 * Esperas entre consultas mientras algo sigue en curso (un cálculo o su
 * análisis con IA): rápido al principio y cada vez más espaciado. Después de
 * la última, se deja de consultar (el usuario puede recargar).
 */
export const POLL_DELAYS_MS = [
  1_500, 3_000, 5_000, 8_000, 13_000, 20_000, 30_000, 30_000, 30_000,
];

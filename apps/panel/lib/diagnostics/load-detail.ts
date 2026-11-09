import "server-only";
import {
  getDiagnostic,
  type DiagnosticDetail,
} from "@/lib/api/diagnostics";
import {
  getCurrentCalculation,
  getScoringEngineStatus,
  listCalculations,
} from "@/lib/api/calculations";
import { listFlags } from "@/lib/api/flags";
import { ApiError } from "@/lib/api/errors";
import type { CalculationData } from "@/components/diagnostics/calculation-section";
import type { FlagsData } from "@/components/diagnostics/flags-section";
import { CALCULATIONS_PAGE_SIZE } from "@/lib/diagnostics/calculation-labels";
import { MAX_PAGE } from "@/lib/users/limits";

export interface DiagnosticDetailData {
  diagnostic: DiagnosticDetail;
  /** Nulo si el diagnóstico todavía no se envió. */
  calculations: CalculationData | null;
  flags: FlagsData | null;
}

/** La página del historial de cálculos que pide la URL (`calcPage`). */
export function historyPageFrom(value: string | string[] | undefined): number {
  const requested = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(requested) && requested > 0 && requested <= MAX_PAGE
    ? requested
    : 1;
}

/**
 * Lo que muestra el detalle del diagnóstico: respuestas, resultado del motor y
 * alertas. Lo usan el detalle (PF-18) y la pantalla de revisión (PF-40).
 */
export async function loadDiagnosticDetail(
  token: string,
  id: string,
  historyPage: number,
): Promise<DiagnosticDetailData> {
  const diagnostic = await getDiagnostic(token, id);
  // Sin enviar no hay cálculos: no se consultan.
  if (diagnostic.status !== "COMPLETED") {
    return { diagnostic, calculations: null, flags: null };
  }
  const [engine, current, latestPage, history, flags] = await Promise.all([
    getScoringEngineStatus(token),
    getCurrentCalculation(token, id),
    listCalculations(token, id, 1, 1),
    listCalculations(token, id, historyPage, CALCULATIONS_PAGE_SIZE),
    // Si fallan solo las alertas, el resto del detalle se muestra igual.
    listFlags(token, id).then(
      (list): FlagsData => ({ list }),
      (error: unknown): FlagsData => {
        if (error instanceof ApiError && error.status === 401) throw error;
        return {
          list: null,
          error: "No pudimos cargar las alertas. Recarga la página.",
        };
      },
    ),
  ]);
  return {
    diagnostic,
    calculations: {
      engine,
      current,
      latest: latestPage.data[0] ?? null,
      history,
    },
    flags,
  };
}

import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import {
  getDiagnostic,
  type DiagnosticDetail as Diagnostic,
} from "@/lib/api/diagnostics";
import {
  getCurrentCalculation,
  getScoringEngineStatus,
  listCalculations,
} from "@/lib/api/calculations";
import { ApiError } from "@/lib/api/errors";
import { PageError } from "@/components/page-error";
import { DiagnosticDetail } from "@/components/diagnostics/diagnostic-detail";
import type { CalculationData } from "@/components/diagnostics/calculation-section";
import { CALCULATIONS_PAGE_SIZE } from "@/lib/diagnostics/calculation-labels";
import { MAX_PAGE } from "@/lib/users/limits";

export const metadata: Metadata = {
  title: "Diagnóstico · Panel SCORE",
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** La ruta que usa el aviso de diagnóstico completado (PF-22). */
export default async function DiagnosticPage({
  params,
  searchParams,
}: PageProps<"/diagnostics/[id]">) {
  await verifySession();
  const { id } = await params;
  const requestedPage = Number(firstValue((await searchParams).calcPage));
  const historyPage =
    Number.isInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= MAX_PAGE
      ? requestedPage
      : 1;

  let diagnostic: Diagnostic;
  let calculations: CalculationData | null = null;
  const token = await getToken();
  try {
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    diagnostic = await getDiagnostic(token, id);
    // Sin enviar no hay cálculos: no se consultan.
    if (diagnostic.status === "COMPLETED") {
      const [engine, current, latestPage, history] = await Promise.all([
        getScoringEngineStatus(token),
        getCurrentCalculation(token, id),
        listCalculations(token, id, 1, 1),
        listCalculations(token, id, historyPage, CALCULATIONS_PAGE_SIZE),
      ]);
      calculations = {
        engine,
        current,
        latest: latestPage.data[0] ?? null,
        history,
      };
    }
  } catch (error) {
    return (
      <PageError
        error={error}
        fallback="No pudimos cargar el diagnóstico. Intenta de nuevo."
      />
    );
  }

  return <DiagnosticDetail diagnostic={diagnostic} calculations={calculations} />;
}

import "server-only";
import { callApi, type ResourceMessages } from "./client";
import { ApiError } from "./errors";
import type { CalculationStatus } from "@/lib/diagnostics/calculation-labels";

export interface CalculationSummary {
  id: string;
  status: CalculationStatus;
  /** Lo que devolvió el motor; nulo hasta terminar con éxito. */
  output: Record<string, unknown> | null;
  engine: string | null;
  isSimulated: boolean | null;
  error: string | null;
  ruleSetVersion: { number: number } | null;
  requestedBy: { id: string; name: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface CalculationsPage {
  data: CalculationSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScoringEngineStatus {
  driver: string;
  enabled: boolean;
  simulated: boolean;
}

const MESSAGES: ResourceMessages = {
  notFound: "No encontramos ese diagnóstico. Puede que ya no exista.",
  conflict: "Ya hay un cálculo en curso para este diagnóstico.",
};

const base = (diagnosticId: string) =>
  `/diagnostics/${encodeURIComponent(diagnosticId)}/calculations`;

/** Historial, el último intento primero. */
export function listCalculations(
  token: string,
  diagnosticId: string,
  page: number,
  pageSize: number,
): Promise<CalculationsPage> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  return callApi(token, `${base(diagnosticId)}?${params}`, MESSAGES);
}

/** El cálculo vigente (el último exitoso), o `null` si todavía no hay. */
export async function getCurrentCalculation(
  token: string,
  diagnosticId: string,
): Promise<CalculationSummary | null> {
  try {
    return await callApi<CalculationSummary>(
      token,
      `${base(diagnosticId)}/current`,
      MESSAGES,
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === "NO_CURRENT_CALCULATION") {
      return null;
    }
    throw error;
  }
}

/** 202: el cálculo se procesa en segundo plano. */
export function requestCalculation(
  token: string,
  diagnosticId: string,
): Promise<CalculationSummary> {
  return callApi(token, base(diagnosticId), MESSAGES, { method: "POST" });
}

export function getScoringEngineStatus(
  token: string,
): Promise<ScoringEngineStatus> {
  return callApi(token, "/scoring-engine/status", {
    notFound: "No pudimos consultar el motor de cálculo.",
  });
}

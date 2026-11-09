import "server-only";
import { callApi, type ResourceMessages } from "./client";
import type {
  FlagAnalysisStatus,
  FlagSeverity,
  FlagSource,
  FlagStatus,
} from "@/lib/diagnostics/flag-labels";

export interface Flag {
  id: string;
  calculationId: string;
  source: FlagSource;
  severity: FlagSeverity;
  /** Puede citar texto del cliente: se muestra siempre como texto plano. */
  message: string;
  status: FlagStatus;
  reviewNote: string | null;
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: string | null;
  createdAt: string;
  questions: { id: string; code: string; text: string }[];
}

export interface FlagAnalysis {
  id: string;
  calculationId: string;
  status: FlagAnalysisStatus;
  provider: string | null;
  model: string | null;
  isSimulated: boolean | null;
  failureReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/** Flags del cálculo vigente, con el estado de su análisis. */
export interface FlagsList {
  /** Nulo si el diagnóstico todavía no tiene un cálculo exitoso. */
  calculationId: string | null;
  /** Nulo si el cálculo es anterior a los flags y nunca se analizó. */
  analysis: FlagAnalysis | null;
  flags: Flag[];
  openCount: number;
}

const MESSAGES: ResourceMessages = {
  notFound: "No encontramos esa alerta. Recarga la página.",
  conflict: "El análisis ya terminó o sigue en curso.",
};

export function listFlags(
  token: string,
  diagnosticId: string,
): Promise<FlagsList> {
  return callApi(
    token,
    `/diagnostics/${encodeURIComponent(diagnosticId)}/flags`,
    { notFound: "No encontramos ese diagnóstico. Puede que ya no exista." },
  );
}

export function reviewFlag(
  token: string,
  flagId: string,
  status: FlagStatus,
  note: string | undefined,
): Promise<Flag> {
  return callApi(token, `/flags/${encodeURIComponent(flagId)}`, MESSAGES, {
    method: "PATCH",
    body: JSON.stringify({ status, ...(note && { note }) }),
  });
}

const analysisPath = (calculationId: string) =>
  `/calculations/${encodeURIComponent(calculationId)}/flag-analysis`;

export function getFlagAnalysis(
  token: string,
  calculationId: string,
): Promise<FlagAnalysis> {
  return callApi(token, analysisPath(calculationId), MESSAGES);
}

/** 202: reintenta un análisis fallido (o analiza un cálculo que no tenía). */
export function requestFlagAnalysis(
  token: string,
  calculationId: string,
): Promise<FlagAnalysis> {
  return callApi(token, analysisPath(calculationId), MESSAGES, {
    method: "POST",
  });
}

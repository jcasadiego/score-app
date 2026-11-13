import "server-only";
import { callApi, type ResourceMessages } from "./client";
import type { DiagnosticFamily } from "@/lib/leads/labels";
import type { QuestionType } from "@/lib/diagnostics/labels";
import type { CalculationStatus } from "@/lib/diagnostics/calculation-labels";
import type { FlagAnalysisStatus } from "@/lib/diagnostics/flag-labels";
import type { ReviewStatus } from "@/lib/reviews/labels";
import type { ReportStatus } from "@/lib/reports/labels";

type Person = { id: string; name: string };

export interface ReviewAssignee extends Person {
  /** Si está desactivado, otra persona puede tomar el caso. */
  active: boolean;
}

export interface ReviewDiagnostic {
  id: string;
  completedAt: string | null;
  leadName: string;
  family: DiagnosticFamily;
}

/** El estado del informe del caso; nulo si todavía no se generó. */
export interface ReviewReportSummary {
  status: ReportStatus;
  /** Se entregó antes y el caso cambió después: falta la versión actualizada. */
  redeliveryPending: boolean;
}

export interface ReviewListItem {
  id: string;
  status: ReviewStatus;
  assignee: ReviewAssignee | null;
  assignedAt: string | null;
  createdAt: string;
  diagnostic: ReviewDiagnostic;
  openFlags: number;
  report: ReviewReportSummary | null;
}

export interface PaginatedReviews {
  data: ReviewListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReviewApproval {
  id: string;
  calculationId: string;
  approvedBy: Person;
  aiExceptionReason: string | null;
  approvedAt: string;
  voidedAt: string | null;
  voidCause: string | null;
  voidedBy: Person | null;
  voidReason: string | null;
}

/** Un error de la lista `errors` de la API: qué falta para aprobar. */
export interface ApprovalBlocker {
  code: string;
  message: string;
}

export interface ReviewDetail {
  id: string;
  status: ReviewStatus;
  /** Va en `If-Match` al corregir y aprobar. */
  version: number;
  assignee: ReviewAssignee | null;
  assignedAt: string | null;
  createdAt: string;
  updatedAt: string;
  diagnostic: ReviewDiagnostic;
  approval: ReviewApproval | null;
  latestCalculation: {
    id: string;
    status: CalculationStatus;
    isSimulated: boolean | null;
    correctionSequence: number;
    analysisStatus: FlagAnalysisStatus | null;
    openFlags: number;
    createdAt: string;
  } | null;
  lastCorrectionSequence: number;
  approvalBlockers: ApprovalBlocker[];
  report: ReviewReportSummary | null;
}

type OptionView = { id: string; value: string; text: string };

export interface AnswerCorrection {
  id: string;
  sequence: number;
  answerId: string;
  /** Texto del cliente o del revisor: se muestra siempre como texto plano. */
  textValue: string | null;
  options: OptionView[];
  reason: string;
  correctedBy: Person;
  createdAt: string;
  question: { id: string; code: string; text: string; type: QuestionType };
  original: { textValue: string | null; options: OptionView[] };
}

export interface ReviewNote {
  id: string;
  dimension: string | null;
  body: string;
  author: Person;
  createdAt: string;
}

export interface ReviewFilters {
  page: number;
  pageSize: number;
  assignment?: "unassigned" | "mine";
  status?: ReviewStatus;
}

const MESSAGES: ResourceMessages = {
  notFound: "No encontramos ese caso. Puede que ya no exista.",
};

const base = (id: string) => `/reviews/${encodeURIComponent(id)}`;
const ifMatch = (version: number) => ({ "If-Match": `"${version}"` });

export function listReviews(
  token: string,
  { page, pageSize, assignment, status }: ReviewFilters,
): Promise<PaginatedReviews> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (assignment) params.set("assignment", assignment);
  if (status) params.set("status", status);
  return callApi(token, `/reviews?${params}`, MESSAGES);
}

export function getReview(token: string, id: string): Promise<ReviewDetail> {
  return callApi(token, base(id), MESSAGES);
}

export function takeReview(token: string, id: string): Promise<ReviewDetail> {
  return callApi(token, `${base(id)}/assignment`, MESSAGES, { method: "PUT" });
}

export function releaseReview(token: string, id: string): Promise<void> {
  return callApi(token, `${base(id)}/assignment`, MESSAGES, {
    method: "DELETE",
  });
}

export function listCorrections(
  token: string,
  id: string,
): Promise<AnswerCorrection[]> {
  return callApi(token, `${base(id)}/corrections`, MESSAGES);
}

export function createCorrection(
  token: string,
  id: string,
  version: number,
  body: { answerId: string; text?: string; optionIds?: string[]; reason: string },
): Promise<AnswerCorrection> {
  return callApi(token, `${base(id)}/corrections`, MESSAGES, {
    method: "POST",
    headers: ifMatch(version),
    body: JSON.stringify(body),
  });
}

export function listNotes(token: string, id: string): Promise<ReviewNote[]> {
  return callApi(token, `${base(id)}/notes`, MESSAGES);
}

export function createNote(
  token: string,
  id: string,
  body: { body: string; dimension?: string },
): Promise<ReviewNote> {
  return callApi(token, `${base(id)}/notes`, MESSAGES, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function approveReview(
  token: string,
  id: string,
  version: number,
  aiExceptionReason?: string,
): Promise<ReviewApproval> {
  return callApi(token, `${base(id)}/approval`, MESSAGES, {
    method: "POST",
    headers: ifMatch(version),
    body: JSON.stringify(aiExceptionReason ? { aiExceptionReason } : {}),
  });
}

export function reopenReview(
  token: string,
  id: string,
  reason: string,
): Promise<ReviewApproval> {
  return callApi(token, `${base(id)}/reopenings`, MESSAGES, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

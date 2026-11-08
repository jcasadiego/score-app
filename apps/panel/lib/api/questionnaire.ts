import "server-only";
import { callApi, type ResourceMessages } from "./client";
import type { DiagnosticFamily } from "@/lib/leads/labels";
import type { QuestionType } from "@/lib/diagnostics/labels";
import type { QuestionnaireVersionStatus } from "@/lib/questionnaire/labels";

export interface QuestionnaireOption {
  id: string;
  text: string;
  value: string;
  position: number;
}

export interface QuestionnaireQuestion {
  id: string;
  code: string;
  text: string;
  type: QuestionType;
  helpText: string | null;
  required: boolean;
  maxLength: number | null;
  position: number;
  options: QuestionnaireOption[];
}

export interface QuestionnaireVersionSummary {
  id: string;
  family: DiagnosticFamily;
  versionNumber: number;
  status: QuestionnaireVersionStatus;
  isSample: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
}

export interface QuestionnaireVersionDetail
  extends Omit<QuestionnaireVersionSummary, "questionCount"> {
  questions: QuestionnaireQuestion[];
}

/** Lo que se envía al crear o editar una pregunta (la pregunta completa). */
export interface QuestionInput {
  code: string;
  text: string;
  type: QuestionType;
  helpText?: string;
  required: boolean;
  maxLength?: number;
  options: { text: string; value: string }[];
}

const MESSAGES: ResourceMessages = {
  notFound: "No encontramos esa versión del cuestionario. Recarga la página.",
};

const base = (versionId: string) =>
  `/questionnaire-versions/${encodeURIComponent(versionId)}`;

/** La versión más reciente de una familia con ese estado, o `null`. */
export async function latestVersion(
  token: string,
  family: DiagnosticFamily,
  status: QuestionnaireVersionStatus,
): Promise<QuestionnaireVersionSummary | null> {
  const params = new URLSearchParams({
    page: "1",
    pageSize: "1",
    family,
    status,
  });
  const { data } = await callApi<{ data: QuestionnaireVersionSummary[] }>(
    token,
    `/questionnaire-versions?${params}`,
    MESSAGES,
  );
  return data[0] ?? null;
}

export function getVersion(
  token: string,
  versionId: string,
): Promise<QuestionnaireVersionDetail> {
  return callApi(token, base(versionId), MESSAGES);
}

export function createDraft(
  token: string,
  family: DiagnosticFamily,
): Promise<QuestionnaireVersionDetail> {
  return callApi(token, "/questionnaire-versions", MESSAGES, {
    method: "POST",
    body: JSON.stringify({ family }),
  });
}

export function addQuestion(
  token: string,
  versionId: string,
  question: QuestionInput,
): Promise<QuestionnaireQuestion> {
  return callApi(token, `${base(versionId)}/questions`, MESSAGES, {
    method: "POST",
    body: JSON.stringify(question),
  });
}

export function updateQuestion(
  token: string,
  versionId: string,
  questionId: string,
  question: QuestionInput,
): Promise<QuestionnaireQuestion> {
  return callApi(
    token,
    `${base(versionId)}/questions/${encodeURIComponent(questionId)}`,
    { notFound: "No encontramos esa pregunta. Recarga la página." },
    { method: "PUT", body: JSON.stringify(question) },
  );
}

export function deleteQuestion(
  token: string,
  versionId: string,
  questionId: string,
): Promise<void> {
  return callApi(
    token,
    `${base(versionId)}/questions/${encodeURIComponent(questionId)}`,
    { notFound: "Esa pregunta ya no existe. Recarga la página." },
    { method: "DELETE" },
  );
}

export function reorderQuestions(
  token: string,
  versionId: string,
  questionIds: string[],
): Promise<QuestionnaireVersionDetail> {
  return callApi(token, `${base(versionId)}/question-order`, MESSAGES, {
    method: "PUT",
    body: JSON.stringify({ questionIds }),
  });
}

export function publishVersion(
  token: string,
  versionId: string,
): Promise<QuestionnaireVersionDetail> {
  return callApi(token, `${base(versionId)}/publication`, MESSAGES, {
    method: "POST",
  });
}

import type { ReviewStatus } from "@/lib/reviews/labels";
import "server-only";
import { callApi, type ResourceMessages } from "./client";
import type { DiagnosticFamily } from "@/lib/leads/labels";
import type {
  AccessLinkOrigin,
  DiagnosticStatus,
  ExternalPlatform,
  QuestionType,
} from "@/lib/diagnostics/labels";

export interface DiagnosticSummary {
  id: string;
  status: DiagnosticStatus;
  family: DiagnosticFamily;
  lead: { id: string; name: string; email: string };
  questionnaireVersion: { id: string; versionNumber: number };
  progress: { answered: number; total: number };
  lastActivityAt: string;
  completedAt: string | null;
  createdAt: string;
}

export type TranscriptionStatus = "PENDING" | "COMPLETED" | "FAILED";

/** Transcripción automática de una grabación (PF-88). Texto solo si terminó. */
export interface Transcription {
  status: TranscriptionStatus;
  text: string | null;
  attempts: number;
  provider: string | null;
  model: string | null;
  lastErrorCode: string | null;
  completedAt: string | null;
  updatedAt: string;
}

/** La grabación de una respuesta, sin el audio ni su clave (PF-86). */
export interface AnswerRecording {
  contentType: string;
  sizeBytes: number;
  durationMs: number;
  updatedAt: string;
  /** El audio se borró por plazo (PF-90); el registro y el texto quedan. */
  audioDeletedAt: string | null;
  transcription: Transcription | null;
}

/** URL firmada de vida corta para escuchar; se pide al reproducir. */
export interface RecordingPlayback {
  url: string;
  expiresAt: string;
  contentType: string;
  durationMs: number;
}

export interface DiagnosticQuestion {
  id: string;
  code: string;
  text: string;
  type: QuestionType;
  helpText: string | null;
  required: boolean;
  position: number;
  allowsVoice: boolean;
  options: { id: string; text: string; value: string }[];
  answer: {
    /** Solo para corregir desde la revisión (PF-40). */
    id: string;
    text: string | null;
    optionIds: string[];
    /** Respuesta por voz; puede ser la única respuesta (sin texto). */
    recording: AnswerRecording | null;
    updatedAt: string;
  } | null;
}

export interface DiagnosticDetail extends DiagnosticSummary {
  creationReason: string | null;
  createdBy: { id: string; name: string } | null;
  externalLinks: { platform: ExternalPlatform; url: string; updatedAt: string }[];
  accessLinks: {
    id: string;
    origin: AccessLinkOrigin;
    expiresAt: string;
    redeemedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }[];
  questions: DiagnosticQuestion[];
  /** La revisión del caso; nula hasta el primer cálculo (PF-64). */
  review: { id: string; status: ReviewStatus } | null;
}

/** Fila del listado: el resumen más las alertas abiertas del cálculo vigente. */
export interface DiagnosticListItem extends DiagnosticSummary {
  openFlagCount: number;
}

export interface PaginatedDiagnostics {
  data: DiagnosticListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DiagnosticFilters {
  page: number;
  pageSize: number;
  search?: string;
  family?: DiagnosticFamily;
  status?: DiagnosticStatus;
}

/** El enlace que la API devuelve una sola vez, y si el correo salió. */
export interface IssuedLink {
  accessLink: { url: string; expiresAt: string };
  emailSent: boolean;
}

const MESSAGES: ResourceMessages = {
  notFound: "No encontramos ese diagnóstico. Puede que ya no exista.",
};

export function listDiagnostics(
  token: string,
  { page, pageSize, search, family, status }: DiagnosticFilters,
): Promise<PaginatedDiagnostics> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search) params.set("search", search);
  if (family) params.set("family", family);
  if (status) params.set("status", status);
  return callApi<PaginatedDiagnostics>(
    token,
    `/diagnostics?${params}`,
    MESSAGES,
  );
}

export function getDiagnostic(
  token: string,
  id: string,
): Promise<DiagnosticDetail> {
  return callApi<DiagnosticDetail>(
    token,
    `/diagnostics/${encodeURIComponent(id)}`,
    MESSAGES,
  );
}

export function createDiagnostic(
  token: string,
  leadId: string,
  reason: string,
): Promise<DiagnosticSummary & IssuedLink> {
  return callApi<DiagnosticSummary & IssuedLink>(
    token,
    "/diagnostics",
    { notFound: "No encontramos ese lead. Puede que ya no exista." },
    { method: "POST", body: JSON.stringify({ leadId, reason }) },
  );
}

export function resendAccessLink(
  token: string,
  id: string,
): Promise<IssuedLink> {
  return callApi<IssuedLink>(
    token,
    `/diagnostics/${encodeURIComponent(id)}/access-links`,
    MESSAGES,
    { method: "POST" },
  );
}

const answerPath = (id: string, questionId: string) =>
  `/diagnostics/${encodeURIComponent(id)}/answers/${encodeURIComponent(questionId)}`;

/** Cada llamada queda en la bitácora de la API (`ANSWER_RECORDING_PLAYED`). */
export function getRecordingPlayback(
  token: string,
  id: string,
  questionId: string,
): Promise<RecordingPlayback> {
  return callApi<RecordingPlayback>(
    token,
    `${answerPath(id, questionId)}/recording`,
    { notFound: "Este audio ya no está disponible." },
  );
}

export function retryTranscription(
  token: string,
  id: string,
  questionId: string,
): Promise<Transcription> {
  return callApi<Transcription>(
    token,
    `${answerPath(id, questionId)}/transcription/retry`,
    { notFound: "Esta respuesta ya no tiene una grabación." },
    { method: "POST" },
  );
}

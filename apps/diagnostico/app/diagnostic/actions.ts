"use server";

import { redirect } from "next/navigation";
import { callApi } from "@/lib/api/client";
import type {
  ActionResult,
  ExternalPlatform,
  RecordingPlayback,
} from "@/lib/api/types";
import { ROUTES } from "@/lib/routes";
import { deleteSession, getSession } from "@/lib/session/cookie";
import { PLATFORMS } from "./platforms";

const NO_SESSION: ActionResult<never> = {
  ok: false,
  status: 401,
  message: "Tu sesión terminó.",
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const INVALID_ID: ActionResult<never> = {
  ok: false,
  status: 400,
  message: "La pregunta no es válida.",
};

/** El diagnóstico sale siempre de la sesión: aquí no viaja ningún id suyo. */
async function withSession<T>(
  path: string,
  method: "PUT" | "DELETE" | "POST",
  body?: unknown,
): Promise<ActionResult<T>> {
  const session = await getSession();
  if (!session) return NO_SESSION;
  return callApi<T>(`/diagnostic-sessions/current${path}`, {
    method,
    session,
    body,
  });
}

export async function saveAnswer(
  questionId: string,
  answer: { text: string } | { optionIds: string[] },
): Promise<ActionResult> {
  if (!ID_PATTERN.test(questionId)) return INVALID_ID;
  const body =
    "text" in answer
      ? { text: String(answer.text) }
      : { optionIds: answer.optionIds.map(String) };
  const result = await withSession<unknown>(
    `/answers/${encodeURIComponent(questionId)}`,
    "PUT",
    body,
  );
  return result.ok ? { ok: true, data: undefined } : result;
}

export async function deleteAnswer(questionId: string): Promise<ActionResult> {
  if (!ID_PATTERN.test(questionId)) return INVALID_ID;
  return withSession(`/answers/${encodeURIComponent(questionId)}`, "DELETE");
}

export async function saveExternalLink(
  platform: ExternalPlatform,
  url: string,
): Promise<ActionResult> {
  if (!PLATFORMS.some((p) => p.id === platform)) return INVALID_ID;
  const result = await withSession<unknown>(
    `/external-links/${encodeURIComponent(platform)}`,
    "PUT",
    { url: String(url) },
  );
  return result.ok ? { ok: true, data: undefined } : result;
}

export async function deleteExternalLink(
  platform: ExternalPlatform,
): Promise<ActionResult> {
  if (!PLATFORMS.some((p) => p.id === platform)) return INVALID_ID;
  return withSession(
    `/external-links/${encodeURIComponent(platform)}`,
    "DELETE",
  );
}

/** Envía el diagnóstico. La API cierra la sesión, así que se borra la cookie. */
export async function submitDiagnostic(): Promise<ActionResult> {
  const result = await withSession<unknown>("/submission", "POST");
  if (!result.ok) return result;
  await deleteSession();
  redirect(ROUTES.submitted);
}

/** Salir en este dispositivo: el avance ya está guardado en la API. */
export async function leave(): Promise<void> {
  await deleteSession();
  redirect(`${ROUTES.home}?left=1`);
}

/** El cliente acepta el uso de su voz (PF-87), con la versión del texto que vio. */
export async function giveVoiceConsent(version: string): Promise<ActionResult> {
  const result = await withSession<unknown>("/voice-consent", "POST", {
    version: String(version),
  });
  return result.ok ? { ok: true, data: undefined } : result;
}

export async function deleteRecording(
  questionId: string,
): Promise<ActionResult> {
  if (!ID_PATTERN.test(questionId)) return INVALID_ID;
  return withSession(
    `/answers/${encodeURIComponent(questionId)}/recording`,
    "DELETE",
  );
}

/** URL firmada de vida corta para escuchar la grabación ya guardada. */
export async function getRecordingUrl(
  questionId: string,
): Promise<ActionResult<RecordingPlayback>> {
  if (!ID_PATTERN.test(questionId)) return INVALID_ID;
  const session = await getSession();
  if (!session) return NO_SESSION;
  return callApi<RecordingPlayback>(
    `/diagnostic-sessions/current/answers/${encodeURIComponent(questionId)}/recording`,
    { session },
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { callApiForm } from "@/lib/api/client";
import type { ActionResult, SavedRecording } from "@/lib/api/types";
import { getSession } from "@/lib/session/cookie";
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_MS,
} from "../../voice-consent";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Margen para las cabeceras del multipart sobre el tope del audio. */
const MAX_BODY_BYTES = MAX_RECORDING_BYTES + 64 * 1024;

const fail = (status: number, message: string, code?: string) =>
  NextResponse.json<ActionResult<never>>(
    { ok: false, status, message, code },
    { status },
  );

/**
 * `Sec-Fetch-Site` cuando el navegador lo envía; si no (Safari anterior a
 * 16.4), el `Origin` debe ser este mismo host.
 */
function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

/**
 * Sube la grabación de una respuesta (PF-87). Va por un Route Handler y no por
 * una Server Action porque estas aceptan 1 MB. El navegador no habla con la
 * API: este servidor reenvía el audio con la sesión de la cookie. La cookie es
 * `SameSite=Strict`, y además se exige que la petición venga del mismo origen.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ questionId: string }> },
) {
  if (!isSameOrigin(request)) return fail(403, "Petición no permitida.");
  const session = await getSession();
  if (!session) return fail(401, "Tu sesión terminó.");

  const { questionId } = await params;
  if (!ID_PATTERN.test(questionId)) {
    return fail(400, "La pregunta no es válida.");
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) {
    return fail(413, "El audio es demasiado largo.", "RECORDING_TOO_LARGE");
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return fail(400, "No pudimos leer el audio.");
  }
  const audio = incoming.get("audio");
  const durationMs = Math.round(Number(incoming.get("durationMs")));
  if (!(audio instanceof Blob) || audio.size === 0) {
    return fail(400, "No pudimos leer el audio.");
  }
  if (audio.size > MAX_RECORDING_BYTES) {
    return fail(413, "El audio es demasiado largo.", "RECORDING_TOO_LARGE");
  }
  if (!Number.isFinite(durationMs) || durationMs < 1) {
    return fail(400, "No pudimos leer la duración del audio.");
  }

  const form = new FormData();
  form.set("durationMs", String(Math.min(durationMs, MAX_RECORDING_MS)));
  form.set("audio", audio, "respuesta");
  const result = await callApiForm<SavedRecording>(
    `/diagnostic-sessions/current/answers/${encodeURIComponent(questionId)}/recording`,
    { session, form },
  );
  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}

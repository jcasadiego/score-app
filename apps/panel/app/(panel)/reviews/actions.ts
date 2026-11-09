"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { getToken, renewSessionIfNeeded } from "@/lib/auth/session";
import { redirectIfSessionExpired } from "@/lib/auth/expire-session";
import { ApiError } from "@/lib/api/errors";
import {
  approveReview,
  createCorrection,
  createNote,
  releaseReview,
  reopenReview,
  takeReview,
  type ApprovalBlocker,
} from "@/lib/api/reviews";
import {
  REVIEW_NOTE_BODY_MAX,
  REVIEW_NOTE_DIMENSION_MAX,
  REVIEW_REASON_MAX,
} from "@/lib/reviews/labels";

export interface ReviewActionResult {
  ok: boolean;
  error?: string;
  /** 412: otra persona cambió el caso. La pantalla recarga sin perder lo escrito. */
  stale?: boolean;
  /** 409 al aprobar: lo que falta. */
  blockers?: ApprovalBlocker[];
}

const STALE_MESSAGE =
  "Alguien más cambió el caso. Recargamos los datos: revisa los cambios e intenta de nuevo.";

async function sessionToken(): Promise<string> {
  await verifySession();
  const token = await getToken();
  if (!token) {
    throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
  }
  await renewSessionIfNeeded();
  return token;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 1e9;
}

/** Texto de una línea: sin espacios repetidos (como `NormalizeText` de la API). */
function cleanLine(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** La bandeja, la pantalla del caso y el detalle del diagnóstico. */
function refresh(diagnosticId?: string) {
  revalidatePath("/reviews", "layout");
  if (diagnosticId && isId(diagnosticId)) {
    revalidatePath(`/diagnostics/${diagnosticId}`);
  }
}

async function failure(error: unknown, fallback: string): Promise<ReviewActionResult> {
  await redirectIfSessionExpired(error);
  if (error instanceof ApiError && error.status === 412) {
    refresh();
    return { ok: false, stale: true, error: STALE_MESSAGE };
  }
  if (error instanceof ApiError && error.status === 409) {
    // Otra persona tomó, aprobó o reabrió el caso: mostrar el estado real.
    refresh();
  }
  return {
    ok: false,
    error: error instanceof ApiError ? error.message : fallback,
  };
}

/** Tomar el caso (Revisor y Aprobador). */
export async function takeReviewAction(
  reviewId: string,
): Promise<ReviewActionResult> {
  try {
    const token = await sessionToken();
    if (!isId(reviewId)) throw new ApiError(400, "Ese caso no es válido.");
    const review = await takeReview(token, reviewId);
    refresh(review.diagnostic.id);
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos tomar el caso. Intenta de nuevo.");
  }
}

/** Liberar el propio; uno ajeno solo el Aprobador (lo valida la API). */
export async function releaseReviewAction(
  reviewId: string,
): Promise<ReviewActionResult> {
  try {
    const token = await sessionToken();
    if (!isId(reviewId)) throw new ApiError(400, "Ese caso no es válido.");
    await releaseReview(token, reviewId);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos liberar el caso. Intenta de nuevo.");
  }
}

/** Corrige una respuesta: texto u opciones, con motivo. Envía If-Match. */
export async function correctAnswerAction(
  reviewId: string,
  version: number,
  diagnosticId: string,
  input: { answerId: string; text?: string; optionIds?: string[]; reason: string },
): Promise<ReviewActionResult> {
  try {
    const token = await sessionToken();
    const reason = cleanLine(input?.reason);
    const text = typeof input?.text === "string" ? input.text : undefined;
    const optionIds = Array.isArray(input?.optionIds) ? input.optionIds : undefined;
    if (
      !isId(reviewId) ||
      !isVersion(version) ||
      !isId(input?.answerId) ||
      (text === undefined) === (optionIds === undefined) ||
      (optionIds !== undefined && (optionIds.length > 100 || !optionIds.every(isId))) ||
      (text !== undefined && text.length > 20_000) ||
      !reason ||
      reason.length > REVIEW_REASON_MAX
    ) {
      throw new ApiError(400, "Revisa el valor y el motivo e intenta de nuevo.");
    }
    await createCorrection(token, reviewId, version, {
      answerId: input.answerId,
      ...(text !== undefined ? { text } : { optionIds }),
      reason,
    });
    refresh(diagnosticId);
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos guardar la corrección. Intenta de nuevo.");
  }
}

/** Nota general o por dimensión (Revisor y Aprobador). */
export async function addNoteAction(
  reviewId: string,
  body: string,
  dimension: string,
): Promise<ReviewActionResult> {
  try {
    const token = await sessionToken();
    const cleanBody = typeof body === "string" ? body.trim() : "";
    const cleanDimension = cleanLine(dimension);
    if (
      !isId(reviewId) ||
      !cleanBody ||
      cleanBody.length > REVIEW_NOTE_BODY_MAX ||
      cleanDimension.length > REVIEW_NOTE_DIMENSION_MAX
    ) {
      throw new ApiError(400, "Revisa la nota e intenta de nuevo.");
    }
    await createNote(token, reviewId, {
      body: cleanBody,
      ...(cleanDimension && { dimension: cleanDimension }),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos guardar la nota. Intenta de nuevo.");
  }
}

/** Solo el Aprobador (lo valida la API). Envía If-Match. */
export async function approveReviewAction(
  reviewId: string,
  version: number,
  diagnosticId: string,
  aiExceptionReason: string,
): Promise<ReviewActionResult> {
  try {
    const token = await sessionToken();
    const reason = cleanLine(aiExceptionReason);
    if (
      !isId(reviewId) ||
      !isVersion(version) ||
      reason.length > REVIEW_REASON_MAX
    ) {
      throw new ApiError(400, "Revisa el motivo e intenta de nuevo.");
    }
    await approveReview(token, reviewId, version, reason || undefined);
    refresh(diagnosticId);
    return { ok: true };
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === "APPROVAL_REQUIREMENTS_NOT_MET"
    ) {
      refresh();
      return {
        ok: false,
        error: "Todavía no se puede aprobar.",
        blockers: (error.errors ?? []).map(({ code, message }) => ({
          code: code ?? "",
          message,
        })),
      };
    }
    return failure(error, "No pudimos aprobar el caso. Intenta de nuevo.");
  }
}

/** Reabre la aprobación vigente con motivo (solo el Aprobador). */
export async function reopenReviewAction(
  reviewId: string,
  diagnosticId: string,
  reason: string,
): Promise<ReviewActionResult> {
  try {
    const token = await sessionToken();
    const cleanReason = cleanLine(reason);
    if (
      !isId(reviewId) ||
      !cleanReason ||
      cleanReason.length > REVIEW_REASON_MAX
    ) {
      throw new ApiError(400, "Escribe el motivo para reabrir.");
    }
    await reopenReview(token, reviewId, cleanReason);
    refresh(diagnosticId);
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos reabrir el caso. Intenta de nuevo.");
  }
}

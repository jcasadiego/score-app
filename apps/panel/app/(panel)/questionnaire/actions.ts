"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { getToken, renewSessionIfNeeded } from "@/lib/auth/session";
import { redirectIfSessionExpired } from "@/lib/auth/expire-session";
import { ApiError, type ApiFieldError } from "@/lib/api/errors";
import {
  addQuestion,
  createDraft,
  deleteQuestion,
  publishVersion,
  reorderQuestions,
  updateQuestion,
  type QuestionInput,
} from "@/lib/api/questionnaire";
import { isFamily } from "@/lib/leads/labels";
import {
  FREE_TEXT_MAX_LENGTH,
  isQuestionType,
  MAX_OPTIONS,
} from "@/lib/questionnaire/labels";

export interface QuestionnaireActionResult {
  ok: boolean;
  error?: string;
  /** Detalle por campo de la API (qué le falta a la versión o a la pregunta). */
  errors?: ApiFieldError[];
}

const PATH = "/questionnaire";

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

/**
 * Una Server Action es un endpoint público: no se confía en los tipos. Aquí
 * solo se arma la forma; las reglas (largos, opciones, códigos) las valida la
 * API, que es la que decide.
 */
function toQuestionInput(raw: unknown): QuestionInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const q = raw as Record<string, unknown>;
  if (
    typeof q.code !== "string" ||
    typeof q.text !== "string" ||
    !isQuestionType(q.type) ||
    typeof q.required !== "boolean" ||
    !Array.isArray(q.options) ||
    q.options.length > MAX_OPTIONS
  ) {
    return null;
  }
  const options = q.options.map((o) =>
    typeof o === "object" && o !== null
      ? {
          text: String((o as Record<string, unknown>).text ?? ""),
          value: String((o as Record<string, unknown>).value ?? ""),
        }
      : { text: "", value: "" },
  );
  const helpText =
    typeof q.helpText === "string" && q.helpText.trim()
      ? q.helpText.trim()
      : undefined;
  const isFreeText = q.type === "FREE_TEXT";
  const maxLength =
    isFreeText &&
    Number.isInteger(q.maxLength) &&
    (q.maxLength as number) >= 1 &&
    (q.maxLength as number) <= FREE_TEXT_MAX_LENGTH
      ? (q.maxLength as number)
      : undefined;
  return {
    code: q.code.trim(),
    text: q.text,
    type: q.type,
    helpText,
    required: q.required,
    maxLength,
    options: isFreeText ? [] : options,
  };
}

async function failure(
  error: unknown,
  fallback: string,
): Promise<QuestionnaireActionResult> {
  await redirectIfSessionExpired(error);
  if (error instanceof ApiError) {
    return { ok: false, error: error.message, errors: error.errors };
  }
  return { ok: false, error: fallback };
}

/** Solo Aprobador (lo valida la API). Copia la última versión publicada. */
export async function createDraftAction(
  family: string,
): Promise<QuestionnaireActionResult> {
  try {
    const token = await sessionToken();
    if (!isFamily(family)) throw new ApiError(400, "Esa familia no existe.");
    await createDraft(token, family);
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos crear el borrador. Intenta de nuevo.");
  }
}

/** Crea (`questionId` nulo) o reemplaza una pregunta del borrador. */
export async function saveQuestionAction(
  versionId: string,
  questionId: string | null,
  question: unknown,
): Promise<QuestionnaireActionResult> {
  try {
    const token = await sessionToken();
    const input = toQuestionInput(question);
    if (!isId(versionId) || (questionId !== null && !isId(questionId)) || !input) {
      throw new ApiError(400, "Revisa los datos de la pregunta.");
    }
    if (questionId) {
      await updateQuestion(token, versionId, questionId, input);
    } else {
      await addQuestion(token, versionId, input);
    }
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos guardar la pregunta. Intenta de nuevo.");
  }
}

export async function deleteQuestionAction(
  versionId: string,
  questionId: string,
): Promise<QuestionnaireActionResult> {
  try {
    const token = await sessionToken();
    if (!isId(versionId) || !isId(questionId)) {
      throw new ApiError(400, "Esa pregunta no es válida.");
    }
    await deleteQuestion(token, versionId, questionId);
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos quitar la pregunta. Intenta de nuevo.");
  }
}

/** Recibe todas las preguntas de la versión en el orden nuevo. */
export async function reorderQuestionsAction(
  versionId: string,
  questionIds: string[],
): Promise<QuestionnaireActionResult> {
  try {
    const token = await sessionToken();
    if (
      !isId(versionId) ||
      !Array.isArray(questionIds) ||
      questionIds.length === 0 ||
      !questionIds.every(isId)
    ) {
      throw new ApiError(400, "No pudimos leer el orden nuevo.");
    }
    await reorderQuestions(token, versionId, questionIds);
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos reordenar. Intenta de nuevo.");
  }
}

export async function publishVersionAction(
  versionId: string,
): Promise<QuestionnaireActionResult> {
  try {
    const token = await sessionToken();
    if (!isId(versionId)) throw new ApiError(400, "Esa versión no es válida.");
    await publishVersion(token, versionId);
    revalidatePath(PATH);
    revalidatePath("/diagnostics");
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos publicar la versión. Intenta de nuevo.");
  }
}

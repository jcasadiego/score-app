"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { getToken, renewSessionIfNeeded } from "@/lib/auth/session";
import { redirectIfSessionExpired } from "@/lib/auth/expire-session";
import { ApiError } from "@/lib/api/errors";
import type { ApprovalBlocker } from "@/lib/api/reviews";
import {
  approveReport,
  deliverReport,
  editSection,
  generateReport,
  listSectionRevisions,
  regenerateReport,
  regenerateSection,
  reopenReport,
  type SectionRevision,
} from "@/lib/api/reports";
import { getLead } from "@/lib/api/leads";
import {
  REPORT_REOPEN_REASON_MAX,
  REPORT_SECTION_BODY_MAX,
} from "@/lib/reports/labels";

export interface ReportActionResult {
  ok: boolean;
  error?: string;
  /** 412: otra persona cambió el informe. La pantalla recarga sin perder lo escrito. */
  stale?: boolean;
  /** 409 al entregar: lo que el caso tiene pendiente. */
  blockers?: ApprovalBlocker[];
  /** Al entregar: si fue un reenvío o la versión actualizada de una entrega anterior. */
  delivery?: { resend: boolean; updated: boolean };
}

const STALE_MESSAGE =
  "Alguien más cambió el informe. Recargamos los datos: revisa los cambios e intenta de nuevo.";

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

function assertTarget(reviewId: unknown, version?: unknown) {
  if (!isId(reviewId) || (version !== undefined && !isVersion(version))) {
    throw new ApiError(400, "Ese informe no es válido.");
  }
}

/** La pantalla del informe, la del caso y la bandeja (todas bajo /reviews). */
function refresh() {
  revalidatePath("/reviews", "layout");
}

async function failure(error: unknown, fallback: string): Promise<ReportActionResult> {
  await redirectIfSessionExpired(error);
  if (error instanceof ApiError && error.status === 412) {
    refresh();
    return { ok: false, stale: true, error: STALE_MESSAGE };
  }
  if (error instanceof ApiError && error.status === 409) {
    // El informe o el caso cambiaron de estado: mostrar el estado real.
    refresh();
  }
  return {
    ok: false,
    error: error instanceof ApiError ? error.message : fallback,
  };
}

/** Genera el borrador con IA (Revisor y Aprobador, con el caso aprobado). */
export async function generateReportAction(
  reviewId: string,
): Promise<ReportActionResult> {
  try {
    const token = await sessionToken();
    assertTarget(reviewId);
    await generateReport(token, reviewId);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos generar el borrador. Intenta de nuevo.");
  }
}

/** Vuelve a redactar todo el borrador con el resultado vigente del caso. */
export async function regenerateReportAction(
  reviewId: string,
  version: number,
): Promise<ReportActionResult> {
  try {
    const token = await sessionToken();
    assertTarget(reviewId, version);
    await regenerateReport(token, reviewId, version);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos regenerar el borrador. Intenta de nuevo.");
  }
}

/** Edita el texto de una sección. Envía If-Match. */
export async function editSectionAction(
  reviewId: string,
  sectionId: string,
  version: number,
  body: string,
): Promise<ReportActionResult> {
  try {
    const token = await sessionToken();
    assertTarget(reviewId, version);
    const clean = typeof body === "string" ? body.trim() : "";
    if (!isId(sectionId) || !clean || clean.length > REPORT_SECTION_BODY_MAX) {
      throw new ApiError(400, "Revisa el texto de la sección e intenta de nuevo.");
    }
    await editSection(token, reviewId, sectionId, version, clean);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos guardar la sección. Intenta de nuevo.");
  }
}

/** Pide a la IA que rehaga una sola sección. Envía If-Match. */
export async function regenerateSectionAction(
  reviewId: string,
  sectionId: string,
  version: number,
): Promise<ReportActionResult> {
  try {
    const token = await sessionToken();
    assertTarget(reviewId, version);
    if (!isId(sectionId)) throw new ApiError(400, "Esa sección no es válida.");
    await regenerateSection(token, reviewId, sectionId, version);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos regenerar la sección. Intenta de nuevo.");
  }
}

/** El historial de una sección (solo lectura). */
export async function sectionRevisionsAction(
  reviewId: string,
  sectionId: string,
): Promise<{ ok: true; revisions: SectionRevision[] } | { ok: false; error: string }> {
  try {
    const token = await sessionToken();
    assertTarget(reviewId);
    if (!isId(sectionId)) throw new ApiError(400, "Esa sección no es válida.");
    return { ok: true, revisions: await listSectionRevisions(token, reviewId, sectionId) };
  } catch (error) {
    const result = await failure(error, "No pudimos cargar el historial. Intenta de nuevo.");
    return { ok: false, error: result.error ?? "No pudimos cargar el historial." };
  }
}

/** Solo el Aprobador (lo valida la API). Envía If-Match. */
export async function approveReportAction(
  reviewId: string,
  version: number,
): Promise<ReportActionResult> {
  try {
    const token = await sessionToken();
    assertTarget(reviewId, version);
    await approveReport(token, reviewId, version);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos aprobar el informe. Intenta de nuevo.");
  }
}

/** Devuelve a borrador un informe aprobado y sin entregar, con motivo (solo el Aprobador). */
export async function reopenReportAction(
  reviewId: string,
  version: number,
  reason: string,
): Promise<ReportActionResult> {
  try {
    const token = await sessionToken();
    assertTarget(reviewId, version);
    const clean = typeof reason === "string" ? reason.trim().replace(/\s+/g, " ") : "";
    if (!clean || clean.length > REPORT_REOPEN_REASON_MAX) {
      throw new ApiError(400, "Escribe el motivo para reabrir el informe.");
    }
    await reopenReport(token, reviewId, version, clean);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "No pudimos reabrir el informe. Intenta de nuevo.");
  }
}

/** Entrega el informe o reenvía el enlace (solo el Aprobador). Envía If-Match. */
export async function deliverReportAction(
  reviewId: string,
  version: number,
): Promise<ReportActionResult> {
  try {
    const token = await sessionToken();
    assertTarget(reviewId, version);
    const { resend, updated } = await deliverReport(token, reviewId, version);
    refresh();
    return { ok: true, delivery: { resend, updated } };
  } catch (error) {
    if (error instanceof ApiError && error.code === "REPORT_DELIVERY_BLOCKED") {
      refresh();
      return {
        ok: false,
        error: "El caso tiene pendientes: el informe no se puede enviar.",
        blockers: (error.errors ?? []).map(({ code, message }) => ({
          code: code ?? "",
          message,
        })),
      };
    }
    return failure(error, "No pudimos enviar el informe. Intenta de nuevo.");
  }
}

/**
 * A quién sale el informe, para confirmarlo antes de entregar (solo el
 * Aprobador ve ese paso). Se pide al abrir la confirmación y no con la
 * pantalla: el correo no viaja a quien no lo necesita.
 */
export async function deliveryRecipientAction(
  leadId: string,
): Promise<{ ok: true; name: string; email: string } | { ok: false; error: string }> {
  try {
    const session = await verifySession();
    if (session.role !== "ADMIN") throw new ApiError(403, "No tienes permiso para hacer esto.");
    const token = await sessionToken();
    if (!isId(leadId)) throw new ApiError(400, "Ese cliente no es válido.");
    const { name, email } = await getLead(token, leadId);
    return { ok: true, name, email };
  } catch (error) {
    const result = await failure(error, "No pudimos cargar el correo del cliente.");
    return { ok: false, error: result.error ?? "No pudimos cargar el correo del cliente." };
  }
}

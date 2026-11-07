"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { getToken, renewSessionIfNeeded } from "@/lib/auth/session";
import { redirectIfSessionExpired } from "@/lib/auth/expire-session";
import { ApiError } from "@/lib/api/errors";
import {
  createDiagnostic,
  resendAccessLink,
  type IssuedLink,
} from "@/lib/api/diagnostics";
import { getLead, listLeads } from "@/lib/api/leads";
import {
  CREATION_REASON_MAX,
  CREATION_REASON_MIN,
} from "@/lib/diagnostics/labels";

/**
 * El enlace solo viaja en la respuesta de la acción, al navegador que la pidió:
 * no se guarda en la URL, en logs ni en el servidor.
 */
export interface IssuedLinkResult {
  ok: boolean;
  error?: string;
  diagnosticId?: string;
  link?: IssuedLink;
  /** Si el lead ya tenía diagnóstico, cuál es, para ofrecer abrirlo. */
  existingDiagnosticId?: string;
}

export interface LeadOption {
  id: string;
  name: string;
  email: string;
  diagnosticId: string | null;
}

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

/** Solo Aprobador (lo valida la API): sin pago, con motivo. */
export async function createDiagnosticAction(
  leadId: string,
  reason: string,
): Promise<IssuedLinkResult> {
  let token: string | undefined;
  try {
    token = await sessionToken();
    // Una Server Action es un endpoint público: no confiar en los tipos.
    const cleanReason =
      typeof reason === "string" ? reason.trim().replace(/\s+/g, " ") : "";
    if (
      !isId(leadId) ||
      cleanReason.length < CREATION_REASON_MIN ||
      cleanReason.length > CREATION_REASON_MAX
    ) {
      throw new ApiError(400, "Revisa el lead y el motivo e intenta de nuevo.");
    }
    const created = await createDiagnostic(token, leadId, cleanReason);
    revalidatePath("/diagnostics");
    revalidatePath("/leads");
    return {
      ok: true,
      diagnosticId: created.id,
      link: { accessLink: created.accessLink, emailSent: created.emailSent },
    };
  } catch (error) {
    await redirectIfSessionExpired(error);
    if (
      error instanceof ApiError &&
      error.code === "DIAGNOSTIC_ALREADY_EXISTS" &&
      token
    ) {
      const lead = await getLead(token, leadId).catch(() => null);
      revalidatePath("/leads");
      return {
        ok: false,
        error: "Este lead ya tiene un diagnóstico.",
        existingDiagnosticId: lead?.diagnostic?.id,
      };
    }
    return {
      ok: false,
      error:
        error instanceof ApiError
          ? error.message
          : "No pudimos generar el diagnóstico. Intenta de nuevo.",
    };
  }
}

/** Revoca los enlaces vigentes y envía uno nuevo (Revisor y Aprobador). */
export async function resendAccessLinkAction(
  diagnosticId: string,
): Promise<IssuedLinkResult> {
  try {
    const token = await sessionToken();
    if (!isId(diagnosticId)) {
      throw new ApiError(400, "Ese diagnóstico no es válido.");
    }
    const link = await resendAccessLink(token, diagnosticId);
    revalidatePath(`/diagnostics/${diagnosticId}`);
    revalidatePath("/diagnostics");
    return { ok: true, diagnosticId, link };
  } catch (error) {
    await redirectIfSessionExpired(error);
    return {
      ok: false,
      error:
        error instanceof ApiError
          ? error.message
          : "No pudimos reenviar el enlace. Intenta de nuevo.",
    };
  }
}

/** Para elegir el lead al generar desde la pantalla de diagnósticos. */
export async function searchLeadsAction(
  query: string,
): Promise<{ ok: boolean; leads: LeadOption[]; error?: string }> {
  try {
    const token = await sessionToken();
    const search =
      typeof query === "string" ? query.trim().slice(0, 100) : "";
    const { data } = await listLeads(token, {
      page: 1,
      pageSize: 10,
      search: search || undefined,
    });
    return {
      ok: true,
      leads: data.map((lead) => ({
        id: lead.id,
        name: lead.name,
        email: lead.email,
        diagnosticId: lead.diagnostic?.id ?? null,
      })),
    };
  } catch (error) {
    await redirectIfSessionExpired(error);
    return {
      ok: false,
      leads: [],
      error:
        error instanceof ApiError
          ? error.message
          : "No pudimos buscar leads. Intenta de nuevo.",
    };
  }
}

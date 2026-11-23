"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { getToken, renewSessionIfNeeded } from "@/lib/auth/session";
import { redirectIfSessionExpired } from "@/lib/auth/expire-session";
import { ApiError } from "@/lib/api/errors";
import { retryCrmSyncEvent } from "@/lib/api/crm";

export interface RetryCrmResult {
  ok: boolean;
  error?: string;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

/**
 * Vuelve a poner en cola un envío fallido al CRM. Ambos roles pueden (CLAUDE.md
 * 5.3); la API lo valida igual. Con 404 o 409 el envío cambió desde que se
 * cargó la pantalla: se recarga para mostrar su estado real.
 */
export async function retryCrmSyncEventAction(
  leadId: string,
  eventId: string,
): Promise<RetryCrmResult> {
  try {
    await verifySession();
    const token = await getToken();
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    await renewSessionIfNeeded();
    // Una Server Action es un endpoint público: no confiar en los tipos.
    if (!isId(leadId) || !isId(eventId)) {
      throw new ApiError(400, "No pudimos identificar el envío.");
    }
    await retryCrmSyncEvent(token, leadId, eventId);
    revalidatePath("/leads");
    return { ok: true };
  } catch (error) {
    await redirectIfSessionExpired(error);
    if (!(error instanceof ApiError)) {
      return { ok: false, error: "No pudimos reintentar el envío. Intenta de nuevo." };
    }
    if (error.status === 409 || error.status === 404) {
      revalidatePath("/leads");
      return {
        ok: false,
        error:
          error.status === 409
            ? "Este envío ya se está procesando."
            : "Este envío ya no existe.",
      };
    }
    return { ok: false, error: error.message };
  }
}

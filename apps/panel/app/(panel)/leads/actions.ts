"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import { redirectIfSessionExpired } from "@/lib/auth/expire-session";
import { ApiError } from "@/lib/api/errors";
import { updateLeadStatus, type Lead } from "@/lib/api/leads";
import { isLeadStatus, type LeadStatus } from "@/lib/leads/labels";

export interface LeadActionResult {
  ok: boolean;
  error?: string;
  lead?: Lead;
}

export async function updateLeadStatusAction(
  id: string,
  status: LeadStatus,
): Promise<LeadActionResult> {
  try {
    await verifySession();
    const token = await getToken();
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    // Una Server Action es un endpoint público: no confiar en el tipo.
    if (!isLeadStatus(status)) {
      throw new ApiError(400, "Ese estado no es válido.");
    }
    const lead = await updateLeadStatus(token, id, status);
    revalidatePath("/leads");
    return { ok: true, lead };
  } catch (error) {
    await redirectIfSessionExpired(error);
    const message =
      error instanceof ApiError
        ? error.message
        : "No pudimos cambiar el estado. Intenta de nuevo.";
    return { ok: false, error: message };
  }
}

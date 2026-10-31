"use server";

import { revalidatePath } from "next/cache";
import { verificarSesion } from "@/lib/auth/dal";
import { obtenerToken } from "@/lib/auth/session";
import { ErrorApi } from "@/lib/api/errors";
import { cambiarEstadoLead, type Lead } from "@/lib/api/leads";
import { esEstadoLead, type EstadoLead } from "@/lib/leads/etiquetas";

export interface ResultadoAccionLead {
  ok: boolean;
  error?: string;
  lead?: Lead;
}

export async function accionCambiarEstadoLead(
  id: string,
  estado: EstadoLead,
): Promise<ResultadoAccionLead> {
  try {
    await verificarSesion();
    const token = await obtenerToken();
    if (!token) {
      throw new ErrorApi(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    // Una Server Action es un endpoint público: no confiar en el tipo.
    if (!esEstadoLead(estado)) {
      throw new ErrorApi(400, "Ese estado no es válido.");
    }
    const lead = await cambiarEstadoLead(token, id, estado);
    revalidatePath("/leads");
    return { ok: true, lead };
  } catch (error) {
    const mensaje =
      error instanceof ErrorApi
        ? error.message
        : "No pudimos cambiar el estado. Intenta de nuevo.";
    return { ok: false, error: mensaje };
  }
}

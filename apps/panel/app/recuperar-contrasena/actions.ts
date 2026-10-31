"use server";

import { solicitarRecuperacion } from "@/lib/api/recuperacion";
import { ErrorApi } from "@/lib/api/errors";

export interface ResultadoSolicitud {
  ok: boolean;
  error?: string;
}

export async function accionSolicitarRecuperacion(
  email: string,
): Promise<ResultadoSolicitud> {
  const limpio = email.trim();
  if (!limpio) {
    return { ok: false, error: "Ingresa tu correo." };
  }

  try {
    await solicitarRecuperacion(limpio);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ErrorApi
          ? error.message
          : "Ocurrió un error inesperado. Intenta de nuevo en unos minutos.",
    };
  }
}

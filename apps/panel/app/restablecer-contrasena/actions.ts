"use server";

import { redirect } from "next/navigation";
import {
  restablecerContrasena,
  STATUS_ENLACE_INVALIDO,
} from "@/lib/api/recuperacion";
import { ErrorApi } from "@/lib/api/errors";
import { eliminarSesion } from "@/lib/auth/session";

export interface ResultadoRestablecer {
  error: string;
  enlaceInvalido?: boolean;
}

export async function accionRestablecerContrasena(
  token: string,
  password: string,
): Promise<ResultadoRestablecer> {
  try {
    await restablecerContrasena(token, password);
  } catch (error) {
    if (error instanceof ErrorApi) {
      return {
        error: error.message,
        enlaceInvalido: error.status === STATUS_ENLACE_INVALIDO,
      };
    }
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }

  // La API ya cerró todas las sesiones de la cuenta; si este navegador
  // tenía una abierta, se borra también la cookie.
  await eliminarSesion();
  redirect("/login?contrasena=restablecida");
}

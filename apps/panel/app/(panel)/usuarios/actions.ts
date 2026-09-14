"use server";

import { revalidatePath } from "next/cache";
import { verificarSesion } from "@/lib/auth/dal";
import { obtenerToken } from "@/lib/auth/session";
import { ErrorApi } from "@/lib/api/errors";
import {
  actualizarUsuario,
  activarUsuario,
  crearUsuario,
  desactivarUsuario,
  type DatosActualizarUsuario,
  type DatosCrearUsuario,
  type Usuario,
} from "@/lib/api/usuarios";

export interface ResultadoAccionUsuario {
  ok: boolean;
  error?: string;
  usuario?: Usuario;
}

/**
 * `verificarSesion` exige sesión activa (redirige si no la hay) y
 * `obtenerToken` da el JWT crudo para llamar a la API como Bearer — la
 * cookie es httpOnly, así que esto solo puede pasar por una Server Action.
 */
async function tokenAutenticado(): Promise<string> {
  await verificarSesion();
  const token = await obtenerToken();
  if (!token) {
    throw new ErrorApi(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
  }
  return token;
}

function manejarError(error: unknown): ResultadoAccionUsuario {
  const mensaje =
    error instanceof ErrorApi
      ? error.message
      : "Ocurrió un error inesperado. Intenta de nuevo.";
  return { ok: false, error: mensaje };
}

export async function accionCrearUsuario(
  datos: DatosCrearUsuario,
): Promise<ResultadoAccionUsuario> {
  try {
    const token = await tokenAutenticado();
    const usuario = await crearUsuario(token, datos);
    revalidatePath("/usuarios");
    return { ok: true, usuario };
  } catch (error) {
    return manejarError(error);
  }
}

export async function accionActualizarUsuario(
  id: string,
  datos: DatosActualizarUsuario,
): Promise<ResultadoAccionUsuario> {
  try {
    const token = await tokenAutenticado();
    const usuario = await actualizarUsuario(token, id, datos);
    revalidatePath("/usuarios");
    return { ok: true, usuario };
  } catch (error) {
    return manejarError(error);
  }
}

export async function accionActivarUsuario(
  id: string,
): Promise<ResultadoAccionUsuario> {
  try {
    const token = await tokenAutenticado();
    const usuario = await activarUsuario(token, id);
    revalidatePath("/usuarios");
    return { ok: true, usuario };
  } catch (error) {
    return manejarError(error);
  }
}

export async function accionDesactivarUsuario(
  id: string,
): Promise<ResultadoAccionUsuario> {
  try {
    const token = await tokenAutenticado();
    const usuario = await desactivarUsuario(token, id);
    revalidatePath("/usuarios");
    return { ok: true, usuario };
  } catch (error) {
    return manejarError(error);
  }
}

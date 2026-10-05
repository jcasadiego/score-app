import "server-only";
import { cookies } from "next/headers";
import { NOMBRE_COOKIE_SESION } from "./constants";
import { decodificarToken, type PayloadSesion } from "./jwt";

export async function crearSesion(accessToken: string): Promise<void> {
  const payload = decodificarToken(accessToken);
  const cookieStore = await cookies();

  cookieStore.set(NOMBRE_COOKIE_SESION, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: payload ? new Date(payload.exp * 1000) : undefined,
  });
}

export async function eliminarSesion(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(NOMBRE_COOKIE_SESION);
}

export async function obtenerSesion(): Promise<PayloadSesion | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(NOMBRE_COOKIE_SESION)?.value;
  if (!token) return null;

  const payload = decodificarToken(token);
  if (!payload || payload.exp * 1000 <= Date.now()) return null;

  return payload;
}

/**
 * Token crudo de la cookie de sesión, para usarlo como Bearer al llamar a
 * la API desde el servidor. Se usa junto a `verificarSesion` (que ya
 * exige sesión activa) en las Server Actions que llaman a endpoints
 * protegidos.
 */
export async function obtenerToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(NOMBRE_COOKIE_SESION)?.value ?? null;
}

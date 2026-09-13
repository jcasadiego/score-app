import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { obtenerSesion } from "./session";
import type { PayloadSesion } from "./jwt";

/**
 * Punto único para exigir sesión activa en Server Components, Route
 * Handlers y Server Actions del panel. `cache()` evita repetir la lectura
 * de cookies si se llama varias veces durante el mismo render.
 */
export const verificarSesion = cache(async (): Promise<PayloadSesion> => {
  const sesion = await obtenerSesion();
  if (!sesion) {
    redirect("/login");
  }
  return sesion;
});

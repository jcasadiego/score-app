import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession } from "./session";
import type { SessionPayload } from "./jwt";

/**
 * Punto único para exigir sesión activa en Server Components, Route
 * Handlers y Server Actions del panel. `cache()` evita repetir la lectura
 * de cookies si se llama varias veces durante el mismo render.
 */
export const verifySession = cache(async (): Promise<SessionPayload> => {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
});

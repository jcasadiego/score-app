import "server-only";
import { redirect, unstable_rethrow } from "next/navigation";
import { ApiError } from "@/lib/api/errors";
import { deleteSession } from "./session";

/**
 * Para el `catch` de una Server Action: si la API rechazó el token, borra
 * la cookie y manda al login. Cualquier otro error sigue su curso.
 *
 * `unstable_rethrow` deja pasar el `redirect` de `verifySession`, que se llama
 * dentro del mismo `try` y si no acabaría como un error genérico.
 */
export async function redirectIfSessionExpired(error: unknown): Promise<void> {
  unstable_rethrow(error);
  if (error instanceof ApiError && error.status === 401) {
    await deleteSession();
    redirect("/login?notice=session-expired");
  }
}

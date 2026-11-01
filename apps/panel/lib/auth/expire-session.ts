import "server-only";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api/errors";
import { deleteSession } from "./session";

/**
 * Para el `catch` de una Server Action: si la API rechazó el token, borra
 * la cookie y manda al login. Cualquier otro error sigue su curso.
 */
export async function redirectIfSessionExpired(error: unknown): Promise<void> {
  if (error instanceof ApiError && error.status === 401) {
    await deleteSession();
    redirect("/login?notice=session-expired");
  }
}

import "server-only";
import { cookies } from "next/headers";

const SESSION_COOKIE_NAME = "score_diagnostic_session";

/**
 * La sesión del cliente vive solo en esta cookie: `httpOnly` (JavaScript no la
 * lee), `Secure` en producción y `SameSite=Strict`. Vence cuando vence la
 * sesión de la API.
 */
export async function saveSession(token: string, expiresAt: string) {
  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function getSession(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}

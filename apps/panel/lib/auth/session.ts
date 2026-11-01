import "server-only";
import { cookies } from "next/headers";
import { refreshAccessToken } from "@/lib/api/auth";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "./constants";
import { decodeToken, shouldRenew, type SessionPayload } from "./jwt";

export async function createSession(accessToken: string): Promise<void> {
  const payload = decodeToken(accessToken);
  const cookieStore = await cookies();

  cookieStore.set(
    SESSION_COOKIE_NAME,
    accessToken,
    sessionCookieOptions(payload?.exp),
  );
}

/**
 * Renueva la sesión desde una Server Action. `proxy.ts` no lo hace en esas
 * peticiones, y quien solo guarda formularios también está usando el panel.
 */
export async function renewSessionIfNeeded(): Promise<void> {
  const token = await getToken();
  const session = token ? decodeToken(token) : null;
  if (!token || !session || !shouldRenew(session)) return;

  const freshToken = await refreshAccessToken(token);
  if (freshToken) await createSession(freshToken);
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = decodeToken(token);
  if (!payload || payload.exp * 1000 <= Date.now()) return null;

  return payload;
}

/**
 * Token crudo de la cookie de sesión, para usarlo como Bearer al llamar a
 * la API desde el servidor. Se usa junto a `verifySession` (que ya
 * exige sesión activa) en las Server Actions que llaman a endpoints
 * protegidos.
 */
export async function getToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

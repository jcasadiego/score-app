import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "./constants";
import { decodeToken, type SessionPayload } from "./jwt";

export async function createSession(accessToken: string): Promise<void> {
  const payload = decodeToken(accessToken);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: payload ? new Date(payload.exp * 1000) : undefined,
  });
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

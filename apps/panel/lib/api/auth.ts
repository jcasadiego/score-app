import "server-only";
import { clientIpHeaders } from "./client-ip";
import { ApiError } from "./errors";

const GENERIC_ERROR_MESSAGE =
  "No pudimos iniciar sesión. Intenta de nuevo en unos minutos.";

/** Quien navega o cierra sesión no debe quedar esperando por la API. */
const SESSION_CALL_TIMEOUT_MS = 3_000;

/**
 * Pide un token nuevo con `POST /auth/refresh`. Devuelve `null` si no se pudo:
 * el token actual sigue siendo válido, así que se reintenta en la siguiente
 * petición, y un token revocado ya lo resuelve la pantalla con su 401.
 */
export async function refreshAccessToken(
  token: string,
): Promise<string | null> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(SESSION_CALL_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { accessToken?: string };
    return body.accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Revoca la sesión en la API con `POST /auth/logout`. Si la API no responde, el
 * logout sigue su curso y el token vale hasta vencer; un 401 significa que ya
 * no valía, así que no hay nada que avisar.
 */
export async function revokeSession(token: string): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(SESSION_CALL_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 401) {
      console.error(`No se pudo revocar la sesión: ${response.status}`);
    }
  } catch {
    console.error("No se pudo revocar la sesión: la API no respondió");
  }
}

/**
 * `true` solo si la API rechaza el token con un 401. Ante cualquier otra
 * respuesta o un fallo de red, no hay certeza de que la sesión esté perdida.
 */
export async function isTokenRejected(token: string): Promise<boolean> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(SESSION_CALL_TIMEOUT_MS),
    });
    return response.status === 401;
  } catch {
    return false;
  }
}

/**
 * Llama a `POST /auth/login` de la API desde el servidor (nunca desde el
 * navegador), para no exponer el token al cliente antes de guardarlo en
 * la cookie httpOnly de sesión.
 *
 * La API responde 401 con el mismo mensaje genérico tanto si el email no
 * existe, el password es incorrecto, o la cuenta está desactivada — es
 * intencional (evita delatar el estado de una cuenta), así que aquí no
 * se puede ni se debe distinguir esos casos.
 */
export async function login(
  email: string,
  password: string,
): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await clientIpHeaders()),
      },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.",
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError(401, "Correo o contraseña incorrectos.");
    }
    if (response.status === 429) {
      throw new ApiError(
        429,
        "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
      );
    }
    throw new ApiError(response.status, GENERIC_ERROR_MESSAGE);
  }

  const body = (await response.json().catch(() => null)) as {
    accessToken?: string;
  } | null;

  if (!body?.accessToken) {
    throw new ApiError(500, GENERIC_ERROR_MESSAGE);
  }

  return body.accessToken;
}

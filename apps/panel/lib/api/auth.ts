import "server-only";
import { clientIpHeaders } from "./client-ip";
import { ApiError } from "./errors";

const GENERIC_ERROR_MESSAGE =
  "Hubo un problema en el servidor y no pudimos iniciar sesión. Intenta de nuevo en unos minutos.";

const API_STARTING_MESSAGE =
  "El servidor está iniciando. Intenta de nuevo en un minuto.";

export const CHALLENGE_EXPIRED_MESSAGE =
  "Pasó demasiado tiempo. Vuelve a iniciar sesión.";

/** Lo que devuelve la contraseña correcta: todavía no abre sesión. */
export interface LoginChallenge {
  mfaToken: string;
  mfaStatus: "CHALLENGE_REQUIRED" | "ENROLLMENT_REQUIRED";
}

export interface MfaEnrollment {
  secret: string;
  otpauthUri: string;
}

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
): Promise<LoginChallenge> {
  const response = await postAuth("login", { email, password });

  if (!response.ok) {
    // 400: el correo no tiene formato válido. Para quien escribe es lo mismo.
    if (response.status === 401 || response.status === 400) {
      throw new ApiError(401, "Correo o contraseña incorrectos.");
    }
    throw await authError(response);
  }

  const body = await readBody<LoginChallenge>(response);
  if (!body?.mfaToken || !body.mfaStatus) {
    logUnexpected(response);
    throw new ApiError(500, GENERIC_ERROR_MESSAGE);
  }
  return body;
}

/** Empieza la configuración del autenticador: entrega el secreto una sola vez. */
export async function startMfaEnrollment(
  mfaToken: string,
): Promise<MfaEnrollment> {
  const response = await postAuth("mfa/enrollment", { mfaToken });
  if (!response.ok) throw await authError(response);

  const body = await readBody<MfaEnrollment>(response);
  if (!body?.secret || !body.otpauthUri) {
    throw new ApiError(500, GENERIC_ERROR_MESSAGE);
  }
  return body;
}

export async function confirmMfaEnrollment(
  mfaToken: string,
  code: string,
): Promise<{ accessToken: string; recoveryCodes: string[] }> {
  const response = await postAuth("mfa/enrollment/confirmation", {
    mfaToken,
    code,
  });
  if (!response.ok) throw await authError(response);

  const body = await readBody<{
    accessToken: string;
    recoveryCodes: string[];
  }>(response);
  if (!body?.accessToken || !body.recoveryCodes) {
    throw new ApiError(500, GENERIC_ERROR_MESSAGE);
  }
  return body;
}

export async function verifyMfa(
  mfaToken: string,
  credential: { code: string } | { recoveryCode: string },
): Promise<string> {
  const path = "code" in credential ? "mfa/verification" : "mfa/recovery";
  const response = await postAuth(path, { mfaToken, ...credential });
  if (!response.ok) throw await authError(response);

  const body = await readBody<{ accessToken: string }>(response);
  if (!body?.accessToken) throw new ApiError(500, GENERIC_ERROR_MESSAGE);
  return body.accessToken;
}

/**
 * Las rutas del acceso se llaman desde el servidor, nunca desde el navegador:
 * los tokens solo llegan al cliente dentro de una cookie httpOnly. La IP va para
 * que el límite de intentos cuente por persona, y no por servidor del panel.
 */
async function postAuth(path: string, body: object): Promise<Response> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
  try {
    return await fetch(`${baseUrl}/api/v1/auth/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await clientIpHeaders()),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.",
    );
  }
}

function readBody<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null) as Promise<T | null>;
}

async function authError(response: Response): Promise<ApiError> {
  if (response.status === 502 || response.status === 503) {
    // En QA (instancias gratuitas) la API se duerme y tarda cerca de un minuto
    // en despertar; mientras tanto la plataforma responde 502/503.
    return new ApiError(response.status, API_STARTING_MESSAGE);
  }
  if (response.status === 429) {
    return new ApiError(
      429,
      "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
    );
  }
  const body = await readBody<{ code?: string }>(response);
  if (body?.code === "INVALID_MFA_CODE") {
    return new ApiError(401, "El código no es válido.");
  }
  if (body?.code === "MFA_CHALLENGE_EXPIRED") {
    return new ApiError(401, CHALLENGE_EXPIRED_MESSAGE);
  }
  logUnexpected(response);
  return new ApiError(response.status, GENERIC_ERROR_MESSAGE);
}

/**
 * Deja en el log del servidor qué respondió la API cuando no es un caso
 * conocido, para poder diagnosticarlo. Solo la ruta y el estado: nunca el
 * cuerpo, que puede traer datos de la persona.
 */
function logUnexpected(response: Response): void {
  const path = new URL(response.url).pathname;
  console.error(
    `Respuesta inesperada de la API: ${response.status} en ${path}`,
  );
}

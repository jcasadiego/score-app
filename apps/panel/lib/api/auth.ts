import "server-only";
import { ApiError } from "./errors";

const GENERIC_ERROR_MESSAGE =
  "No pudimos iniciar sesión. Intenta de nuevo en unos minutos.";

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
      headers: { "Content-Type": "application/json" },
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

import "server-only";
import { ErrorApi } from "./errors";

const MENSAJE_ERROR_GENERICO =
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
export async function iniciarSesion(
  email: string,
  password: string,
): Promise<string> {
  const urlBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

  let respuesta: Response;
  try {
    respuesta = await fetch(`${urlBase}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    throw new ErrorApi(
      0,
      "No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.",
    );
  }

  if (!respuesta.ok) {
    if (respuesta.status === 401) {
      throw new ErrorApi(401, "Correo o contraseña incorrectos.");
    }
    if (respuesta.status === 429) {
      throw new ErrorApi(
        429,
        "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
      );
    }
    throw new ErrorApi(respuesta.status, MENSAJE_ERROR_GENERICO);
  }

  const cuerpo = (await respuesta.json().catch(() => null)) as {
    accessToken?: string;
  } | null;

  if (!cuerpo?.accessToken) {
    throw new ErrorApi(500, MENSAJE_ERROR_GENERICO);
  }

  return cuerpo.accessToken;
}

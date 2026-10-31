import "server-only";
import { ErrorApi } from "./errors";

const MENSAJE_ERROR_GENERICO =
  "Ocurrió un error inesperado. Intenta de nuevo en unos minutos.";

/** Status propio (no HTTP) para distinguir el enlace inválido en la UI. */
export const STATUS_ENLACE_INVALIDO = 4001;

function urlBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
}

async function postPublico(path: string, cuerpo: unknown): Promise<Response> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${urlBase()}/api/v1/auth/password-reset${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      cache: "no-store",
    });
  } catch {
    throw new ErrorApi(
      0,
      "No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.",
    );
  }

  if (respuesta.status === 429) {
    throw new ErrorApi(
      429,
      "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
    );
  }
  return respuesta;
}

/**
 * La API responde lo mismo exista o no el correo, así que aquí tampoco
 * hay nada que distinguir: si no hubo error, se muestra el mismo aviso.
 */
export async function solicitarRecuperacion(email: string): Promise<void> {
  const respuesta = await postPublico("/request", { email });
  if (!respuesta.ok) {
    throw new ErrorApi(respuesta.status, MENSAJE_ERROR_GENERICO);
  }
}

export async function restablecerContrasena(
  token: string,
  password: string,
): Promise<void> {
  const respuesta = await postPublico("/confirm", { token, password });
  if (respuesta.ok) return;

  if (respuesta.status === 400) {
    const body = (await respuesta.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    // Enlace inválido, usado o vencido llega como un único mensaje; los
    // errores de validación del body (ValidationPipe) llegan como lista.
    if (typeof body?.message === "string") {
      throw new ErrorApi(STATUS_ENLACE_INVALIDO, body.message);
    }
    throw new ErrorApi(
      400,
      "La contraseña no cumple las reglas. Revísala e intenta de nuevo.",
    );
  }

  throw new ErrorApi(respuesta.status, MENSAJE_ERROR_GENERICO);
}

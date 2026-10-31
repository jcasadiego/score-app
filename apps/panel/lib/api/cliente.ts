import "server-only";
import { ErrorApi } from "./errors";

const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo.";

/** Mensajes propios de cada recurso para los códigos que los necesitan. */
export interface MensajesRecurso {
  noEncontrado: string;
  conflicto?: string;
}

function urlBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
}

/**
 * Llama a la API con el JWT de la sesión como Bearer. Solo desde el
 * servidor (Server Components y Server Actions): la cookie es httpOnly.
 */
export async function llamarApi<T>(
  token: string,
  path: string,
  mensajes: MensajesRecurso,
  init?: RequestInit,
): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${urlBase()}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ErrorApi(
      0,
      "No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.",
    );
  }

  if (!respuesta.ok) {
    throw await construirError(respuesta, mensajes);
  }

  if (respuesta.status === 204) {
    return undefined as T;
  }

  return (await respuesta.json()) as T;
}

async function construirError(
  respuesta: Response,
  mensajes: MensajesRecurso,
): Promise<ErrorApi> {
  // Forma de error estándar de la api: `{ statusCode, message, error }`;
  // `message` es un texto o, si es de validación, una lista.
  const body = (await respuesta.json().catch(() => null)) as {
    message?: string | string[];
  } | null;
  const mensaje = Array.isArray(body?.message)
    ? body.message[0]
    : body?.message;

  if (respuesta.status === 409) {
    return new ErrorApi(409, mensaje ?? mensajes.conflicto ?? MENSAJE_ERROR_GENERICO);
  }
  if (respuesta.status === 404) {
    return new ErrorApi(404, mensajes.noEncontrado);
  }
  if (respuesta.status === 401 || respuesta.status === 403) {
    return new ErrorApi(
      respuesta.status,
      "No tienes permiso para hacer esto, o tu sesión expiró.",
    );
  }
  if (respuesta.status === 400) {
    return new ErrorApi(400, "Revisa los datos ingresados e intenta de nuevo.");
  }

  return new ErrorApi(respuesta.status, MENSAJE_ERROR_GENERICO);
}

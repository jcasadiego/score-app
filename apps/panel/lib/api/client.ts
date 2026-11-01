import "server-only";
import { ApiError } from "./errors";

const GENERIC_ERROR_MESSAGE = "Ocurrió un error inesperado. Intenta de nuevo.";

/** Mensajes propios de cada recurso para los códigos que los necesitan. */
export interface ResourceMessages {
  notFound: string;
  conflict?: string;
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
}

/**
 * Llama a la API con el JWT de la sesión como Bearer. Solo desde el
 * servidor (Server Components y Server Actions): la cookie es httpOnly.
 */
export async function callApi<T>(
  token: string,
  path: string,
  messages: ResourceMessages,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.",
    );
  }

  if (!response.ok) {
    throw await buildError(response, messages);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function buildError(
  response: Response,
  messages: ResourceMessages,
): Promise<ApiError> {
  // Forma de error estándar de la api: `{ statusCode, message, error }`;
  // `message` es un texto o, si es de validación, una lista.
  const body = (await response.json().catch(() => null)) as {
    message?: string | string[];
  } | null;
  const message = Array.isArray(body?.message)
    ? body.message[0]
    : body?.message;

  if (response.status === 409) {
    return new ApiError(409, message ?? messages.conflict ?? GENERIC_ERROR_MESSAGE);
  }
  if (response.status === 404) {
    return new ApiError(404, messages.notFound);
  }
  if (response.status === 401 || response.status === 403) {
    return new ApiError(
      response.status,
      "No tienes permiso para hacer esto, o tu sesión expiró.",
    );
  }
  if (response.status === 400) {
    return new ApiError(400, "Revisa los datos ingresados e intenta de nuevo.");
  }

  return new ApiError(response.status, GENERIC_ERROR_MESSAGE);
}

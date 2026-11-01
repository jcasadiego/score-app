import "server-only";
import { clientIpHeaders } from "./client-ip";
import { ApiError } from "./errors";

const GENERIC_ERROR_MESSAGE =
  "Ocurrió un error inesperado. Intenta de nuevo en unos minutos.";

/** Status propio (no HTTP) para distinguir el enlace inválido en la UI. */
export const INVALID_LINK_STATUS = 4001;

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
}

async function postPublic(path: string, body: unknown): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/api/v1/auth/password-reset${path}`, {
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

  if (response.status === 429) {
    throw new ApiError(
      429,
      "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
    );
  }
  return response;
}

/**
 * La API responde lo mismo exista o no el correo, así que aquí tampoco
 * hay nada que distinguir: si no hubo error, se muestra el mismo aviso.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const response = await postPublic("/request", { email });
  if (!response.ok) {
    throw new ApiError(response.status, GENERIC_ERROR_MESSAGE);
  }
}

export async function confirmPasswordReset(
  token: string,
  password: string,
): Promise<void> {
  const response = await postPublic("/confirm", { token, password });
  if (response.ok) return;

  if (response.status === 400) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    // Enlace inválido, usado o vencido llega como un único mensaje; los
    // errores de validación del body (ValidationPipe) llegan como lista.
    if (typeof body?.message === "string") {
      throw new ApiError(INVALID_LINK_STATUS, body.message);
    }
    throw new ApiError(
      400,
      "La contraseña no cumple las reglas. Revísala e intenta de nuevo.",
    );
  }

  throw new ApiError(response.status, GENERIC_ERROR_MESSAGE);
}

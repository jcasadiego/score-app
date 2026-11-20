/** Un error de un campo, de la extensión `errors` de RFC 9457. */
export interface ApiFieldError {
  field?: string;
  code?: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** `code` estable de la API (RFC 9457, `api/docs/errores.md`), si vino. */
    public readonly code?: string,
    /** Detalle por campo (`errors`), si vino. */
    public readonly errors?: ApiFieldError[],
  ) {
    super(message);
    this.name = "ErrorApi";
  }
}

export const TOO_MANY_ATTEMPTS_MESSAGE =
  "Demasiados intentos. Espera un minuto e inténtalo de nuevo.";

export const API_STARTING_MESSAGE =
  "El servidor está iniciando. Intenta de nuevo en un minuto.";

/**
 * Error para un 429. Solo es nuestro límite de intentos si trae el `code` de la
 * API (`api/docs/errores.md`). En QA, con la API dormida, la plataforma responde
 * 429 sin ese cuerpo mientras la despierta: decir "demasiados intentos" al
 * primer intento confundía a quien probaba (PF-73).
 */
export async function tooManyRequestsError(
  response: Response,
): Promise<ApiError> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { code?: unknown } | null;
  return body?.code === "TOO_MANY_REQUESTS"
    ? new ApiError(429, TOO_MANY_ATTEMPTS_MESSAGE, "TOO_MANY_REQUESTS")
    : new ApiError(503, API_STARTING_MESSAGE);
}

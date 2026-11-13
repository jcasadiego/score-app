import "server-only";
import { headers } from "next/headers";
import type { ActionResult, FieldError } from "./types";

const GENERIC_ERROR = "Ocurrió un error inesperado. Intenta de nuevo.";
const NETWORK_ERROR =
  "No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.";
const TOO_MANY_REQUESTS =
  "Hiciste demasiados intentos seguidos. Espera un minuto e intenta de nuevo.";

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
}

/**
 * La API ve la IP de este servidor, no la del cliente. Con estos encabezados
 * cuenta sus límites por cliente. Se toma la última entrada de
 * `x-forwarded-for`: la agrega el proxy, y las anteriores las puede inventar el
 * cliente. Sin secreto o sin IP no se envía nada.
 */
async function clientIpHeaders(): Promise<Record<string, string>> {
  const secret = process.env.DIAGNOSTIC_API_SECRET;
  const forwardedFor = (await headers()).get("x-forwarded-for");
  const ip = forwardedFor?.split(",").at(-1)?.trim();
  return secret && ip
    ? { "x-diagnostic-secret": secret, "x-client-ip": ip }
    : {};
}

interface CallOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Sesión del cliente (cookie `httpOnly`), como Bearer. */
  session?: string;
  body?: unknown;
}

/**
 * Llama a la API desde el servidor. Devuelve el resultado o el error RFC 9457
 * (`api/docs/errores.md`) ya traducido a un mensaje para el cliente.
 */
export async function callApi<T>(
  path: string,
  { method = "GET", session, body }: CallOptions = {},
): Promise<ActionResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(session && { Authorization: `Bearer ${session}` }),
        ...(await clientIpHeaders()),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: NETWORK_ERROR };
  }

  if (response.ok) {
    const data =
      response.status === 204 ? undefined : ((await response.json()) as T);
    return { ok: true, data: data as T };
  }
  return problemResult(response);
}

/**
 * Como `callApi`, para una respuesta binaria (el PDF del informe). Solo acepta
 * el tipo esperado: cualquier otra cosa cuenta como error.
 */
export async function callApiFile(
  path: string,
  { method = "POST", body, contentType }: CallOptions & { contentType: string },
): Promise<ActionResult<Uint8Array>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(await clientIpHeaders()),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: NETWORK_ERROR };
  }

  if (!response.ok) return problemResult(response);
  if (!response.headers.get("content-type")?.startsWith(contentType)) {
    return { ok: false, status: 502, message: GENERIC_ERROR };
  }
  try {
    return { ok: true, data: new Uint8Array(await response.arrayBuffer()) };
  } catch {
    return { ok: false, status: 0, message: NETWORK_ERROR };
  }
}

/** El error RFC 9457 de la API, traducido a un mensaje para el cliente. */
async function problemResult(
  response: Response,
): Promise<ActionResult<never>> {
  const problem = (await response.json().catch(() => null)) as {
    detail?: string;
    code?: string;
    errors?: FieldError[];
  } | null;
  const message =
    response.status === 429
      ? TOO_MANY_REQUESTS
      : response.status >= 500
        ? GENERIC_ERROR
        : (problem?.detail ?? GENERIC_ERROR);
  return {
    ok: false,
    status: response.status,
    code: problem?.code,
    message,
    errors: problem?.errors,
  };
}

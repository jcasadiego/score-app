import "server-only";
import { isIP } from "node:net";
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
 * IP de quien navega. Si `CLIENT_IP_HEADER` nombra un encabezado que pone la
 * plataforma y que el cliente no puede falsificar, se usa ese. En Render,
 * `cf-connecting-ip`: Cloudflare rechaza con 403 la petición que lo trae del
 * cliente (verificado en QA, PF-73). Si no, `x-forwarded-for`: cada
 * proxy agrega una entrada al final, así que la del cliente está
 * `TRUST_PROXY_HOPS` posiciones desde el final y las anteriores las puede
 * inventar el cliente. En Render QA contar proxies no sirvió: la cadena varía
 * entre peticiones y el límite de intentos se repartía entre IPs de proxies.
 * Si no hay una IP válida, no se informa nada.
 */
function clientIp(requestHeaders: Headers): string | undefined {
  const headerName = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (headerName) {
    const ip = requestHeaders.get(headerName)?.trim();
    return ip && isIP(ip) ? ip : undefined;
  }

  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const hops = Number(process.env.TRUST_PROXY_HOPS || "1");
  if (!forwardedFor || !Number.isInteger(hops) || hops < 1) return undefined;
  const entries = forwardedFor.split(",").map((entry) => entry.trim());
  const ip = entries.length >= hops ? entries.at(-hops) : undefined;
  return ip && isIP(ip) ? ip : undefined;
}

/**
 * La API ve la IP de este servidor, no la del cliente. Con estos encabezados
 * cuenta sus límites por cliente. Sin secreto o sin IP no se envía nada.
 */
async function clientIpHeaders(): Promise<Record<string, string>> {
  const secret = process.env.DIAGNOSTIC_API_SECRET;
  const ip = clientIp(await headers());
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
 * Como `callApi`, con un cuerpo multipart (la grabación de voz). `fetch` pone
 * el `Content-Type` con su `boundary`.
 */
export async function callApiForm<T>(
  path: string,
  { method = "PUT", session, form }: CallOptions & { form: FormData },
): Promise<ActionResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/api/v1${path}`, {
      method,
      headers: {
        ...(session && { Authorization: `Bearer ${session}` }),
        ...(await clientIpHeaders()),
      },
      body: form,
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: NETWORK_ERROR };
  }
  if (response.ok) return { ok: true, data: (await response.json()) as T };
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

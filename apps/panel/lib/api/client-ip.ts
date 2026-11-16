import "server-only";
import { headers } from "next/headers";

/**
 * IP de quien navega, según `x-forwarded-for`. Cada proxy delante de este
 * servidor agrega una entrada al final, así que la del cliente es la que está
 * `TRUST_PROXY_HOPS` posiciones desde el final; las anteriores las puede
 * inventar el cliente. Medido en Render QA (PF-69): 3 proxies (Cloudflare y
 * Render). Es la misma regla que aplica la API con su `TRUST_PROXY_HOPS`.
 * Si la cadena es más corta de lo esperado, no se informa nada.
 */
function forwardedClientIp(forwardedFor: string | null): string | undefined {
  const hops = Number(process.env.TRUST_PROXY_HOPS || "1");
  if (!forwardedFor || !Number.isInteger(hops) || hops < 1) return undefined;
  const entries = forwardedFor.split(",").map((entry) => entry.trim());
  return entries.length >= hops ? entries.at(-hops) || undefined : undefined;
}

/**
 * La API ve la IP del servidor del panel, no la de quien inicia sesión. Con
 * estos encabezados, su límite de intentos cuenta por cliente. Sin secreto o sin
 * IP no se envía nada, y la API cuenta por IP de conexión.
 */
export async function clientIpHeaders(): Promise<Record<string, string>> {
  const secret = process.env.PANEL_API_SECRET;
  const forwardedFor = (await headers()).get("x-forwarded-for");
  const ip = forwardedClientIp(forwardedFor);

  return secret && ip ? { "x-panel-secret": secret, "x-client-ip": ip } : {};
}

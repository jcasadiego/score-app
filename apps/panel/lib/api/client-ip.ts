import "server-only";
import { isIP } from "node:net";
import { headers } from "next/headers";

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
 * La API ve la IP del servidor del panel, no la de quien inicia sesión. Con
 * estos encabezados, su límite de intentos cuenta por cliente. Sin secreto o sin
 * IP no se envía nada, y la API cuenta por IP de conexión.
 */
export async function clientIpHeaders(): Promise<Record<string, string>> {
  const secret = process.env.PANEL_API_SECRET;
  const ip = clientIp(await headers());

  return secret && ip ? { "x-panel-secret": secret, "x-client-ip": ip } : {};
}

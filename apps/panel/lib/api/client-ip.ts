import "server-only";
import { headers } from "next/headers";

/**
 * La API ve la IP del servidor del panel, no la de quien inicia sesión. Con
 * estos encabezados, su límite de intentos cuenta por cliente. Se toma la última
 * entrada de `x-forwarded-for`: es la que agrega el proxy, y las anteriores las
 * puede inventar el cliente. Sin secreto o sin IP no se envía nada, y la API
 * cuenta por IP de conexión.
 */
export async function clientIpHeaders(): Promise<Record<string, string>> {
  const secret = process.env.PANEL_API_SECRET;
  const forwardedFor = (await headers()).get("x-forwarded-for");
  const ip = forwardedFor?.split(",").at(-1)?.trim();

  return secret && ip ? { "x-panel-secret": secret, "x-client-ip": ip } : {};
}

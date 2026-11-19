import { headers } from "next/headers";

// TEMPORAL (validación de QA, PF-73): muestra los encabezados de IP que llegan
// a este servidor en Render, para elegir una fuente de IP del cliente que no se
// pueda falsificar. Exige sesión (proxy.ts). Se borra en cuanto se decida.
export const dynamic = "force-dynamic";

const IP_HEADERS = [
  "x-forwarded-for",
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip",
  "x-client-ip",
  "forwarded",
  "cf-ray",
  "x-request-start",
  "rndr-id",
];

export async function GET() {
  const requestHeaders = await headers();
  const seen = Object.fromEntries(
    IP_HEADERS.map((name) => [name, requestHeaders.get(name)]),
  );
  return Response.json(seen, { headers: { "Cache-Control": "no-store" } });
}

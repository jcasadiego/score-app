import { NextResponse, type NextRequest } from "next/server";

/**
 * Un nonce por petición: solo corren los scripts y estilos en línea que Next
 * marca con él, así que uno inyectado no se ejecuta. La app no llama a la API
 * desde el navegador (todo pasa por su servidor), por eso `connect-src 'self'`.
 * El modo de desarrollo de Next necesita `eval`, estilos en línea y websocket.
 */
function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export default function proxy(request: NextRequest) {
  const csp = contentSecurityPolicy(btoa(crypto.randomUUID()));
  // Next toma el nonce de este encabezado de la petición y lo pone en sus scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse, type NextRequest } from "next/server";
import {
  HOME_ROUTE,
  SESSION_COOKIE_NAME,
  SESSION_EXPIRED_ROUTE,
  sessionCookieOptions,
} from "@/lib/auth/constants";
import { refreshAccessToken } from "@/lib/api/auth";
import { decodeToken, shouldRenew } from "@/lib/auth/jwt";

const PUBLIC_ROUTES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  SESSION_EXPIRED_ROUTE,
];

/**
 * Públicas que no tienen sentido con sesión abierta. Las de recuperación
 * no están: el enlace del correo debe funcionar aunque el navegador tenga
 * una sesión (por ejemplo, la de otra persona del equipo).
 */
const GUEST_ONLY_ROUTES = ["/login"];

function matchesRoute(routes: string[], pathname: string): boolean {
  return routes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * Chequeo optimista de sesión (solo lee la cookie, sin llamar a la API)
 * para redirigir antes de renderizar. La verificación real — que el
 * usuario siga existiendo y activo — ocurre en la API en cada llamada
 * autenticada; ver `verifySession` (`lib/auth/dal.ts`) para el chequeo
 * de cada Server Component.
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? decodeToken(token) : null;
  const hasValidSession = !!session && session.exp * 1000 > Date.now();

  // El cliente de Next no entiende una redirección del proxy como respuesta
  // de una Server Action: el formulario queda cargando para siempre. Se deja
  // pasar para que la propia acción la resuelva con `verifySession`.
  const isServerAction =
    request.method === "POST" && request.headers.has("next-action");

  if (
    !matchesRoute(PUBLIC_ROUTES, pathname) &&
    !hasValidSession &&
    !isServerAction
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (matchesRoute(GUEST_ONLY_ROUTES, pathname) && hasValidSession) {
    return NextResponse.redirect(new URL(HOME_ROUTE, request.url));
  }

  const response = NextResponse.next();

  // Solo al navegar por pantallas protegidas. En una Server Action, esta
  // cookie competiría con la que borra el logout y podría ganarle.
  if (
    token &&
    session &&
    hasValidSession &&
    request.method === "GET" &&
    !matchesRoute(PUBLIC_ROUTES, pathname) &&
    shouldRenew(session)
  ) {
    const freshToken = await refreshAccessToken(token);
    const freshSession = freshToken ? decodeToken(freshToken) : null;
    if (freshToken && freshSession) {
      response.cookies.set(
        SESSION_COOKIE_NAME,
        freshToken,
        sessionCookieOptions(freshSession.exp),
      );
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

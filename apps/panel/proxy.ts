import { NextResponse, type NextRequest } from "next/server";
import { NOMBRE_COOKIE_SESION, RUTA_INICIO } from "@/lib/auth/constants";
import { decodificarToken } from "@/lib/auth/jwt";

const RUTAS_PUBLICAS = [
  "/login",
  "/recuperar-contrasena",
  "/restablecer-contrasena",
];

/**
 * Públicas que no tienen sentido con sesión abierta. Las de recuperación
 * no están: el enlace del correo debe funcionar aunque el navegador tenga
 * una sesión (por ejemplo, la de otra persona del equipo).
 */
const RUTAS_SOLO_SIN_SESION = ["/login"];

function coincide(rutas: string[], pathname: string): boolean {
  return rutas.some(
    (ruta) => pathname === ruta || pathname.startsWith(`${ruta}/`),
  );
}

/**
 * Chequeo optimista de sesión (solo lee la cookie, sin llamar a la API)
 * para redirigir antes de renderizar. La verificación real — que el
 * usuario siga existiendo y activo — ocurre en la API en cada llamada
 * autenticada; ver `verificarSesion` (`lib/auth/dal.ts`) para el chequeo
 * de cada Server Component.
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(NOMBRE_COOKIE_SESION)?.value;
  const sesion = token ? decodificarToken(token) : null;
  const haySesionValida = !!sesion && sesion.exp * 1000 > Date.now();

  if (!coincide(RUTAS_PUBLICAS, pathname) && !haySesionValida) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (coincide(RUTAS_SOLO_SIN_SESION, pathname) && haySesionValida) {
    return NextResponse.redirect(new URL(RUTA_INICIO, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse, type NextRequest } from "next/server";
import { NOMBRE_COOKIE_SESION } from "@/lib/auth/constants";
import { decodificarToken } from "@/lib/auth/jwt";

const RUTAS_PUBLICAS = ["/login"];

function esRutaPublica(pathname: string): boolean {
  return RUTAS_PUBLICAS.some(
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

  if (!esRutaPublica(pathname) && !haySesionValida) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (esRutaPublica(pathname) && haySesionValida) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

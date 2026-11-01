export const SESSION_COOKIE_NAME = "score_panel_session";

/** Opciones de la cookie de sesión; `exp` es el vencimiento del JWT. */
export function sessionCookieOptions(exp?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: exp ? new Date(exp * 1000) : undefined,
  } as const;
}

/**
 * A dónde aterriza una sesión nueva. Se usa directo (login, proxy y `/`)
 * para no encadenar redirecciones `/login` → `/` → `/users`. Cuando
 * exista la bandeja de casos, pasa a ser esa ruta.
 */
export const HOME_ROUTE = "/users";

/** Borra la cookie cuando la API rechaza el token (ver su `route.ts`). */
export const SESSION_EXPIRED_ROUTE = "/session-expired";

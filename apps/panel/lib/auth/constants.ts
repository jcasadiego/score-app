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

/** Guarda el reto de MFA entre la contraseña y el código. */
export const MFA_CHALLENGE_COOKIE_NAME = "score_panel_mfa_challenge";
/** Igual que la vida del token en la API: más tiempo no serviría. */
export const MFA_CHALLENGE_MAX_AGE_SECONDS = 5 * 60;

export const MFA_ROUTE = "/login/two-factor";
export const MFA_SETUP_ROUTE = "/login/two-factor/setup";

/**
 * A dónde aterriza una sesión nueva. Se usa directo (login, proxy y `/`)
 * para no encadenar redirecciones `/login` → `/` → `/leads`. Cuando
 * exista la bandeja de casos, pasa a ser esa ruta.
 */
export const HOME_ROUTE = "/leads";

/** Borra la cookie cuando la API rechaza el token (ver su `route.ts`). */
export const SESSION_EXPIRED_ROUTE = "/session-expired";

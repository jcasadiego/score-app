export const NOMBRE_COOKIE_SESION = "score_panel_session";

/**
 * A dónde aterriza una sesión nueva. Se usa directo (login, proxy y `/`)
 * para no encadenar redirecciones `/login` → `/` → `/usuarios`. Cuando
 * exista la bandeja de casos, pasa a ser esa ruta.
 */
export const RUTA_INICIO = "/usuarios";

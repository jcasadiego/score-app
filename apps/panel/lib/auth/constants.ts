export const SESSION_COOKIE_NAME = "score_panel_session";

/**
 * A dónde aterriza una sesión nueva. Se usa directo (login, proxy y `/`)
 * para no encadenar redirecciones `/login` → `/` → `/users`. Cuando
 * exista la bandeja de casos, pasa a ser esa ruta.
 */
export const HOME_ROUTE = "/users";

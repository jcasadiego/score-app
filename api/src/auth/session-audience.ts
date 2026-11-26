/**
 * Audiencia del token de sesión del panel. La exige `JwtStrategy`: así otro
 * token firmado con `JWT_SECRET` (el desafío MFA) nunca sirve como sesión,
 * aunque algún día llevara los mismos campos.
 */
export const PANEL_SESSION_AUDIENCE = 'panel-session';

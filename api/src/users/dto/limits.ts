/** Límites compartidos por los DTOs de usuario (y espejados en `apps/panel`). */
export const NAME_MAX = 120;
/** Máximo práctico de una dirección de email (RFC 5321). */
export const EMAIL_MAX = 254;
/**
 * Largo de contraseña al crear, al cambiarla desde el CRUD y al recuperarla.
 * Mínimo según OWASP ASVS. El máximo acota el trabajo de argon2 sin impedir
 * frases largas ni gestores de contraseñas.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

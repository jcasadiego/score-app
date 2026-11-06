/** Largos de los campos de diagnósticos (también en la base, como `VARCHAR`). */
export const CREATION_REASON_MAX = 500;
/** Tope absoluto del texto libre; el de cada pregunta lo valida el servicio. */
export const ANSWER_TEXT_MAX = 5000;
/** Un token de 32 bytes en base64url mide 43; el margen evita rechazar por formato. */
export const ACCESS_TOKEN_MAX = 128;
export const ID_MAX = 64;
export const MAX_SELECTED_OPTIONS = 30;

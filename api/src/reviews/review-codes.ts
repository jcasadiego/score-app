/**
 * Códigos propios del módulo de revisión (catálogo en `docs/errores.md`). En un
 * archivo aparte para que otros módulos (flags) los usen sin importar
 * `ReviewsService`, que ya depende de ellos.
 */
export const REVIEW_ALREADY_TAKEN = 'REVIEW_ALREADY_TAKEN';
export const REVIEW_TAKEN_BY_OTHER = 'REVIEW_TAKEN_BY_OTHER';
export const REVIEW_NOT_TAKEN = 'REVIEW_NOT_TAKEN';
export const REVIEW_APPROVED = 'REVIEW_APPROVED';
export const REVIEW_NOT_APPROVED = 'REVIEW_NOT_APPROVED';
export const APPROVAL_REQUIREMENTS_NOT_MET = 'APPROVAL_REQUIREMENTS_NOT_MET';

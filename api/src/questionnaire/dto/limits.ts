/**
 * Límites del cuestionario. Los largos de texto y el formato de `code`/`value`
 * también están en la base (`VARCHAR` y CHECK); los topes de cantidad acotan el
 * tamaño de una petición y de la versión.
 */
export const CODE_MAX = 64;
/** `code` y `value`: minúsculas, dígitos y `_`, empezando por letra. */
export const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const QUESTION_TEXT_MAX = 500;
export const HELP_TEXT_MAX = 1000;
export const OPTION_TEXT_MAX = 300;
export const FREE_TEXT_MAX_LENGTH = 5000;
export const MIN_CHOICE_OPTIONS = 2;
export const MAX_OPTIONS = 30;
export const MAX_QUESTIONS_PER_VERSION = 200;

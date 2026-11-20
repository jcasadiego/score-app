/** Largos de los campos de pagos (también en la base, como `VARCHAR`). */
export const REFERENCE_MAX = 100;
export const VOID_REASON_MAX = 500;
/**
 * Monto positivo con hasta 12 enteros y 2 decimales (`DECIMAL(14,2)`), como
 * string: un número de JSON puede perder precisión.
 */
export const AMOUNT_PATTERN = /^(?=.*[1-9])\d{1,12}(\.\d{1,2})?$/;

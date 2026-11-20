/**
 * Espejo de los enums y límites de pagos de la API (`api/src/payments`). Si
 * cambian allá, cambian acá.
 */
export const PAYMENT_STATUSES = ["PENDING", "CONFIRMED", "VOIDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  "PAYPAL",
  "BANK_TRANSFER",
  "PAGO_MOVIL",
  "OTHER",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CURRENCIES = ["USD", "VES"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  VOIDED: "Anulado",
};

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  PENDING: "gold",
  CONFIRMED: "green",
  VOIDED: "default",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PAYPAL: "PayPal",
  BANK_TRANSFER: "Transferencia",
  PAGO_MOVIL: "Pago Móvil",
  OTHER: "Otro",
};

export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  USD: "USD (dólares)",
  VES: "VES (bolívares)",
};

export const REFERENCE_MAX = 100;
export const VOID_REASON_MIN = 3;
export const VOID_REASON_MAX = 500;
/** Monto positivo con hasta 12 enteros y 2 decimales, como texto. */
export const AMOUNT_PATTERN = /^(?=.*[1-9])\d{1,12}(\.\d{1,2})?$/;

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return PAYMENT_STATUSES.includes(value as PaymentStatus);
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return PAYMENT_METHODS.includes(value as PaymentMethod);
}

export function isCurrency(value: unknown): value is CurrencyCode {
  return CURRENCIES.includes(value as CurrencyCode);
}

/**
 * El monto llega como texto decimal y así se muestra: `Intl` formatea el
 * string sin pasarlo por `float` (los navegadores y Node actuales aceptan
 * strings decimales en `format`).
 */
export function formatAmount(amount: string, currency: CurrencyCode): string {
  return new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount as unknown as number);
}

/** Acepta coma o punto como separador decimal y quita espacios. */
export function normalizeAmount(value: string): string {
  return value.trim().replace(/\s/g, "").replace(",", ".");
}

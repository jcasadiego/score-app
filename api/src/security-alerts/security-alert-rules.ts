/** Ventanas fijas, alineadas al reloj: todas las instancias ven las mismas. */
export const ALERT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Cuántas ventanas completas hacia atrás se revisan en cada pasada: cubre un
 * reinicio o una pausa corta de la API sin perder una ráfaga.
 */
export const ALERT_LOOKBACK_WINDOWS = 3;

/** Margen para que lleguen a la bitácora los registros que se escriben al responder. */
export const ALERT_GRACE_MS = 10_000;

export interface SecurityAlertRule {
  /** Acción de la bitácora que se cuenta. */
  action: string;
  /** Desde cuántos eventos en una ventana se alerta. */
  threshold: number;
  /** Lo que se lee en el asunto del correo. */
  event: string;
}

/**
 * Umbrales por ventana de 5 minutos (PF-55). Con el tráfico de hoy, un uso
 * normal no llega a ninguno: varios intentos fallidos ya bloquean la cuenta
 * (5 por usuario), así que 20 en 5 minutos indica a alguien probando cuentas.
 */
export const SECURITY_ALERT_RULES: readonly SecurityAlertRule[] = [
  {
    action: 'AUTHENTICATION_FAILED',
    threshold: 20,
    event: 'Muchos intentos fallidos de autenticación',
  },
  {
    action: 'ACCESS_DENIED',
    threshold: 20,
    event: 'Muchos accesos denegados',
  },
  {
    action: 'ACCOUNT_LOCKED',
    threshold: 3,
    event: 'Varias cuentas bloqueadas por intentos fallidos',
  },
  {
    action: 'MFA_RESET',
    threshold: 1,
    event: 'Se restableció el segundo factor de un usuario',
  },
  {
    action: 'REQUEST_FAILED',
    threshold: 10,
    event: 'Errores 5xx sostenidos',
  },
];

/** Las últimas ventanas completas, de la más vieja a la más nueva. */
export function completedWindows(
  now: number,
  count = ALERT_LOOKBACK_WINDOWS,
): { start: Date; end: Date }[] {
  const lastEnd =
    Math.floor((now - ALERT_GRACE_MS) / ALERT_WINDOW_MS) * ALERT_WINDOW_MS;
  return Array.from({ length: count }, (_, i) => {
    const end = lastEnd - (count - 1 - i) * ALERT_WINDOW_MS;
    return { start: new Date(end - ALERT_WINDOW_MS), end: new Date(end) };
  });
}

/** Rutas de la app y los motivos con los que se llega a ellas. */
export const ROUTES = {
  home: "/",
  questionnaire: "/diagnostic",
  recover: "/recover",
  submitted: "/submitted",
  /** Descarga del informe, desde el correo de entrega (`/report#token=…`). */
  report: "/report",
  /** Borra la cookie (un Server Component no puede) y lleva a recuperar. */
  sessionEnded: "/session-ended",
} as const;

export type RecoverReason = "invalid" | "session";

export const recoverUrl = (reason: RecoverReason) =>
  `${ROUTES.recover}?reason=${reason}`;

export const ALREADY_SUBMITTED_URL = `${ROUTES.submitted}?state=already`;

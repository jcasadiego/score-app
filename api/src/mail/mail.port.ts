export const MAIL_PORT = Symbol('MAIL_PORT');

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** Versión en texto plano, para clientes que no muestran HTML. */
  text: string;
}

export type SendResult =
  { sent: true; providerId: string } | { sent: false; reason: string };

/**
 * Límite entre la API y el proveedor de correo (mismo criterio que
 * `ScoringEnginePort`). Los módulos no usan este puerto directo: pasan por
 * `MailService`, que arma la plantilla y registra en la bitácora. Un
 * adaptador nunca lanza por un fallo del proveedor — lo devuelve como
 * `{ sent: false }` para que la operación que pidió el correo siga.
 */
export interface MailPort {
  send(message: MailMessage): Promise<SendResult>;
}

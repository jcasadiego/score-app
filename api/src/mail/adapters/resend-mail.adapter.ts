import { Resend } from 'resend';
import { MailMessage, MailPort, SendResult } from '../mail.port';

export interface ResendOptions {
  apiKey: string;
  /** Ej. `Music Finance Pro <notificaciones@dominio.com>`. */
  from: string;
  replyTo: string;
}

/**
 * Adaptador real (`MAIL_DRIVER=resend`) para staging y producción. Sin
 * reintentos a propósito (fuera de alcance del MVP): un fallo se informa
 * a quien pidió el correo.
 */
export class ResendMailAdapter implements MailPort {
  private readonly client: Resend;

  constructor(private readonly options: ResendOptions) {
    this.client = new Resend(options.apiKey);
  }

  async send(message: MailMessage): Promise<SendResult> {
    try {
      // El SDK no lanza por errores de la API: los devuelve en `error`.
      const { data, error } = await this.client.emails.send({
        from: this.options.from,
        replyTo: this.options.replyTo,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      if (error) {
        return {
          sent: false,
          reason: `${error.name} (${error.statusCode ?? 'sin status'}): ${error.message}`,
        };
      }

      return { sent: true, providerId: data.id };
    } catch (error) {
      // Red caída, DNS, timeouts: lo que el SDK no alcanza a envolver.
      return {
        sent: false,
        reason: error instanceof Error ? error.message : 'error desconocido',
      };
    }
  }
}

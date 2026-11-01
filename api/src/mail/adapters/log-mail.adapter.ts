import { Injectable, Logger } from '@nestjs/common';
import { MailMessage, MailPort, SendResult } from '../mail.port';

/**
 * Adaptador de desarrollo (`MAIL_DRIVER=log`): no envía nada real, deja
 * el correo en el log para probar en local sin cuenta de Resend. Los
 * enlaces sí se muestran completos — es justo lo que hace falta para
 * seguirlos a mano. La validación de entorno impide usarlo en producción.
 */
@Injectable()
export class LogMailAdapter implements MailPort {
  private readonly logger = new Logger('Mail');
  private counter = 0;

  async send(message: MailMessage): Promise<SendResult> {
    const providerId = `log-${Date.now()}-${++this.counter}`;
    const links = [
      ...new Set(
        [...message.html.matchAll(/href="([^"]+)"/g)].map(([, url]) =>
          url.replace(/&amp;/g, '&'),
        ),
      ),
    ];

    this.logger.log(
      [
        `Correo NO enviado (MAIL_DRIVER=log) · ${providerId}`,
        `Para: ${message.to}`,
        `Asunto: ${message.subject}`,
        `Enlaces: ${links.length ? links.join(', ') : '(ninguno)'}`,
        '--- contenido ---',
        message.text,
        '-----------------',
      ].join('\n'),
    );

    return { sent: true, providerId };
  }
}

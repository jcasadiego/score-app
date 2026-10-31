import { Injectable, Logger } from '@nestjs/common';
import { CorreoPort, MensajeCorreo, ResultadoEnvio } from '../correo.port';

/**
 * Adaptador de desarrollo (`CORREO_MODO=log`): no envía nada real, deja
 * el correo en el log para probar en local sin cuenta de Resend. Los
 * enlaces sí se muestran completos — es justo lo que hace falta para
 * seguirlos a mano. La validación de entorno impide usarlo en producción.
 */
@Injectable()
export class CorreoLogAdapter implements CorreoPort {
  private readonly logger = new Logger('Correo');
  private contador = 0;

  async enviar(mensaje: MensajeCorreo): Promise<ResultadoEnvio> {
    const proveedorId = `log-${Date.now()}-${++this.contador}`;
    const enlaces = [
      ...new Set(
        [...mensaje.html.matchAll(/href="([^"]+)"/g)].map(([, url]) =>
          url.replace(/&amp;/g, '&'),
        ),
      ),
    ];

    this.logger.log(
      [
        `Correo NO enviado (CORREO_MODO=log) · ${proveedorId}`,
        `Para: ${mensaje.para}`,
        `Asunto: ${mensaje.asunto}`,
        `Enlaces: ${enlaces.length ? enlaces.join(', ') : '(ninguno)'}`,
        '--- contenido ---',
        mensaje.texto,
        '-----------------',
      ].join('\n'),
    );

    return { enviado: true, proveedorId };
  }
}

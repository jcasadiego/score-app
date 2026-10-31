import { Resend } from 'resend';
import { CorreoPort, MensajeCorreo, ResultadoEnvio } from '../correo.port';

export interface OpcionesResend {
  apiKey: string;
  /** Ej. `Music Finance Pro <notificaciones@dominio.com>`. */
  remitente: string;
  replyTo: string;
}

/**
 * Adaptador real (`CORREO_MODO=resend`) para staging y producción. Sin
 * reintentos a propósito (fuera de alcance del MVP): un fallo se informa
 * a quien pidió el correo.
 */
export class CorreoResendAdapter implements CorreoPort {
  private readonly cliente: Resend;

  constructor(private readonly opciones: OpcionesResend) {
    this.cliente = new Resend(opciones.apiKey);
  }

  async enviar(mensaje: MensajeCorreo): Promise<ResultadoEnvio> {
    try {
      // El SDK no lanza por errores de la API: los devuelve en `error`.
      const { data, error } = await this.cliente.emails.send({
        from: this.opciones.remitente,
        replyTo: this.opciones.replyTo,
        to: mensaje.para,
        subject: mensaje.asunto,
        html: mensaje.html,
        text: mensaje.texto,
      });

      if (error) {
        return {
          enviado: false,
          motivo: `${error.name} (${error.statusCode ?? 'sin status'}): ${error.message}`,
        };
      }

      return { enviado: true, proveedorId: data.id };
    } catch (error) {
      // Red caída, DNS, timeouts: lo que el SDK no alcanza a envolver.
      return {
        enviado: false,
        motivo: error instanceof Error ? error.message : 'error desconocido',
      };
    }
  }
}

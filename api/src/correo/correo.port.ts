export const CORREO_PORT = Symbol('CORREO_PORT');

export interface MensajeCorreo {
  para: string;
  asunto: string;
  html: string;
  /** Versión en texto plano, para clientes que no muestran HTML. */
  texto: string;
}

export type ResultadoEnvio =
  { enviado: true; proveedorId: string } | { enviado: false; motivo: string };

/**
 * Límite entre la API y el proveedor de correo (mismo criterio que
 * `MotorCalculoPort`). Los módulos no usan este puerto directo: pasan por
 * `CorreoService`, que arma la plantilla y registra en Auditoría. Un
 * adaptador nunca lanza por un fallo del proveedor — lo devuelve como
 * `{ enviado: false }` para que la operación que pidió el correo siga.
 */
export interface CorreoPort {
  enviar(mensaje: MensajeCorreo): Promise<ResultadoEnvio>;
}

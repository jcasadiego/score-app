import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActorAuditoria } from '../../generated/prisma/enums';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EnvValidado } from '../config/validar-env';
import { CORREO_PORT, CorreoPort, ResultadoEnvio } from './correo.port';
import {
  correoDiagnosticoEnlace,
  correoRecuperarEnlace,
  correoRestablecerContrasena,
  DatosCorreoEnlace,
} from './plantillas/correos';
import { CorreoRenderizado } from './plantillas/plantilla-base';

export type TipoCorreo =
  'DIAGNOSTICO_ENLACE' | 'RECUPERAR_ENLACE' | 'RESTABLECER_CONTRASENA';

/** A qué se asocia el envío en la bitácora (ej. el Caso que lo pidió). */
export interface ContextoCorreo {
  entidad?: string;
  entidadId?: string;
  actorTipo?: ActorAuditoria;
  actorId?: string;
}

export interface DestinatarioCorreoEnlace extends DatosCorreoEnlace {
  para: string;
}

/** `ana.perez@dominio.com` → `a***@dominio.com`, para la bitácora. */
export function enmascararEmail(email: string): string {
  const [usuario, dominio] = email.split('@');
  return dominio ? `${usuario.slice(0, 1)}***@${dominio}` : '***';
}

/**
 * Única puerta de salida de correo de la API: los módulos piden "enviar
 * este correo" y no saben qué proveedor hay detrás (`CORREO_PORT`).
 * Nunca lanza: devuelve `{ enviado: false, motivo }` y cada intento, bien
 * o mal, queda en Auditoría — sin el enlace ni el contenido del correo.
 */
@Injectable()
export class CorreoService {
  private readonly logger = new Logger(CorreoService.name);

  constructor(
    @Inject(CORREO_PORT) private readonly proveedor: CorreoPort,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService<EnvValidado, true>,
  ) {}

  enviarEnlaceDiagnostico(
    datos: DestinatarioCorreoEnlace,
    contexto?: ContextoCorreo,
  ): Promise<ResultadoEnvio> {
    return this.enviar(
      'DIAGNOSTICO_ENLACE',
      datos.para,
      correoDiagnosticoEnlace(datos, this.marca()),
      contexto,
    );
  }

  enviarRecuperacionEnlace(
    datos: DestinatarioCorreoEnlace,
    contexto?: ContextoCorreo,
  ): Promise<ResultadoEnvio> {
    return this.enviar(
      'RECUPERAR_ENLACE',
      datos.para,
      correoRecuperarEnlace(datos, this.marca()),
      contexto,
    );
  }

  enviarRestablecerContrasena(
    datos: DestinatarioCorreoEnlace,
    contexto?: ContextoCorreo,
  ): Promise<ResultadoEnvio> {
    return this.enviar(
      'RESTABLECER_CONTRASENA',
      datos.para,
      correoRestablecerContrasena(datos, this.marca()),
      contexto,
    );
  }

  private marca() {
    return { logoUrl: this.config.get('CORREO_LOGO_URL', { infer: true }) };
  }

  private async enviar(
    tipo: TipoCorreo,
    para: string,
    correo: CorreoRenderizado,
    contexto: ContextoCorreo = {},
  ): Promise<ResultadoEnvio> {
    let resultado: ResultadoEnvio;
    try {
      resultado = await this.proveedor.enviar({ para, ...correo });
    } catch (error) {
      resultado = {
        enviado: false,
        motivo: error instanceof Error ? error.message : 'error desconocido',
      };
    }

    // `in` y no `!resultado.enviado`: sin strictNullChecks, TS no estrecha
    // la unión por el literal booleano.
    if ('motivo' in resultado) {
      this.logger.warn(
        `No se pudo enviar ${tipo} a ${enmascararEmail(para)}: ${resultado.motivo}`,
      );
    }

    await this.auditar(tipo, para, resultado, contexto);
    return resultado;
  }

  private async auditar(
    tipo: TipoCorreo,
    para: string,
    resultado: ResultadoEnvio,
    contexto: ContextoCorreo,
  ) {
    try {
      await this.auditoria.registrar({
        actorTipo: contexto.actorTipo ?? ActorAuditoria.SISTEMA,
        actorId: contexto.actorId,
        accion: resultado.enviado ? 'CORREO_ENVIADO' : 'CORREO_FALLIDO',
        entidad: contexto.entidad ?? 'Correo',
        entidadId: contexto.entidadId,
        datos: {
          tipo,
          destinatario: enmascararEmail(para),
          ...('motivo' in resultado
            ? { motivo: resultado.motivo }
            : { proveedorId: resultado.proveedorId }),
        },
      });
    } catch (error) {
      // La bitácora caída tampoco debe romper la operación que pidió el correo.
      this.logger.error(
        `No se pudo registrar en Auditoría el envío ${tipo}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditActorType } from '../../generated/prisma/enums';
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

export type TipoCorreo = 'DIAGNOSTIC_LINK' | 'LINK_RECOVERY' | 'PASSWORD_RESET';

/** A qué se asocia el envío en la bitácora (ej. el Caso que lo pidió). */
export interface ContextoCorreo {
  entity?: string;
  entityId?: string;
  actorType?: AuditActorType;
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
      'DIAGNOSTIC_LINK',
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
      'LINK_RECOVERY',
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
      'PASSWORD_RESET',
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
        actorType: contexto.actorType ?? AuditActorType.SYSTEM,
        actorId: contexto.actorId,
        action: resultado.enviado ? 'EMAIL_SENT' : 'EMAIL_FAILED',
        entity: contexto.entity ?? 'Email',
        entityId: contexto.entityId,
        data: {
          type: tipo,
          recipient: enmascararEmail(para),
          ...('motivo' in resultado
            ? { reason: resultado.motivo }
            : { providerId: resultado.proveedorId }),
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

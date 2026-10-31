import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { ActorAuditoria } from '../../generated/prisma/enums';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EnvValidado } from '../config/validar-env';
import { CorreoService } from '../correo/correo.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  datosCambioPassword,
  UsuariosService,
} from '../usuarios/usuarios.service';

export const VIGENCIA_ENLACE_MS = 60 * 60 * 1000;

export const MENSAJE_SOLICITUD =
  'Si el correo está registrado, te enviamos un enlace para restablecer la contraseña.';

/** Mismo mensaje para inválido, vencido o usado: no da pistas de cuál. */
export const MENSAJE_ENLACE_INVALIDO =
  'El enlace no es válido, ya se usó o venció. Pide uno nuevo.';

const PANEL_URL_DESARROLLO = 'http://localhost:3002';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Recuperación de contraseña de los usuarios de `apps/panel`. El token
 * viaja solo en el correo; en la base queda su SHA-256 (es aleatorio de
 * 256 bits, así que no hace falta un hash lento como argon2).
 */
@Injectable()
export class RecuperacionContrasenaService {
  private readonly logger = new Logger(RecuperacionContrasenaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usuarios: UsuariosService,
    private readonly correo: CorreoService,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService<EnvValidado, true>,
  ) {}

  /**
   * Responde enseguida y procesa en segundo plano: así la respuesta es la
   * misma — en contenido y en tiempo — exista o no el correo, y un fallo
   * del proveedor de correo no le llega a quien pidió el enlace (queda en
   * Auditoría vía `CorreoService`).
   */
  solicitar(email: string): { mensaje: string } {
    void this.procesarSolicitud(email).catch((error: unknown) =>
      this.logger.error(
        'Falló la solicitud de recuperación de contraseña',
        error instanceof Error ? error.stack : undefined,
      ),
    );
    return { mensaje: MENSAJE_SOLICITUD };
  }

  async procesarSolicitud(email: string): Promise<void> {
    const usuario = await this.usuarios.buscarPorEmail(email);
    if (!usuario || !usuario.activo) {
      return;
    }

    const token = randomBytes(32).toString('base64url');
    // Borrar los pendientes y crear el nuevo juntos: pedir un enlace nuevo
    // invalida el anterior.
    await this.prisma.$transaction([
      this.prisma.tokenRecuperacionContrasena.deleteMany({
        where: { usuarioId: usuario.id, usadoEn: null },
      }),
      this.prisma.tokenRecuperacionContrasena.create({
        data: {
          usuarioId: usuario.id,
          tokenHash: hashToken(token),
          expiraEn: new Date(Date.now() + VIGENCIA_ENLACE_MS),
        },
      }),
    ]);

    await this.auditoria.registrar({
      actorTipo: ActorAuditoria.SISTEMA,
      accion: 'RECUPERACION_CONTRASENA_SOLICITADA',
      entidad: 'Usuario',
      entidadId: usuario.id,
    });

    const panelUrl =
      this.config.get('PANEL_URL', { infer: true }) ?? PANEL_URL_DESARROLLO;
    const enlace = new URL('/restablecer-contrasena', panelUrl);
    enlace.searchParams.set('token', token);

    await this.correo.enviarRestablecerContrasena(
      { para: usuario.email, nombre: usuario.nombre, enlace: enlace.href },
      { entidad: 'Usuario', entidadId: usuario.id },
    );
  }

  async restablecer(token: string, password: string): Promise<void> {
    const registro = await this.prisma.tokenRecuperacionContrasena.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { usuario: { select: { activo: true } } },
    });

    if (
      !registro ||
      registro.usadoEn ||
      registro.expiraEn <= new Date() ||
      !registro.usuario.activo
    ) {
      throw new BadRequestException(MENSAJE_ENLACE_INVALIDO);
    }

    const datosPassword = await datosCambioPassword(password);

    await this.prisma.$transaction(async (tx) => {
      // Marcar como usado solo si sigue sin usar: si dos requests llegan a
      // la vez con el mismo enlace, solo una cambia la contraseña.
      const { count } = await tx.tokenRecuperacionContrasena.updateMany({
        where: { id: registro.id, usadoEn: null },
        data: { usadoEn: new Date() },
      });
      if (count === 0) {
        throw new BadRequestException(MENSAJE_ENLACE_INVALIDO);
      }

      await tx.usuario.update({
        where: { id: registro.usuarioId },
        data: datosPassword,
      });
      await tx.tokenRecuperacionContrasena.deleteMany({
        where: { usuarioId: registro.usuarioId, usadoEn: null },
      });
    });

    await this.auditoria
      .registrar({
        actorTipo: ActorAuditoria.SISTEMA,
        accion: 'CONTRASENA_RESTABLECIDA',
        entidad: 'Usuario',
        entidadId: registro.usuarioId,
      })
      .catch((error: unknown) =>
        this.logger.error(
          'No se pudo registrar en Auditoría el restablecimiento',
          error instanceof Error ? error.stack : undefined,
        ),
      );
  }
}

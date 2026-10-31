import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { AuditActorType } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { ValidatedEnv } from '../config/validate-env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { passwordChangeData, UsersService } from '../users/users.service';

export const RESET_LINK_TTL_MS = 60 * 60 * 1000;

export const REQUEST_MESSAGE =
  'Si el correo está registrado, te enviamos un enlace para restablecer la contraseña.';

/** Mismo mensaje para inválido, vencido o usado: no da pistas de cuál. */
export const INVALID_LINK_MESSAGE =
  'El enlace no es válido, ya se usó o venció. Pide uno nuevo.';

const DEV_PANEL_URL = 'http://localhost:3002';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Recuperación de contraseña de los usuarios de `apps/panel`. El token
 * viaja solo en el correo; en la base queda su SHA-256 (es aleatorio de
 * 256 bits, así que no hace falta un hash lento como argon2).
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  /**
   * Responde enseguida y procesa en segundo plano: así la respuesta es la
   * misma — en contenido y en tiempo — exista o no el correo, y un fallo
   * del proveedor de correo no le llega a quien pidió el enlace (queda en
   * Auditoría vía `MailService`).
   */
  request(email: string): { message: string } {
    void this.processRequest(email).catch((error: unknown) =>
      this.logger.error(
        'Falló la solicitud de recuperación de contraseña',
        error instanceof Error ? error.stack : undefined,
      ),
    );
    return { message: REQUEST_MESSAGE };
  }

  async processRequest(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.active) {
      return;
    }

    const token = randomBytes(32).toString('base64url');
    // Borrar los pendientes y crear el nuevo juntos: pedir un enlace nuevo
    // invalida el anterior.
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_LINK_TTL_MS),
        },
      }),
    ]);

    await this.audit.record({
      actorType: AuditActorType.SYSTEM,
      action: 'PASSWORD_RESET_REQUESTED',
      entity: 'User',
      entityId: user.id,
    });

    const panelUrl =
      this.config.get('PANEL_URL', { infer: true }) ?? DEV_PANEL_URL;
    const link = new URL('/restablecer-contrasena', panelUrl);
    link.searchParams.set('token', token);

    await this.mail.sendPasswordReset(
      { to: user.email, name: user.name, link: link.href },
      { entity: 'User', entityId: user.id },
    );
  }

  async confirm(token: string, password: string): Promise<void> {
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { active: true } } },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt <= new Date() ||
      !resetToken.user.active
    ) {
      throw new BadRequestException(INVALID_LINK_MESSAGE);
    }

    const passwordData = await passwordChangeData(password);

    await this.prisma.$transaction(async (tx) => {
      // Marcar como usado solo si sigue sin usar: si dos requests llegan a
      // la vez con el mismo enlace, solo una cambia la contraseña.
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0) {
        throw new BadRequestException(INVALID_LINK_MESSAGE);
      }

      await tx.user.update({
        where: { id: resetToken.userId },
        data: passwordData,
      });
      await tx.passwordResetToken.deleteMany({
        where: { userId: resetToken.userId, usedAt: null },
      });
    });

    await this.audit
      .record({
        actorType: AuditActorType.SYSTEM,
        action: 'PASSWORD_RESET_COMPLETED',
        entity: 'User',
        entityId: resetToken.userId,
      })
      .catch((error: unknown) =>
        this.logger.error(
          'No se pudo registrar en Auditoría el restablecimiento',
          error instanceof Error ? error.stack : undefined,
        ),
      );
  }
}

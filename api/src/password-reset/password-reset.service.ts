import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AuditActorType } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { panelLink } from '../config/panel-url';
import { ValidatedEnv } from '../config/validate-env';
import { MailService } from '../mail/mail.service';
import { PasswordPolicyService } from '../password-policy/password-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { hashToken, newLinkToken } from './password-link.service';

export { hashToken };

export const RESET_LINK_TTL_MS = 60 * 60 * 1000;

/**
 * Pedidos por usuario y por hora (auditoría de seguridad, corrida 1): igual que
 * la recuperación del enlace del diagnóstico, para que nadie pueda llenarle la
 * bandeja a un usuario del panel ni reemplazarle el enlace a cada rato.
 */
export const RESET_REQUESTS_PER_HOUR = 3;

export const REQUEST_MESSAGE =
  'Si el correo está registrado, te enviamos un enlace para restablecer la contraseña.';

/** Mismo mensaje para inválido, vencido o usado: no da pistas de cuál. */
const INVALID_LINK_CODE = 'INVALID_RESET_LINK';
export const INVALID_LINK_MESSAGE =
  'El enlace no es válido, ya se usó o venció. Pide uno nuevo.';

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
    private readonly passwordPolicy: PasswordPolicyService,
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

    const { token, record } = newLinkToken(RESET_LINK_TTL_MS);
    const issued = await this.prisma.$transaction(async (tx) => {
      // Serializa los pedidos del mismo usuario: el tope no se salta en paralelo.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`password-reset:${user.id}`}))`;

      // Se cuenta en la bitácora y no en los tokens: cada pedido borra los anteriores.
      const recent = await tx.auditLog.count({
        where: {
          entity: 'User',
          entityId: user.id,
          action: 'PASSWORD_RESET_REQUESTED',
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });
      if (recent >= RESET_REQUESTS_PER_HOUR) {
        await this.audit.record(
          {
            actorType: AuditActorType.SYSTEM,
            action: 'PASSWORD_RESET_LIMITED',
            entity: 'User',
            entityId: user.id,
          },
          tx,
        );
        return false;
      }

      // Borrar los pendientes y crear el nuevo juntos: pedir un enlace nuevo
      // invalida el anterior.
      await tx.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      });
      await tx.passwordResetToken.create({
        data: { userId: user.id, ...record },
      });
      await this.audit.record(
        {
          actorType: AuditActorType.SYSTEM,
          action: 'PASSWORD_RESET_REQUESTED',
          entity: 'User',
          entityId: user.id,
        },
        tx,
      );
      return true;
    });
    if (!issued) return;

    const link = panelLink(this.config, '/reset-password');
    link.searchParams.set('token', token);

    await this.mail.sendPasswordReset(
      { to: user.email, name: user.name, link: link.href },
      { entity: 'User', entityId: user.id },
    );
  }

  /** Sin bloquear: la respuesta no debe tardar distinto por esto. */
  private recordRejected(userId?: string): void {
    this.audit
      .record({
        actorType: AuditActorType.SYSTEM,
        action: 'PASSWORD_RESET_REJECTED',
        entity: 'User',
        entityId: userId,
      })
      .catch((error: unknown) =>
        this.logger.error(
          'No se pudo registrar en Auditoría el enlace rechazado',
          error instanceof Error ? error.stack : undefined,
        ),
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
      this.recordRejected(resetToken?.userId);
      throw new BadRequestException({
        message: INVALID_LINK_MESSAGE,
        code: INVALID_LINK_CODE,
      });
    }

    // Después de validar el enlace: con uno inválido no se consulta nada fuera.
    // El enlace sigue sin usar, así que se puede probar con otra contraseña.
    await this.passwordPolicy.assertNotBreached(password);

    const passwordHash = await argon2.hash(password);

    await this.prisma.$transaction(async (tx) => {
      // Marcar como usado solo si sigue sin usar: si dos requests llegan a
      // la vez con el mismo enlace, solo una cambia la contraseña.
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0) {
        this.recordRejected(resetToken.userId);
        throw new BadRequestException({
          message: INVALID_LINK_MESSAGE,
          code: INVALID_LINK_CODE,
        });
      }

      // Sube `sessionVersion` para cerrar las sesiones abiertas.
      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          passwordSetAt: new Date(),
          sessionVersion: { increment: 1 },
        },
      });
      await tx.passwordResetToken.deleteMany({
        where: { userId: resetToken.userId, usedAt: null },
      });

      // Levanta el bloqueo por intentos, salvo que haya códigos de MFA
      // rechazados hace poco: si no, recuperar la contraseña permitiría seguir
      // probando códigos sin límite. Ese bloqueo vence solo, en 15 minutos.
      const unlocked = await this.users.unlockAfterPasswordReset(
        tx,
        resetToken.userId,
      );
      if (unlocked) {
        await this.audit.record(
          {
            actorType: AuditActorType.SYSTEM,
            action: 'ACCOUNT_UNLOCKED',
            entity: 'User',
            entityId: resetToken.userId,
          },
          tx,
        );
      }
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

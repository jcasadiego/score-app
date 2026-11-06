import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { hashToken, newLinkToken } from '../common/link-token';
import { AuditActorType } from '../../generated/prisma/enums';
import { panelLink } from '../config/panel-url';
import { ValidatedEnv } from '../config/validate-env';
import type { PasswordSetupReason } from '../mail/templates/emails';
import { MailService } from '../mail/mail.service';

/**
 * Vigencia del enlace para definir la contraseña cuando no la pidió su dueño
 * (cuenta nueva o restablecida por un Aprobador): puede no ver el correo
 * enseguida. El que pide el propio dueño vence en 1 hora (`RESET_LINK_TTL_MS`).
 */
export const SETUP_LINK_TTL_MS = 72 * 60 * 60 * 1000;

export { hashToken, newLinkToken };

/**
 * Hash de una contraseña aleatoria que no se guarda en ningún lado: la cuenta
 * no tiene una contraseña usable, y nadie, ni quien la creó, puede entrar con ella.
 */
export function unusablePasswordHash(): Promise<string> {
  return argon2.hash(randomBytes(32).toString('base64url'));
}

interface LinkRecipient {
  id: string;
  name: string;
  email: string;
}

/**
 * Enlaces de un solo uso con los que el dueño de una cuenta del panel define su
 * contraseña sin que nadie más la conozca (PF-59). Reutiliza `PasswordResetToken`
 * y la pantalla `/reset-password`.
 */
@Injectable()
export class PasswordLinkService {
  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  /**
   * Deja la cuenta sin contraseña usable, cierra sus sesiones y retos de MFA en
   * curso y crea un enlace nuevo. Devuelve el token, que se manda con `send`
   * después del commit para no avisar de un cambio que no llegó a guardarse.
   */
  async revokePassword(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<string> {
    const passwordHash = await unusablePasswordHash();
    const { token, record } = newLinkToken(SETUP_LINK_TTL_MS);
    // Antes del `create`: un enlace pendiente ya enviado deja de servir.
    await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordSetAt: null,
        sessionVersion: { increment: 1 },
        sessions: { deleteMany: {} },
        passwordResetTokens: { create: record },
      },
    });
    return token;
  }

  /** `MailService` nunca lanza: un fallo de envío queda en la bitácora. */
  async send(
    user: LinkRecipient,
    token: string,
    reason: PasswordSetupReason,
    actorId: string,
  ): Promise<boolean> {
    const link = panelLink(this.config, '/reset-password');
    link.searchParams.set('token', token);

    const result = await this.mail.sendPasswordSetup(
      {
        to: user.email,
        name: user.name,
        link: link.href,
        reason,
        ttlHours: SETUP_LINK_TTL_MS / 3_600_000,
      },
      {
        entity: 'User',
        entityId: user.id,
        actorType: AuditActorType.PANEL_USER,
        actorId,
      },
    );
    return result.sent;
  }
}

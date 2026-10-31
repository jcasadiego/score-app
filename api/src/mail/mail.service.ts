import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditActorType } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { ValidatedEnv } from '../config/validate-env';
import { MAIL_PORT, MailPort, SendResult } from './mail.port';
import {
  diagnosticLinkEmail,
  linkRecoveryEmail,
  LinkMailData,
  passwordResetEmail,
} from './templates/emails';
import { RenderedEmail } from './templates/base-template';

export type MailType = 'DIAGNOSTIC_LINK' | 'LINK_RECOVERY' | 'PASSWORD_RESET';

/** A qué se asocia el envío en la bitácora (ej. el Caso que lo pidió). */
export interface MailContext {
  entity?: string;
  entityId?: string;
  actorType?: AuditActorType;
  actorId?: string;
}

export interface LinkMailRecipient extends LinkMailData {
  to: string;
}

/** `ana.perez@dominio.com` → `a***@dominio.com`, para la bitácora. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return domain ? `${local.slice(0, 1)}***@${domain}` : '***';
}

/**
 * Única puerta de salida de correo de la API: los módulos piden "enviar
 * este correo" y no saben qué proveedor hay detrás (`MAIL_PORT`).
 * Nunca lanza: devuelve `{ sent: false, reason }` y cada intento, bien
 * o mal, queda en la bitácora — sin el enlace ni el contenido del correo.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_PORT) private readonly provider: MailPort,
    private readonly audit: AuditService,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  sendDiagnosticLink(
    recipient: LinkMailRecipient,
    context?: MailContext,
  ): Promise<SendResult> {
    return this.send(
      'DIAGNOSTIC_LINK',
      recipient.to,
      diagnosticLinkEmail(recipient, this.brand()),
      context,
    );
  }

  sendLinkRecovery(
    recipient: LinkMailRecipient,
    context?: MailContext,
  ): Promise<SendResult> {
    return this.send(
      'LINK_RECOVERY',
      recipient.to,
      linkRecoveryEmail(recipient, this.brand()),
      context,
    );
  }

  sendPasswordReset(
    recipient: LinkMailRecipient,
    context?: MailContext,
  ): Promise<SendResult> {
    return this.send(
      'PASSWORD_RESET',
      recipient.to,
      passwordResetEmail(recipient, this.brand()),
      context,
    );
  }

  private brand() {
    return { logoUrl: this.config.get('MAIL_LOGO_URL', { infer: true }) };
  }

  private async send(
    type: MailType,
    to: string,
    email: RenderedEmail,
    context: MailContext = {},
  ): Promise<SendResult> {
    let result: SendResult;
    try {
      result = await this.provider.send({ to, ...email });
    } catch (error) {
      result = {
        sent: false,
        reason: error instanceof Error ? error.message : 'error desconocido',
      };
    }

    // `in` y no `!result.sent`: sin strictNullChecks, TS no estrecha la
    // unión por el literal booleano.
    if ('reason' in result) {
      this.logger.warn(
        `No se pudo enviar ${type} a ${maskEmail(to)}: ${result.reason}`,
      );
    }

    await this.recordAudit(type, to, result, context);
    return result;
  }

  private async recordAudit(
    type: MailType,
    to: string,
    result: SendResult,
    context: MailContext,
  ) {
    try {
      await this.audit.record({
        actorType: context.actorType ?? AuditActorType.SYSTEM,
        actorId: context.actorId,
        action: result.sent ? 'EMAIL_SENT' : 'EMAIL_FAILED',
        entity: context.entity ?? 'Email',
        entityId: context.entityId,
        data: {
          type,
          recipient: maskEmail(to),
          ...('reason' in result
            ? { reason: result.reason }
            : { providerId: result.providerId }),
        },
      });
    } catch (error) {
      // La bitácora caída tampoco debe romper la operación que pidió el correo.
      this.logger.error(
        `No se pudo registrar en la bitácora el envío ${type}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

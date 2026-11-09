import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiagnosticFamily, UserRole } from '../../generated/prisma/enums';
import { panelLink } from '../config/panel-url';
import { ValidatedEnv } from '../config/validate-env';
import { MailService } from '../mail/mail.service';
import { SendResult } from '../mail/mail.port';
import { UsersService } from '../users/users.service';

export interface NewLeadNotification {
  id: string;
  name: string;
  family: DiagnosticFamily;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export interface DiagnosticCompletedNotification {
  diagnosticId: string;
  leadName: string;
  family: DiagnosticFamily;
}

/**
 * Quién recibe cada aviso: solo el rol que tiene que actuar (PF-38). El lead
 * nuevo lo atiende el Aprobador, que registra el pago y genera el diagnóstico;
 * el diagnóstico completado lo revisan ambos roles. Los dos roles pueden ver
 * leads y diagnósticos, así que nadie recibe datos que no puede ver en el panel.
 */
export const NOTICE_RECIPIENTS = {
  NEW_LEAD: [UserRole.ADMIN],
  DIAGNOSTIC_COMPLETED: [UserRole.ADMIN, UserRole.REVIEWER],
} as const satisfies Record<string, readonly UserRole[]>;

type Notice = keyof typeof NOTICE_RECIPIENTS;

/**
 * Avisos por correo al equipo: van a los usuarios activos con el rol que
 * corresponde (`NOTICE_RECIPIENTS`). Quien dispara el aviso no lo espera y no puede fallar por él: se procesa en
 * segundo plano y cada envío, bien o mal, queda en Auditoría vía `MailService`.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  notifyNewLead(lead: NewLeadNotification): void {
    this.notifyTeam('NEW_LEAD', (to) =>
      this.mail.sendNewLeadNotice(
        to,
        {
          name: lead.name,
          family: lead.family,
          utmSource: lead.utmSource,
          utmMedium: lead.utmMedium,
          utmCampaign: lead.utmCampaign,
          link: panelLink(this.config, '/leads').href,
        },
        { entity: 'Lead', entityId: lead.id },
      ),
    );
  }

  /**
   * Lo dispara el envío del diagnóstico (`DiagnosticSessionsService.submit`).
   * El enlace apunta al detalle del panel, `/diagnostics/:id`.
   */
  notifyDiagnosticCompleted(diagnostic: DiagnosticCompletedNotification): void {
    const id = encodeURIComponent(diagnostic.diagnosticId);
    this.notifyTeam('DIAGNOSTIC_COMPLETED', (to) =>
      this.mail.sendDiagnosticCompletedNotice(
        to,
        {
          leadName: diagnostic.leadName,
          family: diagnostic.family,
          link: panelLink(this.config, `/diagnostics/${id}`).href,
        },
        { entity: 'Diagnostic', entityId: diagnostic.diagnosticId },
      ),
    );
  }

  private notifyTeam(
    notice: Notice,
    send: (to: string) => Promise<SendResult>,
  ): void {
    void this.sendToRecipients(NOTICE_RECIPIENTS[notice], send).catch(
      (error: unknown) =>
        this.logger.error(
          `Falló el aviso ${notice} al equipo`,
          error instanceof Error ? error.stack : undefined,
        ),
    );
  }

  /** Uno por uno y no en paralelo, para no chocar con el límite del proveedor. */
  private async sendToRecipients(
    roles: readonly UserRole[],
    send: (to: string) => Promise<SendResult>,
  ): Promise<void> {
    for (const email of await this.users.findActiveEmails(roles)) {
      await send(email);
    }
  }
}

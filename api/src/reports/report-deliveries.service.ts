import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import {
  AuditActorType,
  DiagnosticFamily,
  ReportPart,
  ReportStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { hashToken, newLinkToken } from '../common/link-token';
import { diagnosticLink } from '../config/diagnostic-url';
import type { ValidatedEnv } from '../config/validate-env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertVersion } from '../reviews/etag';
import { REVIEW_NOT_APPROVED } from '../reviews/review-codes';
import { type Actor, ReviewsService } from '../reviews/reviews.service';
import {
  CURRENT_TEMPLATE_VERSION,
  hasTemplate,
  renderReportPdf,
  type ReportPdfData,
  sha256Hex,
} from './pdf/report-pdf';
import {
  INVALID_REPORT_LINK,
  REPORT_DELIVERY_BLOCKED,
  REPORT_EMAIL_FAILED,
  REPORT_NOT_APPROVED,
  REPORT_OUTDATED,
  REPORT_PDF_INTEGRITY_FAILED,
  REPORT_VERSION_MISMATCH_ERROR,
} from './report-codes';
import { dimensionsOf, REPORT_PARTS } from './report-dimensions';
import { lockReport, lockReview, reportNotFound } from './report-locks';

/** Mismo mensaje para inválido, vencido o revocado: no da pistas de cuál. */
export const INVALID_REPORT_LINK_MESSAGE =
  'El enlace no es válido o ya venció. Escríbenos y te enviamos uno nuevo.';

/** Nombre del archivo que descarga el cliente: sin datos suyos. */
export const REPORT_FILENAME = 'informe-score.pdf';

/**
 * La transacción de la entrega espera al proveedor de correo: más que los 5 s
 * por defecto de Prisma, y el correo se corta antes de que ella venza.
 */
const DELIVERY_TX_TIMEOUT_MS = 30_000;
const MAIL_TIMEOUT_MS = 20_000;

const PART_ORDER = REPORT_PARTS.map(({ part }) => part);

interface SectionText {
  dimension: string;
  position: number;
  part: ReportPart;
  body: string;
}

/** Las secciones en el orden del informe: por dimensión y, dentro, por parte. */
function toDimensions(sections: SectionText[]): ReportPdfData['dimensions'] {
  const sorted = [...sections].sort(
    (a, b) =>
      a.position - b.position ||
      a.dimension.localeCompare(b.dimension) ||
      PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part),
  );
  const dimensions: ReportPdfData['dimensions'] = [];
  for (const { dimension, part, body } of sorted) {
    let current = dimensions[dimensions.length - 1];
    if (current?.code !== dimension) {
      current = { code: dimension, parts: [] };
      dimensions.push(current);
    }
    current.parts.push({ part, body });
  }
  return dimensions;
}

/**
 * Entrega del informe (PF-42): PDF, correo con el enlace de descarga, reenvío y
 * descarga pública. El PDF no se guarda: se genera a pedido desde la versión
 * aprobada y cada entrega anota su SHA-256 y su plantilla; al descargar se
 * vuelve a generar y debe dar la misma huella.
 */
@Injectable()
export class ReportDeliveriesService {
  private readonly logger = new Logger(ReportDeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly reviews: ReviewsService,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  /**
   * Entrega el informe aprobado o, si ya se entregó, reenvía el enlace: en los
   * dos casos sale un correo con un enlace nuevo y el anterior queda revocado.
   * Antes vuelve a comprobar que el caso siga aprobado, con la misma aprobación
   * con que se redactó el informe y sin nada que hoy impediría aprobarlo.
   *
   * El correo sale dentro de la transacción, al final: si no sale, no queda
   * entrega, enlace ni cambio de estado, y se puede reintentar. (Si el correo
   * saliera y la transacción fallara al cerrar, el cliente tendría un enlace
   * que no sirve y el Aprobador un error: al reintentar llega uno válido.)
   */
  async deliver(reviewId: string, expectedVersion: number, actor: Actor) {
    return this.prisma.$transaction(
      async (tx) => {
        await lockReview(tx, reviewId);
        const report = await lockReport(tx, reviewId);
        assertVersion(
          report.version,
          expectedVersion,
          REPORT_VERSION_MISMATCH_ERROR,
        );
        if (report.status === ReportStatus.DRAFT) {
          throw new ConflictException({
            message:
              'El informe no está aprobado. Un Aprobador debe aprobarlo antes de entregarlo.',
            code: REPORT_NOT_APPROVED,
          });
        }
        const resend = report.status === ReportStatus.DELIVERED;
        // Ya se había entregado y el caso cambió después (reabierto o
        // recalculado): el cliente recibe la versión actualizada.
        const updatedReport =
          !resend &&
          (await tx.reportDelivery.count({ where: { reportId: report.id } })) >
            0;

        const reviewApproval = await tx.reviewApproval.findFirst({
          where: { reviewId, voidedAt: null },
          select: { id: true, aiExceptionReason: true },
        });
        if (!reviewApproval) {
          throw new ConflictException({
            message:
              'El caso ya no está aprobado: el informe no se puede enviar.',
            code: REVIEW_NOT_APPROVED,
          });
        }
        if (reviewApproval.id !== report.reviewApprovalId) {
          throw new ConflictException({
            message:
              'El resultado del caso cambió desde que se redactó el informe: no se puede enviar.',
            code: REPORT_OUTDATED,
          });
        }
        const blockers = await this.reviews.blockersOfApproved(
          tx,
          reviewId,
          reviewApproval.aiExceptionReason,
        );
        if (blockers.length > 0) {
          throw new ConflictException({
            message: 'El caso tiene pendientes: el informe no se puede enviar.',
            code: REPORT_DELIVERY_BLOCKED,
            errors: blockers,
          });
        }

        const approval = await tx.reportApproval.findFirstOrThrow({
          where: { reportId: report.id, voidedAt: null },
          select: { id: true },
        });
        const { lead, family } = await this.recipient(tx, reviewId);
        const data = await this.approvedPdfData(tx, approval.id, {
          recipientName: lead.name,
          family,
        });
        const templateVersion = CURRENT_TEMPLATE_VERSION;
        const pdfSha256 = sha256Hex(
          await renderReportPdf(data, templateVersion),
        );

        const now = new Date();
        const { count: revokedLinks } = await tx.reportDownloadLink.updateMany({
          where: { reportId: report.id, revokedAt: null },
          data: { revokedAt: now },
        });
        const ttlDays = this.config.get('REPORT_LINK_TTL_DAYS', {
          infer: true,
        });
        const { token, record } = newLinkToken(ttlDays * 24 * 60 * 60 * 1000);
        const delivery = await tx.reportDelivery.create({
          data: {
            reportId: report.id,
            reportApprovalId: approval.id,
            recipientName: lead.name,
            recipientEmail: lead.email,
            pdfSha256,
            templateVersion,
            deliveredById: actor.id,
          },
          select: { id: true, createdAt: true },
        });
        const link = await tx.reportDownloadLink.create({
          data: { deliveryId: delivery.id, reportId: report.id, ...record },
          select: { id: true, expiresAt: true },
        });
        const updated = await tx.report.update({
          where: { id: report.id },
          data: { status: ReportStatus.DELIVERED, version: { increment: 1 } },
          select: { version: true },
        });
        // Sin el correo de destino ni el enlace: quedan en la entrega.
        await this.audit.record(
          {
            actorType: AuditActorType.PANEL_USER,
            actorId: actor.id,
            action: resend
              ? 'REPORT_LINK_RESENT'
              : updatedReport
                ? 'REPORT_REDELIVERED'
                : 'REPORT_DELIVERED',
            entity: 'Report',
            entityId: report.id,
            data: {
              reviewId,
              deliveryId: delivery.id,
              downloadLinkId: link.id,
              reportApprovalId: approval.id,
              templateVersion,
              pdfSha256,
              revokedLinks,
            },
          },
          tx,
        );

        const sent = await this.sendLink(
          {
            to: lead.email,
            name: lead.name,
            link: this.linkUrl(token),
            updated: updatedReport,
          },
          ttlDays,
          report.id,
          actor,
        );
        if (!sent) {
          throw new ServiceUnavailableException({
            message:
              'No se pudo enviar el correo al cliente. El informe no se marcó como entregado; vuelve a intentarlo.',
            code: REPORT_EMAIL_FAILED,
          });
        }
        return {
          id: delivery.id,
          resend,
          updated: updatedReport,
          deliveredAt: delivery.createdAt,
          linkExpiresAt: link.expiresAt,
          reportVersion: updated.version,
        };
      },
      { timeout: DELIVERY_TX_TIMEOUT_MS },
    );
  }

  /** Cada envío del informe, del más reciente al más antiguo. */
  async list(reviewId: string) {
    const report = await this.prisma.report.findUnique({
      where: { reviewId },
      select: { id: true },
    });
    if (!report) throw reportNotFound(reviewId);
    const deliveries = await this.prisma.reportDelivery.findMany({
      where: { reportId: report.id },
      select: {
        id: true,
        recipientEmail: true,
        pdfSha256: true,
        templateVersion: true,
        deliveredBy: { select: { id: true, name: true } },
        createdAt: true,
        downloadLink: {
          select: {
            expiresAt: true,
            revokedAt: true,
            _count: { select: { downloads: true } },
            downloads: {
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return deliveries.map(({ downloadLink: link, ...delivery }) => ({
      ...delivery,
      link: {
        expiresAt: link.expiresAt,
        revokedAt: link.revokedAt,
        downloads: link._count.downloads,
        lastDownloadAt: link.downloads[0]?.createdAt ?? null,
      },
    }));
  }

  /**
   * El PDF del informe tal como está hoy, para verlo en el panel antes de
   * aprobarlo o entregarlo. Con el nombre actual del lead; un borrador lleva la
   * fecha de su último cambio.
   */
  async preview(reviewId: string): Promise<Buffer> {
    const report = await this.prisma.report.findUnique({
      where: { reviewId },
      select: {
        updatedAt: true,
        reviewApproval: {
          select: { calculation: { select: { output: true } } },
        },
        approvals: { where: { voidedAt: null }, select: { approvedAt: true } },
        sections: {
          select: {
            dimension: true,
            position: true,
            part: true,
            revisions: {
              select: { body: true },
              orderBy: { sequence: 'desc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!report) throw reportNotFound(reviewId);
    const { lead, family } = await this.recipient(this.prisma, reviewId);
    // Solo las dimensiones del resultado con que se redactó (como `findOne`).
    const dimensions = dimensionsOf(report.reviewApproval.calculation.output);
    return renderReportPdf({
      recipientName: lead.name,
      family,
      approvedAt: report.approvals[0]?.approvedAt ?? report.updatedAt,
      dimensions: toDimensions(
        report.sections
          .filter((s) => dimensions.includes(s.dimension))
          .map(({ revisions: [current], ...section }) => ({
            ...section,
            body: current.body,
          })),
      ),
    });
  }

  /**
   * Descarga pública con el token del enlace. Un token solo abre el informe de
   * su entrega (autorización por objeto). El PDF se genera de nuevo desde la
   * versión aprobada y solo se entrega si da la huella anotada al enviarlo.
   */
  async download(token: string): Promise<Buffer> {
    const link = await this.prisma.reportDownloadLink.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        reportId: true,
        expiresAt: true,
        revokedAt: true,
        delivery: {
          select: {
            id: true,
            reportApprovalId: true,
            recipientName: true,
            pdfSha256: true,
            templateVersion: true,
            report: {
              select: {
                review: {
                  select: {
                    diagnosticId: true,
                    diagnostic: {
                      select: {
                        questionnaireVersion: { select: { family: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!link || link.revokedAt || link.expiresAt <= new Date()) {
      this.recordRejected(link?.reportId);
      throw new UnauthorizedException({
        message: INVALID_REPORT_LINK_MESSAGE,
        code: INVALID_REPORT_LINK,
      });
    }
    const { delivery } = link;
    const { review } = delivery.report;

    const pdf = hasTemplate(delivery.templateVersion)
      ? await renderReportPdf(
          await this.approvedPdfData(this.prisma, delivery.reportApprovalId, {
            recipientName: delivery.recipientName,
            family: review.diagnostic.questionnaireVersion.family,
          }),
          delivery.templateVersion,
        )
      : null;
    if (!pdf || sha256Hex(pdf) !== delivery.pdfSha256) {
      // Sin datos del cliente: solo qué entrega dejó de reproducirse.
      this.logger.error(
        `El PDF de la entrega ${delivery.id} no reproduce la huella anotada (plantilla ${delivery.templateVersion})`,
      );
      await this.audit.record({
        actorType: AuditActorType.SYSTEM,
        action: 'REPORT_PDF_INTEGRITY_FAILED',
        entity: 'Report',
        entityId: link.reportId,
        data: { deliveryId: delivery.id, downloadLinkId: link.id },
      });
      throw new InternalServerErrorException({
        message:
          'No pudimos preparar tu informe. Escríbenos para enviártelo de nuevo.',
        code: REPORT_PDF_INTEGRITY_FAILED,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reportDownload.create({ data: { linkId: link.id } });
      await this.audit.record(
        {
          actorType: AuditActorType.END_CLIENT,
          actorId: review.diagnosticId,
          action: 'REPORT_DOWNLOADED',
          entity: 'Report',
          entityId: link.reportId,
          data: { deliveryId: delivery.id, downloadLinkId: link.id },
        },
        tx,
      );
    });
    return pdf;
  }

  /** A quién va el informe: el lead del diagnóstico del caso. */
  private async recipient(client: Prisma.TransactionClient, reviewId: string) {
    const { diagnostic } = await client.review.findUniqueOrThrow({
      where: { id: reviewId },
      select: {
        diagnostic: {
          select: {
            lead: { select: { name: true, email: true } },
            questionnaireVersion: { select: { family: true } },
          },
        },
      },
    });
    return {
      lead: diagnostic.lead,
      family: diagnostic.questionnaireVersion.family,
    };
  }

  /** Los datos del PDF de una aprobación: sus versiones exactas, que no cambian. */
  private async approvedPdfData(
    client: Prisma.TransactionClient,
    approvalId: string,
    header: { recipientName: string; family: DiagnosticFamily },
  ): Promise<ReportPdfData> {
    const approval = await client.reportApproval.findUniqueOrThrow({
      where: { id: approvalId },
      select: {
        approvedAt: true,
        revisions: {
          select: {
            revision: {
              select: {
                body: true,
                section: {
                  select: { dimension: true, position: true, part: true },
                },
              },
            },
          },
        },
      },
    });
    return {
      ...header,
      approvedAt: approval.approvedAt,
      dimensions: toDimensions(
        approval.revisions.map(({ revision }) => ({
          ...revision.section,
          body: revision.body,
        })),
      ),
    };
  }

  /** `MailService` nunca lanza; aquí además se corta si el proveedor no responde. */
  private async sendLink(
    recipient: { to: string; name: string; link: string; updated: boolean },
    ttlDays: number,
    reportId: string,
    actor: Actor,
  ): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), MAIL_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        this.mail
          .sendReportLink(
            { ...recipient, ttlDays },
            {
              entity: 'Report',
              entityId: reportId,
              actorType: AuditActorType.PANEL_USER,
              actorId: actor.id,
            },
          )
          .then((result) => result.sent),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * El token va en el fragmento (`#`): el navegador no lo manda al servidor de
   * `apps/diagnostico`, así que no queda en sus logs ni en el `Referer`.
   */
  private linkUrl(token: string): string {
    const url = diagnosticLink(this.config, '/report');
    url.hash = new URLSearchParams({ token }).toString();
    return url.href;
  }

  /** Sin bloquear: la respuesta no debe tardar distinto por esto. */
  private recordRejected(reportId?: string): void {
    this.audit
      .record({
        actorType: AuditActorType.SYSTEM,
        action: 'REPORT_LINK_REJECTED',
        entity: 'Report',
        entityId: reportId,
      })
      .catch((error: unknown) =>
        this.logger.error(
          'No se pudo registrar el enlace de informe rechazado',
          error instanceof Error ? error.stack : undefined,
        ),
      );
  }
}

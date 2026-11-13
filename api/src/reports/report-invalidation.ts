import { Prisma } from '../../generated/prisma/client';
import {
  ApprovalVoidCause,
  AuditActorType,
  ReportApprovalVoidCause,
  ReportStatus,
} from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';

/** La causa en la aprobación del informe, según qué pasó con la revisión. */
const REPORT_CAUSE: Record<ApprovalVoidCause, ReportApprovalVoidCause> = {
  REOPENED: ReportApprovalVoidCause.REVIEW_REOPENED,
  RECALCULATED: ReportApprovalVoidCause.REVIEW_RECALCULATED,
};

/**
 * En la transacción que anula la aprobación de una revisión (reabrir o
 * recalcular), con la revisión ya bloqueada: si su informe estaba aprobado o
 * entregado, vuelve a borrador y su aprobación queda anulada con la misma
 * causa. Si ya se había entregado, además se revocan los enlaces de descarga
 * del cliente: el PDF que recibió ya no refleja el caso. Queda pendiente de
 * actualizar, aprobar y entregar de nuevo (decisión de José, 2026-11-13).
 * Función suelta y no un servicio para que el módulo de revisión no dependa
 * del de informes.
 */
export async function voidReportApproval(
  tx: Prisma.TransactionClient,
  audit: AuditService,
  reviewId: string,
  cause: ApprovalVoidCause,
  actorId?: string,
): Promise<void> {
  const [report] = await tx.$queryRaw<{ id: string; status: ReportStatus }[]>`
    SELECT id, status FROM reports WHERE review_id = ${reviewId} FOR UPDATE
  `;
  if (!report || report.status === ReportStatus.DRAFT) return;
  const wasDelivered = report.status === ReportStatus.DELIVERED;

  const now = new Date();
  const voided = await tx.reportApproval.updateMany({
    where: { reportId: report.id, voidedAt: null },
    data: {
      voidedAt: now,
      voidCause: REPORT_CAUSE[cause],
      voidedById: actorId ?? null,
    },
  });
  const { count: revokedLinks } = wasDelivered
    ? await tx.reportDownloadLink.updateMany({
        where: { reportId: report.id, revokedAt: null },
        data: { revokedAt: now },
      })
    : { count: 0 };
  await tx.report.update({
    where: { id: report.id },
    data: { status: ReportStatus.DRAFT, version: { increment: 1 } },
  });
  if (voided.count > 0 || revokedLinks > 0) {
    await audit.record(
      {
        actorType: actorId ? AuditActorType.PANEL_USER : AuditActorType.SYSTEM,
        actorId,
        action: 'REPORT_APPROVAL_VOIDED',
        entity: 'Report',
        entityId: report.id,
        data: { reviewId, cause, wasDelivered, revokedLinks },
      },
      tx,
    );
  }
}

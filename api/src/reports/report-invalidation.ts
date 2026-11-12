import { Prisma } from '../../generated/prisma/client';
import {
  ApprovalVoidCause,
  AuditActorType,
  ReportStatus,
} from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';

/**
 * En la transacción que anula la aprobación de una revisión (reabrir o
 * recalcular), con la revisión ya bloqueada: si su informe estaba aprobado,
 * vuelve a borrador y su aprobación queda anulada con la misma causa. Función
 * suelta y no un servicio para que el módulo de revisión no dependa del de
 * informes.
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
  if (!report || report.status !== ReportStatus.APPROVED) return;

  const voided = await tx.reportApproval.updateMany({
    where: { reportId: report.id, voidedAt: null },
    data: {
      voidedAt: new Date(),
      voidCause: cause,
      voidedById: actorId ?? null,
    },
  });
  await tx.report.update({
    where: { id: report.id },
    data: { status: ReportStatus.DRAFT, version: { increment: 1 } },
  });
  if (voided.count > 0) {
    await audit.record(
      {
        actorType: actorId ? AuditActorType.PANEL_USER : AuditActorType.SYSTEM,
        actorId,
        action: 'REPORT_APPROVAL_VOIDED',
        entity: 'Report',
        entityId: report.id,
        data: { reviewId, cause },
      },
      tx,
    );
  }
}

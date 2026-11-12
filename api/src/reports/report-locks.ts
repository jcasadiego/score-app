import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ReportStatus } from '../../generated/prisma/enums';

/** La fila del informe bloqueada con `FOR UPDATE` al cambiarlo. */
export interface LockedReport {
  id: string;
  status: ReportStatus;
  version: number;
  reviewApprovalId: string;
}

export function reportNotFound(reviewId: string) {
  return new NotFoundException(
    `La revisión ${reviewId} no tiene un informe todavía`,
  );
}

/**
 * Orden de bloqueo: la revisión antes que el informe, igual que al anular la
 * aprobación de la revisión (`voidReportApproval`).
 */
export async function lockReview(
  tx: Prisma.TransactionClient,
  reviewId: string,
): Promise<void> {
  const [review] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM reviews WHERE id = ${reviewId} FOR UPDATE
  `;
  if (!review) {
    throw new NotFoundException(`Revisión ${reviewId} no encontrada`);
  }
}

export async function lockReport(
  tx: Prisma.TransactionClient,
  reviewId: string,
): Promise<LockedReport> {
  const [report] = await tx.$queryRaw<LockedReport[]>`
    SELECT id, status, version, review_approval_id AS "reviewApprovalId"
    FROM reports WHERE review_id = ${reviewId} FOR UPDATE
  `;
  if (!report) throw reportNotFound(reviewId);
  return report;
}

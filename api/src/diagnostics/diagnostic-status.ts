import { Prisma } from '../../generated/prisma/client';
import { DiagnosticStatus } from '../../generated/prisma/enums';

/** Días sin actividad del cliente tras los que un diagnóstico está abandonado. */
export const ABANDONMENT_DAYS = 7;

/** Estado que expone la API: el guardado, más el abandono calculado. */
export const DiagnosticViewStatus = {
  ...DiagnosticStatus,
  ABANDONED: 'ABANDONED',
} as const;
export type DiagnosticViewStatus =
  (typeof DiagnosticViewStatus)[keyof typeof DiagnosticViewStatus];

export function abandonmentCutoff(now = new Date()): Date {
  return new Date(now.getTime() - ABANDONMENT_DAYS * 24 * 60 * 60 * 1000);
}

/** Sin guardarlo ni usar cron: se calcula desde `lastActivityAt` al consultar. */
export function viewStatus(
  diagnostic: { status: DiagnosticStatus; lastActivityAt: Date },
  now = new Date(),
): DiagnosticViewStatus {
  if (
    diagnostic.status !== DiagnosticStatus.COMPLETED &&
    diagnostic.lastActivityAt < abandonmentCutoff(now)
  ) {
    return DiagnosticViewStatus.ABANDONED;
  }
  return diagnostic.status;
}

/** El mismo criterio, como filtro de la base. */
export function statusFilter(
  status: DiagnosticViewStatus,
  now = new Date(),
): Prisma.DiagnosticWhereInput {
  const cutoff = abandonmentCutoff(now);
  if (status === DiagnosticViewStatus.ABANDONED) {
    return {
      status: { not: DiagnosticStatus.COMPLETED },
      lastActivityAt: { lt: cutoff },
    };
  }
  if (status === DiagnosticStatus.COMPLETED) return { status };
  return { status, lastActivityAt: { gte: cutoff } };
}

import {
  CalculationStatus,
  FlagAnalysisStatus,
  ReviewStatus,
} from '../../generated/prisma/enums';
import type { ProblemError } from '../common/problem-details';

/** Lo que decide si un caso se puede aprobar. */
export interface ApprovalState {
  /** El último intento de cálculo; nulo si el caso no tiene ninguno. */
  latest: {
    status: CalculationStatus;
    isSimulated: boolean | null;
    /** La última corrección que entró en su `input`. */
    correctionSequence: number;
    analysisStatus: FlagAnalysisStatus | null;
    openFlags: number;
  } | null;
  /** La corrección más reciente del caso (0 si no hay). */
  lastCorrectionSequence: number;
  /** `APP_ENV=production`. */
  production: boolean;
  /** Motivo para aprobar sin un análisis de IA exitoso. */
  aiExceptionReason?: string;
}

/**
 * Todo lo que falta para aprobar, como errores RFC 9457. Vacío = se puede.
 * Las condiciones de análisis y flags miran el último intento: si ese no es
 * exitoso, ya hay un bloqueo y no aplican.
 */
export function approvalBlockers(state: ApprovalState): ProblemError[] {
  const { latest } = state;
  if (!latest) {
    return [
      {
        code: 'NO_CALCULATION',
        message: 'El caso no tiene ningún cálculo del motor.',
      },
    ];
  }
  if (latest.status !== CalculationStatus.SUCCEEDED) {
    return [
      {
        code: 'LATEST_CALCULATION_NOT_SUCCEEDED',
        message:
          latest.status === CalculationStatus.FAILED
            ? 'El último intento de cálculo falló. Recalcula antes de aprobar.'
            : 'El último cálculo sigue en curso. Espera a que termine.',
      },
    ];
  }

  const blockers: ProblemError[] = [];
  if (latest.correctionSequence < state.lastCorrectionSequence) {
    blockers.push({
      code: 'CORRECTIONS_NOT_CALCULATED',
      message:
        'Hay correcciones que el último cálculo no incluye. Recalcula antes de aprobar.',
    });
  }
  const analysisOk = latest.analysisStatus === FlagAnalysisStatus.SUCCEEDED;
  if (!analysisOk && !state.aiExceptionReason?.trim()) {
    blockers.push({
      code: 'FLAG_ANALYSIS_NOT_SUCCEEDED',
      message:
        latest.analysisStatus === FlagAnalysisStatus.FAILED
          ? 'El análisis con IA falló. Reinténtalo o registra una excepción con motivo.'
          : 'El análisis con IA no ha terminado. Espera, o registra una excepción con motivo si la IA no está disponible.',
    });
  }
  if (latest.openFlags > 0) {
    blockers.push({
      code: 'OPEN_FLAGS',
      message:
        latest.openFlags === 1
          ? 'Queda 1 alerta abierta: márcala como revisada o descartada.'
          : `Quedan ${latest.openFlags} alertas abiertas: márcalas como revisadas o descartadas.`,
    });
  }
  if (state.production && latest.isSimulated !== false) {
    blockers.push({
      code: 'SIMULATED_RESULT',
      message: 'En producción no se aprueba un resultado simulado.',
    });
  }
  return blockers;
}

/** El motivo de excepción solo cuenta si el análisis no terminó bien. */
export function usedAiException(state: ApprovalState): string | null {
  const reason = state.aiExceptionReason?.trim();
  if (!reason) return null;
  return state.latest?.analysisStatus === FlagAnalysisStatus.SUCCEEDED
    ? null
    : reason;
}

/** El estado guardado sale de la aprobación vigente y de quién tiene el caso. */
export function reviewStatusFor(
  approved: boolean,
  assigneeId: string | null,
): ReviewStatus {
  if (approved) return ReviewStatus.APPROVED;
  return assigneeId ? ReviewStatus.IN_REVIEW : ReviewStatus.PENDING;
}

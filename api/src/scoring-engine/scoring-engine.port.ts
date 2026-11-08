import type { DiagnosticFamily } from '../../generated/prisma/enums';

export const SCORING_ENGINE_PORT = Symbol('SCORING_ENGINE_PORT');

/** Motores disponibles (`SCORING_ENGINE_DRIVER`). PF-26 agregará el real. */
export type ScoringEngineDriver = 'disabled' | 'stub';

/**
 * Respuesta a una pregunta: el `value` de la opción elegida, la lista de
 * `value` en selección múltiple, o el texto libre.
 */
export type ScoringAnswer = string | string[];

/** Lo que recibe el motor. Las preguntas se identifican por su `code`. */
export interface ScoringInput {
  family: DiagnosticFamily;
  questionnaireVersion: number;
  answers: Record<string, ScoringAnswer>;
}

export interface ScoringOutput {
  /** Resultado tal cual lo devuelve el motor. */
  result: Record<string, unknown>;
  /** Número de la `RuleSetVersion` que aplicó. */
  ruleSetVersionNumber: number;
  /** `true` si el resultado no viene de un motor real. */
  simulated: boolean;
}

/**
 * Límite entre la API y el motor de cálculo de SCORE. Ningún módulo llama al
 * motor directo: todo pasa por aquí. Qué hay detrás depende del escenario real
 * del motor (PF-26); mientras tanto, `disabled` o el adapter simulado.
 */
export interface ScoringEnginePort {
  readonly driver: ScoringEngineDriver;
  /** Con `false`, los cálculos quedan pendientes y no se llama a `evaluate`. */
  readonly enabled: boolean;
  evaluate(input: ScoringInput): Promise<ScoringOutput>;
}

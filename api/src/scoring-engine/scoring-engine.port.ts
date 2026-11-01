export const SCORING_ENGINE_PORT = Symbol('SCORING_ENGINE_PORT');

export interface EvaluateDiagnosticInput {
  familyId: string;
  answers: Record<string, unknown>;
}

export interface EvaluateDiagnosticResult {
  result: Record<string, unknown>;
  ruleSetVersionNumber: number;
}

/**
 * Límite entre la API y el motor de cálculo de SCORE. Qué hay detrás de
 * esta interfaz depende del escenario del motor (API ya ejecutable, hoja
 * de cálculo a portar, o a construir desde cero) — mientras eso se
 * confirma, `StubScoringEngineAdapter` la implementa con un resultado de
 * ejemplo para no bloquear el resto de la API.
 */
export interface ScoringEnginePort {
  evaluateDiagnostic(
    input: EvaluateDiagnosticInput,
  ): Promise<EvaluateDiagnosticResult>;
}

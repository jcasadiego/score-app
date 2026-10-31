import { Injectable } from '@nestjs/common';
import {
  EvaluateDiagnosticInput,
  EvaluateDiagnosticResult,
  ScoringEnginePort,
} from '../scoring-engine.port';

/**
 * TODO: reemplazar cuando se confirme el escenario del motor real
 * (API ya ejecutable / hoja de cálculo a portar / construir desde cero —
 * ver CLAUDE.md sección 3). Devuelve un resultado de ejemplo para que el
 * resto de la API se pueda construir y probar contra el puerto ya
 * definido.
 */
@Injectable()
export class StubScoringEngineAdapter implements ScoringEnginePort {
  async evaluateDiagnostic(
    input: EvaluateDiagnosticInput,
  ): Promise<EvaluateDiagnosticResult> {
    return {
      result: {
        familyId: input.familyId,
        score: null,
        pending: 'motor real no implementado',
      },
      ruleSetVersionNumber: 0,
    };
  }
}

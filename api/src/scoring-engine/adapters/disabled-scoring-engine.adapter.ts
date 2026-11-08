import { Injectable } from '@nestjs/common';
import type { ScoringEnginePort, ScoringOutput } from '../scoring-engine.port';

/** Motor apagado: nadie debe llamarlo, y si lo hace, falla sin calcular. */
@Injectable()
export class DisabledScoringEngineAdapter implements ScoringEnginePort {
  readonly driver = 'disabled' as const;
  readonly enabled = false;

  evaluate(): Promise<ScoringOutput> {
    return Promise.reject(new Error('El motor de cálculo está desactivado.'));
  }
}

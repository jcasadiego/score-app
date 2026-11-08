import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ValidatedEnv } from '../config/validate-env';
import { RulesModule } from '../rules/rules.module';
import { RulesService } from '../rules/rules.service';
import { DisabledScoringEngineAdapter } from './adapters/disabled-scoring-engine.adapter';
import { SimulatedScoringEngineAdapter } from './adapters/simulated-scoring-engine.adapter';
import { SCORING_ENGINE_PORT } from './scoring-engine.port';

/**
 * Elige el motor con `SCORING_ENGINE_DRIVER` al arrancar: cambiarlo es cambiar
 * la variable y reiniciar, sin desplegar código. En desarrollo, sin valor, usa
 * el simulado; en producción la variable es obligatoria (`validate-env.ts`).
 */
@Module({
  imports: [RulesModule],
  providers: [
    {
      provide: SCORING_ENGINE_PORT,
      inject: [ConfigService, RulesService],
      useFactory: (
        config: ConfigService<ValidatedEnv, true>,
        rules: RulesService,
      ) => {
        const driver =
          config.get('SCORING_ENGINE_DRIVER', { infer: true }) ?? 'stub';
        if (driver === 'disabled') return new DisabledScoringEngineAdapter();
        const adapter = new SimulatedScoringEngineAdapter(rules);
        return adapter;
      },
    },
  ],
  exports: [SCORING_ENGINE_PORT],
})
export class ScoringEngineModule {}

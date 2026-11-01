import { Module } from '@nestjs/common';
import { StubScoringEngineAdapter } from './adapters/stub-scoring-engine.adapter';
import { SCORING_ENGINE_PORT } from './scoring-engine.port';

@Module({
  providers: [
    {
      provide: SCORING_ENGINE_PORT,
      useClass: StubScoringEngineAdapter,
    },
  ],
  exports: [SCORING_ENGINE_PORT],
})
export class ScoringEngineModule {}

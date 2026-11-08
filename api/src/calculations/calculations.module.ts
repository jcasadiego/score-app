import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { FlagsModule } from '../flags/flags.module';
import { ScoringEngineModule } from '../scoring-engine/scoring-engine.module';
import { CalculationsController } from './calculations.controller';
import { CalculationsService } from './calculations.service';
import { ScoringEngineStatusController } from './scoring-engine-status.controller';

@Module({
  imports: [AuditModule, AuthModule, ScoringEngineModule, FlagsModule],
  controllers: [CalculationsController, ScoringEngineStatusController],
  providers: [CalculationsService],
  exports: [CalculationsService],
})
export class CalculationsModule {}

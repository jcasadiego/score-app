import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LegacyPrequalificationController } from './legacy/legacy-prequalification.controller';

@Module({
  controllers: [LeadsController, LegacyPrequalificationController],
  providers: [LeadsService],
})
export class LeadsModule {}

import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LegacyPrequalificationController } from './legacy/legacy-prequalification.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [LeadsController, LegacyPrequalificationController],
  providers: [LeadsService],
})
export class LeadsModule {}

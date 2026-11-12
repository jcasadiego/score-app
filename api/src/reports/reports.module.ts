import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { ReportDeliveriesService } from './report-deliveries.service';
import { ReportDownloadsController } from './report-downloads.controller';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuditModule, AuthModule, AiModule, MailModule, ReviewsModule],
  controllers: [ReportsController, ReportDownloadsController],
  providers: [ReportsService, ReportDeliveriesService],
  exports: [ReportsService],
})
export class ReportsModule {}

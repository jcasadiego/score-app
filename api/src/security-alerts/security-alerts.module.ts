import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { SecurityAlertsScheduler } from './security-alerts.scheduler';
import { SecurityAlertsService } from './security-alerts.service';

@Module({
  imports: [MailModule],
  providers: [SecurityAlertsService, SecurityAlertsScheduler],
  exports: [SecurityAlertsService],
})
export class SecurityAlertsModule {}

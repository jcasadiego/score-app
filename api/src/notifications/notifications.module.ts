import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { NoticeBudgetService } from './notice-budget.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [MailModule, UsersModule],
  providers: [NotificationsService, NoticeBudgetService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

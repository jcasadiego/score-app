import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CalculationsModule } from '../calculations/calculations.module';
import { CrmModule } from '../crm/crm.module';
import { FlagsModule } from '../flags/flags.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { AccessLinkGuard } from './access-link.guard';
import { AccessLinkRecoveriesController } from './access-link-recoveries.controller';
import { AccessLinksService } from './access-links.service';
import { AnswerRecordingsService } from './answer-recordings.service';
import { DiagnosticSessionsController } from './diagnostic-sessions.controller';
import { DiagnosticSessionsService } from './diagnostic-sessions.service';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    CalculationsModule,
    CrmModule,
    FlagsModule,
    MailModule,
    NotificationsModule,
    StorageModule,
    JwtModule.register({}),
  ],
  controllers: [
    DiagnosticsController,
    DiagnosticSessionsController,
    AccessLinkRecoveriesController,
  ],
  providers: [
    AccessLinksService,
    AccessLinkGuard,
    AnswerRecordingsService,
    DiagnosticsService,
    DiagnosticSessionsService,
  ],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}

import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DiagnosticsModule } from '../diagnostics/diagnostics.module';
import {
  LeadPaymentsController,
  PaymentsController,
} from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuditModule, AuthModule, DiagnosticsModule],
  controllers: [PaymentsController, LeadPaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}

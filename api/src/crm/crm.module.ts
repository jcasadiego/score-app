import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CrmSyncScheduler } from './crm-sync.scheduler';
import { CrmSyncService } from './crm-sync.service';
import { CrmController } from './crm.controller';

/** Sincronización con el CRM (PF-80). Los módulos del recorrido dejan eventos. */
@Module({
  imports: [AuditModule],
  controllers: [CrmController],
  providers: [CrmSyncService, CrmSyncScheduler],
  exports: [CrmSyncService],
})
export class CrmModule {}

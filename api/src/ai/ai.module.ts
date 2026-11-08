import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AiService } from './ai.service';

/** Servicio de IA compartido. Sin rutas: lo usan otros módulos (Flags, Delivery). */
@Module({
  imports: [AuditModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}

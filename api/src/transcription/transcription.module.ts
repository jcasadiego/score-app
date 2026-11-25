import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionScheduler } from './transcription.scheduler';
import { TranscriptionService } from './transcription.service';

/** Transcripción de las grabaciones de voz (PF-88). */
@Module({
  imports: [AuditModule, StorageModule],
  controllers: [TranscriptionController],
  providers: [TranscriptionService, TranscriptionScheduler],
  exports: [TranscriptionService],
})
export class TranscriptionModule {}

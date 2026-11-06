import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { QuestionnaireVersionsController } from './questionnaire-versions.controller';
import { QuestionnaireVersionsService } from './questionnaire-versions.service';

@Module({
  imports: [AuditModule],
  controllers: [QuestionnaireVersionsController],
  providers: [QuestionnaireVersionsService],
  exports: [QuestionnaireVersionsService],
})
export class QuestionnaireModule {}

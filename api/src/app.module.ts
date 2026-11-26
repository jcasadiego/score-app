import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AiModule } from './ai/ai.module';
import { AuditModule } from './audit/audit.module';
import { FlagsModule } from './flags/flags.module';
import { ReviewsModule } from './reviews/reviews.module';
import { ReportsModule } from './reports/reports.module';
import { AuthModule } from './auth/auth.module';
import { AppThrottlerGuard } from './common/app-throttler.guard';
import { MailModule } from './mail/mail.module';
import { HealthModule } from './health/health.module';
import { LeadsModule } from './leads/leads.module';
import { CrmModule } from './crm/crm.module';
import { SecurityAlertsModule } from './security-alerts/security-alerts.module';
import { TranscriptionModule } from './transcription/transcription.module';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { PasswordResetModule } from './password-reset/password-reset.module';
import { QuestionnaireModule } from './questionnaire/questionnaire.module';
import { RulesModule } from './rules/rules.module';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { UsersModule } from './users/users.module';
import { ValidatedEnv, validateEnv } from './config/validate-env';
import { PostgresThrottlerStorage } from './common/postgres-throttler.storage';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, PrismaService],
      useFactory: (
        config: ConfigService<ValidatedEnv, true>,
        prisma: PrismaService,
      ) => ({
        throttlers: [
          {
            ttl: config.get('THROTTLE_TTL', { infer: true }),
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
        // En la base, para que el límite valga con varias instancias (PF-60).
        storage:
          config.get('THROTTLE_STORAGE', { infer: true }) === 'postgres'
            ? new PostgresThrottlerStorage(prisma)
            : undefined,
      }),
    }),
    PrismaModule,
    ScheduleModule.forRoot(),
    CrmModule,
    SecurityAlertsModule,
    TranscriptionModule,
    AuditModule,
    AiModule,
    FlagsModule,
    ReviewsModule,
    ReportsModule,
    RulesModule,
    UsersModule,
    AuthModule,
    DiagnosticsModule,
    LeadsModule,
    QuestionnaireModule,
    MailModule,
    PasswordResetModule,
    PaymentsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}

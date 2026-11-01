import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AppThrottlerGuard } from './common/app-throttler.guard';
import { MailModule } from './mail/mail.module';
import { HealthModule } from './health/health.module';
import { LeadsModule } from './leads/leads.module';
import { ScoringEngineModule } from './scoring-engine/scoring-engine.module';
import { PrismaModule } from './prisma/prisma.module';
import { PasswordResetModule } from './password-reset/password-reset.module';
import { RulesModule } from './rules/rules.module';
import { AccessLinkModule } from './access-link/access-link.module';
import { UsersModule } from './users/users.module';
import { validateEnv } from './config/validate-env';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL ?? 60_000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 100),
      },
    ]),
    PrismaModule,
    AuditModule,
    RulesModule,
    ScoringEngineModule,
    UsersModule,
    AuthModule,
    AccessLinkModule,
    LeadsModule,
    MailModule,
    PasswordResetModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}

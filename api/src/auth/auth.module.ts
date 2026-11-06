import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { MailModule } from '../mail/mail.module';
import { PasswordLinkModule } from '../password-reset/password-link.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { MfaService } from './mfa.service';
import { RolesGuard } from './roles.guard';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    AuditModule,
    MailModule,
    PasswordLinkModule,
    PassportModule,
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    MfaService,
    JwtStrategy,
    RolesGuard,
    SessionsService,
  ],
  exports: [RolesGuard, MfaService],
})
export class AuthModule {}

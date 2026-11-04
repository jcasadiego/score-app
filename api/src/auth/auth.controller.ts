import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import {
  MfaChallengeDto,
  VerifyMfaCodeDto,
  VerifyRecoveryCodeDto,
} from './dto/mfa.dto';
import { MfaService } from './mfa.service';
import { AuditRoute } from '../audit/audit-route.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { SessionUser } from './jwt.strategy';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Límite propio, más estricto que el global, como mitigación de fuerza
  // bruta sobre credenciales.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditRoute({ byService: true })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  /** Devuelve el secreto una sola vez; pedirlo otra vez lo reemplaza. */
  @Post('mfa/enrollment')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditRoute({ byService: true })
  startMfaEnrollment(@Body() dto: MfaChallengeDto) {
    return this.mfa.startEnrollment(dto.mfaToken);
  }

  @Post('mfa/enrollment/confirmation')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditRoute({ byService: true })
  async confirmMfaEnrollment(@Body() dto: VerifyMfaCodeDto) {
    const { user, recoveryCodes } = await this.mfa.confirmEnrollment(
      dto.mfaToken,
      dto.code,
    );
    return { ...(await this.auth.completeLogin(user)), recoveryCodes };
  }

  @Post('mfa/verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditRoute({ byService: true })
  async verifyMfaCode(@Body() dto: VerifyMfaCodeDto) {
    const user = await this.mfa.verifyCode(dto.mfaToken, dto.code);
    return this.auth.completeLogin(user);
  }

  @Post('mfa/recovery')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditRoute({ byService: true })
  async verifyRecoveryCode(@Body() dto: VerifyRecoveryCodeDto) {
    const user = await this.mfa.verifyRecoveryCode(
      dto.mfaToken,
      dto.recoveryCode,
    );
    return this.auth.completeLogin(user);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @AuditRoute({ action: 'SESSION_REFRESHED', entity: 'UserSession' })
  refresh(@Req() req: { user: SessionUser }) {
    return this.auth.refresh(req.user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @AuditRoute({ action: 'LOGOUT', entity: 'UserSession' })
  logout(@Req() req: { user: SessionUser }) {
    return this.auth.logout(req.user);
  }

  /** 204 si la sesión sigue valiendo; si no, `JwtAuthGuard` responde 401. */
  @Get('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  checkSession(): void {}
}

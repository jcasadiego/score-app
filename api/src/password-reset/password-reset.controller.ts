import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RedactInAudit } from '../audit/redact-in-audit.decorator';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { PasswordResetService } from './password-reset.service';

/**
 * Rutas públicas (sin JWT) para que un usuario del panel recupere el
 * acceso. Límites propios, más estrictos que el global: una evita el
 * spam de correos, la otra el intento de adivinar tokens.
 */
@ApiTags('auth')
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly passwordReset: PasswordResetService) {}

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @RedactInAudit('email')
  request(@Body() dto: RequestPasswordResetDto) {
    return this.passwordReset.request(dto.email);
  }

  /** `token` y `password` ya se redactan en la bitácora por defecto. */
  @Post('confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  confirm(@Body() dto: ConfirmPasswordResetDto) {
    return this.passwordReset.confirm(dto.token, dto.password);
  }
}

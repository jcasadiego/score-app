import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RedactarEnAuditoria } from '../auditoria/redactar-en-auditoria.decorator';
import { RestablecerContrasenaDto } from './dto/restablecer-contrasena.dto';
import { SolicitarRecuperacionDto } from './dto/solicitar-recuperacion.dto';
import { RecuperacionContrasenaService } from './recuperacion-contrasena.service';

/**
 * Rutas públicas (sin JWT) para que un usuario del panel recupere el
 * acceso. Límites propios, más estrictos que el global: una evita el
 * spam de correos, la otra el intento de adivinar tokens.
 */
@ApiTags('auth')
@Controller('auth/password-reset')
export class RecuperacionContrasenaController {
  constructor(private readonly recuperacion: RecuperacionContrasenaService) {}

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @RedactarEnAuditoria('email')
  solicitar(@Body() dto: SolicitarRecuperacionDto) {
    return this.recuperacion.solicitar(dto.email);
  }

  /** `token` y `password` ya se redactan en la bitácora por defecto. */
  @Post('confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  restablecer(@Body() dto: RestablecerContrasenaDto) {
    return this.recuperacion.restablecer(dto.token, dto.password);
  }
}

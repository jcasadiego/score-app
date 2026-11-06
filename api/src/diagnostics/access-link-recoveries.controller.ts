import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuditRoute } from '../audit/audit-route.decorator';
import { AccessLinksService } from './access-links.service';
import { RecoverAccessLinkDto } from './dto/recover-access-link.dto';

/**
 * Ruta pública para que el cliente final pida su enlace de nuevo. Siempre 202
 * con el mismo mensaje: no delata si el correo tiene un diagnóstico. Además del
 * límite por IP, el servicio tiene un tope por correo destino.
 */
@ApiTags('diagnostic-sessions')
@Controller('access-link-recoveries')
export class AccessLinkRecoveriesController {
  constructor(private readonly accessLinks: AccessLinksService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  // Sin el correo: la bitácora no debe delatar quién tiene un diagnóstico.
  @AuditRoute({ action: 'ACCESS_LINK_RECOVERY_RECEIVED', entity: 'Diagnostic' })
  recover(@Body() dto: RecoverAccessLinkDto) {
    return this.accessLinks.requestRecovery(dto.email);
  }
}

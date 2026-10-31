import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RedactarEnAuditoria } from '../auditoria/redactar-en-auditoria.decorator';
import { CrearLeadDto } from './dto/crear-lead.dto';
import { LeadsService } from './leads.service';

/**
 * Endpoint público que consume el formulario de precalificación de
 * `score-sitio` desde el navegador — sin auth de usuario a propósito.
 * Contrato en `docs/contrato-precalificacion.md`.
 */
@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post('precalificacion')
  @HttpCode(HttpStatus.CREATED)
  // Límite propio por IP, más estricto que el global, contra spam del
  // formulario público.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  // Datos personales del lead: ya viven en la tabla Lead, no se duplican
  // en la bitácora.
  @RedactarEnAuditoria('nombre', 'email', 'telefono')
  crear(@Body() dto: CrearLeadDto) {
    return this.leads.crear(dto);
  }
}

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RedactarEnAuditoria } from '../../auditoria/redactar-en-auditoria.decorator';
import { LeadStatus } from '../../../generated/prisma/enums';
import { LeadsService } from '../leads.service';
import { LegacyErrorFilter } from './legacy-error.filter';
import {
  LEGACY_FAMILY,
  LegacyPrequalificationDto,
} from './legacy-prequalification.dto';

const LEGACY_STATUS: Record<LeadStatus, string> = {
  NEW: 'NUEVO',
  CONTACTED: 'CONTACTADO',
  CONVERTED: 'CONVERTIDO',
};

/**
 * TODO: borrar cuando `score-sitio` use `POST /leads/prequalification`
 * (CLAUDE.md, sección 10, fase 1). Mantiene el contrato viejo —
 * request, respuesta y forma de error en español — traduciendo hacia y
 * desde el servicio actual.
 */
@ApiTags('leads')
@Controller('leads')
@UseFilters(LegacyErrorFilter)
export class LegacyPrequalificationController {
  constructor(private readonly leads: LeadsService) {}

  @Post('precalificacion')
  @ApiOperation({
    deprecated: true,
    summary: 'Usar POST /leads/prequalification',
  })
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RedactarEnAuditoria('nombre', 'email', 'telefono')
  async create(@Body() dto: LegacyPrequalificationDto) {
    const lead = await this.leads.crear({
      name: dto.nombre,
      email: dto.email,
      phone: dto.telefono,
      family: LEGACY_FAMILY[dto.familia],
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
    });
    return { id: lead.id, estado: LEGACY_STATUS[lead.status] };
  }
}

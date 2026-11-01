import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RedactInAudit } from '../audit/redact-in-audit.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../../generated/prisma/enums';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { LeadsService } from './leads.service';

/**
 * `POST prequalification` es el endpoint público que consume el formulario
 * de `score-sitio` desde el navegador (mientras el sitio migra, también
 * existe `POST precalificacion` en `legacy/`) — sin auth de usuario a propósito
 * (contrato en `docs/contrato-precalificacion.md`). El resto es para
 * `apps/panel` y exige JWT + ADMIN, por eso los guards van por método y
 * no en el controlador.
 */
@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post('prequalification')
  @HttpCode(HttpStatus.CREATED)
  // Límite propio por IP, más estricto que el global, contra spam del
  // formulario público.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  // Datos personales del lead: ya viven en la tabla Lead, no se duplican
  // en la bitácora.
  @RedactInAudit('name', 'email', 'phone')
  create(@Body() dto: CreateLeadDto) {
    return this.leads.create(dto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  list(@Query() query: ListLeadsDto) {
    return this.leads.list(query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.leads.findOne(id);
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateLeadStatusDto) {
    return this.leads.updateStatus(id, dto.status);
  }
}

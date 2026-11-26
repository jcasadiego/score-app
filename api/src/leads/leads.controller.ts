import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuditRoute } from '../audit/audit-route.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../../generated/prisma/enums';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { LeadsService } from './leads.service';
import { PrequalificationErrorFilter } from './prequalification-error.filter';

/**
 * `POST prequalification` es el endpoint público que consume el formulario
 * de `score-sitio` desde el navegador — sin auth de usuario a propósito
 * (contrato en `docs/contrato-precalificacion.md`). El resto es para
 * `apps/panel` y exige JWT + un rol del panel, por eso los guards van por método y
 * no en el controlador.
 */
@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post('prequalification')
  @UseFilters(PrequalificationErrorFilter)
  @HttpCode(HttpStatus.CREATED)
  // Límite propio por IP, más estricto que el global, contra spam del
  // formulario público.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  // Los datos del lead ya viven en su tabla: no se duplican. Los UTM tampoco
  // van, porque son texto libre de cualquiera y la bitácora no se borra: ahí
  // podría quedar un dato personal escrito en ellos.
  @AuditRoute({
    action: 'LEAD_CREATED',
    entity: 'Lead',
    fields: ['family'],
  })
  create(@Body() dto: CreateLeadDto) {
    return this.leads.create(dto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'LEADS_LISTED', entity: 'Lead' })
  list(@Query() query: ListLeadsDto) {
    return this.leads.list(query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'LEAD_VIEWED', entity: 'Lead' })
  findOne(@Param('id') id: string) {
    return this.leads.findOne(id);
  }
}

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
import { RedactarEnAuditoria } from '../auditoria/redactar-en-auditoria.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../../generated/prisma/enums';
import { CambiarEstadoLeadDto } from './dto/cambiar-estado-lead.dto';
import { CrearLeadDto } from './dto/crear-lead.dto';
import { ListarLeadsDto } from './dto/listar-leads.dto';
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
  @RedactarEnAuditoria('name', 'email', 'phone')
  crear(@Body() dto: CrearLeadDto) {
    return this.leads.crear(dto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  listar(@Query() query: ListarLeadsDto) {
    return this.leads.listar(query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  obtener(@Param('id') id: string) {
    return this.leads.obtener(id);
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  cambiarEstado(@Param('id') id: string, @Body() dto: CambiarEstadoLeadDto) {
    return this.leads.cambiarEstado(id, dto.status);
  }
}

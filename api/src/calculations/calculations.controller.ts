import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UserRole } from '../../generated/prisma/enums';
import { AuditRoute } from '../audit/audit-route.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CalculationsService } from './calculations.service';
import { ListCalculationsDto } from './dto/list-calculations.dto';

interface RequestWithUser extends Request {
  user: { id: string; role: string };
}

/**
 * Cálculos de un diagnóstico desde `apps/panel`. Ver y recalcular: Revisor y
 * Aprobador (CLAUDE.md 5.3, "Resultado del motor"). Las lecturas se auditan:
 * el detalle trae las respuestas del cliente.
 */
@ApiTags('calculations')
@ApiBearerAuth()
@Controller('diagnostics/:id/calculations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CalculationsController {
  constructor(private readonly calculations: CalculationsService) {}

  /** 202: el cálculo se procesa en segundo plano. 503 con el motor apagado. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  async request(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const calculation = await this.calculations.request(id, req.user);
    res.location(
      `/api/v1/diagnostics/${encodeURIComponent(id)}/calculations/${encodeURIComponent(calculation.id)}`,
    );
    return calculation;
  }

  /** Historial paginado; el primero es el último intento. */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'CALCULATIONS_LISTED', entity: 'Diagnostic' })
  list(@Param('id') id: string, @Query() query: ListCalculationsDto) {
    return this.calculations.list(id, query.page, query.pageSize);
  }

  /** El cálculo vigente (el último exitoso); 404 si todavía no hay. */
  @Get('current')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'CALCULATION_VIEWED', entity: 'Diagnostic' })
  current(@Param('id') id: string) {
    return this.calculations.current(id);
  }

  /** Detalle con lo enviado al motor (las respuestas) y lo recibido. */
  @Get(':calculationId')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'CALCULATION_VIEWED', entity: 'Diagnostic' })
  findOne(
    @Param('id') id: string,
    @Param('calculationId') calculationId: string,
  ) {
    return this.calculations.findOne(id, calculationId);
  }
}

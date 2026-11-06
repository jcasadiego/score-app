import {
  Body,
  Controller,
  Get,
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
import { CreateDiagnosticDto } from './dto/create-diagnostic.dto';
import { ListDiagnosticsDto } from './dto/list-diagnostics.dto';
import { DiagnosticsService } from './diagnostics.service';

interface RequestWithUser extends Request {
  user: { id: string };
}

/**
 * Diagnósticos desde `apps/panel`. Ver y reenviar el enlace: Revisor y
 * Aprobador. Generar sin pago (con motivo): solo Aprobador (CLAUDE.md 5.3). Las
 * lecturas se auditan porque muestran datos del cliente.
 */
@ApiTags('diagnostics')
@ApiBearerAuth()
@Controller('diagnostics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'DIAGNOSTICS_LISTED', entity: 'Diagnostic' })
  list(@Query() query: ListDiagnosticsDto) {
    return this.diagnostics.list(query);
  }

  /**
   * Responde el enlace una sola vez, para copiarlo; `emailSent: false` si el
   * correo no salió.
   */
  @Post()
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  async create(
    @Body() dto: CreateDiagnosticDto,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const created = await this.diagnostics.create(
      dto.leadId,
      dto.reason,
      req.user.id,
    );
    res.location(`/api/v1/diagnostics/${encodeURIComponent(created.id)}`);
    return created;
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'DIAGNOSTIC_VIEWED', entity: 'Diagnostic' })
  findOne(@Param('id') id: string) {
    return this.diagnostics.findOne(id);
  }

  /** Revoca los enlaces vigentes y envía uno nuevo por correo. */
  @Post(':id/access-links')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  resendLink(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.diagnostics.resendLink(id, req.user.id);
  }
}

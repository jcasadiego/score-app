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
import { ListFlagsDto } from './dto/list-flags.dto';
import { ReviewFlagDto } from './dto/review-flag.dto';
import { FlagsService } from './flags.service';

interface RequestWithUser extends Request {
  user: { id: string };
}

/**
 * Flags desde `apps/panel`. Ver y marcar revisada o descartada: Revisor y
 * Aprobador ("Alertas", CLAUDE.md 5.3); reintentar el análisis, igual que
 * recalcular. Las lecturas se auditan: los flags hablan de las respuestas.
 */
@ApiTags('flags')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  @Get('diagnostics/:id/flags')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'FLAGS_LISTED', entity: 'Diagnostic' })
  list(@Param('id') id: string, @Query() query: ListFlagsDto) {
    return this.flags.list(id, query.calculationId);
  }

  @Patch('flags/:id')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  review(
    @Param('id') id: string,
    @Body() dto: ReviewFlagDto,
    @Req() req: RequestWithUser,
  ) {
    return this.flags.review(id, dto.status, dto.note, req.user.id);
  }

  @Get('calculations/:id/flag-analysis')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'FLAG_ANALYSIS_VIEWED', entity: 'Calculation' })
  getAnalysis(@Param('id') id: string) {
    return this.flags.getAnalysis(id);
  }

  /** Reintenta un análisis fallido. 202; 409 si terminó bien o sigue en curso. */
  @Post('calculations/:id/flag-analysis')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  async requestAnalysis(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const analysis = await this.flags.requestAnalysis(id, req.user.id);
    res.location(
      `/api/v1/calculations/${encodeURIComponent(id)}/flag-analysis`,
    );
    return analysis;
  }
}

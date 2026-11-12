import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UserRole } from '../../generated/prisma/enums';
import { AuditRoute } from '../audit/audit-route.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { requireIfMatch, reviewEtag } from '../reviews/etag';
import type { Actor } from '../reviews/reviews.service';
import { ReopenReportDto } from './dto/reopen-report.dto';
import { UpdateSectionDto } from './dto/update-section.dto';
import { ReportDeliveriesService } from './report-deliveries.service';
import { ReportsService } from './reports.service';

interface RequestWithUser extends Request {
  user: Actor;
}

const IF_MATCH = {
  name: 'If-Match',
  required: true,
  description: 'ETag de `GET /reviews/:id/report` (la versión del informe).',
};

const SUBJECT = 'del informe';

/**
 * Informe del caso desde `apps/panel` (CLAUDE.md 5.3): generar, editar y
 * regenerar, ambos roles; aprobar, reabrir, entregar y reenviar el enlace, solo
 * el Aprobador. Las lecturas se auditan: traen el contenido del informe del
 * cliente.
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reviews/:reviewId/report')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly deliveries: ReportDeliveriesService,
  ) {}

  /** El informe con el texto vigente de cada sección. Devuelve el ETag. */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'REPORT_VIEWED', entity: 'Report' })
  async findOne(
    @Param('reviewId') reviewId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.findOne(reviewId);
    res.setHeader('ETag', reviewEtag(report.version));
    return report;
  }

  /**
   * Genera el borrador con IA. 409 sin la revisión aprobada o si ya existe;
   * 503 si la IA está desactivada o falla (no se guarda nada).
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  async generate(
    @Param('reviewId') reviewId: string,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.generate(reviewId, req.user);
    res.setHeader('ETag', reviewEtag(report.version));
    return report;
  }

  /** Vuelve a redactar todo el borrador con la aprobación vigente del caso. */
  @Post('regenerations')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  @ApiHeader(IF_MATCH)
  async regenerate(
    @Param('reviewId') reviewId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = requireIfMatch(ifMatch, SUBJECT);
    const report = await this.reports.regenerate(reviewId, expected, req.user);
    res.setHeader('ETag', reviewEtag(report.version));
    return report;
  }

  @Get('sections/:sectionId/revisions')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'REPORT_HISTORY_VIEWED', entity: 'Report' })
  listRevisions(
    @Param('reviewId') reviewId: string,
    @Param('sectionId') sectionId: string,
  ) {
    return this.reports.listRevisions(reviewId, sectionId);
  }

  /** Edita una sección. 428 sin If-Match, 412 si el informe cambió. */
  @Put('sections/:sectionId')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  @ApiHeader(IF_MATCH)
  async editSection(
    @Param('reviewId') reviewId: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateSectionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = requireIfMatch(ifMatch, SUBJECT);
    const report = await this.reports.editSection(
      reviewId,
      sectionId,
      dto.body,
      expected,
      req.user,
    );
    res.setHeader('ETag', reviewEtag(report.version));
    return report;
  }

  /** Pide a la IA que rehaga solo esta sección. */
  @Post('sections/:sectionId/regenerations')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  @ApiHeader(IF_MATCH)
  async regenerateSection(
    @Param('reviewId') reviewId: string,
    @Param('sectionId') sectionId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = requireIfMatch(ifMatch, SUBJECT);
    const report = await this.reports.regenerateSection(
      reviewId,
      sectionId,
      expected,
      req.user,
    );
    res.setHeader('ETag', reviewEtag(report.version));
    return report;
  }

  /**
   * Aprueba el informe tal como está. 409 si el caso ya no está aprobado o el
   * borrador quedó desactualizado. Solo el Aprobador.
   */
  @Post('approval')
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  @ApiHeader(IF_MATCH)
  async approve(
    @Param('reviewId') reviewId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = requireIfMatch(ifMatch, SUBJECT);
    const report = await this.reports.approve(reviewId, expected, req.user);
    res.setHeader('ETag', reviewEtag(report.version));
    return report;
  }

  /**
   * Reabre un informe aprobado, con motivo: vuelve a borrador sin tocar la
   * aprobación del caso. 409 si no está aprobado o si ya se entregó. Solo el
   * Aprobador.
   */
  @Post('reopenings')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  @ApiHeader(IF_MATCH)
  async reopen(
    @Param('reviewId') reviewId: string,
    @Body() dto: ReopenReportDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = requireIfMatch(ifMatch, SUBJECT);
    const report = await this.reports.reopen(
      reviewId,
      dto.reason,
      expected,
      req.user,
    );
    res.setHeader('ETag', reviewEtag(report.version));
    return report;
  }

  /** El PDF del informe tal como está hoy, para revisarlo en el panel. */
  @Get('pdf')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'REPORT_PDF_VIEWED', entity: 'Report' })
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'inline; filename="informe-score.pdf"')
  @Header('Cache-Control', 'no-store')
  async pdf(@Param('reviewId') reviewId: string): Promise<StreamableFile> {
    return new StreamableFile(await this.deliveries.preview(reviewId));
  }

  /** Cada envío del informe, con el estado de su enlace y sus descargas. */
  @Get('deliveries')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'REPORT_DELIVERIES_VIEWED', entity: 'Report' })
  listDeliveries(@Param('reviewId') reviewId: string) {
    return this.deliveries.list(reviewId);
  }

  /**
   * Entrega el informe aprobado por correo o, si ya se entregó, reenvía el
   * enlace (el anterior queda revocado). 409 si el informe no está aprobado o
   * el caso dejó de estarlo; 503 si el correo no sale (no queda entregado).
   * Solo el Aprobador.
   */
  @Post('deliveries')
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  @ApiHeader(IF_MATCH)
  async deliver(
    @Param('reviewId') reviewId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = requireIfMatch(ifMatch, SUBJECT);
    const { reportVersion, ...delivery } = await this.deliveries.deliver(
      reviewId,
      expected,
      req.user,
    );
    res.setHeader('ETag', reviewEtag(reportVersion));
    return delivery;
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UserRole } from '../../generated/prisma/enums';
import { AuditRoute } from '../audit/audit-route.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApproveReviewDto } from './dto/approve-review.dto';
import { CreateCorrectionDto } from './dto/create-correction.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { ListReviewsDto } from './dto/list-reviews.dto';
import { ReopenReviewDto } from './dto/reopen-review.dto';
import { requireIfMatch, reviewEtag } from './etag';
import { type Actor, ReviewsService } from './reviews.service';

interface RequestWithUser extends Request {
  user: Actor;
}

const IF_MATCH = {
  name: 'If-Match',
  required: true,
  description: 'ETag de `GET /reviews/:id` (la versión del caso).',
};

/**
 * Revisión desde `apps/panel` (CLAUDE.md 5.3): ver, tomar, liberar el propio,
 * corregir y escribir notas, ambos roles; aprobar y reabrir, solo el
 * Aprobador; liberar un caso ajeno, el servicio lo limita al Aprobador. Las
 * lecturas se auditan: traen datos del cliente.
 */
@ApiTags('reviews')
@ApiBearerAuth()
@Controller('reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Bandeja: diagnósticos completados con un cálculo exitoso. */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'REVIEWS_LISTED', entity: 'Review' })
  list(@Query() query: ListReviewsDto, @Req() req: RequestWithUser) {
    return this.reviews.list(query, req.user);
  }

  /** El caso y lo que falta para aprobarlo. Devuelve el ETag para If-Match. */
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'REVIEW_VIEWED', entity: 'Review' })
  async findOne(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const review = await this.reviews.findOne(id);
    res.setHeader('ETag', reviewEtag(review.version));
    return review;
  }

  /** Tomar el caso. 409 si otra persona activa ya lo tiene. */
  @Put(':id/assignment')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  async take(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const review = await this.reviews.take(id, req.user);
    res.setHeader('ETag', reviewEtag(review.version));
    return review;
  }

  /** Liberar el caso. Uno ajeno, solo el Aprobador (403 si no). */
  @Delete(':id/assignment')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  release(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.reviews.release(id, req.user);
  }

  @Get(':id/corrections')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'CORRECTIONS_LISTED', entity: 'Review' })
  listCorrections(@Param('id') id: string) {
    return this.reviews.listCorrections(id);
  }

  /** Corrige una respuesta. 428 sin If-Match, 412 si el caso cambió. */
  @Post(':id/corrections')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  @ApiHeader(IF_MATCH)
  async correct(
    @Param('id') id: string,
    @Body() dto: CreateCorrectionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = requireIfMatch(ifMatch);
    const { correction, version } = await this.reviews.correct(
      id,
      dto,
      expected,
      req.user,
    );
    res.setHeader('ETag', reviewEtag(version));
    return correction;
  }

  @Get(':id/notes')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ action: 'REVIEW_NOTES_LISTED', entity: 'Review' })
  listNotes(@Param('id') id: string) {
    return this.reviews.listNotes(id);
  }

  @Post(':id/notes')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @AuditRoute({ byService: true })
  addNote(
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
    @Req() req: RequestWithUser,
  ) {
    return this.reviews.addNote(id, dto, req.user);
  }

  /**
   * Aprueba atado al último cálculo. 409 con lo que falta en `errors`; 428 sin
   * If-Match y 412 si el caso cambió. Solo el Aprobador.
   */
  @Post(':id/approval')
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  @ApiHeader(IF_MATCH)
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveReviewDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expected = requireIfMatch(ifMatch);
    const approval = await this.reviews.approve(id, dto, expected, req.user);
    res.setHeader('ETag', reviewEtag(await this.reviews.version(id)));
    return approval;
  }

  /** Reabre una aprobación vigente, con motivo. Solo el Aprobador. */
  @Post(':id/reopenings')
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  reopen(
    @Param('id') id: string,
    @Body() dto: ReopenReviewDto,
    @Req() req: RequestWithUser,
  ) {
    return this.reviews.reopen(id, dto.reason, req.user);
  }
}

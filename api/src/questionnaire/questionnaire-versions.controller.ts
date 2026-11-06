import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/enums';
import { AuditRoute } from '../audit/audit-route.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateQuestionnaireVersionDto } from './dto/create-questionnaire-version.dto';
import { ListQuestionnaireVersionsDto } from './dto/list-questionnaire-versions.dto';
import { QuestionOrderDto } from './dto/question-order.dto';
import { QuestionDto } from './dto/question.dto';
import { QuestionnaireVersionsService } from './questionnaire-versions.service';

interface RequestWithUser extends Request {
  user: { id: string };
}

/**
 * Administración del cuestionario desde `apps/panel` (PF-12). Ver: Revisor y
 * Aprobador. Crear, editar y publicar: solo Aprobador (CLAUDE.md, 5.3). El
 * cuestionario no tiene datos personales, así que las lecturas no se auditan.
 */
@ApiTags('questionnaire-versions')
@ApiBearerAuth()
@Controller('questionnaire-versions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuestionnaireVersionsController {
  constructor(private readonly versions: QuestionnaireVersionsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  list(@Query() query: ListQuestionnaireVersionsDto) {
    return this.versions.list(query);
  }

  /** Borrador nuevo, con las preguntas de la última versión publicada. */
  @Post()
  @Roles(UserRole.ADMIN)
  @AuditRoute({
    action: 'QUESTIONNAIRE_DRAFT_CREATED',
    entity: 'QuestionnaireVersion',
    fields: ['family'],
  })
  create(
    @Body() dto: CreateQuestionnaireVersionDto,
    @Req() req: RequestWithUser,
  ) {
    return this.versions.createDraft(dto.family, req.user.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  findOne(@Param('id') id: string) {
    return this.versions.findOne(id);
  }

  @Post(':id/questions')
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  addQuestion(
    @Param('id') id: string,
    @Body() dto: QuestionDto,
    @Req() req: RequestWithUser,
  ) {
    return this.versions.addQuestion(id, dto, req.user.id);
  }

  /** Reemplaza la pregunta completa, opciones incluidas. */
  @Put(':id/questions/:questionId')
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  updateQuestion(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: QuestionDto,
    @Req() req: RequestWithUser,
  ) {
    return this.versions.updateQuestion(id, questionId, dto, req.user.id);
  }

  @Delete(':id/questions/:questionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  deleteQuestion(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.versions.deleteQuestion(id, questionId, req.user.id);
  }

  @Put(':id/question-order')
  @Roles(UserRole.ADMIN)
  @AuditRoute({
    action: 'QUESTIONS_REORDERED',
    entity: 'QuestionnaireVersion',
  })
  reorder(@Param('id') id: string, @Body() dto: QuestionOrderDto) {
    return this.versions.reorderQuestions(id, dto.questionIds);
  }

  /** Publica el borrador; desde ahí la versión es inmutable. */
  @Post(':id/publication')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @AuditRoute({ byService: true })
  publish(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.versions.publish(id, req.user.id);
  }
}

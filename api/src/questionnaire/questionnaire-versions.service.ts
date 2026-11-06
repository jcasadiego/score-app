import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  AuditActorType,
  DiagnosticFamily,
  QuestionnaireVersionStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { VALIDATION_FAILED_CODE } from '../common/problem-details';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_QUESTIONS_PER_VERSION } from './dto/limits';
import { QuestionDto } from './dto/question.dto';
import { publicationIssues, questionIssues } from './questionnaire-rules';

/** Códigos propios de este módulo (catálogo en `docs/errores.md`). */
export const DRAFT_ALREADY_EXISTS = 'DRAFT_ALREADY_EXISTS';
export const VERSION_PUBLISHED = 'QUESTIONNAIRE_VERSION_PUBLISHED';
export const VERSION_INCOMPLETE = 'QUESTIONNAIRE_VERSION_INCOMPLETE';
export const DUPLICATE_QUESTION_CODE = 'DUPLICATE_QUESTION_CODE';

const VERSION_FIELDS = {
  id: true,
  family: true,
  versionNumber: true,
  status: true,
  isSample: true,
  createdById: true,
  publishedAt: true,
  publishedById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.QuestionnaireVersionSelect;

export const QUESTION_SELECT = {
  id: true,
  code: true,
  text: true,
  type: true,
  helpText: true,
  required: true,
  maxLength: true,
  position: true,
  options: {
    select: { id: true, text: true, value: true, position: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.QuestionSelect;

const VERSION_DETAIL_SELECT = {
  ...VERSION_FIELDS,
  questions: {
    select: QUESTION_SELECT,
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.QuestionnaireVersionSelect;

export type QuestionnaireQuestion = Prisma.QuestionGetPayload<{
  select: typeof QUESTION_SELECT;
}>;
export type QuestionnaireVersionDetail = Prisma.QuestionnaireVersionGetPayload<{
  select: typeof VERSION_DETAIL_SELECT;
}>;
export type QuestionnaireVersionSummary =
  Prisma.QuestionnaireVersionGetPayload<{
    select: typeof VERSION_FIELDS;
  }> & { questionCount: number };

export interface QuestionnaireVersionsPage {
  data: QuestionnaireVersionSummary[];
  total: number;
  page: number;
  pageSize: number;
}

interface ListParams {
  page: number;
  pageSize: number;
  family?: DiagnosticFamily;
  status?: QuestionnaireVersionStatus;
}

/** Datos de Prisma para crear una pregunta con sus opciones en orden. */
function questionData(dto: QuestionDto) {
  return {
    code: dto.code,
    text: dto.text,
    type: dto.type,
    helpText: dto.helpText || null,
    required: dto.required,
    maxLength: dto.maxLength ?? null,
    options: {
      create: dto.options.map((option, position) => ({
        text: option.text,
        value: option.value,
        position,
      })),
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * Versiones del cuestionario por familia. Un borrador es editable; una versión
 * publicada es inmutable (el servicio lo valida y un trigger lo garantiza en la
 * base). Toda escritura sobre un borrador lo bloquea primero (`lockDraft`), así
 * que no se cruza con una publicación simultánea.
 */
@Injectable()
export class QuestionnaireVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list({
    page,
    pageSize,
    family,
    status,
  }: ListParams): Promise<QuestionnaireVersionsPage> {
    const where: Prisma.QuestionnaireVersionWhereInput = { family, status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.questionnaireVersion.findMany({
        where,
        select: { ...VERSION_FIELDS, _count: { select: { questions: true } } },
        orderBy: [{ family: 'asc' }, { versionNumber: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.questionnaireVersion.count({ where }),
    ]);

    const data = rows.map(({ _count, ...version }) => ({
      ...version,
      questionCount: _count.questions,
    }));
    return { data, total, page, pageSize };
  }

  async findOne(id: string): Promise<QuestionnaireVersionDetail> {
    const version = await this.prisma.questionnaireVersion.findUnique({
      where: { id },
      select: VERSION_DETAIL_SELECT,
    });
    if (!version) throw this.versionNotFound(id);
    return version;
  }

  /**
   * Borrador nuevo con las preguntas de la última versión publicada de la
   * familia. Las versiones de prueba no se copian: el cuestionario oficial
   * empieza vacío en vez de heredar contenido de prueba.
   */
  async createDraft(
    family: DiagnosticFamily,
    requesterId: string,
  ): Promise<QuestionnaireVersionDetail> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const draft = await tx.questionnaireVersion.findFirst({
          where: { family, status: QuestionnaireVersionStatus.DRAFT },
          select: { id: true },
        });
        if (draft) throw this.draftExists(family);

        const [last, source] = await Promise.all([
          tx.questionnaireVersion.aggregate({
            where: { family },
            _max: { versionNumber: true },
          }),
          tx.questionnaireVersion.findFirst({
            where: {
              family,
              status: QuestionnaireVersionStatus.PUBLISHED,
              isSample: false,
            },
            orderBy: { versionNumber: 'desc' },
            select: { questions: { select: QUESTION_SELECT } },
          }),
        ]);

        return tx.questionnaireVersion.create({
          data: {
            family,
            versionNumber: (last._max.versionNumber ?? 0) + 1,
            createdById: requesterId,
            questions: {
              create: (source?.questions ?? []).map((question) => ({
                code: question.code,
                text: question.text,
                type: question.type,
                helpText: question.helpText,
                required: question.required,
                maxLength: question.maxLength,
                position: question.position,
                options: {
                  create: question.options.map(({ text, value, position }) => ({
                    text,
                    value,
                    position,
                  })),
                },
              })),
            },
          },
          select: VERSION_DETAIL_SELECT,
        });
      });
    } catch (error) {
      // Otra petición creó el borrador entre la consulta y el insert: el índice
      // único parcial de la base lo rechaza.
      if (isUniqueViolation(error)) throw this.draftExists(family);
      throw error;
    }
  }

  async addQuestion(
    versionId: string,
    dto: QuestionDto,
    requesterId: string,
  ): Promise<QuestionnaireQuestion> {
    this.assertValidQuestion(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockDraft(tx, versionId);
        const count = await tx.question.count({
          where: { questionnaireVersionId: versionId },
        });
        if (count >= MAX_QUESTIONS_PER_VERSION) {
          throw new ConflictException(
            `La versión ya tiene el máximo de ${MAX_QUESTIONS_PER_VERSION} preguntas.`,
          );
        }
        const question = await tx.question.create({
          data: {
            ...questionData(dto),
            questionnaireVersionId: versionId,
            position: count,
          },
          select: QUESTION_SELECT,
        });
        await this.recordQuestionEvent(
          tx,
          'QUESTION_CREATED',
          versionId,
          question,
          requesterId,
        );
        return question;
      });
    } catch (error) {
      throw this.mapCodeConflict(error, dto.code);
    }
  }

  /** Reemplaza la pregunta completa, opciones incluidas, en una sola operación. */
  async updateQuestion(
    versionId: string,
    questionId: string,
    dto: QuestionDto,
    requesterId: string,
  ): Promise<QuestionnaireQuestion> {
    this.assertValidQuestion(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockDraft(tx, versionId);
        await this.assertQuestionInVersion(tx, versionId, questionId);
        const { options, ...fields } = questionData(dto);
        const question = await tx.question.update({
          where: { id: questionId },
          data: { ...fields, options: { deleteMany: {}, ...options } },
          select: QUESTION_SELECT,
        });
        await this.recordQuestionEvent(
          tx,
          'QUESTION_UPDATED',
          versionId,
          question,
          requesterId,
        );
        return question;
      });
    } catch (error) {
      throw this.mapCodeConflict(error, dto.code);
    }
  }

  async deleteQuestion(
    versionId: string,
    questionId: string,
    requesterId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, versionId);
      const question = await this.assertQuestionInVersion(
        tx,
        versionId,
        questionId,
      );
      await tx.question.delete({ where: { id: questionId } });
      // Cierra el hueco: las posiciones quedan siempre 0..n-1.
      await tx.$executeRaw`
        UPDATE questions AS q SET position = r.rn - 1
        FROM (
          SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) AS rn
          FROM questions WHERE questionnaire_version_id = ${versionId}
        ) AS r
        WHERE q.id = r.id AND q.position <> r.rn - 1
      `;
      await this.recordQuestionEvent(
        tx,
        'QUESTION_DELETED',
        versionId,
        question,
        requesterId,
      );
    });
  }

  /** Recibe todas las preguntas de la versión en el orden nuevo. */
  async reorderQuestions(
    versionId: string,
    questionIds: string[],
  ): Promise<QuestionnaireVersionDetail> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, versionId);
      const current = await tx.question.findMany({
        where: { questionnaireVersionId: versionId },
        select: { id: true },
      });
      const known = new Set(current.map(({ id }) => id));
      if (
        questionIds.length !== known.size ||
        questionIds.some((id) => !known.has(id))
      ) {
        throw new BadRequestException({
          message:
            'El orden debe incluir cada pregunta de la versión exactamente una vez.',
          code: VALIDATION_FAILED_CODE,
          errors: [
            {
              field: 'questionIds',
              message:
                'El orden debe incluir cada pregunta de la versión exactamente una vez.',
            },
          ],
        });
      }
      await tx.$executeRaw`
        UPDATE questions AS q SET position = o.ord - 1
        FROM unnest(${questionIds}::text[]) WITH ORDINALITY AS o(id, ord)
        WHERE q.id = o.id AND q.questionnaire_version_id = ${versionId}
      `;
      return tx.questionnaireVersion.findUniqueOrThrow({
        where: { id: versionId },
        select: VERSION_DETAIL_SELECT,
      });
    });
  }

  /** Publica el borrador si está completo; si no, 409 con lo que le falta. */
  async publish(
    versionId: string,
    requesterId: string,
  ): Promise<QuestionnaireVersionDetail> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, versionId);
      const questions = await tx.question.findMany({
        where: { questionnaireVersionId: versionId },
        select: {
          code: true,
          type: true,
          maxLength: true,
          options: { select: { value: true } },
        },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      const issues = publicationIssues(questions);
      if (issues.length > 0) {
        throw new ConflictException({
          message: 'La versión no se puede publicar todavía.',
          code: VERSION_INCOMPLETE,
          errors: issues,
        });
      }

      const version = await tx.questionnaireVersion.update({
        where: { id: versionId },
        data: {
          status: QuestionnaireVersionStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedById: requesterId,
        },
        select: VERSION_DETAIL_SELECT,
      });
      await this.audit.record(
        {
          actorType: AuditActorType.PANEL_USER,
          actorId: requesterId,
          action: 'QUESTIONNAIRE_VERSION_PUBLISHED',
          entity: 'QuestionnaireVersion',
          entityId: versionId,
          data: {
            family: version.family,
            versionNumber: version.versionNumber,
            questionCount: questions.length,
          },
        },
        tx,
      );
      return version;
    });
  }

  /**
   * Bloquea la versión hasta el fin de la transacción y exige que sea un
   * borrador. Con el bloqueo, editar y publicar a la vez se ordenan: la
   * publicación valida exactamente lo que queda publicado.
   */
  private async lockDraft(
    tx: Prisma.TransactionClient,
    versionId: string,
  ): Promise<void> {
    const [version] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM questionnaire_versions WHERE id = ${versionId} FOR UPDATE
    `;
    if (!version) throw this.versionNotFound(versionId);
    if (version.status !== QuestionnaireVersionStatus.DRAFT) {
      throw new ConflictException({
        message: 'La versión está publicada y no se puede modificar.',
        code: VERSION_PUBLISHED,
      });
    }
  }

  private async assertQuestionInVersion(
    tx: Prisma.TransactionClient,
    versionId: string,
    questionId: string,
  ): Promise<{ id: string; code: string }> {
    const question = await tx.question.findFirst({
      where: { id: questionId, questionnaireVersionId: versionId },
      select: { id: true, code: true },
    });
    if (!question) {
      throw new NotFoundException(
        `Pregunta ${questionId} no encontrada en la versión ${versionId}`,
      );
    }
    return question;
  }

  private assertValidQuestion(dto: QuestionDto): void {
    const errors = questionIssues(dto);
    if (errors.length > 0) {
      throw new BadRequestException({
        message: errors.map(({ message }) => message),
        code: VALIDATION_FAILED_CODE,
        errors,
      });
    }
  }

  /** En la misma transacción: el contenido publicado sale de estos cambios. */
  private recordQuestionEvent(
    tx: Prisma.TransactionClient,
    action: string,
    versionId: string,
    question: { id: string; code: string },
    requesterId: string,
  ) {
    return this.audit.record(
      {
        actorType: AuditActorType.PANEL_USER,
        actorId: requesterId,
        action,
        entity: 'Question',
        entityId: question.id,
        data: { questionnaireVersionId: versionId, code: question.code },
      },
      tx,
    );
  }

  private mapCodeConflict(error: unknown, code: string): unknown {
    if (isUniqueViolation(error)) {
      return new ConflictException({
        message: `Ya existe una pregunta con el código ${code} en esta versión.`,
        code: DUPLICATE_QUESTION_CODE,
      });
    }
    return error;
  }

  private versionNotFound(id: string) {
    return new NotFoundException(`Versión de cuestionario ${id} no encontrada`);
  }

  private draftExists(family: DiagnosticFamily) {
    return new ConflictException({
      message: `Ya existe un borrador para la familia ${family}.`,
      code: DRAFT_ALREADY_EXISTS,
    });
  }
}

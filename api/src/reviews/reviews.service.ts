import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import {
  ApprovalVoidCause,
  AuditActorType,
  CalculationStatus,
  FlagStatus,
  ReportStatus,
  ReviewStatus,
  UserRole,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import {
  type ProblemError,
  VALIDATION_FAILED_CODE,
} from '../common/problem-details';
import type { ValidatedEnv } from '../config/validate-env';
import { validateAnswer } from '../diagnostics/answer-rules';
import { FlagsService } from '../flags/flags.service';
import {
  APPROVAL_REQUIREMENTS_NOT_MET,
  REVIEW_ALREADY_TAKEN,
  REVIEW_APPROVED,
  REVIEW_NOT_APPROVED,
  REVIEW_NOT_TAKEN,
  REVIEW_TAKEN_BY_OTHER,
} from './review-codes';
import { PrismaService } from '../prisma/prisma.service';
import { voidReportApproval } from '../reports/report-invalidation';
import {
  type ApprovalState,
  approvalBlockers,
  reviewStatusFor,
  usedAiException,
} from './approval-rules';
import type { ApproveReviewDto } from './dto/approve-review.dto';
import type { CreateCorrectionDto } from './dto/create-correction.dto';
import type { CreateNoteDto } from './dto/create-note.dto';
import type { ListReviewsDto } from './dto/list-reviews.dto';
import { assertVersion } from './etag';

/** Quien hace la acción, de la sesión (nunca del cliente). */
export interface Actor {
  id: string;
  role: string;
}

/** La fila bloqueada con `FOR UPDATE` al cambiar un caso. */
interface LockedReview {
  id: string;
  diagnosticId: string;
  status: ReviewStatus;
  assigneeId: string | null;
  version: number;
}

const USER_SELECT = { select: { id: true, name: true } } as const;

const OPTION_SELECT = {
  select: { option: { select: { id: true, value: true, text: true } } },
  orderBy: { option: { position: 'asc' } },
} satisfies Prisma.AnswerSelectionFindManyArgs;

const CORRECTION_SELECT = {
  id: true,
  sequence: true,
  answerId: true,
  textValue: true,
  selections: OPTION_SELECT,
  reason: true,
  correctedBy: USER_SELECT,
  createdAt: true,
  answer: {
    select: {
      textValue: true,
      selections: OPTION_SELECT,
      question: { select: { id: true, code: true, text: true, type: true } },
    },
  },
} satisfies Prisma.AnswerCorrectionSelect;

type CorrectionRow = Prisma.AnswerCorrectionGetPayload<{
  select: typeof CORRECTION_SELECT;
}>;

const NOTE_SELECT = {
  id: true,
  dimension: true,
  body: true,
  author: USER_SELECT,
  createdAt: true,
} satisfies Prisma.ReviewNoteSelect;

/** El estado del informe del caso, para la bandeja y la pantalla de revisión. */
const REPORT_SUMMARY_SELECT = {
  select: { status: true, _count: { select: { deliveries: true } } },
} as const;

function reportSummary(
  report: { status: ReportStatus; _count: { deliveries: number } } | null,
) {
  if (!report) return null;
  return {
    status: report.status,
    // Se entregó antes y el caso cambió después: falta la versión actualizada.
    redeliveryPending:
      report.status !== ReportStatus.DELIVERED && report._count.deliveries > 0,
  };
}

const APPROVAL_SELECT = {
  id: true,
  calculationId: true,
  approvedBy: USER_SELECT,
  aiExceptionReason: true,
  approvedAt: true,
  voidedAt: true,
  voidCause: true,
  voidedBy: USER_SELECT,
  voidReason: true,
} satisfies Prisma.ReviewApprovalSelect;

const NEWEST_FIRST = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.CalculationOrderByWithRelationInput[];

/** Solo los diagnósticos con un cálculo exitoso llegan a la bandeja. */
const IN_INBOX = {
  diagnostic: {
    calculations: { some: { status: CalculationStatus.SUCCEEDED } },
  },
} satisfies Prisma.ReviewWhereInput;

/** Valor original y corregido con la misma forma: texto u opciones. */
function correctionView({ answer, selections, ...correction }: CorrectionRow) {
  return {
    ...correction,
    question: answer.question,
    options: selections.map(({ option }) => option),
    original: {
      textValue: answer.textValue,
      options: answer.selections.map(({ option }) => option),
    },
  };
}

/**
 * Revisión humana antes de cualquier entrega (PF-39): bandeja, toma del caso,
 * correcciones con trazabilidad, notas y aprobación atada a un cálculo. Nunca
 * calcula: recalcular pasa por el módulo del motor, que avisa aquí al encolar
 * (`onCalculationEnqueued`). Los cambios que importan a quien corrige o
 * aprueba suben `version` (ETag/If-Match).
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly flags: FlagsService,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  private production(): boolean {
    return this.config.get('APP_ENV', { infer: true }) === 'production';
  }

  /**
   * En la transacción que encola un cálculo, con el diagnóstico ya bloqueado:
   * crea la revisión si es el primero, anula la aprobación vigente si la hay y
   * devuelve la última corrección, que el cálculo debe incluir. Bloquea la
   * revisión, así que una corrección simultánea queda antes o después, nunca
   * a medias. Anular una aprobación equivale a reabrirla: si quien recalcula
   * no es Aprobador, 409 (CLAUDE.md 5.3).
   */
  async onCalculationEnqueued(
    tx: Prisma.TransactionClient,
    diagnosticId: string,
    requester?: Actor,
  ): Promise<{ correctionSequence: number }> {
    const requestedById = requester?.id;
    const review = await tx.review.upsert({
      where: { diagnosticId },
      create: { diagnosticId },
      update: { version: { increment: 1 } },
      select: { id: true, status: true, assigneeId: true },
    });
    if (review.status === ReviewStatus.APPROVED) {
      if (requester && requester.role !== UserRole.ADMIN) {
        throw new ConflictException({
          message:
            'El caso está aprobado. Un Aprobador debe reabrirlo antes de recalcular.',
          code: REVIEW_APPROVED,
        });
      }
      const voided = await tx.reviewApproval.updateMany({
        where: { reviewId: review.id, voidedAt: null },
        data: {
          voidedAt: new Date(),
          voidCause: ApprovalVoidCause.RECALCULATED,
          voidedById: requestedById ?? null,
        },
      });
      await tx.review.update({
        where: { id: review.id },
        data: { status: reviewStatusFor(false, review.assigneeId) },
      });
      if (voided.count > 0) {
        await this.audit.record(
          {
            actorType: requestedById
              ? AuditActorType.PANEL_USER
              : AuditActorType.SYSTEM,
            actorId: requestedById,
            action: 'REVIEW_APPROVAL_VOIDED',
            entity: 'Review',
            entityId: review.id,
            data: { diagnosticId, cause: ApprovalVoidCause.RECALCULATED },
          },
          tx,
        );
      }
      // El informe aprobado sobre ese resultado vuelve a borrador (PF-42).
      await voidReportApproval(
        tx,
        this.audit,
        review.id,
        ApprovalVoidCause.RECALCULATED,
        requestedById,
      );
    }
    return { correctionSequence: await this.lastSequence(tx, review.id) };
  }

  async list(query: ListReviewsDto, actor: Actor) {
    const where: Prisma.ReviewWhereInput = {
      ...IN_INBOX,
      ...(query.status && { status: query.status }),
      ...(query.assignment === 'mine' && { assigneeId: actor.id }),
      ...(query.assignment === 'unassigned' && {
        OR: [{ assigneeId: null }, { assignee: { active: false } }],
      }),
    };
    const { page, pageSize } = query;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        select: {
          id: true,
          status: true,
          assignee: { select: { id: true, name: true, active: true } },
          assignedAt: true,
          createdAt: true,
          diagnostic: {
            select: {
              id: true,
              completedAt: true,
              lead: { select: { name: true } },
              questionnaireVersion: { select: { family: true } },
            },
          },
          report: REPORT_SUMMARY_SELECT,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.review.count({ where }),
    ]);
    const openFlags = await this.flags.openCountsByDiagnostic(
      rows.map(({ diagnostic }) => diagnostic.id),
    );
    const data = rows.map(({ diagnostic, report, ...review }) => ({
      ...review,
      report: reportSummary(report),
      diagnostic: {
        id: diagnostic.id,
        completedAt: diagnostic.completedAt,
        leadName: diagnostic.lead.name,
        family: diagnostic.questionnaireVersion.family,
      },
      openFlags: openFlags.get(diagnostic.id) ?? 0,
    }));
    return { data, total, page, pageSize };
  }

  /** El caso, con lo que falta para aprobarlo. `version` va también como ETag. */
  async findOne(id: string) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        version: true,
        assignee: { select: { id: true, name: true, active: true } },
        assignedAt: true,
        createdAt: true,
        updatedAt: true,
        diagnostic: {
          select: {
            id: true,
            completedAt: true,
            lead: { select: { id: true, name: true } },
            questionnaireVersion: { select: { family: true } },
          },
        },
        approvals: {
          where: { voidedAt: null },
          select: APPROVAL_SELECT,
        },
        report: REPORT_SUMMARY_SELECT,
      },
    });
    if (!review) throw this.notFound(id);
    const state = await this.approvalState(this.prisma, review);
    const { diagnostic, approvals, report, ...rest } = review;
    return {
      ...rest,
      report: reportSummary(report),
      diagnostic: {
        id: diagnostic.id,
        completedAt: diagnostic.completedAt,
        leadId: diagnostic.lead.id,
        leadName: diagnostic.lead.name,
        family: diagnostic.questionnaireVersion.family,
      },
      approval: approvals[0] ?? null,
      latestCalculation: state.latestView,
      lastCorrectionSequence: state.lastCorrectionSequence,
      approvalBlockers: approvalBlockers(state),
    };
  }

  /**
   * Tomar el caso. Con la fila bloqueada: si otro lo tiene (y sigue activo),
   * 409, también ante dos peticiones simultáneas. Tomarlo de nuevo no cambia nada.
   */
  async take(id: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const review = await this.lock(tx, id);
      if (review.assigneeId === actor.id) return;
      if (review.assigneeId) {
        const assignee = await tx.user.findUniqueOrThrow({
          where: { id: review.assigneeId },
          select: { active: true },
        });
        if (assignee.active) {
          throw new ConflictException({
            message: 'Otra persona ya tomó este caso.',
            code: REVIEW_ALREADY_TAKEN,
          });
        }
      }
      await tx.review.update({
        where: { id },
        data: {
          assigneeId: actor.id,
          assignedAt: new Date(),
          status: reviewStatusFor(
            review.status === ReviewStatus.APPROVED,
            actor.id,
          ),
          version: { increment: 1 },
        },
      });
      await this.record(tx, actor, 'REVIEW_TAKEN', id, {
        diagnosticId: review.diagnosticId,
        previousAssigneeId: review.assigneeId,
      });
    });
    return this.findOne(id);
  }

  /** Liberar: el propio, o cualquiera siendo Aprobador. Sin tomar, no hace nada. */
  async release(id: string, actor: Actor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const review = await this.lock(tx, id);
      if (!review.assigneeId) return;
      if (review.assigneeId !== actor.id && actor.role !== UserRole.ADMIN) {
        throw new ForbiddenException({
          message:
            'Solo un Aprobador puede liberar un caso tomado por otra persona.',
          code: REVIEW_TAKEN_BY_OTHER,
        });
      }
      await tx.review.update({
        where: { id },
        data: {
          assigneeId: null,
          assignedAt: null,
          status: reviewStatusFor(
            review.status === ReviewStatus.APPROVED,
            null,
          ),
          version: { increment: 1 },
        },
      });
      await this.record(tx, actor, 'REVIEW_RELEASED', id, {
        diagnosticId: review.diagnosticId,
        previousAssigneeId: review.assigneeId,
      });
    });
  }

  /**
   * Corrige una respuesta: nunca la sobrescribe, agrega una corrección con el
   * número siguiente. Solo quien tiene el caso y sin aprobación vigente.
   */
  async correct(
    id: string,
    dto: CreateCorrectionDto,
    expectedVersion: number,
    actor: Actor,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const review = await this.lock(tx, id);
      assertVersion(review.version, expectedVersion);
      this.assertCorrectable(review, actor);

      const answer = await tx.answer.findFirst({
        where: { id: dto.answerId, diagnosticId: review.diagnosticId },
        select: {
          questionId: true,
          question: {
            select: {
              type: true,
              maxLength: true,
              options: { select: { id: true } },
            },
          },
        },
      });
      if (!answer) {
        throw new NotFoundException(`Respuesta ${dto.answerId} no encontrada`);
      }
      const result = validateAnswer(answer.question, {
        text: dto.text,
        optionIds: dto.optionIds,
      });
      if ('errors' in result) {
        throw new BadRequestException({
          message: result.errors.map(({ message }) => message),
          code: VALIDATION_FAILED_CODE,
          errors: result.errors,
        });
      }

      const sequence = (await this.lastSequence(tx, id)) + 1;
      const correction = await tx.answerCorrection.create({
        data: {
          reviewId: id,
          sequence,
          answerId: dto.answerId,
          questionId: answer.questionId,
          textValue: result.answer.textValue,
          reason: dto.reason,
          correctedById: actor.id,
          selections: {
            create: result.answer.optionIds.map((optionId) => ({ optionId })),
          },
        },
        select: CORRECTION_SELECT,
      });
      const updated = await tx.review.update({
        where: { id },
        data: { version: { increment: 1 } },
        select: { version: true },
      });
      // Sin el valor ni el motivo: son datos del cliente o texto libre.
      await this.record(tx, actor, 'ANSWER_CORRECTED', id, {
        diagnosticId: review.diagnosticId,
        correctionId: correction.id,
        answerId: dto.answerId,
        questionId: answer.questionId,
        sequence,
      });
      return {
        correction: correctionView(correction),
        version: updated.version,
      };
    });
  }

  async listCorrections(id: string) {
    await this.assertExists(id);
    const rows = await this.prisma.answerCorrection.findMany({
      where: { reviewId: id },
      select: CORRECTION_SELECT,
      orderBy: { sequence: 'asc' },
    });
    return rows.map(correctionView);
  }

  async addNote(id: string, dto: CreateNoteDto, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const review = await this.lock(tx, id);
      const note = await tx.reviewNote.create({
        data: {
          reviewId: id,
          dimension: dto.dimension ?? null,
          body: dto.body,
          authorId: actor.id,
        },
        select: NOTE_SELECT,
      });
      await this.record(tx, actor, 'REVIEW_NOTE_ADDED', id, {
        diagnosticId: review.diagnosticId,
        noteId: note.id,
        // Sin la dimensión: es texto libre hasta tener el catálogo D1–D8.
        general: note.dimension === null,
      });
      return note;
    });
  }

  async listNotes(id: string) {
    await this.assertExists(id);
    return this.prisma.reviewNote.findMany({
      where: { reviewId: id },
      select: NOTE_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Aprueba el caso atado al último cálculo, si se cumple todo; si no, 409 con
   * la lista de lo que falta. La revisión bloqueada impide que entre un
   * cálculo o una corrección a la vez, y los flags del cálculo se bloquean en
   * modo compartido para que nadie los reabra mientras tanto.
   */
  async approve(
    id: string,
    dto: ApproveReviewDto,
    expectedVersion: number,
    actor: Actor,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const review = await this.lock(tx, id);
      assertVersion(review.version, expectedVersion);
      if (review.status === ReviewStatus.APPROVED) {
        throw new ConflictException({
          message: 'El caso ya está aprobado.',
          code: REVIEW_APPROVED,
        });
      }
      const state = await this.approvalState(tx, review, {
        lockFlags: true,
        aiExceptionReason: dto.aiExceptionReason,
      });
      const blockers = approvalBlockers(state);
      if (blockers.length > 0 || !state.latestView) {
        throw new ConflictException({
          message: 'El caso todavía no se puede aprobar.',
          code: APPROVAL_REQUIREMENTS_NOT_MET,
          errors: blockers,
        });
      }

      const aiExceptionReason = usedAiException(state);
      const approval = await tx.reviewApproval.create({
        data: {
          reviewId: id,
          calculationId: state.latestView.id,
          approvedById: actor.id,
          aiExceptionReason,
        },
        select: APPROVAL_SELECT,
      });
      await tx.review.update({
        where: { id },
        data: { status: ReviewStatus.APPROVED, version: { increment: 1 } },
      });
      // Quién corrigió y quién aprobó (riesgo aceptado A.5.3, CLAUDE.md 5.3).
      const correctors = await tx.answerCorrection.findMany({
        where: { reviewId: id },
        distinct: ['correctedById'],
        select: { correctedById: true },
        orderBy: { correctedById: 'asc' },
      });
      const correctedByIds = correctors.map((c) => c.correctedById);
      await this.record(tx, actor, 'REVIEW_APPROVED', id, {
        diagnosticId: review.diagnosticId,
        approvalId: approval.id,
        calculationId: approval.calculationId,
        aiException: aiExceptionReason !== null,
        correctedByIds,
        approverCorrected: correctedByIds.includes(actor.id),
      });
      return approval;
    });
  }

  /** Anula la aprobación vigente con motivo. El caso vuelve a revisión. */
  async reopen(id: string, reason: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const review = await this.lock(tx, id);
      const active = await tx.reviewApproval.findFirst({
        where: { reviewId: id, voidedAt: null },
        select: { id: true },
      });
      if (!active) {
        throw new ConflictException({
          message: 'El caso no tiene una aprobación vigente que reabrir.',
          code: REVIEW_NOT_APPROVED,
        });
      }
      const approval = await tx.reviewApproval.update({
        where: { id: active.id },
        data: {
          voidedAt: new Date(),
          voidCause: ApprovalVoidCause.REOPENED,
          voidedById: actor.id,
          voidReason: reason,
        },
        select: APPROVAL_SELECT,
      });
      await tx.review.update({
        where: { id },
        data: {
          status: reviewStatusFor(false, review.assigneeId),
          version: { increment: 1 },
        },
      });
      // Sin el motivo: texto libre que puede citar al cliente.
      await this.record(tx, actor, 'REVIEW_REOPENED', id, {
        diagnosticId: review.diagnosticId,
        approvalId: approval.id,
        calculationId: approval.calculationId,
      });
      await voidReportApproval(
        tx,
        this.audit,
        id,
        ApprovalVoidCause.REOPENED,
        actor.id,
      );
      return approval;
    });
  }

  /**
   * Lo que hoy impediría aprobar un caso que ya tiene una aprobación vigente,
   * con la excepción de IA con que se aprobó. Vacío = sigue en regla. Lo usa
   * la entrega del informe, en su transacción y con la revisión ya bloqueada.
   */
  async blockersOfApproved(
    tx: Prisma.TransactionClient,
    reviewId: string,
    aiExceptionReason: string | null,
  ): Promise<ProblemError[]> {
    const review = await tx.review.findUniqueOrThrow({
      where: { id: reviewId },
      select: { id: true, diagnosticId: true },
    });
    const state = await this.approvalState(tx, review, {
      lockFlags: true,
      aiExceptionReason: aiExceptionReason ?? undefined,
    });
    return approvalBlockers(state);
  }

  /** La versión actual, para el ETag de las respuestas que cambian el caso. */
  async version(id: string): Promise<number> {
    const review = await this.prisma.review.findUnique({
      where: { id },
      select: { version: true },
    });
    if (!review) throw this.notFound(id);
    return review.version;
  }

  private assertCorrectable(review: LockedReview, actor: Actor): void {
    if (review.status === ReviewStatus.APPROVED) {
      throw new ConflictException({
        message:
          'El caso está aprobado. Para corregirlo, primero hay que reabrirlo.',
        code: REVIEW_APPROVED,
      });
    }
    if (!review.assigneeId) {
      throw new ConflictException({
        message: 'Toma el caso antes de corregir sus respuestas.',
        code: REVIEW_NOT_TAKEN,
      });
    }
    if (review.assigneeId !== actor.id) {
      throw new ForbiddenException({
        message: 'Solo quien tiene tomado el caso puede corregirlo.',
        code: REVIEW_TAKEN_BY_OTHER,
      });
    }
  }

  /** Lo que decide la aprobación, leído del último intento de cálculo. */
  private async approvalState(
    client: Prisma.TransactionClient,
    review: { id: string; diagnostic?: { id: string }; diagnosticId?: string },
    options: { lockFlags?: boolean; aiExceptionReason?: string } = {},
  ) {
    const diagnosticId = review.diagnosticId ?? review.diagnostic?.id;
    const latest = await client.calculation.findFirst({
      where: { diagnosticId },
      select: {
        id: true,
        status: true,
        isSimulated: true,
        correctionSequence: true,
        createdAt: true,
        flagAnalysis: { select: { status: true } },
      },
      orderBy: NEWEST_FIRST,
    });
    let openFlags = 0;
    if (latest?.status === CalculationStatus.SUCCEEDED) {
      if (options.lockFlags) {
        const flags = await client.$queryRaw<{ status: FlagStatus }[]>`
          SELECT status FROM flags WHERE calculation_id = ${latest.id} FOR SHARE
        `;
        openFlags = flags.filter((f) => f.status === FlagStatus.OPEN).length;
      } else {
        openFlags = await client.flag.count({
          where: { calculationId: latest.id, status: FlagStatus.OPEN },
        });
      }
    }
    const lastCorrectionSequence = await this.lastSequence(client, review.id);
    const latestView = latest && {
      id: latest.id,
      status: latest.status,
      isSimulated: latest.isSimulated,
      correctionSequence: latest.correctionSequence,
      analysisStatus: latest.flagAnalysis?.status ?? null,
      openFlags,
      createdAt: latest.createdAt,
    };
    return {
      latest: latestView,
      latestView,
      lastCorrectionSequence,
      production: this.production(),
      aiExceptionReason: options.aiExceptionReason,
    } satisfies ApprovalState & { latestView: unknown };
  }

  private async lastSequence(
    client: Prisma.TransactionClient,
    reviewId: string,
  ): Promise<number> {
    const { _max } = await client.answerCorrection.aggregate({
      where: { reviewId },
      _max: { sequence: true },
    });
    return _max.sequence ?? 0;
  }

  private async lock(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<LockedReview> {
    const [review] = await tx.$queryRaw<LockedReview[]>`
      SELECT id, diagnostic_id AS "diagnosticId", status,
             assignee_id AS "assigneeId", version
      FROM reviews WHERE id = ${id} FOR UPDATE
    `;
    if (!review) throw this.notFound(id);
    return review;
  }

  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.review.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw this.notFound(id);
  }

  private record(
    tx: Prisma.TransactionClient,
    actor: Actor,
    action: string,
    reviewId: string,
    data: Prisma.InputJsonObject,
  ) {
    return this.audit.record(
      {
        actorType: AuditActorType.PANEL_USER,
        actorId: actor.id,
        action,
        entity: 'Review',
        entityId: reviewId,
        data,
      },
      tx,
    );
  }

  private notFound(id: string) {
    return new NotFoundException(`Revisión ${id} no encontrada`);
  }
}

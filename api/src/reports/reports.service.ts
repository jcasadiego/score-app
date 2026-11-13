import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  AuditActorType,
  ReportApprovalVoidCause,
  ReportPart,
  ReportRevisionSource,
  ReportStatus,
} from '../../generated/prisma/enums';
import { AiService } from '../ai/ai.service';
import type { AiResult } from '../ai/ai.types';
import {
  type DimensionTexts,
  REPORT_DRAFT_PROMPT,
  REPORT_SECTION_PROMPT,
  REPORT_SECTION_SCHEMA,
  reportDraftSchema,
} from '../ai/prompts/report-draft.prompt';
import { AuditService } from '../audit/audit.service';
import { AI_DISABLED } from '../flags/flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertVersion } from '../reviews/etag';
import { REVIEW_NOT_APPROVED } from '../reviews/review-codes';
import type { Actor } from '../reviews/reviews.service';
import {
  AI_TASK_FAILED,
  REPORT_ALREADY_EXISTS,
  REPORT_APPROVED,
  REPORT_DELIVERED,
  REPORT_DIMENSIONS_MISSING,
  REPORT_NOT_APPROVED,
  REPORT_OUTDATED,
  REPORT_VERSION_MISMATCH_ERROR as VERSION_MISMATCH,
} from './report-codes';
import {
  dimensionsOf,
  partKey,
  REPORT_PARTS,
  resultForAi,
} from './report-dimensions';

import {
  type LockedReport,
  lockReport,
  lockReview,
  reportNotFound,
} from './report-locks';

const USER_SELECT = { select: { id: true, name: true } } as const;

const REVISION_SELECT = {
  id: true,
  sequence: true,
  body: true,
  source: true,
  aiCallLogId: true,
  author: USER_SELECT,
  createdAt: true,
} satisfies Prisma.ReportSectionRevisionSelect;

const APPROVAL_SELECT = {
  id: true,
  reportVersion: true,
  approvedBy: USER_SELECT,
  approvedAt: true,
} satisfies Prisma.ReportApprovalSelect;

/** Lo que la IA necesita de la aprobación vigente de la revisión. */
const SOURCE_SELECT = {
  id: true,
  calculation: {
    select: {
      input: true,
      output: true,
      diagnostic: {
        select: {
          id: true,
          lead: { select: { name: true } },
          questionnaireVersion: {
            select: {
              family: true,
              questions: {
                select: {
                  code: true,
                  text: true,
                  type: true,
                  options: {
                    select: { value: true, text: true },
                    orderBy: { position: 'asc' },
                  },
                },
                orderBy: { position: 'asc' },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ReviewApprovalSelect;

type ApprovalSource = Prisma.ReviewApprovalGetPayload<{
  select: typeof SOURCE_SELECT;
}>;

/** Todo lo que una tarea de IA del informe recibe, ya sin datos de contacto. */
interface DraftContext {
  source: ApprovalSource;
  dimensions: string[];
  data: Record<string, unknown>;
  redact: string[];
  diagnosticId: string;
}

/**
 * Informe del diagnóstico (PF-42): la IA redacta el borrador a partir de la
 * revisión aprobada, una persona lo edita y un Aprobador lo aprueba. La IA
 * nunca calcula ni cambia el puntaje y nunca recibe nombre, correo ni teléfono
 * del lead. Cada cambio queda en el historial de su sección (solo inserción).
 * Orden de bloqueo: la revisión antes que el informe (`report-locks.ts`).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
  ) {}

  /** El informe con el texto vigente de cada sección. `version` es el ETag. */
  async findOne(reviewId: string) {
    const report = await this.prisma.report.findUnique({
      where: { reviewId },
      select: {
        id: true,
        reviewId: true,
        status: true,
        version: true,
        reviewApprovalId: true,
        createdAt: true,
        updatedAt: true,
        reviewApproval: {
          select: { voidedAt: true, calculation: { select: { output: true } } },
        },
        approvals: { where: { voidedAt: null }, select: APPROVAL_SELECT },
        // La primera entrega: cuándo recibió el cliente su informe.
        deliveries: {
          select: { createdAt: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
        },
        sections: {
          select: {
            id: true,
            dimension: true,
            part: true,
            position: true,
            revisions: {
              select: REVISION_SELECT,
              orderBy: { sequence: 'desc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!report) throw this.notFound(reviewId);

    // Solo las dimensiones del resultado con que se redactó, en su orden.
    const dimensions = dimensionsOf(report.reviewApproval.calculation.output);
    const partOrder = REPORT_PARTS.map(({ part }) => part);
    const sections = report.sections
      .filter((s) => dimensions.includes(s.dimension))
      .sort(
        (a, b) =>
          dimensions.indexOf(a.dimension) - dimensions.indexOf(b.dimension) ||
          partOrder.indexOf(a.part) - partOrder.indexOf(b.part),
      )
      .map(({ revisions: [current], ...section }) => ({
        id: section.id,
        dimension: section.dimension,
        part: section.part,
        body: current.body,
        source: current.source,
        sequence: current.sequence,
        author: current.author,
        revisedAt: current.createdAt,
      }));
    const { reviewApproval, approvals, deliveries, ...rest } = report;
    return {
      ...rest,
      deliveredAt: deliveries[0]?.createdAt ?? null,
      // La aprobación de la revisión con que se redactó ya no es la vigente.
      outdated: reviewApproval.voidedAt !== null,
      approval: approvals[0] ?? null,
      sections,
    };
  }

  /** Historial completo de una sección, del más reciente al más antiguo. */
  async listRevisions(reviewId: string, sectionId: string) {
    await this.findSection(this.prisma, reviewId, sectionId);
    return this.prisma.reportSectionRevision.findMany({
      where: { sectionId },
      select: REVISION_SELECT,
      orderBy: { sequence: 'desc' },
    });
  }

  /**
   * Genera el borrador con IA. Solo con la revisión aprobada y una vez por
   * revisión. La IA corre fuera de la transacción; al guardar se comprueba que
   * la aprobación siga siendo la misma.
   */
  async generate(reviewId: string, actor: Actor) {
    await this.assertReviewExists(reviewId);
    if (await this.prisma.report.findUnique({ where: { reviewId } })) {
      throw this.alreadyExists();
    }
    const context = await this.draftContext(reviewId);
    const draft = await this.runDraft(context);

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockReview(tx, reviewId);
        await this.assertSameApproval(tx, reviewId, context.source.id);
        const report = await tx.report.create({
          data: { reviewId, reviewApprovalId: context.source.id },
          select: { id: true },
        });
        await this.writeDraft(tx, report.id, context, draft, actor);
        await this.record(tx, actor, 'REPORT_GENERATED', report.id, {
          reviewId,
          reviewApprovalId: context.source.id,
          aiCallLogId: draft.callLogId,
          dimensions: context.dimensions.length,
        });
      });
    } catch (error) {
      // Otra petición lo creó mientras la IA redactaba.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.alreadyExists();
      }
      throw error;
    }
    return this.findOne(reviewId);
  }

  /**
   * Vuelve a redactar todo el borrador con la aprobación vigente de la
   * revisión: así se pone al día un informe desactualizado. Las versiones
   * anteriores quedan en el historial.
   */
  async regenerate(reviewId: string, expectedVersion: number, actor: Actor) {
    const current = await this.reportOrThrow(reviewId);
    assertVersion(current.version, expectedVersion, VERSION_MISMATCH);
    this.assertDraft(current.status);
    const context = await this.draftContext(reviewId);
    const draft = await this.runDraft(context);

    await this.prisma.$transaction(async (tx) => {
      await this.lockReview(tx, reviewId);
      const report = await this.lockReport(tx, reviewId);
      assertVersion(report.version, expectedVersion, VERSION_MISMATCH);
      this.assertDraft(report.status);
      await this.assertSameApproval(tx, reviewId, context.source.id);
      await this.writeDraft(tx, report.id, context, draft, actor);
      await tx.report.update({
        where: { id: report.id },
        data: {
          reviewApprovalId: context.source.id,
          version: { increment: 1 },
        },
      });
      await this.record(tx, actor, 'REPORT_REGENERATED', report.id, {
        reviewId,
        reviewApprovalId: context.source.id,
        previousReviewApprovalId: report.reviewApprovalId,
        aiCallLogId: draft.callLogId,
      });
    });
    return this.findOne(reviewId);
  }

  /** Pide a la IA que rehaga una sola parte, con las otras como contexto. */
  async regenerateSection(
    reviewId: string,
    sectionId: string,
    expectedVersion: number,
    actor: Actor,
  ) {
    const current = await this.reportOrThrow(reviewId);
    assertVersion(current.version, expectedVersion, VERSION_MISMATCH);
    this.assertDraft(current.status);
    const section = await this.findSection(this.prisma, reviewId, sectionId);
    const context = await this.draftContext(reviewId);
    if (context.source.id !== current.reviewApprovalId) throw this.outdated();
    if (!context.dimensions.includes(section.dimension)) {
      throw new NotFoundException(`Sección ${sectionId} no encontrada`);
    }

    const siblings = await this.prisma.reportSection.findMany({
      where: { reportId: current.id, dimension: section.dimension },
      select: {
        part: true,
        revisions: {
          select: { body: true },
          orderBy: { sequence: 'desc' },
          take: 1,
        },
      },
    });
    const currentDimension = Object.fromEntries(
      siblings.map((s) => [partKey(s.part), s.revisions[0]?.body ?? '']),
    );
    const result = await this.ai.run({
      use: 'report',
      prompt: REPORT_SECTION_PROMPT,
      schema: REPORT_SECTION_SCHEMA,
      data: {
        ...context.data,
        target: { dimension: section.dimension, part: partKey(section.part) },
        currentDimension,
      },
      redact: context.redact,
      subject: { entity: 'Report', entityId: current.id },
    });
    const {
      callLogId,
      value: { text },
    } = this.assertAiResult(result);

    await this.prisma.$transaction(async (tx) => {
      await this.lockReview(tx, reviewId);
      const report = await this.lockReport(tx, reviewId);
      assertVersion(report.version, expectedVersion, VERSION_MISMATCH);
      this.assertDraft(report.status);
      await this.assertSameApproval(tx, reviewId, report.reviewApprovalId);
      const revision = await this.addRevision(tx, sectionId, {
        body: text,
        source: ReportRevisionSource.AI,
        aiCallLogId: callLogId,
        authorId: actor.id,
      });
      await this.bumpVersion(tx, report.id);
      await this.record(tx, actor, 'REPORT_SECTION_REGENERATED', report.id, {
        reviewId,
        sectionId,
        dimension: section.dimension,
        part: section.part,
        sequence: revision.sequence,
        aiCallLogId: callLogId,
      });
    });
    return this.findOne(reviewId);
  }

  /** Edición humana de una sección: agrega una versión, nunca sobrescribe. */
  async editSection(
    reviewId: string,
    sectionId: string,
    body: string,
    expectedVersion: number,
    actor: Actor,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const report = await this.lockReport(tx, reviewId);
      assertVersion(report.version, expectedVersion, VERSION_MISMATCH);
      this.assertDraft(report.status);
      const section = await this.findSection(tx, reviewId, sectionId);
      const revision = await this.addRevision(tx, sectionId, {
        body,
        source: ReportRevisionSource.HUMAN,
        aiCallLogId: null,
        authorId: actor.id,
      });
      await this.bumpVersion(tx, report.id);
      // Sin el texto: es el contenido del informe del cliente.
      await this.record(tx, actor, 'REPORT_SECTION_EDITED', report.id, {
        reviewId,
        sectionId,
        dimension: section.dimension,
        part: section.part,
        sequence: revision.sequence,
      });
    });
    return this.findOne(reviewId);
  }

  /**
   * Aprueba el informe tal como está: guarda qué versión de cada sección se
   * aprobó. Exige que la revisión siga aprobada con la misma aprobación con
   * que se redactó el borrador. Solo el Aprobador (lo decide el controlador).
   */
  async approve(reviewId: string, expectedVersion: number, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockReview(tx, reviewId);
      const report = await this.lockReport(tx, reviewId);
      assertVersion(report.version, expectedVersion, VERSION_MISMATCH);
      this.assertDraft(report.status);
      await this.assertSameApproval(tx, reviewId, report.reviewApprovalId);

      const source = await tx.reviewApproval.findUniqueOrThrow({
        where: { id: report.reviewApprovalId },
        select: { calculation: { select: { output: true } } },
      });
      const dimensions = dimensionsOf(source.calculation.output);
      const sections = await tx.reportSection.findMany({
        where: { reportId: report.id, dimension: { in: dimensions } },
        select: {
          revisions: {
            select: { id: true },
            orderBy: { sequence: 'desc' },
            take: 1,
          },
        },
      });
      const approval = await tx.reportApproval.create({
        data: {
          reportId: report.id,
          reportVersion: report.version,
          approvedById: actor.id,
          revisions: {
            create: sections.map((s) => ({ revisionId: s.revisions[0].id })),
          },
        },
        select: { id: true },
      });
      await tx.report.update({
        where: { id: report.id },
        data: { status: ReportStatus.APPROVED, version: { increment: 1 } },
      });
      await this.record(tx, actor, 'REPORT_APPROVED', report.id, {
        reviewId,
        approvalId: approval.id,
        reportVersion: report.version,
        reviewApprovalId: report.reviewApprovalId,
      });
    });
    return this.findOne(reviewId);
  }

  /**
   * Reabre un informe aprobado que todavía no se entregó: vuelve a borrador y
   * su aprobación queda anulada con el motivo. La aprobación del caso no se
   * toca. Solo el Aprobador (lo decide el controlador).
   */
  async reopen(
    reviewId: string,
    reason: string,
    expectedVersion: number,
    actor: Actor,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockReview(tx, reviewId);
      const report = await this.lockReport(tx, reviewId);
      assertVersion(report.version, expectedVersion, VERSION_MISMATCH);
      if (report.status === ReportStatus.DRAFT) {
        throw new ConflictException({
          message: 'El informe no está aprobado: no hay nada que reabrir.',
          code: REPORT_NOT_APPROVED,
        });
      }
      if (report.status === ReportStatus.DELIVERED) throw this.delivered();

      const active = await tx.reportApproval.findFirstOrThrow({
        where: { reportId: report.id, voidedAt: null },
        select: { id: true },
      });
      await tx.reportApproval.update({
        where: { id: active.id },
        data: {
          voidedAt: new Date(),
          voidCause: ReportApprovalVoidCause.REPORT_REOPENED,
          voidedById: actor.id,
          voidReason: reason,
        },
      });
      await tx.report.update({
        where: { id: report.id },
        data: { status: ReportStatus.DRAFT, version: { increment: 1 } },
      });
      // Sin el motivo: texto libre que puede citar al cliente.
      await this.record(tx, actor, 'REPORT_REOPENED', report.id, {
        reviewId,
        approvalId: active.id,
      });
    });
    return this.findOne(reviewId);
  }

  /** La versión actual, para el ETag. */
  async version(reviewId: string): Promise<number> {
    return (await this.reportOrThrow(reviewId)).version;
  }

  /**
   * Arma lo que la IA recibe de la aprobación vigente: el resultado del
   * cálculo aprobado, el cuestionario con las respuestas efectivas de ese
   * cálculo y las notas del revisor. Nada de contacto del lead (y su nombre se
   * tacha si aparece en un texto libre).
   */
  private async draftContext(reviewId: string): Promise<DraftContext> {
    const source = await this.prisma.reviewApproval.findFirst({
      where: { reviewId, voidedAt: null },
      select: SOURCE_SELECT,
    });
    if (!source) {
      throw new ConflictException({
        message:
          'El caso no tiene una aprobación vigente: apruébalo antes de redactar el informe.',
        code: REVIEW_NOT_APPROVED,
      });
    }
    const { calculation } = source;
    const dimensions = dimensionsOf(calculation.output);
    if (dimensions.length === 0) {
      throw new ConflictException({
        message:
          'El resultado aprobado no trae dimensiones con que redactar el informe.',
        code: REPORT_DIMENSIONS_MISSING,
      });
    }
    if (this.ai.configFor('report').provider === 'disabled') {
      throw new ServiceUnavailableException({
        message: 'La IA está desactivada para los informes.',
        code: AI_DISABLED,
      });
    }
    const notes = await this.prisma.reviewNote.findMany({
      where: { reviewId },
      select: { dimension: true, body: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const { diagnostic } = calculation;
    const version = diagnostic.questionnaireVersion;
    const input = calculation.input as { answers?: Record<string, unknown> };
    return {
      source,
      dimensions,
      diagnosticId: diagnostic.id,
      redact: [diagnostic.lead.name],
      data: {
        family: version.family,
        result: resultForAi(calculation.output),
        questionnaire: version.questions,
        answers: input.answers ?? {},
        reviewerNotes: notes,
      },
    };
  }

  private async runDraft(context: DraftContext) {
    const result = await this.ai.run({
      use: 'report',
      prompt: REPORT_DRAFT_PROMPT,
      schema: reportDraftSchema(context.dimensions),
      data: context.data,
      redact: context.redact,
      subject: { entity: 'Diagnostic', entityId: context.diagnosticId },
    });
    const { callLogId, value } = this.assertAiResult(result);
    return { callLogId, texts: value.dimensions };
  }

  /**
   * La respuesta y el id del registro de la llamada, o 503: sin resultado, o
   * sin registro (un texto de la IA nunca se guarda sin saber de qué llamada
   * salió).
   */
  private assertAiResult<T>(result: AiResult<T>): {
    value: T;
    callLogId: string;
  } {
    if (!result.ok || !result.callLogId) {
      throw new ServiceUnavailableException({
        message:
          'La IA no pudo redactar el informe. No se guardó nada; vuelve a intentarlo.',
        code: AI_TASK_FAILED,
      });
    }
    return { value: result.value, callLogId: result.callLogId };
  }

  /** Una versión nueva de cada parte de cada dimensión (crea la sección si falta). */
  private async writeDraft(
    tx: Prisma.TransactionClient,
    reportId: string,
    context: DraftContext,
    draft: { callLogId: string; texts: Record<string, DimensionTexts> },
    actor: Actor,
  ) {
    for (const [position, dimension] of context.dimensions.entries()) {
      for (const { part, key } of REPORT_PARTS) {
        const section = await tx.reportSection.upsert({
          where: { reportId_dimension_part: { reportId, dimension, part } },
          create: { reportId, dimension, part, position },
          update: { position },
          select: { id: true },
        });
        await this.addRevision(tx, section.id, {
          body: draft.texts[dimension][key],
          source: ReportRevisionSource.AI,
          aiCallLogId: draft.callLogId,
          authorId: actor.id,
        });
      }
    }
  }

  private async addRevision(
    tx: Prisma.TransactionClient,
    sectionId: string,
    data: {
      body: string;
      source: ReportRevisionSource;
      aiCallLogId: string | null;
      authorId: string;
    },
  ) {
    const { _max } = await tx.reportSectionRevision.aggregate({
      where: { sectionId },
      _max: { sequence: true },
    });
    return tx.reportSectionRevision.create({
      data: { sectionId, sequence: (_max.sequence ?? 0) + 1, ...data },
      select: { sequence: true },
    });
  }

  private bumpVersion(tx: Prisma.TransactionClient, reportId: string) {
    return tx.report.update({
      where: { id: reportId },
      data: { version: { increment: 1 } },
    });
  }

  /** La sección, solo si es del informe de esa revisión (autorización por objeto). */
  private async findSection(
    client: Prisma.TransactionClient,
    reviewId: string,
    sectionId: string,
  ): Promise<{ dimension: string; part: ReportPart }> {
    const section = await client.reportSection.findFirst({
      where: { id: sectionId, report: { reviewId } },
      select: { dimension: true, part: true },
    });
    if (!section) {
      throw new NotFoundException(`Sección ${sectionId} no encontrada`);
    }
    return section;
  }

  /** 409 si la aprobación vigente de la revisión ya no es `expectedId`. */
  private async assertSameApproval(
    tx: Prisma.TransactionClient,
    reviewId: string,
    expectedId: string,
  ): Promise<void> {
    const active = await tx.reviewApproval.findFirst({
      where: { reviewId, voidedAt: null },
      select: { id: true },
    });
    if (!active) {
      throw new ConflictException({
        message:
          'El caso ya no está aprobado. Un Aprobador debe aprobarlo de nuevo antes de seguir con el informe.',
        code: REVIEW_NOT_APPROVED,
      });
    }
    if (active.id !== expectedId) throw this.outdated();
  }

  private assertDraft(status: ReportStatus): void {
    if (status === ReportStatus.DELIVERED) throw this.delivered();
    if (status !== ReportStatus.DRAFT) {
      throw new ConflictException({
        message:
          'El informe ya está aprobado: no admite cambios. Un Aprobador puede reabrirlo.',
        code: REPORT_APPROVED,
      });
    }
  }

  private lockReview(tx: Prisma.TransactionClient, reviewId: string) {
    return lockReview(tx, reviewId);
  }

  private lockReport(tx: Prisma.TransactionClient, reviewId: string) {
    return lockReport(tx, reviewId);
  }

  private async reportOrThrow(reviewId: string): Promise<LockedReport> {
    const report = await this.prisma.report.findUnique({
      where: { reviewId },
      select: {
        id: true,
        status: true,
        version: true,
        reviewApprovalId: true,
      },
    });
    if (!report) throw this.notFound(reviewId);
    return report;
  }

  private async assertReviewExists(reviewId: string): Promise<void> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true },
    });
    if (!review) {
      throw new NotFoundException(`Revisión ${reviewId} no encontrada`);
    }
  }

  private record(
    tx: Prisma.TransactionClient,
    actor: Actor,
    action: string,
    reportId: string,
    data: Prisma.InputJsonObject,
  ) {
    return this.audit.record(
      {
        actorType: AuditActorType.PANEL_USER,
        actorId: actor.id,
        action,
        entity: 'Report',
        entityId: reportId,
        data,
      },
      tx,
    );
  }

  private alreadyExists() {
    return new ConflictException({
      message: 'El caso ya tiene un informe.',
      code: REPORT_ALREADY_EXISTS,
    });
  }

  private outdated() {
    return new ConflictException({
      message:
        'El resultado del caso cambió desde que se redactó el borrador. Vuelve a generarlo completo antes de seguir.',
      code: REPORT_OUTDATED,
    });
  }

  private delivered() {
    return new ConflictException({
      message: 'El informe ya se entregó al cliente: no admite cambios.',
      code: REPORT_DELIVERED,
    });
  }

  private notFound(reviewId: string) {
    return reportNotFound(reviewId);
  }
}

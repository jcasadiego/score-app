import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import {
  AuditActorType,
  CalculationStatus,
  FlagAnalysisStatus,
  FlagSeverity,
  FlagSource,
  FlagStatus,
} from '../../generated/prisma/enums';
import { AiService } from '../ai/ai.service';
import {
  FLAGS_CONTRADICTIONS_PROMPT,
  FLAGS_CONTRADICTIONS_SCHEMA,
  type FlagsContradictionsOutput,
} from '../ai/prompts/flags-contradictions.prompt';
import { AuditService } from '../audit/audit.service';
import { VALIDATION_FAILED_CODE } from '../common/problem-details';
import type { ValidatedEnv } from '../config/validate-env';
import { PrismaService } from '../prisma/prisma.service';

/** Códigos propios del módulo (catálogo en `docs/errores.md`). */
export const FLAG_ANALYSIS_NOT_RETRYABLE = 'FLAG_ANALYSIS_NOT_RETRYABLE';
export const CALCULATION_NOT_SUCCEEDED = 'CALCULATION_NOT_SUCCEEDED';
export const AI_DISABLED = 'AI_DISABLED';

const MESSAGE_MAX = 1000;
const CONTRADICTION_PREFIX = 'Posible contradicción: ';
const INSTRUCTIONS_MESSAGE =
  'Posible intento de dar instrucciones a la IA en las respuestas. Revisa estas preguntas antes de confiar en el análisis automático.';

const FLAG_SELECT = {
  id: true,
  calculationId: true,
  source: true,
  severity: true,
  message: true,
  status: true,
  reviewNote: true,
  reviewedBy: { select: { id: true, name: true } },
  reviewedAt: true,
  createdAt: true,
  questions: {
    select: { question: { select: { id: true, code: true, text: true } } },
    orderBy: { question: { position: 'asc' } },
  },
} satisfies Prisma.FlagSelect;

const ANALYSIS_SELECT = {
  id: true,
  calculationId: true,
  status: true,
  provider: true,
  model: true,
  promptId: true,
  promptVersion: true,
  isSimulated: true,
  failureReason: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
} satisfies Prisma.FlagAnalysisSelect;

type FlagRow = Prisma.FlagGetPayload<{ select: typeof FLAG_SELECT }>;

/** Las preguntas de un flag sin la tabla puente. */
function flagView({ questions, ...flag }: FlagRow) {
  return { ...flag, questions: questions.map(({ question }) => question) };
}

function truncate(text: string): string {
  return text.length > MESSAGE_MAX
    ? `${text.slice(0, MESSAGE_MAX - 1)}…`
    : text;
}

/** Siempre como posibilidad, aunque la IA lo haya redactado como hecho. */
function contradictionMessage(explanation: string): string {
  const text = explanation.trim();
  return truncate(
    /^posible contradicci[oó]n/i.test(text)
      ? text
      : `${CONTRADICTION_PREFIX}${text}`,
  );
}

/**
 * Flags del revisor (PF-34): baja confianza según el motor y posibles
 * contradicciones señaladas por la IA. Nunca cambian el resultado ni las
 * respuestas. Cada cálculo exitoso tiene su `FlagAnalysis`; cero flags solo
 * significa "sin alertas" si el análisis terminó bien. Como el cálculo, supone
 * una sola instancia de la API: al arrancar, un análisis `RUNNING` quedó a
 * medias por un reinicio.
 */
@Injectable()
export class FlagsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FlagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  private aiEnabled(): boolean {
    return this.ai.configFor('flags').provider !== 'disabled';
  }

  /**
   * En la transacción que marca exitoso el cálculo: el flag de baja confianza
   * y el análisis pendiente. Después del commit, `dispatch`.
   */
  async onCalculationSucceeded(
    tx: Prisma.TransactionClient,
    calculationId: string,
    output: Record<string, unknown>,
  ): Promise<{ analysisId: string }> {
    const threshold = this.config.get('FLAG_LOW_CONFIDENCE_THRESHOLD', {
      infer: true,
    });
    const confidence = output.confidence;
    if (typeof confidence === 'number' && confidence < threshold) {
      await tx.flag.create({
        data: {
          calculationId,
          source: FlagSource.ENGINE,
          severity: FlagSeverity.MEDIUM,
          message: `Baja confianza del motor: ${confidence} (umbral ${threshold}). Conviene revisar las respuestas antes de aprobar.`,
        },
      });
    }
    const analysis = await tx.flagAnalysis.create({
      data: { calculationId },
      select: { id: true },
    });
    return { analysisId: analysis.id };
  }

  /** En segundo plano: quien lo pide no espera a la IA. */
  dispatch(analysisId: string): void {
    void this.process(analysisId).catch((error: unknown) =>
      this.logFailure(analysisId, error),
    );
  }

  /**
   * Corre el análisis con IA. Lo toma solo si sigue `PENDING` y lo cierra solo
   * si sigue siendo el suyo (`startedAt`): retomarlo dos veces no duplica
   * flags. Con la IA desactivada lo deja pendiente.
   */
  async process(analysisId: string): Promise<void> {
    if (!this.aiEnabled()) return;
    const startedAt = new Date();
    const { count } = await this.prisma.flagAnalysis.updateMany({
      where: { id: analysisId, status: FlagAnalysisStatus.PENDING },
      data: { status: FlagAnalysisStatus.RUNNING, startedAt },
    });
    if (count === 0) return;
    const claim = {
      id: analysisId,
      status: FlagAnalysisStatus.RUNNING,
      startedAt,
    };

    const analysis = await this.prisma.flagAnalysis.findUniqueOrThrow({
      where: { id: analysisId },
      select: {
        calculation: {
          select: {
            id: true,
            input: true,
            diagnostic: {
              select: {
                id: true,
                lead: { select: { name: true } },
                questionnaireVersion: {
                  select: {
                    questions: {
                      select: {
                        id: true,
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
      },
    });
    const { calculation } = analysis;
    const { diagnostic } = calculation;
    const questions = diagnostic.questionnaireVersion.questions;
    const { provider, model } = this.ai.configFor('flags');
    const used = {
      provider,
      model,
      promptId: FLAGS_CONTRADICTIONS_PROMPT.id,
      promptVersion: FLAGS_CONTRADICTIONS_PROMPT.version,
    };

    const input = calculation.input as { answers?: Record<string, unknown> };
    let result;
    try {
      result = await this.ai.run({
        use: 'flags',
        prompt: FLAGS_CONTRADICTIONS_PROMPT,
        schema: FLAGS_CONTRADICTIONS_SCHEMA,
        data: {
          questionnaire: questions.map(({ code, text, type, options }) => ({
            code,
            text,
            type,
            options,
          })),
          answers: input.answers ?? {},
        },
        // El nombre del lead nunca sale, aunque lo haya escrito en un texto.
        redact: [diagnostic.lead.name],
        subject: { entity: 'Diagnostic', entityId: diagnostic.id },
      });
    } catch (error) {
      this.logFailure(analysisId, error);
      return this.finishFailed(claim, used, diagnostic.id, 'provider_error');
    }
    if (!result.ok) {
      return this.finishFailed(claim, used, diagnostic.id, result.reason);
    }

    // Solo preguntas de la versión del diagnóstico (OWASP LLM05).
    const idByCode = new Map(questions.map(({ id, code }) => [code, id]));
    const output: FlagsContradictionsOutput = result.value;
    const codes = [
      ...output.contradictions.flatMap((c) => c.questionCodes),
      ...output.instructionsToAi.questionCodes,
    ];
    if (codes.some((code) => !idByCode.has(code))) {
      return this.finishFailed(claim, used, diagnostic.id, 'invalid_question');
    }
    const questionLinks = (questionCodes: string[]) => ({
      create: [...new Set(questionCodes)].map((code) => ({
        questionId: idByCode.get(code) as string,
      })),
    });

    await this.prisma.$transaction(async (tx) => {
      const { count: finished } = await tx.flagAnalysis.updateMany({
        where: claim,
        data: {
          ...used,
          status: FlagAnalysisStatus.SUCCEEDED,
          isSimulated: result.simulated,
          finishedAt: new Date(),
        },
      });
      if (finished === 0) return;
      for (const contradiction of output.contradictions) {
        await tx.flag.create({
          data: {
            calculationId: calculation.id,
            analysisId,
            source: FlagSource.AI,
            severity: contradiction.severity,
            message: contradictionMessage(contradiction.explanation),
            questions: questionLinks(contradiction.questionCodes),
          },
        });
      }
      // Que el cliente le pida a la IA callar deja rastro para el revisor.
      if (output.instructionsToAi.detected) {
        await tx.flag.create({
          data: {
            calculationId: calculation.id,
            analysisId,
            source: FlagSource.AI,
            severity: FlagSeverity.MEDIUM,
            message: INSTRUCTIONS_MESSAGE,
            questions: questionLinks(output.instructionsToAi.questionCodes),
          },
        });
      }
      await this.audit.record(
        {
          actorType: AuditActorType.SYSTEM,
          action: 'FLAG_ANALYSIS_SUCCEEDED',
          entity: 'Diagnostic',
          entityId: diagnostic.id,
          data: {
            analysisId,
            calculationId: calculation.id,
            flags:
              output.contradictions.length +
              (output.instructionsToAi.detected ? 1 : 0),
          },
        },
        tx,
      );
    });
  }

  private async finishFailed(
    claim: Prisma.FlagAnalysisWhereInput,
    used: Prisma.FlagAnalysisUpdateManyMutationInput,
    diagnosticId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.flagAnalysis.updateMany({
        where: claim,
        data: {
          ...used,
          status: FlagAnalysisStatus.FAILED,
          failureReason: reason,
          finishedAt: new Date(),
        },
      });
      if (count === 0) return;
      await this.audit.record(
        {
          actorType: AuditActorType.SYSTEM,
          action: 'FLAG_ANALYSIS_FAILED',
          entity: 'Diagnostic',
          entityId: diagnosticId,
          data: { analysisId: claim.id as string, reason },
        },
        tx,
      );
    });
  }

  /** Al arrancar retoma los análisis pendientes o a medias, sin bloquear. */
  async onApplicationBootstrap(): Promise<void> {
    const open = {
      status: {
        in: [FlagAnalysisStatus.PENDING, FlagAnalysisStatus.RUNNING],
      },
    };
    const pending = await this.prisma.flagAnalysis.count({ where: open });
    if (pending === 0) return;
    if (!this.aiEnabled()) {
      this.logger.warn(
        `IA desactivada: ${pending} análisis de flags esperan a que se active`,
      );
      return;
    }
    await this.prisma.flagAnalysis.updateMany({
      where: { status: FlagAnalysisStatus.RUNNING },
      data: { status: FlagAnalysisStatus.PENDING, startedAt: null },
    });
    const queued = await this.prisma.flagAnalysis.findMany({
      where: { status: FlagAnalysisStatus.PENDING },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    this.logger.log(`Retomando ${queued.length} análisis de flags`);
    void (async () => {
      for (const { id } of queued) {
        await this.process(id).catch((error: unknown) =>
          this.logFailure(id, error),
        );
      }
    })();
  }

  /**
   * Reintenta un análisis fallido, o crea el de un cálculo exitoso anterior a
   * los flags. 202; 409 si ya terminó bien o sigue en curso.
   */
  async requestAnalysis(calculationId: string, requesterId: string) {
    if (!this.aiEnabled()) {
      throw new ServiceUnavailableException({
        message:
          'La IA está desactivada. Los análisis quedan pendientes hasta activarla.',
        code: AI_DISABLED,
      });
    }
    const analysisId = await this.prisma.$transaction(async (tx) => {
      const [calculation] = await tx.$queryRaw<
        { status: CalculationStatus; diagnosticId: string }[]
      >`
        SELECT status, diagnostic_id AS "diagnosticId" FROM calculations
        WHERE id = ${calculationId} FOR UPDATE
      `;
      if (!calculation) throw this.calculationNotFound(calculationId);
      if (calculation.status !== CalculationStatus.SUCCEEDED) {
        throw new ConflictException({
          message: 'Solo se analiza un cálculo exitoso.',
          code: CALCULATION_NOT_SUCCEEDED,
        });
      }
      const existing = await tx.flagAnalysis.findUnique({
        where: { calculationId },
        select: { id: true, status: true },
      });
      let id: string;
      if (!existing) {
        ({ id } = await tx.flagAnalysis.create({
          data: { calculationId },
          select: { id: true },
        }));
      } else if (existing.status === FlagAnalysisStatus.FAILED) {
        id = existing.id;
        await tx.flagAnalysis.update({
          where: { id },
          data: {
            status: FlagAnalysisStatus.PENDING,
            failureReason: null,
            startedAt: null,
            finishedAt: null,
          },
        });
      } else {
        throw new ConflictException({
          message:
            existing.status === FlagAnalysisStatus.SUCCEEDED
              ? 'El análisis de este cálculo ya terminó bien. Para otro análisis, recalcula.'
              : 'El análisis de este cálculo sigue en curso.',
          code: FLAG_ANALYSIS_NOT_RETRYABLE,
        });
      }
      await this.audit.record(
        {
          actorType: AuditActorType.PANEL_USER,
          actorId: requesterId,
          action: 'FLAG_ANALYSIS_REQUESTED',
          entity: 'Diagnostic',
          entityId: calculation.diagnosticId,
          data: { analysisId: id, calculationId },
        },
        tx,
      );
      return id;
    });
    this.dispatch(analysisId);
    return this.prisma.flagAnalysis.findUniqueOrThrow({
      where: { id: analysisId },
      select: ANALYSIS_SELECT,
    });
  }

  async getAnalysis(calculationId: string) {
    const calculation = await this.prisma.calculation.findUnique({
      where: { id: calculationId },
      select: { flagAnalysis: { select: ANALYSIS_SELECT } },
    });
    if (!calculation) throw this.calculationNotFound(calculationId);
    if (!calculation.flagAnalysis) {
      throw new NotFoundException(
        `El cálculo ${calculationId} no tiene análisis de flags`,
      );
    }
    return calculation.flagAnalysis;
  }

  /**
   * Flags de un cálculo del diagnóstico (por defecto, el vigente), con el
   * estado de su análisis y cuántos siguen abiertos.
   */
  async list(diagnosticId: string, calculationId?: string) {
    const diagnostic = await this.prisma.diagnostic.findUnique({
      where: { id: diagnosticId },
      select: { id: true },
    });
    if (!diagnostic) {
      throw new NotFoundException(`Diagnóstico ${diagnosticId} no encontrado`);
    }
    const calculation = await this.prisma.calculation.findFirst({
      where: calculationId
        ? { id: calculationId, diagnosticId }
        : { diagnosticId, status: CalculationStatus.SUCCEEDED },
      select: { id: true, flagAnalysis: { select: ANALYSIS_SELECT } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!calculation) {
      if (calculationId) throw this.calculationNotFound(calculationId);
      return { calculationId: null, analysis: null, flags: [], openCount: 0 };
    }

    const [flags, openCount] = await this.prisma.$transaction([
      this.prisma.flag.findMany({
        where: { calculationId: calculation.id },
        select: FLAG_SELECT,
        orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.flag.count({
        where: { calculationId: calculation.id, status: FlagStatus.OPEN },
      }),
    ]);
    return {
      calculationId: calculation.id,
      analysis: calculation.flagAnalysis,
      flags: flags.map(flagView),
      openCount,
    };
  }

  /** Revisado, descartado (con nota) o reabierto. Quién, de la sesión. */
  async review(
    flagId: string,
    status: FlagStatus,
    note: string | undefined,
    reviewerId: string,
  ) {
    const cleanNote = note?.trim() || null;
    if (status === FlagStatus.DISMISSED && !cleanNote) {
      throw new BadRequestException({
        message: ['Para descartar un flag hace falta una nota.'],
        code: VALIDATION_FAILED_CODE,
        errors: [
          {
            field: 'note',
            message: 'Para descartar un flag hace falta una nota.',
          },
        ],
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.flag.findUnique({
        where: { id: flagId },
        select: {
          status: true,
          calculation: { select: { diagnosticId: true } },
        },
      });
      if (!current) throw new NotFoundException(`Flag ${flagId} no encontrado`);
      const reopened = status === FlagStatus.OPEN;
      const flag = await tx.flag.update({
        where: { id: flagId },
        data: {
          status,
          reviewNote: reopened ? null : cleanNote,
          reviewedById: reopened ? null : reviewerId,
          reviewedAt: reopened ? null : new Date(),
        },
        select: FLAG_SELECT,
      });
      // Sin la nota: es texto libre y puede citar al cliente.
      await this.audit.record(
        {
          actorType: AuditActorType.PANEL_USER,
          actorId: reviewerId,
          action: 'FLAG_REVIEWED',
          entity: 'Diagnostic',
          entityId: current.calculation.diagnosticId,
          data: { flagId, from: current.status, to: status },
        },
        tx,
      );
      return flagView(flag);
    });
  }

  private calculationNotFound(id: string) {
    return new NotFoundException(`Cálculo ${id} no encontrado`);
  }

  /** Solo el tipo de error: el mensaje podría citar datos del cliente. */
  private logFailure(analysisId: string, error: unknown): void {
    this.logger.error(
      `Falló el análisis de flags ${analysisId}: ${error instanceof Error ? error.name : 'desconocido'}`,
    );
  }
}

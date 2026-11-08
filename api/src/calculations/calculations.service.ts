import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  AuditActorType,
  CalculationStatus,
  DiagnosticStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SCORING_ENGINE_PORT,
  type ScoringEnginePort,
  type ScoringInput,
  type ScoringOutput,
} from '../scoring-engine/scoring-engine.port';
import { buildScoringInput } from './calculation-input';

/** Códigos propios del módulo (catálogo en `docs/errores.md`). */
export const SCORING_ENGINE_DISABLED = 'SCORING_ENGINE_DISABLED';
export const CALCULATION_IN_PROGRESS = 'CALCULATION_IN_PROGRESS';
export const DIAGNOSTIC_NOT_COMPLETED = 'DIAGNOSTIC_NOT_COMPLETED';
export const NO_CURRENT_CALCULATION = 'NO_CURRENT_CALCULATION';

/** Cuánto se espera al motor antes de dar el cálculo por fallido. */
export const ENGINE_TIMEOUT_MS = 30_000;

/** Lo que ve el panel de un cálculo fallido: sin detalles internos del motor. */
const FAILED_MESSAGES = {
  error: 'El motor devolvió un error. Puedes reintentar el cálculo.',
  timeout: 'El motor no respondió a tiempo. Puedes reintentar el cálculo.',
  unknownRules:
    'El motor aplicó una versión de reglas que no está registrada. Revisa la configuración del motor.',
} as const;

const SUMMARY_SELECT = {
  id: true,
  status: true,
  output: true,
  engine: true,
  isSimulated: true,
  error: true,
  ruleSetVersion: { select: { number: true } },
  requestedBy: { select: { id: true, name: true } },
  startedAt: true,
  finishedAt: true,
  createdAt: true,
} satisfies Prisma.CalculationSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  diagnosticId: true,
  input: true,
} satisfies Prisma.CalculationSelect;

const NEWEST_FIRST = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.CalculationOrderByWithRelationInput[];

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

class EngineTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EngineTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Cálculos del motor (PF-24). El sistema nunca calcula por su cuenta: todo pasa
 * por `ScoringEnginePort`. Cada cálculo se guarda aparte y nunca se
 * sobrescribe. Último intento = el más reciente; cálculo vigente = el más
 * reciente `SUCCEEDED`. Las respuestas del cliente (`input`) quedan en la base,
 * nunca en logs ni en la bitácora.
 *
 * Supone una sola instancia de la API, como el límite de peticiones: al
 * arrancar, un cálculo `RUNNING` es uno que quedó a medias por un reinicio.
 */
@Injectable()
export class CalculationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CalculationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(SCORING_ENGINE_PORT) private readonly engine: ScoringEnginePort,
  ) {}

  status() {
    return {
      driver: this.engine.driver,
      enabled: this.engine.enabled,
      simulated: this.engine.driver === 'stub',
    };
  }

  /**
   * Crea un cálculo pendiente dentro de la transacción de quien lo pide (el
   * envío del diagnóstico o el panel). Después del commit, `dispatch`.
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    diagnosticId: string,
    requestedById?: string,
  ): Promise<{ id: string }> {
    const input = await buildScoringInput(tx, diagnosticId);
    const calculation = await tx.calculation.create({
      data: {
        diagnosticId,
        requestedById,
        input: input as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await this.audit.record(
      {
        actorType: requestedById
          ? AuditActorType.PANEL_USER
          : AuditActorType.SYSTEM,
        actorId: requestedById,
        action: 'CALCULATION_REQUESTED',
        entity: 'Diagnostic',
        entityId: diagnosticId,
        data: { calculationId: calculation.id, automatic: !requestedById },
      },
      tx,
    );
    return calculation;
  }

  /** Procesa en segundo plano: quien lo llama no espera al motor. */
  dispatch(calculationId: string): void {
    if (!this.engine.enabled) return;
    void this.process(calculationId).catch((error: unknown) =>
      this.logFailure(calculationId, error),
    );
  }

  /** Recalcular desde el panel: 202, o 503 con el motor desactivado. */
  async request(diagnosticId: string, requesterId: string) {
    if (!this.engine.enabled) {
      throw new ServiceUnavailableException({
        message:
          'El motor de cálculo está desactivado. Los cálculos quedan pendientes hasta activarlo.',
        code: SCORING_ENGINE_DISABLED,
      });
    }
    let created: { id: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const [diagnostic] = await tx.$queryRaw<{ status: DiagnosticStatus }[]>`
          SELECT status FROM diagnostics WHERE id = ${diagnosticId} FOR UPDATE
        `;
        if (!diagnostic) throw this.diagnosticNotFound(diagnosticId);
        if (diagnostic.status !== DiagnosticStatus.COMPLETED) {
          throw new ConflictException({
            message: 'Solo se calcula un diagnóstico que el cliente ya envió.',
            code: DIAGNOSTIC_NOT_COMPLETED,
          });
        }
        return this.enqueue(tx, diagnosticId, requesterId);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          message: 'Ya hay un cálculo en curso para este diagnóstico.',
          code: CALCULATION_IN_PROGRESS,
        });
      }
      throw error;
    }
    this.dispatch(created.id);
    return this.prisma.calculation.findUniqueOrThrow({
      where: { id: created.id },
      select: SUMMARY_SELECT,
    });
  }

  /**
   * Llama al motor y guarda el resultado. Toma el cálculo solo si sigue
   * `PENDING`, y lo cierra solo si sigue siendo el suyo (`startedAt`): retomar
   * un pendiente dos veces no crea dos resultados.
   */
  async process(calculationId: string): Promise<void> {
    const startedAt = new Date();
    const { count } = await this.prisma.calculation.updateMany({
      where: { id: calculationId, status: CalculationStatus.PENDING },
      data: {
        status: CalculationStatus.RUNNING,
        startedAt,
        engine: this.engine.driver,
      },
    });
    if (count === 0) return;

    const calculation = await this.prisma.calculation.findUniqueOrThrow({
      where: { id: calculationId },
      select: { diagnosticId: true, input: true },
    });
    const claim = {
      id: calculationId,
      status: CalculationStatus.RUNNING,
      startedAt,
    };

    let output: ScoringOutput;
    try {
      output = await withTimeout(
        this.engine.evaluate(calculation.input as unknown as ScoringInput),
        ENGINE_TIMEOUT_MS,
      );
    } catch (error) {
      // Solo el tipo de error: el mensaje del motor podría traer respuestas.
      this.logger.warn(
        `El motor falló en el cálculo ${calculationId}: ${error instanceof Error ? error.name : 'desconocido'}`,
      );
      const reason = error instanceof EngineTimeoutError ? 'timeout' : 'error';
      return this.finishFailed(claim, calculation.diagnosticId, reason);
    }

    const ruleSet = await this.prisma.ruleSetVersion.findUnique({
      where: { number: output.ruleSetVersionNumber },
      select: { id: true, number: true },
    });
    if (!ruleSet) {
      return this.finishFailed(claim, calculation.diagnosticId, 'unknownRules');
    }

    await this.prisma.$transaction(async (tx) => {
      const { count: finished } = await tx.calculation.updateMany({
        where: claim,
        data: {
          status: CalculationStatus.SUCCEEDED,
          output: output.result as Prisma.InputJsonValue,
          ruleSetVersionId: ruleSet.id,
          isSimulated: output.simulated,
          finishedAt: new Date(),
        },
      });
      if (finished === 0) return;
      await this.audit.record(
        {
          actorType: AuditActorType.SYSTEM,
          action: 'CALCULATION_SUCCEEDED',
          entity: 'Diagnostic',
          entityId: calculation.diagnosticId,
          data: {
            calculationId,
            ruleSetVersion: ruleSet.number,
            simulated: output.simulated,
          },
        },
        tx,
      );
    });
  }

  private async finishFailed(
    claim: Prisma.CalculationWhereInput,
    diagnosticId: string,
    reason: keyof typeof FAILED_MESSAGES,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.calculation.updateMany({
        where: claim,
        data: {
          status: CalculationStatus.FAILED,
          error: FAILED_MESSAGES[reason],
          finishedAt: new Date(),
        },
      });
      if (count === 0) return;
      await this.audit.record(
        {
          actorType: AuditActorType.SYSTEM,
          action: 'CALCULATION_FAILED',
          entity: 'Diagnostic',
          entityId: diagnosticId,
          data: { calculationId: claim.id as string, reason },
        },
        tx,
      );
    });
  }

  /**
   * Al arrancar retoma lo que quedó pendiente o a medias, sin bloquear el
   * arranque. Con el motor desactivado no toca nada: quedan para cuando se
   * active.
   */
  async onApplicationBootstrap(): Promise<void> {
    const pending = await this.prisma.calculation.count({
      where: {
        status: { in: [CalculationStatus.PENDING, CalculationStatus.RUNNING] },
      },
    });
    if (!this.engine.enabled) {
      if (pending > 0) {
        this.logger.warn(
          `Motor de cálculo desactivado: ${pending} cálculos esperan a que se active`,
        );
      }
      return;
    }
    if (pending === 0) return;

    await this.prisma.calculation.updateMany({
      where: { status: CalculationStatus.RUNNING },
      data: {
        status: CalculationStatus.PENDING,
        startedAt: null,
        engine: null,
      },
    });
    const queued = await this.prisma.calculation.findMany({
      where: { status: CalculationStatus.PENDING },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    this.logger.log(`Retomando ${queued.length} cálculos pendientes`);
    void (async () => {
      for (const { id } of queued) {
        await this.process(id).catch((error: unknown) =>
          this.logFailure(id, error),
        );
      }
    })();
  }

  async list(diagnosticId: string, page: number, pageSize: number) {
    await this.assertDiagnosticExists(diagnosticId);
    const where = { diagnosticId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.calculation.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: NEWEST_FIRST,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.calculation.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  /** Cálculo vigente: el más reciente `SUCCEEDED`. */
  async current(diagnosticId: string) {
    await this.assertDiagnosticExists(diagnosticId);
    const current = await this.prisma.calculation.findFirst({
      where: { diagnosticId, status: CalculationStatus.SUCCEEDED },
      select: SUMMARY_SELECT,
      orderBy: NEWEST_FIRST,
    });
    if (!current) {
      throw new NotFoundException({
        message: 'El diagnóstico todavía no tiene un cálculo exitoso.',
        code: NO_CURRENT_CALCULATION,
      });
    }
    return current;
  }

  async findOne(diagnosticId: string, calculationId: string) {
    const calculation = await this.prisma.calculation.findFirst({
      where: { id: calculationId, diagnosticId },
      select: DETAIL_SELECT,
    });
    if (!calculation) {
      throw new NotFoundException(`Cálculo ${calculationId} no encontrado`);
    }
    return calculation;
  }

  /**
   * Solo el tipo y el código del error: el mensaje de Prisma puede citar los
   * valores de la consulta, y ahí van las respuestas del cliente.
   */
  private logFailure(calculationId: string, error: unknown): void {
    const name = error instanceof Error ? error.name : 'desconocido';
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? ` (${error.code})`
        : '';
    this.logger.error(
      `Falló el procesamiento del cálculo ${calculationId}: ${name}${code}`,
    );
  }

  private async assertDiagnosticExists(diagnosticId: string): Promise<void> {
    const found = await this.prisma.diagnostic.findUnique({
      where: { id: diagnosticId },
      select: { id: true },
    });
    if (!found) throw this.diagnosticNotFound(diagnosticId);
  }

  private diagnosticNotFound(id: string) {
    return new NotFoundException(`Diagnóstico ${id} no encontrado`);
  }
}

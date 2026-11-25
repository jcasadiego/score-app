import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import {
  AudioFormat,
  AuditActorType,
  TranscriptionErrorCode,
  TranscriptionStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import type { ValidatedEnv } from '../config/validate-env';
import {
  AUDIO_CONTENT_TYPES,
  MAX_RECORDING_BYTES,
} from '../diagnostics/recording-rules';
import { PrismaService } from '../prisma/prisma.service';
import { StorageError } from '../storage/storage.port';
import { StorageService } from '../storage/storage.service';
import { OpenAiTranscriptionAdapter } from './adapters/openai-transcription.adapter';
import { SimulatedTranscriptionAdapter } from './adapters/simulated-transcription.adapter';
import {
  TRANSCRIPTION_AUDIO_DELETED,
  TRANSCRIPTION_NOT_FAILED,
  TRANSCRIPTION_NOT_FOUND,
} from './transcription-codes';
import {
  TranscriptionAdapter,
  TranscriptionAdapterError,
  TranscriptionProviderName,
} from './transcription.port';

/** Intentos antes de dejarla `FAILED` a la espera de un reintento manual. */
export const MAX_ATTEMPTS = 5;
/** Espera tras cada intento fallido (el último valor se repite). */
export const BACKOFF_MS = [
  60_000, // 1 min
  5 * 60_000, // 5 min
  30 * 60_000, // 30 min
  2 * 60 * 60_000, // 2 h
];
/** Tope a la espera que pide el proveedor (429). */
export const MAX_RETRY_AFTER_MS = 6 * 60 * 60_000;
/**
 * Mientras se transcribe, nadie más la toma. Si el proceso muere a mitad de
 * camino, al vencer este plazo otra pasada la retoma (cuenta como intento).
 * Mayor que el tope de `TRANSCRIPTION_TIMEOUT_MS` más la descarga del audio.
 */
export const LEASE_MS = 10 * 60_000;
/** Transcripciones por pasada: el resto queda para la siguiente. */
export const BATCH_SIZE = 20;
/** Largo máximo del texto (CHECK en la base): 3 minutos de voz dan mucho menos. */
export const MAX_TEXT_LENGTH = 20_000;

/** Errores que se pueden resolver solos: el resto espera un reintento manual. */
const RETRYABLE: ReadonlySet<TranscriptionErrorCode> = new Set([
  TranscriptionErrorCode.TIMEOUT,
  TranscriptionErrorCode.RATE_LIMITED,
  TranscriptionErrorCode.PROVIDER_ERROR,
  TranscriptionErrorCode.STORAGE_UNAVAILABLE,
]);

/** Lo que ve el panel. El texto solo con `COMPLETED`. */
export const TRANSCRIPTION_SELECT = {
  status: true,
  text: true,
  attempts: true,
  provider: true,
  model: true,
  lastErrorCode: true,
  completedAt: true,
  updatedAt: true,
} satisfies Prisma.AnswerTranscriptionSelect;

export type TranscriptionView = Prisma.AnswerTranscriptionGetPayload<{
  select: typeof TRANSCRIPTION_SELECT;
}>;

/** Vuelve al estado inicial: al crear la grabación o al reemplazar el audio. */
const RESET = {
  status: TranscriptionStatus.PENDING,
  attempts: 0,
  provider: null,
  model: null,
  text: null,
  lastErrorCode: null,
  completedAt: null,
} as const;

interface ClaimedTranscription {
  id: string;
  /** Ya contando el intento en curso. */
  attempts: number;
  objectKey: string;
  format: AudioFormat;
  diagnosticId: string;
  questionId: string;
}

/**
 * Transcripción de las grabaciones de voz (PF-88). Cada grabación nueva o
 * reemplazada deja una transcripción `PENDING`, en la misma transacción; aquí
 * se procesan en segundo plano con reintentos. El texto no reemplaza la
 * respuesta escrita: va a alertas e informe como "transcripción automática".
 * Si el proveedor falla, el diagnóstico sigue igual. Ni el audio ni el texto
 * van a logs ni a la bitácora.
 */
@Injectable()
export class TranscriptionService implements OnModuleDestroy {
  private readonly logger = new Logger(TranscriptionService.name);
  /** `null` con `disabled`: las pendientes esperan. */
  private readonly adapter: TranscriptionAdapter | null;
  private readonly providerName: TranscriptionProviderName;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    config: ConfigService<ValidatedEnv, true>,
  ) {
    this.providerName = transcriptionProvider(config);
    this.adapter = createAdapter(this.providerName, config);
  }

  /** Qué proveedor está configurado, sin la llave. */
  status(): {
    provider: TranscriptionProviderName;
    model: string | null;
    simulated: boolean;
  } {
    return {
      provider: this.providerName,
      model: this.adapter?.model ?? null,
      simulated: this.adapter?.simulated ?? false,
    };
  }

  /**
   * Deja la transcripción pendiente. Va dentro de la transacción que guarda la
   * grabación: al reemplazar el audio, el texto anterior se descarta.
   */
  async requestFor(
    tx: Prisma.TransactionClient,
    recordingId: string,
  ): Promise<void> {
    await tx.answerTranscription.upsert({
      where: { recordingId },
      create: { recordingId },
      update: { ...RESET, nextAttemptAt: new Date() },
    });
  }

  /**
   * Pide una pasada sin esperarla. Se llama después del commit. Con
   * `disabled` no hace nada. Nunca lanza.
   */
  kick(): void {
    if (!this.adapter) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try {
          await this.processDue();
        } catch (error) {
          this.logger.error(
            `Falló la pasada de transcripciones: ${errorName(error)}`,
          );
        }
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
  }

  /** Al cerrar la app, espera la pasada en curso (no deja conexiones vivas). */
  async onModuleDestroy() {
    this.again = false;
    await this.running;
  }

  /** Procesa las que ya tocan, de a una. Devuelve cuántas procesó. */
  async processDue(): Promise<number> {
    if (!this.adapter) return 0;
    let processed = 0;
    while (processed < BATCH_SIZE) {
      const claimed = await this.claimNext();
      if (!claimed) break;
      await this.transcribe(this.adapter, claimed);
      processed += 1;
    }
    return processed;
  }

  /**
   * Toma la próxima pendiente y la reserva por `LEASE_MS`, en una transacción
   * corta (`SKIP LOCKED`: dos procesos nunca toman la misma). La llamada al
   * proveedor va fuera de la transacción: puede tardar.
   */
  private claimNext(): Promise<ClaimedTranscription | null> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<ClaimedTranscription[]>`
        SELECT t.id, t.attempts, r.object_key AS "objectKey", r.format,
               a.diagnostic_id AS "diagnosticId", a.question_id AS "questionId"
        FROM answer_transcriptions t
        JOIN answer_recordings r ON r.id = t.recording_id
        JOIN answers a ON a.id = r.answer_id
        WHERE t.status = 'PENDING' AND t.next_attempt_at <= now()
          AND r.audio_deleted_at IS NULL
        ORDER BY t.next_attempt_at, t.created_at, t.id
        LIMIT 1
        FOR UPDATE OF t SKIP LOCKED
      `;
      if (!row) return null;
      const attempts = row.attempts + 1;
      await tx.answerTranscription.update({
        where: { id: row.id },
        data: { attempts, nextAttemptAt: new Date(Date.now() + LEASE_MS) },
      });
      return { ...row, attempts };
    });
  }

  private async transcribe(
    adapter: TranscriptionAdapter,
    claimed: ClaimedTranscription,
  ): Promise<void> {
    let text: string;
    try {
      const audio = await this.download(claimed.objectKey);
      ({ text } = await adapter.transcribe({
        audio,
        contentType: AUDIO_CONTENT_TYPES[claimed.format],
      }));
    } catch (error) {
      await this.fail(adapter, claimed, error);
      return;
    }

    const completed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.answerTranscription.updateMany({
        where: this.stillClaimed(claimed),
        data: {
          status: TranscriptionStatus.COMPLETED,
          text: text.trim().slice(0, MAX_TEXT_LENGTH),
          provider: adapter.name,
          model: adapter.model,
          lastErrorCode: null,
          completedAt: new Date(),
        },
      });
      if (count === 0) return false;
      await this.record(tx, 'TRANSCRIPTION_COMPLETED', claimed, {
        attempts: claimed.attempts,
        provider: adapter.name,
      });
      return true;
    });
    if (!completed) this.logDiscarded(claimed);
  }

  /** Programa el próximo intento o, si no quedan, la deja `FAILED`. */
  private async fail(
    adapter: TranscriptionAdapter,
    claimed: ClaimedTranscription,
    error: unknown,
  ): Promise<void> {
    let code: TranscriptionErrorCode = TranscriptionErrorCode.PROVIDER_ERROR;
    let retryAfterMs = 0;
    let final = false;
    if (error instanceof TranscriptionAdapterError) {
      code = error.code;
      retryAfterMs = Math.min(
        Math.max(error.retryAfterMs ?? 0, 0),
        MAX_RETRY_AFTER_MS,
      );
    } else if (error instanceof StorageError) {
      code = TranscriptionErrorCode.STORAGE_UNAVAILABLE;
      // El audio ya no está: reintentar no lo trae de vuelta.
      final = error.reason === 'not_found';
    } else {
      // Error de código, no del proveedor: solo el nombre, nunca el mensaje.
      this.logger.error(
        `Error inesperado al transcribir ${claimed.id}: ${errorName(error)}`,
      );
    }

    final = final || !RETRYABLE.has(code) || claimed.attempts >= MAX_ATTEMPTS;
    const wait = Math.max(
      BACKOFF_MS[Math.min(claimed.attempts - 1, BACKOFF_MS.length - 1)],
      retryAfterMs,
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.answerTranscription.updateMany({
        where: this.stillClaimed(claimed),
        data: {
          status: final
            ? TranscriptionStatus.FAILED
            : TranscriptionStatus.PENDING,
          provider: adapter.name,
          model: adapter.model,
          lastErrorCode: code,
          nextAttemptAt: final ? new Date() : new Date(Date.now() + wait),
        },
      });
      if (count === 0) return false;
      if (final) {
        await this.record(tx, 'TRANSCRIPTION_FAILED', claimed, {
          attempts: claimed.attempts,
          code,
        });
      }
      return true;
    });
    if (!updated) {
      this.logDiscarded(claimed);
      return;
    }
    this.logger.warn(
      `Transcripción ${claimed.id} falló con ${code}` +
        (final ? ', queda fallida' : `, se reintenta en ${wait / 1000} s`),
    );
  }

  /**
   * Sigue siendo la misma tarea: nadie reemplazó el audio (la clave cambia y
   * los intentos vuelven a cero) ni la tomó otro proceso tras vencer la reserva.
   */
  private stillClaimed(
    claimed: ClaimedTranscription,
  ): Prisma.AnswerTranscriptionWhereInput {
    return {
      id: claimed.id,
      status: TranscriptionStatus.PENDING,
      attempts: claimed.attempts,
      recording: { objectKey: claimed.objectKey },
    };
  }

  private logDiscarded(claimed: ClaimedTranscription) {
    this.logger.log(
      `Transcripción ${claimed.id}: el audio cambió o se borró mientras se procesaba; se descarta el resultado`,
    );
  }

  private async download(objectKey: string): Promise<Buffer> {
    const { stream } = await this.storage.get(objectKey);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as Uint8Array);
      size += buffer.length;
      // Nunca debería pasar (CHECK de la base): no se carga un objeto enorme.
      if (size > MAX_RECORDING_BYTES) {
        stream.destroy();
        throw new TranscriptionAdapterError(
          TranscriptionErrorCode.INVALID_AUDIO,
        );
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }

  /** Ids y códigos, nunca el audio ni el texto. */
  private record(
    tx: Prisma.TransactionClient,
    action: string,
    claimed: ClaimedTranscription,
    data: Prisma.InputJsonObject,
  ) {
    return this.audit.record(
      {
        actorType: AuditActorType.SYSTEM,
        action,
        entity: 'AnswerTranscription',
        entityId: claimed.id,
        data: {
          diagnosticId: claimed.diagnosticId,
          questionId: claimed.questionId,
          ...data,
        },
      },
      tx,
    );
  }

  /**
   * Vuelve a poner en cola una transcripción fallida, con los intentos desde
   * cero. 404 si la respuesta no tiene grabación; 409 si no está fallida.
   */
  async retry(
    diagnosticId: string,
    questionId: string,
    actorId: string,
  ): Promise<TranscriptionView> {
    const where = { recording: { answer: { diagnosticId, questionId } } };
    const view = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.answerTranscription.updateMany({
        where: {
          status: TranscriptionStatus.FAILED,
          recording: { ...where.recording, audioDeletedAt: null },
        },
        data: {
          status: TranscriptionStatus.PENDING,
          attempts: 0,
          nextAttemptAt: new Date(),
        },
      });
      const current = await tx.answerTranscription.findFirst({
        where,
        select: { ...TRANSCRIPTION_SELECT, id: true },
      });
      if (!current) {
        throw new NotFoundException({
          message: 'Esta respuesta no tiene una grabación para transcribir.',
          code: TRANSCRIPTION_NOT_FOUND,
        });
      }
      // Sin audio no hay qué transcribir (PF-90).
      const audio = await tx.answerRecording.findFirst({
        where: where.recording,
        select: { audioDeletedAt: true },
      });
      if (audio?.audioDeletedAt) {
        throw new ConflictException({
          message:
            'El audio de esta respuesta se borró por plazo: ya no se puede transcribir.',
          code: TRANSCRIPTION_AUDIO_DELETED,
        });
      }
      if (count === 0) {
        throw new ConflictException({
          message:
            'Esta transcripción no está fallida: ya se está procesando o ya terminó.',
          code: TRANSCRIPTION_NOT_FAILED,
        });
      }
      const { id, ...transcription } = current;
      await this.audit.record(
        {
          actorType: AuditActorType.PANEL_USER,
          actorId,
          action: 'TRANSCRIPTION_RETRIED',
          entity: 'AnswerTranscription',
          entityId: id,
          data: { diagnosticId, questionId },
        },
        tx,
      );
      return transcription;
    });
    this.kick();
    return view;
  }
}

/** Vacío: `simulated` en desarrollo y tests; `disabled` en servidores. */
export function transcriptionProvider(
  config: ConfigService<ValidatedEnv, true>,
): TranscriptionProviderName {
  return (
    config.get('TRANSCRIPTION_PROVIDER', { infer: true }) ??
    (config.get('NODE_ENV', { infer: true }) === 'production'
      ? 'disabled'
      : 'simulated')
  );
}

function createAdapter(
  provider: TranscriptionProviderName,
  config: ConfigService<ValidatedEnv, true>,
): TranscriptionAdapter | null {
  switch (provider) {
    case 'disabled':
      return null;
    case 'simulated':
      return new SimulatedTranscriptionAdapter(
        config.get('TRANSCRIPTION_SIMULATED_FAILURE', { infer: true }),
      );
    case 'openai':
      // `validateEnv` exige la llave con este proveedor.
      return new OpenAiTranscriptionAdapter({
        apiKey: config.get('OPENAI_API_KEY', { infer: true })!,
        model: config.get('TRANSCRIPTION_MODEL', { infer: true }),
        timeoutMs: config.get('TRANSCRIPTION_TIMEOUT_MS', { infer: true }),
      });
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

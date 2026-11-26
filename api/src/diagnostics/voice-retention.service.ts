import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  AuditActorType,
  TranscriptionErrorCode,
  TranscriptionStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageError } from '../storage/storage.port';
import { StorageService } from '../storage/storage.service';

/**
 * Plazo del audio (decidido por José el 2026-11-24 y el 2026-11-25, PF-84 y
 * PF-90): 90 días tras la primera entrega del informe, o tras la última
 * actividad del cliente si el diagnóstico quedó sin enviar. Un caso enviado
 * sin informe entregado conserva el audio hasta la entrega.
 */
export const AUDIO_RETENTION_DAYS = 90;
/**
 * Un objeto sin grabación registrada se borra recién pasado este margen: la
 * subida guarda el objeto antes de confirmar la transacción.
 */
export const ORPHAN_GRACE_MS = 24 * 60 * 60_000;
/** Grabaciones por pasada: el resto queda para la siguiente. */
export const EXPIRED_BATCH_SIZE = 100;
/** Páginas del listado del bucket por pasada (1000 objetos cada una). */
export const MAX_LIST_PAGES = 20;

const DAY_MS = 24 * 60 * 60_000;

export type AudioDeletionReason = 'REPORT_DELIVERED' | 'ABANDONED';

interface ExpiredRecording {
  id: string;
  objectKey: string;
  diagnosticId: string;
  questionId: string;
  reason: AudioDeletionReason;
}

export interface RetentionResult {
  expired: number;
  orphans: number;
  failed: number;
}

/**
 * Conservación de la voz (PF-90). Borra el audio vencido del bucket y marca
 * la grabación (`audioDeletedAt`); el registro y la transcripción se
 * conservan. También borra los objetos huérfanos: subidos sin grabación
 * registrada, o reemplazados o borrados cuyo borrado falló. Todo es
 * idempotente: repetir una pasada no falla ni duplica la bitácora. Un fallo
 * del proveedor se reintenta en la siguiente pasada. Nada del audio ni de su
 * clave va a logs ni a la bitácora.
 */
@Injectable()
export class VoiceRetentionService implements OnModuleDestroy {
  private readonly logger = new Logger(VoiceRetentionService.name);
  private running: Promise<RetentionResult> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Una pasada completa; si ya hay una en curso, devuelve esa. Nunca lanza. */
  run(now = new Date()): Promise<RetentionResult> {
    this.running ??= this.sweep(now).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async onModuleDestroy() {
    await this.running;
  }

  private async sweep(now: Date): Promise<RetentionResult> {
    const result: RetentionResult = { expired: 0, orphans: 0, failed: 0 };
    try {
      await this.deleteExpired(now, result);
      await this.deleteOrphans(now, result);
    } catch (error) {
      // La base o el listado del bucket no respondieron: la siguiente pasada
      // retoma. Solo el nombre del error.
      this.logger.error(
        error instanceof StorageError
          ? `Conservación de la voz: el almacenamiento no respondió (${error.reason})`
          : `Falló la pasada de conservación de la voz: ${errorName(error)}`,
      );
    }
    if (result.expired || result.orphans || result.failed) {
      this.logger.log(
        `Conservación de la voz: ${result.expired} audios vencidos y ${result.orphans} huérfanos borrados, ${result.failed} fallidos`,
      );
    }
    return result;
  }

  private async deleteExpired(now: Date, result: RetentionResult) {
    const cutoff = new Date(now.getTime() - AUDIO_RETENTION_DAYS * DAY_MS);
    const expired = await this.prisma.$queryRaw<ExpiredRecording[]>`
      SELECT r.id, r.object_key AS "objectKey",
             a.diagnostic_id AS "diagnosticId", a.question_id AS "questionId",
             CASE WHEN delivered.at IS NOT NULL THEN 'REPORT_DELIVERED'
                  ELSE 'ABANDONED' END AS reason
      FROM answer_recordings r
      JOIN answers a ON a.id = r.answer_id
      JOIN diagnostics d ON d.id = a.diagnostic_id
      LEFT JOIN LATERAL (
        SELECT min(rd.created_at) AS at
        FROM reviews rv
        JOIN reports rp ON rp.review_id = rv.id
        JOIN report_deliveries rd ON rd.report_id = rp.id
        WHERE rv.diagnostic_id = d.id
      ) delivered ON true
      WHERE r.audio_deleted_at IS NULL
        AND (
          delivered.at < ${cutoff}
          OR (d.status <> 'COMPLETED' AND d.last_activity_at < ${cutoff})
        )
      ORDER BY r.created_at, r.id
      LIMIT ${EXPIRED_BATCH_SIZE}
    `;

    for (const recording of expired) {
      try {
        // Primero el objeto: si después falla la base, la siguiente pasada
        // vuelve a borrarlo (no falla) y recién ahí lo marca.
        await this.storage.delete(recording.objectKey);
      } catch (error) {
        result.failed += 1;
        this.logger.warn(
          `No se pudo borrar el audio de la grabación ${recording.id}: ${errorName(error)}`,
        );
        continue;
      }
      if (await this.markDeleted(recording, now)) result.expired += 1;
    }
  }

  /**
   * `false` si otra pasada ya la había marcado (no duplica la bitácora) o si
   * el cliente regrabó entre la consulta y la marca: el audio nuevo tiene otra
   * clave y no se toca.
   */
  private markDeleted(recording: ExpiredRecording, now: Date) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.answerRecording.updateMany({
        where: {
          id: recording.id,
          objectKey: recording.objectKey,
          audioDeletedAt: null,
        },
        data: { audioDeletedAt: now },
      });
      if (count === 0) return false;
      // Lo que no llegó a transcribirse ya no puede hacerlo.
      await tx.answerTranscription.updateMany({
        where: {
          recordingId: recording.id,
          status: { not: TranscriptionStatus.COMPLETED },
        },
        data: {
          status: TranscriptionStatus.FAILED,
          lastErrorCode: TranscriptionErrorCode.AUDIO_DELETED,
        },
      });
      await this.record(
        tx,
        'VOICE_AUDIO_DELETED',
        'AnswerRecording',
        recording.id,
        {
          diagnosticId: recording.diagnosticId,
          questionId: recording.questionId,
          reason: recording.reason,
        },
      );
      return true;
    });
  }

  /**
   * Objetos del bucket que ninguna grabación con audio apunta, con más de
   * `ORPHAN_GRACE_MS`. Una sola entrada en la bitácora por pasada, con la
   * cantidad: no hay entidad a la que asociarlos.
   */
  private async deleteOrphans(now: Date, result: RetentionResult) {
    const olderThan = now.getTime() - ORPHAN_GRACE_MS;
    let cursor: string | undefined;
    let deleted = 0;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const listed = await this.storage.list('voice', cursor);
      const candidates = listed.objects
        .filter((o) => o.lastModified.getTime() < olderThan)
        .map((o) => o.key);
      if (candidates.length > 0) {
        const live = await this.prisma.answerRecording.findMany({
          where: { objectKey: { in: candidates }, audioDeletedAt: null },
          select: { objectKey: true },
        });
        const kept = new Set(live.map((r) => r.objectKey));
        for (const key of candidates) {
          if (kept.has(key)) continue;
          try {
            await this.storage.delete(key);
            deleted += 1;
          } catch (error) {
            result.failed += 1;
            this.logger.warn(
              `No se pudo borrar un objeto huérfano: ${errorName(error)}`,
            );
          }
        }
      }
      cursor = listed.nextCursor;
      if (!cursor) break;
    }
    result.orphans += deleted;
    if (deleted > 0) {
      await this.record(this.prisma, 'VOICE_ORPHANS_DELETED', 'Storage', null, {
        count: deleted,
      });
    }
  }

  /** Ids, motivo y cantidades: nunca el audio ni su clave. */
  private record(
    client: Prisma.TransactionClient,
    action: string,
    entity: string,
    entityId: string | null,
    data: Prisma.InputJsonObject,
  ) {
    return this.audit.record(
      {
        actorType: AuditActorType.SYSTEM,
        action,
        entity,
        entityId: entityId ?? undefined,
        data,
      },
      client,
    );
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

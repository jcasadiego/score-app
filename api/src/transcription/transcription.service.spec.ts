import type { Mock } from 'vitest';
import { Readable } from 'node:stream';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TranscriptionErrorCode,
  TranscriptionStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageError } from '../storage/storage.port';
import { StorageService } from '../storage/storage.service';
import { SIMULATED_TRANSCRIPT } from './adapters/simulated-transcription.adapter';
import {
  BACKOFF_MS,
  LEASE_MS,
  MAX_ATTEMPTS,
  TranscriptionService,
} from './transcription.service';

const CLAIMED = {
  id: 'tr-1',
  attempts: 0,
  objectKey: 'voice/00000000-0000-4000-8000-000000000000',
  format: 'WEBM',
  diagnosticId: 'diag-1',
  questionId: 'q-1',
};

describe('TranscriptionService', () => {
  let tx: {
    $queryRaw: Mock;
    answerRecording: { findFirst: Mock };
    answerTranscription: {
      update: Mock;
      updateMany: Mock;
      upsert: Mock;
      findFirst: Mock;
    };
  };
  let audit: { record: Mock };
  let storage: { get: Mock };
  let env: Record<string, unknown>;

  function build() {
    const prisma = {
      ...tx,
      $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    return new TranscriptionService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as StorageService,
      { get: (key: string) => env[key] } as unknown as ConfigService<
        never,
        true
      >,
    );
  }

  /** Una pasada con una sola transcripción en la cola. */
  async function processOne(service: TranscriptionService, claimed = CLAIMED) {
    tx.$queryRaw.mockResolvedValueOnce([claimed]).mockResolvedValue([]);
    return service.processDue();
  }

  /** Lo último que se escribió al terminar el intento. */
  function finished() {
    return tx.answerTranscription.updateMany.mock.calls.at(-1)![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
  }

  beforeEach(() => {
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      answerRecording: {
        findFirst: vi.fn().mockResolvedValue({ audioDeletedAt: null }),
      },
      answerTranscription: {
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        upsert: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    audit = { record: vi.fn() };
    storage = {
      get: vi.fn(() =>
        Promise.resolve({ stream: Readable.from([Buffer.from('audio')]) }),
      ),
    };
    env = { NODE_ENV: 'development' };
  });

  describe('proveedor', () => {
    it('en desarrollo, vacío es el simulado', () => {
      expect(build().status()).toEqual({
        provider: 'simulated',
        model: 'simulated',
        simulated: true,
      });
    });

    it('en un servidor, vacío es disabled: nada sale de SCORE', async () => {
      env.NODE_ENV = 'production';
      const service = build();
      expect(service.status().provider).toBe('disabled');
      // Las pendientes esperan: ni siquiera se buscan.
      expect(await service.processDue()).toBe(0);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
  });

  it('al pedirla, deja la transcripción pendiente y sin el texto anterior', async () => {
    await build().requestFor(
      tx as unknown as Parameters<TranscriptionService['requestFor']>[0],
      'rec-1',
    );
    const args = tx.answerTranscription.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ recordingId: 'rec-1' });
    expect(args.update).toMatchObject({
      status: TranscriptionStatus.PENDING,
      attempts: 0,
      text: null,
      completedAt: null,
    });
  });

  it('reserva la transcripción antes de llamar al proveedor', async () => {
    const before = Date.now();
    await processOne(build());
    const reserve = tx.answerTranscription.update.mock.calls[0][0];
    expect(reserve.data.attempts).toBe(1);
    expect(reserve.data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + LEASE_MS,
    );
  });

  it('con el simulado queda completada, y la bitácora no lleva el texto', async () => {
    expect(await processOne(build())).toBe(1);
    const { where, data } = finished();
    expect(where).toEqual({
      id: 'tr-1',
      status: TranscriptionStatus.PENDING,
      attempts: 1,
      recording: { objectKey: CLAIMED.objectKey },
    });
    expect(data).toMatchObject({
      status: TranscriptionStatus.COMPLETED,
      text: SIMULATED_TRANSCRIPT,
      provider: 'simulated',
      model: 'simulated',
    });
    const entry = audit.record.mock.calls[0][0];
    expect(entry.action).toBe('TRANSCRIPTION_COMPLETED');
    expect(JSON.stringify(entry)).not.toContain('simulada');
  });

  it('si el audio cambió mientras se procesaba, descarta el resultado', async () => {
    tx.answerTranscription.updateMany.mockResolvedValue({ count: 0 });
    await processOne(build());
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('un error temporal se reintenta más tarde', async () => {
    env.TRANSCRIPTION_SIMULATED_FAILURE = TranscriptionErrorCode.RATE_LIMITED;
    const before = Date.now();
    await processOne(build());
    const { data } = finished();
    expect(data.status).toBe(TranscriptionStatus.PENDING);
    expect(data.lastErrorCode).toBe(TranscriptionErrorCode.RATE_LIMITED);
    expect((data.nextAttemptAt as Date).getTime()).toBeGreaterThanOrEqual(
      before + BACKOFF_MS[0],
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('agotados los intentos queda fallida y se registra', async () => {
    env.TRANSCRIPTION_SIMULATED_FAILURE = TranscriptionErrorCode.TIMEOUT;
    await processOne(build(), { ...CLAIMED, attempts: MAX_ATTEMPTS - 1 });
    expect(finished().data.status).toBe(TranscriptionStatus.FAILED);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: 'TRANSCRIPTION_FAILED',
      data: { code: 'TIMEOUT', attempts: MAX_ATTEMPTS },
    });
  });

  it('un audio inválido falla sin reintentos', async () => {
    env.TRANSCRIPTION_SIMULATED_FAILURE = TranscriptionErrorCode.INVALID_AUDIO;
    await processOne(build());
    expect(finished().data.status).toBe(TranscriptionStatus.FAILED);
  });

  it('si el almacenamiento falla, reintenta; si el audio ya no está, falla', async () => {
    storage.get.mockRejectedValueOnce(new StorageError('unavailable'));
    await processOne(build());
    expect(finished().data).toMatchObject({
      status: TranscriptionStatus.PENDING,
      lastErrorCode: TranscriptionErrorCode.STORAGE_UNAVAILABLE,
    });

    storage.get.mockRejectedValueOnce(new StorageError('not_found'));
    await processOne(build());
    expect(finished().data.status).toBe(TranscriptionStatus.FAILED);
  });

  describe('reintento manual', () => {
    const VIEW = { id: 'tr-1', status: TranscriptionStatus.PENDING };

    it('pone en cola una fallida y lo registra con quién', async () => {
      tx.answerTranscription.findFirst.mockResolvedValue(VIEW);
      const view = await build().retry('diag-1', 'q-1', 'user-1');
      expect(view).toEqual({ status: TranscriptionStatus.PENDING });
      expect(tx.answerTranscription.updateMany.mock.calls[0][0]).toMatchObject({
        where: { status: TranscriptionStatus.FAILED },
        data: { status: TranscriptionStatus.PENDING, attempts: 0 },
      });
      expect(audit.record.mock.calls[0][0]).toMatchObject({
        actorId: 'user-1',
        action: 'TRANSCRIPTION_RETRIED',
        entityId: 'tr-1',
      });
    });

    it('409 si no está fallida', async () => {
      tx.answerTranscription.updateMany.mockResolvedValue({ count: 0 });
      tx.answerTranscription.findFirst.mockResolvedValue(VIEW);
      await expect(build().retry('diag-1', 'q-1', 'u')).rejects.toThrow(
        ConflictException,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('409 si el audio ya se borró por plazo', async () => {
      tx.answerTranscription.updateMany.mockResolvedValue({ count: 0 });
      tx.answerTranscription.findFirst.mockResolvedValue(VIEW);
      tx.answerRecording.findFirst.mockResolvedValue({
        audioDeletedAt: new Date(),
      });
      await expect(build().retry('diag-1', 'q-1', 'u')).rejects.toMatchObject({
        response: { code: 'TRANSCRIPTION_AUDIO_DELETED' },
      });
    });

    it('404 si la respuesta no tiene grabación', async () => {
      tx.answerTranscription.updateMany.mockResolvedValue({ count: 0 });
      tx.answerTranscription.findFirst.mockResolvedValue(null);
      await expect(build().retry('diag-1', 'q-1', 'u')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

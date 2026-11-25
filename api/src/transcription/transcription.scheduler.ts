import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { ValidatedEnv } from '../config/validate-env';
import { TranscriptionService } from './transcription.service';

export const TRANSCRIPTION_INTERVAL = 'transcription';

/**
 * Pasada periódica de las transcripciones: los reintentos que ya tocan, las
 * reservas vencidas y lo que quedó pendiente si la API se reinició o estuvo
 * en `disabled`. Con `TRANSCRIPTION_INTERVAL_MS=0` no corre (tests).
 */
@Injectable()
export class TranscriptionScheduler implements OnApplicationBootstrap {
  constructor(
    private readonly transcriptions: TranscriptionService,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  onApplicationBootstrap() {
    const intervalMs = this.config.get('TRANSCRIPTION_INTERVAL_MS', {
      infer: true,
    });
    if (intervalMs <= 0) return;
    this.registry.addInterval(
      TRANSCRIPTION_INTERVAL,
      setInterval(() => this.transcriptions.kick(), intervalMs),
    );
    this.transcriptions.kick();
  }
}

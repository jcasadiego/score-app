import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { ValidatedEnv } from '../config/validate-env';
import { StorageService } from '../storage/storage.service';
import { VoiceRetentionService } from './voice-retention.service';

export const VOICE_RETENTION_INTERVAL = 'voice-retention';

/**
 * Pasada periódica de la conservación de la voz (PF-90), también al arrancar.
 * Con `VOICE_RETENTION_INTERVAL_MS=0` no corre (tests). Con varias instancias
 * no hace falta coordinar: cada paso es idempotente.
 */
@Injectable()
export class VoiceRetentionScheduler implements OnApplicationBootstrap {
  constructor(
    private readonly retention: VoiceRetentionService,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<ValidatedEnv, true>,
    private readonly storage: StorageService,
  ) {}

  onApplicationBootstrap() {
    const intervalMs = this.config.get('VOICE_RETENTION_INTERVAL_MS', {
      infer: true,
    });
    // Sin almacenamiento no hay nada que borrar: no ensucia el log cada pasada.
    if (intervalMs <= 0 || this.storage.driver === 'disabled') return;
    this.registry.addInterval(
      VOICE_RETENTION_INTERVAL,
      setInterval(() => void this.retention.run(), intervalMs),
    );
    void this.retention.run();
  }
}

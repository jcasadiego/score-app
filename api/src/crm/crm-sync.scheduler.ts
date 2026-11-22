import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { ValidatedEnv } from '../config/validate-env';
import { CrmSyncService } from './crm-sync.service';

export const CRM_SYNC_INTERVAL = 'crm-sync';

/**
 * Pasada periódica de la bandeja del CRM: recoge los reintentos que ya tocan y
 * lo que quedó pendiente si la API se reinició. Con `CRM_SYNC_INTERVAL_MS=0`
 * no corre (tests): los eventos salen solo con el aviso tras cada cambio.
 */
@Injectable()
export class CrmSyncScheduler implements OnApplicationBootstrap {
  constructor(
    private readonly sync: CrmSyncService,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  onApplicationBootstrap() {
    const intervalMs = this.config.get('CRM_SYNC_INTERVAL_MS', { infer: true });
    if (intervalMs <= 0) return;
    // `ScheduleModule` limpia el intervalo al cerrar la app.
    this.registry.addInterval(
      CRM_SYNC_INTERVAL,
      setInterval(() => this.sync.kick(), intervalMs),
    );
    // Al arrancar: lo que quedó en cola mientras la API estaba apagada o dormida.
    this.sync.kick();
  }
}

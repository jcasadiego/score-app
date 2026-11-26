import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { ValidatedEnv } from '../config/validate-env';
import { SecurityAlertsService } from './security-alerts.service';

export const SECURITY_ALERTS_INTERVAL = 'security-alerts';

/**
 * Pasada periódica de las alertas de seguridad. Con
 * `SECURITY_ALERT_INTERVAL_MS=0` no corre (tests); sin `SECURITY_ALERT_EMAIL`
 * tampoco, y en producción lo avisa al arrancar.
 */
@Injectable()
export class SecurityAlertsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SecurityAlertsScheduler.name);
  private running = false;

  constructor(
    private readonly alerts: SecurityAlertsService,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  onApplicationBootstrap() {
    const intervalMs = this.config.get('SECURITY_ALERT_INTERVAL_MS', {
      infer: true,
    });
    if (intervalMs <= 0) return;
    if (!this.config.get('SECURITY_ALERT_EMAIL', { infer: true })) {
      if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
        this.logger.warn(
          'Sin SECURITY_ALERT_EMAIL: las alertas de seguridad están apagadas',
        );
      }
      return;
    }
    // `ScheduleModule` limpia el intervalo al cerrar la app.
    this.registry.addInterval(
      SECURITY_ALERTS_INTERVAL,
      setInterval(() => void this.tick(), intervalMs),
    );
  }

  /** Una pasada a la vez: si la anterior sigue, esta se salta. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.alerts.check();
    } catch (error) {
      this.logger.error(
        'Falló la revisión de alertas de seguridad',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}

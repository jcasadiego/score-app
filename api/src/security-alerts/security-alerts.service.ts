import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnv } from '../config/validate-env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { completedWindows, SECURITY_ALERT_RULES } from './security-alert-rules';

/** Marca de "esta alerta ya salió" en `throttle_counters`. */
export const SECURITY_ALERT_THROTTLER = 'security-alert';

function markKey(alertId: string): string {
  return createHash('sha256').update(alertId).digest('hex');
}

/** Cuánto se guarda la marca: más que las ventanas que se revisan. */
const MARK_TTL_SECONDS = 24 * 60 * 60;

/**
 * Alertas sobre eventos de seguridad (PF-55): cuenta en la bitácora los
 * intentos fallidos, accesos denegados, bloqueos, MFA restablecidos y errores
 * 5xx de cada ventana, y avisa al correo de soporte (`SECURITY_ALERT_EMAIL`)
 * cuando pasan su umbral. El correo lleva solo el hecho y la cantidad.
 *
 * Cada alerta sale una sola vez aunque haya varias instancias o la ventana se
 * revise de nuevo: la primera que guarda la marca en Postgres es la que envía.
 */
@Injectable()
export class SecurityAlertsService {
  private readonly logger = new Logger(SecurityAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService<ValidatedEnv, true>,
  ) {}

  /** Revisa las últimas ventanas completas. Devuelve cuántas alertas envió. */
  async check(now = Date.now()): Promise<number> {
    const to = this.config.get('SECURITY_ALERT_EMAIL', { infer: true });
    if (!to) return 0;

    let sent = 0;
    for (const window of completedWindows(now)) {
      const counts = await this.countByAction(window.start, window.end);
      for (const rule of SECURITY_ALERT_RULES) {
        const count = counts.get(rule.action) ?? 0;
        if (count < rule.threshold) continue;

        const alertId = `${rule.action}:${window.start.toISOString()}`;
        if (!(await this.claim(alertId))) continue;

        const result = await this.mail.sendSecurityAlert(
          to,
          {
            event: rule.event,
            count,
            threshold: rule.threshold,
            windowStart: window.start.toISOString(),
            windowEnd: window.end.toISOString(),
          },
          { entity: 'SecurityAlert', entityId: alertId },
        );
        if (result.sent) {
          sent += 1;
        } else {
          // Ya quedó `EMAIL_FAILED` en la bitácora. Se suelta la marca para que
          // la próxima pasada lo reintente mientras la ventana siga en revisión.
          this.logger.error(`No salió la alerta de seguridad ${alertId}`);
          await this.release(alertId);
        }
      }
    }
    return sent;
  }

  private async countByAction(start: Date, end: Date) {
    const rows = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: {
        action: { in: SECURITY_ALERT_RULES.map((rule) => rule.action) },
        createdAt: { gte: start, lt: end },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.action, row._count._all]));
  }

  private async release(alertId: string): Promise<void> {
    await this.prisma.throttleCounter.deleteMany({
      where: { key: markKey(alertId), throttler: SECURITY_ALERT_THROTTLER },
    });
  }

  /** `true` solo para la primera instancia que reclama esta alerta. */
  private async claim(alertId: string): Promise<boolean> {
    const key = markKey(alertId);
    const rows = await this.prisma.$queryRaw<{ key: string }[]>`
      INSERT INTO throttle_counters (key, throttler, hits, window_ends_at)
      VALUES (
        ${key}, ${SECURITY_ALERT_THROTTLER}, 1,
        now() + make_interval(secs => ${MARK_TTL_SECONDS}::float8)
      )
      ON CONFLICT (key, throttler) DO NOTHING
      RETURNING key`;
    return rows.length > 0;
  }
}

import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { PrismaService } from '../prisma/prisma.service';

/** El paquete no exporta el tipo del registro: se toma de la interfaz. */
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

/** Cada cuánto, como mucho, este proceso borra los contadores vencidos. */
const SWEEP_INTERVAL_MS = 60_000;

interface CounterRow {
  hits: number;
  time_to_expire: number;
  is_blocked: boolean;
  time_to_block_expire: number;
}

/**
 * Contadores del límite de peticiones en Postgres (PF-60), para que el límite
 * se mantenga con varias instancias de la API. Ventana fija por clave: el
 * primer golpe la abre, al pasar el límite la clave queda bloqueada
 * `blockDuration`, y al vencer la ventana o el bloqueo vuelve a empezar.
 *
 * Un solo `INSERT ... ON CONFLICT` por petición: atómico entre instancias, y el
 * reloj es el de la base, no el de cada proceso.
 */
export class PostgresThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(PostgresThrottlerStorage.name);
  private lastSweep = 0;

  constructor(private readonly prisma: PrismaService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    this.sweepSometimes();
    const [row] = await this.prisma.$queryRaw<CounterRow[]>`
      INSERT INTO throttle_counters AS t (key, throttler, hits, window_ends_at, blocked_until)
      VALUES (
        ${key}, ${throttlerName}, 1,
        now() + make_interval(secs => ${ttl}::float8 / 1000),
        CASE WHEN 1 > ${limit}::int
          THEN now() + make_interval(secs => ${blockDuration}::float8 / 1000) END
      )
      ON CONFLICT (key, throttler) DO UPDATE SET
        hits = CASE
          WHEN t.blocked_until > now() THEN t.hits
          WHEN t.window_ends_at <= now() OR t.blocked_until IS NOT NULL THEN 1
          ELSE t.hits + 1 END,
        window_ends_at = CASE
          WHEN t.blocked_until > now() THEN t.window_ends_at
          WHEN t.window_ends_at <= now() OR t.blocked_until IS NOT NULL
            THEN now() + make_interval(secs => ${ttl}::float8 / 1000)
          ELSE t.window_ends_at END,
        blocked_until = CASE
          WHEN t.blocked_until > now() THEN t.blocked_until
          WHEN t.window_ends_at <= now() OR t.blocked_until IS NOT NULL THEN NULL
          WHEN t.hits + 1 > ${limit}::int
            THEN now() + make_interval(secs => ${blockDuration}::float8 / 1000)
          ELSE NULL END
      RETURNING
        hits,
        GREATEST(0, ceil(extract(epoch FROM window_ends_at - now())))::int AS time_to_expire,
        COALESCE(blocked_until > now(), false) AS is_blocked,
        GREATEST(0, COALESCE(ceil(extract(epoch FROM blocked_until - now())), 0))::int
          AS time_to_block_expire`;

    return {
      totalHits: row.hits,
      timeToExpire: row.time_to_expire,
      isBlocked: row.is_blocked,
      timeToBlockExpire: row.time_to_block_expire,
    };
  }

  /** Borra, sin esperar, los contadores que ya no limitan a nadie. */
  private sweepSometimes(): void {
    const now = Date.now();
    if (now - this.lastSweep < SWEEP_INTERVAL_MS) return;
    this.lastSweep = now;
    this.prisma.$executeRaw`
      DELETE FROM throttle_counters
       WHERE window_ends_at < now()
         AND (blocked_until IS NULL OR blocked_until < now())`.catch(
      (error: unknown) =>
        this.logger.warn(
          `No se pudieron borrar los contadores vencidos: ${error instanceof Error ? error.message : 'error'}`,
        ),
    );
  }
}

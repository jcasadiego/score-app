import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnv } from '../config/validate-env';
import { PrismaService } from '../prisma/prisma.service';

/** Nombre del contador en `throttle_counters`, aparte del límite de peticiones. */
export const NOTICE_BUDGET_THROTTLER = 'notice-budget';

export const NOTICE_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

interface MemoryCounter {
  hits: number;
  endsAt: number;
}

/**
 * Cupo global de avisos al equipo (PF-36): cuenta cuántos van en la ventana,
 * sin importar de qué IP vino el lead. Ventana fija: el primer aviso la abre y
 * al vencer vuelve a empezar.
 *
 * Con `THROTTLE_STORAGE=postgres` el contador vive en `throttle_counters`, así
 * que se comparte entre instancias de la API; un solo `INSERT ... ON CONFLICT`
 * lo hace atómico. Con `memory` (tests) es por proceso.
 */
@Injectable()
export class NoticeBudgetService {
  private readonly memory = new Map<string, MemoryCounter>();
  private readonly usePostgres: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<ValidatedEnv, true>,
  ) {
    this.usePostgres =
      config.get('THROTTLE_STORAGE', { infer: true }) === 'postgres';
  }

  /** Suma un aviso y devuelve cuántos van en la ventana, este incluido. */
  async consume(
    notice: string,
    windowMs = NOTICE_BUDGET_WINDOW_MS,
  ): Promise<number> {
    const key = createHash('sha256').update(notice).digest('hex');
    return this.usePostgres
      ? this.consumeInPostgres(key, windowMs)
      : this.consumeInMemory(key, windowMs);
  }

  private async consumeInPostgres(
    key: string,
    windowMs: number,
  ): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ hits: number }[]>`
      INSERT INTO throttle_counters AS t (key, throttler, hits, window_ends_at)
      VALUES (
        ${key}, ${NOTICE_BUDGET_THROTTLER}, 1,
        now() + make_interval(secs => ${windowMs}::float8 / 1000)
      )
      ON CONFLICT (key, throttler) DO UPDATE SET
        hits = CASE WHEN t.window_ends_at <= now() THEN 1 ELSE t.hits + 1 END,
        window_ends_at = CASE
          WHEN t.window_ends_at <= now()
            THEN now() + make_interval(secs => ${windowMs}::float8 / 1000)
          ELSE t.window_ends_at END
      RETURNING hits`;
    return row.hits;
  }

  private consumeInMemory(key: string, windowMs: number): number {
    const now = Date.now();
    const counter = this.memory.get(key);
    if (!counter || counter.endsAt <= now) {
      this.memory.set(key, { hits: 1, endsAt: now + windowMs });
      return 1;
    }
    counter.hits += 1;
    return counter.hits;
  }
}

import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RulesService } from '../../rules/rules.service';
import type {
  ScoringEnginePort,
  ScoringInput,
  ScoringOutput,
} from '../scoring-engine.port';

/** Reglas que se registran para el adapter simulado si no hay una activa. */
export const SIMULATED_RULE_SET = {
  simulated: true,
  description:
    'Reglas del adapter simulado (PF-24). No son las reglas reales de SCORE.',
};

const DIMENSIONS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'];

/** JSON con las claves ordenadas: el mismo input da siempre el mismo texto. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Adapter simulado y determinístico: deriva números de un SHA-256 de las
 * respuestas, con la forma del brief del cliente (Potencial 0–100, Madurez
 * 1–4, Confianza 0–1, dimensiones D1–D8). No es una fórmula de SCORE ni lo
 * intenta: solo permite construir y probar el resto. No se admite con
 * `APP_ENV=production` (`validate-env.ts`).
 */
@Injectable()
export class SimulatedScoringEngineAdapter
  implements ScoringEnginePort, OnModuleInit
{
  readonly driver = 'stub' as const;
  readonly enabled = true;
  private readonly logger = new Logger(SimulatedScoringEngineAdapter.name);

  constructor(private readonly rules: RulesService) {}

  /** Sin una versión de reglas activa, registra y activa la simulada. */
  async onModuleInit(): Promise<void> {
    if (await this.rules.getActiveVersion()) return;
    const version = await this.rules.createVersion(SIMULATED_RULE_SET);
    await this.rules.activateVersion(version.number);
    this.logger.log(
      `Versión de reglas simulada ${version.number} registrada y activa`,
    );
  }

  async evaluate(input: ScoringInput): Promise<ScoringOutput> {
    const active = await this.rules.getActiveVersion();
    if (!active) throw new Error('No hay una versión de reglas activa.');

    const digest = createHash('sha256').update(canonical(input)).digest();
    const byte = (i: number) => digest[i % digest.length];
    const dimensions = Object.fromEntries(
      DIMENSIONS.map((d, i) => [d, Math.round((byte(4 + i) / 255) * 100)]),
    );
    return {
      result: {
        simulated: true,
        potential: Math.round((byte(0) / 255) * 100),
        maturity: 1 + (byte(1) % 4),
        confidence: Math.round((byte(2) / 255) * 100) / 100,
        dimensions,
      },
      ruleSetVersionNumber: active.number,
      simulated: true,
    };
  }
}

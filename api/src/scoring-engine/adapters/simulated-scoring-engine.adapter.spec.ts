import { describe, expect, it, vi } from 'vitest';
import type { RulesService } from '../../rules/rules.service';
import type { ScoringInput } from '../scoring-engine.port';
import { SimulatedScoringEngineAdapter } from './simulated-scoring-engine.adapter';

const rules = (active: { number: number } | null) =>
  ({
    getActiveVersion: vi.fn().mockResolvedValue(active),
    createVersion: vi.fn().mockResolvedValue({ number: 7 }),
    activateVersion: vi.fn().mockResolvedValue([]),
  }) as unknown as RulesService & {
    createVersion: ReturnType<typeof vi.fn>;
    activateVersion: ReturnType<typeof vi.fn>;
  };

const INPUT: ScoringInput = {
  family: 'PROJECT',
  questionnaireVersion: 1,
  answers: {
    stage: 'released',
    channels: ['spotify', 'shows'],
    story: 'Un disco',
  },
};

describe('SimulatedScoringEngineAdapter', () => {
  it('da el mismo resultado para las mismas respuestas, sin importar el orden de las claves', async () => {
    const adapter = new SimulatedScoringEngineAdapter(rules({ number: 3 }));
    const reordered: ScoringInput = {
      answers: {
        story: 'Un disco',
        channels: ['spotify', 'shows'],
        stage: 'released',
      },
      questionnaireVersion: 1,
      family: 'PROJECT',
    };
    expect(await adapter.evaluate(INPUT)).toEqual(
      await adapter.evaluate(reordered),
    );
  });

  it('respeta las escalas del brief y queda marcado como simulado', async () => {
    const adapter = new SimulatedScoringEngineAdapter(rules({ number: 3 }));
    const { result, ruleSetVersionNumber, simulated } =
      await adapter.evaluate(INPUT);
    expect(simulated).toBe(true);
    expect(ruleSetVersionNumber).toBe(3);
    expect(result.simulated).toBe(true);
    expect(result.potential).toBeGreaterThanOrEqual(0);
    expect(result.potential).toBeLessThanOrEqual(100);
    expect([1, 2, 3, 4]).toContain(result.maturity);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(Object.keys(result.dimensions as object)).toEqual([
      'D1',
      'D2',
      'D3',
      'D4',
      'D5',
      'D6',
      'D7',
      'D8',
    ]);
  });

  it('respuestas distintas dan otro resultado', async () => {
    const adapter = new SimulatedScoringEngineAdapter(rules({ number: 3 }));
    const other = { ...INPUT, answers: { ...INPUT.answers, stage: 'idea' } };
    expect(await adapter.evaluate(other)).not.toEqual(
      await adapter.evaluate(INPUT),
    );
  });

  it('sin una versión de reglas activa, registra y activa la simulada al iniciar', async () => {
    const service = rules(null);
    await new SimulatedScoringEngineAdapter(service).onModuleInit();
    expect(service.createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ simulated: true }),
    );
    expect(service.activateVersion).toHaveBeenCalledWith(7);
  });

  it('con una versión activa no registra otra', async () => {
    const service = rules({ number: 3 });
    await new SimulatedScoringEngineAdapter(service).onModuleInit();
    expect(service.createVersion).not.toHaveBeenCalled();
  });
});

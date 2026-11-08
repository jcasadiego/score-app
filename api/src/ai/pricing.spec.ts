import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from './pricing';

describe('estimateCostUsd', () => {
  it('calcula con la tarifa del modelo', () => {
    // 10.000 de entrada y 2.000 de salida en Opus 5.5: 0,04 + 0,04.
    expect(estimateCostUsd('claude-opus-5-5', 10_000, 2_000)).toBe(0.08);
  });

  it('el simulado no cuesta, y un modelo sin precio da null', () => {
    expect(estimateCostUsd('stub', 100, 100)).toBe(0);
    expect(estimateCostUsd('otro-modelo', 100, 100)).toBeNull();
  });
});

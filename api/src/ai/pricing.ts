/**
 * Precio por millón de tokens, en dólares, de la API de Anthropic (tarifas
 * estándar, sin caché ni descuentos). Solo para estimar el costo de cada
 * llamada: la factura manda. Revisar al cambiar de modelo.
 */
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  // Hasta 100K tokens de entrada; más allá cuesta $0.50 / $2.50.
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

/** Costo aproximado en dólares, o `null` si el modelo no tiene precio aquí. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (model === 'stub') return 0;
  const price = PRICES_PER_MTOK[model];
  if (!price) return null;
  const cost =
    (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

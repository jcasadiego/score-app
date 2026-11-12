import { ReportPart } from '../../generated/prisma/enums';
import type { DimensionTexts } from '../ai/prompts/report-draft.prompt';

/** Tope de dimensiones por informe: el brief habla de ocho (D1–D8). */
export const MAX_DIMENSIONS = 20;

/** Un código de dimensión como los del motor (`D1`), nunca texto libre. */
const DIMENSION_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

/** Las partes en el orden del informe, con su clave en la respuesta de la IA. */
export const REPORT_PARTS: { part: ReportPart; key: keyof DimensionTexts }[] = [
  { part: ReportPart.FINDING, key: 'finding' },
  { part: ReportPart.IMPLICATION, key: 'implication' },
  { part: ReportPart.RECOMMENDATION, key: 'recommendation' },
  { part: ReportPart.NEXT_STEP, key: 'nextStep' },
];

export function partKey(part: ReportPart): keyof DimensionTexts {
  return REPORT_PARTS.find((p) => p.part === part)!.key;
}

/**
 * Los códigos de dimensión del resultado del motor, en su orden. Vacío si el
 * resultado no trae dimensiones o alguna no tiene la forma esperada: sin ellas
 * no hay informe que redactar.
 */
export function dimensionsOf(output: unknown): string[] {
  if (!output || typeof output !== 'object') return [];
  const dimensions = (output as Record<string, unknown>).dimensions;
  if (
    !dimensions ||
    typeof dimensions !== 'object' ||
    Array.isArray(dimensions)
  ) {
    return [];
  }
  const codes = Object.keys(dimensions);
  const valid =
    codes.length > 0 &&
    codes.length <= MAX_DIMENSIONS &&
    codes.every((code) => DIMENSION_CODE.test(code));
  return valid ? codes : [];
}

/**
 * Lo que la IA recibe del resultado: todo menos la marca de simulado, que no
 * le sirve para redactar.
 */
export function resultForAi(output: unknown): Record<string, unknown> {
  const result = { ...(output as Record<string, unknown>) };
  delete result.simulated;
  return result;
}

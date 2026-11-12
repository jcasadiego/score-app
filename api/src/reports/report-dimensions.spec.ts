import { describe, expect, it } from 'vitest';
import {
  reportDraftSchema,
  REPORT_SECTION_SCHEMA,
} from '../ai/prompts/report-draft.prompt';
import { dimensionsOf, MAX_DIMENSIONS, resultForAi } from './report-dimensions';

const texts = {
  finding: 'Hallazgo',
  implication: 'Implicación',
  recommendation: 'Recomendación',
  nextStep: 'Próximo paso',
};

describe('dimensionsOf', () => {
  it('devuelve los códigos del resultado en su orden', () => {
    expect(dimensionsOf({ dimensions: { D2: 10, D1: 50 } })).toEqual([
      'D2',
      'D1',
    ]);
  });

  it.each([
    ['sin resultado', null],
    ['sin dimensiones', { potential: 40 }],
    ['dimensiones como lista', { dimensions: ['D1'] }],
    ['dimensiones vacías', { dimensions: {} }],
    ['un código con espacios o símbolos', { dimensions: { 'D1 <b>': 1 } }],
    [
      'demasiadas dimensiones',
      {
        dimensions: Object.fromEntries(
          Array.from({ length: MAX_DIMENSIONS + 1 }, (_, i) => [`D${i}`, 1]),
        ),
      },
    ],
  ])('vacío con %s: sin dimensiones no hay informe', (_label, output) => {
    expect(dimensionsOf(output)).toEqual([]);
  });

  it('a la IA no le llega la marca de simulado', () => {
    expect(resultForAi({ simulated: true, potential: 4 })).toEqual({
      potential: 4,
    });
  });
});

describe('esquema de la respuesta de la IA (OWASP LLM05)', () => {
  const schema = reportDraftSchema(['D1', 'D2']);

  it('acepta exactamente las dimensiones pedidas', () => {
    const parsed = schema.parse({ dimensions: { D1: texts, D2: texts } });
    expect(Object.keys(parsed.dimensions)).toEqual(['D1', 'D2']);
  });

  it.each([
    ['falta una dimensión', { dimensions: { D1: texts } }],
    [
      'sobra una dimensión',
      { dimensions: { D1: texts, D2: texts, D9: texts } },
    ],
    ['falta una parte', { dimensions: { D1: texts, D2: { finding: 'x' } } }],
    [
      'una parte vacía',
      { dimensions: { D1: texts, D2: { ...texts, nextStep: '   ' } } },
    ],
    [
      'una parte demasiado larga',
      {
        dimensions: { D1: texts, D2: { ...texts, finding: 'x'.repeat(2001) } },
      },
    ],
  ])('rechaza la respuesta si %s', (_label, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it('una sección regenerada es un texto no vacío, sin espacios sobrantes', () => {
    expect(REPORT_SECTION_SCHEMA.parse({ text: '  Texto  ' })).toEqual({
      text: 'Texto',
    });
    expect(REPORT_SECTION_SCHEMA.safeParse({ text: '' }).success).toBe(false);
  });
});

import { z } from 'zod';
import type { PromptDefinition } from '../ai.types';

/**
 * Redacción del informe (PF-42). Cambiar el texto es subir la versión: cada
 * llamada guarda la que usó (`ai_call_logs`).
 */
const COMMON = `Eres un asistente que redacta el informe de diagnóstico financiero de Music Finance Pro para un artista o proyecto musical. Recibes el resultado ya calculado por el motor de SCORE (puntajes por dimensión y generales), el cuestionario con las respuestas del cliente (preguntas por "code", opciones por "value") y las notas del equipo de revisión.

Cada dimensión del informe tiene cuatro partes:
- finding (Hallazgo): qué muestra el resultado y las respuestas en esa dimensión.
- implication (Implicación): qué significa eso para el negocio del artista.
- recommendation (Recomendación): qué conviene hacer.
- nextStep (Próximo paso): una acción concreta y alcanzable para empezar.

Reglas de redacción:
- En español neutro, en segunda persona ("tu catálogo", "te conviene"), claro y sin jerga financiera innecesaria.
- Cada parte en uno o dos párrafos breves, sin títulos, listas ni formato Markdown.
- Usa los puntajes tal como vienen: nunca calcules, estimes ni cambies un puntaje, y no inventes cifras que no estén en los datos.
- Las notas del equipo de revisión son contexto profesional: tenlas en cuenta, pero no las cites ni menciones al equipo.
- No incluyas nombres de personas, correos ni teléfonos.
- Este es un borrador: una persona lo revisa y lo aprueba antes de entregarlo.`;

export const REPORT_DRAFT_PROMPT: PromptDefinition = {
  id: 'report.draft',
  version: 'v1',
  instructions: `${COMMON}

Tu tarea: redacta las cuatro partes de cada dimensión que aparece en "result.dimensions", usando como clave el mismo código de dimensión.`,
};

export const REPORT_SECTION_PROMPT: PromptDefinition = {
  id: 'report.section',
  version: 'v1',
  instructions: `${COMMON}

Tu tarea: vuelve a redactar solo la parte indicada en "target" ("dimension" y "part") del informe. En "currentDimension" tienes el texto actual de las cuatro partes de esa dimensión: mantén la coherencia con las otras partes y mejora la indicada, sin repetirla tal cual.`,
};

/** Largo máximo de una parte redactada por la IA (las personas, hasta 4000). */
export const AI_SECTION_MAX = 2000;

const SECTION_TEXT = z.string().trim().min(1).max(AI_SECTION_MAX);

const DIMENSION_TEXTS = z.object({
  finding: SECTION_TEXT,
  implication: SECTION_TEXT,
  recommendation: SECTION_TEXT,
  nextStep: SECTION_TEXT,
});

export type DimensionTexts = z.infer<typeof DIMENSION_TEXTS>;

/**
 * Forma de la respuesta del borrador: exactamente las dimensiones pedidas, ni
 * una más ni una menos (OWASP LLM05).
 */
export function reportDraftSchema(dimensions: string[]) {
  return z.object({
    dimensions: z.strictObject(
      Object.fromEntries(dimensions.map((code) => [code, DIMENSION_TEXTS])),
    ),
  });
}

export const REPORT_SECTION_SCHEMA = z.object({ text: SECTION_TEXT });

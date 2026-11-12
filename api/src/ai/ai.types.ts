import type { z } from 'zod';

/** Para qué se usa la IA. Cada uso puede tener su proveedor y modelo. */
export const AI_USES = ['flags', 'report'] as const;
export type AiUse = (typeof AI_USES)[number];

export type AiProviderName = 'disabled' | 'stub' | 'claude';

/**
 * Un prompt versionado del repo. Las instrucciones son nuestras; los datos del
 * cliente nunca van aquí, sino en `AiTask.data`.
 */
export interface PromptDefinition {
  /** Estable entre versiones (`flags.contradictions`). */
  id: string;
  /** Sube con cada cambio de texto (`v1`, `v2`): queda en cada llamada. */
  version: string;
  /** Instrucciones de la tarea. */
  instructions: string;
}

/**
 * Lo que pide un módulo: la tarea, los datos y la forma de la respuesta. No
 * sabe qué proveedor hay detrás.
 */
export interface AiTask<T> {
  use: AiUse;
  prompt: PromptDefinition;
  /**
   * Datos del cliente, ya minimizados por quien llama: solo lo que la tarea
   * necesita (respuestas por `code`/`value`), nunca nombre, correo ni teléfono.
   * Se tratan como no confiables y van separados de las instrucciones.
   */
  data: Record<string, unknown>;
  /** Forma esperada de la respuesta. Lo que no la cumpla es un error. */
  schema: z.ZodType<T>;
  /**
   * Textos que nunca deben llegar a la IA aunque aparezcan en `data` (por
   * ejemplo, el nombre del lead escrito en un texto libre).
   */
  redact?: string[];
  maxOutputTokens?: number;
  /** Sobre qué se pidió, para el registro de uso (`Diagnostic` y su id). */
  subject?: { entity: string; entityId: string };
}

/** Por qué no hay resultado. Nunca se confunde con un resultado vacío. */
export type AiFailureReason =
  | 'disabled'
  | 'timeout'
  | 'rate_limited'
  | 'provider_error'
  | 'refused'
  | 'invalid_output';

/**
 * `callLogId` es el registro de la llamada en `ai_call_logs`, para quien deba
 * guardar de dónde salió un texto. Falta si no hubo llamada (IA desactivada)
 * o si no se pudo registrar.
 */
export type AiResult<T> =
  | { ok: true; value: T; simulated: boolean; callLogId?: string }
  | { ok: false; reason: AiFailureReason; callLogId?: string };

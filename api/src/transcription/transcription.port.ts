import type { TranscriptionErrorCode } from '../../generated/prisma/enums';

/**
 * `disabled`: no transcribe; las pendientes esperan a que se active un
 * proveedor (como el motor de cálculo). `simulated`: texto fijo, sin llamadas
 * externas. `openai`: `gpt-4o-mini-transcribe` (decidido por José el
 * 2026-11-24; solo con DPA y retención cero).
 */
export const TRANSCRIPTION_PROVIDERS = [
  'disabled',
  'simulated',
  'openai',
] as const;
export type TranscriptionProviderName =
  (typeof TRANSCRIPTION_PROVIDERS)[number];

/** Idioma fijo (PF-88): mejora la precisión y evita adivinarlo por el audio. */
export const TRANSCRIPTION_LANGUAGE = 'es';

export interface TranscriptionRequest {
  audio: Buffer;
  /** `audio/webm` o `audio/mp4`. */
  contentType: string;
}

export interface TranscriptionResult {
  text: string;
}

/**
 * Un fallo del proveedor ya clasificado. Nunca lleva la llave, el audio ni la
 * respuesta del proveedor (podría traer el texto): solo el código.
 */
export class TranscriptionAdapterError extends Error {
  constructor(
    readonly code: TranscriptionErrorCode,
    /** Cuánto pide esperar el proveedor antes de reintentar (429). */
    readonly retryAfterMs?: number,
  ) {
    super(`Falló la transcripción: ${code}`);
    this.name = 'TranscriptionAdapterError';
  }
}

/**
 * Límite entre la API y un servicio de voz a texto (mismo criterio que el
 * correo, la IA y el CRM). Agregar un proveedor es escribir un adapter nuevo.
 */
export interface TranscriptionAdapter {
  readonly name: Exclude<TranscriptionProviderName, 'disabled'>;
  readonly model: string;
  /** `true` si no llama a nada externo: el audio no sale de SCORE. */
  readonly simulated: boolean;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

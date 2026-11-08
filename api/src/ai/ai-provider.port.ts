import type { AiFailureReason } from './ai.types';

/** Lo que recibe un proveedor: ya armado, minimizado y con su esquema JSON. */
export interface AiProviderRequest {
  model: string;
  /** Instrucciones (canal de sistema). */
  system: string;
  /** Datos del cliente, envueltos y marcados como no confiables. */
  userContent: string;
  /** JSON Schema de la respuesta. */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface AiProviderResponse {
  /** El texto JSON que devolvió el modelo, sin validar todavía. */
  text: string;
  /** El modelo que respondió (puede ser otro si hubo fallback). */
  servedModel: string;
  inputTokens: number;
  outputTokens: number;
}

/** Un fallo del proveedor ya clasificado. Nunca lleva la API key ni contenido. */
export class AiProviderError extends Error {
  constructor(readonly reason: AiFailureReason) {
    super(`Falló la llamada a la IA: ${reason}`);
    this.name = 'AiProviderError';
  }
}

/**
 * Límite entre la API y un proveedor de IA. Agregar un proveedor es escribir
 * un adapter nuevo; los módulos que usan IA no cambian.
 */
export interface AiProviderAdapter {
  readonly name: string;
  /** `true` si responde datos de ejemplo, no de un modelo real. */
  readonly simulated: boolean;
  complete(request: AiProviderRequest): Promise<AiProviderResponse>;
}

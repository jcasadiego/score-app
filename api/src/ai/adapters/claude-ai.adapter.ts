import Anthropic from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import {
  AiProviderAdapter,
  AiProviderError,
  AiProviderRequest,
  AiProviderResponse,
} from '../ai-provider.port';

/**
 * Modelos con fallback del lado del servidor: si el modelo declina por
 * seguridad, la API reintenta con el modelo que corresponde y lo informa en
 * `model` de la respuesta.
 */
const MODELS_WITH_FALLBACK = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5-5',
]);

/**
 * Adapter de Claude (Anthropic Messages API) con salida estructurada
 * (`output_config.format`): el modelo responde JSON con el esquema pedido, y
 * aun así `AiService` lo valida. Un reintento como máximo; el timeout lo pone
 * quien llama. Los errores se clasifican por su clase, nunca se registra su
 * mensaje.
 */
export class ClaudeAiAdapter implements AiProviderAdapter {
  readonly name = 'claude';
  readonly simulated = false;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 1 });
  }

  async complete(request: AiProviderRequest): Promise<AiProviderResponse> {
    const withFallback = MODELS_WITH_FALLBACK.has(request.model);
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model: request.model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.userContent }],
          output_config: {
            // Ajusta el esquema a lo que admite la salida estructurada (las
            // restricciones que no admite pasan a la descripción). La validación
            // completa la hace AiService con el esquema original.
            format: {
              type: 'json_schema',
              schema: transformJSONSchema(request.jsonSchema),
            },
          },
          ...(withFallback && {
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default' as const,
          }),
        },
        { timeout: request.timeoutMs },
      );
    } catch (error) {
      throw new AiProviderError(classify(error));
    }

    if (response.stop_reason === 'refusal') {
      throw new AiProviderError('refused');
    }
    // Cortada por el límite: el JSON quedaría incompleto.
    if (response.stop_reason === 'max_tokens') {
      throw new AiProviderError('invalid_output');
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return {
      text,
      servedModel: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

function classify(error: unknown) {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.RateLimitError) return 'rate_limited';
  return 'provider_error';
}

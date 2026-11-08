import type {
  AiProviderAdapter,
  AiProviderRequest,
  AiProviderResponse,
} from '../ai-provider.port';

type Schema = Record<string, unknown>;

/** Un valor de ejemplo que cumple el esquema, siempre el mismo. */
function sample(schema: Schema): unknown {
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if ('const' in schema) return schema.const;
  const options = (schema.anyOf ?? schema.oneOf) as Schema[] | undefined;
  if (options?.length) return sample(options[0]);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      return Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [key, sample(value)]),
      );
    }
    case 'array':
      return [];
    case 'string':
      return 'Respuesta simulada';
    case 'integer':
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

/**
 * Adapter de desarrollo: sin API key ni costo, responde un ejemplo que cumple
 * el esquema pedido. No mira los datos del cliente. No se admite con
 * `APP_ENV=production` (`validate-env.ts`).
 */
export class SimulatedAiAdapter implements AiProviderAdapter {
  readonly name = 'stub';
  readonly simulated = true;

  complete(request: AiProviderRequest): Promise<AiProviderResponse> {
    return Promise.resolve({
      text: JSON.stringify(sample(request.jsonSchema)),
      servedModel: 'stub',
      inputTokens: 0,
      outputTokens: 0,
    });
  }
}

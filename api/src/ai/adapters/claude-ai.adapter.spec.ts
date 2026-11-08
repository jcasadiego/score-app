import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AiProviderError, type AiProviderRequest } from '../ai-provider.port';
import { ClaudeAiAdapter } from './claude-ai.adapter';

const REQUEST: AiProviderRequest = {
  model: 'claude-opus-5-5',
  system: 'Instrucciones',
  userContent: '<client_data>{}</client_data>',
  jsonSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  },
  maxOutputTokens: 1000,
  timeoutMs: 5000,
};

function adapterReturning(create: ReturnType<typeof vi.fn>) {
  const adapter = new ClaudeAiAdapter('sk-ant-prueba');
  (adapter as unknown as { client: unknown }).client = {
    beta: { messages: { create } },
  };
  return adapter;
}

const message = (overrides: object) => ({
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: '{"ok":true}' }],
  usage: { input_tokens: 120, output_tokens: 30 },
  ...overrides,
});

describe('ClaudeAiAdapter', () => {
  it('manda instrucciones y datos por canales separados, con salida estructurada y fallback', async () => {
    const create = vi.fn().mockResolvedValue(message({}));
    const response = await adapterReturning(create).complete(REQUEST);

    const [params, options] = create.mock.calls[0];
    expect(params.system).toBe('Instrucciones');
    expect(params.messages).toEqual([
      { role: 'user', content: '<client_data>{}</client_data>' },
    ]);
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.max_tokens).toBe(1000);
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(options).toEqual({ timeout: 5000 });
    expect(response).toEqual({
      text: '{"ok":true}',
      servedModel: 'claude-opus-5-5',
      inputTokens: 120,
      outputTokens: 30,
    });
  });

  it('un modelo sin fallback no lo pide', async () => {
    const create = vi.fn().mockResolvedValue(message({}));
    await adapterReturning(create).complete({
      ...REQUEST,
      model: 'claude-haiku-5-5',
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty('fallbacks');
  });

  it.each([
    [{ stop_reason: 'refusal' }, 'refused'],
    [{ stop_reason: 'max_tokens' }, 'invalid_output'],
  ])('%o es un error controlado: %s', async (overrides, reason) => {
    const create = vi.fn().mockResolvedValue(message(overrides));
    await expect(adapterReturning(create).complete(REQUEST)).rejects.toEqual(
      new AiProviderError(reason as never),
    );
  });

  it.each([
    [new Anthropic.APIConnectionTimeoutError(), 'timeout'],
    [Object.create(Anthropic.RateLimitError.prototype), 'rate_limited'],
    [new Error('sk-ant-prueba en el mensaje'), 'provider_error'],
  ])('clasifica el error sin conservar su mensaje', async (error, reason) => {
    const create = vi.fn().mockRejectedValue(error);
    const failure = await adapterReturning(create)
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AiProviderError);
    expect((failure as AiProviderError).reason).toBe(reason);
    expect((failure as Error).message).not.toContain('sk-ant');
  });
});

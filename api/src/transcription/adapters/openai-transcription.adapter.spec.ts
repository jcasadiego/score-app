import type { Mock } from 'vitest';
import { TranscriptionAdapterError } from '../transcription.port';
import { OpenAiTranscriptionAdapter } from './openai-transcription.adapter';

const REQUEST = { audio: Buffer.from('audio'), contentType: 'audio/webm' };

describe('OpenAiTranscriptionAdapter', () => {
  let fetchMock: Mock;

  function build() {
    return new OpenAiTranscriptionAdapter({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini-transcribe',
      timeoutMs: 5_000,
      fetch: fetchMock as unknown as typeof fetch,
    });
  }

  async function failure(): Promise<TranscriptionAdapterError> {
    try {
      await build().transcribe(REQUEST);
    } catch (error) {
      return error as TranscriptionAdapterError;
    }
    throw new Error('no falló');
  }

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('envía el audio, el modelo y el español fijo, y devuelve el texto', async () => {
    fetchMock.mockResolvedValue(Response.json({ text: 'Hola, soy artista.' }));
    expect(await build().transcribe(REQUEST)).toEqual({
      text: 'Hola, soy artista.',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(form.get('language')).toBe('es');
    expect((form.get('file') as File).name).toBe('respuesta.webm');
  });

  it.each([
    [401, 'AUTH_FAILED'],
    [403, 'AUTH_FAILED'],
    [408, 'TIMEOUT'],
    [400, 'INVALID_AUDIO'],
    [413, 'INVALID_AUDIO'],
    [500, 'PROVIDER_ERROR'],
    [503, 'PROVIDER_ERROR'],
  ])('clasifica el estado %i como %s', async (status, code) => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"message":"texto del proveedor"}}', { status }),
    );
    const error = await failure();
    expect(error.code).toBe(code);
    // Nunca lleva la respuesta del proveedor.
    expect(error.message).not.toContain('texto del proveedor');
  });

  it('429 lleva la espera que pide el proveedor', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 429, headers: { 'retry-after': '20' } }),
    );
    const error = await failure();
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryAfterMs).toBe(20_000);
  });

  it('el tiempo de espera agotado es TIMEOUT; un fallo de red, PROVIDER_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'TimeoutError' }),
    );
    expect((await failure()).code).toBe('TIMEOUT');
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await failure()).code).toBe('PROVIDER_ERROR');
  });

  it('una respuesta sin texto es PROVIDER_ERROR', async () => {
    fetchMock.mockResolvedValue(Response.json({ foo: 1 }));
    expect((await failure()).code).toBe('PROVIDER_ERROR');
  });
});

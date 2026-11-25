import { TranscriptionErrorCode } from '../../../generated/prisma/enums';
import {
  TRANSCRIPTION_LANGUAGE,
  TranscriptionAdapter,
  TranscriptionAdapterError,
  TranscriptionRequest,
  TranscriptionResult,
} from '../transcription.port';

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

const FILE_NAMES: Record<string, string> = {
  'audio/webm': 'respuesta.webm',
  'audio/mp4': 'respuesta.mp4',
};

export interface OpenAiTranscriptionOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Para los tests. */
  fetch?: typeof fetch;
}

/**
 * Voz a texto con OpenAI (`POST /v1/audio/transcriptions`), sin SDK: una sola
 * llamada HTTP con el audio y el idioma fijo. Sin reintentos propios: los
 * hace la bandeja. Los errores se clasifican por estado HTTP; nunca se guarda
 * ni se registra el cuerpo de la respuesta.
 */
export class OpenAiTranscriptionAdapter implements TranscriptionAdapter {
  readonly name = 'openai' as const;
  readonly simulated = false;
  readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: OpenAiTranscriptionOptions) {
    this.model = options.model;
    this.fetchFn = options.fetch ?? fetch;
  }

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(request.audio)], { type: request.contentType }),
      FILE_NAMES[request.contentType] ?? 'respuesta',
    );
    form.append('model', this.model);
    form.append('language', TRANSCRIPTION_LANGUAGE);
    form.append('response_format', 'json');

    let response: Response;
    try {
      response = await this.fetchFn(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      const timeout =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new TranscriptionAdapterError(
        timeout
          ? TranscriptionErrorCode.TIMEOUT
          : TranscriptionErrorCode.PROVIDER_ERROR,
      );
    }

    if (!response.ok) {
      // El cuerpo no se lee: podría traer parte del audio o del texto.
      await response.body?.cancel().catch(() => undefined);
      throw errorFor(response);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TranscriptionAdapterError(
        TranscriptionErrorCode.PROVIDER_ERROR,
      );
    }
    const text = (body as { text?: unknown } | null)?.text;
    if (typeof text !== 'string') {
      throw new TranscriptionAdapterError(
        TranscriptionErrorCode.PROVIDER_ERROR,
      );
    }
    return { text };
  }
}

function errorFor(response: Response): TranscriptionAdapterError {
  const { status } = response;
  if (status === 401 || status === 403) {
    return new TranscriptionAdapterError(TranscriptionErrorCode.AUTH_FAILED);
  }
  if (status === 429) {
    return new TranscriptionAdapterError(
      TranscriptionErrorCode.RATE_LIMITED,
      retryAfterMs(response.headers.get('retry-after')),
    );
  }
  if (status === 408) {
    return new TranscriptionAdapterError(TranscriptionErrorCode.TIMEOUT);
  }
  // El audio no sirve (formato, tamaño o contenido): reintentar no lo arregla.
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return new TranscriptionAdapterError(TranscriptionErrorCode.INVALID_AUDIO);
  }
  return new TranscriptionAdapterError(TranscriptionErrorCode.PROVIDER_ERROR);
}

/** `Retry-After` en segundos o como fecha HTTP. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(seconds, 0) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(date - Date.now(), 0);
}

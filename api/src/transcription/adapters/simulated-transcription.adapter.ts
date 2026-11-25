import type { TranscriptionErrorCode } from '../../../generated/prisma/enums';
import {
  TranscriptionAdapter,
  TranscriptionAdapterError,
  TranscriptionResult,
} from '../transcription.port';

/** El texto que devuelve siempre el adapter simulado. */
export const SIMULATED_TRANSCRIPT =
  'Transcripción simulada: en desarrollo y QA no se envía el audio a ningún proveedor.';

/**
 * Voz a texto de mentira (PF-88): no llama a nada externo y devuelve un texto
 * fijo. Si se configura, falla siempre con el código dado, para probar los
 * reintentos y el panel.
 */
export class SimulatedTranscriptionAdapter implements TranscriptionAdapter {
  readonly name = 'simulated' as const;
  readonly model = 'simulated';
  readonly simulated = true;

  constructor(private readonly forcedFailure?: TranscriptionErrorCode) {}

  transcribe(): Promise<TranscriptionResult> {
    if (this.forcedFailure) {
      return Promise.reject(new TranscriptionAdapterError(this.forcedFailure));
    }
    return Promise.resolve({ text: SIMULATED_TRANSCRIPT });
  }
}

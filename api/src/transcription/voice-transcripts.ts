import { Prisma } from '../../generated/prisma/client';
import { TranscriptionStatus } from '../../generated/prisma/enums';

/** Cómo se marca en los datos de la IA: no es lo que escribió el cliente. */
export const AUTOMATIC_TRANSCRIPTION = 'automatic_transcription';

export interface VoiceTranscript {
  source: typeof AUTOMATIC_TRANSCRIPTION;
  text: string;
}

/**
 * Las transcripciones completadas de un diagnóstico, por `code` de pregunta,
 * para las alertas y el informe (PF-88). No reemplazan la respuesta escrita:
 * van aparte, marcadas como transcripción automática. Son texto no confiable
 * (OWASP LLM01): viajan como dato dentro de `<client_data>`, nunca como
 * instrucción, y pasan por la misma minimización que las respuestas.
 */
export async function loadVoiceTranscripts(
  db: Pick<Prisma.TransactionClient, 'answerTranscription'>,
  diagnosticId: string,
): Promise<Record<string, VoiceTranscript>> {
  const rows = await db.answerTranscription.findMany({
    where: {
      status: TranscriptionStatus.COMPLETED,
      recording: { answer: { diagnosticId } },
    },
    select: {
      text: true,
      recording: {
        select: {
          answer: { select: { question: { select: { code: true } } } },
        },
      },
    },
  });
  const byCode: Record<string, VoiceTranscript> = {};
  for (const row of rows) {
    if (!row.text) continue;
    byCode[row.recording.answer.question.code] = {
      source: AUTOMATIC_TRANSCRIPTION,
      text: row.text,
    };
  }
  return byCode;
}

-- Conservación de la voz (PF-90). Solo agrega: un valor de enum, una columna
-- nula y un índice parcial. Varios pasos: en una transacción (PF-46). El valor
-- nuevo del enum no se usa dentro de esta misma transacción.
BEGIN;

-- AlterEnum
ALTER TYPE "transcription_error_code" ADD VALUE 'AUDIO_DELETED';

-- AlterTable
ALTER TABLE "answer_recordings" ADD COLUMN     "audio_deleted_at" TIMESTAMPTZ(3);

-- El barrido busca solo las grabaciones que todavía tienen audio.
CREATE INDEX "answer_recordings_audio_pending_idx" ON "answer_recordings"("created_at")
  WHERE "audio_deleted_at" IS NULL;

COMMIT;

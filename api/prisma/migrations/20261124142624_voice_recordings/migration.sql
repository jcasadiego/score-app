-- Voz en las respuestas (PF-86). Solo agrega: columnas con valor por defecto o
-- nulas, una tabla y un enum. Varios pasos: en una transacción (PF-46).
BEGIN;

-- CreateEnum
CREATE TYPE "audio_format" AS ENUM ('WEBM', 'MP4');

-- AlterTable
ALTER TABLE "diagnostics" ADD COLUMN     "voice_consent_at" TIMESTAMPTZ(3),
ADD COLUMN     "voice_consent_version" VARCHAR(32);

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "allows_voice" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "answer_recordings" (
    "id" TEXT NOT NULL,
    "answer_id" TEXT NOT NULL,
    "object_key" VARCHAR(64) NOT NULL,
    "format" "audio_format" NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "answer_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "answer_recordings_answer_id_key" ON "answer_recordings"("answer_id");

-- CreateIndex
CREATE UNIQUE INDEX "answer_recordings_object_key_key" ON "answer_recordings"("object_key");

-- AddForeignKey
ALTER TABLE "answer_recordings" ADD CONSTRAINT "answer_recordings_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "answers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Solo las preguntas de texto libre aceptan voz.
ALTER TABLE "questions" ADD CONSTRAINT "questions_allows_voice_free_text_check"
  CHECK (NOT "allows_voice" OR "type" = 'FREE_TEXT');

-- El consentimiento se guarda completo: fecha y versión del texto, o nada.
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_voice_consent_check"
  CHECK (("voice_consent_at" IS NULL) = ("voice_consent_version" IS NULL));

-- Límites de PF-86 (decididos por José el 2026-11-24): 5 MB y 3 minutos.
ALTER TABLE "answer_recordings" ADD CONSTRAINT "answer_recordings_size_check"
  CHECK ("size_bytes" BETWEEN 1 AND 5242880);
ALTER TABLE "answer_recordings" ADD CONSTRAINT "answer_recordings_duration_check"
  CHECK ("duration_ms" BETWEEN 1 AND 180000);
ALTER TABLE "answer_recordings" ADD CONSTRAINT "answer_recordings_object_key_check"
  CHECK ("object_key" ~ '^voice/[0-9a-f-]{36}$');

COMMIT;

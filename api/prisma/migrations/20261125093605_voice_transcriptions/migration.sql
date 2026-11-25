-- Transcripción de las grabaciones de voz (PF-88). Solo agrega: dos enums y
-- una tabla. Varios pasos: en una transacción (PF-46).
BEGIN;

-- CreateEnum
CREATE TYPE "transcription_status" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "transcription_error_code" AS ENUM ('TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR', 'STORAGE_UNAVAILABLE', 'INVALID_AUDIO', 'AUTH_FAILED');

-- CreateTable
CREATE TABLE "answer_transcriptions" (
    "id" TEXT NOT NULL,
    "recording_id" TEXT NOT NULL,
    "status" "transcription_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" VARCHAR(32),
    "model" VARCHAR(64),
    "text" TEXT,
    "last_error_code" "transcription_error_code",
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "answer_transcriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "answer_transcriptions_recording_id_key" ON "answer_transcriptions"("recording_id");

-- CreateIndex
CREATE INDEX "answer_transcriptions_status_next_attempt_at_idx" ON "answer_transcriptions"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "answer_transcriptions" ADD CONSTRAINT "answer_transcriptions_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "answer_recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- El texto existe solo con la transcripción completada. Tope holgado: 3
-- minutos de voz son unos 3.000 caracteres.
ALTER TABLE "answer_transcriptions" ADD CONSTRAINT "answer_transcriptions_text_check"
  CHECK (("status" = 'COMPLETED') = ("text" IS NOT NULL) AND char_length("text") <= 20000);
ALTER TABLE "answer_transcriptions" ADD CONSTRAINT "answer_transcriptions_completed_at_check"
  CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL));
ALTER TABLE "answer_transcriptions" ADD CONSTRAINT "answer_transcriptions_attempts_check"
  CHECK ("attempts" >= 0);

-- Las grabaciones que ya existían quedan pendientes de transcribir.
INSERT INTO "answer_transcriptions" ("id", "recording_id", "updated_at")
SELECT gen_random_uuid()::text, "id", CURRENT_TIMESTAMP FROM "answer_recordings";

COMMIT;

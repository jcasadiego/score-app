-- Flags del revisor (PF-34). Lo que Prisma no expresa va al final: CHECKs.
BEGIN;

-- CreateEnum
CREATE TYPE "flag_source" AS ENUM ('ENGINE', 'AI');

-- CreateEnum
CREATE TYPE "flag_severity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "flag_status" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "flag_analysis_status" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "flag_analyses" (
    "id" TEXT NOT NULL,
    "calculation_id" TEXT NOT NULL,
    "status" "flag_analysis_status" NOT NULL DEFAULT 'PENDING',
    "provider" VARCHAR(32),
    "model" VARCHAR(64),
    "prompt_id" VARCHAR(64),
    "prompt_version" VARCHAR(16),
    "is_simulated" BOOLEAN,
    "failure_reason" VARCHAR(32),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "flag_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flags" (
    "id" TEXT NOT NULL,
    "calculation_id" TEXT NOT NULL,
    "analysis_id" TEXT,
    "source" "flag_source" NOT NULL,
    "severity" "flag_severity" NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "status" "flag_status" NOT NULL DEFAULT 'OPEN',
    "review_note" VARCHAR(1000),
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flag_questions" (
    "flag_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,

    CONSTRAINT "flag_questions_pkey" PRIMARY KEY ("flag_id","question_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flag_analyses_calculation_id_key" ON "flag_analyses"("calculation_id");

-- CreateIndex
CREATE INDEX "flag_analyses_status_idx" ON "flag_analyses"("status");

-- CreateIndex
CREATE INDEX "flags_calculation_id_status_idx" ON "flags"("calculation_id", "status");

-- CreateIndex
CREATE INDEX "flags_analysis_id_idx" ON "flags"("analysis_id");

-- CreateIndex
CREATE INDEX "flags_reviewed_by_id_idx" ON "flags"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "flag_questions_question_id_idx" ON "flag_questions"("question_id");

-- AddForeignKey
ALTER TABLE "flag_analyses" ADD CONSTRAINT "flag_analyses_calculation_id_fkey" FOREIGN KEY ("calculation_id") REFERENCES "calculations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flags" ADD CONSTRAINT "flags_calculation_id_fkey" FOREIGN KEY ("calculation_id") REFERENCES "calculations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flags" ADD CONSTRAINT "flags_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "flag_analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flags" ADD CONSTRAINT "flags_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flag_questions" ADD CONSTRAINT "flag_questions_flag_id_fkey" FOREIGN KEY ("flag_id") REFERENCES "flags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flag_questions" ADD CONSTRAINT "flag_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Revisado o descartado: quién y cuándo. Descartar exige nota.
ALTER TABLE "flags" ADD CONSTRAINT "flags_review_fields" CHECK (
  ("status" = 'OPEN') = ("reviewed_by_id" IS NULL AND "reviewed_at" IS NULL)
);
ALTER TABLE "flags" ADD CONSTRAINT "flags_dismissed_has_note" CHECK (
  "status" <> 'DISMISSED' OR length(btrim("review_note")) > 0
);
-- Un flag de IA viene de un análisis; uno del motor, no.
ALTER TABLE "flags" ADD CONSTRAINT "flags_source_analysis" CHECK (
  ("source" = 'AI') = ("analysis_id" IS NOT NULL)
);
-- Cada estado del análisis con sus campos.
ALTER TABLE "flag_analyses" ADD CONSTRAINT "flag_analyses_failed_has_reason" CHECK (
  ("status" = 'FAILED') = ("failure_reason" IS NOT NULL)
);
ALTER TABLE "flag_analyses" ADD CONSTRAINT "flag_analyses_finished_at" CHECK (
  ("status" IN ('SUCCEEDED', 'FAILED')) = ("finished_at" IS NOT NULL)
);

COMMIT;

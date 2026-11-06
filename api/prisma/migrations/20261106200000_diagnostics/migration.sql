-- Diagnósticos, enlaces del cliente y respuestas (PF-16). Lo que Prisma no
-- expresa va al final, a mano: CHECKs y el trigger que exige una versión publicada.
BEGIN;

-- CreateEnum
CREATE TYPE "diagnostic_status" AS ENUM ('ACTIVE', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "access_link_origin" AS ENUM ('PANEL', 'RECOVERY');

-- CreateEnum
CREATE TYPE "external_platform" AS ENUM ('SPOTIFY', 'YOUTUBE', 'INSTAGRAM', 'TIKTOK', 'WEBSITE');

-- CreateTable
CREATE TABLE "diagnostics" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "questionnaire_version_id" TEXT NOT NULL,
    "status" "diagnostic_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT,
    "creation_reason" VARCHAR(500),
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "diagnostics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_links" (
    "id" TEXT NOT NULL,
    "diagnostic_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "origin" "access_link_origin" NOT NULL,
    "created_by_id" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "redeemed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" TEXT NOT NULL,
    "diagnostic_id" TEXT NOT NULL,
    "questionnaire_version_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "text_value" VARCHAR(5000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_selections" (
    "answer_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,

    CONSTRAINT "answer_selections_pkey" PRIMARY KEY ("answer_id","option_id")
);

-- CreateTable
CREATE TABLE "external_links" (
    "id" TEXT NOT NULL,
    "diagnostic_id" TEXT NOT NULL,
    "platform" "external_platform" NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "external_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "diagnostics_lead_id_key" ON "diagnostics"("lead_id");

-- CreateIndex
CREATE INDEX "diagnostics_questionnaire_version_id_idx" ON "diagnostics"("questionnaire_version_id");

-- CreateIndex
CREATE INDEX "diagnostics_created_by_id_idx" ON "diagnostics"("created_by_id");

-- CreateIndex
CREATE INDEX "diagnostics_status_last_activity_at_idx" ON "diagnostics"("status", "last_activity_at");

-- CreateIndex
CREATE UNIQUE INDEX "diagnostics_id_questionnaire_version_id_key" ON "diagnostics"("id", "questionnaire_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_links_token_hash_key" ON "access_links"("token_hash");

-- CreateIndex
CREATE INDEX "access_links_diagnostic_id_idx" ON "access_links"("diagnostic_id");

-- CreateIndex
CREATE INDEX "access_links_created_by_id_idx" ON "access_links"("created_by_id");

-- CreateIndex
CREATE INDEX "access_links_origin_created_at_idx" ON "access_links"("origin", "created_at");

-- CreateIndex
CREATE INDEX "answers_diagnostic_id_questionnaire_version_id_idx" ON "answers"("diagnostic_id", "questionnaire_version_id");

-- CreateIndex
CREATE INDEX "answers_question_id_questionnaire_version_id_idx" ON "answers"("question_id", "questionnaire_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "answers_diagnostic_id_question_id_key" ON "answers"("diagnostic_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "answers_id_question_id_key" ON "answers"("id", "question_id");

-- CreateIndex
CREATE INDEX "answer_selections_answer_id_question_id_idx" ON "answer_selections"("answer_id", "question_id");

-- CreateIndex
CREATE INDEX "answer_selections_option_id_question_id_idx" ON "answer_selections"("option_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_links_diagnostic_id_platform_key" ON "external_links"("diagnostic_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "questions_id_questionnaire_version_id_key" ON "questions"("id", "questionnaire_version_id");

-- AddForeignKey
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_questionnaire_version_id_fkey" FOREIGN KEY ("questionnaire_version_id") REFERENCES "questionnaire_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_diagnostic_id_fkey" FOREIGN KEY ("diagnostic_id") REFERENCES "diagnostics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_diagnostic_id_questionnaire_version_id_fkey" FOREIGN KEY ("diagnostic_id", "questionnaire_version_id") REFERENCES "diagnostics"("id", "questionnaire_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_questionnaire_version_id_fkey" FOREIGN KEY ("question_id", "questionnaire_version_id") REFERENCES "questions"("id", "questionnaire_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_selections" ADD CONSTRAINT "answer_selections_answer_id_question_id_fkey" FOREIGN KEY ("answer_id", "question_id") REFERENCES "answers"("id", "question_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_selections" ADD CONSTRAINT "answer_selections_option_id_question_id_fkey" FOREIGN KEY ("option_id", "question_id") REFERENCES "answer_options"("id", "question_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_links" ADD CONSTRAINT "external_links_diagnostic_id_fkey" FOREIGN KEY ("diagnostic_id") REFERENCES "diagnostics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Generado desde el panel = sin pago: exige el motivo (CLAUDE.md 5.3).
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_panel_requires_reason"
  CHECK ("created_by_id" IS NULL OR length(btrim("creation_reason")) > 0);

ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_completed_at_matches_status"
  CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL));

-- Un enlace del panel siempre dice quién lo emitió; uno de recuperación, nadie.
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_origin_matches_creator"
  CHECK (("origin" = 'PANEL') = ("created_by_id" IS NOT NULL));

ALTER TABLE "access_links" ADD CONSTRAINT "access_links_expires_after_creation"
  CHECK ("expires_at" > "created_at");

ALTER TABLE "external_links" ADD CONSTRAINT "external_links_https_only"
  CHECK ("url" LIKE 'https://%');

-- Un diagnóstico solo puede apuntar a una versión publicada (inmutable). Reutiliza
-- la función de la migración del cuestionario.
CREATE FUNCTION "diagnostics_require_published_version"() RETURNS trigger AS $$
BEGIN
  IF NOT "questionnaire_version_is_published"(NEW."questionnaire_version_id") THEN
    RAISE EXCEPTION 'a diagnostic must point to a published questionnaire version'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "diagnostics_published_version_only"
  BEFORE INSERT OR UPDATE OF "questionnaire_version_id" ON "diagnostics"
  FOR EACH ROW EXECUTE FUNCTION "diagnostics_require_published_version"();

COMMIT;

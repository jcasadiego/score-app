-- Revisión y aprobación (PF-39). Lo que Prisma no expresa va al final:
-- CHECKs, índice único parcial, triggers de solo inserción y la carga de las
-- revisiones de los diagnósticos que ya tienen cálculo.
BEGIN;

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED');

-- CreateEnum
CREATE TYPE "approval_void_cause" AS ENUM ('REOPENED', 'RECALCULATED');

-- AlterTable
ALTER TABLE "calculations" ADD COLUMN     "correction_sequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "diagnostic_id" TEXT NOT NULL,
    "status" "review_status" NOT NULL DEFAULT 'PENDING',
    "assignee_id" TEXT,
    "assigned_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_corrections" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "answer_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "text_value" VARCHAR(5000),
    "reason" VARCHAR(500) NOT NULL,
    "corrected_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_correction_selections" (
    "correction_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,

    CONSTRAINT "answer_correction_selections_pkey" PRIMARY KEY ("correction_id","option_id")
);

-- CreateTable
CREATE TABLE "review_approvals" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "calculation_id" TEXT NOT NULL,
    "approved_by_id" TEXT NOT NULL,
    "ai_exception_reason" VARCHAR(500),
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "void_cause" "approval_void_cause",
    "voided_by_id" TEXT,
    "void_reason" VARCHAR(500),

    CONSTRAINT "review_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_notes" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "dimension" VARCHAR(64),
    "body" VARCHAR(5000) NOT NULL,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_diagnostic_id_key" ON "reviews"("diagnostic_id");

-- CreateIndex
CREATE INDEX "reviews_assignee_id_idx" ON "reviews"("assignee_id");

-- CreateIndex
CREATE INDEX "reviews_status_created_at_idx" ON "reviews"("status", "created_at");

-- CreateIndex
CREATE INDEX "answer_corrections_answer_id_question_id_idx" ON "answer_corrections"("answer_id", "question_id");

-- CreateIndex
CREATE INDEX "answer_corrections_corrected_by_id_idx" ON "answer_corrections"("corrected_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "answer_corrections_review_id_sequence_key" ON "answer_corrections"("review_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "answer_corrections_id_question_id_key" ON "answer_corrections"("id", "question_id");

-- CreateIndex
CREATE INDEX "answer_correction_selections_correction_id_question_id_idx" ON "answer_correction_selections"("correction_id", "question_id");

-- CreateIndex
CREATE INDEX "answer_correction_selections_option_id_question_id_idx" ON "answer_correction_selections"("option_id", "question_id");

-- CreateIndex
CREATE INDEX "review_approvals_review_id_idx" ON "review_approvals"("review_id");

-- CreateIndex
CREATE INDEX "review_approvals_calculation_id_idx" ON "review_approvals"("calculation_id");

-- CreateIndex
CREATE INDEX "review_approvals_approved_by_id_idx" ON "review_approvals"("approved_by_id");

-- CreateIndex
CREATE INDEX "review_approvals_voided_by_id_idx" ON "review_approvals"("voided_by_id");

-- CreateIndex
CREATE INDEX "review_notes_review_id_created_at_idx" ON "review_notes"("review_id", "created_at");

-- CreateIndex
CREATE INDEX "review_notes_author_id_idx" ON "review_notes"("author_id");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_diagnostic_id_fkey" FOREIGN KEY ("diagnostic_id") REFERENCES "diagnostics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_corrections" ADD CONSTRAINT "answer_corrections_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_corrections" ADD CONSTRAINT "answer_corrections_answer_id_question_id_fkey" FOREIGN KEY ("answer_id", "question_id") REFERENCES "answers"("id", "question_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_corrections" ADD CONSTRAINT "answer_corrections_corrected_by_id_fkey" FOREIGN KEY ("corrected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_correction_selections" ADD CONSTRAINT "answer_correction_selections_correction_id_question_id_fkey" FOREIGN KEY ("correction_id", "question_id") REFERENCES "answer_corrections"("id", "question_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_correction_selections" ADD CONSTRAINT "answer_correction_selections_option_id_question_id_fkey" FOREIGN KEY ("option_id", "question_id") REFERENCES "answer_options"("id", "question_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_approvals" ADD CONSTRAINT "review_approvals_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_approvals" ADD CONSTRAINT "review_approvals_calculation_id_fkey" FOREIGN KEY ("calculation_id") REFERENCES "calculations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_approvals" ADD CONSTRAINT "review_approvals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_approvals" ADD CONSTRAINT "review_approvals_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Estado y toma del caso, coherentes.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_assignment_fields" CHECK (
  ("assignee_id" IS NULL) = ("assigned_at" IS NULL)
);
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_status_assignment" CHECK (
  "status" = 'APPROVED'
  OR ("status" = 'IN_REVIEW') = ("assignee_id" IS NOT NULL)
);
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_version_non_negative" CHECK ("version" >= 0);

ALTER TABLE "calculations" ADD CONSTRAINT "calculations_correction_sequence_non_negative" CHECK (
  "correction_sequence" >= 0
);

-- Una corrección siempre trae motivo.
ALTER TABLE "answer_corrections" ADD CONSTRAINT "answer_corrections_sequence_positive" CHECK ("sequence" >= 1);
ALTER TABLE "answer_corrections" ADD CONSTRAINT "answer_corrections_reason_not_blank" CHECK (
  length(btrim("reason")) > 0
);

-- Anulación completa o ninguna; reabrir exige quién y por qué.
ALTER TABLE "review_approvals" ADD CONSTRAINT "review_approvals_void_fields" CHECK (
  ("voided_at" IS NULL) = ("void_cause" IS NULL)
);
ALTER TABLE "review_approvals" ADD CONSTRAINT "review_approvals_reopened_has_reason" CHECK (
  "void_cause" IS DISTINCT FROM 'REOPENED'
  OR ("voided_by_id" IS NOT NULL AND length(btrim("void_reason")) > 0)
);
ALTER TABLE "review_approvals" ADD CONSTRAINT "review_approvals_exception_not_blank" CHECK (
  "ai_exception_reason" IS NULL OR length(btrim("ai_exception_reason")) > 0
);

-- A lo sumo una aprobación vigente por revisión.
CREATE UNIQUE INDEX "review_approvals_one_active_per_review"
  ON "review_approvals"("review_id") WHERE "voided_at" IS NULL;

ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_body_not_blank" CHECK (
  length(btrim("body")) > 0
);

-- Las correcciones son de solo inserción: la historia no se reescribe.
CREATE FUNCTION "answer_corrections_reject_changes"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% es de solo inserción', TG_TABLE_NAME
    USING ERRCODE = 'object_not_in_prerequisite_state';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "answer_corrections_no_update_delete"
  BEFORE UPDATE OR DELETE ON "answer_corrections"
  FOR EACH ROW EXECUTE FUNCTION "answer_corrections_reject_changes"();
CREATE TRIGGER "answer_corrections_no_truncate"
  BEFORE TRUNCATE ON "answer_corrections"
  FOR EACH STATEMENT EXECUTE FUNCTION "answer_corrections_reject_changes"();
CREATE TRIGGER "answer_correction_selections_no_update_delete"
  BEFORE UPDATE OR DELETE ON "answer_correction_selections"
  FOR EACH ROW EXECUTE FUNCTION "answer_corrections_reject_changes"();
CREATE TRIGGER "answer_correction_selections_no_truncate"
  BEFORE TRUNCATE ON "answer_correction_selections"
  FOR EACH STATEMENT EXECUTE FUNCTION "answer_corrections_reject_changes"();

-- Una aprobación no se borra, y lo único que cambia es su anulación, una vez.
CREATE FUNCTION "review_approvals_guard_changes"() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'UPDATE'
    OR OLD."voided_at" IS NOT NULL
    OR NEW."review_id" IS DISTINCT FROM OLD."review_id"
    OR NEW."calculation_id" IS DISTINCT FROM OLD."calculation_id"
    OR NEW."approved_by_id" IS DISTINCT FROM OLD."approved_by_id"
    OR NEW."ai_exception_reason" IS DISTINCT FROM OLD."ai_exception_reason"
    OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
  THEN
    RAISE EXCEPTION 'review_approvals solo admite anular una aprobación vigente'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "review_approvals_guard"
  BEFORE UPDATE OR DELETE ON "review_approvals"
  FOR EACH ROW EXECUTE FUNCTION "review_approvals_guard_changes"();
CREATE TRIGGER "review_approvals_no_truncate"
  BEFORE TRUNCATE ON "review_approvals"
  FOR EACH STATEMENT EXECUTE FUNCTION "review_approvals_guard_changes"();

-- Los diagnósticos que ya tienen cálculo reciben su revisión, sin tomar.
INSERT INTO "reviews" ("id", "diagnostic_id", "updated_at")
SELECT gen_random_uuid()::text, d."id", CURRENT_TIMESTAMP
FROM "diagnostics" d
WHERE EXISTS (SELECT 1 FROM "calculations" c WHERE c."diagnostic_id" = d."id");

COMMIT;

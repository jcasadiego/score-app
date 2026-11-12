-- Informe del diagnóstico (PF-42): borrador, historial de solo inserción y
-- aprobación atada a versiones exactas. Varios pasos: en una transacción.
BEGIN;

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "report_part" AS ENUM ('FINDING', 'IMPLICATION', 'RECOMMENDATION', 'NEXT_STEP');

-- CreateEnum
CREATE TYPE "report_revision_source" AS ENUM ('AI', 'HUMAN');

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "status" "report_status" NOT NULL DEFAULT 'DRAFT',
    "review_approval_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_sections" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "dimension" VARCHAR(64) NOT NULL,
    "position" INTEGER NOT NULL,
    "part" "report_part" NOT NULL,

    CONSTRAINT "report_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_section_revisions" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "source" "report_revision_source" NOT NULL,
    "ai_call_log_id" TEXT,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_section_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_approvals" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "report_version" INTEGER NOT NULL,
    "approved_by_id" TEXT NOT NULL,
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "void_cause" "approval_void_cause",
    "voided_by_id" TEXT,

    CONSTRAINT "report_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_approval_revisions" (
    "approval_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,

    CONSTRAINT "report_approval_revisions_pkey" PRIMARY KEY ("approval_id","revision_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reports_review_id_key" ON "reports"("review_id");

-- CreateIndex
CREATE INDEX "reports_review_approval_id_review_id_idx" ON "reports"("review_approval_id", "review_id");

-- CreateIndex
CREATE INDEX "reports_status_updated_at_idx" ON "reports"("status", "updated_at");

-- CreateIndex
CREATE INDEX "report_sections_report_id_position_idx" ON "report_sections"("report_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "report_sections_report_id_dimension_part_key" ON "report_sections"("report_id", "dimension", "part");

-- CreateIndex
CREATE INDEX "report_section_revisions_ai_call_log_id_idx" ON "report_section_revisions"("ai_call_log_id");

-- CreateIndex
CREATE INDEX "report_section_revisions_author_id_idx" ON "report_section_revisions"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_section_revisions_section_id_sequence_key" ON "report_section_revisions"("section_id", "sequence");

-- CreateIndex
CREATE INDEX "report_approvals_report_id_idx" ON "report_approvals"("report_id");

-- CreateIndex
CREATE INDEX "report_approvals_approved_by_id_idx" ON "report_approvals"("approved_by_id");

-- CreateIndex
CREATE INDEX "report_approvals_voided_by_id_idx" ON "report_approvals"("voided_by_id");

-- CreateIndex
CREATE INDEX "report_approval_revisions_revision_id_idx" ON "report_approval_revisions"("revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_approvals_id_review_id_key" ON "review_approvals"("id", "review_id");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_review_approval_id_review_id_fkey" FOREIGN KEY ("review_approval_id", "review_id") REFERENCES "review_approvals"("id", "review_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_sections" ADD CONSTRAINT "report_sections_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_section_revisions" ADD CONSTRAINT "report_section_revisions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "report_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_section_revisions" ADD CONSTRAINT "report_section_revisions_ai_call_log_id_fkey" FOREIGN KEY ("ai_call_log_id") REFERENCES "ai_call_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_section_revisions" ADD CONSTRAINT "report_section_revisions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_approval_revisions" ADD CONSTRAINT "report_approval_revisions_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "report_approvals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_approval_revisions" ADD CONSTRAINT "report_approval_revisions_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "report_section_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que la base garantiza aunque el código falle.
ALTER TABLE "reports" ADD CONSTRAINT "reports_version_non_negative" CHECK ("version" >= 0);
ALTER TABLE "report_sections" ADD CONSTRAINT "report_sections_position_non_negative" CHECK ("position" >= 0);
ALTER TABLE "report_sections" ADD CONSTRAINT "report_sections_dimension_not_blank" CHECK (
  length(btrim("dimension")) > 0
);
ALTER TABLE "report_section_revisions" ADD CONSTRAINT "report_section_revisions_sequence_positive" CHECK ("sequence" >= 1);
ALTER TABLE "report_section_revisions" ADD CONSTRAINT "report_section_revisions_body_not_blank" CHECK (
  length(btrim("body")) > 0
);
-- La IA siempre con su llamada registrada; una persona, nunca.
ALTER TABLE "report_section_revisions" ADD CONSTRAINT "report_section_revisions_ai_call" CHECK (
  ("source" = 'AI') = ("ai_call_log_id" IS NOT NULL)
);
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_version_non_negative" CHECK (
  "report_version" >= 0
);
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_void_fields" CHECK (
  ("voided_at" IS NULL) = ("void_cause" IS NULL)
);

-- A lo sumo una aprobación vigente por informe.
CREATE UNIQUE INDEX "report_approvals_one_active_per_report"
  ON "report_approvals"("report_id") WHERE "voided_at" IS NULL;

-- Historial y versiones aprobadas: de solo inserción, como las correcciones.
CREATE FUNCTION "report_history_reject_changes"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% es de solo inserción', TG_TABLE_NAME
    USING ERRCODE = 'object_not_in_prerequisite_state';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "report_section_revisions_no_update_delete"
  BEFORE UPDATE OR DELETE ON "report_section_revisions"
  FOR EACH ROW EXECUTE FUNCTION "report_history_reject_changes"();
CREATE TRIGGER "report_section_revisions_no_truncate"
  BEFORE TRUNCATE ON "report_section_revisions"
  FOR EACH STATEMENT EXECUTE FUNCTION "report_history_reject_changes"();
CREATE TRIGGER "report_approval_revisions_no_update_delete"
  BEFORE UPDATE OR DELETE ON "report_approval_revisions"
  FOR EACH ROW EXECUTE FUNCTION "report_history_reject_changes"();
CREATE TRIGGER "report_approval_revisions_no_truncate"
  BEFORE TRUNCATE ON "report_approval_revisions"
  FOR EACH STATEMENT EXECUTE FUNCTION "report_history_reject_changes"();

COMMIT;

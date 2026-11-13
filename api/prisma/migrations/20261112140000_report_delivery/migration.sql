-- Entrega del informe (PF-42, parte B): estado DELIVERED, reapertura del
-- informe con motivo, entregas, enlace de descarga y descargas.
-- Escrita a mano: Prisma resolvía el cambio de tipo de `void_cause` como
-- DROP + ADD (perdía las causas ya guardadas) y no envuelve los pasos en una
-- transacción.
BEGIN;

-- AlterEnum (el valor nuevo no se usa en esta misma transacción)
ALTER TYPE "report_status" ADD VALUE 'DELIVERED';

-- CreateEnum
CREATE TYPE "report_approval_void_cause" AS ENUM ('REVIEW_REOPENED', 'REVIEW_RECALCULATED', 'REPORT_REOPENED');

-- La causa de anular la aprobación de un informe pasa a su propio enum,
-- conservando las ya guardadas.
ALTER TABLE "report_approvals"
  ALTER COLUMN "void_cause" TYPE "report_approval_void_cause" USING (
    CASE "void_cause"::text
      WHEN 'REOPENED' THEN 'REVIEW_REOPENED'
      WHEN 'RECALCULATED' THEN 'REVIEW_RECALCULATED'
    END
  )::"report_approval_void_cause",
  ADD COLUMN "void_reason" VARCHAR(500);

-- CreateTable
CREATE TABLE "report_deliveries" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "report_approval_id" TEXT NOT NULL,
    "recipient_name" VARCHAR(200) NOT NULL,
    "recipient_email" VARCHAR(320) NOT NULL,
    "pdf_sha256" CHAR(64) NOT NULL,
    "template_version" INTEGER NOT NULL,
    "delivered_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_download_links" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_download_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_downloads" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_downloads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_deliveries_report_id_created_at_idx" ON "report_deliveries"("report_id", "created_at");

-- CreateIndex
CREATE INDEX "report_deliveries_report_approval_id_report_id_idx" ON "report_deliveries"("report_approval_id", "report_id");

-- CreateIndex
CREATE INDEX "report_deliveries_delivered_by_id_idx" ON "report_deliveries"("delivered_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_deliveries_id_report_id_key" ON "report_deliveries"("id", "report_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_download_links_token_hash_key" ON "report_download_links"("token_hash");

-- CreateIndex
CREATE INDEX "report_download_links_report_id_idx" ON "report_download_links"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_download_links_delivery_id_report_id_key" ON "report_download_links"("delivery_id", "report_id");

-- CreateIndex
CREATE INDEX "report_downloads_link_id_created_at_idx" ON "report_downloads"("link_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "report_approvals_id_report_id_key" ON "report_approvals"("id", "report_id");

-- AddForeignKey
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_report_approval_id_report_id_fkey" FOREIGN KEY ("report_approval_id", "report_id") REFERENCES "report_approvals"("id", "report_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_delivered_by_id_fkey" FOREIGN KEY ("delivered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_download_links" ADD CONSTRAINT "report_download_links_delivery_id_report_id_fkey" FOREIGN KEY ("delivery_id", "report_id") REFERENCES "report_deliveries"("id", "report_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_download_links" ADD CONSTRAINT "report_download_links_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_downloads" ADD CONSTRAINT "report_downloads_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "report_download_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que la base garantiza aunque el código falle.
-- El motivo acompaña siempre, y solo, a la reapertura del informe.
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_reopened_has_reason" CHECK (
  ("void_cause" IS NOT DISTINCT FROM 'REPORT_REOPENED') = ("void_reason" IS NOT NULL)
);
ALTER TABLE "report_approvals" ADD CONSTRAINT "report_approvals_void_reason_not_blank" CHECK (
  "void_reason" IS NULL OR length(btrim("void_reason")) > 0
);
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_pdf_sha256_hex" CHECK (
  "pdf_sha256" ~ '^[0-9a-f]{64}$'
);
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_template_version_positive" CHECK (
  "template_version" >= 1
);
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_recipient_not_blank" CHECK (
  length(btrim("recipient_name")) > 0 AND length(btrim("recipient_email")) > 0
);
ALTER TABLE "report_download_links" ADD CONSTRAINT "report_download_links_token_hash_hex" CHECK (
  "token_hash" ~ '^[0-9a-f]{64}$'
);
ALTER TABLE "report_download_links" ADD CONSTRAINT "report_download_links_expires_after_created" CHECK (
  "expires_at" > "created_at"
);

-- A lo sumo un enlace sin revocar por informe: reenviar revoca el anterior.
CREATE UNIQUE INDEX "report_download_links_one_active_per_report"
  ON "report_download_links"("report_id") WHERE "revoked_at" IS NULL;

-- Entregas y descargas: de solo inserción, como el historial del informe.
CREATE TRIGGER "report_deliveries_no_update_delete"
  BEFORE UPDATE OR DELETE ON "report_deliveries"
  FOR EACH ROW EXECUTE FUNCTION "report_history_reject_changes"();
CREATE TRIGGER "report_deliveries_no_truncate"
  BEFORE TRUNCATE ON "report_deliveries"
  FOR EACH STATEMENT EXECUTE FUNCTION "report_history_reject_changes"();
CREATE TRIGGER "report_downloads_no_update_delete"
  BEFORE UPDATE OR DELETE ON "report_downloads"
  FOR EACH ROW EXECUTE FUNCTION "report_history_reject_changes"();
CREATE TRIGGER "report_downloads_no_truncate"
  BEFORE TRUNCATE ON "report_downloads"
  FOR EACH STATEMENT EXECUTE FUNCTION "report_history_reject_changes"();

-- Del enlace solo cambia `revoked_at`, una vez: de nulo a una fecha.
CREATE FUNCTION "report_download_links_guard_changes"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."revoked_at" IS NULL
    AND NEW."revoked_at" IS NOT NULL
    AND (to_jsonb(NEW) - 'revoked_at') = (to_jsonb(OLD) - 'revoked_at')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'report_download_links solo admite revocar un enlace vigente'
    USING ERRCODE = 'object_not_in_prerequisite_state';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "report_download_links_guard"
  BEFORE UPDATE OR DELETE ON "report_download_links"
  FOR EACH ROW EXECUTE FUNCTION "report_download_links_guard_changes"();
CREATE TRIGGER "report_download_links_no_truncate"
  BEFORE TRUNCATE ON "report_download_links"
  FOR EACH STATEMENT EXECUTE FUNCTION "report_history_reject_changes"();

COMMIT;

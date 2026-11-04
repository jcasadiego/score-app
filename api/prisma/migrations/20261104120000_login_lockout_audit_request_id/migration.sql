-- Bloqueo por intentos fallidos y correlación de la bitácora con los logs.
-- Solo agrega columnas y un índice: el trigger de solo inserción de audit_logs
-- frena UPDATE, DELETE y TRUNCATE, no ALTER TABLE.
BEGIN;

ALTER TABLE "users"
  ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMPTZ(3);

ALTER TABLE "audit_logs" ADD COLUMN "request_id" TEXT;

CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

COMMIT;

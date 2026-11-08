-- Registro de llamadas a la IA (PF-32): solo metadatos, nunca contenido.
BEGIN;

-- CreateEnum
CREATE TYPE "ai_call_outcome" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "ai_call_logs" (
    "id" TEXT NOT NULL,
    "use" VARCHAR(32) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "served_model" VARCHAR(64),
    "prompt_id" VARCHAR(64) NOT NULL,
    "prompt_version" VARCHAR(16) NOT NULL,
    "outcome" "ai_call_outcome" NOT NULL,
    "failure_reason" VARCHAR(32),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "estimated_cost_usd" DECIMAL(12,6),
    "duration_ms" INTEGER NOT NULL,
    "entity" VARCHAR(64),
    "entity_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_call_logs_created_at_idx" ON "ai_call_logs"("created_at");

-- CreateIndex
CREATE INDEX "ai_call_logs_entity_entity_id_idx" ON "ai_call_logs"("entity", "entity_id");

-- Los conteos y el costo nunca son negativos.
ALTER TABLE "ai_call_logs" ADD CONSTRAINT "ai_call_logs_non_negative" CHECK (
  ("input_tokens" IS NULL OR "input_tokens" >= 0)
  AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
  AND ("estimated_cost_usd" IS NULL OR "estimated_cost_usd" >= 0)
  AND "duration_ms" >= 0
);
-- Un fallo siempre dice por qué; un éxito no lleva motivo.
ALTER TABLE "ai_call_logs" ADD CONSTRAINT "ai_call_logs_failure_reason" CHECK (
  ("outcome" = 'FAILED') = ("failure_reason" IS NOT NULL)
);

COMMIT;

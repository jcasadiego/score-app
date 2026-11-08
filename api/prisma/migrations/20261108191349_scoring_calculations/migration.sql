-- Cálculos del motor (PF-24). Lo que Prisma no expresa va al final, a mano:
-- índices únicos parciales y CHECKs de cada estado.
BEGIN;

-- CreateEnum
CREATE TYPE "calculation_status" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "calculations" (
    "id" TEXT NOT NULL,
    "diagnostic_id" TEXT NOT NULL,
    "status" "calculation_status" NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "rule_set_version_id" TEXT,
    "engine" VARCHAR(32),
    "is_simulated" BOOLEAN,
    "error" VARCHAR(500),
    "requested_by_id" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calculations_diagnostic_id_created_at_idx" ON "calculations"("diagnostic_id", "created_at");

-- CreateIndex
CREATE INDEX "calculations_rule_set_version_id_idx" ON "calculations"("rule_set_version_id");

-- CreateIndex
CREATE INDEX "calculations_requested_by_id_idx" ON "calculations"("requested_by_id");

-- CreateIndex
CREATE INDEX "calculations_status_idx" ON "calculations"("status");

-- AddForeignKey
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_diagnostic_id_fkey" FOREIGN KEY ("diagnostic_id") REFERENCES "diagnostics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_rule_set_version_id_fkey" FOREIGN KEY ("rule_set_version_id") REFERENCES "rule_set_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A lo sumo un cálculo en curso por diagnóstico, también ante dos peticiones
-- simultáneas (doble clic en recalcular).
CREATE UNIQUE INDEX "calculations_one_in_progress_per_diagnostic"
  ON "calculations"("diagnostic_id") WHERE "status" IN ('PENDING', 'RUNNING');

-- Cada estado con los campos que le corresponden.
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_succeeded_has_result" CHECK (
  "status" <> 'SUCCEEDED' OR (
    "output" IS NOT NULL AND "rule_set_version_id" IS NOT NULL
    AND "is_simulated" IS NOT NULL AND "finished_at" IS NOT NULL
  )
);
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_failed_has_error" CHECK (
  "status" <> 'FAILED' OR ("error" IS NOT NULL AND "finished_at" IS NOT NULL)
);
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_in_progress_has_no_result" CHECK (
  "status" NOT IN ('PENDING', 'RUNNING') OR ("output" IS NULL AND "finished_at" IS NULL)
);

-- A lo sumo una versión de reglas activa, ni siquiera en simultáneo. Si ya hay
-- más de una, la migración falla a propósito: se decide a mano cuál queda.
CREATE UNIQUE INDEX "rule_set_versions_one_active"
  ON "rule_set_versions"("active") WHERE "active";

COMMIT;

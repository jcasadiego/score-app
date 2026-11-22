-- Sincronización con el CRM (PF-80): bandeja de salida `crm_sync_events`, id
-- del contacto en el lead y estado `CONTACTED` fuera de `lead_status` (el
-- seguimiento comercial vive en el CRM).
-- Escrita a mano: un solo BEGIN/COMMIT para todos los pasos, la tabla de leads
-- bloqueada antes de mover las filas y los CHECK que Prisma no genera.
BEGIN;

-- Ningún cambio de estado puede colarse entre mover las filas y cambiar el
-- tipo: un PATCH viejo que llegue durante el despliegue espera y luego falla.
LOCK TABLE "leads" IN ACCESS EXCLUSIVE MODE;

-- Los leads "contactados" vuelven a "nuevo" antes de quitar el valor.
UPDATE "leads" SET "status" = 'NEW' WHERE "status" = 'CONTACTED';

-- AlterEnum: Postgres no quita valores de un enum; se reemplaza el tipo.
CREATE TYPE "lead_status_new" AS ENUM ('NEW', 'CONVERTED');
ALTER TABLE "leads" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "status" TYPE "lead_status_new" USING ("status"::text::"lead_status_new");
ALTER TYPE "lead_status" RENAME TO "lead_status_old";
ALTER TYPE "lead_status_new" RENAME TO "lead_status";
DROP TYPE "lead_status_old";
ALTER TABLE "leads" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- CreateEnum
CREATE TYPE "crm_sync_event_type" AS ENUM ('LEAD_CREATED', 'DIAGNOSTIC_ACTIVATED', 'DIAGNOSTIC_STARTED', 'DIAGNOSTIC_COMPLETED', 'REPORT_DELIVERED');

-- CreateEnum
CREATE TYPE "crm_sync_event_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "crm_sync_error_code" AS ENUM ('TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR', 'INVALID_DATA', 'AUTH_FAILED');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "crm_contact_id" VARCHAR(100);

-- CreateTable
CREATE TABLE "crm_sync_events" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "type" "crm_sync_event_type" NOT NULL,
    "status" "crm_sync_event_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error_code" "crm_sync_error_code",
    "last_http_status" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "crm_sync_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_sync_events_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "crm_sync_events_http_status_check" CHECK (coalesce("last_http_status" BETWEEN 100 AND 599, true)),
    -- Enviado si y solo si tiene fecha de envío.
    CONSTRAINT "crm_sync_events_sent_at_check" CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL)),
    -- Un fallido siempre dice por qué.
    CONSTRAINT "crm_sync_events_failed_reason_check" CHECK ("status" <> 'FAILED' OR "last_error_code" IS NOT NULL)
);

-- CreateIndex: también cubre la FK (columna inicial).
CREATE INDEX "crm_sync_events_lead_id_created_at_idx" ON "crm_sync_events"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_sync_events_status_next_attempt_at_idx" ON "crm_sync_events"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "crm_sync_events" ADD CONSTRAINT "crm_sync_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

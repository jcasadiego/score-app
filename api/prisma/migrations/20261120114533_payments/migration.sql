-- Pagos registrados a mano y activación del diagnóstico con pago (PF-51).
-- Escrita a mano para envolver los pasos en una transacción y agregar los CHECK
-- y los índices parciales que Prisma no genera.
BEGIN;

-- CreateEnum
CREATE TYPE "diagnostic_activation_type" AS ENUM ('PAID', 'WITHOUT_PAYMENT');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'CONFIRMED', 'VOIDED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('PAYPAL', 'BANK_TRANSFER', 'PAGO_MOVIL', 'OTHER');

-- CreateEnum
CREATE TYPE "currency_code" AS ENUM ('USD', 'VES');

-- AlterTable
ALTER TABLE "diagnostics" ADD COLUMN     "activation_type" "diagnostic_activation_type" NOT NULL DEFAULT 'WITHOUT_PAYMENT';

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" VARCHAR(100) NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "registered_by_id" TEXT NOT NULL,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "voided_by_id" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_lead_id_idx" ON "payments"("lead_id");

-- CreateIndex
CREATE INDEX "payments_status_paid_at_idx" ON "payments"("status", "paid_at");

-- CreateIndex
CREATE INDEX "payments_registered_by_id_idx" ON "payments"("registered_by_id");

-- CreateIndex
CREATE INDEX "payments_confirmed_by_id_idx" ON "payments"("confirmed_by_id");

-- CreateIndex
CREATE INDEX "payments_voided_by_id_idx" ON "payments"("voided_by_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_registered_by_id_fkey" FOREIGN KEY ("registered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los textos obligatorios se comparan con `coalesce`: `length(btrim(NULL)) > 0`
-- da NULL, y un CHECK que da NULL se cumple.
--
-- Un diagnóstico sin pago lleva motivo; uno pagado no lo lleva. Los dos tienen
-- quién lo generó o activó. Reemplaza "diagnostics_panel_requires_reason", que
-- dejaba `created_by_id` nulo para los creados por Pagos. El código anterior
-- (sin `activation_type`) inserta con autor y motivo: cumple la regla nueva.
ALTER TABLE "diagnostics" DROP CONSTRAINT "diagnostics_panel_requires_reason";
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_activation_matches_reason"
  CHECK (
    "created_by_id" IS NOT NULL AND (
      ("activation_type" = 'WITHOUT_PAYMENT' AND length(btrim(coalesce("creation_reason", ''))) > 0)
      OR ("activation_type" = 'PAID' AND "creation_reason" IS NULL)
    )
  );

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_reference_not_blank"
  CHECK (length(btrim(coalesce("reference", ''))) > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_version_not_negative" CHECK ("version" >= 0);

-- Cada estado lleva exactamente sus datos: quién confirmó o anuló, cuándo y,
-- al anular, el motivo.
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_matches_data"
  CHECK (
    ("status" = 'PENDING'
      AND "confirmed_by_id" IS NULL AND "confirmed_at" IS NULL
      AND "voided_by_id" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL)
    OR ("status" = 'CONFIRMED'
      AND "confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL
      AND "voided_by_id" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL)
    OR ("status" = 'VOIDED'
      AND "voided_by_id" IS NOT NULL AND "voided_at" IS NOT NULL
      AND length(btrim(coalesce("void_reason", ''))) > 0
      AND "confirmed_by_id" IS NULL AND "confirmed_at" IS NULL)
  );

-- Un solo pago pendiente por lead: para corregirlo se anula y se registra otro.
CREATE UNIQUE INDEX "payments_one_pending_per_lead"
  ON "payments"("lead_id") WHERE "status" = 'PENDING';

-- La misma referencia no se cobra dos veces con el mismo método. Los anulados
-- no cuentan, para poder registrar de nuevo un pago mal cargado.
CREATE UNIQUE INDEX "payments_method_reference_key"
  ON "payments"("method", lower("reference")) WHERE "status" <> 'VOIDED';

COMMIT;

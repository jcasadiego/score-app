-- Contadores del límite de peticiones en la base, compartidos entre instancias
-- de la API (PF-60). Escrita a mano para envolver los pasos en una transacción.
BEGIN;

-- CreateTable
CREATE TABLE "throttle_counters" (
    "key" CHAR(64) NOT NULL,
    "throttler" VARCHAR(64) NOT NULL,
    "hits" INTEGER NOT NULL,
    "window_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3),

    CONSTRAINT "throttle_counters_pkey" PRIMARY KEY ("key","throttler"),
    CONSTRAINT "throttle_counters_hits_check" CHECK ("hits" >= 1)
);

-- CreateIndex
CREATE INDEX "throttle_counters_window_ends_at_idx" ON "throttle_counters"("window_ends_at");

COMMIT;

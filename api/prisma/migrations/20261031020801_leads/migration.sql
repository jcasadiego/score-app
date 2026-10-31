-- CreateEnum
CREATE TYPE "FamiliaDiagnostico" AS ENUM ('PROYECTO', 'B2B', 'PROFESIONAL', 'CATALOGO');

-- CreateEnum
CREATE TYPE "EstadoLead" AS ENUM ('NUEVO');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT,
    "familia" "FamiliaDiagnostico" NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "estado" "EstadoLead" NOT NULL DEFAULT 'NUEVO',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_creadoEn_idx" ON "Lead"("creadoEn");

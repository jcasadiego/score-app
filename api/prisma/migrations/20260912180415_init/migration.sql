-- CreateTable
CREATE TABLE "RegistroAuditoria" (
    "id" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT,
    "usuarioId" TEXT,
    "datos" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistroAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionReglas" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "contenido" JSONB NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VersionReglas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistroAuditoria_entidad_entidadId_idx" ON "RegistroAuditoria"("entidad", "entidadId");

-- CreateIndex
CREATE INDEX "RegistroAuditoria_creadoEn_idx" ON "RegistroAuditoria"("creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "VersionReglas_numero_key" ON "VersionReglas"("numero");

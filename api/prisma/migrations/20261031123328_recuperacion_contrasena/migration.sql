-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "versionSesion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TokenRecuperacionContrasena" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenRecuperacionContrasena_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenRecuperacionContrasena_tokenHash_key" ON "TokenRecuperacionContrasena"("tokenHash");

-- CreateIndex
CREATE INDEX "TokenRecuperacionContrasena_usuarioId_idx" ON "TokenRecuperacionContrasena"("usuarioId");

-- AddForeignKey
ALTER TABLE "TokenRecuperacionContrasena" ADD CONSTRAINT "TokenRecuperacionContrasena_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

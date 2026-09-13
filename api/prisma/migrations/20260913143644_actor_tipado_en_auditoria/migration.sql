/*
  Warnings:

  - You are about to drop the column `usuarioId` on the `RegistroAuditoria` table. All the data in the column will be lost.
  - Added the required column `actorTipo` to the `RegistroAuditoria` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ActorAuditoria" AS ENUM ('USUARIO_PANEL', 'CLIENTE_FINAL', 'SISTEMA');

-- AlterTable
ALTER TABLE "RegistroAuditoria" DROP COLUMN "usuarioId",
ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "actorTipo" "ActorAuditoria";

-- Backfill: los registros existentes son de antes de que el actor se
-- capturara correctamente (bug corregido junto con esta migración), así
-- que no hay un actor real que recuperar para ellos.
UPDATE "RegistroAuditoria" SET "actorTipo" = 'SISTEMA' WHERE "actorTipo" IS NULL;

ALTER TABLE "RegistroAuditoria" ALTER COLUMN "actorTipo" SET NOT NULL;

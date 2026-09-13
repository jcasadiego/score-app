-- AlterTable
-- `nombre` usa un default temporal solo para poder backfillear filas
-- existentes (de antes de este campo) sin perder datos; se quita
-- después para que quede NOT NULL sin default, como en el schema.
ALTER TABLE "Usuario" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nombre" TEXT NOT NULL DEFAULT 'Sin nombre';

ALTER TABLE "Usuario" ALTER COLUMN "nombre" DROP DEFAULT;

-- PR de prueba de PF-71: no se mergea.
ALTER TABLE "leads" ADD COLUMN "pf71_probe" TEXT;
ALTER TABLE "leads" DROP COLUMN "pf71_probe";

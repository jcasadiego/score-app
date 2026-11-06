-- Activación de cuenta por enlace (PF-59). Nulo = la cuenta espera que su dueño
-- defina la contraseña. Las cuentas existentes ya tienen una definida.
BEGIN;

ALTER TABLE "users" ADD COLUMN "password_set_at" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE "users" SET "password_set_at" = "updated_at";

COMMIT;

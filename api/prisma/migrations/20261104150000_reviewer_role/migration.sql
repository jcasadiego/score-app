-- Rol Revisor (PF-48). Los usuarios existentes se quedan en ADMIN (Aprobador).
BEGIN;

ALTER TYPE "user_role" ADD VALUE 'REVIEWER';

-- Sin valor por defecto: nadie debe recibir el rol con más privilegios por omisión.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

COMMIT;

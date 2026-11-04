-- Segundo factor del panel (TOTP): secreto cifrado y códigos de recuperación.
BEGIN;

ALTER TABLE "users"
  ADD COLUMN "mfa_secret" TEXT,
  ADD COLUMN "mfa_enabled_at" TIMESTAMPTZ(3),
  ADD COLUMN "mfa_last_used_step" INTEGER;

CREATE TABLE "user_recovery_codes" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_recovery_codes_code_hash_key" ON "user_recovery_codes"("code_hash");
CREATE INDEX "user_recovery_codes_user_id_idx" ON "user_recovery_codes"("user_id");

ALTER TABLE "user_recovery_codes"
  ADD CONSTRAINT "user_recovery_codes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

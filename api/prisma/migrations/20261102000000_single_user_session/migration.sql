-- Una sola sesión por usuario: se conserva la más reciente de cada uno.
DELETE FROM "user_sessions" AS older
USING "user_sessions" AS newer
WHERE older."user_id" = newer."user_id"
  AND (older."created_at", older."id") < (newer."created_at", newer."id");

-- DropIndex
DROP INDEX "user_sessions_user_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_user_id_key" ON "user_sessions"("user_id");

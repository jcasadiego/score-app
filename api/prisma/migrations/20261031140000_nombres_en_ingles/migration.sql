-- Pasa tablas, columnas, enums e índices a inglés (CLAUDE.md, sección 10).
-- Escrita a mano: Prisma resuelve un rename como DROP + CREATE y perdería
-- los datos. Aquí todo es RENAME, más un UPDATE de las acciones de la
-- bitácora para que el historial use los nombres nuevos.

-- Enums
ALTER TYPE "RolUsuario" RENAME TO "user_role";

ALTER TYPE "ActorAuditoria" RENAME TO "audit_actor_type";
ALTER TYPE "audit_actor_type" RENAME VALUE 'USUARIO_PANEL' TO 'PANEL_USER';
ALTER TYPE "audit_actor_type" RENAME VALUE 'CLIENTE_FINAL' TO 'END_CLIENT';
ALTER TYPE "audit_actor_type" RENAME VALUE 'SISTEMA' TO 'SYSTEM';

ALTER TYPE "FamiliaDiagnostico" RENAME TO "diagnostic_family";
ALTER TYPE "diagnostic_family" RENAME VALUE 'PROYECTO' TO 'PROJECT';
ALTER TYPE "diagnostic_family" RENAME VALUE 'PROFESIONAL' TO 'PROFESSIONAL';
ALTER TYPE "diagnostic_family" RENAME VALUE 'CATALOGO' TO 'CATALOG';

ALTER TYPE "EstadoLead" RENAME TO "lead_status";
ALTER TYPE "lead_status" RENAME VALUE 'NUEVO' TO 'NEW';
ALTER TYPE "lead_status" RENAME VALUE 'CONTACTADO' TO 'CONTACTED';
ALTER TYPE "lead_status" RENAME VALUE 'CONVERTIDO' TO 'CONVERTED';

-- audit_logs
ALTER TABLE "RegistroAuditoria" RENAME TO "audit_logs";
ALTER TABLE "audit_logs" RENAME COLUMN "actorTipo" TO "actor_type";
ALTER TABLE "audit_logs" RENAME COLUMN "actorId" TO "actor_id";
ALTER TABLE "audit_logs" RENAME COLUMN "accion" TO "action";
ALTER TABLE "audit_logs" RENAME COLUMN "entidad" TO "entity";
ALTER TABLE "audit_logs" RENAME COLUMN "entidadId" TO "entity_id";
ALTER TABLE "audit_logs" RENAME COLUMN "datos" TO "data";
ALTER TABLE "audit_logs" RENAME COLUMN "creadoEn" TO "created_at";
ALTER TABLE "audit_logs" RENAME CONSTRAINT "RegistroAuditoria_pkey" TO "audit_logs_pkey";
ALTER INDEX "RegistroAuditoria_entidad_entidadId_idx" RENAME TO "audit_logs_entity_entity_id_idx";
ALTER INDEX "RegistroAuditoria_creadoEn_idx" RENAME TO "audit_logs_created_at_idx";

UPDATE "audit_logs" SET "action" = CASE "action"
  WHEN 'CORREO_ENVIADO' THEN 'EMAIL_SENT'
  WHEN 'CORREO_FALLIDO' THEN 'EMAIL_FAILED'
  WHEN 'RECUPERACION_CONTRASENA_SOLICITADA' THEN 'PASSWORD_RESET_REQUESTED'
  WHEN 'CONTRASENA_RESTABLECIDA' THEN 'PASSWORD_RESET_COMPLETED'
  ELSE "action"
END;
UPDATE "audit_logs" SET "entity" = 'User' WHERE "entity" = 'Usuario';
UPDATE "audit_logs" SET "entity" = 'Email' WHERE "entity" = 'Correo';

-- rule_set_versions
ALTER TABLE "VersionReglas" RENAME TO "rule_set_versions";
ALTER TABLE "rule_set_versions" RENAME COLUMN "numero" TO "number";
ALTER TABLE "rule_set_versions" RENAME COLUMN "contenido" TO "content";
ALTER TABLE "rule_set_versions" RENAME COLUMN "activa" TO "active";
ALTER TABLE "rule_set_versions" RENAME COLUMN "creadoEn" TO "created_at";
ALTER TABLE "rule_set_versions" RENAME CONSTRAINT "VersionReglas_pkey" TO "rule_set_versions_pkey";
ALTER INDEX "VersionReglas_numero_key" RENAME TO "rule_set_versions_number_key";
ALTER SEQUENCE "VersionReglas_numero_seq" RENAME TO "rule_set_versions_number_seq";

-- users
ALTER TABLE "Usuario" RENAME TO "users";
ALTER TABLE "users" RENAME COLUMN "nombre" TO "name";
ALTER TABLE "users" RENAME COLUMN "passwordHash" TO "password_hash";
ALTER TABLE "users" RENAME COLUMN "activo" TO "active";
ALTER TABLE "users" RENAME COLUMN "rol" TO "role";
ALTER TABLE "users" RENAME COLUMN "versionSesion" TO "session_version";
ALTER TABLE "users" RENAME COLUMN "creadoEn" TO "created_at";
ALTER TABLE "users" RENAME COLUMN "actualizadoEn" TO "updated_at";
ALTER TABLE "users" RENAME CONSTRAINT "Usuario_pkey" TO "users_pkey";
ALTER INDEX "Usuario_email_key" RENAME TO "users_email_key";

-- password_reset_tokens
ALTER TABLE "TokenRecuperacionContrasena" RENAME TO "password_reset_tokens";
ALTER TABLE "password_reset_tokens" RENAME COLUMN "usuarioId" TO "user_id";
ALTER TABLE "password_reset_tokens" RENAME COLUMN "tokenHash" TO "token_hash";
ALTER TABLE "password_reset_tokens" RENAME COLUMN "expiraEn" TO "expires_at";
ALTER TABLE "password_reset_tokens" RENAME COLUMN "usadoEn" TO "used_at";
ALTER TABLE "password_reset_tokens" RENAME COLUMN "creadoEn" TO "created_at";
ALTER TABLE "password_reset_tokens" RENAME CONSTRAINT "TokenRecuperacionContrasena_pkey" TO "password_reset_tokens_pkey";
ALTER TABLE "password_reset_tokens" RENAME CONSTRAINT "TokenRecuperacionContrasena_usuarioId_fkey" TO "password_reset_tokens_user_id_fkey";
ALTER INDEX "TokenRecuperacionContrasena_tokenHash_key" RENAME TO "password_reset_tokens_token_hash_key";
ALTER INDEX "TokenRecuperacionContrasena_usuarioId_idx" RENAME TO "password_reset_tokens_user_id_idx";

-- leads
ALTER TABLE "Lead" RENAME TO "leads";
ALTER TABLE "leads" RENAME COLUMN "nombre" TO "name";
ALTER TABLE "leads" RENAME COLUMN "telefono" TO "phone";
ALTER TABLE "leads" RENAME COLUMN "familia" TO "family";
ALTER TABLE "leads" RENAME COLUMN "utmSource" TO "utm_source";
ALTER TABLE "leads" RENAME COLUMN "utmMedium" TO "utm_medium";
ALTER TABLE "leads" RENAME COLUMN "utmCampaign" TO "utm_campaign";
ALTER TABLE "leads" RENAME COLUMN "estado" TO "status";
ALTER TABLE "leads" RENAME COLUMN "creadoEn" TO "created_at";
ALTER TABLE "leads" RENAME COLUMN "actualizadoEn" TO "updated_at";
ALTER TABLE "leads" RENAME CONSTRAINT "Lead_pkey" TO "leads_pkey";
ALTER INDEX "Lead_email_idx" RENAME TO "leads_email_idx";
ALTER INDEX "Lead_creadoEn_idx" RENAME TO "leads_created_at_idx";

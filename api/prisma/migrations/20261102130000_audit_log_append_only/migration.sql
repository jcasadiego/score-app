-- La bitácora es de solo inserción. Con trigger y no con REVOKE: la API se
-- conecta como dueña de la tabla, y a la dueña un REVOKE no la frena.
BEGIN;

CREATE FUNCTION audit_logs_reject_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es de solo inserción';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_changes();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_changes();

COMMIT;

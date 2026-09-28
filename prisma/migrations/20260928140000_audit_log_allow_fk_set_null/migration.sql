CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow PostgreSQL foreign key ON DELETE SET NULL cascades (when referenced parent session or user is deleted)
  IF TG_OP = 'UPDATE' AND (
    (OLD."tontineSessionId" IS NOT NULL AND NEW."tontineSessionId" IS NULL) OR
    (OLD."actorId" IS NOT NULL AND NEW."actorId" IS NULL)
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_logs rows are immutable — % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

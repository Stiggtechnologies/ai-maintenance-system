/*
  # Pre-PR4 hardening: add 'failed' status to autonomous_decisions

  'rejected' means a human declined the recommendation.
  'failed' means a system error prevented the intelligence task
  from completing. These are semantically different and must not
  be conflated.

  Adds 'failed' to the CHECK constraint on autonomous_decisions.status.
*/

-- Drop the old constraint and re-create with the added status.
-- The existing CHECK is unnamed (inline), so we identify it by column.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
  WHERE con.conrelid = 'autonomous_decisions'::regclass
    AND att.attname = 'status'
    AND con.contype = 'c';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE autonomous_decisions DROP CONSTRAINT %I', constraint_name);
  END IF;
END
$$;

ALTER TABLE autonomous_decisions
  ADD CONSTRAINT autonomous_decisions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'auto_executed', 'expired', 'failed'));
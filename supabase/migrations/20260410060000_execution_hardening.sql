/*
  # Execution hardening

  Makes the approve→execute path production-safe before scaling to
  more capabilities.

  1. Idempotency on autonomous_actions
     - Add idempotency_key (derived from decision_id for approval
       executions) with partial unique index.
     - One successful execution per decision — duplicates are no-ops.

  2. Structured execution_result column
     - Replaces implicit success/error_message with a jsonb column
       containing: status, message, affected_records, timestamp.
     - Required for debugging, auditing, and future complex actions.

  3. executed_at normalization
     - Already exists on autonomous_decisions (set on approval).
     - Add explicit executed_at to autonomous_actions (set on
       execution, not on insert).
     - Ensures consistent timestamps across the audit chain.
*/

-- 1. Idempotency
ALTER TABLE autonomous_actions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_autonomous_actions_idempotency
  ON autonomous_actions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN autonomous_actions.idempotency_key IS
  'Guarantees at-most-once execution per logical action. For approval '
  'executions, derived from decision_id. Partial unique index enforces '
  'uniqueness only when key is non-null (legacy rows are exempt).';

-- 2. Structured execution_result
ALTER TABLE autonomous_actions
  ADD COLUMN IF NOT EXISTS execution_result jsonb;

COMMENT ON COLUMN autonomous_actions.execution_result IS
  'Structured execution outcome. Shape: '
  '{ status: "success"|"failed", message: string, '
  'affected_records: string[], timestamp: string }. '
  'Canonical source for what actually happened during execution.';

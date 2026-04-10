/*
  # Approve → Execute support

  1. Add decision_id column to autonomous_actions (was in jsonb only)
  2. Backfill existing rows from action_data->>'decision_id'
*/

ALTER TABLE autonomous_actions
  ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES autonomous_decisions(id) ON DELETE SET NULL;

-- Backfill from jsonb where possible
UPDATE autonomous_actions aa
SET decision_id = (aa.action_data->>'decision_id')::uuid
WHERE aa.decision_id IS NULL
  AND aa.action_data->>'decision_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autonomous_actions_decision
  ON autonomous_actions (decision_id)
  WHERE decision_id IS NOT NULL;
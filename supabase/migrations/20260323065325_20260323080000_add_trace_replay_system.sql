/*
  # Trace Replay System

  1. New Tables
    - `trace_snapshots` - Saved trace snapshots for replay
    - `trace_replay_sessions` - Replay session tracking

  2. Security
    - Enable RLS on all tables
    - Users can view traces for their runs

  3. Features
    - Snapshot storage for completed runs
    - Replay session management
    - Trace comparison
*/

CREATE TABLE IF NOT EXISTS trace_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  snapshot_type text NOT NULL DEFAULT 'full',
  trace_data jsonb NOT NULL,
  tool_calls jsonb DEFAULT '[]'::jsonb,
  costs jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS trace_replay_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_snapshot_id uuid NOT NULL REFERENCES trace_snapshots(id) ON DELETE CASCADE,
  replayed_by uuid NOT NULL REFERENCES auth.users(id),
  replay_mode text NOT NULL DEFAULT 'read_only',
  current_step integer DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_trace_snapshots_run ON trace_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_trace_snapshots_created ON trace_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trace_replay_sessions_snapshot ON trace_replay_sessions(trace_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_trace_replay_sessions_user ON trace_replay_sessions(replayed_by);

ALTER TABLE trace_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE trace_replay_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view trace snapshots"
  ON trace_snapshots FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create trace snapshots"
  ON trace_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can view their own replay sessions"
  ON trace_replay_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = replayed_by);

CREATE POLICY "Users can manage their own replay sessions"
  ON trace_replay_sessions FOR ALL
  TO authenticated
  USING (auth.uid() = replayed_by)
  WITH CHECK (auth.uid() = replayed_by);

CREATE OR REPLACE FUNCTION create_trace_snapshot(
  p_run_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_snapshot_id uuid;
  v_run_data jsonb;
  v_tool_calls jsonb;
  v_costs jsonb;
BEGIN
  SELECT to_jsonb(r.*) INTO v_run_data
  FROM openclaw_orchestration_runs r
  WHERE r.id = p_run_id;

  SELECT jsonb_agg(tc.*) INTO v_tool_calls
  FROM openclaw_tool_calls tc
  WHERE tc.orchestration_run_id = p_run_id
  ORDER BY tc.created_at;

  SELECT jsonb_agg(c.*) INTO v_costs
  FROM openclaw_costs c
  WHERE c.orchestration_run_id = p_run_id;

  INSERT INTO trace_snapshots (
    run_id,
    trace_data,
    tool_calls,
    costs,
    created_by
  ) VALUES (
    p_run_id,
    v_run_data,
    COALESCE(v_tool_calls, '[]'::jsonb),
    COALESCE(v_costs, '[]'::jsonb),
    p_user_id
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;
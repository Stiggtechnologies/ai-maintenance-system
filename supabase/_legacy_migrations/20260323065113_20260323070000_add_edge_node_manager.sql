/*
  # Edge Node Manager System

  1. New Tables
    - `edge_nodes` - Node registration, capabilities, status
    - `edge_node_heartbeats` - Heartbeat tracking for connectivity monitoring
    - `edge_node_capabilities` - Declared capabilities per node
    - `edge_node_queue` - Local queue for edge execution
    - `edge_deployments` - Track deployment assignments to nodes
    - `edge_sync_log` - Track delayed sync operations

  2. Security
    - Enable RLS on all edge tables
    - Policies for organizational unit isolation

  3. Functions
    - Automatic heartbeat expiry detection
    - Stale node detection
    - Queue sync coordination
*/

CREATE TABLE IF NOT EXISTS edge_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id uuid REFERENCES organizational_units(id) ON DELETE CASCADE,
  node_name text NOT NULL UNIQUE,
  node_type text NOT NULL DEFAULT 'standard',
  deployment_mode text NOT NULL DEFAULT 'cloud',
  capabilities jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  version text,
  ip_address inet,
  hostname text,
  last_heartbeat timestamptz,
  registered_at timestamptz DEFAULT now(),
  registered_by uuid REFERENCES auth.users(id),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS edge_node_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES edge_nodes(id) ON DELETE CASCADE,
  heartbeat_at timestamptz DEFAULT now(),
  status jsonb DEFAULT '{}'::jsonb,
  latency_ms integer,
  active_jobs integer DEFAULT 0,
  queued_jobs integer DEFAULT 0,
  errors_since_last integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS edge_node_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES edge_nodes(id) ON DELETE CASCADE,
  capability_type text NOT NULL,
  capability_name text NOT NULL,
  capability_version text,
  enabled boolean DEFAULT true,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(node_id, capability_type, capability_name)
);

CREATE TABLE IF NOT EXISTS edge_node_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES edge_nodes(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  job_payload jsonb NOT NULL,
  priority integer DEFAULT 50,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  synced_to_cloud_at timestamptz,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  error_log text,
  result jsonb
);

CREATE TABLE IF NOT EXISTS edge_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id uuid REFERENCES organizational_units(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES edge_nodes(id) ON DELETE CASCADE,
  deployment_type text NOT NULL,
  deployment_id uuid NOT NULL,
  deployment_name text NOT NULL,
  version text,
  enabled boolean DEFAULT true,
  deployed_at timestamptz DEFAULT now(),
  deployed_by uuid REFERENCES auth.users(id),
  config jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS edge_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES edge_nodes(id) ON DELETE CASCADE,
  sync_type text NOT NULL,
  sync_direction text NOT NULL,
  sync_status text NOT NULL DEFAULT 'pending',
  records_synced integer DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_edge_nodes_org ON edge_nodes(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_edge_nodes_status ON edge_nodes(status);
CREATE INDEX IF NOT EXISTS idx_edge_nodes_last_heartbeat ON edge_nodes(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_edge_heartbeats_node ON edge_node_heartbeats(node_id, heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_queue_node_status ON edge_node_queue(node_id, status);
CREATE INDEX IF NOT EXISTS idx_edge_queue_created ON edge_node_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_edge_deployments_node ON edge_deployments(node_id);
CREATE INDEX IF NOT EXISTS idx_edge_sync_log_node ON edge_sync_log(node_id, started_at DESC);

ALTER TABLE edge_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_node_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_node_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_node_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage edge nodes"
  ON edge_nodes FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'site_admin')
    )
  );

CREATE POLICY "Users can view edge nodes"
  ON edge_nodes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Node service can insert heartbeats"
  ON edge_node_heartbeats FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can view heartbeats"
  ON edge_node_heartbeats FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage capabilities"
  ON edge_node_capabilities FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'site_admin')
    )
  );

CREATE POLICY "Users can manage edge queue"
  ON edge_node_queue FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage deployments"
  ON edge_deployments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'site_admin')
    )
  );

CREATE POLICY "Users can view sync log"
  ON edge_sync_log FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION detect_stale_edge_nodes()
RETURNS TABLE(node_id uuid, node_name text, last_seen timestamptz, minutes_offline integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    en.id,
    en.node_name,
    en.last_heartbeat,
    EXTRACT(EPOCH FROM (now() - en.last_heartbeat))::integer / 60 AS minutes_offline
  FROM edge_nodes en
  WHERE en.status = 'online'
    AND en.last_heartbeat < now() - interval '5 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION update_edge_node_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE edge_nodes
  SET
    last_heartbeat = NEW.heartbeat_at,
    status = CASE
      WHEN NEW.errors_since_last > 5 THEN 'degraded'
      ELSE 'online'
    END
  WHERE id = NEW.node_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_heartbeat_update_node_status
  AFTER INSERT ON edge_node_heartbeats
  FOR EACH ROW
  EXECUTE FUNCTION update_edge_node_status();

CREATE OR REPLACE FUNCTION mark_stale_nodes_offline()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE edge_nodes
  SET status = 'offline'
  WHERE status = 'online'
    AND last_heartbeat < now() - interval '5 minutes';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
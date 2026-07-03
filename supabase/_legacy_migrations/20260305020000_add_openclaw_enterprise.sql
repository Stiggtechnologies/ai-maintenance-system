/*
  # OpenClaw Enterprise Hardening
  - Notification endpoints
  - Audit log
  - Health check history
*/

CREATE TABLE IF NOT EXISTS openclaw_notification_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  channel text NOT NULL,
  target text NOT NULL,
  endpoint_url text NOT NULL,
  headers jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS openclaw_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS openclaw_health_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text DEFAULT 'ok' CHECK (status IN ('ok', 'warn', 'error')),
  details jsonb DEFAULT '{}'::jsonb,
  checked_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_openclaw_audit_created ON openclaw_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openclaw_notify_endpoint ON openclaw_notification_endpoints(channel, target);

ALTER TABLE openclaw_notification_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_health_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "openclaw_notification_endpoints_select" ON openclaw_notification_endpoints FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "openclaw_notification_endpoints_insert" ON openclaw_notification_endpoints FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "openclaw_audit_select" ON openclaw_audit_log FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "openclaw_audit_insert" ON openclaw_audit_log FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "openclaw_health_history_select" ON openclaw_health_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "openclaw_health_history_insert" ON openclaw_health_history FOR INSERT TO authenticated WITH CHECK (true);

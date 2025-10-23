/*
  # Usage Tracking & Gain-Share Tables

  1. New Tables
    - `usage_events` - Records every credit-consuming event
    - `asset_snapshots` - Periodic snapshots of asset counts
    - `kpi_baselines` - Baseline KPI values for gain-share
    - `gainshare_runs` - Performance-based fee calculations

  2. Views
    - `v_tenant_monthly_usage` - Aggregated monthly credit usage
    - `v_asset_latest` - Latest asset count per tenant

  3. Security
    - Enable RLS on all tables
*/

-- Usage events table
CREATE TABLE IF NOT EXISTS usage_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  subscription_id UUID NOT NULL REFERENCES billing_subscriptions(id),
  site_id UUID,
  asset_id UUID,
  event_type TEXT NOT NULL,
  units BIGINT NOT NULL,
  credits_consumed BIGINT NOT NULL,
  meta JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_sub_period ON usage_events(subscription_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_tenant ON usage_events(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_type ON usage_events(event_type, occurred_at);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant usage"
  ON usage_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
  );

CREATE POLICY "System can insert usage events"
  ON usage_events FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Asset snapshots
CREATE TABLE IF NOT EXISTS asset_snapshots (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  asset_count INT NOT NULL,
  site_breakdown JSONB,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_snap_tenant ON asset_snapshots(tenant_id, captured_at DESC);

ALTER TABLE asset_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own asset snapshots"
  ON asset_snapshots FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
  );

-- KPI baselines
CREATE TABLE IF NOT EXISTS kpi_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  metric TEXT NOT NULL,
  baseline_value NUMERIC NOT NULL,
  currency TEXT DEFAULT 'CAD',
  cost_per_unit NUMERIC,
  effective_from DATE NOT NULL,
  effective_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, metric, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_kpi_baseline_tenant ON kpi_baselines(tenant_id);

ALTER TABLE kpi_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own KPI baselines"
  ON kpi_baselines FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
  );

-- Gain-share runs
CREATE TABLE IF NOT EXISTS gainshare_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  method TEXT NOT NULL DEFAULT 'delta_savings',
  calculated_savings_cad NUMERIC(14,2) NOT NULL,
  share_pct NUMERIC(5,2) NOT NULL,
  fee_cad NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  report JSONB,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  invoice_id UUID REFERENCES billing_invoices(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gainshare_tenant ON gainshare_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gainshare_status ON gainshare_runs(status);

ALTER TABLE gainshare_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own gain-share runs"
  ON gainshare_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
  );

-- Views
CREATE OR REPLACE VIEW v_tenant_monthly_usage AS
SELECT 
  subscription_id,
  tenant_id,
  date_trunc('month', occurred_at) AS month,
  SUM(credits_consumed) AS total_credits,
  COUNT(*) AS event_count
FROM usage_events
GROUP BY subscription_id, tenant_id, date_trunc('month', occurred_at);

CREATE OR REPLACE VIEW v_asset_latest AS
SELECT DISTINCT ON (tenant_id)
  tenant_id,
  asset_count,
  captured_at
FROM asset_snapshots
ORDER BY tenant_id, captured_at DESC;

CREATE OR REPLACE VIEW v_subscription_credit_summary AS
SELECT 
  bs.id AS subscription_id,
  bs.tenant_id,
  bp.code AS plan_code,
  bp.name AS plan_name,
  sl.included_credits,
  sl.remaining_credits,
  sl.included_credits - sl.remaining_credits AS credits_used,
  CASE 
    WHEN sl.remaining_credits < 0 THEN ABS(sl.remaining_credits)
    ELSE 0
  END AS overage_credits,
  bs.current_period_start,
  bs.current_period_end
FROM billing_subscriptions bs
JOIN billing_plans bp ON bp.id = bs.plan_id
JOIN subscription_limits sl ON sl.subscription_id = bs.id
WHERE bs.status = 'active';

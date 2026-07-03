/*
  # Add Missing MVP Tables

  1. New Tables
    - `kpi_thresholds` - KPI alerting thresholds (green/amber/red)
    - `kpi_rollups` - Aggregated KPI values by scope/period
    - `scorecards` - Role-based KPI groupings
    - `scorecard_items` - KPIs included in each scorecard
    - `backlog_snapshots` - Point-in-time work backlog metrics
    - `asset_risk_scores` - Asset-specific risk scoring over time

  2. Security
    - Enable RLS on all new tables
    - Add tenant isolation policies
*/

-- KPI thresholds
CREATE TABLE IF NOT EXISTS kpi_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kpi_definition_id uuid NOT NULL REFERENCES kpi_definitions(id) ON DELETE CASCADE,
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  green_min numeric,
  green_max numeric,
  amber_min numeric,
  amber_max numeric,
  red_min numeric,
  red_max numeric,
  threshold_logic text DEFAULT 'range',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE kpi_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view KPI thresholds in their org"
  ON kpi_thresholds FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage KPI thresholds"
  ON kpi_thresholds FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- KPI rollups
CREATE TABLE IF NOT EXISTS kpi_rollups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  scope_type text NOT NULL,
  scope_id uuid,
  kpi_definition_id uuid NOT NULL REFERENCES kpi_definitions(id) ON DELETE CASCADE,
  period_type text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  value numeric NOT NULL,
  status text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE kpi_rollups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view KPI rollups in their org"
  ON kpi_rollups FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "System can manage KPI rollups"
  ON kpi_rollups FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Scorecards
CREATE TABLE IF NOT EXISTS scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  role_code text NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE scorecards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view scorecards in their org"
  ON scorecards FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage scorecards"
  ON scorecards FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Scorecard items
CREATE TABLE IF NOT EXISTS scorecard_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_id uuid NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  kpi_definition_id uuid NOT NULL REFERENCES kpi_definitions(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE scorecard_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view scorecard items via scorecard"
  ON scorecard_items FOR SELECT
  TO authenticated
  USING (scorecard_id IN (
    SELECT id FROM scorecards
    WHERE organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  ));

CREATE POLICY "Admins can manage scorecard items"
  ON scorecard_items FOR ALL
  TO authenticated
  USING (scorecard_id IN (
    SELECT id FROM scorecards
    WHERE organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  ))
  WITH CHECK (scorecard_id IN (
    SELECT id FROM scorecards
    WHERE organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  ));

-- Backlog snapshots
CREATE TABLE IF NOT EXISTS backlog_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  snapshot_time timestamptz NOT NULL DEFAULT now(),
  open_work_order_count integer DEFAULT 0,
  overdue_count integer DEFAULT 0,
  backlog_hours numeric DEFAULT 0,
  critical_backlog_hours numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE backlog_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view backlog snapshots in their org"
  ON backlog_snapshots FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "System can manage backlog snapshots"
  ON backlog_snapshots FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Asset risk scores (separate from general risk_scores table)
CREATE TABLE IF NOT EXISTS asset_risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  score_time timestamptz NOT NULL DEFAULT now(),
  risk_score numeric NOT NULL,
  probability_score numeric,
  consequence_score numeric,
  model_version text,
  drivers jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE asset_risk_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view asset risk scores in their org"
  ON asset_risk_scores FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "System can manage asset risk scores"
  ON asset_risk_scores FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_kpi_thresholds_org_kpi ON kpi_thresholds(organization_id, kpi_definition_id);
CREATE INDEX IF NOT EXISTS idx_kpi_rollups_org_kpi_period ON kpi_rollups(organization_id, kpi_definition_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_asset_risk_scores_asset_time ON asset_risk_scores(asset_id, score_time DESC);
CREATE INDEX IF NOT EXISTS idx_asset_risk_scores_org_site_time ON asset_risk_scores(organization_id, site_id, score_time DESC);
CREATE INDEX IF NOT EXISTS idx_backlog_snapshots_org_site_time ON backlog_snapshots(organization_id, site_id, snapshot_time DESC);

-- Add updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_kpi_thresholds_updated_at') THEN
    CREATE TRIGGER update_kpi_thresholds_updated_at BEFORE UPDATE ON kpi_thresholds FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_scorecards_updated_at') THEN
    CREATE TRIGGER update_scorecards_updated_at BEFORE UPDATE ON scorecards FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

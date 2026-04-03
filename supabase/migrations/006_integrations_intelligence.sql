-- SyncAI MVP - Integrations & Intelligence Core Migration

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- H. INTEGRATIONS DOMAIN
-- ============================================

CREATE TABLE connectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    connector_type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    config JSONB DEFAULT '{}',
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE connector_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connector_id UUID REFERENCES connectors(id) ON DELETE CASCADE NOT NULL,
    run_type TEXT,
    status TEXT DEFAULT 'pending',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    records_processed INTEGER DEFAULT 0,
    error_message TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE normalized_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    signal_type TEXT NOT NULL,
    signal_name TEXT NOT NULL,
    signal_time TIMESTAMPTZ NOT NULL,
    numeric_value NUMERIC,
    text_value TEXT,
    unit TEXT,
    quality_status TEXT DEFAULT 'good',
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- I. INTELLIGENCE DOMAIN
-- ============================================

CREATE TABLE recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    source_type TEXT,
    title TEXT NOT NULL,
    summary TEXT,
    recommendation_type TEXT,
    priority TEXT DEFAULT 'medium',
    risk_score NUMERIC,
    confidence_score NUMERIC,
    impacted_kpi_ids UUID[],
    business_impact JSONB,
    approval_required BOOLEAN DEFAULT false,
    status TEXT DEFAULT 'pending',
    generated_by_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE decision_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    recommendation_id UUID REFERENCES recommendations(id) ON DELETE SET NULL,
    related_entity_type TEXT,
    related_entity_id UUID,
    source_signal_summary TEXT,
    impacted_kpi_summary JSONB,
    business_impact_summary JSONB,
    confidence_score NUMERIC,
    required_approval BOOLEAN,
    decision_outcome TEXT,
    decided_by_actor_type TEXT,
    decided_by_actor_id UUID,
    decision_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE risk_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    score_time TIMESTAMPTZ DEFAULT NOW(),
    risk_score NUMERIC NOT NULL,
    probability_score NUMERIC,
    consequence_score NUMERIC,
    model_version TEXT,
    drivers JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX idx_connectors_org ON connectors(organization_id);
CREATE INDEX idx_connector_runs_connector ON connector_runs(connector_id);
CREATE INDEX idx_normalized_signals_asset ON normalized_signals(asset_id);
CREATE INDEX idx_normalized_signals_time ON normalized_signals(signal_time);
CREATE INDEX idx_recommendations_org ON recommendations(organization_id);
CREATE INDEX idx_recommendations_asset ON recommendations(asset_id);
CREATE INDEX idx_recommendations_status ON recommendations(status);
CREATE INDEX idx_risk_scores_asset ON risk_scores(asset_id);
CREATE INDEX idx_risk_scores_time ON risk_scores(score_time);

-- RLS
ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE normalized_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conn_select" ON connectors FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "cr_select" ON connector_runs FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "ns_select" ON normalized_signals FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "rec_select" ON recommendations FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "dl_select" ON decision_logs FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "rs_select" ON risk_scores FOR SELECT USING (organization_id = current_user_org_id());

-- Risk calculation function
CREATE OR REPLACE FUNCTION calculate_asset_risk(asset_id UUID) RETURNS NUMERIC AS $$
DECLARE
    c_level TEXT;
    health NUMERIC;
    age_years NUMERIC;
    score NUMERIC;
BEGIN
    SELECT a.criticality_level, a.health_score, 
           COALESCE(EXTRACT(YEAR FROM AGE(NOW(), a.install_date))::INTEGER, 0)
    INTO c_level, health, age_years
    FROM assets a WHERE a.id = asset_id;
    
    IF NOT FOUND THEN RETURN 50; END IF;
    
    CASE c_level WHEN 'critical' THEN score := 40;
        WHEN 'high' THEN score := 30;
        WHEN 'medium' THEN score := 20;
        ELSE score := 10;
    END CASE;
    
    score := score + (100 - COALESCE(health, 100)) + LEAST(age_years * 2, 40);
    RETURN LEAST(score, 100);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'Integrations & Intelligence Core Migration Complete' AS status;
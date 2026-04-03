-- SyncAI Integrations and Intelligence Migration
-- Workstream 4: CMMS Connectors, Ingestion, Recommendation Engine, Risk Scoring

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- INTEGRATION DOMAIN
-- ============================================

-- Connectors (CMMS, ERP, SCADA, IoT)
CREATE TABLE connectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    connector_type TEXT NOT NULL, -- cmms, erp, scada, iot, historian, api
    description TEXT,
    config JSONB DEFAULT '{}',
    credentials JSONB DEFAULT '{}', -- encrypted
    is_active BOOLEAN DEFAULT true,
    last_sync TIMESTAMPTZ,
    sync_status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Connector Runs
CREATE TABLE connector_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connector_id UUID REFERENCES connectors(id) ON DELETE CASCADE NOT NULL,
    status TEXT NOT NULL, -- running, completed, failed
    records_processed INTEGER,
    records_created INTEGER,
    records_updated INTEGER,
    errors JSONB,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Ingestion Jobs
CREATE TABLE ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    connector_id UUID REFERENCES connectors(id) ON DELETE SET NULL,
    job_type TEXT NOT NULL, -- batch, realtime, scheduled
    schedule_cron TEXT,
    last_run TIMESTAMPTZ,
    next_run TIMESTAMPTZ,
    status TEXT DEFAULT 'active',
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ingestion Events
CREATE TABLE ingestion_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    job_id UUID REFERENCES ingestion_jobs(id) ON DELETE SET NULL,
    event_type TEXT,
    source_id TEXT,
    payload JSONB,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Normalized Signals (from IoT/SCADA)
CREATE TABLE normalized_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    signal_name TEXT NOT NULL,
    signal_type TEXT NOT NULL, -- numeric, boolean, string
    value JSONB NOT NULL,
    quality TEXT DEFAULT 'good', -- good, suspect, bad
    units TEXT,
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Signal Quality Records
CREATE TABLE signal_quality_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    signal_id UUID REFERENCES normalized_signals(id) ON DELETE CASCADE NOT NULL,
    quality TEXT NOT NULL,
    reason TEXT,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INTELLIGENCE DOMAIN
-- ============================================

-- Recommendations
CREATE TABLE recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    recommendation_type TEXT NOT NULL, -- maintenance, repair, replacement, investigation
    title TEXT NOT NULL,
    description TEXT,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
    confidence NUMERIC DEFAULT 0, -- 0-1
    priority INTEGER DEFAULT 3, -- 1=Critical, 2=High, 3=Medium, 4=Low
    estimated_cost NUMERIC,
    estimated_labor_hours NUMERIC,
    status TEXT DEFAULT 'pending', -- pending, accepted, rejected, completed
    created_by TEXT, -- AI agent name
    accepted_by UUID REFERENCES users(id),
    accepted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Risk Scores
CREATE TABLE risk_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    risk_type TEXT NOT NULL, -- failure, safety, compliance, financial
    risk_score NUMERIC NOT NULL, -- 0-100
    likelihood TEXT, -- very_low, low, medium, high, very_high
    consequence TEXT, -- very_low, low, medium, high, very_high
    contributing_factors JSONB DEFAULT '[]',
    confidence NUMERIC DEFAULT 0.8,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- Anomaly Detection
CREATE TABLE anomalies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    anomaly_type TEXT NOT NULL, -- vibration, temperature, current, pressure
    description TEXT,
    severity TEXT DEFAULT 'low', -- low, medium, high, critical
    confidence NUMERIC DEFAULT 0.8,
    sensor_readings JSONB,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT
);

-- AI Agents
CREATE TABLE ai_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    agent_type TEXT NOT NULL, -- analyzer, predictor, optimizer, recommender
    model_config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    last_run TIMESTAMPTZ,
    run_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent Outputs
CREATE TABLE agent_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE NOT NULL,
    output_type TEXT NOT NULL,
    content JSONB NOT NULL,
    confidence NUMERIC,
    execution_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Decision Rules (for autonomy engine)
CREATE TABLE decision_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    condition JSONB NOT NULL, -- when condition is met
    action JSONB NOT NULL, -- then take this action
    autonomy_mode TEXT, -- applies to specific mode
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_connectors_org ON connectors(organization_id);
CREATE INDEX idx_connector_runs_connector ON connector_runs(connector_id);
CREATE INDEX idx_ingestion_jobs_org ON ingestion_jobs(organization_id);
CREATE INDEX idx_ingestion_events_job ON ingestion_events(job_id);
CREATE INDEX idx_normalized_signals_asset ON normalized_signals(asset_id);
CREATE INDEX idx_normalized_signals_recorded ON normalized_signals(recorded_at);
CREATE INDEX idx_recommendations_org ON recommendations(organization_id);
CREATE INDEX idx_recommendations_asset ON recommendations(asset_id);
CREATE INDEX idx_recommendations_status ON recommendations(status);
CREATE INDEX idx_risk_scores_asset ON risk_scores(asset_id);
CREATE INDEX idx_risk_scores_calculated ON risk_scores(calculated_at);
CREATE INDEX idx_anomalies_asset ON anomalies(asset_id);
CREATE INDEX idx_anomalies_detected ON anomalies(detected_at);
CREATE INDEX idx_ai_agents_org ON ai_agents(organization_id);
CREATE INDEX idx_agent_outputs_agent ON agent_outputs(agent_id);
CREATE INDEX idx_decision_rules_org ON decision_rules(organization_id);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE normalized_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_quality_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conn_org_isolation" ON connectors FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "cr_org_isolation" ON connector_runs FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "ij_org_isolation" ON ingestion_jobs FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "ie_org_isolation" ON ingestion_events FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "ns_org_isolation" ON normalized_signals FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "sqr_org_isolation" ON signal_quality_records FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "rec_org_isolation" ON recommendations FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "rs_org_isolation" ON risk_scores FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "anom_org_isolation" ON anomalies FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "aa_org_isolation" ON ai_agents FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "ao_org_isolation" ON agent_outputs FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "dr_org_isolation" ON decision_rules FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- ============================================
-- FUNCTION: CALCULATE RISK SCORE
-- ============================================

CREATE OR REPLACE FUNCTION calculate_asset_risk_score(asset_id UUID)
RETURNS NUMERIC AS $$
DECLARE
    c_level INTEGER;
    health NUMERIC;
    age_years NUMERIC;
    score NUMERIC;
BEGIN
    -- Get asset criticality and health
    SELECT a.criticality_level, a.health_score, 
           EXTRACT(YEAR FROM AGE(NOW(), a.install_date))::INTEGER
    INTO c_level, health, age_years
    FROM assets a
    WHERE a.id = calculate_asset_risk_score.asset_id;
    
    IF NOT FOUND THEN RETURN 50; END IF;
    
    -- Calculate risk: higher = more risk
    -- Criticality: 1=critical (40 pts), 2=high (30), 3=medium (20), 4=low (10)
    CASE c_level
        WHEN 1 THEN score := 40;
        WHEN 2 THEN score := 30;
        WHEN 3 THEN score := 20;
        ELSE score := 10;
    END CASE;
    
    -- Health: 0-100 (lower = more risk)
    score := score + (100 - COALESCE(health, 100));
    
    -- Age: 0-20+ years
    score := score + LEAST(age_years * 2, 40);
    
    -- Cap at 100
    RETURN LEAST(score, 100);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'SyncAI Integrations and Intelligence Migration Complete' AS status;
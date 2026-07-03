-- SyncAI Phase 3c: OpenClaw Compatibility Tables
-- Creates compatibility tables/views for existing app queries

BEGIN;

-- Map to existing AI agents structure for onboarding compatibility
CREATE TABLE IF NOT EXISTS openclaw_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    agent_type TEXT,
    status TEXT DEFAULT 'active',
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    configuration JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Map to AI agent logs for insights tracking
CREATE TABLE IF NOT EXISTS ai_agent_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES openclaw_agents(id) ON DELETE SET NULL,
    action_type TEXT,
    input_data JSONB,
    output_data JSONB,
    confidence_score NUMERIC,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed some default agents for onboarding
INSERT INTO openclaw_agents (name, agent_type, status, organization_id) 
SELECT 'Asset Monitor', 'monitoring', 'active', id FROM organizations LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO openclaw_agents (name, agent_type, status, organization_id) 
SELECT 'OEE Analyzer', 'performance', 'active', id FROM organizations LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO openclaw_agents (name, agent_type, status, organization_id) 
SELECT 'Work Order Manager', 'work_management', 'active', id FROM organizations LIMIT 1
ON CONFLICT DO NOTHING;

-- Add onboarding columns to user_profiles if not exists
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_progress JSONB DEFAULT '{}';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_current_step INTEGER DEFAULT 0;

-- Create view to track onboarding progress
CREATE OR REPLACE VIEW onboarding_status AS
SELECT 
    up.id as user_id,
    up.onboarding_completed,
    up.onboarding_progress,
    up.onboarding_current_step,
    COUNT(DISTINCT a.id)::int as total_assets,
    COUNT(DISTINCT oa.id)::int as total_agents,
    COUNT(DISTINCT al.id)::int as total_insights,
    COUNT(DISTINCT wo.id)::int as total_work_orders
FROM user_profiles up
LEFT JOIN assets a ON a.organization_id = up.organization_id
LEFT JOIN openclaw_agents oa ON oa.organization_id = up.organization_id
LEFT JOIN ai_agent_logs al ON al.organization_id = up.organization_id
LEFT JOIN work_orders wo ON wo.organization_id = up.organization_id
GROUP BY up.id;

-- Ensure user_kpi_dashboard works with new schema
-- Already created in 010, but ensure it's accessible
GRANT SELECT ON user_kpi_dashboard TO authenticated;
GRANT SELECT ON asset_criticality_summary TO authenticated;
GRANT SELECT ON work_order_summary TO authenticated;
GRANT SELECT ON recommendation_summary TO authenticated;
GRANT SELECT ON onboarding_status TO authenticated;

COMMIT;

SELECT 'Phase 3c compatibility tables created' AS status;
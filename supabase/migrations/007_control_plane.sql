-- SyncAI MVP - Control Plane Core Migration

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- J. CONTROL PLANE DOMAIN
-- ============================================

CREATE TABLE deployment_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    industry TEXT,
    description TEXT,
    template_config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE deployment_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    deployment_template_id UUID REFERENCES deployment_templates(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    autonomy_mode TEXT,
    configuration JSONB DEFAULT '{}',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE deployment_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_instance_id UUID REFERENCES deployment_instances(id) ON DELETE CASCADE NOT NULL,
    step_order INTEGER NOT NULL,
    step_code TEXT NOT NULL,
    step_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    details JSONB,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE environment_health (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    status_time TIMESTAMPTZ DEFAULT NOW(),
    intelligence_engine_status TEXT DEFAULT 'healthy',
    integration_health_status TEXT DEFAULT 'healthy',
    governance_status TEXT DEFAULT 'healthy',
    data_sync_percent NUMERIC DEFAULT 100,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE diagnostics_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    deployment_instance_id UUID REFERENCES deployment_instances(id) ON DELETE SET NULL,
    diagnostic_type TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX idx_deployment_instances_org ON deployment_instances(organization_id);
CREATE INDEX idx_deployment_instances_status ON deployment_instances(status);
CREATE INDEX idx_deployment_steps_instance ON deployment_steps(deployment_instance_id);
CREATE INDEX idx_environment_health_org ON environment_health(organization_id);
CREATE INDEX idx_environment_health_time ON environment_health(status_time);

-- SEED: DEPLOYMENT TEMPLATES
INSERT INTO deployment_templates (code, name, industry, description) VALUES
    ('oil_sands', 'Oil Sands', 'mining', 'Standard oil sands operation template'),
    ('mining', 'Mining', 'mining', 'Standard mining operation template'),
    ('manufacturing', 'Manufacturing', 'manufacturing', 'Standard manufacturing template'),
    ('utilities', 'Utilities', 'utilities', 'Utility infrastructure template')
ON CONFLICT (code) DO NOTHING;

-- RLS
ALTER TABLE deployment_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE environment_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnostics_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dt_select" ON deployment_templates FOR SELECT USING (true);
CREATE POLICY "di_select" ON deployment_instances FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "ds_select" ON deployment_steps FOR SELECT USING (
    EXISTS (SELECT 1 FROM deployment_instances di WHERE di.id = deployment_steps.deployment_instance_id AND di.organization_id = current_user_org_id())
);
CREATE POLICY "eh_select" ON environment_health FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "dr_select" ON diagnostics_records FOR SELECT USING (organization_id = current_user_org_id());

SELECT 'Control Plane Core Migration Complete' AS status;
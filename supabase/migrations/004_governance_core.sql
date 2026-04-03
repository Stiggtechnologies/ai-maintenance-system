-- SyncAI MVP - Governance Core Migration

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- F. GOVERNANCE DOMAIN
-- ============================================

CREATE TABLE autonomy_modes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE approval_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    applies_to_module TEXT,
    applies_to_action TEXT,
    asset_criticality_band TEXT,
    risk_score_min NUMERIC,
    approval_role_code TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE escalation_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    trigger_type TEXT,
    trigger_condition JSONB,
    escalate_to_role_code TEXT,
    sla_minutes INTEGER,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE decision_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    condition_json JSONB NOT NULL,
    action_json JSONB NOT NULL,
    governance_json JSONB,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    required_role_code TEXT,
    status TEXT DEFAULT 'pending',
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    decided_by UUID REFERENCES user_profiles(id),
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    override_type TEXT,
    previous_value JSONB,
    new_value JSONB,
    reason TEXT,
    overridden_by UUID REFERENCES user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    entity_type TEXT,
    entity_id UUID,
    event_type TEXT NOT NULL,
    actor_type TEXT,
    actor_id UUID,
    event_time TIMESTAMPTZ DEFAULT NOW(),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX idx_approval_policies_org ON approval_policies(organization_id);
CREATE INDEX idx_decision_rules_org ON decision_rules(organization_id);
CREATE INDEX idx_approvals_entity ON approvals(entity_type, entity_id);
CREATE INDEX idx_overrides_entity ON overrides(entity_type, entity_id);
CREATE INDEX idx_audit_events_org ON audit_events(organization_id);
CREATE INDEX idx_audit_events_time ON audit_events(event_time DESC);
CREATE INDEX idx_audit_events_entity ON audit_events(entity_type, entity_id);

-- SEED: AUTONOMY MODES
INSERT INTO autonomy_modes (code, name, description) VALUES
    ('advisory', 'Advisory', 'AI provides recommendations, human decides'),
    ('conditional', 'Conditional', 'AI acts if confidence high'),
    ('controlled_autonomy', 'Controlled Autonomy', 'AI executes within bounds')
ON CONFLICT (code) DO NOTHING;

-- RLS
ALTER TABLE autonomy_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "am_select" ON autonomy_modes FOR SELECT USING (true);
CREATE POLICY "ap_select" ON approval_policies FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "ep_select" ON escalation_policies FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "dr_select" ON decision_rules FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "appr_select" ON approvals FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "over_select" ON overrides FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "audit_select" ON audit_events FOR SELECT USING (organization_id = current_user_org_id());

-- Audit trigger function
CREATE OR REPLACE FUNCTION syncai_audit_trigger() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_events (organization_id, event_type, actor_type, actor_id, entity_type, entity_id, details)
    VALUES (
        COALESCE(NEW.organization_id, current_user_org_id()),
        TG_OP, 
        CASE WHEN auth.uid() IS NOT NULL THEN 'user' END,
        auth.uid()::uuid,
        TG_TABLE_NAME,
        NEW.id,
        to_jsonb(NEW)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'Governance Core Migration Complete' AS status;
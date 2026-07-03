-- SyncAI Core Platform Migration
-- Workstream 1: Organizations, Sites, Users, RBAC, Governance, Audit

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PLATFORM DOMAIN
-- ============================================

-- Organizations (multi-tenant)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    industry TEXT,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sites
CREATE TABLE sites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    location TEXT,
    address TEXT,
    timezone TEXT DEFAULT 'America/Edmonton',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Roles (system roles for RBAC)
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_system_role BOOLEAN DEFAULT false,
    permissions JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permissions (action definitions)
CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT,
    UNIQUE(resource, action)
);

-- User Role Assignments
CREATE TABLE user_role_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- ============================================
-- GOVERNANCE DOMAIN
-- ============================================

-- Autonomy Modes (Advisory, Conditional, Controlled)
CREATE TABLE autonomy_modes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    min_confidence NUMERIC DEFAULT 0,
    max_autonomy_level INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Approval Policies
CREATE TABLE approval_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    threshold_amount NUMERIC DEFAULT 0,
    threshold_type TEXT DEFAULT 'cost',
    require_approval_role_id UUID REFERENCES roles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Decision Logs (AI decisions and human overrides)
CREATE TABLE decision_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id UUID,
    decision TEXT,
    confidence NUMERIC,
    reasoning TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Events (full audit trail)
CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id),
    event_type TEXT NOT NULL,
    event_action TEXT,
    resource_type TEXT,
    resource_id UUID,
    changes JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CONTROL PLANE DOMAIN
-- ============================================

-- Deployment Templates
CREATE TABLE deployment_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    industry TEXT,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_sites_organization ON sites(organization_id);
CREATE INDEX idx_users_organization ON users(organization_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_roles_organization ON roles(organization_id);
CREATE INDEX idx_user_role_assignments_user ON user_role_assignments(user_id);
CREATE INDEX idx_user_role_assignments_role ON user_role_assignments(role_id);
CREATE INDEX idx_decision_logs_organization ON decision_logs(organization_id);
CREATE INDEX idx_decision_logs_user ON decision_logs(user_id);
CREATE INDEX idx_audit_events_organization ON audit_events(organization_id);
CREATE INDEX idx_audit_events_user ON audit_events(user_id);
CREATE INDEX idx_audit_events_resource ON audit_events(resource_type, resource_id);

-- ============================================
-- SEED DATA: SYSTEM ROLES
-- ============================================

INSERT INTO roles (id, name, description, is_system_role, permissions) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Admin', 'Full system administration', true, '["*"]'::jsonb),
    ('00000000-0000-0000-0000-000000000002', 'Manager', 'Site/team management', true, '["read","write","approve"]'::jsonb),
    ('00000000-0000-0000-0000-000000000003', 'Operator', 'Day-to-day operations', true, '["read","write"]'::jsonb),
    ('00000000-0000-0000-0000-000000000004', 'Viewer', 'Read-only access', true, '["read"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- SEED DATA: PERMISSIONS
-- ============================================

INSERT INTO permissions (resource, action, description) VALUES
    ('organizations', 'read', 'View organizations'),
    ('organizations', 'write', 'Create/update organizations'),
    ('sites', 'read', 'View sites'),
    ('sites', 'write', 'Create/update sites'),
    ('users', 'read', 'View users'),
    ('users', 'write', 'Create/update users'),
    ('roles', 'read', 'View roles'),
    ('roles', 'write', 'Create/update roles'),
    ('assets', 'read', 'View assets'),
    ('assets', 'write', 'Create/update assets'),
    ('work', 'read', 'View work orders'),
    ('work', 'write', 'Create/update work orders'),
    ('approve', 'execute', 'Approve decisions'),
    ('audit', 'read', 'View audit logs')
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED DATA: AUTONOMY MODES
-- ============================================

INSERT INTO autonomy_modes (organization_id, name, description, min_confidence, max_autonomy_level) VALUES
    (NULL, 'Advisory', 'AI provides recommendations, human decides', 0, 1),
    (NULL, 'Conditional', 'AI acts if confidence high, otherwise escalates', 0.7, 2),
    (NULL, 'Controlled', 'AI executes within bounds, monitors closely', 0.9, 3)
ON CONFLICT DO NOTHING;

-- ============================================
-- ROW-LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomy_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_templates ENABLE ROW LEVEL SECURITY;

-- Organization-level RLS policies
CREATE POLICY "org_isolation" ON organizations FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- Sites: same organization
CREATE POLICY "sites_org_isolation" ON sites FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- Users: same organization
CREATE POLICY "users_org_isolation" ON users FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- Roles: same organization or system roles
CREATE POLICY "roles_org_isolation" ON roles FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid OR is_system_role = true
);

-- User role assignments: through user org
CREATE POLICY "ura_org_isolation" ON user_role_assignments FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- Autonomy modes: same organization
CREATE POLICY "am_org_isolation" ON autonomy_modes FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- Approval policies: same organization
CREATE POLICY "ap_org_isolation" ON approval_policies FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- Decision logs: same organization
CREATE POLICY "dl_org_isolation" ON decision_logs FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- Audit events: same organization (read-only for most)
CREATE POLICY "ae_org_isolation" ON audit_events FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- Deployment templates: same organization
CREATE POLICY "dt_org_isolation" ON deployment_templates FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- ============================================
-- FUNCTION: AUDIT TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION syncai_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_events (
        organization_id,
        user_id,
        event_type,
        event_action,
        resource_type,
        resource_id,
        changes,
        ip_address,
        user_agent
    )
    SELECT 
        COALESCE(
            NEW.organization_id,
            (SELECT organization_id FROM users WHERE id = current_setting('auth.uid', true)::uuid)
        ),
        current_setting('auth.uid', true)::uuid,
        TG_TABLE_NAME,
        TG_OP,
        TG_TABLE_NAME,
        NEW.id,
        CASE WHEN TG_OP = 'DELETE' THEN NULL
        ELSE to_jsonb(NEW)
        END,
        current_setting('request.ip_address', true)::text,
        current_setting('request.user_agent', true)::text;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create audit trigger for key tables
CREATE TRIGGER audit_organizations
    AFTER INSERT OR UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION syncai_audit_trigger();

CREATE TRIGGER audit_sites
    AFTER INSERT OR UPDATE ON sites
    FOR EACH ROW EXECUTE FUNCTION syncai_audit_trigger();

CREATE TRIGGER audit_users
    AFTER INSERT OR UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION syncai_audit_trigger();

-- ============================================
-- FUNCTION: GET USER PERMISSIONS
-- ============================================

CREATE OR REPLACE FUNCTION get_user_permissions(user_id UUID)
RETURNS JSONB AS $$
DECLARE
    perms JSONB := '[]'::jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(DISTINCT p.permissions), '[]'::jsonb)
    INTO perms
    FROM user_role_assignments ura
    JOIN roles r ON r.id = ura.role_id
    WHERE ura.user_id = get_user_permissions.user_id
    AND (ura.expires_at IS NULL OR ura.expires_at > NOW());
    
    RETURN perms;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

SELECT 'SyncAI Core Platform Migration Complete' AS status;
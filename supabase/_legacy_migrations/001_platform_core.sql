-- SyncAI MVP - Platform Core Migration
-- Organizations, Sites, Departments, User Profiles (uses Supabase Auth)

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- A. PLATFORM DOMAIN
-- ============================================

-- Organizations (tenant root)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    industry TEXT,
    timezone TEXT DEFAULT 'America/Edmonton',
    status TEXT DEFAULT 'active',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sites (physical operating locations)
CREATE TABLE sites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    code TEXT,
    region TEXT,
    timezone TEXT,
    status TEXT DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Departments (optional in MVP)
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Roles (canonical role library)
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    level TEXT,
    description TEXT,
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, code)
);

-- Permissions (action-level control)
CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    module TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Role Permissions (junction)
CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE NOT NULL,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(role_id, permission_id)
);

-- User Profiles (links to Supabase Auth)
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY, -- references auth.users.id
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    default_site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    full_name TEXT,
    email TEXT NOT NULL,
    title TEXT,
    status TEXT DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id)
);

-- User Role Assignments
CREATE TABLE user_role_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenant Settings (org-level configuration)
CREATE TABLE tenant_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE UNIQUE NOT NULL,
    autonomy_mode_default TEXT DEFAULT 'advisory',
    audit_retention_years INTEGER DEFAULT 7,
    oee_enabled BOOLEAN DEFAULT true,
    governance_enabled BOOLEAN DEFAULT true,
    risk_matrix JSONB DEFAULT '{"probability": ["very_low","low","medium","high","very_high"], "consequence": ["very_low","low","medium","high","very_high"]}',
    branding JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_sites_organization ON sites(organization_id);
CREATE INDEX idx_departments_organization ON departments(organization_id);
CREATE INDEX idx_departments_site ON departments(site_id);
CREATE INDEX idx_roles_organization ON roles(organization_id);
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX idx_user_profiles_organization ON user_profiles(organization_id);
CREATE INDEX idx_user_role_assignments_user ON user_role_assignments(user_id);
CREATE INDEX idx_user_role_assignments_role ON user_role_assignments(role_id);
CREATE INDEX idx_user_role_assignments_org ON user_role_assignments(organization_id);
CREATE INDEX idx_tenant_settings_org ON tenant_settings(organization_id);

-- ============================================
-- SEED DATA: ROLES
-- ============================================

INSERT INTO roles (id, code, name, level, description, is_system) VALUES
    ('00000000-0000-0000-0000-000000000001', 'board', '1', 'Board of Directors', false),
    ('00000000-0000-0000-0000-000000000002', 'ceo', '2', 'Chief Executive Officer', false),
    ('00000000-0000-0000-0000-000000000003', 'coo', '3', 'Chief Operating Officer', false),
    ('00000000-0000-0000-0000-000000000004', 'cfo', '3', 'Chief Financial Officer', false),
    ('00000000-0000-0000-0000-000000000005', 'vp_operations', '4', 'VP Operations', false),
    ('00000000-0000-0000-0000-000000000006', 'maintenance_manager', '5', 'Maintenance Manager', false),
    ('00000000-0000-0000-0000-000000000007', 'plant_manager', '5', 'Plant Manager', false),
    ('00000000-0000-0000-0000-000000000008', 'reliability_engineer', '6', 'Reliability Engineer', false),
    ('00000000-0000-0000-0000-000000000009', 'supervisor', '7', 'Supervisor', false),
    ('00000000-0000-0000-0000-000000000010', 'technician', '8', 'Technician', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- SEED DATA: PERMISSIONS
-- ============================================

INSERT INTO permissions (code, name, description, module) VALUES
    -- Organization
    ('org.read', 'Read Organization', 'View org settings', 'platform'),
    ('org.write', 'Write Organization', 'Edit org settings', 'platform'),
    -- Sites
    ('site.read', 'Read Sites', 'View sites', 'platform'),
    ('site.write', 'Write Sites', 'Create/edit sites', 'platform'),
    -- Users
    ('user.read', 'Read Users', 'View user profiles', 'platform'),
    ('user.write', 'Write Users', 'Create/edit users', 'platform'),
    ('user.assign_roles', 'Assign Roles', 'Assign roles to users', 'platform'),
    -- Assets
    ('asset.read', 'Read Assets', 'View asset register', 'assets'),
    ('asset.write', 'Write Assets', 'Create/edit assets', 'assets'),
    ('asset.criticality', 'Manage Criticality', 'Update criticality profiles', 'assets'),
    -- Performance
    ('kpi.read', 'Read KPIs', 'View KPI data', 'performance'),
    ('kpi.write', 'Write KPIs', 'Define KPIs', 'performance'),
    ('oee.read', 'Read OEE', 'View OEE data', 'performance'),
    ('oee.write', 'Write OEE', 'Record OEE', 'performance'),
    -- Work
    ('work.read', 'Read Work', 'View work orders', 'work'),
    ('work.write', 'Write Work', 'Create work orders', 'work'),
    ('work.approve', 'Approve Work', 'Approve work', 'work'),
    ('work.close', 'Close Work', 'Closeout work', 'work'),
    -- Governance
    ('governance.read', 'Read Governance', 'View governance', 'governance'),
    ('governance.write', 'Write Governance', 'Configure governance', 'governance'),
    ('audit.read', 'Read Audit', 'View audit logs', 'governance'),
    ('approve.execute', 'Execute Approvals', 'Make approvals', 'governance'),
    ('override.execute', 'Execute Overrides', 'Override decisions', 'governance'),
    -- Integrations
    ('integration.read', 'Read Integrations', 'View connectors', 'integrations'),
    ('integration.write', 'Write Integrations', 'Configure connectors', 'integrations'),
    -- Intelligence
    ('intelligence.read', 'Read Intelligence', 'View recommendations', 'intelligence'),
    ('intelligence.write', 'Write Intelligence', 'Configure AI', 'intelligence'),
    -- Control Plane
    ('deployment.read', 'Read Deployments', 'View deployments', 'control_plane'),
    ('deployment.write', 'Write Deployments', 'Manage deployments', 'control_plane')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- SEED DATA: AUTONOMY MODES
-- ============================================

INSERT INTO roles (id, code, name, description, is_system) VALUES
    ('11111111-1111-1111-1111-111111111111', 'advisory', 'Advisory', 'AI provides recommendations, human decides', true),
    ('11111111-1111-1111-1111-111111111112', 'conditional', 'Conditional', 'AI acts if confidence high, otherwise escalates', true),
    ('11111111-1111-1111-1111-111111111113', 'controlled_autonomy', 'Controlled', 'AI executes within bounds, monitors closely', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;

-- Helper functions
CREATE OR REPLACE FUNCTION current_user_org_id() RETURNS UUID AS $$
    SELECT organization_id FROM user_profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_user_site_ids() RETURNS UUID[] AS $$
    SELECT ARRAY_AGG(site_id) FROM user_role_assignments 
    WHERE user_id = auth.uid() AND site_id IS NOT NULL;
$$ LANGUAGE SQL SECURITY DEFINER;

CREATE OR REPLACE FUNCTION user_has_permission(perm_code TEXT) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_role_assignments ura
        JOIN role_permissions rp ON rp.role_id = ura.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE ura.user_id = auth.uid()
        AND p.code = user_has_permission.perm_code
    );
$$ LANGUAGE SQL SECURITY DEFINER;

CREATE OR REPLACE FUNCTION user_has_role(role_code TEXT) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON r.id = ura.role_id
        WHERE ura.user_id = auth.uid()
        AND r.code = user_has_role.role_code
    );
$$ LANGUAGE SQL SECURITY DEFINER;

-- Organizations: everyone in org can read
CREATE POLICY "orgs_select" ON organizations FOR SELECT USING (id = current_user_org_id());

-- Sites: org isolation
CREATE POLICY "sites_select" ON sites FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "sites_insert" ON sites FOR INSERT WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "sites_update" ON sites FOR UPDATE USING (organization_id = current_user_org_id());

-- Departments: org isolation
CREATE POLICY "depts_select" ON departments FOR SELECT USING (organization_id = current_user_org_id());

-- Roles: org or system
CREATE POLICY "roles_select" ON roles FOR SELECT USING (organization_id = current_user_org_id() OR organization_id IS NULL);

-- Permissions: readable by all
CREATE POLICY "perms_select" ON permissions FOR SELECT USING (true);

-- Role permissions: managed by admins
CREATE POLICY "role_perms_select" ON role_permissions FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id WHERE ura.user_id = auth.uid() AND r.code IN ('admin', 'maintenance_manager'))
);

-- User profiles: org isolation
CREATE POLICY "user_profiles_select" ON user_profiles FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "user_profiles_insert" ON user_profiles FOR INSERT WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "user_profiles_update" ON user_profiles FOR UPDATE USING (organization_id = current_user_org_id());

-- User role assignments: org isolation
CREATE POLICY "ura_select" ON user_role_assignments FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "ura_insert" ON user_role_assignments FOR INSERT WITH CHECK (organization_id = current_user_org_id());

-- Tenant settings: org isolation
CREATE POLICY "ts_select" ON tenant_settings FOR SELECT USING (organization_id = current_user_org_id());

SELECT 'Platform Core Migration Complete' AS status;
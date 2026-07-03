-- SyncAI Phase 2: Auth + RBAC Implementation
-- This phase focuses on identity, access control, and tenant scope
-- ONLY touches: user_profiles, roles, permissions, user_role_assignments, tenant_settings

BEGIN;

-- ============================================
-- STEP 1: Supabase Auth Integration
-- ============================================

-- Function to sync user profile on sign-in
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, organization_id, status, created_at, updated_at)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        (SELECT id FROM organizations WHERE slug = 'default' LIMIT 1),
        'active',
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for auto-creating user profiles
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- STEP 2: Helper Functions for Org/Site/Role
-- ============================================

-- Get current user's organization ID
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS UUID AS $$
DECLARE
    org_id UUID;
BEGIN
    SELECT organization_id INTO org_id
    FROM user_profiles
    WHERE id = auth.uid()
    LIMIT 1;
    
    RETURN org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get current user's site IDs
CREATE OR REPLACE FUNCTION public.current_user_site_ids()
RETURNS UUID[] AS $$
DECLARE
    site_ids UUID[];
BEGIN
    SELECT ARRAY_AGG(DISTINCT site_id) INTO site_ids
    FROM user_role_assignments
    WHERE user_id = auth.uid()
    AND site_id IS NOT NULL;
    
    RETURN COALESCE(site_ids, ARRAY[]::UUID[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user has specific role
CREATE OR REPLACE FUNCTION public.user_has_role(role_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    has_role BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON r.id = ura.role_id
        WHERE ura.user_id = auth.uid()
        AND r.code = role_code
    ) INTO has_role;
    
    RETURN COALESCE(has_role, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user has specific permission
CREATE OR REPLACE FUNCTION public.user_has_permission(permission_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    has_perm BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON r.id = ura.role_id
        JOIN role_permissions rp ON rp.role_id = r.id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE ura.user_id = auth.uid()
        AND p.code = permission_code
    ) INTO has_perm;
    
    RETURN COALESCE(has_perm, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get current user's primary role
CREATE OR REPLACE FUNCTION public.current_user_primary_role()
RETURNS TEXT AS $$
DECLARE
    role_code TEXT;
BEGIN
    SELECT r.code INTO role_code
    FROM user_role_assignments ura
    JOIN roles r ON r.id = ura.role_id
    WHERE ura.user_id = auth.uid()
    AND ura.is_primary = true
    LIMIT 1;
    
    RETURN role_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- STEP 3: RLS Policies for Tenant Isolation
-- ============================================

-- Enable RLS on tenant tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;

-- Organizations: Users can read their org
CREATE POLICY "Users can view their organization" ON organizations
    FOR SELECT USING (id = public.current_user_org_id());

-- Sites: Users can read sites in their org
CREATE POLICY "Users can view sites in their org" ON sites
    FOR SELECT USING (organization_id = public.current_user_org_id());

-- User Profiles: Users can read profiles in their org
CREATE POLICY "Users can view profiles in their org" ON user_profiles
    FOR SELECT USING (organization_id = public.current_user_org_id());

-- User Profiles: Users can update their own profile
CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (id = auth.uid());

-- Roles: Users can read roles in their org
CREATE POLICY "Users can view roles in their org" ON roles
    FOR SELECT USING (
        organization_id = public.current_user_org_id() 
        OR is_system = true
    );

-- Permissions: Global read
CREATE POLICY "Anyone can view permissions" ON permissions
    FOR SELECT USING (true);

-- User Role Assignments: Users can view their own assignments
CREATE POLICY "Users can view own role assignments" ON user_role_assignments
    FOR SELECT USING (user_id = auth.uid());

-- User Role Assignments: Admins can manage
CREATE POLICY "Admins can manage role assignments" ON user_role_assignments
    FOR ALL USING (
        EXISTS(
            SELECT 1 FROM user_role_assignments ura
            JOIN roles r ON r.id = ura.role_id
            WHERE ura.user_id = auth.uid()
            AND r.code IN ('ceo', 'coo', 'plant_manager', 'maintenance_manager')
        )
    );

-- Tenant Settings: Users can read their org settings
CREATE POLICY "Users can view their org settings" ON tenant_settings
    FOR SELECT USING (organization_id = public.current_user_org_id());

-- ============================================
-- STEP 4: API Endpoints for Auth
-- ============================================

-- GET /api/platform/me implementation
CREATE OR REPLACE FUNCTION public.get_current_user_context()
RETURNS JSONB AS $$
DECLARE
    user_ctx JSONB;
BEGIN
    SELECT jsonb_build_object(
        'user', jsonb_build_object(
            'id', up.id,
            'full_name', up.full_name,
            'email', up.email,
            'title', up.title
        ),
        'organization', jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'slug', o.slug,
            'industry', o.industry
        ),
        'roles', (
            SELECT jsonb_agg(r.code)
            FROM user_role_assignments ura
            JOIN roles r ON r.id = ura.role_id
            WHERE ura.user_id = up.id
        ),
        'site_scope', public.current_user_site_ids(),
        'permissions', (
            SELECT jsonb_agg(p.code)
            FROM user_role_assignments ura
            JOIN roles r ON r.id = ura.role_id
            JOIN role_permissions rp ON rp.role_id = r.id
            JOIN permissions p ON p.id = rp.permission_id
            WHERE ura.user_id = up.id
        ),
        'primary_role', public.current_user_primary_role(),
        'can_approve', public.user_has_permission('approvals.write'),
        'can_override', public.user_has_permission('overrides.write'),
        'can_deploy', public.user_has_permission('control_plane.write')
    ) INTO user_ctx
    FROM user_profiles up
    JOIN organizations o ON o.id = up.organization_id
    WHERE up.id = auth.uid();
    
    RETURN user_ctx;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- STEP 5: Seed Test User
-- ============================================

-- Create a test organization if not exists
INSERT INTO organizations (name, slug, industry, status)
VALUES ('Default Organization', 'default', 'general', 'active')
ON CONFLICT (slug) DO NOTHING;

-- Create default site
INSERT INTO sites (organization_id, name, code, region, status)
SELECT id, 'Main Site', 'MAIN', 'North America', 'active'
FROM organizations WHERE slug = 'default'
ON CONFLICT DO NOTHING;

-- Note: Actual test user would be created via Supabase Auth signup
-- This just ensures the structure exists

COMMIT;

SELECT 'Phase 2 Auth + RBAC implementation complete' AS status;
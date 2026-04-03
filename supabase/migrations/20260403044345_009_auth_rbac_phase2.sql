/*
  # Phase 2: Auth + RBAC Implementation

  1. Supabase Auth Integration
    - Auto-create user profiles on signup
    - Sync user data from auth.users to user_profiles

  2. Helper Functions
    - `current_user_org_id()` - Get user's organization
    - `current_user_site_ids()` - Get user's accessible sites
    - `user_has_role(code)` - Check role membership
    - `user_has_permission(code)` - Check permissions
    - `current_user_primary_role()` - Get primary role
    - `get_current_user_context()` - Complete user context API

  3. RLS Policies
    - Tenant isolation on all core tables
    - Org-scoped access control
    - Role-based permissions

  4. Seed Data
    - Default organization
    - Default site
*/

-- Auth Integration Trigger
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helper Functions
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

-- RLS Policies
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their organization" ON organizations
    FOR SELECT USING (id = public.current_user_org_id());

CREATE POLICY "Users can view sites in their org" ON sites
    FOR SELECT USING (organization_id = public.current_user_org_id());

CREATE POLICY "Users can view profiles in their org" ON user_profiles
    FOR SELECT USING (organization_id = public.current_user_org_id());

CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Users can view roles in their org" ON roles
    FOR SELECT USING (
        organization_id = public.current_user_org_id() 
        OR is_system = true
    );

CREATE POLICY "Anyone can view permissions" ON permissions
    FOR SELECT USING (true);

CREATE POLICY "Users can view own role assignments" ON user_role_assignments
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can manage role assignments" ON user_role_assignments
    FOR ALL USING (
        EXISTS(
            SELECT 1 FROM user_role_assignments ura
            JOIN roles r ON r.id = ura.role_id
            WHERE ura.user_id = auth.uid()
            AND r.code IN ('ceo', 'coo', 'plant_manager', 'maintenance_manager')
        )
    );

CREATE POLICY "Users can view their org settings" ON tenant_settings
    FOR SELECT USING (organization_id = public.current_user_org_id());

-- Seed Data
INSERT INTO organizations (name, slug, industry, status)
VALUES ('Default Organization', 'default', 'general', 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO sites (organization_id, name, code, region, status)
SELECT id, 'Main Site', 'MAIN', 'North America', 'active'
FROM organizations WHERE slug = 'default'
ON CONFLICT DO NOTHING;
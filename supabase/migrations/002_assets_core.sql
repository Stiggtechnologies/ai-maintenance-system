-- SyncAI MVP - Assets Core Migration
-- Asset Classes, Locations, Assets, Hierarchy, Criticality, Documents

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- B. ASSETS DOMAIN
-- ============================================

-- Asset Classes (taxonomy)
CREATE TABLE asset_classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_class_id UUID REFERENCES asset_classes(id) ON DELETE SET NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, code)
);

-- Asset Locations
CREATE TABLE asset_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    parent_location_id UUID REFERENCES asset_locations(id) ON DELETE SET NULL,
    code TEXT,
    name TEXT NOT NULL,
    type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Assets (core register)
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_class_id UUID REFERENCES asset_classes(id) ON DELETE SET NULL,
    location_id UUID REFERENCES asset_locations(id) ON DELETE SET NULL,
    asset_tag TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    manufacturer TEXT,
    model TEXT,
    serial_number TEXT,
    install_date DATE,
    status TEXT DEFAULT 'active',
    lifecycle_state TEXT DEFAULT 'operating',
    criticality_level TEXT DEFAULT 'medium',
    replacement_value NUMERIC,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, asset_tag)
);

-- Asset Hierarchy (parent-child relationships)
CREATE TABLE asset_hierarchy (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    parent_asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    child_asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    relationship_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(parent_asset_id, child_asset_id)
);

-- Asset Criticality Profiles
CREATE TABLE asset_criticality_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE UNIQUE NOT NULL,
    safety_score NUMERIC DEFAULT 0,
    environmental_score NUMERIC DEFAULT 0,
    production_score NUMERIC DEFAULT 0,
    quality_score NUMERIC DEFAULT 0,
    cost_score NUMERIC DEFAULT 0,
    regulatory_score NUMERIC DEFAULT 0,
    reputation_score NUMERIC DEFAULT 0,
    total_criticality_score NUMERIC DEFAULT 0,
    criticality_band TEXT,
    methodology_version TEXT DEFAULT '1.0',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asset Documents
CREATE TABLE asset_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    document_name TEXT NOT NULL,
    document_type TEXT,
    storage_path TEXT,
    version TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_asset_classes_org ON asset_classes(organization_id);
CREATE INDEX idx_asset_classes_parent ON asset_classes(parent_class_id);
CREATE INDEX idx_asset_locations_org ON asset_locations(organization_id);
CREATE INDEX idx_asset_locations_site ON asset_locations(site_id);
CREATE INDEX idx_asset_locations_parent ON asset_locations(parent_location_id);
CREATE INDEX idx_assets_org ON assets(organization_id);
CREATE INDEX idx_assets_site ON assets(site_id);
CREATE INDEX idx_assets_class ON assets(asset_class_id);
CREATE INDEX idx_assets_location ON assets(location_id);
CREATE INDEX idx_assets_tag ON assets(asset_tag);
CREATE INDEX idx_asset_hierarchy_parent ON asset_hierarchy(parent_asset_id);
CREATE INDEX idx_asset_hierarchy_child ON asset_hierarchy(child_asset_id);
CREATE INDEX idx_asset_criticality_asset ON asset_criticality_profiles(asset_id);
CREATE INDEX idx_asset_documents_asset ON asset_documents(asset_id);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE asset_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_hierarchy ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_criticality_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ac_select" ON asset_classes FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "al_select" ON asset_locations FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "assets_select" ON assets FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "assets_insert" ON assets FOR INSERT WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "assets_update" ON assets FOR UPDATE USING (organization_id = current_user_org_id());
CREATE POLICY "ah_select" ON asset_hierarchy FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "acp_select" ON asset_criticality_profiles FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "ad_select" ON asset_documents FOR SELECT USING (organization_id = current_user_org_id());

SELECT 'Assets Core Migration Complete' AS status;
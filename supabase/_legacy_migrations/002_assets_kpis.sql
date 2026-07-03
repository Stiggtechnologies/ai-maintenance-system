-- SyncAI Assets and Performance Migration
-- Workstream 2: Assets, KPIs, OEE

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ASSET DOMAIN
-- ============================================

-- Asset Classes (taxonomy)
CREATE TABLE asset_classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    parent_id UUID REFERENCES asset_classes(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    code TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Assets
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_class_id UUID REFERENCES asset_classes(id) ON DELETE SET NULL,
    parent_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    serial_number TEXT,
    model TEXT,
    manufacturer TEXT,
    install_date DATE,
    warranty_expiry DATE,
    criticality_level INTEGER DEFAULT 3, -- 1=Critical, 2=High, 3=Medium, 4=Low
    lifecycle_state TEXT DEFAULT 'operating',
    health_score NUMERIC DEFAULT 100,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asset Locations
CREATE TABLE asset_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    parent_location_id UUID REFERENCES asset_locations(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    location_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asset Health Profiles
CREATE TABLE asset_health_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    health_score NUMERIC DEFAULT 100,
    last_inspection TIMESTAMPTZ,
    next_inspection TIMESTAMPTZ,
    condition_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asset Relationships (for digital twin)
CREATE TABLE asset_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    related_asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    relationship_type TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- KPI / PERFORMANCE DOMAIN
-- ============================================

-- KPI Definitions
CREATE TABLE kpi_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    unit TEXT,
    category TEXT,
    calculation_formula TEXT,
    target_value NUMERIC,
    threshold_warning NUMERIC,
    threshold_critical NUMERIC,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- KPI Measurements
CREATE TABLE kpi_measurements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    kpi_id UUID REFERENCES kpi_definitions(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    value NUMERIC NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- KPI Targets
CREATE TABLE kpi_targets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    kpi_id UUID REFERENCES kpi_definitions(id) ON DELETE CASCADE NOT NULL,
    target_value NUMERIC NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- KPI Owners
CREATE TABLE kpi_owners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kpi_id UUID REFERENCES kpi_definitions(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    assigned_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- OEE DOMAIN
-- ============================================

-- Production Lines
CREATE TABLE production_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    capacity_rate NUMERIC,
    shift_hours NUMERIC DEFAULT 24,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Line to Asset Mapping
CREATE TABLE line_asset_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    line_id UUID REFERENCES production_lines(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- OEE Measurements
CREATE TABLE oee_measurements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    line_id UUID REFERENCES production_lines(id) ON DELETE SET NULL,
    availability NUMERIC,
    performance NUMERIC,
    quality NUMERIC,
    oee NUMERIC,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- OEE Loss Categories
CREATE TABLE oee_loss_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    category_type TEXT NOT NULL, -- availability, performance, quality
    description TEXT
);

-- OEE Loss Events
CREATE TABLE oee_loss_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    line_id UUID REFERENCES production_lines(id) ON DELETE SET NULL,
    category_id UUID REFERENCES oee_loss_categories(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    duration_minutes INTEGER NOT NULL,
    loss_quantity NUMERIC,
    description TEXT,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_assets_organization ON assets(organization_id);
CREATE INDEX idx_assets_site ON assets(site_id);
CREATE INDEX idx_assets_class ON assets(asset_class_id);
CREATE INDEX idx_assets_location ON assets(asset_id);
CREATE INDEX idx_kpi_measurements_kpi ON kpi_measurements(kpi_id);
CREATE INDEX idx_kpi_measurements_asset ON kpi_measurements(asset_id);
CREATE INDEX idx_kpi_measurements_date ON kpi_measurements(recorded_at);
CREATE INDEX idx_oee_measurements_line ON oee_measurements(line_id);
CREATE INDEX idx_oee_measurements_date ON oee_measurements(recorded_at);

-- ============================================
-- SEED DATA: ASSET CLASSES
-- ============================================

INSERT INTO asset_classes (organization_id, name, code, description) VALUES
    (NULL, 'Rotating Equipment', 'ROT', 'Pumps, motors, compressors'),
    (NULL, 'Electrical', 'ELEC', 'Power distribution, controls'),
    (NULL, 'Instrumentation', 'INST', 'Sensors, gauges, transmitters'),
    (NULL, 'Piping', 'PIPE', 'Pipes, valves, fittings'),
    (NULL, 'Structures', 'STR', 'Buildings, platforms, ladders')
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED DATA: KPI DEFINITIONS
-- ============================================

INSERT INTO kpi_definitions (organization_id, name, description, unit, category) VALUES
    (NULL, 'Overall Equipment Effectiveness', 'Combined availability x performance x quality', '%', 'OEE'),
    (NULL, 'MTBF', 'Mean Time Between Failures', 'hours', 'Reliability'),
    (NULL, 'MTTR', 'Mean Time To Repair', 'hours', 'Reliability'),
    (NULL, 'PM Compliance', 'Preventive Maintenance completion rate', '%', 'Compliance'),
    (NULL, 'Asset Availability', 'Operating time / planned time', '%', 'Availability'),
    (NULL, 'Maintenance Cost per Unit', 'Total maintenance cost / production units', '$', 'Cost')
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED DATA: OEE LOSS CATEGORIES
-- ============================================

INSERT INTO oee_loss_categories (name, category_type, description) VALUES
    ('Equipment Failure', 'availability', 'Unplanned downtime'),
    ('Setup/Adjustment', 'availability', 'Changeover time'),
    ('Idling/Minor Stops', 'performance', 'Small delays'),
    ('Reduced Speed', 'performance', 'Operating below rate'),
    ('Process Defects', 'quality', 'Rework or scrap'),
    ('Startup Losses', 'availability', 'Startup delays')
ON CONFLICT DO NOTHING;

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE asset_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_health_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_asset_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE oee_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE oee_loss_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE oee_loss_events ENABLE ROW LEVEL SECURITY;

-- Asset class policy
CREATE POLICY "ac_org_isolation" ON asset_classes FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- Assets policy
CREATE POLICY "assets_org_isolation" ON assets FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- KPI policies
CREATE POLICY "kpi_def_org_isolation" ON kpi_definitions FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "kpi_meas_org_isolation" ON kpi_measurements FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- OEE policies
CREATE POLICY "oee_meas_org_isolation" ON oee_measurements FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

SELECT 'SyncAI Assets and Performance Migration Complete' AS status;
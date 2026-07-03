-- SyncAI MVP - Performance & OEE Core Migration

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- D. PERFORMANCE DOMAIN
-- ============================================

-- KPI Definitions
CREATE TABLE kpi_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    level TEXT,
    description TEXT,
    formula_text TEXT,
    unit TEXT,
    owner_role_code TEXT,
    source_systems JSONB DEFAULT '[]',
    refresh_frequency TEXT,
    is_oee_component BOOLEAN DEFAULT false,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, code)
);

-- KPI Thresholds
CREATE TABLE kpi_thresholds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    kpi_definition_id UUID REFERENCES kpi_definitions(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    green_min NUMERIC,
    green_max NUMERIC,
    amber_min NUMERIC,
    amber_max NUMERIC,
    red_min NUMERIC,
    red_max NUMERIC,
    threshold_logic TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- KPI Measurements (raw values)
CREATE TABLE kpi_measurements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    kpi_definition_id UUID REFERENCES kpi_definitions(id) ON DELETE CASCADE NOT NULL,
    measurement_time TIMESTAMPTZ NOT NULL,
    value NUMERIC NOT NULL,
    unit TEXT,
    status TEXT,
    source_type TEXT,
    source_ref TEXT,
    dimensions JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- KPI Rollups (summarized)
CREATE TABLE kpi_rollups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    scope_type TEXT,
    scope_id UUID,
    kpi_definition_id UUID REFERENCES kpi_definitions(id) ON DELETE CASCADE NOT NULL,
    period_type TEXT,
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    value NUMERIC,
    status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scorecards
CREATE TABLE scorecards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    role_code TEXT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scorecard Items
CREATE TABLE scorecard_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scorecard_id UUID REFERENCES scorecards(id) ON DELETE CASCADE NOT NULL,
    kpi_definition_id UUID REFERENCES kpi_definitions(id) ON DELETE CASCADE NOT NULL,
    display_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- E. OEE DOMAIN
-- ============================================

-- Production Lines
CREATE TABLE production_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, code)
);

-- Line Asset Mappings
CREATE TABLE line_asset_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    production_line_id UUID REFERENCES production_lines(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    role_in_line TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- OEE Measurements
CREATE TABLE oee_measurements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    production_line_id UUID REFERENCES production_lines(id) ON DELETE SET NULL,
    measurement_time TIMESTAMPTZ NOT NULL,
    availability NUMERIC,
    performance NUMERIC,
    quality NUMERIC,
    oee NUMERIC,
    source_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- OEE Loss Categories
CREATE TABLE oee_loss_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    loss_group TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- OEE Loss Events
CREATE TABLE oee_loss_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    production_line_id UUID REFERENCES production_lines(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    loss_category_id UUID REFERENCES oee_loss_categories(id) ON DELETE SET NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_minutes NUMERIC,
    estimated_impact NUMERIC,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_kpi_definitions_org ON kpi_definitions(organization_id);
CREATE INDEX idx_kpi_thresholds_kpi ON kpi_thresholds(kpi_definition_id);
CREATE INDEX idx_kpi_measurements_kpi ON kpi_measurements(kpi_definition_id);
CREATE INDEX idx_kpi_measurements_asset ON kpi_measurements(asset_id);
CREATE INDEX idx_kpi_measurements_time ON kpi_measurements(measurement_time);
CREATE INDEX idx_kpi_rollups_kpi ON kpi_rollups(kpi_definition_id);
CREATE INDEX idx_kpi_rollups_period ON kpi_rollups(period_type, period_start);
CREATE INDEX idx_scorecard_items_card ON scorecard_items(scorecard_id);

CREATE INDEX idx_production_lines_org ON production_lines(organization_id);
CREATE INDEX idx_production_lines_site ON production_lines(site_id);
CREATE INDEX idx_line_asset_mappings_line ON line_asset_mappings(production_line_id);
CREATE INDEX idx_line_asset_mappings_asset ON line_asset_mappings(asset_id);
CREATE INDEX idx_oee_measurements_line ON oee_measurements(production_line_id);
CREATE INDEX idx_oee_measurements_time ON oee_measurements(measurement_time);
CREATE INDEX idx_oee_loss_events_line ON oee_loss_events(production_line_id);

-- ============================================
-- SEED DATA: KPI DEFINITIONS
-- ============================================

INSERT INTO kpi_definitions (organization_id, code, name, category, level, description, unit) VALUES
    (NULL, 'enterprise_risk_index', 'Enterprise Risk Index', 'Risk', 'enterprise', 'Combined risk across all assets', 'score'),
    (NULL, 'downtime_cost_exposure', 'Downtime Cost Exposure', 'Financial', 'site', 'Annualized downtime cost', '$'),
    (NULL, 'site_oee', 'Site OEE', 'OEE', 'site', 'Overall Equipment Effectiveness', '%'),
    (NULL, 'availability', 'Availability', 'OEE', 'line', 'Equipment availability', '%'),
    (NULL, 'performance', 'Performance Rate', 'OEE', 'line', 'Performance rate', '%'),
    (NULL, 'quality', 'Quality Rate', 'OEE', 'line', 'Quality rate', '%'),
    (NULL, 'mtbf', 'Mean Time Between Failures', 'Reliability', 'asset', 'Average运行时间 between failures', 'hours'),
    (NULL, 'mttr', 'Mean Time To Repair', 'Reliability', 'asset', 'Average repair time', 'hours'),
    (NULL, 'pm_compliance', 'PM Compliance', 'Compliance', 'site', 'PM completion rate', '%'),
    (NULL, 'asset_availability', 'Asset Availability', 'Availability', 'asset', 'Operating time / planned time', '%'),
    (NULL, 'maintenance_cost_per_unit', 'Maintenance Cost per Unit', 'Financial', 'site', 'Total cost / production units', '$'),
    (NULL, 'work_order_completion_rate', 'Work Order Completion Rate', 'Work', 'site', 'Completed / issued', '%'),
    (NULL, 'response_time', 'Response Time', 'Work', 'site', 'Avg time to start work', 'hours'),
    (NULL, 'ai_confidence_score', 'AI Confidence Score', 'Intelligence', 'enterprise', 'Average AI confidence', '%'),
    (NULL, 'governance_compliance_score', 'Governance Compliance', 'Governance', 'enterprise', 'Approval compliance', '%')
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED DATA: OEE LOSS CATEGORIES
-- ============================================

INSERT INTO oee_loss_categories (code, name, loss_group) VALUES
    ('equipment_failure', 'Equipment Failure', 'availability'),
    ('setup_adjustment', 'Setup/Adjustment', 'availability'),
    ('waiting_starvation', 'Waiting/Starvation', 'availability'),
    ('minor_stop', 'Minor Stops', 'performance'),
    ('reduced_speed', 'Reduced Speed', 'performance'),
    ('startup_reject', 'Startup Rejects', 'quality'),
    ('production_reject', 'Production Rejects', 'quality')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE kpi_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecard_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_asset_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE oee_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE oee_loss_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE oee_loss_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kpi_def_select" ON kpi_definitions FOR SELECT USING (organization_id = current_user_org_id() OR organization_id IS NULL);
CREATE POLICY "kpi_thresh_select" ON kpi_thresholds FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "kpi_meas_select" ON kpi_measurements FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "kpi_rollups_select" ON kpi_rollups FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "scorecards_select" ON scorecards FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "scorecard_items_select" ON scorecard_items FOR SELECT USING (
    organization_id = current_user_org_id()
);

CREATE POLICY "prod_lines_select" ON production_lines FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "line_assets_select" ON line_asset_mappings FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "oee_meas_select" ON oee_measurements FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "oee_loss_cats_select" ON oee_loss_categories FOR SELECT USING (true);
CREATE POLICY "oee_loss_events_select" ON oee_loss_events FOR SELECT USING (organization_id = current_user_org_id());

-- Helper view: current_kpi_status
CREATE OR REPLACE VIEW latest_kpi_status_view AS
SELECT 
    km.organization_id,
    km.site_id,
    kd.code AS kpi_code,
    kd.name AS kpi_name,
    km.value,
    km.unit,
    km.measurement_time,
    kt.green_min,
    kt.amber_min,
    CASE 
        WHEN km.value >= COALESCE(kt.green_min, -999) THEN 'green'
        WHEN km.value >= COALESCE(kt.amber_min, -999) THEN 'amber'
        ELSE 'red'
    END AS status
FROM kpi_measurements km
JOIN kpi_definitions kd ON kd.id = km.kpi_definition_id
LEFT JOIN kpi_thresholds kt ON kt.kpi_definition_id = kd.id
WHERE km.measurement_time = (
    SELECT MAX(measurement_time) 
    FROM kpi_measurements 
    WHERE kpi_definition_id = km.kpi_definition_id
    AND organization_id = km.organization_id
);

SELECT 'Performance & OEE Core Migration Complete' AS status;
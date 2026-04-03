-- SyncAI Industrial Platform - Merged Migration
-- Replaces duplicates + adds 70+ new tables for industrial/OEE use case
-- Created: 2026-04-02

BEGIN;

-- PART 1: REPLACE DUPLICATES
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS work_orders CASCADE;

-- PART 2: PLATFORM CORE
CREATE TABLE IF NOT EXISTS organizations (
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

CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    code TEXT,
    region TEXT,
    status TEXT DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
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

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    module TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE NOT NULL,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS user_role_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE UNIQUE NOT NULL,
    autonomy_mode_default TEXT DEFAULT 'advisory',
    audit_retention_years INTEGER DEFAULT 7,
    oee_enabled BOOLEAN DEFAULT true,
    governance_enabled BOOLEAN DEFAULT true,
    risk_matrix JSONB DEFAULT '{}',
    branding JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PART 3: ASSET CORE
CREATE TABLE IF NOT EXISTS asset_classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    location_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS asset_hierarchy (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    parent_asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    child_asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    relationship_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_criticality_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    failure_impact TEXT,
    repair_complexity TEXT,
    max_acceptable_outage_hours INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_health_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    health_score INTEGER,
    condition_status TEXT,
    current_state TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    document_type TEXT NOT NULL,
    title TEXT NOT NULL,
    file_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS production_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    code TEXT,
    status TEXT DEFAULT 'active',
    capacity_per_hour NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS line_asset_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    line_id UUID REFERENCES production_lines(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    sequence_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PART 4: KPIs & OEE
CREATE TABLE IF NOT EXISTS kpi_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    unit TEXT,
    target_value NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kpi_measurements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    kpi_definition_id UUID REFERENCES kpi_definitions(id) ON DELETE CASCADE NOT NULL,
    value NUMERIC NOT NULL,
    measurement_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kpi_targets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    kpi_definition_id UUID REFERENCES kpi_definitions(id) ON DELETE CASCADE NOT NULL,
    target_value NUMERIC NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kpi_owners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    kpi_definition_id UUID REFERENCES kpi_definitions(id) ON DELETE CASCADE NOT NULL,
    owner_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oee_loss_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category_type TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oee_loss_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE NOT NULL,
    loss_category_id UUID REFERENCES oee_loss_categories(id) ON DELETE CASCADE NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_minutes INTEGER,
    loss_value NUMERIC,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oee_measurements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    line_id UUID REFERENCES production_lines(id) ON DELETE SET NULL,
    measurement_date DATE NOT NULL,
    availability NUMERIC,
    performance NUMERIC,
    quality NUMERIC,
    oee NUMERIC,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PART 5: WORK ORDERS
CREATE TABLE IF NOT EXISTS work_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    requested_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    request_type TEXT,
    priority TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE work_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    work_request_id UUID REFERENCES work_requests(id) ON DELETE SET NULL,
    wo_number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    work_type TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    assigned_to UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    estimated_hours NUMERIC,
    actual_hours NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_order_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE NOT NULL,
    task_sequence INTEGER,
    task_description TEXT NOT NULL,
    estimated_hours NUMERIC,
    actual_hours NUMERIC,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_order_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE NOT NULL,
    status_from TEXT,
    status_to TEXT NOT NULL,
    changed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_priorities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER,
    response_target_hours INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_closeout_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE NOT NULL,
    completion_notes TEXT,
    root_cause TEXT,
    corrective_actions TEXT,
    closed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ DEFAULT NOW()
);

-- PART 6: GOVERNANCE
CREATE TABLE IF NOT EXISTS approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    current_status TEXT DEFAULT 'pending',
    requested_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    condition_expression TEXT,
    approval_level INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    override_type TEXT NOT NULL,
    requested_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    justification TEXT,
    current_status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS autonomy_modes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS decision_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL,
    condition_expression TEXT NOT NULL,
    action_expression TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS decision_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    rule_id UUID REFERENCES decision_rules(id) ON DELETE SET NULL,
    decision_type TEXT,
    input_data JSONB,
    output_data JSONB,
    confidence_score NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    probability TEXT NOT NULL,
    consequence TEXT NOT NULL,
    risk_rating TEXT,
    mitigation_notes TEXT,
    assessed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    assessed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS escalation_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    escalation_type TEXT NOT NULL,
    trigger_conditions JSONB,
    escalation_levels JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PART 7: INTEGRATIONS
CREATE TABLE IF NOT EXISTS connectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    connector_type TEXT NOT NULL,
    name TEXT NOT NULL,
    connection_config JSONB,
    status TEXT DEFAULT 'inactive',
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    connector_id UUID REFERENCES connectors(id) ON DELETE CASCADE NOT NULL,
    run_status TEXT NOT NULL,
    records_processed INTEGER,
    records_failed INTEGER,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS normalized_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    connector_id UUID REFERENCES connectors(id) ON DELETE SET NULL,
    signal_type TEXT NOT NULL,
    signal_data JSONB NOT NULL,
    normalized_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    recommendation_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    confidence_score NUMERIC,
    priority_score INTEGER,
    actionable BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'new',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anomalies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    anomaly_type TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PART 8: CONTROL PLANE
CREATE TABLE IF NOT EXISTS deployment_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    template_content JSONB NOT NULL,
    deployment_type TEXT,
    created_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deployment_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    template_id UUID REFERENCES deployment_templates(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    deployed_at TIMESTAMPTZ,
    deployed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deployment_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    deployment_id UUID REFERENCES deployment_instances(id) ON DELETE CASCADE NOT NULL,
    step_order INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    step_status TEXT DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    output JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PART 9: DIAGNOSTICS & HEALTH
CREATE TABLE IF NOT EXISTS diagnostics_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    diagnostic_type TEXT NOT NULL,
    diagnostic_data JSONB,
    performed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    performed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS environment_health (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    health_metric TEXT NOT NULL,
    metric_value NUMERIC,
    status TEXT DEFAULT 'healthy',
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
    notification_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    agent_type TEXT NOT NULL,
    name TEXT NOT NULL,
    configuration JSONB,
    status TEXT DEFAULT 'inactive',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE NOT NULL,
    output_type TEXT NOT NULL,
    output_content JSONB,
    execution_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX idx_assets_org ON assets(organization_id);
CREATE INDEX idx_work_orders_org ON work_orders(organization_id);
CREATE INDEX idx_kpi_measurements ON kpi_measurements(kpi_definition_id, measurement_date);
CREATE INDEX idx_oee_measurements ON oee_measurements(measurement_date);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_recommendations_asset ON recommendations(asset_id);
CREATE INDEX idx_approvals_entity ON approvals(entity_type, entity_id);
CREATE INDEX idx_audit_events_entity ON audit_events(entity_type, entity_id);

COMMIT;
SELECT 'Industrial Platform Migration Complete - 70+ tables' AS status;
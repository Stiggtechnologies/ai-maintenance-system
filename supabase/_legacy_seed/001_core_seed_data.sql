-- Seed Data for SyncAI MVP
-- Run this AFTER 008_industrial_platform_merged.sql

BEGIN;

-- ============================================
-- ROLES (MVP Core Roles)
-- ============================================

INSERT INTO roles (organization_id, code, name, level, description, is_system) VALUES 
(NULL, 'board', 'Board of Directors', 'executive', 'Strategic governance and oversight', true),
(NULL, 'ceo', 'Chief Executive Officer', 'executive', 'Overall organizational leadership', true),
(NULL, 'coo', 'Chief Operating Officer', 'executive', 'Operational management', true),
(NULL, 'cfo', 'Chief Financial Officer', 'executive', 'Financial strategy and control', true),
(NULL, 'vp_operations', 'VP Operations', 'executive', 'Operations leadership', true),
(NULL, 'vp_maintenance', 'VP Maintenance', 'executive', 'Maintenance strategy', true),
(NULL, 'plant_manager', 'Plant Manager', 'site', 'Site-level P&L and operations', true),
(NULL, 'maintenance_manager', 'Maintenance Manager', 'site', 'Maintenance operations', true),
(NULL, 'operations_manager', 'Operations Manager', 'site', 'Production operations', true),
(NULL, 'reliability_engineer', 'Reliability Engineer', 'engineering', 'Asset reliability and strategy', true),
(NULL, 'maintenance_planner', 'Maintenance Planner', 'planning', 'Work planning and scheduling', true),
(NULL, 'maintenance_supervisor', 'Maintenance Supervisor', 'supervision', 'Field supervision', true),
(NULL, 'shift_supervisor', 'Shift Supervisor', 'supervision', 'Shift operations', true),
(NULL, 'technician', 'Technician', 'field', 'Maintenance execution', true),
(NULL, 'operator', 'Operator', 'field', 'Production operations', true)
ON CONFLICT (organization_id, code) DO NOTHING;

-- ============================================
-- PERMISSIONS (MVP Core Permissions)
-- ============================================

INSERT INTO permissions (code, name, description, module) VALUES
-- Platform
('platform.read', 'Read platform data', 'View org/site info', 'platform'),
('platform.write', 'Manage platform data', 'Create/update org settings', 'platform'),
('users.read', 'Read users', 'View user directory', 'platform'),
('users.write', 'Manage users', 'Add/remove users', 'platform'),
-- Assets
('assets.read', 'Read assets', 'View asset register', 'assets'),
('assets.write', 'Manage assets', 'Create/update assets', 'assets'),
('assets.criticality.write', 'Manage criticality', 'Update criticality profiles', 'assets'),
-- Performance
('performance.read', 'Read KPIs', 'View KPI dashboards', 'performance'),
('performance.write', 'Manage KPIs', 'Create/update KPIs', 'performance'),
('oee.read', 'Read OEE', 'View OEE data', 'performance'),
('oee.write', 'Manage OEE', 'Configure OEE', 'performance'),
-- Governance
('governance.read', 'Read governance', 'View policies', 'governance'),
('governance.write', 'Manage governance', 'Create policies', 'governance'),
('approvals.read', 'Read approvals', 'View pending approvals', 'governance'),
('approvals.write', 'Approve/Reject', 'Approve or reject', 'governance'),
('overrides.write', 'Apply overrides', 'Override governance', 'governance'),
('audit.read', 'Read audit logs', 'View audit trail', 'governance'),
-- Work
('work.read', 'Read work orders', 'View work management', 'work'),
('work.write', 'Manage work orders', 'Create/update WOs', 'work'),
('work.execute', 'Execute work', 'Start/complete WOs', 'work'),
('work.close', 'Close work orders', 'Close and closeout WOs', 'work'),
-- Integrations
('integrations.read', 'Read integrations', 'View connector status', 'integrations'),
('integrations.write', 'Manage integrations', 'Configure connectors', 'integrations'),
-- Intelligence
('intelligence.read', 'Read recommendations', 'View AI recommendations', 'intelligence'),
('intelligence.accept', 'Accept recommendations', 'Accept AI suggestions', 'intelligence'),
-- Control Plane
('control_plane.read', 'Read control plane', 'View deployments', 'control_plane'),
('control_plane.write', 'Manage deployments', 'Deploy templates', 'control_plane')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- KPI DEFINITIONS (MVP Core KPIs)
-- ============================================

INSERT INTO kpi_definitions (organization_id, code, name, category, level, description, unit, owner_role_code, refresh_frequency, is_oee_component) VALUES 
(NULL, 'enterprise_risk_index', 'Enterprise Risk Index', 'strategic', 'executive', 'Aggregated risk across all assets', 'score', 'ceo', 'daily', false),
(NULL, 'downtime_cost_exposure', 'Downtime Cost Exposure', 'operational', 'site', 'Estimated cost of downtime', 'currency', 'plant_manager', 'daily', false),
(NULL, 'site_oee', 'Site OEE', 'operational', 'site', 'Overall Equipment Effectiveness', 'percent', 'plant_manager', 'hourly', true),
(NULL, 'availability', 'Availability', 'operational', 'site', 'Equipment availability', 'percent', 'maintenance_manager', 'hourly', true),
(NULL, 'performance', 'Performance', 'operational', 'site', 'Performance rate', 'percent', 'maintenance_manager', 'hourly', true),
(NULL, 'quality', 'Quality', 'operational', 'site', 'Quality rate', 'percent', 'operations_manager', 'hourly', true),
(NULL, 'mtbf', 'MTBF (Mean Time Between Failures)', 'engineering', 'engineering', 'Average time between failures', 'hours', 'reliability_engineer', 'daily', false),
(NULL, 'mttr', 'MTTR (Mean Time To Repair)', 'engineering', 'engineering', 'Average repair time', 'hours', 'reliability_engineer', 'daily', false),
(NULL, 'planned_vs_unplanned', 'Planned vs Unplanned Work', 'operational', 'site', 'Ratio of planned to unplanned work', 'ratio', 'maintenance_manager', 'daily', false),
(NULL, 'work_order_completion_rate', 'Work Order Completion Rate', 'operational', 'site', 'Percentage of WOs completed on time', 'percent', 'maintenance_manager', 'daily', false),
(NULL, 'response_time', 'Response Time', 'operational', 'site', 'Average time to respond to issues', 'hours', 'maintenance_supervisor', 'daily', false),
(NULL, 'backlog_hours', 'Backlog Hours', 'operational', 'site', 'Total backlog in hours', 'hours', 'maintenance_planner', 'daily', false),
(NULL, 'ai_confidence_score', 'AI Confidence Score', 'governance', 'executive', 'Average AI recommendation confidence', 'percent', 'coo', 'daily', false),
(NULL, 'governance_compliance_score', 'Governance Compliance Score', 'governance', 'executive', 'Percentage of governance policies followed', 'percent', 'coo', 'daily', false),
(NULL, 'deployment_maturity_score', 'Deployment Maturity Score', 'governance', 'executive', 'Overall deployment readiness', 'percent', 'vp_operations', 'weekly', false)
ON CONFLICT (organization_id, code) DO NOTHING;

-- ============================================
-- OEE LOSS CATEGORIES
-- ============================================

INSERT INTO oee_loss_categories (organization_id, code, name, category_type, description) VALUES 
(NULL, 'equipment_failure', 'Equipment Failure', 'availability', 'Unplanned downtime due to equipment failure'),
(NULL, 'setup_adjustment', 'Setup & Adjustment', 'availability', 'Time lost during changeover'),
(NULL, 'waiting_starvation', 'Waiting & Starvation', 'availability', 'Downtime due to lack of materials or resources'),
(NULL, 'minor_stop', 'Minor Stop', 'performance', 'Short stops less than 5 minutes'),
(NULL, 'reduced_speed', 'Reduced Speed', 'performance', 'Operating below designed speed'),
(NULL, 'startup_reject', 'Startup Rejects', 'quality', 'Rejects during startup'),
(NULL, 'production_reject', 'Production Rejects', 'quality', 'Rejects during normal production')
ON CONFLICT (organization_id, code) DO NOTHING;

-- ============================================
-- AUTONOMY MODES
-- ============================================

INSERT INTO autonomy_modes (organization_id, code, name, description, is_system) VALUES 
(NULL, 'advisory', 'Advisory', 'AI recommends, human decides', true),
(NULL, 'conditional', 'Conditional Execution', 'AI acts within approved policies, escalates outside', true),
(NULL, 'controlled_autonomy', 'Controlled Autonomy', 'AI executes with tight governance and full audit', true)
ON CONFLICT (organization_id, code) DO NOTHING;

-- ============================================
-- WORK PRIORITIES (Default)
-- ============================================

INSERT INTO work_priorities (organization_id, code, name, rank, response_target_hours) VALUES 
(NULL, 'emergency', 'Emergency', 1, 1),
(NULL, 'urgent', 'Urgent', 2, 4),
(NULL, 'high', 'High', 3, 24),
(NULL, 'medium', 'Medium', 4, 72),
(NULL, 'low', 'Low', 5, 168),
(NULL, 'backlog', 'Backlog', 6, 720)
ON CONFLICT (organization_id, code) DO NOTHING;

-- ============================================
-- DEPLOYMENT TEMPLATES
-- ============================================

INSERT INTO deployment_templates (code, name, industry, description, template_config, is_active) VALUES 
('oil_sands', 'Oil Sands Operation', 'oil_gas', 'Template for oil sands mining operations', '{"industry": "oil_sands", "default_autonomy": "conditional", "default_kpis": ["site_oee", "mtbf", "mttr"], "governance_level": "high"}', true),
('mining', 'Mining Operation', 'mining', 'Template for underground/surface mining', '{"industry": "mining", "default_autonomy": "conditional", "default_kpis": ["site_oee", "availability"], "governance_level": "high"}', true),
('manufacturing', 'Manufacturing Plant', 'manufacturing', 'Template for discrete/continuous manufacturing', '{"industry": "manufacturing", "default_autonomy": "advisory", "default_kpis": ["site_oee", "quality"], "governance_level": "medium"}', true),
('utilities', 'Utilities / Power', 'utilities', 'Template for power generation and utilities', '{"industry": "utilities", "default_autonomy": "conditional", "default_kpis": ["site_oee", "reliability"], "governance_level": "high"}', true),
('general', 'General Industrial', 'general', 'Generic template for industrial operations', '{"industry": "general", "default_autonomy": "advisory", "default_kpis": ["site_oee"], "governance_level": "low"}', true)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- DEFAULT TENANT SETTINGS
-- ============================================

INSERT INTO tenant_settings (organization_id, autonomy_mode_default, audit_retention_years, oee_enabled, governance_enabled, risk_matrix, branding) VALUES 
-- Will be linked to actual organization after creation
((SELECT id FROM organizations WHERE slug = 'default' LIMIT 1), 'conditional', 7, true, true, 
 '{"probability": ["very_low", "low", "medium", "high", "very_high"], "consequence": ["very_low", "low", "medium", "high", "very_high"]}',
 '{}')
ON CONFLICT (organization_id) DO NOTHING;

COMMIT;

SELECT 'Seed data applied successfully' AS status;
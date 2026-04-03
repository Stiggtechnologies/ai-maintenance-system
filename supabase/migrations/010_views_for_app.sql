-- SyncAI Phase 3b: Create Views for App Compatibility
-- Creates views that bridge new schema to existing app expectations

BEGIN;

-- Create user_kpi_dashboard view to support ExecutiveDashboard
-- Maps new kpi_measurements + kpi_definitions to expected format
CREATE OR REPLACE VIEW user_kpi_dashboard AS
SELECT 
    up.id as user_id,
    up.organization_id,
    kd.id as kpi_id,
    kd.code as kpi_code,
    kd.name as kpi_name,
    kd.category as kpi_category,
    'KOI' as kpi_type,
    kd.description as kpi_description,
    km.value as latest_value,
    kt.target_value,
    CASE 
        WHEN km.value IS NULL THEN 'unknown'
        WHEN kt.target_value IS NULL THEN 'unknown'
        WHEN km.value >= kt.target_value THEN 'green'
        WHEN km.value >= kt.target_value * 0.8 THEN 'yellow'
        ELSE 'red'
    END as status,
    'stable' as trend,
    km.measurement_time as last_updated,
    kd.unit
FROM user_profiles up
CROSS JOIN kpi_definitions kd
LEFT JOIN LATERAL (
    SELECT value, measurement_time 
    FROM kpi_measurements 
    WHERE kpi_definition_id = kd.id 
    AND organization_id = up.organization_id
    ORDER BY measurement_time DESC 
    LIMIT 1
) km ON true
LEFT JOIN kpi_targets kt ON kt.kpi_definition_id = kd.id 
    AND kt.organization_id = up.organization_id;

-- Create asset_criticality view for asset management
CREATE OR REPLACE VIEW asset_criticality_summary AS
SELECT 
    a.id as asset_id,
    a.organization_id,
    a.site_id,
    a.asset_tag,
    a.name as asset_name,
    a.status as asset_status,
    a.lifecycle_state,
    acp.total_criticality_score,
    acp.criticality_band,
    acp.safety_score,
    acp.production_score,
    acp.cost_score,
    s.name as site_name,
    ac.name as asset_class_name
FROM assets a
LEFT JOIN asset_criticality_profiles acp ON acp.asset_id = a.id
LEFT JOIN sites s ON s.id = a.site_id
LEFT JOIN asset_classes ac ON ac.id = a.asset_class_id;

-- Create work_order_summary view
CREATE OR REPLACE VIEW work_order_summary AS
SELECT 
    wo.id as work_order_id,
    wo.organization_id,
    wo.site_id,
    wo.asset_id,
    wo.work_order_number,
    wo.title,
    wo.work_type,
    wo.priority,
    wo.status as work_status,
    wo.scheduled_start,
    wo.scheduled_finish,
    wo.actual_start,
    wo.actual_finish,
    wo.estimated_hours,
    wo.actual_hours,
    a.name as asset_name,
    a.asset_tag,
    s.name as site_name,
    up.full_name as assigned_to_name
FROM work_orders wo
LEFT JOIN assets a ON a.id = wo.asset_id
LEFT JOIN sites s ON s.id = wo.site_id
LEFT JOIN user_profiles up ON up.id = wo.assigned_to;

-- Create recommendation_summary view
CREATE OR REPLACE VIEW recommendation_summary AS
SELECT 
    r.id as recommendation_id,
    r.organization_id,
    r.site_id,
    r.asset_id,
    r.title,
    r.summary,
    r.recommendation_type,
    r.priority,
    r.risk_score,
    r.confidence_score,
    r.status as recommendation_status,
    r.created_at,
    a.name as asset_name,
    a.asset_tag
FROM recommendations r
LEFT JOIN assets a ON a.id = r.asset_id;

COMMIT;

SELECT 'Phase 3b views created' AS status;
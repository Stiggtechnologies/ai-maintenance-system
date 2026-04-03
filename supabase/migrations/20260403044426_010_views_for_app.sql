/*
  # Application Views

  1. Views Created
    - `user_kpi_dashboard` - KPI dashboard data per user
    - `asset_criticality_summary` - Asset criticality overview
    - `work_order_summary` - Work order list view

  2. Purpose
    - Bridge schema to app expectations
    - Pre-join common queries for performance
    - Simplify frontend data fetching
*/

-- KPI Dashboard View
CREATE OR REPLACE VIEW user_kpi_dashboard AS
SELECT 
    up.id as user_id,
    up.organization_id,
    kd.id as kpi_id,
    kd.code as kpi_code,
    kd.name as kpi_name,
    kd.category as kpi_category,
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
    km.measurement_date as last_updated,
    kd.unit
FROM user_profiles up
CROSS JOIN kpi_definitions kd
LEFT JOIN LATERAL (
    SELECT value, measurement_date
    FROM kpi_measurements 
    WHERE kpi_definition_id = kd.id 
    AND organization_id = up.organization_id
    ORDER BY measurement_date DESC 
    LIMIT 1
) km ON true
LEFT JOIN LATERAL (
    SELECT target_value
    FROM kpi_targets 
    WHERE kpi_definition_id = kd.id 
    AND organization_id = up.organization_id
    AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    ORDER BY start_date DESC
    LIMIT 1
) kt ON true
WHERE kd.organization_id = up.organization_id
AND kd.active = true;

-- Asset Criticality Summary
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
    acp.code as criticality_code,
    acp.name as criticality_name,
    acp.failure_impact,
    acp.repair_complexity,
    acp.max_acceptable_outage_hours,
    s.name as site_name,
    ac.name as asset_class_name
FROM assets a
LEFT JOIN asset_criticality_profiles acp ON acp.asset_id = a.id
LEFT JOIN sites s ON s.id = a.site_id
LEFT JOIN asset_classes ac ON ac.id = a.asset_class_id;

-- Work Order Summary
CREATE OR REPLACE VIEW work_order_summary AS
SELECT 
    wo.id as work_order_id,
    wo.organization_id,
    wo.site_id,
    wo.asset_id,
    wo.wo_number as work_order_number,
    wo.title,
    wo.work_type,
    wo.priority,
    wo.status as work_status,
    wo.scheduled_start,
    wo.scheduled_end as scheduled_finish,
    wo.estimated_hours,
    wo.actual_hours,
    a.name as asset_name,
    a.asset_tag,
    s.name as site_name,
    up.full_name as assigned_to_name,
    wo.created_at,
    wo.updated_at
FROM work_orders wo
LEFT JOIN assets a ON a.id = wo.asset_id
LEFT JOIN sites s ON s.id = wo.site_id
LEFT JOIN user_profiles up ON up.id = wo.assigned_to;
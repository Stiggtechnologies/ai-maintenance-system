-- Seed: Demo data for SyncAI platform
-- Created: 2026-04-05
-- Description: Inserts a complete demo dataset for Axium Industrial,
--              including organization, site, asset classes, assets,
--              work orders, system alerts, and notifications.

-- ============================================================================
-- Demo Organization
-- ============================================================================

INSERT INTO organizations (id, name, slug, industry, settings, timezone) VALUES
('00000000-0000-0000-0000-000000000001', 'Axium Industrial', 'axium', 'manufacturing', '{}', 'America/Toronto')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Demo Site
-- ============================================================================

INSERT INTO sites (id, organization_id, name, code, region, status) VALUES
('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Edmonton Plant', 'YEG-01', 'Alberta', 'active')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Asset Classes
-- ============================================================================

INSERT INTO asset_classes (id, organization_id, code, name) VALUES
('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'PUMP', 'Centrifugal Pump'),
('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'MOTOR', 'Electric Motor'),
('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'CONV', 'Conveyor System'),
('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', 'COMP', 'Air Compressor'),
('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000001', 'HX', 'Heat Exchanger')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Demo Assets (10)
-- ============================================================================

INSERT INTO assets (id, organization_id, site_id, asset_class_id, name, asset_tag, status, criticality, manufacturer, model, install_date) VALUES
('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020', 'Primary Feed Pump A', 'PMP-001', 'operational', 'critical', 'Flowserve', 'HPX-2000', '2021-06-15'),
('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020', 'Primary Feed Pump B', 'PMP-002', 'operational', 'critical', 'Flowserve', 'HPX-2000', '2021-06-15'),
('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000021', 'Main Drive Motor', 'MOT-001', 'operational', 'high', 'ABB', 'M3BP-315', '2020-03-10'),
('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000022', 'Conveyor Line Alpha', 'CONV-001', 'degraded', 'high', 'Hytrol', 'ProSort-400', '2019-11-20'),
('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000023', 'Air Compressor Unit 1', 'COMP-001', 'operational', 'medium', 'Atlas Copco', 'GA-90', '2022-01-05'),
('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000023', 'Air Compressor Unit 2', 'COMP-002', 'maintenance', 'medium', 'Atlas Copco', 'GA-90', '2022-01-05'),
('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000024', 'Shell & Tube HX-1', 'HX-001', 'operational', 'high', 'Alfa Laval', 'M15-BW', '2020-08-12'),
('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000021', 'Auxiliary Motor B', 'MOT-002', 'operational', 'medium', 'Siemens', '1LE1', '2021-02-28'),
('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020', 'Cooling Water Pump', 'PMP-003', 'operational', 'medium', 'Grundfos', 'CR-32', '2023-04-01'),
('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000022', 'Conveyor Line Beta', 'CONV-002', 'operational', 'low', 'Hytrol', 'ProSort-200', '2023-07-15')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Work Orders (variety of statuses)
-- ============================================================================

INSERT INTO work_orders (id, organization_id, site_id, asset_id, title, description, priority, status, created_at) VALUES
('00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000103', 'Conveyor Belt Replacement', 'Belt showing signs of wear and tracking issues on Conveyor Alpha', 'high', 'in_progress', NOW() - INTERVAL '3 days'),
('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000100', 'Pump Seal Inspection', 'Quarterly preventive maintenance - inspect mechanical seals', 'medium', 'pending', NOW() - INTERVAL '1 day'),
('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000105', 'Compressor Overhaul', 'Scheduled major overhaul per manufacturer recommendation', 'high', 'in_progress', NOW() - INTERVAL '7 days'),
('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000102', 'Motor Vibration Analysis', 'Elevated vibration readings detected - investigate root cause', 'critical', 'pending', NOW() - INTERVAL '6 hours'),
('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000106', 'Heat Exchanger Cleaning', 'Routine cleaning and tube bundle inspection', 'low', 'completed', NOW() - INTERVAL '14 days'),
('00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000104', 'Air Filter Replacement', 'Replace inlet air filters on compressor unit 1', 'low', 'completed', NOW() - INTERVAL '21 days')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- System Alerts
-- ============================================================================

INSERT INTO system_alerts (id, severity, title, description, alert_type, target_users, acknowledged, resolved) VALUES
('00000000-0000-0000-0000-000000000300', 'critical', 'Motor Vibration Threshold Exceeded', 'Main Drive Motor MOT-001 vibration reading 12.5mm/s exceeds 10mm/s threshold', 'asset_health', '{}', false, false),
('00000000-0000-0000-0000-000000000301', 'high', 'Conveyor Belt Wear Detected', 'Conveyor Alpha belt wear at 85% - replacement recommended within 2 weeks', 'asset_health', '{}', true, false),
('00000000-0000-0000-0000-000000000302', 'medium', 'Compressor Efficiency Drop', 'Air Compressor Unit 2 efficiency dropped 15% over last month', 'performance', '{}', false, false)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Notifications
-- ============================================================================

INSERT INTO notifications (id, organization_id, site_id, title, description, priority, status, source_type) VALUES
('00000000-0000-0000-0000-000000000400', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'Preventive Maintenance Due', 'PM schedule for Feed Pump A is due in 3 days', 'medium', 'open', 'system'),
('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'Work Order Overdue', 'WO for Compressor Overhaul is 2 days past due date', 'high', 'open', 'system'),
('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'New AI Recommendation', 'AI suggests predictive maintenance for Heat Exchanger HX-001', 'low', 'open', 'ai')
ON CONFLICT DO NOTHING;

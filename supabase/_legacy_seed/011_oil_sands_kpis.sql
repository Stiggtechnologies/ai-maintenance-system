-- Oil Sands KPI Pack Items (38 KPIs)

-- Executive KOIs (5)
INSERT INTO kpi_pack_items (id, pack_id, kpi_code, kpi_name, kpi_type, category, level, unit, direction, formula_description, default_target, default_green_threshold, default_yellow_threshold, default_red_threshold, frequency, is_oee_component, sort_order) VALUES
('10000000-1000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'enterprise_downtime_cost_exposure', 'Enterprise Downtime Cost Exposure', 'KOI', 'Strategic Alignment', 'executive', '$/year', 'lower_better', 'downtime_hours * cost_per_hour', NULL, 5000000, 15000000, 15000001, 'monthly', false, 1),
('10000000-1000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'enterprise_risk_index', 'Enterprise Risk Index', 'KOI', 'Risk Management', 'executive', 'score', 'higher_better', 'Weighted aggregate asset risk across enterprise', 85, 80, 60, 59, 'monthly', false, 2),
('10000000-1000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'ebitda_impact_from_maintenance', 'EBITDA Impact from Maintenance', 'KOI', 'Financial', 'executive', '$', 'higher_better', 'Financial effect of maintenance decisions on EBITDA', NULL, NULL, NULL, NULL, 'quarterly', false, 3),
('10000000-1000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'asset_capital_efficiency', 'Asset Capital Efficiency Index', 'KOI', 'Financial', 'executive', 'ratio', 'higher_better', 'Return on asset base and capital effectiveness', 1.2, 1.1, 0.9, 0.89, 'quarterly', false, 4),
('10000000-1000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'availability_weighted_oee_rollup', 'Availability-Weighted OEE Rollup', 'KOI', 'Performance Monitoring', 'executive', '%', 'higher_better', 'Executive OEE with availability weighting', 78, 75, 65, 64, 'weekly', true, 5),

-- Site Leadership KPIs (10)
('10000000-1000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'site_oee', 'Site OEE', 'KPI', 'Performance Monitoring', 'tactical', '%', 'higher_better', NULL, 78, 75, 65, 64, 'daily', true, 6),
('10000000-1000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'asset_availability_pct', 'Asset Availability', 'KPI', 'Maintenance & Reliability', 'tactical', '%', 'higher_better', NULL, 92, 90, 85, 84, 'daily', false, 7),
('10000000-1000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'critical_asset_uptime', 'Critical Asset Uptime', 'KPI', 'Maintenance & Reliability', 'tactical', '%', 'higher_better', NULL, 97, 95, 90, 89, 'daily', false, 8),
('10000000-1000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'planned_vs_unplanned_pct', 'Planned vs Unplanned Work', 'KPI', 'Planning', 'tactical', '%', 'higher_better', NULL, 80, 75, 60, 59, 'weekly', false, 9),
('10000000-1000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'schedule_compliance', 'Schedule Compliance', 'KPI', 'Planning', 'tactical', '%', 'higher_better', NULL, 90, 85, 75, 74, 'weekly', false, 10),
('10000000-1000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'maintenance_cost_per_op_hour', 'Maintenance Cost per Operating Hour', 'KPI', 'Financial', 'tactical', '$/hr', 'lower_better', NULL, NULL, NULL, NULL, NULL, 'monthly', false, 11),
('10000000-1000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'backlog_health_weeks', 'Backlog Health', 'KPI', 'Planning', 'tactical', 'weeks', 'lower_better', NULL, 4, 4, 8, 9, 'weekly', false, 12),
('10000000-1000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'critical_spare_readiness', 'Critical Spare Readiness', 'KPI', 'Planning', 'tactical', '%', 'higher_better', NULL, 98, 95, 90, 89, 'weekly', false, 13),
('10000000-1000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', 'downtime_hours_by_area', 'Downtime Hours by Area', 'KPI', 'Performance Monitoring', 'tactical', 'hours', 'lower_better', NULL, NULL, NULL, NULL, NULL, 'daily', false, 14),
('10000000-1000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', 'repeat_failure_rate', 'Repeat Failure Rate', 'KPI', 'Maintenance & Reliability', 'tactical', '%', 'lower_better', NULL, 5, 5, 10, 11, 'monthly', false, 15),

-- Engineering KPIs (10)
('10000000-1000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000001', 'mtbf', 'Mean Time Between Failures', 'KPI', 'Maintenance & Reliability', 'tactical', 'hours', 'higher_better', NULL, 2000, 1800, 1200, 1199, 'monthly', false, 16),
('10000000-1000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000001', 'mttr', 'Mean Time To Repair', 'KPI', 'Maintenance & Reliability', 'tactical', 'hours', 'lower_better', NULL, 4, 4, 8, 9, 'monthly', false, 17),
('10000000-1000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000001', 'critical_asset_risk_score', 'Critical Asset Risk Score', 'KPI', 'Risk Management', 'tactical', 'score', 'lower_better', NULL, 20, 25, 50, 51, 'monthly', false, 18),
('10000000-1000-0000-0000-000000000019', '10000000-0000-0000-0000-000000000001', 'predictive_accuracy', 'Predictive Accuracy', 'KPI', 'Digital Enablement', 'tactical', '%', 'higher_better', NULL, 85, 80, 65, 64, 'monthly', false, 19),
('10000000-1000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000001', 'failure_mode_frequency', 'Failure Mode Frequency', 'KPI', 'Maintenance & Reliability', 'tactical', 'count/mo', 'lower_better', NULL, NULL, NULL, NULL, NULL, 'monthly', false, 20),
('10000000-1000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001', 'pm_effectiveness', 'PM Effectiveness', 'KPI', 'Maintenance & Reliability', 'tactical', '%', 'higher_better', NULL, 90, 85, 75, 74, 'monthly', false, 21),
('10000000-1000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000001', 'defect_elimination_closure', 'Defect Elimination Closure Rate', 'KPI', 'Continuous Improvement', 'tactical', '%', 'higher_better', NULL, 80, 75, 60, 59, 'monthly', false, 22),
('10000000-1000-0000-0000-000000000023', '10000000-0000-0000-0000-000000000001', 'strategy_compliance', 'Strategy Compliance', 'KPI', 'Planning', 'tactical', '%', 'higher_better', NULL, 95, 90, 80, 79, 'monthly', false, 23),
('10000000-1000-0000-0000-000000000024', '10000000-0000-0000-0000-000000000001', 'bad_actor_count', 'Bad Actor Asset Count', 'KPI', 'Maintenance & Reliability', 'tactical', 'count', 'lower_better', NULL, 5, 5, 10, 11, 'monthly', false, 24),
('10000000-1000-0000-0000-000000000025', '10000000-0000-0000-0000-000000000001', 'spare_exposure_score', 'Spare Exposure Score', 'KPI', 'Planning', 'tactical', 'score', 'lower_better', NULL, 10, 10, 25, 26, 'monthly', false, 25),

-- Field/Supervision KPIs (8)
('10000000-1000-0000-0000-000000000026', '10000000-0000-0000-0000-000000000001', 'work_order_completion_rate', 'Work Order Completion Rate', 'KPI', 'Planning', 'operational', '%', 'higher_better', NULL, 95, 90, 80, 79, 'weekly', false, 26),
('10000000-1000-0000-0000-000000000027', '10000000-0000-0000-0000-000000000001', 'response_time', 'Response Time', 'KPI', 'Maintenance & Reliability', 'operational', 'hours', 'lower_better', NULL, 1, 1, 4, 5, 'daily', false, 27),
('10000000-1000-0000-0000-000000000028', '10000000-0000-0000-0000-000000000001', 'inspection_compliance', 'Inspection Compliance', 'KPI', 'Safety', 'operational', '%', 'higher_better', NULL, 100, 95, 85, 84, 'weekly', false, 28),
('10000000-1000-0000-0000-000000000029', '10000000-0000-0000-0000-000000000001', 'time_on_tool', 'Time on Tool', 'KPI', 'Performance Monitoring', 'operational', '%', 'higher_better', NULL, 65, 60, 50, 49, 'weekly', false, 29),
('10000000-1000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000001', 'first_time_fix_rate', 'First-Time Fix Rate', 'KPI', 'Maintenance & Reliability', 'operational', '%', 'higher_better', NULL, 85, 80, 70, 69, 'monthly', false, 30),
('10000000-1000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000001', 'shift_oee', 'Shift OEE', 'KPI', 'Performance Monitoring', 'operational', '%', 'higher_better', NULL, 78, 75, 65, 64, 'per_shift', true, 31),
('10000000-1000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000001', 'escalation_response_time', 'Escalation Response Time', 'KPI', 'Planning', 'operational', 'minutes', 'lower_better', NULL, 30, 30, 60, 61, 'daily', false, 32),
('10000000-1000-0000-0000-000000000033', '10000000-0000-0000-0000-000000000001', 'safety_critical_task_compliance', 'Safety-Critical Task Compliance', 'KPI', 'Safety', 'operational', '%', 'higher_better', NULL, 100, 98, 95, 94, 'daily', false, 33),

-- Governance KPIs (5)
('10000000-1000-0000-0000-000000000034', '10000000-0000-0000-0000-000000000001', 'approval_cycle_time', 'Approval Cycle Time', 'KPI', 'Planning', 'tactical', 'hours', 'lower_better', NULL, 4, 4, 12, 13, 'weekly', false, 34),
('10000000-1000-0000-0000-000000000035', '10000000-0000-0000-0000-000000000001', 'override_frequency', 'Override Frequency', 'KPI', 'Risk Management', 'tactical', 'count/mo', 'lower_better', NULL, 3, 3, 10, 11, 'monthly', false, 35),
('10000000-1000-0000-0000-000000000036', '10000000-0000-0000-0000-000000000001', 'governance_compliance_score', 'Governance Compliance Score', 'KPI', 'Performance Monitoring', 'executive', '%', 'higher_better', NULL, 95, 90, 80, 79, 'monthly', false, 36),
('10000000-1000-0000-0000-000000000037', '10000000-0000-0000-0000-000000000001', 'audit_completion_integrity', 'Audit Completion Integrity', 'KPI', 'Data Integrity', 'tactical', '%', 'higher_better', NULL, 100, 95, 90, 89, 'monthly', false, 37),
('10000000-1000-0000-0000-000000000038', '10000000-0000-0000-0000-000000000001', 'low_confidence_recommendation_rate', 'Low Confidence Recommendation Rate', 'KPI', 'Digital Enablement', 'tactical', '%', 'lower_better', NULL, 5, 5, 15, 16, 'monthly', false, 38)
ON CONFLICT DO NOTHING;

-- Master Templates + OEE Models
-- 4 master templates + Oil Sands/Mining OEE models + KPI/Asset/Criticality/Governance/Work/Failure packs (headers only)

-- =============================================
-- MASTER TEMPLATES
-- =============================================
INSERT INTO deployment_templates (id, code, name, industry, description, template_type, is_active, template_config) VALUES
('f0000000-0000-0000-0000-000000000001', 'heavy_industrial_master', 'Heavy Industrial Master', 'heavy_industrial', 'Master template for oil sands, mining, pulp & paper, cement. Mobile + fixed assets, extreme downtime costs, safety-weighted.', 'master', true, '{"default_autonomy_mode":"conditional","oee_focus":"availability","governance_level":"high"}'),
('f0000000-0000-0000-0000-000000000002', 'process_industrial_master', 'Process Industrial Master', 'process_industrial', 'Master for chemicals, utilities, refining, water/wastewater. Process continuity, fixed-plant dominant, compliance-focused.', 'master', true, '{"default_autonomy_mode":"conditional","oee_focus":"availability","governance_level":"high"}'),
('f0000000-0000-0000-0000-000000000003', 'discrete_manufacturing_master', 'Discrete Manufacturing Master', 'manufacturing', 'Master for automotive, food & bev, pharma, consumer goods. Line-based, OEE-driven, quality-critical.', 'master', true, '{"default_autonomy_mode":"advisory","oee_focus":"balanced","governance_level":"medium"}'),
('f0000000-0000-0000-0000-000000000004', 'infrastructure_fleet_master', 'Infrastructure & Fleet Master', 'infrastructure', 'Master for transportation, rail, ports, facilities. Distributed assets, inspection-heavy, service continuity.', 'master', true, '{"default_autonomy_mode":"advisory","oee_focus":"availability","governance_level":"medium"}')
ON CONFLICT DO NOTHING;

-- =============================================
-- OIL SANDS — Pack Headers
-- =============================================
INSERT INTO kpi_packs (id, pack_code, pack_name, industry, description, kpi_count) VALUES
('10000000-0000-0000-0000-000000000001', 'oil_sands_core_kpis', 'Oil Sands Core KPI Pack', 'oil_sands', '38 KPIs across executive, site, engineering, field, and governance levels', 38)
ON CONFLICT DO NOTHING;

INSERT INTO industry_asset_libraries (id, library_code, library_name, industry, description, asset_class_count) VALUES
('10000000-0000-0000-0000-000000000010', 'oil_sands_asset_library', 'Oil Sands Asset Class Library', 'oil_sands', 'Mobile mining, fixed plant, utilities, and instrumentation asset classes', 50)
ON CONFLICT DO NOTHING;

INSERT INTO industry_criticality_profiles (id, profile_code, profile_name, industry, description, safety_weight, environmental_weight, production_weight, quality_weight, cost_weight, regulatory_weight, reputation_weight, band_a_min, band_b_min, band_c_min, band_a_label, band_b_label, band_c_label, band_d_label) VALUES
('10000000-0000-0000-0000-000000000020', 'oil_sands_criticality', 'Oil Sands Safety & Environment Weighted Criticality', 'oil_sands', 'Heavy safety and environmental weighting for oil sands regulatory context', 30, 20, 25, 5, 5, 10, 5, 75, 55, 35, 'Band A — Critical: Immediate attention, safety/environmental/production risk', 'Band B — High: Scheduled priority maintenance, close monitoring', 'Band C — Moderate: Standard maintenance program', 'Band D — Low: Run to failure acceptable')
ON CONFLICT DO NOTHING;

INSERT INTO industry_governance_profiles (id, profile_code, profile_name, industry, description, default_autonomy_mode, auto_approve_confidence_min, require_approval_cost_threshold_cad, require_engineering_review_criticality, audit_retention_years, compliance_frameworks, emergency_response_time_minutes, escalation_levels) VALUES
('10000000-0000-0000-0000-000000000030', 'oil_sands_high_control', 'Oil Sands High-Control Governance', 'oil_sands', 'Conditional autonomy with strong safety suppression, extended audit retention', 'conditional', 95, 25000, 'critical', 10, ARRAY['CSA Z662','API 1130','ABSA','AER Directive 071','AER Directive 060','Alberta OHS Act','EPEA'], 15, '[{"level":1,"role":"shift_supervisor","timeout_minutes":15},{"level":2,"role":"maintenance_manager","timeout_minutes":45},{"level":3,"role":"operations_manager","timeout_minutes":90},{"level":4,"role":"plant_manager","timeout_minutes":180}]'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO industry_work_taxonomies (id, taxonomy_code, taxonomy_name, industry, description, work_type_count) VALUES
('10000000-0000-0000-0000-000000000040', 'oil_sands_work_taxonomy', 'Oil Sands Heavy Industrial Work Taxonomy', 'oil_sands', 'Inspection, PM, PdM, corrective, shutdown, regulatory, and safety work types', 20)
ON CONFLICT DO NOTHING;

INSERT INTO industry_failure_mode_packs (id, pack_code, pack_name, industry, description, failure_mode_count) VALUES
('10000000-0000-0000-0000-000000000050', 'oil_sands_failure_modes', 'Oil Sands Failure Mode Library', 'oil_sands', 'Rotating, mobile, conveyance, electrical, instrumentation, process, and safety-critical failure modes', 35)
ON CONFLICT DO NOTHING;

INSERT INTO industry_oee_models (id, model_code, model_name, industry, description, availability_weight, performance_weight, quality_weight, target_oee, target_availability, target_performance, target_quality, primary_loss_focus, seasonal_adjustment, shift_based, notes) VALUES
('10000000-0000-0000-0000-000000000060', 'oil_sands_oee', 'Oil Sands Availability-Weighted OEE', 'oil_sands', 'Availability-dominated for heavy industrial. Quality = process conformance.', 45, 35, 20, 78, 92, 88, 96, 'availability', true, true, 'Seasonal adjustments for Alberta winter operations. Performance = throughput targets. Quality = process conformance and off-spec penalties.')
ON CONFLICT DO NOTHING;

-- =============================================
-- MINING — Pack Headers
-- =============================================
INSERT INTO kpi_packs (id, pack_code, pack_name, industry, description, kpi_count) VALUES
('20000000-0000-0000-0000-000000000001', 'mining_core_kpis', 'Mining Core KPI Pack', 'mining', '39 KPIs across executive, site, engineering, field, and governance levels', 39)
ON CONFLICT DO NOTHING;

INSERT INTO industry_asset_libraries (id, library_code, library_name, industry, description, asset_class_count) VALUES
('20000000-0000-0000-0000-000000000010', 'mining_asset_library', 'Mining Asset Class Library', 'mining', 'Mobile fleet, crushing/milling, processing, utilities, instrumentation', 38)
ON CONFLICT DO NOTHING;

INSERT INTO industry_criticality_profiles (id, profile_code, profile_name, industry, description, safety_weight, environmental_weight, production_weight, quality_weight, cost_weight, regulatory_weight, reputation_weight, band_a_min, band_b_min, band_c_min, band_a_label, band_b_label, band_c_label, band_d_label) VALUES
('20000000-0000-0000-0000-000000000020', 'mining_criticality', 'Mining Production & Safety Weighted Criticality', 'mining', 'Production and safety weighted for mining throughput dependency chains', 22, 16, 24, 8, 14, 10, 6, 85, 70, 45, 'Band A — Critical: Production bottleneck or safety risk', 'Band B — High: Scheduled priority', 'Band C — Moderate: Standard program', 'Band D — Low: Run to failure')
ON CONFLICT DO NOTHING;

INSERT INTO industry_governance_profiles (id, profile_code, profile_name, industry, description, default_autonomy_mode, auto_approve_confidence_min, require_approval_cost_threshold_cad, require_engineering_review_criticality, audit_retention_years, compliance_frameworks, emergency_response_time_minutes, escalation_levels) VALUES
('20000000-0000-0000-0000-000000000030', 'mining_high_control', 'Mining High-Control Governance', 'mining', 'Conditional autonomy with blast/geotechnical suppression rules', 'conditional', 92, 50000, 'critical', 7, ARRAY['MSHA','Mining Act','Environmental Protection Act','Mine Health and Safety Act'], 20, '[{"level":1,"role":"shift_supervisor","timeout_minutes":15},{"level":2,"role":"maintenance_manager","timeout_minutes":45},{"level":3,"role":"mine_manager","timeout_minutes":120}]'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO industry_work_taxonomies (id, taxonomy_code, taxonomy_name, industry, description, work_type_count) VALUES
('20000000-0000-0000-0000-000000000040', 'mining_work_taxonomy', 'Mining Work Taxonomy', 'mining', 'Mining-specific inspection, PM, PdM, corrective, shutdown, and regulatory work types', 20)
ON CONFLICT DO NOTHING;

INSERT INTO industry_failure_mode_packs (id, pack_code, pack_name, industry, description, failure_mode_count) VALUES
('20000000-0000-0000-0000-000000000050', 'mining_failure_modes', 'Mining Failure Mode Library', 'mining', 'Mobile fleet, crushing/conveying, milling/process, electrical, and instrumentation failure modes', 30)
ON CONFLICT DO NOTHING;

INSERT INTO industry_oee_models (id, model_code, model_name, industry, description, availability_weight, performance_weight, quality_weight, target_oee, target_availability, target_performance, target_quality, primary_loss_focus, seasonal_adjustment, shift_based, notes) VALUES
('20000000-0000-0000-0000-000000000060', 'mining_oee', 'Mining Availability-Weighted OEE', 'mining', 'Availability-heavy for mining. Quality = ore grade recovery conformance.', 50, 35, 15, 72, 88, 85, 95, 'availability', true, true, 'Mining OEE heavily availability-driven. Performance = tonnage throughput. Quality = grade recovery.')
ON CONFLICT DO NOTHING;

-- =============================================
-- LINK Oil Sands + Mining to deployment_templates
-- =============================================
UPDATE deployment_templates SET
  kpi_pack_id = '10000000-0000-0000-0000-000000000001',
  asset_library_id = '10000000-0000-0000-0000-000000000010',
  criticality_profile_id = '10000000-0000-0000-0000-000000000020',
  governance_profile_id = '10000000-0000-0000-0000-000000000030',
  work_taxonomy_id = '10000000-0000-0000-0000-000000000040',
  failure_mode_pack_id = '10000000-0000-0000-0000-000000000050',
  oee_model_id = '10000000-0000-0000-0000-000000000060',
  parent_template_code = 'heavy_industrial_master',
  template_type = 'derived',
  inherits_from_master = true
WHERE code = 'oil_sands';

UPDATE deployment_templates SET
  kpi_pack_id = '20000000-0000-0000-0000-000000000001',
  asset_library_id = '20000000-0000-0000-0000-000000000010',
  criticality_profile_id = '20000000-0000-0000-0000-000000000020',
  governance_profile_id = '20000000-0000-0000-0000-000000000030',
  work_taxonomy_id = '20000000-0000-0000-0000-000000000040',
  failure_mode_pack_id = '20000000-0000-0000-0000-000000000050',
  oee_model_id = '20000000-0000-0000-0000-000000000060',
  parent_template_code = 'heavy_industrial_master',
  template_type = 'derived',
  inherits_from_master = true
WHERE code = 'mining';

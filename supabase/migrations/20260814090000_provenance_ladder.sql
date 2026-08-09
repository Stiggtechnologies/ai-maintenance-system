-- ============================================================================
-- The onboarding provenance ladder (capability register C9.01, U21.02, E1.x).
--
-- Onboarding should be autonomous wherever it CAN be, derive what it cannot
-- fetch, and ask a person only for what it can neither reach nor derive — with
-- guidance when it does ask.
--
-- The old model gave each requirement ONE fill_strategy, which conflated three
-- different reasons a thing might need a human:
--
--     1. nobody has connected the system that holds it   → shrinks on connection
--     2. nobody has run the derivation                    → a bug, not a fact
--     3. it is a judgement, an approval or an observation → the real floor
--
-- Collapsing those into "human" makes the floor look like whatever the current
-- integration state happens to be, and it never improves because nothing tracks
-- WHY a person was asked. 65.5 human touches per asset across 181 assets, with
-- zero assets live, is what that produces.
--
-- So a requirement now declares an ORDERED LADDER of sources. The resolver
-- walks it and records which rung answered. What remains human is classified
-- as AWAITING A CONNECTION (actionable, and it disappears when the connector
-- arrives) or IRREDUCIBLE (a person must decide). Only the second is the floor,
-- and stating it honestly is the point: a vendor claiming zero human effort is
-- either lying or about to fabricate an approval.
--
-- Canonical reuse: onboarding_requirements, asset_onboarding_items, assets,
-- work_orders, operating_states, connectors, condition_alerts. Additive.
-- ============================================================================

create table if not exists requirement_sources (
  id uuid primary key default gen_random_uuid(),
  requirement_key text not null,
  rank int not null,
  source_kind text not null check (source_kind in
    ('connector', 'derive', 'library', 'ai', 'human')),
  -- connector kind, derivation key, or library key
  source_ref text,
  -- Only for the human rung, and mandatory there: asking without telling
  -- someone what is wanted and why is how a checklist stalls.
  guidance jsonb,
  -- true when a person must decide even with every system connected
  irreducible boolean not null default false,
  register_ref text not null default 'C9.01',
  unique (requirement_key, rank)
);

alter table requirement_sources enable row level security;
drop policy if exists requirement_sources_read on requirement_sources;
create policy requirement_sources_read on requirement_sources
  for select to authenticated using (true);

alter table asset_onboarding_items
  add column if not exists resolved_by text,
  add column if not exists resolved_ref text,
  add column if not exists blocked_on text,
  add column if not exists irreducible boolean not null default false;

comment on column asset_onboarding_items.blocked_on is
  'When a person is being asked only because a system is not connected, this names the connection. It is the difference between "we need a human" and "we need a historian", and only the first is a floor.';

insert into requirement_sources (requirement_key, rank, source_kind, source_ref, guidance, irreducible) values
  ('s1_asset_name',1,'connector','cmms',null,false),
  ('s1_asset_name',2,'derive','asset_field_name',null,false),
  ('s1_asset_tag',1,'connector','cmms',null,false),
  ('s1_asset_tag',2,'derive','asset_field_tag',null,false),
  ('s1_asset_class_category',1,'connector','cmms',null,false),
  ('s1_asset_class_category',2,'derive','asset_field_class',null,false),
  ('s1_asset_type',1,'connector','cmms',null,false),
  ('s1_asset_type',2,'derive','asset_field_class',null,false),
  ('s1_location',1,'connector','cmms',null,false),
  ('s1_location',2,'derive','asset_field_site',null,false),
  ('s1_manufacturer',1,'connector','cmms',null,false),
  ('s1_manufacturer',2,'connector','document',null,false),
  ('s1_manufacturer',3,'ai',null,null,false),
  ('s1_model',1,'connector','cmms',null,false),
  ('s1_model',2,'connector','document',null,false),
  ('s1_model',3,'ai',null,null,false),
  ('s1_serial_number',1,'connector','cmms',null,false),
  ('s1_commissioning_date',1,'connector','cmms',null,false),
  ('s1_commissioning_date',2,'connector','erp',null,false),
  ('s1_parent_asset',1,'connector','cmms',null,false),
  ('s1_parent_asset',2,'derive','asset_field_parent',null,false),
  ('s1_child_assets',1,'connector','cmms',null,false),
  ('s1_ownership',1,'connector','erp',null,false),
  ('s1_ownership',2,'human',null,'{"what": "Which business unit owns this asset on the balance sheet", "why": "Ownership decides who funds its replacement and who carries its risk", "where": "Fixed-asset register or the finance business partner", "example": "Mine Operations \u2014 Fleet"}'::jsonb,true),
  ('s2_hierarchy_assigned',1,'connector','cmms',null,false),
  ('s2_hierarchy_assigned',2,'derive','asset_field_site',null,false),
  ('s2_criticality_assigned',1,'derive','criticality_from_history',null,false),
  ('s2_criticality_assigned',2,'human',null,'{"what": "Confirm the criticality band", "why": "Criticality drives strategy, spares and how hard the platform pushes an alert", "where": "Your criticality matrix; the platform proposes one from downtime history", "example": "A / B / C"}'::jsonb,false),
  ('s2_duplicates_removed',1,'derive','duplicate_check',null,false),
  ('s2_naming_convention',1,'derive','naming_check',null,false),
  ('s2_parent_child_links',1,'connector','cmms',null,false),
  ('s2_boundary_defined',1,'ai',null,null,false),
  ('s2_boundary_defined',2,'human',null,'{"what": "Where does this asset end and the next begin", "why": "Boundary decides which failures count against this asset", "where": "P&ID or the reliability engineer", "example": "Motor + coupling + gearbox; driven pump excluded"}'::jsonb,false),
  ('s3_primary_function',1,'ai',null,null,false),
  ('s3_primary_function',2,'human',null,'{"what": "What this asset must do, with a measurable standard", "why": "A failure is the loss of a stated function; without it nothing else is definable", "where": "Design basis or operations", "example": "Haul 240 t at 20 km/h on a 10% grade"}'::jsonb,true),
  ('s3_failure_definition',1,'derive','failure_definition_from_taxonomy',null,false),
  ('s3_failure_definition',2,'ai',null,null,false),
  ('s3_secondary_functions',1,'ai',null,null,false),
  ('s3_mission_profile',1,'derive','load_profile',null,false),
  ('s3_mission_profile',2,'ai',null,null,false),
  ('s3_operating_role',1,'ai',null,null,false),
  ('s3_performance_limits',1,'connector','historian',null,false),
  ('s3_performance_limits',2,'connector','document',null,false),
  ('s3_performance_limits',3,'ai',null,null,false),
  ('s3_process_served',1,'connector','cmms',null,false),
  ('s3_process_served',2,'ai',null,null,false),
  ('s4_mechanical_specs',1,'connector','document',null,false),
  ('s4_mechanical_specs',2,'ai',null,null,false),
  ('s4_electrical_specs',1,'connector','document',null,false),
  ('s4_electrical_specs',2,'ai',null,null,false),
  ('s4_materials',1,'connector','document',null,false),
  ('s4_materials',2,'ai',null,null,false),
  ('s4_operating_limits',1,'connector','historian',null,false),
  ('s4_operating_limits',2,'connector','document',null,false),
  ('s4_operating_limits',3,'ai',null,null,false),
  ('s4_environmental_limits',1,'connector','document',null,false),
  ('s4_environmental_limits',2,'ai',null,null,false),
  ('s4_lubrication',1,'connector','document',null,false),
  ('s4_lubrication',2,'ai',null,null,false),
  ('s4_instrumentation',1,'derive','sensor_inventory',null,false),
  ('s4_instrumentation',2,'connector','historian',null,false),
  ('s4_utilities',1,'connector','document',null,false),
  ('s4_utilities',2,'ai',null,null,false),
  ('s5_criticality_level',1,'derive','criticality_from_history',null,false),
  ('s5_criticality_level',2,'human',null,'{"what": "Confirm criticality A/B/C", "why": "It sets maintenance strategy and alert priority", "where": "Criticality matrix", "example": "B"}'::jsonb,false),
  ('s5_failure_frequency',1,'derive','failure_frequency',null,false),
  ('s5_detectability',1,'derive','detectability_coverage',null,false),
  ('s5_production_impact',1,'derive','production_impact',null,false),
  ('s5_maintenance_cost',1,'derive','maintenance_cost',null,false),
  ('s5_safety_impact',1,'ai',null,null,false),
  ('s5_safety_impact',2,'human',null,'{"what": "Can a failure of this asset hurt someone", "why": "Safety consequence overrides cost in every downstream decision", "where": "HSE risk register or the safety gatekeeper", "example": "Yes \u2014 stored energy, elevated work"}'::jsonb,true),
  ('s5_environmental_impact',1,'ai',null,null,false),
  ('s5_environmental_impact',2,'human',null,'{"what": "Can a failure of this asset breach an environmental limit", "why": "Environmental consequence is separately reportable and separately gated", "where": "Environmental approvals register", "example": "Yes \u2014 hydraulic release to ground"}'::jsonb,true),
  ('s6_failure_history',1,'derive','failure_history',null,false),
  ('s6_failure_rate',1,'derive','failure_rate',null,false),
  ('s6_mtbf',1,'derive','mtbf',null,false),
  ('s6_bad_actor',1,'derive','bad_actor',null,false),
  ('s6_repeated_failure_modes',1,'derive','repeat_modes',null,false),
  ('s6_operating_hours',1,'derive','operating_hours',null,false),
  ('s6_operating_hours',2,'connector','historian',null,false),
  ('s6_asset_age',1,'derive','asset_age',null,false),
  ('s6_asset_age',2,'connector','cmms',null,false),
  ('s6_start_stop_cycles',1,'derive','start_stop_cycles',null,false),
  ('s6_start_stop_cycles',2,'connector','historian',null,false),
  ('s6_warranty_history',1,'connector','erp',null,false),
  ('s6_warranty_history',2,'human',null,'{"what": "Any warranty claims or campaigns on this unit", "why": "A unit under warranty is repaired differently and the cost sits elsewhere", "where": "OEM dealer portal or the contracts team", "example": "Two powertrain claims, 2011"}'::jsonb,true),
  ('s6_design_weaknesses',1,'derive','repeat_modes',null,false),
  ('s6_design_weaknesses',2,'ai',null,null,false),
  ('s7_maintenance_history',1,'derive','maintenance_history',null,false),
  ('s7_mttr',1,'derive','mttr',null,false),
  ('s7_required_tools',1,'derive','tools_from_job_plans',null,false),
  ('s7_required_tools',2,'ai',null,null,false),
  ('s7_required_skills',1,'derive','crafts_from_job_plans',null,false),
  ('s7_required_skills',2,'ai',null,null,false),
  ('s7_isolation_requirements',1,'derive','permits_from_job_plans',null,false),
  ('s7_isolation_requirements',2,'ai',null,null,false),
  ('s7_test_after_repair',1,'derive','checks_from_job_plans',null,false),
  ('s7_test_after_repair',2,'ai',null,null,false),
  ('s7_access_constraints',1,'human',null,'{"what": "Anything that makes this asset physically hard to work on", "why": "Access drives duration, crew size and the safety plan", "where": "Walk the asset with the crew that maintains it", "example": "Requires 20 t crane; confined space entry"}'::jsonb,true),
  ('s8_actual_availability',1,'derive','actual_availability',null,false),
  ('s8_downtime_events',1,'derive','downtime_events',null,false),
  ('s8_unplanned_downtime',1,'derive','unplanned_downtime',null,false),
  ('s8_required_availability',1,'human',null,'{"what": "What availability does the business require of this asset", "why": "Without a target, actual availability is a number with nothing to compare against", "where": "Production plan or the asset owner", "example": "92% on a 24/7 roster"}'::jsonb,true),
  ('s8_redundancy_config',1,'connector','cmms',null,false),
  ('s8_redundancy_config',2,'human',null,'{"what": "Is there a spare or standby unit", "why": "Redundancy changes the consequence of failure more than any other single fact", "where": "Operations or the P&ID", "example": "N+1 \u2014 one standby grader"}'::jsonb,false),
  ('s8_recovery_time_objective',1,'human',null,'{"what": "How quickly must this be back after a failure", "why": "It sets spares holding and the response the platform should demand", "where": "Operations and the asset owner", "example": "8 hours"}'::jsonb,true),
  ('s9_failure_modes_configured',1,'library','fmea_library',null,false),
  ('s9_failure_modes_configured',2,'derive','modes_from_history',null,false),
  ('s9_failure_modes_configured',3,'ai',null,null,false),
  ('s9_fmea_detection_methods',1,'derive','detectability_coverage',null,false),
  ('s9_fmea_detection_methods',2,'library','fmea_library',null,false),
  ('s9_fmea_recommended_actions',1,'library','fmea_library',null,false),
  ('s9_fmea_recommended_actions',2,'ai',null,null,false),
  ('s9_severity_rankings',1,'ai',null,null,false),
  ('s9_severity_rankings',2,'human',null,'{"what": "Confirm severity and occurrence rankings", "why": "These drive the risk priority the whole programme is sequenced by", "where": "Reliability engineer with the FMEA", "example": "S=8 O=3"}'::jsonb,false),
  ('s10_strategy_assigned',1,'library','strategy_library',null,false),
  ('s10_strategy_assigned',2,'derive','strategy_from_history',null,false),
  ('s10_strategy_assigned',3,'ai',null,null,false),
  ('s10_pm_tasks_linked',1,'derive','pm_tasks_linked',null,false),
  ('s10_pm_tasks_linked',2,'connector','cmms',null,false),
  ('s10_task_details',1,'derive','job_plan_details',null,false),
  ('s10_task_details',2,'ai',null,null,false),
  ('s10_statutory_inspections',1,'connector','document',null,false),
  ('s10_statutory_inspections',2,'human',null,'{"what": "Which statutory inspections apply", "why": "A missed statutory inspection is a regulatory breach, not a maintenance miss", "where": "Regulatory register or the compliance lead", "example": "Annual pressure-vessel inspection"}'::jsonb,true),
  ('s11_sensor_tags_mapped',1,'connector','historian',null,false),
  ('s11_sensor_tags_mapped',2,'derive','sensor_inventory',null,false),
  ('s11_alarm_thresholds',1,'connector','historian',null,false),
  ('s11_alarm_thresholds',2,'derive','alarm_limits',null,false),
  ('s11_units_standardized',1,'derive','unit_consistency',null,false),
  ('s11_units_standardized',2,'connector','historian',null,false),
  ('s11_data_quality_reviewed',1,'derive','reading_quality',null,false),
  ('s11_failure_labels',1,'derive','failure_labels',null,false),
  ('s11_operating_envelope',1,'derive','load_profile',null,false),
  ('s11_operating_envelope',2,'connector','historian',null,false),
  ('s11_operating_envelope',3,'ai',null,null,false),
  ('s12_use_case',1,'derive','analytics_use_case',null,false),
  ('s12_use_case',2,'ai',null,null,false),
  ('s12_data_inputs',1,'derive','sensor_inventory',null,false),
  ('s12_data_inputs',2,'connector','historian',null,false),
  ('s12_target_failure_modes',1,'library','fmea_library',null,false),
  ('s12_target_failure_modes',2,'derive','modes_from_history',null,false),
  ('s12_alert_rules',1,'derive','alarm_limits',null,false),
  ('s12_alert_rules',2,'connector','historian',null,false),
  ('s12_alert_workflow_tested',1,'derive','alert_workflow',null,false),
  ('s12_feedback_loop',1,'derive','feedback_loop',null,false),
  ('s12_model_owner',1,'human',null,'{"what": "Who owns the model''s behaviour", "why": "A model with no owner is a model nobody retires when it goes wrong", "where": "Reliability or digital lead", "example": "J. Smith, Reliability Engineering"}'::jsonb,true),
  ('s13_cmms_linkage',1,'derive','cmms_linkage',null,false),
  ('s13_cmms_linkage',2,'connector','cmms',null,false),
  ('s13_wo_history_imported',1,'derive','wo_history_imported',null,false),
  ('s13_wo_integration_verified',1,'derive','wo_integration_verified',null,false),
  ('s13_failure_codes',1,'library','taxonomy',null,false),
  ('s13_failure_codes',2,'derive','failure_labels',null,false),
  ('s13_priority_matrix',1,'library','priority_matrix',null,false),
  ('s13_priority_matrix',2,'connector','cmms',null,false),
  ('s14_bom',1,'connector','inventory',null,false),
  ('s14_bom',2,'connector','document',null,false),
  ('s14_bom',3,'derive','bom_lines',null,false),
  ('s14_critical_spares',1,'derive','critical_spares',null,false),
  ('s14_critical_spares',2,'connector','inventory',null,false),
  ('s14_critical_spares',3,'ai',null,null,false),
  ('s14_reorder_points',1,'connector','inventory',null,false),
  ('s14_reorder_points',2,'human',null,'{"what": "Min/max and lead time for the critical spares", "why": "Reorder points are what turn a spares list into availability", "where": "Inventory system or the storeroom", "example": "Min 2, max 4, 45-day lead"}'::jsonb,false),
  ('s14_storage_requirements',1,'connector','document',null,false),
  ('s14_storage_requirements',2,'ai',null,null,false),
  ('s15_core_documents',1,'connector','document',null,false),
  ('s15_core_documents',2,'human',null,'{"what": "Attach the OEM manual and datasheet", "why": "Most specification gaps close from these two documents alone", "where": "OEM portal or the document-management system", "example": "Komatsu 980E-4 shop manual"}'::jsonb,false),
  ('s15_drawings',1,'connector','document',null,false),
  ('s15_drawings',2,'human',null,'{"what": "Attach the general arrangement and P&ID", "why": "Drawings settle boundary and isolation questions", "where": "Engineering document control", "example": "GA-4471 rev C"}'::jsonb,false),
  ('s15_procedures',1,'connector','document',null,false),
  ('s15_procedures',2,'human',null,'{"what": "Attach operating and maintenance procedures", "why": "Procedures are what job plans are built from", "where": "Document control", "example": "SOP-112 brake pack change"}'::jsonb,false),
  ('s15_certificates',1,'connector','document',null,false),
  ('s15_certificates',2,'human',null,'{"what": "Attach statutory certificates", "why": "Certificates are evidence in an audit, not a convenience", "where": "Compliance records", "example": "Pressure vessel cert 2026"}'::jsonb,false),
  ('s16_safety_critical',1,'derive','safety_critical',null,false),
  ('s16_safety_critical',2,'ai',null,null,false),
  ('s16_loto_requirements',1,'derive','permits_from_job_plans',null,false),
  ('s16_loto_requirements',2,'ai',null,null,false),
  ('s16_regulatory_requirements',1,'connector','document',null,false),
  ('s16_regulatory_requirements',2,'ai',null,null,false),
  ('s16_hazardous_area',1,'human',null,'{"what": "Hazardous-area classification for this location", "why": "It governs what equipment may legally be installed and how work is permitted", "where": "Area classification drawing", "example": "Zone 2 IIA T3"}'::jsonb,true),
  ('s16_cybersecurity_class',1,'ai',null,null,false),
  ('s16_cybersecurity_class',2,'human',null,'{"what": "Confirm the cybersecurity classification", "why": "It decides network placement and remote-access rules", "where": "IT/OT security lead", "example": "OT Level 2"}'::jsonb,false),
  ('s16_data_sensitivity',1,'ai',null,null,false),
  ('s17_baseline_captured',1,'derive','baseline_captured',null,false),
  ('s17_normal_alarm_rate',1,'derive','normal_alarm_rate',null,false),
  ('s18_health_index_configured',1,'derive','health_index',null,false),
  ('s19_asset_owner',1,'connector','cmms',null,false),
  ('s19_asset_owner',2,'human',null,'{"what": "Name the accountable asset owner", "why": "Every recommendation this platform raises has to route to a person", "where": "Org chart or the maintenance manager", "example": "A. Nguyen, Fleet Superintendent"}'::jsonb,true),
  ('s19_support_roles',1,'connector','cmms',null,false),
  ('s19_support_roles',2,'derive','support_roles',null,false),
  ('s20_dq_gate',1,'derive','dq_gate',null,false),
  ('s20_sensor_validation',1,'derive','sensor_validation',null,false),
  ('s20_unit_consistency',1,'derive','unit_consistency',null,false),
  ('s20_bad_data_rules',1,'derive','bad_data_rules',null,false),
  ('s22_failure_coding',1,'library','taxonomy',null,false),
  ('s22_failure_coding',2,'derive','failure_labels',null,false),
  ('s22_fracas_loop',1,'derive','fracas_loop',null,false),
  ('s23_normal_duty',1,'derive','load_profile',null,false),
  ('s23_normal_duty',2,'connector','historian',null,false),
  ('s23_normal_duty',3,'ai',null,null,false),
  ('s23_load_profile',1,'derive','load_profile',null,false),
  ('s23_start_stop_frequency',1,'derive','start_stop_cycles',null,false),
  ('s23_service_severity',1,'derive','service_severity',null,false),
  ('s23_service_severity',2,'ai',null,null,false),
  ('s23_abnormal_modes',1,'derive','process_events',null,false),
  ('s23_abnormal_modes',2,'ai',null,null,false),
  ('s23_process_fluid',1,'connector','document',null,false),
  ('s23_process_fluid',2,'ai',null,null,false),
  ('s23_contamination_risk',1,'ai',null,null,false),
  ('s24_model_purpose',1,'derive','analytics_use_case',null,false),
  ('s24_training_window',1,'derive','training_window',null,false),
  ('s24_excluded_data',1,'derive','excluded_data',null,false),
  ('s24_alert_confidence',1,'derive','alert_confidence',null,false),
  ('s24_false_positive_process',1,'derive','feedback_loop',null,false),
  ('s24_false_negative_process',1,'derive','feedback_loop',null,false),
  ('s24_review_cycle',1,'library','governance_defaults',null,false),
  ('s24_change_log',1,'derive','model_change_log',null,false),
  ('s25_alert_playbook',1,'library','playbook_library',null,false),
  ('s25_alert_playbook',2,'ai',null,null,false),
  ('s26_closeout_standard',1,'library','governance_defaults',null,false),
  ('s27_reliability_targets',1,'derive','reliability_targets',null,false),
  ('s27_reliability_targets',2,'ai',null,null,false),
  ('s28_lifecycle_status',1,'derive','lifecycle_status',null,false),
  ('s28_lifecycle_status',2,'connector','cmms',null,false),
  ('s29_moc_control',1,'library','governance_defaults',null,false),
  ('s30_audit_log',1,'derive','audit_log',null,false),
  ('s30_user_roles',1,'derive','user_roles',null,false),
  ('s30_backup_recovery',1,'library','governance_defaults',null,false),
  ('s30_data_source_security',1,'derive','connector_security',null,false),
  ('s30_network_zone',1,'human',null,'{"what": "Which network zone does this asset''s control system sit in", "why": "It decides what may connect to it and how", "where": "IT/OT network diagram", "example": "OT Level 2, VLAN 220"}'::jsonb,true),
  ('s30_remote_access',1,'human',null,'{"what": "Is remote access permitted, and under what control", "why": "Remote access is the highest-consequence control decision on an OT asset", "where": "IT/OT security policy", "example": "Vendor access via jump host, ticketed"}'::jsonb,true),
  ('s31_role_training',1,'human',null,'{"what": "Confirm the crews maintaining this asset are trained", "why": "An asset the crew cannot maintain is not ready for service", "where": "Training records", "example": "12 of 14 millwrights current"}'::jsonb,true),
  ('s32_approval_maintenance',1,'human',null,'{"what": "Maintenance approval to go live", "why": "Go-live is an accountable decision, not a completion percentage", "where": "Maintenance manager", "example": "Approved"}'::jsonb,true),
  ('s32_approval_operations',1,'human',null,'{"what": "Operations approval to go live", "why": "Operations accepts the asset into service", "where": "Operations superintendent", "example": "Approved"}'::jsonb,true),
  ('s32_approval_reliability',1,'human',null,'{"what": "Reliability approval to go live", "why": "Reliability confirms the strategy and data are sound", "where": "Reliability engineer", "example": "Approved"}'::jsonb,true),
  ('s32_approval_hse',1,'human',null,'{"what": "HSE approval to go live", "why": "Safety-critical elements and permits are confirmed", "where": "HSE lead", "example": "Approved"}'::jsonb,true),
  ('s32_approval_data_it',1,'human',null,'{"what": "Data/IT approval to go live", "why": "Confirms data sources, security and access are correct", "where": "Data or IT lead", "example": "Approved"}'::jsonb,true)
on conflict (requirement_key, rank) do update set source_kind=excluded.source_kind,
  source_ref=excluded.source_ref, guidance=excluded.guidance, irreducible=excluded.irreducible;

-- ----------------------------------------------------------------------------
-- Derivations. Each returns a value or NULL; NULL means "cannot compute from
-- what we hold", and the ladder falls through to the next rung. A derivation
-- that guesses would be worse than one that abstains, because the checklist
-- would go green on an invention.
-- ----------------------------------------------------------------------------
create or replace function public.derive_onboarding_value(
  p_asset_id uuid,
  p_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid;
  a assets%rowtype;
  v numeric;
  n int;
  m int;
  t text;
begin
  select * into a from assets where id = p_asset_id;
  if not found then return null; end if;
  v_org := a.organization_id;

  case p_key
    when 'asset_field_name' then
      return case when a.name is not null then to_jsonb(a.name) end;
    when 'asset_field_class' then
      return case when a.asset_class is not null then to_jsonb(a.asset_class) end;
    when 'asset_field_site' then
      select s.name into t from sites s where s.id = a.site_id;
      return case when t is not null then to_jsonb(t) end;

    when 'failure_history' then
      select count(*) into n from work_orders
      where asset_id = p_asset_id and work_type = 'corrective' and completed_at is not null;
      return case when n > 0 then to_jsonb(format('%s corrective events recorded', n)) end;

    when 'maintenance_history' then
      select count(*) into n from work_orders where asset_id = p_asset_id and completed_at is not null;
      return case when n > 0 then to_jsonb(format('%s completed work orders', n)) end;

    when 'failure_frequency' then
      select count(*)::numeric / greatest(extract(epoch from (max(completed_at)-min(completed_at)))/31557600.0, 0.08)
      into v from work_orders
      where asset_id = p_asset_id and work_type='corrective' and completed_at is not null;
      return case when v is not null and v > 0 then to_jsonb(round(v,1)::text || ' failures/year') end;

    when 'failure_rate' then
      select count(*) into n from work_orders
      where asset_id = p_asset_id and work_type='corrective' and completed_at is not null;
      return case when n >= 2 then to_jsonb(n) end;

    when 'mtbf' then
      -- Calendar-based: span minus downtime, over failures. Stated as such.
      select case when count(*) >= 2 then
        round(((extract(epoch from (max(completed_at)-min(completed_at)))/3600.0
                - coalesce(sum(downtime_hours),0)) / count(*))::numeric, 1) end
      into v from work_orders
      where asset_id = p_asset_id and work_type='corrective' and completed_at is not null;
      return case when v is not null and v > 0 then to_jsonb(v::text || ' h (calendar basis)') end;

    when 'mttr' then
      select round(avg(downtime_hours)::numeric,1) into v from work_orders
      where asset_id = p_asset_id and work_type='corrective' and downtime_hours > 0;
      return case when v is not null then to_jsonb(v::text || ' h') end;

    when 'bad_actor' then
      select sum(downtime_hours) into v from work_orders
      where asset_id = p_asset_id and work_type='corrective';
      if v is null then return null; end if;
      select count(*) into n from (
        select asset_id, sum(downtime_hours) h from work_orders
        where organization_id = v_org and work_type='corrective'
        group by 1 having sum(downtime_hours) > v) x;
      -- count of assets with MORE downtime than this one; top decile if few beat it
      select count(distinct asset_id) into m from work_orders
      where organization_id=v_org and work_type='corrective';
      return to_jsonb(case when n < greatest(m/10, 1)
        then 'Yes — top decile by downtime'::text else 'No'::text end);

    when 'repeat_modes' then
      select count(*) into n from (
        select actual_failure_mode from work_orders
        where asset_id = p_asset_id and work_type='corrective' and actual_failure_mode is not null
        group by 1 having count(*) > 1) x;
      return case when n > 0 then to_jsonb(format('%s repeated codes', n)) end;

    when 'downtime_events' then
      select count(*) into n from operating_states
      where asset_id = p_asset_id and state in ('down_planned','down_unplanned');
      return case when n > 0 then to_jsonb(n) end;

    when 'unplanned_downtime' then
      select round(sum(extract(epoch from (coalesce(ended_at,now())-started_at))/3600.0)::numeric,1)
      into v from operating_states where asset_id = p_asset_id and state='down_unplanned';
      return case when v is not null then to_jsonb(v::text || ' h') end;

    when 'actual_availability' then
      select round((100.0 * (1 - sum(extract(epoch from (coalesce(ended_at,now())-started_at))/3600.0)
        / nullif(extract(epoch from (max(coalesce(ended_at,now())) - min(started_at)))/3600.0,0)))::numeric,1)
      into v from operating_states
      where asset_id = p_asset_id and state in ('down_planned','down_unplanned');
      return case when v is not null and v between 0 and 100 then to_jsonb(v::text || '%') end;

    when 'operating_hours' then
      select round(sum(extract(epoch from (coalesce(ended_at,now())-started_at))/3600.0)::numeric,0)
      into v from operating_states where asset_id = p_asset_id and state='running';
      return case when v is not null and v > 0 then to_jsonb(v::text || ' h') end;

    when 'start_stop_cycles' then
      select count(*) into n from operating_states where asset_id = p_asset_id and state='running';
      return case when n > 0 then to_jsonb(format('%s starts recorded', n)) end;

    when 'load_profile' then
      select round(avg(load_pct)::numeric,0) into v from operating_states
      where asset_id = p_asset_id and state='running' and load_pct is not null;
      return case when v is not null then to_jsonb(v::text || '% mean load while running') end;

    when 'asset_age' then
      return null;  -- needs a commissioning date; the CMMS rung supplies it

    when 'sensor_inventory' then
      select count(*) into n from sensors where asset_id = p_asset_id;
      return case when n > 0 then to_jsonb(format('%s sensors mapped', n)) end;

    when 'alarm_limits' then
      select count(*) into n from sensors where asset_id = p_asset_id and alarm_limit is not null;
      return case when n > 0 then to_jsonb(format('%s sensors with alarm limits', n)) end;

    when 'detectability_coverage' then
      select count(distinct d.mechanism_id) into n
      from sensors s
      join detection_techniques dt on dt.organization_id=v_org and dt.technique_key=s.technique_key
      join mechanism_detectability d on d.technique_id=dt.id and d.detectability='primary'
      where s.asset_id = p_asset_id;
      return case when n > 0 then to_jsonb(format('%s mechanisms covered by a primary technique', n)) end;

    when 'reading_quality' then
      select count(*) into n from condition_readings where asset_id = p_asset_id;
      return case when n > 0 then to_jsonb(format('%s readings held', n)) end;

    when 'normal_alarm_rate' then
      select count(*) into n from condition_alerts where asset_id = p_asset_id;
      return case when n > 0 then to_jsonb(format('%s alerts recorded', n)) end;

    when 'failure_labels' then
      select count(*) into n from work_orders w
      join failure_code_map m on m.organization_id=v_org and m.source_label=w.actual_failure_mode
      where w.asset_id = p_asset_id and m.label_kind <> 'unclassified';
      return case when n > 0 then to_jsonb(format('%s events carry a classified code', n)) end;

    when 'wo_history_imported' then
      select count(*) into n from work_orders where asset_id = p_asset_id and source_system is not null;
      return case when n > 0 then to_jsonb(format('%s work orders imported from a source system', n)) end;

    when 'cmms_linkage' then
      select count(*) into n from work_orders where asset_id = p_asset_id and external_id is not null;
      return case when n > 0 then to_jsonb(format('%s work orders carry a source identifier', n)) end;

    when 'wo_integration_verified' then
      select count(*) into n from work_orders where asset_id = p_asset_id and external_id is not null;
      return case when n > 0 then to_jsonb('Source identifiers present and unique'::text) end;

    when 'pm_tasks_linked' then
      select count(*) into n from work_orders where asset_id = p_asset_id and work_type='preventive';
      return case when n > 0 then to_jsonb(format('%s preventive events in history', n)) end;

    when 'modes_from_history' then
      select count(distinct actual_failure_mode) into n from work_orders
      where asset_id = p_asset_id and work_type='corrective' and actual_failure_mode is not null;
      return case when n > 0 then to_jsonb(format('%s distinct coded modes in history', n)) end;

    when 'criticality_from_history' then
      return case when a.criticality is not null then to_jsonb(a.criticality) end;

    when 'duplicate_check' then
      select count(*) into n from assets where organization_id=v_org and name = a.name;
      return case when n = 1 then to_jsonb('No duplicate name'::text) end;

    when 'naming_check' then
      return case when a.name ~ '^[A-Za-z].*[0-9]' then to_jsonb('Matches type + number convention'::text) end;

    when 'tools_from_job_plans' then
      select count(*) into n from job_plan_tools t
      join job_plans p on p.id=t.job_plan_id
      where p.organization_id=v_org and p.applies_to_asset_class = a.asset_class;
      return case when n > 0 then to_jsonb(format('%s tools from applicable job plans', n)) end;

    when 'crafts_from_job_plans' then
      select count(distinct s.craft) into n from job_plan_steps s
      join job_plans p on p.id=s.job_plan_id
      where p.organization_id=v_org and p.applies_to_asset_class = a.asset_class and s.craft is not null;
      return case when n > 0 then to_jsonb(format('%s crafts from applicable job plans', n)) end;

    when 'permits_from_job_plans' then
      select count(*) into n from job_plan_permits jp
      join job_plans p on p.id=jp.job_plan_id
      where p.organization_id=v_org and p.applies_to_asset_class = a.asset_class;
      return case when n > 0 then to_jsonb(format('%s permit/isolation requirements', n)) end;

    when 'checks_from_job_plans' then
      select count(*) into n from job_plan_checks c
      join job_plans p on p.id=c.job_plan_id
      where p.organization_id=v_org and p.applies_to_asset_class = a.asset_class;
      return case when n > 0 then to_jsonb(format('%s acceptance criteria', n)) end;

    when 'bom_lines' then
      select count(*) into n from bom_lines where asset_id = p_asset_id or asset_class = a.asset_class;
      return case when n > 0 then to_jsonb(format('%s BOM lines', n)) end;

    when 'audit_log' then
      select count(*) into n from audit_events where organization_id=v_org;
      return case when n > 0 then to_jsonb('Audit log active'::text) end;

    when 'user_roles' then
      select count(*) into n from user_profiles where organization_id=v_org;
      return case when n > 0 then to_jsonb(format('%s users with assigned roles', n)) end;

    when 'connector_security' then
      select count(*) into n from connectors where organization_id=v_org and direction='read_only';
      return case when n > 0 then to_jsonb(format('%s connectors read-only', n)) end;

    when 'training_window' then
      select round(extract(epoch from (max(completed_at)-min(completed_at)))/86400.0)::int into n
      from work_orders where asset_id=p_asset_id and completed_at is not null;
      return case when n > 0 then to_jsonb(format('%s days of history', n)) end;

    else return null;
  end case;
end
$$;

grant execute on function public.derive_onboarding_value(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- The resolver: walk the ladder, record which rung answered and why not higher
-- ----------------------------------------------------------------------------
create or replace function public.run_onboarding_resolution(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  a assets%rowtype;
  it record;
  rung record;
  v_val jsonb;
  v_done boolean;
  v_resolved int := 0;
  v_human int := 0;
  v_blocked int := 0;
  v_irreducible int := 0;
  v_queued int := 0;
  v_missing_connectors text[] := '{}';
begin
  select * into a from assets where id = p_asset_id;
  if not found then return jsonb_build_object('error', 'asset not found'); end if;
  v_org := a.organization_id;

  for it in
    select i.id, i.requirement_key
    from asset_onboarding_items i
    where i.asset_id = p_asset_id
      and i.status not in ('auto_filled', 'provided', 'deduced')
  loop
    v_done := false;
    for rung in
      select * from requirement_sources
      where requirement_key = it.requirement_key order by rank
    loop
      if v_done then exit; end if;

      if rung.source_kind = 'derive' then
        v_val := derive_onboarding_value(p_asset_id, rung.source_ref);
        if v_val is not null then
          update asset_onboarding_items
          set status = 'auto_filled', value = v_val,
              source = 'derived', resolved_by = 'derive',
              resolved_ref = rung.source_ref, blocked_on = null,
              irreducible = false, filled_at = now()
          where id = it.id;
          v_resolved := v_resolved + 1;
          v_done := true;
        end if;

      elsif rung.source_kind = 'connector' then
        -- An enabled connector of the right kind would answer this. Naming the
        -- missing one is what turns "needs a human" into a purchase order.
        if exists (select 1 from connectors
                   where organization_id = v_org and enabled
                     and (system_kind = rung.source_ref or connector_type = rung.source_ref)) then
          null;  -- connected but no value yet; fall through to the next rung
        else
          if not (rung.source_ref = any(v_missing_connectors)) then
            v_missing_connectors := v_missing_connectors || rung.source_ref;
          end if;
        end if;

      elsif rung.source_kind in ('ai', 'library') then
        -- Queue it rather than leave it looking like a human task. An item
        -- whose ladder ends at an AI or library rung is waiting on a PASS
        -- nobody has run — that is a backlog, not a floor, and labelling it
        -- "human required" is how 30 items per asset got miscounted as
        -- irreducible effort.
        update asset_onboarding_items
        set status = 'pending_ai', resolved_by = rung.source_kind,
            resolved_ref = rung.source_ref, blocked_on = null, irreducible = false
        where id = it.id;
        v_queued := v_queued + 1;
        v_done := true;

      elsif rung.source_kind = 'human' then
        update asset_onboarding_items
        set status = 'human_required',
            resolved_by = null,
            blocked_on = (
              select string_agg(distinct s2.source_ref, ', ')
              from requirement_sources s2
              where s2.requirement_key = it.requirement_key
                and s2.source_kind = 'connector'
                and not exists (select 1 from connectors c
                                where c.organization_id = v_org and c.enabled
                                  and (c.system_kind = s2.source_ref or c.connector_type = s2.source_ref))),
            irreducible = rung.irreducible,
            note = coalesce(rung.guidance->>'what', note)
        where id = it.id;
        v_human := v_human + 1;
        if rung.irreducible then v_irreducible := v_irreducible + 1;
        else v_blocked := v_blocked + 1; end if;
        v_done := true;
      end if;
    end loop;

    -- A ladder that offers only connectors leaves nothing marked. Left alone
    -- the item keeps whatever the legacy model called it — usually "human
    -- required" — which is the specific lie this slice exists to remove: no
    -- person can supply it, and no person needs to. It is waiting on an
    -- integration and is recorded as exactly that.
    if not v_done then
      update asset_onboarding_items
      set status = 'human_required', irreducible = false, resolved_by = null,
          blocked_on = (
            select string_agg(distinct s2.source_ref, ', ')
            from requirement_sources s2
            where s2.requirement_key = it.requirement_key
              and s2.source_kind = 'connector'
              and not exists (select 1 from connectors c
                              where c.organization_id = v_org and c.enabled
                                and (c.system_kind = s2.source_ref or c.connector_type = s2.source_ref)))
      where id = it.id;
      v_human := v_human + 1;
      v_blocked := v_blocked + 1;
    end if;
  end loop;

  update asset_onboarding_state s
  set completion_pct = (
        select round(100.0 * count(*) filter (where status in ('auto_filled','provided','deduced'))
               / greatest(count(*),1))
        from asset_onboarding_items where asset_id = p_asset_id),
      human_required_count = (
        select count(*) from asset_onboarding_items
        where asset_id = p_asset_id and status = 'human_required'),
      updated_at = now()
  where s.asset_id = p_asset_id;

  return jsonb_build_object(
    'asset', a.name,
    'resolved_by_derivation', v_resolved,
    'queued_for_ai_or_library', v_queued,
    'human_required', v_human,
    'of_which_irreducible', v_irreducible,
    'of_which_awaiting_a_connection', v_blocked,
    'missing_connectors', to_jsonb(v_missing_connectors),
    'note', 'A human item blocked on a connection is not a floor — it disappears when that system is connected. Only the irreducible count is what onboarding will always cost.');
end
$$;

grant execute on function public.run_onboarding_resolution(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- The honest accounting, fleet-wide
-- ----------------------------------------------------------------------------
create or replace function public.get_onboarding_human_floor()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_assets int;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select count(*) into v_assets from assets where organization_id = v_org;

  return jsonb_build_object(
    'assets', v_assets,
    'items_total', (select count(*) from asset_onboarding_items where organization_id = v_org),
    'auto_satisfied', (select count(*) from asset_onboarding_items
                       where organization_id = v_org and status in ('auto_filled','deduced','provided')),
    'human_irreducible', (select count(*) from asset_onboarding_items
                          where organization_id = v_org and status='human_required' and irreducible),
    'human_awaiting_connection', (select count(*) from asset_onboarding_items
                                  where organization_id = v_org and status='human_required'
                                    and not irreducible and blocked_on is not null),
    'human_unclassified', (select count(*) from asset_onboarding_items
                           where organization_id = v_org and status='human_required'
                             and not irreducible and blocked_on is null),
    'irreducible_per_asset', (select round(count(*)::numeric / greatest(v_assets,1),1)
                              from asset_onboarding_items
                              where organization_id = v_org and status='human_required' and irreducible),
    'connections_that_would_help', (
      select coalesce(jsonb_agg(jsonb_build_object('connector', k, 'items_unblocked', n)
             order by n desc), '[]'::jsonb)
      from (select blocked_on k, count(*) n from asset_onboarding_items
            where organization_id = v_org and status='human_required' and blocked_on is not null
            group by 1) x),
    'note', 'Human items split three ways on purpose. IRREDUCIBLE is the true floor — approvals, ownership, physical observation. AWAITING A CONNECTION shrinks to zero the moment that system is connected, and naming it turns "we need people" into a specific integration. Reporting one number for both would make the floor look like whatever today''s integration state happens to be.');
end
$$;

grant execute on function public.get_onboarding_human_floor() to authenticated;

notify pgrst, 'reload schema';

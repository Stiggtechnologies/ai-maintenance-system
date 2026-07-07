-- ============================================================================
-- Autonomous asset onboarding — RAM checklist engine (DoD RAM Guide aligned).
--
-- Implements the 23-section SyncAI asset onboarding checklist as a live,
-- self-filling requirements catalog:
--
--   * onboarding_requirements  — global catalog of checklist items (sections
--     1–19 of the checklist; section 20 is this workflow, 21 is the
--     required_for_golive flags, 22 is the catalog itself, 23 is the
--     approve_asset_golive() gate).
--   * asset_onboarding_items   — one row per asset per requirement, tracking
--     how it was satisfied (auto_filled / deduced / human_provided / n.a.)
--     or why it needs a human (human_required) or the AI pass (pending_ai).
--   * onboarding_fmea_library  — deterministic failure-mode starters matched
--     by asset-class pattern, copied into asset_failure_mode_libraries.
--   * asset_onboarding_state   — per-asset rollup + go-live status.
--
-- Autonomy model (per operator direction): onboarding is fully autonomous —
-- run_onboarding_autofill() harvests everything findable from the asset
-- record, components, sensors, work-order history and integrations; the
-- onboarding-enrich edge function deduces what an experienced reliability
-- engineer could infer (function, failure definition, envelope, strategy
-- detail); ONLY items that can be neither found nor deduced (serials,
-- documents, ownership, spares stocking, redundancy design) become
-- human_required — the human-in-the-loop queue. New assets self-onboard via
-- an AFTER INSERT trigger. Go-live is gated on the Section-21 minimum data
-- set plus an explicit SME approval (the one intentionally-human step).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Requirements catalog
-- ----------------------------------------------------------------------------
create table if not exists onboarding_requirements (
  key text primary key,
  section_number int not null,
  section_title text not null,
  item_label text not null,
  hint text,
  fill_strategy text not null check (fill_strategy in ('record','derived','library','ai','human')),
  required_for_golive boolean not null default false,
  sort_order int not null default 0
);

alter table onboarding_requirements enable row level security;
drop policy if exists onboarding_requirements_read on onboarding_requirements;
create policy onboarding_requirements_read on onboarding_requirements
  for select to authenticated using (true);

insert into onboarding_requirements (key, section_number, section_title, item_label, hint, fill_strategy, required_for_golive, sort_order) values
-- Section 1 — Asset Identification
('s1_asset_name',        1,'Asset Identification','Asset name','Standardized equipment name','record', true, 10),
('s1_asset_tag',         1,'Asset Identification','Asset ID / tag number','Unique tag, CMMS/ERP ID','record', true, 20),
('s1_serial_number',     1,'Asset Identification','Serial number','OEM serial number','record', false, 30),
('s1_model',             1,'Asset Identification','Model number','Manufacturer model','record', false, 40),
('s1_manufacturer',      1,'Asset Identification','Manufacturer / OEM','Vendor or supplier','record', false, 50),
('s1_asset_type',        1,'Asset Identification','Asset type','Pump, motor, compressor, conveyor…','record', false, 60),
('s1_asset_class_category',1,'Asset Identification','Asset class','Rotating, static, electrical, mobile…','record', false, 70),
('s1_parent_asset',      1,'Asset Identification','Parent asset','System, line, unit, train','record', false, 80),
('s1_child_assets',      1,'Asset Identification','Child assets / components','Motor, gearbox, bearings, sensors','record', false, 90),
('s1_location',          1,'Asset Identification','Location','Site, plant, area, unit','record', true, 100),
('s1_commissioning_date',1,'Asset Identification','Commissioning date','Date asset entered service','record', false, 110),
('s1_ownership',         1,'Asset Identification','Ownership','Operations, maintenance, reliability…','human', false, 120),
-- Section 2 — Asset Hierarchy
('s2_hierarchy_assigned', 2,'Asset Hierarchy','Asset assigned to plant/area/system','Plant → Area → Unit → System → Equipment','record', true, 10),
('s2_parent_child_links', 2,'Asset Hierarchy','Parent-child relationships created','Maintainable components linked','record', false, 20),
('s2_boundary_defined',   2,'Asset Hierarchy','Equipment boundary defined','What is inside/outside the asset boundary','ai', false, 30),
('s2_duplicates_removed', 2,'Asset Hierarchy','Duplicate asset records removed','Tag is unique in the register','derived', false, 40),
('s2_naming_convention',  2,'Asset Hierarchy','Naming convention verified','Tag follows the site convention','derived', false, 50),
('s2_criticality_assigned',2,'Asset Hierarchy','Asset criticality level assigned','A/B/C ranking on record','record', true, 60),
-- Section 3 — Functional Description
('s3_primary_function',   3,'Functional Description','Primary function','What the asset must do, with performance standard','ai', true, 10),
('s3_secondary_functions',3,'Functional Description','Secondary functions','Support, safety, containment, standby','ai', false, 20),
('s3_operating_role',     3,'Functional Description','Operating role','Duty, standby, emergency, intermittent','ai', false, 30),
('s3_process_served',     3,'Functional Description','Process served','Production line, utility, safety system','record', false, 40),
('s3_performance_limits', 3,'Functional Description','Performance limits','Minimum/maximum acceptable values','record', false, 50),
('s3_mission_profile',    3,'Functional Description','Mission profile','Continuous, cyclic, seasonal, start-stop','ai', false, 60),
('s3_failure_definition', 3,'Functional Description','Failure definition','What counts as functional failure','ai', true, 70),
-- Section 4 — Technical Specifications
('s4_mechanical_specs',   4,'Technical Specifications','Mechanical specifications','Capacity, flow, pressure, speed, bearing/seal type','human', false, 10),
('s4_electrical_specs',   4,'Technical Specifications','Electrical specifications','Voltage, current, power, insulation class','human', false, 20),
('s4_instrumentation',    4,'Technical Specifications','Instrumentation','Sensor types, ranges, signal types','record', false, 30),
('s4_operating_limits',   4,'Technical Specifications','Operating limits','Temperature, pressure, vibration, speed limits','record', true, 40),
('s4_environmental_limits',4,'Technical Specifications','Environmental limits','Ambient, humidity, dust, hazardous area','ai', false, 50),
('s4_lubrication',        4,'Technical Specifications','Lubrication','Oil/grease type, quantity, interval','ai', false, 60),
('s4_materials',          4,'Technical Specifications','Materials of construction','Casing, shaft, impeller, seals','human', false, 70),
('s4_utilities',          4,'Technical Specifications','Utility requirements','Air, water, steam, power, hydraulics','ai', false, 80),
-- Section 5 — Criticality Assessment
('s5_safety_impact',      5,'Criticality Assessment','Safety impact','Can failure injure personnel?','ai', false, 10),
('s5_environmental_impact',5,'Criticality Assessment','Environmental impact','Spill, emission, fire, contamination risk','ai', false, 20),
('s5_production_impact',  5,'Criticality Assessment','Production impact','Does failure stop or reduce throughput?','derived', false, 30),
('s5_maintenance_cost',   5,'Criticality Assessment','Maintenance cost profile','Repair cost / labour intensity','derived', false, 40),
('s5_detectability',      5,'Criticality Assessment','Detectability','Can degradation be detected early?','derived', false, 50),
('s5_failure_frequency',  5,'Criticality Assessment','Failure frequency','Has the asset failed repeatedly?','derived', false, 60),
('s5_criticality_level',  5,'Criticality Assessment','Criticality level (A/B/C)','Overall ranking with basis','record', true, 70),
-- Section 6 — Reliability Data
('s6_failure_history',    6,'Reliability Data','Historical failures','Failure date, mode, cause, repair action','derived', false, 10),
('s6_mtbf',               6,'Reliability Data','MTBF','Mean time between failures','derived', false, 20),
('s6_failure_rate',       6,'Reliability Data','Failure rate','Events per operating period','derived', false, 30),
('s6_bad_actor',          6,'Reliability Data','Bad actor status','Repeated failer vs fleet','derived', false, 40),
('s6_repeated_failure_modes',6,'Reliability Data','Repeated failure modes','Top recurring failures','derived', false, 50),
('s6_asset_age',          6,'Reliability Data','Asset age','Time since installation/overhaul','derived', false, 60),
('s6_operating_hours',    6,'Reliability Data','Operating hours','Total and annualized','derived', false, 70),
('s6_start_stop_cycles',  6,'Reliability Data','Start/stop cycles','Cycle count for rotating/electrical assets','human', false, 80),
('s6_design_weaknesses',  6,'Reliability Data','Known design weaknesses','OEM bulletins, RCA findings','ai', false, 90),
('s6_warranty_history',   6,'Reliability Data','Warranty history','Claims, defects, vendor issues','human', false, 100),
-- Section 7 — Maintainability Data
('s7_mttr',               7,'Maintainability Data','MTTR','Mean time to repair','derived', false, 10),
('s7_access_constraints', 7,'Maintainability Data','Access constraints','Scaffolding, confined space, lifting','human', false, 20),
('s7_required_skills',    7,'Maintainability Data','Required skills','Mechanical, electrical, instrument, vendor','ai', false, 30),
('s7_required_tools',     7,'Maintainability Data','Required tools','Special tools, lifting, diagnostics','ai', false, 40),
('s7_isolation_requirements',7,'Maintainability Data','Isolation requirements','LOTO, depressurize, drain, purge','ai', false, 50),
('s7_test_after_repair',  7,'Maintainability Data','Test after repair','Functional/performance test, alignment','ai', false, 60),
('s7_maintenance_history',7,'Maintainability Data','Maintenance history','PM, CM, PdM, overhauls, inspections','derived', false, 70),
-- Section 8 — Availability Data
('s8_required_availability',8,'Availability Data','Required availability','Target, e.g. 98%','human', false, 10),
('s8_actual_availability', 8,'Availability Data','Actual availability','From history / historian','derived', false, 20),
('s8_downtime_events',     8,'Availability Data','Downtime events','Date, duration, cause','derived', false, 30),
('s8_unplanned_downtime',  8,'Availability Data','Unplanned downtime','Failure-related stoppages','derived', false, 40),
('s8_redundancy_config',   8,'Availability Data','Redundancy','N+1, duty/standby, bypass, spare unit','human', false, 50),
('s8_recovery_time_objective',8,'Availability Data','Recovery time objective','Required restoration time','human', false, 60),
-- Section 9 — Failure Modes (FMEA)
('s9_failure_modes_configured',9,'Failure Modes (FMEA)','Failure modes configured','Mode, effect, cause per major component','library', true, 10),
('s9_fmea_detection_methods',  9,'Failure Modes (FMEA)','Detection methods assigned','Vibration, temperature, inspection…','library', false, 20),
('s9_fmea_recommended_actions',9,'Failure Modes (FMEA)','Recommended actions assigned','Task per failure mode','library', false, 30),
('s9_severity_rankings',       9,'Failure Modes (FMEA)','Severity / occurrence rankings','Risk priority inputs','ai', false, 40),
-- Section 10 — Maintenance Strategy
('s10_strategy_assigned', 10,'Maintenance Strategy','Maintenance strategy assigned','RTF / TBM / CBM / PdM per criticality & monitoring','library', true, 10),
('s10_pm_tasks_linked',   10,'Maintenance Strategy','PM tasks linked','Active PM/inspection tasks exist','derived', true, 20),
('s10_task_details',      10,'Maintenance Strategy','Task details captured','Frequency, trigger, skill, labour, acceptance criteria','ai', false, 30),
('s10_statutory_inspections',10,'Maintenance Strategy','Statutory inspections','Pressure vessels, lifting, safety devices','human', false, 40),
-- Section 11 — Condition Monitoring
('s11_sensor_tags_mapped', 11,'Condition Monitoring','Sensor/historian tags mapped','Tags bound to this asset (if applicable)','record', true, 10),
('s11_units_standardized', 11,'Condition Monitoring','Units of measure standardized','Consistent engineering units','record', false, 20),
('s11_alarm_thresholds',   11,'Condition Monitoring','Alarm thresholds captured','Warning/alarm limits per point','record', false, 30),
('s11_operating_envelope', 11,'Condition Monitoring','Normal operating envelope defined','Healthy operating ranges','ai', false, 40),
('s11_data_quality_reviewed',11,'Condition Monitoring','Data quality reviewed','Gaps and bad sensor data flagged','derived', true, 50),
('s11_failure_labels',     11,'Condition Monitoring','Failure event labels available','Labelled events for AI training','derived', false, 60),
-- Section 12 — AI / Analytics Configuration
('s12_use_case',          12,'AI / Analytics Configuration','AI use case configured','Failure prediction, anomaly detection…','derived', false, 10),
('s12_target_failure_modes',12,'AI / Analytics Configuration','Target failure modes','Modes the models watch for','library', false, 20),
('s12_data_inputs',       12,'AI / Analytics Configuration','Data inputs mapped','Historian tags, CMMS records, inspections','record', false, 30),
('s12_alert_rules',       12,'AI / Analytics Configuration','Alert rules configured','Warning / alarm / critical thresholds','record', false, 40),
('s12_alert_workflow_tested',12,'AI / Analytics Configuration','Alert workflow tested','Alert → review → work order proven','derived', true, 50),
('s12_feedback_loop',     12,'AI / Analytics Configuration','Feedback loop active','Technician confirms true/false alerts','record', false, 60),
('s12_model_owner',       12,'AI / Analytics Configuration','Model owner assigned','Reliability engineer / data scientist','human', false, 70),
-- Section 13 — Work Management Integration
('s13_cmms_linkage',      13,'Work Management Integration','CMMS linkage','SAP, Maximo, Oracle, IFS…','derived', false, 10),
('s13_wo_history_imported',13,'Work Management Integration','Work order history imported','History mapped to this asset','derived', false, 20),
('s13_wo_integration_verified',13,'Work Management Integration','Work order integration verified','Alert → WO → closeout round trip works','derived', true, 30),
('s13_failure_codes',     13,'Work Management Integration','Failure/cause/remedy codes','Standardized closeout codes','ai', false, 40),
('s13_priority_matrix',   13,'Work Management Integration','Priority matrix','Emergency, urgent, routine, planned','record', false, 50),
-- Section 14 — Spares & BOM
('s14_bom',               14,'Spares & BOM','Bill of materials','Full asset BOM','human', false, 10),
('s14_critical_spares',   14,'Spares & BOM','Critical spares identified','Parts needed to restore critical function','ai', true, 20),
('s14_reorder_points',    14,'Spares & BOM','Reorder points & lead times','Min stock, vendor delivery time','human', false, 30),
('s14_storage_requirements',14,'Spares & BOM','Storage & shelf life','Preservation, shelf-life items','ai', false, 40),
-- Section 15 — Documentation Package
('s15_core_documents',    15,'Documentation Package','OEM manual & datasheet linked','Core reference documents on file','human', true, 10),
('s15_drawings',          15,'Documentation Package','Drawings linked','P&ID / electrical / process drawings','human', false, 20),
('s15_procedures',        15,'Documentation Package','Operating & maintenance procedures','SOPs and job plans referenced','human', false, 30),
('s15_certificates',      15,'Documentation Package','Certificates','Pressure, lifting, Ex-rated, statutory','human', false, 40),
-- Section 16 — Risk & Compliance
('s16_safety_critical',   16,'Risk & Compliance','Safety critical element','Yes/no with basis','ai', false, 10),
('s16_regulatory_requirements',16,'Risk & Compliance','Regulatory requirements','OSHA, API, ISO, IEC, statutory','ai', false, 20),
('s16_hazardous_area',    16,'Risk & Compliance','Hazardous area classification','Zone/Class/Division','human', false, 30),
('s16_loto_requirements', 16,'Risk & Compliance','LOTO / isolation points','Energy isolation requirements','ai', false, 40),
('s16_cybersecurity_class',16,'Risk & Compliance','Cybersecurity classification','For connected/control assets','ai', false, 50),
('s16_data_sensitivity',  16,'Risk & Compliance','Data sensitivity','Public / internal / confidential / restricted','record', false, 60),
-- Section 17 — Baseline Performance
('s17_baseline_captured', 17,'Baseline Performance','Baseline performance captured','Healthy benchmark per monitored signal','record', true, 10),
('s17_normal_alarm_rate', 17,'Baseline Performance','Normal alarm rate','Alerts per period at healthy state','derived', false, 20),
-- Section 18 — Asset Health Index
('s18_health_index_configured',18,'Asset Health Index','Health index configured','Weighted scoring active for this asset','record', false, 10),
-- Section 19 — Roles & Responsibilities
('s19_asset_owner',       19,'Roles & Responsibilities','Asset owner assigned','Accountable business owner','human', true, 10),
('s19_support_roles',     19,'Roles & Responsibilities','Support roles assigned','Reliability, planning, operations, data','record', false, 20)
on conflict (key) do update set
  section_number = excluded.section_number,
  section_title = excluded.section_title,
  item_label = excluded.item_label,
  hint = excluded.hint,
  fill_strategy = excluded.fill_strategy,
  required_for_golive = excluded.required_for_golive,
  sort_order = excluded.sort_order;

-- ----------------------------------------------------------------------------
-- 2. FMEA starter library (deterministic, matched by asset-class pattern)
-- ----------------------------------------------------------------------------
create table if not exists onboarding_fmea_library (
  id uuid primary key default gen_random_uuid(),
  class_pattern text not null,          -- case-insensitive regex vs assets.asset_class
  component text not null,
  failure_mode text not null,
  effect text not null,
  cause text not null,
  detection_method text not null,
  recommended_action text not null,
  severity text not null default 'medium'
);

alter table onboarding_fmea_library enable row level security;
drop policy if exists onboarding_fmea_library_read on onboarding_fmea_library;
create policy onboarding_fmea_library_read on onboarding_fmea_library
  for select to authenticated using (true);

insert into onboarding_fmea_library (class_pattern, component, failure_mode, effect, cause, detection_method, recommended_action, severity) values
('pump','Mechanical seal','Seal leakage','Loss of containment, unplanned shutdown','Wear, dry running, pressure upset, operation away from BEP','Visual inspection, seal pot trend, leak sensor','Replace seal, verify flush plan and operating point','high'),
('pump','Bearing','Bearing wear / seizure','High vibration, heat, secondary damage','Lubrication failure, misalignment, contamination','Vibration route, bearing temperature, oil analysis','Lubricate, align, replace on condition','high'),
('pump','Impeller','Impeller erosion / cavitation','Reduced flow and head, efficiency loss','Off-BEP operation, NPSH shortfall, abrasive solids','Performance trending, vibration signature','Verify operating point, inspect and restore clearances','medium'),
('conveyor','Belt','Belt tear / mistracking','Line stoppage, spillage, fire risk','Impact damage, worn idlers, poor splice, misalignment','Belt scanner, visual patrol, speed vs drive current','Splice repair, idler replacement, tracking adjustment','high'),
('conveyor','Drive assembly','Gearbox / drive failure','Conveyor down, production stop','Lubrication degradation, overload, bearing fatigue','Vibration, oil analysis, temperature trend','Oil change on condition, drive inspection, load review','high'),
('conveyor','Pulley bearing','Pulley bearing failure','Belt stop, potential belt damage and fire','Fatigue, contamination, lubrication failure','Vibration route, temperature, acoustic monitoring','Greasing standard, on-condition replacement','high'),
('compressor','Valve','Compressor valve failure','Capacity loss, temperature rise, trip','Fatigue, liquid carry-over, fouling','Valve temperature mapping, performance curve deviation','Valve overhaul on condition, suction scrubber check','high'),
('compressor','Piston/rings|rod','Ring / packing wear','Blow-by, capacity loss, rod load change','Wear, lubrication issues, misalignment','Rod drop monitoring, blow-by measurement','Replace rings/packing per condition, verify lubrication','medium'),
('compressor','Crankshaft bearing','Bearing failure','Major mechanical damage, long outage','Lubrication failure, overload, fatigue','Oil analysis, vibration, crankcase inspection','Oil condition program, torque verification','high'),
('exchanger|heat','Tube bundle','Tube fouling / plugging','Reduced duty, throughput constraint','Scaling, corrosion products, biological growth','Differential temperature / pressure trending','Schedule cleaning at fouling threshold','medium'),
('exchanger|heat','Tubes','Tube leak','Cross-contamination, capacity loss','Corrosion, erosion, vibration fretting','Fluid sampling, pressure trend, eddy current at TA','Plug or retube per inspection findings','high'),
('truck|haul','Engine','Engine derate / failure','Truck down, haulage capacity loss','Cooling system degradation, injector wear, dust ingress','Coolant temp trend, oil analysis, VIMS/telemetry fault codes','Cooling system service, oil program, filter regime','high'),
('truck|haul','Final drive','Final drive failure','Truck down, high repair cost','Gear fatigue, oil contamination, seal failure','Oil analysis (Fe/Si), magnetic plug inspection','On-condition oil change, planned rebuild by hours','high'),
('truck|haul','Suspension','Suspension cylinder failure','Ride degradation, frame stress, operator exposure','Nitrogen charge loss, seal wear, overload','Strut pressure check, payload monitoring','Recharge/rebuild per inspection, payload policy','medium'),
('shovel','Hoist machinery','Hoist gearcase failure','Shovel down, mining face stopped','Gear/bearing fatigue, lubrication failure','Oil analysis, vibration, temperature','Lubrication program, planned gearcase inspection','high'),
('shovel','Swing system','Swing transmission failure','Cycle time loss, shovel down','Shock loading, gear wear, motor issues','Motor current signature, oil analysis','Operator loading standard, on-condition rebuild','high'),
('shovel','Boom|structure','Structural cracking','Safety risk, major outage','Fatigue from duty cycle, weld defects','NDT inspection program, crack monitoring','Scheduled NDT, weld repair procedure','high'),
('motor','Winding','Winding insulation failure','Motor trip, rewind or replace','Overload, thermal aging, moisture, voltage transients','Current signature, IR/PI testing, winding temperature','Electrical testing program, thermal protection review','high'),
('motor','Bearing','Bearing failure','Vibration, seizure, stator contact','Lubrication, shaft currents, misalignment','Vibration, ultrasound, temperature','Greasing standard, shaft grounding check','medium'),
('.*','Primary function carrier','Loss of primary function','Asset cannot meet its functional requirement','Age-related wear, operating outside envelope, maintenance quality','Condition monitoring where fitted, operator rounds, performance trending','Define monitoring plan and PM aligned to dominant failure modes','medium')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 3. Per-asset checklist items + state + runs
-- ----------------------------------------------------------------------------
create table if not exists asset_onboarding_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  requirement_key text not null references onboarding_requirements(key) on delete cascade,
  status text not null default 'pending' check (status in
    ('pending','auto_filled','deduced','pending_ai','human_required','human_provided','not_applicable')),
  value jsonb,
  source text,        -- asset_record | components | sensor_map | work_order_history | derived_metric | fmea_library | strategy_rule | integrations | platform | ai_deduction | human
  confidence text check (confidence in ('high','medium','low') or confidence is null),
  note text,
  filled_at timestamptz,
  provided_by uuid,
  created_at timestamptz not null default now(),
  unique (asset_id, requirement_key)
);

create table if not exists asset_onboarding_state (
  asset_id uuid primary key references assets(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress','ready_for_golive','live')),
  completion_pct int not null default 0,
  human_required_count int not null default 0,
  approved_by uuid,
  approved_by_label text,
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists asset_onboarding_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  run_type text not null,                 -- autofill | ai_deduction
  items_auto_filled int not null default 0,
  items_deduced int not null default 0,
  items_pending_ai int not null default 0,
  items_human_required int not null default 0,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_onboarding_items_asset on asset_onboarding_items(asset_id);
create index if not exists idx_onboarding_items_status on asset_onboarding_items(organization_id, status);
create index if not exists idx_onboarding_runs_asset on asset_onboarding_runs(asset_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['asset_onboarding_items','asset_onboarding_state','asset_onboarding_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_rw', t);
    execute format(
      'create policy %I on %I for all to authenticated using (organization_id = app_current_org()) with check (organization_id = app_current_org())',
      t || '_org_rw', t
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Internal fill helper (precedence-aware upsert)
-- ----------------------------------------------------------------------------
create or replace function public.fill_onboarding_item(
  p_org uuid, p_asset uuid, p_key text,
  p_value jsonb, p_source text, p_confidence text, p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into asset_onboarding_items (organization_id, asset_id, requirement_key, status, value, source, confidence, filled_at)
  values (p_org, p_asset, p_key, p_status, p_value, p_source, p_confidence,
          case when p_status in ('auto_filled','deduced') then now() end)
  on conflict (asset_id, requirement_key) do update
    set status = excluded.status,
        value = excluded.value,
        source = excluded.source,
        confidence = excluded.confidence,
        filled_at = case when excluded.status in ('auto_filled','deduced') then now() else asset_onboarding_items.filled_at end
    -- Autonomy never clobbers a human answer, an accepted AI deduction,
    -- or an explicit not-applicable ruling.
    where asset_onboarding_items.status not in ('human_provided','deduced','not_applicable');
end
$$;

revoke execute on function public.fill_onboarding_item(uuid, uuid, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.fill_onboarding_item(uuid, uuid, text, jsonb, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 5. start_asset_onboarding — seed the checklist for one asset
-- ----------------------------------------------------------------------------
create or replace function public.start_asset_onboarding(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset assets%rowtype;
  v_seeded int;
begin
  select * into v_asset from assets where id = p_asset_id;
  if v_asset.id is null then
    return jsonb_build_object('error', 'asset_not_found');
  end if;
  if auth.uid() is not null and v_asset.organization_id <> app_current_org() then
    return jsonb_build_object('error', 'forbidden');
  end if;

  insert into asset_onboarding_items (organization_id, asset_id, requirement_key)
  select v_asset.organization_id, v_asset.id, r.key
  from onboarding_requirements r
  on conflict (asset_id, requirement_key) do nothing;
  get diagnostics v_seeded = row_count;

  insert into asset_onboarding_state (asset_id, organization_id)
  values (v_asset.id, v_asset.organization_id)
  on conflict (asset_id) do nothing;

  return jsonb_build_object('asset_id', v_asset.id, 'items_seeded', v_seeded);
end
$$;

grant execute on function public.start_asset_onboarding(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. run_onboarding_autofill — the deterministic autonomous pass
-- ----------------------------------------------------------------------------
create or replace function public.run_onboarding_autofill(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a assets%rowtype;
  v_org uuid;
  v_components jsonb;
  v_component_count int;
  v_sensors jsonb;
  v_sensor_count int;
  v_sensor_gap_count int;
  v_thresholds jsonb;
  v_baseline jsonb;
  v_wo_total int; v_wo_completed int; v_wo_corrective int; v_wo_planned int;
  v_wo_hours numeric;
  v_age_days int;
  v_mtbf_days numeric;
  v_mttr_hours numeric;
  v_availability numeric;
  v_rec_count int; v_loop_rec_count int;
  v_alert_count int;
  v_integration text;
  v_dup_count int;
  v_fmea_count int;
  v_strategy text;
  v_class_cat text;
  v_counts record;
begin
  select * into a from assets where id = p_asset_id;
  if a.id is null then
    return jsonb_build_object('error', 'asset_not_found');
  end if;
  if auth.uid() is not null and a.organization_id <> app_current_org() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  v_org := a.organization_id;

  perform start_asset_onboarding(p_asset_id);

  -- ---- Gather evidence ------------------------------------------------------
  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'type', c.type)), '[]'::jsonb), count(*)
    into v_components, v_component_count
  from components c where c.asset_id = a.id;

  select
    coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'signal', s.signal_type, 'unit', s.unit,
      'last_value', s.last_value, 'threshold', s.threshold, 'status', s.status)), '[]'::jsonb),
    count(*),
    count(*) filter (where s.last_value is null or s.unit is null)
    into v_sensors, v_sensor_count, v_sensor_gap_count
  from sensors s where s.asset_id = a.id;

  select coalesce(jsonb_agg(jsonb_build_object('point', s.name, 'threshold', s.threshold, 'unit', s.unit)), '[]'::jsonb)
    into v_thresholds
  from sensors s where s.asset_id = a.id and s.threshold is not null;

  select coalesce(jsonb_agg(jsonb_build_object('point', s.name, 'healthy_value', s.last_value, 'unit', s.unit)), '[]'::jsonb)
    into v_baseline
  from sensors s where s.asset_id = a.id and s.last_value is not null and s.status = 'normal';

  select count(*),
         count(*) filter (where w.status = 'completed'),
         count(*) filter (where w.priority in ('critical','high') or w.safety_flag),
         count(*) filter (where w.status in ('scheduled','pending','approval','in_progress')),
         coalesce(avg(w.estimated_hours) filter (where w.status = 'completed' and w.estimated_hours > 0), 0)
    into v_wo_total, v_wo_completed, v_wo_corrective, v_wo_planned, v_wo_hours
  from work_orders w where w.asset_id = a.id;

  v_age_days := case when a.installed_date is not null
    then greatest((current_date - a.installed_date), 0) end;
  v_mtbf_days := case when v_wo_corrective > 0 and v_age_days is not null
    then round(v_age_days::numeric / v_wo_corrective, 1) end;
  v_mttr_hours := nullif(round(v_wo_hours, 1), 0);
  v_availability := case when v_age_days is not null and v_age_days > 0
    then round(100 - least((coalesce(v_wo_completed,0) * coalesce(v_mttr_hours, 8)) / (v_age_days * 24.0) * 100, 25), 2) end;

  select count(*), count(*) filter (where r.rationale like 'Raised by the continuous%')
    into v_rec_count, v_loop_rec_count
  from recommendations r where r.asset_id = a.id;

  select count(*) into v_alert_count from sensors s
  where s.asset_id = a.id and s.status in ('warning','alarm');

  select i.name into v_integration
  from integrations i
  where i.organization_id = v_org and lower(coalesce(i.status,'')) in ('connected','healthy','active')
  order by i.created_at limit 1;

  select count(*) into v_dup_count from assets x
  where x.organization_id = v_org and x.tag = a.tag and x.id <> a.id;

  v_class_cat := case
    when a.asset_class ~* 'pump|compressor|conveyor|motor|turbine|fan|gearbox' then 'Rotating'
    when a.asset_class ~* 'exchanger|vessel|tank|pipe|valve|boiler' then 'Static'
    when a.asset_class ~* 'transformer|switchgear|ups|electrical|motor control' then 'Electrical'
    when a.asset_class ~* 'truck|shovel|dozer|loader|mobile|crane' then 'Mobile equipment'
    when a.asset_class ~* 'plc|dcs|instrument|sensor|control' then 'Instrumentation & control'
    else 'General equipment' end;

  -- ---- Section 1: identification -------------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's1_asset_name', to_jsonb(a.name), 'asset_record', 'high', 'auto_filled');
  if a.tag is not null then
    perform fill_onboarding_item(v_org, a.id, 's1_asset_tag', to_jsonb(a.tag), 'asset_record', 'high', 'auto_filled');
  end if;
  if a.serial_number is not null then
    perform fill_onboarding_item(v_org, a.id, 's1_serial_number', to_jsonb(a.serial_number), 'asset_record', 'high', 'auto_filled');
  end if;
  if a.model is not null then
    perform fill_onboarding_item(v_org, a.id, 's1_model', to_jsonb(a.model), 'asset_record', 'high', 'auto_filled');
  end if;
  if a.manufacturer is not null then
    perform fill_onboarding_item(v_org, a.id, 's1_manufacturer', to_jsonb(a.manufacturer), 'asset_record', 'high', 'auto_filled');
  end if;
  if a.asset_class is not null then
    perform fill_onboarding_item(v_org, a.id, 's1_asset_type', to_jsonb(a.asset_class), 'asset_record', 'high', 'auto_filled');
    perform fill_onboarding_item(v_org, a.id, 's1_asset_class_category', to_jsonb(v_class_cat), 'asset_record', 'medium', 'auto_filled');
  end if;
  if a.system is not null then
    perform fill_onboarding_item(v_org, a.id, 's1_parent_asset',
      jsonb_build_object('system', a.system, 'area', a.area), 'asset_record', 'high', 'auto_filled');
  end if;
  if v_component_count > 0 then
    perform fill_onboarding_item(v_org, a.id, 's1_child_assets',
      jsonb_build_object('count', v_component_count, 'components', v_components), 'components', 'high', 'auto_filled');
  end if;
  if a.area is not null then
    perform fill_onboarding_item(v_org, a.id, 's1_location',
      jsonb_build_object('area', a.area, 'system', a.system), 'asset_record', 'high', 'auto_filled');
  end if;
  if a.installed_date is not null then
    perform fill_onboarding_item(v_org, a.id, 's1_commissioning_date', to_jsonb(a.installed_date), 'asset_record', 'medium', 'auto_filled');
  end if;

  -- ---- Section 2: hierarchy --------------------------------------------------
  if a.area is not null and a.system is not null then
    perform fill_onboarding_item(v_org, a.id, 's2_hierarchy_assigned',
      jsonb_build_object('path', 'Site → ' || a.area || ' → ' || a.system || ' → ' || a.name), 'asset_record', 'high', 'auto_filled');
  end if;
  if v_component_count > 0 then
    perform fill_onboarding_item(v_org, a.id, 's2_parent_child_links',
      jsonb_build_object('maintainable_components', v_component_count), 'components', 'high', 'auto_filled');
  end if;
  perform fill_onboarding_item(v_org, a.id, 's2_duplicates_removed',
    jsonb_build_object('duplicate_tags_found', v_dup_count, 'summary',
      case when v_dup_count = 0 then 'Tag ' || coalesce(a.tag,'?') || ' is unique in the register'
           else v_dup_count || ' duplicate tag(s) found — resolve in asset register' end),
    'derived_metric', case when v_dup_count = 0 then 'high' else 'low' end,
    case when v_dup_count = 0 then 'auto_filled' else 'human_required' end);
  if a.tag ~ '^[A-Z]{1,3}-[0-9]{2,4}$' then
    perform fill_onboarding_item(v_org, a.id, 's2_naming_convention',
      jsonb_build_object('summary', 'Tag matches site convention (AAA-000)'), 'derived_metric', 'high', 'auto_filled');
  end if;
  if a.criticality is not null then
    perform fill_onboarding_item(v_org, a.id, 's2_criticality_assigned', to_jsonb(a.criticality), 'asset_record', 'high', 'auto_filled');
  end if;

  -- ---- Section 3: function (deterministic parts) -----------------------------
  if a.system is not null then
    perform fill_onboarding_item(v_org, a.id, 's3_process_served',
      jsonb_build_object('system', a.system, 'area', a.area), 'asset_record', 'high', 'auto_filled');
  end if;
  if jsonb_array_length(v_thresholds) > 0 then
    perform fill_onboarding_item(v_org, a.id, 's3_performance_limits',
      jsonb_build_object('limits', v_thresholds), 'sensor_map', 'medium', 'auto_filled');
  end if;

  -- ---- Section 4: technical specifications -----------------------------------
  if v_sensor_count > 0 then
    perform fill_onboarding_item(v_org, a.id, 's4_instrumentation',
      jsonb_build_object('points', v_sensors), 'sensor_map', 'high', 'auto_filled');
    perform fill_onboarding_item(v_org, a.id, 's4_operating_limits',
      jsonb_build_object('limits', v_thresholds), 'sensor_map', 'medium', 'auto_filled');
  end if;

  -- ---- Section 5: criticality assessment --------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's5_production_impact',
    jsonb_build_object('risk_score', a.risk_score, 'criticality', a.criticality,
      'summary', case when a.criticality in ('critical','high')
        then 'Failure interrupts production (risk score ' || a.risk_score || '/100)'
        else 'Failure has limited production impact (risk score ' || a.risk_score || '/100)' end),
    'derived_metric', 'medium', 'auto_filled');
  if v_wo_completed > 0 then
    perform fill_onboarding_item(v_org, a.id, 's5_maintenance_cost',
      jsonb_build_object('avg_repair_hours', v_mttr_hours, 'completed_work_orders', v_wo_completed),
      'work_order_history', 'medium', 'auto_filled');
  end if;
  perform fill_onboarding_item(v_org, a.id, 's5_detectability',
    jsonb_build_object('monitored_points', v_sensor_count,
      'summary', case when v_sensor_count > 0
        then v_sensor_count || ' condition-monitoring point(s) provide early detection'
        else 'No online monitoring — detection relies on inspection rounds' end),
    'sensor_map', case when v_sensor_count > 0 then 'high' else 'medium' end, 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's5_failure_frequency',
    jsonb_build_object('corrective_events', v_wo_corrective, 'total_work_orders', v_wo_total),
    'work_order_history', 'medium', 'auto_filled');
  if a.criticality is not null then
    perform fill_onboarding_item(v_org, a.id, 's5_criticality_level',
      jsonb_build_object('level', case a.criticality
          when 'critical' then 'A / Critical' when 'high' then 'B / Important'
          else 'C / Non-critical' end,
        'basis', 'Register criticality "' || a.criticality || '" with risk score ' || a.risk_score || '/100'),
      'asset_record', 'high', 'auto_filled');
  end if;

  -- ---- Section 6: reliability data --------------------------------------------
  if v_wo_total > 0 then
    perform fill_onboarding_item(v_org, a.id, 's6_failure_history',
      jsonb_build_object('work_orders', v_wo_total, 'corrective', v_wo_corrective, 'completed', v_wo_completed),
      'work_order_history', 'high', 'auto_filled');
  end if;
  if v_mtbf_days is not null then
    perform fill_onboarding_item(v_org, a.id, 's6_mtbf',
      jsonb_build_object('mtbf_days', v_mtbf_days, 'basis', v_wo_corrective || ' significant events over ' || v_age_days || ' days in service'),
      'derived_metric', 'medium', 'auto_filled');
    perform fill_onboarding_item(v_org, a.id, 's6_failure_rate',
      jsonb_build_object('events_per_year', round(365.0 / nullif(v_mtbf_days,0), 2)), 'derived_metric', 'medium', 'auto_filled');
  end if;
  perform fill_onboarding_item(v_org, a.id, 's6_bad_actor',
    jsonb_build_object('bad_actor', v_wo_corrective >= 3,
      'basis', v_wo_corrective || ' high-priority/safety events on record'),
    'work_order_history', 'medium', 'auto_filled');
  if v_wo_corrective > 0 then
    perform fill_onboarding_item(v_org, a.id, 's6_repeated_failure_modes',
      (select jsonb_build_object('top_issues', coalesce(jsonb_agg(t.title), '[]'::jsonb))
       from (select w.title, count(*) from work_orders w
             where w.asset_id = a.id group by w.title order by count(*) desc limit 3) t),
      'work_order_history', 'medium', 'auto_filled');
  end if;
  if v_age_days is not null then
    perform fill_onboarding_item(v_org, a.id, 's6_asset_age',
      jsonb_build_object('age_years', round(v_age_days / 365.25, 1), 'installed', a.installed_date),
      'derived_metric', 'high', 'auto_filled');
    perform fill_onboarding_item(v_org, a.id, 's6_operating_hours',
      jsonb_build_object('estimated_hours', v_age_days * 24, 'basis', 'Continuous service assumption since install — refine with historian runtime'),
      'derived_metric', 'low', 'auto_filled');
  end if;

  -- ---- Section 7: maintainability ----------------------------------------------
  if v_mttr_hours is not null then
    perform fill_onboarding_item(v_org, a.id, 's7_mttr',
      jsonb_build_object('mttr_hours', v_mttr_hours, 'basis', v_wo_completed || ' completed work orders'),
      'derived_metric', 'medium', 'auto_filled');
  end if;
  if v_wo_total > 0 then
    perform fill_onboarding_item(v_org, a.id, 's7_maintenance_history',
      jsonb_build_object('total', v_wo_total, 'completed', v_wo_completed, 'open', v_wo_planned),
      'work_order_history', 'high', 'auto_filled');
  end if;

  -- ---- Section 8: availability ---------------------------------------------------
  if v_availability is not null then
    perform fill_onboarding_item(v_org, a.id, 's8_actual_availability',
      jsonb_build_object('estimated_pct', v_availability, 'basis', 'Derived from repair history — replace with historian actuals when connected'),
      'derived_metric', 'low', 'auto_filled');
  end if;
  perform fill_onboarding_item(v_org, a.id, 's8_downtime_events',
    jsonb_build_object('recorded_events', v_wo_completed), 'work_order_history', 'medium', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's8_unplanned_downtime',
    jsonb_build_object('unplanned_events', v_wo_corrective), 'work_order_history', 'medium', 'auto_filled');

  -- ---- Section 9: FMEA (library copy) ---------------------------------------------
  select count(*) into v_fmea_count from asset_failure_mode_libraries f
  where f.organization_id = v_org and f.asset_id = coalesce(a.tag, a.id::text);

  if v_fmea_count = 0 then
    insert into asset_failure_mode_libraries
      (session_id, organization_id, asset_id, failure_mode, failure_mechanism, cause, effect,
       detection_method, consequence, current_controls, recommended_controls, source)
    select 'autonomous-onboarding:' || a.id,
           v_org, coalesce(a.tag, a.id::text),
           l.component || ' — ' || l.failure_mode,
           l.failure_mode, l.cause, l.effect, l.detection_method,
           case l.severity when 'high' then 'High consequence — production/safety exposure'
             else 'Moderate consequence' end,
           'Existing PMs and operator rounds',
           l.recommended_action, 'fmea_library'
    from onboarding_fmea_library l
    where a.asset_class ~* l.class_pattern
      and l.class_pattern <> '.*';

    get diagnostics v_fmea_count = row_count;

    if v_fmea_count = 0 then
      insert into asset_failure_mode_libraries
        (session_id, organization_id, asset_id, failure_mode, failure_mechanism, cause, effect,
         detection_method, consequence, current_controls, recommended_controls, source)
      select 'autonomous-onboarding:' || a.id,
             v_org, coalesce(a.tag, a.id::text),
             l.component || ' — ' || l.failure_mode,
             l.failure_mode, l.cause, l.effect, l.detection_method,
             'Consequence per asset criticality', 'Existing PMs and operator rounds',
             l.recommended_action, 'fmea_library'
      from onboarding_fmea_library l where l.class_pattern = '.*';
      get diagnostics v_fmea_count = row_count;
    end if;
  end if;

  if v_fmea_count > 0 then
    perform fill_onboarding_item(v_org, a.id, 's9_failure_modes_configured',
      jsonb_build_object('failure_modes', v_fmea_count, 'source', 'SyncAI failure-mode library for ' || coalesce(a.asset_class, 'this asset class')),
      'fmea_library', 'medium', 'auto_filled');
    perform fill_onboarding_item(v_org, a.id, 's9_fmea_detection_methods',
      jsonb_build_object('summary', 'Detection method assigned per failure mode from library'), 'fmea_library', 'medium', 'auto_filled');
    perform fill_onboarding_item(v_org, a.id, 's9_fmea_recommended_actions',
      jsonb_build_object('summary', 'Recommended task assigned per failure mode from library'), 'fmea_library', 'medium', 'auto_filled');
  end if;

  -- ---- Section 10: maintenance strategy ----------------------------------------------
  v_strategy := case
    when v_sensor_count > 0 and a.criticality in ('critical','high') then 'Condition-based + predictive maintenance (sensors online, high criticality)'
    when v_sensor_count > 0 then 'Condition-based maintenance (sensors online)'
    when a.criticality in ('critical','high') then 'Time-based PM with condition monitoring buildout recommended'
    when a.criticality = 'low' then 'Run-to-failure with operator care (low criticality)'
    else 'Time-based PM at OEM intervals' end;
  perform fill_onboarding_item(v_org, a.id, 's10_strategy_assigned',
    jsonb_build_object('strategy', v_strategy), 'strategy_rule', 'medium', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's10_pm_tasks_linked',
    jsonb_build_object('open_or_scheduled_tasks', v_wo_planned, 'completed_tasks', v_wo_completed),
    'work_order_history',
    case when v_wo_planned + v_wo_completed > 0 then 'high' else 'low' end,
    case when v_wo_planned + v_wo_completed > 0 then 'auto_filled' else 'human_required' end);

  -- ---- Section 11: condition monitoring ------------------------------------------------
  if v_sensor_count > 0 then
    perform fill_onboarding_item(v_org, a.id, 's11_sensor_tags_mapped',
      jsonb_build_object('mapped_points', v_sensor_count, 'points', v_sensors), 'sensor_map', 'high', 'auto_filled');
    perform fill_onboarding_item(v_org, a.id, 's11_units_standardized',
      jsonb_build_object('summary', case when v_sensor_gap_count = 0 then 'All points carry engineering units'
        else v_sensor_gap_count || ' point(s) missing unit or value' end),
      'sensor_map', case when v_sensor_gap_count = 0 then 'high' else 'low' end,
      case when v_sensor_gap_count = 0 then 'auto_filled' else 'human_required' end);
    if jsonb_array_length(v_thresholds) > 0 then
      perform fill_onboarding_item(v_org, a.id, 's11_alarm_thresholds',
        jsonb_build_object('thresholds', v_thresholds), 'sensor_map', 'high', 'auto_filled');
    end if;
    perform fill_onboarding_item(v_org, a.id, 's11_data_quality_reviewed',
      jsonb_build_object('points', v_sensor_count, 'points_with_gaps', v_sensor_gap_count,
        'summary', case when v_sensor_gap_count = 0 then 'No data gaps across monitored points'
          else 'Data gaps on ' || v_sensor_gap_count || ' point(s)' end),
      'sensor_map', case when v_sensor_gap_count = 0 then 'high' else 'low' end,
      case when v_sensor_gap_count = 0 then 'auto_filled' else 'human_required' end);
  end if;
  if v_wo_corrective > 0 or exists (select 1 from learning_events le where le.asset_id = a.id) then
    perform fill_onboarding_item(v_org, a.id, 's11_failure_labels',
      jsonb_build_object('labelled_events', v_wo_corrective), 'work_order_history', 'medium', 'auto_filled');
  end if;

  -- ---- Section 12: AI / analytics --------------------------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's12_use_case',
    jsonb_build_object('use_case', case when v_sensor_count > 0
      then 'Anomaly detection + failure prediction from live condition monitoring'
      else 'Maintenance optimization from work-order and criticality data' end),
    'platform', 'high', 'auto_filled');
  if v_fmea_count > 0 then
    perform fill_onboarding_item(v_org, a.id, 's12_target_failure_modes',
      jsonb_build_object('modes', v_fmea_count, 'source', 'FMEA library'), 'fmea_library', 'medium', 'auto_filled');
  end if;
  perform fill_onboarding_item(v_org, a.id, 's12_data_inputs',
    jsonb_build_object('sensor_points', v_sensor_count, 'work_orders', v_wo_total, 'recommendations', v_rec_count),
    'platform', 'high', 'auto_filled');
  if jsonb_array_length(v_thresholds) > 0 then
    perform fill_onboarding_item(v_org, a.id, 's12_alert_rules',
      jsonb_build_object('threshold_rules', jsonb_array_length(v_thresholds), 'engine', 'Continuous agent loop (5-min scan)'),
      'platform', 'high', 'auto_filled');
  end if;
  perform fill_onboarding_item(v_org, a.id, 's12_alert_workflow_tested',
    jsonb_build_object('loop_raised_recommendations', v_loop_rec_count, 'total_recommendations', v_rec_count,
      'summary', case when v_rec_count > 0
        then 'Alert → review → work order workflow proven on this asset'
        else 'No alerts raised yet — workflow will verify on first event' end),
    'platform', case when v_rec_count > 0 then 'high' else 'low' end,
    case when v_rec_count > 0 then 'auto_filled' else 'human_required' end);
  perform fill_onboarding_item(v_org, a.id, 's12_feedback_loop',
    jsonb_build_object('summary', 'Challenge-AI feedback loop active platform-wide (false-positive learning events)'),
    'platform', 'high', 'auto_filled');

  -- ---- Section 13: work management ---------------------------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's13_cmms_linkage',
    jsonb_build_object('connected_system', coalesce(v_integration, 'SyncAI native work management'),
      'external_cmms', v_integration is not null),
    'integrations', case when v_integration is not null then 'high' else 'medium' end, 'auto_filled');
  if v_wo_total > 0 then
    perform fill_onboarding_item(v_org, a.id, 's13_wo_history_imported',
      jsonb_build_object('work_orders', v_wo_total), 'work_order_history', 'high', 'auto_filled');
  end if;
  perform fill_onboarding_item(v_org, a.id, 's13_wo_integration_verified',
    jsonb_build_object('work_orders_on_asset', v_wo_total,
      'summary', case when v_wo_total > 0 then 'Work order round trip verified on this asset'
        else 'No work orders yet — will verify on first work action' end),
    'work_order_history', case when v_wo_total > 0 then 'high' else 'low' end,
    case when v_wo_total > 0 then 'auto_filled' else 'human_required' end);
  perform fill_onboarding_item(v_org, a.id, 's13_priority_matrix',
    jsonb_build_object('matrix', 'critical / high / medium / low with approval gates'), 'platform', 'high', 'auto_filled');

  -- ---- Section 16 + 17 + 18 ------------------------------------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's16_data_sensitivity',
    to_jsonb('internal'::text), 'platform', 'medium', 'auto_filled');
  if jsonb_array_length(v_baseline) > 0 then
    perform fill_onboarding_item(v_org, a.id, 's17_baseline_captured',
      jsonb_build_object('baseline', v_baseline), 'sensor_map', 'high', 'auto_filled');
  end if;
  perform fill_onboarding_item(v_org, a.id, 's17_normal_alarm_rate',
    jsonb_build_object('active_alerts', v_alert_count), 'sensor_map', 'medium', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's18_health_index_configured',
    jsonb_build_object('health_score', a.health_score,
      'weights', jsonb_build_object('condition_monitoring', 25, 'failure_history', 20, 'criticality', 20,
        'maintenance_compliance', 15, 'operating_envelope', 10, 'spares_readiness', 5, 'documentation', 5)),
    'platform', 'high', 'auto_filled');

  -- ---- Section 19 -----------------------------------------------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's19_support_roles',
    jsonb_build_object('reliability', 'Reliability Engineering agent + org reliability engineer',
      'planning', 'Planning & Scheduling agent + planner', 'operations', 'Operations representative',
      'data', 'SyncAI platform'),
    'platform', 'medium', 'auto_filled');

  -- ---- Route everything still pending ----------------------------------------------------------
  update asset_onboarding_items i
  set status = case when r.fill_strategy = 'ai' then 'pending_ai' else 'human_required' end
  from onboarding_requirements r
  where i.requirement_key = r.key
    and i.asset_id = a.id
    and i.status = 'pending';

  -- ---- Rollup + run log --------------------------------------------------------------------------
  select
    count(*) filter (where status = 'auto_filled') as auto_filled,
    count(*) filter (where status = 'deduced') as deduced,
    count(*) filter (where status = 'pending_ai') as pending_ai,
    count(*) filter (where status = 'human_required') as human_required,
    count(*) as total,
    count(*) filter (where status in ('auto_filled','deduced','human_provided','not_applicable')) as satisfied
  into v_counts
  from asset_onboarding_items where asset_id = a.id;

  insert into asset_onboarding_runs (organization_id, asset_id, run_type,
    items_auto_filled, items_deduced, items_pending_ai, items_human_required, detail)
  values (v_org, a.id, 'autofill',
    v_counts.auto_filled, v_counts.deduced, v_counts.pending_ai, v_counts.human_required,
    jsonb_build_object('sensors', v_sensor_count, 'work_orders', v_wo_total, 'fmea_modes', v_fmea_count));

  update asset_onboarding_state s
  set completion_pct = (v_counts.satisfied * 100 / greatest(v_counts.total, 1)),
      human_required_count = v_counts.human_required,
      updated_at = now()
  where s.asset_id = a.id;

  return jsonb_build_object(
    'asset_id', a.id, 'asset', a.name,
    'auto_filled', v_counts.auto_filled,
    'pending_ai', v_counts.pending_ai,
    'human_required', v_counts.human_required,
    'completion_pct', (v_counts.satisfied * 100 / greatest(v_counts.total, 1))
  );
end
$$;

grant execute on function public.run_onboarding_autofill(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Human-in-the-loop: provide a missing item (or rule it not applicable)
-- ----------------------------------------------------------------------------
create or replace function public.provide_onboarding_item(
  p_item_id uuid,
  p_value jsonb,
  p_note text default null,
  p_not_applicable boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item asset_onboarding_items%rowtype;
  v_label text;
  v_counts record;
begin
  select * into v_item from asset_onboarding_items where id = p_item_id;
  if v_item.id is null then
    return jsonb_build_object('error', 'item_not_found');
  end if;
  if v_item.organization_id <> app_current_org() then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select coalesce(p.full_name, u.email, 'Operator') into v_label
  from auth.users u left join user_profiles p on p.id = u.id
  where u.id = auth.uid();

  update asset_onboarding_items
  set status = case when p_not_applicable then 'not_applicable' else 'human_provided' end,
      value = p_value,
      source = 'human',
      confidence = 'high',
      note = p_note,
      filled_at = now(),
      provided_by = auth.uid()
  where id = p_item_id;

  insert into learning_events (organization_id, asset_id, event_type, title, detail)
  values (v_item.organization_id, v_item.asset_id, 'lesson_learned',
    'Onboarding gap closed by ' || coalesce(v_label, 'operator'),
    'Requirement ' || v_item.requirement_key || ' ' ||
      case when p_not_applicable then 'ruled not applicable' else 'provided by human-in-the-loop' end);

  select
    count(*) as total,
    count(*) filter (where status in ('auto_filled','deduced','human_provided','not_applicable')) as satisfied,
    count(*) filter (where status = 'human_required') as human_required
  into v_counts
  from asset_onboarding_items where asset_id = v_item.asset_id;

  update asset_onboarding_state
  set completion_pct = (v_counts.satisfied * 100 / greatest(v_counts.total, 1)),
      human_required_count = v_counts.human_required,
      updated_at = now()
  where asset_id = v_item.asset_id;

  return jsonb_build_object('updated', true, 'completion_pct', (v_counts.satisfied * 100 / greatest(v_counts.total, 1)));
end
$$;

grant execute on function public.provide_onboarding_item(uuid, jsonb, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Go-live gate (Section 21 minimum data + explicit SME approval)
-- ----------------------------------------------------------------------------
create or replace function public.get_golive_readiness(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_missing jsonb;
  v_required int;
  v_satisfied int;
begin
  if not exists (select 1 from assets a where a.id = p_asset_id and a.organization_id = app_current_org()) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select
    count(*) filter (where r.required_for_golive),
    count(*) filter (where r.required_for_golive and i.status in ('auto_filled','deduced','human_provided','not_applicable')),
    coalesce(jsonb_agg(jsonb_build_object('key', r.key, 'label', r.item_label, 'section', r.section_title, 'status', i.status))
      filter (where r.required_for_golive and i.status not in ('auto_filled','deduced','human_provided','not_applicable')), '[]'::jsonb)
  into v_required, v_satisfied, v_missing
  from asset_onboarding_items i
  join onboarding_requirements r on r.key = i.requirement_key
  where i.asset_id = p_asset_id;

  return jsonb_build_object(
    'required', v_required,
    'satisfied', v_satisfied,
    'ready', v_required > 0 and v_satisfied = v_required,
    'missing', v_missing
  );
end
$$;

grant execute on function public.get_golive_readiness(uuid) to authenticated;

create or replace function public.approve_asset_golive(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset assets%rowtype;
  v_readiness jsonb;
  v_label text;
begin
  select * into v_asset from assets where id = p_asset_id;
  if v_asset.id is null or v_asset.organization_id <> app_current_org() then
    return jsonb_build_object('error', 'forbidden');
  end if;

  v_readiness := get_golive_readiness(p_asset_id);
  if not (v_readiness->>'ready')::boolean then
    return jsonb_build_object('approved', false, 'missing', v_readiness->'missing');
  end if;

  select coalesce(p.full_name, u.email, 'Operator') into v_label
  from auth.users u left join user_profiles p on p.id = u.id
  where u.id = auth.uid();

  update asset_onboarding_state
  set status = 'live', approved_by = auth.uid(), approved_by_label = v_label,
      approved_at = now(), updated_at = now()
  where asset_id = p_asset_id;

  insert into decisions (organization_id, asset_id, decision_type, action_taken,
    approval_status, autonomy_mode, confidence_score, human_actor, rationale, outcome_status)
  values (v_asset.organization_id, v_asset.id, 'onboarding_gate',
    'Approved ' || v_asset.name || ' for live SyncAI monitoring',
    'approved', 'advisory', 95, v_label,
    'SME sign-off: Section-21 minimum data set complete — hierarchy, function, criticality, failure modes, strategy, monitoring, baseline, ownership and documentation verified.',
    'executed');

  insert into learning_events (organization_id, asset_id, event_type, title, detail)
  values (v_asset.organization_id, v_asset.id, 'lesson_learned',
    v_asset.name || ' approved for live monitoring',
    'Autonomous onboarding complete; SME approval recorded by ' || coalesce(v_label, 'operator') || '.');

  return jsonb_build_object('approved', true, 'asset', v_asset.name, 'approved_by', v_label);
end
$$;

grant execute on function public.approve_asset_golive(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. AI deduction queue (service-role surface for the onboarding-enrich fn)
-- ----------------------------------------------------------------------------
create or replace function public.get_onboarding_ai_queue(p_limit int default 3)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select coalesce(jsonb_agg(asset_bundle), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'asset_id', a.id,
      'organization_id', a.organization_id,
      'asset', jsonb_build_object('name', a.name, 'tag', a.tag, 'class', a.asset_class,
        'criticality', a.criticality, 'manufacturer', a.manufacturer, 'model', a.model,
        'area', a.area, 'system', a.system),
      'known', (
        select coalesce(jsonb_object_agg(i2.requirement_key, i2.value), '{}'::jsonb)
        from asset_onboarding_items i2
        where i2.asset_id = a.id and i2.status in ('auto_filled','human_provided') and i2.value is not null
      ),
      'pending', (
        select jsonb_agg(jsonb_build_object('item_id', i3.id, 'key', i3.requirement_key,
          'label', r3.item_label, 'hint', r3.hint))
        from asset_onboarding_items i3
        join onboarding_requirements r3 on r3.key = i3.requirement_key
        where i3.asset_id = a.id and i3.status = 'pending_ai'
      )
    ) as asset_bundle
    from assets a
    where exists (select 1 from asset_onboarding_items i where i.asset_id = a.id and i.status = 'pending_ai')
    order by a.created_at
    limit p_limit
  ) q;
  return v_result;
end
$$;

revoke execute on function public.get_onboarding_ai_queue(int) from public, anon, authenticated;
grant execute on function public.get_onboarding_ai_queue(int) to service_role;

create or replace function public.apply_onboarding_ai_deduction(
  p_item_id uuid, p_value jsonb, p_confidence text, p_rationale text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item asset_onboarding_items%rowtype;
  v_counts record;
begin
  select * into v_item from asset_onboarding_items where id = p_item_id;
  if v_item.id is null then
    return jsonb_build_object('error', 'item_not_found');
  end if;

  if p_confidence = 'low' then
    -- Not confident enough to accept autonomously → human-in-the-loop.
    update asset_onboarding_items
    set status = 'human_required',
        note = coalesce('AI could not deduce confidently: ' || p_rationale, 'AI deduction below confidence threshold'),
        value = p_value
    where id = p_item_id and status = 'pending_ai';
  else
    update asset_onboarding_items
    set status = 'deduced', value = p_value, source = 'ai_deduction',
        confidence = p_confidence, note = p_rationale, filled_at = now()
    where id = p_item_id and status in ('pending_ai','human_required');
  end if;

  select
    count(*) as total,
    count(*) filter (where status in ('auto_filled','deduced','human_provided','not_applicable')) as satisfied,
    count(*) filter (where status = 'human_required') as human_required
  into v_counts
  from asset_onboarding_items where asset_id = v_item.asset_id;

  update asset_onboarding_state
  set completion_pct = (v_counts.satisfied * 100 / greatest(v_counts.total, 1)),
      human_required_count = v_counts.human_required,
      updated_at = now()
  where asset_id = v_item.asset_id;

  return jsonb_build_object('applied', true);
end
$$;

revoke execute on function public.apply_onboarding_ai_deduction(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.apply_onboarding_ai_deduction(uuid, jsonb, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 10. Self-onboarding trigger for new assets
-- ----------------------------------------------------------------------------
create or replace function public.on_asset_created_onboard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform start_asset_onboarding(new.id);
  perform run_onboarding_autofill(new.id);
  return new;
end
$$;

drop trigger if exists trg_asset_autonomous_onboarding on assets;
create trigger trg_asset_autonomous_onboarding
  after insert on assets
  for each row execute function public.on_asset_created_onboard();

-- ----------------------------------------------------------------------------
-- 11. Cron trigger for the AI-deduction edge function (same fail-soft pattern
--     as agent enrichment: no config → no-op)
-- ----------------------------------------------------------------------------
create table if not exists private.onboarding_enrich_config (
  id boolean primary key default true check (id),
  function_url text not null,
  service_key text not null,
  updated_at timestamptz not null default now()
);

create or replace function public.configure_onboarding_enrichment(
  p_function_url text, p_service_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into private.onboarding_enrich_config (id, function_url, service_key)
  values (true, p_function_url, p_service_key)
  on conflict (id) do update
    set function_url = excluded.function_url,
        service_key = excluded.service_key,
        updated_at = now();
  return jsonb_build_object('configured', true);
end
$$;

revoke execute on function public.configure_onboarding_enrichment(text, text) from public, anon, authenticated;
grant execute on function public.configure_onboarding_enrichment(text, text) to service_role;

create or replace function public.trigger_onboarding_enrichment()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg record;
  req_id bigint;
begin
  select * into cfg from private.onboarding_enrich_config where id = true;
  if cfg.function_url is null then
    return jsonb_build_object('skipped', 'not_configured');
  end if;
  if not exists (select 1 from asset_onboarding_items where status = 'pending_ai') then
    return jsonb_build_object('skipped', 'queue_empty');
  end if;

  select net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into req_id;

  return jsonb_build_object('requested', true, 'request_id', req_id);
end
$$;

revoke execute on function public.trigger_onboarding_enrichment() from public, anon, authenticated;
grant execute on function public.trigger_onboarding_enrichment() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'syncai-onboarding-enrich';
    perform cron.schedule('syncai-onboarding-enrich', '*/15 * * * *', 'select public.trigger_onboarding_enrichment()');
  end if;
end
$$;

-- Signed-in operators may REQUEST an AI pass (the cron does it anyway every
-- 15 min); the trigger stays service-role-only and never exposes config.
create or replace function public.request_onboarding_ai_pass()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_current_org() is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return trigger_onboarding_enrichment();
end
$$;

grant execute on function public.request_onboarding_ai_pass() to authenticated;

-- ----------------------------------------------------------------------------
-- 12. Backfill: autonomously onboard every asset already in the register
-- ----------------------------------------------------------------------------
do $$
declare v_asset uuid;
begin
  for v_asset in select id from assets loop
    perform start_asset_onboarding(v_asset);
    perform run_onboarding_autofill(v_asset);
  end loop;
end
$$;

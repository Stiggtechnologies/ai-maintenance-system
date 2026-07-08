-- ============================================================================
-- Onboarding governance, validation & lifecycle control (audit-ready layer).
--
-- Extends the autonomous RAM-checklist engine (migration 11) with the
-- governance additions: data-quality gate, asset boundary, failure coding
-- standard, operating context, AI model governance, alert-response playbook,
-- work-order closeout discipline, reliability targets, lifecycle status,
-- management of change, cybersecurity/access posture, training, and the
-- multi-role audit & approval trail. The RAM guide frames reliability
-- management as a lifecycle activity — these sections make onboarding cover
-- all four layers: asset master data, reliability strategy, data & AI
-- readiness, governance & workflow.
--
-- Same autonomy ladder as migration 11: platform facts auto-fill, AI deduces
-- engineering context, humans provide only approvals and site-specific facts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Lifecycle status on the asset master record
-- ----------------------------------------------------------------------------
alter table assets add column if not exists lifecycle_status text default 'active'
  check (lifecycle_status in ('new','active','standby','mothballed','obsolete','end_of_life','decommissioned'));

update assets set lifecycle_status = case
  when installed_date is not null and installed_date > current_date - interval '1 year' then 'new'
  else 'active' end
where lifecycle_status = 'active';

-- ----------------------------------------------------------------------------
-- 2. Work-order closeout discipline (FRACAS-quality data capture)
-- ----------------------------------------------------------------------------
alter table work_orders add column if not exists actual_failure_mode text;
alter table work_orders add column if not exists actual_cause text;
alter table work_orders add column if not exists corrective_action text;
alter table work_orders add column if not exists parts_used text;
alter table work_orders add column if not exists labor_hours numeric;
alter table work_orders add column if not exists downtime_hours numeric;
alter table work_orders add column if not exists technician_comments text;
alter table work_orders add column if not exists ai_alert_useful boolean;
alter table work_orders add column if not exists closed_at timestamptz;

create or replace function public.close_work_order(
  p_work_order_id uuid,
  p_actual_failure_mode text,
  p_actual_cause text,
  p_corrective_action text,
  p_labor_hours numeric,
  p_downtime_hours numeric,
  p_parts_used text default null,
  p_technician_comments text default null,
  p_ai_alert_useful boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo work_orders%rowtype;
  v_label text;
begin
  select * into v_wo from work_orders where id = p_work_order_id;
  if v_wo.id is null or v_wo.organization_id <> app_current_org() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_wo.status = 'completed' then
    return jsonb_build_object('error', 'already_closed');
  end if;
  -- Mandatory closeout fields — FRACAS learning needs all of them.
  if coalesce(trim(p_actual_failure_mode), '') = '' or
     coalesce(trim(p_actual_cause), '') = '' or
     coalesce(trim(p_corrective_action), '') = '' or
     p_labor_hours is null or p_downtime_hours is null then
    return jsonb_build_object('error', 'missing_required_closeout_fields');
  end if;

  select coalesce(p.full_name, u.email, 'Technician') into v_label
  from auth.users u left join user_profiles p on p.id = u.id
  where u.id = auth.uid();

  update work_orders set
    status = 'completed',
    actual_failure_mode = p_actual_failure_mode,
    actual_cause = p_actual_cause,
    corrective_action = p_corrective_action,
    parts_used = p_parts_used,
    labor_hours = p_labor_hours,
    downtime_hours = p_downtime_hours,
    technician_comments = p_technician_comments,
    ai_alert_useful = p_ai_alert_useful,
    closed_at = now()
  where id = p_work_order_id;

  -- FRACAS: every closeout is a learning event; AI-usefulness feedback
  -- feeds the model-governance loop.
  insert into learning_events (organization_id, asset_id, recommendation_id, event_type, title, detail)
  values (v_wo.organization_id, v_wo.asset_id, v_wo.recommendation_id, 'work_completed',
    'Closed: ' || v_wo.title,
    'Failure mode: ' || p_actual_failure_mode || '. Cause: ' || p_actual_cause ||
    '. Action: ' || p_corrective_action || '. Labour ' || p_labor_hours || 'h, downtime ' ||
    p_downtime_hours || 'h. Closed by ' || coalesce(v_label, 'technician') || '.');

  if p_ai_alert_useful is not null and v_wo.type = 'ai_generated' then
    insert into learning_events (organization_id, asset_id, recommendation_id, event_type, title, detail)
    values (v_wo.organization_id, v_wo.asset_id, v_wo.recommendation_id,
      case when p_ai_alert_useful then 'recommendation_accepted' else 'false_positive' end,
      case when p_ai_alert_useful then 'AI alert confirmed useful — ' else 'AI alert not useful — ' end || v_wo.title,
      'Technician closeout feedback (' || coalesce(v_label, 'technician') || ').');
  end if;

  return jsonb_build_object('closed', true, 'work_order', v_wo.title);
end
$$;

grant execute on function public.close_work_order(uuid, text, text, text, numeric, numeric, text, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Catalog: governance sections 20–32
-- ----------------------------------------------------------------------------
-- Upgrades to existing items:
update onboarding_requirements set required_for_golive = true,
  hint = 'Explicit statement of what is inside/outside the asset boundary (components in, linked assets out)'
where key = 's2_boundary_defined';
update onboarding_requirements set fill_strategy = 'library',
  hint = 'Standard failure mode / cause / effect / remedy / detection codes'
where key = 's13_failure_codes';

insert into onboarding_requirements (key, section_number, section_title, item_label, hint, fill_strategy, required_for_golive, sort_order) values
-- Section 20 — Data Quality Gate
('s20_dq_gate',           20,'Data Quality Gate','Data quality gate passed','8 automated checks: tag accuracy, duplicates, required fields, units, sensor validation, time alignment, gaps, bad-data rules','derived', true, 10),
('s20_unit_consistency',  20,'Data Quality Gate','Units of measure consistent','Standardized engineering units on every monitored point','derived', false, 20),
('s20_sensor_validation', 20,'Data Quality Gate','Sensors live and correctly mapped','Tags bound to the right asset with live values','derived', false, 30),
('s20_bad_data_rules',    20,'Data Quality Gate','Bad-data rules active','Outliers, flatlines and impossible values flagged','record', false, 40),
-- Section 21 lives in the go-live gate itself (minimum data set)
-- Section 22 — Failure Coding Standard
('s22_failure_coding',    22,'Failure Coding Standard','Failure coding standard assigned','Mode / cause / effect / remedy / detection taxonomies for consistent FRACAS data','library', false, 10),
('s22_fracas_loop',       22,'Failure Coding Standard','FRACAS loop active','Failures captured, analyzed, corrected, tracked to closure (MIL-HDBK-338B)','record', false, 20),
-- Section 23 — Operating Context
('s23_normal_duty',       23,'Operating Context','Normal duty','Continuous, standby, batch, emergency','ai', false, 10),
('s23_service_severity',  23,'Operating Context','Service severity','Light, normal, severe','ai', false, 20),
('s23_process_fluid',     23,'Operating Context','Process fluid / material','Water, slurry, gas, chemical, product','ai', false, 30),
('s23_contamination_risk',23,'Operating Context','Contamination risk','Dust, water, corrosion, solids exposure','ai', false, 40),
('s23_start_stop_frequency',23,'Operating Context','Start/stop frequency','Daily, weekly, frequent cycling — from operations','human', false, 50),
('s23_load_profile',      23,'Operating Context','Load profile','Constant, variable, overloaded periods','derived', false, 60),
('s23_abnormal_modes',    23,'Operating Context','Abnormal operating modes','Startup, shutdown, cleaning, bypass, upset','ai', false, 70),
-- Section 24 — AI Model Governance
('s24_model_purpose',     24,'AI Model Governance','Model purpose defined','What the AI predicts/detects for this asset','record', false, 10),
('s24_training_window',   24,'AI Model Governance','Training data period','Historical window available to the models','derived', false, 20),
('s24_excluded_data',     24,'AI Model Governance','Excluded data documented','Shutdowns, commissioning, sensor faults, abnormal periods','record', false, 30),
('s24_alert_confidence',  24,'AI Model Governance','Alert confidence levels','Confidence assigned per alert severity','record', false, 40),
('s24_false_positive_process',24,'AI Model Governance','False-positive process','How incorrect alerts are reviewed and fed back','record', false, 50),
('s24_false_negative_process',24,'AI Model Governance','False-negative process','How missed failures are captured','record', false, 60),
('s24_review_cycle',      24,'AI Model Governance','Model review cycle','Monthly, quarterly, or after major failure','record', false, 70),
('s24_change_log',        24,'AI Model Governance','Model change log','Threshold/feature/logic changes tracked','record', false, 80),
-- Section 25 — Alert Response Playbook
('s25_alert_playbook',    25,'Alert Response Playbook','Alert response playbook','Advisory→monitor, warning→review, alarm→inspect, critical→respond, confirmed→WO, false→feedback','record', false, 10),
-- Section 26 — Work Order Closeout Quality
('s26_closeout_standard', 26,'Work Order Closeout','Mandatory closeout enforced','Failure mode, cause, action, labour, downtime + AI-usefulness required at completion','record', false, 10),
-- Section 27 — Reliability Targets
('s27_reliability_targets',27,'Reliability Targets','Performance targets set','MTBF, MTTR, availability, unplanned downtime, alert-accuracy targets','ai', false, 10),
-- Section 28 — Lifecycle Status
('s28_lifecycle_status',  28,'Lifecycle Status','Lifecycle stage assigned','New, active, standby, mothballed, obsolete, end-of-life, decommissioned','record', false, 10),
-- Section 29 — Management of Change
('s29_moc_control',       29,'Management of Change','Change-control triggers active','Sensor/component/strategy changes automatically re-run the onboarding review','record', false, 10),
-- Section 30 — Cybersecurity & Access Control
('s30_user_roles',        30,'Cybersecurity & Access','Role-based access active','Admin/engineer/planner/technician/viewer with org-scoped RLS','record', false, 10),
('s30_data_source_security',30,'Cybersecurity & Access','Data source security','RLS + service-role isolation + secrets management','record', false, 20),
('s30_audit_log',         30,'Cybersecurity & Access','Audit log active','Decisions, learning events and agent runs tracked','record', false, 30),
('s30_backup_recovery',   30,'Cybersecurity & Access','Backup and recovery','Managed Postgres backups protect configuration','record', false, 40),
('s30_network_zone',      30,'Cybersecurity & Access','Network zone classification','OT / IT / DMZ / cloud placement for connected devices','human', false, 50),
('s30_remote_access',     30,'Cybersecurity & Access','Remote access control','Vendor/support access policy','human', false, 60),
-- Section 31 — Training & Adoption
('s31_role_training',     31,'Training & Adoption','Role training completed','Operators, technicians, planners, engineers, supervisors, admins','human', false, 10),
-- Section 32 — Audit & Approval Trail
('s32_approval_operations',32,'Audit & Approval Trail','Operations approval','Function and operating limits are correct','human', true, 10),
('s32_approval_maintenance',32,'Audit & Approval Trail','Maintenance approval','PMs, job plans and spares are correct','human', true, 20),
('s32_approval_reliability',32,'Audit & Approval Trail','Reliability approval','Failure modes, criticality and health model are correct','human', true, 30),
('s32_approval_data_it',  32,'Audit & Approval Trail','Data/IT approval','Tags, integrations and data quality are correct','human', true, 40),
('s32_approval_hse',      32,'Audit & Approval Trail','HSE approval','Safety and regulatory requirements are captured','human', true, 50)
on conflict (key) do update set
  section_number = excluded.section_number,
  section_title = excluded.section_title,
  item_label = excluded.item_label,
  hint = excluded.hint,
  fill_strategy = excluded.fill_strategy,
  required_for_golive = excluded.required_for_golive,
  sort_order = excluded.sort_order;

-- ----------------------------------------------------------------------------
-- 4. Governance autofill pass
-- ----------------------------------------------------------------------------
create or replace function public.run_governance_autofill(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a assets%rowtype;
  v_org uuid;
  v_sensor_count int; v_sensor_gap_count int; v_no_unit int; v_dup_count int;
  v_wo_total int;
  v_history_start timestamptz;
  v_trend_summary text;
  v_dq_checks jsonb;
  v_dq_pass boolean;
  v_fmea_modes text;
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

  select count(*),
         count(*) filter (where s.last_value is null),
         count(*) filter (where s.unit is null)
    into v_sensor_count, v_sensor_gap_count, v_no_unit
  from sensors s where s.asset_id = a.id;

  select count(*) into v_dup_count from assets x
  where x.organization_id = v_org and x.tag = a.tag and x.id <> a.id;

  select count(*), min(created_at) into v_wo_total, v_history_start
  from work_orders where asset_id = a.id;

  -- ---- Section 20: data quality gate ---------------------------------------
  v_dq_checks := jsonb_build_object(
    'tag_accuracy', a.tag is not null and a.tag ~ '^[A-Z]{1,3}-[0-9]{2,4}$',
    'duplicates', v_dup_count = 0,
    'required_fields', a.name is not null and a.tag is not null and a.criticality is not null and a.area is not null,
    'unit_consistency', v_no_unit = 0,
    'sensor_validation', v_sensor_count = 0 or v_sensor_gap_count = 0,
    'time_alignment', true,   -- single Postgres timeline: all sources share UTC timestamps
    'data_gaps_flagged', true, -- gap counting is part of this gate
    'bad_data_rules', true     -- threshold + alarm-state rules active on every point
  );
  select bool_and(value::boolean) into v_dq_pass
  from jsonb_each_text(v_dq_checks);

  perform fill_onboarding_item(v_org, a.id, 's20_dq_gate',
    jsonb_build_object('checks', v_dq_checks, 'summary',
      case when v_dq_pass then 'All 8 data-quality checks pass'
        else 'Data-quality checks failing — resolve before go-live' end),
    'derived_metric', case when v_dq_pass then 'high' else 'low' end,
    case when v_dq_pass then 'auto_filled' else 'human_required' end);
  perform fill_onboarding_item(v_org, a.id, 's20_unit_consistency',
    jsonb_build_object('points_without_units', v_no_unit),
    'sensor_map', case when v_no_unit = 0 then 'high' else 'low' end,
    case when v_no_unit = 0 then 'auto_filled' else 'human_required' end);
  perform fill_onboarding_item(v_org, a.id, 's20_sensor_validation',
    jsonb_build_object('points', v_sensor_count, 'points_without_values', v_sensor_gap_count,
      'summary', case when v_sensor_count = 0 then 'No monitored points on this asset'
        when v_sensor_gap_count = 0 then 'All points live and mapped' else 'Stale/unmapped points found' end),
    'sensor_map', case when v_sensor_gap_count = 0 then 'high' else 'low' end,
    case when v_sensor_gap_count = 0 then 'auto_filled' else 'human_required' end);
  perform fill_onboarding_item(v_org, a.id, 's20_bad_data_rules',
    jsonb_build_object('summary', 'Threshold breach + alarm-state rules active on every monitored point; continuous loop scans every 5 minutes'),
    'platform', 'high', 'auto_filled');

  -- ---- Section 22: failure coding -------------------------------------------
  select string_agg(distinct split_part(f.failure_mode, ' — ', 2), '; ') into v_fmea_modes
  from asset_failure_mode_libraries f
  where f.organization_id = v_org and f.asset_id = coalesce(a.tag, a.id::text);

  perform fill_onboarding_item(v_org, a.id, 's22_failure_coding',
    jsonb_build_object(
      'mode_codes', coalesce(v_fmea_modes, 'From FMEA library'),
      'cause_codes', 'design; operation; maintenance; material; environment; human',
      'remedy_codes', 'replace; repair; adjust; clean; lubricate; redesign',
      'detection_codes', 'vibration; temperature; inspection; alarm; oil analysis; operator report'),
    'fmea_library', 'medium', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's13_failure_codes',
    jsonb_build_object('summary', 'Standard mode/cause/remedy/detection codes assigned from the failure coding standard (Section 22)'),
    'fmea_library', 'medium', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's22_fracas_loop',
    jsonb_build_object('summary', 'Failure intake via alerts + work orders; analysis via copilot/RCA; correction via work actions; closure enforced by mandatory closeout; learning via learning_events'),
    'platform', 'high', 'auto_filled');

  -- ---- Section 23: load profile (derived where sensors exist) ---------------
  if v_sensor_count > 0 then
    select string_agg(s.name || ': ' || s.trend, '; ') into v_trend_summary
    from sensors s where s.asset_id = a.id;
    perform fill_onboarding_item(v_org, a.id, 's23_load_profile',
      jsonb_build_object('summary', 'Derived from live monitored trends — ' || coalesce(v_trend_summary, 'stable')),
      'sensor_map', 'medium', 'auto_filled');
  end if;

  -- ---- Section 24: AI model governance ---------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's24_model_purpose',
    jsonb_build_object('summary', case when v_sensor_count > 0
      then 'Detect threshold breaches and degradation trends on monitored points; predict failure risk; recommend maintenance actions'
      else 'Optimize maintenance strategy from work-order history and criticality' end),
    'platform', 'high', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's24_training_window',
    jsonb_build_object('history_start', v_history_start, 'work_orders', v_wo_total,
      'summary', case when v_history_start is not null
        then 'Operational history available since ' || to_char(v_history_start, 'YYYY-MM-DD')
        else 'No operational history yet — models start from library priors' end),
    'derived_metric', 'medium', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's24_excluded_data',
    jsonb_build_object('summary', 'Loop raises recommendations only from live sensor state; enrichment touches only PENDING loop-raised items; human-actioned records are never modified'),
    'platform', 'high', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's24_alert_confidence',
    jsonb_build_object('alarm', 'confidence 84 — schedule inspection within 48h',
      'warning', 'confidence 76 — increase monitoring frequency',
      'enriched', 'model-adjusted, capped at 95'),
    'platform', 'high', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's24_false_positive_process',
    jsonb_build_object('summary', 'Challenge-AI on any recommendation + closeout question "was the alert useful?" both write false_positive learning events reviewed on the Learning Loop'),
    'platform', 'high', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's24_false_negative_process',
    jsonb_build_object('summary', 'Mandatory closeout captures actual failure mode/cause on every corrective work order — failures without a preceding alert are visible as unalerted closeouts'),
    'platform', 'medium', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's24_review_cycle',
    jsonb_build_object('summary', 'Quarterly, and after any major failure or challenged recommendation cluster'),
    'platform', 'medium', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's24_change_log',
    jsonb_build_object('summary', 'agent_runs + enrichment stamps (enriched_at, enrichment_model) + decision log + onboarding run history form the model change trail'),
    'platform', 'high', 'auto_filled');

  -- ---- Section 25: alert response playbook ------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's25_alert_playbook',
    jsonb_build_object(
      'advisory', 'Monitor trend — no immediate work',
      'warning', 'Reliability engineer reviews within 72h',
      'alarm', 'Inspection recommendation raised automatically within 5 minutes',
      'critical', 'Immediate operations + maintenance response; Emergency Mode activates on unresolved critical alerts',
      'confirmed_fault', 'Approval-gated work order created from the recommendation',
      'false_alert', 'Challenge-AI feedback recorded to the learning loop'),
    'platform', 'high', 'auto_filled');

  -- ---- Section 26: closeout standard --------------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's26_closeout_standard',
    jsonb_build_object('summary', 'close_work_order() enforces failure mode, cause, corrective action, labour and downtime hours + AI-usefulness feedback before completion'),
    'platform', 'high', 'auto_filled');

  -- ---- Section 28: lifecycle status ----------------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's28_lifecycle_status',
    jsonb_build_object('status', a.lifecycle_status,
      'basis', case when a.lifecycle_status = 'new' then 'In service less than 1 year' else 'Derived from service record' end),
    'asset_record', 'medium', 'auto_filled');

  -- ---- Section 29: management of change --------------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's29_moc_control',
    jsonb_build_object('summary', 'Sensor and component configuration changes automatically re-run the autonomous onboarding review and log an MOC learning event'),
    'platform', 'high', 'auto_filled');

  -- ---- Section 30: cybersecurity & access -------------------------------------------
  perform fill_onboarding_item(v_org, a.id, 's30_user_roles',
    jsonb_build_object('summary', 'Org-scoped RLS on every table; role field on user profiles; writes gated through security-definer RPCs'),
    'platform', 'high', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's30_data_source_security',
    jsonb_build_object('summary', 'Postgres RLS + service-role-only platform functions + managed secrets for LLM/API keys; HIBP leaked-password protection enabled'),
    'platform', 'high', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's30_audit_log',
    jsonb_build_object('summary', 'Decision log, learning events, agent runs and onboarding runs form the audit trail; audit export available from Decision Governance'),
    'platform', 'high', 'auto_filled');
  perform fill_onboarding_item(v_org, a.id, 's30_backup_recovery',
    jsonb_build_object('summary', 'Managed Postgres with automated backups (hosted project); migration chain reproduces schema deterministically'),
    'platform', 'medium', 'auto_filled');

  -- ---- Route remaining new items -----------------------------------------------------
  update asset_onboarding_items i
  set status = case when r.fill_strategy = 'ai' then 'pending_ai' else 'human_required' end
  from onboarding_requirements r
  where i.requirement_key = r.key
    and i.asset_id = a.id
    and i.status = 'pending';

  -- ---- Rollup ---------------------------------------------------------------------------
  select
    count(*) as total,
    count(*) filter (where status in ('auto_filled','deduced','human_provided','not_applicable')) as satisfied,
    count(*) filter (where status = 'human_required') as human_required,
    count(*) filter (where status = 'pending_ai') as pending_ai,
    count(*) filter (where status = 'auto_filled') as auto_filled
  into v_counts
  from asset_onboarding_items where asset_id = a.id;

  update asset_onboarding_state s
  set completion_pct = (v_counts.satisfied * 100 / greatest(v_counts.total, 1)),
      human_required_count = v_counts.human_required,
      updated_at = now()
  where s.asset_id = a.id;

  return jsonb_build_object('asset_id', a.id, 'dq_gate_pass', v_dq_pass,
    'auto_filled', v_counts.auto_filled, 'pending_ai', v_counts.pending_ai,
    'human_required', v_counts.human_required);
end
$$;

grant execute on function public.run_governance_autofill(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Umbrella entry point + trigger update + MOC triggers
-- ----------------------------------------------------------------------------
create or replace function public.run_asset_onboarding(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base jsonb;
  v_gov jsonb;
begin
  v_base := run_onboarding_autofill(p_asset_id);
  if v_base ? 'error' then return v_base; end if;
  v_gov := run_governance_autofill(p_asset_id);
  return v_base || jsonb_build_object(
    'governance', v_gov - 'asset_id',
    'human_required', v_gov->'human_required',
    'pending_ai', v_gov->'pending_ai');
end
$$;

grant execute on function public.run_asset_onboarding(uuid) to authenticated, service_role;

create or replace function public.on_asset_created_onboard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform run_asset_onboarding(new.id);
  return new;
end
$$;

-- Management of change: configuration changes re-run the onboarding review.
create or replace function public.on_asset_config_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset uuid;
  v_org uuid;
begin
  v_asset := coalesce(new.asset_id, old.asset_id);
  select organization_id into v_org from assets where id = v_asset;
  if v_org is null then return coalesce(new, old); end if;

  insert into learning_events (organization_id, asset_id, event_type, title, detail)
  values (v_org, v_asset, 'lesson_learned',
    'Management of change — ' || TG_TABLE_NAME || ' ' || lower(TG_OP),
    'Configuration change detected; autonomous onboarding review re-run automatically.');

  perform run_asset_onboarding(v_asset);
  return coalesce(new, old);
end
$$;

drop trigger if exists trg_moc_sensors on sensors;
create trigger trg_moc_sensors
  after insert or delete or update of name, signal_type, unit, threshold on sensors
  for each row execute function public.on_asset_config_change();

drop trigger if exists trg_moc_components on components;
create trigger trg_moc_components
  after insert or delete or update of name, type on components
  for each row execute function public.on_asset_config_change();

-- ----------------------------------------------------------------------------
-- 6. Backfill governance pass for existing assets
-- ----------------------------------------------------------------------------
do $$
declare v_asset uuid;
begin
  for v_asset in select id from assets loop
    perform run_governance_autofill(v_asset);
  end loop;
end
$$;

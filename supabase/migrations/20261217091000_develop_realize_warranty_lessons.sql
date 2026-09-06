-- ============================================================================
-- Sync Develop — Realize / Learn (D9.02, D9.03, D9.04, D9.11, D9.13)
--
-- ONE WARRANTY STORE, ONE VERIFICATION LOOP, ONE LEARNING STORE.
--
-- D9.02  OperationalPerformanceWarranty  → grow `ram_targets` (ruling 13).
--        `warranty_terms` / `warranty_claims` stay COMMERCIAL vendor cover.
-- D9.03  30/90/180/365 checkpoints       → `value_metrics` rows + the one
--        `verify_value_metric` loop (ruling 12). No checkpoint table.
-- D9.13  Benefits realization workflow   → the same shells, auto-created
--        when a named human opens the post-startup window. No re-entry.
-- D9.04  Eight delivery failure types    → a `taxonomy_definitions` branch
--        (the ONE failure-mode identity). Seeded DRAFT; adoption is C3.
-- D9.11  Lesson / Project-FRACAS §33     → extend `learning_events` (ruling 9)
--        with case/project linkage + cause / corrective_action / applicability.
--
-- recommend ≠ authorize: recording a design target, opening the window, and
-- capturing an observation never verify a metric and never adopt a standard.
-- Verification stays `verify_value_metric`. Methodology revision is D9.09.
--
-- Canonical reuse: ram_targets, value_metrics, learning_events,
-- taxonomy_definitions, development_cases, capital_projects, audit_events.
-- No new root object. Child columns only.
-- ============================================================================

-- Vocabularies the TypeScript module mirrors. The slice test pins the pairs.
create or replace function public.sync_warranty_metric_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'throughput',
    'availability',
    'reliability',
    'maintenance_cost',
    'energy',
    'quality',
    'operating_cost'
  ];
$$;

create or replace function public.sync_checkpoint_horizons()
returns int[]
language sql
immutable
as $$
  select array[30, 90, 180, 365];
$$;

create or replace function public.sync_delivery_failure_types()
returns text[]
language sql
immutable
as $$
  select array[
    'project_delivery.bad_estimate',
    'project_delivery.late_design',
    'project_delivery.poor_vendor_data',
    'project_delivery.construction_rework',
    'project_delivery.interface_failure',
    'project_delivery.commissioning_defect',
    'project_delivery.startup_failure',
    'project_delivery.benefit_shortfall'
  ];
$$;

revoke all on function public.sync_warranty_metric_keys() from public, anon;
revoke all on function public.sync_checkpoint_horizons() from public, anon;
revoke all on function public.sync_delivery_failure_types() from public, anon;
grant execute on function public.sync_warranty_metric_keys() to authenticated, service_role;
grant execute on function public.sync_checkpoint_horizons() to authenticated, service_role;
grant execute on function public.sync_delivery_failure_types() to authenticated, service_role;

-- A target without its unit is a bare number. Used by the ram_targets CHECKs.
create or replace function public.sync_metric_pair_ok(p_target numeric, p_unit text)
returns boolean
language sql
immutable
as $$
  select (p_target is null and (p_unit is null or btrim(p_unit) = ''))
      or (p_target is not null and p_unit is not null and btrim(p_unit) <> '');
$$;

revoke all on function public.sync_metric_pair_ok(numeric, text) from public, anon;
grant execute on function public.sync_metric_pair_ok(numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D9.02 — grow ram_targets into the seven-metric internal commitment.
-- Existing target_availability stays the availability leg (NOT NULL, 0–1).
-- The other six are optional: unstated renders "not warranted", never zero.
-- ---------------------------------------------------------------------------
alter table public.ram_targets
  add column if not exists development_case_id uuid
    references development_cases(id) on delete set null,
  add column if not exists asset_id uuid
    references assets(id) on delete set null,
  add column if not exists startup_at date,
  add column if not exists survives_handover boolean not null default true,
  add column if not exists warranty_basis text,
  add column if not exists throughput_target numeric,
  add column if not exists throughput_unit text,
  add column if not exists reliability_target numeric,
  add column if not exists reliability_unit text,
  add column if not exists maintenance_cost_target numeric,
  add column if not exists maintenance_cost_unit text,
  add column if not exists energy_target numeric,
  add column if not exists energy_unit text,
  add column if not exists quality_target numeric,
  add column if not exists quality_unit text,
  add column if not exists operating_cost_target numeric,
  add column if not exists operating_cost_unit text;

alter table public.ram_targets
  drop constraint if exists ram_targets_case_warranty_basis;
alter table public.ram_targets
  add constraint ram_targets_case_warranty_basis check (
    development_case_id is null
    or (warranty_basis is not null and btrim(warranty_basis) <> '')
  );

alter table public.ram_targets
  drop constraint if exists ram_targets_metric_pairs;
alter table public.ram_targets
  add constraint ram_targets_metric_pairs check (
    sync_metric_pair_ok(throughput_target, throughput_unit)
    and sync_metric_pair_ok(reliability_target, reliability_unit)
    and sync_metric_pair_ok(maintenance_cost_target, maintenance_cost_unit)
    and sync_metric_pair_ok(energy_target, energy_unit)
    and sync_metric_pair_ok(quality_target, quality_unit)
    and sync_metric_pair_ok(operating_cost_target, operating_cost_unit)
  );

create index if not exists idx_ram_targets_case
  on ram_targets(organization_id, development_case_id)
  where development_case_id is not null;

comment on column public.ram_targets.survives_handover is
  'Internal performance warranty outlives project close. vendor cover lives on warranty_terms.';

-- Same-org on the case and the optional asset, for every writer.
create or replace function public.enforce_ram_target_case_tenancy()
returns trigger
language plpgsql
as $$
declare
  v_case_org uuid;
  v_asset_org uuid;
begin
  if new.development_case_id is not null then
    select organization_id into v_case_org
      from development_cases where id = new.development_case_id;
    if v_case_org is distinct from new.organization_id then
      raise exception
        'A case warranty belongs to its case''s organization — a ram_target pointing at another tenant''s development case is refused for every writer.'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.asset_id is not null then
    select organization_id into v_asset_org
      from assets where id = new.asset_id;
    if v_asset_org is distinct from new.organization_id then
      raise exception
        'A warranty asset must belong to this organization — commercial vendor warranty is a different store (warranty_terms).'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_ram_target_case_tenancy on public.ram_targets;
create trigger trg_ram_target_case_tenancy
  before insert or update on public.ram_targets
  for each row execute function public.enforce_ram_target_case_tenancy();

revoke all on function public.enforce_ram_target_case_tenancy() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- D9.03 / D9.13 — checkpoint columns on the ONE value store.
-- ---------------------------------------------------------------------------
alter table public.value_metrics
  add column if not exists checkpoint_horizon_days int,
  add column if not exists ram_target_id bigint
    references ram_targets(id) on delete cascade,
  add column if not exists parent_metric_id uuid
    references value_metrics(id) on delete cascade,
  add column if not exists warranted_metric text,
  add column if not exists observed_value numeric,
  add column if not exists observation_method text,
  add column if not exists observation_evidence text,
  add column if not exists observed_by uuid,
  add column if not exists observed_at timestamptz,
  add column if not exists due_on date;

alter table public.value_metrics
  drop constraint if exists value_metrics_checkpoint_horizon;
alter table public.value_metrics
  add constraint value_metrics_checkpoint_horizon check (
    checkpoint_horizon_days is null
    or checkpoint_horizon_days = any (sync_checkpoint_horizons())
  );

alter table public.value_metrics
  drop constraint if exists value_metrics_checkpoint_metric;
alter table public.value_metrics
  add constraint value_metrics_checkpoint_metric check (
    warranted_metric is null
    or warranted_metric = any (sync_warranty_metric_keys())
  );

alter table public.value_metrics
  drop constraint if exists value_metrics_checkpoint_anchor;
alter table public.value_metrics
  add constraint value_metrics_checkpoint_anchor check (
    checkpoint_horizon_days is null
    or num_nonnulls(ram_target_id, parent_metric_id) = 1
  );

create unique index if not exists idx_value_metrics_warranty_checkpoint
  on value_metrics(ram_target_id, warranted_metric, checkpoint_horizon_days)
  where ram_target_id is not null and checkpoint_horizon_days is not null;

create unique index if not exists idx_value_metrics_benefit_checkpoint
  on value_metrics(parent_metric_id, checkpoint_horizon_days)
  where parent_metric_id is not null and checkpoint_horizon_days is not null;

create index if not exists idx_value_metrics_case_checkpoints
  on value_metrics(organization_id, development_case_id, checkpoint_horizon_days)
  where checkpoint_horizon_days is not null;

-- ---------------------------------------------------------------------------
-- D9.04 / D9.11 — project FRACAS on the ONE learning store + taxonomy branch.
-- ---------------------------------------------------------------------------
alter table public.learning_events
  add column if not exists development_case_id uuid
    references development_cases(id) on delete set null,
  add column if not exists capital_project_id bigint
    references capital_projects(id) on delete set null,
  add column if not exists failure_mode_key text,
  add column if not exists cause text,
  add column if not exists corrective_action text,
  add column if not exists applicability text;

alter table public.learning_events
  drop constraint if exists learning_events_case_lesson_complete;
alter table public.learning_events
  add constraint learning_events_case_lesson_complete check (
    development_case_id is null
    or (
      failure_mode_key is not null
      and failure_mode_key = any (sync_delivery_failure_types())
      and cause is not null and btrim(cause) <> ''
      and corrective_action is not null and btrim(corrective_action) <> ''
      and applicability is not null and btrim(applicability) <> ''
    )
  );

create index if not exists idx_learning_events_case
  on learning_events(organization_id, development_case_id)
  where development_case_id is not null;

create or replace function public.enforce_learning_event_case_tenancy()
returns trigger
language plpgsql
as $$
declare
  v_case_org uuid;
  v_project_org uuid;
begin
  if new.development_case_id is not null then
    select organization_id into v_case_org
      from development_cases where id = new.development_case_id;
    if v_case_org is distinct from new.organization_id then
      raise exception
        'A project lesson belongs to its case''s organization — a learning_event pointing at another tenant''s development case is refused for every writer.'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.capital_project_id is not null then
    select organization_id into v_project_org
      from capital_projects where id = new.capital_project_id;
    if v_project_org is distinct from new.organization_id then
      raise exception
        'A project lesson''s capital_project_id must belong to this organization.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_learning_event_case_tenancy on public.learning_events;
create trigger trg_learning_event_case_tenancy
  before insert or update on public.learning_events
  for each row execute function public.enforce_learning_event_case_tenancy();

revoke all on function public.enforce_learning_event_case_tenancy() from public, anon, authenticated;

-- Eight delivery failure types as DRAFT taxonomy for every existing org.
-- Adoption remains the C3 human act. No OEM values invented — the eight
-- names are spec I.37 verbatim.
insert into taxonomy_definitions (
  organization_id, def_key, title, definition, basis, register_ref, status, version
)
select o.id, d.def_key, d.title, d.definition, d.basis, d.register_ref, 'draft', 1
from organizations o
cross join (values
  ('project_delivery.bad_estimate',
   'Bad estimate',
   'A project-delivery failure whose dominant cause is an estimate that did not survive contact with the work: quantity, productivity, or cost basis that proved wrong.',
   'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim',
   'D9.04'),
  ('project_delivery.late_design',
   'Late design',
   'A project-delivery failure caused by design information arriving after the activity that needed it, producing hold, rework or out-of-sequence work.',
   'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim',
   'D9.04'),
  ('project_delivery.poor_vendor_data',
   'Poor vendor data',
   'A project-delivery failure caused by incomplete, late or incorrect vendor information (drawings, weights, utilities, interfaces) that the project had to treat as true.',
   'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim',
   'D9.04'),
  ('project_delivery.construction_rework',
   'Construction rework',
   'A project-delivery failure in which installed work had to be removed or redone because of construction quality, sequence or interface error.',
   'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim',
   'D9.04'),
  ('project_delivery.interface_failure',
   'Interface failure',
   'A project-delivery failure at a boundary between packages, disciplines or organizations where responsibility was assumed rather than specified.',
   'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim',
   'D9.04'),
  ('project_delivery.commissioning_defect',
   'Commissioning defect',
   'A project-delivery failure discovered or introduced during commissioning: a test that could not pass, a punch that should have been found earlier, or a procedure that did not match the plant.',
   'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim',
   'D9.04'),
  ('project_delivery.startup_failure',
   'Startup failure',
   'A project-delivery failure during first operation: the asset or system could not hold the intended duty after energization or introduction of process.',
   'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim',
   'D9.04'),
  ('project_delivery.benefit_shortfall',
   'Benefit shortfall',
   'A project-delivery failure in which the sanctioned benefit did not appear in the operating window it was promised for. Distinct from a commercial warranty claim.',
   'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim',
   'D9.04')
) as d(def_key, title, definition, basis, register_ref)
on conflict (organization_id, def_key, version) do nothing;

create or replace function public.ensure_project_delivery_taxonomy()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
begin
  if v_org is null then
    return;
  end if;
  insert into taxonomy_definitions (
    organization_id, def_key, title, definition, basis, register_ref, status, version
  )
  select v_org, d.def_key, d.title, d.definition, d.basis, d.register_ref, 'draft', 1
  from (values
    ('project_delivery.bad_estimate', 'Bad estimate',
     'A project-delivery failure whose dominant cause is an estimate that did not survive contact with the work: quantity, productivity, or cost basis that proved wrong.',
     'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim', 'D9.04'),
    ('project_delivery.late_design', 'Late design',
     'A project-delivery failure caused by design information arriving after the activity that needed it, producing hold, rework or out-of-sequence work.',
     'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim', 'D9.04'),
    ('project_delivery.poor_vendor_data', 'Poor vendor data',
     'A project-delivery failure caused by incomplete, late or incorrect vendor information (drawings, weights, utilities, interfaces) that the project had to treat as true.',
     'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim', 'D9.04'),
    ('project_delivery.construction_rework', 'Construction rework',
     'A project-delivery failure in which installed work had to be removed or redone because of construction quality, sequence or interface error.',
     'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim', 'D9.04'),
    ('project_delivery.interface_failure', 'Interface failure',
     'A project-delivery failure at a boundary between packages, disciplines or organizations where responsibility was assumed rather than specified.',
     'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim', 'D9.04'),
    ('project_delivery.commissioning_defect', 'Commissioning defect',
     'A project-delivery failure discovered or introduced during commissioning: a test that could not pass, a punch that should have been found earlier, or a procedure that did not match the plant.',
     'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim', 'D9.04'),
    ('project_delivery.startup_failure', 'Startup failure',
     'A project-delivery failure during first operation: the asset or system could not hold the intended duty after energization or introduction of process.',
     'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim', 'D9.04'),
    ('project_delivery.benefit_shortfall', 'Benefit shortfall',
     'A project-delivery failure in which the sanctioned benefit did not appear in the operating window it was promised for. Distinct from a commercial warranty claim.',
     'Sync Develop spec I.37 Project FRACAS — eight delivery failure types, verbatim', 'D9.04')
  ) as d(def_key, title, definition, basis, register_ref)
  on conflict (organization_id, def_key, version) do nothing;
end
$$;

revoke all on function public.ensure_project_delivery_taxonomy() from public, anon;
grant execute on function public.ensure_project_delivery_taxonomy() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared role predicate. Preparation roles; ai_admin is refused by name.
-- ---------------------------------------------------------------------------
create or replace function public.sync_realize_writer_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from user_profiles where id = auth.uid();
  return v_role;
end
$$;

revoke all on function public.sync_realize_writer_role() from public, anon;
grant execute on function public.sync_realize_writer_role() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D9.02 write path — record the internal performance warranty.
-- ---------------------------------------------------------------------------
create or replace function public.record_operational_warranty(
  p_case_id uuid,
  p_system_label text,
  p_target_availability numeric,
  p_warranty_basis text,
  p_asset_id uuid default null,
  p_metrics jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text := sync_realize_writer_role();
  c development_cases%rowtype;
  v_id bigint;
  v_key text;
  v_metrics jsonb := coalesce(p_metrics, '{}'::jsonb);
  v_throughput numeric;
  v_throughput_unit text;
  v_reliability numeric;
  v_reliability_unit text;
  v_maint numeric;
  v_maint_unit text;
  v_energy numeric;
  v_energy_unit text;
  v_quality numeric;
  v_quality_unit text;
  v_opex numeric;
  v_opex_unit text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording an operational performance warranty requires a planning, engineering or governance role — the AI-operator identity is not offered (recommend ≠ authorize)');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error',
      'a warranty is not recordable on a ' || c.status || ' case');
  end if;
  if c.capital_project_id is null then
    return jsonb_build_object('error',
      'an operational warranty binds to the delivery-side capital project (ram_targets.project_id) — bind the case to a capital project first');
  end if;
  if coalesce(length(btrim(p_system_label)), 0) < 2 then
    return jsonb_build_object('error', 'a warranty names the system it commits (2 characters minimum)');
  end if;
  if p_target_availability is null
     or p_target_availability <= 0
     or p_target_availability >= 1 then
    return jsonb_build_object('error',
      'availability is the required I.36 metric and stays on ram_targets.target_availability — state a fraction strictly between 0 and 1');
  end if;
  if coalesce(length(btrim(p_warranty_basis)), 0) < 10 then
    return jsonb_build_object('error',
      'a warranty without its basis is a number somebody liked — state where the commitment comes from (10 characters minimum)');
  end if;
  if p_asset_id is not null and not exists (
    select 1 from assets where id = p_asset_id and organization_id = v_org) then
    return jsonb_build_object('error',
      'the linked asset must belong to this organization — this is not vendor warranty_terms');
  end if;

  for v_key in select jsonb_object_keys(v_metrics)
  loop
    if v_key = 'availability' then
      return jsonb_build_object('error',
        'availability is p_target_availability — do not also send it in p_metrics');
    end if;
    if v_key <> all (sync_warranty_metric_keys()) then
      return jsonb_build_object('error',
        'unknown warranted metric "' || v_key || '" — the seven I.36 keys are throughput, availability, reliability, maintenance_cost, energy, quality, operating_cost');
    end if;
    if jsonb_typeof(v_metrics -> v_key) is distinct from 'object'
       or (v_metrics -> v_key ->> 'target') is null
       or (v_metrics -> v_key ->> 'unit') is null
       or btrim(v_metrics -> v_key ->> 'unit') = '' then
      return jsonb_build_object('error',
        'metric "' || v_key || '" states {target, unit} together or is omitted — an unstated metric is not warranted, never zero');
    end if;
  end loop;

  v_throughput := nullif(v_metrics #>> '{throughput,target}', '')::numeric;
  v_throughput_unit := nullif(btrim(v_metrics #>> '{throughput,unit}'), '');
  v_reliability := nullif(v_metrics #>> '{reliability,target}', '')::numeric;
  v_reliability_unit := nullif(btrim(v_metrics #>> '{reliability,unit}'), '');
  v_maint := nullif(v_metrics #>> '{maintenance_cost,target}', '')::numeric;
  v_maint_unit := nullif(btrim(v_metrics #>> '{maintenance_cost,unit}'), '');
  v_energy := nullif(v_metrics #>> '{energy,target}', '')::numeric;
  v_energy_unit := nullif(btrim(v_metrics #>> '{energy,unit}'), '');
  v_quality := nullif(v_metrics #>> '{quality,target}', '')::numeric;
  v_quality_unit := nullif(btrim(v_metrics #>> '{quality,unit}'), '');
  v_opex := nullif(v_metrics #>> '{operating_cost,target}', '')::numeric;
  v_opex_unit := nullif(btrim(v_metrics #>> '{operating_cost,unit}'), '');

  insert into ram_targets (
    organization_id, project_id, development_case_id, asset_id,
    system_label, target_availability, target_basis, warranty_basis,
    survives_handover, configuration,
    throughput_target, throughput_unit,
    reliability_target, reliability_unit,
    maintenance_cost_target, maintenance_cost_unit,
    energy_target, energy_unit,
    quality_target, quality_unit,
    operating_cost_target, operating_cost_unit
  ) values (
    v_org, c.capital_project_id, c.id, p_asset_id,
    btrim(p_system_label), p_target_availability, btrim(p_warranty_basis),
    btrim(p_warranty_basis), true, 'series',
    v_throughput, v_throughput_unit,
    v_reliability, v_reliability_unit,
    v_maint, v_maint_unit,
    v_energy, v_energy_unit,
    v_quality, v_quality_unit,
    v_opex, v_opex_unit
  )
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'operational_performance_warranty', coalesce(v_role, 'unknown'),
    jsonb_build_object(
      'ram_target_id', v_id, 'case_id', c.id,
      'system_label', btrim(p_system_label),
      'target_availability', p_target_availability,
      'survives_handover', true,
      'note', 'Projected design commitment — checkpoints are not generated until a named human opens the realization window'));

  return jsonb_build_object(
    'ram_target_id', v_id,
    'case_id', c.id,
    'survives_handover', true,
    'note', 'Internal performance warranty recorded on ram_targets. Checkpoints are not generated until open_realization_window. Verification stays verify_value_metric.');
end
$$;

revoke all on function public.record_operational_warranty(uuid, text, numeric, text, uuid, jsonb) from public, anon;
grant execute on function public.record_operational_warranty(uuid, text, numeric, text, uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generate 30/90/180/365 shells. Idempotent. Called only from the window.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_realization_checkpoints(
  p_case_id uuid,
  p_startup date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_warranty_n int := 0;
  v_benefit_n int := 0;
  r record;
  h int;
  v_due date;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  for r in
    select t.*
    from ram_targets t
    where t.organization_id = v_org
      and t.development_case_id = p_case_id
  loop
    foreach h in array sync_checkpoint_horizons()
    loop
      v_due := (p_startup + (h || ' days')::interval)::date;

      -- Availability is always stated (column NOT NULL).
      insert into value_metrics (
        organization_id, development_case_id, ram_target_id,
        metric_type, label, value, unit, status, period,
        checkpoint_horizon_days, warranted_metric, due_on, basis
      )
      select v_org, p_case_id, r.id,
             'realization_checkpoint',
             r.system_label || ' — availability @ day ' || h,
             r.target_availability, 'fraction', 'projected', 'day_' || h,
             h, 'availability', v_due, r.warranty_basis
      where not exists (
        select 1 from value_metrics v
        where v.ram_target_id = r.id
          and v.warranted_metric = 'availability'
          and v.checkpoint_horizon_days = h
      );
      if found then v_warranty_n := v_warranty_n + 1; end if;
    end loop;

    foreach h in array sync_checkpoint_horizons()
    loop
      v_due := (p_startup + (h || ' days')::interval)::date;

      if r.throughput_target is not null then
        insert into value_metrics (
          organization_id, development_case_id, ram_target_id,
          metric_type, label, value, unit, status, period,
          checkpoint_horizon_days, warranted_metric, due_on, basis
        )
        select v_org, p_case_id, r.id,
               'realization_checkpoint',
               r.system_label || ' — throughput @ day ' || h,
               r.throughput_target, r.throughput_unit, 'projected', 'day_' || h,
               h, 'throughput', v_due, r.warranty_basis
        where not exists (
          select 1 from value_metrics v
          where v.ram_target_id = r.id and v.warranted_metric = 'throughput'
            and v.checkpoint_horizon_days = h
        );
        if found then v_warranty_n := v_warranty_n + 1; end if;
      end if;

      if r.reliability_target is not null then
        insert into value_metrics (
          organization_id, development_case_id, ram_target_id,
          metric_type, label, value, unit, status, period,
          checkpoint_horizon_days, warranted_metric, due_on, basis
        )
        select v_org, p_case_id, r.id,
               'realization_checkpoint',
               r.system_label || ' — reliability @ day ' || h,
               r.reliability_target, r.reliability_unit, 'projected', 'day_' || h,
               h, 'reliability', v_due, r.warranty_basis
        where not exists (
          select 1 from value_metrics v
          where v.ram_target_id = r.id and v.warranted_metric = 'reliability'
            and v.checkpoint_horizon_days = h
        );
        if found then v_warranty_n := v_warranty_n + 1; end if;
      end if;

      if r.maintenance_cost_target is not null then
        insert into value_metrics (
          organization_id, development_case_id, ram_target_id,
          metric_type, label, value, unit, status, period,
          checkpoint_horizon_days, warranted_metric, due_on, basis
        )
        select v_org, p_case_id, r.id,
               'realization_checkpoint',
               r.system_label || ' — maintenance_cost @ day ' || h,
               r.maintenance_cost_target, r.maintenance_cost_unit, 'projected', 'day_' || h,
               h, 'maintenance_cost', v_due, r.warranty_basis
        where not exists (
          select 1 from value_metrics v
          where v.ram_target_id = r.id and v.warranted_metric = 'maintenance_cost'
            and v.checkpoint_horizon_days = h
        );
        if found then v_warranty_n := v_warranty_n + 1; end if;
      end if;

      if r.energy_target is not null then
        insert into value_metrics (
          organization_id, development_case_id, ram_target_id,
          metric_type, label, value, unit, status, period,
          checkpoint_horizon_days, warranted_metric, due_on, basis
        )
        select v_org, p_case_id, r.id,
               'realization_checkpoint',
               r.system_label || ' — energy @ day ' || h,
               r.energy_target, r.energy_unit, 'projected', 'day_' || h,
               h, 'energy', v_due, r.warranty_basis
        where not exists (
          select 1 from value_metrics v
          where v.ram_target_id = r.id and v.warranted_metric = 'energy'
            and v.checkpoint_horizon_days = h
        );
        if found then v_warranty_n := v_warranty_n + 1; end if;
      end if;

      if r.quality_target is not null then
        insert into value_metrics (
          organization_id, development_case_id, ram_target_id,
          metric_type, label, value, unit, status, period,
          checkpoint_horizon_days, warranted_metric, due_on, basis
        )
        select v_org, p_case_id, r.id,
               'realization_checkpoint',
               r.system_label || ' — quality @ day ' || h,
               r.quality_target, r.quality_unit, 'projected', 'day_' || h,
               h, 'quality', v_due, r.warranty_basis
        where not exists (
          select 1 from value_metrics v
          where v.ram_target_id = r.id and v.warranted_metric = 'quality'
            and v.checkpoint_horizon_days = h
        );
        if found then v_warranty_n := v_warranty_n + 1; end if;
      end if;

      if r.operating_cost_target is not null then
        insert into value_metrics (
          organization_id, development_case_id, ram_target_id,
          metric_type, label, value, unit, status, period,
          checkpoint_horizon_days, warranted_metric, due_on, basis
        )
        select v_org, p_case_id, r.id,
               'realization_checkpoint',
               r.system_label || ' — operating_cost @ day ' || h,
               r.operating_cost_target, r.operating_cost_unit, 'projected', 'day_' || h,
               h, 'operating_cost', v_due, r.warranty_basis
        where not exists (
          select 1 from value_metrics v
          where v.ram_target_id = r.id and v.warranted_metric = 'operating_cost'
            and v.checkpoint_horizon_days = h
        );
        if found then v_warranty_n := v_warranty_n + 1; end if;
      end if;
    end loop;
  end loop;

  -- Benefit checkpoints: one shell per recorded case benefit × four horizons.
  -- The benefit row itself stays the expected benefit; these are observations.
  for r in
    select m.*
    from value_metrics m
    where m.organization_id = v_org
      and m.development_case_id = p_case_id
      and m.checkpoint_horizon_days is null
      and m.parent_metric_id is null
      and m.ram_target_id is null
  loop
    foreach h in array sync_checkpoint_horizons()
    loop
      v_due := (p_startup + (h || ' days')::interval)::date;
      insert into value_metrics (
        organization_id, development_case_id, parent_metric_id, owner_id,
        objective_id, metric_type, label, value, unit, status, period,
        checkpoint_horizon_days, due_on, basis, expected_date
      )
      select v_org, p_case_id, r.id, r.owner_id,
             r.objective_id, 'realization_checkpoint',
             coalesce(r.label, r.metric_type) || ' @ day ' || h,
             r.value, r.unit, 'projected', 'day_' || h,
             h, v_due, r.basis, r.expected_date
      where not exists (
        select 1 from value_metrics v
        where v.parent_metric_id = r.id and v.checkpoint_horizon_days = h
      );
      if found then v_benefit_n := v_benefit_n + 1; end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'warranty_shells_created', v_warranty_n,
    'benefit_shells_created', v_benefit_n
  );
end
$$;

revoke all on function public.ensure_realization_checkpoints(uuid, date) from public, anon;
grant execute on function public.ensure_realization_checkpoints(uuid, date) to authenticated, service_role;

create or replace function public.open_realization_window(
  p_case_id uuid,
  p_startup date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text := sync_realize_writer_role();
  c development_cases%rowtype;
  v_shells jsonb;
  v_updated int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'opening the realization window is a named-human act — the AI-operator identity is not offered (recommend ≠ authorize)');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if p_startup is null then
    return jsonb_build_object('error',
      'a realization window without a startup date cannot date 30/90/180/365 — state when operations started');
  end if;

  update ram_targets
     set startup_at = p_startup
   where organization_id = v_org
     and development_case_id = c.id
     and startup_at is null;
  get diagnostics v_updated = row_count;

  v_shells := ensure_realization_checkpoints(c.id, p_startup);
  if v_shells ? 'error' then
    return v_shells;
  end if;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'realization_window', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'startup_at', p_startup,
      'warranties_started', v_updated, 'shells', v_shells));

  return jsonb_build_object(
    'case_id', c.id,
    'startup_at', p_startup,
    'warranties_started', v_updated,
    'warranty_shells_created', v_shells -> 'warranty_shells_created',
    'benefit_shells_created', v_shells -> 'benefit_shells_created',
    'note', 'Shells are projected. Observation is not verification. verify_value_metric is the one authorization door.');
end
$$;

revoke all on function public.open_realization_window(uuid, date) from public, anon;
grant execute on function public.open_realization_window(uuid, date) to authenticated, service_role;

-- Observation is evidence assembly. It does not verify.
create or replace function public.record_checkpoint_observation(
  p_metric_id uuid,
  p_observed_value numeric,
  p_method text,
  p_evidence text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text := sync_realize_writer_role();
  m value_metrics%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording an observed actual requires a planning, engineering or operations-adjacent role — the AI-operator identity is not offered');
  end if;
  select * into m from value_metrics
    where id = p_metric_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'checkpoint not found in your organization');
  end if;
  if m.checkpoint_horizon_days is null then
    return jsonb_build_object('error',
      'this value_metrics row is not a realization checkpoint — observe those through this door, verify any projected metric through verify_value_metric');
  end if;
  if m.status not in ('projected', 'baseline_pending_validation') then
    return jsonb_build_object('error',
      'only projected checkpoints accept an observation (current: ' || m.status || ')');
  end if;
  if p_observed_value is null then
    return jsonb_build_object('error', 'an observation states the actual number');
  end if;
  if coalesce(length(btrim(p_method)), 0) < 10 then
    return jsonb_build_object('error',
      'an observation without a method is a number somebody typed — state how it was measured (10 characters minimum)');
  end if;
  if coalesce(length(btrim(p_evidence)), 0) < 10 then
    return jsonb_build_object('error',
      'an observation without evidence cannot be verified later — name the record (10 characters minimum)');
  end if;

  -- `value` stays the DESIGN target. Overwriting it with the actual would
  -- make verify_value_metric stamp the observation as if it had been the
  -- commitment. observed_value is the actual; verification reads that.
  update value_metrics set
    observed_value = p_observed_value,
    observation_method = btrim(p_method),
    observation_evidence = btrim(p_evidence),
    observed_by = auth.uid(),
    observed_at = now()
  where id = m.id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'realization_observation', coalesce(v_role, 'unknown'),
    jsonb_build_object('metric_id', m.id, 'observed_value', p_observed_value,
      'horizon_days', m.checkpoint_horizon_days,
      'note', 'Observed, not verified — verify_value_metric remains the authorization door'));

  return jsonb_build_object(
    'metric_id', m.id,
    'status', m.status,
    'observed_value', p_observed_value,
    'note', 'Observed, not verified. value stays the DESIGN target. recommend ≠ authorize. Call verify_value_metric to authorize.');
end
$$;

revoke all on function public.record_checkpoint_observation(uuid, numeric, text, text) from public, anon;
grant execute on function public.record_checkpoint_observation(uuid, numeric, text, text) to authenticated, service_role;

-- Extend the ONE verification loop: a checkpoint without an observation
-- cannot be verified (that would stamp the design target as the actual).
create or replace function public.verify_value_metric(
  p_metric_id uuid,
  p_verified boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_new_status text;
begin
  select * into m from value_metrics
  where id = p_metric_id and organization_id = app_current_org();

  if m.id is null then
    raise exception 'Value metric not found in your organization';
  end if;
  if m.status not in ('projected', 'baseline_pending_validation') then
    raise exception 'Only projected/baseline metrics can be verified (current: %)', m.status;
  end if;
  if m.checkpoint_horizon_days is not null and m.observed_at is null then
    raise exception
      'A realization checkpoint cannot be verified until a named human records the observed actual — the design target is not the actual (recommend ≠ authorize)';
  end if;

  v_new_status := case when p_verified then 'verified' else 'rejected' end;
  -- Checkpoints verify the OBSERVED actual. Other metrics keep yesterday's
  -- behaviour (the projected `value` is what the human is confirming).

  update value_metrics set
    status = v_new_status,
    verified_by = auth.uid(),
    verified_at = now(),
    verification_note = p_note
  where id = p_metric_id;

  insert into learning_events (
    organization_id, recommendation_id, asset_id, event_type, title, detail,
    expected_value, verified_value, model_confidence, development_case_id
  ) values (
    m.organization_id, m.recommendation_id, m.asset_id,
    case when p_verified then 'work_completed' else 'false_positive' end,
    case when p_verified
      then 'Value verified — ' || coalesce(m.label, m.metric_type)
      else 'Value rejected — ' || coalesce(m.label, m.metric_type) end,
    coalesce(p_note,
      case when p_verified
        then 'Projected value confirmed by operator review.'
        else 'Projected value rejected by operator review — model feedback captured.' end),
    m.value,
    case
      when not p_verified then 0
      when m.checkpoint_horizon_days is not null then m.observed_value
      else m.value
    end,
    null,
    m.development_case_id
  );

  return jsonb_build_object(
    'metric_id', p_metric_id,
    'status', v_new_status,
    'value', case
      when m.checkpoint_horizon_days is not null then m.observed_value
      else m.value
    end,
    'verified_at', now()
  );
end
$$;

revoke execute on function public.verify_value_metric(uuid, boolean, text) from public, anon;
grant execute on function public.verify_value_metric(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- D9.11 — project lesson write path.
-- ---------------------------------------------------------------------------
create or replace function public.record_project_lesson(
  p_case_id uuid,
  p_failure_mode_key text,
  p_title text,
  p_cause text,
  p_corrective_action text,
  p_applicability text,
  p_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text := sync_realize_writer_role();
  c development_cases%rowtype;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a project lesson is a named-human act — the AI-operator identity may recommend text, it does not persist a lesson (recommend ≠ authorize)');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if p_failure_mode_key is null
     or p_failure_mode_key <> all (sync_delivery_failure_types()) then
    return jsonb_build_object('error',
      'A project lesson names one of the eight delivery failure types (spec I.37) — this is not a new failure-mode identity');
  end if;
  if coalesce(length(btrim(p_title)), 0) < 3 then
    return jsonb_build_object('error', 'a lesson needs a title (3 characters minimum)');
  end if;
  if coalesce(length(btrim(p_cause)), 0) < 10 then
    return jsonb_build_object('error',
      'A lesson without a cause is a complaint — state the cause (10 characters minimum)');
  end if;
  if coalesce(length(btrim(p_corrective_action)), 0) < 10 then
    return jsonb_build_object('error',
      'A lesson without a corrective action cannot close — state the action (10 characters minimum)');
  end if;
  if coalesce(length(btrim(p_applicability)), 0) < 10 then
    return jsonb_build_object('error',
      'A lesson without applicability cannot screen a future case — state where it applies (10 characters minimum)');
  end if;

  perform ensure_project_delivery_taxonomy();

  insert into learning_events (
    organization_id, development_case_id, capital_project_id,
    event_type, title, detail, failure_mode_key, cause, corrective_action, applicability
  ) values (
    v_org, c.id, c.capital_project_id,
    'lesson_learned', btrim(p_title), nullif(btrim(p_detail), ''),
    p_failure_mode_key, btrim(p_cause), btrim(p_corrective_action), btrim(p_applicability)
  )
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'project_lesson', coalesce(v_role, 'unknown'),
    jsonb_build_object('lesson_id', v_id, 'case_id', c.id,
      'failure_mode_key', p_failure_mode_key,
      'note', 'Captured. Does not adopt a standard or revise a framework (D9.05 / D9.09 remain separate human acts).'));

  return jsonb_build_object(
    'lesson_id', v_id,
    'case_id', c.id,
    'failure_mode_key', p_failure_mode_key,
    'note', 'Lesson captured on learning_events. Capturing is not adopting a standard.');
end
$$;

revoke all on function public.record_project_lesson(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.record_project_lesson(uuid, text, text, text, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reads — SECURITY DEFINER, session-org. Panels render these rows verbatim.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_operational_warranty(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.capital_project_id is null then
    return jsonb_build_object(
      'caseId', c.id,
      'available', false,
      'reason', 'an operational warranty binds to the delivery-side capital project — this case has none',
      'warranties', '[]'::jsonb
    );
  end if;
  return jsonb_build_object(
    'caseId', c.id,
    'available', true,
    'capitalProjectId', c.capital_project_id,
    'warranties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'systemLabel', t.system_label,
        'survivesHandover', t.survives_handover,
        'startupAt', t.startup_at,
        'basis', t.warranty_basis,
        'assetId', t.asset_id,
        'metrics', jsonb_build_array(
          jsonb_build_object('key','availability','target',t.target_availability,'unit','fraction'),
          jsonb_build_object('key','throughput','target',t.throughput_target,'unit',t.throughput_unit),
          jsonb_build_object('key','reliability','target',t.reliability_target,'unit',t.reliability_unit),
          jsonb_build_object('key','maintenance_cost','target',t.maintenance_cost_target,'unit',t.maintenance_cost_unit),
          jsonb_build_object('key','energy','target',t.energy_target,'unit',t.energy_unit),
          jsonb_build_object('key','quality','target',t.quality_target,'unit',t.quality_unit),
          jsonb_build_object('key','operating_cost','target',t.operating_cost_target,'unit',t.operating_cost_unit)
        )
      ) order by t.system_label, t.id)
      from ram_targets t
      where t.organization_id = v_org
        and (t.development_case_id = c.id or t.project_id = c.capital_project_id)
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.get_case_operational_warranty(uuid) from public, anon;
grant execute on function public.get_case_operational_warranty(uuid) to authenticated, service_role;

create or replace function public.get_case_realization_checkpoints(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  return jsonb_build_object(
    'caseId', c.id,
    'checkpoints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'label', v.label,
        'horizonDays', v.checkpoint_horizon_days,
        'dueOn', v.due_on,
        'warrantedMetric', v.warranted_metric,
        'kind', case when v.ram_target_id is not null then 'warranty' else 'benefit' end,
        'designValue', v.value,
        'observedValue', v.observed_value,
        'observedAt', v.observed_at,
        'observationMethod', v.observation_method,
        'status', v.status,
        'unit', v.unit,
        'verifiedAt', v.verified_at
      ) order by v.checkpoint_horizon_days, v.label)
      from value_metrics v
      where v.organization_id = v_org
        and v.development_case_id = c.id
        and v.checkpoint_horizon_days is not null
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.get_case_realization_checkpoints(uuid) from public, anon;
grant execute on function public.get_case_realization_checkpoints(uuid) to authenticated, service_role;

create or replace function public.get_case_project_lessons(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  return jsonb_build_object(
    'caseId', c.id,
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'title', e.title,
        'failureModeKey', e.failure_mode_key,
        'cause', e.cause,
        'correctiveAction', e.corrective_action,
        'applicability', e.applicability,
        'detail', e.detail,
        'createdAt', e.created_at,
        'capitalProjectId', e.capital_project_id
      ) order by e.created_at desc)
      from learning_events e
      where e.organization_id = v_org
        and e.development_case_id = c.id
        and e.event_type = 'lesson_learned'
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.get_case_project_lessons(uuid) from public, anon;
grant execute on function public.get_case_project_lessons(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- THE §34 EDGE LEDGER, TRANSFORMED (not re-typed).
--
-- Slice 5D's audit named `learning_events.applicability` as the column whose
-- existence closes `Lesson APPLIES_TO AssetClass`, and said so in live SQL:
-- "This closes when §33's applicability lands there (D9.11)." This file is
-- that landing. Leaving the ledger on `absent` and the audit to report a
-- newly-closable edge forever would be the unchecked-prose defect those
-- files exist to catch, committed by the file that closed the gap.
--
-- Same shape as Slice 7A (20261210090100): ask the catalogue, RAISE if the
-- live body is not the shape 5C/5D/7A left it in, never re-type nineteen
-- entries. D9.12 (auto-screening at case creation) is a different residual
-- and stays yellow — a stored applicability field is the edge, not the
-- screen-at-create hop.
-- ---------------------------------------------------------------------------
do $spec34lesson$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_spec34_edges';
  if v_def is null then
    raise exception
      'sync_spec34_edges does not exist — the Slice 5C ledger this file corrects is missing, and writing a second ledger instead is forbidden.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'learning_events'
                    and column_name = 'applicability') then
    raise exception
      'learning_events.applicability does not exist, so Lesson APPLIES_TO AssetClass is genuinely absent and this correction would be the false claim it exists to remove.'
      using errcode = 'check_violation';
  end if;
  if position('CORRECTED 20261217091000' in v_def) > 0 then
    null;  -- already corrected by a previous run of this migration
  else
    v_new := replace(v_def,
      $old$'home','none — spec §33 Lesson/FRACAS object is not built','status','absent',$old$,
      $new$'home','learning_events.applicability (20261217091000, register row D9.11)','status','live_elsewhere',$new$);
    if v_new = v_def then
      raise exception
        'the Lesson APPLIES_TO AssetClass entry of sync_spec34_edges was not found in the shape Slice 5C left it — do not edit a ledger blind; re-derive this correction against the current body.'
        using errcode = 'check_violation';
    end if;
    v_new := replace(v_new,
      $old$'note','screen_similar_assets is the nearest live machinery and it screens ASSETS, not a lesson register. Named as absent rather than counted as covered.'$old$,
      $new$'note','CORRECTED 20261217091000: the LESSON end is built. RULING 9 — learning_events IS §33 and now carries applicability, which is the column sync_spec34_absent_edge_audit() itself named as the closing condition (D9.11). Not on the CDE thread: the edge lives on the learning store, which has its own reads, and this ledger does not re-implement them. D9.12 auto-screening at case creation is a different residual and is not this column.'$new$);
    if position('CORRECTED 20261217091000' in v_new) = 0 then
      raise exception
        'the Lesson APPLIES_TO AssetClass note of sync_spec34_edges was not found — a ledger whose status and whose note disagree is worse than one that is simply wrong, so this fails rather than moving the status alone.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$spec34lesson$;

-- ---------------------------------------------------------------------------
-- THE ABSENT-EDGE AUDIT, ACTED ON RATHER THAN LEFT TO ALARM.
--
-- `sync_spec34_absent_edge_audit()` exists so that a ledger's absence claim
-- is CHECKED rather than asserted, and its own note says what a caller
-- should do when it fires: "`newlyClosableCount` above zero means the
-- endpoint got built and the ledger's prose is stale". This slice is that
-- happening for Lesson APPLIES_TO AssetClass. The Lesson tuple is REMOVED
-- from the absent list and the note is corrected, by TRANSFORMATION of the
-- live body — the two remaining entries are never re-typed.
-- ---------------------------------------------------------------------------
do $spec34auditle$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_spec34_absent_edge_audit';
  if v_def is null then
    raise exception
      'sync_spec34_absent_edge_audit does not exist — the Slice 5D audit this file acts on is missing, and writing a second one instead is forbidden.'
      using errcode = 'check_violation';
  end if;
  if position('TWO of' in v_def) > 0 then
    null;  -- already corrected by a previous run of this migration
  else
    -- Match the live body whether pg_get_functiondef kept the 5D `$$` quoting
    -- (`§33''s`) or doubled it. Same tuple either way; do not edit blind.
    v_new := replace(v_def,
$old$      ('Lesson APPLIES_TO AssetClass',
       'learning_events', 'applicability',
       'The asset-class END exists (assets.asset_class_id); the LESSON end does not. The canonical Lesson is `learning_events` (overlap ruling 9) and it carries no applicability field. This closes when §33''s applicability lands there (D9.11).')
$old$, '');
    if v_new = v_def then
      v_new := replace(v_def,
$old$      ('Lesson APPLIES_TO AssetClass',
       'learning_events', 'applicability',
       'The asset-class END exists (assets.asset_class_id); the LESSON end does not. The canonical Lesson is `learning_events` (overlap ruling 9) and it carries no applicability field. This closes when §33''''s applicability lands there (D9.11).')
$old$, '');
    end if;
    if v_new = v_def then
      raise exception
        'the Lesson entry of sync_spec34_absent_edge_audit was not found in the shape Slice 5D left it — do not edit an audit blind; re-derive this correction against the current body.'
        using errcode = 'check_violation';
    end if;
    v_new := replace(v_new,
      'states THREE of',
      'states TWO of');
    if position('states TWO of' in v_new) = 0 then
      raise exception
        'the note of sync_spec34_absent_edge_audit was not found — an audit whose list and whose note disagree is worse than one that is simply wrong, so this fails rather than moving the list alone.'
        using errcode = 'check_violation';
    end if;
    v_new := replace(v_new,
      '20261210090100 closed WorkPackage DEPENDS_ON Constraint at restoration_constraints.work_order_id — the column this audit itself named as the closing condition',
      '20261210090100 closed WorkPackage DEPENDS_ON Constraint at restoration_constraints.work_order_id, and three until 20261217091000 closed Lesson APPLIES_TO AssetClass at learning_events.applicability — the column this audit itself named as the closing condition');
    if position('20261217091000 closed Lesson APPLIES_TO AssetClass' in v_new) = 0 then
      raise exception
        'the Slice 7A close-clause of sync_spec34_absent_edge_audit was not found — do not edit an audit blind; re-derive this correction against the current body.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$spec34auditle$;

comment on function public.sync_spec34_absent_edge_audit() is
  'D11.21 / spec III.§34 ruling 5D-R16, updated by Slice 7A and D9 realize: makes the remaining TWO absent edges falsifiable. Benefit MEASURES Objective was closed by 20261207090300; WorkPackage DEPENDS_ON Constraint was closed by 20261210090100 at restoration_constraints.work_order_id; Lesson APPLIES_TO AssetClass was closed by 20261217091000 at learning_events.applicability — the exact column this audit named as its closing condition, which is what an audit is FOR. For each remaining edge it names the table and column whose existence would close it and asks information_schema.';

notify pgrst, 'reload schema';

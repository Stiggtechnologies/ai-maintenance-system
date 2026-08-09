-- ============================================================================
-- Lifecycle decisions: repair, replace, redesign, defer
-- (capability register C8.09, C2.10; feeds C6.03).
--
-- The platform could already say an asset was failing. It could not say what to
-- do about it in the only terms that settle the argument — money over a common
-- horizon, against the consequence of being wrong.
--
-- NO COST DATA EXISTS ANYWHERE IN THE SCHEMA. Not maintenance cost, not
-- replacement value, not the cost of an hour of downtime. So this adds the
-- input layer and leaves it EMPTY. Every figure an operator has not supplied is
-- reported as a missing input by name, and an option that cannot be priced is
-- never ranked. Inventing a replacement value would be worse than having none:
-- the resulting recommendation carries the authority of arithmetic while
-- resting on a number nobody chose.
--
-- WHERE THE MATHEMATICS LIVES. The conditional failure probability every option
-- depends on comes from the Weibull fit in src/lib/reliability, which has
-- twelve validation tests behind it. Reimplementing it in plpgsql would create
-- a second engine that can drift from the tested one, and the two would
-- disagree about a number that decides whether a machine keeps running. So the
-- database supplies inputs and stores results; src/lib/lifecycle does the
-- arithmetic against the single validated engine, and every evaluation is
-- persisted WITH the inputs it used so any figure can be recomputed and
-- challenged.
--
-- An evaluation is a decision aid. It is adopted by a human or it does nothing.
--
-- Canonical reuse: assets, work_orders, consequence_dimensions,
-- app_current_org(). Additive.
-- ============================================================================

create table if not exists asset_economics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  asset_class text,
  replacement_value_usd numeric check (replacement_value_usd > 0),
  annual_maintenance_cost_usd numeric check (annual_maintenance_cost_usd >= 0),
  downtime_cost_per_hour_usd numeric check (downtime_cost_per_hour_usd >= 0),
  expected_repair_cost_usd numeric check (expected_repair_cost_usd >= 0),
  expected_repair_hours numeric check (expected_repair_hours > 0),
  expected_remaining_life_years numeric check (expected_remaining_life_years > 0),
  -- Where each number came from. A cost with no provenance cannot be defended
  -- in the meeting where the decision is challenged.
  basis text not null,
  source_system text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  register_ref text not null default 'C2.10',
  check (asset_id is not null or asset_class is not null)
);

create unique index if not exists idx_asset_economics_asset
  on asset_economics(organization_id, asset_id) where asset_id is not null;
create unique index if not exists idx_asset_economics_class
  on asset_economics(organization_id, asset_class) where asset_id is null;

alter table asset_economics enable row level security;
drop policy if exists asset_economics_read on asset_economics;
create policy asset_economics_read on asset_economics
  for select to authenticated using (organization_id = app_current_org());

create table if not exists lifecycle_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  -- The inputs, frozen. An evaluation whose inputs cannot be reconstructed is
  -- an opinion with a timestamp.
  inputs jsonb not null,
  options jsonb not null,
  recommended text check (recommended in ('repair', 'replace', 'redesign', 'defer')),
  uncertainty_level text not null check (uncertainty_level in ('low', 'moderate', 'high')),
  uncertainty_reasons jsonb not null default '[]',
  rationale text not null,
  engine_version text not null default 'lifecycle/1',
  evaluated_by uuid references auth.users(id),
  evaluated_at timestamptz not null default now(),
  -- Adoption is separate from evaluation, always.
  decision text check (decision in ('accepted', 'rejected', 'deferred_decision')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  register_ref text not null default 'C8.09'
);

create index if not exists idx_lifecycle_eval_asset
  on lifecycle_evaluations(organization_id, asset_id, evaluated_at desc);

alter table lifecycle_evaluations enable row level security;
drop policy if exists lifecycle_evaluations_read on lifecycle_evaluations;
create policy lifecycle_evaluations_read on lifecycle_evaluations
  for select to authenticated using (organization_id = app_current_org());

-- ----------------------------------------------------------------------------
-- Inputs: everything the analysis needs, and an explicit list of what is absent
-- ----------------------------------------------------------------------------
create or replace function public.get_lifecycle_inputs(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  a assets%rowtype;
  e asset_economics%rowtype;
  v_missing text[] := '{}';
  v_times numeric[];
  v_age numeric;
begin
  select * into a from assets where id = p_asset_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'asset not found');
  end if;

  -- Asset-specific economics win; a class-level row is the fallback.
  select * into e from asset_economics
  where organization_id = v_org and asset_id = p_asset_id;
  if not found then
    select * into e from asset_economics
    where organization_id = v_org and asset_class = a.asset_class;
  end if;

  if e.replacement_value_usd is null then v_missing := v_missing || 'replacement value'::text; end if;
  if e.annual_maintenance_cost_usd is null then v_missing := v_missing || 'annual maintenance cost'::text; end if;
  if e.downtime_cost_per_hour_usd is null then v_missing := v_missing || 'downtime cost per hour'::text; end if;
  if e.expected_repair_hours is null then v_missing := v_missing || 'expected repair hours'::text; end if;
  if e.expected_remaining_life_years is null then v_missing := v_missing || 'expected remaining life'::text; end if;

  -- Times between corrective failures, in hours: the input the Weibull fit
  -- needs. Ordered so the client computes inter-arrival gaps, not calendar
  -- positions.
  select array_agg(extract(epoch from (completed_at - prev)) / 3600.0
                   order by completed_at)
  into v_times
  from (
    select completed_at,
           lag(completed_at) over (order by completed_at) as prev
    from work_orders
    where organization_id = v_org and asset_id = p_asset_id
      and work_type = 'corrective' and completed_at is not null) t
  where prev is not null;

  select extract(epoch from (now() - max(completed_at))) / 3600.0
  into v_age
  from work_orders
  where organization_id = v_org and asset_id = p_asset_id
    and work_type = 'corrective' and completed_at is not null;

  return jsonb_build_object(
    'asset_id', p_asset_id, 'asset_name', a.name,
    'asset_class', a.asset_class, 'criticality', a.criticality,
    'inter_failure_hours', coalesce(to_jsonb(v_times), '[]'::jsonb),
    'failures', coalesce(array_length(v_times, 1), 0),
    'hours_since_last_failure', round(coalesce(v_age, 0)::numeric, 1),
    'economics', jsonb_build_object(
      'replacementValueUsd', e.replacement_value_usd,
      'annualMaintenanceCostUsd', e.annual_maintenance_cost_usd,
      'downtimeCostPerHourUsd', e.downtime_cost_per_hour_usd,
      'expectedRepairCostUsd', e.expected_repair_cost_usd,
      'expectedRepairHours', e.expected_repair_hours,
      'expectedRemainingLifeYears', e.expected_remaining_life_years),
    'economics_basis', e.basis,
    'missing_inputs', to_jsonb(v_missing),
    'sufficient_for_failure_model', coalesce(array_length(v_times, 1), 0) >= 2,
    'note', case
      when coalesce(array_length(v_times, 1), 0) < 2
        then 'Fewer than two inter-failure intervals: a life model is not identifiable, so no option that depends on failure probability can be priced.'
      when array_length(v_missing, 1) > 0
        then 'Some economic inputs are absent. Options that need them will be reported unpriced and named, never estimated.'
      else 'All inputs present.' end);
end
$$;

grant execute on function public.get_lifecycle_inputs(uuid) to authenticated;

create or replace function public.record_lifecycle_evaluation(
  p_asset_id uuid,
  p_inputs jsonb,
  p_options jsonb,
  p_recommended text,
  p_uncertainty_level text,
  p_uncertainty_reasons jsonb,
  p_rationale text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id uuid;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('reliability_engineer', 'maintenance_manager', 'executive', 'admin', 'ai_admin') then
    return jsonb_build_object('error',
      'recording a lifecycle evaluation requires an engineering, management or executive role');
  end if;
  if not exists (select 1 from assets where id = p_asset_id and organization_id = v_org) then
    return jsonb_build_object('error', 'asset not found');
  end if;
  if p_inputs is null or p_inputs = '{}'::jsonb then
    return jsonb_build_object('error',
      'an evaluation must carry the inputs it used — one that cannot be reconstructed is an opinion with a timestamp');
  end if;

  insert into lifecycle_evaluations (organization_id, asset_id, inputs, options,
    recommended, uncertainty_level, uncertainty_reasons, rationale, evaluated_by)
  values (v_org, p_asset_id, p_inputs, p_options, p_recommended,
    p_uncertainty_level, coalesce(p_uncertainty_reasons, '[]'::jsonb),
    p_rationale, auth.uid())
  returning id into v_id;

  return jsonb_build_object('evaluation_id', v_id, 'recommended', p_recommended,
    'note', 'Recorded as a decision aid. It changes nothing until a human decides on it.');
end
$$;

grant execute on function public.record_lifecycle_evaluation(uuid, jsonb, jsonb, text, text, jsonb, text) to authenticated;

create or replace function public.decide_lifecycle_evaluation(
  p_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  e lifecycle_evaluations%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();
  select * into e from lifecycle_evaluations where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evaluation not found');
  end if;
  if e.decision is not null then
    return jsonb_build_object('error', 'this evaluation was already ' || e.decision);
  end if;
  if p_decision not in ('accepted', 'rejected', 'deferred_decision') then
    return jsonb_build_object('error', 'decision must be accepted, rejected or deferred_decision');
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error', 'record the reasoning for this decision');
  end if;

  -- Accepting a high-uncertainty recommendation is permitted, and is recorded
  -- as exactly that. The point is not to prevent the judgement but to make it
  -- visible when the outcome is reviewed.
  if e.uncertainty_level = 'high' and p_decision = 'accepted'
     and v_role not in ('reliability_engineer', 'executive', 'admin', 'ai_admin') then
    return jsonb_build_object('error',
      'this evaluation is high-uncertainty; accepting it requires engineering or executive authority');
  end if;

  update lifecycle_evaluations
  set decision = p_decision, decided_by = auth.uid(), decided_at = now(),
      decision_note = trim(p_note)
  where id = p_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'lifecycle_decision', coalesce(v_role, 'unknown'),
    jsonb_build_object('evaluation_id', p_id, 'decision', p_decision,
      'recommended', e.recommended, 'uncertainty', e.uncertainty_level));

  return jsonb_build_object('evaluation_id', p_id, 'decision', p_decision);
end
$$;

grant execute on function public.decide_lifecycle_evaluation(uuid, text, text) to authenticated;

create or replace function public.get_lifecycle_position()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_assets int;
  v_priced int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select count(*) into v_assets from assets where organization_id = v_org;
  select count(distinct a.id) into v_priced
  from assets a
  join asset_economics e on e.organization_id = v_org
    and (e.asset_id = a.id or (e.asset_id is null and e.asset_class = a.asset_class))
  where a.organization_id = v_org;

  return jsonb_build_object(
    'assets', v_assets,
    'assets_with_economics', v_priced,
    'economics_coverage_pct', case when v_assets > 0
      then round(100.0 * v_priced / v_assets, 1) end,
    'evaluations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', le.id, 'asset', a.name, 'recommended', le.recommended,
        'uncertainty', le.uncertainty_level,
        'uncertainty_reasons', le.uncertainty_reasons,
        'rationale', le.rationale, 'evaluated_at', le.evaluated_at,
        'decision', le.decision, 'decision_note', le.decision_note,
        'options', le.options) order by le.evaluated_at desc), '[]'::jsonb)
      from lifecycle_evaluations le
      join assets a on a.id = le.asset_id
      where le.organization_id = v_org
      limit 20),
    'note', case when v_priced = 0
      then 'No asset carries economic inputs. Repair-versus-replace is a money question, and the platform will report options as unpriced rather than invent a replacement value — an invented one produces a recommendation with the authority of arithmetic behind a number nobody chose.'
      else 'Evaluations are decision aids: recorded with their inputs, adopted only by a human.' end);
end
$$;

grant execute on function public.get_lifecycle_position() to authenticated;

notify pgrst, 'reload schema';

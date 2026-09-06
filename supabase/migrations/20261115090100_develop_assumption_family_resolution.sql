-- ============================================================================
-- Sync Develop Slice 2 — the assumption family resolved (D2.06 / D3.29,
-- overlap-map ruling 5, BINDING) and threshold monitoring wired on the
-- existing indicator machinery (D2.07, first half).
--
-- THE RULING, APPLIED VERBATIM: `risk_assumptions` (+ dependencies +
-- invalidation, D3.30 ✅) IS the platform Assumption. `financial_assumptions`
-- remains its NUMERIC LEG — the versioned series a threshold predicate reads.
-- No third store arrives; spec §18 built as written would have been the
-- fourth. This file EXTENDS the one family:
--
--   * risk_id relaxes to nullable — an assumption anchors to a risk OR to a
--     development case (business-case viability assumptions, spec I.12); a
--     row anchored to nothing is refused at the schema;
--   * development_case_id + business_case_id land as TYPED links. The
--     business-case link deliberately does NOT ride
--     risk_assumption_dependencies: that table's subject_id is uuid and
--     business_cases keys are bigint — a cast-shaped bridge would be a lie
--     in the type system. Typed columns, documented here, ARE the extension;
--     the dependency table keeps carrying every uuid-keyed subject exactly
--     as before;
--   * the VIABILITY PREDICATE (spec I.12: "works only if production gain ≥
--     5.2%") lands as comparator/threshold columns naming a
--     financial_assumptions series by key: threshold_parameter +
--     threshold_comparator + threshold_value + threshold_unit, all-or-none.
--     The predicate is DECLARED here and EVALUATED deterministically when
--     the numeric leg moves (upsert_financial_assumption, 20261115090200) —
--     rules, not judgement, per §70.
--
-- MONITORING RIDES THE ONE INDICATOR MACHINERY (D2.07): a declared threshold
-- is WIRED AS a risk_indicators row (assumption_id added; risk_id relaxed;
-- direction derived from the comparator; the threshold in the same
-- `thresholds` jsonb the risk machinery reads). Observations land in
-- risk_indicator_observations — the same trail, the same warning/critical
-- states, no new monitor store. The risk-score side-effects of
-- record_risk_indicator_observation stay risk-scoped; assumption-anchored
-- indicators are observed by the deterministic sweep in
-- upsert_financial_assumption, which owns the assumption-side consequence
-- (invalidation → D3.30 reopening → D2.03 collapse evaluation).
--
-- INVALIDATION IS ONE IMPLEMENTATION: the D3.30 machinery
-- (invalidate_risk_assumption) is refactored around a single internal core,
-- apply_assumption_invalidation, so the human act and the deterministic
-- threshold-violation path CANNOT drift. The human RPC keeps every check it
-- had (role, ownership, reason length) — nothing weakened; the core is
-- client-revoked.
--
-- Canonical reuse: risk_assumptions, risk_assumption_dependencies,
-- risk_indicators, risk_indicator_observations, financial_assumptions,
-- development_cases, business_cases, mark_risk_reassessment, audit_events.
-- No new table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The family, extended.
-- ---------------------------------------------------------------------------
alter table public.risk_assumptions
  alter column risk_id drop not null;

alter table public.risk_assumptions
  add column if not exists development_case_id uuid
    references development_cases(id) on delete cascade,
  add column if not exists business_case_id bigint
    references business_cases(id) on delete set null,
  add column if not exists threshold_parameter text,
  add column if not exists threshold_comparator text,
  add column if not exists threshold_value numeric,
  add column if not exists threshold_unit text;

-- An assumption is anchored somewhere, always.
alter table public.risk_assumptions
  drop constraint if exists risk_assumptions_anchor_present;
alter table public.risk_assumptions
  add constraint risk_assumptions_anchor_present check (
    risk_id is not null or development_case_id is not null
  );

-- The predicate is complete or absent — a comparator with no threshold, or a
-- threshold naming no series, is not a viability envelope.
alter table public.risk_assumptions
  drop constraint if exists risk_assumptions_predicate_complete;
alter table public.risk_assumptions
  add constraint risk_assumptions_predicate_complete check (
    (threshold_parameter is null and threshold_comparator is null and threshold_value is null)
    or (threshold_parameter is not null and btrim(threshold_parameter) <> ''
        and threshold_comparator is not null and threshold_value is not null)
  );

alter table public.risk_assumptions
  drop constraint if exists risk_assumptions_comparator_allowed;
alter table public.risk_assumptions
  add constraint risk_assumptions_comparator_allowed check (
    threshold_comparator is null or threshold_comparator in ('>=','<=','>','<')
  );

create index if not exists idx_risk_assumptions_case
  on risk_assumptions(organization_id, development_case_id)
  where development_case_id is not null;
create index if not exists idx_risk_assumptions_threshold
  on risk_assumptions(organization_id, threshold_parameter)
  where threshold_parameter is not null and status = 'active';

-- ---------------------------------------------------------------------------
-- 2. Indicators learn to watch an assumption (same table, no second store).
-- ---------------------------------------------------------------------------
alter table public.risk_indicators
  alter column risk_id drop not null;

alter table public.risk_indicators
  add column if not exists assumption_id uuid
    references risk_assumptions(id) on delete cascade;

alter table public.risk_indicators
  drop constraint if exists risk_indicators_subject_present;
alter table public.risk_indicators
  add constraint risk_indicators_subject_present check (
    risk_id is not null or assumption_id is not null
  );

-- One indicator per declared predicate: the assumption IS the threshold.
create unique index if not exists idx_risk_indicators_assumption
  on risk_indicators(assumption_id) where assumption_id is not null;

-- ---------------------------------------------------------------------------
-- 2b. Read policies learn the null-risk anchor. The prior predicates AND'd
--     can_read_risk(risk_id), which is FALSE for a null risk_id — a
--     case-anchored assumption (and its indicator) would be invisible to
--     every client, including the workspace that renders it. The
--     risk_event_scenarios policy (20260921110102) is the established shape
--     for a nullable risk anchor and is copied verbatim: org-scoped always;
--     the risk-sensitivity boundary applies exactly when a risk is named.
--     Nothing weakens for risk-anchored rows — their predicate is unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists risk_assumptions_org_read on risk_assumptions;
create policy risk_assumptions_org_read on risk_assumptions
  for select to authenticated using
    (organization_id=app_current_org() and (risk_id is null or can_read_risk(risk_id)));

drop policy if exists risk_indicators_sensitive_read on risk_indicators;
create policy risk_indicators_sensitive_read on risk_indicators
  for select to authenticated using
    (organization_id=app_current_org() and (risk_id is null or can_read_risk(risk_id)));

drop policy if exists risk_assumption_dependencies_org_read on risk_assumption_dependencies;
create policy risk_assumption_dependencies_org_read on risk_assumption_dependencies
  for select to authenticated using (organization_id=app_current_org() and exists(
    select 1 from risk_assumptions a where a.id=assumption_id
      and (a.risk_id is null or can_read_risk(a.risk_id))));

-- ---------------------------------------------------------------------------
-- 3. The one invalidation core. invalidate_risk_assumption's dependency walk
--    moves here VERBATIM; the RPC below and the deterministic threshold path
--    (20261115090200) both call it. p_actor_role labels the audit row —
--    'system:threshold' for the deterministic path, the human's role
--    otherwise. Client-revoked: this is machinery, not a surface.
-- ---------------------------------------------------------------------------
create or replace function public.apply_assumption_invalidation(
  p_assumption_id uuid,
  p_reason text,
  p_actor_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a risk_assumptions%rowtype;
  dep record; linked record; v_dep_risk uuid;
begin
  select * into a from risk_assumptions where id = p_assumption_id and status = 'active';
  if not found then
    return jsonb_build_object('error','active assumption not found');
  end if;
  update risk_assumptions set status='invalidated',invalidated_by=auth.uid(),invalidated_at=now(),
    invalidation_reason=btrim(p_reason) where id=a.id;
  for dep in select * from risk_assumption_dependencies where assumption_id=a.id loop
    if dep.subject_type='risk' then perform mark_risk_reassessment(dep.subject_id,'Assumption invalidated: '||a.statement); end if;
    if dep.subject_type='decision' then update decisions set reassessment_required=true,
      reassessment_reason='Assumption invalidated: '||a.statement
      where id=dep.subject_id and organization_id=a.organization_id; end if;
    if dep.subject_type='scenario' then
      select risk_id into v_dep_risk from scenarios where id=dep.subject_id and organization_id=a.organization_id;
      if v_dep_risk is not null then perform mark_risk_reassessment(v_dep_risk,'Dependent scenario assumption invalidated: '||a.statement); end if;
    end if;
    if dep.subject_type='control' then
      for linked in select risk_id from risk_control_links where control_id=dep.subject_id and organization_id=a.organization_id loop
        perform mark_risk_reassessment(linked.risk_id,'Dependent control assumption invalidated: '||a.statement);
      end loop;
    end if;
    if dep.subject_type='objective' then
      for linked in select id risk_id from risks where objective_id=dep.subject_id and organization_id=a.organization_id loop
        perform mark_risk_reassessment(linked.risk_id,'Dependent objective assumption invalidated: '||a.statement);
      end loop;
    end if;
    if dep.subject_type='work_order' then
      select coalesce(w.risk_id,rec.risk_id) into v_dep_risk from work_orders w
        left join recommendations rec on rec.id=w.recommendation_id
        where w.id=dep.subject_id and w.organization_id=a.organization_id;
      if v_dep_risk is not null then perform mark_risk_reassessment(v_dep_risk,'Dependent work assumption invalidated: '||a.statement); end if;
    end if;
  end loop;
  -- The direct risk anchor is a dependency in fact even when the row predates
  -- the dependency seed (record_risk_assumption seeds it; case assumptions
  -- have none).
  if a.risk_id is not null and not exists (
    select 1 from risk_assumption_dependencies
    where assumption_id = a.id and subject_type = 'risk' and subject_id = a.risk_id
  ) then
    perform mark_risk_reassessment(a.risk_id,'Assumption invalidated: '||a.statement);
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(a.organization_id,'risk_assumption_invalidated',p_actor_role,
    jsonb_build_object('assumption_id',a.id,'reason',btrim(p_reason),
      'development_case_id',a.development_case_id,'business_case_id',a.business_case_id));
  return jsonb_build_object('assumption_id',a.id,'status','invalidated','reassessment_required',true);
end;
$$;

revoke all on function public.apply_assumption_invalidation(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. invalidate_risk_assumption, re-created on the core. EVERY pre-existing
--    check stands: org scope, active status, owner-or-role authority, reason
--    length. Behavior identical for risk-anchored rows; case-anchored rows
--    now travel the same act.
-- ---------------------------------------------------------------------------
create or replace function public.invalidate_risk_assumption(p_assumption_id uuid,p_reason text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; a risk_assumptions%rowtype;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  select * into a from risk_assumptions where id=p_assumption_id and organization_id=v_org and status='active';
  if not found then return jsonb_build_object('error','active assumption not found'); end if;
  if a.owner_id<>auth.uid() and v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if coalesce(length(btrim(p_reason)),0)<10 then return jsonb_build_object('error','record why the assumption is invalid'); end if;
  return public.apply_assumption_invalidation(a.id, p_reason, coalesce(v_role,'unknown'));
end;
$$;
revoke execute on function public.invalidate_risk_assumption(uuid,text) from public, anon;
grant execute on function public.invalidate_risk_assumption(uuid,text) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 5. Declaring a case assumption — the spec-I.12 sentence as a row on the ONE
--    family. The predicate is optional (case assumptions without thresholds
--    are legitimate); when present it must name an EXISTING series in the
--    numeric leg — declaring a threshold on a series nobody records would be
--    an alarm wired to nothing, and it is refused with the wiring named.
--    Declaring one ALSO wires the indicator row (D2.07) in the same
--    transaction: comparator '>=' / '>' means the case needs the value HIGH,
--    so falling to/below the threshold is the violation (lower_is_worse);
--    '<=' / '<' mirror. The indicator starts 'unknown' until the first
--    observation arrives from the numeric leg.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_assumption(
  p_case_id uuid,
  p_assumption jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_owner uuid := nullif(p_assumption->>'owner_id','')::uuid;
  v_bc bigint := nullif(p_assumption->>'business_case_id','')::bigint;
  v_param text := nullif(btrim(coalesce(p_assumption->>'threshold_parameter','')),'');
  v_comparator text := nullif(btrim(coalesce(p_assumption->>'threshold_comparator','')),'');
  v_threshold numeric := nullif(p_assumption->>'threshold_value','')::numeric;
  v_unit text := nullif(btrim(coalesce(p_assumption->>'threshold_unit','')),'');
  v_id uuid;
  v_indicator uuid;
  v_dependency_exists boolean;
  dep jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','recording a case assumption requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error','assumptions are not recordable on a '||c.status||' case');
  end if;
  if v_owner is null or not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','assumption owner not found in this organization');
  end if;
  if coalesce(length(btrim(p_assumption->>'statement')),0)<10 or
     coalesce(length(btrim(p_assumption->>'trigger_for_review')),0)<10 then
    return jsonb_build_object('error','assumption and measurable review trigger are required');
  end if;
  if v_bc is not null and not exists(
    select 1 from business_cases where id=v_bc and organization_id=v_org) then
    return jsonb_build_object('error','business case not found in this organization');
  end if;
  -- Predicate: all-or-none, and the series must exist in the numeric leg.
  if v_param is not null or v_comparator is not null or v_threshold is not null then
    if v_param is null or v_comparator is null or v_threshold is null then
      return jsonb_build_object('error',
        'a viability threshold is complete or absent: threshold_parameter, threshold_comparator and threshold_value together');
    end if;
    if v_comparator not in ('>=','<=','>','<') then
      return jsonb_build_object('error','threshold_comparator must be one of >=, <=, >, <');
    end if;
    if not exists (select 1 from financial_assumptions
                   where organization_id=v_org and assumption_key=v_param) then
      return jsonb_build_object('error',
        format('no financial assumption series named "%s" is recorded in this organization — record the numeric series first (upsert_financial_assumption); a threshold on a series nobody records is an alarm wired to nothing', v_param));
    end if;
  end if;
  for dep in select value from jsonb_array_elements(coalesce(p_assumption->'dependencies','[]'::jsonb)) loop
    if dep->>'subject_type' not in ('risk','decision','scenario','control','objective','work_order') or
       nullif(dep->>'subject_id','') is null then
      return jsonb_build_object('error','invalid assumption dependency');
    end if;
    begin
      v_dependency_exists:=false;
      if dep->>'subject_type'='risk' then
        select exists(select 1 from risks where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='decision' then
        select exists(select 1 from decisions where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='scenario' then
        select exists(select 1 from scenarios where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='control' then
        select exists(select 1 from risk_controls where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='objective' then
        select exists(select 1 from risk_objectives where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='work_order' then
        select exists(select 1 from work_orders where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      end if;
      if not v_dependency_exists then
        return jsonb_build_object('error','assumption dependency not found in this organization');
      end if;
    exception when invalid_text_representation then
      return jsonb_build_object('error','invalid assumption dependency identifier');
    end;
  end loop;

  insert into risk_assumptions(organization_id,risk_id,development_case_id,business_case_id,
    statement,owner_id,confidence,valid_from,valid_until,trigger_for_review,
    threshold_parameter,threshold_comparator,threshold_value,threshold_unit)
  values(v_org,null,c.id,v_bc,
    btrim(p_assumption->>'statement'),v_owner,
    coalesce((p_assumption->>'confidence')::numeric,0),
    coalesce(nullif(p_assumption->>'valid_from','')::date,current_date),
    nullif(p_assumption->>'valid_until','')::date,btrim(p_assumption->>'trigger_for_review'),
    v_param,v_comparator,v_threshold,v_unit)
  returning id into v_id;

  for dep in select value from jsonb_array_elements(coalesce(p_assumption->'dependencies','[]'::jsonb)) loop
    insert into risk_assumption_dependencies(organization_id,assumption_id,subject_type,subject_id)
    values(v_org,v_id,dep->>'subject_type',(dep->>'subject_id')::uuid) on conflict do nothing;
  end loop;

  -- D2.07: the declared threshold IS an indicator row on the one machinery.
  if v_param is not null then
    insert into risk_indicators(organization_id,risk_id,assumption_id,name,source_system,
      signal_key,unit,direction,thresholds,current_state,active)
    values(v_org,null,v_id,
      'Viability threshold: '||btrim(p_assumption->>'statement'),
      'financial_assumptions',v_param,v_unit,
      case when v_comparator in ('>=','>') then 'lower_is_worse' else 'higher_is_worse' end,
      jsonb_build_object('critical', v_threshold),
      'unknown',true)
    returning id into v_indicator;
  end if;

  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'case_assumption',coalesce(v_role,'unknown'),jsonb_build_object(
    'case_id',c.id,'assumption_id',v_id,'business_case_id',v_bc,
    'threshold', case when v_param is null then null else
      jsonb_build_object('parameter',v_param,'comparator',v_comparator,'value',v_threshold,'unit',v_unit) end,
    'indicator_id',v_indicator));

  return jsonb_build_object('assumption_id',v_id,'status','active',
    'indicator_id',v_indicator,
    'monitored', v_param is not null);
end;
$$;

revoke all on function public.record_case_assumption(uuid, jsonb) from public, anon;
grant execute on function public.record_case_assumption(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

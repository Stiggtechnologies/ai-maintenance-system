-- ============================================================================
-- D11.29 — value-management calculations join the ONE calculation ledger.
--
-- The Value Management surface previously ran option comparison and capital
-- prioritisation in the browser. The mathematics was tested, but a displayed
-- result had no immutable method/version/input/output record and a browser
-- could claim any output. The calculation-service Edge function now executes
-- the same TypeScript kernels server-side from tenant-filtered canonical rows
-- and calls the service-only overload below. The browser never supplies a
-- trusted result.
--
-- Canonical reuse: business_cases, business_case_options, capital_plan_items,
-- user_profiles, calculation_runs and audit_events. No second ledger, value
-- store, approval path or workflow is introduced. These results remain
-- advisory; this migration grants no decision or spending authority.
-- ============================================================================

alter table public.calculation_runs
  add column if not exists subject_type text,
  add column if not exists subject_ref text;

-- Existing runs already have canonical anchors. Make that anchor explicit so
-- a non-case calculation is not an unscoped organization-wide blob.
-- The ledger's immutable trigger correctly reports privileged mutations, but
-- this one-time structural backfill is part of the ledger migration itself,
-- not an operator rewriting history. Recreate the trigger in this transaction
-- immediately after the backfill instead of emitting one false security event
-- for every historical calculation.
drop trigger if exists trg_calculation_run_immutable on public.calculation_runs;
update public.calculation_runs
set subject_type = case
      when development_case_id is not null then 'development_case'
      when model_register_id is not null then 'engineering_model'
      when asset_id is not null then 'asset'
      when recommendation_id is not null then 'recommendation'
      else 'organization'
    end,
    subject_ref = case
      when development_case_id is not null then development_case_id::text
      when model_register_id is not null then model_register_id::text
      when asset_id is not null then asset_id::text
      when recommendation_id is not null then recommendation_id::text
      else organization_id::text
    end
where subject_type is null or subject_ref is null;

create trigger trg_calculation_run_immutable
  before update or delete on public.calculation_runs
  for each row execute function public.enforce_calculation_run_immutable();

-- Every existing recorder omits these new columns. Derive its already-known
-- canonical anchor before constraints run, so adding explicit subjects cannot
-- break the case, model, asset or recommendation calculation paths.
create or replace function public.set_calculation_run_subject()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.subject_type is null or new.subject_ref is null then
    if new.development_case_id is not null then
      new.subject_type := 'development_case';
      new.subject_ref := new.development_case_id::text;
    elsif new.model_register_id is not null then
      new.subject_type := 'engineering_model';
      new.subject_ref := new.model_register_id::text;
    elsif new.asset_id is not null then
      new.subject_type := 'asset';
      new.subject_ref := new.asset_id::text;
    elsif new.recommendation_id is not null then
      new.subject_type := 'recommendation';
      new.subject_ref := new.recommendation_id::text;
    else
      new.subject_type := 'organization';
      new.subject_ref := new.organization_id::text;
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.set_calculation_run_subject() from public,anon,authenticated;

drop trigger if exists trg_calculation_run_subject on public.calculation_runs;
create trigger trg_calculation_run_subject
  before insert on public.calculation_runs
  for each row execute function public.set_calculation_run_subject();

alter table public.calculation_runs
  alter column subject_type set not null,
  alter column subject_ref set not null;

alter table public.calculation_runs
  drop constraint if exists calculation_runs_subject_named;
alter table public.calculation_runs
  add constraint calculation_runs_subject_named check (
    subject_type in (
      'organization', 'development_case', 'engineering_model', 'asset',
      'recommendation', 'business_case', 'capital_plan_year'
    )
    and
    length(btrim(subject_type)) between 3 and 80
    and length(btrim(subject_ref)) between 1 and 200
  );

create index if not exists idx_calculation_runs_subject
  on public.calculation_runs(
    organization_id, subject_type, subject_ref, calculation_key, computed_at desc
  );

comment on column public.calculation_runs.subject_type is
  'Canonical subject kind for this run. The service-only recorder validates supported kinds against their tenant-owned source rows.';
comment on column public.calculation_runs.subject_ref is
  'Stable canonical subject identifier (UUID, bigint id, organization id, or governed plan year) validated by the trusted recorder.';

-- Preserve every previously pinned key and add only keys that the new trusted
-- service records. A key with no recorder must not be pinned: a version entry
-- is evidence only when an act can produce its run.
create or replace function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select v from (values
    ('case_scope_growth',                 'develop-controls/4A/2026-11-24'),
    ('case_cost_reconciliation',          'develop-controls/4A/2026-11-24'),
    ('case_earned_value',                 'develop-performance/4B/2026-12-01'),
    ('case_performance_trend',            'develop-performance/4B/2026-12-01'),
    ('case_progress_integrity',           'develop-performance/4B/2026-12-01'),
    ('case_estimate_confidence',          'develop-performance/4B/2026-12-01'),
    ('case_forecast_confidence',          'develop-performance/4B/2026-12-01'),
    ('case_schedule_quality',             'develop-schedule/4C/2026-12-02'),
    ('case_schedule_simulation',          'develop-schedule/4C/2026-12-02'),
    ('case_risk_schedule_economics',      'develop-schedule/4C/2026-12-02'),
    ('case_contingency_consumption',      'develop-change/4D/2026-12-03'),
    ('case_change_control',               'develop-change/4D/2026-12-03'),
    ('case_decision_latency',             'develop-change/4D/2026-12-03'),
    ('case_decision_debt',                'develop-change/4D/2026-12-03'),
    ('case_requirement_traceability',     'develop-requirements/5A/2026-12-04'),
    ('case_design_scorecard',             'develop-design/5B/2026-12-05'),
    ('case_ram_profile',                  'develop-ram/5E/2026-12-20'),
    ('case_procurement_position',         'develop-procurement/6A/2026-12-08'),
    ('package_constraint_burndown',       'develop-awp/7A/2026-12-10'),
    ('package_field_readiness',           'develop-awp/7B/2026-12-11'),
    ('case_resource_balance',             'develop-workforce/7C/2026-12-12'),
    ('competency_readiness',              'develop-workforce/7C/2026-12-12'),
    ('constraint_free_work_index',        'develop-workforce/7C/2026-12-12'),
    ('workface_execution_metrics',        'develop-workforce/7C/2026-12-12'),
    ('business_case_option_comparison',   'value-management/1/2026-12-26'),
    ('capital_plan_prioritisation',       'value-management/1/2026-12-26')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

-- Service-only overload for calculations whose canonical subject is not a
-- development case. The original case-scoped signature remains unchanged.
create or replace function public.record_calculation_run(
  p_organization_id uuid,
  p_actor_id uuid,
  p_subject_type text,
  p_subject_ref text,
  p_key text,
  p_method text,
  p_inputs jsonb,
  p_input_refs jsonb,
  p_outputs jsonb,
  p_refusals jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version text := public.sync_calculation_code_version(p_key);
  v_refusals jsonb := coalesce(p_refusals, '[]'::jsonb);
  v_status text;
  v_id uuid;
  v_actor_role text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'non-case calculation recording is service-only'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists(select 1 from public.organizations where id=p_organization_id) then
    raise exception 'organization not found' using errcode = 'no_data_found';
  end if;
  select role into v_actor_role from public.user_profiles
   where id=p_actor_id and organization_id=p_organization_id;
  if not found then
    raise exception 'calculation actor is not a member of this organization'
      using errcode = 'insufficient_privilege';
  end if;
  if v_version is null then
    raise exception 'no code version is pinned for calculation key "%"', p_key
      using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_method,''))) < 10 then
    raise exception 'calculation method must be stated'
      using errcode = 'check_violation';
  end if;
  if jsonb_typeof(coalesce(p_inputs, 'null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_input_refs, 'null'::jsonb)) <> 'array'
     or jsonb_typeof(v_refusals) <> 'array'
     or (p_outputs is not null and jsonb_typeof(p_outputs) <> 'object') then
    raise exception 'calculation inputs/outputs/refusals have an invalid shape'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_input_refs) as input_ref
     where jsonb_typeof(input_ref) <> 'object'
        or length(btrim(coalesce(input_ref->>'table',''))) = 0
        or length(btrim(coalesce(input_ref->>'id',''))) = 0
  ) then
    raise exception 'every calculation input reference must name a table and row id'
      using errcode = 'check_violation';
  end if;
  if p_outputs is null and jsonb_array_length(v_refusals)=0 then
    raise exception 'a refused calculation must record at least one refusal'
      using errcode = 'check_violation';
  end if;

  -- Every supported subject is checked against the canonical tenant-owned row.
  -- The organization subject is used only when no narrower subject exists
  -- (for example, an empty capital plan that still records its refusal).
  if p_subject_type='organization' then
    if p_subject_ref is null or p_subject_ref <> p_organization_id::text then
      raise exception 'organization subject does not match calculation tenant'
        using errcode = 'insufficient_privilege';
    end if;
  elsif p_subject_type='business_case' then
    if p_subject_ref is null or p_subject_ref !~ '^[0-9]+$' then
      raise exception 'business-case subject reference is malformed'
        using errcode = 'check_violation';
    end if;
    if not exists(
      select 1 from public.business_cases b
       where b.id=p_subject_ref::bigint and b.organization_id=p_organization_id
    ) then
      raise exception 'business-case subject not found in calculation tenant'
        using errcode = 'no_data_found';
    end if;
  elsif p_subject_type='capital_plan_year' then
    if p_subject_ref is null or p_subject_ref !~ '^[0-9]{4}$' then
      raise exception 'capital-plan subject reference is malformed'
        using errcode = 'check_violation';
    end if;
    if not exists(
      select 1 from public.capital_plan_items i
       where i.plan_year=p_subject_ref::int and i.organization_id=p_organization_id
    ) then
      raise exception 'capital-plan subject not found in calculation tenant'
        using errcode = 'no_data_found';
    end if;
  else
    raise exception 'unsupported non-case calculation subject type "%"', p_subject_type
      using errcode = 'check_violation';
  end if;

  v_status := case
    when p_outputs is null then 'refused'
    when jsonb_array_length(v_refusals)>0 then 'computed_with_refusals'
    else 'computed' end;

  insert into public.calculation_runs(
    organization_id, calculation_key, method, code_version, inputs, input_refs,
    outputs, refusals, status, computed_by, subject_type, subject_ref
  ) values (
    p_organization_id, p_key, btrim(p_method), v_version, p_inputs, p_input_refs,
    p_outputs, v_refusals, v_status, p_actor_id, p_subject_type, p_subject_ref
  ) returning id into v_id;

  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    p_organization_id, 'calculation_run', coalesce(v_actor_role,'unknown'),
    jsonb_build_object(
      'calculation_run_id',v_id,'calculation_key',p_key,
      'code_version',v_version,'subject_type',p_subject_type,
      'subject_ref',p_subject_ref,'status',v_status
    ), null,
    jsonb_build_object(
      'calculation_key',p_key,'code_version',v_version,'status',v_status,
      'refusalCount',jsonb_array_length(v_refusals)
    )
  );

  return v_id;
end
$$;

revoke all on function public.record_calculation_run(
  uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.record_calculation_run(
  uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb
) to service_role;

comment on function public.record_calculation_run(
  uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb
) is
  'D11.29 service-only overload for non-case calculations. Validates actor membership and canonical tenant subject, pins code version server-side, and appends to the one immutable calculation_runs ledger.';

notify pgrst,'reload schema';

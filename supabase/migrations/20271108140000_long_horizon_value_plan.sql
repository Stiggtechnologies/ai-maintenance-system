-- A1.05 — value engine for a multi-year maintenance and capital plan.
--
-- Canonical reuse:
--   * capital_plan_items remains the capital-candidate store;
--   * budget_lines remains the maintenance-budget store and is not given a
--     currency it does not record;
--   * asset_economics and lifecycle_evaluations remain the lifecycle-cost
--     evidence;
--   * risks remains the governed risk object;
--   * production_records remains observed performance;
--   * threat_scenarios and climate_resilience_assessments remain resilience
--     evidence;
--   * evidence_items, calculation_runs and audit_events remain the provenance,
--     calculation and audit ledgers.
--
-- The plan is an identity and a horizon. It does not copy those records, fit a
-- trend, convert currency, or treat a missing year as zero. Adoption freezes
-- one composition and grants no expenditure, sanction, work, risk acceptance
-- or return-to-service authority.

create table if not exists public.long_horizon_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_code text not null check (plan_code ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  version integer not null check (version > 0),
  status text not null check (status in ('draft','adopted','superseded')),
  start_year integer not null,
  end_year integer not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  forecast_method text not null check (forecast_method in
    ('recorded_only','human_stated_annual_maintenance')),
  stated_annual_maintenance numeric,
  stated_annual_basis text,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  basis text not null check (length(btrim(basis)) >= 20),
  calculation_run_id uuid references public.calculation_runs(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  adoption_note text,
  created_at timestamptz not null default now(),
  check (end_year >= start_year + 1 and end_year <= start_year + 29),
  check (
    (forecast_method = 'recorded_only'
      and stated_annual_maintenance is null
      and stated_annual_basis is null)
    or (forecast_method = 'human_stated_annual_maintenance'
      and stated_annual_maintenance >= 0
      and length(btrim(stated_annual_basis)) >= 20)
  ),
  check (
    (status = 'draft' and adopted_by is null and adopted_at is null and calculation_run_id is null)
    or (status = 'adopted' and adopted_by is not null and adopted_at is not null
        and calculation_run_id is not null and adopted_by <> created_by
        and length(btrim(adoption_note)) >= 20)
    or (status = 'superseded')
  ),
  unique (organization_id, plan_code, version)
);

create unique index if not exists long_horizon_plans_one_draft
  on public.long_horizon_plans(organization_id, plan_code)
  where status = 'draft';
create unique index if not exists long_horizon_plans_one_adopted
  on public.long_horizon_plans(organization_id, plan_code)
  where status = 'adopted';
create index if not exists long_horizon_plans_org_idx
  on public.long_horizon_plans(organization_id, created_at desc);

alter table public.long_horizon_plans enable row level security;
drop policy if exists long_horizon_plans_read on public.long_horizon_plans;
create policy long_horizon_plans_read on public.long_horizon_plans
  for select to authenticated
  using (organization_id = public.app_current_org());

revoke all on table public.long_horizon_plans from public, anon, authenticated, service_role;
grant select on table public.long_horizon_plans to authenticated;
revoke truncate on table public.long_horizon_plans from public, anon, authenticated, service_role;

create or replace function public.guard_long_horizon_plan_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $guard$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'long-horizon plans are changed only through the governed value-engine writer';
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if coalesce(current_setting('app.long_horizon_plan_writer', true), '') <> 'governed' then
    raise exception 'long-horizon plans are changed only through the governed value-engine writer';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$guard$;

revoke all on function public.guard_long_horizon_plan_write() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_long_horizon_plan_write on public.long_horizon_plans;
create trigger trg_guard_long_horizon_plan_write
  before insert or update or delete on public.long_horizon_plans
  for each row execute function public.guard_long_horizon_plan_write();

drop trigger if exists trg_guard_long_horizon_plan_truncate on public.long_horizon_plans;
create trigger trg_guard_long_horizon_plan_truncate
  before truncate on public.long_horizon_plans
  for each statement execute function public.guard_long_horizon_plan_write();

create or replace function public.compose_long_horizon_value(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $compose$
declare
  v_org uuid := public.app_current_org();
  p public.long_horizon_plans%rowtype;
  y integer;
  v_match_n bigint;
  v_match_sum numeric;
  v_unknown_n bigint;
  v_other_n bigint;
  v_maint_n bigint;
  v_maint_forecast_n bigint;
  v_capital_budget_n bigint;
  v_status text;
  v_amount numeric;
  v_year_total numeric;
  v_year_basis text;
  v_years jsonb := '[]'::jsonb;
  v_all_clean boolean := true;
  v_capital_sum numeric := 0;
  v_span integer;
  v_eval_n bigint;
  v_econ_n bigint;
  v_econ_annual_n bigint;
  v_econ_annual numeric;
  v_open_n bigint;
  v_high_n bigint;
  v_risk_currencies bigint;
  v_risk_missing bigint;
  v_risk_sum numeric;
  v_risk_currency text;
  v_prod_n bigint;
  v_prod_units bigint;
  v_prod_unit text;
  v_prod_sum numeric;
  v_threat_n bigint;
  v_climate_n bigint;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','a named tenant session is required');
  end if;
  select * into p from public.long_horizon_plans
   where id = p_plan_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error','long-horizon plan not found in this organization');
  end if;

  for y in p.start_year..p.end_year loop
    select
      count(*) filter (where i.currency = p.currency),
      coalesce(sum(i.cost) filter (where i.currency = p.currency), 0),
      count(*) filter (where i.currency is null),
      count(*) filter (where i.currency is not null and i.currency <> p.currency)
    into v_match_n, v_match_sum, v_unknown_n, v_other_n
    from public.capital_plan_items i
    where i.organization_id = v_org and i.plan_year = y;

    select
      count(*) filter (where b.category <> 'capital'),
      count(*) filter (where b.category <> 'capital' and b.forecast is not null),
      count(*) filter (where b.category = 'capital')
    into v_maint_n, v_maint_forecast_n, v_capital_budget_n
    from public.budget_lines b
    where b.organization_id = v_org and b.budget_year = y;

    if v_match_n = 0 and v_unknown_n = 0 and v_other_n = 0 then
      v_status := 'not_recorded';
      v_amount := null;
      v_year_total := null;
      v_year_basis := 'not_recorded';
      v_all_clean := false;
    elsif v_unknown_n > 0 or v_other_n > 0 then
      v_status := 'currency_unsafe';
      v_amount := null;
      v_year_total := null;
      v_year_basis := 'withheld_currency';
      v_all_clean := false;
    else
      v_status := 'recorded';
      v_amount := v_match_sum;
      v_capital_sum := v_capital_sum + v_match_sum;
      if p.forecast_method = 'human_stated_annual_maintenance' then
        v_year_total := v_match_sum + p.stated_annual_maintenance;
        v_year_basis := 'recorded_capital_plus_stated_maintenance';
      else
        v_year_total := v_match_sum;
        v_year_basis := 'recorded_capital';
      end if;
    end if;

    v_years := v_years || jsonb_build_array(jsonb_build_object(
      'year', y,
      'capitalStatus', v_status,
      'capitalAmount', v_amount,
      'unknownCurrencyCount', v_unknown_n,
      'otherCurrencyCount', v_other_n,
      'maintenanceLineCount', v_maint_n,
      'maintenanceForecastCount', v_maint_forecast_n,
      'capitalBudgetLineCount', v_capital_budget_n,
      'maintenanceCurrency', null,
      'statedMaintenance', case
        when p.forecast_method = 'human_stated_annual_maintenance' then p.stated_annual_maintenance
        else null end,
      'yearTotal', v_year_total,
      'yearTotalBasis', v_year_basis
    ));
  end loop;

  v_span := p.end_year - p.start_year + 1;
  select count(*) into v_eval_n from public.lifecycle_evaluations e where e.organization_id = v_org;
  select count(*),
         count(*) filter (where annual_maintenance_cost_usd is not null),
         sum(annual_maintenance_cost_usd) filter (where annual_maintenance_cost_usd is not null)
    into v_econ_n, v_econ_annual_n, v_econ_annual
    from public.asset_economics where organization_id = v_org;

  select
    count(*) filter (where r.status not in ('draft','closed','archived')),
    count(*) filter (where r.status not in ('draft','closed','archived')
      and r.current_risk_level in ('High','Critical')),
    count(distinct r.value_currency) filter (where r.status not in ('draft','closed','archived')
      and r.value_at_risk is not null),
    count(*) filter (where r.status not in ('draft','closed','archived') and r.value_at_risk is null),
    sum(r.value_at_risk) filter (where r.status not in ('draft','closed','archived')
      and r.value_at_risk is not null),
    min(r.value_currency) filter (where r.status not in ('draft','closed','archived')
      and r.value_at_risk is not null)
  into v_open_n, v_high_n, v_risk_currencies, v_risk_missing, v_risk_sum, v_risk_currency
  from public.risks r where r.organization_id = v_org;

  select count(*), count(distinct unit_of_measure), min(unit_of_measure),
         sum(units_produced)
    into v_prod_n, v_prod_units, v_prod_unit, v_prod_sum
    from public.production_records where organization_id = v_org;

  select count(*) into v_threat_n from public.threat_scenarios where organization_id = v_org;
  select count(*) into v_climate_n from public.climate_resilience_assessments where organization_id = v_org;

  return jsonb_build_object(
    'planId', p.id,
    'planCode', p.plan_code,
    'version', p.version,
    'status', p.status,
    'startYear', p.start_year,
    'endYear', p.end_year,
    'currency', p.currency,
    'forecastMethod', p.forecast_method,
    'statedAnnualMaintenance', p.stated_annual_maintenance,
    'statedAnnualBasis', p.stated_annual_basis,
    'evidenceItemId', p.evidence_item_id,
    'basis', p.basis,
    'calculationRunId', p.calculation_run_id,
    'createdBy', p.created_by,
    'adoptedBy', p.adopted_by,
    'expenditureAuthorized', false,
    'projectSanctioned', false,
    'workAuthorized', false,
    'riskAccepted', false,
    'returnToServiceAuthorized', false,
    'lifecycleCost', jsonb_build_object(
      'currency', 'USD',
      'evaluationCount', v_eval_n,
      'economicsSnapshotCount', v_econ_n,
      'snapshotsWithAnnualMaintenance', v_econ_annual_n,
      'recordedAnnualMaintenanceUsd', case when v_econ_annual_n = 0 then null else v_econ_annual end,
      'horizonMultiplication', false,
      'note', 'Recorded annual maintenance stays in USD and is not multiplied across the horizon or converted into the plan currency.'
    ),
    'risk', jsonb_build_object(
      'openCount', v_open_n,
      'highOrCriticalCount', v_high_n,
      'currency', case when v_open_n > 0 and v_risk_missing = 0 and v_risk_currencies = 1 then v_risk_currency else null end,
      'recordedValueAtRisk', case when v_open_n > 0 and v_risk_missing = 0 and v_risk_currencies = 1 then v_risk_sum else null end,
      'valueWithheldReason', case
        when v_open_n = 0 then 'no open governed risks'
        when v_risk_missing > 0 then 'an open risk has no recorded value at risk'
        when v_risk_currencies <> 1 then 'open risks do not share one currency'
        else null end
    ),
    'performance', jsonb_build_object(
      'recordCount', v_prod_n,
      'unit', case when v_prod_units = 1 then v_prod_unit else null end,
      'observedUnits', case when v_prod_units = 1 then v_prod_sum else null end,
      'withheldReason', case
        when v_prod_n = 0 then 'no production records'
        when v_prod_units > 1 then 'production spans mixed units'
        else null end,
      'label', 'observed history, not a forecast'
    ),
    'resilience', jsonb_build_object(
      'threatScenarioCount', v_threat_n,
      'climateAssessmentCount', v_climate_n,
      'score', null,
      'note', 'Exposure counts are not a resilience rating and do not change an interval, spare, or emergency plan.'
    ),
    'capitalAllocation', jsonb_build_object(
      'currency', p.currency,
      'years', v_years,
      'maintenanceAssumptionTotal', case
        when p.forecast_method = 'human_stated_annual_maintenance'
          then p.stated_annual_maintenance * v_span
        else null end,
      'capitalHorizonTotal', case when v_all_clean then v_capital_sum else null end,
      'combinedHorizonTotal', case
        when not v_all_clean then null
        when p.forecast_method = 'human_stated_annual_maintenance'
          then v_capital_sum + p.stated_annual_maintenance * v_span
        else v_capital_sum end,
      'horizonTotalStatus', case when v_all_clean then 'recorded' else 'withheld' end,
      'withheldReason', case
        when v_all_clean then null
        else 'a year in the horizon has no currency-matched capital, or mixes unknown or foreign currency; missing capital is not zero and budget lines are not converted' end,
      'budgetLineNote', 'budget lines record no currency, so their amounts are counted and withheld from every total'
    )
  );
end
$compose$;

revoke all on function public.compose_long_horizon_value(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.long_horizon_actor()
returns table(organization_id uuid, actor_id uuid, actor_role text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $actor$
declare
  v_org uuid := public.app_current_org();
  v_role text;
begin
  if auth.uid() is null or v_org is null then
    return;
  end if;
  select u.role into v_role
    from public.user_profiles u
   where u.id = auth.uid() and u.organization_id = v_org;
  if v_role is null then
    return;
  end if;
  organization_id := v_org;
  actor_id := auth.uid();
  actor_role := v_role;
  return next;
end
$actor$;

revoke all on function public.long_horizon_actor()
  from public, anon, authenticated, service_role;

create or replace function public.record_long_horizon_plan(p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $record$
declare
  v_org uuid;
  v_actor uuid;
  v_role text;
  v_code text;
  v_start integer;
  v_end integer;
  v_currency text;
  v_method text;
  v_stated numeric;
  v_stated_basis text;
  v_evidence uuid;
  v_basis text;
  v_version integer;
  v_id uuid;
  v_window_start integer := extract(year from current_date)::integer - 1;
  v_window_end integer := extract(year from current_date)::integer + 30;
begin
  select a.organization_id, a.actor_id, a.actor_role
    into v_org, v_actor, v_role
    from public.long_horizon_actor() a;
  if v_org is null then
    return jsonb_build_object('error','a named tenant session is required');
  end if;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error','AI operator is refused');
  end if;
  if v_role not in ('reliability_engineer','planner','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','this role cannot record a long-horizon plan');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor) or public.app_current_aal() <> 'aal2' then
    return jsonb_build_object('error','a verified factor and an AAL2 session are required');
  end if;

  v_code := upper(btrim(coalesce(p_plan->>'planCode','')));
  v_currency := upper(btrim(coalesce(p_plan->>'currency','')));
  v_method := btrim(coalesce(p_plan->>'forecastMethod',''));
  v_basis := btrim(coalesce(p_plan->>'basis',''));
  v_stated_basis := nullif(btrim(coalesce(p_plan->>'statedAnnualBasis','')),'');
  begin
    v_start := (p_plan->>'startYear')::integer;
    v_end := (p_plan->>'endYear')::integer;
    v_evidence := (p_plan->>'evidenceItemId')::uuid;
    if p_plan ? 'statedAnnualMaintenance' and p_plan->>'statedAnnualMaintenance' is not null
       and btrim(p_plan->>'statedAnnualMaintenance') <> '' then
      v_stated := (p_plan->>'statedAnnualMaintenance')::numeric;
    else
      v_stated := null;
    end if;
  exception when others then
    return jsonb_build_object('error','plan code, years, currency, method and evidence must be valid');
  end;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' then
    return jsonb_build_object('error','plan code must be 2 to 40 letters, digits or hyphens');
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error','currency must be a three-letter ISO code');
  end if;
  if v_start is null or v_end is null or v_end < v_start + 1 or v_end > v_start + 29
     or v_start < v_window_start or v_end > v_window_end then
    return jsonb_build_object('error','the horizon must cover at least two years and stay inside the governed planning window');
  end if;
  if v_method = 'recorded_only' then
    if v_stated is not null or v_stated_basis is not null then
      return jsonb_build_object('error','a recorded-only plan cannot carry a stated maintenance amount');
    end if;
  elsif v_method = 'human_stated_annual_maintenance' then
    if v_stated is null or v_stated < 0 or coalesce(length(v_stated_basis),0) < 20 then
      return jsonb_build_object('error','a stated annual maintenance amount needs a non-negative value and a basis');
    end if;
  else
    return jsonb_build_object('error','forecast method must be recorded capital only or a stated annual maintenance assumption');
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('error','the plan basis must state what the horizon rests on');
  end if;
  if not exists (
    select 1 from public.evidence_items e
     where e.id = v_evidence and e.organization_id = v_org
       and e.verification_status = 'verified'
       and e.verified_by is distinct from v_actor
  ) then
    return jsonb_build_object('error','the plan requires same-tenant evidence independently verified by someone other than the author');
  end if;
  if exists (
    select 1 from public.long_horizon_plans existing
     where existing.organization_id = v_org and existing.plan_code = v_code
       and existing.status = 'draft'
  ) then
    return jsonb_build_object('error','a draft already exists for this plan code');
  end if;

  select coalesce(max(existing.version), 0) + 1 into v_version
    from public.long_horizon_plans existing
   where existing.organization_id = v_org and existing.plan_code = v_code;

  perform set_config('app.long_horizon_plan_writer', 'governed', true);
  insert into public.long_horizon_plans(
    organization_id, plan_code, version, status, start_year, end_year, currency,
    forecast_method, stated_annual_maintenance, stated_annual_basis,
    evidence_item_id, basis, created_by
  ) values (
    v_org, v_code, v_version, 'draft', v_start, v_end, v_currency,
    v_method, v_stated, v_stated_basis, v_evidence, v_basis, v_actor
  ) returning id into v_id;

  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'long_horizon_plan', v_role,
    jsonb_build_object(
      'action','draft_recorded','planId',v_id,'planCode',v_code,'version',v_version,
      'actorId',v_actor,'evidenceItemId',v_evidence,
      'expenditureAuthorized',false,'projectSanctioned',false,'workAuthorized',false,
      'riskAccepted',false,'returnToServiceAuthorized',false
    ),
    null,
    jsonb_build_object(
      'startYear',v_start,'endYear',v_end,'currency',v_currency,
      'forecastMethod',v_method,'statedAnnualMaintenance',v_stated,'basis',v_basis
    )
  );

  return jsonb_build_object(
    'planId', v_id,
    'planCode', v_code,
    'version', v_version,
    'status', 'draft',
    'expenditureAuthorized', false,
    'projectSanctioned', false,
    'workAuthorized', false,
    'riskAccepted', false,
    'returnToServiceAuthorized', false
  );
end
$record$;

revoke all on function public.record_long_horizon_plan(jsonb) from public, anon, service_role;
grant execute on function public.record_long_horizon_plan(jsonb) to authenticated;

create or replace function public.adopt_long_horizon_plan(p_plan_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $adopt$
declare
  v_org uuid;
  v_actor uuid;
  v_role text;
  p public.long_horizon_plans%rowtype;
  v_note text := btrim(coalesce(p_note,''));
  v_composition jsonb;
  v_run uuid;
  v_before jsonb;
begin
  select a.organization_id, a.actor_id, a.actor_role
    into v_org, v_actor, v_role
    from public.long_horizon_actor() a;
  if v_org is null then
    return jsonb_build_object('error','a named tenant session is required');
  end if;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error','AI operator is refused');
  end if;
  if v_role not in ('executive','admin','maintenance_manager') then
    return jsonb_build_object('error','adoption requires an executive, administrator or maintenance manager');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor) or public.app_current_aal() <> 'aal2' then
    return jsonb_build_object('error','a verified factor and an AAL2 session are required');
  end if;
  if length(v_note) < 20 then
    return jsonb_build_object('error','adoption needs a note of what was reviewed');
  end if;

  select * into p from public.long_horizon_plans
   where id = p_plan_id and organization_id = v_org
   for update;
  if not found then
    return jsonb_build_object('error','long-horizon plan not found in this organization');
  end if;
  if p.status <> 'draft' then
    return jsonb_build_object('error','only a draft plan can be adopted');
  end if;
  if p.created_by = v_actor then
    return jsonb_build_object('error','the author cannot adopt their own long-horizon plan');
  end if;

  v_composition := public.compose_long_horizon_value(p.id);
  if v_composition ? 'error' then
    return v_composition;
  end if;
  v_composition := v_composition || jsonb_build_object(
    'status', 'adopted',
    'adoptedBy', v_actor,
    'expenditureAuthorized', false
  );

  insert into public.calculation_runs(
    organization_id, calculation_key, method, code_version, inputs, input_refs,
    outputs, refusals, status, computed_by, subject_type, subject_ref
  ) values (
    v_org,
    'long_horizon_value_plan',
    'Compose recorded capital, stated maintenance, lifecycle cost, risk, observed performance and resilience exposure across the named horizon without inventing missing years.',
    'value-engine/a1.05/2027-11-08',
    jsonb_build_object(
      'planId', p.id, 'planCode', p.plan_code, 'version', p.version,
      'startYear', p.start_year, 'endYear', p.end_year, 'currency', p.currency,
      'forecastMethod', p.forecast_method
    ),
    jsonb_build_array(jsonb_build_object(
      'table','long_horizon_plans','id',p.id,'evidenceItemId',p.evidence_item_id
    )),
    v_composition,
    '[]'::jsonb,
    'computed',
    v_actor,
    'organization',
    p.id::text
  ) returning id into v_run;

  v_before := jsonb_build_object('status', p.status, 'version', p.version);
  perform set_config('app.long_horizon_plan_writer', 'governed', true);
  update public.long_horizon_plans prior
     set status = 'superseded'
   where prior.organization_id = v_org
     and prior.plan_code = p.plan_code
     and prior.status = 'adopted'
     and prior.id <> p.id;
  update public.long_horizon_plans current
     set status = 'adopted',
         adopted_by = v_actor,
         adopted_at = now(),
         adoption_note = v_note,
         calculation_run_id = v_run
   where current.id = p.id and current.organization_id = v_org;

  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'long_horizon_plan', v_role,
    jsonb_build_object(
      'action','adopted','planId',p.id,'planCode',p.plan_code,'version',p.version,
      'actorId',v_actor,'authorId',p.created_by,'calculationRunId',v_run,
      'expenditureAuthorized',false,'projectSanctioned',false,'workAuthorized',false,
      'riskAccepted',false,'returnToServiceAuthorized',false
    ),
    v_before,
    jsonb_build_object('status','adopted','calculationRunId',v_run,'note',v_note)
  );

  return jsonb_build_object(
    'planId', p.id,
    'status', 'adopted',
    'calculationRunId', v_run,
    'expenditureAuthorized', false,
    'projectSanctioned', false,
    'workAuthorized', false,
    'riskAccepted', false,
    'returnToServiceAuthorized', false
  );
end
$adopt$;

revoke all on function public.adopt_long_horizon_plan(uuid, text) from public, anon, service_role;
grant execute on function public.adopt_long_horizon_plan(uuid, text) to authenticated;

create or replace function public.get_long_horizon_value_plan(p_plan_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $get$
declare
  v_org uuid := public.app_current_org();
  v_selected uuid;
  v_composition jsonb;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','a named tenant session is required');
  end if;
  if p_plan_id is not null then
    select id into v_selected from public.long_horizon_plans
     where id = p_plan_id and organization_id = v_org;
    if v_selected is null then
      return jsonb_build_object('error','long-horizon plan not found in this organization');
    end if;
  else
    select id into v_selected from public.long_horizon_plans
     where organization_id = v_org
     order by case status when 'adopted' then 0 when 'draft' then 1 else 2 end,
              created_at desc
     limit 1;
  end if;
  if v_selected is not null then
    v_composition := public.compose_long_horizon_value(v_selected);
  end if;
  return jsonb_build_object(
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'planCode', q.plan_code, 'version', q.version, 'status', q.status,
        'startYear', q.start_year, 'endYear', q.end_year, 'currency', q.currency,
        'forecastMethod', q.forecast_method, 'createdBy', q.created_by,
        'adoptedBy', q.adopted_by
      ) order by q.created_at desc)
      from public.long_horizon_plans q where q.organization_id = v_org
    ), '[]'::jsonb),
    'selected', v_composition,
    'decisionBoundary', 'This plan composes recorded evidence. It does not commit expenditure, sanction a project, release work, accept risk or return equipment to service.'
  );
end
$get$;

revoke all on function public.get_long_horizon_value_plan(uuid) from public, anon, service_role;
grant execute on function public.get_long_horizon_value_plan(uuid) to authenticated;

comment on table public.long_horizon_plans is
  'A1.05 multi-year maintenance and capital plan identity. Amounts stay in capital_plan_items, budget_lines and the other canonical lenses; this row does not authorize spend.';

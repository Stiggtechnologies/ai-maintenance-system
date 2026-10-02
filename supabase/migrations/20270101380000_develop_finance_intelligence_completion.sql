-- ============================================================================
-- Sync Develop D2.04 — complete the thirteen-dimension finance intelligence
-- contract on the EXISTING value-management family.
--
-- No second finance store is introduced. This migration:
--   * binds sourced escalation / FX assumptions to business_case_options;
--   * leaves raw cash_flows immutable and lets src/lib/value perform the one
--     deterministic transformation before its existing NPV / IRR / payback;
--   * composes the existing earned-value, forecast-confidence and
--     since-sanction reads into one finance-intelligence response;
--   * makes all thirteen spec I.11 dimensions explicit as recorded,
--     computable, applied, refused or missing — absence is never a zero;
--   * routes every cash-flow writer through cash_flows_well_formed by trigger,
--     in addition to the existing CHECK and RPC refusal.
--
-- Economic bindings are human planning acts. They do not approve an option,
-- sanction capital, accept risk, change a baseline or verify realized value.
-- ============================================================================

alter table public.business_case_options
  add column if not exists source_currency text,
  add column if not exists escalation_assumption_key text,
  add column if not exists fx_assumption_key text,
  add column if not exists economic_adjustment_basis text;

alter table public.business_case_options
  drop constraint if exists business_case_options_source_currency_iso;
alter table public.business_case_options
  add constraint business_case_options_source_currency_iso check (
    source_currency is null or source_currency ~ '^[A-Z]{3}$'
  );

alter table public.business_case_options
  drop constraint if exists business_case_options_adjustment_basis;
alter table public.business_case_options
  add constraint business_case_options_adjustment_basis check (
    (escalation_assumption_key is null and fx_assumption_key is null
      and economic_adjustment_basis is null)
    or (economic_adjustment_basis is not null
      and length(btrim(economic_adjustment_basis)) >= 20)
  );

-- The helper was previously reachable only through a CHECK. This trigger uses
-- the SAME helper — no duplicate shape logic — and gives every writer the
-- named refusal before a malformed flow can reach the value kernel.
create or replace function public.enforce_business_case_cash_flow_shape()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.cash_flows_well_formed(new.cash_flows) then
    raise exception
      'cash_flows must be an array of finite {period: integer >= 0, amount: number} records'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists trg_business_case_cash_flow_shape
  on public.business_case_options;
create trigger trg_business_case_cash_flow_shape
  before insert or update of cash_flows on public.business_case_options
  for each row execute function public.enforce_business_case_cash_flow_shape();

revoke all on function public.enforce_business_case_cash_flow_shape()
  from public, anon, authenticated, service_role;

-- Bind assumptions by stable series key. The operative value remains the
-- latest effective version in financial_assumptions; no rate is copied onto
-- the option, so provenance and later reviewed versions stay visible.
create or replace function public.configure_business_case_option_economics(
  p_option_id bigint,
  p_source_currency text,
  p_escalation_assumption_key text default null,
  p_fx_assumption_key text default null,
  p_basis text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  o business_case_options%rowtype;
  bc business_cases%rowtype;
  v_source text := upper(nullif(btrim(coalesce(p_source_currency, '')), ''));
  v_escalation_key text := nullif(btrim(coalesce(p_escalation_assumption_key, '')), '');
  v_fx_key text := nullif(btrim(coalesce(p_fx_assumption_key, '')), '');
  v_basis text := nullif(btrim(coalesce(p_basis, '')), '');
  v_escalation financial_assumptions%rowtype;
  v_fx financial_assumptions%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role
    from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'binding assumptions that change economic cash flows is a named human planning act — the AI-operator identity may prepare evidence but cannot set the basis');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'configuring option economics requires a human planning, engineering or governance role');
  end if;

  select * into o from business_case_options
   where id = p_option_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'business-case option not found in this organization');
  end if;
  select * into bc from business_cases
   where id = o.case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'business case not found in this organization');
  end if;

  if v_escalation_key is null and v_fx_key is null then
    return jsonb_build_object('error',
      'name an escalation or FX assumption to bind — an existing binding is revised with a new stated basis, never silently cleared');
  end if;
  if v_source is null or v_source !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error', 'source currency must be a three-letter ISO code');
  end if;
  if v_basis is null or length(v_basis) < 20 then
    return jsonb_build_object('error',
      'state why these sourced assumptions apply to this option (20 characters minimum)');
  end if;

  if v_escalation_key is not null then
    select * into v_escalation from financial_assumptions
     where organization_id = v_org
       and assumption_key = v_escalation_key
       and kind = 'escalation'
       and effective_from <= current_date
     order by effective_from desc, id desc limit 1;
    if not found then
      return jsonb_build_object('error',
        format('escalation assumption "%s" has no operative sourced version in this organization', v_escalation_key));
    end if;
    if v_escalation.unit is distinct from 'fraction_per_period' then
      return jsonb_build_object('error',
        format('escalation assumption "%s" must use unit fraction_per_period; %s cannot be applied as a rate',
          v_escalation_key, coalesce(v_escalation.unit, 'no unit')));
    end if;
    if v_escalation.value <= -1
       or v_escalation.value = 'NaN'::numeric
       or v_escalation.value = 'Infinity'::numeric
       or v_escalation.value = '-Infinity'::numeric then
      return jsonb_build_object('error',
        'an escalation rate must be finite and greater than -1 per period');
    end if;
  end if;

  if v_source <> upper(bc.currency) and v_fx_key is null then
    return jsonb_build_object('error',
      format('source currency %s differs from business-case currency %s — bind a sourced FX assumption; an exchange rate is never invented',
        v_source, upper(bc.currency)));
  end if;
  if v_fx_key is not null then
    if v_source = upper(bc.currency) then
      return jsonb_build_object('error',
        'source and business-case currency are already the same — an FX multiplier would change the value without converting a currency');
    end if;
    select * into v_fx from financial_assumptions
     where organization_id = v_org
       and assumption_key = v_fx_key
       and kind = 'fx'
       and effective_from <= current_date
     order by effective_from desc, id desc limit 1;
    if not found then
      return jsonb_build_object('error',
        format('FX assumption "%s" has no operative sourced version in this organization', v_fx_key));
    end if;
    if v_fx.unit is distinct from upper(bc.currency) || '_per_' || v_source then
      return jsonb_build_object('error',
        format('FX assumption "%s" must use unit %s_per_%s so conversion direction is explicit; recorded unit is %s',
          v_fx_key, upper(bc.currency), v_source, coalesce(v_fx.unit, 'none')));
    end if;
    if v_fx.value <= 0
       or v_fx.value = 'NaN'::numeric
       or v_fx.value = 'Infinity'::numeric
       or v_fx.value = '-Infinity'::numeric then
      return jsonb_build_object('error', 'an FX rate must be finite and greater than zero');
    end if;
  end if;

  update business_case_options
     set source_currency = v_source,
         escalation_assumption_key = v_escalation_key,
         fx_assumption_key = v_fx_key,
         economic_adjustment_basis = v_basis
   where id = o.id and organization_id = v_org;

  insert into audit_events
    (organization_id, entity_type, actor, previous_state, new_state, event_data)
  values
    (v_org, 'business_case_option_economics', v_role,
     jsonb_build_object('sourceCurrency', o.source_currency,
       'escalationAssumptionKey', o.escalation_assumption_key,
       'fxAssumptionKey', o.fx_assumption_key,
       'basis', o.economic_adjustment_basis),
     jsonb_build_object('sourceCurrency', v_source,
       'targetCurrency', upper(bc.currency),
       'escalationAssumptionKey', v_escalation_key,
       'fxAssumptionKey', v_fx_key,
       'basis', v_basis),
     jsonb_build_object('optionId', o.id, 'businessCaseId', bc.id,
       'developmentCaseId', bc.development_case_id,
       'decisionBoundary', 'economic input binding only — no option approval, sanction, baseline change or value verification'));

  return jsonb_build_object('optionId', o.id,
    'sourceCurrency', v_source, 'targetCurrency', upper(bc.currency),
    'escalationAssumptionKey', v_escalation_key,
    'fxAssumptionKey', v_fx_key, 'basis', v_basis);
end
$$;

revoke all on function public.configure_business_case_option_economics(
  bigint, text, text, text, text) from public, anon;
grant execute on function public.configure_business_case_option_economics(
  bigint, text, text, text, text) to authenticated, service_role;

-- One composition read. get_case_finance_model remains the canonical base;
-- this function enriches its options with the operative assumption versions
-- and composes existing execution-economics reads. It performs no NPV, IRR,
-- payback, EVM, forecast or sanction arithmetic of its own.
create or replace function public.get_case_finance_intelligence(p_case_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_model jsonb;
  v_option jsonb;
  v_options jsonb := '[]'::jsonb;
  o business_case_options%rowtype;
  bc business_cases%rowtype;
  v_escalation financial_assumptions%rowtype;
  v_fx financial_assumptions%rowtype;
  v_adjustment jsonb;
  v_refusal text;
  v_has_capital boolean := false;
  v_has_operating boolean := false;
  v_has_flows boolean := false;
  v_has_contingency boolean := false;
  v_escalation_bound boolean := false;
  v_fx_bound boolean := false;
  v_escalation_recorded boolean := false;
  v_fx_recorded boolean := false;
  v_assumptions_recorded boolean := false;
  v_commodity_sensitivity boolean := false;
  v_funding_recorded boolean := false;
  v_dimensions jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases
   where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_model := public.get_case_finance_model(c.id);
  if v_model ? 'error' or coalesce((v_model->>'available')::boolean, false) is false then
    return v_model;
  end if;
  select * into bc from business_cases
   where id = (v_model->'businessCase'->>'id')::bigint
     and organization_id = v_org;

  for v_option in select value from jsonb_array_elements(v_model->'options')
  loop
    select * into o from business_case_options
     where id = (v_option->>'id')::bigint and organization_id = v_org;
    v_refusal := null;
    v_escalation := null;
    v_fx := null;

    if o.escalation_assumption_key is not null then
      select * into v_escalation from financial_assumptions
       where organization_id = v_org
         and assumption_key = o.escalation_assumption_key
         and kind = 'escalation'
         and effective_from <= current_date
       order by effective_from desc, id desc limit 1;
      if not found then
        v_refusal := format('Escalation unavailable: bound assumption "%s" has no operative sourced version.', o.escalation_assumption_key);
      elsif v_escalation.unit is distinct from 'fraction_per_period'
         or v_escalation.value <= -1 then
        v_refusal := format('Escalation unavailable: bound assumption "%s" is not a valid fraction_per_period greater than -1.', o.escalation_assumption_key);
      else
        v_escalation_bound := true;
      end if;
    end if;

    if o.fx_assumption_key is not null then
      select * into v_fx from financial_assumptions
       where organization_id = v_org
         and assumption_key = o.fx_assumption_key
         and kind = 'fx'
         and effective_from <= current_date
       order by effective_from desc, id desc limit 1;
      if not found then
        v_refusal := coalesce(v_refusal || ' ', '') ||
          format('FX unavailable: bound assumption "%s" has no operative sourced version.', o.fx_assumption_key);
      elsif v_fx.unit is distinct from upper(bc.currency) || '_per_' || o.source_currency
         or v_fx.value <= 0 then
        v_refusal := coalesce(v_refusal || ' ', '') ||
          format('FX unavailable: bound assumption "%s" is not a positive %s_per_%s rate.',
            o.fx_assumption_key, upper(bc.currency), o.source_currency);
      else
        v_fx_bound := true;
      end if;
    elsif o.source_currency is not null and o.source_currency <> upper(bc.currency) then
      v_refusal := coalesce(v_refusal || ' ', '') ||
        format('FX unavailable: source currency %s differs from business-case currency %s and no approved FX assumption is bound.',
          o.source_currency, upper(bc.currency));
    end if;

    if o.escalation_assumption_key is null and o.fx_assumption_key is null then
      v_adjustment := null;
    else
      v_adjustment := jsonb_build_object(
        'status', case when v_refusal is null then 'ready' else 'refused' end,
        'sourceCurrency', coalesce(o.source_currency, upper(bc.currency)),
        'targetCurrency', upper(bc.currency),
        'basis', o.economic_adjustment_basis,
        'escalation', case when v_escalation.id is null then null else jsonb_build_object(
          'key', v_escalation.assumption_key, 'value', v_escalation.value,
          'unit', v_escalation.unit, 'source', v_escalation.source,
          'effectiveFrom', v_escalation.effective_from) end,
        'foreignExchange', case when v_fx.id is null then null else jsonb_build_object(
          'key', v_fx.assumption_key, 'value', v_fx.value,
          'unit', v_fx.unit, 'source', v_fx.source,
          'effectiveFrom', v_fx.effective_from) end,
        'refusal', v_refusal);
    end if;
    v_options := v_options || jsonb_build_array(
      v_option || jsonb_build_object('economicAdjustment', v_adjustment));
  end loop;

  select exists (
    select 1 from business_case_options bo,
      lateral jsonb_array_elements(bo.cash_flows) f
     where bo.case_id = bc.id and (f->>'period')::int = 0
  ), exists (
    select 1 from business_case_options bo,
      lateral jsonb_array_elements(bo.cash_flows) f
     where bo.case_id = bc.id and (f->>'period')::int > 0
       and (f->>'amount')::numeric < 0
  ), exists (
    select 1 from business_case_options bo
     where bo.case_id = bc.id and jsonb_array_length(bo.cash_flows) > 0
  ), exists (
    select 1 from business_case_options bo
     where bo.case_id = bc.id and bo.contingency is not null
  )
  into v_has_capital, v_has_operating, v_has_flows, v_has_contingency;

  select exists (select 1 from financial_assumptions
                  where organization_id = v_org and effective_from <= current_date),
         exists (select 1 from financial_assumptions
                  where organization_id = v_org and kind = 'escalation' and effective_from <= current_date),
         exists (select 1 from financial_assumptions
                  where organization_id = v_org and kind = 'fx' and effective_from <= current_date)
    into v_assumptions_recorded, v_escalation_recorded, v_fx_recorded;

  select exists (
    select 1 from risk_assumptions a
    join financial_assumptions fa
      on fa.organization_id = a.organization_id
     and fa.assumption_key = a.threshold_parameter
     and fa.kind = 'commodity_price'
     and fa.effective_from <= current_date
    where a.organization_id = v_org and a.development_case_id = c.id
      and a.threshold_parameter is not null
  ) into v_commodity_sensitivity;

  v_funding_recorded :=
    jsonb_array_length(v_model->'fundingConstraints'->'capitalPlanItems') > 0
    or jsonb_array_length(v_model->'fundingConstraints'->'capitalBudgetLines') > 0;

  v_dimensions := jsonb_build_array(
    jsonb_build_object('key','capital_cost','status',case when v_has_capital then 'recorded' else 'missing' end,
      'reason',case when v_has_capital then 'Period-0 cash flows are recorded.' else 'No period-0 cash flow is recorded.' end),
    jsonb_build_object('key','operating_cost','status',case when v_has_operating then 'recorded' else 'missing' end,
      'reason',case when v_has_operating then 'Post-period-0 negative cash flows are recorded.' else 'No post-period-0 operating-cost flow is recorded.' end),
    jsonb_build_object('key','lifecycle_cost','status',case when v_has_flows then 'recorded' else 'missing' end,
      'reason',case when v_has_flows then 'Full-life option cash-flow inputs are recorded.' else 'No full-life option cash flow is recorded.' end),
    jsonb_build_object('key','npv','status',case when (v_model->>'npvInputsComplete')::boolean then 'computable' else 'refused' end,
      'reason',case when (v_model->>'npvInputsComplete')::boolean then 'The one value kernel has complete recorded inputs.' else v_model->'refusals' end),
    jsonb_build_object('key','irr','status',case when (v_model->>'npvInputsComplete')::boolean then 'computable' else 'refused' end,
      'reason','The one value kernel computes or refuses IRR from the same dated flows.'),
    jsonb_build_object('key','payback','status',case when (v_model->>'npvInputsComplete')::boolean then 'computable' else 'refused' end,
      'reason','The one value kernel computes or refuses payback from the same dated flows.'),
    jsonb_build_object('key','cash_flow','status',case when v_has_flows then 'recorded' else 'missing' end,
      'reason','Raw dated flows remain the authoritative option input.'),
    jsonb_build_object('key','escalation','status',case when v_escalation_bound then 'applied' when v_escalation_recorded then 'recorded_unbound' else 'missing' end,
      'reason','Only an explicitly bound fraction_per_period assumption changes a flow.'),
    jsonb_build_object('key','contingency','status',case when v_has_contingency then 'recorded' else 'missing' end,
      'reason','Contingency is stated on the option with its mandatory basis.'),
    jsonb_build_object('key','economic_assumptions','status',case when v_assumptions_recorded then 'recorded' else 'missing' end,
      'reason','Every operative assumption remains a sourced, dated version.'),
    jsonb_build_object('key','foreign_exchange','status',case when v_fx_bound then 'applied' when v_fx_recorded then 'recorded_unbound' else 'missing' end,
      'reason','Only an explicitly bound target_per_source rate converts a flow.'),
    jsonb_build_object('key','commodity_sensitivity','status',case when v_commodity_sensitivity then 'recorded' else 'missing' end,
      'reason','Commodity sensitivity is the declared threshold margin on a sourced commodity-price series.'),
    jsonb_build_object('key','funding_constraints','status',case when v_funding_recorded then 'recorded' else 'missing' end,
      'reason','Funding constraints come from canonical capital-plan items and budget lines.')
  );

  return v_model || jsonb_build_object(
    'options', v_options,
    'dimensions', v_dimensions,
    'performance', jsonb_build_object(
      'earnedValue', public.get_case_earned_value(c.id),
      'forecastConfidence', public.get_case_forecast_confidence(c.id),
      'sinceSanctionDelta', public.get_since_sanction_delta(c.id)),
    'decisionBoundary',
      'Finance intelligence compares recorded and deterministic evidence. It does not approve an option, sanction capital, accept risk, change a baseline or verify realized value.');
end
$$;

revoke all on function public.get_case_finance_intelligence(uuid)
  from public, anon, service_role;
grant execute on function public.get_case_finance_intelligence(uuid)
  to authenticated;

comment on function public.get_case_finance_intelligence(uuid) is
  'D2.04 / spec I.11: composes the existing finance model, explicitly bound escalation/FX inputs, canonical earned value, forecast confidence and since-sanction delta. All thirteen dimensions report recorded/computable/applied/refused/missing; no autonomous financial decision.';

notify pgrst, 'reload schema';

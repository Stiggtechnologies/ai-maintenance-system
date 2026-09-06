-- ============================================================================
-- Sync Develop Slice 2 — the finance intelligence model (D2.04, spec I.11)
-- and the machine-readable ValueHypothesis (D2.01, spec I.4), landed on the
-- EXISTING financial family — business_cases / business_case_options /
-- financial_assumptions / capital_plan_items / budget_lines (20260819140000)
-- — exactly as the register rows rule. No parallel finance store arrives.
--
-- WHY THIS FILE IS SHAPED BY REFUSALS. This repository has retracted four
-- economic figures that reached committed documents, every one born as a
-- confident number whose basis nobody could produce. The corrections-log
-- lesson is standing law here: a number without its basis and sample is a
-- liability, and refusing to compute is a feature. Accordingly:
--
--   * the numeric leg (financial_assumptions) keeps its born rule — source
--     is NOT NULL — and every new write path re-states it;
--   * the hypothesis is all-or-none: spend + effect + value + basis. A
--     hypothesis missing its basis is a slogan and is refused;
--   * a declared viability floor (D2.03's tripwire) carries a stated basis,
--     can be revised with a reason, and can never be silently removed;
--   * NPV / IRR / payback are NEVER computed here. The single calculation
--     home is src/lib/value (the npv/compareOptions kernel — one engine,
--     never two, per the lifecycle-decisions convention: "the database
--     supplies inputs and stores results"). get_case_finance_model returns
--     the INPUTS plus, per dimension, either the recorded data or a NAMED
--     refusal ("NPV unavailable: no discount rate source recorded") that
--     the surface renders verbatim. The kernel refuses the same way
--     client-side (irr/payback added in src/lib/value this slice).
--
-- THE THIRTEEN I.11 DIMENSIONS map onto the family so:
--   capital / operating / lifecycle cost, cash flow → the options' dated
--     cash_flows (period 0 = capital; later periods operating/benefit);
--   NPV, IRR, payback → kernel over those inputs, refusal-first;
--   escalation, FX, commodity price, discount-rate provenance → TYPED KINDS
--     on financial_assumptions (new `kind` column) — the series already
--     versioned by effective_from IS the record; no new table;
--   contingency → typed columns on business_case_options with mandatory
--     basis (the capital_plan_items mandatory_basis idiom);
--   economic assumptions → the financial_assumptions register itself;
--   commodity sensitivity → the D2.06 threshold assumptions predicated on
--     kind='commodity_price' series (declared envelope, deterministic
--     margin — no invented elasticity model);
--   funding constraints → capital_plan_items + budget_lines rows where
--     recorded — absence renders as absence.
--
-- D2.07, SECOND HALF: upsert_financial_assumption is where the numeric leg
-- MOVES, so it is where declared thresholds are evaluated — deterministic
-- comparison, observation recorded on the ONE indicator machinery, violation
-- invalidating the assumption through the ONE invalidation core (D3.30
-- reopens dependents). §70 stands: rules fire; humans re-decide.
--
-- Canonical reuse: everything named above + development_cases, audit_events,
-- app_current_org(). No new table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The numeric leg gains its typed kind.
-- ---------------------------------------------------------------------------
alter table public.financial_assumptions
  add column if not exists kind text not null default 'general';

alter table public.financial_assumptions
  drop constraint if exists financial_assumptions_kind_allowed;
alter table public.financial_assumptions
  add constraint financial_assumptions_kind_allowed check (kind in
    ('general','escalation','fx','commodity_price','discount_rate','funding'));

-- ---------------------------------------------------------------------------
-- 2. Business cases bind to a development case and carry the hypothesis and
--    the viability floor. All-or-none checks at the schema; the RPCs repeat
--    them with named refusals.
-- ---------------------------------------------------------------------------
alter table public.business_cases
  add column if not exists development_case_id uuid
    references development_cases(id) on delete set null,
  add column if not exists currency text not null default 'USD',
  add column if not exists hypothesis_spend numeric,
  add column if not exists hypothesis_effect text,
  add column if not exists hypothesis_effect_quantity numeric,
  add column if not exists hypothesis_effect_unit text,
  add column if not exists hypothesis_value_per_year numeric,
  add column if not exists hypothesis_basis text,
  add column if not exists viability_floor numeric,
  add column if not exists viability_floor_basis text;

create index if not exists idx_business_cases_dev_case
  on business_cases(organization_id, development_case_id)
  where development_case_id is not null;

-- The hypothesis is machine-readable or absent — spend, effect, value and
-- basis together (I.4: "spending $28M will eliminate 120 h/year downtime
-- worth $11M/year", with where that belief comes from).
alter table public.business_cases
  drop constraint if exists business_cases_hypothesis_complete;
alter table public.business_cases
  add constraint business_cases_hypothesis_complete check (
    (hypothesis_spend is null and hypothesis_effect is null
     and hypothesis_effect_quantity is null and hypothesis_effect_unit is null
     and hypothesis_value_per_year is null and hypothesis_basis is null)
    or (hypothesis_spend is not null and hypothesis_spend >= 0
        and hypothesis_effect is not null and btrim(hypothesis_effect) <> ''
        and hypothesis_value_per_year is not null
        and hypothesis_basis is not null and btrim(hypothesis_basis) <> '')
  );

-- A floor without its basis is a number somebody liked (the asset_economics
-- stated-basis pattern, applied to the tripwire itself).
alter table public.business_cases
  drop constraint if exists business_cases_viability_floor_basis;
alter table public.business_cases
  add constraint business_cases_viability_floor_basis check (
    viability_floor is null
    or (viability_floor_basis is not null and btrim(viability_floor_basis) <> '')
  );

-- ---------------------------------------------------------------------------
-- 3. Options gain contingency-with-basis (I.11 dimension 9).
-- ---------------------------------------------------------------------------
alter table public.business_case_options
  add column if not exists contingency numeric,
  add column if not exists contingency_basis text;

alter table public.business_case_options
  drop constraint if exists business_case_options_contingency_basis;
alter table public.business_case_options
  add constraint business_case_options_contingency_basis check (
    contingency is null
    or (contingency >= 0 and contingency_basis is not null and btrim(contingency_basis) <> '')
  );

-- Cash-flow shape is a SCHEMA invariant, for every writer (the D9.10
-- unbypassable-CHECK idiom). The RPC refuses with a friendly message; this
-- constraint makes the refusal unbypassable — a flow missing its period or
-- amount key is exactly the undated/unquantified flow the guard exists to
-- refuse, and jsonb_typeof(NULL-from-absent-key) is SQL NULL, so every
-- element test COALESCEs before comparing. A malformed flow reaching the
-- kernel renders NaN on the business-case screen: the fabricated-number
-- class this slice exists to kill.
create or replace function public.cash_flows_well_formed(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(p) cf
       where jsonb_typeof(cf) <> 'object'
          or coalesce(jsonb_typeof(cf->'period'), 'missing') <> 'number'
          or coalesce(jsonb_typeof(cf->'amount'), 'missing') <> 'number'
          or (cf->>'period')::numeric < 0
          or (cf->>'period')::numeric <> floor((cf->>'period')::numeric));
$$;

alter table public.business_case_options
  drop constraint if exists business_case_options_cash_flows_shape;
alter table public.business_case_options
  add constraint business_case_options_cash_flows_shape
  check (cash_flows_well_formed(cash_flows));

-- ---------------------------------------------------------------------------
-- 4. The numeric leg's write path. financial_assumptions had NO customer
--    write path (demo-seed only, E9.01's named gap); this is it. Each write
--    is a NEW VERSION row (unique on org+key+effective_from — the series is
--    the record; nothing is overwritten). Source is mandatory at the schema
--    and re-stated here so the refusal names the rule.
--
--    THE D2.07 SWEEP RUNS HERE, because this is the only door the numeric
--    leg moves through: every ACTIVE assumption whose predicate names this
--    key is evaluated against the new value; the observation lands on its
--    indicator (the one machinery); a violation invalidates the assumption
--    through the one core, which reopens dependents (D3.30) — and, once
--    20261115090500 lands, evaluates business-case collapse (D2.03).
-- ---------------------------------------------------------------------------
create or replace function public.upsert_financial_assumption(
  p_key text,
  p_label text,
  p_value numeric,
  p_unit text default null,
  p_source text default null,
  p_kind text default 'general',
  p_effective_from date default null,
  p_review_due date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id bigint;
  v_effective date := coalesce(p_effective_from, current_date);
  a risk_assumptions%rowtype;
  v_violated boolean;
  v_state text;
  v_observations int := 0;
  v_violations jsonb := '[]'::jsonb;
  v_result jsonb;
  i risk_indicators%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'recording a financial assumption requires a planning, engineering or governance role');
  end if;
  if coalesce(length(btrim(p_key)), 0) < 2 then
    return jsonb_build_object('error', 'an assumption series needs a key (2 characters minimum)');
  end if;
  if coalesce(length(btrim(p_label)), 0) < 3 then
    return jsonb_build_object('error', 'an assumption needs a label (3 characters minimum)');
  end if;
  if p_value is null then
    return jsonb_build_object('error', 'an assumption version records a value — there is no empty version');
  end if;
  if coalesce(length(btrim(p_source)), 0) < 5 then
    return jsonb_build_object('error',
      'an assumption with no source is a number somebody liked — state where this value comes from (5 characters minimum)');
  end if;
  if p_kind not in ('general','escalation','fx','commodity_price','discount_rate','funding') then
    return jsonb_build_object('error',
      'kind must be one of general, escalation, fx, commodity_price, discount_rate, funding');
  end if;
  if exists (select 1 from financial_assumptions
             where organization_id = v_org and assumption_key = btrim(p_key)
               and effective_from = v_effective) then
    return jsonb_build_object('error',
      format('a version of "%s" effective %s already exists — the series is the record; record a new effective date rather than overwriting', btrim(p_key), v_effective));
  end if;

  insert into financial_assumptions
    (organization_id, assumption_key, label, value, unit, source, kind,
     effective_from, review_due)
  values
    (v_org, btrim(p_key), btrim(p_label), p_value,
     nullif(btrim(coalesce(p_unit,'')), ''), btrim(p_source), p_kind,
     v_effective, p_review_due)
  returning id into v_id;

  -- The deterministic sweep (D2.07). Only versions effective TODAY or
  -- earlier move the operative value; a future-dated version is recorded
  -- and left for its day (its evaluation happens when a then-current write
  -- occurs — the sweep always compares the LATEST OPERATIVE version).
  if v_effective <= current_date then
    for a in
      select * from risk_assumptions
      where organization_id = v_org and status = 'active'
        and threshold_parameter = btrim(p_key)
    loop
      -- Operative value: the latest effective version as of today (this
      -- write may or may not be it).
      declare
        v_operative numeric;
      begin
        select value into v_operative from financial_assumptions
        where organization_id = v_org and assumption_key = btrim(p_key)
          and effective_from <= current_date
        order by effective_from desc, id desc limit 1;

        v_violated := case a.threshold_comparator
          when '>=' then v_operative < a.threshold_value
          when '>'  then v_operative <= a.threshold_value
          when '<=' then v_operative > a.threshold_value
          when '<'  then v_operative >= a.threshold_value
        end;
        v_state := case when v_violated then 'critical' else 'normal' end;

        select * into i from risk_indicators
        where assumption_id = a.id and organization_id = v_org and active;
        if found then
          insert into risk_indicator_observations
            (organization_id, indicator_id, value, state, data_quality,
             source_reference, observed_at)
          values
            (v_org, i.id, v_operative, v_state, 'good',
             format('financial_assumptions:%s@%s (source: %s)', btrim(p_key), v_effective, btrim(p_source)),
             now());
          update risk_indicators
          set previous_value = current_value, current_value = v_operative,
              current_state = v_state, observed_at = now()
          where id = i.id;
          v_observations := v_observations + 1;
        end if;

        if v_violated then
          v_result := public.apply_assumption_invalidation(
            a.id,
            format('Business case threshold violated (spec I.12): %s — recorded %s = %s %s against the declared envelope %s %s %s. Source of the new value: %s.',
                   a.statement, btrim(p_key), v_operative, coalesce(a.threshold_unit,''),
                   btrim(p_key), a.threshold_comparator, a.threshold_value, btrim(p_source)),
            'system:threshold');
          v_violations := v_violations || jsonb_build_object(
            'assumption_id', a.id,
            'statement', a.statement,
            'development_case_id', a.development_case_id,
            'observed', v_operative,
            'declared', a.threshold_comparator || ' ' || a.threshold_value::text,
            'invalidation', v_result);
        end if;
      end;
    end loop;
  end if;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'financial_assumption', coalesce(v_role, 'unknown'),
    jsonb_build_object('assumption_key', btrim(p_key), 'version_id', v_id,
      'value', p_value, 'kind', p_kind, 'effective_from', v_effective,
      'source', btrim(p_source),
      'threshold_observations', v_observations,
      'threshold_violations', jsonb_array_length(v_violations)));

  return jsonb_build_object('version_id', v_id, 'assumption_key', btrim(p_key),
    'effective_from', v_effective,
    'threshold_observations', v_observations,
    'threshold_violations', v_violations);
end
$$;

revoke all on function public.upsert_financial_assumption(text, text, numeric, text, text, text, date, date) from public, anon;
grant execute on function public.upsert_financial_assumption(text, text, numeric, text, text, text, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. A business case on a development case. The discount rate arrives WITH
--    its source or not at all — the refusal the retractions taught.
-- ---------------------------------------------------------------------------
create or replace function public.create_case_business_case(
  p_case_id uuid,
  p_case_ref text,
  p_title text,
  p_driver text,
  p_discount_rate numeric,
  p_discount_rate_source text,
  p_currency text default 'USD'
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
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'recording a business case requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'a business case is not recordable on a ' || c.status || ' case');
  end if;
  if coalesce(length(btrim(p_case_ref)), 0) < 3 then
    return jsonb_build_object('error', 'a business case needs a reference (3 characters minimum)');
  end if;
  if coalesce(length(btrim(p_title)), 0) < 3 then
    return jsonb_build_object('error', 'a business case needs a title (3 characters minimum)');
  end if;
  if p_driver not in ('safety','regulatory','reliability','capacity','cost_reduction','obsolescence','environmental') then
    return jsonb_build_object('error',
      'driver must be one of safety, regulatory, reliability, capacity, cost_reduction, obsolescence, environmental');
  end if;
  if p_discount_rate is null or p_discount_rate < 0 or p_discount_rate >= 1 then
    return jsonb_build_object('error', 'discount_rate is a fraction in [0, 1) — 0.08 for 8%');
  end if;
  if coalesce(length(btrim(p_discount_rate_source)), 0) < 5 then
    return jsonb_build_object('error',
      'a discount rate nobody owns quietly decides every long-dated decision — state where this rate comes from (5 characters minimum)');
  end if;
  if exists (select 1 from business_cases
             where organization_id = v_org and case_ref = btrim(p_case_ref)) then
    return jsonb_build_object('error',
      'that case reference already exists in this organization — references are unique');
  end if;

  insert into business_cases
    (organization_id, development_case_id, case_ref, title, driver,
     discount_rate, discount_rate_source, currency, status)
  values
    (v_org, c.id, btrim(p_case_ref), btrim(p_title), p_driver,
     p_discount_rate, btrim(p_discount_rate_source),
     coalesce(nullif(btrim(p_currency), ''), 'USD'), 'draft')
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_business_case', coalesce(v_role, 'unknown'),
    jsonb_build_object('business_case_id', v_id, 'case_id', c.id,
      'case_ref', btrim(p_case_ref), 'driver', p_driver,
      'discount_rate', p_discount_rate, 'discount_rate_source', btrim(p_discount_rate_source)));

  return jsonb_build_object('business_case_id', v_id, 'case_ref', btrim(p_case_ref),
    'development_case_id', c.id);
end
$$;

revoke all on function public.create_case_business_case(uuid, text, text, text, numeric, text, text) from public, anon;
grant execute on function public.create_case_business_case(uuid, text, text, text, numeric, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The ValueHypothesis (D2.01): spend → effect → value, machine-readable,
--    all-or-refuse, basis mandatory.
-- ---------------------------------------------------------------------------
create or replace function public.record_value_hypothesis(
  p_business_case_id bigint,
  p_spend numeric,
  p_effect text,
  p_effect_quantity numeric,
  p_effect_unit text,
  p_value_per_year numeric,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  bc business_cases%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'recording a value hypothesis requires a planning, engineering or governance role');
  end if;
  select * into bc from business_cases where id = p_business_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'business case not found in this organization');
  end if;
  if p_spend is null or p_spend < 0 then
    return jsonb_build_object('error', 'the hypothesis states the spend (a non-negative amount)');
  end if;
  if coalesce(length(btrim(p_effect)), 0) < 10 then
    return jsonb_build_object('error',
      'the hypothesis states its mechanism — what the spend eliminates or creates (10 characters minimum)');
  end if;
  if p_effect_quantity is not null and coalesce(length(btrim(p_effect_unit)), 0) < 1 then
    return jsonb_build_object('error', 'a quantified effect states its unit (h/year, t/day, ...)');
  end if;
  if p_value_per_year is null then
    return jsonb_build_object('error', 'the hypothesis states the value per year the effect is worth');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error',
      'a hypothesis without its basis is a slogan — state where the spend, effect and value figures come from (20 characters minimum)');
  end if;

  update business_cases
  set hypothesis_spend = p_spend,
      hypothesis_effect = btrim(p_effect),
      hypothesis_effect_quantity = p_effect_quantity,
      hypothesis_effect_unit = nullif(btrim(coalesce(p_effect_unit,'')), ''),
      hypothesis_value_per_year = p_value_per_year,
      hypothesis_basis = btrim(p_basis)
  where id = bc.id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'value_hypothesis', coalesce(v_role, 'unknown'),
    jsonb_build_object('business_case_id', bc.id, 'case_ref', bc.case_ref,
      'spend', p_spend, 'effect', btrim(p_effect),
      'effect_quantity', p_effect_quantity, 'effect_unit', p_effect_unit,
      'value_per_year', p_value_per_year, 'basis', btrim(p_basis)));

  return jsonb_build_object('business_case_id', bc.id, 'hypothesis',
    jsonb_build_object('spend', p_spend, 'effect', btrim(p_effect),
      'effectQuantity', p_effect_quantity, 'effectUnit', p_effect_unit,
      'valuePerYear', p_value_per_year, 'basis', btrim(p_basis)));
end
$$;

revoke all on function public.record_value_hypothesis(bigint, numeric, text, numeric, text, numeric, text) from public, anon;
grant execute on function public.record_value_hypothesis(bigint, numeric, text, numeric, text, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The viability floor (D2.03's declared tripwire). Revisable with a
--    basis; never silently removable — a case that "no longer has" a floor
--    is a case whose tripwire someone disarmed, and that is a revision with
--    a reason, not a deletion.
-- ---------------------------------------------------------------------------
create or replace function public.set_case_viability_floor(
  p_business_case_id bigint,
  p_floor numeric,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  bc business_cases%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    if coalesce(v_role, '') = 'ai_admin' then
      return jsonb_build_object('error',
        'declaring what makes a case no longer viable is a human accountability act — the AI-operator identity cannot set it');
    end if;
    return jsonb_build_object('error', 'setting a viability floor requires a governance or engineering role');
  end if;
  select * into bc from business_cases where id = p_business_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'business case not found in this organization');
  end if;
  if p_floor is null then
    return jsonb_build_object('error',
      'a viability floor is revised, never removed — the tripwire below which sanction must be reconsidered does not silently disappear; state the new floor with its basis');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error',
      'a floor without its basis is a number somebody liked — state why viability ends at this value (20 characters minimum)');
  end if;

  update business_cases
  set viability_floor = p_floor, viability_floor_basis = btrim(p_basis)
  where id = bc.id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_viability_floor', coalesce(v_role, 'unknown'),
    jsonb_build_object('business_case_id', bc.id, 'case_ref', bc.case_ref,
      'previous_floor', bc.viability_floor, 'floor', p_floor, 'basis', btrim(p_basis)));

  return jsonb_build_object('business_case_id', bc.id, 'viability_floor', p_floor);
end
$$;

revoke all on function public.set_case_viability_floor(bigint, numeric, text) from public, anon;
grant execute on function public.set_case_viability_floor(bigint, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Options with dated cash flows (the input NPV/IRR/payback stand on).
--    Structural validation only — arithmetic stays in the kernel.
-- ---------------------------------------------------------------------------
create or replace function public.add_business_case_option(
  p_business_case_id bigint,
  p_label text,
  p_life_periods int,
  p_cash_flows jsonb,
  p_benefit_probability numeric default null,
  p_is_do_nothing boolean default false,
  p_notes text default null,
  p_contingency numeric default null,
  p_contingency_basis text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  bc business_cases%rowtype;
  v_id bigint;
  cf jsonb;
  v_count int := 0;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'adding a business case option requires a planning, engineering or governance role');
  end if;
  select * into bc from business_cases where id = p_business_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'business case not found in this organization');
  end if;
  if coalesce(length(btrim(p_label)), 0) < 2 then
    return jsonb_build_object('error', 'an option needs a label (2 characters minimum)');
  end if;
  if p_life_periods is null or p_life_periods < 1 then
    return jsonb_build_object('error', 'life_periods states the option''s service life (at least 1 period)');
  end if;
  if p_cash_flows is null or jsonb_typeof(p_cash_flows) <> 'array' then
    return jsonb_build_object('error',
      'cash_flows is a json array of {period, amount} — NPV, IRR and payback are computed from dated flows or not at all');
  end if;
  for cf in select * from jsonb_array_elements(p_cash_flows) loop
    -- COALESCE before comparing: an ABSENT key makes jsonb_typeof return SQL
    -- NULL, and NULL <> 'number' is NULL, not TRUE — without the coalesce an
    -- undated/unquantified flow slips this guard and renders NaN downstream.
    if jsonb_typeof(cf) <> 'object'
       or coalesce(jsonb_typeof(cf->'period'), 'missing') <> 'number'
       or coalesce(jsonb_typeof(cf->'amount'), 'missing') <> 'number' then
      return jsonb_build_object('error',
        'each cash flow is {period: integer >= 0, amount: number} — an undated or unquantified flow cannot be discounted');
    end if;
    if (cf->>'period')::numeric <> floor((cf->>'period')::numeric)
       or (cf->>'period')::numeric < 0 then
      return jsonb_build_object('error', 'cash flow periods are whole numbers, 0 (today) or later');
    end if;
    if (cf->>'period')::numeric > p_life_periods then
      return jsonb_build_object('error',
        format('cash flow at period %s falls outside the option''s %s-period life', cf->>'period', p_life_periods));
    end if;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    return jsonb_build_object('error',
      'an option with no cash flows values nothing — state at least one dated flow (negative for cost, positive for benefit)');
  end if;
  if p_benefit_probability is not null
     and (p_benefit_probability <= 0 or p_benefit_probability > 1) then
    return jsonb_build_object('error', 'benefit_probability is a fraction in (0, 1]');
  end if;
  if p_contingency is not null then
    if p_contingency < 0 then
      return jsonb_build_object('error', 'contingency cannot be negative');
    end if;
    if coalesce(length(btrim(p_contingency_basis)), 0) < 10 then
      return jsonb_build_object('error',
        'contingency states its basis — what uncertainty it covers and how it was sized (10 characters minimum)');
    end if;
  end if;
  if p_is_do_nothing and exists (
    select 1 from business_case_options
    where case_id = bc.id and is_do_nothing) then
    return jsonb_build_object('error', 'this business case already carries a do-nothing option');
  end if;

  insert into business_case_options
    (organization_id, case_id, label, life_periods, cash_flows,
     benefit_probability, is_do_nothing, notes, contingency, contingency_basis)
  values
    (v_org, bc.id, btrim(p_label), p_life_periods, p_cash_flows,
     p_benefit_probability, coalesce(p_is_do_nothing, false),
     nullif(btrim(coalesce(p_notes,'')), ''),
     p_contingency, nullif(btrim(coalesce(p_contingency_basis,'')), ''))
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_business_case_option', coalesce(v_role, 'unknown'),
    jsonb_build_object('business_case_id', bc.id, 'option_id', v_id,
      'label', btrim(p_label), 'life_periods', p_life_periods,
      'flows', v_count, 'is_do_nothing', coalesce(p_is_do_nothing, false)));

  return jsonb_build_object('option_id', v_id, 'business_case_id', bc.id,
    'flows_recorded', v_count);
end
$$;

revoke all on function public.add_business_case_option(bigint, text, int, jsonb, numeric, boolean, text, numeric, text) from public, anon;
grant execute on function public.add_business_case_option(bigint, text, int, jsonb, numeric, boolean, text, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. The thirteen-dimension read (D2.04). One query; per dimension either
--    the recorded inputs or a NAMED refusal the page renders verbatim. The
--    kernel (src/lib/value) computes NPV/IRR/payback client-side from the
--    'cashFlow' inputs exactly when 'npvInputsComplete' — the same
--    completeness this function reports; nothing here invents a number.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_finance_model(p_case_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  bc business_cases%rowtype;
  v_options jsonb;
  v_option_count int;
  v_flows_present boolean;
  v_assumptions jsonb;
  v_thresholds jsonb;
  v_funding jsonb;
  v_budget jsonb;
  v_missing text[] := '{}';
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select * into bc from business_cases
  where organization_id = v_org and development_case_id = c.id
  order by created_at desc, id desc limit 1;
  if not found then
    return jsonb_build_object(
      'caseId', c.id,
      'available', false,
      'reason', 'No business case is recorded on this development case. The finance model reads recorded inputs; record the business case first (create_case_business_case).');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'label', o.label, 'lifePeriods', o.life_periods,
      'cashFlows', o.cash_flows, 'benefitProbability', o.benefit_probability,
      'isDoNothing', o.is_do_nothing, 'notes', o.notes,
      'contingency', o.contingency, 'contingencyBasis', o.contingency_basis)
      order by o.is_do_nothing desc, o.label), '[]'::jsonb),
    count(*),
    bool_or(jsonb_array_length(o.cash_flows) > 0)
  into v_options, v_option_count, v_flows_present
  from business_case_options o where o.case_id = bc.id;

  if bc.discount_rate_source is null or btrim(bc.discount_rate_source) = '' then
    v_missing := array_append(v_missing,
      'NPV unavailable: no discount rate source recorded — a rate nobody owns is refused as an input (set it on the business case)');
  end if;
  if v_option_count = 0 then
    v_missing := array_append(v_missing,
      'NPV, IRR and payback unavailable: no options with dated cash flows are recorded (add_business_case_option)');
  elsif not coalesce(v_flows_present, false) then
    v_missing := array_append(v_missing,
      'NPV, IRR and payback unavailable: the recorded options carry no dated cash flows');
  end if;

  -- Current version per key, typed by kind.
  select coalesce(jsonb_agg(row_obj order by kind, key), '[]'::jsonb)
  into v_assumptions
  from (
    select distinct on (fa.assumption_key)
      fa.assumption_key as key, fa.kind as kind,
      jsonb_build_object(
        'key', fa.assumption_key, 'label', fa.label, 'value', fa.value,
        'unit', fa.unit, 'source', fa.source, 'kind', fa.kind,
        'effectiveFrom', fa.effective_from, 'reviewDue', fa.review_due) as row_obj
    from financial_assumptions fa
    where fa.organization_id = v_org and fa.effective_from <= current_date
    order by fa.assumption_key, fa.effective_from desc, fa.id desc
  ) latest;

  -- Declared viability thresholds on this case (D2.06) with the margin to
  -- the operative value — subtraction, not modelling.
  select coalesce(jsonb_agg(jsonb_build_object(
      'assumptionId', a.id,
      'statement', a.statement,
      'status', a.status,
      'parameter', a.threshold_parameter,
      'comparator', a.threshold_comparator,
      'threshold', a.threshold_value,
      'unit', a.threshold_unit,
      'operativeValue', op.value,
      'margin', case when op.value is null then null else
        case when a.threshold_comparator in ('>=','>')
          then op.value - a.threshold_value
          else a.threshold_value - op.value end end,
      'operativeSource', op.source)
      order by a.created_at), '[]'::jsonb)
  into v_thresholds
  from risk_assumptions a
  left join lateral (
    select fa.value, fa.source from financial_assumptions fa
    where fa.organization_id = v_org and fa.assumption_key = a.threshold_parameter
      and fa.effective_from <= current_date
    order by fa.effective_from desc, fa.id desc limit 1
  ) op on true
  where a.organization_id = v_org and a.development_case_id = c.id
    and a.threshold_parameter is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
      'label', cp.label, 'planYear', cp.plan_year, 'cost', cp.cost,
      'benefitPresentValue', cp.benefit_present_value,
      'mandatory', cp.mandatory, 'mandatoryBasis', cp.mandatory_basis)
      order by cp.plan_year, cp.label), '[]'::jsonb)
  into v_funding
  from capital_plan_items cp
  where cp.organization_id = v_org and cp.case_id = bc.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'budgetYear', bl.budget_year, 'category', bl.category,
      'budgeted', bl.budgeted, 'committed', bl.committed, 'actual', bl.actual,
      'forecast', bl.forecast, 'forecastBasis', bl.forecast_basis)
      order by bl.budget_year, bl.category), '[]'::jsonb)
  into v_budget
  from budget_lines bl
  where bl.organization_id = v_org and bl.category = 'capital'
    and bl.budget_year >= extract(year from current_date)::int - 1;

  return jsonb_build_object(
    'caseId', c.id,
    'available', true,
    'businessCase', jsonb_build_object(
      'id', bc.id, 'caseRef', bc.case_ref, 'title', bc.title,
      'driver', bc.driver, 'status', bc.status, 'currency', bc.currency,
      'discountRate', bc.discount_rate,
      'discountRateSource', bc.discount_rate_source,
      'decidedAt', bc.decided_at),
    'hypothesis', case when bc.hypothesis_spend is null then null else jsonb_build_object(
      'spend', bc.hypothesis_spend,
      'effect', bc.hypothesis_effect,
      'effectQuantity', bc.hypothesis_effect_quantity,
      'effectUnit', bc.hypothesis_effect_unit,
      'valuePerYear', bc.hypothesis_value_per_year,
      'basis', bc.hypothesis_basis) end,
    'viability', case when bc.viability_floor is null then null else jsonb_build_object(
      'floor', bc.viability_floor,
      'basis', bc.viability_floor_basis) end,
    'options', v_options,
    'npvInputsComplete', (v_missing = '{}'),
    'refusals', to_jsonb(v_missing),
    'economicAssumptions', v_assumptions,
    'viabilityThresholds', v_thresholds,
    'fundingConstraints', jsonb_build_object(
      'capitalPlanItems', v_funding,
      'capitalBudgetLines', v_budget));
end
$$;

revoke all on function public.get_case_finance_model(uuid) from public, anon;
grant execute on function public.get_case_finance_model(uuid) to authenticated;

notify pgrst, 'reload schema';

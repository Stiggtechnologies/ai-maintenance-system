-- ============================================================================
-- E9.04 — maintenance budget forecasting on the canonical budget_lines row.
--
-- budget_lines was select-only. The only rows came from the demo seed. This
-- migration adds the customer write path and computes the forecast from
-- recorded spend. It does not add a finance store, a currency column, or an
-- external-system client. Canonical budget lines still have no currency, so
-- this file never sums one category into another and never totals the table.
--
-- WHAT IS MEASURED.
--   labour    — completed work_orders.labor_hours times the tenant's operative
--               financial_assumptions row keyed labour_rate. No rate, no
--               conversion. actual_hours is not a substitute.
--   materials — work_order_materials.qty_issued times materials.unit_cost_usd.
--               The current issued quantity is used once. Issue events are
--               only a date when the work order has no completion time.
--   contract, capital, overhaul, other — no currency-safe actual stream.
--               Contract cost has no currency. The downtime-cost proxy is not
--               maintenance spend and is not read. No external financial
--               system is read. The forecast is refused.
--
-- THE ARITHMETIC is maintenance_budget_forecast_math, the same limits as
-- src/lib/value/budgetForecast.ts. A closed year equals its recorded actual.
-- A year with no recorded month is not stored as zero. Extrapolation needs
-- three months in the trailing 18-month window. A trend is fitted only at
-- four. The projection is the sum of each remaining month, and a negative
-- month is floored at zero. Committed money is not added to the forecast.
--
-- GOVERNANCE. A named planner, maintenance manager, reliability engineer,
-- executive or administrator with a verified factor and an AAL2 session
-- records the budget. The AI operator and external roles are refused. The
-- forecast does not approve the budget, authorize expenditure, release work,
-- accept risk or return equipment to service. Direct writes, including
-- service-role writes, are refused unless the marker below is set by these
-- functions. Deletes and truncates are refused outright.
-- ============================================================================

alter table public.budget_lines
  add column if not exists budget_basis text,
  add column if not exists committed_basis text,
  add column if not exists actual_measured boolean not null default false,
  add column if not exists version integer not null default 1,
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

alter table public.budget_lines
  drop constraint if exists budget_lines_amounts_finite;
alter table public.budget_lines
  add constraint budget_lines_amounts_finite check (
    budgeted > '-Infinity'::numeric and budgeted < 'Infinity'::numeric and budgeted >= 0
    and committed > '-Infinity'::numeric and committed < 'Infinity'::numeric and committed >= 0
    and actual > '-Infinity'::numeric and actual < 'Infinity'::numeric and actual >= 0
    and (forecast is null or (
      forecast > '-Infinity'::numeric and forecast < 'Infinity'::numeric and forecast >= 0
    ))
  );

alter table public.budget_lines
  drop constraint if exists budget_lines_forecast_basis;
alter table public.budget_lines
  add constraint budget_lines_forecast_basis check (
    forecast is null
    or (forecast_basis is not null and length(btrim(forecast_basis)) >= 20)
  );

comment on column public.budget_lines.actual_measured is
  'True only after refresh_maintenance_budget_forecast or record_maintenance_budget_line has summed a recorded actual. A false row may still hold a demo or previously entered figure; that figure is not a measurement.';

comment on table public.budget_lines is
  'E9 plan-level maintenance budget. Customer writes go through record_maintenance_budget_line and refresh_maintenance_budget_forecast. The forecast is category-scoped and does not authorize expenditure.';

-- ---------------------------------------------------------------------------
-- The arithmetic. Immutable: it sees only the months the caller already
-- summed. The trailing window is the anchor month minus 17 months, the same
-- span as interval '17 months' and 18 months inclusive.
-- ---------------------------------------------------------------------------
create or replace function public.maintenance_budget_forecast_math(
  p_year int,
  p_months jsonb
) returns jsonb
language plpgsql
immutable
set search_path = public
as $math$
declare
  v_item jsonb;
  v_period text;
  v_actual numeric;
  v_index int;
  v_seen text[] := '{}';
  v_periods text[] := '{}';
  v_actuals numeric[] := '{}';
  v_indexes int[] := '{}';
  v_year int;
  v_month int;
  v_n int;
  v_i int;
  v_k int;
  v_tmp_period text;
  v_tmp_actual numeric;
  v_tmp_index int;
  v_anchor text;
  v_anchor_year int;
  v_anchor_month int;
  v_anchor_index int;
  v_window_start int;
  v_hist numeric[] := '{}';
  v_year_sum numeric := 0;
  v_year_count int := 0;
  v_hist_n int;
  v_mean_x numeric;
  v_mean_y numeric;
  v_num numeric := 0;
  v_den numeric := 0;
  v_slope numeric;
  v_trend boolean := false;
  v_remaining int;
  v_raw numeric;
  v_projection numeric := 0;
  v_note text;
  v_actual_out numeric;
  v_measured boolean;
begin
  if p_year is null or p_year < 1990 or p_year > 2100 then
    return jsonb_build_object('error', 'The budget year must be a calendar year from 1990 through 2100.');
  end if;
  if coalesce(jsonb_typeof(p_months), '') <> 'array' then
    return jsonb_build_object('error', 'History must be a list of months.');
  end if;

  for v_item in select value from jsonb_array_elements(p_months) loop
    v_period := v_item->>'period';
    if v_period is null or v_period !~ '^\d{4}-\d{2}$' then
      return jsonb_build_object('error', 'Every history month needs a YYYY-MM period and a finite actual.');
    end if;
    v_year := substring(v_period, 1, 4)::int;
    v_month := substring(v_period, 6, 2)::int;
    if v_month < 1 or v_month > 12 then
      return jsonb_build_object('error', 'Every history month needs a YYYY-MM period and a finite actual.');
    end if;
    begin
      v_actual := (v_item->>'actual')::numeric;
    exception when others then
      return jsonb_build_object('error', 'Every history month needs a YYYY-MM period and a finite actual.');
    end;
    if v_actual is null
       or not (v_actual > '-Infinity'::numeric and v_actual < 'Infinity'::numeric) then
      return jsonb_build_object('error', 'Every history month needs a YYYY-MM period and a finite actual.');
    end if;
    if v_period = any (v_seen) then
      return jsonb_build_object('error', format(
        'Month %s is repeated. Duplicate months would double the actual, so the forecast is refused.',
        v_period));
    end if;
    v_seen := v_seen || v_period;
    v_index := v_year * 12 + (v_month - 1);
    v_periods := v_periods || v_period;
    v_actuals := v_actuals || v_actual;
    v_indexes := v_indexes || v_index;
  end loop;

  v_n := coalesce(array_length(v_periods, 1), 0);
  if v_n = 0 then
    return jsonb_build_object(
      'forecastable', false, 'forecast', null, 'actualInYear', null,
      'actualMeasured', false, 'monthsUsed', 0, 'trendFitted', false,
      'slopePerMonth', null, 'remainingMonths', 0, 'anchorPeriod', null,
      'closedYear', false, 'extrapolatedYear', false,
      'reason', 'No costed months are recorded. There is nothing to sum and nothing to extrapolate.');
  end if;

  for v_i in 1..v_n loop
    for v_k in 1..v_n - 1 loop
      if v_indexes[v_k] > v_indexes[v_k + 1] then
        v_tmp_index := v_indexes[v_k];
        v_indexes[v_k] := v_indexes[v_k + 1];
        v_indexes[v_k + 1] := v_tmp_index;
        v_tmp_actual := v_actuals[v_k];
        v_actuals[v_k] := v_actuals[v_k + 1];
        v_actuals[v_k + 1] := v_tmp_actual;
        v_tmp_period := v_periods[v_k];
        v_periods[v_k] := v_periods[v_k + 1];
        v_periods[v_k + 1] := v_tmp_period;
      end if;
    end loop;
  end loop;

  v_anchor := v_periods[v_n];
  v_anchor_index := v_indexes[v_n];
  v_anchor_year := substring(v_anchor, 1, 4)::int;
  v_anchor_month := substring(v_anchor, 6, 2)::int;
  -- interval '17 months' back from the anchor, inclusive of the anchor.
  v_window_start := v_anchor_index - 17;

  for v_i in 1..v_n loop
    if v_indexes[v_i] >= v_window_start then
      v_hist := v_hist || v_actuals[v_i];
    end if;
    if substring(v_periods[v_i], 1, 4)::int = p_year then
      v_year_sum := v_year_sum + v_actuals[v_i];
      v_year_count := v_year_count + 1;
    end if;
  end loop;
  v_hist_n := coalesce(array_length(v_hist, 1), 0);
  v_measured := v_year_count > 0;
  v_actual_out := case when v_measured then round(v_year_sum, 2) else null end;

  if p_year < v_anchor_year or (p_year = v_anchor_year and v_anchor_month = 12) then
    if not v_measured then
      return jsonb_build_object(
        'forecastable', false, 'forecast', null, 'actualInYear', null,
        'actualMeasured', false, 'monthsUsed', v_hist_n, 'trendFitted', false,
        'slopePerMonth', null, 'remainingMonths', 0, 'anchorPeriod', v_anchor,
        'closedYear', false, 'extrapolatedYear', false,
        'reason', format(
          'Absence is not zero. No costed month was recorded in %s, and a missing year is not stored as a zero actual.',
          p_year));
    end if;
    return jsonb_build_object(
      'forecastable', true, 'forecast', v_actual_out, 'actualInYear', v_actual_out,
      'actualMeasured', true, 'monthsUsed', v_hist_n, 'trendFitted', false,
      'slopePerMonth', null, 'remainingMonths', 0, 'anchorPeriod', v_anchor,
      'closedYear', true, 'extrapolatedYear', false,
      'reason', 'Forecast at completion equals the summed recorded actual. No extrapolation.');
  end if;

  if p_year > v_anchor_year + 1 then
    return jsonb_build_object(
      'forecastable', false, 'forecast', null, 'actualInYear', v_actual_out,
      'actualMeasured', v_measured, 'monthsUsed', v_hist_n, 'trendFitted', false,
      'slopePerMonth', null, 'remainingMonths', 0, 'anchorPeriod', v_anchor,
      'closedYear', false, 'extrapolatedYear', false,
      'reason', format(
        'The latest recorded month is %s. A forecast for %s is more than one year past the latest recorded month and is refused.',
        v_anchor, p_year));
  end if;

  if v_hist_n < 3 then
    return jsonb_build_object(
      'forecastable', false, 'forecast', null, 'actualInYear', v_actual_out,
      'actualMeasured', v_measured, 'monthsUsed', v_hist_n, 'trendFitted', false,
      'slopePerMonth', null, 'remainingMonths', 0, 'anchorPeriod', v_anchor,
      'closedYear', false, 'extrapolatedYear', false,
      'reason', format(
        '%s costed month(s) are below the 3 months required to extrapolate. The recorded actual is reported and the forecast is refused.',
        v_hist_n));
  end if;

  v_mean_y := 0;
  for v_i in 1..v_hist_n loop
    v_mean_y := v_mean_y + v_hist[v_i];
  end loop;
  v_mean_y := v_mean_y / v_hist_n;
  v_mean_x := (v_hist_n - 1)::numeric / 2;
  v_trend := v_hist_n >= 4;
  if v_trend then
    for v_i in 1..v_hist_n loop
      v_num := v_num + ((v_i - 1)::numeric - v_mean_x) * (v_hist[v_i] - v_mean_y);
      v_den := v_den + ((v_i - 1)::numeric - v_mean_x) ^ 2;
    end loop;
    v_slope := case when v_den = 0 then 0 else v_num / v_den end;
  else
    v_slope := null;
  end if;

  v_remaining := case when p_year = v_anchor_year then 12 - v_anchor_month else 12 end;
  for v_k in 1..v_remaining loop
    if v_slope is null then
      v_raw := v_mean_y;
    else
      v_raw := v_mean_y + v_slope * (v_mean_x + v_k);
    end if;
    if v_raw < 0 then
      v_raw := 0;
    end if;
    v_projection := v_projection + v_raw;
  end loop;

  if v_trend then
    v_note := 'A trend was fitted.';
  else
    v_note := format(
      '%s months is below the 4 required to fit a trend, so each remaining month is the mean and no direction is claimed.',
      v_hist_n);
  end if;

  if p_year = v_anchor_year + 1 then
    return jsonb_build_object(
      'forecastable', true,
      'forecast', round(v_projection, 2),
      'actualInYear', null,
      'actualMeasured', false,
      'monthsUsed', v_hist_n,
      'trendFitted', v_trend,
      'slopePerMonth', v_slope,
      'remainingMonths', 12,
      'anchorPeriod', v_anchor,
      'closedYear', false,
      'extrapolatedYear', true,
      'reason', format(
        'No recorded actual in %s. The figure extrapolates the next 12 months from %s recorded month(s) and is not a forecast at completion of spend already recorded in that year. %s',
        p_year, v_hist_n, v_note));
  end if;

  return jsonb_build_object(
    'forecastable', true,
    'forecast', round(v_year_sum + v_projection, 2),
    'actualInYear', v_actual_out,
    'actualMeasured', v_measured,
    'monthsUsed', v_hist_n,
    'trendFitted', v_trend,
    'slopePerMonth', v_slope,
    'remainingMonths', v_remaining,
    'anchorPeriod', v_anchor,
    'closedYear', false,
    'extrapolatedYear', false,
    'reason', format(
      'Forecast at completion adds %s remaining month(s) to the recorded actual. %s',
      v_remaining, v_note));
end
$math$;

revoke all on function public.maintenance_budget_forecast_math(int, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Turn recorded rows into the monthly series, then call the arithmetic.
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_maintenance_budget_forecast(
  p_year int,
  p_category text,
  p_site uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $eval$
declare
  v_org uuid := public.app_current_org();
  v_category text := btrim(coalesce(p_category, ''));
  v_months jsonb := '[]'::jsonb;
  v_math jsonb;
  v_rate numeric;
  v_unit text;
  v_source text;
  v_effective date;
  v_currency text;
  v_uncosted bigint := 0;
  v_undated bigint := 0;
  v_invalid bigint := 0;
  v_missing_site bigint := 0;
  v_basis text;
  v_rec record;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  if public.app_current_role_is_external() then
    return jsonb_build_object('error', 'an external role cannot read the maintenance budget forecast');
  end if;
  if p_year is null or p_year < 1990 or p_year > 2100 then
    return jsonb_build_object('error', 'The budget year must be a calendar year from 1990 through 2100.');
  end if;
  if v_category not in ('labour', 'materials', 'contract', 'capital', 'overhaul', 'other') then
    return jsonb_build_object('error', 'category must be labour, materials, contract, capital, overhaul or other');
  end if;
  if p_site is not null and not exists (
    select 1 from public.sites s
    where s.id = p_site and s.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'site is outside the active tenant');
  end if;

  if v_category = 'labour' then
    select fa.value, fa.unit, fa.source, fa.effective_from
      into v_rate, v_unit, v_source, v_effective
    from public.financial_assumptions fa
    where fa.organization_id = v_org
      and fa.assumption_key = 'labour_rate'
      and fa.effective_from <= current_date
    order by fa.effective_from desc, fa.id desc
    limit 1;
    if not found
       or v_rate is null
       or not (v_rate > 0 and v_rate < 'Infinity'::numeric)
       or v_unit is null
       or v_unit !~ '^[A-Z]{3}/h$' then
      return jsonb_build_object(
        'category', 'labour', 'currency', null, 'forecastable', false,
        'forecast', null, 'actualInYear', null, 'actualMeasured', false,
        'rate', case when v_rate is null then null else jsonb_build_object(
          'value', v_rate, 'unit', v_unit, 'source', v_source, 'effectiveFrom', v_effective)
        end,
        'basis', 'No usable operative labour-rate assumption is recorded. Hours are not converted, because a missing rate is not zero and a default rate is not invented. The unit must be a three-letter currency per hour, for example USD/h. No external financial system was read.',
        'reason', 'No usable operative labour-rate assumption is recorded.');
    end if;
    v_currency := substring(v_unit, 1, 3);
    select
      count(*) filter (
        where w.completed_at is not null and w.labor_hours is null),
      count(*) filter (
        where w.completed_at is null
          and w.labor_hours is not null
          and w.labor_hours >= 0
          and w.labor_hours < 'Infinity'::numeric),
      count(*) filter (
        where w.labor_hours is not null
          and not (w.labor_hours >= 0 and w.labor_hours < 'Infinity'::numeric)),
      count(*) filter (
        where p_site is not null
          and w.site_id is null
          and w.completed_at is not null
          and w.labor_hours is not null
          and w.labor_hours >= 0
          and w.labor_hours < 'Infinity'::numeric)
      into v_uncosted, v_undated, v_invalid, v_missing_site
    from work_orders w
    where w.organization_id = v_org
      and (
        p_site is null
        or w.site_id = p_site
        or (
          w.site_id is null
          and w.labor_hours is not null
          and w.completed_at is not null
        )
      );
    for v_rec in
      select to_char(date_trunc('month', w.completed_at), 'YYYY-MM') as period,
             sum(w.labor_hours) * v_rate as actual
      from work_orders w
      where w.organization_id = v_org
        and w.completed_at is not null
        and w.labor_hours is not null
        and w.labor_hours >= 0
        and w.labor_hours < 'Infinity'::numeric
        and (p_site is null or w.site_id = p_site)
      group by 1
      order by 1
    loop
      v_months := v_months || jsonb_build_array(
        jsonb_build_object('period', v_rec.period, 'actual', v_rec.actual));
    end loop;
    v_math := public.maintenance_budget_forecast_math(p_year, v_months);
    if v_math ? 'error' then
      return v_math;
    end if;
    v_basis := format(
      'Labour actuals are completed work-order labour hours multiplied by the operative labour-rate assumption of %s %s effective %s. Source: %s. %s Excluded rows — uncosted hours: %s; undated hours: %s; invalid hours: %s; hours with no site on a site-scoped forecast: %s. Committed amounts are not added. This does not authorize expenditure. No external financial system was read, and the downtime-cost proxy was not used.',
      v_rate, v_unit, v_effective, v_source, v_math->>'reason',
      v_uncosted, v_undated, v_invalid, v_missing_site);
    return v_math || jsonb_build_object(
      'category', 'labour', 'currency', v_currency, 'basis', v_basis,
      'rate', jsonb_build_object(
        'value', v_rate, 'unit', v_unit, 'source', v_source,
        'effectiveFrom', v_effective),
      'excluded', jsonb_build_object(
        'uncosted', v_uncosted, 'undated', v_undated,
        'invalid', v_invalid, 'missingSite', v_missing_site));
  end if;

  if v_category = 'materials' then
    select
      count(*) filter (
        where wm.qty_issued > 0
          and m.unit_cost_usd is null
          and m.is_template = false),
      count(*) filter (
        where wm.qty_issued > 0 and m.is_template = true),
      count(*) filter (
        where wm.qty_issued > 0
          and m.is_template = false
          and m.unit_cost_usd is not null
          and m.unit_cost_usd >= 0
          and m.unit_cost_usd < 'Infinity'::numeric
          and w.completed_at is null
          and issued.occurred_at is null),
      count(*) filter (
        where wm.qty_issued > 0
          and m.unit_cost_usd is not null
          and not (m.unit_cost_usd >= 0 and m.unit_cost_usd < 'Infinity'::numeric))
      into v_uncosted, v_undated, v_missing_site, v_invalid
    from public.work_order_materials wm
    join public.materials m
      on m.id = wm.material_id and m.organization_id = v_org
    join work_orders w
      on w.id = wm.work_order_id and w.organization_id = v_org
    left join lateral (
      select max(e.occurred_at) as occurred_at
      from public.material_events e
      where e.organization_id = v_org
        and e.work_order_material_id = wm.id
        and e.event_type = 'issued'
    ) issued on true
    where wm.organization_id = v_org
      and (p_site is null or w.site_id = p_site);
    -- v_undated above counted templates. Keep the names honest in the basis.
    for v_rec in
      select to_char(
               date_trunc('month', coalesce(w.completed_at, issued.occurred_at)),
               'YYYY-MM') as period,
             sum(wm.qty_issued * m.unit_cost_usd) as actual
      from public.work_order_materials wm
      join public.materials m
        on m.id = wm.material_id and m.organization_id = v_org
      join work_orders w
        on w.id = wm.work_order_id and w.organization_id = v_org
      left join lateral (
        select max(e.occurred_at) as occurred_at
        from public.material_events e
        where e.organization_id = v_org
          and e.work_order_material_id = wm.id
          and e.event_type = 'issued'
      ) issued on true
      where wm.organization_id = v_org
        and m.is_template = false
        and m.unit_cost_usd is not null
        and m.unit_cost_usd >= 0
        and m.unit_cost_usd < 'Infinity'::numeric
        and wm.qty_issued > 0
        and coalesce(w.completed_at, issued.occurred_at) is not null
        and (p_site is null or w.site_id = p_site)
      group by 1
      order by 1
    loop
      v_months := v_months || jsonb_build_array(
        jsonb_build_object('period', v_rec.period, 'actual', v_rec.actual));
    end loop;
    v_math := public.maintenance_budget_forecast_math(p_year, v_months);
    if v_math ? 'error' then
      return v_math;
    end if;
    v_basis := format(
      'Material actuals are the current issued quantity on each work-order material line multiplied by materials.unit_cost_usd. Currency is USD because that column is denominated in USD; no conversion is applied. Issue events are not summed, because the line stores the current quantity rather than an additive history, and an issue event supplies a date only when the work order has no completion time. %s Excluded lines — no unit cost: %s; template catalogue: %s; undated: %s; invalid unit cost: %s. Committed amounts are not added. This does not authorize expenditure. No external financial system was read, and the downtime-cost proxy was not used.',
      v_math->>'reason', v_uncosted, v_undated, v_missing_site, v_invalid);
    return v_math || jsonb_build_object(
      'category', 'materials', 'currency', 'USD', 'basis', v_basis,
      'excluded', jsonb_build_object(
        'uncosted', v_uncosted, 'template', v_undated,
        'undated', v_missing_site, 'invalid', v_invalid));
  end if;

  return jsonb_build_object(
    'category', v_category, 'currency', null, 'forecastable', false,
    'forecast', null, 'actualInYear', null, 'actualMeasured', false,
    'monthsUsed', 0, 'trendFitted', false, 'slopePerMonth', null,
    'remainingMonths', 0, 'anchorPeriod', null, 'closedYear', false,
    'extrapolatedYear', false,
    'reason', 'This category has no currency-safe recorded actual stream.',
    'basis', 'This category has no currency-safe recorded actual stream. Contract performance cost has no currency. Capital, overhaul and other have no maintenance-spend source on the work order or the material line. The downtime-cost proxy is not maintenance spend and is not used. No external financial system was read. The forecast is refused rather than filled.');
end
$eval$;

revoke all on function public.evaluate_maintenance_budget_forecast(int, text, uuid)
  from public, anon, authenticated;

create or replace function public.get_maintenance_budget_workspace(
  p_year int,
  p_site uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $get$
declare
  v_org uuid := public.app_current_org();
  v_category text;
  v_previews jsonb := '[]'::jsonb;
  v_preview jsonb;
  v_lines jsonb;
  v_sites jsonb;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  if public.app_current_role_is_external() then
    return jsonb_build_object('error', 'an external role cannot read the maintenance budget forecast');
  end if;
  if p_year is null or p_year < 1990 or p_year > 2100 then
    return jsonb_build_object('error', 'The budget year must be a calendar year from 1990 through 2100.');
  end if;
  if p_site is not null and not exists (
    select 1 from public.sites s
    where s.id = p_site and s.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'site is outside the active tenant');
  end if;

  foreach v_category in array array['labour', 'materials', 'contract', 'capital', 'overhaul', 'other'] loop
    v_preview := public.evaluate_maintenance_budget_forecast(p_year, v_category, p_site);
    v_previews := v_previews || jsonb_build_array(v_preview);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name) order by s.name), '[]'::jsonb)
    into v_sites
  from public.sites s
  where s.organization_id = v_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', bl.id,
    'budgetYear', bl.budget_year,
    'category', bl.category,
    'siteId', bl.site_id,
    'siteName', s.name,
    'budgeted', bl.budgeted,
    'budgetBasis', bl.budget_basis,
    'committed', bl.committed,
    'committedBasis', bl.committed_basis,
    'actual', bl.actual,
    'actualMeasured', bl.actual_measured,
    'forecast', bl.forecast,
    'forecastBasis', bl.forecast_basis,
    'version', bl.version
  ) order by bl.category, s.name nulls first, bl.id), '[]'::jsonb)
    into v_lines
  from public.budget_lines bl
  left join public.sites s
    on s.id = bl.site_id and s.organization_id = v_org
  where bl.organization_id = v_org
    and bl.budget_year = p_year;

  return jsonb_build_object(
    'year', p_year,
    'siteId', p_site,
    'sites', v_sites,
    'lines', v_lines,
    'previews', v_previews,
    'authority', jsonb_build_object(
      'expenditureAuthorized', false,
      'budgetApproved', false,
      'workAuthorized', false,
      'externalFinanceSystemRead', false,
      'note', 'A named human records the budget. The forecast is computed from recorded labour hours and issued material quantities. It does not authorize expenditure, approve the budget, release work, or read an external financial system.'
    ));
end
$get$;

revoke all on function public.get_maintenance_budget_workspace(int, uuid)
  from public, anon;
grant execute on function public.get_maintenance_budget_workspace(int, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Direct writes never pass. The marker is transaction-local and is set only
-- by the two customer functions below.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_budget_line_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $guard$
declare
  v_marker text := coalesce(current_setting('app.budget_line_write', true), '');
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'budget lines are the maintenance-budget record. Truncating them erases every tenant in one statement.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    raise exception
      'A budget line is revised, not deleted. Deleting it would erase the budget and the forecast with no successor.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_marker <> 'granted' then
    raise exception
      'A budget line is written through record_maintenance_budget_line or refresh_maintenance_budget_forecast, which require a named role, an AAL2 session and an audit row. A direct change is refused.'
      using errcode = 'insufficient_privilege';
  end if;
  if auth.uid() is not null
     and new.organization_id is distinct from public.app_current_org() then
    raise exception
      'budget line organization does not match the session'
      using errcode = 'insufficient_privilege';
  end if;
  if new.site_id is not null and not exists (
    select 1 from public.sites s
    where s.id = new.site_id and s.organization_id = new.organization_id
  ) then
    raise exception
      'budget line site is outside its organization'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.budget_year is distinct from old.budget_year
    or new.category is distinct from old.category
    or new.site_id is distinct from old.site_id
  ) then
    raise exception
      'budget line identity is immutable; record a new line for a different year, category or site'
      using errcode = 'check_violation';
  end if;
  return new;
end
$guard$;

revoke all on function public.enforce_budget_line_write()
  from public, anon, authenticated;

drop trigger if exists trg_budget_line_write on public.budget_lines;
create trigger trg_budget_line_write
  before insert or update or delete on public.budget_lines
  for each row execute function public.enforce_budget_line_write();

drop trigger if exists trg_budget_line_no_truncate on public.budget_lines;
create trigger trg_budget_line_no_truncate
  before truncate on public.budget_lines
  for each statement execute function public.enforce_budget_line_write();

revoke insert, update, delete, truncate on table public.budget_lines
  from public, anon, authenticated;
revoke truncate on table public.budget_lines from service_role;

create or replace function public.record_maintenance_budget_line(
  p_year int,
  p_category text,
  p_site uuid,
  p_budgeted numeric,
  p_budget_basis text,
  p_committed numeric,
  p_committed_basis text,
  p_expected_version int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $record$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text := public.app_current_role();
  v_category text := btrim(coalesce(p_category, ''));
  v_budget_basis text := btrim(coalesce(p_budget_basis, ''));
  v_committed numeric := coalesce(p_committed, 0);
  v_committed_basis text := nullif(btrim(coalesce(p_committed_basis, '')), '');
  v_existing public.budget_lines%rowtype;
  v_eval jsonb;
  v_measured boolean;
  v_actual numeric;
  v_forecast numeric;
  v_basis text;
  v_id bigint;
  v_version int;
  v_before jsonb;
  v_after jsonb;
begin
  if v_org is null or v_actor is null
     or public.app_current_role_is_external()
     or v_role not in (
       'admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner'
     ) then
    return jsonb_build_object('error',
      'Recording a maintenance budget requires a named planner, maintenance, engineering, executive or administrator in this tenant. The AI operator and external roles are refused.');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal() <> 'aal2' then
    return jsonb_build_object('error',
      'Recording a maintenance budget requires a verified factor and an AAL2 session.');
  end if;
  if p_year is null or p_year < 1990 or p_year > 2100 then
    return jsonb_build_object('error', 'The budget year must be a calendar year from 1990 through 2100.');
  end if;
  if v_category not in ('labour', 'materials', 'contract', 'capital', 'overhaul', 'other') then
    return jsonb_build_object('error', 'category must be labour, materials, contract, capital, overhaul or other');
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    return jsonb_build_object('error', 'Expected version cannot be negative.');
  end if;
  if p_budgeted is null
     or not (p_budgeted >= 0 and p_budgeted < 'Infinity'::numeric)
     or p_budgeted > 1000000000000000 then
    return jsonb_build_object('error', 'Budgeted amount must be a finite, non-negative, bounded number.');
  end if;
  if length(v_budget_basis) < 20 or length(v_budget_basis) > 4000 then
    return jsonb_build_object('error', 'The budget needs a 20 to 4000 character basis saying where the figure comes from.');
  end if;
  if not (v_committed >= 0 and v_committed < 'Infinity'::numeric)
     or v_committed > 1000000000000000 then
    return jsonb_build_object('error', 'Committed amount must be a finite, non-negative, bounded number.');
  end if;
  if v_committed > 0 and (v_committed_basis is null or length(v_committed_basis) < 20 or length(v_committed_basis) > 4000) then
    return jsonb_build_object('error', 'A commitment above zero needs a 20 to 4000 character basis.');
  end if;
  if p_site is not null and not exists (
    select 1 from public.sites s
    where s.id = p_site and s.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'site is outside the active tenant');
  end if;

  v_eval := public.evaluate_maintenance_budget_forecast(p_year, v_category, p_site);
  if v_eval ? 'error' then
    return v_eval;
  end if;
  v_measured := coalesce((v_eval->>'actualMeasured')::boolean, false);
  v_actual := case when v_measured then (v_eval->>'actualInYear')::numeric else 0 end;
  v_forecast := (v_eval->>'forecast')::numeric;
  v_basis := v_eval->>'basis';

  select * into v_existing
  from public.budget_lines
  where organization_id = v_org
    and budget_year = p_year
    and category = v_category
    and site_id is not distinct from p_site
  for update;

  if found then
    if v_existing.version <> p_expected_version then
      return jsonb_build_object('error',
        'The budget line changed after it was loaded. Refresh before recording again.');
    end if;
    v_before := jsonb_build_object(
      'id', v_existing.id, 'version', v_existing.version,
      'budgeted', v_existing.budgeted, 'budgetBasis', v_existing.budget_basis,
      'committed', v_existing.committed, 'committedBasis', v_existing.committed_basis,
      'actual', v_existing.actual, 'actualMeasured', v_existing.actual_measured,
      'forecast', v_existing.forecast, 'forecastBasis', v_existing.forecast_basis);
    v_version := v_existing.version + 1;
    perform set_config('app.budget_line_write', 'granted', true);
    update public.budget_lines set
      budgeted = p_budgeted,
      budget_basis = v_budget_basis,
      committed = v_committed,
      committed_basis = v_committed_basis,
      actual = case when v_measured then v_actual else actual end,
      actual_measured = case when v_measured then true else actual_measured end,
      forecast = v_forecast,
      forecast_basis = v_basis,
      version = v_version,
      updated_by = v_actor,
      updated_at = now()
    where id = v_existing.id and organization_id = v_org;
    v_id := v_existing.id;
  else
    if p_expected_version <> 0 then
      return jsonb_build_object('error', 'No budget line exists for that expected version.');
    end if;
    v_version := 1;
    v_before := null;
    perform set_config('app.budget_line_write', 'granted', true);
    insert into public.budget_lines (
      organization_id, site_id, budget_year, category,
      budgeted, committed, actual, forecast, forecast_basis,
      budget_basis, committed_basis, actual_measured, version,
      updated_by, updated_at
    ) values (
      v_org, p_site, p_year, v_category,
      p_budgeted, v_committed,
      case when v_measured then v_actual else 0 end,
      v_forecast, v_basis,
      v_budget_basis, v_committed_basis, v_measured, v_version,
      v_actor, now()
    ) returning id into v_id;
  end if;

  v_after := jsonb_build_object(
    'id', v_id, 'version', v_version, 'year', p_year, 'category', v_category,
    'siteId', p_site, 'budgeted', p_budgeted, 'budgetBasis', v_budget_basis,
    'committed', v_committed, 'committedBasis', v_committed_basis,
    'actual', case when v_measured then v_actual else null end,
    'actualMeasured', v_measured, 'forecast', v_forecast, 'forecastBasis', v_basis);
  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'maintenance_budget_line', v_role,
    jsonb_build_object(
      'action', 'record', 'budgetLineId', v_id, 'actorId', v_actor,
      'expenditureAuthorized', false, 'budgetApproved', false,
      'workAuthorized', false, 'externalFinanceSystemRead', false),
    v_before, v_after);

  return jsonb_build_object(
    'budgetLineId', v_id, 'version', v_version,
    'forecastable', coalesce((v_eval->>'forecastable')::boolean, false),
    'forecast', v_forecast,
    'actualInYear', v_eval->'actualInYear',
    'actualMeasured', v_measured,
    'currency', v_eval->'currency',
    'basis', v_basis,
    'expenditureAuthorized', false,
    'budgetApproved', false,
    'workAuthorized', false,
    'externalFinanceSystemRead', false);
exception
  when unique_violation then
    return jsonb_build_object('error',
      'A budget line for that year, category and site already exists. Refresh and revise it by version.');
end
$record$;

revoke all on function public.record_maintenance_budget_line(
  int, text, uuid, numeric, text, numeric, text, int)
  from public, anon, service_role;
grant execute on function public.record_maintenance_budget_line(
  int, text, uuid, numeric, text, numeric, text, int)
  to authenticated;

create or replace function public.refresh_maintenance_budget_forecast(
  p_year int,
  p_category text,
  p_site uuid,
  p_expected_version int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $refresh$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text := public.app_current_role();
  v_category text := btrim(coalesce(p_category, ''));
  v_existing public.budget_lines%rowtype;
  v_eval jsonb;
  v_measured boolean;
  v_actual numeric;
  v_forecast numeric;
  v_basis text;
  v_version int;
  v_before jsonb;
  v_after jsonb;
begin
  if v_org is null or v_actor is null
     or public.app_current_role_is_external()
     or v_role not in (
       'admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner'
     ) then
    return jsonb_build_object('error',
      'Refreshing a maintenance-budget forecast requires a named planner, maintenance, engineering, executive or administrator in this tenant. The AI operator and external roles are refused.');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal() <> 'aal2' then
    return jsonb_build_object('error',
      'Refreshing a maintenance-budget forecast requires a verified factor and an AAL2 session.');
  end if;
  if p_year is null or p_year < 1990 or p_year > 2100 then
    return jsonb_build_object('error', 'The budget year must be a calendar year from 1990 through 2100.');
  end if;
  if v_category not in ('labour', 'materials', 'contract', 'capital', 'overhaul', 'other') then
    return jsonb_build_object('error', 'category must be labour, materials, contract, capital, overhaul or other');
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    return jsonb_build_object('error', 'Refresh addresses an existing budget line by its current version.');
  end if;

  v_eval := public.evaluate_maintenance_budget_forecast(p_year, v_category, p_site);
  if v_eval ? 'error' then
    return v_eval;
  end if;
  v_measured := coalesce((v_eval->>'actualMeasured')::boolean, false);
  v_actual := (v_eval->>'actualInYear')::numeric;
  v_forecast := (v_eval->>'forecast')::numeric;
  v_basis := v_eval->>'basis';

  select * into v_existing
  from public.budget_lines
  where organization_id = v_org
    and budget_year = p_year
    and category = v_category
    and site_id is not distinct from p_site
  for update;
  if not found then
    return jsonb_build_object('error',
      'Record the budget line before refreshing its forecast. A forecast is not stored without a budget.');
  end if;
  if v_existing.version <> p_expected_version then
    return jsonb_build_object('error',
      'The budget line changed after it was loaded. Refresh before trying again.');
  end if;

  v_before := jsonb_build_object(
    'id', v_existing.id, 'version', v_existing.version,
    'actual', v_existing.actual, 'actualMeasured', v_existing.actual_measured,
    'forecast', v_existing.forecast, 'forecastBasis', v_existing.forecast_basis);
  v_version := v_existing.version + 1;
  perform set_config('app.budget_line_write', 'granted', true);
  update public.budget_lines set
    actual = case when v_measured then v_actual else actual end,
    actual_measured = case when v_measured then true else actual_measured end,
    forecast = v_forecast,
    forecast_basis = v_basis,
    version = v_version,
    updated_by = v_actor,
    updated_at = now()
  where id = v_existing.id and organization_id = v_org;

  v_after := jsonb_build_object(
    'id', v_existing.id, 'version', v_version,
    'actual', case when v_measured then v_actual else v_existing.actual end,
    'actualMeasured', case when v_measured then true else v_existing.actual_measured end,
    'forecast', v_forecast, 'forecastBasis', v_basis);
  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'maintenance_budget_forecast', v_role,
    jsonb_build_object(
      'action', 'refresh', 'budgetLineId', v_existing.id, 'actorId', v_actor,
      'expenditureAuthorized', false, 'budgetApproved', false,
      'workAuthorized', false, 'externalFinanceSystemRead', false),
    v_before, v_after);

  return jsonb_build_object(
    'budgetLineId', v_existing.id, 'version', v_version,
    'forecastable', coalesce((v_eval->>'forecastable')::boolean, false),
    'forecast', v_forecast,
    'actualInYear', v_eval->'actualInYear',
    'actualMeasured', v_measured,
    'currency', v_eval->'currency',
    'basis', v_basis,
    'expenditureAuthorized', false,
    'budgetApproved', false,
    'workAuthorized', false,
    'externalFinanceSystemRead', false);
end
$refresh$;

revoke all on function public.refresh_maintenance_budget_forecast(int, text, uuid, int)
  from public, anon, service_role;
grant execute on function public.refresh_maintenance_budget_forecast(int, text, uuid, int)
  to authenticated;

comment on function public.record_maintenance_budget_line(int, text, uuid, numeric, text, numeric, text, int) is
  'E9.04: named-human budget line on canonical budget_lines, with a forecast computed from recorded labour hours or issued material cost. Does not authorize expenditure.';
comment on function public.refresh_maintenance_budget_forecast(int, text, uuid, int) is
  'E9.04: recompute actual and forecast for an existing budget line from recorded spend. Does not change the budgeted amount and does not authorize expenditure.';

notify pgrst, 'reload schema';

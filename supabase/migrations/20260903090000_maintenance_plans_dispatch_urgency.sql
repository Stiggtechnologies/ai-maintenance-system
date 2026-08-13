-- ============================================================================
-- The two measurements the work-health family could not make honestly (C2.02).
--
-- C6.08 and C6.10 have been amber since the family shipped, both for the same
-- reason: the source data did not exist, so each fell back to a proxy that is
-- close enough to look right and wrong in the direction that flatters.
--
-- EMERGENCY WORK was `priority = 'critical' or status = 'critical'`. Priority is
-- a queue position; emergency is a response mode. A planned shutdown task can be
-- critical priority and is not emergency work, and a pump that failed at 03:00
-- can be raised as medium by whoever was on shift. Counting priority as urgency
-- misreads how much of the day is spent reacting — the one thing this KPI exists
-- to expose.
--
-- PM COMPLIANCE was completed preventive work over preventive work RAISED. That
-- denominator measures only what somebody remembered to raise, so a PM never
-- raised at all — an interval silently skipped, the worst outcome — improves the
-- score by shrinking the denominator. A metric that rewards forgetting is worse
-- than no metric.
--
-- Both need maintenance plans and a dispatch-level flag, which is C2.02.
--
-- WHAT THIS DOES NOT DO. It does not invent intervals. A PM interval is an
-- engineering decision owned by the operator, derived from OEM requirement, duty
-- and failure history; inventing one here would be the fabricated authority the
-- knowledge-base trust tiers exist to prevent. Plans are customer master data.
-- Only the demo organization is seeded, and clearly as demonstration data.
--
-- AND IT DOES NOT SILENTLY CHANGE THE NUMBER. An organization with no plans and
-- no dispatch flags keeps the old proxy and is TOLD it is a proxy, in the same
-- `basis` string the panel already renders. A metric that quietly changes meaning
-- between tenants, or between months for one tenant, destroys the trend it
-- exists to show.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Maintenance plans. The PM-due denominator.
-- ---------------------------------------------------------------------------
create table if not exists maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  task_code text,
  task_label text not null,
  -- Calendar intervals fall due on elapsed time; usage intervals fall due on
  -- accumulated running hours and cannot be evaluated without a meter. The basis
  -- is explicit rather than inferred from which column happens to be populated.
  interval_basis text not null default 'calendar_days'
    check (interval_basis in ('calendar_days', 'run_hours')),
  interval_value numeric not null check (interval_value > 0),
  last_performed_at timestamptz,
  -- Where the interval came from. An interval with no stated source is an
  -- assertion, and this platform does not let assertions pass as measurements.
  source text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_maint_plans_org_asset
  on maintenance_plans (organization_id, asset_id) where active;

-- One plan per task per asset. Also gives the demo seed and any customer import
-- a conflict target to be idempotent against, instead of silently duplicating a
-- programme on replay — which would double the PM-due denominator and quietly
-- halve everyone's compliance score.
create unique index if not exists uq_maint_plans_org_asset_task
  on maintenance_plans (organization_id, asset_id, task_code)
  where task_code is not null;

alter table maintenance_plans enable row level security;
drop policy if exists mplan_read on maintenance_plans;
create policy mplan_read on maintenance_plans
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Dispatch-level response class. The emergency flag.
-- ---------------------------------------------------------------------------
-- NULL is meaningful and is the default: it means this work order was raised by
-- a path that never captured a response mode. Defaulting to 'scheduled' would
-- manufacture the answer for every historical row and report 0% emergency work
-- for an organization that has simply never been asked the question.
alter table work_orders
  add column if not exists response_class text;

do $$
begin
  alter table work_orders
    add constraint work_orders_response_class_check
    check (response_class is null
           or response_class in ('emergency', 'urgent', 'scheduled'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_wo_response_class
  on work_orders (organization_id, response_class) where response_class is not null;

-- ---------------------------------------------------------------------------
-- How many PM occurrences FELL DUE in a window, whether or not anyone raised
-- one. Calendar plans only: a run-hours interval needs a meter reading, and
-- guessing utilisation to turn hours into dates would reintroduce exactly the
-- invented denominator this migration removes. Usage plans are reported as
-- unmeasurable rather than estimated.
-- ---------------------------------------------------------------------------
drop function if exists get_pm_due_count(uuid, timestamptz, timestamptz);
create or replace function get_pm_due_count(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (due_count bigint, calendar_plans bigint, usage_plans bigint)
language sql stable security definer set search_path = public as $$
  with plans as (
    select * from maintenance_plans
     where organization_id = p_org and active
  ),
  calendar as (
    -- Interval boundaries crossed inside the window. The plan is a repeating
    -- schedule, so it is projected in BOTH directions from the last completion:
    -- a 30-day route generates about three occurrences per 90 days whatever
    -- date you ask on. Clamping the earlier term to zero instead — counting
    -- only forward from the last completion — makes every recently performed
    -- plan contribute nothing, so the denominator collapses to whatever is
    -- overdue and compliance looks best on the assets being neglected.
    select (
      floor(extract(epoch from (p_to - coalesce(last_performed_at, p_from)))
            / nullif(interval_value * 86400, 0))
      - floor(extract(epoch from (p_from - coalesce(last_performed_at, p_from)))
              / nullif(interval_value * 86400, 0))
    )::bigint as occurrences
    from plans where interval_basis = 'calendar_days'
  )
  select
    coalesce((select sum(occurrences) from calendar), 0)::bigint,
    (select count(*) from plans where interval_basis = 'calendar_days')::bigint,
    (select count(*) from plans where interval_basis = 'run_hours')::bigint;
$$;

grant execute on function get_pm_due_count(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Layer the two real measurements over the existing family, following the same
-- rename-once idiom slice 12 used for planning accuracy, so five hundred lines
-- of arithmetic are not duplicated to change two entries.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.get_work_management_health_base2(int)') is null then
    alter function public.get_work_management_health(int)
      rename to get_work_management_health_base2;
  end if;
end $$;

create or replace function public.get_work_management_health(
  p_window_days int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_days int := greatest(coalesce(p_window_days, 90), 1);
  v_from timestamptz := now() - make_interval(days => v_days);
  v_to timestamptz := now();
  v_base jsonb;
  v_metrics jsonb := '[]'::jsonb;
  m jsonb;
  v_total int;
  v_classified int;
  v_emergency int;
  v_pm_raised int;
  v_pm_done int;
  v_pm_due bigint;
  v_cal_plans bigint;
  v_usage_plans bigint;
  v_emergency_pct numeric;
  v_emergency_basis text;
  v_emergency_measured boolean;
  v_pm_pct numeric;
  v_pm_basis text;
  v_pm_measured boolean;
begin
  v_base := get_work_management_health_base2(p_window_days);
  if v_org is null then
    return v_base;
  end if;

  select
    count(*),
    count(*) filter (where response_class is not null),
    count(*) filter (where response_class = 'emergency'),
    count(*) filter (where work_type = 'preventive'),
    count(*) filter (where work_type = 'preventive' and completed_at is not null)
  into v_total, v_classified, v_emergency, v_pm_raised, v_pm_done
  from work_orders
  where organization_id = v_org
    and coalesce(completed_at, created_at) between v_from and v_to;

  -- EMERGENCY. Measured against the work orders that actually carry a response
  -- class, not the whole population: under partial adoption, dividing by every
  -- work order reports a falling emergency rate that is really a rising
  -- classification rate.
  v_emergency_measured := v_classified > 0;
  if v_emergency_measured then
    v_emergency_pct := round(100.0 * v_emergency / v_classified, 1);
    v_emergency_basis := format(
      'Dispatch response class on %s of %s work orders in the window (%s%% classified).',
      v_classified, v_total,
      case when v_total > 0 then round(100.0 * v_classified / v_total) else 0 end);
  else
    v_emergency_pct := case when v_total > 0 then round(
      100.0 * (select count(*) from work_orders
                where organization_id = v_org
                  and coalesce(completed_at, created_at) between v_from and v_to
                  and (priority = 'critical' or status = 'critical')) / v_total, 1) end;
    v_emergency_basis := 'PROXY — critical priority stands in for emergency response, '
      || 'which over- or under-states reactive work depending on how priority is used '
      || 'here. Set work_orders.response_class to measure it.';
  end if;

  -- PM COMPLIANCE. Against occurrences that fell due, so a skipped PM counts
  -- against the score instead of vanishing from the denominator.
  select due_count, calendar_plans, usage_plans
    into v_pm_due, v_cal_plans, v_usage_plans
  from get_pm_due_count(v_org, v_from, v_to);

  v_pm_measured := v_pm_due > 0;
  if v_pm_measured then
    v_pm_pct := round(100.0 * least(v_pm_done, v_pm_due) / v_pm_due, 1);
    v_pm_basis := format(
      'Completed preventive work against %s occurrence(s) falling due from %s calendar-based '
      || 'plan(s). A PM never raised counts as missed.', v_pm_due, v_cal_plans);
    if v_usage_plans > 0 then
      v_pm_basis := v_pm_basis || format(
        ' %s usage-based plan(s) excluded: a run-hours interval needs a meter reading, and '
        || 'estimating utilisation would invent the denominator.', v_usage_plans);
    end if;
  else
    v_pm_pct := case when v_pm_raised > 0
      then round(100.0 * v_pm_done / v_pm_raised, 1) end;
    v_pm_basis := 'PROXY — completed preventive work as a share of preventive work RAISED. '
      || 'A PM never raised improves this number instead of harming it. Load '
      || 'maintenance_plans to measure compliance against work actually due.';
  end if;

  for m in select * from jsonb_array_elements(v_base->'metrics') loop
    if m->>'key' = 'emergency_work_pct' then
      v_metrics := v_metrics || (m || jsonb_build_object(
        'value', v_emergency_pct, 'basis', v_emergency_basis,
        'measured', v_emergency_measured));
    elsif m->>'key' = 'pm_compliance' then
      v_metrics := v_metrics || (m || jsonb_build_object(
        'value', v_pm_pct, 'basis', v_pm_basis,
        'measured', v_pm_measured));
    else
      v_metrics := v_metrics || m;
    end if;
  end loop;

  return jsonb_set(
    jsonb_set(v_base, '{metrics}', v_metrics),
    '{coverage}',
    jsonb_build_object(
      'responseClassified', v_classified,
      'workOrders', v_total,
      'calendarPlans', v_cal_plans,
      'usagePlans', v_usage_plans,
      'pmOccurrencesDue', v_pm_due));
end
$$;

grant execute on function public.get_work_management_health(int) to authenticated;

notify pgrst, 'reload schema';

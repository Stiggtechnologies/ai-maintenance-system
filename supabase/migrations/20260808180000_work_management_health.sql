-- ============================================================================
-- Work-management health metrics (capability register C6.07–C6.16).
--
-- Spec §6 defines a work-management health family distinct from enterprise
-- outcomes and reliability performance: planned-work %, emergency-work %,
-- schedule compliance, PM compliance, ready backlog, backlog age and risk,
-- break-in work, planning accuracy, waiting-on-material, rework/repeat.
-- The point of the family is balance — it exists so that optimizing one
-- metric (schedule compliance) cannot quietly damage another (emergency work).
--
-- What is computable today, and what is not, is reported EXPLICITLY. Metrics
-- that require data the platform does not yet ingest return `available:false`
-- with the reason, rather than a zero that reads like a good score. That
-- distinction is the whole point: an executive must be able to tell "we are
-- at zero" from "we cannot see this yet".
--
-- Schedule compliance became computable only once the Scheduler shipped
-- released/frozen weekly schedules (C5.04) — it compares completion against
-- the frozen plan, which is the only honest basis for the metric.
--
-- Canonical reuse: work_orders, schedule_options, app_current_org(). Additive,
-- read-only.
-- ============================================================================

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
  v_from timestamptz;
  v_to timestamptz;
  v_total int;
  v_planned int;
  v_emergency int;
  v_pm_due int;
  v_pm_done int;
  v_open int;
  v_open_ready int;
  v_backlog_age numeric;
  v_backlog_risk int;
  v_repeat int;
  v_sched_total int;
  v_sched_done int;
  v_breakin int;
  v_metrics jsonb := '[]'::jsonb;
begin
  -- Window: derived from data by default, for the same reason as the
  -- segmented metrics — a trailing window ending now() silently reports
  -- nothing for a fleet whose history is not current.
  if p_window_days is null then
    select min(completed_at), max(completed_at) into v_from, v_to
    from work_orders
    where organization_id = v_org and completed_at is not null;
    if v_from is null then
      v_from := now() - interval '90 days';
      v_to := now();
    end if;
  else
    v_from := now() - make_interval(days => greatest(p_window_days, 1));
    v_to := now();
  end if;

  select
    count(*),
    count(*) filter (where work_type = 'preventive'),
    count(*) filter (where priority = 'critical' or status = 'critical'),
    count(*) filter (where work_type = 'preventive'),
    count(*) filter (where work_type = 'preventive' and completed_at is not null)
  into v_total, v_planned, v_emergency, v_pm_due, v_pm_done
  from work_orders
  where organization_id = v_org
    and coalesce(completed_at, created_at) between v_from and v_to;

  select
    count(*),
    count(*) filter (where coalesce(parts_ready, false)),
    round(avg(extract(epoch from (now() - created_at)) / 86400.0)::numeric, 1),
    count(*) filter (where priority in ('critical', 'high'))
  into v_open, v_open_ready, v_backlog_age, v_backlog_risk
  from work_orders
  where organization_id = v_org and completed_at is null;

  -- Repeat work: same asset + same coded failure mode completed more than once.
  select count(*) into v_repeat from (
    select asset_id, actual_failure_mode
    from work_orders
    where organization_id = v_org
      and work_type = 'corrective'
      and completed_at between v_from and v_to
      and actual_failure_mode is not null
    group by asset_id, actual_failure_mode
    having count(*) > 1
  ) t;

  -- Schedule compliance against RELEASED (frozen) schedules only.
  select
    coalesce(sum(jsonb_array_length(o.items)), 0),
    coalesce(sum((
      select count(*) from jsonb_array_elements(o.items) it
      join work_orders w on w.id = (it->>'wo_id')::uuid
      where w.completed_at is not null
    )), 0)
  into v_sched_total, v_sched_done
  from schedule_options o
  where o.organization_id = v_org and o.status = 'released';

  -- Break-in: work completed in a released week that was not on that schedule.
  select count(*) into v_breakin
  from work_orders w
  where w.organization_id = v_org
    and w.completed_at is not null
    and exists (
      select 1 from schedule_options o
      where o.organization_id = v_org and o.status = 'released'
        and w.completed_at::date between o.week_start and o.week_start + 6
    )
    and not exists (
      select 1 from schedule_options o2,
        lateral jsonb_array_elements(o2.items) it
      where o2.organization_id = v_org and o2.status = 'released'
        and (it->>'wo_id')::uuid = w.id
    );

  v_metrics := jsonb_build_array(
    jsonb_build_object('key','planned_work_pct','label','Planned-work percentage',
      'register_ref','C6.07','available', v_total > 0,
      'value', case when v_total > 0 then round(100.0 * v_planned / v_total, 1) end,
      'unit','%','basis','Preventive work orders as a share of all work in the window.'),
    jsonb_build_object('key','emergency_work_pct','label','Emergency-work percentage',
      'register_ref','C6.08','available', v_total > 0,
      'value', case when v_total > 0 then round(100.0 * v_emergency / v_total, 1) end,
      'unit','%','basis','Critical-priority work as a share of all work. Emergency is defined by the adopted taxonomy definition (C3.07); this proxies it with critical priority until dispatch-level urgency is ingested.'),
    jsonb_build_object('key','schedule_compliance','label','Schedule compliance',
      'register_ref','C6.09','available', v_sched_total > 0,
      'value', case when v_sched_total > 0 then round(100.0 * v_sched_done / v_sched_total, 1) end,
      'unit','%','basis', case when v_sched_total > 0
        then 'Completed items as a share of items on released (frozen) weekly schedules.'
        else 'No released schedule yet — release a weekly schedule to make this measurable.' end),
    jsonb_build_object('key','pm_compliance','label','PM compliance',
      'register_ref','C6.10','available', v_pm_due > 0,
      'value', case when v_pm_due > 0 then round(100.0 * v_pm_done / v_pm_due, 1) end,
      'unit','%','basis','Completed preventive work as a share of preventive work raised. A true PM-due denominator requires maintenance plans (C2.02).'),
    jsonb_build_object('key','ready_backlog','label','Ready backlog',
      'register_ref','C6.11','available', v_open > 0,
      'value', case when v_open > 0 then round(100.0 * v_open_ready / v_open, 1) end,
      'unit','%','basis','Open work flagged parts-ready. Materials readiness is a flag today; true kitting status requires inventory integration (C2.07).'),
    jsonb_build_object('key','backlog_age','label','Backlog age',
      'register_ref','C6.12','available', v_open > 0,
      'value', v_backlog_age,'unit','days',
      'basis','Mean age of open work orders.'),
    jsonb_build_object('key','backlog_risk','label','Backlog at risk',
      'register_ref','C6.12','available', v_open > 0,
      'value', v_backlog_risk,'unit','WOs',
      'basis','Open work at critical or high priority.'),
    jsonb_build_object('key','break_in_work','label','Break-in work',
      'register_ref','C6.13','available', v_sched_total > 0,
      'value', case when v_sched_total > 0 then v_breakin end,'unit','WOs',
      'basis', case when v_sched_total > 0
        then 'Work completed inside a released week that was not on the frozen schedule.'
        else 'Requires a released weekly schedule to measure against.' end),
    jsonb_build_object('key','planning_accuracy','label','Planning accuracy',
      'register_ref','C6.14','available', false,'value', null,'unit','%',
      'basis','Requires planned versus actual labour hours on job plans. Job plans are not yet modelled (C8.07).'),
    jsonb_build_object('key','waiting_on_material','label','Waiting-on-material time',
      'register_ref','C6.15','available', false,'value', null,'unit','hours',
      'basis','Requires materials reservation and delivery events from an inventory system (C2.07/C2.17).'),
    jsonb_build_object('key','rework_repeat','label','Rework and repeat work',
      'register_ref','C6.16','available', true,'value', v_repeat,'unit','asset-mode pairs',
      'basis','Asset and coded failure-mode pairs with more than one corrective completion in the window.')
  );

  return jsonb_build_object(
    'window_from', v_from, 'window_to', v_to,
    'window_source', case when p_window_days is null then 'derived from data span' else 'caller-specified trailing window' end,
    'work_orders_in_window', v_total,
    'open_work_orders', v_open,
    'metrics', v_metrics);
end
$$;

grant execute on function public.get_work_management_health(int) to authenticated;

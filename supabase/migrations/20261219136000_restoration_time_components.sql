-- C6.18 — MTTR and restoration-time components on canonical Recovery events.
-- Existing updated_at cannot prove execution boundaries because every edit
-- overwrites it. Preserve the two missing event-work facts at the transition.

alter table public.restoration_event_work
  add column if not exists execution_started_at timestamptz,
  add column if not exists execution_completed_at timestamptz;

comment on column public.restoration_event_work.execution_started_at is
  'Immutable server timestamp for the first governed transition into in_progress; never inferred from updated_at.';
comment on column public.restoration_event_work.execution_completed_at is
  'Immutable server timestamp for the governed transition from in_progress to complete.';

-- Historical completion can be recovered from the canonical linked work order.
-- Historical start cannot be reconstructed and deliberately remains NULL.
update public.restoration_event_work ew
set execution_completed_at = w.completed_at
from public.work_orders w
where w.id = ew.work_order_id
  and w.organization_id = ew.organization_id
  and ew.execution_status = 'complete'
  and ew.execution_completed_at is null
  and w.completed_at is not null;

create or replace function public.stamp_restoration_execution_boundaries()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Callers transition state through the existing governed Recovery RPCs;
  -- they cannot submit either clock value, including the first value.
  if new.execution_started_at is distinct from old.execution_started_at then
    raise exception 'execution_started_at is server-controlled and immutable';
  end if;
  if new.execution_completed_at is distinct from old.execution_completed_at then
    raise exception 'execution_completed_at is server-controlled and immutable';
  end if;

  if new.execution_status = 'in_progress'
     and old.execution_status is distinct from 'in_progress' then
    new.execution_started_at := coalesce(old.execution_started_at, now());
  end if;
  if new.execution_status = 'complete'
     and old.execution_status = 'in_progress' then
    -- A historical in-progress row can lack a start boundary. Do not invent
    -- that boundary at completion; its execution component stays unavailable.
    new.execution_started_at := old.execution_started_at;
    new.execution_completed_at := coalesce(old.execution_completed_at, now());
  end if;
  return new;
end
$$;

drop trigger if exists trg_stamp_restoration_execution_boundaries
  on public.restoration_event_work;
create trigger trg_stamp_restoration_execution_boundaries
before update of execution_status, execution_started_at, execution_completed_at
on public.restoration_event_work
for each row execute function public.stamp_restoration_execution_boundaries();

create or replace function public.get_restoration_time_components(
  p_window_days int default 365
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_days int := least(greatest(coalesce(p_window_days, 365), 30), 3650);
  v_result jsonb;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;

  with closed as (
    select e.id, e.event_code, e.asset_id, e.opened_at, e.actual_return_at
    from public.restoration_events e
    where e.organization_id = v_org and e.status = 'closed'
      and e.actual_return_at >= now() - make_interval(days => v_days)
      and e.actual_return_at <= now()
      and e.actual_return_at > e.opened_at
  ), work_bounds as (
    select c.id,
      count(ew.id) filter (where ew.plan_state = 'included')::int as included_work,
      count(ew.id) filter (where ew.plan_state = 'included'
        and ew.execution_started_at is not null
        and ew.execution_completed_at is not null)::int as timestamped_work,
      min(ew.execution_started_at) filter (where ew.plan_state = 'included') as first_work_start,
      max(ew.execution_completed_at) filter (where ew.plan_state = 'included') as last_work_complete
    from closed c left join public.restoration_event_work ew
      on ew.event_id = c.id and ew.organization_id = v_org
    group by c.id
  ), releases as (
    select c.id, min(p.released_at) as first_release_at
    from closed c left join public.restoration_plan_versions p
      on p.event_id = c.id and p.organization_id = v_org
      and p.released_at is not null
    group by c.id
  ), blocker_ranges as (
    select c.id,
      range_agg(tstzrange(greatest(b.started_at, c.opened_at),
        least(coalesce(b.resolved_at, c.actual_return_at), c.actual_return_at), '[)')) as covered
    from closed c join public.restoration_blockers b
      on b.event_id = c.id and b.organization_id = v_org
      and b.started_at < c.actual_return_at
      and coalesce(b.resolved_at, c.actual_return_at) > c.opened_at
    group by c.id
  ), blocker_hours as (
    select br.id,
      sum(extract(epoch from (upper(piece) - lower(piece))) / 3600.0)::numeric as hours
    from blocker_ranges br
    cross join lateral unnest(br.covered) as ranges(piece)
    group by br.id
  ), measured as (
    select c.id, c.event_code, c.asset_id, c.opened_at, c.actual_return_at,
      wb.included_work, wb.timestamped_work,
      round((extract(epoch from (c.actual_return_at-c.opened_at))/3600.0)::numeric, 2) as total_hours,
      case when r.first_release_at between c.opened_at and c.actual_return_at then
        round((extract(epoch from (r.first_release_at-c.opened_at))/3600.0)::numeric, 2) end as planning_hours,
      case when wb.included_work > 0 and wb.timestamped_work = wb.included_work
        and wb.first_work_start >= c.opened_at
        and wb.last_work_complete between wb.first_work_start and c.actual_return_at then
        round((extract(epoch from (wb.last_work_complete-wb.first_work_start))/3600.0)::numeric, 2) end as execution_hours,
      case when wb.included_work > 0 and wb.timestamped_work = wb.included_work
        and wb.last_work_complete <= c.actual_return_at then
        round((extract(epoch from (c.actual_return_at-wb.last_work_complete))/3600.0)::numeric, 2) end as return_to_service_hours,
      round(coalesce(bh.hours,0),2) as blocked_clock_hours
    from closed c join work_bounds wb on wb.id=c.id
    join releases r on r.id=c.id left join blocker_hours bh on bh.id=c.id
  ), summary as (
    select count(*)::int as events,
      round(avg(total_hours),2) as mean_total,
      round(avg(planning_hours),2) as mean_planning,
      round(avg(execution_hours),2) as mean_execution,
      round(avg(return_to_service_hours),2) as mean_rts,
      round(avg(blocked_clock_hours),2) as mean_blocked,
      count(planning_hours)::int as planning_samples,
      count(execution_hours)::int as execution_samples,
      count(return_to_service_hours)::int as rts_samples
    from measured
  )
  select jsonb_build_object(
    'available', s.events > 0, 'windowDays', v_days,
    'closedEvents', s.events, 'mttrHours', s.mean_total,
    'components', jsonb_build_array(
      jsonb_build_object('key','planning_release','label','Open to first released plan','meanHours',s.mean_planning,'sampleCount',s.planning_samples),
      jsonb_build_object('key','execution','label','First governed work start to last completion','meanHours',s.mean_execution,'sampleCount',s.execution_samples),
      jsonb_build_object('key','return_to_service','label','Last work completion to authorized return','meanHours',s.mean_rts,'sampleCount',s.rts_samples),
      jsonb_build_object('key','blocked_clock','label','Unioned elapsed time with an open blocker','meanHours',s.mean_blocked,'sampleCount',s.events)
    ),
    'basis', 'MTTR is mean elapsed time from canonical restoration opening to authorized actual return. Components use first plan release and immutable governed work transitions. Blocker intervals are unioned, so concurrent blockers are not double-counted. Missing historical boundaries remain missing.',
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'eventId',m.id,'eventCode',m.event_code,'assetId',m.asset_id,
      'totalHours',m.total_hours,'planningHours',m.planning_hours,
      'executionHours',m.execution_hours,'returnToServiceHours',m.return_to_service_hours,
      'blockedClockHours',m.blocked_clock_hours,'includedWork',m.included_work,
      'timestampedWork',m.timestamped_work
    ) order by m.actual_return_at desc) from (
      select * from measured order by actual_return_at desc limit 100
    ) m),'[]'::jsonb)
  ) into v_result from summary s;
  return v_result;
end
$$;

revoke all on function public.get_restoration_time_components(int) from public, anon;
grant execute on function public.get_restoration_time_components(int) to authenticated;
notify pgrst, 'reload schema';

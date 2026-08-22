-- ============================================================================
-- Sync Recovery — platform-wide context and weekly-schedule integration
--
-- Recovery coordinates a restoration event across canonical operating-system
-- records. It does not become another owner of work, materials, schedules,
-- equipment custody, approvals, value, or learning.
--
-- This migration adds only read contracts plus a Recovery-aware check inside
-- the existing weekly schedule feasibility function. No operational table is
-- introduced here.
-- ============================================================================

create or replace function public.get_recovery_platform_context(
  p_surface text default 'mission',
  p_work_order_id uuid default null,
  p_asset_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := public.app_current_org();
  v_work_order_context jsonb := null;
  v_active_events jsonb := '[]'::jsonb;
  v_material_impacts jsonb := '[]'::jsonb;
  v_handover_impacts jsonb := '[]'::jsonb;
  v_schedule_commitments jsonb := '[]'::jsonb;
  v_recent_closed jsonb := '[]'::jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if p_surface not in (
    'mission', 'work_order', 'materials', 'scheduling', 'handover',
    'reliability', 'learning', 'value', 'sync'
  ) then
    return jsonb_build_object('error', 'unsupported Recovery context surface');
  end if;

  if p_work_order_id is not null and not exists (
    select 1 from work_orders w
    where w.id = p_work_order_id and w.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'work order not found');
  end if;

  if p_asset_id is not null and not exists (
    select 1 from assets a
    where a.id = p_asset_id and a.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'asset not found');
  end if;

  select coalesce(jsonb_agg(row_data order by opened_at), '[]'::jsonb)
  into v_active_events
  from (
    select
      e.opened_at,
      jsonb_build_object(
        'event_id', e.id,
        'event_code', e.event_code,
        'status', e.status,
        'event_type', e.event_type,
        'asset_id', e.asset_id,
        'asset', a.name,
        'tag', a.tag,
        'criticality', a.criticality,
        'opened_at', e.opened_at,
        'baseline_return_at', e.baseline_return_at,
        'forecast_return_at', e.forecast_return_at,
        'forecast_p80_return_at', e.forecast_p80_return_at,
        'open_blockers', (
          select count(*)
          from restoration_blockers b
          where b.organization_id = v_org
            and b.event_id = e.id
            and b.status = 'open'
        ),
        'critical_open_blockers', (
          select count(*)
          from restoration_blockers b
          where b.organization_id = v_org
            and b.event_id = e.id
            and b.status = 'open'
            and b.severity = 'critical'
        ),
        'latest_plan_version', p.version,
        'latest_plan_status', p.status,
        'critical_path_hours', p.critical_path_hours,
        'p80_critical_path_hours', p.p80_critical_path_hours,
        'projected_hours_recovered', p.projected_hours_recovered,
        'projected_downtime_value_usd', p.projected_downtime_value_usd,
        'value_basis', p.economics_basis
      ) as row_data
    from restoration_events e
    join assets a
      on a.id = e.asset_id
     and a.organization_id = v_org
    left join lateral (
      select rp.*
      from restoration_plan_versions rp
      where rp.organization_id = v_org and rp.event_id = e.id
      order by rp.version desc
      limit 1
    ) p on true
    where e.organization_id = v_org
      and e.status in ('open','planning','approval','released','executing','return_pending')
      and (p_asset_id is null or e.asset_id = p_asset_id)
      and (
        p_work_order_id is null
        or exists (
          select 1 from restoration_event_work ew
          where ew.organization_id = v_org
            and ew.event_id = e.id
            and ew.work_order_id = p_work_order_id
        )
      )
  ) q;

  if p_work_order_id is not null then
    select jsonb_build_object(
      'event_id', e.id,
      'event_code', e.event_code,
      'event_status', e.status,
      'asset_id', e.asset_id,
      'work_order_id', w.id,
      'wo_number', w.wo_number,
      'title', w.title,
      'work_order_status', w.status,
      'plan_state', ew.plan_state,
      'disposition', ew.disposition,
      'sequence_no', ew.sequence_no,
      'concurrency_rule', ew.concurrency_rule,
      'parallel_group', ew.parallel_group,
      'execution_status', ew.execution_status,
      'forecast_return_at', e.forecast_return_at,
      'forecast_p80_return_at', e.forecast_p80_return_at,
      'latest_plan_version', p.version,
      'latest_plan_status', p.status
    )
    into v_work_order_context
    from restoration_event_work ew
    join restoration_events e
      on e.id = ew.event_id
     and e.organization_id = v_org
    join work_orders w
      on w.id = ew.work_order_id
     and w.organization_id = v_org
    left join lateral (
      select rp.*
      from restoration_plan_versions rp
      where rp.organization_id = v_org and rp.event_id = e.id
      order by rp.version desc
      limit 1
    ) p on true
    where ew.organization_id = v_org
      and ew.work_order_id = p_work_order_id
      and e.status in ('open','planning','approval','released','executing','return_pending')
    order by e.opened_at desc
    limit 1;
  end if;

  select coalesce(jsonb_agg(row_data order by event_code, wo_number), '[]'::jsonb)
  into v_material_impacts
  from (
    select
      e.event_code,
      w.wo_number,
      jsonb_build_object(
        'event_id', e.id,
        'event_code', e.event_code,
        'asset_id', e.asset_id,
        'asset', a.name,
        'work_order_id', w.id,
        'wo_number', w.wo_number,
        'title', w.title,
        'short_lines', count(*) filter (where m.status = 'short'),
        'requested_lines', count(*) filter (where m.status = 'requested'),
        'recorded_rts_impact_hours', (
          select round(sum(b.forecast_rts_impact_hours)::numeric, 2)
          from restoration_blockers b
          where b.organization_id = v_org
            and b.event_id = e.id
            and b.event_work_id = ew.id
            and b.status = 'open'
            and b.category = 'parts'
            and b.forecast_rts_impact_hours is not null
        )
      ) as row_data
    from restoration_events e
    join assets a
      on a.id = e.asset_id
     and a.organization_id = v_org
    join restoration_event_work ew
      on ew.event_id = e.id
     and ew.organization_id = v_org
    join work_orders w
      on w.id = ew.work_order_id
     and w.organization_id = v_org
    join work_order_materials m
      on m.work_order_id = w.id
     and m.organization_id = v_org
     and m.status in ('short','requested')
    where e.organization_id = v_org
      and e.status in ('open','planning','approval','released','executing','return_pending')
      and ew.plan_state = 'included'
      and ew.execution_status <> 'complete'
      and (p_asset_id is null or e.asset_id = p_asset_id)
      and (p_work_order_id is null or w.id = p_work_order_id)
    group by e.id, e.event_code, e.asset_id, a.name, ew.id, w.id, w.wo_number, w.title
  ) q;

  select coalesce(jsonb_agg(row_data order by released_at), '[]'::jsonb)
  into v_handover_impacts
  from (
    select
      r.released_at,
      jsonb_build_object(
        'event_id', e.id,
        'event_code', e.event_code,
        'asset_id', e.asset_id,
        'asset', a.name,
        'release_id', r.id,
        'release_status', r.status,
        'released_at', r.released_at,
        'returned_at', r.returned_at,
        'isolation_confirmed', r.isolation_confirmed,
        'awaiting_operations_acceptance', r.status = 'returned'
      ) as row_data
    from restoration_events e
    join assets a
      on a.id = e.asset_id
     and a.organization_id = v_org
    join lateral (
      select er.*
      from equipment_releases er
      where er.organization_id = v_org
        and er.asset_id = e.asset_id
        and er.status in ('released','returned')
      order by er.released_at desc
      limit 1
    ) r on true
    where e.organization_id = v_org
      and e.status in ('open','planning','approval','released','executing','return_pending')
      and (p_asset_id is null or e.asset_id = p_asset_id)
      and (
        p_work_order_id is null
        or exists (
          select 1 from restoration_event_work ew
          where ew.organization_id = v_org
            and ew.event_id = e.id
            and ew.work_order_id = p_work_order_id
        )
      )
  ) q;

  select coalesce(jsonb_agg(row_data order by event_code, sequence_no, wo_number), '[]'::jsonb)
  into v_schedule_commitments
  from (
    select
      e.event_code,
      ew.sequence_no,
      w.wo_number,
      jsonb_build_object(
        'event_id', e.id,
        'event_code', e.event_code,
        'asset_id', e.asset_id,
        'asset', a.name,
        'work_order_id', w.id,
        'wo_number', w.wo_number,
        'title', w.title,
        'priority', w.priority,
        'sequence_no', ew.sequence_no,
        'concurrency_rule', ew.concurrency_rule,
        'parallel_group', ew.parallel_group,
        'execution_status', ew.execution_status,
        'planned_hours', w.planned_hours,
        'estimated_hours', w.estimated_hours,
        'duration_basis', case
          when w.planned_hours is not null and w.planned_hours > 0 then 'work_order_planned_hours'
          when w.estimated_hours is not null and w.estimated_hours > 0 then 'work_order_estimated_hours'
          else 'not_sized'
        end
      ) as row_data
    from restoration_events e
    join assets a
      on a.id = e.asset_id
     and a.organization_id = v_org
    join restoration_event_work ew
      on ew.event_id = e.id
     and ew.organization_id = v_org
    join work_orders w
      on w.id = ew.work_order_id
     and w.organization_id = v_org
    where e.organization_id = v_org
      and e.status in ('open','planning','approval','released','executing','return_pending')
      and ew.plan_state = 'included'
      and ew.execution_status <> 'complete'
      and (p_asset_id is null or e.asset_id = p_asset_id)
      and (p_work_order_id is null or w.id = p_work_order_id)
  ) q;

  select coalesce(jsonb_agg(row_data order by actual_return_at desc), '[]'::jsonb)
  into v_recent_closed
  from (
    select
      e.actual_return_at,
      jsonb_build_object(
        'event_id', e.id,
        'event_code', e.event_code,
        'asset_id', e.asset_id,
        'asset', a.name,
        'opened_at', e.opened_at,
        'actual_return_at', e.actual_return_at,
        'baseline_return_at', e.baseline_return_at,
        'counterfactual_hours_recovered', case
          when e.actual_return_at is not null and e.baseline_return_at is not null
          then round(greatest(0, extract(epoch from (e.baseline_return_at - e.actual_return_at)) / 3600.0)::numeric, 2)
          else null
        end,
        'projected_downtime_value_usd', p.projected_downtime_value_usd,
        'value_status', case
          when p.projected_downtime_value_usd is null then 'not_computable'
          else 'projected_pending_value_verification'
        end
      ) as row_data
    from restoration_events e
    join assets a
      on a.id = e.asset_id
     and a.organization_id = v_org
    left join lateral (
      select rp.*
      from restoration_plan_versions rp
      where rp.organization_id = v_org and rp.event_id = e.id
      order by rp.version desc
      limit 1
    ) p on true
    where e.organization_id = v_org
      and e.status = 'closed'
      and (p_asset_id is null or e.asset_id = p_asset_id)
      and (
        p_work_order_id is null
        or exists (
          select 1 from restoration_event_work ew
          where ew.organization_id = v_org
            and ew.event_id = e.id
            and ew.work_order_id = p_work_order_id
        )
      )
    order by e.actual_return_at desc nulls last
    limit 10
  ) q;

  return jsonb_build_object(
    'surface', p_surface,
    'generated_at', now(),
    'active_events', v_active_events,
    'work_order_context', v_work_order_context,
    'material_impacts', v_material_impacts,
    'handover_impacts', v_handover_impacts,
    'schedule_commitments', v_schedule_commitments,
    'recent_closed_events', v_recent_closed,
    'authority', jsonb_build_object(
      'recovery_owns', 'event orchestration and restoration-plan control',
      'work_orders_own', 'work execution record',
      'materials_own', 'material readiness truth',
      'scheduling_owns', 'weekly resource commitments',
      'handover_owns', 'equipment custody and operations acceptance',
      'approvals_own', 'release authority',
      'value_owns', 'verified benefit',
      'reliability_learning_owns', 'recurrence and improvement learning',
      'sync_owns', 'conversational interpretation and governed interaction'
    )
  );
end
$$;

revoke all on function public.get_recovery_platform_context(text,uuid,uuid) from public, anon;
grant execute on function public.get_recovery_platform_context(text,uuid,uuid) to authenticated;

-- Stable contract for the platform-wide Sync interaction layer. This is a read
-- seam only. Sync may explain or retrieve this evidence; operational actions
-- still call the existing governed Recovery RPCs and retain their human/safety
-- gates.
create or replace function public.get_sync_recovery_context(
  p_asset_id uuid default null,
  p_work_order_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select public.get_recovery_platform_context(
    'sync', p_work_order_id, p_asset_id
  )
$$;

revoke all on function public.get_sync_recovery_context(uuid,uuid) from public, anon;
grant execute on function public.get_sync_recovery_context(uuid,uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Weekly schedule feasibility: Recovery is a real SOFT constraint signal.
--
-- The weekly schedule still owns resource commitments. Recovery still owns the
-- event sequence/concurrency and cannot be overridden by a week plan. Omitted
-- active Recovery work is therefore a warning requiring acknowledgement, not a
-- silent omission and not a second schedule engine.
-- ----------------------------------------------------------------------------
create or replace function public.evaluate_schedule_feasibility(p_option_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  o schedule_options%rowtype;
  v_ids uuid[];
  v_safety int;
  v_authority int;
  v_short int;
  v_unassessed int;
  v_cap_rows int;
  v_labour jsonb;
  v_recovery_total int := 0;
  v_recovery_in_option int := 0;
  v_recovery_omitted int := 0;
  v_blocking int := 0;
  v_warning int := 0;
  v_checks jsonb := '[]'::jsonb;
begin
  select * into o from schedule_options where id = p_option_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'schedule option not found');
  end if;

  select array_agg((it->>'wo_id')::uuid)
  into v_ids
  from jsonb_array_elements(o.items) it
  where it->>'wo_id' is not null;

  if v_ids is null then v_ids := '{}'; end if;

  -- HARD: safety gates
  select count(*) into v_safety
  from recommendation_screenings s
  join recommendations r on r.id = s.recommendation_id
  join work_orders w on w.recommendation_id = r.id
  where w.id = any(v_ids) and s.requires_gatekeeper and s.gatekeeper_attested_at is null;

  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Safety consequence clearance', 'severity', 'blocking',
    'register_ref', 'C1.11',
    'passed', v_safety = 0, 'count', v_safety,
    'detail', case when v_safety = 0
      then 'No scheduled work is awaiting gatekeeper clearance.'
      else format('%s scheduled work order(s) carry an un-cleared safety gate. A schedule cannot be frozen around work that is not yet permitted to proceed.', v_safety) end);
  if v_safety > 0 then v_blocking := v_blocking + 1; end if;

  -- HARD: approval authority
  select count(*) into v_authority
  from work_orders w
  join recommendations r on r.id = w.recommendation_id
  where w.id = any(v_ids) and r.status = 'pending' and r.approval_required is not null;

  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Approval authority', 'severity', 'blocking',
    'register_ref', 'E4.03',
    'passed', v_authority = 0, 'count', v_authority,
    'detail', case when v_authority = 0
      then 'No scheduled work is waiting on an approval.'
      else format('%s scheduled work order(s) still require approval.', v_authority) end);
  if v_authority > 0 then v_blocking := v_blocking + 1; end if;

  -- SOFT: materials
  select count(distinct work_order_id) into v_short
  from work_order_materials
  where work_order_id = any(v_ids) and status = 'short';

  select count(distinct work_order_id) into v_unassessed
  from work_order_materials
  where work_order_id = any(v_ids) and status = 'requested';

  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Material readiness', 'severity', 'warning',
    'register_ref', 'C6.11',
    'passed', v_short = 0 and v_unassessed = 0,
    'count', v_short + v_unassessed,
    'detail', case
      when v_short = 0 and v_unassessed = 0 then 'Every scheduled job with recorded demand is materially ready.'
      else format('%s job(s) short of material, %s with demand that cannot be assessed. Warned rather than blocked: starting a job while a part is in transit is a legitimate planning judgement.', v_short, v_unassessed) end);
  if v_short + v_unassessed > 0 then v_warning := v_warning + 1; end if;

  -- SOFT: Recovery commitments. This does not resequence work. It makes a
  -- weekly plan acknowledge active restoration scope it omits.
  select
    count(distinct ew.work_order_id),
    count(distinct ew.work_order_id) filter (where ew.work_order_id = any(v_ids))
  into v_recovery_total, v_recovery_in_option
  from restoration_event_work ew
  join restoration_events e
    on e.id = ew.event_id
   and e.organization_id = v_org
  where ew.organization_id = v_org
    and e.status in ('open','planning','approval','released','executing','return_pending')
    and ew.plan_state = 'included'
    and ew.execution_status <> 'complete';

  v_recovery_total := coalesce(v_recovery_total, 0);
  v_recovery_in_option := coalesce(v_recovery_in_option, 0);
  v_recovery_omitted := greatest(0, v_recovery_total - v_recovery_in_option);

  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Active Recovery commitments', 'severity', 'warning',
    'register_ref', 'SYNC-RECOVERY',
    'passed', v_recovery_omitted = 0,
    'count', v_recovery_omitted,
    'active_recovery_work', v_recovery_total,
    'included_in_week', v_recovery_in_option,
    'detail', case
      when v_recovery_total = 0 then
        'No active included Recovery work requires weekly-schedule acknowledgement.'
      when v_recovery_omitted = 0 then
        format('All %s active Recovery work order(s) are represented in this option. The Recovery event plan remains authoritative for sequence and verified concurrency.', v_recovery_total)
      else
        format('%s of %s active Recovery work order(s) are omitted from this weekly option. Omission is a capacity warning, not a deferral: the governed Recovery event plan remains authoritative for restoration sequence and execution.', v_recovery_omitted, v_recovery_total)
    end);
  if v_recovery_omitted > 0 then v_warning := v_warning + 1; end if;

  -- SOFT or NOT ASSESSABLE: labour against craft capacity
  select count(*) into v_cap_rows from craft_capacity where organization_id = v_org;

  if v_cap_rows = 0 then
    v_checks := v_checks || jsonb_build_object(
      'constraint', 'Labour capacity', 'severity', 'warning',
      'register_ref', 'C8.08', 'passed', null, 'count', 0,
      'detail', 'Not assessable: no craft capacity is recorded. Capacity is deliberately not inferred from headcount — a fabricated figure would silently authorise an unachievable week.');
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'craft', x.craft, 'required_hours', x.req, 'available_hours', x.cap,
      'utilisation_pct', round(100.0 * x.req / x.cap, 1)) order by x.req desc), '[]'::jsonb)
    into v_labour
    from (
      select coalesce(t.craft, 'Unassigned') as craft,
             round(sum(t.estimated_hours)::numeric, 1) as req,
             coalesce((select sum(weekly_hours) from craft_capacity c
                       where c.organization_id = v_org and c.craft = t.craft), 0) as cap
      from work_order_tasks t
      where t.work_order_id = any(v_ids)
      group by coalesce(t.craft, 'Unassigned')) x
    where x.cap > 0;

    v_checks := v_checks || jsonb_build_object(
      'constraint', 'Labour capacity', 'severity', 'warning',
      'register_ref', 'C8.08',
      'passed', not exists (
        select 1 from jsonb_array_elements(coalesce(v_labour, '[]'::jsonb)) l
        where (l->>'utilisation_pct')::numeric > 100),
      'by_craft', v_labour,
      'detail', 'Required hours from applied job plans against recorded craft capacity. Over-commitment warns rather than blocks — overtime and contractors are real options a planner may take.');
    if exists (select 1 from jsonb_array_elements(coalesce(v_labour, '[]'::jsonb)) l
               where (l->>'utilisation_pct')::numeric > 100) then
      v_warning := v_warning + 1;
    end if;
  end if;

  -- NOT ASSESSABLE: production/operating context
  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Production window', 'severity', 'warning',
    'register_ref', 'C2.04', 'passed', null, 'count', 0,
    'detail', 'Not assessable: operating context and production plans are not ingested. Equipment availability windows cannot be checked against a plan the platform cannot see.');

  return jsonb_build_object(
    'option_id', p_option_id, 'week_start', o.week_start,
    'work_orders', coalesce(array_length(v_ids, 1), 0),
    'blocking_failures', v_blocking, 'warnings', v_warning,
    'releasable', v_blocking = 0,
    'checks', v_checks,
    'policy', 'Hard constraints block a release; soft constraints warn and leave the judgement with the planner. Recovery event sequence remains governed by Recovery and cannot be overridden by a weekly option.');
end
$$;

revoke all on function public.evaluate_schedule_feasibility(uuid) from public, anon;
grant execute on function public.evaluate_schedule_feasibility(uuid) to authenticated;

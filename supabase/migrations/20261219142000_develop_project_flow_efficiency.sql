-- D7.09 / spec section 29 — Project Flow Efficiency.
--
-- Canonical-home ruling: this is a read model over the existing work_orders
-- and work_order_status_history objects. A work order belongs to a Development
-- Case only through the existing development_case_assets scope relation. No
-- flow event, project, workflow, approval, or metric persistence store is added.
-- Missing or contradictory transition evidence is reported and excluded; it
-- is never converted to zero active time.

create or replace function public.get_project_flow_efficiency(
  p_case_id uuid,
  p_as_of timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_result jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.development_cases
    where id = p_case_id and organization_id = v_org
  ) then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_as_of > now() + interval '1 minute' then
    return jsonb_build_object('error', 'as-of time cannot be in the future');
  end if;

  with case_work as (
    select distinct w.id, w.wo_number, w.title, w.status, w.created_at,
      least(coalesce(w.completed_at, v_as_of), v_as_of) as end_at
    from public.development_case_assets ca
    join public.work_orders w
      on w.asset_id = ca.asset_id and w.organization_id = ca.organization_id
    where ca.development_case_id = p_case_id
      and ca.organization_id = v_org
      and w.created_at <= v_as_of
  ), history_facts as (
    select w.*,
      count(h.id) filter (where h.status_from is distinct from h.status_to)::int as transition_count,
      (array_agg(h.status_from order by h.changed_at, h.id)
        filter (where h.status_from is distinct from h.status_to))[1] as first_status,
      (array_agg(h.status_to order by h.changed_at desc, h.id desc)
        filter (where h.status_from is distinct from h.status_to))[1] as last_status,
      count(h.id) filter (
        where h.status_from is distinct from h.status_to
          and (h.changed_at < w.created_at or h.changed_at > w.end_at)
      )::int as out_of_bounds_count,
      count(h.id) filter (
        where h.status_from is distinct from h.status_to
          and (h.status_from not in ('pending','approval','scheduled','in_progress','blocked','critical','completed')
            or h.status_to not in ('pending','approval','scheduled','in_progress','blocked','critical','completed'))
      )::int as unknown_status_count,
      (select count(*)::int from (
        select q.status_from,
          lag(q.status_to) over (order by q.changed_at,q.id) as prior_status
        from public.work_order_status_history q
        where q.work_order_id=w.id and q.status_from is distinct from q.status_to
      ) chain where chain.prior_status is not null
        and chain.status_from is distinct from chain.prior_status) as discontinuity_count
    from case_work w
    left join public.work_order_status_history h on h.work_order_id = w.id
    group by w.id, w.wo_number, w.title, w.status, w.created_at, w.end_at
  ), assessed as (
    select h.*,
      case
        when end_at < created_at then 'completion precedes creation'
        when status not in ('pending','approval','scheduled','in_progress','blocked','critical','completed') then 'current status is outside the governed flow map'
        when out_of_bounds_count > 0 then 'transition timestamp is outside the work-order elapsed window'
        when unknown_status_count > 0 then 'transition status is outside the governed flow map'
        when discontinuity_count > 0 then 'transition history contains a status-chain discontinuity'
        when transition_count = 0 and status <> 'pending' then 'status changed without transition evidence'
        when transition_count > 0 and last_status is distinct from status then 'latest transition does not match current status'
        else null
      end as exclusion_reason
    from history_facts h
  ), valid_work as (
    select * from assessed where exclusion_reason is null and end_at > created_at
  ), ordered_transitions as (
    select v.id, h.status_from, h.status_to, h.changed_at,
      lead(h.changed_at, 1, v.end_at) over (
        partition by v.id order by h.changed_at, h.id
      ) as next_at,
      row_number() over (partition by v.id order by h.changed_at, h.id) as sequence_no
    from valid_work v
    join public.work_order_status_history h on h.work_order_id = v.id
    where h.status_from is distinct from h.status_to
      and h.changed_at between v.created_at and v.end_at
  ), intervals as (
    select v.id, coalesce(t.status_from, v.status) as interval_status,
      v.created_at as started_at, coalesce(t.changed_at, v.end_at) as ended_at
    from valid_work v
    left join ordered_transitions t on t.id = v.id and t.sequence_no = 1
    union all
    select t.id, t.status_to, t.changed_at, t.next_at
    from ordered_transitions t
  ), work_metrics as (
    select v.id, v.wo_number, v.title, v.status, v.created_at, v.end_at,
      v.transition_count,
      round((extract(epoch from (v.end_at-v.created_at))/3600.0)::numeric, 2) as total_hours,
      round(coalesce(sum(extract(epoch from (i.ended_at-i.started_at))/3600.0)
        filter (where i.interval_status='in_progress' and i.ended_at>i.started_at),0)::numeric, 2) as active_hours,
      round(coalesce(sum(extract(epoch from (i.ended_at-i.started_at))/3600.0)
        filter (where i.interval_status in ('pending','approval','scheduled','blocked','critical')
          and i.ended_at>i.started_at),0)::numeric, 2) as waiting_hours
    from valid_work v
    join intervals i on i.id=v.id
    group by v.id,v.wo_number,v.title,v.status,v.created_at,v.end_at,v.transition_count
  ), totals as (
    select count(*)::int as measured_work_orders,
      coalesce(sum(active_hours),0)::numeric as active_hours,
      coalesce(sum(total_hours),0)::numeric as total_hours,
      coalesce(sum(waiting_hours),0)::numeric as waiting_hours
    from work_metrics
  )
  select jsonb_build_object(
    'caseId', p_case_id,
    'asOf', v_as_of,
    'computable', t.measured_work_orders > 0,
    'partial', exists(select 1 from assessed where exclusion_reason is not null),
    'flowEfficiencyPct', case when t.total_hours > 0
      then round((100*t.active_hours/t.total_hours)::numeric,2) else null end,
    'activeHours', round(t.active_hours,2),
    'waitingHours', round(t.waiting_hours,2),
    'totalElapsedHours', round(t.total_hours,2),
    'eligibleWorkOrders', (select count(*) from assessed),
    'measuredWorkOrders', t.measured_work_orders,
    'excludedWorkOrders', (select count(*) from assessed where exclusion_reason is not null),
    'basis', 'Active value-adding time is the canonical in_progress interval; pending, approval, scheduled, blocked and critical intervals are waiting time.',
    'provenance', jsonb_build_object(
      'scope', 'development_case_assets -> work_orders',
      'timing', 'work_order_status_history.changed_at',
      'calculatedAt', now()
    ),
    'workOrders', coalesce((select jsonb_agg(jsonb_build_object(
      'workOrderId',m.id,'workOrderNumber',m.wo_number,'title',m.title,
      'status',m.status,'activeHours',m.active_hours,'waitingHours',m.waiting_hours,
      'totalElapsedHours',m.total_hours,'flowEfficiencyPct',case when m.total_hours>0
        then round((100*m.active_hours/m.total_hours)::numeric,2) else null end,
      'transitionCount',m.transition_count,'evidenceStart',m.created_at,'evidenceEnd',m.end_at
    ) order by m.wo_number nulls last,m.id) from work_metrics m),'[]'::jsonb),
    'exclusions', coalesce((select jsonb_agg(jsonb_build_object(
      'workOrderId',a.id,'workOrderNumber',a.wo_number,'reason',a.exclusion_reason
    ) order by a.wo_number nulls last,a.id) from assessed a where a.exclusion_reason is not null),'[]'::jsonb)
  ) into v_result
  from totals t;
  return v_result;
end;
$$;

revoke all on function public.get_project_flow_efficiency(uuid,timestamptz)
  from public, anon;
grant execute on function public.get_project_flow_efficiency(uuid,timestamptz)
  to authenticated;

comment on function public.get_project_flow_efficiency(uuid,timestamptz) is
  'D7.09: tenant-scoped Project Flow Efficiency calculated from canonical work-order transition evidence; incomplete evidence is named and excluded.';

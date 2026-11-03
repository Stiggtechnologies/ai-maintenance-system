-- C6.11, C6.15, C8.08 — honest work-health measures and constrained
-- weekly / outage placement.
--
-- Canonical reuse only:
--   * get_work_management_health remains the executive work-health reader;
--   * work_order_materials, material_stock and material_events remain the
--     materials record (no second inventory store);
--   * operating_states plus the human-confirmed failure_code_map remain the
--     source-system delay record;
--   * schedule_options remains the weekly draft / release workflow;
--   * schedule_production_window_check remains the production-window arm;
--   * sync_resource_capacity_hours remains the labour predicate;
--   * outage_windows, outage_work, shutdown_tasks and
--     evaluate_turnaround_readiness remain the outage workflow.
--
-- Nothing here releases a week, freezes outage scope, approves a production
-- interruption, or fabricates stock, duration, or crew capacity.

-- ---------------------------------------------------------------------------
-- Production states for an interval, composed from the one weekly arm.
-- A work order is available only when every overlapped week returns available.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_work_production_states(
  p_work_order_ids uuid[],
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_week date;
  v_last date;
  v_check jsonb;
  v_states jsonb := '{}'::jsonb;
  v_seen jsonb := '{}'::jsonb;
  v_row jsonb;
  v_id text;
  v_next text;
  v_cur text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    return jsonb_build_object('error', 'production interval is empty');
  end if;

  select coalesce(jsonb_object_agg(id::text, to_jsonb('unseen'::text)), '{}'::jsonb)
    into v_states
  from unnest(coalesce(p_work_order_ids, '{}'::uuid[])) as id;

  v_week := date_trunc('week', p_start)::date;
  v_last := date_trunc('week', p_end - interval '1 microsecond')::date;

  while v_week <= v_last loop
    v_check := public.schedule_production_window_check(
      coalesce(p_work_order_ids, '{}'::uuid[]), v_week);
    if v_check ? 'error' then
      return v_check;
    end if;
    v_seen := '{}'::jsonb;
    for v_row in
      select value from jsonb_array_elements(coalesce(v_check->'evidence', '[]'::jsonb))
    loop
      v_id := v_row->>'workOrderId';
      if v_id is null or not (v_states ? v_id) then
        continue;
      end if;
      v_seen := jsonb_set(v_seen, array[v_id], 'true'::jsonb, true);
      v_next := coalesce(v_row->>'assessmentState', 'not_assessable');
      v_cur := coalesce(v_states->>v_id, 'unseen');
      if v_next = 'unavailable' or v_cur = 'unavailable' then
        v_states := jsonb_set(v_states, array[v_id], '"unavailable"'::jsonb, true);
      elsif v_cur = 'unseen' and v_next in ('available', 'not_assessable', 'unavailable') then
        v_states := jsonb_set(v_states, array[v_id], to_jsonb(v_next), true);
      elsif v_next = 'available' and v_cur = 'available' then
        v_states := jsonb_set(v_states, array[v_id], '"available"'::jsonb, true);
      else
        v_states := jsonb_set(v_states, array[v_id], '"not_assessable"'::jsonb, true);
      end if;
    end loop;
    -- A week that omits a work order is not a clearance.
    for v_id in
      select jsonb_object_keys(v_states)
    loop
      if not (v_seen ? v_id) and coalesce(v_states->>v_id, '') <> 'unavailable' then
        v_states := jsonb_set(v_states, array[v_id], '"not_assessable"'::jsonb, true);
      end if;
    end loop;
    v_week := v_week + 7;
  end loop;

  for v_id in
    select jsonb_object_keys(v_states)
  loop
    if coalesce(v_states->>v_id, '') = 'unseen' then
      v_states := jsonb_set(v_states, array[v_id], '"not_assessable"'::jsonb, true);
    end if;
  end loop;

  return jsonb_build_object('states', v_states, 'source', 'schedule_production_window_check');
end
$$;

revoke all on function public.schedule_work_production_states(uuid[], timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

comment on function public.schedule_work_production_states(uuid[], timestamptz, timestamptz) is
  'Internal C8.08 composition of schedule_production_window_check across every week an interval overlaps. Unavailable wins; a missing week is not assessable. Not executable by customer or service roles.';

-- ---------------------------------------------------------------------------
-- C6.11 and C6.15. Replace the two work-health cards in place.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.get_work_management_health_base4(int)') is null then
    alter function public.get_work_management_health(int)
      rename to get_work_management_health_base4;
  end if;
end $$;

create or replace function public.get_work_management_health(
  p_window_days int default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_base jsonb := public.get_work_management_health_base4(p_window_days);
  v_from timestamptz;
  v_to timestamptz;
  v_open int := 0;
  v_no_demand int := 0;
  v_no_stock int := 0;
  v_awaiting int := 0;
  v_not_ready int := 0;
  v_ready int := 0;
  v_assessable int := 0;
  v_wait_hours numeric;
  v_wait_n int := 0;
  v_src_mean numeric;
  v_src_total numeric;
  v_src_n int := 0;
  v_other_delay int := 0;
  v_unconfirmed int := 0;
  v_open_intervals int := 0;
  v_metrics jsonb := '[]'::jsonb;
  m jsonb;
begin
  if v_base ? 'error' then
    return v_base;
  end if;

  v_from := (v_base->>'window_from')::timestamptz;
  v_to := (v_base->>'window_to')::timestamptz;

  with open_wo as (
    select w.id, w.site_id
    from public.work_orders w
    where w.organization_id = v_org and w.completed_at is null
  ), line_facts as (
    select
      o.id as work_order_id,
      m.id as line_id,
      m.status,
      m.qty_required,
      m.qty_reserved,
      exists (
        select 1 from public.material_stock s
        where s.organization_id = v_org
          and s.material_id = m.material_id
          and (
            (o.site_id is null and s.site_id is null)
            or s.site_id = o.site_id
          )
      ) as has_stock,
      exists (
        select 1 from public.material_events e
        where e.organization_id = v_org
          and e.work_order_material_id = m.id
          and e.actor is not null
          and e.event_type in ('reserved', 'kitted', 'issued', 'shortage_declared')
      ) as human_act
    from open_wo o
    left join public.work_order_materials m
      on m.work_order_id = o.id
     and m.organization_id = v_org
     and m.status <> 'cancelled'
  ), per_wo as (
    select
      work_order_id,
      count(line_id) as line_count,
      count(*) filter (where line_id is not null and not has_stock) as missing_stock,
      count(*) filter (where line_id is not null and has_stock and not human_act) as awaiting,
      count(*) filter (
        where line_id is not null and has_stock and human_act
          and not (
            status in ('kitted', 'issued')
            or (status = 'reserved' and qty_reserved >= qty_required)
          )
      ) as not_ready
    from line_facts
    group by work_order_id
  )
  select
    count(*)::int,
    count(*) filter (where line_count = 0)::int,
    count(*) filter (where line_count > 0 and missing_stock > 0)::int,
    count(*) filter (where line_count > 0 and missing_stock = 0 and awaiting > 0)::int,
    count(*) filter (where line_count > 0 and missing_stock = 0 and awaiting = 0 and not_ready > 0)::int,
    count(*) filter (where line_count > 0 and missing_stock = 0 and awaiting = 0 and not_ready = 0)::int
  into v_open, v_no_demand, v_no_stock, v_awaiting, v_not_ready, v_ready
  from per_wo;

  v_assessable := coalesce(v_ready, 0) + coalesce(v_not_ready, 0);

  select round(avg(extract(epoch from (sat.at - req.at)) / 3600.0)::numeric, 1),
         count(*)::int
    into v_wait_hours, v_wait_n
  from (
    select work_order_material_id, min(occurred_at) as at
    from public.material_events
    where organization_id = v_org
      and event_type = 'requested'
      and actor is not null
    group by work_order_material_id
  ) req
  join (
    select work_order_material_id, min(occurred_at) as at
    from public.material_events
    where organization_id = v_org
      and event_type in ('reserved', 'kitted', 'issued')
      and actor is not null
    group by work_order_material_id
  ) sat on sat.work_order_material_id = req.work_order_material_id
  where sat.at >= req.at;

  -- Source-system delay intervals. Confirmed delay labels only. A parts wait
  -- is the label's own words, not every delay and not a dealer name.
  with states as (
    select s.id, s.reason_code, s.started_at, s.ended_at,
      m.label_kind,
      (
        s.reason_code ~* '(wait|waiting|await)'
        and s.reason_code ~* '(part|material|spare|stores)'
      ) as parts_words
    from public.operating_states s
    left join public.failure_code_map m
      on m.organization_id = v_org
     and m.source_label = s.reason_code
    where s.organization_id = v_org
      and s.reason_code is not null
      and s.started_at < v_to
      and (
        s.ended_at is null
        or (s.ended_at > v_from and s.ended_at > s.started_at)
      )
  )
  select
    count(*) filter (
      where ended_at is not null and label_kind = 'delay_reason' and parts_words
    )::int,
    round(avg(extract(epoch from (ended_at - started_at)) / 3600.0) filter (
      where ended_at is not null and label_kind = 'delay_reason' and parts_words
    )::numeric, 1),
    round(sum(extract(epoch from (ended_at - started_at)) / 3600.0) filter (
      where ended_at is not null and label_kind = 'delay_reason' and parts_words
    )::numeric, 1),
    count(*) filter (
      where ended_at is not null and label_kind = 'delay_reason' and not parts_words
    )::int,
    count(*) filter (
      where ended_at is not null and parts_words and label_kind is distinct from 'delay_reason'
    )::int,
    count(*) filter (where ended_at is null and parts_words)::int
  into v_src_n, v_src_mean, v_src_total, v_other_delay, v_unconfirmed, v_open_intervals
  from states;

  for m in select * from jsonb_array_elements(v_base->'metrics') loop
    if m->>'key' = 'ready_backlog' then
      v_metrics := v_metrics || jsonb_build_object(
        'key', 'ready_backlog',
        'label', 'Ready backlog',
        'register_ref', 'C6.11',
        'available', v_assessable > 0,
        'value', case when v_assessable > 0
          then round(100.0 * v_ready / v_assessable, 1) end,
        'unit', '%',
        'basis', case when v_assessable > 0 then format(
          'Open work whose every remaining material line has a same-site stock record and a named-human reserve, kit, issue or shortage act. %s of %s assessable work orders are fully reserved, kitted or issued. %s are short after a stock record. Excluded as unassessable: %s with no demand, %s with no stock record, %s awaiting a human reserve, kit, issue or shortage act. An empty stock position is not 0%% and not 100%%.',
          v_ready, v_assessable, v_not_ready, v_no_demand, v_no_stock, v_awaiting)
        else format(
          'Not measurable. No open work order has a stock-backed material line that a named human has reserved, kitted, issued or declared short. Excluded: %s with no demand, %s with no stock record, %s awaiting that human act. This is not 0%% and not 100%%.',
          v_no_demand, v_no_stock, v_awaiting)
        end
      );
    elsif m->>'key' = 'waiting_on_material' then
      v_metrics := v_metrics || jsonb_build_array(
        jsonb_build_object(
          'key', 'waiting_on_material',
          'label', 'Waiting-on-material time',
          'register_ref', 'C6.15',
          'available', coalesce(v_wait_n, 0) > 0,
          'value', case when coalesce(v_wait_n, 0) > 0 then v_wait_hours end,
          'unit', 'hours',
          'basis', case when coalesce(v_wait_n, 0) > 0 then format(
            'Mean hours from a named-human material request to the first named-human reservation, kit or issue, over %s satisfied lines. This platform stream is not added to source-system delay hours.',
            v_wait_n)
          else
            'No material line yet has both a named-human request and a later named-human reservation, kit or issue. Source-system delay hours are reported on the separate card and are not substituted here.'
          end
        ),
        jsonb_build_object(
          'key', 'waiting_on_material_source_delay',
          'label', 'Waiting-on-material source delay',
          'register_ref', 'C6.15',
          'available', coalesce(v_src_n, 0) > 0,
          'value', case when coalesce(v_src_n, 0) > 0 then v_src_mean end,
          'unit', 'hours',
          'basis', case when coalesce(v_src_n, 0) > 0 then format(
            'Mean recorded duration of %s operating-state interval(s) whose reason code is a confirmed delay_reason and whose own words name a parts or material wait. Total %s h in this window. These are source-system delay records, not material-request events, and they are not added to the platform mean. %s other confirmed delays, %s unconfirmed parts-worded labels and %s open-ended parts-worded intervals were excluded.',
            v_src_n, coalesce(v_src_total, 0), v_other_delay, v_unconfirmed, v_open_intervals)
          else format(
            'No closed operating-state interval in this window has a confirmed delay_reason whose own words name a parts or material wait. %s other confirmed delays, %s unconfirmed parts-worded labels and %s open-ended parts-worded intervals were excluded. Historical wait-parts totals are this population when those rows and confirmed labels are loaded; they are not invented here.',
            v_other_delay, v_unconfirmed, v_open_intervals)
          end
        )
      );
    else
      v_metrics := v_metrics || m;
    end if;
  end loop;

  return jsonb_set(v_base, '{metrics}', v_metrics);
end
$$;

revoke all on function public.get_work_management_health(int) from public, anon;
grant execute on function public.get_work_management_health(int) to authenticated;
revoke all on function public.get_work_management_health_base4(int)
  from public, anon, authenticated;

comment on function public.get_work_management_health(int) is
  'C6.11 and C6.15: ready backlog counts only stock-backed lines a named human has acted on, and withholds the percentage when that sample is empty. Waiting time keeps the material-event mean separate from confirmed source-system parts-wait intervals.';

-- ---------------------------------------------------------------------------
-- Weekly options are placed inside the constraints, not only scored later.
-- ---------------------------------------------------------------------------
alter table public.schedule_options
  add column if not exists constraint_posture jsonb not null default '{}'::jsonb;

comment on column public.schedule_options.constraint_posture is
  'C8.08 placement record: which work was deferred and which capacity figure was used. Not a release and not a second schedule.';

create or replace function public.generate_schedule_options(
  p_week_start date default null,
  p_capacity_hours_per_day numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_right jsonb;
  v_week date;
  v_org uuid := public.app_current_org();
  v_caller_cap numeric := p_capacity_hours_per_day;
  v_ids uuid[];
  v_prod jsonb;
  v_portfolio jsonb;
  v_base_counts jsonb := '{}'::jsonb;
  v_ord int;
  v_label text;
  v_strategy text;
  v_items jsonb;
  v_total numeric;
  v_placed int;
  v_counts jsonb;
  v_used jsonb;
  v_day_used numeric[];
  v_day int;
  v_prod_na int;
  v_fit boolean;
  v_defer text;
  v_craft_need jsonb;
  v_cap jsonb;
  v_have numeric;
  wo record;
  craft record;
  need record;
  d int;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_caller_cap is not null and (
    not public.sync_is_finite_numeric(v_caller_cap) or v_caller_cap <= 0
  ) then
    return jsonb_build_object('error',
      'a stated daily bound must be a finite positive number of hours');
  end if;

  v_right := public.check_decision_right('produce_schedule_options');
  if coalesce((v_right->>'allowed')::boolean, false) is not true then
    return jsonb_build_object('error',
      coalesce(v_right->>'reason', 'schedule generation is not permitted'),
      'decision_right', v_right);
  end if;

  v_week := coalesce(p_week_start,
    (current_date + ((8 - extract(isodow from current_date)::int) % 7 + 7) % 7 + 1));
  v_week := v_week - ((extract(isodow from v_week)::int) - 1);

  if exists (
    select 1 from public.schedule_options
    where organization_id = v_org and week_start = v_week and status = 'released'
  ) then
    return jsonb_build_object('error',
      'a released (frozen) schedule already exists for this week');
  end if;

  select coalesce(array_agg(w.id), '{}'::uuid[]) into v_ids
  from public.work_orders w
  where w.organization_id = v_org and w.completed_at is null;

  v_prod := public.schedule_work_production_states(
    v_ids, v_week::timestamptz, (v_week + 7)::timestamptz);
  if v_prod ? 'error' then
    return v_prod;
  end if;

  v_portfolio := public.sync_portfolio_resource_conflicts(v_org, v_week, v_week + 7);

  drop table if exists sched_cand_c808;
  create temporary table sched_cand_c808 (
    id uuid primary key,
    wo_number text,
    title text,
    tag text,
    priority text,
    hours numeric,
    priority_weight int,
    criticality_weight int,
    age_days int,
    ratio numeric,
    recovery boolean,
    reason text,
    production_state text
  ) on commit drop;

  insert into sched_cand_c808 (
    id, wo_number, title, tag, priority, hours, priority_weight,
    criticality_weight, age_days, ratio, recovery, reason, production_state
  )
  select
    w.id,
    w.wo_number,
    w.title,
    coalesce(nullif(a.asset_tag, ''), a.tag),
    coalesce(w.priority, 'medium'),
    coalesce(task_hours.hours, nullif(w.planned_hours, 0), nullif(w.estimated_hours, 0)),
    case coalesce(w.priority, 'medium')
      when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end,
    case coalesce(a.criticality, 'medium')
      when 'critical' then 3 when 'high' then 2 else 1 end,
    greatest(0, extract(day from now() - w.created_at)::int),
    case when coalesce(task_hours.hours, nullif(w.planned_hours, 0), nullif(w.estimated_hours, 0)) > 0
      then (case coalesce(w.priority, 'medium')
        when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end)::numeric
        / coalesce(task_hours.hours, nullif(w.planned_hours, 0), nullif(w.estimated_hours, 0))
    end,
    exists (
      select 1 from public.restoration_event_work ew
      join public.restoration_events e
        on e.id = ew.event_id and e.organization_id = v_org
      where ew.organization_id = v_org
        and ew.work_order_id = w.id
        and e.status in ('open', 'planning', 'approval', 'released', 'executing', 'return_pending')
        and ew.plan_state = 'included'
        and ew.execution_status <> 'complete'
    ),
    case
      when exists (
        select 1 from public.recommendation_screenings s
        join public.recommendations r on r.id = s.recommendation_id
        where r.id = w.recommendation_id
          and s.requires_gatekeeper
          and s.gatekeeper_attested_at is null
      ) then 'safety_gate'
      when exists (
        select 1 from public.recommendations r
        where r.id = w.recommendation_id
          and r.status = 'pending'
          and r.approval_required is not null
      ) then 'approval_outstanding'
      when exists (
        select 1 from public.outage_work ow
        join public.outage_windows win on win.id = ow.outage_window_id
        where ow.organization_id = v_org
          and ow.work_order_id = w.id
          and win.organization_id = v_org
          and win.status in ('planned', 'frozen', 'executing')
          and win.starts_at < (v_week + 7)::timestamptz
          and win.ends_at > v_week::timestamptz
      ) then 'committed_to_outage'
      when coalesce(v_prod->'states'->>w.id::text, 'not_assessable') = 'unavailable'
        then 'production_unavailable'
      when coalesce(mat.line_count, 0) = 0 then 'material_no_demand'
      when mat.missing_stock > 0 then 'material_unassessable'
      when mat.awaiting > 0 then 'material_awaiting_human'
      when mat.not_ready > 0 then 'material_short'
      when coalesce(task_hours.craft_rows, 0) = 0 then 'labour_demand_not_recorded'
      else null
    end,
    coalesce(v_prod->'states'->>w.id::text, 'not_assessable')
  from public.work_orders w
  left join public.assets a
    on a.id = w.asset_id and a.organization_id = v_org
  left join lateral (
    select
      count(*) filter (where m.status <> 'cancelled') as line_count,
      count(*) filter (
        where m.status <> 'cancelled' and not exists (
          select 1 from public.material_stock s
          where s.organization_id = v_org
            and s.material_id = m.material_id
            and ((w.site_id is null and s.site_id is null) or s.site_id = w.site_id)
        )
      ) as missing_stock,
      count(*) filter (
        where m.status <> 'cancelled'
          and exists (
            select 1 from public.material_stock s
            where s.organization_id = v_org
              and s.material_id = m.material_id
              and ((w.site_id is null and s.site_id is null) or s.site_id = w.site_id)
          )
          and not exists (
            select 1 from public.material_events e
            where e.organization_id = v_org
              and e.work_order_material_id = m.id
              and e.actor is not null
              and e.event_type in ('reserved', 'kitted', 'issued', 'shortage_declared')
          )
      ) as awaiting,
      count(*) filter (
        where m.status <> 'cancelled'
          and exists (
            select 1 from public.material_stock s
            where s.organization_id = v_org
              and s.material_id = m.material_id
              and ((w.site_id is null and s.site_id is null) or s.site_id = w.site_id)
          )
          and exists (
            select 1 from public.material_events e
            where e.organization_id = v_org
              and e.work_order_material_id = m.id
              and e.actor is not null
              and e.event_type in ('reserved', 'kitted', 'issued', 'shortage_declared')
          )
          and not (
            m.status in ('kitted', 'issued')
            or (m.status = 'reserved' and m.qty_reserved >= m.qty_required)
          )
      ) as not_ready
    from public.work_order_materials m
    where m.organization_id = v_org and m.work_order_id = w.id
  ) mat on true
  left join lateral (
    select
      coalesce(sum(t.estimated_hours) filter (where t.estimated_hours > 0), 0) as hours,
      count(*) filter (where t.estimated_hours > 0) as craft_rows
    from public.work_order_tasks t
    where t.work_order_id = w.id and t.organization_id = v_org
  ) task_hours on true
  where w.organization_id = v_org and w.completed_at is null;

  select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb)
    into v_base_counts
  from (
    select reason, count(*) as n
    from sched_cand_c808
    where reason is not null
    group by reason
  ) counted;

  delete from public.schedule_options
  where organization_id = v_org and week_start = v_week and status = 'draft';

  for v_ord in 1..3 loop
    v_label := case v_ord
      when 1 then 'Risk-first' when 2 then 'Quick-wins' else 'Balanced' end;
    v_strategy := case v_ord
      when 1 then 'Eligible work ordered by priority and asset criticality after safety, approval, material, outage, production and recorded labour constraints.'
      when 2 then 'Eligible work ordered by shortest recorded task duration after the same constraints. Missing hours are deferred, not assumed.'
      else 'Eligible work ordered by priority per recorded hour after the same constraints.'
    end;
    v_items := '[]'::jsonb;
    v_total := 0;
    v_placed := 0;
    v_prod_na := 0;
    v_counts := v_base_counts;
    v_used := '{}'::jsonb;
    v_day_used := array[0, 0, 0, 0, 0]::numeric[];

    for wo in
      select * from sched_cand_c808 c
      where c.reason is null
      order by c.recovery desc,
        case when v_ord = 1 then c.priority_weight else 0 end desc,
        case when v_ord = 1 then c.criticality_weight else 0 end desc,
        case when v_ord = 2 then c.hours else 0 end asc,
        case when v_ord = 3 then c.ratio else 0 end desc,
        c.age_days desc,
        c.id
    loop
      v_fit := true;
      v_defer := null;
      v_craft_need := '[]'::jsonb;
      v_day := null;

      if v_placed >= 60 then
        v_fit := false;
        v_defer := 'beyond_option_limit';
      end if;

      if v_fit then
        for craft in
          select coalesce(nullif(btrim(t.craft), ''), 'Unassigned') as craft,
                 round(sum(t.estimated_hours)::numeric, 1) as req
          from public.work_order_tasks t
          where t.work_order_id = wo.id
            and t.organization_id = v_org
            and t.estimated_hours > 0
          group by 1
        loop
          v_cap := public.sync_resource_capacity_hours(
            v_org, 'skilled_trades', craft.craft, v_week, v_week + 7);
          v_have := coalesce((v_used->>craft.craft)::numeric, 0);
          if coalesce((v_cap->>'answered')::boolean, false) is not true
             or nullif(v_cap->>'capacityHours', '') is null
             or (v_cap->>'capacityHours')::numeric <= 0 then
            v_fit := false;
            v_defer := 'labour_not_assessable';
            exit;
          elsif v_have + craft.req > (v_cap->>'capacityHours')::numeric then
            v_fit := false;
            v_defer := 'labour_over_capacity';
            exit;
          end if;
          v_craft_need := v_craft_need || jsonb_build_array(
            jsonb_build_object('craft', craft.craft, 'req', craft.req));
        end loop;
        if v_fit and jsonb_array_length(v_craft_need) = 0 then
          v_fit := false;
          v_defer := 'labour_demand_not_recorded';
        end if;
      end if;

      if v_fit and v_caller_cap is not null then
        for d in 1..5 loop
          if v_day_used[d] + wo.hours <= v_caller_cap then
            v_day := d;
            exit;
          end if;
        end loop;
        if v_day is null then
          v_fit := false;
          v_defer := 'does_not_fit_stated_daily_bound';
        end if;
      elsif v_fit then
        v_day := (v_placed % 5) + 1;
      end if;

      if v_fit then
        for need in
          select e.value as item from jsonb_array_elements(v_craft_need) e
        loop
          v_used := jsonb_set(
            v_used,
            array[need.item->>'craft'],
            to_jsonb(coalesce((v_used->> (need.item->>'craft'))::numeric, 0)
              + (need.item->>'req')::numeric),
            true);
        end loop;
        if v_caller_cap is not null then
          v_day_used[v_day] := v_day_used[v_day] + wo.hours;
        end if;
        v_items := v_items || jsonb_build_object(
          'wo_id', wo.id, 'wo_number', wo.wo_number, 'title', wo.title,
          'tag', wo.tag, 'priority', wo.priority, 'hours', wo.hours, 'day', v_day);
        v_total := v_total + coalesce(wo.hours, 0);
        v_placed := v_placed + 1;
        if wo.production_state = 'not_assessable' then
          v_prod_na := v_prod_na + 1;
        end if;
      else
        v_counts := jsonb_set(
          v_counts,
          array[v_defer],
          to_jsonb(coalesce((v_counts->>v_defer)::int, 0) + 1),
          true);
      end if;
    end loop;

    insert into public.schedule_options (
      organization_id, week_start, label, strategy, items, total_hours,
      capacity_hours, status, generated_by, constraint_posture
    ) values (
      v_org, v_week, v_label, v_strategy, v_items, v_total,
      coalesce(v_caller_cap, 0), 'draft', auth.uid(),
      jsonb_build_object(
        'register_ref', 'C8.08',
        'capacity_basis', case when v_caller_cap is not null
          then 'Caller-stated daily hour bound. It is not recorded crew capacity.'
          else 'No caller-stated daily bound. Placement uses skilled-trades capacity in force for this week. Day numbers are a sequence, not a daily crew.'
        end,
        'caller_daily_bound', v_caller_cap,
        'placed', v_placed,
        'production_not_assessable', v_prod_na,
        'production_basis', 'Unavailable production evidence excludes the work order. Missing or partial evidence can remain on the draft and is not a clearance.',
        'portfolio', jsonb_build_object(
          'answered', v_portfolio->'answered',
          'conflicts', v_portfolio->'conflicts'),
        'deferred_counts', v_counts,
        'recovery_note', 'Active Recovery work that passes the hard exclusions is ordered first. The Recovery event plan is not rewritten.',
        'authority', 'Draft option only. Freezing the week remains release_schedule_option, which refuses the AI-operator identity by name.'
      )
    );
  end loop;

  drop table if exists sched_cand_c808;

  return jsonb_build_object(
    'ok', true,
    'week_start', v_week,
    'options', 3,
    'decision_right', v_right->>'register_ref',
    'authority', 'drafts only; release_schedule_option remains the freeze and refuses ai_admin');
exception when others then
  drop table if exists sched_cand_c808;
  raise;
end
$$;

revoke all on function public.generate_schedule_options(date, numeric)
  from public, anon, service_role;
grant execute on function public.generate_schedule_options(date, numeric)
  to authenticated;

comment on function public.generate_schedule_options(date, numeric) is
  'C8.08 weekly placement. Safety gates and outstanding approvals are left off the draft. Material with no demand, no stock record, no human act, or a shortage is left off. Work committed to an overlapping outage is left off. Unavailable production evidence is left off. Labour is placed only against sync_resource_capacity_hours for skilled trades in force that week. A missing caller daily bound is not replaced with 24. The function writes drafts only.';

-- ---------------------------------------------------------------------------
-- Outage proposal. Reads the canonical readiness door and dependency graph.
-- It does not add work, freeze scope, or release execution.
-- ---------------------------------------------------------------------------
create or replace function public.propose_constrained_outage_schedule(
  p_window_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_right jsonb;
  w public.outage_windows%rowtype;
  v_readiness jsonb;
  v_cycle boolean := false;
  v_event uuid;
  v_tasks text[] := '{}'::text[];
  v_emitted text[] := '{}'::text[];
  v_next text;
  v_guard int := 0;
  v_sequence jsonb := '[]'::jsonb;
  v_task record;
  v_from date;
  v_to date;
  v_labour_note text;
  v_labour_state text := 'assessed';
  v_used jsonb := '{}'::jsonb;
  v_window_hours numeric := 0;
  v_included_hours numeric := 0;
  v_remaining numeric := 0;
  v_proposed_hours numeric := 0;
  v_ids uuid[];
  v_prod jsonb;
  v_candidates jsonb := '[]'::jsonb;
  v_excluded jsonb := '[]'::jsonb;
  v_excluded_n int := 0;
  cand record;
  craft record;
  v_fit boolean;
  v_reason text;
  v_cap jsonb;
  v_have numeric;
  v_need numeric;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  v_right := public.check_decision_right('produce_schedule_options');
  if coalesce((v_right->>'allowed')::boolean, false) is not true then
    return jsonb_build_object('error',
      coalesce(v_right->>'reason', 'outage proposals are not permitted'),
      'decision_right', v_right);
  end if;

  select * into w from public.outage_windows
  where id = p_window_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'outage window not found');
  end if;

  v_readiness := public.evaluate_turnaround_readiness(w.id);
  v_cycle := coalesce((v_readiness#>>'{sequence,cycleDetected}')::boolean, false);
  v_event := w.shutdown_event_id;

  if v_event is not null and not v_cycle then
    select coalesce(array_agg(t.task_key order by t.id), '{}'::text[])
      into v_tasks
    from public.shutdown_tasks t
    where t.event_id = v_event;

    while v_guard < coalesce(array_length(v_tasks, 1), 0) loop
      v_guard := v_guard + 1;
      select t.task_key into v_next
      from public.shutdown_tasks t
      where t.event_id = v_event
        and not (t.task_key = any(v_emitted))
        and not exists (
          select 1 from public.shutdown_task_dependencies d
          where d.event_id = v_event
            and d.task_key = t.task_key
            and not (d.predecessor_key = any(v_emitted))
        )
      order by t.id
      limit 1;
      exit when v_next is null;
      v_emitted := v_emitted || v_next;
    end loop;

    if coalesce(array_length(v_emitted, 1), 0) = coalesce(array_length(v_tasks, 1), 0)
       and coalesce(array_length(v_tasks, 1), 0) > 0 then
      for v_task in
        select t.task_key, t.label, t.duration_hours, ow.work_order_id, wo.wo_number,
               u.ord
        from unnest(v_emitted) with ordinality as u(task_key, ord)
        join public.shutdown_tasks t
          on t.event_id = v_event and t.task_key = u.task_key
        left join public.outage_work ow on ow.id = t.outage_work_id
        left join public.work_orders wo
          on wo.id = ow.work_order_id and wo.organization_id = v_org
        order by u.ord
      loop
        v_sequence := v_sequence || jsonb_build_array(jsonb_build_object(
          'taskKey', v_task.task_key,
          'label', v_task.label,
          'durationHours', v_task.duration_hours,
          'workOrderId', v_task.work_order_id,
          'woNumber', v_task.wo_number,
          'basis', 'Recorded predecessor order. No dependency was invented.'
        ));
      end loop;
    else
      v_cycle := true;
      v_sequence := '[]'::jsonb;
    end if;
  end if;

  v_from := w.starts_at::date;
  v_to := greatest(w.ends_at::date, v_from + 1);
  v_labour_note := 'Labour uses the recorded skilled-trades figure from the outage start date through its end date, exclusive. The window is not rounded up, and a same-calendar-day outage asks for one day of that recorded week.';

  for craft in
    select coalesce(nullif(btrim(t.craft), ''), 'Unassigned') as craft,
           round(sum(t.estimated_hours)::numeric, 1) as req
    from public.outage_work ow
    join public.work_order_tasks t
      on t.work_order_id = ow.work_order_id and t.organization_id = v_org
    where ow.organization_id = v_org
      and ow.outage_window_id = w.id
      and t.estimated_hours > 0
    group by 1
  loop
    v_cap := public.sync_resource_capacity_hours(
      v_org, 'skilled_trades', craft.craft, v_from, v_to);
    if coalesce((v_cap->>'answered')::boolean, false) is not true
       or nullif(v_cap->>'capacityHours', '') is null then
      v_labour_state := 'not_assessable';
      exit;
    end if;
    v_used := jsonb_set(v_used, array[craft.craft], to_jsonb(craft.req), true);
    if craft.req > (v_cap->>'capacityHours')::numeric then
      v_labour_state := 'over_committed';
    end if;
  end loop;

  select round(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0, 1)
    into v_window_hours;
  select coalesce(round(sum(wo.planned_hours)::numeric, 1), 0)
    into v_included_hours
  from public.outage_work ow
  join public.work_orders wo on wo.id = ow.work_order_id and wo.organization_id = v_org
  where ow.organization_id = v_org
    and ow.outage_window_id = w.id
    and wo.planned_hours > 0;
  v_remaining := greatest(coalesce(v_window_hours, 0) - coalesce(v_included_hours, 0), 0);

  if w.status = 'planned' and v_labour_state = 'assessed' then
    select coalesce(array_agg(c.id), '{}'::uuid[]) into v_ids
    from (
      select wko.id
      from public.work_orders wko
      where wko.organization_id = v_org
        and wko.completed_at is null
        and wko.planned_hours > 0
        and not exists (
          select 1 from public.outage_work ow
          where ow.outage_window_id = w.id and ow.work_order_id = wko.id
        )
        and not exists (
          select 1 from public.work_order_materials m
          where m.organization_id = v_org
            and m.work_order_id = wko.id
            and m.status in ('requested', 'short')
        )
        and not exists (
          select 1 from public.approvals a
          where a.organization_id = v_org
            and a.work_order_id = wko.id
            and a.status in ('required', 'pending')
        )
        and not (
          coalesce(wko.approval_required, false) and not exists (
            select 1 from public.approvals a
            where a.organization_id = v_org
              and a.work_order_id = wko.id
              and a.status = 'approved'
          )
        )
        and not exists (
          select 1 from public.recommendation_screenings s
          join public.recommendations r on r.id = s.recommendation_id
          where r.id = wko.recommendation_id
            and s.requires_gatekeeper
            and s.gatekeeper_attested_at is null
        )
    ) c;

    v_prod := public.schedule_work_production_states(v_ids, w.starts_at, w.ends_at);
    if v_prod ? 'error' then
      return v_prod || jsonb_build_object('readiness', v_readiness);
    end if;

    for cand in
      select wko.id, wko.wo_number, wko.title, wko.planned_hours,
        coalesce(v_prod->'states'->>wko.id::text, 'not_assessable') as production_state,
        case coalesce(wko.priority, 'medium')
          when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end as priority_weight
      from public.work_orders wko
      where wko.id = any(v_ids)
      order by priority_weight desc, wko.planned_hours asc, wko.id
    loop
      v_fit := true;
      v_reason := null;
      if cand.production_state <> 'available' then
        v_fit := false;
        v_reason := case when cand.production_state = 'unavailable'
          then 'production_unavailable' else 'production_not_assessable' end;
      elsif v_proposed_hours + cand.planned_hours > v_remaining then
        v_fit := false;
        v_reason := 'does_not_fit_remaining_window';
      else
        for craft in
          select coalesce(nullif(btrim(t.craft), ''), 'Unassigned') as craft,
                 round(sum(t.estimated_hours)::numeric, 1) as req
          from public.work_order_tasks t
          where t.work_order_id = cand.id
            and t.organization_id = v_org
            and t.estimated_hours > 0
          group by 1
        loop
          v_cap := public.sync_resource_capacity_hours(
            v_org, 'skilled_trades', craft.craft, v_from, v_to);
          v_have := coalesce((v_used->>craft.craft)::numeric, 0);
          v_need := craft.req;
          if coalesce((v_cap->>'answered')::boolean, false) is not true
             or nullif(v_cap->>'capacityHours', '') is null then
            v_fit := false;
            v_reason := 'labour_not_assessable';
            exit;
          elsif v_have + v_need > (v_cap->>'capacityHours')::numeric then
            v_fit := false;
            v_reason := 'labour_over_capacity';
            exit;
          end if;
        end loop;
        if v_fit and not exists (
          select 1 from public.work_order_tasks t
          where t.work_order_id = cand.id
            and t.organization_id = v_org
            and t.estimated_hours > 0
        ) then
          v_fit := false;
          v_reason := 'labour_demand_not_recorded';
        end if;
      end if;

      if v_fit then
        for craft in
          select coalesce(nullif(btrim(t.craft), ''), 'Unassigned') as craft,
                 round(sum(t.estimated_hours)::numeric, 1) as req
          from public.work_order_tasks t
          where t.work_order_id = cand.id
            and t.organization_id = v_org
            and t.estimated_hours > 0
          group by 1
        loop
          v_used := jsonb_set(
            v_used,
            array[craft.craft],
            to_jsonb(coalesce((v_used->>craft.craft)::numeric, 0) + craft.req),
            true);
        end loop;
        v_proposed_hours := v_proposed_hours + cand.planned_hours;
        v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
          'workOrderId', cand.id,
          'woNumber', cand.wo_number,
          'title', cand.title,
          'plannedHours', cand.planned_hours,
          'productionState', cand.production_state,
          'basis', 'Sized, not already in scope, and clear of the turnaround material, approval and safety blockers. Production evidence is available for the window and the added labour fits the capacity in force.'
        ));
      else
        v_excluded_n := v_excluded_n + 1;
        if v_excluded_n <= 40 then
          v_excluded := v_excluded || jsonb_build_array(jsonb_build_object(
            'workOrderId', cand.id,
            'woNumber', cand.wo_number,
            'reason', v_reason
          ));
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'windowId', w.id,
    'windowKey', w.window_key,
    'status', w.status,
    'readiness', v_readiness,
    'sequenceClaimed', v_sequence <> '[]'::jsonb and not v_cycle,
    'sequenceBasis', case
      when v_event is null then 'No linked shutdown schedule, so no sequence is claimed.'
      when v_cycle then 'A dependency cycle or an incomplete predecessor set was found. No order is claimed.'
      when v_sequence = '[]'::jsonb then 'The linked schedule has no tasks, so no order is claimed.'
      else 'Existing activities in recorded predecessor order.'
    end,
    'sequence', v_sequence,
    'candidates', case when w.status = 'planned' and v_labour_state = 'assessed'
      then v_candidates else '[]'::jsonb end,
    'excluded', v_excluded,
    'excludedCount', v_excluded_n,
    'labourState', v_labour_state,
    'labourBasis', v_labour_note,
    'remainingHours', v_remaining,
    'decisionRight', v_right->>'register_ref',
    'authority', 'Proposal only. This does not add work, freeze scope, release execution, or approve a production interruption. ai_admin is not given freeze authority here.'
  );
end
$$;

revoke all on function public.propose_constrained_outage_schedule(uuid)
  from public, anon, service_role;
grant execute on function public.propose_constrained_outage_schedule(uuid)
  to authenticated;

comment on function public.propose_constrained_outage_schedule(uuid) is
  'C8.08 outage proposal over evaluate_turnaround_readiness, shutdown_task_dependencies, schedule_work_production_states and sync_resource_capacity_hours. Read only. Additions are proposed only for a planned window whose included labour is assessable and not already over the capacity in force.';

notify pgrst, 'reload schema';

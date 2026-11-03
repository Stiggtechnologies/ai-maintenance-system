-- C9.07 / C9.08 — measured Stage-1 pilot proof from this tenant's live rows.
--
-- Canonical reuse, no parallel store:
--   work_orders.response_class          emergency share (C3.07 / C6.08)
--   get_work_management_health          classified population only
--   get_repeat_failure_metrics          governed repeats (C6.20)
--   operating_states                    availability and demonstrated downtime
--   production_records                  demonstrated output (C6.04 rule)
--   work_orders.job_plan_id             backlog planning completeness (C8.07)
--   work_order_materials                backlog material readiness (C6.11)
--   ingest_staging                      source response_class already accepted
--     + connectors / connector_runs       by the one work-order ingest door
--
-- What this refuses:
--   * priority, critical status, or a case-study fleet as "emergency"
--   * nameplate capacity as a production-loss rate
--   * summing losses across different units of measure
--   * a blended backlog-quality score, or a parts-ready flag as readiness
--   * calendar availability invented from work-order downtime hours
--   * an availability ratio when running and down intervals overlap
--   * AI-operator classification of dispatch class
--
-- The read grants no work, approval, risk, spend, limit, or return-to-service
-- authority. Empty evidence stays not_measurable.

create or replace function public.apply_imported_work_order_response_class(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $apply$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_blank int := 0;
  v_invalid int := 0;
  v_conflicts int := 0;
  v_unmatched int := 0;
  v_applied int := 0;
  v_run_org uuid;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'copying a response class requires a signed-in tenant');
  end if;
  select role into v_role
  from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if v_role is null then
    return jsonb_build_object('error', 'copying a response class requires a member of this tenant');
  end if;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error', 'the AI operator cannot classify emergency work');
  end if;

  select organization_id into v_run_org
  from public.connector_runs
  where id = p_run_id and organization_id = v_org;
  if v_run_org is null then
    return jsonb_build_object('error', 'import run not found');
  end if;

  select
    count(*) filter (where class is null),
    count(*) filter (
      where class is not null
        and class not in ('emergency', 'urgent', 'scheduled')
    ),
    count(*) filter (
      where class in ('emergency', 'urgent', 'scheduled')
        and w.id is not null
        and w.response_class is not null
        and w.response_class is distinct from class
    ),
    count(*) filter (
      where class in ('emergency', 'urgent', 'scheduled')
        and w.id is null
    )
  into v_blank, v_invalid, v_conflicts, v_unmatched
  from (
    select
      nullif(lower(btrim(s.payload->>'response_class')), '') as class,
      c.connector_key as source_system,
      s.external_id
    from public.ingest_staging s
    join public.connector_runs r
      on r.id = s.run_id and r.organization_id = v_org
    join public.connectors c
      on c.id = r.connector_id and c.organization_id = v_org
    where s.run_id = p_run_id
      and s.organization_id = v_org
      and s.entity_type = 'work_order'
      and s.status = 'accepted'
  ) staged
  left join public.work_orders w
    on w.organization_id = v_org
   and w.source_system = staged.source_system
   and w.external_id = staged.external_id;

  with staged as (
    select
      nullif(lower(btrim(s.payload->>'response_class')), '') as class,
      c.connector_key as source_system,
      s.external_id
    from public.ingest_staging s
    join public.connector_runs r
      on r.id = s.run_id and r.organization_id = v_org
    join public.connectors c
      on c.id = r.connector_id and c.organization_id = v_org
    where s.run_id = p_run_id
      and s.organization_id = v_org
      and s.entity_type = 'work_order'
      and s.status = 'accepted'
  )
  update public.work_orders w
  set response_class = staged.class
  from staged
  where staged.class in ('emergency', 'urgent', 'scheduled')
    and w.organization_id = v_org
    and w.source_system = staged.source_system
    and w.external_id = staged.external_id
    and (w.response_class is null or w.response_class = staged.class);
  get diagnostics v_applied = row_count;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (
    v_org,
    'work_order_response_class',
    v_role,
    jsonb_build_object(
      'run_id', p_run_id,
      'applied', v_applied,
      'blank', v_blank,
      'invalid', v_invalid,
      'conflicts', v_conflicts,
      'unmatched', v_unmatched,
      'boundary', 'Source response_class is copied as written. Priority is not a class. Conflicting existing classes are left unchanged.'
    )
  );

  return jsonb_build_object(
    'applied', v_applied,
    'blank', v_blank,
    'invalid', v_invalid,
    'conflicts', v_conflicts,
    'unmatched', v_unmatched
  );
end
$apply$;

revoke all on function public.apply_imported_work_order_response_class(uuid)
  from public, anon, service_role;
grant execute on function public.apply_imported_work_order_response_class(uuid)
  to authenticated;

create or replace function public.get_stage1_measured_pilot_proof(
  p_window_days int default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $proof$
declare
  v_org uuid := public.app_current_org();
  v_from timestamptz;
  v_to timestamptz;
  v_window_source text;
  v_health jsonb;
  v_metric jsonb;
  v_repeat jsonb;
  v_emergency jsonb;
  v_repeats jsonb;
  v_running numeric;
  v_down numeric;
  v_other numeric;
  v_conflicts int;
  v_state_rows int;
  v_availability jsonb;
  v_open int;
  v_planning int;
  v_demand int;
  v_ready int;
  v_backlog jsonb;
  v_measurable int;
  v_mixed int;
  v_no_rate int;
  v_uoms int;
  v_uom text;
  v_units numeric;
  v_loss_rows jsonb;
  v_loss jsonb;
  v_wo int;
  v_wo_unsourced int;
  v_production_rows int;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'a measured pilot proof requires a signed-in tenant');
  end if;
  if p_window_days is not null and p_window_days < 1 then
    return jsonb_build_object('error', 'window days must be at least 1');
  end if;

  if p_window_days is null then
    select min(ts_from), max(ts_to)
    into v_from, v_to
    from (
      select min(started_at) as ts_from,
             max(coalesce(ended_at, started_at)) as ts_to
      from public.operating_states
      where organization_id = v_org
      union all
      select min(period_start), max(period_end)
      from public.production_records
      where organization_id = v_org and asset_id is not null
    ) bounds;
    v_window_source := 'derived from this tenant''s operating and production rows';
  else
    v_from := now() - make_interval(days => p_window_days);
    v_to := now();
    v_window_source := 'caller-specified trailing window';
  end if;

  select count(*) into v_wo
  from public.work_orders
  where organization_id = v_org;
  select count(*) into v_wo_unsourced
  from public.work_orders
  where organization_id = v_org
    and nullif(btrim(source_system), '') is null;
  select count(*) into v_state_rows
  from public.operating_states
  where organization_id = v_org;
  select count(*) into v_production_rows
  from public.production_records
  where organization_id = v_org and asset_id is not null;

  -- Emergency. Measured only when get_work_management_health says the
  -- response_class population exists. Its priority proxy is discarded.
  v_health := public.get_work_management_health(p_window_days);
  v_metric := null;
  if v_health is not null and not (v_health ? 'error') then
    select m into v_metric
    from jsonb_array_elements(coalesce(v_health->'metrics', '[]'::jsonb)) m
    where m->>'key' = 'emergency_work_pct'
    limit 1;
  end if;
  if v_metric is not null
     and coalesce((v_metric->>'measured')::boolean, false)
     and jsonb_typeof(v_metric->'value') = 'number' then
    v_emergency := jsonb_build_object(
      'status', 'measured',
      'value', v_metric->'value',
      'unit', '%',
      'classified', coalesce(v_health->'coverage'->'responseClassified', '0'::jsonb),
      'work_orders', coalesce(v_health->'coverage'->'workOrders', '0'::jsonb),
      'basis', v_metric->>'basis'
    );
  else
    v_emergency := jsonb_build_object(
      'status', 'not_measurable',
      'value', null,
      'unit', '%',
      'classified', coalesce(v_health->'coverage'->'responseClassified', '0'::jsonb),
      'work_orders', coalesce(v_health->'work_orders_in_window', '0'::jsonb),
      'basis', 'Emergency work counts only work orders whose source dispatch class is emergency, divided by the classified population. A blank class stays unclassified.'
    );
  end if;

  v_repeat := public.get_repeat_failure_metrics(90, p_window_days);
  if v_repeat is null or v_repeat ? 'error' or not coalesce((v_repeat->>'available')::boolean, false) then
    v_repeats := jsonb_build_object(
      'status', 'not_measurable',
      'value', null,
      'unit', '%',
      'coded_events', coalesce(v_repeat->'codedEvents', '0'::jsonb),
      'repeat_events', coalesce(v_repeat->'repeatEvents', '0'::jsonb),
      'repeat_pairs', coalesce(v_repeat->'repeatAssetMechanismPairs', '0'::jsonb),
      'uncoded_excluded', coalesce(v_repeat->'uncodedEventsExcluded', '0'::jsonb),
      'incomplete_excluded', coalesce(v_repeat->'incompleteCodingProvenanceExcluded', '0'::jsonb),
      'basis', coalesce(
        v_repeat->>'basis',
        'Repeat failures need completed corrective work with a governed human mechanism coding. Uncoded history is excluded.'
      )
    );
  else
    v_repeats := jsonb_build_object(
      'status', 'measured',
      'value', v_repeat->'repeatRatePct',
      'unit', '%',
      'coded_events', v_repeat->'codedEvents',
      'repeat_events', v_repeat->'repeatEvents',
      'repeat_pairs', v_repeat->'repeatAssetMechanismPairs',
      'uncoded_excluded', v_repeat->'uncodedEventsExcluded',
      'incomplete_excluded', v_repeat->'incompleteCodingProvenanceExcluded',
      'basis', v_repeat->>'basis'
    );
  end if;

  v_running := null;
  v_down := null;
  v_other := null;
  v_conflicts := 0;
  if v_from is null or v_to is null or v_to <= v_from or v_state_rows = 0 then
    v_availability := jsonb_build_object(
      'status', 'not_measurable',
      'value', null,
      'unit', '%',
      'running_hours', null,
      'down_hours', null,
      'other_hours', null,
      'conflict_assets', 0,
      'window_from', v_from,
      'window_to', v_to,
      'window_source', v_window_source,
      'basis', 'Availability uses unioned operating-state intervals. This tenant has no operating-state span to measure.'
    );
  else
    with running as (
      select os.asset_id,
        range_agg(tstzrange(
          greatest(os.started_at, v_from),
          least(coalesce(os.ended_at, v_to), v_to),
          '[)'
        )) as covered
      from public.operating_states os
      where os.organization_id = v_org
        and os.state = 'running'
        and least(coalesce(os.ended_at, v_to), v_to) > greatest(os.started_at, v_from)
      group by os.asset_id
    ), down as (
      select os.asset_id,
        range_agg(tstzrange(
          greatest(os.started_at, v_from),
          least(coalesce(os.ended_at, v_to), v_to),
          '[)'
        )) as covered
      from public.operating_states os
      where os.organization_id = v_org
        and os.state in ('down_planned', 'down_unplanned')
        and least(coalesce(os.ended_at, v_to), v_to) > greatest(os.started_at, v_from)
      group by os.asset_id
    ), other as (
      select os.asset_id,
        range_agg(tstzrange(
          greatest(os.started_at, v_from),
          least(coalesce(os.ended_at, v_to), v_to),
          '[)'
        )) as covered
      from public.operating_states os
      where os.organization_id = v_org
        and os.state in ('idle', 'standby', 'offline')
        and least(coalesce(os.ended_at, v_to), v_to) > greatest(os.started_at, v_from)
      group by os.asset_id
    )
    select
      coalesce((
        select sum(extract(epoch from (upper(piece) - lower(piece))) / 3600.0)
        from running r
        cross join lateral unnest(r.covered) as ranges(piece)
      ), 0),
      coalesce((
        select sum(extract(epoch from (upper(piece) - lower(piece))) / 3600.0)
        from down d
        cross join lateral unnest(d.covered) as ranges(piece)
      ), 0),
      coalesce((
        select sum(extract(epoch from (upper(piece) - lower(piece))) / 3600.0)
        from other o
        cross join lateral unnest(o.covered) as ranges(piece)
      ), 0),
      (
        select count(*)::int
        from running r
        join down d on d.asset_id = r.asset_id
        where r.covered && d.covered
      )
    into v_running, v_down, v_other, v_conflicts;

    if v_conflicts > 0 then
      v_availability := jsonb_build_object(
        'status', 'not_measurable',
        'value', null,
        'unit', '%',
        'running_hours', null,
        'down_hours', null,
        'other_hours', round(v_other, 1),
        'conflict_assets', v_conflicts,
        'window_from', v_from,
        'window_to', v_to,
        'window_source', v_window_source,
        'basis', format(
          '%s asset(s) have a running interval overlapping a down interval. The ratio is withheld.',
          v_conflicts
        )
      );
    elsif v_running + v_down <= 0 then
      v_availability := jsonb_build_object(
        'status', 'not_measurable',
        'value', null,
        'unit', '%',
        'running_hours', round(v_running, 1),
        'down_hours', round(v_down, 1),
        'other_hours', round(v_other, 1),
        'conflict_assets', 0,
        'window_from', v_from,
        'window_to', v_to,
        'window_source', v_window_source,
        'basis', case
          when v_other > 0 then
            'Operating states in this window are idle, standby, or offline. Those hours stay outside the running-plus-down ratio.'
          else
            'No running or down operating-state time falls in this window.'
        end
      );
    else
      v_availability := jsonb_build_object(
        'status', 'measured',
        'value', round(100.0 * v_running / (v_running + v_down), 1),
        'unit', '%',
        'running_hours', round(v_running, 1),
        'down_hours', round(v_down, 1),
        'other_hours', round(v_other, 1),
        'conflict_assets', 0,
        'window_from', v_from,
        'window_to', v_to,
        'window_source', v_window_source,
        'basis', 'Availability is unioned running hours divided by unioned running plus down hours. Idle, standby, and offline hours stay outside the ratio. Work-order downtime hours are not the exposure.'
      );
    end if;
  end if;

  select
    count(*),
    count(*) filter (
      where job_plan_id is not null
        and planned_hours is not null
        and planned_hours > 0
    )
  into v_open, v_planning
  from public.work_orders
  where organization_id = v_org and completed_at is null;

  select
    count(distinct l.work_order_id),
    count(distinct l.work_order_id) filter (
      where not exists (
        select 1
        from public.work_order_materials m
        where m.work_order_id = l.work_order_id
          and m.organization_id = v_org
          and m.status not in ('reserved', 'kitted', 'issued', 'cancelled')
      )
    )
  into v_demand, v_ready
  from public.work_order_materials l
  join public.work_orders w
    on w.id = l.work_order_id
   and w.organization_id = v_org
   and w.completed_at is null
  where l.organization_id = v_org;

  if v_open = 0 then
    v_backlog := jsonb_build_object(
      'status', 'not_measurable',
      'open_work_orders', 0,
      'planning_complete', 0,
      'planning_complete_pct', null,
      'materials_status', 'not_measurable',
      'materials_ready', null,
      'materials_with_demand', 0,
      'materials_ready_pct', null,
      'basis', 'Backlog quality needs open work orders. An empty backlog is not a perfect score.'
    );
  elsif v_demand = 0 then
    v_backlog := jsonb_build_object(
      'status', 'partial',
      'open_work_orders', v_open,
      'planning_complete', v_planning,
      'planning_complete_pct', round(100.0 * v_planning / v_open, 1),
      'materials_status', 'not_measurable',
      'materials_ready', null,
      'materials_with_demand', 0,
      'materials_ready_pct', null,
      'basis', 'Planning completeness is open work with an applied job plan and planned hours. Material readiness stays unmeasured until a work order carries material demand. The two are not blended, and a parts-ready flag is not readiness.'
    );
  else
    v_backlog := jsonb_build_object(
      'status', 'measured',
      'open_work_orders', v_open,
      'planning_complete', v_planning,
      'planning_complete_pct', round(100.0 * v_planning / v_open, 1),
      'materials_status', 'measured',
      'materials_ready', v_ready,
      'materials_with_demand', v_demand,
      'materials_ready_pct', round(100.0 * v_ready / v_demand, 1),
      'basis', 'Planning completeness is open work with an applied job plan and planned hours. Material readiness is open work whose every material line is reserved, kitted, issued, or cancelled. The two percentages stay separate.'
    );
  end if;

  v_measurable := 0;
  v_mixed := 0;
  v_no_rate := 0;
  v_uoms := 0;
  v_uom := null;
  v_units := null;
  v_loss_rows := '[]'::jsonb;
  if v_from is null or v_to is null or v_to <= v_from then
    v_loss := jsonb_build_object(
      'status', 'not_measurable',
      'units_lost', null,
      'unit_of_measure', null,
      'sum_refused', false,
      'assets_measurable', 0,
      'assets_excluded_mixed_units', 0,
      'assets_excluded_no_rate', 0,
      'by_asset', '[]'::jsonb,
      'window_from', v_from,
      'window_to', v_to,
      'window_source', v_window_source,
      'basis', 'Production loss needs this tenant''s operating states and production records. Loss is the downtime hours times the rate the asset demonstrated while running.'
    );
  else
    with running as (
      select os.asset_id,
        range_agg(tstzrange(
          greatest(os.started_at, v_from),
          least(coalesce(os.ended_at, v_to), v_to),
          '[)'
        )) as covered
      from public.operating_states os
      where os.organization_id = v_org
        and os.state = 'running'
        and least(coalesce(os.ended_at, v_to), v_to) > greatest(os.started_at, v_from)
      group by os.asset_id
    ), running_hours as (
      select r.asset_id,
        sum(extract(epoch from (upper(piece) - lower(piece))) / 3600.0) as hours
      from running r
      cross join lateral unnest(r.covered) as ranges(piece)
      group by r.asset_id
    ), down as (
      select os.asset_id,
        range_agg(tstzrange(
          greatest(os.started_at, v_from),
          least(coalesce(os.ended_at, v_to), v_to),
          '[)'
        )) as covered
      from public.operating_states os
      where os.organization_id = v_org
        and os.state in ('down_planned', 'down_unplanned')
        and least(coalesce(os.ended_at, v_to), v_to) > greatest(os.started_at, v_from)
      group by os.asset_id
    ), down_hours as (
      select d.asset_id,
        sum(extract(epoch from (upper(piece) - lower(piece))) / 3600.0) as hours
      from down d
      cross join lateral unnest(d.covered) as ranges(piece)
      group by d.asset_id
    ), produced as (
      select p.asset_id,
        count(distinct p.unit_of_measure)::int as uom_count,
        min(p.unit_of_measure) as uom,
        sum(p.units_produced) as units
      from public.production_records p
      where p.organization_id = v_org
        and p.asset_id is not null
        and p.period_start < v_to
        and p.period_end > v_from
      group by p.asset_id
    ), judged as (
      select
        a.name as asset,
        coalesce(dh.hours, 0) as down_hours,
        rh.hours as running_hours,
        pr.uom,
        pr.units,
        case
          when pr.uom_count > 1 then 'mixed_unit'
          when pr.uom_count is distinct from 1 or coalesce(rh.hours, 0) <= 0
            then 'no_demonstrated_rate'
          else 'measured'
        end as row_status,
        case
          when pr.uom_count = 1 and coalesce(rh.hours, 0) > 0
            then coalesce(dh.hours, 0) * (pr.units / rh.hours)
          else null
        end as units_lost
      from public.assets a
      left join running_hours rh on rh.asset_id = a.id
      left join down_hours dh on dh.asset_id = a.id
      left join produced pr on pr.asset_id = a.id
      where a.organization_id = v_org
        and (rh.asset_id is not null or dh.asset_id is not null or pr.asset_id is not null)
    )
    select
      count(*) filter (where row_status = 'measured'),
      count(*) filter (where row_status = 'mixed_unit'),
      count(*) filter (where row_status = 'no_demonstrated_rate'),
      count(distinct uom) filter (where row_status = 'measured'),
      min(uom) filter (where row_status = 'measured'),
      sum(units_lost) filter (where row_status = 'measured'),
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'asset', s.asset,
          'units_lost', round(s.units_lost::numeric, 1),
          'unit_of_measure', s.uom,
          'down_hours', round(s.down_hours::numeric, 1),
          'demonstrated_rate', round((s.units / s.running_hours)::numeric, 3)
        ) order by s.units_lost desc)
        from (
          select *
          from judged
          where row_status = 'measured'
          order by units_lost desc
          limit 20
        ) s
      ), '[]'::jsonb)
    into v_measurable, v_mixed, v_no_rate, v_uoms, v_uom, v_units, v_loss_rows
    from judged;

    if v_measurable = 0 then
      v_loss := jsonb_build_object(
        'status', 'not_measurable',
        'units_lost', null,
        'unit_of_measure', null,
        'sum_refused', false,
        'assets_measurable', 0,
        'assets_excluded_mixed_units', v_mixed,
        'assets_excluded_no_rate', v_no_rate,
        'by_asset', '[]'::jsonb,
        'window_from', v_from,
        'window_to', v_to,
        'window_source', v_window_source,
        'basis', 'Production loss is downtime hours times the rate each asset demonstrated while running, in that asset''s own unit. Nameplate capacity is refused. An asset with mixed units, no production record, or no running hours is excluded.'
      );
    elsif v_uoms <> 1 then
      v_loss := jsonb_build_object(
        'status', 'measured',
        'units_lost', null,
        'unit_of_measure', null,
        'sum_refused', true,
        'assets_measurable', v_measurable,
        'assets_excluded_mixed_units', v_mixed,
        'assets_excluded_no_rate', v_no_rate,
        'by_asset', v_loss_rows,
        'window_from', v_from,
        'window_to', v_to,
        'window_source', v_window_source,
        'basis', 'Each measurable asset has its own demonstrated loss. Mixed units are not summed into one fleet total.'
      );
    else
      v_loss := jsonb_build_object(
        'status', 'measured',
        'units_lost', round(v_units, 1),
        'unit_of_measure', v_uom,
        'sum_refused', false,
        'assets_measurable', v_measurable,
        'assets_excluded_mixed_units', v_mixed,
        'assets_excluded_no_rate', v_no_rate,
        'by_asset', v_loss_rows,
        'window_from', v_from,
        'window_to', v_to,
        'window_source', v_window_source,
        'basis', format(
          'Fleet loss sums demonstrated loss for assets that share the unit %s. Nameplate capacity is refused.',
          v_uom
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'historical_fleet_studies_used', false,
    'authority', 'read only — creates no work, approval, risk acceptance, spend, operating-limit change, or return to service',
    'population', jsonb_build_object(
      'work_orders', v_wo,
      'work_orders_without_source_system', v_wo_unsourced,
      'operating_state_rows', v_state_rows,
      'production_rows', v_production_rows
    ),
    'emergency_work', v_emergency,
    'repeat_failures', v_repeats,
    'availability', v_availability,
    'backlog_quality', v_backlog,
    'production_loss', v_loss
  );
end
$proof$;

revoke all on function public.get_stage1_measured_pilot_proof(int)
  from public, anon, service_role;
grant execute on function public.get_stage1_measured_pilot_proof(int)
  to authenticated;

notify pgrst, 'reload schema';

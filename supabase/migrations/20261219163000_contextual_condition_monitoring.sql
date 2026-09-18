-- ============================================================================
-- C9.04 — historian + condition monitoring WITH operating context.
--
-- The canonical ingredients already exist: condition_readings, sensors,
-- operating_states and the read-only plant_historian connector. This composes
-- them at read time. It does not create a second time-series store and it does
-- not relabel seed/sim/manual readings as live plant evidence.
--
-- Context is matched only when an operating-state interval for the same asset
-- actually covers the reading timestamp. Missing context remains UNKNOWN; it
-- is never inferred from the nearest row. The RPC is tenant-scoped through
-- app_current_org() and is read-only.
-- ============================================================================

create or replace function public.get_contextual_condition_monitoring(
  p_window_days int default 30,
  p_limit int default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_window int := least(greatest(coalesce(p_window_days, 30), 1), 365);
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 100);
  v_connector_key text;
  v_connector_enabled boolean := false;
  v_total bigint := 0;
  v_contextualized bigint := 0;
  v_connector_backed bigint := 0;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select c.connector_key, c.enabled
    into v_connector_key, v_connector_enabled
  from public.connectors c
  where c.organization_id = v_org
    and c.connector_type = 'plant_historian'
  order by c.enabled desc, c.last_success_at desc nulls last, c.created_at desc
  limit 1;

  with scoped as (
    select cr.id, cr.asset_id, cr.taken_at, cr.source_system
    from public.condition_readings cr
    where cr.organization_id = v_org
      and cr.taken_at >= now() - make_interval(days => v_window)
  )
  select
    count(*),
    count(*) filter (where exists (
      select 1
      from public.operating_states os
      where os.organization_id = v_org
        and os.asset_id = scoped.asset_id
        and os.started_at <= scoped.taken_at
        and (os.ended_at is null or os.ended_at > scoped.taken_at)
    )),
    count(*) filter (
      where v_connector_enabled
        and v_connector_key is not null
        and scoped.source_system = v_connector_key
    )
  into v_total, v_contextualized, v_connector_backed
  from scoped;

  return jsonb_build_object(
    'window_days', v_window,
    'summary', jsonb_build_object(
      'readings', v_total,
      'contextualized', v_contextualized,
      'context_unknown', v_total - v_contextualized,
      'context_coverage_pct', case when v_total > 0
        then round(100.0 * v_contextualized / v_total, 1) end,
      'connector_backed', v_connector_backed,
      'other_source', v_total - v_connector_backed
    ),
    'source', jsonb_build_object(
      'connector_key', v_connector_key,
      'connector_enabled', v_connector_enabled,
      'basis', case
        when v_connector_enabled and v_connector_key is not null then
          format('%s is the enabled read-only plant source. Only readings whose source_system equals that connector key are labelled connector-backed.', v_connector_key)
        else
          'No enabled plant historian owns telemetry for this tenant. Readings are retained as seed, simulated or imported evidence and are not labelled live plant data.'
      end
    ),
    'readings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'asset_id', q.asset_id,
        'asset', q.asset,
        'sensor', q.sensor,
        'signal_type', q.signal_type,
        'unit', q.unit,
        'value', q.value,
        'quality', q.quality,
        'taken_at', q.taken_at,
        'source_system', q.source_system,
        'source_posture', case
          when v_connector_enabled and v_connector_key is not null
            and q.source_system = v_connector_key then 'connector_backed'
          else 'seed_sim_or_import'
        end,
        'context_known', q.operating_state_id is not null,
        'operating_state', q.operating_state,
        'load_pct', q.load_pct,
        'operating_reason', q.operating_reason,
        'operating_source', q.operating_source
      ) order by q.taken_at desc)
      from (
        select
          cr.id, cr.asset_id, a.name as asset, s.name as sensor,
          s.signal_type, s.unit, cr.value, cr.quality, cr.taken_at,
          cr.source_system, os.id as operating_state_id,
          os.state as operating_state, os.load_pct,
          os.reason_code as operating_reason, os.source_system as operating_source
        from public.condition_readings cr
        join public.sensors s
          on s.id = cr.sensor_id and s.organization_id = v_org
        left join public.assets a
          on a.id = cr.asset_id and a.organization_id = v_org
        left join lateral (
          select x.id, x.state, x.load_pct, x.reason_code, x.source_system
          from public.operating_states x
          where x.organization_id = v_org
            and x.asset_id = cr.asset_id
            and x.started_at <= cr.taken_at
            and (x.ended_at is null or x.ended_at > cr.taken_at)
          order by x.started_at desc
          limit 1
        ) os on true
        where cr.organization_id = v_org
          and cr.taken_at >= now() - make_interval(days => v_window)
        order by cr.taken_at desc
        limit v_limit
      ) q
    ), '[]'::jsonb),
    'basis', case
      when v_total = 0 then
        format('No condition readings exist in the last %s days. No condition or operating conclusion can be drawn.', v_window)
      when v_contextualized = 0 then
        'Condition readings exist, but none has a covering operating-state interval. Duty remains unknown; SyncAI will not infer it from a nearby state.'
      else
        format('%s of %s readings have a same-asset operating-state interval covering the exact reading time. Unknown context remains explicit.', v_contextualized, v_total)
    end
  );
end
$$;

revoke all on function public.get_contextual_condition_monitoring(int, int)
  from public, anon;
grant execute on function public.get_contextual_condition_monitoring(int, int)
  to authenticated;

comment on function public.get_contextual_condition_monitoring(int, int) is
  'C9.04 read-only tenant-scoped composition of condition readings with exact-time operating context and honest plant-source posture.';

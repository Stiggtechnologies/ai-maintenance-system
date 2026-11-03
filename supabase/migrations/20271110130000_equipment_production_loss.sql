-- C6.04: enterprise total production loss attributable to equipment.
--
-- Replaces get_production_loss. The previous body multiplied every planned and
-- unplanned down hour by a demonstrated rate and called that equipment loss.
-- C3.10 attributes loss by category, and C2.06 already stores the named-human
-- classification on the canonical operating-state event. Only the latest
-- equipment_failure interpretation enters this total. Planned, operations,
-- external, other and unclassified downtime stay visible as exclusions.
--
-- Hours are unioned per asset so overlapping states are not counted twice.
-- The rate is units produced divided by unioned running hours in the same
-- window. Mixed units and missing rate evidence stay not measurable. Nameplate
-- capacity is not consulted. No second loss ledger is created.

create or replace function public.get_production_loss(
  p_window_days int default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $loss$
declare
  v_org uuid := public.app_current_org();
  v_days int := least(greatest(coalesce(p_window_days, 90), 1), 730);
  v_from timestamptz;
  v_to timestamptz := now();
  v_rows jsonb;
  v_totals jsonb;
  v_excluded jsonb;
  v_unmeasured numeric;
  v_mixed int;
  v_assets int;
  v_basis text;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  v_from := v_to - make_interval(days => v_days);

  with running_ranges as (
    select os.asset_id,
      range_agg(tstzrange(
        greatest(os.started_at, v_from),
        least(coalesce(os.ended_at, v_to), v_to),
        '[)'
      )) as covered
    from public.operating_states os
    where os.organization_id = v_org
      and os.state = 'running'
      and os.started_at < v_to
      and coalesce(os.ended_at, v_to) > v_from
    group by os.asset_id
  ), running as (
    select rr.asset_id, coalesce(span.hours, 0) as hours
    from running_ranges rr
    cross join lateral (
      select coalesce(sum(extract(epoch from (upper(piece) - lower(piece))) / 3600.0), 0) as hours
      from unnest(rr.covered) as ranges(piece)
    ) span
  ), produced as (
    select p.asset_id,
      sum(p.units_produced) as units,
      min(p.unit_of_measure) as uom,
      count(distinct p.unit_of_measure) as unit_count
    from public.production_records p
    where p.organization_id = v_org
      and p.asset_id is not null
      and p.period_start >= v_from
      and p.period_end <= v_to
    group by p.asset_id
  ), rate as (
    select p.asset_id,
      p.units / nullif(r.hours, 0) as units_per_hour,
      p.uom
    from produced p
    join running r on r.asset_id = p.asset_id
    where r.hours > 0 and p.unit_count = 1
  ), latest_review as (
    select distinct on (d.operating_state_id)
      d.operating_state_id, d.id, d.classification
    from public.downtime_classification_reviews d
    where d.organization_id = v_org
    order by d.operating_state_id, d.classified_at desc, d.id desc
  ), down as (
    select s.id, s.asset_id, s.started_at, s.ended_at,
      coalesce(lr.classification, 'unclassified') as classification,
      lr.id as review_id
    from public.operating_states s
    left join latest_review lr on lr.operating_state_id = s.id
    where s.organization_id = v_org
      and s.state in ('down_planned', 'down_unplanned', 'offline')
      and s.started_at < v_to
      and coalesce(s.ended_at, v_to) > v_from
  ), equipment_ranges as (
    select d.asset_id,
      range_agg(tstzrange(
        greatest(d.started_at, v_from),
        least(coalesce(d.ended_at, v_to), v_to),
        '[)'
      )) as covered,
      array_agg(d.id order by d.id) as state_ids,
      array_agg(d.review_id order by d.id) as review_ids
    from down d
    where d.classification = 'equipment_failure'
    group by d.asset_id
  ), equipment_hours as (
    select er.asset_id, er.state_ids, er.review_ids,
      coalesce(span.hours, 0) as down_hours
    from equipment_ranges er
    cross join lateral (
      select coalesce(sum(extract(epoch from (upper(piece) - lower(piece))) / 3600.0), 0) as hours
      from unnest(er.covered) as ranges(piece)
    ) span
  ), class_ranges as (
    select d.asset_id, d.classification,
      range_agg(tstzrange(
        greatest(d.started_at, v_from),
        least(coalesce(d.ended_at, v_to), v_to),
        '[)'
      )) as covered,
      count(*)::int as events
    from down d
    group by d.asset_id, d.classification
  ), class_hours as (
    select cr.classification,
      sum(cr.events)::int as events,
      coalesce(sum(span.hours), 0) as down_hours
    from class_ranges cr
    cross join lateral (
      select coalesce(sum(extract(epoch from (upper(piece) - lower(piece))) / 3600.0), 0) as hours
      from unnest(cr.covered) as ranges(piece)
    ) span
    group by cr.classification
  ), measurable as (
    select a.name as asset, a.id as asset_id,
      round(eh.down_hours::numeric, 1) as down_hours,
      round(rt.units_per_hour::numeric, 3) as demonstrated_rate,
      rt.uom as unit_of_measure,
      round((eh.down_hours * rt.units_per_hour)::numeric, 1) as units_lost,
      to_jsonb(eh.state_ids) as operating_state_ids,
      to_jsonb(eh.review_ids) as classification_review_ids
    from equipment_hours eh
    join rate rt on rt.asset_id = eh.asset_id
    join public.assets a on a.id = eh.asset_id and a.organization_id = v_org
    where eh.down_hours > 0
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
      'asset', m.asset,
      'asset_id', m.asset_id,
      'down_hours', m.down_hours,
      'demonstrated_rate', m.demonstrated_rate,
      'unit_of_measure', m.unit_of_measure,
      'units_lost', m.units_lost,
      'operating_state_ids', m.operating_state_ids,
      'classification_review_ids', m.classification_review_ids
    ) order by m.units_lost desc, m.asset), '[]'::jsonb) from measurable m),
    (select coalesce(jsonb_agg(jsonb_build_object(
      'unit_of_measure', t.unit_of_measure,
      'assets', t.assets,
      'down_hours', t.down_hours,
      'units_lost', t.units_lost
    ) order by t.unit_of_measure), '[]'::jsonb)
    from (
      select unit_of_measure, count(*)::int as assets,
        round(sum(down_hours), 1) as down_hours,
        round(sum(units_lost), 1) as units_lost
      from measurable
      group by unit_of_measure
    ) t),
    (select coalesce(jsonb_agg(jsonb_build_object(
      'classification', c.classification,
      'events', c.events,
      'down_hours', round(c.down_hours::numeric, 1)
    ) order by c.down_hours desc, c.classification), '[]'::jsonb)
    from class_hours c
    where c.classification <> 'equipment_failure'),
    (select round(coalesce(sum(eh.down_hours), 0)::numeric, 1)
     from equipment_hours eh
     left join rate rt on rt.asset_id = eh.asset_id
     where rt.asset_id is null),
    (select count(*)::int from produced p where p.unit_count > 1),
    (select count(*)::int from public.assets a where a.organization_id = v_org)
  into v_rows, v_totals, v_excluded, v_unmeasured, v_mixed, v_assets;

  v_basis := case
    when jsonb_array_length(v_rows) = 0 then
      'No asset has both equipment-failure downtime and one demonstrated production rate in this window. Unclassified and non-equipment downtime are excluded. Loss is not estimated from nameplate capacity.'
    else
      'Equipment-failure downtime, with overlapping intervals unioned per asset, multiplied by the rate that asset demonstrated while running. Other classifications and mixed units are excluded. Unlike units are not added. Nameplate capacity is not used.'
  end;

  return jsonb_build_object(
    'window_days', v_days,
    'by_asset', v_rows,
    'assets_measurable', jsonb_array_length(v_rows),
    'assets', v_assets,
    'totals_by_unit', v_totals,
    'exclusions', v_excluded,
    'not_measurable_equipment_hours', v_unmeasured,
    'mixed_unit_assets', v_mixed,
    'basis', v_basis,
    'attribution_rule', 'equipment_failure only',
    'decision_boundary', 'This total does not release work, accept risk, commit spend, change an operating limit, or return equipment to service.'
  );
end
$loss$;

revoke all on function public.get_production_loss(int)
  from public, anon, service_role;
grant execute on function public.get_production_loss(int) to authenticated;

create or replace function public.record_equipment_production_loss_receipt(
  p_window_days int default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $receipt$
declare
  v_org uuid := public.app_current_org();
  v_loss jsonb;
  v_audit uuid;
begin
  if v_org is null or auth.uid() is null
     or not public.production_loss_human_role_allowed() then
    return jsonb_build_object('error',
      'recording an equipment production-loss receipt requires a named human operations, planning, maintenance or reliability role');
  end if;

  v_loss := public.get_production_loss(p_window_days);
  if v_loss ? 'error' then
    return v_loss;
  end if;

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (
    v_org,
    'equipment_production_loss',
    public.app_current_role(),
    jsonb_build_object(
      'action', 'measurement_recorded',
      'window_days', v_loss->'window_days',
      'totals_by_unit', v_loss->'totals_by_unit',
      'assets_measurable', v_loss->'assets_measurable',
      'exclusions', v_loss->'exclusions',
      'not_measurable_equipment_hours', v_loss->'not_measurable_equipment_hours',
      'mixed_unit_assets', v_loss->'mixed_unit_assets',
      'basis', v_loss->'basis',
      'measurement_sha256', encode(sha256(convert_to(v_loss::text, 'UTF8')), 'hex'),
      'actor_id', auth.uid(),
      'production_value_authorized', false,
      'work_released', false,
      'risk_accepted', false,
      'return_to_service_authorized', false
    )
  )
  returning id into v_audit;

  return v_loss || jsonb_build_object(
    'recorded', true,
    'audit_event_id', v_audit,
    'authority', 'receipt only; no work, risk, spend or return-to-service authority'
  );
end
$receipt$;

revoke all on function public.record_equipment_production_loss_receipt(int)
  from public, anon, service_role;
grant execute on function public.record_equipment_production_loss_receipt(int)
  to authenticated;

comment on function public.get_production_loss(int) is
  'C6.04 tenant total of production loss attributable to equipment: unioned equipment_failure downtime times demonstrated running rate. Nameplate is not used. No execution authority.';
comment on function public.record_equipment_production_loss_receipt(int) is
  'C6.04 append-only audit receipt of the current equipment production-loss total. It does not create a second ledger or authorize work, risk, spend or return to service.';

notify pgrst, 'reload schema';

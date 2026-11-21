-- C6.24 warning lead time becomes measurable from a named-human observation.
--
-- Canonical reuse only: sensors, condition_readings, condition_alerts,
-- work_orders, audit_events, app_current_org(). No parallel store.
--
-- The clock is the alert's triggered_at (the reading that crossed a limit the
-- tenant already configured) to the linked same-asset work order. A second
-- clock, to recorded completed_at, is reported separately and is omitted when
-- completion was not recorded. Open unlinked alerts are backlog age, not lead
-- time, and they never enter the average.
--
-- Worked sample, not a stored threshold: warnings 10 hours and 30 hours before
-- the work order average to 20.0 hours. A work order raised before the warning
-- is excluded, not clamped to zero. DEMO readings and an inactive sensor do
-- not create a number.
--
-- Recording or linking does not authorize work, accept risk, change a limit,
-- or return equipment to service.

create or replace function public.protect_condition_alert_linkage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'condition alerts are retained';
  end if;
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.sensor_id is distinct from old.sensor_id
       or new.asset_id is distinct from old.asset_id
       or new.triggered_at is distinct from old.triggered_at
       or new.triggered_value is distinct from old.triggered_value
       or new.limit_value is distinct from old.limit_value
       or new.severity is distinct from old.severity
       or new.register_ref is distinct from old.register_ref
       or new.created_at is distinct from old.created_at then
      raise exception 'condition alert evidence is immutable';
    end if;
    if new.work_order_id is distinct from old.work_order_id
       and coalesce(current_setting('app.condition_alert_link', true), '') <> 'granted' then
      raise exception 'condition alert linkage is written only by link_alert_to_work';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.protect_condition_alert_linkage() from public, anon, authenticated;

drop trigger if exists trg_protect_condition_alert_linkage on public.condition_alerts;
create trigger trg_protect_condition_alert_linkage
  before update or delete on public.condition_alerts
  for each row execute function public.protect_condition_alert_linkage();

create or replace function public.record_condition_observation(
  p_sensor_id uuid,
  p_value numeric,
  p_taken_at timestamptz,
  p_quality text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  s sensors%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role from user_profiles
  where id = auth.uid() and organization_id = v_org;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error', 'ai_admin cannot record a condition observation');
  end if;
  if coalesce(v_role, '') not in ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'a named reliability engineer, maintenance manager or administrator is required');
  end if;
  if p_value is null or p_value <> p_value or not isfinite(p_value) then
    return jsonb_build_object('error', 'the reading must be a finite number');
  end if;
  if p_taken_at is null then
    return jsonb_build_object('error', 'the observation time is required');
  end if;
  if p_taken_at > now() + interval '5 minutes' then
    return jsonb_build_object('error', 'an observation time in the future is refused');
  end if;
  if coalesce(p_quality, '') not in ('good', 'suspect', 'bad', 'substituted') then
    return jsonb_build_object('error', 'quality must be good, suspect, bad or substituted');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error', 'state what was observed and why this reading is evidence (20 characters minimum)');
  end if;

  select * into s from sensors
  where id = p_sensor_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'sensor not found');
  end if;
  if s.registry_status is distinct from 'active' then
    return jsonb_build_object(
      'error', 'the sensor is not active; inactive and decommissioned measurement points record no reading and no lead time',
      'registry_status', s.registry_status);
  end if;
  if s.warning_limit is null and s.alarm_limit is null then
    return jsonb_build_object('error', 'this sensor has no warning or alarm limit, so a crossing — and therefore lead time — cannot be measured');
  end if;

  v_result := public.record_condition_reading(
    p_sensor_id, p_value, p_taken_at, p_quality, 'governed_observation', null);
  if v_result ? 'error' then
    return v_result;
  end if;

  insert into audit_events(organization_id, entity_type, actor, event_data)
  values (v_org, 'condition_alert', v_role, jsonb_build_object(
    'action', 'condition_observation_recorded',
    'sensor_id', p_sensor_id,
    'asset_id', s.asset_id,
    'value', p_value,
    'taken_at', p_taken_at,
    'quality', p_quality,
    'basis', btrim(p_basis),
    'alert_id', v_result -> 'alert_id',
    'alerted', coalesce(v_result->>'alert_id', '') <> '',
    'severity', v_result -> 'severity',
    'actor_id', auth.uid(),
    'source_system', 'governed_observation',
    'mayAuthorizeWork', false,
    'mayChangeLimits', false,
    'mayReturnToService', false));

  return v_result || jsonb_build_object(
    'mayAuthorizeWork', false,
    'mayChangeLimits', false,
    'mayReturnToService', false);
end
$$;

revoke all on function public.record_condition_observation(uuid, numeric, timestamptz, text, text)
  from public, anon;
grant execute on function public.record_condition_observation(uuid, numeric, timestamptz, text, text)
  to authenticated;

create or replace function public.link_alert_to_work(
  p_alert_id uuid,
  p_work_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_alert condition_alerts%rowtype;
  v_wo work_orders%rowtype;
  v_hours numeric;
  v_linked boolean;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role from user_profiles
  where id = auth.uid() and organization_id = v_org;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error', 'ai_admin cannot link a condition alert to work');
  end if;
  if coalesce(v_role, '') not in ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'a named reliability engineer, maintenance manager or administrator is required');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_alert_id::text, 0));

  select * into v_alert from condition_alerts
  where id = p_alert_id and organization_id = v_org;
  if v_alert.id is null then
    return jsonb_build_object('error', 'alert not found');
  end if;
  select * into v_wo from work_orders
  where id = p_work_order_id and organization_id = v_org;
  if v_wo.id is null then
    return jsonb_build_object('error', 'work order not found');
  end if;
  if v_alert.asset_id is null or v_wo.asset_id is distinct from v_alert.asset_id then
    return jsonb_build_object('error', 'the work order is not on the alert asset');
  end if;
  if v_wo.created_at < v_alert.triggered_at then
    return jsonb_build_object('error', 'the work order was raised before this warning, so it is not warning lead time');
  end if;
  if not exists (
    select 1 from condition_readings cr
    where cr.organization_id = v_org
      and cr.sensor_id = v_alert.sensor_id
      and cr.quality = 'good'
      and cr.taken_at = v_alert.triggered_at
      and coalesce(cr.source_system, '') not like 'DEMO%'
  ) then
    return jsonb_build_object('error', 'this alert has no non-DEMO good reading at its trigger time, so it cannot enter the lead-time sample');
  end if;
  if v_alert.work_order_id = p_work_order_id then
    return jsonb_build_object(
      'linked', v_alert.id, 'work_order_id', p_work_order_id,
      'idempotent', true, 'mayAuthorizeWork', false);
  end if;
  if v_alert.work_order_id is not null then
    return jsonb_build_object('error', 'this alert is already linked; the measurement is not rewritten');
  end if;

  v_hours := round((extract(epoch from (v_wo.created_at - v_alert.triggered_at)) / 3600.0)::numeric, 1);
  perform set_config('app.condition_alert_link', 'granted', true);
  update condition_alerts
  set work_order_id = p_work_order_id
  where id = v_alert.id and organization_id = v_org and work_order_id is null;
  v_linked := found;
  perform set_config('app.condition_alert_link', '', true);
  if not v_linked then
    return jsonb_build_object('error', 'this alert is already linked; the measurement is not rewritten');
  end if;

  insert into audit_events(organization_id, entity_type, actor, event_data)
  values (v_org, 'condition_alert', v_role, jsonb_build_object(
    'action', 'condition_alert_linked',
    'alert_id', v_alert.id,
    'sensor_id', v_alert.sensor_id,
    'asset_id', v_alert.asset_id,
    'work_order_id', p_work_order_id,
    'triggered_at', v_alert.triggered_at,
    'work_created_at', v_wo.created_at,
    'warning_lead_hours', v_hours,
    'actor_id', auth.uid(),
    'mayAuthorizeWork', false));

  return jsonb_build_object(
    'linked', v_alert.id,
    'work_order_id', p_work_order_id,
    'warning_lead_hours', v_hours,
    'idempotent', false,
    'mayAuthorizeWork', false);
exception when others then
  perform set_config('app.condition_alert_link', '', true);
  raise;
end
$$;

revoke all on function public.link_alert_to_work(uuid, uuid) from public, anon;
grant execute on function public.link_alert_to_work(uuid, uuid) to authenticated;

create or replace function public.get_condition_monitoring()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_assets int;
  v_monitored int;
  v_critical int;
  v_critical_monitored int;
  v_readings bigint;
  v_qualifying int := 0;
  v_lead_hours numeric;
  v_lead_min numeric;
  v_lead_n int := 0;
  v_repair_hours numeric;
  v_repair_n int := 0;
  v_backlog_n int;
  v_backlog_age numeric;
  v_pm_total int;
  v_pm_finding int;
  v_pm_missed int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select count(*), count(*) filter (where criticality = 'critical')
  into v_assets, v_critical from assets where organization_id = v_org;

  select count(distinct s.asset_id),
         count(distinct s.asset_id) filter (where a.criticality = 'critical')
  into v_monitored, v_critical_monitored
  from sensors s join assets a on a.id = s.asset_id
  where s.organization_id = v_org;

  select count(*) into v_readings from condition_readings where organization_id = v_org;

  select count(*) into v_qualifying
  from condition_readings cr
  where cr.organization_id = v_org
    and cr.quality = 'good'
    and coalesce(cr.source_system, '') not like 'DEMO%';

  if v_qualifying > 0 then
    -- 10 h and 30 h before the work order average to 20.0. Earlier work is excluded.
    select count(*),
           round(avg(extract(epoch from (w.created_at - al.triggered_at)) / 3600.0)::numeric, 1),
           round(min(extract(epoch from (w.created_at - al.triggered_at)) / 3600.0)::numeric, 1),
           count(*) filter (
             where w.completed_at is not null and w.completed_at >= al.triggered_at),
           round(avg(extract(epoch from (w.completed_at - al.triggered_at)) / 3600.0)
             filter (where w.completed_at is not null and w.completed_at >= al.triggered_at)::numeric, 1)
    into v_lead_n, v_lead_hours, v_lead_min, v_repair_n, v_repair_hours
    from condition_alerts al
    join work_orders w
      on w.id = al.work_order_id
     and w.organization_id = al.organization_id
     and w.asset_id = al.asset_id
    where al.organization_id = v_org
      and al.asset_id is not null
      and w.created_at >= al.triggered_at
      and exists (
        select 1 from condition_readings cr
        where cr.organization_id = al.organization_id
          and cr.sensor_id = al.sensor_id
          and cr.quality = 'good'
          and cr.taken_at = al.triggered_at
          and coalesce(cr.source_system, '') not like 'DEMO%'
      );

    select count(*),
           round(avg(extract(epoch from (now() - al.triggered_at)) / 3600.0)::numeric, 1)
    into v_backlog_n, v_backlog_age
    from condition_alerts al
    where al.organization_id = v_org
      and al.cleared_at is null
      and al.work_order_id is null
      and exists (
        select 1 from condition_readings cr
        where cr.organization_id = al.organization_id
          and cr.sensor_id = al.sensor_id
          and cr.quality = 'good'
          and cr.taken_at = al.triggered_at
          and coalesce(cr.source_system, '') not like 'DEMO%'
      );
  end if;

  select count(*) into v_pm_total
  from work_orders
  where organization_id = v_org and work_type = 'preventive'
    and completed_at is not null;

  select count(*) into v_pm_finding
  from work_orders pm
  where pm.organization_id = v_org and pm.work_type = 'preventive'
    and pm.completed_at is not null
    and exists (
      select 1 from work_orders c
      where c.organization_id = v_org and c.asset_id = pm.asset_id
        and c.work_type = 'corrective'
        and c.created_at between pm.completed_at and pm.completed_at + interval '7 days');

  select count(*) into v_pm_missed
  from work_orders pm
  where pm.organization_id = v_org and pm.work_type = 'preventive'
    and pm.completed_at is not null
    and exists (
      select 1 from work_orders f
      where f.organization_id = v_org and f.asset_id = pm.asset_id
        and f.work_type = 'corrective'
        and f.priority in ('critical', 'high')
        and f.created_at between pm.completed_at + interval '7 days'
                            and pm.completed_at + interval '30 days');

  return jsonb_build_object(
    'coverage', jsonb_build_object(
      'assets', v_assets, 'monitored_assets', v_monitored,
      'coverage_pct', case when v_assets > 0
        then round(100.0 * v_monitored / v_assets, 1) end,
      'critical_assets', v_critical, 'critical_monitored', v_critical_monitored,
      'critical_coverage_pct', case when v_critical > 0
        then round(100.0 * v_critical_monitored / v_critical, 1) end,
      'readings', v_readings,
      'qualifying_readings', v_qualifying,
      'basis', case when v_qualifying = 0
        then 'No non-DEMO good reading exists yet. Warning lead time stays unavailable — an inactive sensor and an empty series do not become a number. Record a governed observation or connect a historian.'
        else 'Qualifying reading history is present. Lead time uses only alerts linked to later same-asset work.' end),
    'active_alerts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', al.id, 'asset_id', al.asset_id, 'asset', a.name, 'sensor', s.name,
        'severity', al.severity,
        'value', al.triggered_value, 'limit', al.limit_value,
        'triggered_at', al.triggered_at,
        'hours_open', round(extract(epoch from (now() - al.triggered_at)) / 3600.0, 1),
        'acknowledged', al.acknowledged_at is not null,
        'linked_work_order', al.work_order_id is not null)
        order by al.severity desc, al.triggered_at), '[]'::jsonb)
      from condition_alerts al
      join sensors s on s.id = al.sensor_id and s.organization_id = al.organization_id
      left join assets a on a.id = al.asset_id and a.organization_id = al.organization_id
      where al.organization_id = v_org and al.cleared_at is null),
    'observation_points', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'asset_id', s.asset_id, 'asset', a.name,
        'unit', s.unit, 'warning_limit', s.warning_limit, 'alarm_limit', s.alarm_limit,
        'limit_direction', s.limit_direction, 'registry_status', s.registry_status)
        order by a.name, s.name), '[]'::jsonb)
      from sensors s
      left join assets a on a.id = s.asset_id and a.organization_id = s.organization_id
      where s.organization_id = v_org
        and s.registry_status = 'active'
        and (s.warning_limit is not null or s.alarm_limit is not null)),
    'warning_lead_time', jsonb_build_object(
      'register_ref', 'C6.24',
      'available', coalesce(v_lead_n, 0) > 0,
      'value', case when coalesce(v_lead_n, 0) > 0 then v_lead_hours end,
      'unit', 'hours',
      'sample', coalesce(v_lead_n, 0),
      'min_hours', case when coalesce(v_lead_n, 0) > 0 then v_lead_min end,
      'basis', case
        when v_qualifying = 0 then
          'No non-DEMO good condition reading exists. Warning lead time, completion time and backlog age stay unavailable rather than zero.'
        when coalesce(v_lead_n, 0) > 0 then
          format('Mean hours from a linked condition alert to the same-asset work order raised at or after it, over %s alerts. A 10-hour warning and a 30-hour warning average to 20.0. Work raised before the warning is excluded.', v_lead_n)
        else
          'Qualifying readings exist, but no alert is linked to a later same-asset work order. Unlinked alerts are not lead time.'
      end,
      'to_repair', jsonb_build_object(
        'available', coalesce(v_repair_n, 0) > 0,
        'value', case when coalesce(v_repair_n, 0) > 0 then v_repair_hours end,
        'unit', 'hours',
        'sample', coalesce(v_repair_n, 0),
        'basis', 'Hours from the same warning to the linked work order recorded completed_at. Orders without a completion stay out of this average; creation time is not treated as repair time.'),
      'open_backlog', jsonb_build_object(
        'available', v_qualifying > 0,
        'count', case when v_qualifying > 0 then coalesce(v_backlog_n, 0) end,
        'mean_age_hours', case when v_qualifying > 0 and coalesce(v_backlog_n, 0) > 0 then v_backlog_age end,
        'unit', 'hours',
        'basis', case when v_qualifying = 0
          then 'Withheld. There is no qualifying reading, so an empty backlog is not reported as zero.'
          else 'Age of open alerts that have a qualifying reading and are not yet linked. This is backlog age, not warning lead time, and it does not enter the lead-time average.'
        end)),
    'pm_task_effectiveness', jsonb_build_object(
      'register_ref', 'C6.25',
      'available', v_pm_total > 0,
      'pm_completed', v_pm_total,
      'finding_rate_pct', case when v_pm_total > 0
        then round(100.0 * v_pm_finding / v_pm_total, 1) end,
      'missed_rate_pct', case when v_pm_total > 0
        then round(100.0 * v_pm_missed / v_pm_total, 1) end,
      'basis', 'Finding rate: preventive tasks followed by corrective work on the same asset within 7 days — the task found something. Missed rate: high or critical corrective work 7 to 30 days after a PM — the task did not look at the right thing. Both are proxies from work-order sequence; a PM findings field on closeout would make them direct (C8.07).'),
    'pf_intervals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'failure_mode', failure_mode, 'technique', detection_technique,
        'pf_interval_days', pf_interval_days,
        'recommended_inspection_days', recommended_inspection_days,
        'status', status, 'basis', basis)
        order by pf_interval_days), '[]'::jsonb)
      from pf_intervals where organization_id = v_org and status in ('draft', 'adopted')),
    'pf_note', 'P-F intervals are declared engineering reference data, seeded as drafts. Inspection at half the interval gives two opportunities inside the detectable window. Adopt or replace them before they inform a real inspection frequency.');
end
$$;

revoke all on function public.get_condition_monitoring() from public, anon;
grant execute on function public.get_condition_monitoring() to authenticated;

create or replace function public.derive_observed_pf(
  p_min_samples int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_rows jsonb;
  v_n int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'technique', t.name,
    'samples', x.n,
    'observed_pf_days_mean', x.mean_days,
    'observed_pf_days_min', x.min_days,
    'implied_inspection_days', round(x.min_days / 2.0, 1)
  ) order by x.n desc), '[]'::jsonb), count(*)
  into v_rows, v_n
  from (
    select s.technique_key,
           count(*)::int as n,
           round(avg(extract(epoch from (w.created_at - al.triggered_at)) / 86400.0)::numeric, 1) as mean_days,
           round(min(extract(epoch from (w.created_at - al.triggered_at)) / 86400.0)::numeric, 1) as min_days
    from condition_alerts al
    join sensors s on s.id = al.sensor_id and s.organization_id = al.organization_id
    join work_orders w
      on w.id = al.work_order_id
     and w.organization_id = al.organization_id
     and w.asset_id = al.asset_id
    where al.organization_id = v_org
      and w.created_at >= al.triggered_at
      and s.technique_key is not null
      and exists (
        select 1 from condition_readings cr
        where cr.organization_id = al.organization_id
          and cr.sensor_id = al.sensor_id
          and cr.quality = 'good'
          and cr.taken_at = al.triggered_at
          and coalesce(cr.source_system, '') not like 'DEMO%'
      )
    group by s.technique_key
    having count(*) >= greatest(p_min_samples, 1)
  ) x
  join detection_techniques t
    on t.organization_id = v_org and t.technique_key = x.technique_key;

  return jsonb_build_object(
    'observed', v_rows,
    'available', coalesce(v_n, 0) > 0,
    'min_samples', greatest(p_min_samples, 1),
    'basis', case when coalesce(v_n, 0) > 0
      then 'Derived from this organization''s own linked alert-to-work-order history on qualifying non-DEMO readings. The MINIMUM observed interval, not the mean, is the safe basis for an inspection frequency — the mean would leave half the population undetected. It does not authorize that frequency.'
      else 'Not enough linked alert-to-work history on qualifying readings yet. Until there is, P-F intervals remain declared engineering values (pf_intervals), never inferred from a thin sample or a DEMO series.' end);
end
$$;

revoke all on function public.derive_observed_pf(int) from public, anon;
grant execute on function public.derive_observed_pf(int) to authenticated;

-- ============================================================================
-- Condition monitoring: reading history, edge-triggered alerts, P-F intervals,
-- warning lead time and PM task effectiveness
-- (capability register C2.05, C6.24, C6.25; strengthens C2.04, C4.03).
--
-- The platform has 33 sensors across 13 of 37 assets, and the sensors table
-- stores ONLY last_value. There is no history. That single fact makes several
-- things impossible rather than merely inaccurate:
--
--   * no trend can be computed, so the `trend` column was decorative;
--   * no alert can be edge-triggered, so a sensor sitting above its limit
--     either screams on every read or is silently ignored;
--   * the P-F interval — the whole basis of condition-based maintenance —
--     has nowhere to live;
--   * warning lead time (C6.24) cannot be measured, because measuring it
--     means knowing WHEN the warning first appeared.
--
-- So the history is the slice. condition_readings is the time series;
-- condition_alerts records a CROSSING, not a state, which is what makes
-- "how much warning did we get?" answerable.
--
-- P-F INTERVALS ARE DECLARED, NOT INFERRED. The interval between a detectable
-- potential failure and functional failure is an engineering property of the
-- failure mode and the detection technique. It is seeded here as DRAFT
-- reference values with their basis stated, for an engineer to adopt or
-- replace — deriving it from thin history and presenting it as fact would put
-- an invented number underneath inspection intervals.
--
-- Canonical reuse: sensors, assets, work_orders, recommendations,
-- app_current_org(). Additive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The missing history
-- ----------------------------------------------------------------------------
create table if not exists condition_readings (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  sensor_id uuid not null references sensors(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  value numeric not null,
  -- Bad data that looks like good data is worse than a gap.
  quality text not null default 'good'
    check (quality in ('good', 'suspect', 'bad', 'substituted')),
  taken_at timestamptz not null default now(),
  source_system text,
  created_at timestamptz not null default now()
);

create index if not exists idx_condition_readings_series
  on condition_readings(sensor_id, taken_at desc);
create index if not exists idx_condition_readings_org
  on condition_readings(organization_id, taken_at desc);

alter table condition_readings enable row level security;
drop policy if exists condition_readings_org_read on condition_readings;
create policy condition_readings_org_read on condition_readings
  for select to authenticated using (organization_id = app_current_org());

alter table sensors
  add column if not exists warning_limit numeric,
  add column if not exists alarm_limit numeric,
  add column if not exists limit_direction text default 'above'
    check (limit_direction in ('above', 'below')),
  add column if not exists detection_technique text,
  add column if not exists source_system text;

comment on column sensors.limit_direction is
  'Whether the limit is breached going above (vibration, temperature) or below (lubricant pressure, flow). Assuming "above" for every signal silently disables alerting on the whole second class.';

-- Seed limits from the legacy single `threshold` where one exists, so the
-- migration does not quietly discard configuration that is already there.
update sensors
set alarm_limit = threshold,
    warning_limit = case when threshold is not null then round(threshold * 0.8, 4) end
where alarm_limit is null and threshold is not null;

comment on column sensors.warning_limit is
  'Derived at migration time as 80% of the legacy single threshold where no explicit warning limit existed. That fraction is a placeholder, not an engineering determination — set real warning limits per signal.';

-- ----------------------------------------------------------------------------
-- Alerts record a CROSSING, not a state
-- ----------------------------------------------------------------------------
create table if not exists condition_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  sensor_id uuid not null references sensors(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  severity text not null check (severity in ('warning', 'alarm')),
  triggered_value numeric not null,
  limit_value numeric not null,
  triggered_at timestamptz not null default now(),
  cleared_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  -- The link that makes lead time measurable: which work this warning produced.
  work_order_id uuid references work_orders(id) on delete set null,
  recommendation_id uuid references recommendations(id) on delete set null,
  register_ref text not null default 'C6.24',
  created_at timestamptz not null default now()
);

create index if not exists idx_condition_alerts_open
  on condition_alerts(organization_id, cleared_at, triggered_at desc);
create index if not exists idx_condition_alerts_asset
  on condition_alerts(asset_id, triggered_at);

alter table condition_alerts enable row level security;
drop policy if exists condition_alerts_org_read on condition_alerts;
create policy condition_alerts_org_read on condition_alerts
  for select to authenticated using (organization_id = app_current_org());

-- ----------------------------------------------------------------------------
-- P-F intervals: declared engineering reference data
-- ----------------------------------------------------------------------------
create table if not exists pf_intervals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_class text,
  failure_mode text not null,
  detection_technique text not null,
  pf_interval_days numeric not null check (pf_interval_days > 0),
  -- RCM practice: inspect at no more than half the P-F interval so at least
  -- two opportunities fall inside the detectable window.
  recommended_inspection_days numeric generated always as (pf_interval_days / 2) stored,
  basis text not null,
  status text not null default 'draft'
    check (status in ('draft', 'adopted', 'superseded')),
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  register_ref text not null default 'C2.05',
  created_at timestamptz not null default now(),
  unique (organization_id, asset_class, failure_mode, detection_technique)
);

alter table pf_intervals enable row level security;
drop policy if exists pf_intervals_org_read on pf_intervals;
create policy pf_intervals_org_read on pf_intervals
  for select to authenticated using (organization_id = app_current_org());

insert into pf_intervals (organization_id, asset_class, failure_mode,
  detection_technique, pf_interval_days, basis)
select o.id, v.cls, v.mode, v.tech, v.days, v.basis
from organizations o
cross join (values
  (null, 'Rolling-element bearing degradation', 'Vibration analysis', 60::numeric,
   'Draft reference. Vibration gives comparatively long warning on rolling-element bearings; the usable interval depends on speed, load and measurement location. Replace with the operator''s own condition-monitoring programme values before it informs an inspection interval.'),
  (null, 'Rolling-element bearing degradation', 'Oil analysis (wear debris)', 30::numeric,
   'Draft reference. Wear debris appears later than a vibration signature for the same mechanism, so the interval is shorter. Confirm against the operator''s laboratory turnaround, which consumes part of the interval.'),
  (null, 'Gear tooth wear', 'Oil analysis (wear debris)', 45::numeric,
   'Draft reference. Confirm against the operator''s programme.'),
  (null, 'Lubrication degradation', 'Oil analysis (condition)', 90::numeric,
   'Draft reference. Fluid condition typically degrades gradually and is sampled on a fixed cycle; the sampling cycle, not the mechanism, is often the binding constraint.'),
  (null, 'Electrical insulation degradation', 'Thermography', 30::numeric,
   'Draft reference. Thermographic detection depends on load at the time of survey — a survey taken at low load can miss a hot joint entirely.'),
  (null, 'Structural crack propagation', 'Visual and NDT inspection', 21::numeric,
   'Draft reference. Crack growth is highly non-linear and duty-dependent; this value must come from the operator''s structural engineering assessment before it is used.'),
  (null, 'Hydraulic seal leakage', 'Visual inspection', 14::numeric,
   'Draft reference. Short interval: seal leakage is usually visible only shortly before it becomes functionally significant.'),
  (null, 'Brake friction wear', 'Measurement and inspection', 30::numeric,
   'Draft reference. Safety-critical: the operator''s own wear-limit procedure governs and must replace this.')
) as v(cls, mode, tech, days, basis)
where not exists (
  select 1 from pf_intervals p
  where p.organization_id = o.id and p.failure_mode = v.mode
    and p.detection_technique = v.tech);

-- ----------------------------------------------------------------------------
-- Ingestion: one reading in, limits evaluated, alert raised only on a crossing
-- ----------------------------------------------------------------------------
create or replace function public.record_condition_reading(
  p_sensor_id uuid,
  p_value numeric,
  p_taken_at timestamptz default now(),
  p_quality text default 'good',
  p_source_system text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  s sensors%rowtype;
  v_sev text;
  v_limit numeric;
  v_open condition_alerts%rowtype;
  v_alert uuid;
  v_prev numeric;
  v_trend text;
begin
  select * into s from sensors where id = p_sensor_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'sensor not found');
  end if;

  select value into v_prev from condition_readings
  where sensor_id = p_sensor_id order by taken_at desc limit 1;

  insert into condition_readings (organization_id, sensor_id, asset_id, value,
    quality, taken_at, source_system)
  values (v_org, p_sensor_id, s.asset_id, p_value, p_quality, p_taken_at, p_source_system);

  -- Suspect and bad readings are stored — the gap itself is evidence — but they
  -- never drive an alert. Alarming on data you have already labelled untrusted
  -- is how a monitoring programme loses its audience.
  if p_quality in ('bad', 'suspect') then
    return jsonb_build_object('recorded', true, 'quality', p_quality,
      'alerted', false,
      'note', 'Reading stored but not evaluated against limits: quality is ' || p_quality);
  end if;

  if s.limit_direction = 'below' then
    v_sev := case
      when s.alarm_limit is not null and p_value <= s.alarm_limit then 'alarm'
      when s.warning_limit is not null and p_value <= s.warning_limit then 'warning' end;
    v_limit := case when v_sev = 'alarm' then s.alarm_limit else s.warning_limit end;
  else
    v_sev := case
      when s.alarm_limit is not null and p_value >= s.alarm_limit then 'alarm'
      when s.warning_limit is not null and p_value >= s.warning_limit then 'warning' end;
    v_limit := case when v_sev = 'alarm' then s.alarm_limit else s.warning_limit end;
  end if;

  select * into v_open from condition_alerts
  where sensor_id = p_sensor_id and cleared_at is null
  order by triggered_at desc limit 1;

  if v_sev is null then
    -- Returned inside limits: close the alert but keep it. Its triggered_at is
    -- the whole record of how much warning there was.
    if v_open.id is not null then
      update condition_alerts set cleared_at = p_taken_at where id = v_open.id;
    end if;
  elsif v_open.id is null then
    insert into condition_alerts (organization_id, sensor_id, asset_id, severity,
      triggered_value, limit_value, triggered_at)
    values (v_org, p_sensor_id, s.asset_id, v_sev, p_value, v_limit, p_taken_at)
    returning id into v_alert;
  elsif v_sev = 'alarm' and v_open.severity = 'warning' then
    -- Escalation is a new crossing and deserves its own record; the warning is
    -- closed at the moment it escalated, so both intervals stay measurable.
    update condition_alerts set cleared_at = p_taken_at where id = v_open.id;
    insert into condition_alerts (organization_id, sensor_id, asset_id, severity,
      triggered_value, limit_value, triggered_at)
    values (v_org, p_sensor_id, s.asset_id, 'alarm', p_value, v_limit, p_taken_at)
    returning id into v_alert;
  end if;

  v_trend := case
    when v_prev is null then 'stable'
    when p_value > v_prev * 1.02 then 'up'
    when p_value < v_prev * 0.98 then 'down'
    else 'stable' end;

  update sensors
  set last_value = p_value,
      status = coalesce(v_sev, 'normal'),
      trend = v_trend
  where id = p_sensor_id;

  return jsonb_build_object('recorded', true, 'severity', v_sev,
    'alert_id', v_alert, 'trend', v_trend);
end
$$;

grant execute on function public.record_condition_reading(uuid, numeric, timestamptz, text, text) to authenticated;

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
begin
  update condition_alerts
  set work_order_id = p_work_order_id
  where id = p_alert_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'alert not found');
  end if;
  return jsonb_build_object('linked', p_alert_id, 'work_order_id', p_work_order_id);
end
$$;

grant execute on function public.link_alert_to_work(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- C6.24 warning lead time · C6.25 PM task effectiveness · coverage
-- ----------------------------------------------------------------------------
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
  v_lead_hours numeric;
  v_lead_n int;
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

  -- C6.24: from the FIRST warning on an asset to the corrective work that
  -- followed it. Measured from alert linkage where it exists, because an
  -- unlinked alert and a coincidental repair are not the same thing.
  select round(avg(extract(epoch from (w.created_at - al.triggered_at)) / 3600.0)::numeric, 1),
         count(*)
  into v_lead_hours, v_lead_n
  from condition_alerts al
  join work_orders w on w.id = al.work_order_id
  where al.organization_id = v_org and w.created_at >= al.triggered_at;

  -- C6.25: a PM task is effective when it FINDS something. Measured two ways,
  -- because each alone is misleading: the finding rate says the task is worth
  -- doing, and the miss rate says whether it is catching what it should.
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

  -- A failure shortly after a PM that the PM did not raise is the signal that
  -- the task is not looking at the right thing.
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
      'basis', case when v_readings = 0
        then 'Sensors are configured but no reading history exists yet. Trend, alerting and lead time all require history — connect a historian or condition-monitoring source (C2.04).'
        else 'Reading history present; limits are evaluated on ingest.' end),
    'active_alerts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', al.id, 'asset', a.name, 'sensor', s.name, 'severity', al.severity,
        'value', al.triggered_value, 'limit', al.limit_value,
        'triggered_at', al.triggered_at,
        'hours_open', round(extract(epoch from (now() - al.triggered_at)) / 3600.0, 1),
        'acknowledged', al.acknowledged_at is not null,
        'linked_work_order', al.work_order_id is not null)
        order by al.severity desc, al.triggered_at), '[]'::jsonb)
      from condition_alerts al
      join sensors s on s.id = al.sensor_id
      left join assets a on a.id = al.asset_id
      where al.organization_id = v_org and al.cleared_at is null),
    'warning_lead_time', jsonb_build_object(
      'register_ref', 'C6.24',
      'available', coalesce(v_lead_n, 0) > 0,
      'value', v_lead_hours, 'unit', 'hours', 'sample', v_lead_n,
      'basis', case when coalesce(v_lead_n, 0) > 0
        then format('Mean hours from a condition alert to the work order raised against it, over %s linked alerts.', v_lead_n)
        else 'No condition alert has been linked to a work order yet. Lead time is deliberately measured from LINKED alerts only — an unlinked alert and a coincidental repair are not the same thing.' end),
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

grant execute on function public.get_condition_monitoring() to authenticated;

create or replace function public.adopt_pf_interval(
  p_id uuid,
  p_days numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
begin
  select role into v_role from user_profiles where id = auth.uid();
  -- A P-F interval sets inspection frequency, which sets exposure. Engineering
  -- authority, not administrative convenience.
  if v_role not in ('reliability_engineer', 'admin', 'ai_admin') then
    return jsonb_build_object('error',
      'adopting a P-F interval requires the reliability engineer role');
  end if;
  if p_days is null or p_days <= 0 then
    return jsonb_build_object('error', 'the interval must be greater than zero days');
  end if;
  if coalesce(length(trim(p_note)), 0) < 20 then
    return jsonb_build_object('error',
      'state the engineering basis for this interval (20 characters minimum)');
  end if;

  update pf_intervals
  set pf_interval_days = p_days, status = 'adopted',
      adopted_by = auth.uid(), adopted_at = now(),
      basis = 'Adopted: ' || trim(p_note)
  where id = p_id and organization_id = v_org and status = 'draft';

  if not found then
    return jsonb_build_object('error', 'draft interval not found');
  end if;
  return jsonb_build_object('adopted', p_id, 'pf_interval_days', p_days,
    'recommended_inspection_days', p_days / 2);
end
$$;

grant execute on function public.adopt_pf_interval(uuid, numeric, text) to authenticated;

notify pgrst, 'reload schema';

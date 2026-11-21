-- E3.03 Starts, stops, loading, cycling, and process excursions.
--
-- Canonical reuse: operating_states carries the interval and its load_pct;
-- process_events carries alarms, trips, interlocks, excursions, starts and
-- stops. This reading does not create a second event stream and it does not
-- read condition_alerts. A retained row freezes the computation. It does not
-- acknowledge an alarm, create work, change a limit, or release equipment.
--
-- What is not assumed: a missing load_pct is unknown, not zero. A running
-- interval that has not ended is not a completed cycle. An asset with no
-- state record in the window is not treated as running. Overlapping state
-- rows are summed as stored and are not converted into a utilisation figure.

create table if not exists public.operating_duty_readings (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  window_days integer not null check (window_days > 0),
  window_from timestamptz not null,
  window_to timestamptz not null,
  starts integer not null check (starts >= 0),
  stops integer not null check (stops >= 0),
  cycles_completed integer not null check (cycles_completed >= 0),
  running_open integer not null check (running_open >= 0),
  source_start_events integer not null check (source_start_events >= 0),
  source_stop_events integer not null check (source_stop_events >= 0),
  excursions integer not null check (excursions >= 0),
  trips integer not null check (trips >= 0),
  alarms integer not null check (alarms >= 0),
  interlocks integer not null check (interlocks >= 0),
  states jsonb not null,
  hours_covered numeric not null check (hours_covered >= 0),
  coverage_pct numeric not null,
  source_digest text not null,
  basis text not null,
  note text,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  check (window_to > window_from),
  check (cycles_completed <= starts),
  check (cycles_completed <= stops),
  check (jsonb_typeof(states) = 'array'),
  check (source_digest ~ '^[0-9a-f]{32}$'),
  check (note is null or char_length(note) <= 500)
);

create index if not exists idx_operating_duty_readings_asset
  on public.operating_duty_readings (organization_id, asset_id, recorded_at desc);

alter table public.operating_duty_readings enable row level security;

drop policy if exists operating_duty_readings_read on public.operating_duty_readings;
create policy operating_duty_readings_read on public.operating_duty_readings
  for select to authenticated
  using (organization_id = public.app_current_org());

revoke all on table public.operating_duty_readings from public, anon, authenticated, service_role;
grant select on table public.operating_duty_readings to authenticated;

create or replace function public.operating_duty_readings_append_only()
returns trigger
language plpgsql
set search_path = public
as $duty$
begin
  raise exception
    'operating_duty_readings is append-only. A retained duty snapshot is not revised in place.'
    using errcode = 'insufficient_privilege';
end
$duty$;

revoke all on function public.operating_duty_readings_append_only() from public, anon, authenticated, service_role;

drop trigger if exists trg_operating_duty_readings_append_only on public.operating_duty_readings;
create trigger trg_operating_duty_readings_append_only
  before update or delete on public.operating_duty_readings
  for each row execute function public.operating_duty_readings_append_only();

drop trigger if exists trg_operating_duty_readings_no_truncate on public.operating_duty_readings;
create trigger trg_operating_duty_readings_no_truncate
  before truncate on public.operating_duty_readings
  for each statement execute function public.operating_duty_readings_append_only();

create or replace function public.compute_operating_duty(
  p_asset_id uuid,
  p_window_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $duty$
declare
  v_org uuid := public.app_current_org();
  v_days integer := greatest(coalesce(p_window_days, 90), 1);
  v_from timestamptz := now() - make_interval(days => v_days);
  v_to timestamptz := now();
  v_starts integer;
  v_stops integer;
  v_cycles integer;
  v_open integer;
  v_excursions integer;
  v_trips integer;
  v_alarms integer;
  v_interlocks integer;
  v_source_starts integer;
  v_source_stops integer;
  v_events integer;
  v_covered numeric;
  v_known numeric;
  v_unknown numeric;
  v_states jsonb;
  v_digest text;
  v_total_states integer;
  v_total_events integer;
  v_basis text;
begin
  if v_org is null or auth.uid() is null then
    raise exception 'operating duty requires an authenticated organization member'
      using errcode = 'insufficient_privilege';
  end if;
  if p_asset_id is null or not exists (
    select 1 from public.assets
    where id = p_asset_id and organization_id = v_org
  ) then
    raise exception 'asset not found';
  end if;

  select count(*) into v_starts
  from public.operating_states
  where organization_id = v_org and asset_id = p_asset_id
    and state = 'running'
    and started_at >= v_from and started_at <= v_to;

  select count(*) into v_stops
  from public.operating_states
  where organization_id = v_org and asset_id = p_asset_id
    and state = 'running'
    and ended_at is not null
    and ended_at >= v_from and ended_at <= v_to;

  select count(*) into v_cycles
  from public.operating_states
  where organization_id = v_org and asset_id = p_asset_id
    and state = 'running'
    and started_at >= v_from and started_at <= v_to
    and ended_at is not null
    and ended_at >= v_from and ended_at <= v_to;

  select count(*) into v_open
  from public.operating_states
  where organization_id = v_org and asset_id = p_asset_id
    and state = 'running'
    and started_at <= v_to
    and coalesce(ended_at, v_to) > v_from
    and (ended_at is null or ended_at > v_to);

  select
    count(*) filter (where event_type = 'excursion'),
    count(*) filter (where event_type = 'trip'),
    count(*) filter (where event_type = 'alarm'),
    count(*) filter (where event_type = 'interlock'),
    count(*) filter (where event_type = 'start'),
    count(*) filter (where event_type = 'stop'),
    count(*)
  into v_excursions, v_trips, v_alarms, v_interlocks,
       v_source_starts, v_source_stops, v_events
  from public.process_events
  where organization_id = v_org and asset_id = p_asset_id
    and occurred_at >= v_from and occurred_at <= v_to;

  with clipped as (
    select state, load_pct,
      extract(epoch from (
        least(coalesce(ended_at, v_to), v_to) - greatest(started_at, v_from)
      )) / 3600.0 as hrs
    from public.operating_states
    where organization_id = v_org and asset_id = p_asset_id
      and least(coalesce(ended_at, v_to), v_to) > greatest(started_at, v_from)
  )
  select
    coalesce(sum(hrs), 0),
    coalesce(sum(hrs) filter (where load_pct is not null), 0),
    coalesce(sum(hrs) filter (where load_pct is null), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'state', state,
        'hours', hours,
        'load_known_hours', load_known_hours,
        'load_unknown_hours', load_unknown_hours,
        'load_pct_time_weighted', load_pct_time_weighted
      ) order by hours desc, state)
      from (
        select state,
          round(sum(hrs)::numeric, 1) as hours,
          round(coalesce(sum(hrs) filter (where load_pct is not null), 0)::numeric, 1) as load_known_hours,
          round(coalesce(sum(hrs) filter (where load_pct is null), 0)::numeric, 1) as load_unknown_hours,
          case when coalesce(sum(hrs) filter (where load_pct is not null), 0) > 0
            then round((
              sum(hrs * load_pct) filter (where load_pct is not null)
              / sum(hrs) filter (where load_pct is not null)
            )::numeric, 1)
          end as load_pct_time_weighted
        from clipped
        group by state
      ) grouped
    ), '[]'::jsonb)
  into v_covered, v_known, v_unknown, v_states
  from clipped;

  select md5(coalesce(string_agg(piece, '|' order by piece), ''))
  into v_digest
  from (
    select concat(
      's:', id::text, ':', state, ':', coalesce(load_pct::text, 'null'), ':',
      started_at::text, ':', coalesce(ended_at::text, 'open')
    ) as piece
    from public.operating_states
    where organization_id = v_org and asset_id = p_asset_id
      and coalesce(ended_at, v_to) > v_from
      and started_at <= v_to
    union all
    select concat('e:', id::text, ':', event_type, ':', occurred_at::text)
    from public.process_events
    where organization_id = v_org and asset_id = p_asset_id
      and occurred_at >= v_from and occurred_at <= v_to
  ) sources;

  select count(*) into v_total_states
  from public.operating_states
  where organization_id = v_org and asset_id = p_asset_id;
  select count(*) into v_total_events
  from public.process_events
  where organization_id = v_org and asset_id = p_asset_id;

  v_basis := 'Starts and stops are counted from running-state intervals. A completed cycle is a running interval that both starts and stops inside the window. Load is the time-weighted load percent of each state and is omitted where it was not recorded. Excursions and trips are counted from process events and are not condition alerts. Retaining this reading does not acknowledge an alarm, create work, change a limit, or release equipment.';
  if v_covered = 0 and v_events = 0 and v_total_states = 0 and v_total_events = 0 then
    v_basis := v_basis || ' No operating-state record and no process event exist for this asset. Silence is not uptime.';
  elsif v_covered = 0 and v_events = 0 and (v_total_states > 0 or v_total_events > 0) then
    v_basis := v_basis || ' Records exist for this asset, but none fall inside the requested window. That is not the same as having no history.';
  elsif v_covered = 0 and v_events > 0 then
    v_basis := v_basis || ' Process events fall in the window, but no operating-state hours do. Event counts are not converted into running hours.';
  elsif v_known = 0 then
    v_basis := v_basis || ' State hours are covered, but load was not recorded on them. No load is inferred.';
  elsif v_unknown > 0 then
    v_basis := v_basis || ' Some covered hours have no recorded load. Those hours stay unknown and are excluded from the time-weighted load.';
  end if;
  if v_covered > (v_days * 24.0) then
    v_basis := v_basis || ' Covered hours exceed the window because overlapping state records are summed as stored. That figure is not utilisation.';
  end if;

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'window_days', v_days,
    'window_from', v_from,
    'window_to', v_to,
    'starts', v_starts,
    'stops', v_stops,
    'cycles_completed', v_cycles,
    'running_open', v_open,
    'source_start_events', v_source_starts,
    'source_stop_events', v_source_stops,
    'excursions', v_excursions,
    'trips', v_trips,
    'alarms', v_alarms,
    'interlocks', v_interlocks,
    'states', v_states,
    'hours_covered', round(v_covered::numeric, 1),
    'coverage_pct', round((100.0 * v_covered / (v_days * 24.0))::numeric, 1),
    'source_digest', v_digest,
    'basis', v_basis,
    'condition_alerts_consulted', false
  );
end
$duty$;

revoke all on function public.compute_operating_duty(uuid, integer) from public, anon, authenticated, service_role;

create or replace function public.preview_operating_duty(
  p_asset_id uuid,
  p_window_days integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $duty$
declare
  v_org uuid := public.app_current_org();
begin
  if v_org is null or auth.uid() is null then
    raise exception 'previewing operating duty requires an authenticated organization member'
      using errcode = 'insufficient_privilege';
  end if;
  if p_asset_id is null or not exists (
    select 1 from public.assets
    where id = p_asset_id and organization_id = v_org
  ) then
    raise exception 'asset not found';
  end if;
  return public.compute_operating_duty(p_asset_id, p_window_days);
end
$duty$;

revoke all on function public.preview_operating_duty(uuid, integer) from public, anon, service_role;
grant execute on function public.preview_operating_duty(uuid, integer) to authenticated;

create or replace function public.record_operating_duty_reading(
  p_asset_id uuid,
  p_window_days integer default 90,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $duty$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_picture jsonb;
  v_days integer;
  v_digest text;
  v_existing bigint;
  v_id bigint;
  v_reading jsonb;
begin
  if v_org is null or v_uid is null then
    raise exception 'recording an operating-duty reading requires an authenticated organization member'
      using errcode = 'insufficient_privilege';
  end if;
  select role into v_role
  from public.user_profiles
  where id = v_uid and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    raise exception 'AI cannot record an operating-duty reading; a named human must retain it'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(v_role, '') not in (
    'admin', 'executive', 'maintenance_manager', 'reliability_engineer',
    'supervisor', 'operator', 'planner', 'technician'
  ) then
    raise exception 'recording an operating-duty reading requires an operations or maintenance role'
      using errcode = 'insufficient_privilege';
  end if;
  if p_asset_id is null or not exists (
    select 1 from public.assets
    where id = p_asset_id and organization_id = v_org
  ) then
    raise exception 'asset not found';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'a duty-reading note is limited to 500 characters and cannot change the computed counts';
  end if;

  v_picture := public.compute_operating_duty(p_asset_id, p_window_days);
  v_days := (v_picture->>'window_days')::integer;
  v_digest := v_picture->>'source_digest';

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_asset_id::text, 0));

  select id into v_existing
  from public.operating_duty_readings
  where organization_id = v_org
    and asset_id = p_asset_id
    and window_days = v_days
    and source_digest = v_digest
    and recorded_at >= now() - interval '2 minutes'
  order by recorded_at desc
  limit 1;

  if v_existing is not null then
    select (to_jsonb(t) - 'organization_id')
      || jsonb_build_object('condition_alerts_consulted', false)
    into v_reading
    from public.operating_duty_readings t
    where t.id = v_existing and t.organization_id = v_org;
    return jsonb_build_object('reading', v_reading, 'replayed', true);
  end if;

  insert into public.operating_duty_readings (
    organization_id, asset_id, window_days, window_from, window_to,
    starts, stops, cycles_completed, running_open,
    source_start_events, source_stop_events,
    excursions, trips, alarms, interlocks,
    states, hours_covered, coverage_pct, source_digest, basis, note, recorded_by
  ) values (
    v_org, p_asset_id, v_days,
    (v_picture->>'window_from')::timestamptz,
    (v_picture->>'window_to')::timestamptz,
    (v_picture->>'starts')::integer,
    (v_picture->>'stops')::integer,
    (v_picture->>'cycles_completed')::integer,
    (v_picture->>'running_open')::integer,
    (v_picture->>'source_start_events')::integer,
    (v_picture->>'source_stop_events')::integer,
    (v_picture->>'excursions')::integer,
    (v_picture->>'trips')::integer,
    (v_picture->>'alarms')::integer,
    (v_picture->>'interlocks')::integer,
    v_picture->'states',
    (v_picture->>'hours_covered')::numeric,
    (v_picture->>'coverage_pct')::numeric,
    v_digest,
    v_picture->>'basis',
    v_note,
    v_uid
  ) returning id into v_id;

  select (to_jsonb(t) - 'organization_id')
    || jsonb_build_object('condition_alerts_consulted', false)
  into v_reading
  from public.operating_duty_readings t
  where t.id = v_id and t.organization_id = v_org;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org,
    'operating_duty_reading',
    v_uid::text,
    jsonb_build_object(
      'action', 'recorded',
      'reading_id', v_id,
      'asset_id', p_asset_id,
      'window_days', v_days,
      'source_digest', v_digest,
      'does_not', jsonb_build_array(
        'acknowledge_alarm', 'create_work', 'change_operating_limit', 'release_equipment'
      )
    ),
    null,
    jsonb_build_object(
      'starts', v_reading->'starts',
      'stops', v_reading->'stops',
      'cycles_completed', v_reading->'cycles_completed',
      'excursions', v_reading->'excursions',
      'trips', v_reading->'trips',
      'states', v_reading->'states'
    )
  );

  return jsonb_build_object('reading', v_reading, 'replayed', false);
end
$duty$;

revoke all on function public.record_operating_duty_reading(uuid, integer, text) from public, anon, service_role;
grant execute on function public.record_operating_duty_reading(uuid, integer, text) to authenticated;

create or replace function public.get_operating_duty_readings(
  p_asset_id uuid,
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $duty$
declare
  v_org uuid := public.app_current_org();
  v_rows jsonb;
begin
  if v_org is null or auth.uid() is null then
    raise exception 'reading retained operating duty requires an authenticated organization member'
      using errcode = 'insufficient_privilege';
  end if;
  if p_asset_id is null or not exists (
    select 1 from public.assets
    where id = p_asset_id and organization_id = v_org
  ) then
    raise exception 'asset not found';
  end if;

  select coalesce(jsonb_agg(
    (to_jsonb(t) - 'organization_id')
      || jsonb_build_object('condition_alerts_consulted', false)
    order by t.recorded_at desc
  ), '[]'::jsonb)
  into v_rows
  from (
    select *
    from public.operating_duty_readings
    where organization_id = v_org and asset_id = p_asset_id
    order by recorded_at desc
    limit least(greatest(coalesce(p_limit, 10), 1), 20)
  ) t;

  return jsonb_build_object('readings', v_rows);
end
$duty$;

revoke all on function public.get_operating_duty_readings(uuid, integer) from public, anon, service_role;
grant execute on function public.get_operating_duty_readings(uuid, integer) to authenticated;

comment on table public.operating_duty_readings is
  'E3.03 retained snapshot of starts, stops, load, cycles and process excursions. Computed from operating_states and process_events. Not a condition_alerts stream and not an operating authority.';
comment on function public.preview_operating_duty(uuid, integer) is
  'E3.03 tenant-scoped preview. Does not persist, audit, or consult condition_alerts.';
comment on function public.record_operating_duty_reading(uuid, integer, text) is
  'E3.03 named-human retention of a computed duty picture. Writes operating_duty_readings and audit_events. Grants no alarm, work, limit, or release authority.';

notify pgrst, 'reload schema';

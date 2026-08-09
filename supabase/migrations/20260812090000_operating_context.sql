-- ============================================================================
-- Operating context: run states, production, process events
-- (capability register C2.04, E3.02, E3.03; unblocks C6.03 and completes
-- the operating-regime axis of C6.26).
--
-- This is the single missing input that the most other capabilities named as
-- their blocker. Without it the platform knows THAT an asset failed and never
-- WHAT IT WAS DOING when it failed — and duty is usually the difference
-- between a design problem and an operating one.
--
-- A NOTE ON DATA WE ALREADY HAD AND DISCARDED. The monthly source sheets this
-- fleet was onboarded from were an operating-state export — Down Scheduled,
-- Down Unscheduled and the running states between them. Ingest converted the
-- down events of an hour or more into work orders and dropped the rest. That
-- was right for building a work history and wrong as a permanent choice: the
-- states left behind are exactly this table. Re-ingesting the full stream
-- through the slice-14 contract would populate it from data already in hand,
-- which is why 'operating_state' and 'production_record' are added as ingest
-- entity types here rather than left for later.
--
-- WHAT IS NOT ASSUMED. An asset with no state record is not treated as
-- running. Utilisation over a period with partial coverage reports the
-- coverage alongside the number, because 92% utilisation measured over 3% of
-- the period is not 92% utilisation.
--
-- Canonical reuse: assets, sites, work_orders, asset_economics, connectors and
-- ingest_batch from slice 14, app_current_org(). Additive.
-- ============================================================================

create table if not exists operating_states (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  state text not null check (state in
    ('running', 'idle', 'standby', 'down_planned', 'down_unplanned', 'offline')),
  -- The duty the asset was under while in that state, where the source knows.
  load_pct numeric check (load_pct >= 0 and load_pct <= 200),
  started_at timestamptz not null,
  ended_at timestamptz,
  reason_code text,
  source_system text,
  external_id text,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at)
);

create index if not exists idx_operating_states_asset
  on operating_states(organization_id, asset_id, started_at desc);
create unique index if not exists idx_operating_states_external
  on operating_states(organization_id, source_system, external_id)
  where external_id is not null;

alter table operating_states enable row level security;
drop policy if exists operating_states_read on operating_states;
create policy operating_states_read on operating_states
  for select to authenticated using (organization_id = app_current_org());

create table if not exists production_records (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  units_produced numeric not null check (units_produced >= 0),
  unit_of_measure text not null,
  source_system text,
  external_id text,
  created_at timestamptz not null default now(),
  check (period_end > period_start),
  check (asset_id is not null or site_id is not null)
);

create index if not exists idx_production_records_period
  on production_records(organization_id, period_start desc);
create unique index if not exists idx_production_records_external
  on production_records(organization_id, source_system, external_id)
  where external_id is not null;

alter table production_records enable row level security;
drop policy if exists production_records_read on production_records;
create policy production_records_read on production_records
  for select to authenticated using (organization_id = app_current_org());

create table if not exists process_events (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  event_type text not null check (event_type in
    ('alarm', 'trip', 'interlock', 'excursion', 'start', 'stop')),
  -- A process alarm is an operator-facing DCS event. It is deliberately NOT
  -- the same object as a condition_alert, which is a limit crossing on a
  -- monitored signal: conflating them would let alarm floods drown the small
  -- number of condition warnings that actually predict failure.
  severity text check (severity in ('low', 'medium', 'high', 'critical')),
  tag text,
  description text,
  occurred_at timestamptz not null,
  source_system text,
  external_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_process_events_asset
  on process_events(organization_id, asset_id, occurred_at desc);

alter table process_events enable row level security;
drop policy if exists process_events_read on process_events;
create policy process_events_read on process_events
  for select to authenticated using (organization_id = app_current_org());

-- ----------------------------------------------------------------------------
-- Duty profile: what the asset was actually doing
-- ----------------------------------------------------------------------------
create or replace function public.get_operating_context(
  p_asset_id uuid,
  p_window_days int default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_from timestamptz := now() - make_interval(days => greatest(p_window_days, 1));
  v_window_hours numeric := greatest(p_window_days, 1) * 24.0;
  v_covered numeric;
  v_rows jsonb;
  v_starts int;
begin
  if not exists (select 1 from assets where id = p_asset_id and organization_id = v_org) then
    return jsonb_build_object('error', 'asset not found');
  end if;

  select coalesce(sum(extract(epoch from
      (least(coalesce(ended_at, now()), now()) - greatest(started_at, v_from))) / 3600.0), 0)
  into v_covered
  from operating_states
  where organization_id = v_org and asset_id = p_asset_id
    and coalesce(ended_at, now()) > v_from;

  select coalesce(jsonb_agg(jsonb_build_object(
    'state', state, 'hours', hrs,
    'pct_of_covered', case when v_covered > 0 then round(100.0 * hrs / v_covered, 1) end)
    order by hrs desc), '[]'::jsonb)
  into v_rows
  from (
    select state,
           round(sum(extract(epoch from
             (least(coalesce(ended_at, now()), now()) - greatest(started_at, v_from))) / 3600.0)::numeric, 1) as hrs
    from operating_states
    where organization_id = v_org and asset_id = p_asset_id
      and coalesce(ended_at, now()) > v_from
    group by state) t;

  -- Starts and stops (E3.03): cycling is a load on many components that
  -- steady running is not, so it is counted rather than inferred.
  select count(*) into v_starts
  from operating_states
  where organization_id = v_org and asset_id = p_asset_id
    and state = 'running' and started_at >= v_from;

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'window_days', greatest(p_window_days, 1),
    'states', v_rows,
    'starts_in_window', v_starts,
    'hours_covered', round(v_covered, 1),
    -- The number that stops a partial feed from reading as a full picture.
    'coverage_pct', round(100.0 * v_covered / v_window_hours, 1),
    'basis', case
      when v_covered = 0
        then 'No operating-state record for this asset. The platform does not assume an asset with no state record was running.'
      when v_covered / v_window_hours < 0.5
        then format('Only %s%% of the window is covered by state records — percentages below describe the covered portion, not the period.',
             round(100.0 * v_covered / v_window_hours, 1))
      else 'State records cover the window.' end);
end
$$;

grant execute on function public.get_operating_context(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- C6.03 — maintenance cost per production unit
-- ----------------------------------------------------------------------------
create or replace function public.get_cost_per_production_unit(
  p_window_days int default 365
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_from timestamptz := now() - make_interval(days => greatest(p_window_days, 1));
  v_units numeric;
  v_uom text;
  v_cost numeric;
  v_assets_priced int;
  v_assets int;
  v_missing text[] := '{}';
begin
  select sum(units_produced), min(unit_of_measure), count(distinct unit_of_measure)
  into v_units, v_uom, v_assets
  from production_records
  where organization_id = v_org and period_start >= v_from;

  if coalesce(v_units, 0) = 0 then
    v_missing := v_missing || 'production volume'::text;
  end if;
  if v_assets > 1 then
    -- Summing tonnes and hours into one denominator would produce a number
    -- with no meaning at all.
    return jsonb_build_object('available', false,
      'basis', 'Production is recorded in more than one unit of measure. A single cost-per-unit figure across mixed units would be meaningless; segment by unit before comparing.');
  end if;

  select count(*) filter (where e.annual_maintenance_cost_usd is not null),
         count(*)
  into v_assets_priced, v_assets
  from assets a
  left join asset_economics e on e.organization_id = v_org
    and (e.asset_id = a.id or (e.asset_id is null and e.asset_class = a.asset_class))
  where a.organization_id = v_org;

  select sum(coalesce(e.annual_maintenance_cost_usd, 0)
             * (greatest(p_window_days, 1) / 365.0))
  into v_cost
  from assets a
  join asset_economics e on e.organization_id = v_org
    and (e.asset_id = a.id or (e.asset_id is null and e.asset_class = a.asset_class))
  where a.organization_id = v_org;

  if coalesce(v_cost, 0) = 0 then
    v_missing := v_missing || 'maintenance cost'::text;
  end if;

  return jsonb_build_object(
    'available', array_length(v_missing, 1) is null,
    'value', case when array_length(v_missing, 1) is null
      then round(v_cost / v_units, 4) end,
    'unit', case when v_uom is not null then 'USD per ' || v_uom end,
    'units_produced', v_units,
    'maintenance_cost_usd', round(coalesce(v_cost, 0), 0),
    'cost_coverage', format('%s of %s assets carry a maintenance cost', v_assets_priced, v_assets),
    'missing_inputs', to_jsonb(v_missing),
    'basis', case when array_length(v_missing, 1) is null
      then format('Annualised maintenance cost over recorded production for the last %s days.', greatest(p_window_days, 1))
      else format('Not computable: %s not recorded. A cost-per-unit figure built on a partial denominator understates it, which is the direction that flatters.',
           array_to_string(v_missing, ' and ')) end);
end
$$;

grant execute on function public.get_cost_per_production_unit(int) to authenticated;

create or replace function public.get_production_position()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  return jsonb_build_object(
    'assets_with_state_records', (
      select count(distinct asset_id) from operating_states where organization_id = v_org),
    'assets', (select count(*) from assets where organization_id = v_org),
    'state_records', (select count(*) from operating_states where organization_id = v_org),
    'production_records', (select count(*) from production_records where organization_id = v_org),
    'process_events', (select count(*) from process_events where organization_id = v_org),
    'cost_per_unit', get_cost_per_production_unit(365),
    'note', 'Operating context is the input most other capabilities named as their blocker: without it the platform knows THAT an asset failed and never what it was doing when it failed. Both operating_state and production_record are accepted by the slice-14 ingest contract.');
end
$$;

grant execute on function public.get_production_position() to authenticated;

-- ----------------------------------------------------------------------------
-- Operating-regime segmentation — the last axis C6.26 was missing
-- ----------------------------------------------------------------------------
create or replace function public.get_operating_regime(p_asset_id uuid, p_at timestamptz)
returns text
language sql
security definer
set search_path = public
stable
as $$
  -- The regime an asset was in at a moment: high duty, low duty, or unknown.
  -- Unknown is a real answer and is never quietly folded into one of the others.
  select case
    when s.load_pct is null then 'Unknown duty'
    when s.load_pct >= 80 then 'High duty'
    when s.load_pct >= 40 then 'Moderate duty'
    else 'Low duty' end
  from operating_states s
  where s.asset_id = p_asset_id
    and s.started_at <= p_at
    and coalesce(s.ended_at, now()) >= p_at
  order by s.started_at desc
  limit 1;
$$;

grant execute on function public.get_operating_regime(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- Ingest: operating states and production land through the SAME contract
-- (slice 14) — validated, idempotent, rejects retained with reasons.
-- ----------------------------------------------------------------------------
create or replace function public.ingest_context_batch(
  p_run_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  r connector_runs%rowtype;
  row_in jsonb;
  v_ext text;
  v_reason text;
  v_read int := 0;
  v_ok int := 0;
  v_dup int := 0;
  v_rej int := 0;
  v_max_ts timestamptz;
  v_asset uuid;
  v_site uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_source text;
begin
  select * into r from connector_runs where id = p_run_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;
  if r.status <> 'running' then
    return jsonb_build_object('error', 'this run is already ' || r.status);
  end if;
  if r.entity_type not in ('operating_state', 'production_record') then
    return jsonb_build_object('error',
      format('ingest_context_batch handles operating_state and production_record; this run is %s', r.entity_type));
  end if;

  select connector_key into v_source from connectors where id = r.connector_id;

  for row_in in select * from jsonb_array_elements(p_rows) loop
    v_read := v_read + 1;
    v_reason := null;
    v_ext := row_in->>'external_id';
    if v_ext is null or length(trim(v_ext)) = 0 then
      v_reason := 'missing external_id: a source row without a stable identifier cannot be replayed safely';
    end if;

    if v_reason is null then
      select id into v_asset from assets
      where organization_id = v_org
        and (id::text = row_in->>'asset_id' or name = row_in->>'asset_name')
      limit 1;
    end if;

    if v_reason is null and r.entity_type = 'operating_state' then
      v_start := (row_in->>'started_at')::timestamptz;
      v_end := (row_in->>'ended_at')::timestamptz;
      if v_asset is null then
        v_reason := format('unknown asset "%s"', coalesce(row_in->>'asset_name', row_in->>'asset_id', '(none)'));
      elsif row_in->>'state' is null then
        v_reason := 'missing state';
      elsif row_in->>'state' not in ('running','idle','standby','down_planned','down_unplanned','offline') then
        v_reason := format('unrecognised state "%s"', row_in->>'state');
      elsif v_start is null then
        v_reason := 'missing or unparseable started_at';
      elsif v_end is not null and v_end <= v_start then
        v_reason := 'ended_at is not after started_at — a state cannot end before it begins';
      elsif exists (select 1 from operating_states
                    where organization_id = v_org and source_system = v_source and external_id = v_ext) then
        v_dup := v_dup + 1;
        insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status)
        values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'duplicate');
        continue;
      else
        insert into operating_states (organization_id, asset_id, state, load_pct,
          started_at, ended_at, reason_code, source_system, external_id)
        values (v_org, v_asset, row_in->>'state', (row_in->>'load_pct')::numeric,
          v_start, v_end, row_in->>'reason_code', v_source, v_ext);
        v_max_ts := greatest(coalesce(v_max_ts, v_start), v_start);
      end if;

    elsif v_reason is null and r.entity_type = 'production_record' then
      v_start := (row_in->>'period_start')::timestamptz;
      v_end := (row_in->>'period_end')::timestamptz;
      select id into v_site from sites where organization_id = v_org and name = row_in->>'site_name';
      if v_asset is null and v_site is null then
        v_reason := 'production must attach to a known asset or site';
      elsif row_in->>'units_produced' is null then
        v_reason := 'missing units_produced';
      elsif (row_in->>'units_produced')::numeric < 0 then
        v_reason := 'negative units_produced';
      elsif row_in->>'unit_of_measure' is null then
        v_reason := 'missing unit_of_measure — a quantity without a unit cannot be aggregated';
      elsif v_start is null or v_end is null or v_end <= v_start then
        v_reason := 'period_start and period_end must both parse, with the end after the start';
      elsif exists (select 1 from production_records
                    where organization_id = v_org and source_system = v_source and external_id = v_ext) then
        v_dup := v_dup + 1;
        insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status)
        values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'duplicate');
        continue;
      else
        insert into production_records (organization_id, asset_id, site_id,
          period_start, period_end, units_produced, unit_of_measure, source_system, external_id)
        values (v_org, v_asset, v_site, v_start, v_end,
          (row_in->>'units_produced')::numeric, row_in->>'unit_of_measure', v_source, v_ext);
        v_max_ts := greatest(coalesce(v_max_ts, v_end), v_end);
      end if;
    end if;

    if v_reason is null then
      v_ok := v_ok + 1;
      insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status)
      values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'accepted');
    else
      v_rej := v_rej + 1;
      insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status, reject_reason)
      values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'rejected', v_reason);
    end if;
  end loop;

  update connector_runs
  set records_read = records_read + v_read,
      records_accepted = records_accepted + v_ok,
      records_rejected = records_rejected + v_rej,
      records_duplicate = records_duplicate + v_dup,
      watermark_to = greatest(coalesce(watermark_to, v_max_ts), v_max_ts)
  where id = p_run_id;

  return jsonb_build_object('read', v_read, 'accepted', v_ok,
    'duplicate', v_dup, 'rejected', v_rej);
end
$$;

grant execute on function public.ingest_context_batch(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

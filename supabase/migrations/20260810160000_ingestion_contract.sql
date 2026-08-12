-- ============================================================================
-- The ingestion contract: staging, validation, idempotency and connector
-- health (capability register C2.12–C2.19, U21.01; unblocks C9.02/C9.04).
--
-- `connectors` and `connector_runs` have existed since the legacy baseline as
-- empty shells — no functions, no staging, no idempotency, and connector_runs
-- carries no organization_id at all. They are EXTENDED here rather than
-- replaced, because a second connector model beside the first is exactly the
-- duplicate-persistence problem the contributor guide warns about.
--
-- WHAT THIS IS, AND IS NOT. It is not a Maximo or PI adapter — those cannot be
-- written honestly without a live system to verify against, and an unverified
-- vendor adapter is worse than none because it looks finished. It is the thing
-- every adapter needs and none of them should reimplement: a validated,
-- idempotent, replay-safe ingestion path with an audit trail of what was
-- rejected and why. A PI or Maximo client becomes a thin caller of ingest_batch.
--
-- THREE DESIGN COMMITMENTS.
--
--   1. REJECTS ARE KEPT, WITH REASONS. A connector that silently drops 40% of
--      its rows reports a successful sync. Rejected rows land in ingest_staging
--      with the reason attached and are counted against the run, so the health
--      view shows an acceptance rate rather than a green tick.
--
--   2. IDEMPOTENT ON (source_system, external_id). Replays, overlapping
--      windows and retries are normal in industrial integration. Re-sending a
--      batch must not double-count a reading or duplicate a work order.
--
--   3. READ-ONLY BY DEFAULT (E5.01). A connector may only write back to a
--      source system when write_enabled is explicitly set AND the decision
--      right permits it. The default posture is that this platform reads.
--
-- Canonical reuse: connectors, connector_runs, condition_readings,
-- material_stock, work_orders, decision_rights, app_current_org(). Additive.
-- ============================================================================

alter table connectors
  add column if not exists connector_key text,
  add column if not exists system_kind text
    check (system_kind in ('historian', 'cmms', 'eam', 'erp', 'inventory',
      'condition_monitoring', 'document', 'scheduling', 'data_lake',
      'financial', 'file')),
  add column if not exists direction text not null default 'read_only'
    check (direction in ('read_only', 'read_write')),
  add column if not exists write_enabled boolean not null default false,
  add column if not exists enabled boolean not null default false,
  -- A hint, never a secret. Credentials belong in the platform secret store.
  add column if not exists endpoint_hint text,
  add column if not exists expected_interval_minutes int,
  add column if not exists contract_note text,
  add column if not exists register_ref text default 'C2.12';

comment on column connectors.endpoint_hint is
  'Human-readable location of the source, for operators to recognise. Never a credential: secrets live in the platform secret store, not in a tenant-readable table.';

comment on column connectors.write_enabled is
  'Write-back is off unless explicitly enabled AND permitted by the decision-rights matrix. Read-only is the default posture of the platform (E5.01).';

create unique index if not exists idx_connectors_key
  on connectors(organization_id, connector_key) where connector_key is not null;

alter table connector_runs
  -- The legacy table had no tenant column at all; its RLS policy had to reach
  -- through the parent. Adding it makes the row self-describing and lets the
  -- staging join stay cheap.
  add column if not exists organization_id uuid references organizations(id) on delete cascade,
  add column if not exists entity_type text,
  add column if not exists records_read int not null default 0,
  add column if not exists records_accepted int not null default 0,
  add column if not exists records_rejected int not null default 0,
  add column if not exists records_duplicate int not null default 0,
  add column if not exists watermark_from timestamptz,
  add column if not exists watermark_to timestamptz,
  add column if not exists triggered_by uuid references auth.users(id);

update connector_runs r
set organization_id = c.organization_id
from connectors c
where r.connector_id = c.id and r.organization_id is null;

create index if not exists idx_connector_runs_recent
  on connector_runs(organization_id, started_at desc);

-- ----------------------------------------------------------------------------
-- Staging: everything lands here first, accepted or not
-- ----------------------------------------------------------------------------
create table if not exists ingest_staging (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  connector_id uuid references connectors(id) on delete cascade,
  run_id uuid references connector_runs(id) on delete cascade,
  entity_type text not null,
  external_id text,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'duplicate')),
  reject_reason text,
  received_at timestamptz not null default now()
);

create index if not exists idx_ingest_staging_run
  on ingest_staging(run_id, status);
create index if not exists idx_ingest_staging_rejects
  on ingest_staging(organization_id, status, received_at desc)
  where status = 'rejected';

alter table ingest_staging enable row level security;
drop policy if exists ingest_staging_org_read on ingest_staging;
create policy ingest_staging_org_read on ingest_staging
  for select to authenticated using (organization_id = app_current_org());

create table if not exists ingest_watermarks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connector_id uuid not null references connectors(id) on delete cascade,
  entity_type text not null,
  last_position timestamptz,
  last_run_id uuid references connector_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (connector_id, entity_type)
);

alter table ingest_watermarks enable row level security;
drop policy if exists ingest_watermarks_org_read on ingest_watermarks;
create policy ingest_watermarks_org_read on ingest_watermarks
  for select to authenticated using (organization_id = app_current_org());

-- Idempotency keys on the canonical tables. Partial uniques so rows created by
-- hand — which have no external identity — are unaffected.
-- material_stock's unique from slice 12 treats NULL site_id as distinct, so a
-- site-less stock row would duplicate on every sync instead of updating.
-- NULLS NOT DISTINCT makes the upsert behave as intended.
alter table material_stock drop constraint if exists material_stock_material_id_site_id_key;
create unique index if not exists idx_material_stock_unique
  on material_stock (material_id, site_id) nulls not distinct;

alter table condition_readings add column if not exists external_id text;
create unique index if not exists idx_condition_readings_external
  on condition_readings(organization_id, source_system, external_id)
  where external_id is not null;

alter table work_orders add column if not exists external_id text;
alter table work_orders add column if not exists source_system text;
create unique index if not exists idx_work_orders_external
  on work_orders(organization_id, source_system, external_id)
  where external_id is not null;

alter table materials add column if not exists external_id text;
create unique index if not exists idx_materials_external
  on materials(organization_id, source_system, external_id)
  where external_id is not null;

-- ----------------------------------------------------------------------------
-- Registration and run lifecycle
-- ----------------------------------------------------------------------------
create or replace function public.register_connector(
  p_key text,
  p_name text,
  p_system_kind text,
  p_endpoint_hint text default null,
  p_expected_interval_minutes int default null,
  p_contract_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id uuid;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('admin', 'ai_admin') then
    return jsonb_build_object('error', 'registering a connector requires an administrator');
  end if;
  if p_endpoint_hint is not null and p_endpoint_hint ~* '(password|secret|token|api[_-]?key|bearer)' then
    return jsonb_build_object('error',
      'the endpoint hint looks like it contains a credential. Secrets belong in the platform secret store, never in a tenant-readable column');
  end if;

  insert into connectors (organization_id, connector_key, name, connector_type,
    system_kind, endpoint_hint, expected_interval_minutes, contract_note,
    status, enabled, direction)
  values (v_org, p_key, p_name, p_system_kind, p_system_kind, p_endpoint_hint,
    p_expected_interval_minutes, p_contract_note, 'configured', false, 'read_only')
  -- The index is partial, so the predicate must be repeated here for the
  -- planner to match it.
  on conflict (organization_id, connector_key) where connector_key is not null
  do update
    set name = excluded.name, system_kind = excluded.system_kind,
        endpoint_hint = excluded.endpoint_hint,
        expected_interval_minutes = excluded.expected_interval_minutes,
        contract_note = excluded.contract_note
  returning id into v_id;

  return jsonb_build_object('connector_id', v_id, 'enabled', false,
    'direction', 'read_only',
    'note', 'Registered disabled and read-only. Enable explicitly; write-back additionally requires write_enabled and a permitting decision right.');
end
$$;

grant execute on function public.register_connector(text, text, text, text, int, text) to authenticated;

create or replace function public.begin_connector_run(
  p_connector_key text,
  p_entity_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c connectors%rowtype;
  v_run uuid;
  v_from timestamptz;
begin
  select * into c from connectors
  where organization_id = v_org and connector_key = p_connector_key;
  if not found then
    return jsonb_build_object('error', 'connector not registered');
  end if;
  if not c.enabled then
    return jsonb_build_object('error',
      format('connector "%s" is registered but not enabled', p_connector_key));
  end if;

  select last_position into v_from from ingest_watermarks
  where connector_id = c.id and entity_type = p_entity_type;

  insert into connector_runs (organization_id, connector_id, entity_type,
    run_type, status, started_at, watermark_from, triggered_by)
  values (v_org, c.id, p_entity_type, 'sync', 'running', now(), v_from, auth.uid())
  returning id into v_run;

  return jsonb_build_object('run_id', v_run, 'watermark_from', v_from,
    'note', case when v_from is null
      then 'No prior watermark: this is a full load.'
      else 'Incremental from the last successful position.' end);
end
$$;

grant execute on function public.begin_connector_run(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- The ingestion path: validate, deduplicate, promote — keeping every reject
-- ----------------------------------------------------------------------------
create or replace function public.ingest_batch(
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
  v_sensor uuid;
  v_asset uuid;
  v_material uuid;
  v_site uuid;
  v_ts timestamptz;
  v_source text;
begin
  select * into r from connector_runs where id = p_run_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;
  if r.status <> 'running' then
    return jsonb_build_object('error', 'this run is already ' || r.status);
  end if;

  select connector_key into v_source from connectors where id = r.connector_id;

  for row_in in select * from jsonb_array_elements(p_rows)
  loop
    v_read := v_read + 1;
    v_reason := null;
    v_ext := row_in->>'external_id';

    if v_ext is null or length(trim(v_ext)) = 0 then
      -- Without a stable external identity there is no way to make a replay
      -- idempotent, so the row is refused rather than quietly duplicated.
      v_reason := 'missing external_id: a source row without a stable identifier cannot be replayed safely';
    end if;

    -- ── condition_reading ────────────────────────────────────────────────
    if v_reason is null and r.entity_type = 'condition_reading' then
      v_ts := (row_in->>'taken_at')::timestamptz;
      if row_in->>'value' is null then
        v_reason := 'missing value';
      elsif v_ts is null then
        v_reason := 'missing or unparseable taken_at';
      elsif v_ts > now() + interval '1 hour' then
        v_reason := 'taken_at is in the future: a clock or timezone fault at the source';
      else
        select id, asset_id into v_sensor, v_asset from sensors
        where organization_id = v_org
          and (id::text = row_in->>'sensor_id' or name = row_in->>'sensor_name')
        limit 1;
        if v_sensor is null then
          v_reason := format('unknown sensor "%s"', coalesce(row_in->>'sensor_id', row_in->>'sensor_name', '(none)'));
        end if;
      end if;

      if v_reason is null then
        if exists (select 1 from condition_readings
                   where organization_id = v_org and source_system = v_source
                     and external_id = v_ext) then
          v_dup := v_dup + 1;
          insert into ingest_staging (organization_id, connector_id, run_id,
            entity_type, external_id, payload, status)
          values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'duplicate');
          continue;
        end if;

        insert into condition_readings (organization_id, sensor_id, asset_id,
          value, quality, taken_at, source_system, external_id)
        values (v_org, v_sensor, v_asset, (row_in->>'value')::numeric,
          coalesce(row_in->>'quality', 'good'), v_ts, v_source, v_ext);

        -- Route through the same limit evaluation a manual reading uses, so an
        -- ingested breach raises an alert exactly as a keyed-in one would.
        perform record_condition_reading(v_sensor, (row_in->>'value')::numeric,
          v_ts, coalesce(row_in->>'quality', 'good'), v_source);

        v_max_ts := greatest(coalesce(v_max_ts, v_ts), v_ts);
      end if;

    -- ── material_stock ───────────────────────────────────────────────────
    elsif v_reason is null and r.entity_type = 'material_stock' then
      select id into v_material from materials
      where organization_id = v_org
        and (material_code = row_in->>'material_code'
             or (source_system = v_source and external_id = v_ext))
      limit 1;
      if v_material is null then
        v_reason := format('unknown material "%s" — the catalogue must be loaded before stock',
          coalesce(row_in->>'material_code', v_ext));
      elsif row_in->>'qty_on_hand' is null then
        v_reason := 'missing qty_on_hand';
      elsif (row_in->>'qty_on_hand')::numeric < 0 then
        v_reason := 'negative qty_on_hand';
      else
        select id into v_site from sites
        where organization_id = v_org and name = row_in->>'site_name' limit 1;

        insert into material_stock (organization_id, material_id, site_id,
          qty_on_hand, qty_on_order, source_system, updated_at)
        values (v_org, v_material, v_site, (row_in->>'qty_on_hand')::numeric,
          coalesce((row_in->>'qty_on_order')::numeric, 0), v_source, now())
        on conflict (material_id, site_id) do update
          set qty_on_hand = excluded.qty_on_hand,
              qty_on_order = excluded.qty_on_order,
              source_system = excluded.source_system,
              updated_at = now();
        v_max_ts := greatest(coalesce(v_max_ts, now()), now());
      end if;

    -- ── work_order ───────────────────────────────────────────────────────
    elsif v_reason is null and r.entity_type = 'work_order' then
      if row_in->>'title' is null then
        v_reason := 'missing title';
      else
        select id into v_asset from assets
        where organization_id = v_org
          and (id::text = row_in->>'asset_id' or name = row_in->>'asset_name')
        limit 1;

        if exists (select 1 from work_orders
                   where organization_id = v_org and source_system = v_source
                     and external_id = v_ext) then
          v_dup := v_dup + 1;
          insert into ingest_staging (organization_id, connector_id, run_id,
            entity_type, external_id, payload, status)
          values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'duplicate');
          continue;
        end if;

        insert into work_orders (organization_id, asset_id, wo_number, title,
          status, priority, work_type, created_at, completed_at,
          actual_failure_mode, downtime_hours, source_system, external_id)
        values (v_org, v_asset, coalesce(row_in->>'wo_number', v_ext),
          row_in->>'title', coalesce(row_in->>'status', 'open'),
          coalesce(row_in->>'priority', 'medium'),
          coalesce(row_in->>'work_type', 'corrective'),
          coalesce((row_in->>'created_at')::timestamptz, now()),
          (row_in->>'completed_at')::timestamptz,
          row_in->>'failure_mode',
          (row_in->>'downtime_hours')::numeric, v_source, v_ext);
        v_max_ts := greatest(coalesce(v_max_ts, now()),
          coalesce((row_in->>'created_at')::timestamptz, now()));
      end if;

    elsif v_reason is null then
      v_reason := format('unsupported entity_type "%s"', r.entity_type);
    end if;

    if v_reason is null then
      v_ok := v_ok + 1;
      insert into ingest_staging (organization_id, connector_id, run_id,
        entity_type, external_id, payload, status)
      values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'accepted');
    else
      v_rej := v_rej + 1;
      -- The rejected row is KEPT. A connector that silently drops rows reports
      -- a successful sync; this is what makes that impossible.
      insert into ingest_staging (organization_id, connector_id, run_id,
        entity_type, external_id, payload, status, reject_reason)
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

grant execute on function public.ingest_batch(uuid, jsonb) to authenticated;

create or replace function public.finish_connector_run(
  p_run_id uuid,
  p_status text default 'success',
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  r connector_runs%rowtype;
begin
  select * into r from connector_runs where id = p_run_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;

  update connector_runs
  set status = p_status, finished_at = now(), error_message = p_error,
      records_processed = records_accepted
  where id = p_run_id;

  -- The watermark advances only on a clean run. Advancing it after a partial
  -- failure is how rows get skipped forever.
  if p_status = 'success' and r.watermark_to is not null then
    insert into ingest_watermarks (organization_id, connector_id, entity_type,
      last_position, last_run_id)
    values (v_org, r.connector_id, r.entity_type, r.watermark_to, p_run_id)
    on conflict (connector_id, entity_type) do update
      set last_position = greatest(ingest_watermarks.last_position, excluded.last_position),
          last_run_id = excluded.last_run_id, updated_at = now();
  end if;

  update connectors
  set last_success_at = case when p_status = 'success' then now() else last_success_at end,
      last_failure_at = case when p_status <> 'success' then now() else last_failure_at end
  where id = r.connector_id;

  return jsonb_build_object('run_id', p_run_id, 'status', p_status,
    'watermark_advanced', p_status = 'success' and r.watermark_to is not null);
end
$$;

grant execute on function public.finish_connector_run(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Health: acceptance rate and staleness, not a green tick
-- ----------------------------------------------------------------------------
create or replace function public.get_connector_health()
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
    'connectors', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'connector_key', c.connector_key, 'name', c.name,
        'system_kind', c.system_kind, 'enabled', c.enabled,
        'direction', c.direction, 'write_enabled', c.write_enabled,
        'last_success_at', c.last_success_at,
        'expected_interval_minutes', c.expected_interval_minutes,
        -- A connector that has not run is STALE, never healthy. Reporting
        -- silence as success is the most common integration lie.
        'state', case
          when not c.enabled then 'disabled'
          when c.last_success_at is null then 'never run'
          when c.expected_interval_minutes is not null
               and c.last_success_at < now() - make_interval(mins => c.expected_interval_minutes * 2)
            then 'stale'
          else 'current' end,
        'runs_30d', coalesce(s.runs, 0),
        'records_accepted_30d', coalesce(s.accepted, 0),
        'records_rejected_30d', coalesce(s.rejected, 0),
        'acceptance_pct', case when coalesce(s.read, 0) > 0
          then round(100.0 * s.accepted / s.read, 1) end
      ) order by c.name), '[]'::jsonb)
      from connectors c
      left join lateral (
        select count(*) as runs, sum(records_read) as read,
               sum(records_accepted) as accepted, sum(records_rejected) as rejected
        from connector_runs cr
        where cr.connector_id = c.id and cr.started_at > now() - interval '30 days') s on true
      where c.organization_id = v_org),
    'top_reject_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reason', reason, 'count', n) order by n desc), '[]'::jsonb)
      from (
        select reject_reason as reason, count(*) as n
        from ingest_staging
        where organization_id = v_org and status = 'rejected'
          and received_at > now() - interval '30 days'
        group by reject_reason order by count(*) desc limit 8) t),
    'note', 'Rejected rows are retained in staging with their reason. A connector that silently drops rows would otherwise report a successful sync.');
end
$$;

grant execute on function public.get_connector_health() to authenticated;

notify pgrst, 'reload schema';

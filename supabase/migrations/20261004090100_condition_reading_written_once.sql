-- ============================================================================
-- Every ingested condition reading was written twice (C2.05, C2.13).
--
-- FOUND BY PROVING THE DOOR. 20261004090000 routes condition_reading to
-- ingest_batch and makes it reachable from the product for the first time. The
-- end-to-end proof loaded two rows and found four in condition_readings:
--
--   external_id | sensor_id                            | value | taken_at
--   ------------+--------------------------------------+-------+--------------------
--   CR-1        | 8765a20d-dfa1-49df-8679-2e3892adb0aa |  1.82 | 2026-03-01 06:00Z
--               | 8765a20d-dfa1-49df-8679-2e3892adb0aa |  1.82 | 2026-03-01 06:00Z
--   CR-2        | 8765a20d-dfa1-49df-8679-2e3892adb0aa |  1.79 | 2026-03-01 07:00Z
--               | 8765a20d-dfa1-49df-8679-2e3892adb0aa |  1.79 | 2026-03-01 07:00Z
--
-- ingest_batch's condition_reading branch inserted the row itself
-- (20260905090000:110-113) and then called record_condition_reading
-- (:118-120) to evaluate limits — and record_condition_reading inserts too
-- (20260810090000:201-203). Two writers, one reading.
--
-- WHY IT MATTERS MORE THAN A DUPLICATE ROW.
--   1. The second copy carries NO external_id, so it is invisible to
--      idx_condition_readings_external and to the branch's own duplicate check.
--      The contract's idempotency guarantee did not cover half of what it wrote.
--   2. record_condition_reading reads the PREVIOUS value to compute the trend
--      it writes onto sensors.trend — and read it AFTER ingest_batch had already
--      inserted the current one. Every ingested reading compared itself to
--      itself, so `trend` was pinned to 'stable' for ingested data whatever the
--      readings did. A rising vibration trend reported as stable is the
--      monitoring failure this module exists to prevent.
--   3. Any count, mean or rate over condition_readings was doubled for
--      ingested data and correct for keyed-in data, in the same column.
--
-- THE FIX IS ONE WRITER. record_condition_reading gains a sixth parameter and
-- becomes the only thing that writes a reading; ingest_batch stops inserting
-- and calls it. Limit evaluation, alert raising, escalation and clearing are
-- untouched and remain defined in exactly one place.
--
-- ONE SIGNATURE, NOT TWO. Postgres forbids a non-defaulted parameter after a
-- defaulted one, so p_external_id must default — and a defaulted sixth
-- parameter makes any five-argument call ambiguous against a surviving
-- five-argument function. The old signature is therefore dropped and replaced
-- rather than kept alongside. Manual entry omits the argument, gets null, and
-- writes exactly what it wrote before; PostgREST resolves named-argument calls
-- against the default, so no client call site changes. The grant is restated
-- below because a drop takes the privileges with it.
--
-- BOTH BODIES BELOW WERE SPLICED PROGRAMMATICALLY from 20260810090000 and
-- 20260905090000 rather than retyped, for the reason 20260905090000 gives for
-- doing the same: hand-copying validation and alert logic to change three lines
-- is how a transcription error reaches production disguised as a fix. The
-- splice asserts its target appears exactly once and that no direct insert into
-- condition_readings survives in ingest_batch.
--
-- NOT BACKFILLED. The orphan copies already written have no external_id and no
-- way to be told apart from a genuine manual reading recorded with the same
-- source_system, so a delete would be a guess about customer data. This
-- migration stops the doubling; naming the existing rows is a data question for
-- the tenant, not a schema one.
-- ============================================================================

-- The five-argument signature is REPLACED, not kept beside a six-argument one.
-- Postgres forbids a non-defaulted parameter after a defaulted one, and giving
-- p_external_id a default makes a five-argument call ambiguous between the two
-- — so one function it is. Manual entry omits the argument and gets null,
-- which is the same thing it always wrote and still means "keyed in, not
-- replayed". PostgREST resolves named-argument calls against the default, so no
-- client call site changes.
drop function if exists public.record_condition_reading(uuid, numeric, timestamptz, text, text);

create or replace function public.record_condition_reading(
  p_sensor_id uuid,
  p_value numeric,
  p_taken_at timestamptz default now(),
  p_quality text default 'good',
  p_source_system text default null,
  p_external_id text default null
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
    quality, taken_at, source_system, external_id)
  values (v_org, p_sensor_id, s.asset_id, p_value, p_quality, p_taken_at,
    p_source_system, p_external_id);

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

revoke all on function public.record_condition_reading(uuid, numeric, timestamptz, text, text, text) from public, anon;
grant execute on function public.record_condition_reading(uuid, numeric, timestamptz, text, text, text) to authenticated;
grant execute on function public.record_condition_reading(uuid, numeric, timestamptz, text, text, text) to service_role;

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
  v_notif uuid;
  v_plan_asset uuid;
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

        -- ONE write, through the same function a manual reading uses, so an
        -- ingested breach raises an alert exactly as a keyed-in one would.
        --
        -- Until this migration the branch inserted the reading ITSELF and then
        -- called record_condition_reading, which inserts as well. Every
        -- ingested reading was therefore stored TWICE — once carrying
        -- external_id and once not — and the second copy, having no external
        -- id, sat outside idx_condition_readings_external and outside the
        -- duplicate check above, so nothing could ever find or dedupe it.
        perform record_condition_reading(v_sensor, (row_in->>'value')::numeric,
          v_ts, coalesce(row_in->>'quality', 'good'), v_source, v_ext);

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

    -- ── maintenance_notification ─────────────────────────────────────────
    elsif v_reason is null and r.entity_type = 'maintenance_notification' then
      if row_in->>'description' is null then
        v_reason := 'missing description — a notification with no observation is not a report';
      else
        select id into v_asset from assets
        where organization_id = v_org
          and (id::text = row_in->>'asset_id' or name = row_in->>'asset_name')
        limit 1;
        -- An unmatched asset is a REJECT, not a null. A notification whose asset
        -- cannot be resolved is invisible to duplicate detection and to every
        -- per-asset reliability figure, so accepting it would quietly lose it.
        if v_asset is null and coalesce(row_in->>'asset_id', row_in->>'asset_name') is not null then
          v_reason := format('unknown asset "%s"',
            coalesce(row_in->>'asset_id', row_in->>'asset_name'));
        else
          insert into maintenance_notifications (organization_id, asset_id,
            notification_no, description, notification_type, reported_by,
            reported_at, status)
          values (v_org, v_asset, coalesce(row_in->>'notification_no', v_ext),
            row_in->>'description',
            coalesce(row_in->>'notification_type', 'fault'),
            row_in->>'reported_by',
            coalesce((row_in->>'reported_at')::timestamptz, now()),
            coalesce(row_in->>'status', 'open'))
          on conflict (organization_id, notification_no)
            where notification_no is not null
            do update set description = excluded.description,
                          status = excluded.status
          returning id into v_notif;
          v_max_ts := greatest(coalesce(v_max_ts, now()),
            coalesce((row_in->>'reported_at')::timestamptz, now()));
        end if;
      end if;

    -- ── maintenance_plan ─────────────────────────────────────────────────
    elsif v_reason is null and r.entity_type = 'maintenance_plan' then
      select id into v_plan_asset from assets
      where organization_id = v_org
        and (id::text = row_in->>'asset_id' or name = row_in->>'asset_name')
      limit 1;
      if row_in->>'task_label' is null then
        v_reason := 'missing task_label';
      elsif v_plan_asset is null then
        v_reason := format('unknown asset "%s"',
          coalesce(row_in->>'asset_id', row_in->>'asset_name', '(none supplied)'));
      elsif (row_in->>'interval_value') is null
            or (row_in->>'interval_value')::numeric <= 0 then
        v_reason := 'interval_value must be a positive number';
      elsif coalesce(row_in->>'interval_basis', 'calendar_days')
              not in ('calendar_days', 'run_hours') then
        v_reason := format('interval_basis "%s" is neither calendar_days nor run_hours',
          row_in->>'interval_basis');
      else
        -- `source` carries the operator's own basis for the interval. It is
        -- recorded rather than defaulted, because an interval with no stated
        -- source is an assertion and the PM-due denominator is built on these.
        insert into maintenance_plans (organization_id, asset_id, task_code,
          task_label, interval_basis, interval_value, last_performed_at, source)
        values (v_org, v_plan_asset, coalesce(row_in->>'task_code', v_ext),
          row_in->>'task_label',
          coalesce(row_in->>'interval_basis', 'calendar_days'),
          (row_in->>'interval_value')::numeric,
          (row_in->>'last_performed_at')::timestamptz,
          coalesce(row_in->>'source', format('Ingested from %s', v_source)))
        on conflict (organization_id, asset_id, task_code)
          where task_code is not null
          do update set task_label = excluded.task_label,
                        interval_basis = excluded.interval_basis,
                        interval_value = excluded.interval_value,
                        last_performed_at = excluded.last_performed_at,
                        source = excluded.source;
        v_max_ts := greatest(coalesce(v_max_ts, now()), now());
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

notify pgrst, 'reload schema';

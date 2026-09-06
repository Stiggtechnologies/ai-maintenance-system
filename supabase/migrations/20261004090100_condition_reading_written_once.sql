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
-- writes exactly what it wrote before. There is no client call site to break:
-- `record_condition_reading` is called from SQL only, and a grep of src/ for it
-- returns nothing. The grant is restated below because a drop takes the
-- privileges with it.
--
-- AND HISTORY IS NOT STATE. Making condition_reading reachable points a caller
-- with HISTORICAL data at a function written for a caller whose every reading
-- is by definition current. record_condition_reading set sensors.last_value,
-- status and trend from whatever reading it was handed, and opened or cleared
-- condition_alerts at that reading's own timestamp. Measured on a full schema,
-- with an honest, well-formed 2010 file that passes every client-side check:
--
--   Vibration — Drive End  12.4 / alarm / up   -- five 2.4-2.9 readings from
--     June 2010, newest-first as a historian exports them
--                        ->  2.4 / normal / down    A LIVE ALARM, SILENTLY CLEARED
--
--   Vibration — K-201  6.9 / normal, 0 open alerts  -- three rising readings,
--     June 2010, chronological
--                        ->  9.6 / alarm / up  + an OPEN, UNCLEARED alarm
--                            dated 2010-06-03 on the live board
--
-- Both reported read 3 / accepted 3 / rejected 0. A reading older than the
-- series head is history: it is stored, and it no longer speaks for the
-- present. That also removes the trend defect for good — the previous value is
-- now always the reading that actually precedes the one being recorded.
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
  v_prev_at timestamptz;
  v_trend text;
begin
  select * into s from sensors where id = p_sensor_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'sensor not found');
  end if;

  select value, taken_at into v_prev, v_prev_at from condition_readings
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

  -- HISTORY IS NOT STATE. Everything below this point describes the present:
  -- sensors.last_value/status/trend is what the equipment is doing NOW, and an
  -- alert opened or cleared here appears on the live board. A reading older
  -- than the newest one already held is a backfill, and it may not speak for
  -- the present — a 2010 historian export ends with the OLDEST row when it is
  -- sorted newest-first, so the sensor would come to describe the oldest
  -- reading in the file. The reading is stored either way; the series head is
  -- what decides whether it is also the current state.
  if v_prev_at is not null and p_taken_at < v_prev_at then
    return jsonb_build_object('recorded', true, 'historical', true,
      'alerted', false,
      'note', format(
        'Reading stored as history. This sensor already holds a reading at %s, '
        || 'so last_value, status and trend still describe the newest reading '
        || 'and no alert was raised or cleared at a past timestamp.', v_prev_at));
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
  v_ids uuid[];
  v_stock_key text;
  v_seen_ids text[] := '{}';
  v_seen_stock text[] := '{}';
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

    -- The same external_id twice in ONE file is a copy-pasted identifier, not a
    -- replay. Reporting it as `duplicate` told the operator the row was already
    -- loaded when in fact a DIFFERENT fact under a reused id was discarded.
    if v_reason is null and v_ext = any (v_seen_ids) then
      v_reason := format(
        'external_id "%s" appears more than once in this upload — only the first '
        || 'line was loaded. Give each row its own identifier.', v_ext);
    elsif v_reason is null then
      v_seen_ids := v_seen_ids || v_ext;
    end if;

    -- EVERY per-row write happens inside this subtransaction. Without it a
    -- single cell the validator cannot see aborted the WHOLE call and took the
    -- retained rejects down with the accepted rows. Measured: a
    -- notification_type of "malfunction" — an ordinary word, and what a
    -- capitalised CMMS export or a "closed" status looks like too — violated
    -- maintenance_notifications_notification_type_check and left 0 rows
    -- written, 0 rejects retained, counters 0/0/0 and the run stuck `running`,
    -- with a raw Postgres CHECK message where a row-level reason should be.
    begin

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
        select array_agg(id) into v_ids from sensors
        where organization_id = v_org
          and (id::text = row_in->>'sensor_id' or name = row_in->>'sensor_name');
        -- `limit 1` with no ORDER BY bound an ambiguous name to whichever row
        -- the scan reached first, and a plant with two "Vibration — DE" tags
        -- would have had half its history charged to the wrong machine.
        if coalesce(array_length(v_ids, 1), 0) > 1 then
          v_reason := format('sensor "%s" matches %s sensors — give sensor_id instead of sensor_name',
            coalesce(row_in->>'sensor_name', row_in->>'sensor_id'), array_length(v_ids, 1));
        else
          v_sensor := v_ids[1];
          if v_sensor is null then
            v_reason := format('unknown sensor "%s"', coalesce(row_in->>'sensor_id', row_in->>'sensor_name', '(none)'));
          end if;
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
        perform record_condition_reading(v_sensor, (btrim(row_in->>'value'))::numeric,
          v_ts, coalesce(nullif(btrim(row_in->>'quality'), ''), 'good'), v_source, v_ext);

        v_max_ts := greatest(coalesce(v_max_ts, v_ts), v_ts);
      end if;

    -- ── material_stock ───────────────────────────────────────────────────
    elsif v_reason is null and r.entity_type = 'material_stock' then
      select array_agg(id) into v_ids from materials
      where organization_id = v_org
        and (material_code = row_in->>'material_code'
             or (source_system = v_source and external_id = v_ext));
      v_material := null;
      v_site := null;
      if coalesce(array_length(v_ids, 1), 0) > 1 then
        v_reason := format('material "%s" matches %s catalogue entries',
          coalesce(row_in->>'material_code', v_ext), array_length(v_ids, 1));
      else
        v_material := v_ids[1];
      end if;

      if v_reason is not null then
        null;
      elsif v_material is null then
        v_reason := format('unknown material "%s" — the catalogue must be loaded before stock',
          coalesce(row_in->>'material_code', v_ext));
      elsif nullif(btrim(row_in->>'qty_on_hand'), '') is null then
        v_reason := 'missing qty_on_hand';
      elsif (btrim(row_in->>'qty_on_hand'))::numeric < 0 then
        v_reason := 'negative qty_on_hand';
      -- qty_on_hand was checked and qty_on_order was not, and material_stock
      -- carries no CHECK, so a stock line arrived holding -999 on order.
      elsif coalesce((nullif(btrim(row_in->>'qty_on_order'), ''))::numeric, 0) < 0 then
        v_reason := 'negative qty_on_order';
      else
        if nullif(btrim(row_in->>'site_name'), '') is not null then
          select array_agg(id) into v_ids from sites
          where organization_id = v_org and name = btrim(row_in->>'site_name');
          if coalesce(array_length(v_ids, 1), 0) > 1 then
            v_reason := format('site "%s" matches %s sites', btrim(row_in->>'site_name'), array_length(v_ids, 1));
          else
            v_site := v_ids[1];
          end if;
          -- A site_name that matched nothing used to be dropped in silence and
          -- the row ACCEPTED, so a per-site file could land as one site-less
          -- pile with the counts reporting success. It is a refusal now.
          if v_reason is null and v_site is null then
            v_reason := format('unknown site "%s"', btrim(row_in->>'site_name'));
          end if;
        end if;

        -- material_stock holds ONE quantity per material per site and has no
        -- external_id column, so two lines in one file for the same pair
        -- silently collapsed: the second overwrote the first and BOTH were
        -- reported accepted. That is the one place the contract's arithmetic —
        -- count in = count landed + count refused — did not hold.
        v_stock_key := coalesce(v_material::text, '-') || '|' || coalesce(v_site::text, '-');
        if v_reason is null and v_stock_key = any (v_seen_stock) then
          v_reason := format(
            'another line in this file already sets stock for "%s" at "%s" — '
            || 'stock is one quantity per material per site, so this line would '
            || 'overwrite that one and both would be reported as accepted',
            coalesce(row_in->>'material_code', v_ext),
            coalesce(nullif(btrim(row_in->>'site_name'), ''), '(no site)'));
        end if;

        if v_reason is null then
          v_seen_stock := v_seen_stock || v_stock_key;
          insert into material_stock (organization_id, material_id, site_id,
            qty_on_hand, qty_on_order, source_system, updated_at)
          values (v_org, v_material, v_site, (btrim(row_in->>'qty_on_hand'))::numeric,
            coalesce((nullif(btrim(row_in->>'qty_on_order'), ''))::numeric, 0), v_source, now())
          on conflict (material_id, site_id) do update
            set qty_on_hand = excluded.qty_on_hand,
                qty_on_order = excluded.qty_on_order,
                source_system = excluded.source_system,
                updated_at = now();
          v_max_ts := greatest(coalesce(v_max_ts, now()), now());
        end if;
      end if;

    -- ── work_order ───────────────────────────────────────────────────────
    elsif v_reason is null and r.entity_type = 'work_order' then
      if nullif(btrim(row_in->>'title'), '') is null then
        v_reason := 'missing title';
      else
        select array_agg(id) into v_ids from assets
        where organization_id = v_org
          and (id::text = row_in->>'asset_id' or name = row_in->>'asset_name');
        v_asset := null;
        if coalesce(array_length(v_ids, 1), 0) > 1 then
          v_reason := format('asset "%s" matches %s assets — give asset_id instead of asset_name',
            coalesce(row_in->>'asset_name', row_in->>'asset_id'), array_length(v_ids, 1));
        else
          v_asset := v_ids[1];
        end if;
      end if;

      -- An unmatched asset is a REJECT, not a null. maintenance_notification
      -- (:347) and maintenance_plan (:378) already refuse one; work_order did
      -- not, so a row naming an asset that does not exist — including another
      -- tenant's UUID — was ACCEPTED with asset_id NULL and no reason given.
      -- Every per-asset reliability figure is computed from work_orders, so a
      -- work order with no asset is a downtime hour nobody can attribute.
      if v_reason is null and nullif(btrim(row_in->>'title'), '') is not null then
        if v_asset is null and coalesce(row_in->>'asset_id', row_in->>'asset_name') is not null then
          v_reason := format('unknown asset "%s"',
            coalesce(row_in->>'asset_name', row_in->>'asset_id'));
        else
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
      end if;

    -- ── maintenance_notification ─────────────────────────────────────────
    elsif v_reason is null and r.entity_type = 'maintenance_notification' then
      -- Both of these columns carry a CHECK, and neither was validated here or
      -- named in the client-side allowlist. `malfunction` is an ordinary word;
      -- so is a capitalised `Fault` from a CMMS export, or a `closed` status.
      -- Any of them raised, and before the subtransaction above that meant the
      -- whole file was lost with nothing retained to explain it. Refusing the
      -- row NAMES the column and the accepted values.
      if nullif(btrim(row_in->>'description'), '') is null then
        v_reason := 'missing description — a notification with no observation is not a report';
      elsif coalesce(nullif(btrim(row_in->>'notification_type'), ''), 'fault')
            not in ('fault', 'observation', 'request', 'safety') then
        v_reason := format('notification_type "%s" is not one of fault, observation, request, safety',
          btrim(row_in->>'notification_type'));
      elsif coalesce(nullif(btrim(row_in->>'status'), ''), 'open')
            not in ('open', 'in_planning', 'converted', 'rejected', 'merged') then
        v_reason := format('status "%s" is not one of open, in_planning, converted, rejected, merged',
          btrim(row_in->>'status'));
      else
        select array_agg(id) into v_ids from assets
        where organization_id = v_org
          and (id::text = row_in->>'asset_id' or name = row_in->>'asset_name');
        v_asset := null;
        if coalesce(array_length(v_ids, 1), 0) > 1 then
          v_reason := format('asset "%s" matches %s assets — give asset_id instead of asset_name',
            coalesce(row_in->>'asset_name', row_in->>'asset_id'), array_length(v_ids, 1));
        else
          v_asset := v_ids[1];
        end if;
        -- An unmatched asset is a REJECT, not a null. A notification whose asset
        -- cannot be resolved is invisible to duplicate detection and to every
        -- per-asset reliability figure, so accepting it would quietly lose it.
        if v_reason is not null then
          null;
        elsif v_asset is null and coalesce(row_in->>'asset_id', row_in->>'asset_name') is not null then
          v_reason := format('unknown asset "%s"',
            coalesce(row_in->>'asset_id', row_in->>'asset_name'));
        else
          insert into maintenance_notifications (organization_id, asset_id,
            notification_no, description, notification_type, reported_by,
            reported_at, status)
          values (v_org, v_asset, coalesce(row_in->>'notification_no', v_ext),
            btrim(row_in->>'description'),
            coalesce(nullif(btrim(row_in->>'notification_type'), ''), 'fault'),
            row_in->>'reported_by',
            coalesce((row_in->>'reported_at')::timestamptz, now()),
            coalesce(nullif(btrim(row_in->>'status'), ''), 'open'))
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
      select array_agg(id) into v_ids from assets
      where organization_id = v_org
        and (id::text = row_in->>'asset_id' or name = row_in->>'asset_name');
      v_plan_asset := null;
      if coalesce(array_length(v_ids, 1), 0) > 1 then
        v_reason := format('asset "%s" matches %s assets — give asset_id instead of asset_name',
          coalesce(row_in->>'asset_name', row_in->>'asset_id'), array_length(v_ids, 1));
      else
        v_plan_asset := v_ids[1];
      end if;
      if v_reason is not null then
        null;
      elsif nullif(btrim(row_in->>'task_label'), '') is null then
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

    exception
      when unique_violation then
        -- The dedupe INDEX is the real guarantee; the `exists` check above is
        -- only an optimisation, and a concurrent run can land the same
        -- external_id between the two. Before this block that raised and took
        -- the whole batch — the good rows AND the retained rejects — with it,
        -- showing the operator an internal index name instead of a row.
        v_reason := 'already loaded — another run wrote this external_id while this one was in flight';
      when others then
        -- The row's own writes are rolled back with the subtransaction; the
        -- counters are PL/pgSQL variables and are not. The database's own words
        -- are the reason, because a CHECK it enforces is a fact this validator
        -- may not have been taught yet.
        v_reason := format('the database refused this row: %s', sqlerrm);
    end;

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

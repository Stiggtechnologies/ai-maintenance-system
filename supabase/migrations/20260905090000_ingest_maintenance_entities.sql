-- ============================================================================
-- Make the two entities added this week loadable by a customer (C2.12).
--
-- 20260903090000 and 20260904090000 modelled maintenance plans and maintenance
-- notifications, and both are reachable today only by migration. That makes
-- them demonstration furniture: the PM-due denominator and the duplicate
-- detector are real, and no operator can put their own data behind either. A
-- capability nobody can load is not a capability.
--
-- The ingest contract already carries work_order and material_stock end to end
-- — staging, validation, idempotency on (source_system, external_id), and
-- rejected rows KEPT rather than dropped. These two entities join it on the
-- same terms rather than arriving through a side door.
--
-- WHY THE FUNCTION IS REPRODUCED WHOLE. ingest_batch dispatches on entity_type
-- through one inline if/elsif chain, so there is no seam to extend and the
-- definition has to be replaced. It was spliced programmatically from the
-- 20260810160000 source rather than retyped, because hand-copying two hundred
-- lines of customer-data validation to add two branches is how a transcription
-- error reaches production disguised as a feature.
--
-- AN UNRESOLVED ASSET IS A REJECT, NOT A NULL. Both entities refuse a row whose
-- asset cannot be matched. A notification with no asset is invisible to
-- duplicate detection and to every per-asset reliability figure; a plan with no
-- asset contributes nothing to the PM-due count. Accepting either as a null
-- would report a clean sync while quietly losing the row — and the contract's
-- own reason for keeping rejects is that a connector reporting success while
-- dropping data is the failure worth engineering against.
-- ============================================================================

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
grant execute on function public.ingest_batch(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

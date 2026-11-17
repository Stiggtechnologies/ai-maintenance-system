-- C2.04: governed process-event ingest and per-asset read model.
-- Process alarms/trips remain canonical process_events, never condition_alerts.

do $dedupe$
begin
  if exists (
    select 1 from public.process_events
    where external_id is not null and source_system is not null
    group by organization_id, source_system, external_id having count(*) > 1
  ) then
    raise exception 'process_events contains duplicate source identities; reconcile them before enabling governed replay'
      using errcode = 'check_violation';
  end if;
end
$dedupe$;

create unique index if not exists idx_process_events_external
  on public.process_events(organization_id, source_system, external_id)
  where external_id is not null and source_system is not null;

revoke insert, update, delete, truncate on public.process_events from anon, authenticated;

create or replace function public.ingest_entity_routes()
returns table (entity_type text, handler text)
language sql immutable set search_path = public
as $$
  select * from (values
    ('condition_reading',        'ingest_batch'),
    ('material_stock',           'ingest_batch'),
    ('maintenance_notification', 'ingest_batch'),
    ('maintenance_plan',         'ingest_batch'),
    ('work_order',               'ingest_batch'),
    ('operating_state',          'ingest_context_batch'),
    ('process_event',            'ingest_process_event_batch'),
    ('production_record',        'ingest_context_batch'),
    ('schedule_activity',        'ingest_schedule_batch'),
    ('procurement_status',       'ingest_procurement_status_batch'),
    ('cost_actual',              'ingest_cost_actual_batch')
  ) as routes(entity_type, handler);
$$;
revoke all on function public.ingest_entity_routes() from public, anon;
grant execute on function public.ingest_entity_routes() to authenticated;

create or replace function public.ingest_process_event_batch(p_run_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  r connector_runs%rowtype;
  row_in jsonb;
  v_ext text;
  v_source text;
  v_reason text;
  v_asset_raw text;
  v_asset_name text;
  v_asset_id uuid;
  v_asset_count int;
  v_type text;
  v_severity text;
  v_tag text;
  v_description text;
  v_at_raw text;
  v_at timestamptz;
  v_seen text[] := '{}';
  v_read int := 0;
  v_ok int := 0;
  v_dup int := 0;
  v_rej int := 0;
  v_max_ts timestamptz;
begin
  select * into r from connector_runs
   where id = p_run_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'run not found'); end if;
  if r.status <> 'running' then
    return jsonb_build_object('error', 'this run is already ' || r.status);
  end if;
  if r.entity_type = 'process_event' then
    null; -- this dedicated validator owns exactly this route
  else
    return jsonb_build_object('error', 'run is not a process_event import');
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('error', 'rows must be a JSON array');
  end if;

  select connector_key into v_source from connectors
   where id = r.connector_id and organization_id = v_org
     and connector_type = 'manual_upload';
  if v_source is null then
    return jsonb_build_object('error', 'the run is not bound to a governed manual-upload source');
  end if;

  for row_in in select * from jsonb_array_elements(p_rows) loop
    v_read := v_read + 1;
    v_reason := null;
    v_asset_id := null;
    v_asset_count := 0;
    v_ext := nullif(btrim(coalesce(row_in->>'external_id', '')), '');
    if v_ext is null then
      v_reason := 'missing external_id: an event without a stable source identity cannot be replayed safely';
    elsif v_ext = any(v_seen) then
      v_reason := format('external_id "%s" appears more than once in this upload', v_ext);
    else
      v_seen := v_seen || v_ext;
    end if;

    begin
      v_asset_raw := nullif(btrim(coalesce(row_in->>'asset_id', '')), '');
      v_asset_name := nullif(btrim(coalesce(row_in->>'asset_name', '')), '');
      if v_reason is null and v_asset_raw is null and v_asset_name is null then
        v_reason := 'asset_id or asset_name is required';
      elsif v_reason is null and v_asset_raw is not null then
        v_asset_id := sync_text_as_uuid(v_asset_raw);
        if v_asset_id is null then
          v_reason := format('asset_id "%s" is not a UUID', v_asset_raw);
        elsif not exists (select 1 from assets where id = v_asset_id and organization_id = v_org) then
          v_reason := 'asset not found in this organization';
        end if;
      elsif v_reason is null then
        select count(*), max(id::text)::uuid into v_asset_count, v_asset_id
          from assets where organization_id = v_org and name = v_asset_name;
        if v_asset_count = 0 then
          v_reason := format('asset_name "%s" does not resolve in this organization', v_asset_name);
        elsif v_asset_count > 1 then
          v_reason := format('asset_name "%s" is ambiguous — use asset_id', v_asset_name);
        end if;
      end if;

      v_type := lower(nullif(btrim(coalesce(row_in->>'event_type', '')), ''));
      v_severity := lower(nullif(btrim(coalesce(row_in->>'severity', '')), ''));
      v_tag := nullif(btrim(coalesce(row_in->>'tag', '')), '');
      v_description := nullif(btrim(coalesce(row_in->>'description', '')), '');
      v_at_raw := nullif(btrim(coalesce(row_in->>'occurred_at', '')), '');
      v_at := sync_text_as_timestamptz(v_at_raw);

      if v_reason is null and (v_type is null or v_type not in
          ('alarm','trip','interlock','excursion','start','stop')) then
        v_reason := 'event_type must be alarm, trip, interlock, excursion, start or stop';
      elsif v_reason is null and v_severity is not null and v_severity not in
          ('low','medium','high','critical') then
        v_reason := 'severity must be low, medium, high or critical when supplied';
      elsif v_reason is null and v_tag is null and v_description is null then
        v_reason := 'tag or description is required';
      elsif v_reason is null and (v_at_raw is null or v_at_raw !~* '(Z|[+-][0-9]{2}:?[0-9]{2})$') then
        v_reason := 'occurred_at must include Z or an explicit UTC offset';
      elsif v_reason is null and (v_at is null or not isfinite(v_at)) then
        v_reason := 'occurred_at is not a finite timestamp';
      elsif v_reason is null and v_at > now() + interval '1 hour' then
        v_reason := 'occurred_at is more than one hour in the future; correct the source clock';
      end if;

      if v_reason is null and exists (
        select 1 from process_events where organization_id = v_org
          and source_system = v_source and external_id = v_ext
      ) then
        v_dup := v_dup + 1;
        insert into ingest_staging (organization_id, connector_id, run_id,
          entity_type, external_id, payload, status)
        values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'duplicate');
        continue;
      end if;

      if v_reason is null then
        insert into process_events(organization_id, asset_id, event_type, severity,
          tag, description, occurred_at, source_system, external_id)
        values(v_org, v_asset_id, v_type, v_severity, v_tag, v_description,
          v_at, v_source, v_ext);
        v_max_ts := greatest(coalesce(v_max_ts, v_at), v_at);
      end if;
    exception
      when unique_violation then
        v_reason := 'already loaded — another run wrote this source identity while this one was in flight';
      when others then
        v_reason := format('the database refused this row: %s', sqlerrm);
    end;

    if v_reason is null then
      v_ok := v_ok + 1;
      insert into ingest_staging (organization_id, connector_id, run_id,
        entity_type, external_id, payload, status)
      values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'accepted');
    else
      v_rej := v_rej + 1;
      insert into ingest_staging (organization_id, connector_id, run_id,
        entity_type, external_id, payload, status, reject_reason)
      values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in,
        'rejected', v_reason);
    end if;
  end loop;

  update connector_runs set
    records_read = records_read + v_read,
    records_accepted = records_accepted + v_ok,
    records_rejected = records_rejected + v_rej,
    records_duplicate = records_duplicate + v_dup,
    watermark_to = greatest(coalesce(watermark_to, v_max_ts), v_max_ts)
  where id = p_run_id and organization_id = v_org;

  return jsonb_build_object('read', v_read, 'accepted', v_ok,
    'duplicate', v_dup, 'rejected', v_rej);
end
$$;
revoke all on function public.ingest_process_event_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_process_event_batch(uuid, jsonb) to service_role;

do $router$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ingest_rows';
  if v_def is null then raise exception 'ingest_rows router is missing'; end if;
  if position('ingest_process_event_batch' in v_def) = 0 then
    v_new := replace(v_def,
      $old$  elsif v_handler = 'ingest_cost_actual_batch' then
    return public.ingest_cost_actual_batch(p_run_id, p_rows);
  end if;$old$,
      $new$  elsif v_handler = 'ingest_cost_actual_batch' then
    return public.ingest_cost_actual_batch(p_run_id, p_rows);
  elsif v_handler = 'ingest_process_event_batch' then
    return public.ingest_process_event_batch(p_run_id, p_rows);
  end if;$new$);
    if v_new = v_def then
      raise exception 'cost-actual dispatch anchor changed; refusing a blind router rewrite'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$router$;
revoke all on function public.ingest_rows(uuid, jsonb) from public, anon;
grant execute on function public.ingest_rows(uuid, jsonb) to authenticated, service_role;

create or replace function public.get_process_event_context(
  p_asset_id uuid, p_window_days int default 90
)
returns jsonb language plpgsql security definer set search_path = public stable
as $$
declare
  v_org uuid := app_current_org();
  v_days int := greatest(coalesce(p_window_days, 90), 1);
  v_from timestamptz;
  v_total int;
  v_all int;
  v_first timestamptz;
  v_last timestamptz;
  v_events jsonb;
begin
  if not exists (select 1 from assets where id = p_asset_id and organization_id = v_org) then
    return jsonb_build_object('error', 'asset not found');
  end if;
  v_from := now() - make_interval(days => v_days);
  select count(*), min(occurred_at), max(occurred_at)
    into v_all, v_first, v_last from process_events
    where organization_id = v_org and asset_id = p_asset_id;
  select count(*) into v_total from process_events
    where organization_id = v_org and asset_id = p_asset_id and occurred_at >= v_from;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'event_type', event_type, 'severity', severity, 'tag', tag,
      'description', description, 'occurred_at', occurred_at,
      'source_system', source_system) order by occurred_at desc), '[]'::jsonb)
    into v_events from (
      select * from process_events where organization_id = v_org
        and asset_id = p_asset_id and occurred_at >= v_from
      order by occurred_at desc limit 100
    ) e;
  return jsonb_build_object(
    'asset_id', p_asset_id, 'window_days', v_days,
    'total_in_window', v_total, 'records_total', v_all,
    'data_span_from', v_first, 'data_span_to', v_last, 'events', v_events,
    'basis', case
      when v_all = 0 then 'No process events have been recorded for this asset.'
      when v_total = 0 then format('No process events fall inside this %s-day window; older source events exist.', v_days)
      when v_total > 100 then format('%s process events fall inside the window; the 100 most recent are shown.', v_total)
      else format('%s process event%s fall inside the requested window.', v_total, case when v_total = 1 then '' else 's' end)
    end);
end
$$;
revoke all on function public.get_process_event_context(uuid, int) from public, anon;
grant execute on function public.get_process_event_context(uuid, int) to authenticated;

comment on function public.ingest_process_event_batch(uuid, jsonb) is
  'C2.04 router-only, tenant-bound process-event import. It cannot acknowledge or suppress alarms or write condition_alerts.';
comment on function public.get_process_event_context(uuid, int) is
  'C2.04 tenant-bound per-asset process-event evidence; separate from predictive condition alerts.';

notify pgrst, 'reload schema';

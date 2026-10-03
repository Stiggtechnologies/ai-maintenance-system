-- Close the ADLS row-provenance and clean-watermark gap discovered by the
-- C2.14 fresh-database smoke. The transport attaches `_sync_source` to every
-- mapped row, while the canonical Recovery validator correctly rejects
-- arbitrary nested values. This migration admits that one reserved envelope
-- only inside the attested ADLS wrapper, proves it against the immutable run
-- manifest, retains it in canonical staging, and reconciles all transported
-- rows before a clean cursor can advance.

create or replace function public.recovery_activation_allowed_fields(
  p_entity_type text
) returns text[]
language sql
stable
set search_path=public
as $$
  select (
    case p_entity_type
      when 'site' then array['external_id','name','code','location']
      when 'asset' then array['external_id','name','site_external_id','tag','asset_class','criticality','status','area','system','manufacturer','model','serial_number']
      when 'work_order' then array['external_id','title','asset_external_id','wo_number','status','priority','work_type','planned_hours','created_at','completed_at','failure_mode','downtime_hours']
      when 'material' then array['external_id','material_code','description','unit_of_measure','category','unit_cost_usd','lead_time_days','criticality','basis']
      when 'material_stock' then array['external_id','material_external_id','site_external_id','qty_on_hand','qty_reserved','qty_on_order','last_counted_at']
      when 'craft_capacity' then array['external_id','site_external_id','craft','weekly_hours','effective_from','basis']
      when 'operating_state' then array['external_id','asset_external_id','state','started_at','ended_at','load_pct','reason_code']
      when 'production_record' then array['external_id','site_external_id','asset_external_id','period_start','period_end','units_produced','unit_of_measure']
      else '{}'::text[]
    end
  ) || case
    when coalesce(current_setting('app.data_lake_ingest',true),'')='granted'
      then array['_sync_source']::text[]
    else '{}'::text[]
  end
$$;

revoke all on function public.recovery_activation_allowed_fields(text)
from public,anon,authenticated;

create or replace function public.restore_data_lake_staging_provenance()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_receipt jsonb;
begin
  if coalesce(current_setting('app.data_lake_ingest',true),'')='granted'
     and jsonb_typeof(new.payload->'_sync_source')='string'
     and exists(
       select 1
       from public.connector_runs r
       join public.connectors c
         on c.id=r.connector_id and c.organization_id=r.organization_id
       where r.id=new.run_id and r.organization_id=new.organization_id
         and c.connector_type='recovery_activation'
         and c.system_kind='data_lake' and c.register_ref='C2.14'
     ) then
    begin
      v_receipt:=(new.payload->>'_sync_source')::jsonb;
    exception when others then
      raise exception 'attested ADLS row provenance is not valid JSON';
    end;
    if jsonb_typeof(v_receipt)<>'object' then
      raise exception 'attested ADLS row provenance must be an object';
    end if;
    new.payload:=jsonb_set(new.payload,'{_sync_source}',v_receipt,true);
  end if;
  return new;
end
$$;

revoke all on function public.restore_data_lake_staging_provenance()
from public,anon,authenticated;

drop trigger if exists trg_restore_data_lake_staging_provenance
on public.ingest_staging;
create trigger trg_restore_data_lake_staging_provenance
before insert on public.ingest_staging
for each row execute function public.restore_data_lake_staging_provenance();

create or replace function public.ingest_data_lake_read_batch(
  p_run_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_run public.connector_runs%rowtype;
  v_row jsonb;
  v_receipt jsonb;
  v_canonical_row jsonb;
  v_result jsonb;
  v_external_id text;
  v_read int:=0;
  v_accepted int:=0;
  v_duplicate int:=0;
  v_rejected int:=0;
begin
  if v_org is null or not public.recovery_role_allowed(
    array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']
  ) then
    return jsonb_build_object('error','data-lake ingestion authority denied');
  end if;
  if coalesce(jsonb_typeof(p_rows),'')<>'array' then
    return jsonb_build_object('error','rows must be a JSON array');
  end if;
  if jsonb_array_length(p_rows)>500 then
    return jsonb_build_object('error','commit batches are limited to 500 rows');
  end if;
  select r.* into v_run
  from public.connector_runs r
  join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=v_org and r.status='running'
    and c.connector_type='recovery_activation' and c.system_kind='data_lake'
    and c.register_ref='C2.14' and c.enabled and c.direction='read_only'
    and not c.write_enabled;
  if not found then
    return jsonb_build_object('error','running governed ADLS run not found');
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row)<>'object' then
      return jsonb_build_object('error','every ADLS row must be a JSON object');
    end if;
    v_receipt:=v_row->'_sync_source';
    if coalesce(jsonb_typeof(v_receipt),'')<>'object' then
      return jsonb_build_object('error','every ADLS row requires immutable source provenance');
    end if;
    if (select count(*) from jsonb_object_keys(v_receipt))<>6
       or exists(
         select 1 from jsonb_object_keys(v_receipt) key
         where key not in (
           'transport','path','etag','last_modified','content_length','sha256'
         )
       ) then
      return jsonb_build_object('error','ADLS row provenance has an invalid contract');
    end if;
    if not exists(
      select 1
      from jsonb_array_elements(v_run.transport_manifest) item
      where item->>'transport' is not distinct from v_receipt->>'transport'
        and item->>'path' is not distinct from v_receipt->>'path'
        and item->>'etag' is not distinct from v_receipt->>'etag'
        and item->>'last_modified' is not distinct from v_receipt->>'last_modified'
        and item->>'content_length' is not distinct from v_receipt->>'content_length'
        and item->>'sha256' is not distinct from v_receipt->>'sha256'
    ) then
      return jsonb_build_object('error','ADLS row provenance does not match the immutable run manifest');
    end if;
  end loop;

  perform set_config('app.data_lake_ingest','granted',true);

  -- Classify only an exact business-payload replay as a duplicate. Transport
  -- receipts vary between files and runs, so they are deliberately excluded
  -- from the comparison; a changed source row must still reach the canonical
  -- upsert path. Process rows in order so a repeated row in the same batch is
  -- also idempotent. The canonical validator accepts scalar values only, so
  -- encode the already verified receipt for that call; the staging trigger
  -- restores the exact object before each append.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_external_id:=nullif(trim(v_row->>'external_id'),'');
    v_canonical_row:=jsonb_set(
      v_row,
      '{_sync_source}',
      to_jsonb((v_row->'_sync_source')::text),
      true
    );

    if v_external_id is not null then
      perform pg_advisory_xact_lock(
        hashtextextended(
          v_org::text||':'||v_run.connector_id::text||':'||
          v_run.entity_type||':'||v_external_id,
          0
        )
      );
    end if;

    if v_external_id is not null and (
      select s.payload-'_sync_source'
      from public.ingest_staging s
      where s.organization_id=v_org
        and s.connector_id=v_run.connector_id
        and s.entity_type=v_run.entity_type
        and s.external_id=v_external_id
        and s.status='accepted'
      order by s.received_at desc,s.id desc
      limit 1
    )=(v_row-'_sync_source') then
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,
        external_id,payload,status
      ) values(
        v_org,v_run.connector_id,p_run_id,v_run.entity_type,
        v_external_id,v_canonical_row,'duplicate'
      );
      update public.connector_runs set
        records_read=records_read+1,
        records_duplicate=records_duplicate+1
      where id=p_run_id and organization_id=v_org and status='running';
      v_read:=v_read+1;
      v_duplicate:=v_duplicate+1;
      continue;
    end if;

    v_result:=public.ingest_recovery_activation_batch(
      p_run_id,
      jsonb_build_array(v_canonical_row)
    );
    if v_result ? 'error' then
      raise exception 'canonical ADLS ingestion failed: %',v_result->>'error';
    end if;
    v_read:=v_read+coalesce((v_result->>'read')::int,0);
    v_accepted:=v_accepted+coalesce((v_result->>'accepted')::int,0);
    v_duplicate:=v_duplicate+coalesce((v_result->>'duplicate')::int,0);
    v_rejected:=v_rejected+coalesce((v_result->>'rejected')::int,0);
  end loop;

  return jsonb_build_object(
    'read',v_read,
    'accepted',v_accepted,
    'duplicate',v_duplicate,
    'rejected',v_rejected
  );
end
$$;

revoke all on function public.ingest_data_lake_read_batch(uuid,jsonb)
from public,anon;
grant execute on function public.ingest_data_lake_read_batch(uuid,jsonb)
to authenticated;

create or replace function public.finish_data_lake_read_run(
  p_organization_id uuid,
  p_run_id uuid,
  p_status text,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_run public.connector_runs%rowtype;
  v_clean boolean;
  v_advanced boolean:=false;
  v_rows int:=0;
  v_manifest_rows bigint:=0;
begin
  if p_status not in ('success','partial','failed') then
    return jsonb_build_object('error','data-lake run status must be success, partial or failed');
  end if;
  select r.* into v_run
  from public.connector_runs r
  join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id
    and r.status='running' and c.connector_type='recovery_activation'
    and c.system_kind='data_lake' and c.register_ref='C2.14';
  if not found then
    return jsonb_build_object('error','running governed ADLS run not found');
  end if;

  select coalesce(sum((item->>'row_count')::bigint),0)
  into v_manifest_rows
  from jsonb_array_elements(v_run.transport_manifest) item;

  if p_status in ('success','partial')
     and (
       v_run.records_read<>v_manifest_rows
       or v_run.records_read<>
          v_run.records_accepted+v_run.records_rejected+v_run.records_duplicate
     ) then
    return jsonb_build_object(
      'error','transported and ingested ADLS row counts do not reconcile'
    );
  end if;
  if p_status='success' and v_run.records_rejected<>0 then
    return jsonb_build_object(
      'error','a clean ADLS finish cannot contain rejected rows'
    );
  end if;

  v_clean:=p_status='success' and v_run.records_rejected=0
    and v_run.records_read=v_manifest_rows
    and v_run.transport_cursor_to is not null
    and v_run.transport_manifest is not null;

  perform set_config('app.data_lake_finish','granted',true);
  update public.connector_runs set
    status=p_status,
    finished_at=now(),
    error_message=case when p_error is null then null else left(p_error,500) end,
    records_processed=records_accepted
  where id=p_run_id and organization_id=p_organization_id;

  if v_clean then
    insert into public.ingest_watermarks(
      organization_id,connector_id,entity_type,last_cursor,last_run_id,updated_at
    ) values(
      p_organization_id,v_run.connector_id,v_run.entity_type,
      v_run.transport_cursor_to,p_run_id,now()
    ) on conflict(connector_id,entity_type) do update set
      last_cursor=excluded.last_cursor,
      last_run_id=excluded.last_run_id,
      updated_at=now()
    where public.ingest_watermarks.last_cursor is null
       or (excluded.last_cursor->>'last_modified')::timestamptz>
          (public.ingest_watermarks.last_cursor->>'last_modified')::timestamptz
       or (
         (excluded.last_cursor->>'last_modified')::timestamptz=
           (public.ingest_watermarks.last_cursor->>'last_modified')::timestamptz
         and convert_to(excluded.last_cursor->>'path','UTF8')>
           convert_to(public.ingest_watermarks.last_cursor->>'path','UTF8')
       );
    get diagnostics v_rows=row_count;
    v_advanced:=v_rows=1;
  end if;

  update public.connectors set
    last_success_at=case when v_clean then now() else last_success_at end,
    last_failure_at=case when not v_clean then now() else last_failure_at end
  where id=v_run.connector_id and organization_id=p_organization_id;

  return jsonb_build_object(
    'ok',true,
    'run_id',p_run_id,
    'status',p_status,
    'cursor_advanced',v_advanced,
    'records_read',v_run.records_read,
    'manifest_rows',v_manifest_rows,
    'records_rejected',v_run.records_rejected
  );
end
$$;

revoke all on function public.finish_data_lake_read_run(
  uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.finish_data_lake_read_run(
  uuid,uuid,text,text
) to service_role;

notify pgrst, 'reload schema';

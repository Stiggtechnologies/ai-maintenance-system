-- Genuine Azure Data Lake Storage Gen2 ingestion for C2.14.
--
-- This extends the ONE connector -> connector_runs -> ingest_staging ->
-- ingest_watermarks contract already used by Recovery. It deliberately does
-- not add a lake catalog, queue, staging store, canonical entity or audit
-- ledger. The Edge transport reads ADLS with a least-privilege service
-- principal, hashes every object, and opens a canonical run only after the
-- complete bounded object window has been downloaded and parsed.

alter table public.connectors
  add column if not exists object_prefix text,
  add column if not exists object_format text,
  add column if not exists object_max_files int,
  add column if not exists object_max_bytes bigint;

alter table public.connectors
  drop constraint if exists connectors_object_profile_check;
alter table public.connectors
  add constraint connectors_object_profile_check check (
    (
      object_prefix is null and object_format is null
      and object_max_files is null and object_max_bytes is null
    )
    or (
      object_prefix is not null
      and length(object_prefix) between 1 and 1024
      and object_prefix !~ '(^/|\\|[?#[:cntrl:]]|(^|/)\.\.(/|$)|//)'
      and coalesce(object_format in ('csv','jsonl','json'),false)
      and coalesce(object_max_files between 1 and 100,false)
      and coalesce(object_max_bytes between 1048576 and 52428800,false)
    )
  );

comment on column public.connectors.object_prefix is
  'Administrator-approved ADLS path prefix. It is never supplied by a pull request and may not contain traversal, query or fragment syntax.';
comment on column public.connectors.object_format is
  'Approved object serialization for the bounded ADLS dataset: csv, jsonl or json.';
comment on column public.connectors.object_max_files is
  'Hard maximum number of immutable ADLS objects downloaded in one run (1..100).';
comment on column public.connectors.object_max_bytes is
  'Hard maximum aggregate ADLS payload bytes for one run (1 MiB..50 MiB).';

alter table public.connector_runs
  add column if not exists transport_manifest jsonb,
  add column if not exists transport_cursor_from jsonb,
  add column if not exists transport_cursor_to jsonb,
  add column if not exists source_object_count int,
  add column if not exists source_bytes bigint;

alter table public.connector_runs
  drop constraint if exists connector_runs_transport_evidence_check;
alter table public.connector_runs
  add constraint connector_runs_transport_evidence_check check (
    transport_manifest is null
    or case when jsonb_typeof(transport_manifest)='array' then
      jsonb_array_length(transport_manifest) between 1 and 100
      and coalesce(jsonb_typeof(transport_cursor_to)='object',false)
      and coalesce(source_object_count=jsonb_array_length(transport_manifest),false)
      and coalesce(source_bytes between 0 and 52428800,false)
    else false end
  );

comment on column public.connector_runs.transport_manifest is
  'Retained source-object evidence: path, ETag, last-modified time, content length, SHA-256 and parsed row count. Never contains credentials or object contents.';
comment on column public.connector_runs.transport_cursor_from is
  'Deterministic source cursor inherited from the last clean run.';
comment on column public.connector_runs.transport_cursor_to is
  'Deterministic source cursor proposed by this fully fetched object window; committed only by a clean finish.';

alter table public.ingest_watermarks
  add column if not exists last_cursor jsonb;

comment on column public.ingest_watermarks.last_cursor is
  'Opaque connector-specific cursor. C2.14 uses {last_modified,path}; it advances only after a clean, zero-reject run.';

create or replace function public.configure_data_lake_read_source(
  p_key text,
  p_name text,
  p_filesystem_url text,
  p_object_prefix text,
  p_object_format text,
  p_max_files int,
  p_max_bytes bigint,
  p_expected_interval_minutes int,
  p_credential_binding_ref text,
  p_enabled boolean,
  p_basis text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_id uuid;
  v_endpoint text:=lower(trim(coalesce(p_filesystem_url,'')));
  v_prefix text:=trim(coalesce(p_object_prefix,''));
  v_format text:=lower(trim(coalesce(p_object_format,'')));
  v_ref text:=nullif(trim(coalesce(p_credential_binding_ref,'')),'');
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in ('admin','ai_admin') then
    return jsonb_build_object('error','configuring an Azure data-lake source requires an administrator');
  end if;
  if coalesce(length(trim(p_key)),0)<3 or coalesce(length(trim(p_name)),0)<3 then
    return jsonb_build_object('error','connector key and name are required');
  end if;
  if coalesce(length(trim(p_basis)),0)<20 then
    return jsonb_build_object('error','record a substantive data-lake authority and basis');
  end if;
  if exists(
    select 1 from public.connectors
    where organization_id=v_org and connector_key=trim(p_key)
      and connector_type is distinct from 'recovery_activation'
  ) then
    return jsonb_build_object('error','connector key already belongs to another governed integration contract');
  end if;
  if v_endpoint !~ '^https://[a-z0-9]{3,24}\.dfs\.core\.windows\.net/[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$' then
    return jsonb_build_object('error','filesystem URL must be an exact credential-free ADLS Gen2 DFS filesystem root');
  end if;
  if length(v_prefix) not between 1 and 1024
     or v_prefix ~ '(^/|\\|[?#[:cntrl:]]|(^|/)\.\.(/|$)|//)' then
    return jsonb_build_object('error','object prefix is required and must not contain traversal, query, fragment or control syntax');
  end if;
  if v_format not in ('csv','jsonl','json') then
    return jsonb_build_object('error','object format must be csv, jsonl or json');
  end if;
  if coalesce(p_max_files,0) not between 1 and 100 then
    return jsonb_build_object('error','maximum files per run must be between 1 and 100');
  end if;
  if coalesce(p_max_bytes,0) not between 1048576 and 52428800 then
    return jsonb_build_object('error','maximum aggregate bytes must be between 1 MiB and 50 MiB');
  end if;
  if coalesce(p_expected_interval_minutes,0)<1 then
    return jsonb_build_object('error','expected interval must be at least one minute');
  end if;
  if v_ref is null or v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$'
     or v_ref ~ '[@?=#]' then
    return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value or query string');
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,endpoint_hint,
    expected_interval_minutes,credential_binding_ref,contract_note,register_ref,
    status,enabled,direction,write_enabled,object_prefix,object_format,
    object_max_files,object_max_bytes
  ) values(
    v_org,trim(p_key),trim(p_name),'recovery_activation','data_lake',v_endpoint,
    p_expected_interval_minutes,v_ref,
    'Bounded ADLS Gen2 object pull using Microsoft OAuth. Read-only; no source write-back, delete, lease or metadata mutation.',
    'C2.14',case when p_enabled then 'active' else 'configured' end,p_enabled,
    'read_only',false,v_prefix,v_format,p_max_files,p_max_bytes
  )
  on conflict(organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,connector_type='recovery_activation',system_kind='data_lake',
    endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,register_ref='C2.14',status=excluded.status,
    enabled=excluded.enabled,direction='read_only',write_enabled=false,
    object_prefix=excluded.object_prefix,object_format=excluded.object_format,
    object_max_files=excluded.object_max_files,object_max_bytes=excluded.object_max_bytes
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'data_lake_read_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      ||' read-only ADLS dataset '||trim(p_key)||' at prefix '||v_prefix,
    'approved','manual',100,auth.uid()::text,trim(p_basis),'executed'
  );

  return jsonb_build_object(
    'ok',true,'connector_id',v_id,'enabled',p_enabled,
    'direction','read_only','write_enabled',false,'transport','adls_gen2_oauth',
    'object_prefix',v_prefix,'object_format',v_format,
    'max_files',p_max_files,'max_bytes',p_max_bytes,
    'note','Credentials remain in the Edge secret registry. Pulls are user-triggered and watermarks advance only on a clean run.'
  );
end
$$;

revoke all on function public.configure_data_lake_read_source(
  text,text,text,text,text,int,bigint,int,text,boolean,text
) from public,anon;
grant execute on function public.configure_data_lake_read_source(
  text,text,text,text,text,int,bigint,int,text,boolean,text
) to authenticated;

create or replace function public.get_data_lake_read_source(
  p_connector_key text,p_entity_type text
) returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype;
  v_cursor jsonb;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error','data-lake source access denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id=v_org and connector_key=trim(p_connector_key)
    and connector_type='recovery_activation' and system_kind='data_lake'
    and register_ref='C2.14';
  if not found then return jsonb_build_object('error','governed ADLS source not found'); end if;
  select * into v_mapping from public.connector_entity_mappings
  where organization_id=v_org and connector_id=v_connector.id
    and entity_type=p_entity_type;
  if not found then return jsonb_build_object('error','entity mapping not found'); end if;
  select last_cursor into v_cursor from public.ingest_watermarks
  where connector_id=v_connector.id and entity_type=p_entity_type;
  return jsonb_build_object(
    'organization_id',v_org,'connector_key',v_connector.connector_key,
    'enabled',v_connector.enabled,'direction',v_connector.direction,
    'write_enabled',v_connector.write_enabled,'filesystem_url',v_connector.endpoint_hint,
    'credential_binding_ref',v_connector.credential_binding_ref,
    'object_prefix',v_connector.object_prefix,'object_format',v_connector.object_format,
    'max_files',v_connector.object_max_files,'max_bytes',v_connector.object_max_bytes,
    'mapping_status',v_mapping.status,'source_array_path',v_mapping.source_array_path,
    'column_mapping',v_mapping.column_mapping,'value_mappings',v_mapping.value_mappings,
    'constants',v_mapping.constants,'last_cursor',v_cursor
  );
end
$$;

revoke all on function public.get_data_lake_read_source(text,text) from public,anon;
grant execute on function public.get_data_lake_read_source(text,text) to authenticated;

-- Only the Edge transport, authenticated with service_role after validating
-- the end-user session, can attest that the full bounded object window exists.
create or replace function public.begin_data_lake_read_run(
  p_organization_id uuid,
  p_triggered_by uuid,
  p_connector_key text,
  p_entity_type text,
  p_manifest jsonb,
  p_cursor_to jsonb,
  p_source_bytes bigint
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype;
  v_role text;
  v_cursor_from jsonb;
  v_cursor_from_at timestamptz;
  v_cursor_to_at timestamptz;
  v_item jsonb;
  v_item_at timestamptz;
  v_max_at timestamptz;
  v_max_path text;
  v_source_bytes numeric:=0;
  v_run uuid;
begin
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error','data-lake run actor is not authorized for this tenant');
  end if;
  select * into v_connector from public.connectors
  where organization_id=p_organization_id and connector_key=trim(p_connector_key)
    and connector_type='recovery_activation' and system_kind='data_lake'
    and register_ref='C2.14' and enabled and direction='read_only' and not write_enabled;
  if not found then return jsonb_build_object('error','active governed ADLS source not found'); end if;
  select * into v_mapping from public.connector_entity_mappings
  where organization_id=p_organization_id and connector_id=v_connector.id
    and entity_type=p_entity_type and status='approved';
  if not found then return jsonb_build_object('error','approved entity mapping not found'); end if;
  if coalesce(jsonb_typeof(p_manifest),'')<>'array' then
    return jsonb_build_object('error','bounded ADLS transport manifest must be an array');
  end if;
  if jsonb_array_length(p_manifest) not between 1 and v_connector.object_max_files
     or coalesce(jsonb_typeof(p_cursor_to),'')<>'object'
     or coalesce(p_cursor_to->>'last_modified','')='' or coalesce(p_cursor_to->>'path','')=''
     or coalesce(p_source_bytes,-1)<0 or p_source_bytes>v_connector.object_max_bytes then
    return jsonb_build_object('error','bounded ADLS transport evidence is invalid');
  end if;
  for v_item in select value from jsonb_array_elements(p_manifest) loop
    if jsonb_typeof(v_item)<>'object'
       or coalesce(v_item->>'transport','')<>'adls_gen2'
       or coalesce(v_item->>'path','')=''
       or left(v_item->>'path',length(v_connector.object_prefix))<>v_connector.object_prefix
       or v_item->>'path' ~ '(^/|\\|[?#[:cntrl:]]|(^|/)\.\.(/|$)|//)'
       or lower(right(v_item->>'path',length(v_connector.object_format)+1))
          <>'.'||v_connector.object_format
       or coalesce(v_item->>'sha256','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_item->>'etag','')=''
       or coalesce(v_item->>'last_modified','')=''
       or coalesce(v_item->>'content_length','') !~ '^[0-9]+$'
       or (case when coalesce(v_item->>'content_length','') ~ '^[0-9]+$'
            then (v_item->>'content_length')::numeric>52428800 else true end)
       or coalesce(v_item->>'row_count','') !~ '^[0-9]+$'
       or (case when coalesce(v_item->>'row_count','') ~ '^[0-9]+$'
            then (v_item->>'row_count')::numeric>20000 else true end) then
      return jsonb_build_object('error','ADLS manifest is missing immutable object provenance');
    end if;
    begin
      v_item_at:=(v_item->>'last_modified')::timestamptz;
    exception when others then
      return jsonb_build_object('error','ADLS manifest contains an invalid last-modified timestamp');
    end;
    v_source_bytes:=v_source_bytes+(v_item->>'content_length')::numeric;
    if v_max_at is null or v_item_at>v_max_at
       or (v_item_at=v_max_at
           and convert_to(v_item->>'path','UTF8')>convert_to(v_max_path,'UTF8')) then
      v_max_at:=v_item_at;
      v_max_path:=v_item->>'path';
    end if;
  end loop;
  if v_source_bytes<>p_source_bytes then
    return jsonb_build_object('error','ADLS manifest byte total does not match the transported payload');
  end if;
  if (select count(*) from jsonb_array_elements(p_manifest))<>
     (select count(distinct value->>'path') from jsonb_array_elements(p_manifest)) then
    return jsonb_build_object('error','ADLS manifest contains a duplicate object path');
  end if;
  begin
    v_cursor_to_at:=(p_cursor_to->>'last_modified')::timestamptz;
  exception when others then
    return jsonb_build_object('error','ADLS cursor timestamp is invalid');
  end;
  if v_cursor_to_at is distinct from v_max_at
     or (p_cursor_to->>'path') is distinct from v_max_path then
    return jsonb_build_object('error','ADLS cursor must equal the newest object in the immutable manifest');
  end if;
  select last_cursor into v_cursor_from from public.ingest_watermarks
  where connector_id=v_connector.id and entity_type=p_entity_type;
  if v_cursor_from is not null then
    begin
      v_cursor_from_at:=(v_cursor_from->>'last_modified')::timestamptz;
    exception when others then
      return jsonb_build_object('error','stored ADLS cursor timestamp is invalid');
    end;
    if v_cursor_to_at<v_cursor_from_at
       or (v_cursor_to_at=v_cursor_from_at
           and convert_to(p_cursor_to->>'path','UTF8')<=
             convert_to(coalesce(v_cursor_from->>'path',''),'UTF8')) then
      return jsonb_build_object('error','ADLS object window does not advance the clean watermark');
    end if;
  end if;

  perform set_config('app.data_lake_transport','granted',true);
  insert into public.connector_runs(
    organization_id,connector_id,entity_type,run_type,status,started_at,
    triggered_by,transport_manifest,transport_cursor_from,transport_cursor_to,
    source_object_count,source_bytes
  ) values(
    p_organization_id,v_connector.id,p_entity_type,'sync','running',now(),
    p_triggered_by,p_manifest,v_cursor_from,p_cursor_to,
    jsonb_array_length(p_manifest),p_source_bytes
  ) returning id into v_run;
  return jsonb_build_object('ok',true,'run_id',v_run,'cursor_from',v_cursor_from,
    'cursor_to',p_cursor_to,'object_count',jsonb_array_length(p_manifest));
end
$$;

revoke all on function public.begin_data_lake_read_run(
  uuid,uuid,text,text,jsonb,jsonb,bigint
) from public,anon,authenticated;
grant execute on function public.begin_data_lake_read_run(
  uuid,uuid,text,text,jsonb,jsonb,bigint
) to service_role;

-- Canonical promotion remains tenant-authenticated, but ADLS runs may enter it
-- only through this wrapper. The local proof lets the run trigger distinguish
-- this reviewed path from the generic import RPC, which otherwise lets any
-- tenant member mutate ADLS run counters before the service-only finish gate.
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
begin
  if v_org is null or not public.recovery_role_allowed(
    array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']
  ) then
    return jsonb_build_object('error','data-lake ingestion authority denied');
  end if;
  if not exists(
    select 1 from public.connector_runs r
    join public.connectors c on c.id=r.connector_id and c.organization_id=r.organization_id
    where r.id=p_run_id and r.organization_id=v_org and r.status='running'
      and c.connector_type='recovery_activation' and c.system_kind='data_lake'
      and c.register_ref='C2.14' and c.enabled and c.direction='read_only'
      and not c.write_enabled
  ) then
    return jsonb_build_object('error','running governed ADLS run not found');
  end if;
  perform set_config('app.data_lake_ingest','granted',true);
  return public.ingest_recovery_activation_batch(p_run_id,p_rows);
end
$$;

revoke all on function public.ingest_data_lake_read_batch(uuid,jsonb)
from public,anon;
grant execute on function public.ingest_data_lake_read_batch(uuid,jsonb)
to authenticated;

create or replace function public.enforce_data_lake_run_attestation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if exists(
    select 1 from public.connectors c where c.id=new.connector_id
      and c.system_kind='data_lake' and c.register_ref='C2.14'
  ) then
    if tg_op='INSERT' and coalesce(current_setting('app.data_lake_transport',true),'')<>'granted' then
      raise exception 'governed ADLS runs require service-attested transport evidence';
    end if;
    if tg_op='UPDATE'
       and coalesce(current_setting('app.data_lake_ingest',true),'')<>'granted'
       and coalesce(current_setting('app.data_lake_finish',true),'')<>'granted' then
      raise exception 'governed ADLS runs require the attested ingest or service-only clean-finish contract';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_data_lake_run_attestation on public.connector_runs;
create trigger trg_data_lake_run_attestation
before insert or update on public.connector_runs
for each row execute function public.enforce_data_lake_run_attestation();

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
begin
  if p_status not in ('success','partial','failed') then
    return jsonb_build_object('error','data-lake run status must be success, partial or failed');
  end if;
  select r.* into v_run from public.connector_runs r
  join public.connectors c on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id and r.status='running'
    and c.connector_type='recovery_activation' and c.system_kind='data_lake'
    and c.register_ref='C2.14';
  if not found then return jsonb_build_object('error','running governed ADLS run not found'); end if;
  v_clean:=p_status='success' and v_run.records_rejected=0
    and v_run.transport_cursor_to is not null and v_run.transport_manifest is not null;

  perform set_config('app.data_lake_finish','granted',true);
  update public.connector_runs set status=p_status,finished_at=now(),
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
      last_cursor=excluded.last_cursor,last_run_id=excluded.last_run_id,updated_at=now()
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
  return jsonb_build_object('ok',true,'run_id',p_run_id,'status',p_status,
    'cursor_advanced',v_advanced,'records_rejected',v_run.records_rejected);
end
$$;

revoke all on function public.finish_data_lake_read_run(
  uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.finish_data_lake_read_run(
  uuid,uuid,text,text
) to service_role;

notify pgrst, 'reload schema';

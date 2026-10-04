-- C2.19 — governed Bently Nevada System 1 condition-data read adapter.
--
-- A customer-operated gateway reads the System 1 OPC UA export and exposes a
-- narrow HTTPS contract. One connector binds exact OPC UA node IDs and units
-- to existing same-tenant canonical sensors. The adapter extends the ONE
-- connectors/runs/staging/watermark path and calls record_condition_reading;
-- it creates no telemetry store, sensor identity or plant-control surface.

create or replace function public.is_valid_system1_node_bindings(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path=public
as $$
declare
  v_item jsonb;
  v_node text;
  v_sensor text;
  v_nodes text[]:='{}';
  v_sensors text[]:='{}';
begin
  if coalesce(jsonb_typeof(p_value),'')<>'array'
     or jsonb_array_length(p_value) not between 1 and 200 then return false; end if;
  for v_item in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_item)<>'object'
       or exists(select 1 from jsonb_object_keys(v_item) k
         where k not in ('nodeId','sensorId','unit')) then return false; end if;
    v_node:=btrim(coalesce(v_item->>'nodeId',''));
    v_sensor:=lower(btrim(coalesce(v_item->>'sensorId','')));
    if length(v_node) not between 1 and 512
       or v_node ~ '[[:cntrl:]]'
       or v_sensor !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or length(btrim(coalesce(v_item->>'unit',''))) not between 1 and 40
       or btrim(v_item->>'unit') ~ '[[:cntrl:]]'
       or v_node=any(v_nodes) or v_sensor=any(v_sensors) then return false; end if;
    v_nodes:=v_nodes||v_node;
    v_sensors:=v_sensors||v_sensor;
  end loop;
  return true;
end
$$;

revoke all on function public.is_valid_system1_node_bindings(jsonb)
  from public,anon,authenticated;

alter table public.connectors
  add column if not exists condition_node_bindings jsonb,
  add column if not exists condition_max_rows int,
  add column if not exists condition_page_size int;

alter table public.connectors
  drop constraint if exists connectors_system1_read_profile_check;
alter table public.connectors add constraint connectors_system1_read_profile_check check (
  connector_type is distinct from 'condition_monitoring_read'
  or (
    system_kind='condition_monitoring'
    and connector_profile='bently_system1_opcua_gateway'
    and public.is_valid_system1_node_bindings(condition_node_bindings)
    and condition_max_rows between 1 and 5000
    and condition_page_size between 1 and least(condition_max_rows,1000)
    and pagination_mode='cursor'
    and pagination_max_pages between 1 and 100
    and direction='read_only'
    and not write_enabled
  )
);

comment on column public.connectors.condition_node_bindings is
  'Human-approved Bently System 1 OPC UA node ID to existing canonical sensor UUID and exact engineering-unit bindings.';
comment on column public.connectors.condition_max_rows is
  'Maximum complete System 1 response admitted by one user-triggered read; never an unattended polling setting.';

create or replace function public.configure_bently_system1_source(
  p_key text,
  p_name text,
  p_endpoint text,
  p_credential_binding_ref text,
  p_node_bindings jsonb,
  p_max_rows int,
  p_page_size int,
  p_max_pages int,
  p_expected_interval_minutes int,
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
  v_endpoint text:=nullif(btrim(coalesce(p_endpoint,'')),'');
  v_ref text:=nullif(btrim(coalesce(p_credential_binding_ref,'')),'');
  v_item jsonb;
  v_sensor public.sensors%rowtype;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then
    return jsonb_build_object('error','a named human administrator must configure or enable a System 1 source');
  end if;
  if v_org is null or coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error','configuring a System 1 source requires an administrator');
  end if;
  if coalesce(length(btrim(p_key)),0)<3 or coalesce(length(btrim(p_name)),0)<3 then
    return jsonb_build_object('error','connector key and name are required');
  end if;
  if coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','record a substantive gateway, node, sensor and unit approval basis');
  end if;
  if not public.is_valid_system1_node_bindings(p_node_bindings) then
    return jsonb_build_object('error','provide 1 to 200 unique System 1 node and canonical sensor bindings with exact units');
  end if;
  for v_item in select value from jsonb_array_elements(p_node_bindings) loop
    select * into v_sensor from public.sensors
    where id=(v_item->>'sensorId')::uuid and organization_id=v_org;
    if not found then
      return jsonb_build_object('error',format('canonical sensor %s is outside the active tenant or does not exist',v_item->>'sensorId'));
    end if;
    if v_sensor.registry_status<>'active' then
      return jsonb_build_object('error',format('canonical sensor %s is not active',v_item->>'sensorId'));
    end if;
    if btrim(coalesce(v_sensor.unit,''))<>btrim(v_item->>'unit') then
      return jsonb_build_object('error',format('System 1 node %s unit %s does not match canonical sensor unit %s',
        btrim(v_item->>'nodeId'),btrim(v_item->>'unit'),coalesce(v_sensor.unit,'(unknown)')));
    end if;
  end loop;
  if coalesce(p_max_rows,0) not between 1 and 5000 then
    return jsonb_build_object('error','maximum System 1 rows must be between 1 and 5000');
  end if;
  if coalesce(p_page_size,0) not between 1 and least(coalesce(p_max_rows,0),1000) then
    return jsonb_build_object('error','System 1 page size must be between 1 and the approved row maximum, capped at 1000');
  end if;
  if coalesce(p_max_pages,0) not between 1 and 100 then
    return jsonb_build_object('error','maximum System 1 pages must be between 1 and 100');
  end if;
  if coalesce(p_expected_interval_minutes,0)<1 then
    return jsonb_build_object('error','expected interval must be at least one minute');
  end if;
  if v_endpoint is null
     or v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]?#]*)*/syncai/v1/system1/readings$'
     or v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)' then
    return jsonb_build_object('error','System 1 gateway must be a credential-free public HTTPS URL ending in /syncai/v1/system1/readings; private/local targets are blocked');
  end if;
  if v_ref is null or v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$' or v_ref ~ '[@?=#]' then
    return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value, query or fragment');
  end if;
  if exists(select 1 from public.connectors where organization_id=v_org
    and connector_key=btrim(p_key) and connector_type is distinct from 'condition_monitoring_read') then
    return jsonb_build_object('error','connector key already belongs to another governed integration contract');
  end if;
  if exists(select 1 from public.connectors c join public.connector_runs r
    on r.connector_id=c.id and r.organization_id=c.organization_id
    where c.organization_id=v_org and c.connector_key=btrim(p_key) and r.status='running') then
    return jsonb_build_object('error','wait for the active connector run before changing its governed System 1 scope');
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,
    connector_profile,endpoint_hint,expected_interval_minutes,
    credential_binding_ref,contract_note,register_ref,status,enabled,
    direction,write_enabled,pagination_mode,pagination_next_path,
    pagination_max_pages,condition_node_bindings,condition_max_rows,
    condition_page_size
  ) values(
    v_org,btrim(p_key),btrim(p_name),'condition_monitoring_read',
    'condition_monitoring','bently_system1_opcua_gateway',v_endpoint,
    p_expected_interval_minutes,v_ref,
    'Bounded Bently Nevada System 1 OPC UA gateway GET. Exact approved node/sensor/unit bindings promote through canonical condition readings; no OPC write, alarm acknowledgement, limit change or control authority.',
    'C2.19',case when p_enabled then 'active' else 'configured' end,p_enabled,
    'read_only',false,'cursor','nextCursor',p_max_pages,p_node_bindings,
    p_max_rows,p_page_size
  ) on conflict(organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,connector_type='condition_monitoring_read',
    system_kind='condition_monitoring',
    connector_profile='bently_system1_opcua_gateway',
    endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,register_ref='C2.19',
    status=excluded.status,enabled=excluded.enabled,direction='read_only',
    write_enabled=false,pagination_mode='cursor',
    pagination_next_path='nextCursor',
    pagination_max_pages=excluded.pagination_max_pages,
    condition_node_bindings=excluded.condition_node_bindings,
    condition_max_rows=excluded.condition_max_rows,
    condition_page_size=excluded.condition_page_size
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'bently_system1_condition_read_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      ||' read-only System 1 gateway with '
      ||jsonb_array_length(p_node_bindings)||' exact node bindings',
    'approved','manual',100,auth.uid()::text,btrim(p_basis),'executed'
  );
  return jsonb_build_object('ok',true,'connector_id',v_id,'enabled',p_enabled,
    'direction','read_only','write_enabled',false,
    'source_profile','bently_system1_opcua_gateway',
    'binding_count',jsonb_array_length(p_node_bindings),
    'note',case when p_enabled
      then 'Enabled bounded user-triggered System 1 reads. Source alarms, limits and control remain unchanged.'
      else 'Saved disabled. Deploy the approved gateway host and tenant-bound credential before enabling.' end);
end
$$;

revoke all on function public.configure_bently_system1_source(
  text,text,text,text,jsonb,int,int,int,int,boolean,text
) from public,anon;
grant execute on function public.configure_bently_system1_source(
  text,text,text,text,jsonb,int,int,int,int,boolean,text
) to authenticated;

create or replace function public.bently_system1_contract_hash(p_connector_id uuid)
returns text language sql stable security definer set search_path=public
as $$
  select encode(extensions.digest(jsonb_build_object(
    'organizationId',c.organization_id,
    'connectorId',c.id,
    'connectorKey',c.connector_key,
    'endpoint',c.endpoint_hint,
    'credentialBindingRef',c.credential_binding_ref,
    'enabled',c.enabled,
    'direction',c.direction,
    'writeEnabled',c.write_enabled,
    'nodeBindings',c.condition_node_bindings,
    'maxRows',c.condition_max_rows,
    'pageSize',c.condition_page_size,
    'maxPages',c.pagination_max_pages
  )::text,'sha256'),'hex')
  from public.connectors c where c.id=p_connector_id
$$;

revoke all on function public.bently_system1_contract_hash(uuid)
  from public,anon,authenticated;

create or replace function public.get_bently_system1_source(p_connector_key text)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_item jsonb;
  v_from timestamptz;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error','System 1 source access denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id=v_org and connector_key=btrim(p_connector_key)
    and connector_type='condition_monitoring_read'
    and system_kind='condition_monitoring'
    and connector_profile='bently_system1_opcua_gateway'
    and register_ref='C2.19';
  if not found then return jsonb_build_object('error','governed System 1 source not found'); end if;
  for v_item in select value from jsonb_array_elements(v_connector.condition_node_bindings) loop
    if not exists(select 1 from public.sensors s
      where s.id=(v_item->>'sensorId')::uuid and s.organization_id=v_org
        and s.registry_status='active'
        and btrim(coalesce(s.unit,''))=btrim(v_item->>'unit')) then
      return jsonb_build_object('error','a mapped canonical sensor is missing, inactive or no longer uses the approved unit; a human administrator must revise the source');
    end if;
  end loop;
  select last_position into v_from from public.ingest_watermarks
  where connector_id=v_connector.id and entity_type='condition_reading';
  return jsonb_build_object(
    'organization_id',v_org,'connector_key',v_connector.connector_key,
    'enabled',v_connector.enabled,'direction',v_connector.direction,
    'write_enabled',v_connector.write_enabled,
    'source_profile',v_connector.connector_profile,
    'endpoint',v_connector.endpoint_hint,
    'credential_binding_ref',v_connector.credential_binding_ref,
    'node_bindings',v_connector.condition_node_bindings,
    'max_rows',v_connector.condition_max_rows,
    'page_size',v_connector.condition_page_size,
    'max_pages',v_connector.pagination_max_pages,
    'watermark_from',v_from,
    'contract_hash',public.bently_system1_contract_hash(v_connector.id),
    'can_commit',v_role in ('reliability_engineer','maintenance_manager','admin'));
end
$$;

revoke all on function public.get_bently_system1_source(text) from public,anon;
grant execute on function public.get_bently_system1_source(text) to authenticated;

create or replace function public.begin_bently_system1_read_run(
  p_organization_id uuid,
  p_triggered_by uuid,
  p_connector_key text,
  p_contract_hash text,
  p_manifest jsonb,
  p_cursor_to jsonb,
  p_source_bytes bigint
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_connector public.connectors%rowtype;
  v_role text;
  v_item jsonb;
  v_page int:=0;
  v_rows int:=0;
  v_bytes bigint:=0;
  v_run uuid;
  v_from timestamptz;
  v_fetched timestamptz;
  v_max_taken timestamptz;
  v_hashes text[]:='{}';
  v_digest text;
  v_expected_cursor text:=null;
  v_complete boolean;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','System 1 transport attestation is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','System 1 run actor is not authorized for this tenant');
  end if;
  select * into v_connector from public.connectors
  where organization_id=p_organization_id and connector_key=btrim(p_connector_key)
    and connector_type='condition_monitoring_read'
    and system_kind='condition_monitoring'
    and connector_profile='bently_system1_opcua_gateway'
    and register_ref='C2.19' and enabled and direction='read_only'
    and not write_enabled for update;
  if not found then return jsonb_build_object('error','active governed System 1 source not found'); end if;
  if coalesce(p_contract_hash,'') !~ '^[0-9a-f]{64}$'
     or p_contract_hash<>public.bently_system1_contract_hash(v_connector.id)
     or coalesce(p_cursor_to->>'contract_hash','')<>p_contract_hash then
    return jsonb_build_object('error','System 1 connector contract changed after source discovery; fetch and validate the approved scope again');
  end if;
  if exists(select 1 from public.connector_runs r
    where r.connector_id=v_connector.id and r.organization_id=p_organization_id
      and r.entity_type='condition_reading' and r.status='running') then
    return jsonb_build_object('error','a System 1 pull is already running for this connector');
  end if;
  if coalesce(jsonb_typeof(p_manifest),'')<>'array'
     or jsonb_array_length(p_manifest) not between 1 and v_connector.pagination_max_pages
     or coalesce(jsonb_typeof(p_cursor_to),'')<>'object'
     or coalesce(p_source_bytes,0)<=0 or p_source_bytes>26214400
     or coalesce(p_cursor_to->>'source_digest','') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error','bounded System 1 transport evidence is invalid');
  end if;
  begin
    v_fetched:=(p_cursor_to->>'fetched_at')::timestamptz;
    v_max_taken:=(p_cursor_to->>'max_taken_at')::timestamptz;
  exception when others then
    return jsonb_build_object('error','System 1 transport timestamps are invalid');
  end;
  if not isfinite(v_fetched) or not isfinite(v_max_taken)
     or v_fetched>now()+interval '5 minutes'
     or v_fetched<now()-interval '10 minutes'
     or v_max_taken>v_fetched+interval '5 minutes' then
    return jsonb_build_object('error','System 1 transport timestamps are not finite current observations');
  end if;

  for v_item in select value from jsonb_array_elements(p_manifest) loop
    v_page:=v_page+1;
    if jsonb_typeof(v_item)<>'object'
       or coalesce(v_item->>'transport','')<>'system1_gateway_v1'
       or coalesce(v_item->>'resource','')<>'readings'
       or coalesce(v_item->>'page','')<>v_page::text
       or coalesce(v_item->>'cursor_in','')<>coalesce(v_expected_cursor,'')
       or coalesce(v_item->>'complete','') not in ('true','false')
       or coalesce(v_item->>'sha256','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_item->>'bytes','') !~ '^[0-9]+$'
       or coalesce(v_item->>'row_count','') !~ '^[0-9]+$' then
      return jsonb_build_object('error','System 1 manifest is missing bounded page or cursor provenance');
    end if;
    v_complete:=(v_item->>'complete')::boolean;
    v_expected_cursor:=nullif(v_item->>'cursor_out','');
    if (v_complete and v_expected_cursor is not null)
       or (not v_complete and v_expected_cursor is null) then
      return jsonb_build_object('error','System 1 manifest cursor and completion state are inconsistent');
    end if;
    if v_complete and v_page<>jsonb_array_length(p_manifest) then
      return jsonb_build_object('error','System 1 manifest contains pages after the complete page');
    end if;
    if (v_item->>'bytes')::bigint<=0 or (v_item->>'bytes')::bigint>10485760 then
      return jsonb_build_object('error','System 1 source pages must contain no more than 10 MB');
    end if;
    if (v_item->>'row_count')::int<0
       or (v_item->>'row_count')::int>v_connector.condition_page_size then
      return jsonb_build_object('error','System 1 source page row count exceeds the approved page size');
    end if;
    v_hashes:=v_hashes||(v_item->>'sha256');
    v_bytes:=v_bytes+(v_item->>'bytes')::bigint;
    v_rows:=v_rows+(v_item->>'row_count')::int;
  end loop;
  if not v_complete then
    return jsonb_build_object('error','System 1 manifest does not contain a complete final page');
  end if;
  v_digest:=encode(extensions.digest(array_to_string(v_hashes,':'),'sha256'),'hex');
  if v_bytes<>p_source_bytes or v_rows<1 or v_rows>v_connector.condition_max_rows
     or coalesce(p_cursor_to->>'raw_rows','')<>v_rows::text
     or coalesce(p_cursor_to->>'mapped_rows','')<>v_rows::text
     or coalesce(p_cursor_to->>'pages','')<>v_page::text
     or coalesce(p_cursor_to->>'source_digest','')<>v_digest then
    return jsonb_build_object('error','System 1 manifest does not reconcile to the complete mapped response');
  end if;
  select last_position into v_from from public.ingest_watermarks
  where connector_id=v_connector.id and entity_type='condition_reading';
  if v_from is not null and v_max_taken<=v_from then
    return jsonb_build_object('error','System 1 response does not advance the clean connector watermark');
  end if;
  perform set_config('app.system1_transport','granted',true);
  insert into public.connector_runs(
    organization_id,connector_id,entity_type,run_type,status,started_at,
    watermark_from,watermark_to,triggered_by,source_contract_hash,
    transport_manifest,transport_cursor_to,source_object_count,source_bytes
  ) values(
    p_organization_id,v_connector.id,'condition_reading','sync','running',now(),
    v_from,v_max_taken,p_triggered_by,p_contract_hash,p_manifest,p_cursor_to,
    v_page,p_source_bytes
  ) returning id into v_run;
  return jsonb_build_object('ok',true,'run_id',v_run,
    'watermark_from',v_from,'watermark_to',v_max_taken);
end
$$;

revoke all on function public.begin_bently_system1_read_run(
  uuid,uuid,text,text,jsonb,jsonb,bigint
) from public,anon,authenticated;
grant execute on function public.begin_bently_system1_read_run(
  uuid,uuid,text,text,jsonb,jsonb,bigint
) to service_role;

create or replace function public.ingest_bently_system1_read_batch(
  p_organization_id uuid,
  p_triggered_by uuid,
  p_run_id uuid,
  p_actor_aal text,
  p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_connector public.connectors%rowtype;
  v_run public.connector_runs%rowtype;
  v_role text;
  v_row jsonb;
  v_mapping jsonb;
  v_record jsonb;
  v_ext text;
  v_reason text;
  v_value numeric;
  v_taken timestamptz;
  v_sensor uuid;
  v_quality text;
  v_read int:=0;
  v_ok int:=0;
  v_duplicate int:=0;
  v_rejected int:=0;
  v_expected int;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','System 1 ingestion is service-only');
  end if;
  if coalesce(p_actor_aal,'') not in ('aal1','aal2') then
    return jsonb_build_object('error','System 1 ingestion requires verified human session assurance');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','System 1 ingest actor is not authorized for this tenant');
  end if;
  select r.* into v_run from public.connector_runs r join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id
    and r.triggered_by=p_triggered_by and r.status='running'
    and r.entity_type='condition_reading'
    and c.connector_type='condition_monitoring_read'
    and c.system_kind='condition_monitoring'
    and c.connector_profile='bently_system1_opcua_gateway'
    and c.register_ref='C2.19' and c.enabled
    and c.direction='read_only' and not c.write_enabled for update of r;
  if not found then return jsonb_build_object('error','running attested System 1 run not found'); end if;
  select * into v_connector from public.connectors
  where id=v_run.connector_id and organization_id=p_organization_id;
  if v_run.source_contract_hash<>public.bently_system1_contract_hash(v_connector.id)
     or coalesce(v_run.transport_cursor_to->>'contract_hash','')<>v_run.source_contract_hash then
    return jsonb_build_object('error','System 1 connector contract no longer matches the attested run');
  end if;
  v_expected:=(v_run.transport_cursor_to->>'mapped_rows')::int;
  if coalesce(jsonb_typeof(p_rows),'')<>'array'
     or jsonb_array_length(p_rows) not between 1 and 500
     or v_run.records_read+jsonb_array_length(p_rows)>v_expected then
    return jsonb_build_object('error','System 1 batch must contain 1 to 500 rows within the attested response count');
  end if;
  if (select count(*) from jsonb_array_elements(p_rows))<>
     (select count(distinct value->>'external_id') from jsonb_array_elements(p_rows)) then
    return jsonb_build_object('error','System 1 batch repeats a source sample identity');
  end if;

  perform set_config('request.jwt.claim.sub',p_triggered_by::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.aal',p_actor_aal,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_triggered_by,'role','authenticated','aal',p_actor_aal)::text,true);
  perform set_config('app.system1_ingest','granted',true);

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_read:=v_read+1;
    v_reason:=null;
    v_sensor:=null;
    v_value:=null;
    v_taken:=null;
    v_mapping:=null;
    v_record:=null;
    v_ext:=btrim(coalesce(v_row->>'external_id',''));
    v_quality:=lower(btrim(coalesce(v_row->>'quality','')));
    begin
      v_sensor:=(v_row->>'sensor_id')::uuid;
      v_value:=(v_row->>'value')::numeric;
      v_taken:=(v_row->>'taken_at')::timestamptz;
    exception when others then
      v_reason:='System 1 mapped value, sensor or timestamp is invalid';
    end;
    select value into v_mapping from jsonb_array_elements(v_connector.condition_node_bindings)
    where value->>'sensorId'=coalesce(v_row->>'sensor_id','') limit 1;
    if jsonb_typeof(v_row)<>'object'
       or exists(select 1 from jsonb_object_keys(v_row) k where k not in
         ('external_id','sensor_id','value','taken_at','quality')) then
      v_reason:='System 1 mapped row escaped the approved canonical field contract';
    elsif v_ext !~ '^system1:.{1,180}$'
       or v_ext ~ '[[:cntrl:]]'
       or length(v_ext)>188 then
      v_reason:='System 1 sample identity is invalid';
    elsif exists(select 1 from public.ingest_staging s
      where s.run_id=p_run_id and s.external_id=v_ext) then
      return jsonb_build_object('error','System 1 response repeats a source sample identity across batches');
    elsif v_reason is not null then
      null;
    elsif v_mapping is null
       or not exists(select 1 from public.sensors s
         where s.id=v_sensor and s.organization_id=p_organization_id
           and s.registry_status='active'
           and btrim(coalesce(s.unit,''))=btrim(v_mapping->>'unit')) then
      v_reason:='System 1 sample is not bound to an active same-tenant sensor with the approved unit';
    elsif not public.sync_is_finite_numeric(v_value) then
      v_reason:='System 1 sample value must be finite';
    elsif v_quality not in ('good','suspect','bad') then
      v_reason:='System 1 sample quality is outside the approved vocabulary';
    elsif v_taken>v_run.watermark_to
       or (v_run.watermark_from is not null and v_taken<=v_run.watermark_from) then
      v_reason:='System 1 sample timestamp escaped the attested watermark window';
    end if;

    if v_reason is not null then
      v_rejected:=v_rejected+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,
        payload,status,reject_reason
      ) values(
        p_organization_id,v_connector.id,p_run_id,'condition_reading',
        nullif(v_ext,''),v_row,'rejected',v_reason
      );
      continue;
    end if;
    if exists(select 1 from public.condition_readings
      where organization_id=p_organization_id
        and source_system=v_connector.connector_key and external_id=v_ext) then
      v_duplicate:=v_duplicate+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(
        p_organization_id,v_connector.id,p_run_id,'condition_reading',v_ext,
        v_row,'duplicate'
      );
      continue;
    end if;
    begin
      v_record:=public.record_condition_reading(
        v_sensor,v_value,v_taken,v_quality,v_connector.connector_key,v_ext);
      if v_record ? 'error' then v_reason:=v_record->>'error'; end if;
    exception
      when unique_violation then
        v_duplicate:=v_duplicate+1;
        insert into public.ingest_staging(
          organization_id,connector_id,run_id,entity_type,external_id,payload,status
        ) values(
          p_organization_id,v_connector.id,p_run_id,'condition_reading',v_ext,
          v_row,'duplicate'
        );
        continue;
      when others then
        v_reason:=format('the canonical condition writer refused this row: %s',sqlerrm);
    end;
    if v_reason is not null then
      v_rejected:=v_rejected+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,
        payload,status,reject_reason
      ) values(
        p_organization_id,v_connector.id,p_run_id,'condition_reading',v_ext,
        v_row,'rejected',v_reason
      );
    else
      v_ok:=v_ok+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(
        p_organization_id,v_connector.id,p_run_id,'condition_reading',v_ext,
        v_row,'accepted'
      );
    end if;
  end loop;
  update public.connector_runs set
    records_read=records_read+v_read,
    records_accepted=records_accepted+v_ok,
    records_duplicate=records_duplicate+v_duplicate,
    records_rejected=records_rejected+v_rejected
  where id=p_run_id and organization_id=p_organization_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(p_organization_id,'bently_system1_condition_read',v_role,
    jsonb_build_object('action','ingest_condition_samples','runId',p_run_id,
      'connectorKey',v_connector.connector_key,'actorId',p_triggered_by,
      'sourceWriteBack',false,'alarmAcknowledgement',false,
      'limitChangeAuthority',false,'controlAuthority',false),
    jsonb_build_object('read',v_read,'accepted',v_ok,
      'duplicate',v_duplicate,'rejected',v_rejected));
  return jsonb_build_object('read',v_read,'accepted',v_ok,
    'duplicate',v_duplicate,'rejected',v_rejected);
end
$$;

revoke all on function public.ingest_bently_system1_read_batch(
  uuid,uuid,uuid,text,jsonb
) from public,anon,authenticated;
grant execute on function public.ingest_bently_system1_read_batch(
  uuid,uuid,uuid,text,jsonb
) to service_role;

create or replace function public.enforce_bently_system1_run_attestation()
returns trigger language plpgsql set search_path=public
as $$
begin
  if exists(select 1 from public.connectors c where c.id=new.connector_id
    and c.connector_type='condition_monitoring_read'
    and c.system_kind='condition_monitoring'
    and c.connector_profile='bently_system1_opcua_gateway'
    and c.register_ref='C2.19') then
    if tg_op='INSERT'
       and coalesce(current_setting('app.system1_transport',true),'')<>'granted' then
      raise exception 'governed System 1 runs require service-attested complete transport evidence';
    end if;
    if tg_op='UPDATE'
       and coalesce(current_setting('app.system1_ingest',true),'')<>'granted'
       and coalesce(current_setting('app.system1_finish',true),'')<>'granted' then
      raise exception 'governed System 1 runs require service-only ingest or finish';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_bently_system1_run_attestation
  on public.connector_runs;
create trigger trg_bently_system1_run_attestation
before insert or update on public.connector_runs
for each row execute function public.enforce_bently_system1_run_attestation();

create or replace function public.finish_bently_system1_read_run(
  p_organization_id uuid,
  p_run_id uuid,
  p_status text,
  p_error text default null
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_run public.connector_runs%rowtype;
  v_connector public.connectors%rowtype;
  v_clean boolean;
  v_advanced boolean:=false;
  v_expected int;
  v_rows int:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','System 1 finish is service-only');
  end if;
  if p_status not in ('success','partial','failed') then
    return jsonb_build_object('error','System 1 status must be success, partial or failed');
  end if;
  select r.* into v_run from public.connector_runs r
  join public.connectors c on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id
    and r.status='running' and c.connector_type='condition_monitoring_read'
    and c.system_kind='condition_monitoring'
    and c.connector_profile='bently_system1_opcua_gateway'
    and c.register_ref='C2.19' for update of r;
  if not found then return jsonb_build_object('error','running governed System 1 run not found'); end if;
  select c.* into v_connector from public.connectors c
  where c.id=v_run.connector_id and c.organization_id=p_organization_id
    and c.connector_type='condition_monitoring_read'
    and c.system_kind='condition_monitoring'
    and c.connector_profile='bently_system1_opcua_gateway'
    and c.register_ref='C2.19';
  if not found then return jsonb_build_object('error','governed System 1 connector not found'); end if;
  if v_run.source_contract_hash<>public.bently_system1_contract_hash(v_connector.id) then
    return jsonb_build_object('error','System 1 connector contract changed before run completion');
  end if;
  v_expected:=(v_run.transport_cursor_to->>'mapped_rows')::int;
  if p_status in ('success','partial') and v_run.records_read<>v_expected then
    return jsonb_build_object('error','System 1 run rows do not reconcile to the attested mapped response');
  end if;
  if p_status='success' and v_run.records_rejected>0 then
    return jsonb_build_object('error','a System 1 run with refused rows cannot finish as success');
  end if;
  v_clean:=p_status='success' and v_run.records_rejected=0
    and v_run.records_read=v_expected
    and v_run.records_accepted+v_run.records_duplicate=v_expected
    and v_run.transport_manifest is not null
    and v_run.transport_cursor_to is not null;
  perform set_config('app.system1_finish','granted',true);
  update public.connector_runs set status=p_status,finished_at=now(),
    records_processed=records_accepted,
    error_message=case when p_error is null then null else left(p_error,500) end
  where id=p_run_id and organization_id=p_organization_id;
  if v_clean then
    insert into public.ingest_watermarks(
      organization_id,connector_id,entity_type,last_position,last_cursor,
      last_run_id,updated_at
    ) values(
      p_organization_id,v_run.connector_id,'condition_reading',
      v_run.watermark_to,v_run.transport_cursor_to,p_run_id,now()
    ) on conflict(connector_id,entity_type) do update set
      last_position=greatest(public.ingest_watermarks.last_position,excluded.last_position),
      last_cursor=excluded.last_cursor,last_run_id=excluded.last_run_id,
      updated_at=now();
    get diagnostics v_rows=row_count;
    v_advanced:=v_rows=1;
  end if;
  update public.connectors set
    last_success_at=case when v_clean then now() else last_success_at end,
    last_failure_at=case when not v_clean then now() else last_failure_at end
  where id=v_run.connector_id and organization_id=p_organization_id;
  return jsonb_build_object('ok',true,'run_id',p_run_id,'status',p_status,
    'watermark_advanced',v_advanced,'records_read',v_run.records_read,
    'records_accepted',v_run.records_accepted,
    'records_duplicate',v_run.records_duplicate,
    'records_rejected',v_run.records_rejected);
end
$$;

revoke all on function public.finish_bently_system1_read_run(
  uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.finish_bently_system1_read_run(
  uuid,uuid,text,text
) to service_role;

notify pgrst,'reload schema';

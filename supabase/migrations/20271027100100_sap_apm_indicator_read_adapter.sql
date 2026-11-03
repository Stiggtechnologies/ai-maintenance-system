-- C2.19 — governed SAP Asset Performance Management indicator read.
--
-- One connector reads IndicatorService/v1/Indicators for one technical object
-- and confirms administrator bindings to existing canonical sensors. The
-- verified GET returns indicator identity, not a measurement, so this adapter
-- does not write condition_readings, last_value, limits, or a health score.

create or replace function public.is_valid_sap_apm_indicator_bindings(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path=public
as $$
declare
  v_item jsonb;
  v_keys text[]:='{}';
  v_key text;
begin
  if coalesce(jsonb_typeof(p_value),'')<>'array'
     or jsonb_array_length(p_value) not between 1 and 40 then return false; end if;
  for v_item in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_item)<>'object'
       or exists(select 1 from jsonb_object_keys(v_item) k where k not in (
         'characteristicsInternalId','positionId','categoryName',
         'technicalObjectType','sensorId'))
       or btrim(coalesce(v_item->>'characteristicsInternalId','')) !~ '^[A-Za-z0-9._:-]{1,80}$'
       or btrim(coalesce(v_item->>'positionId','')) !~ '^[A-Za-z0-9._:-]{1,80}$'
       or btrim(coalesce(v_item->>'categoryName','')) !~ '^[A-Za-z0-9._:-]{1,80}$'
       or btrim(coalesce(v_item->>'technicalObjectType','')) !~ '^[A-Za-z0-9._:-]{1,80}$'
       or btrim(coalesce(v_item->>'sensorId','')) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return false;
    end if;
    v_key:=btrim(v_item->>'technicalObjectType')||chr(31)||btrim(v_item->>'characteristicsInternalId')
      ||chr(31)||btrim(v_item->>'positionId')||chr(31)||btrim(v_item->>'categoryName');
    if v_key=any(v_keys) then return false; end if;
    v_keys:=v_keys||v_key;
  end loop;
  return true;
end
$$;

revoke all on function public.is_valid_sap_apm_indicator_bindings(jsonb)
  from public,anon,authenticated;

alter table public.connectors
  add column if not exists apm_site_id uuid references public.sites(id) on delete set null,
  add column if not exists apm_technical_object_number text,
  add column if not exists apm_indicator_bindings jsonb,
  add column if not exists apm_max_rows int;

alter table public.connectors
  drop constraint if exists connectors_apm_indicator_read_profile_check;
alter table public.connectors
  add constraint connectors_apm_indicator_read_profile_check check (
    connector_type is distinct from 'apm_indicator_read'
    or (
      system_kind='condition_monitoring'
      and connector_profile='sap_apm_indicator'
      and apm_site_id is not null
      and apm_technical_object_number ~ '^[A-Za-z0-9._:-]{1,80}$'
      and public.is_valid_sap_apm_indicator_bindings(apm_indicator_bindings)
      and apm_max_rows between 1 and 5000
      and pagination_mode='next_url'
      and pagination_next_path='d.__next'
      and pagination_max_pages between 2 and 100
      and direction='read_only'
      and not write_enabled
    )
  );

comment on column public.connectors.apm_indicator_bindings is
  'Human-approved SAP APM indicator identity to an existing canonical sensor. This is not a measurement or a health score.';

create or replace function public.sap_apm_indicator_contract_hash(p_connector_id uuid)
returns text
language sql
stable
security definer
set search_path=public
as $$
  select encode(extensions.digest(jsonb_build_object(
    'organizationId',c.organization_id,
    'connectorId',c.id,
    'connectorKey',c.connector_key,
    'serviceRoot',c.endpoint_hint,
    'credentialBindingRef',c.credential_binding_ref,
    'enabled',c.enabled,
    'direction',c.direction,
    'writeEnabled',c.write_enabled,
    'siteId',c.apm_site_id,
    'technicalObjectNumber',c.apm_technical_object_number,
    'indicatorBindings',c.apm_indicator_bindings,
    'maxRows',c.apm_max_rows,
    'maxPages',c.pagination_max_pages
  )::text,'sha256'),'hex')
  from public.connectors c where c.id=p_connector_id
$$;

revoke all on function public.sap_apm_indicator_contract_hash(uuid)
  from public,anon,authenticated;

create or replace function public.configure_sap_apm_indicator_source(
  p_key text,
  p_name text,
  p_service_root text,
  p_technical_object_number text,
  p_site_id uuid,
  p_indicator_bindings jsonb,
  p_max_rows int,
  p_max_pages int,
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
  v_endpoint text:=nullif(btrim(coalesce(p_service_root,'')),'');
  v_ref text:=nullif(btrim(coalesce(p_credential_binding_ref,'')),'');
  v_object text:=btrim(coalesce(p_technical_object_number,''));
  v_item jsonb;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then
    return jsonb_build_object('error','a named human administrator must configure or enable an SAP APM indicator source');
  end if;
  if v_org is null or coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error','configuring an SAP APM indicator source requires an administrator');
  end if;
  if coalesce(length(btrim(p_key)),0) not between 3 and 160
     or coalesce(length(btrim(p_name)),0) not between 3 and 160 then
    return jsonb_build_object('error','connector key and name must be between 3 and 160 characters');
  end if;
  if coalesce(length(btrim(p_basis)),0) not between 20 and 2000 then
    return jsonb_build_object('error','record a substantive bounded SAP APM indicator activation and sensor-mapping basis');
  end if;
  if not exists(select 1 from public.sites s where s.id=p_site_id and s.organization_id=v_org) then
    return jsonb_build_object('error','the canonical indicator site is outside the active tenant or does not exist');
  end if;
  if v_object !~ '^[A-Za-z0-9._:-]{1,80}$' then
    return jsonb_build_object('error','SAP APM technical object number must be a short explicit identifier');
  end if;
  if not public.is_valid_sap_apm_indicator_bindings(p_indicator_bindings) then
    return jsonb_build_object('error','provide 1 to 40 unique SAP APM indicator to canonical sensor bindings');
  end if;
  for v_item in select value from jsonb_array_elements(p_indicator_bindings) loop
    if not exists(
      select 1 from public.sensors s
      join public.assets a on a.id=s.asset_id and a.organization_id=s.organization_id
      where s.id=(v_item->>'sensorId')::uuid
        and s.organization_id=v_org
        and s.registry_status='active'
        and a.site_id=p_site_id
        and a.external_id=v_object
    ) then
      return jsonb_build_object('error','each binding must name an active sensor on the one canonical asset whose external id is the SAP technical object');
    end if;
  end loop;
  if coalesce(p_max_rows,0) not between 1 and 5000 then
    return jsonb_build_object('error','maximum SAP APM indicator rows must be between 1 and 5000');
  end if;
  if coalesce(p_max_pages,0) not between 2 and 100 then
    return jsonb_build_object('error','maximum SAP APM pages must be between 2 and 100');
  end if;
  if coalesce(p_expected_interval_minutes,0) not between 1 and 525600 then
    return jsonb_build_object('error','expected interval must be between one minute and one year');
  end if;
  if v_endpoint is null or length(v_endpoint)>2048
     or v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]?#]*)?$'
     or v_endpoint !~ '/IndicatorService/v1/?$'
     or v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)' then
    return jsonb_build_object('error','SAP APM service root must be a credential-free public HTTPS URL ending in IndicatorService/v1 without query or fragment; private/local targets are blocked');
  end if;
  if v_ref is null or length(v_ref)>500
     or v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$'
     or v_ref ~ '[@?=#]' then
    return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value, query or fragment');
  end if;
  if exists(select 1 from public.connectors where organization_id=v_org
    and connector_key=btrim(p_key) and connector_type is distinct from 'apm_indicator_read') then
    return jsonb_build_object('error','connector key already belongs to another governed integration contract');
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,
    connector_profile,endpoint_hint,expected_interval_minutes,
    credential_binding_ref,contract_note,register_ref,status,enabled,
    direction,write_enabled,pagination_mode,pagination_next_path,
    pagination_max_pages,apm_site_id,apm_technical_object_number,
    apm_indicator_bindings,apm_max_rows
  ) values(
    v_org,btrim(p_key),btrim(p_name),'apm_indicator_read','condition_monitoring',
    'sap_apm_indicator',regexp_replace(v_endpoint,'/$',''),
    p_expected_interval_minutes,v_ref,
    'Bounded SAP APM IndicatorService GET. Confirms indicator identity on canonical sensors. No measurement, limit, health-score or source write.',
    'C2.19',case when p_enabled then 'active' else 'configured' end,p_enabled,
    'read_only',false,'next_url','d.__next',p_max_pages,p_site_id,v_object,
    p_indicator_bindings,p_max_rows
  )
  on conflict(organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,connector_type='apm_indicator_read',
    system_kind='condition_monitoring',connector_profile='sap_apm_indicator',
    endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,register_ref='C2.19',
    status=excluded.status,enabled=excluded.enabled,direction='read_only',
    write_enabled=false,pagination_mode='next_url',pagination_next_path='d.__next',
    pagination_max_pages=excluded.pagination_max_pages,
    apm_site_id=excluded.apm_site_id,
    apm_technical_object_number=excluded.apm_technical_object_number,
    apm_indicator_bindings=excluded.apm_indicator_bindings,
    apm_max_rows=excluded.apm_max_rows
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'sap_apm_indicator_read_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      ||' read-only SAP APM technical object '||v_object||' mapped to site '||p_site_id,
    'approved','manual',100,auth.uid()::text,btrim(p_basis),'executed'
  );
  return jsonb_build_object(
    'ok',true,'connector_id',v_id,'enabled',p_enabled,
    'direction','read_only','write_enabled',false,
    'source_profile','sap_apm_indicator','technical_object_number',v_object,
    'site_id',p_site_id,'mapping_count',jsonb_array_length(p_indicator_bindings),
    'note',case when p_enabled
      then 'Enabled bounded user-triggered SAP APM indicator identity reads. Measurements and health scores are not written.'
      else 'Saved disabled. Deploy the approved host, OAuth bearer and API key before enabling.' end
  );
end
$$;

revoke all on function public.configure_sap_apm_indicator_source(
  text,text,text,text,uuid,jsonb,int,int,int,text,boolean,text
) from public,anon;
grant execute on function public.configure_sap_apm_indicator_source(
  text,text,text,text,uuid,jsonb,int,int,int,text,boolean,text
) to authenticated;

create or replace function public.get_sap_apm_indicator_source(p_connector_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','SAP APM indicator source access denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id=v_org and connector_key=btrim(p_connector_key)
    and connector_type='apm_indicator_read' and system_kind='condition_monitoring'
    and connector_profile='sap_apm_indicator' and register_ref='C2.19';
  if not found then return jsonb_build_object('error','governed SAP APM indicator source not found'); end if;
  return jsonb_build_object(
    'organization_id',v_org,'connector_key',v_connector.connector_key,
    'enabled',v_connector.enabled,'direction',v_connector.direction,
    'write_enabled',v_connector.write_enabled,
    'source_profile',v_connector.connector_profile,
    'service_root',v_connector.endpoint_hint,
    'credential_binding_ref',v_connector.credential_binding_ref,
    'site_id',v_connector.apm_site_id,
    'technical_object_number',v_connector.apm_technical_object_number,
    'indicator_bindings',v_connector.apm_indicator_bindings,
    'max_rows',v_connector.apm_max_rows,
    'max_pages',v_connector.pagination_max_pages,
    'contract_hash',public.sap_apm_indicator_contract_hash(v_connector.id)
  );
end
$$;

revoke all on function public.get_sap_apm_indicator_source(text) from public,anon;
grant execute on function public.get_sap_apm_indicator_source(text) to authenticated;

create or replace function public.begin_sap_apm_indicator_read_run(
  p_organization_id uuid,
  p_triggered_by uuid,
  p_connector_key text,
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
  v_role text;
  v_item jsonb;
  v_page int:=0;
  v_rows int:=0;
  v_bytes bigint:=0;
  v_run uuid;
  v_from timestamptz;
  v_observed_at timestamptz;
  v_hash text;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','SAP APM indicator transport attestation is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','SAP APM indicator run actor is not authorized for this tenant');
  end if;
  select * into v_connector from public.connectors
  where organization_id=p_organization_id and connector_key=btrim(p_connector_key)
    and connector_type='apm_indicator_read' and system_kind='condition_monitoring'
    and connector_profile='sap_apm_indicator' and register_ref='C2.19'
    and enabled and direction='read_only' and not write_enabled
  for update;
  if not found then return jsonb_build_object('error','active governed SAP APM indicator source not found'); end if;
  v_hash:=public.sap_apm_indicator_contract_hash(v_connector.id);
  if exists(select 1 from public.connector_runs r where r.connector_id=v_connector.id
    and r.organization_id=p_organization_id and r.entity_type='sensor' and r.status='running') then
    return jsonb_build_object('error','an SAP APM indicator pull is already running for this connector');
  end if;
  if coalesce(jsonb_typeof(p_manifest),'')<>'array'
     or jsonb_array_length(p_manifest) not between 1 and v_connector.pagination_max_pages
     or coalesce(jsonb_typeof(p_cursor_to),'')<>'object'
     or coalesce(p_cursor_to->>'fetched_at','')=''
     or coalesce(p_cursor_to->>'contract_hash','')<>v_hash
     or coalesce(p_source_bytes,0)<=0 or p_source_bytes>26214400 then
    return jsonb_build_object('error','bounded SAP APM indicator transport evidence is invalid');
  end if;
  begin v_observed_at:=(p_cursor_to->>'fetched_at')::timestamptz;
  exception when others then
    return jsonb_build_object('error','SAP APM indicator transport timestamp is invalid');
  end;
  if not isfinite(v_observed_at) or v_observed_at>now()+interval '5 minutes' then
    return jsonb_build_object('error','SAP APM indicator timestamp is not a finite current observation');
  end if;
  for v_item in select value from jsonb_array_elements(p_manifest) loop
    v_page:=v_page+1;
    if jsonb_typeof(v_item)<>'object'
       or coalesce(v_item->>'transport','')<>'sap_apm_rest'
       or coalesce(v_item->>'resource','')<>'IndicatorService/v1/Indicators'
       or coalesce(v_item->>'page','')<>v_page::text
       or coalesce(v_item->>'technical_object_number','')<>v_connector.apm_technical_object_number
       or coalesce(v_item->>'sha256','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_item->>'bytes','') !~ '^[0-9]+$'
       or coalesce(v_item->>'row_count','') !~ '^[0-9]+$' then
      return jsonb_build_object('error','SAP APM indicator manifest is missing bounded page provenance');
    end if;
    if (v_item->>'bytes')::bigint<=0 or (v_item->>'bytes')::bigint>10485760
       or (v_item->>'row_count')::int<1
       or (v_item->>'row_count')::int>v_connector.apm_max_rows then
      return jsonb_build_object('error','SAP APM indicator source page exceeds its approved bounds');
    end if;
    v_bytes:=v_bytes+(v_item->>'bytes')::bigint;
    v_rows:=v_rows+(v_item->>'row_count')::int;
  end loop;
  if v_bytes<>p_source_bytes or v_rows<1 or v_rows>v_connector.apm_max_rows
     or coalesce(p_cursor_to->>'raw_rows','')<>v_rows::text
     or coalesce(p_cursor_to->>'pages','')<>v_page::text
     or coalesce(p_cursor_to->>'mapped_rows','') !~ '^[1-9][0-9]*$'
     or (p_cursor_to->>'mapped_rows')::int<>jsonb_array_length(v_connector.apm_indicator_bindings) then
    return jsonb_build_object('error','SAP APM indicator manifest does not reconcile to the approved bindings');
  end if;
  select last_position into v_from from public.ingest_watermarks
  where connector_id=v_connector.id and entity_type='sensor';
  if v_from is not null and v_observed_at<=v_from then
    return jsonb_build_object('error','SAP APM indicator observation does not advance the clean connector watermark');
  end if;
  perform set_config('app.sap_apm_indicator_transport','granted',true);
  insert into public.connector_runs(
    organization_id,connector_id,entity_type,run_type,status,started_at,
    watermark_from,watermark_to,triggered_by,source_contract_hash,
    transport_manifest,transport_cursor_to,source_object_count,source_bytes
  ) values(
    p_organization_id,v_connector.id,'sensor','sync','running',now(),
    v_from,v_observed_at,p_triggered_by,v_hash,p_manifest,p_cursor_to,v_page,p_source_bytes
  ) returning id into v_run;
  return jsonb_build_object('ok',true,'run_id',v_run,'watermark_from',v_from,'cursor_to',p_cursor_to);
end
$$;

revoke all on function public.begin_sap_apm_indicator_read_run(
  uuid,uuid,text,jsonb,jsonb,bigint
) from public,anon,authenticated;
grant execute on function public.begin_sap_apm_indicator_read_run(
  uuid,uuid,text,jsonb,jsonb,bigint
) to service_role;

create or replace function public.ingest_sap_apm_indicator_read_batch(
  p_organization_id uuid,
  p_triggered_by uuid,
  p_run_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_connector public.connectors%rowtype;
  v_run public.connector_runs%rowtype;
  v_role text;
  v_row jsonb;
  v_binding jsonb;
  v_sensor public.sensors%rowtype;
  v_ext text;
  v_observed timestamptz;
  v_read int:=0;
  v_ok int:=0;
  v_duplicate int:=0;
  v_rejected int:=0;
  v_reason text;
  v_expected int;
  v_seen text[]:='{}';
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','SAP APM indicator ingestion is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','SAP APM indicator ingest actor is not authorized for this tenant');
  end if;
  select r.* into v_run
  from public.connector_runs r join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id
    and r.triggered_by=p_triggered_by and r.status='running'
    and r.entity_type='sensor' and r.records_read=0
    and c.connector_type='apm_indicator_read'
    and c.system_kind='condition_monitoring'
    and c.connector_profile='sap_apm_indicator' and c.register_ref='C2.19'
    and c.enabled and c.direction='read_only' and not c.write_enabled;
  if not found then return jsonb_build_object('error','running attested SAP APM indicator run not found'); end if;
  select * into v_connector from public.connectors
  where id=v_run.connector_id and organization_id=p_organization_id;
  if v_run.source_contract_hash is distinct from public.sap_apm_indicator_contract_hash(v_connector.id)
     or coalesce(v_run.transport_cursor_to->>'contract_hash','')<>v_run.source_contract_hash then
    return jsonb_build_object('error','SAP APM indicator contract changed during this run');
  end if;
  v_expected:=(v_run.transport_cursor_to->>'mapped_rows')::int;
  if coalesce(jsonb_typeof(p_rows),'')<>'array'
     or jsonb_array_length(p_rows)<>v_expected
     or v_expected<>jsonb_array_length(v_connector.apm_indicator_bindings) then
    return jsonb_build_object('error','SAP APM indicator rows must exactly reconcile to the approved bindings');
  end if;

  perform set_config('app.sap_apm_indicator_ingest','granted',true);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_read:=v_read+1; v_reason:=null; v_binding:=null;
    v_ext:=nullif(btrim(v_row->>'external_id'),'');
    if jsonb_typeof(v_row)<>'object'
       or exists(select 1 from jsonb_object_keys(v_row) k where k not in (
         'external_id','sensor_id','technical_object_number','technical_object_type',
         'characteristics_internal_id','position_id','category_name','site_id','observed_at')) then
      v_reason:='row contains fields outside the governed SAP APM indicator contract';
    elsif coalesce(v_row->>'technical_object_number','')<>v_connector.apm_technical_object_number
       or coalesce(v_row->>'site_id','')<>v_connector.apm_site_id::text
       or v_ext is distinct from v_connector.apm_technical_object_number||':'||btrim(v_row->>'technical_object_type')
          ||':'||btrim(v_row->>'characteristics_internal_id')||':'||btrim(v_row->>'position_id')
          ||':'||btrim(v_row->>'category_name') then
      v_reason:='indicator identity escaped the approved technical object or site';
    else
      begin
        v_observed:=(v_row->>'observed_at')::timestamptz;
        if not isfinite(v_observed) or v_observed<>v_run.watermark_to then
          v_reason:='observation timestamp does not match the attested SAP APM snapshot';
        end if;
      exception when others then
        v_reason:='observation timestamp is invalid';
      end;
    end if;
    if v_reason is null then
      select value into v_binding from jsonb_array_elements(v_connector.apm_indicator_bindings) item
      where item->>'sensorId'=coalesce(v_row->>'sensor_id','')
        and item->>'technicalObjectType'=coalesce(v_row->>'technical_object_type','')
        and item->>'characteristicsInternalId'=coalesce(v_row->>'characteristics_internal_id','')
        and item->>'positionId'=coalesce(v_row->>'position_id','')
        and item->>'categoryName'=coalesce(v_row->>'category_name','')
      limit 1;
      if v_binding is null then
        v_reason:='SAP APM row is not an approved indicator binding';
      end if;
    end if;
    if v_reason is null and v_ext=any(v_seen) then
      v_reason:='mapped SAP APM response repeats an indicator';
    elsif v_reason is null then
      v_seen:=v_seen||v_ext;
    end if;
    if v_reason is null then
      select s.* into v_sensor from public.sensors s
      join public.assets a on a.id=s.asset_id and a.organization_id=s.organization_id
      where s.id=(v_row->>'sensor_id')::uuid
        and s.organization_id=p_organization_id
        and s.registry_status='active'
        and a.site_id=v_connector.apm_site_id
        and a.external_id=v_connector.apm_technical_object_number;
      if not found then
        v_reason:='binding no longer matches an active sensor on the canonical technical-object asset';
      elsif v_sensor.source_system is not null
         and v_sensor.source_system is distinct from v_connector.connector_key then
        v_reason:='canonical sensor is already bound to a different source';
      end if;
    end if;
    if v_reason is not null then
      v_rejected:=v_rejected+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status,reject_reason
      ) values(p_organization_id,v_connector.id,p_run_id,'sensor',v_ext,v_row,'rejected',v_reason);
      continue;
    end if;
    if v_sensor.source_system=v_connector.connector_key then
      v_duplicate:=v_duplicate+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(p_organization_id,v_connector.id,p_run_id,'sensor',v_ext,v_row,'duplicate');
    else
      update public.sensors set source_system=v_connector.connector_key
      where id=v_sensor.id and organization_id=p_organization_id
        and registry_status='active'
        and source_system is null;
      if not found then
        v_rejected:=v_rejected+1;
        insert into public.ingest_staging(
          organization_id,connector_id,run_id,entity_type,external_id,payload,status,reject_reason
        ) values(p_organization_id,v_connector.id,p_run_id,'sensor',v_ext,v_row,'rejected',
          'canonical sensor source identity changed before it could be stamped');
        continue;
      end if;
      v_ok:=v_ok+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(p_organization_id,v_connector.id,p_run_id,'sensor',v_ext,v_row,'accepted');
    end if;
  end loop;
  update public.connector_runs set records_read=v_read,records_accepted=v_ok,
    records_rejected=v_rejected,records_duplicate=v_duplicate
  where id=p_run_id and organization_id=p_organization_id;
  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,new_state
  ) values(
    p_organization_id,'sap_apm_indicator_read',v_role,
    jsonb_build_object('action','confirm_indicator_identity','runId',p_run_id,
      'connectorKey',v_connector.connector_key,'actorId',p_triggered_by,
      'sourceWriteBack',false,'measurementWrite',false,'healthScoreWrite',false,
      'limitChangeAuthority',false),
    jsonb_build_object('read',v_read,'accepted',v_ok,'duplicate',v_duplicate,
      'rejected',v_rejected,'preservedFields',jsonb_build_array(
        'last_value','warning_limit','alarm_limit','unit','registry_status'))
  );
  return jsonb_build_object('read',v_read,'accepted',v_ok,'duplicate',v_duplicate,'rejected',v_rejected);
end
$$;

revoke all on function public.ingest_sap_apm_indicator_read_batch(
  uuid,uuid,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.ingest_sap_apm_indicator_read_batch(
  uuid,uuid,uuid,jsonb
) to service_role;

create or replace function public.enforce_sap_apm_indicator_run_attestation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if exists(select 1 from public.connectors c where c.id=new.connector_id
    and c.connector_type='apm_indicator_read'
    and c.connector_profile='sap_apm_indicator' and c.register_ref='C2.19') then
    if tg_op='INSERT'
       and coalesce(current_setting('app.sap_apm_indicator_transport',true),'')<>'granted' then
      raise exception 'governed SAP APM indicator runs require service-attested complete transport evidence';
    end if;
    if tg_op='UPDATE'
       and coalesce(current_setting('app.sap_apm_indicator_ingest',true),'')<>'granted'
       and coalesce(current_setting('app.sap_apm_indicator_finish',true),'')<>'granted' then
      raise exception 'governed SAP APM indicator runs require service-only ingest or finish';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_sap_apm_indicator_run_attestation on public.connector_runs;
create trigger trg_sap_apm_indicator_run_attestation
before insert or update on public.connector_runs
for each row execute function public.enforce_sap_apm_indicator_run_attestation();

create or replace function public.finish_sap_apm_indicator_read_run(
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
  v_connector public.connectors%rowtype;
  v_clean boolean;
  v_advanced boolean:=false;
  v_expected int;
  v_rows int:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','SAP APM indicator finish is service-only');
  end if;
  if p_status not in ('success','partial','failed') then
    return jsonb_build_object('error','SAP APM indicator status must be success, partial or failed');
  end if;
  select r.* into v_run from public.connector_runs r join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id and r.status='running'
    and c.connector_type='apm_indicator_read' and c.connector_profile='sap_apm_indicator'
    and c.register_ref='C2.19';
  if not found then return jsonb_build_object('error','running governed SAP APM indicator run not found'); end if;
  select * into v_connector from public.connectors
  where id=v_run.connector_id and organization_id=p_organization_id;
  if v_run.source_contract_hash is distinct from public.sap_apm_indicator_contract_hash(v_connector.id) then
    return jsonb_build_object('error','SAP APM indicator contract changed before finish');
  end if;
  v_expected:=(v_run.transport_cursor_to->>'mapped_rows')::int;
  if p_status in ('success','partial') and v_run.records_read<>v_expected then
    return jsonb_build_object('error','SAP APM indicator run rows do not reconcile to the attested mapped response');
  end if;
  if p_status='success' and v_run.records_rejected>0 then
    return jsonb_build_object('error','an SAP APM indicator run with rejected rows cannot finish as success');
  end if;
  v_clean:=p_status='success' and v_run.records_rejected=0
    and v_run.transport_manifest is not null and v_run.transport_cursor_to is not null;
  perform set_config('app.sap_apm_indicator_finish','granted',true);
  update public.connector_runs set status=p_status,finished_at=now(),
    records_processed=records_accepted,
    error_message=case when p_error is null then null else left(p_error,500) end
  where id=p_run_id and organization_id=p_organization_id;
  if v_clean then
    insert into public.ingest_watermarks(
      organization_id,connector_id,entity_type,last_position,last_cursor,last_run_id,updated_at
    ) values(
      p_organization_id,v_run.connector_id,'sensor',v_run.watermark_to,
      v_run.transport_cursor_to,p_run_id,now()
    ) on conflict(connector_id,entity_type) do update set
      last_position=greatest(public.ingest_watermarks.last_position,excluded.last_position),
      last_cursor=excluded.last_cursor,last_run_id=excluded.last_run_id,updated_at=now();
    get diagnostics v_rows=row_count; v_advanced:=v_rows=1;
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

revoke all on function public.finish_sap_apm_indicator_read_run(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.finish_sap_apm_indicator_read_run(uuid,uuid,text,text)
  to service_role;

notify pgrst,'reload schema';

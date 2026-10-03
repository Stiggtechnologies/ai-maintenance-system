-- ============================================================================
-- C2.13 — Azure IoT Operations / Event Hubs read-only ingress.
--
-- Azure IoT Operations remains the OT-edge owner: OPC UA -> MQTT -> data flow
-- -> Event Hubs.  A small Azure Function relay signs a normalized batch and
-- sends it here.  SyncAI never opens an OPC UA session and this contract has no
-- plant-write, method-call, command-topic or control-plane surface.
--
-- Canonical reuse is deliberate:
--   * connectors / connector_runs own configuration and run evidence;
--   * historian_tag_map is the named-human tag-to-sensor decision;
--   * ingest_staging retains every accepted, duplicate and rejected row;
--   * ingest_batch is the one condition-reading validator/writer, so limit
--     evaluation and alerts remain identical to manual and historian reads.
-- ============================================================================

alter table public.connectors
  add column if not exists ingress_key_id text,
  add column if not exists ingress_authorized_by uuid references auth.users(id) on delete restrict,
  add column if not exists ingress_authorized_at timestamptz;

create unique index if not exists uq_connectors_ingress_key_id
  on public.connectors(ingress_key_id) where ingress_key_id is not null;

alter table public.connectors
  drop constraint if exists connectors_ingress_authority_complete;
alter table public.connectors
  add constraint connectors_ingress_authority_complete check (
    ingress_key_id is null or (
      ingress_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$'
      and ingress_authorized_by is not null
      and ingress_authorized_at is not null
    )
  );

comment on column public.connectors.ingress_key_id is
  'Non-secret identifier selecting an externally stored ingress signing key. The key value never enters the database.';

alter table public.connector_runs
  add column if not exists source_delivery_id text,
  add column if not exists source_body_sha256 text,
  add column if not exists source_received_at timestamptz,
  add column if not exists source_transport text;

create unique index if not exists uq_connector_runs_source_delivery
  on public.connector_runs(connector_id,source_delivery_id)
  where source_delivery_id is not null;

alter table public.connector_runs
  drop constraint if exists connector_runs_source_receipt_complete;
alter table public.connector_runs
  add constraint connector_runs_source_receipt_complete check (
    source_delivery_id is null or (
      length(btrim(source_delivery_id)) between 8 and 200
      and source_body_sha256 ~ '^[0-9a-f]{64}$'
      and source_received_at is not null
      and source_transport='azure_event_hubs'
    )
  );

create or replace function public.configure_azure_iot_operations_source(
  p_key text,
  p_name text,
  p_event_hubs_namespace text,
  p_event_hub_name text,
  p_expected_interval_minutes integer,
  p_ingress_key_id text,
  p_credential_binding_ref text,
  p_context_purpose text,
  p_rights_reference text,
  p_enabled boolean,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_id uuid;
  v_namespace text:=lower(btrim(coalesce(p_event_hubs_namespace,'')));
  v_hub text:=btrim(coalesce(p_event_hub_name,''));
  v_key_id text:=btrim(coalesce(p_ingress_key_id,''));
  v_ref text:=nullif(btrim(coalesce(p_credential_binding_ref,'')),'');
  v_endpoint text;
  v_mapping_count integer;
begin
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_org is null or coalesce(v_role,'') not in ('admin','ai_admin') then
    return jsonb_build_object('error','configuring Azure IoT Operations requires a named administrator');
  end if;
  if coalesce(length(btrim(p_key)),0)<3 or coalesce(length(btrim(p_name)),0)<3 then
    return jsonb_build_object('error','connector key and display name are required');
  end if;
  if v_namespace !~ '^[a-z0-9][a-z0-9-]{4,48}[a-z0-9]\.servicebus\.windows\.net$' then
    return jsonb_build_object('error','use the credential-free Event Hubs namespace host ending in .servicebus.windows.net');
  end if;
  if v_hub !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$' then
    return jsonb_build_object('error','Event Hub name is invalid');
  end if;
  if v_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$' then
    return jsonb_build_object('error','ingress key ID must be 8–80 safe identifier characters');
  end if;
  if v_ref is null or v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$' or v_ref ~ '[@?=#]' then
    return jsonb_build_object('error','record only an opaque Key Vault or secret-store URI without a credential value');
  end if;
  if coalesce(p_expected_interval_minutes,0)<1 or p_expected_interval_minutes>1440 then
    return jsonb_build_object('error','expected interval must be between 1 and 1440 minutes');
  end if;
  if coalesce(length(btrim(p_context_purpose)),0)<10 then
    return jsonb_build_object('error','record the operational purpose of this source');
  end if;
  if coalesce(length(btrim(p_rights_reference)),0)<8 then
    return jsonb_build_object('error','record the customer authority or data-rights reference');
  end if;
  if coalesce(length(btrim(p_basis)),0)<40 then
    return jsonb_build_object('error','record a substantive activation, data-rights and read-only basis of at least 40 characters');
  end if;
  if exists(
    select 1 from public.connectors
    where organization_id=v_org and connector_key=btrim(p_key)
      and connector_type is distinct from 'azure_iot_operations'
  ) then
    return jsonb_build_object('error','connector key already belongs to another governed integration contract');
  end if;
  if exists(
    select 1 from public.connectors
    where ingress_key_id=v_key_id
      and (organization_id<>v_org or connector_key<>btrim(p_key))
  ) then
    return jsonb_build_object('error','ingress key ID already identifies another governed connector');
  end if;

  select count(*) into v_mapping_count
  from public.historian_tag_map
  where organization_id=v_org and source_system=btrim(p_key)
    and sensor_id is not null and confirmed_by is not null and confirmed_at is not null;
  if p_enabled and v_mapping_count=0 then
    return jsonb_build_object(
      'error','confirm at least one tag-to-sensor mapping in Data Governance before enabling live ingress'
    );
  end if;

  v_endpoint:='https://' || v_namespace || '/' || v_hub;
  perform set_config('app.sync_context_source_write','granted',true);
  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,
    endpoint_hint,expected_interval_minutes,credential_binding_ref,
    contract_note,register_ref,status,enabled,direction,write_enabled,
    ingress_key_id,ingress_authorized_by,ingress_authorized_at,
    context_source_class,context_source_authority,context_purpose,
    context_rights_state,context_rights_reference,context_rights_basis,
    context_rights_decided_by,context_rights_decided_at,
    context_health_state,context_checked_at,context_health_detail
  ) values(
    v_org,btrim(p_key),btrim(p_name),'azure_iot_operations','historian',
    v_endpoint,p_expected_interval_minutes,v_ref,
    'Azure IoT Operations OPC UA telemetry relayed from Event Hubs. Strictly read-only; no plant command, write, method call or control topic.',
    'C2.13',case when p_enabled then 'active' else 'configured' end,
    p_enabled,'read_only',false,v_key_id,auth.uid(),now(),
    'customer_operational','tenant_authorized',btrim(p_context_purpose),
    'customer_authorized',btrim(p_rights_reference),btrim(p_basis),auth.uid(),now(),
    case when p_enabled then 'not_connected' else 'unavailable' end,now(),
    case when p_enabled
      then 'Configured for signed Event Hubs relay; no accepted delivery observed yet.'
      else 'Saved disabled; no live source claim is made.' end
  )
  on conflict(organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,connector_type='azure_iot_operations',system_kind='historian',
    endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,register_ref='C2.13',status=excluded.status,
    enabled=excluded.enabled,direction='read_only',write_enabled=false,
    ingress_key_id=excluded.ingress_key_id,
    ingress_authorized_by=auth.uid(),ingress_authorized_at=now(),
    context_source_class='customer_operational',
    context_source_authority='tenant_authorized',
    context_purpose=excluded.context_purpose,
    context_rights_state='customer_authorized',
    context_rights_reference=excluded.context_rights_reference,
    context_rights_basis=excluded.context_rights_basis,
    context_rights_decided_by=auth.uid(),context_rights_decided_at=now(),
    context_health_state=case
      when excluded.enabled then 'not_connected' else 'unavailable' end,
    context_checked_at=now(),context_observed_at=null,
    context_health_detail=case when excluded.enabled
      then 'Configured for signed Event Hubs relay; no accepted delivery observed yet.'
      else 'Saved disabled; no live source claim is made.' end
  returning id into v_id;
  perform set_config('app.sync_context_source_write','',true);

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'azure_iot_operations_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      || ' read-only Azure IoT Operations source ' || btrim(p_key),
    'approved','manual',100,auth.uid()::text,btrim(p_basis),'executed'
  );

  return jsonb_build_object(
    'ok',true,'connector_id',v_id,'enabled',p_enabled,
    'direction','read_only','write_enabled',false,
    'transport','azure_iot_operations_event_hubs',
    'confirmed_tag_mappings',v_mapping_count,
    'note',case when p_enabled
      then 'Enabled for signed read-only relay batches. Live status begins only after an accepted delivery.'
      else 'Saved disabled. Confirm tag mappings, deploy the relay/key binding, then enable.' end
  );
exception when others then
  perform set_config('app.sync_context_source_write','',true);
  raise;
end
$$;

revoke all on function public.configure_azure_iot_operations_source(
  text,text,text,text,integer,text,text,text,text,boolean,text
) from public,anon;
grant execute on function public.configure_azure_iot_operations_source(
  text,text,text,text,integer,text,text,text,text,boolean,text
) to authenticated;

create or replace function public.get_azure_iot_operations_status()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_connector public.connectors%rowtype;
  v_effective_health text;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into v_connector from public.connectors
  where organization_id=v_org and connector_type='azure_iot_operations'
  order by enabled desc,created_at desc limit 1;
  if not found then
    return jsonb_build_object(
      'configured',false,'enabled',false,'live',false,
      'confirmed_tag_mappings',0,'unconfirmed_tag_mappings',0,
      'recent_runs','[]'::jsonb,
      'basis','No Azure IoT Operations source is configured. No live OPC UA telemetry claim is made.'
    );
  end if;
  v_effective_health:=case
    when v_connector.enabled and v_connector.context_health_state='live' and (
      v_connector.last_success_at is null or v_connector.context_observed_at is null
      or v_connector.last_success_at < now()-make_interval(
        mins=>greatest(v_connector.expected_interval_minutes,1)*2)
      or v_connector.context_observed_at < now()-make_interval(
        mins=>greatest(v_connector.expected_interval_minutes,1)*2)
    ) then 'stale'
    else v_connector.context_health_state end;
  return jsonb_build_object(
    'configured',true,'enabled',v_connector.enabled,
    'live',v_connector.enabled and v_effective_health='live',
    'connector_key',v_connector.connector_key,'name',v_connector.name,
    'endpoint_hint',v_connector.endpoint_hint,
    'direction',v_connector.direction,'write_enabled',v_connector.write_enabled,
    'ingress_key_id',v_connector.ingress_key_id,
    'context_health_state',v_effective_health,
    'context_health_detail',v_connector.context_health_detail,
    'last_success_at',v_connector.last_success_at,
    'confirmed_tag_mappings',(
      select count(*) from public.historian_tag_map h
      where h.organization_id=v_org and h.source_system=v_connector.connector_key
        and h.sensor_id is not null and h.confirmed_by is not null and h.confirmed_at is not null
    ),
    'unconfirmed_tag_mappings',(
      select count(*) from public.historian_tag_map h
      where h.organization_id=v_org and h.source_system=v_connector.connector_key
        and (h.sensor_id is null or h.confirmed_by is null or h.confirmed_at is null)
    ),
    'recent_runs',coalesce((
      select jsonb_agg(jsonb_build_object(
        'run_id',r.id,'delivery_id',r.source_delivery_id,'status',r.status,
        'started_at',r.started_at,'finished_at',r.finished_at,
        'read',r.records_read,'accepted',r.records_accepted,
        'duplicate',r.records_duplicate,'rejected',r.records_rejected
      ) order by r.started_at desc)
      from (select * from public.connector_runs
        where organization_id=v_org and connector_id=v_connector.id
        order by started_at desc limit 10) r
    ),'[]'::jsonb),
    'basis',case
      when not v_connector.enabled then 'Configured but disabled; no live source claim is made.'
      when v_effective_health='live' then
        'Signed Event Hubs deliveries are landing through confirmed tag mappings.'
      when v_effective_health='stale' then
        'The source was previously live, but its latest accepted delivery or source observation is now older than twice the expected interval.'
      else coalesce(v_connector.context_health_detail,'Enabled but no accepted live delivery is proven.')
    end
  );
end
$$;

revoke all on function public.get_azure_iot_operations_status() from public,anon;
grant execute on function public.get_azure_iot_operations_status() to authenticated;

-- Service-only signed ingress.  It temporarily supplies the explicitly
-- authorizing administrator solely so the canonical app_current_org()-based
-- ingest contract can be reused.  The run itself remains an unattended system
-- run (triggered_by NULL), and the connector preserves who authorized it.
create or replace function public.ingest_azure_iot_operations_batch(
  p_organization_id uuid,
  p_connector_key text,
  p_ingress_key_id text,
  p_delivery_id text,
  p_body_sha256 text,
  p_received_at timestamptz,
  p_points jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_connector public.connectors%rowtype;
  v_run uuid;
  v_point jsonb;
  v_tag text;
  v_ext text;
  v_reason text;
  v_sensor uuid;
  v_map record;
  v_rows jsonb:='[]'::jsonb;
  v_rejected integer:=0;
  v_result jsonb:=jsonb_build_object('read',0,'accepted',0,'duplicate',0,'rejected',0);
  v_old_sub text:=current_setting('request.jwt.claim.sub',true);
  v_old_claims text:=current_setting('request.jwt.claims',true);
  v_status text;
  v_observed_at timestamptz;
  v_health_state text;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','service role required');
  end if;
  if p_organization_id is null or coalesce(length(btrim(p_connector_key)),0)<3
     or coalesce(length(btrim(p_ingress_key_id)),0)<8 then
    return jsonb_build_object('error','tenant, connector and ingress key identity are required');
  end if;
  if coalesce(length(btrim(p_delivery_id)),0) not between 8 and 200
     or p_body_sha256 is null or p_body_sha256 !~ '^[0-9a-f]{64}$'
     or p_received_at is null
     or p_received_at < now()-interval '10 minutes'
     or p_received_at > now()+interval '5 minutes' then
    return jsonb_build_object('error','delivery identity, body digest and receipt time are required');
  end if;
  if p_points is null or jsonb_typeof(p_points)<>'array' or jsonb_array_length(p_points)=0
     or jsonb_array_length(p_points)>500 then
    return jsonb_build_object('error','points must contain 1–500 normalized telemetry rows');
  end if;

  select * into v_connector from public.connectors
  where organization_id=p_organization_id and connector_key=btrim(p_connector_key)
    and connector_type='azure_iot_operations' and ingress_key_id=btrim(p_ingress_key_id);
  if not found or not v_connector.enabled then
    return jsonb_build_object('error','enabled Azure IoT Operations connector not found');
  end if;
  if v_connector.direction<>'read_only' or v_connector.write_enabled then
    return jsonb_build_object('error','Azure IoT Operations ingress refuses a write-enabled connector');
  end if;
  if v_connector.ingress_authorized_by is null or not exists(
    select 1 from public.user_profiles u
    where u.id=v_connector.ingress_authorized_by
      and u.organization_id=p_organization_id and u.role in ('admin','ai_admin')
  ) then
    return jsonb_build_object('error','the named ingress authorization is no longer valid');
  end if;

  select id into v_run from public.connector_runs
  where connector_id=v_connector.id and source_delivery_id=btrim(p_delivery_id);
  if v_run is not null then
    return jsonb_build_object('ok',true,'replayed',true,'run_id',v_run,
      'note','delivery already recorded; no rows were written again');
  end if;

  insert into public.connector_runs(
    organization_id,connector_id,entity_type,run_type,status,started_at,
    source_delivery_id,source_body_sha256,source_received_at,source_transport
  ) values(
    p_organization_id,v_connector.id,'condition_reading','stream','running',now(),
    btrim(p_delivery_id),p_body_sha256,p_received_at,'azure_event_hubs'
  ) returning id into v_run;

  for v_point in select * from jsonb_array_elements(p_points) loop
    v_reason:=null; v_sensor:=null; v_tag:=btrim(coalesce(v_point->>'tag',''));
    v_ext:=btrim(coalesce(v_point->>'external_id',''));
    if length(v_tag)<2 then v_reason:='missing OPC UA tag identity';
    elsif length(v_ext)<8 then v_reason:='missing stable Event Hubs point identity';
    elsif v_point->>'value' is null then v_reason:='missing value';
    elsif nullif(btrim(coalesce(v_point->>'source_timestamp','')),'') is null then
      v_reason:='missing source timestamp';
    end if;

    if v_reason is null then
      select h.sensor_id,h.asset_id,h.measurement,h.unit into v_map
      from public.historian_tag_map h
      where h.organization_id=p_organization_id and h.historian_tag=v_tag
        and h.source_system=v_connector.connector_key
        and h.sensor_id is not null and h.confirmed_by is not null and h.confirmed_at is not null;
      v_sensor:=v_map.sensor_id;
      if v_sensor is null then
        v_reason:='tag has no named-human confirmed mapping to a canonical sensor';
      elsif not exists(
        select 1 from public.sensors s
        where s.id=v_sensor and s.organization_id=p_organization_id
          and s.asset_id=v_map.asset_id
      ) then
        v_reason:='confirmed tag mapping no longer resolves to the same-tenant canonical sensor and asset';
      end if;
    end if;

    if v_reason is null then
      begin
        perform (v_point->>'value')::numeric;
        perform (v_point->>'source_timestamp')::timestamptz;
        if (v_point->>'source_timestamp')::timestamptz > p_received_at+interval '5 minutes' then
          v_reason:='source timestamp is implausibly later than relay receipt';
        end if;
      exception when others then
        v_reason:='value or source timestamp is not parseable';
      end;
    end if;

    if v_reason is null then
      v_rows:=v_rows || jsonb_build_array(jsonb_build_object(
        'external_id',v_ext,'sensor_id',v_sensor,'value',v_point->'value',
        'taken_at',v_point->>'source_timestamp',
        'quality',coalesce(nullif(btrim(v_point->>'quality'),''),'unknown'),
        'source_tag',v_tag,'measurement',v_map.measurement,'unit',v_map.unit,
        'delivery_id',p_delivery_id,'body_sha256',p_body_sha256,
        'partition_id',v_point->>'partition_id','offset',v_point->>'offset',
        'sequence_number',v_point->>'sequence_number'
      ));
    else
      v_rejected:=v_rejected+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status,reject_reason
      ) values(
        p_organization_id,v_connector.id,v_run,'condition_reading',nullif(v_ext,''),
        v_point || jsonb_build_object('delivery_id',p_delivery_id,'body_sha256',p_body_sha256),
        'rejected',v_reason
      );
    end if;
  end loop;

  -- Reuse the canonical writer under the exact tenant explicitly authorized
  -- on this connector. The run remains system-triggered, not human-triggered.
  perform set_config('request.jwt.claim.sub',v_connector.ingress_authorized_by::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_connector.ingress_authorized_by::text,'role','authenticated'
  )::text,true);
  if jsonb_array_length(v_rows)>0 then
    v_result:=public.ingest_batch(v_run,v_rows);
    if v_result ? 'error' then raise exception '%',v_result->>'error'; end if;
  end if;
  update public.connector_runs set
    records_read=records_read+v_rejected,
    records_rejected=records_rejected+v_rejected
  where id=v_run;
  v_status:=case when (v_result->>'rejected')::integer+v_rejected>0
    then 'partial' else 'success' end;
  perform public.finish_connector_run(v_run,v_status,null);
  select watermark_to into v_observed_at from public.connector_runs where id=v_run;
  v_health_state:=case
    when v_status<>'success' then 'partial_coverage'
    when v_observed_at is null then 'unavailable'
    when v_observed_at < p_received_at-make_interval(
      mins=>greatest(v_connector.expected_interval_minutes,1)*2
    ) then 'stale'
    else 'live' end;

  perform set_config('app.sync_context_source_write','granted',true);
  update public.connectors set
    context_health_state=v_health_state,
    context_checked_at=now(),context_observed_at=v_observed_at,
    context_health_detail=case when v_health_state='live'
      then 'Signed Event Hubs delivery accepted through confirmed tag mappings.'
      when v_health_state='stale' then format(
        'Signed delivery succeeded, but latest source time %s is older than twice the %s-minute expected interval.',
        v_observed_at,v_connector.expected_interval_minutes)
      when v_health_state='unavailable' then
        'Signed delivery succeeded without a usable source timestamp; live source status is withheld.'
      else format('%s telemetry point(s) were retained as rejects; watermark did not advance.',
        (v_result->>'rejected')::integer+v_rejected) end
  where id=v_connector.id;
  perform set_config('app.sync_context_source_write','',true);
  perform set_config('request.jwt.claim.sub',coalesce(v_old_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(v_old_claims,''),true);

  return jsonb_build_object(
    'ok',true,'replayed',false,'run_id',v_run,'status',v_status,
    'read',(v_result->>'read')::integer+v_rejected,
    'accepted',(v_result->>'accepted')::integer,
    'duplicate',(v_result->>'duplicate')::integer,
    'rejected',(v_result->>'rejected')::integer+v_rejected,
    'watermark_advanced',v_status='success',
    'source_health_state',v_health_state,'source_observed_at',v_observed_at
  );
exception when unique_violation then
  perform set_config('app.sync_context_source_write','',true);
  perform set_config('request.jwt.claim.sub',coalesce(v_old_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(v_old_claims,''),true);
  select id into v_run from public.connector_runs
  where connector_id=v_connector.id and source_delivery_id=btrim(p_delivery_id);
  return jsonb_build_object('ok',true,'replayed',true,'run_id',v_run,
    'note','delivery already recorded; no rows were written again');
when others then
  perform set_config('app.sync_context_source_write','',true);
  perform set_config('request.jwt.claim.sub',coalesce(v_old_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(v_old_claims,''),true);
  if v_run is not null then
    update public.connector_runs set status='failed',finished_at=now(),
      error_message='Azure IoT Operations ingress failed; inspect protected function logs.'
    where id=v_run and status='running';
    update public.connectors set last_failure_at=now() where id=v_connector.id;
  end if;
  raise;
end
$$;

revoke all on function public.ingest_azure_iot_operations_batch(
  uuid,text,text,text,text,timestamptz,jsonb
) from public,anon,authenticated;
grant execute on function public.ingest_azure_iot_operations_batch(
  uuid,text,text,text,text,timestamptz,jsonb
) to service_role;

-- A live Azure source must yield the seed randomizer exactly as the existing
-- plant-historian source does. Mixing generated values into a live source's
-- sensor history would make provenance labels and decisions untrustworthy.
create or replace function public.simulate_telemetry_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare s record; v_updated int:=0; v_new numeric; v_drift numeric; v_new_status text;
begin
  for s in
    select se.* from public.sensors se
    where se.last_value is not null and not exists(
      select 1 from public.connectors c
      where c.organization_id=se.organization_id
        and c.connector_type in ('plant_historian','azure_iot_operations')
        and c.enabled and c.direction='read_only' and not c.write_enabled
    )
  loop
    v_drift:=(random()-0.5)*0.03*greatest(abs(s.last_value),1);
    if s.threshold is not null then
      v_drift:=v_drift+(s.threshold*0.8-s.last_value)*0.02;
      if random()<0.02 then v_drift:=v_drift+s.threshold*0.12; end if;
    end if;
    v_new:=round((s.last_value+v_drift)::numeric,2);
    if v_new<0 then v_new:=0; end if;
    v_new_status:=case when s.threshold is null then s.status
      when v_new>=s.threshold then 'alarm'
      when v_new>=s.threshold*0.9 then 'warning' else 'normal' end;
    update public.sensors set last_value=v_new,status=v_new_status,
      trend=case when v_new>s.last_value*1.005 then 'up'
        when v_new<s.last_value*0.995 then 'down' else 'stable' end
    where id=s.id;
    v_updated:=v_updated+1;
  end loop;
  return jsonb_build_object('sensors_updated',v_updated,'ran_at',now());
end
$$;
revoke execute on function public.simulate_telemetry_tick() from public,anon,authenticated;
grant execute on function public.simulate_telemetry_tick() to service_role;

-- C9.04 previously recognized one plant_historian key. Compose all enabled,
-- read-only canonical plant sources so Azure readings are never mislabeled as
-- seed/import evidence and a tenant may transition sources without ambiguity.
create or replace function public.get_contextual_condition_monitoring(
  p_window_days int default 30,p_limit int default 24
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_window int:=least(greatest(coalesce(p_window_days,30),1),365);
  v_limit int:=least(greatest(coalesce(p_limit,24),1),100);
  v_connector_keys text[]:='{}';
  v_total bigint:=0; v_contextualized bigint:=0; v_connector_backed bigint:=0;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select coalesce(array_agg(c.connector_key order by c.connector_key),'{}')
  into v_connector_keys from public.connectors c
  where c.organization_id=v_org
    and c.connector_type in ('plant_historian','azure_iot_operations')
    and c.enabled and c.direction='read_only' and not c.write_enabled;
  with scoped as(
    select cr.id,cr.asset_id,cr.taken_at,cr.source_system
    from public.condition_readings cr where cr.organization_id=v_org
      and cr.taken_at>=now()-make_interval(days=>v_window)
  )
  select count(*),count(*) filter(where exists(
    select 1 from public.operating_states os where os.organization_id=v_org
      and os.asset_id=scoped.asset_id and os.started_at<=scoped.taken_at
      and (os.ended_at is null or os.ended_at>scoped.taken_at)
  )),count(*) filter(where scoped.source_system=any(v_connector_keys))
  into v_total,v_contextualized,v_connector_backed from scoped;
  return jsonb_build_object(
    'window_days',v_window,
    'summary',jsonb_build_object(
      'readings',v_total,'contextualized',v_contextualized,
      'context_unknown',v_total-v_contextualized,
      'context_coverage_pct',case when v_total>0 then round(100.0*v_contextualized/v_total,1) end,
      'connector_backed',v_connector_backed,'other_source',v_total-v_connector_backed),
    'source',jsonb_build_object(
      'connector_key',v_connector_keys[1],
      'connector_keys',to_jsonb(v_connector_keys),
      'connector_enabled',cardinality(v_connector_keys)>0,
      'basis',case when cardinality(v_connector_keys)>0 then
        format('%s enabled read-only plant source(s). Only readings whose source_system equals one of those exact connector keys are labelled connector-backed.',cardinality(v_connector_keys))
      else 'No enabled read-only plant source owns telemetry for this tenant. Readings remain seed, simulated or imported evidence and are not labelled live plant data.' end),
    'readings',coalesce((select jsonb_agg(jsonb_build_object(
      'id',q.id,'asset_id',q.asset_id,'asset',q.asset,'sensor',q.sensor,
      'signal_type',q.signal_type,'unit',q.unit,'value',q.value,'quality',q.quality,
      'taken_at',q.taken_at,'source_system',q.source_system,
      'source_posture',case when q.source_system=any(v_connector_keys)
        then 'connector_backed' else 'seed_sim_or_import' end,
      'context_known',q.operating_state_id is not null,
      'operating_state',q.operating_state,'load_pct',q.load_pct,
      'operating_reason',q.operating_reason,'operating_source',q.operating_source
    ) order by q.taken_at desc) from(
      select cr.id,cr.asset_id,a.name asset,s.name sensor,s.signal_type,s.unit,
        cr.value,cr.quality,cr.taken_at,cr.source_system,
        os.id operating_state_id,os.state operating_state,os.load_pct,
        os.reason_code operating_reason,os.source_system operating_source
      from public.condition_readings cr
      join public.sensors s on s.id=cr.sensor_id and s.organization_id=v_org
      left join public.assets a on a.id=cr.asset_id and a.organization_id=v_org
      left join lateral(
        select x.id,x.state,x.load_pct,x.reason_code,x.source_system
        from public.operating_states x where x.organization_id=v_org
          and x.asset_id=cr.asset_id and x.started_at<=cr.taken_at
          and (x.ended_at is null or x.ended_at>cr.taken_at)
        order by x.started_at desc limit 1
      ) os on true
      where cr.organization_id=v_org
        and cr.taken_at>=now()-make_interval(days=>v_window)
      order by cr.taken_at desc limit v_limit
    ) q),'[]'::jsonb),
    'basis',case when v_total=0 then
      format('No condition readings exist in the last %s days. No condition or operating conclusion can be drawn.',v_window)
    when v_contextualized=0 then
      'Condition readings exist, but none has a covering operating-state interval. Duty remains unknown; SyncAI will not infer it from a nearby state.'
    else format('%s of %s readings have a same-asset operating-state interval covering the exact reading time. Unknown context remains explicit.',v_contextualized,v_total) end
  );
end
$$;
revoke all on function public.get_contextual_condition_monitoring(int,int) from public,anon;
grant execute on function public.get_contextual_condition_monitoring(int,int) to authenticated;

notify pgrst,'reload schema';

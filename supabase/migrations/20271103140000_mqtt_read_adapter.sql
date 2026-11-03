-- C2.20 — governed read-only MQTT subscribe adapter.
--
-- One connector listens to one allowlisted TLS WebSocket broker for a bounded
-- window and retains the messages as staging evidence. Payloads are not
-- promoted into condition readings, alarms, limits, or work. MQTT remains
-- subscribe-only: this migration has no publish, write-back, or command path.
-- It extends connectors, connector_runs, ingest_staging, ingest_watermarks,
-- decisions, and audit_events. It creates no second store.

create or replace function public.mqtt_topic_filter_valid(p_filter text)
returns boolean
language plpgsql
immutable
set search_path=public
as $$
declare
  v_level text;
  v_levels text[];
  v_index int:=0;
  v_count int;
begin
  if p_filter is null or length(p_filter) not between 1 and 256 then return false; end if;
  if p_filter ~ '[^A-Za-z0-9_./+#-]' or p_filter like '%$%' then return false; end if;
  v_levels:=string_to_array(p_filter,'/');
  v_count:=coalesce(array_length(v_levels,1),0);
  if v_count<1 then return false; end if;
  foreach v_level in array v_levels loop
    v_index:=v_index+1;
    if v_level is null or length(v_level)=0 then return false; end if;
    if v_level='#' then
      if v_index<>v_count then return false; end if;
    elsif position('#' in v_level)>0 or position('+' in v_level)>0 then
      if v_level<>'+' then return false; end if;
    end if;
  end loop;
  return true;
end
$$;

revoke all on function public.mqtt_topic_filter_valid(text) from public,anon,authenticated;

create or replace function public.mqtt_topic_filters_are_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path=public
as $$
declare
  v_item jsonb;
  v_text text;
  v_seen text[]:='{}';
begin
  if coalesce(jsonb_typeof(p_value),'')<>'array'
     or jsonb_array_length(p_value) not between 1 and 8 then return false; end if;
  for v_item in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_item)<>'string' then return false; end if;
    v_text:=v_item #>> '{}';
    if not public.mqtt_topic_filter_valid(v_text) then return false; end if;
    if v_text=any(v_seen) then return false; end if;
    v_seen:=v_seen||v_text;
  end loop;
  return true;
end
$$;

revoke all on function public.mqtt_topic_filters_are_valid(jsonb) from public,anon,authenticated;

create or replace function public.mqtt_topic_matches_filter(p_topic text, p_filter text)
returns boolean
language plpgsql
immutable
set search_path=public
as $$
declare
  v_topic text[];
  v_filter text[];
  v_index int;
  v_topic_count int;
  v_filter_count int;
begin
  if p_topic is null or p_filter is null then return false; end if;
  if length(p_topic) not between 1 and 256 or p_topic ~ '[^A-Za-z0-9_./-]' then return false; end if;
  if left(p_topic,1)='$' and (left(p_filter,1)='#' or left(p_filter,1)='+') then return false; end if;
  v_topic:=string_to_array(p_topic,'/');
  v_filter:=string_to_array(p_filter,'/');
  v_topic_count:=coalesce(array_length(v_topic,1),0);
  v_filter_count:=coalesce(array_length(v_filter,1),0);
  if v_topic_count<1 or ''=any(v_topic) then return false; end if;
  v_index:=1;
  while v_index<=v_filter_count loop
    if v_filter[v_index]='#' then
      return v_index=v_filter_count;
    end if;
    if v_index>v_topic_count then return false; end if;
    if v_filter[v_index]<>'+' and v_filter[v_index] is distinct from v_topic[v_index] then
      return false;
    end if;
    v_index:=v_index+1;
  end loop;
  return v_index-1=v_topic_count;
end
$$;

revoke all on function public.mqtt_topic_matches_filter(text,text) from public,anon,authenticated;

alter table public.connectors drop constraint if exists connectors_system_kind_check;
alter table public.connectors add constraint connectors_system_kind_check check (
  system_kind is null
  or system_kind in (
    'historian','cmms','eam','erp','inventory','condition_monitoring',
    'document','scheduling','data_lake','financial','file','iot'
  )
);

alter table public.connectors
  add column if not exists mqtt_topic_filters jsonb,
  add column if not exists mqtt_window_seconds int,
  add column if not exists mqtt_max_messages int,
  add column if not exists mqtt_subscribe_qos int;

alter table public.connectors drop constraint if exists connectors_mqtt_read_profile_check;
alter table public.connectors add constraint connectors_mqtt_read_profile_check check (
  connector_type is distinct from 'mqtt_read'
  or (
    system_kind='iot'
    and connector_profile='mqtt_wss_subscribe'
    and public.mqtt_topic_filters_are_valid(mqtt_topic_filters)
    and mqtt_window_seconds between 1 and 30
    and mqtt_max_messages between 1 and 200
    and mqtt_subscribe_qos between 0 and 2
    and pagination_mode='none'
    and pagination_next_path is null
    and pagination_max_pages=1
    and direction='read_only'
    and not write_enabled
  )
);

comment on column public.connectors.mqtt_topic_filters is
  'Administrator-approved MQTT topic filters for one subscribe-only listen. Not a publish list and not an engineering limit.';
comment on column public.connectors.mqtt_window_seconds is
  'Hard listen window for one pull, 1 to 30 seconds. A transport ceiling, not a process interval.';
comment on column public.connectors.mqtt_max_messages is
  'Hard maximum messages retained from one listen window.';
comment on column public.connectors.mqtt_subscribe_qos is
  'Maximum QoS requested on subscribe. The adapter still never publishes.';

create or replace function public.configure_mqtt_read_source(
  p_key text,
  p_name text,
  p_broker_url text,
  p_topic_filters jsonb,
  p_window_seconds int,
  p_max_messages int,
  p_subscribe_qos int,
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
  v_endpoint text:=nullif(btrim(coalesce(p_broker_url,'')),'');
  v_ref text:=nullif(btrim(coalesce(p_credential_binding_ref,'')),'');
  v_port int;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then
    return jsonb_build_object('error','a named human administrator must configure or enable an MQTT source');
  end if;
  if v_org is null or coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error','configuring an MQTT source requires an administrator');
  end if;
  if coalesce(length(btrim(p_key)),0) not between 3 and 160
     or coalesce(length(btrim(p_name)),0) not between 3 and 160 then
    return jsonb_build_object('error','connector key and name must be between 3 and 160 characters');
  end if;
  if coalesce(length(btrim(p_basis)),0) not between 20 and 2000 then
    return jsonb_build_object('error','record a substantive MQTT activation basis');
  end if;
  if not public.mqtt_topic_filters_are_valid(p_topic_filters) then
    return jsonb_build_object('error','provide 1 to 8 unique MQTT topic filters');
  end if;
  if coalesce(p_window_seconds,0) not between 1 and 30 then
    return jsonb_build_object('error','MQTT listen window must be between 1 and 30 seconds');
  end if;
  if coalesce(p_max_messages,0) not between 1 and 200 then
    return jsonb_build_object('error','MQTT message cap must be between 1 and 200');
  end if;
  if coalesce(p_subscribe_qos,-1) not between 0 and 2 then
    return jsonb_build_object('error','MQTT subscribe QoS must be 0, 1, or 2');
  end if;
  if coalesce(p_expected_interval_minutes,0) not between 1 and 525600 then
    return jsonb_build_object('error','expected interval must be between one minute and one year');
  end if;
  if v_endpoint is null or length(v_endpoint)>2048
     or v_endpoint !~* '^wss://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'
     or v_endpoint ~* '(localhost|\.local($|/)|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[|@|\?|#|password|token|api[_-]?key|bearer|secret)' then
    return jsonb_build_object('error','MQTT broker URL must be a credential-free public wss:// URL without a query or fragment; private, local, and cleartext targets are blocked');
  end if;
  if v_endpoint ~ ':[0-9]' then
    v_port:=substring(v_endpoint from '://[^/:]+:([0-9]+)')::int;
    if v_port is null or v_port not between 1 and 65535 then
      return jsonb_build_object('error','MQTT broker port is invalid');
    end if;
  end if;
  if v_ref is null or length(v_ref)>500
     or v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$'
     or v_ref ~ '[@?=#]' then
    return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value, query or fragment');
  end if;
  if exists(select 1 from public.connectors where organization_id=v_org
    and connector_key=btrim(p_key) and connector_type is distinct from 'mqtt_read') then
    return jsonb_build_object('error','connector key already belongs to another governed integration contract');
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,
    connector_profile,endpoint_hint,expected_interval_minutes,
    credential_binding_ref,contract_note,register_ref,status,enabled,
    direction,write_enabled,pagination_mode,pagination_next_path,
    pagination_max_pages,mqtt_topic_filters,mqtt_window_seconds,
    mqtt_max_messages,mqtt_subscribe_qos
  ) values(
    v_org,btrim(p_key),btrim(p_name),'mqtt_read','iot',
    'mqtt_wss_subscribe',v_endpoint,p_expected_interval_minutes,v_ref,
    'Bounded MQTT subscribe over TLS WebSockets. No publish, no last will, and no promotion into condition readings or engineering limits. Tested against mocks only until a live broker is certified.',
    'C2.20',case when p_enabled then 'active' else 'configured' end,p_enabled,
    'read_only',false,'none',null,1,p_topic_filters,p_window_seconds,
    p_max_messages,p_subscribe_qos
  )
  on conflict(organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,connector_type='mqtt_read',system_kind='iot',
    connector_profile='mqtt_wss_subscribe',endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,register_ref='C2.20',
    status=excluded.status,enabled=excluded.enabled,direction='read_only',
    write_enabled=false,pagination_mode='none',pagination_next_path=null,
    pagination_max_pages=1,mqtt_topic_filters=excluded.mqtt_topic_filters,
    mqtt_window_seconds=excluded.mqtt_window_seconds,
    mqtt_max_messages=excluded.mqtt_max_messages,
    mqtt_subscribe_qos=excluded.mqtt_subscribe_qos
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'mqtt_read_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      ||' read-only MQTT subscribe for '||btrim(p_key),
    'approved','manual',100,auth.uid()::text,btrim(p_basis),'executed'
  );

  return jsonb_build_object(
    'ok',true,'connector_id',v_id,'enabled',p_enabled,
    'direction','read_only','write_enabled',false,
    'source_profile','mqtt_wss_subscribe',
    'note',case when p_enabled
      then 'Enabled bounded user-triggered MQTT subscribe. Messages are staged evidence only. Silence is not a process state.'
      else 'Saved disabled. Deploy the approved host and username/password binding before enabling.' end
  );
end
$$;

revoke all on function public.configure_mqtt_read_source(
  text,text,text,jsonb,int,int,int,int,text,boolean,text
) from public,anon;
grant execute on function public.configure_mqtt_read_source(
  text,text,text,jsonb,int,int,int,int,text,boolean,text
) to authenticated;

create or replace function public.get_mqtt_read_source(p_connector_key text)
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
  if v_org is null or coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error','MQTT source access denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id=v_org and connector_key=btrim(p_connector_key)
    and connector_type='mqtt_read' and system_kind='iot'
    and connector_profile='mqtt_wss_subscribe' and register_ref='C2.20';
  if not found then return jsonb_build_object('error','governed MQTT source not found'); end if;
  return jsonb_build_object(
    'organization_id',v_org,'connector_key',v_connector.connector_key,
    'enabled',v_connector.enabled,'direction',v_connector.direction,
    'write_enabled',v_connector.write_enabled,
    'source_profile',v_connector.connector_profile,
    'broker_url',v_connector.endpoint_hint,
    'credential_binding_ref',v_connector.credential_binding_ref,
    'topic_filters',v_connector.mqtt_topic_filters,
    'window_seconds',v_connector.mqtt_window_seconds,
    'max_messages',v_connector.mqtt_max_messages,
    'subscribe_qos',v_connector.mqtt_subscribe_qos
  );
end
$$;

revoke all on function public.get_mqtt_read_source(text) from public,anon;
grant execute on function public.get_mqtt_read_source(text) to authenticated;

create or replace function public.begin_mqtt_read_run(
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
  v_started timestamptz;
  v_finished timestamptz;
  v_host text;
  v_run uuid;
  v_from timestamptz;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','MQTT transport attestation is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error','MQTT run actor is not an administrator in this tenant');
  end if;
  select * into v_connector from public.connectors
  where organization_id=p_organization_id and connector_key=btrim(p_connector_key)
    and connector_type='mqtt_read' and system_kind='iot'
    and connector_profile='mqtt_wss_subscribe' and register_ref='C2.20'
    and enabled and direction='read_only' and not write_enabled
  for update;
  if not found then return jsonb_build_object('error','active governed MQTT source not found'); end if;
  if exists(select 1 from public.connector_runs r where r.connector_id=v_connector.id
    and r.organization_id=p_organization_id and r.entity_type='mqtt_message'
    and r.status='running') then
    return jsonb_build_object('error','an MQTT listen is already running for this connector');
  end if;
  if coalesce(jsonb_typeof(p_manifest),'')<>'array'
     or jsonb_array_length(p_manifest)<>1
     or coalesce(jsonb_typeof(p_cursor_to),'')<>'object'
     or coalesce(p_source_bytes,-1)<0 or p_source_bytes>262144 then
    return jsonb_build_object('error','bounded MQTT transport evidence is invalid');
  end if;
  v_item:=p_manifest->0;
  v_host:=lower(substring(v_connector.endpoint_hint from '^wss://([^/:]+)'));
  begin
    v_started:=(p_cursor_to->>'window_started_at')::timestamptz;
    v_finished:=(p_cursor_to->>'window_finished_at')::timestamptz;
  exception when others then
    return jsonb_build_object('error','MQTT listen timestamps are invalid');
  end;
  if not isfinite(v_started) or not isfinite(v_finished)
     or v_finished<=v_started
     or v_finished>now()+interval '5 minutes'
     or v_finished-v_started>make_interval(secs=>v_connector.mqtt_window_seconds+2)
     or coalesce(v_item->>'transport','')<>'mqtt_wss_subscribe'
     or lower(coalesce(v_item->>'broker_host',''))<>v_host
     or v_item->'topic_filters' is distinct from v_connector.mqtt_topic_filters
     or coalesce(v_item->>'subscribe_qos','')<>v_connector.mqtt_subscribe_qos::text
     or coalesce(v_item->>'window_started_at','') is distinct from p_cursor_to->>'window_started_at'
     or coalesce(v_item->>'window_finished_at','') is distinct from p_cursor_to->>'window_finished_at'
     or coalesce(v_item->>'sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_item->>'bytes','')<>p_source_bytes::text
     or coalesce(v_item->>'row_count','')<>coalesce(p_cursor_to->>'message_count','')
     or coalesce(p_cursor_to->>'message_count','') !~ '^[0-9]+$'
     or (p_cursor_to->>'message_count')::int>v_connector.mqtt_max_messages
     or coalesce(p_cursor_to->>'bytes','')<>p_source_bytes::text
     or jsonb_typeof(p_cursor_to->'truncated')<>'boolean'
     or jsonb_typeof(v_item->'truncated')<>'boolean'
     or (p_cursor_to->>'truncated') is distinct from (v_item->>'truncated') then
    return jsonb_build_object('error','MQTT manifest does not match the approved subscribe profile');
  end if;
  select last_position into v_from from public.ingest_watermarks
  where connector_id=v_connector.id and entity_type='mqtt_message';
  if v_from is not null and v_finished<=v_from then
    return jsonb_build_object('error','MQTT listen does not advance the clean connector watermark');
  end if;
  perform set_config('app.mqtt_read_transport','granted',true);
  insert into public.connector_runs(
    organization_id,connector_id,entity_type,run_type,status,started_at,
    watermark_from,watermark_to,triggered_by,transport_manifest,
    transport_cursor_to,source_object_count,source_bytes
  ) values(
    p_organization_id,v_connector.id,'mqtt_message','sync','running',now(),
    v_from,v_finished,p_triggered_by,p_manifest,p_cursor_to,1,p_source_bytes
  ) returning id into v_run;
  return jsonb_build_object('ok',true,'run_id',v_run,'watermark_from',v_from,
    'cursor_to',p_cursor_to);
end
$$;

revoke all on function public.begin_mqtt_read_run(
  uuid,uuid,text,jsonb,jsonb,bigint
) from public,anon,authenticated;
grant execute on function public.begin_mqtt_read_run(
  uuid,uuid,text,jsonb,jsonb,bigint
) to service_role;

create or replace function public.ingest_mqtt_read_batch(
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
  v_ext text;
  v_topic text;
  v_received timestamptz;
  v_filter text;
  v_matched boolean;
  v_read int:=0;
  v_ok int:=0;
  v_rejected int:=0;
  v_reason text;
  v_expected int;
  v_seen text[]:='{}';
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','MQTT ingestion is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error','MQTT ingest actor is not an administrator in this tenant');
  end if;
  select r.* into v_run
  from public.connector_runs r join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id
    and r.triggered_by=p_triggered_by and r.status='running'
    and r.entity_type='mqtt_message' and r.records_read=0
    and c.connector_type='mqtt_read' and c.system_kind='iot'
    and c.connector_profile='mqtt_wss_subscribe' and c.register_ref='C2.20'
    and c.enabled and c.direction='read_only' and not c.write_enabled;
  if not found then return jsonb_build_object('error','running attested MQTT listen not found'); end if;
  select * into v_connector from public.connectors c
  where c.id=v_run.connector_id and c.organization_id=p_organization_id;
  v_expected:=(v_run.transport_cursor_to->>'message_count')::int;
  if coalesce(jsonb_typeof(p_rows),'')<>'array'
     or jsonb_array_length(p_rows)<>v_expected
     or v_expected>v_connector.mqtt_max_messages then
    return jsonb_build_object('error','MQTT messages must exactly reconcile to the attested listen');
  end if;

  perform set_config('app.mqtt_read_ingest','granted',true);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_read:=v_read+1; v_reason:=null; v_ext:=null; v_topic:=null; v_matched:=false;
    if jsonb_typeof(v_row)<>'object'
       or exists(select 1 from jsonb_object_keys(v_row) k
         where k not in ('external_id','topic','payload_text','payload_encoding','qos','retain','received_at')) then
      v_reason:='row contains fields outside the governed MQTT message contract';
    else
      v_ext:=nullif(btrim(v_row->>'external_id'),'');
      v_topic:=nullif(btrim(v_row->>'topic'),'');
      if v_ext is null or v_ext !~ '^[0-9a-f]{64}$' or v_topic is null
         or length(v_topic)>256 or v_topic ~ '[^A-Za-z0-9_./-]'
         or coalesce(v_row->>'payload_encoding','') not in ('utf8','base64')
         or jsonb_typeof(v_row->'payload_text')<>'string'
         or length(v_row->>'payload_text')>12000
         or coalesce(v_row->>'qos','') not in ('0','1','2')
         or (v_row ? 'retain' and jsonb_typeof(v_row->'retain')<>'boolean') then
        v_reason:='topic, payload, encoding, QoS, and external identity are required';
      else
        begin
          v_received:=(v_row->>'received_at')::timestamptz;
          if not isfinite(v_received)
             or v_received<v_run.watermark_to - make_interval(secs=>v_connector.mqtt_window_seconds+2)
             or v_received>v_run.watermark_to then
            v_reason:='received timestamp is outside the attested listen window';
          end if;
        exception when others then
          v_reason:='received timestamp is invalid';
        end;
      end if;
    end if;
    if v_reason is null then
      for v_filter in select value #>> '{}' from jsonb_array_elements(v_connector.mqtt_topic_filters) loop
        if public.mqtt_topic_matches_filter(v_topic,v_filter) then v_matched:=true; end if;
      end loop;
      if not v_matched then
        v_reason:='topic is outside the approved MQTT filters';
      end if;
    end if;
    if v_reason is null and v_ext=any(v_seen) then
      v_reason:='MQTT listen repeats a message identity';
    elsif v_reason is null then
      v_seen:=v_seen||v_ext;
    end if;
    if v_reason is not null then
      v_rejected:=v_rejected+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status,reject_reason
      ) values(
        p_organization_id,v_connector.id,p_run_id,'mqtt_message',v_ext,v_row,'rejected',v_reason
      );
      continue;
    end if;
    v_ok:=v_ok+1;
    insert into public.ingest_staging(
      organization_id,connector_id,run_id,entity_type,external_id,payload,status
    ) values(
      p_organization_id,v_connector.id,p_run_id,'mqtt_message',v_ext,v_row,'accepted'
    );
  end loop;
  update public.connector_runs set records_read=v_read,records_accepted=v_ok,
    records_rejected=v_rejected,records_duplicate=0
  where id=p_run_id and organization_id=p_organization_id;
  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,new_state
  ) values(
    p_organization_id,'mqtt_read',v_role,
    jsonb_build_object('action','ingest_listen','runId',p_run_id,
      'connectorKey',v_connector.connector_key,'actorId',p_triggered_by,
      'sourceWriteBack',false,'publish',false),
    jsonb_build_object('read',v_read,'accepted',v_ok,'rejected',v_rejected,
      'promotedToConditionReadings',false)
  );
  return jsonb_build_object('read',v_read,'accepted',v_ok,'rejected',v_rejected);
end
$$;

revoke all on function public.ingest_mqtt_read_batch(
  uuid,uuid,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.ingest_mqtt_read_batch(
  uuid,uuid,uuid,jsonb
) to service_role;

create or replace function public.enforce_mqtt_read_run_attestation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if exists(select 1 from public.connectors c where c.id=new.connector_id
    and c.connector_type='mqtt_read' and c.system_kind='iot'
    and c.connector_profile='mqtt_wss_subscribe' and c.register_ref='C2.20') then
    if tg_op='INSERT'
       and coalesce(current_setting('app.mqtt_read_transport',true),'')<>'granted' then
      raise exception 'governed MQTT runs require service-attested subscribe evidence';
    end if;
    if tg_op='UPDATE'
       and coalesce(current_setting('app.mqtt_read_ingest',true),'')<>'granted'
       and coalesce(current_setting('app.mqtt_read_finish',true),'')<>'granted' then
      raise exception 'governed MQTT runs require service-only ingest or finish';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_mqtt_read_run_attestation on public.connector_runs;
create trigger trg_mqtt_read_run_attestation
before insert or update on public.connector_runs
for each row execute function public.enforce_mqtt_read_run_attestation();

create or replace function public.finish_mqtt_read_run(
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
  v_expected int;
  v_rows int:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','MQTT finish is service-only');
  end if;
  if p_status not in ('success','partial','failed') then
    return jsonb_build_object('error','MQTT status must be success, partial or failed');
  end if;
  select r.* into v_run from public.connector_runs r join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id and r.status='running'
    and c.connector_type='mqtt_read' and c.system_kind='iot'
    and c.connector_profile='mqtt_wss_subscribe' and c.register_ref='C2.20';
  if not found then return jsonb_build_object('error','running governed MQTT listen not found'); end if;
  v_expected:=(v_run.transport_cursor_to->>'message_count')::int;
  if p_status in ('success','partial') and v_run.records_read<>v_expected then
    return jsonb_build_object('error','MQTT run messages do not reconcile to the attested listen');
  end if;
  if p_status='success' and v_run.records_rejected>0 then
    return jsonb_build_object('error','an MQTT listen with rejected messages cannot finish as success');
  end if;
  v_clean:=p_status='success' and v_run.records_rejected=0
    and v_run.transport_manifest is not null and v_run.transport_cursor_to is not null;
  perform set_config('app.mqtt_read_finish','granted',true);
  update public.connector_runs set status=p_status,finished_at=now(),
    records_processed=records_accepted,
    error_message=case when p_error is null then null else left(p_error,500) end
  where id=p_run_id and organization_id=p_organization_id;
  if v_clean then
    insert into public.ingest_watermarks(
      organization_id,connector_id,entity_type,last_position,last_cursor,last_run_id,updated_at
    ) values(
      p_organization_id,v_run.connector_id,'mqtt_message',v_run.watermark_to,
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
    'records_rejected',v_run.records_rejected);
end
$$;

revoke all on function public.finish_mqtt_read_run(
  uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.finish_mqtt_read_run(
  uuid,uuid,text,text
) to service_role;

notify pgrst,'reload schema';

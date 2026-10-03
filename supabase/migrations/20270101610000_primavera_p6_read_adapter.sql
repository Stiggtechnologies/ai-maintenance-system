-- C2.16 — governed Oracle Primavera P6 EPPM schedule read adapter.
--
-- This extends the ONE canonical connector/run/staging/watermark contract and
-- the ONE schedule graph (shutdown_events, shutdown_tasks and
-- shutdown_task_dependencies). P6 remains system of record. The adapter is
-- GET-only, user-triggered, service-attested and incapable of source write-back.

alter table public.connectors
  add column if not exists scheduling_project_object_id bigint,
  add column if not exists scheduling_case_id uuid
    references public.development_cases(id) on delete set null,
  add column if not exists scheduling_schedule_name text,
  add column if not exists scheduling_duration_to_hours numeric,
  add column if not exists scheduling_max_activities int,
  add column if not exists scheduling_max_relationships int;

alter table public.connectors
  drop constraint if exists connectors_scheduling_read_profile_check;
alter table public.connectors
  add constraint connectors_scheduling_read_profile_check check (
    connector_type is distinct from 'scheduling_read'
    or (
      system_kind='scheduling'
      and connector_profile='primavera_p6_eppm'
      and scheduling_project_object_id>0
      and scheduling_case_id is not null
      and length(trim(scheduling_schedule_name)) between 3 and 200
      and scheduling_duration_to_hours is not null
      and scheduling_duration_to_hours<>'NaN'::numeric
      and scheduling_duration_to_hours>'0'::numeric
      and scheduling_duration_to_hours<'Infinity'::numeric
      and scheduling_max_activities between 1 and 5000
      and scheduling_max_relationships between 1 and 20000
      and direction='read_only'
      and not write_enabled
    )
  );

comment on column public.connectors.scheduling_project_object_id is
  'Administrator-approved Oracle P6 ProjectObjectId. The request body cannot select or widen project scope.';
comment on column public.connectors.scheduling_case_id is
  'Same-tenant canonical development case receiving this analysis copy of the P6 schedule.';
comment on column public.connectors.scheduling_duration_to_hours is
  'Human-approved multiplier from the deployed P6 REST duration unit to canonical hours. SyncAI never guesses calendar conversion.';
comment on column public.connectors.scheduling_max_activities is
  'Hard maximum P6 activity rows in one complete project snapshot (1..5000).';
comment on column public.connectors.scheduling_max_relationships is
  'Hard maximum predecessor relationships in one complete project snapshot (1..20000).';

create or replace function public.configure_p6_schedule_read_source(
  p_key text,
  p_name text,
  p_base_url text,
  p_project_object_id bigint,
  p_development_case_id uuid,
  p_schedule_name text,
  p_duration_to_hours numeric,
  p_max_activities int,
  p_max_relationships int,
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
  v_endpoint text:=nullif(trim(coalesce(p_base_url,'')),'');
  v_ref text:=nullif(trim(coalesce(p_credential_binding_ref,'')),'');
  v_schedule text:=trim(coalesce(p_schedule_name,''));
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in ('admin','ai_admin') then
    return jsonb_build_object('error','configuring a P6 schedule source requires an administrator');
  end if;
  if coalesce(length(trim(p_key)),0)<3 or coalesce(length(trim(p_name)),0)<3 then
    return jsonb_build_object('error','connector key and name are required');
  end if;
  if coalesce(length(trim(p_basis)),0)<20 then
    return jsonb_build_object('error','record a substantive P6 activation and duration-conversion basis');
  end if;
  if not exists(
    select 1 from public.development_cases c
    where c.id=p_development_case_id and c.organization_id=v_org
  ) then
    return jsonb_build_object('error','the configured development case is outside the active tenant or does not exist');
  end if;
  if coalesce(p_project_object_id,0)<=0 then
    return jsonb_build_object('error','P6 ProjectObjectId must be a positive integer');
  end if;
  if length(v_schedule) not between 3 and 200 then
    return jsonb_build_object('error','a schedule name between 3 and 200 characters is required');
  end if;
  if p_duration_to_hours is null
     or p_duration_to_hours='NaN'::numeric
     or p_duration_to_hours<='0'::numeric
     or p_duration_to_hours>='Infinity'::numeric then
    return jsonb_build_object('error','duration-to-hours multiplier must be a finite positive number approved from the deployed P6 unit setting');
  end if;
  if coalesce(p_max_activities,0) not between 1 and 5000 then
    return jsonb_build_object('error','maximum activities must be between 1 and 5000');
  end if;
  if coalesce(p_max_relationships,0) not between 1 and 20000 then
    return jsonb_build_object('error','maximum relationships must be between 1 and 20000');
  end if;
  if coalesce(p_expected_interval_minutes,0)<1 then
    return jsonb_build_object('error','expected interval must be at least one minute');
  end if;
  if v_endpoint is null
     or v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]?#]*)?$'
     or v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)' then
    return jsonb_build_object('error','P6 base URL must be a credential-free public HTTPS URL without query or fragment; private/local targets are blocked');
  end if;
  if v_ref is null
     or v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$'
     or v_ref ~ '[@?=#]' then
    return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value, query or fragment');
  end if;
  if exists(
    select 1 from public.connectors
    where organization_id=v_org and connector_key=trim(p_key)
      and connector_type is distinct from 'scheduling_read'
  ) then
    return jsonb_build_object('error','connector key already belongs to another governed integration contract');
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,
    connector_profile,endpoint_hint,expected_interval_minutes,
    credential_binding_ref,contract_note,register_ref,status,enabled,
    direction,write_enabled,scheduling_project_object_id,scheduling_case_id,
    scheduling_schedule_name,scheduling_duration_to_hours,
    scheduling_max_activities,scheduling_max_relationships
  ) values(
    v_org,trim(p_key),trim(p_name),'scheduling_read','scheduling',
    'primavera_p6_eppm',v_endpoint,p_expected_interval_minutes,v_ref,
    'Bounded Oracle P6 EPPM REST GET of one approved project. P6 remains system of record; no write-back, schedule mutation or autonomous release.',
    'C2.16',case when p_enabled then 'active' else 'configured' end,p_enabled,
    'read_only',false,p_project_object_id,p_development_case_id,v_schedule,
    p_duration_to_hours,p_max_activities,p_max_relationships
  )
  on conflict(organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,connector_type='scheduling_read',system_kind='scheduling',
    connector_profile='primavera_p6_eppm',endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,register_ref='C2.16',
    status=excluded.status,enabled=excluded.enabled,direction='read_only',
    write_enabled=false,
    scheduling_project_object_id=excluded.scheduling_project_object_id,
    scheduling_case_id=excluded.scheduling_case_id,
    scheduling_schedule_name=excluded.scheduling_schedule_name,
    scheduling_duration_to_hours=excluded.scheduling_duration_to_hours,
    scheduling_max_activities=excluded.scheduling_max_activities,
    scheduling_max_relationships=excluded.scheduling_max_relationships
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'p6_schedule_read_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      ||' read-only P6 project '||p_project_object_id||' as '||v_schedule,
    'approved','manual',100,auth.uid()::text,trim(p_basis),'executed'
  );

  return jsonb_build_object(
    'ok',true,'connector_id',v_id,'enabled',p_enabled,
    'direction','read_only','write_enabled',false,
    'source_profile','primavera_p6_eppm',
    'project_object_id',p_project_object_id,
    'development_case_id',p_development_case_id,
    'duration_to_hours',p_duration_to_hours,
    'note',case when p_enabled
      then 'Enabled bounded user-triggered P6 reads. The source stays read-only and changed replays still require human revision review.'
      else 'Saved disabled. Deploy the approved host and opaque OAuth binding before enabling.' end
  );
end
$$;

revoke all on function public.configure_p6_schedule_read_source(
  text,text,text,bigint,uuid,text,numeric,int,int,int,text,boolean,text
) from public,anon;
grant execute on function public.configure_p6_schedule_read_source(
  text,text,text,bigint,uuid,text,numeric,int,int,int,text,boolean,text
) to authenticated;

create or replace function public.get_p6_schedule_read_source(p_connector_key text)
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
    ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error','P6 schedule source access denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id=v_org and connector_key=trim(p_connector_key)
    and connector_type='scheduling_read' and system_kind='scheduling'
    and connector_profile='primavera_p6_eppm' and register_ref='C2.16';
  if not found then return jsonb_build_object('error','governed P6 schedule source not found'); end if;
  if not exists(
    select 1 from public.development_cases c
    where c.id=v_connector.scheduling_case_id and c.organization_id=v_org
  ) then
    return jsonb_build_object('error','configured P6 development case is no longer available in this tenant');
  end if;
  return jsonb_build_object(
    'organization_id',v_org,'connector_key',v_connector.connector_key,
    'enabled',v_connector.enabled,'direction',v_connector.direction,
    'write_enabled',v_connector.write_enabled,
    'source_profile',v_connector.connector_profile,
    'base_url',v_connector.endpoint_hint,
    'credential_binding_ref',v_connector.credential_binding_ref,
    'project_object_id',v_connector.scheduling_project_object_id,
    'development_case_id',v_connector.scheduling_case_id,
    'schedule_name',v_connector.scheduling_schedule_name,
    'duration_to_hours',v_connector.scheduling_duration_to_hours,
    'max_activities',v_connector.scheduling_max_activities,
    'max_relationships',v_connector.scheduling_max_relationships
  );
end
$$;

revoke all on function public.get_p6_schedule_read_source(text) from public,anon;
grant execute on function public.get_p6_schedule_read_source(text) to authenticated;

-- The Edge transport opens a run only after both bounded Oracle responses are
-- downloaded, parsed and hashed. End users cannot mint this attestation.
create or replace function public.begin_p6_schedule_read_run(
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
  v_resources text[]:='{}';
  v_bytes bigint:=0;
  v_run uuid;
  v_from timestamptz;
  v_observed_at timestamptz;
  v_activity_sha text;
  v_relationship_sha text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    return jsonb_build_object('error','P6 transport attestation is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error','P6 run actor is not authorized for this tenant');
  end if;
  select * into v_connector from public.connectors
  where organization_id=p_organization_id and connector_key=trim(p_connector_key)
    and connector_type='scheduling_read' and system_kind='scheduling'
    and connector_profile='primavera_p6_eppm' and register_ref='C2.16'
    and enabled and direction='read_only' and not write_enabled
  for update;
  if not found then return jsonb_build_object('error','active governed P6 schedule source not found'); end if;
  if exists(
    select 1 from public.connector_runs r
    where r.connector_id=v_connector.id and r.organization_id=p_organization_id
      and r.entity_type='schedule_activity' and r.status='running'
  ) then
    return jsonb_build_object('error','a P6 schedule pull is already running for this connector');
  end if;
  if coalesce(jsonb_typeof(p_manifest),'')<>'array'
     or jsonb_array_length(p_manifest)<>2
     or coalesce(jsonb_typeof(p_cursor_to),'')<>'object'
     or coalesce(p_cursor_to->>'fetched_at','')=''
     or coalesce(p_source_bytes,0)<=0 or p_source_bytes>26214400 then
    return jsonb_build_object('error','bounded P6 transport evidence is invalid');
  end if;
  begin
    v_observed_at:=(p_cursor_to->>'fetched_at')::timestamptz;
  exception when others then
    return jsonb_build_object('error','P6 transport timestamp is invalid');
  end;
  if not isfinite(v_observed_at) or v_observed_at>now()+interval '5 minutes' then
    return jsonb_build_object('error','P6 transport timestamp is not a finite current observation');
  end if;
  for v_item in select value from jsonb_array_elements(p_manifest) loop
    if jsonb_typeof(v_item)<>'object'
       or coalesce(v_item->>'transport','')<>'oracle_p6_eppm_rest'
       or coalesce(v_item->>'resource','') not in ('activity','relationship')
       or coalesce(v_item->>'project_object_id','')<>v_connector.scheduling_project_object_id::text
       or coalesce(v_item->>'sha256','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_item->>'bytes','') !~ '^[0-9]+$'
       or coalesce(v_item->>'row_count','') !~ '^[0-9]+$' then
      return jsonb_build_object('error','P6 manifest is missing bounded source-response provenance');
    end if;
    if (v_item->>'bytes')::bigint<=0 then
      return jsonb_build_object('error','P6 manifest source responses must contain bytes');
    end if;
    if v_item->>'resource'=any(v_resources) then
      return jsonb_build_object('error','P6 manifest repeats a source resource');
    end if;
    v_resources:=v_resources||(v_item->>'resource');
    v_bytes:=v_bytes+(v_item->>'bytes')::bigint;
    if v_item->>'resource'='activity' then
      v_activity_sha:=v_item->>'sha256';
      if (v_item->>'row_count')::bigint<1
         or (v_item->>'row_count')::bigint>v_connector.scheduling_max_activities then
        return jsonb_build_object('error','P6 activity response must be non-empty and within the approved row limit');
      end if;
    end if;
    if v_item->>'resource'='relationship' then
      v_relationship_sha:=v_item->>'sha256';
      if (v_item->>'row_count')::bigint>v_connector.scheduling_max_relationships then
        return jsonb_build_object('error','P6 relationship response exceeds the approved row limit');
      end if;
    end if;
  end loop;
  if not ('activity'=any(v_resources) and 'relationship'=any(v_resources))
     or v_bytes<>p_source_bytes
     or coalesce(p_cursor_to->>'activity_sha256','')<>coalesce(v_activity_sha,'')
     or coalesce(p_cursor_to->>'relationship_sha256','')<>coalesce(v_relationship_sha,'') then
    return jsonb_build_object('error','P6 manifest does not match both complete transported responses');
  end if;

  select last_position into v_from from public.ingest_watermarks
  where connector_id=v_connector.id and entity_type='schedule_activity';
  if v_from is not null and v_observed_at<=v_from then
    return jsonb_build_object('error','P6 observation timestamp does not advance the clean connector watermark');
  end if;
  perform set_config('app.p6_read_transport','granted',true);
  insert into public.connector_runs(
    organization_id,connector_id,entity_type,run_type,status,started_at,
    watermark_from,watermark_to,triggered_by,transport_manifest,
    transport_cursor_to,source_object_count,source_bytes
  ) values(
    p_organization_id,v_connector.id,'schedule_activity','sync','running',now(),
    v_from,v_observed_at,p_triggered_by,p_manifest,
    p_cursor_to,2,p_source_bytes
  ) returning id into v_run;
  return jsonb_build_object('ok',true,'run_id',v_run,'watermark_from',v_from,
    'cursor_to',p_cursor_to);
end
$$;

revoke all on function public.begin_p6_schedule_read_run(
  uuid,uuid,text,jsonb,jsonb,bigint
) from public,anon,authenticated;
grant execute on function public.begin_p6_schedule_read_run(
  uuid,uuid,text,jsonb,jsonb,bigint
) to service_role;

-- Service-only wrapper reuses the canonical schedule importer. The local JWT
-- context names the already-verified human actor so app_current_org, tenant
-- entitlement, the verified session AAL, MFA policy and the existing
-- provenance triggers stay in force. The service wrapper must never upgrade
-- a human's assurance level.
create or replace function public.ingest_p6_schedule_read_batch(
  p_organization_id uuid,
  p_triggered_by uuid,
  p_run_id uuid,
  p_actor_aal text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare
  v_connector public.connectors%rowtype;
  v_role text;
  v_result jsonb;
  v_manifest jsonb;
  v_already_read int;
  v_expected_rows int;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    return jsonb_build_object('error','P6 schedule ingestion is service-only');
  end if;
  if coalesce(p_actor_aal,'') not in ('aal1','aal2') then
    return jsonb_build_object('error','P6 ingest requires the verified human session assurance level');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error','P6 ingest actor is not authorized for this tenant');
  end if;
  select c.* into v_connector
  from public.connector_runs r
  join public.connectors c on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id
    and r.triggered_by=p_triggered_by and r.status='running'
    and r.entity_type='schedule_activity'
    and c.connector_type='scheduling_read' and c.system_kind='scheduling'
    and c.connector_profile='primavera_p6_eppm' and c.register_ref='C2.16'
    and c.enabled and c.direction='read_only' and not c.write_enabled;
  if not found then return jsonb_build_object('error','running attested P6 schedule run not found'); end if;
  select r.transport_manifest,r.records_read
    into v_manifest,v_already_read
  from public.connector_runs r
  where r.id=p_run_id and r.organization_id=p_organization_id;
  select (item->>'row_count')::int into v_expected_rows
  from jsonb_array_elements(v_manifest) item
  where item->>'resource'='activity';
  if coalesce(jsonb_typeof(p_rows),'')<>'array'
     or jsonb_array_length(p_rows)<1
     or jsonb_array_length(p_rows)>v_connector.scheduling_max_activities
     or jsonb_array_length(p_rows)<>coalesce(v_expected_rows,-1) then
    return jsonb_build_object('error','P6 schedule rows must exactly reconcile to the attested complete activity response');
  end if;
  if coalesce(v_already_read,0)<>0 then
    return jsonb_build_object('error','an attested P6 project snapshot is ingested exactly once');
  end if;
  perform set_config('request.jwt.claim.sub',p_triggered_by::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.aal',p_actor_aal,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_triggered_by,'role','authenticated','aal',p_actor_aal
  )::text,true);
  perform set_config('app.p6_read_ingest','granted',true);
  v_result:=public.ingest_schedule_batch(p_run_id,p_rows);
  return v_result;
end
$$;

revoke all on function public.ingest_p6_schedule_read_batch(
  uuid,uuid,uuid,text,jsonb
) from public,anon,authenticated;
grant execute on function public.ingest_p6_schedule_read_batch(
  uuid,uuid,uuid,text,jsonb
) to service_role;

create or replace function public.enforce_p6_schedule_run_attestation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if exists(
    select 1 from public.connectors c where c.id=new.connector_id
      and c.connector_type='scheduling_read' and c.system_kind='scheduling'
      and c.connector_profile='primavera_p6_eppm' and c.register_ref='C2.16'
  ) then
    if tg_op='INSERT'
       and coalesce(current_setting('app.p6_read_transport',true),'')<>'granted' then
      raise exception 'governed P6 runs require service-attested complete transport evidence';
    end if;
    if tg_op='UPDATE'
       and coalesce(current_setting('app.p6_read_ingest',true),'')<>'granted'
       and coalesce(current_setting('app.p6_read_finish',true),'')<>'granted' then
      raise exception 'governed P6 runs require service-only ingest or finish';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_p6_schedule_run_attestation on public.connector_runs;
create trigger trg_p6_schedule_run_attestation
before insert or update on public.connector_runs
for each row execute function public.enforce_p6_schedule_run_attestation();

create or replace function public.finish_p6_schedule_read_run(
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
  v_expected_rows int;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    return jsonb_build_object('error','P6 schedule finish is service-only');
  end if;
  if p_status not in ('success','partial','failed') then
    return jsonb_build_object('error','P6 run status must be success, partial or failed');
  end if;
  select r.* into v_run from public.connector_runs r
  join public.connectors c on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id and r.status='running'
    and c.connector_type='scheduling_read' and c.system_kind='scheduling'
    and c.connector_profile='primavera_p6_eppm' and c.register_ref='C2.16';
  if not found then return jsonb_build_object('error','running governed P6 schedule run not found'); end if;
  select (item->>'row_count')::int into v_expected_rows
  from jsonb_array_elements(v_run.transport_manifest) item
  where item->>'resource'='activity';
  if p_status in ('success','partial')
     and v_run.records_read<>coalesce(v_expected_rows,-1) then
    return jsonb_build_object('error','P6 run row counts do not reconcile to the attested activity response');
  end if;
  if p_status='success' and v_run.records_rejected>0 then
    return jsonb_build_object('error','a P6 run with rejected rows cannot be finished as success');
  end if;
  v_clean:=p_status='success' and v_run.records_rejected=0
    and v_run.transport_manifest is not null and v_run.transport_cursor_to is not null;
  perform set_config('app.p6_read_finish','granted',true);
  update public.connector_runs set
    status=p_status,finished_at=now(),records_processed=records_accepted,
    error_message=case when p_error is null then null else left(p_error,500) end
  where id=p_run_id and organization_id=p_organization_id;
  if v_clean then
    insert into public.ingest_watermarks(
      organization_id,connector_id,entity_type,last_position,last_cursor,last_run_id,updated_at
    ) values(
      p_organization_id,v_run.connector_id,'schedule_activity',
      v_run.watermark_to,v_run.transport_cursor_to,p_run_id,now()
    ) on conflict(connector_id,entity_type) do update set
      last_position=greatest(public.ingest_watermarks.last_position,excluded.last_position),
      last_cursor=excluded.last_cursor,last_run_id=excluded.last_run_id,updated_at=now();
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

revoke all on function public.finish_p6_schedule_read_run(
  uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.finish_p6_schedule_read_run(
  uuid,uuid,text,text
) to service_role;

-- Reuse the one schedule-revision workflow for changed read-adapter snapshots.
-- The existing function admitted only manual_upload runs; replacing it here
-- changes only that source gate. Its tenant, role, digest, audit and named-human
-- approval boundaries remain the canonical implementation.
create or replace function public.propose_schedule_import_revision(p_run_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_source text;
  v_source_name text;
  v_run_status text;
  v_existing public.schedule_import_revisions%rowtype;
  s record;
  t public.shutdown_tasks%rowtype;
  v_case uuid;
  v_case_ids uuid[];
  v_schedule text;
  v_event uuid;
  v_fields jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_new_relationships jsonb;
  v_old_relationships jsonb;
  v_label text;
  v_wbs text;
  v_duration numeric;
  v_start timestamptz;
  v_finish timestamptz;
  v_calendar text;
  v_float numeric;
  v_constraint text;
  v_constraint_date timestamptz;
  v_revision uuid;
  v_digest text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'maintenance_manager', 'reliability_engineer', 'planner', 'ai_admin') then
    return jsonb_build_object('error',
      'reviewing imported schedule evidence requires a planning, engineering or governance role');
  end if;

  select cr.status, c.connector_key, c.name
    into v_run_status, v_source, v_source_name
  from public.connector_runs cr
  join public.connectors c on c.id = cr.connector_id
  where cr.id = p_run_id
    and cr.organization_id = v_org
    and cr.entity_type = 'schedule_activity'
    and c.connector_type in ('manual_upload','scheduling_read');
  if not found then
    return jsonb_build_object('error', 'completed schedule import run not found');
  end if;
  if v_run_status <> 'success' then
    return jsonb_build_object('error',
      format('schedule import run is %s; a changed schedule is reviewable only after every row passes. Fix refused rows and re-import before proposing a revision.', v_run_status));
  end if;

  select * into v_existing
  from public.schedule_import_revisions r
  where r.organization_id = v_org and r.connector_run_id = p_run_id;
  if found then
    return jsonb_build_object(
      'answered', true,
      'revisionId', v_existing.id,
      'status', v_existing.status,
      'changeCount', jsonb_array_length(v_existing.change_set),
      'changes', v_existing.change_set,
      'note', 'This import run already has a revision record; it is returned rather than duplicated.'
    );
  end if;

  for s in
    select st.id, st.external_id, st.payload
    from public.ingest_staging st
    where st.organization_id = v_org
      and st.run_id = p_run_id
      and st.entity_type = 'schedule_activity'
      and st.status = 'duplicate'
    order by st.id
  loop
    v_case := null;
    if nullif(btrim(s.payload->>'development_case_id'), '') is not null then
      begin
        v_case := (btrim(s.payload->>'development_case_id'))::uuid;
      exception when others then
        v_case := null;
      end;
    else
      select array_agg(c.id) into v_case_ids
      from public.development_cases c
      where c.organization_id = v_org
        and c.title = btrim(s.payload->>'case_title');
      if coalesce(array_length(v_case_ids, 1), 0) = 1 then
        v_case := v_case_ids[1];
      else
        v_case := null;
      end if;
    end if;
    if v_case is null then continue; end if;

    v_schedule := coalesce(nullif(btrim(s.payload->>'schedule_name'), ''), 'P6 import');
    select e.id into v_event
    from public.shutdown_events e
    where e.organization_id = v_org
      and e.development_case_id = v_case
      and e.event_key = 'develop:' || v_case::text || ':' || lower(v_schedule);
    if v_event is null then continue; end if;

    select * into t from public.shutdown_tasks x
    where x.event_id = v_event
      and x.source_system = v_source
      and x.external_id = s.external_id;
    if not found or t.origin <> 'imported' then continue; end if;

    begin
      v_label := nullif(btrim(s.payload->>'description'), '');
      v_wbs := nullif(btrim(s.payload->>'wbs_path'), '');
      v_duration := nullif(btrim(s.payload->>'original_duration_hours'), '')::numeric;
      v_start := nullif(btrim(s.payload->>'planned_start'), '')::timestamptz;
      v_finish := nullif(btrim(s.payload->>'planned_finish'), '')::timestamptz;
      v_calendar := nullif(btrim(s.payload->>'calendar'), '');
      v_float := nullif(btrim(s.payload->>'total_float_hours'), '')::numeric;
      v_constraint := nullif(btrim(s.payload->>'constraint_type'), '');
      v_constraint_date := nullif(btrim(s.payload->>'constraint_date'), '')::timestamptz;
    exception when others then
      continue;
    end;

    if jsonb_typeof(s.payload->'relationships') = 'array' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'predecessor', r->>'predecessor',
        'link_type', nullif(upper(btrim(r->>'link_type')), ''),
        'lag_hours', nullif(btrim(r->>'lag_hours'), '')::numeric
      ) order by r->>'predecessor'), '[]'::jsonb)
      into v_new_relationships
      from jsonb_array_elements(s.payload->'relationships') r;
    else
      select coalesce(jsonb_agg(jsonb_build_object(
        'predecessor', token, 'link_type', null, 'lag_hours', null
      ) order by token), '[]'::jsonb)
      into v_new_relationships
      from (
        select distinct nullif(btrim(value), '') as token
        from regexp_split_to_table(coalesce(s.payload->>'predecessors', ''), '[,;]') value
      ) q where token is not null;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'predecessor', d.predecessor_key,
      'link_type', d.link_type,
      'lag_hours', d.lag_hours
    ) order by d.predecessor_key), '[]'::jsonb)
    into v_old_relationships
    from public.shutdown_task_dependencies d
    where d.event_id = t.event_id and d.task_key = t.task_key;

    v_fields := '{}'::jsonb;
    if v_label is distinct from t.label then
      v_fields := v_fields || jsonb_build_object('label', jsonb_build_object('from', t.label, 'to', v_label));
    end if;
    if v_duration is distinct from t.duration_hours then
      v_fields := v_fields || jsonb_build_object('durationHours', jsonb_build_object('from', t.duration_hours, 'to', v_duration));
    end if;
    if v_start is distinct from t.planned_start then
      v_fields := v_fields || jsonb_build_object('plannedStart', jsonb_build_object('from', t.planned_start, 'to', v_start));
    end if;
    if v_finish is distinct from t.planned_finish then
      v_fields := v_fields || jsonb_build_object('plannedFinish', jsonb_build_object('from', t.planned_finish, 'to', v_finish));
    end if;
    if v_calendar is distinct from t.calendar_name then
      v_fields := v_fields || jsonb_build_object('calendarName', jsonb_build_object('from', t.calendar_name, 'to', v_calendar));
    end if;
    if v_wbs is distinct from t.wbs_path then
      v_fields := v_fields || jsonb_build_object('wbsPath', jsonb_build_object('from', t.wbs_path, 'to', v_wbs));
    end if;
    if v_float is distinct from t.total_float_hours then
      v_fields := v_fields || jsonb_build_object('totalFloatHours', jsonb_build_object('from', t.total_float_hours, 'to', v_float));
    end if;
    if v_constraint is distinct from t.constraint_type then
      v_fields := v_fields || jsonb_build_object('constraintType', jsonb_build_object('from', t.constraint_type, 'to', v_constraint));
    end if;
    if v_constraint_date is distinct from t.constraint_date then
      v_fields := v_fields || jsonb_build_object('constraintDate', jsonb_build_object('from', t.constraint_date, 'to', v_constraint_date));
    end if;
    if v_new_relationships is distinct from v_old_relationships then
      v_fields := v_fields || jsonb_build_object('relationships', jsonb_build_object('from', v_old_relationships, 'to', v_new_relationships));
    end if;

    if v_fields <> '{}'::jsonb then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'taskId', t.id,
        'eventId', t.event_id,
        'caseId', v_case,
        'activityKey', t.task_key,
        'fields', v_fields,
        'stagingRowId', s.id
      ));
    end if;
  end loop;

  if jsonb_array_length(v_changes) = 0 then
    return jsonb_build_object(
      'answered', false,
      'refusal', 'No changed duplicate activity was found in this run. Identical replays remain ordinary duplicates and do not create revision noise.'
    );
  end if;

  v_digest := public.sync_schedule_revision_digest(v_changes);
  v_revision := gen_random_uuid();
  perform set_config('app.schedule_revision_write', 'granted', true);
  insert into public.schedule_import_revisions
    (id, organization_id, connector_run_id, source_name, change_set,
     before_digest, proposed_by)
  values
    (v_revision, v_org, p_run_id, v_source_name, v_changes,
     v_digest, auth.uid());
  perform set_config('app.schedule_revision_write', '', true);

  insert into public.audit_events
    (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values
    (v_org, 'schedule_import_revision', coalesce(v_role, 'system'),
     jsonb_build_object('revisionId', v_revision, 'runId', p_run_id, 'act', 'propose'),
     null,
     jsonb_build_object('status', 'pending', 'changeCount', jsonb_array_length(v_changes),
       'beforeDigest', v_digest));

  return jsonb_build_object(
    'answered', true,
    'revisionId', v_revision,
    'status', 'pending',
    'changeCount', jsonb_array_length(v_changes),
    'changes', v_changes,
    'note', 'Changed P6 rows were retained as a pending revision. Nothing has overwritten the canonical schedule; a named human must accept or reject the change set.'
  );
end
$$;

revoke all on function public.propose_schedule_import_revision(uuid)
  from public, anon, service_role;
grant execute on function public.propose_schedule_import_revision(uuid)
  to authenticated;

notify pgrst, 'reload schema';

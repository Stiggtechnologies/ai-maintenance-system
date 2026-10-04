-- C2.05: governed customer sensor registry for the canonical condition stack.
--
-- Canonical reuse only:
--   * sensors remains the measurement-point identity and current-state store;
--   * condition_readings remains the one time-series store;
--   * condition_monitoring_agent_packs remains the immutable diagnostic report;
--   * instrument_calibrations remains the calibration evidence store; and
--   * audit_events remains the operating trace.
--
-- This migration does not invent limits or grant operational authority. A
-- named tenant human records configuration and basis; condition evidence and
-- diagnostic packs remain advisory inputs to governed maintenance decisions.

alter table public.sensors
  add column if not exists sensor_tag text,
  add column if not exists registry_status text not null default 'active',
  add column if not exists configuration_version integer not null default 1,
  add column if not exists configuration_basis text,
  add column if not exists configured_by uuid references auth.users(id),
  add column if not exists configured_at timestamptz,
  add column if not exists decommissioned_by uuid references auth.users(id),
  add column if not exists decommissioned_at timestamptz,
  add column if not exists decommission_reason text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.sensors'::regclass
      and conname='sensors_registry_status_check'
  ) then
    alter table public.sensors add constraint sensors_registry_status_check
      check (registry_status in ('active','inactive','decommissioned'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.sensors'::regclass
      and conname='sensors_configuration_version_check'
  ) then
    alter table public.sensors add constraint sensors_configuration_version_check
      check (configuration_version > 0);
  end if;
end $$;

do $dedupe$
begin
  if exists (
    select 1 from public.sensors
    where sensor_tag is not null and btrim(sensor_tag) <> ''
    group by organization_id, lower(btrim(sensor_tag)) having count(*) > 1
  ) then
    raise exception 'sensors contains duplicate tenant sensor tags; reconcile them before enabling the governed registry'
      using errcode='check_violation';
  end if;
end
$dedupe$;

create unique index if not exists idx_sensors_org_tag
  on public.sensors(organization_id, lower(btrim(sensor_tag)))
  where sensor_tag is not null and btrim(sensor_tag) <> '';

create table if not exists public.sensor_configuration_revisions (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sensor_id uuid not null references public.sensors(id) on delete restrict,
  version integer not null check (version > 0),
  action text not null check (action in ('registered','revised','decommissioned','reactivated')),
  configuration jsonb not null,
  basis text not null check (length(btrim(basis)) >= 10),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(sensor_id, version)
);

create index if not exists idx_sensor_configuration_revisions_org
  on public.sensor_configuration_revisions(organization_id, sensor_id, version desc);

alter table public.sensor_configuration_revisions enable row level security;
drop policy if exists sensor_configuration_revisions_org_read
  on public.sensor_configuration_revisions;
create policy sensor_configuration_revisions_org_read
  on public.sensor_configuration_revisions for select to authenticated
  using (organization_id=public.app_current_org());

drop policy if exists sensors_org_rw on public.sensors;
drop policy if exists sensors_org_read on public.sensors;
create policy sensors_org_read on public.sensors for select to authenticated
  using (organization_id=public.app_current_org());

revoke insert,update,delete,truncate on public.sensors from public,anon,authenticated;
grant select on public.sensors to authenticated;
revoke insert,update,delete,truncate on public.sensor_configuration_revisions
  from public,anon,authenticated;
grant select on public.sensor_configuration_revisions to authenticated;

create or replace function public.protect_sensor_configuration_revision()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'sensor configuration history is append-only';
  end if;
  if coalesce(current_setting('app.sensor_registry_write',true),'')<>'granted' then
    raise exception 'sensor configuration history is written only by governed registry functions';
  end if;
  return new;
end $$;
revoke all on function public.protect_sensor_configuration_revision()
  from public,anon,authenticated;

drop trigger if exists trg_protect_sensor_configuration_revision
  on public.sensor_configuration_revisions;
create trigger trg_protect_sensor_configuration_revision
  before insert or update or delete on public.sensor_configuration_revisions
  for each row execute function public.protect_sensor_configuration_revision();

create or replace function public.condition_sensor_human_role_allowed()
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and public.app_current_org() is not null
    and coalesce(public.app_current_role(),'') in
      ('reliability_engineer','maintenance_manager','admin')
$$;
revoke all on function public.condition_sensor_human_role_allowed()
  from public,anon;
grant execute on function public.condition_sensor_human_role_allowed()
  to authenticated;

create or replace function public.condition_sensor_configuration(p_sensor public.sensors)
returns jsonb language sql stable set search_path=public as $$
  select jsonb_build_object(
    'sensorId',p_sensor.id,
    'assetId',p_sensor.asset_id,
    'sensorTag',p_sensor.sensor_tag,
    'name',p_sensor.name,
    'signalType',p_sensor.signal_type,
    'unit',p_sensor.unit,
    'detectionTechnique',p_sensor.detection_technique,
    'warningLimit',p_sensor.warning_limit,
    'alarmLimit',p_sensor.alarm_limit,
    'limitDirection',p_sensor.limit_direction,
    'sourceSystem',p_sensor.source_system,
    'registryStatus',p_sensor.registry_status,
    'configurationVersion',p_sensor.configuration_version)
$$;
revoke all on function public.condition_sensor_configuration(public.sensors)
  from public,anon,authenticated;

create or replace function public.upsert_condition_sensor(
  p_sensor_id uuid,
  p_asset_id uuid,
  p_sensor_tag text,
  p_name text,
  p_signal_type text,
  p_unit text,
  p_detection_technique text,
  p_warning_limit numeric,
  p_alarm_limit numeric,
  p_limit_direction text,
  p_source_system text,
  p_basis text,
  p_expected_version integer default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_sensor public.sensors%rowtype;
  v_id uuid;
  v_version integer;
  v_action text;
begin
  if not public.condition_sensor_human_role_allowed() then
    return jsonb_build_object('error','named human reliability, maintenance or administrator authority is required');
  end if;
  if p_asset_id is null or not exists(
    select 1 from public.assets where id=p_asset_id and organization_id=v_org
  ) then
    return jsonb_build_object('error','a canonical asset in this organization is required');
  end if;
  if coalesce(length(btrim(p_sensor_tag)),0)<2
     or coalesce(length(btrim(p_name)),0)<2
     or coalesce(length(btrim(p_signal_type)),0)<2
     or coalesce(length(btrim(p_unit)),0)<1
     or coalesce(length(btrim(p_basis)),0)<10 then
    return jsonb_build_object('error','sensor tag, name, signal type, unit and an evidence basis of at least 10 characters are required');
  end if;
  if coalesce(p_limit_direction,'') not in ('above','below') then
    return jsonb_build_object('error','limit direction must be above or below');
  end if;
  if p_warning_limit is not null and p_alarm_limit is not null and
     ((p_limit_direction='above' and p_warning_limit>=p_alarm_limit)
       or (p_limit_direction='below' and p_warning_limit<=p_alarm_limit)) then
    return jsonb_build_object('error','warning and alarm limits are inconsistent with the selected direction');
  end if;

  perform set_config('app.sensor_registry_write','granted',true);
  if p_sensor_id is null then
    insert into public.sensors(
      organization_id,asset_id,sensor_tag,name,signal_type,unit,
      detection_technique,warning_limit,alarm_limit,limit_direction,
      source_system,registry_status,configuration_version,
      configuration_basis,configured_by,configured_at)
    values(
      v_org,p_asset_id,btrim(p_sensor_tag),btrim(p_name),btrim(p_signal_type),
      btrim(p_unit),nullif(btrim(p_detection_technique),''),p_warning_limit,
      p_alarm_limit,p_limit_direction,nullif(btrim(p_source_system),''),
      'active',1,btrim(p_basis),auth.uid(),now())
    returning * into v_sensor;
    v_action:='registered';
  else
    select * into v_sensor from public.sensors
    where id=p_sensor_id and organization_id=v_org for update;
    if not found then
      perform set_config('app.sensor_registry_write','',true);
      return jsonb_build_object('error','sensor is outside this organization');
    end if;
    if v_sensor.asset_id<>p_asset_id then
      perform set_config('app.sensor_registry_write','',true);
      return jsonb_build_object('error','a sensor cannot be moved between canonical assets; decommission it and register a new measurement point');
    end if;
    if v_sensor.registry_status='decommissioned' then
      perform set_config('app.sensor_registry_write','',true);
      return jsonb_build_object('error','a decommissioned sensor requires the explicit reactivation workflow');
    end if;
    if p_expected_version is null or p_expected_version<>v_sensor.configuration_version then
      perform set_config('app.sensor_registry_write','',true);
      return jsonb_build_object('error','sensor configuration changed after it was loaded; refresh before revising it');
    end if;
    update public.sensors set
      sensor_tag=btrim(p_sensor_tag),name=btrim(p_name),
      signal_type=btrim(p_signal_type),unit=btrim(p_unit),
      detection_technique=nullif(btrim(p_detection_technique),''),
      warning_limit=p_warning_limit,alarm_limit=p_alarm_limit,
      limit_direction=p_limit_direction,
      source_system=nullif(btrim(p_source_system),''),
      configuration_version=configuration_version+1,
      configuration_basis=btrim(p_basis),configured_by=auth.uid(),configured_at=now()
    where id=p_sensor_id and organization_id=v_org
      and configuration_version=p_expected_version
    returning * into v_sensor;
    if not found then
      perform set_config('app.sensor_registry_write','',true);
      return jsonb_build_object('error','sensor configuration changed after it was loaded; refresh before revising it');
    end if;
    v_action:='revised';
  end if;

  v_id:=v_sensor.id;
  v_version:=v_sensor.configuration_version;
  insert into public.sensor_configuration_revisions(
    organization_id,sensor_id,version,action,configuration,basis,actor_id)
  values(v_org,v_id,v_version,v_action,
    public.condition_sensor_configuration(v_sensor),btrim(p_basis),auth.uid());
  perform set_config('app.sensor_registry_write','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'condition_sensor',public.app_current_role(),jsonb_build_object(
    'action',v_action,'sensor_id',v_id,'asset_id',p_asset_id,
    'configuration_version',v_version,'actor_id',auth.uid(),
    'limits_recorded',p_warning_limit is not null or p_alarm_limit is not null,
    'operational_authorization',false));
  return jsonb_build_object('sensorId',v_id,'version',v_version,
    'status',v_sensor.registry_status,'action',v_action,
    'operationalAuthorization',false);
exception when unique_violation then
  perform set_config('app.sensor_registry_write','',true);
  return jsonb_build_object('error','this organization already has that sensor tag');
end $$;
revoke all on function public.upsert_condition_sensor(
  uuid,uuid,text,text,text,text,text,numeric,numeric,text,text,text,integer)
  from public,anon;
grant execute on function public.upsert_condition_sensor(
  uuid,uuid,text,text,text,text,text,numeric,numeric,text,text,text,integer)
  to authenticated;

create or replace function public.decommission_condition_sensor(
  p_sensor_id uuid,p_reason text,p_expected_version integer
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_sensor public.sensors%rowtype;
begin
  if not public.condition_sensor_human_role_allowed() then
    return jsonb_build_object('error','named human reliability, maintenance or administrator authority is required');
  end if;
  if coalesce(length(btrim(p_reason)),0)<10 then
    return jsonb_build_object('error','a decommissioning reason of at least 10 characters is required');
  end if;
  perform set_config('app.sensor_registry_write','granted',true);
  update public.sensors set registry_status='decommissioned',
    configuration_version=configuration_version+1,
    configuration_basis=btrim(p_reason),configured_by=auth.uid(),configured_at=now(),
    decommissioned_by=auth.uid(),decommissioned_at=now(),
    decommission_reason=btrim(p_reason)
  where id=p_sensor_id and organization_id=v_org
    and registry_status<>'decommissioned'
    and configuration_version=p_expected_version
  returning * into v_sensor;
  if not found then
    perform set_config('app.sensor_registry_write','',true);
    return jsonb_build_object('error','sensor changed after it was loaded, is already decommissioned or is outside this organization');
  end if;
  insert into public.sensor_configuration_revisions(
    organization_id,sensor_id,version,action,configuration,basis,actor_id)
  values(v_org,v_sensor.id,v_sensor.configuration_version,'decommissioned',
    public.condition_sensor_configuration(v_sensor),btrim(p_reason),auth.uid());
  perform set_config('app.sensor_registry_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'condition_sensor',public.app_current_role(),jsonb_build_object(
    'action','decommissioned','sensor_id',v_sensor.id,
    'configuration_version',v_sensor.configuration_version,'actor_id',auth.uid(),
    'history_preserved',true,'operational_authorization',false));
  return jsonb_build_object('sensorId',v_sensor.id,
    'version',v_sensor.configuration_version,'status','decommissioned',
    'historyPreserved',true,'operationalAuthorization',false);
end $$;
revoke all on function public.decommission_condition_sensor(uuid,text,integer)
  from public,anon;
grant execute on function public.decommission_condition_sensor(uuid,text,integer)
  to authenticated;

create or replace function public.reactivate_condition_sensor(
  p_sensor_id uuid,p_basis text,p_expected_version integer
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_sensor public.sensors%rowtype;
begin
  if not public.condition_sensor_human_role_allowed() then
    return jsonb_build_object('error','named human reliability, maintenance or administrator authority is required');
  end if;
  if coalesce(length(btrim(p_basis)),0)<10 then
    return jsonb_build_object('error','a reactivation basis of at least 10 characters is required');
  end if;
  perform set_config('app.sensor_registry_write','granted',true);
  update public.sensors set registry_status='active',
    configuration_version=configuration_version+1,
    configuration_basis=btrim(p_basis),configured_by=auth.uid(),configured_at=now(),
    decommissioned_by=null,decommissioned_at=null,decommission_reason=null
  where id=p_sensor_id and organization_id=v_org
    and registry_status='decommissioned'
    and configuration_version=p_expected_version
  returning * into v_sensor;
  if not found then
    perform set_config('app.sensor_registry_write','',true);
    return jsonb_build_object('error','sensor changed after it was loaded, is not decommissioned or is outside this organization');
  end if;
  insert into public.sensor_configuration_revisions(
    organization_id,sensor_id,version,action,configuration,basis,actor_id)
  values(v_org,v_sensor.id,v_sensor.configuration_version,'reactivated',
    public.condition_sensor_configuration(v_sensor),btrim(p_basis),auth.uid());
  perform set_config('app.sensor_registry_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'condition_sensor',public.app_current_role(),jsonb_build_object(
    'action','reactivated','sensor_id',v_sensor.id,
    'configuration_version',v_sensor.configuration_version,'actor_id',auth.uid(),
    'operational_authorization',false));
  return jsonb_build_object('sensorId',v_sensor.id,
    'version',v_sensor.configuration_version,'status','active',
    'operationalAuthorization',false);
end $$;
revoke all on function public.reactivate_condition_sensor(uuid,text,integer)
  from public,anon;
grant execute on function public.reactivate_condition_sensor(uuid,text,integer)
  to authenticated;

create or replace function public.reject_reading_for_inactive_sensor()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  select registry_status into v_status from public.sensors
  where id=new.sensor_id and organization_id=new.organization_id;
  if v_status is null then
    raise exception 'condition reading sensor is outside the reading organization';
  end if;
  if v_status<>'active' then
    raise exception 'condition readings require an active governed sensor; current status is %',v_status;
  end if;
  return new;
end $$;
revoke all on function public.reject_reading_for_inactive_sensor()
  from public,anon,authenticated;
drop trigger if exists trg_condition_reading_active_sensor on public.condition_readings;
create trigger trg_condition_reading_active_sensor
  before insert on public.condition_readings for each row
  execute function public.reject_reading_for_inactive_sensor();

create or replace function public.get_condition_sensor_registry()
returns jsonb language sql stable security definer set search_path=public as $$
  with caller as (select public.app_current_org() organization_id),
  sensor_rows as (
    select s.*,coalesce(a.asset_tag,a.tag,a.name) asset_tag,a.name asset_name,
      coalesce(readings.reading_count,0) reading_count,readings.latest_reading_at,
      calibration.calibrated_on,calibration.calibration_due_on,
      calibration.certificate_reference,calibration.as_left_within_tolerance,
      coalesce(reports.report_count,0) report_count,reports.latest_report_at,
      coalesce(history.history_count,0) history_count
    from public.sensors s join caller c on c.organization_id=s.organization_id
    join public.assets a on a.id=s.asset_id and a.organization_id=s.organization_id
    left join lateral (
      select count(*)::integer reading_count,max(cr.taken_at) latest_reading_at
      from public.condition_readings cr
      where cr.organization_id=s.organization_id and cr.sensor_id=s.id
    ) readings on true
    left join lateral (
      select ic.calibrated_on,
        (ic.calibrated_on+(ic.interval_months||' months')::interval)::date calibration_due_on,
        ic.certificate_reference,ic.as_left_within_tolerance
      from public.instrument_calibrations ic
      where ic.organization_id=s.organization_id and ic.sensor_id=s.id
      order by ic.calibrated_on desc,ic.id desc limit 1
    ) calibration on true
    left join lateral (
      select count(*)::integer report_count,max(p.created_at) latest_report_at
      from public.condition_monitoring_agent_packs p
      where p.organization_id=s.organization_id and p.sensor_id=s.id
    ) reports on true
    left join lateral (
      select count(*)::integer history_count
      from public.sensor_configuration_revisions h
      where h.organization_id=s.organization_id and h.sensor_id=s.id
    ) history on true
  )
  select case when (select organization_id from caller) is null
    then jsonb_build_object('error','authentication required') else jsonb_build_object(
      'assets',coalesce((select jsonb_agg(jsonb_build_object(
        'assetId',a.id,'assetTag',coalesce(a.asset_tag,a.tag,a.name),'name',a.name)
        order by coalesce(a.asset_tag,a.tag,a.name)) from public.assets a
        join caller c on c.organization_id=a.organization_id),'[]'::jsonb),
      'sensors',coalesce((select jsonb_agg(jsonb_build_object(
        'sensorId',id,'assetId',asset_id,'assetTag',asset_tag,'assetName',asset_name,
        'sensorTag',sensor_tag,'name',name,'signalType',signal_type,'unit',unit,
        'detectionTechnique',detection_technique,'warningLimit',warning_limit,
        'alarmLimit',alarm_limit,'limitDirection',limit_direction,
        'sourceSystem',source_system,'registryStatus',registry_status,
        'configurationVersion',configuration_version,
        'configurationBasis',configuration_basis,'configuredAt',configured_at,
        'readingCount',reading_count,'latestReadingAt',latest_reading_at,
        'calibration',case when calibrated_on is null then null else jsonb_build_object(
          'calibratedOn',calibrated_on,'dueOn',calibration_due_on,
          'certificateReference',certificate_reference,
          'asLeftWithinTolerance',as_left_within_tolerance,
          'posture',case when not as_left_within_tolerance then 'out_of_tolerance'
            when calibration_due_on<current_date then 'overdue' else 'current' end) end,
        'diagnosticReportCount',report_count,'latestDiagnosticReportAt',latest_report_at,
        'historyCount',history_count,'lastValue',last_value,'currentStatus',status,
        'trend',trend) order by asset_tag,name) from sensor_rows),'[]'::jsonb),
      'canManage',public.condition_sensor_human_role_allowed(),
      'basis','Sensors are governed measurement points on the canonical asset hierarchy. Limits are named-human configuration, not diagnoses or operating authority. Readings and immutable diagnostic packs retain their existing stores and review controls.',
      'boundary','Registering or changing a sensor does not authorize maintenance, change an operating limit in the control system, accept risk, approve work or return equipment to service.') end
$$;
revoke all on function public.get_condition_sensor_registry() from public,anon;
grant execute on function public.get_condition_sensor_registry() to authenticated;

comment on table public.sensor_configuration_revisions is
  'Append-only named-human configuration history for canonical sensors; never a parallel reading or diagnostic-report store.';

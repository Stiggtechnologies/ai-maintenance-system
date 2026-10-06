-- E12.07 — governed time-synchronization assurance.
--
-- SyncAI does not set or discipline plant clocks.  It records the tenant's
-- administrator-recorded clock contract on the ONE canonical connector, accepts immutable
-- measurements from a controlled service, and fails closed when event time
-- cannot be shown to be current and within the administrator-recorded tolerance.
-- There is deliberately no second connector/source-health store and no path
-- from this capability to a PLC, DCS, historian, NTP or PTP configuration.

alter table public.connectors
  add column if not exists time_sync_protocol text
    check (time_sync_protocol is null or time_sync_protocol in
      ('ntp','ptp','gnss','vendor_managed','system_managed')),
  add column if not exists time_reference_authority text,
  add column if not exists time_tolerance_ms numeric,
  add column if not exists time_observation_max_age_minutes integer,
  add column if not exists time_evidence_reference text,
  add column if not exists time_configuration_basis text,
  add column if not exists time_configured_by uuid
    references public.user_profiles(id) on delete restrict,
  add column if not exists time_configured_at timestamptz,
  add column if not exists time_assurance_revision integer not null default 0;

alter table public.connectors
  drop constraint if exists connectors_time_assurance_complete;
alter table public.connectors
  add constraint connectors_time_assurance_complete check (
    (time_sync_protocol is null
      and time_reference_authority is null
      and time_tolerance_ms is null
      and time_observation_max_age_minutes is null
      and time_evidence_reference is null
      and time_configuration_basis is null
      and time_configured_by is null
      and time_configured_at is null
      and time_assurance_revision = 0)
    or
    coalesce((time_sync_protocol is not null
      and length(btrim(time_reference_authority)) >= 5
      and time_tolerance_ms > 0
      and time_tolerance_ms::text not in ('NaN','Infinity','-Infinity')
      and time_observation_max_age_minutes > 0
      and length(btrim(time_evidence_reference)) >= 8
      and length(btrim(time_configuration_basis)) >= 40
      and time_configured_by is not null
      and time_configured_at is not null
      and time_assurance_revision > 0),false)
  );

comment on column public.connectors.time_tolerance_ms is
  'Administrator-recorded maximum worst-case absolute clock offset in milliseconds. Opaque evidence references do not establish engineering approval. SyncAI never invents this threshold.';
comment on column public.connectors.time_assurance_revision is
  'Monotonic clock-contract revision. Reconfiguration makes prior observations historical rather than silently applying them to the new contract.';

create or replace function public.enforce_connector_time_configuration()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    if old.time_assurance_revision>0 then
      raise exception 'connector clock history is retained; disable the connector instead of deleting it';
    end if;
    return old;
  end if;
  if tg_op='INSERT' then
    if new.time_sync_protocol is not null
       or new.time_reference_authority is not null
       or new.time_tolerance_ms is not null
       or new.time_observation_max_age_minutes is not null
       or new.time_evidence_reference is not null
       or new.time_configuration_basis is not null
       or new.time_configured_by is not null
       or new.time_configured_at is not null
       or new.time_assurance_revision<>0 then
      raise exception 'initial connector clock configuration requires the governed configuration RPC';
    end if;
    return new;
  end if;
  if old.time_assurance_revision>0 and
     (new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.connector_key is distinct from old.connector_key) then
    raise exception 'connector clock history is retained under its original tenant and source identity';
  end if;
  if coalesce(current_setting('app.time_assurance_config_write',true),'') <> 'granted'
     and (new.time_sync_protocol is distinct from old.time_sync_protocol
       or new.time_reference_authority is distinct from old.time_reference_authority
       or new.time_tolerance_ms is distinct from old.time_tolerance_ms
       or new.time_observation_max_age_minutes is distinct from old.time_observation_max_age_minutes
       or new.time_evidence_reference is distinct from old.time_evidence_reference
       or new.time_configuration_basis is distinct from old.time_configuration_basis
       or new.time_configured_by is distinct from old.time_configured_by
       or new.time_configured_at is distinct from old.time_configured_at
       or new.time_assurance_revision is distinct from old.time_assurance_revision) then
    raise exception 'connector time-assurance fields are writable only through the governed configuration RPC';
  end if;
  if new.time_configured_by is not null and not exists (
    select 1 from public.user_profiles p
    where p.id=new.time_configured_by
      and p.organization_id=new.organization_id
      and p.role='admin'
  ) then
    raise exception 'time assurance must be configured by a named human administrator in the connector tenant';
  end if;
  return new;
end
$$;

drop trigger if exists trg_connector_time_configuration on public.connectors;
create trigger trg_connector_time_configuration
  before insert or update or delete on public.connectors
  for each row execute function public.enforce_connector_time_configuration();
revoke all on function public.enforce_connector_time_configuration()
  from public,anon,authenticated,service_role;

create table if not exists public.connector_time_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  connector_id uuid not null
    references public.connectors(id) on delete cascade,
  configuration_revision integer not null check (configuration_revision > 0),
  delivery_id text not null check (length(btrim(delivery_id)) between 3 and 200),
  source_clock_at timestamptz not null,
  reference_clock_at timestamptz not null,
  offset_ms numeric not null
    check (offset_ms::text not in ('NaN','Infinity','-Infinity')),
  round_trip_delay_ms numeric
    check (round_trip_delay_ms is null or
      (round_trip_delay_ms >= 0 and round_trip_delay_ms::text not in ('NaN','Infinity','-Infinity'))),
  measurement_uncertainty_ms numeric not null
    check (measurement_uncertainty_ms >= 0 and
      measurement_uncertainty_ms::text not in ('NaN','Infinity','-Infinity')),
  evidence_reference text not null check (length(btrim(evidence_reference)) >= 8),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_by text not null,
  received_at timestamptz not null default clock_timestamp(),
  unique(connector_id,delivery_id)
);

create index if not exists idx_connector_time_observations_latest
  on public.connector_time_observations
    (organization_id,connector_id,configuration_revision,received_at desc);

alter table public.connector_time_observations enable row level security;
drop policy if exists connector_time_observations_read
  on public.connector_time_observations;
create policy connector_time_observations_read
  on public.connector_time_observations for select to authenticated
  using (
    organization_id=public.app_current_org()
    and public.app_current_role() in
      ('planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin')
  );

revoke all on table public.connector_time_observations
  from public,anon,authenticated,service_role;
grant select on table public.connector_time_observations to authenticated;

create or replace function public.enforce_connector_time_observation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  c public.connectors%rowtype;
  v_offset numeric;
begin
  if tg_op in ('UPDATE','DELETE','TRUNCATE') then
    raise exception 'connector clock observations are immutable evidence; append a new observation';
  end if;
  if coalesce(current_setting('app.time_assurance_observation_write',true),'') <> 'granted' then
    raise exception 'connector clock observations are service-only and writable only through the governed RPC';
  end if;
  select * into c from public.connectors where id=new.connector_id;
  if not found or c.organization_id<>new.organization_id then
    raise exception 'clock observation crosses the connector tenant boundary';
  end if;
  if c.time_sync_protocol is null or c.time_assurance_revision<>new.configuration_revision then
    raise exception 'clock observation does not match the active governed clock contract';
  end if;
  v_offset:=round((extract(epoch from
    (new.source_clock_at-new.reference_clock_at))*1000)::numeric,6);
  if abs(new.offset_ms-v_offset)>0.000001 then
    raise exception 'clock offset must be computed server-side from source and reference timestamps';
  end if;
  return new;
end
$$;

drop trigger if exists trg_connector_time_observation
  on public.connector_time_observations;
create trigger trg_connector_time_observation
  before insert or update or delete on public.connector_time_observations
  for each row execute function public.enforce_connector_time_observation();
drop trigger if exists trg_connector_time_observation_truncate
  on public.connector_time_observations;
create trigger trg_connector_time_observation_truncate
  before truncate on public.connector_time_observations
  for each statement execute function public.enforce_connector_time_observation();
revoke all on function public.enforce_connector_time_observation()
  from public,anon,authenticated,service_role;

-- Complete, versioned clock snapshots belong in the ONE canonical audit ledger.
-- This is not an approval assertion or a parallel clock-contract history table.
create or replace function public.connector_time_contract_snapshot(c public.connectors)
returns jsonb language sql stable set search_path=public as $$
  select jsonb_build_object('clock_contract_version',1,
    'connector_id',c.id,'organization_id',c.organization_id,'connector_key',c.connector_key,
    'revision',c.time_assurance_revision,'protocol',c.time_sync_protocol,
    'reference_authority',c.time_reference_authority,'tolerance_ms',c.time_tolerance_ms,
    'max_observation_age_minutes',c.time_observation_max_age_minutes,
    'evidence_reference',c.time_evidence_reference,'configuration_basis',c.time_configuration_basis,
    'configured_by',c.time_configured_by,
    'configured_at',to_char(c.time_configured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
$$;
revoke all on function public.connector_time_contract_snapshot(public.connectors)
  from public,anon,authenticated,service_role;

create or replace function public.enforce_connector_time_audit_receipt()
returns trigger language plpgsql security definer set search_path=public as $$
declare c public.connectors%rowtype;
begin
  if new.entity_type<>'connector_time_assurance_configuration' then return new; end if;
  if coalesce(current_setting('app.time_assurance_audit_write',true),'')<>'granted' then
    raise exception 'clock configuration audit receipts require the governed configuration RPC';
  end if;
  select * into c from public.connectors
    where id::text=new.event_data->>'connector_id' and organization_id=new.organization_id;
  if not found or c.time_assurance_revision<1
     or new.actor is distinct from c.time_configured_by::text
     or new.new_state is distinct from public.connector_time_contract_snapshot(c)
     or new.previous_state->>'revision' is distinct from (c.time_assurance_revision-1)::text
     or new.previous_state->>'connector_id' is distinct from c.id::text
     or new.previous_state->>'organization_id' is distinct from c.organization_id::text
     or new.previous_state->>'connector_key' is distinct from c.connector_key then
    raise exception 'clock configuration receipt must match the canonical connector and its prior revision';
  end if;
  if exists(select 1 from public.audit_events a
    where a.organization_id=c.organization_id
      and a.entity_type='connector_time_assurance_configuration'
      and a.event_data->>'connector_id'=c.id::text
      and a.new_state->>'revision'=c.time_assurance_revision::text) then
    raise exception 'clock configuration receipt already exists for this revision';
  end if;
  return new;
end $$;
drop trigger if exists trg_connector_time_audit_receipt on public.audit_events;
create trigger trg_connector_time_audit_receipt
  before insert on public.audit_events for each row
  execute function public.enforce_connector_time_audit_receipt();
revoke all on function public.enforce_connector_time_audit_receipt()
  from public,anon,authenticated,service_role;
create index if not exists idx_audit_connector_time_contract
  on public.audit_events(organization_id,(event_data->>'connector_id'))
  where entity_type='connector_time_assurance_configuration';

create or replace function public.configure_connector_time_assurance(
  p_connector_id uuid,
  p_protocol text,
  p_reference_authority text,
  p_tolerance_ms numeric,
  p_max_observation_age_minutes integer,
  p_evidence_reference text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_uid uuid:=auth.uid();
  v_role text:=public.app_current_role();
  c public.connectors%rowtype;
  v_protocol text:=lower(btrim(coalesce(p_protocol,'')));
  v_revision integer;
  v_current public.connectors%rowtype;
begin
  if v_org is null or v_uid is null or coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error',
      'time assurance configuration requires a named same-tenant human administrator');
  end if;
  select * into c from public.connectors
  where id=p_connector_id and organization_id=v_org for update;
  if not found then
    return jsonb_build_object('error','connector not found in this organization');
  end if;
  if v_protocol not in ('ntp','ptp','gnss','vendor_managed','system_managed') then
    return jsonb_build_object('error','unsupported clock synchronization protocol');
  end if;
  if coalesce(length(btrim(p_reference_authority)),0)<5 then
    return jsonb_build_object('error','the authoritative clock source must be identified');
  end if;
  if p_tolerance_ms is null or p_tolerance_ms<=0
     or p_tolerance_ms::text in ('NaN','Infinity','-Infinity') then
    return jsonb_build_object('error',
      'a positive tenant-approved clock tolerance in milliseconds is required');
  end if;
  if coalesce(p_max_observation_age_minutes,0)<=0 then
    return jsonb_build_object('error',
      'a positive maximum observation age in minutes is required');
  end if;
  if coalesce(length(btrim(p_evidence_reference)),0)<8 then
    return jsonb_build_object('error','a governed configuration evidence reference is required');
  end if;
  if p_evidence_reference ~* '(password|secret|token|api[_-]?key|bearer)' then
    return jsonb_build_object('error',
      'the evidence reference appears to contain a credential; store only an opaque reference');
  end if;
  if coalesce(length(btrim(p_basis)),0)<40 then
    return jsonb_build_object('error',
      'a substantive clock authority, tolerance and freshness basis is required');
  end if;

  v_revision:=c.time_assurance_revision+1;
  perform set_config('app.time_assurance_config_write','granted',true);
  update public.connectors set
    time_sync_protocol=v_protocol,
    time_reference_authority=btrim(p_reference_authority),
    time_tolerance_ms=p_tolerance_ms,
    time_observation_max_age_minutes=p_max_observation_age_minutes,
    time_evidence_reference=btrim(p_evidence_reference),
    time_configuration_basis=btrim(p_basis),
    time_configured_by=v_uid,
    time_configured_at=clock_timestamp(),
    time_assurance_revision=v_revision
  where id=c.id returning * into v_current;
  perform set_config('app.time_assurance_config_write','',true);

  perform set_config('app.time_assurance_audit_write','granted',true);
  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state
  ) values(
    v_org,'connector_time_assurance_configuration',v_uid::text,
    jsonb_build_object('connector_id',c.id,'connector_key',c.connector_key,
      'operational_authority',false,'sets_source_clock',false),
    public.connector_time_contract_snapshot(c),
    public.connector_time_contract_snapshot(v_current)
  );
  perform set_config('app.time_assurance_audit_write','',true);

  return jsonb_build_object('ok',true,'connector_id',c.id,
    'configuration_revision',v_revision,'state','unproven',
    'operational_authority',false,'configuration_evidence_verified',false,
    'eligible_for_time_sensitive_evidence',false,
    'note','Clock contract recorded. A current service observation is still required before event time is usable.');
end
$$;

revoke all on function public.configure_connector_time_assurance(
  uuid,text,text,numeric,integer,text,text
) from public,anon,service_role;
grant execute on function public.configure_connector_time_assurance(
  uuid,text,text,numeric,integer,text,text
) to authenticated;

create or replace function public.record_connector_time_observation(
  p_organization_id uuid,
  p_connector_key text,
  p_delivery_id text,
  p_source_clock_at timestamptz,
  p_reference_clock_at timestamptz,
  p_round_trip_delay_ms numeric,
  p_measurement_uncertainty_ms numeric,
  p_evidence_reference text,
  p_payload_sha256 text,
  p_configuration_revision integer default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  c public.connectors%rowtype;
  existing public.connector_time_observations%rowtype;
  v_received timestamptz;
  v_offset numeric;
  v_id uuid;
  v_worst numeric;
  v_state text;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','clock observations are accepted only from the controlled service role');
  end if;
  select * into c from public.connectors
  where organization_id=p_organization_id and connector_key=btrim(p_connector_key)
  for update;
  -- Receipt belongs to the serialized, accepted revision, not time spent waiting
  -- for a concurrent configuration transaction's connector lock.
  v_received:=clock_timestamp();
  if not found then return jsonb_build_object('error','connector not found in the stated organization'); end if;
  if not c.enabled then return jsonb_build_object('error','connector is disabled'); end if;
  if c.time_sync_protocol is null then
    return jsonb_build_object('error','connector has no governed clock contract');
  end if;
  -- Bind collection to the explicitly observed contract under the same row lock
  -- used by human configuration. Never stamp a delayed envelope with a new
  -- contract just because a reconfiguration won the race to this receipt.
  if p_configuration_revision is null or p_configuration_revision<1 then
    return jsonb_build_object('error','an expected clock-contract revision is required');
  end if;
  if p_configuration_revision<>c.time_assurance_revision then
    return jsonb_build_object('error',case
      when p_configuration_revision<c.time_assurance_revision
        then 'observation names a superseded clock-contract revision'
      else 'observation clock-contract revision is not active' end);
  end if;
  if coalesce(length(btrim(p_delivery_id)),0) not between 3 and 200 then
    return jsonb_build_object('error','a stable delivery identifier is required for replay safety');
  end if;
  if p_source_clock_at is null or p_reference_clock_at is null
     or not isfinite(p_source_clock_at) or not isfinite(p_reference_clock_at) then
    return jsonb_build_object('error','finite source and reference timestamps are required');
  end if;
  if p_round_trip_delay_ms is not null and
     (p_round_trip_delay_ms<0 or p_round_trip_delay_ms::text in ('NaN','Infinity','-Infinity')) then
    return jsonb_build_object('error','round-trip delay cannot be negative or non-finite');
  end if;
  if p_measurement_uncertainty_ms is null or p_measurement_uncertainty_ms<0
     or p_measurement_uncertainty_ms::text in ('NaN','Infinity','-Infinity') then
    return jsonb_build_object('error','finite non-negative measurement uncertainty is required');
  end if;
  if p_round_trip_delay_ms is not null
     and p_measurement_uncertainty_ms<p_round_trip_delay_ms/2 then
    return jsonb_build_object('error',
      'measurement uncertainty cannot be less than half the observed round-trip delay');
  end if;
  if p_reference_clock_at > v_received and
      extract(epoch from (p_reference_clock_at-v_received))*1000>p_measurement_uncertainty_ms then
    return jsonb_build_object('error',
      'reference timestamp is later than receipt beyond its stated uncertainty');
  end if;
  if coalesce(length(btrim(p_evidence_reference)),0)<8 then
    return jsonb_build_object('error','an observation evidence reference is required');
  end if;
  if lower(coalesce(p_payload_sha256,'')) !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error','payload_sha256 must be a lowercase SHA-256 digest');
  end if;

  select * into existing from public.connector_time_observations
  where connector_id=c.id and delivery_id=btrim(p_delivery_id);
  if found then
    if existing.payload_sha256=lower(p_payload_sha256)
       and existing.configuration_revision=c.time_assurance_revision then
      if not (existing.source_clock_at is not distinct from p_source_clock_at
        and existing.reference_clock_at is not distinct from p_reference_clock_at
        and existing.round_trip_delay_ms is not distinct from p_round_trip_delay_ms
        and existing.measurement_uncertainty_ms is not distinct from p_measurement_uncertainty_ms
        and existing.evidence_reference is not distinct from btrim(p_evidence_reference)) then
        return jsonb_build_object('error',
          'delivery identifier has the same digest but a different observation envelope');
      end if;
      return jsonb_build_object('ok',true,'observation_id',existing.id,
        'replay',true,'state',case
          when existing.reference_clock_at>v_received then 'unproven'
          when existing.reference_clock_at+make_interval(mins=>c.time_observation_max_age_minutes)<v_received then 'stale'
          when abs(existing.offset_ms)+existing.measurement_uncertainty_ms<=c.time_tolerance_ms
            then 'synchronized' else 'untrusted' end,
        'operational_authority',false,
        'configuration_evidence_verified',false,
        'eligible_for_time_sensitive_evidence',false);
    end if;
    if existing.payload_sha256=lower(p_payload_sha256) then
      return jsonb_build_object('error',
        'delivery identifier belongs to a superseded clock-contract revision');
    end if;
    return jsonb_build_object('error',
      'delivery identifier was already used with a different payload digest');
  end if;

  v_offset:=round((extract(epoch from
    (p_source_clock_at-p_reference_clock_at))*1000)::numeric,6);
  v_worst:=abs(v_offset)+p_measurement_uncertainty_ms;
  v_state:=case
    when p_reference_clock_at>v_received then 'unproven'
    when p_reference_clock_at+make_interval(mins=>c.time_observation_max_age_minutes)<v_received then 'stale'
    when v_worst<=c.time_tolerance_ms
    then 'synchronized' else 'untrusted' end;

  perform set_config('app.time_assurance_observation_write','granted',true);
  insert into public.connector_time_observations(
    organization_id,connector_id,configuration_revision,delivery_id,
    source_clock_at,reference_clock_at,offset_ms,round_trip_delay_ms,
    measurement_uncertainty_ms,evidence_reference,payload_sha256,recorded_by,
    received_at
  ) values(
    c.organization_id,c.id,c.time_assurance_revision,btrim(p_delivery_id),
    p_source_clock_at,p_reference_clock_at,v_offset,p_round_trip_delay_ms,
    p_measurement_uncertainty_ms,btrim(p_evidence_reference),
    lower(p_payload_sha256),'service_role',v_received
  ) returning id into v_id;
  perform set_config('app.time_assurance_observation_write','',true);

  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,new_state
  ) values(
    c.organization_id,'connector_time_observation','service_role',
    jsonb_build_object('connector_id',c.id,'connector_key',c.connector_key,
      'observation_id',v_id,'delivery_id',btrim(p_delivery_id),
      'payload_sha256',lower(p_payload_sha256),'operational_authority',false),
    jsonb_build_object('configuration_revision',c.time_assurance_revision,
      'offset_ms',v_offset,'measurement_uncertainty_ms',p_measurement_uncertainty_ms,
      'worst_case_offset_ms',v_worst,'tolerance_ms',c.time_tolerance_ms,
      'state',v_state)
  );

  return jsonb_build_object('ok',true,'observation_id',v_id,'replay',false,
    'configuration_revision',c.time_assurance_revision,'offset_ms',v_offset,
    'measurement_uncertainty_ms',p_measurement_uncertainty_ms,
    'worst_case_offset_ms',v_worst,'tolerance_ms',c.time_tolerance_ms,
    'state',v_state,'operational_authority',false,
    'configuration_evidence_verified',false,
    'eligible_for_time_sensitive_evidence',false);
end
$$;

revoke all on function public.record_connector_time_observation(
  uuid,text,text,timestamptz,timestamptz,numeric,numeric,text,text,integer
) from public,anon,authenticated;
grant execute on function public.record_connector_time_observation(
  uuid,text,text,timestamptz,timestamptz,numeric,numeric,text,text,integer
) to service_role;

create or replace function public.get_connector_time_assurance()
returns jsonb
language plpgsql
security definer
set search_path=public
stable
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text:=public.app_current_role();
  v_rows jsonb;
begin
  if v_org is null or coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin') then
    return jsonb_build_object('error','time assurance requires an authorized same-tenant user');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'connectorId',q.id,'connectorKey',q.connector_key,'name',q.name,
    'enabled',q.enabled,'protocol',q.time_sync_protocol,
    'referenceAuthority',q.time_reference_authority,
    'toleranceMs',q.time_tolerance_ms,
    'maxObservationAgeMinutes',q.time_observation_max_age_minutes,
    'configurationRevision',q.time_assurance_revision,
    'configurationEvidenceReference',q.time_evidence_reference,
    'configuredAt',q.time_configured_at,
    'state',q.state,'withinClockContract',q.state='synchronized',
    'configurationEvidenceVerified',false,'eligibleForTimeSensitiveEvidence',false,
    'reason',q.reason,'observationId',q.observation_id,
    'sourceClockAt',q.source_clock_at,'referenceClockAt',q.reference_clock_at,
    'receivedAt',q.received_at,'offsetMs',q.offset_ms,
    'measurementUncertaintyMs',q.measurement_uncertainty_ms,
    'worstCaseOffsetMs',q.worst_case_offset_ms,
    'observationEvidenceReference',q.observation_evidence_reference
  ) order by q.name),'[]'::jsonb) into v_rows
  from (
    select c.*,o.id observation_id,o.source_clock_at,o.reference_clock_at,
      o.received_at,o.offset_ms,o.measurement_uncertainty_ms,
      abs(o.offset_ms)+o.measurement_uncertainty_ms worst_case_offset_ms,
      o.evidence_reference observation_evidence_reference,
      case
        when c.time_sync_protocol is null then 'unconfigured'
        when not c.enabled then 'disabled'
        when o.id is null then 'unproven'
        when o.reference_clock_at>clock_timestamp() then 'unproven'
        when o.reference_clock_at + make_interval(mins=>c.time_observation_max_age_minutes)<clock_timestamp()
          then 'stale'
        when abs(o.offset_ms)+o.measurement_uncertainty_ms<=c.time_tolerance_ms
          then 'synchronized'
        else 'untrusted'
      end state,
      case
        when c.time_sync_protocol is null then 'No governed clock contract has been recorded.'
        when not c.enabled then 'Connector is disabled; its event time is not operational evidence.'
        when o.id is null then 'No observation matches the active clock-contract revision.'
        when o.reference_clock_at>clock_timestamp() then 'The reference timestamp has not yet occurred; clock posture is unproven.'
        when o.reference_clock_at + make_interval(mins=>c.time_observation_max_age_minutes)<clock_timestamp()
          then 'The latest observation is older than the recorded freshness interval.'
        when abs(o.offset_ms)+o.measurement_uncertainty_ms<=c.time_tolerance_ms
          then 'Current worst-case offset is within the recorded tolerance. Canonical configuration-evidence approval is not yet verified; time-sensitive evidence remains ineligible.'
        else 'Worst-case offset exceeds the recorded tolerance.'
      end reason
    from public.connectors c
    left join lateral (
      select x.* from public.connector_time_observations x
      where x.organization_id=c.organization_id and x.connector_id=c.id
        and x.configuration_revision=c.time_assurance_revision
      order by x.reference_clock_at desc,x.received_at desc,x.id desc limit 1
    ) o on true
    where c.organization_id=v_org
  ) q;
  return jsonb_build_object('generatedAt',clock_timestamp(),
    'operationalAuthority',false,'setsSourceClocks',false,'connectors',v_rows);
end
$$;

revoke all on function public.get_connector_time_assurance()
  from public,anon,service_role;
grant execute on function public.get_connector_time_assurance()
  to authenticated;

create or replace function public.evaluate_connector_event_time(
  p_connector_id uuid,
  p_event_time timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=public
stable
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text:=public.app_current_role();
  c public.connectors%rowtype;
  o public.connector_time_observations%rowtype;
  v_worst numeric;
  v_state text;
  a record;
  v_previous jsonb;
  v_contract jsonb;
  v_audit_id uuid;
  v_history_revision integer:=0;
  v_recorded_at timestamptz;
  v_last_recorded_at timestamptz;
  v_history_good boolean:=true;
  v_tolerance numeric;
  v_max_age integer;
  v_event_revision integer;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin') then
    return jsonb_build_object('error','event-time assurance requires an authorized same-tenant user');
  end if;
  select * into c from public.connectors
  where id=p_connector_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','connector not found in this organization'); end if;
  if p_event_time is null or not isfinite(p_event_time) then
    return jsonb_build_object('error','a finite event timestamp is required');
  end if;
  if p_event_time>clock_timestamp() then
    return jsonb_build_object('error','future event time cannot be qualified');
  end if;
  if c.time_sync_protocol is null then v_state:='unconfigured';
  elsif not c.enabled then v_state:='disabled';
  else
    v_previous:=public.connector_time_contract_snapshot(c)||jsonb_build_object(
      'revision',0,'protocol',null,'reference_authority',null,'tolerance_ms',null,
      'max_observation_age_minutes',null,'evidence_reference',null,
      'configuration_basis',null,'configured_by',null,'configured_at',null);
    -- Verify a complete contiguous chain and its current canonical endpoint.
    -- Missing, duplicate, legacy/incomplete, malformed or contradictory receipts
    -- fail closed; no backfill or inferred historical engineering contract.
    begin
      for a in select id,actor,previous_state,new_state from public.audit_events
        where organization_id=v_org and entity_type='connector_time_assurance_configuration'
          and event_data->>'connector_id'=c.id::text
        order by (new_state->>'revision')::integer,id
      loop
        v_history_revision:=v_history_revision+1;
        v_recorded_at:=(a.new_state->>'configured_at')::timestamptz;
        if a.previous_state is distinct from v_previous
          or not coalesce(a.new_state ?& array['clock_contract_version','connector_id','organization_id',
            'connector_key','revision','protocol','reference_authority','tolerance_ms',
            'max_observation_age_minutes','evidence_reference','configuration_basis','configured_by','configured_at'],false)
          or a.new_state->>'clock_contract_version' is distinct from '1'
          or a.new_state->>'revision' is distinct from v_history_revision::text
          or a.new_state->>'connector_id' is distinct from c.id::text
          or a.new_state->>'organization_id' is distinct from v_org::text
          or a.new_state->>'connector_key' is distinct from c.connector_key
          or a.actor is distinct from a.new_state->>'configured_by'
          or a.new_state->>'protocol' not in ('ntp','ptp','gnss','vendor_managed','system_managed')
          or coalesce(length(btrim(a.new_state->>'reference_authority')),0)<5
          or coalesce(length(btrim(a.new_state->>'evidence_reference')),0)<8
          or coalesce(length(btrim(a.new_state->>'configuration_basis')),0)<40
          or coalesce((a.new_state->>'tolerance_ms')::numeric,0)<=0
          or a.new_state->>'tolerance_ms' in ('NaN','Infinity','-Infinity')
          or coalesce((a.new_state->>'max_observation_age_minutes')::integer,0)<=0
          or v_recorded_at is null or not isfinite(v_recorded_at)
          or v_recorded_at>clock_timestamp()
          or v_recorded_at<v_last_recorded_at then
          v_history_good:=false; exit;
        end if;
        if v_recorded_at<=p_event_time then
          v_contract:=a.new_state; v_audit_id:=a.id;
        end if;
        v_previous:=a.new_state; v_last_recorded_at:=v_recorded_at;
      end loop;
      if v_history_revision<>c.time_assurance_revision
        or v_previous is distinct from public.connector_time_contract_snapshot(c) then
        v_history_good:=false;
      end if;
    exception when data_exception then v_history_good:=false;
    end;
    if not v_history_good then
      v_contract:=null; v_audit_id:=null; v_state:='unproven';
    elsif v_contract is null then v_state:='unproven';
    else
      v_event_revision:=(v_contract->>'revision')::integer;
      v_tolerance:=(v_contract->>'tolerance_ms')::numeric;
      v_max_age:=(v_contract->>'max_observation_age_minutes')::integer;
      select * into o from public.connector_time_observations x
      where x.organization_id=v_org and x.connector_id=c.id
        and x.configuration_revision=v_event_revision
        and x.reference_clock_at<=p_event_time
        and x.received_at<=p_event_time
      order by x.reference_clock_at desc,x.received_at desc,x.id desc limit 1;
      if not found then v_state:='unproven';
      elsif o.reference_clock_at + make_interval(mins=>v_max_age)<p_event_time then
        v_state:='stale';
      else
        v_worst:=abs(o.offset_ms)+o.measurement_uncertainty_ms;
        v_state:=case when v_worst<=v_tolerance then 'synchronized' else 'untrusted' end;
      end if;
    end if;
  end if;
  return jsonb_build_object('connector_id',c.id,'event_time',p_event_time,
    'state',v_state,'within_clock_contract',v_state='synchronized',
    'contract_scope','recorded_contract_at_event',
    'history_integrity',case when c.time_sync_protocol is null or not c.enabled then 'unproven'
      when v_history_good then 'verified_recorded_chain' else 'unproven' end,
    'history_reason',case when not v_history_good then 'Clock contract history is incomplete or inconsistent.' end,
    'configuration_audit_id',v_audit_id,
    'configuration_evidence_verified',false,'eligible_for_time_sensitive_evidence',false,
    'observation_id',o.id,'configuration_revision',v_event_revision,
    'configuration_recorded_at',v_contract->>'configured_at',
    'worst_case_offset_ms',v_worst,'tolerance_ms',v_tolerance,
    'max_observation_age_minutes',v_max_age,
    'operational_authority',false,
    'note','Numerical posture against the recorded contract at event time only. Canonical configuration-evidence approval is not yet verified. A disabled connector remains ineligible; clock history does not reconstruct operational enablement, prove causality or authorize action.');
end
$$;

revoke all on function public.evaluate_connector_event_time(uuid,timestamptz)
  from public,anon,service_role;
grant execute on function public.evaluate_connector_event_time(uuid,timestamptz)
  to authenticated;

comment on table public.connector_time_observations is
  'Immutable, tenant-bound evidence of connector clock offset. Current trust is derived against the named-human clock contract; observations never change plant clocks or grant operational authority.';
comment on function public.record_connector_time_observation(
  uuid,text,text,timestamptz,timestamptz,numeric,numeric,text,text,integer
) is
  'Service-only, replay-safe ingestion bound to the explicitly expected clock-contract revision. Missing, superseded or unrecorded revisions are refused under the connector lock. Offset is calculated server-side; uncertainty cannot understate half the measured round-trip delay.';

notify pgrst,'reload schema';

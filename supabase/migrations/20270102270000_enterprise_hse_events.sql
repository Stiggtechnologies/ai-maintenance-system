-- C6.01 — governed enterprise safety and environmental event measures.
--
-- Canonical reuse:
--   * containment_losses remains the one process-safety loss-of-containment record;
--   * evidence_items remains the one independently verified evidence record;
--   * audit_events remains the one immutable audit ledger;
--   * kpi_catalog / kpi_values remain the one enterprise KPI service.
--
-- This migration adds the missing occupational/environmental event record and
-- an evidence-backed declaration of reporting coverage. Coverage is not a
-- target and it is not compliance certification. It exists because zero
-- recorded events without an attested reporting source means "no data", not
-- "zero events".

create table public.hse_reporting_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_ref text not null,
  version integer not null check (version > 0),
  supersedes_id uuid references public.hse_reporting_sources(id) on delete restrict,
  domain text not null check (domain in
    ('occupational_safety','process_safety','environmental')),
  scope text not null check (scope in ('enterprise','site')),
  site_id uuid references public.sites(id) on delete restrict,
  source_name text not null,
  source_kind text not null check (source_kind in
    ('manual_register','external_system','hybrid')),
  connector_id uuid references public.connectors(id) on delete restrict,
  status text not null check (status in ('active','inactive')),
  coverage_start timestamptz not null,
  coverage_end timestamptz,
  source_reference text not null,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  basis text not null,
  attested_by uuid not null references auth.users(id),
  attested_at timestamptz not null default now(),
  constraint hse_reporting_source_scope check (
    (scope='enterprise' and site_id is null)
    or (scope='site' and site_id is not null)),
  constraint hse_reporting_source_period check (
    coverage_end is null or coverage_end >= coverage_start),
  constraint hse_reporting_source_status_period check (
    (status='active' and coverage_end is null)
    or (status='inactive' and coverage_end is not null)),
  constraint hse_reporting_source_reference_length check (
    length(btrim(source_reference)) between 2 and 500),
  constraint hse_reporting_source_basis_length check (
    length(btrim(basis)) between 20 and 4000),
  unique (organization_id,source_ref,version),
  unique (supersedes_id)
);

create table public.hse_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_ref text not null,
  version integer not null check (version > 0),
  supersedes_id uuid references public.hse_events(id) on delete restrict,
  status text not null check (status in ('active','withdrawn')),
  domain text not null check (domain in ('occupational_safety','environmental')),
  event_type text not null check (event_type in (
    'injury','occupational_illness','exposure','unsafe_condition',
    'spill_release','permit_exceedance','water_nonconformance',
    'waste_nonconformance','wildlife_impact','other')),
  actuality text not null check (actuality in ('actual','near_miss')),
  occurred_at timestamptz not null,
  site_id uuid references public.sites(id) on delete restrict,
  asset_id uuid references public.assets(id) on delete restrict,
  containment_loss_id bigint references public.containment_losses(id) on delete restrict,
  recordability text not null check (recordability in
    ('recordable','not_recordable','pending_determination','not_applicable')),
  regulatory_reportability text not null check (regulatory_reportability in
    ('reportable','not_reportable','pending_determination','not_applicable')),
  severity_label text,
  severity_scale_reference text,
  description text not null,
  source_reference text not null,
  basis text not null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  verification_evidence_id uuid references public.evidence_items(id) on delete restrict,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  verification_note text,
  constraint hse_event_severity_basis check (
    (severity_label is null and severity_scale_reference is null)
    or (length(btrim(severity_label)) between 1 and 120
      and length(btrim(severity_scale_reference)) between 2 and 500)),
  constraint hse_event_description_length check (
    length(btrim(description)) between 20 and 4000),
  constraint hse_event_source_reference_length check (
    length(btrim(source_reference)) between 2 and 500),
  constraint hse_event_basis_length check (
    length(btrim(basis)) between 20 and 4000),
  constraint hse_event_verification_complete check (
    (verification_evidence_id is null and verified_by is null
      and verified_at is null and verification_note is null)
    or (verification_evidence_id is not null and verified_by is not null
      and verified_at is not null and length(btrim(verification_note)) between 20 and 4000)),
  unique (organization_id,event_ref,version),
  unique (supersedes_id)
);

create index hse_reporting_sources_org_domain_idx
  on public.hse_reporting_sources(organization_id,domain,scope,site_id,coverage_start);
create index hse_events_org_time_idx
  on public.hse_events(organization_id,occurred_at desc);
create index hse_events_org_domain_idx
  on public.hse_events(organization_id,domain,event_ref,version desc);
create index hse_events_containment_idx
  on public.hse_events(organization_id,containment_loss_id)
  where containment_loss_id is not null;

alter table public.hse_reporting_sources enable row level security;
alter table public.hse_events enable row level security;

create policy hse_reporting_sources_read on public.hse_reporting_sources
  for select to authenticated
  using (organization_id=public.app_current_org());
create policy hse_events_read on public.hse_events
  for select to authenticated
  using (organization_id=public.app_current_org());

create or replace function public.guard_hse_event_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if tg_op='TRUNCATE' then
    raise exception 'HSE event history cannot be truncated';
  end if;
  if coalesce(current_setting('app.hse_event_writer',true),'')<>'governed' then
    raise exception 'HSE records can change only through the governed C6.01 functions';
  end if;
  if tg_op='DELETE' then
    raise exception 'HSE records are retained; append a withdrawn or corrected version';
  end if;
  if tg_op='UPDATE' then
    if tg_table_name<>'hse_events' then
      raise exception 'HSE reporting-source history is append-only';
    end if;
    if (to_jsonb(new)-array['verification_evidence_id','verified_by','verified_at','verification_note'])
       is distinct from
       (to_jsonb(old)-array['verification_evidence_id','verified_by','verified_at','verification_note']) then
      raise exception 'HSE event identity, classification and source are immutable; append a corrected version';
    end if;
    if old.verified_at is not null then
      raise exception 'HSE event verification is immutable';
    end if;
  end if;
  return new;
end $$;

create trigger trg_hse_reporting_source_write
  before insert or update or delete on public.hse_reporting_sources
  for each row execute function public.guard_hse_event_write();
create trigger trg_hse_reporting_source_truncate
  before truncate on public.hse_reporting_sources
  for each statement execute function public.guard_hse_event_write();
create trigger trg_hse_event_write
  before insert or update or delete on public.hse_events
  for each row execute function public.guard_hse_event_write();
create trigger trg_hse_event_truncate
  before truncate on public.hse_events
  for each statement execute function public.guard_hse_event_write();

revoke all on function public.guard_hse_event_write()
  from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.hse_reporting_sources
  from anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.hse_events
  from anon,authenticated,service_role;
grant select on public.hse_reporting_sources,public.hse_events to authenticated;

create or replace function public.hse_assert_named_human(p_action text)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
begin
  if v_org is null or v_actor is null then
    raise exception '% requires an authenticated organization member',p_action;
  end if;
  if v_role='ai_admin' then
    raise exception 'ai_admin may read HSE posture but cannot %; a named human must make the classification',p_action;
  end if;
  if v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then
    raise exception '% requires an administrator, executive, maintenance manager or reliability engineer',p_action;
  end if;
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal()<>'aal2' then
    raise exception '% requires a verified factor and an AAL2 session',p_action;
  end if;
  return v_actor;
end $$;

revoke all on function public.hse_assert_named_human(text)
  from public,anon,authenticated,service_role;

create or replace function public.record_hse_reporting_source(p_source jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid;
  v_ref text:=nullif(btrim(p_source->>'sourceRef'),'');
  v_expected integer;
  v_latest public.hse_reporting_sources%rowtype;
  v_domain text:=nullif(p_source->>'domain','');
  v_scope text:=nullif(p_source->>'scope','');
  v_site uuid;
  v_connector uuid;
  v_status text:=nullif(p_source->>'status','');
  v_start timestamptz;
  v_end timestamptz;
  v_evidence uuid;
  v_id uuid;
  v_basis text:=nullif(btrim(p_source->>'basis'),'');
  v_source_reference text:=nullif(btrim(p_source->>'sourceReference'),'');
begin
  v_actor:=public.hse_assert_named_human('attest an HSE reporting source');
  begin
    v_expected:=coalesce(nullif(p_source->>'expectedVersion','')::integer,0);
    v_site:=nullif(p_source->>'siteId','')::uuid;
    v_connector:=nullif(p_source->>'connectorId','')::uuid;
    v_start:=(p_source->>'coverageStart')::timestamptz;
    v_end:=nullif(p_source->>'coverageEnd','')::timestamptz;
    v_evidence:=(p_source->>'evidenceItemId')::uuid;
  exception when others then
    return jsonb_build_object('error','Expected version, identifiers and coverage dates must be valid values');
  end;
  if v_ref is null or v_ref!~'^[A-Za-z0-9][A-Za-z0-9._/-]{2,79}$' then
    return jsonb_build_object('error','A stable 3-80 character reporting source reference is required');
  end if;
  if v_expected<0 then
    return jsonb_build_object('error','Expected version cannot be negative');
  end if;
  if v_domain not in ('occupational_safety','process_safety','environmental')
     or v_scope not in ('enterprise','site')
     or v_status not in ('active','inactive')
     or nullif(btrim(p_source->>'sourceName'),'') is null
     or nullif(p_source->>'sourceKind','') not in ('manual_register','external_system','hybrid') then
    return jsonb_build_object('error','Domain, scope, source name, source kind and status are required');
  end if;
  if (v_scope='enterprise' and v_site is not null)
     or (v_scope='site' and v_site is null) then
    return jsonb_build_object('error','Enterprise coverage cannot name a site; site coverage must name one');
  end if;
  if v_site is not null and not exists(
    select 1 from public.sites where id=v_site and organization_id=v_org
  ) then
    return jsonb_build_object('error','Reporting source site is outside the active tenant');
  end if;
  if v_connector is not null and not exists(
    select 1 from public.connectors
    where id=v_connector and organization_id=v_org
  ) then
    return jsonb_build_object('error','Connector is outside the active tenant');
  end if;
  if nullif(p_source->>'sourceKind','') in ('external_system','hybrid')
     and v_connector is null then
    return jsonb_build_object('error','External and hybrid sources must reference the canonical connector');
  end if;
  if nullif(p_source->>'sourceKind','')='manual_register' and v_connector is not null then
    return jsonb_build_object('error','A manual register cannot claim an external connector');
  end if;
  if v_start>now() or (v_end is not null and (v_end<v_start or v_end>now()))
     or (v_status='active' and v_end is not null)
     or (v_status='inactive' and v_end is null) then
    return jsonb_build_object('error','Coverage must start no later than now; active coverage is open-ended and inactive coverage has a non-future end');
  end if;
  if length(coalesce(v_basis,'')) not between 20 and 4000
     or length(coalesce(v_source_reference,'')) not between 2 and 500 then
    return jsonb_build_object('error','A 20-4000 character basis and bounded source reference are required');
  end if;
  if not exists(
    select 1 from public.evidence_items e
    join public.user_profiles verifier on verifier.id=e.verified_by
      and verifier.organization_id=e.organization_id
      and verifier.role in ('admin','executive','maintenance_manager','reliability_engineer')
    where e.id=v_evidence and e.organization_id=v_org
      and e.verification_status='verified'
      and e.verified_by is not null and e.verified_at is not null
      and e.verified_by<>v_actor
  ) then
    return jsonb_build_object('error','Same-tenant independently verified source-coverage evidence is required');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':hse-source:'||lower(v_ref),0));
  select * into v_latest from public.hse_reporting_sources
  where organization_id=v_org and lower(source_ref)=lower(v_ref)
  order by version desc limit 1 for update;
  if found and v_latest.version<>v_expected then
    return jsonb_build_object('error','Reporting source changed after it was loaded','currentVersion',v_latest.version);
  elsif not found and v_expected<>0 then
    return jsonb_build_object('error','Reporting source does not exist at the expected version');
  end if;

  perform set_config('app.hse_event_writer','governed',true);
  insert into public.hse_reporting_sources(
    organization_id,source_ref,version,supersedes_id,domain,scope,site_id,
    source_name,source_kind,connector_id,status,coverage_start,coverage_end,
    source_reference,evidence_item_id,basis,attested_by
  ) values(
    v_org,v_ref,v_expected+1,v_latest.id,v_domain,v_scope,v_site,
    btrim(p_source->>'sourceName'),p_source->>'sourceKind',v_connector,v_status,
    v_start,v_end,v_source_reference,v_evidence,v_basis,v_actor
  ) returning id into v_id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'hse_reporting_source',v_actor::text,jsonb_build_object(
    'event_type','hse_reporting_source_version_recorded','subject_id',v_id,
    'source_ref',v_ref,'version',v_expected+1,'domain',v_domain,'scope',v_scope,
    'site_id',v_site,'status',v_status,'coverage_start',v_start,'coverage_end',v_end,
    'evidence_item_id',v_evidence,'reportingCoverageComplete',false));

  return jsonb_build_object(
    'id',v_id,'sourceRef',v_ref,'version',v_expected+1,'status',v_status,
    'reportingCoverageAttested',true,'reportingCoverageComplete',false,
    'incidentClosed',false,'complianceCertified',false,'riskAccepted',false,
    'workAuthorized',false,'returnToServiceAuthorized',false);
end $$;

create or replace function public.record_hse_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid;
  v_ref text:=nullif(btrim(p_event->>'eventRef'),'');
  v_expected integer;
  v_latest public.hse_events%rowtype;
  v_status text:=nullif(p_event->>'status','');
  v_domain text:=nullif(p_event->>'domain','');
  v_type text:=nullif(p_event->>'eventType','');
  v_actuality text:=nullif(p_event->>'actuality','');
  v_occurred timestamptz;
  v_site uuid;
  v_asset uuid;
  v_loss bigint;
  v_id uuid;
  v_basis text:=nullif(btrim(p_event->>'basis'),'');
  v_source_reference text:=nullif(btrim(p_event->>'sourceReference'),'');
begin
  v_actor:=public.hse_assert_named_human('record or correct an HSE event');
  begin
    v_expected:=coalesce(nullif(p_event->>'expectedVersion','')::integer,0);
    v_occurred:=(p_event->>'occurredAt')::timestamptz;
    v_site:=nullif(p_event->>'siteId','')::uuid;
    v_asset:=nullif(p_event->>'assetId','')::uuid;
    v_loss:=nullif(p_event->>'containmentLossId','')::bigint;
  exception when others then
    return jsonb_build_object('error','Expected version, occurrence time and identifiers must be valid values');
  end;
  if v_ref is null or v_ref!~'^[A-Za-z0-9][A-Za-z0-9._/-]{2,79}$' then
    return jsonb_build_object('error','A stable 3-80 character event reference is required');
  end if;
  if v_expected<0 then
    return jsonb_build_object('error','Expected version cannot be negative');
  end if;
  if v_status not in ('active','withdrawn')
     or v_domain not in ('occupational_safety','environmental')
     or v_actuality not in ('actual','near_miss')
     or v_type not in ('injury','occupational_illness','exposure','unsafe_condition',
       'spill_release','permit_exceedance','water_nonconformance',
       'waste_nonconformance','wildlife_impact','other') then
    return jsonb_build_object('error','Status, domain, event type and actuality must use the governed vocabulary');
  end if;
  if (v_domain='occupational_safety' and v_type not in
       ('injury','occupational_illness','exposure','unsafe_condition','other'))
     or (v_domain='environmental' and v_type not in
       ('spill_release','permit_exceedance','water_nonconformance',
        'waste_nonconformance','wildlife_impact','other')) then
    return jsonb_build_object('error','Event type is not valid for the selected domain');
  end if;
  if nullif(p_event->>'recordability','') not in
       ('recordable','not_recordable','pending_determination','not_applicable')
     or nullif(p_event->>'regulatoryReportability','') not in
       ('reportable','not_reportable','pending_determination','not_applicable') then
    return jsonb_build_object('error','Recordability and regulatory reportability must be explicit, including pending or not applicable');
  end if;
  if v_domain='occupational_safety'
     and nullif(p_event->>'recordability','')='not_applicable' then
    return jsonb_build_object('error','Occupational-safety recordability cannot be marked not applicable; record the human determination or pending state');
  end if;
  if v_domain='environmental'
     and nullif(p_event->>'regulatoryReportability','')='not_applicable' then
    return jsonb_build_object('error','Environmental reportability cannot be marked not applicable; record the human determination or pending state');
  end if;
  if v_occurred>now()+interval '5 minutes' then
    return jsonb_build_object('error','HSE event occurrence cannot be in the future');
  end if;
  if v_site is not null and not exists(
    select 1 from public.sites where id=v_site and organization_id=v_org
  ) then
    return jsonb_build_object('error','Site is outside the active tenant');
  end if;
  if v_asset is not null and not exists(
    select 1 from public.assets where id=v_asset and organization_id=v_org
  ) then
    return jsonb_build_object('error','Asset is outside the active tenant');
  end if;
  if v_asset is not null and v_site is not null and not exists(
    select 1 from public.assets
    where id=v_asset and organization_id=v_org and site_id=v_site
  ) then
    return jsonb_build_object('error','Asset does not belong to the selected site');
  end if;
  if v_loss is not null then
    if v_domain<>'environmental' or v_type<>'spill_release' or v_actuality<>'actual' then
      return jsonb_build_object('error','A containment loss can only supplement an actual environmental spill/release classification');
    end if;
    if not exists(
      select 1 from public.containment_losses l
      where l.id=v_loss and l.organization_id=v_org and l.reached_environment
        and (v_asset is null or l.asset_id is null or l.asset_id=v_asset)
    ) then
      return jsonb_build_object('error','Containment loss is outside the tenant, did not reach the environment or conflicts with the selected asset');
    end if;
  end if;
  if length(btrim(coalesce(p_event->>'description',''))) not between 20 and 4000
     or length(coalesce(v_basis,'')) not between 20 and 4000
     or length(coalesce(v_source_reference,'')) not between 2 and 500 then
    return jsonb_build_object('error','Description, substantive basis and bounded source reference are required');
  end if;
  if (nullif(btrim(p_event->>'severityLabel'),'') is null)
     <> (nullif(btrim(p_event->>'severityScaleReference'),'') is null) then
    return jsonb_build_object('error','A severity label requires the exact human-approved scale reference, and vice versa');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':hse-event:'||lower(v_ref),0));
  select * into v_latest from public.hse_events
  where organization_id=v_org and lower(event_ref)=lower(v_ref)
  order by version desc limit 1 for update;
  if found and v_latest.version<>v_expected then
    return jsonb_build_object('error','HSE event changed after it was loaded','currentVersion',v_latest.version);
  elsif not found and v_expected<>0 then
    return jsonb_build_object('error','HSE event does not exist at the expected version');
  elsif not found and v_status='withdrawn' then
    return jsonb_build_object('error','A new event cannot begin withdrawn');
  end if;

  perform set_config('app.hse_event_writer','governed',true);
  insert into public.hse_events(
    organization_id,event_ref,version,supersedes_id,status,domain,event_type,
    actuality,occurred_at,site_id,asset_id,containment_loss_id,recordability,
    regulatory_reportability,severity_label,severity_scale_reference,
    description,source_reference,basis,recorded_by
  ) values(
    v_org,v_ref,v_expected+1,v_latest.id,v_status,v_domain,v_type,v_actuality,
    v_occurred,v_site,v_asset,v_loss,p_event->>'recordability',
    p_event->>'regulatoryReportability',nullif(btrim(p_event->>'severityLabel'),''),
    nullif(btrim(p_event->>'severityScaleReference'),''),btrim(p_event->>'description'),
    v_source_reference,v_basis,v_actor
  ) returning id into v_id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'hse_event',v_actor::text,jsonb_build_object(
    'event_type','hse_event_version_recorded','subject_id',v_id,'event_ref',v_ref,
    'version',v_expected+1,'status',v_status,'domain',v_domain,'actuality',v_actuality,
    'occurred_at',v_occurred,'site_id',v_site,'asset_id',v_asset,
    'containment_loss_id',v_loss,'source_reference',v_source_reference));

  return jsonb_build_object(
    'id',v_id,'eventRef',v_ref,'version',v_expected+1,'status',v_status,
    'incidentClosed',false,'complianceCertified',false,'riskAccepted',false,
    'workAuthorized',false,'returnToServiceAuthorized',false);
end $$;

create or replace function public.verify_hse_event(
  p_event_id uuid,p_evidence_item_id uuid,p_note text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid;
  v_event public.hse_events%rowtype;
begin
  v_actor:=public.hse_assert_named_human('verify an HSE event classification');
  select * into v_event from public.hse_events
  where id=p_event_id and organization_id=v_org
  for update;
  if not found then
    return jsonb_build_object('error','HSE event not found');
  end if;
  if v_event.status<>'active' or exists(
    select 1 from public.hse_events newer
    where newer.organization_id=v_org and newer.event_ref=v_event.event_ref
      and newer.version>v_event.version
  ) then
    return jsonb_build_object('error','Only the latest active HSE event version can be verified');
  end if;
  if v_event.verified_at is not null then
    return jsonb_build_object('error','HSE event version is already verified');
  end if;
  if v_event.recorded_by=v_actor then
    return jsonb_build_object('error','Independent verification requires a named human other than the event recorder');
  end if;
  if length(btrim(coalesce(p_note,''))) not between 20 and 4000 then
    return jsonb_build_object('error','A 20-4000 character verification note is required');
  end if;
  if not exists(
    select 1 from public.evidence_items e
    join public.user_profiles verifier on verifier.id=e.verified_by
      and verifier.organization_id=e.organization_id
      and verifier.role in ('admin','executive','maintenance_manager','reliability_engineer')
    where e.id=p_evidence_item_id and e.organization_id=v_org
      and e.verification_status='verified'
      and e.verified_by is not null and e.verified_at is not null
      and e.verified_by<>v_event.recorded_by
      and (e.asset_id is null or v_event.asset_id is null or e.asset_id=v_event.asset_id)
  ) then
    return jsonb_build_object('error','Same-tenant evidence independently verified from the event recorder is required');
  end if;

  perform set_config('app.hse_event_writer','governed',true);
  update public.hse_events set
    verification_evidence_id=p_evidence_item_id,
    verified_by=v_actor,verified_at=now(),verification_note=btrim(p_note)
  where id=v_event.id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'hse_event',v_actor::text,jsonb_build_object(
    'event_type','hse_event_classification_verified','subject_id',v_event.id,
    'event_ref',v_event.event_ref,'version',v_event.version,
    'evidence_item_id',p_evidence_item_id,
    'incidentClosed',false,'complianceCertified',false,'riskAccepted',false,
    'workAuthorized',false,'returnToServiceAuthorized',false));

  return jsonb_build_object(
    'id',v_event.id,'eventRef',v_event.event_ref,'version',v_event.version,
    'verified',true,'incidentClosed',false,'complianceCertified',false,
    'riskAccepted',false,'workAuthorized',false,'returnToServiceAuthorized',false);
end $$;

create or replace function public.hse_reporting_coverage_complete(
  p_org uuid,p_domain text,p_from timestamptz,p_to timestamptz
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with latest as (
    select distinct on (lower(source_ref)) *
    from public.hse_reporting_sources
    where organization_id=p_org and domain=p_domain
    order by lower(source_ref),version desc
  ), valid as (
    select * from latest
    where coverage_start<=p_from
      and coalesce(coverage_end,'infinity'::timestamptz)>=p_to
  )
  select exists(select 1 from valid where scope='enterprise')
    or (
      exists(select 1 from public.sites where organization_id=p_org)
      and not exists(
        select 1 from public.sites s
        where s.organization_id=p_org
          and not exists(select 1 from valid v where v.scope='site' and v.site_id=s.id)
      )
    )
$$;

create or replace function public.sync_enterprise_hse_metrics(
  p_org uuid,p_from timestamptz,p_to timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with latest_events as (
    select distinct on (lower(event_ref)) *
    from public.hse_events
    where organization_id=p_org
    order by lower(event_ref),version desc
  ), active_events as (
    select * from latest_events
    where status='active' and occurred_at>=p_from and occurred_at<p_to
  ), safety_events as (
    select 'hse:'||id::text as source_key,actuality,
      (verified_at is not null) as independently_verified,
      recordability='pending_determination' as classification_pending,
      false as human_recorded_containment
    from active_events where domain='occupational_safety'
    union all
    select 'loc:'||id::text,
      case when tier in ('tier_1','tier_2') then 'actual'
        when tier in ('tier_3','tier_4') then 'near_miss' end,
      false,false,true
    from public.containment_losses
    where organization_id=p_org and occurred_at>=p_from and occurred_at<p_to
  ), environmental_events as (
    select case when containment_loss_id is null then 'hse:'||id::text
      else 'loc:'||containment_loss_id::text end as source_key,
      actuality,(verified_at is not null) as independently_verified,
      regulatory_reportability='pending_determination' as classification_pending,
      false as human_recorded_containment
    from active_events where domain='environmental'
    union all
    select 'loc:'||l.id::text,'actual',false,true,true
    from public.containment_losses l
    where l.organization_id=p_org and l.occurred_at>=p_from and l.occurred_at<p_to
      and l.reached_environment
      and not exists(
        select 1 from active_events e
        where e.domain='environmental' and e.containment_loss_id=l.id
      )
  ), safety_rollup as (
    select count(*) filter(where actuality='actual')::integer actual_events,
      count(*) filter(where actuality='near_miss')::integer near_misses,
      count(*) filter(where independently_verified)::integer independently_verified,
      count(*) filter(where classification_pending)::integer classification_pending,
      count(*) filter(where human_recorded_containment)::integer containment_events
    from safety_events
  ), environmental_rollup as (
    select count(distinct source_key) filter(where actuality='actual')::integer actual_events,
      count(distinct source_key) filter(where actuality='near_miss')::integer near_misses,
      count(distinct source_key) filter(where independently_verified)::integer independently_verified,
      count(distinct source_key) filter(where classification_pending)::integer classification_pending,
      count(distinct source_key) filter(where human_recorded_containment)::integer containment_events
    from environmental_events
  ), coverage as (
    select public.hse_reporting_coverage_complete(p_org,'occupational_safety',p_from,p_to)
       and public.hse_reporting_coverage_complete(p_org,'process_safety',p_from,p_to)
       as safety_complete,
      public.hse_reporting_coverage_complete(p_org,'environmental',p_from,p_to)
       as environmental_complete
  ), gap_rollup as (
    select count(*) filter(where verification_evidence_id is null)::integer unverified,
      count(*) filter(where asset_id is null)::integer without_asset,
      count(*) filter(where site_id is null)::integer without_site
    from active_events
  )
  select jsonb_build_object(
    'window',jsonb_build_object('from',p_from,'to',p_to),
    'safety',jsonb_build_object(
      'reportingCoverageComplete',c.safety_complete,
      'actualEvents',case when c.safety_complete then s.actual_events else null end,
      'nearMisses',case when c.safety_complete then s.near_misses else null end,
      'independentlyVerified',s.independently_verified,
      'pendingClassification',s.classification_pending,
      'humanRecordedContainmentLosses',s.containment_events,
      'basis',case when c.safety_complete
        then 'Recorded occupational events plus canonical containment losses. API 754 tiers 1-2 are actual process-safety events and tiers 3-4 are leading/near-miss events; sources are counted once.'
        else 'Awaiting reporting coverage for both occupational and process safety; no zero is inferred.' end),
    'environmental',jsonb_build_object(
      'reportingCoverageComplete',c.environmental_complete,
      'actualEvents',case when c.environmental_complete then e.actual_events else null end,
      'nearMisses',case when c.environmental_complete then e.near_misses else null end,
      'independentlyVerified',e.independently_verified,
      'pendingClassification',e.classification_pending,
      'humanRecordedContainmentLosses',e.containment_events,
      'basis',case when c.environmental_complete
        then 'Recorded environmental events plus canonical containment losses that reached the environment. A linked event and containment loss are countedOnce.'
        else 'Awaiting reporting coverage for environmental events; no zero is inferred.' end),
    'gaps',jsonb_build_object('unverifiedEvents',g.unverified,
      'eventsWithoutAsset',g.without_asset,'eventsWithoutSite',g.without_site),
    'decisionBoundary','Counts are recorded-event measures. They do not close incidents, certify compliance, accept risk, authorize work or return equipment to service.'
  )
  from safety_rollup s cross join environmental_rollup e
  cross join coverage c cross join gap_rollup g
$$;

create or replace function public.get_enterprise_hse_workspace(
  p_window_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text:=public.app_current_role();
  v_days integer:=coalesce(p_window_days,30);
  v_to timestamptz:=now();
  v_from timestamptz;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication and an active tenant are required');
  end if;
  if v_days<1 or v_days>366 then
    return jsonb_build_object('error','Window days must be between 1 and 366');
  end if;
  v_from:=v_to-make_interval(days=>v_days);
  return jsonb_build_object(
    'canRecord',v_role in ('admin','executive','maintenance_manager','reliability_engineer'),
    'requiredAal','aal2',
    'metrics',public.sync_enterprise_hse_metrics(v_org,v_from,v_to),
    'sites',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name)
      from public.sites s where s.organization_id=v_org),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,
        'tag',a.tag,'siteId',a.site_id) order by a.name)
      from public.assets a where a.organization_id=v_org),'[]'::jsonb),
    'connectors',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,
        'type',c.connector_type,'status',c.status) order by c.name)
      from public.connectors c where c.organization_id=v_org),'[]'::jsonb),
    'verifiedEvidence',coalesce((select jsonb_agg(jsonb_build_object(
        'id',e.id,'description',e.description,'sourceSystem',e.source_system,
        'assetId',e.asset_id,'verifiedBy',e.verified_by,'verifiedAt',e.verified_at)
        order by e.verified_at desc)
      from (select evidence.* from public.evidence_items evidence
        join public.user_profiles verifier on verifier.id=evidence.verified_by
          and verifier.organization_id=evidence.organization_id
          and verifier.role in ('admin','executive','maintenance_manager','reliability_engineer')
        where evidence.organization_id=v_org
          and evidence.verification_status='verified'
          and evidence.verified_by is not null and evidence.verified_at is not null
        order by evidence.verified_at desc limit 100) e),'[]'::jsonb),
    'reportingSources',coalesce((select jsonb_agg(jsonb_build_object(
        'id',x.id,'sourceRef',x.source_ref,'version',x.version,'domain',x.domain,
        'scope',x.scope,'siteId',x.site_id,'sourceName',x.source_name,
        'sourceKind',x.source_kind,'connectorId',x.connector_id,'status',x.status,
        'coverageStart',x.coverage_start,'coverageEnd',x.coverage_end,
        'sourceReference',x.source_reference,'evidenceItemId',x.evidence_item_id,
        'attestedBy',x.attested_by,'attestedAt',x.attested_at)
        order by x.domain,x.source_ref)
      from (select distinct on (lower(source_ref)) *
        from public.hse_reporting_sources where organization_id=v_org
        order by lower(source_ref),version desc) x),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object(
        'id',x.id,'eventRef',x.event_ref,'version',x.version,'status',x.status,
        'domain',x.domain,'eventType',x.event_type,'actuality',x.actuality,
        'occurredAt',x.occurred_at,'siteId',x.site_id,'assetId',x.asset_id,
        'containmentLossId',x.containment_loss_id,'recordability',x.recordability,
        'regulatoryReportability',x.regulatory_reportability,
        'severityLabel',x.severity_label,'severityScaleReference',x.severity_scale_reference,
        'description',x.description,'sourceReference',x.source_reference,'basis',x.basis,
        'recordedBy',x.recorded_by,'recordedAt',x.recorded_at,
        'verificationEvidenceId',x.verification_evidence_id,
        'verifiedBy',x.verified_by,'verifiedAt',x.verified_at,
        'verificationNote',x.verification_note)
        order by x.occurred_at desc)
      from (select distinct on (lower(event_ref)) * from public.hse_events
        where organization_id=v_org order by lower(event_ref),version desc) x),'[]'::jsonb),
    'containmentLosses',coalesce((select jsonb_agg(jsonb_build_object(
        'id',l.id,'occurredAt',l.occurred_at,'assetId',l.asset_id,'substance',l.substance,
        'quantity',l.quantity,'quantityUnit',l.quantity_unit,'tier',l.tier,
        'reachedEnvironment',l.reached_environment,'investigationReference',l.investigation_reference)
        order by l.occurred_at desc)
      from (select loss.* from public.containment_losses loss
        where loss.organization_id=v_org and loss.occurred_at>=v_from
        order by loss.occurred_at desc limit 100) l),'[]'::jsonb),
    'decisionBoundary','HSE reporting records facts and human classifications. It does not close an incident, certify compliance, accept risk, authorize work or return equipment to service.'
  );
end $$;

revoke all on function public.record_hse_reporting_source(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.record_hse_event(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.verify_hse_event(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.hse_reporting_coverage_complete(uuid,text,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.sync_enterprise_hse_metrics(uuid,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.get_enterprise_hse_workspace(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.record_hse_reporting_source(jsonb) to authenticated;
grant execute on function public.record_hse_event(jsonb) to authenticated;
grant execute on function public.verify_hse_event(uuid,uuid,text) to authenticated;
grant execute on function public.get_enterprise_hse_workspace(integer) to authenticated;

-- Remove the unsafe work-order proxy and its derived history. A safety-flagged
-- maintenance order is not an incident. Keeping those values would preserve a
-- known false enterprise claim, so the derived KPI rows are deliberately
-- discarded while the work orders themselves remain untouched.
delete from public.kpi_catalog where kpi_key='asset_safety_incidents';

insert into public.kpi_catalog(
  kpi_key,name,page,formula,target_label,direction,target_low,target_high,unit,
  accountable,responsible,consulted,informed,agent_owner,audience,computable,source_note
) values
  ('enterprise_safety_events_30d','Safety events (30 days)','risk_safety',
   'Recorded occupational actual events + API 754 tier 1/2 containment losses','0','down',null,0,'count',
   'HSE','Safety','Operations','Executive','compliance_auditing',null,true,
   'Requires attested occupational- and process-safety reporting coverage; no coverage means Awaiting source, not zero'),
  ('enterprise_environmental_events_30d','Environmental events (30 days)','sustainability',
   'Recorded environmental actual events + containment losses reaching the environment, deduplicated','0','down',null,0,'count',
   'HSE','Environment','Operations','Executive','compliance_auditing',null,true,
   'Requires attested environmental reporting coverage; no coverage means Awaiting source, not zero')
on conflict(kpi_key) do update set
  name=excluded.name,page=excluded.page,formula=excluded.formula,
  target_label=excluded.target_label,direction=excluded.direction,
  target_low=excluded.target_low,target_high=excluded.target_high,unit=excluded.unit,
  accountable=excluded.accountable,responsible=excluded.responsible,
  consulted=excluded.consulted,informed=excluded.informed,
  agent_owner=excluded.agent_owner,audience=excluded.audience,
  computable=excluded.computable,source_note=excluded.source_note;

-- Preserve the existing broad KPI computation unchanged under an internal
-- name, then compose it with the governed HSE computation at the public job
-- entry point. This avoids copying hundreds of lines or creating a second KPI
-- fact store.
alter function public.compute_kpi_snapshot() rename to compute_general_kpi_snapshot;

revoke all on function public.compute_general_kpi_snapshot()
  from public,anon,authenticated;
grant execute on function public.compute_general_kpi_snapshot() to service_role;

create or replace function public.compute_enterprise_hse_kpi_snapshot()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid;
  v_metrics jsonb;
  v_value numeric;
  v_written integer:=0;
  v_key text;
  v_section text;
begin
  for v_org in select id from public.organizations loop
    v_metrics:=public.sync_enterprise_hse_metrics(
      v_org,now()-interval '30 days',now());

    -- These are rolling current-state measures. Remove the prior derived
    -- snapshot before evaluating coverage so an expired or withdrawn source
    -- can never leave a stale numeric value on the executive dashboard.
    delete from public.kpi_values
    where organization_id=v_org and kpi_key in
      ('enterprise_safety_events_30d','enterprise_environmental_events_30d');

    for v_key,v_section in values
      ('enterprise_safety_events_30d','safety'),
      ('enterprise_environmental_events_30d','environmental')
    loop
      if coalesce((v_metrics->v_section->>'reportingCoverageComplete')::boolean,false) then
        v_value:=(v_metrics->v_section->>'actualEvents')::numeric;
        insert into public.kpi_values(
          organization_id,kpi_key,value,status,variance_pct,confidence,computed_from
        ) values(
          v_org,v_key,v_value,case when v_value=0 then 'on_target' else 'breach' end,
          null,'high',jsonb_build_object(
            'source','Governed HSE event register + canonical containment-loss register',
            'window',v_metrics->'window','basis',v_metrics->v_section->'basis',
            'reportingCoverageComplete',true,
            'pendingClassification',v_metrics->v_section->'pendingClassification',
            'independentlyVerified',v_metrics->v_section->'independentlyVerified'));
        v_written:=v_written+1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('kpi_values_written',v_written,'ran_at',now());
end $$;

revoke all on function public.compute_enterprise_hse_kpi_snapshot()
  from public,anon,authenticated;
grant execute on function public.compute_enterprise_hse_kpi_snapshot() to service_role;

create or replace function public.compute_kpi_snapshot()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_general jsonb;
  v_hse jsonb;
begin
  v_general:=public.compute_general_kpi_snapshot();
  v_hse:=public.compute_enterprise_hse_kpi_snapshot();
  return jsonb_build_object('general',v_general,'hse',v_hse,'ran_at',now());
end $$;

revoke all on function public.compute_kpi_snapshot()
  from public,anon,authenticated;
grant execute on function public.compute_kpi_snapshot() to service_role;

comment on table public.hse_events is
  'C6.01 canonical, versioned occupational-safety and environmental event record. Process-safety containment events remain canonical in containment_losses.';
comment on table public.hse_reporting_sources is
  'C6.01 evidence-backed reporting coverage. A zero KPI is emitted only when the complete enterprise reporting window is covered.';
comment on function public.sync_enterprise_hse_metrics(uuid,timestamptz,timestamptz) is
  'C6.01 deterministic safety/environment event rollup. Linked environmental event and containment-loss evidence are countedOnce; domains are never combined into one score.';

notify pgrst,'reload schema';

-- E12.14 — governed data residency and sovereignty.
--
-- Canonical reuse:
--   deployment_instances is the ONE deployment identity and policy head;
--   audit_events is the ONE governance audit ledger;
--   existing retention/archive controls remain authoritative for retention.
-- This ledger records asserted processing topology and its evidence. It does
-- not claim that SyncAI moved data or configured any provider resource.

alter table public.deployment_instances
  add column if not exists deployment_environment text not null default 'evaluation',
  add column if not exists residency_status text not null default 'unconfigured',
  add column if not exists residency_policy_revision integer not null default 0,
  add column if not exists residency_jurisdictions text[] not null default '{}',
  add column if not exists residency_permitted_countries text[] not null default '{}',
  add column if not exists residency_permitted_regions text[] not null default '{}',
  add column if not exists residency_data_classes text[] not null default '{}',
  add column if not exists residency_cross_border_basis text,
  add column if not exists residency_authority_reference text,
  add column if not exists residency_evidence_basis text,
  add column if not exists residency_configured_by uuid references auth.users(id),
  add column if not exists residency_configured_at timestamptz,
  add column if not exists residency_verified_by uuid references auth.users(id),
  add column if not exists residency_verified_at timestamptz,
  add column if not exists residency_verification_basis text;

alter table public.deployment_instances drop constraint if exists deployment_instances_environment_check;
alter table public.deployment_instances add constraint deployment_instances_environment_check
  check (deployment_environment in ('evaluation','pilot','production'));
alter table public.deployment_instances drop constraint if exists deployment_instances_residency_status_check;
alter table public.deployment_instances add constraint deployment_instances_residency_status_check
  check (residency_status in ('unconfigured','draft','verified','blocked'));

create table if not exists public.deployment_data_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deployment_id uuid not null references public.deployment_instances(id) on delete cascade,
  policy_revision integer not null check (policy_revision > 0),
  location_key text not null check (btrim(location_key) <> ''),
  data_plane text not null check (data_plane in (
    'application','database','object_storage','backup','logging','ai_inference',
    'analytics','support','email','integration'
  )),
  provider text not null check (btrim(provider) <> ''),
  service text not null check (btrim(service) <> ''),
  region_code text not null check (btrim(region_code) <> ''),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  processing_activities text[] not null,
  data_classes text[] not null,
  evidence_reference text not null check (length(btrim(evidence_reference)) >= 3),
  evidence_basis text not null check (length(btrim(evidence_basis)) >= 20),
  status text not null default 'declared' check (status in ('declared','verified','superseded','rejected')),
  declared_by uuid not null references auth.users(id),
  declared_at timestamptz not null default now(),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  verification_basis text,
  supersedes_id uuid references public.deployment_data_locations(id),
  superseded_by_id uuid references public.deployment_data_locations(id),
  created_at timestamptz not null default now(),
  check (cardinality(processing_activities) > 0),
  check (processing_activities <@ array['store','process','transmit','support']::text[]),
  check (cardinality(data_classes) > 0)
);

comment on table public.deployment_data_locations is
  'E12.14 append-only evidence ledger for declared cloud processing locations. A verified row proves review of the named evidence only; it does not move data or configure provider resources.';

create index if not exists deployment_data_locations_current_idx
  on public.deployment_data_locations (organization_id, deployment_id, policy_revision, data_plane, status);
create unique index if not exists deployment_data_locations_active_key
  on public.deployment_data_locations (organization_id, deployment_id, policy_revision, location_key)
  where status in ('declared','verified');

alter table public.deployment_data_locations enable row level security;
drop policy if exists deployment_data_locations_read on public.deployment_data_locations;
create policy deployment_data_locations_read on public.deployment_data_locations
  for select to authenticated using (organization_id = public.app_current_org());
revoke all on public.deployment_data_locations from public, anon, authenticated;
grant select on public.deployment_data_locations to authenticated;

create or replace function public.guard_residency_governance_rows()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if coalesce(current_setting('app.residency_governed_write',true),'') <> 'on' then
    if tg_op='INSERT' then
      if new.deployment_environment <> 'evaluation' or new.residency_status <> 'unconfigured'
         or new.residency_policy_revision <> 0 or cardinality(new.residency_jurisdictions) > 0
         or cardinality(new.residency_permitted_countries) > 0
         or cardinality(new.residency_permitted_regions) > 0
         or cardinality(new.residency_data_classes) > 0 then
        raise exception 'residency policy fields require governed named-human controls';
      end if;
    elsif (new.deployment_environment,new.residency_status,new.residency_policy_revision,
           new.residency_jurisdictions,new.residency_permitted_countries,new.residency_permitted_regions,
           new.residency_data_classes,new.residency_cross_border_basis,new.residency_authority_reference,
           new.residency_evidence_basis,new.residency_configured_by,new.residency_configured_at,
           new.residency_verified_by,new.residency_verified_at,new.residency_verification_basis)
       is distinct from
          (old.deployment_environment,old.residency_status,old.residency_policy_revision,
           old.residency_jurisdictions,old.residency_permitted_countries,old.residency_permitted_regions,
           old.residency_data_classes,old.residency_cross_border_basis,old.residency_authority_reference,
           old.residency_evidence_basis,old.residency_configured_by,old.residency_configured_at,
           old.residency_verified_by,old.residency_verified_at,old.residency_verification_basis) then
      raise exception 'residency policy fields require governed named-human controls';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_residency_governance_rows on public.deployment_instances;
create trigger guard_residency_governance_rows before insert or update on public.deployment_instances
  for each row execute function public.guard_residency_governance_rows();

create or replace function public.guard_deployment_data_location_immutability()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if coalesce(current_setting('app.residency_governed_write',true),'') <> 'on' then
    raise exception 'deployment location evidence is append-only and requires governed controls';
  end if;
  if tg_op='DELETE' then raise exception 'deployment location evidence cannot be deleted'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists guard_deployment_data_location_immutability on public.deployment_data_locations;
create trigger guard_deployment_data_location_immutability before insert or update or delete on public.deployment_data_locations
  for each row execute function public.guard_deployment_data_location_immutability();

create or replace function public.residency_named_human_admin()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and public.app_current_role() in ('admin','executive','manager','plant_manager','operations_manager');
$$;
revoke all on function public.residency_named_human_admin() from public,anon;
grant execute on function public.residency_named_human_admin() to authenticated;

create or replace function public.configure_deployment_residency(p_deployment_id uuid,p_policy jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); d public.deployment_instances%rowtype;
  v_j text[]; v_c text[]; v_r text[]; v_dc text[]; v_rev integer;
begin
  if v_org is null or not public.residency_named_human_admin() then return jsonb_build_object('error','a named human administrator is required'); end if;
  select * into d from public.deployment_instances where id=p_deployment_id and organization_id=v_org for update;
  if d.id is null then return jsonb_build_object('error','deployment not found in this tenant'); end if;
  select coalesce(array_agg(upper(btrim(x)) order by upper(btrim(x))),'{}') into v_c from jsonb_array_elements_text(coalesce(p_policy->'permitted_countries','[]')) x;
  select coalesce(array_agg(btrim(x) order by btrim(x)),'{}') into v_r from jsonb_array_elements_text(coalesce(p_policy->'permitted_regions','[]')) x;
  select coalesce(array_agg(btrim(x) order by btrim(x)),'{}') into v_j from jsonb_array_elements_text(coalesce(p_policy->'jurisdictions','[]')) x;
  select coalesce(array_agg(btrim(x) order by btrim(x)),'{}') into v_dc from jsonb_array_elements_text(coalesce(p_policy->'data_classes','[]')) x;
  if cardinality(v_c)=0 or exists(select 1 from unnest(v_c) x where x !~ '^[A-Z]{2}$') then return jsonb_build_object('error','at least one ISO alpha-2 permitted country is required'); end if;
  if cardinality(v_r)=0 or cardinality(v_j)=0 or cardinality(v_dc)=0
     or exists(select 1 from unnest(v_r||v_j||v_dc) x where btrim(x)='') then
    return jsonb_build_object('error','non-empty jurisdictions, provider regions and data classes are required');
  end if;
  if cardinality(v_c)>1 and length(btrim(coalesce(p_policy->>'cross_border_basis','')))<20 then
    return jsonb_build_object('error','a substantive cross-border transfer basis is required when more than one country is permitted');
  end if;
  if length(btrim(coalesce(p_policy->>'authority_reference','')))<3 or length(btrim(coalesce(p_policy->>'evidence_basis','')))<20 then return jsonb_build_object('error','authority reference and substantive evidence basis are required'); end if;
  v_rev:=d.residency_policy_revision+1;
  perform set_config('app.residency_governed_write','on',true);
  update public.deployment_instances set residency_status='draft',residency_policy_revision=v_rev,
    residency_jurisdictions=v_j,residency_permitted_countries=v_c,residency_permitted_regions=v_r,
    residency_data_classes=v_dc,residency_cross_border_basis=nullif(btrim(p_policy->>'cross_border_basis'),''),
    residency_authority_reference=btrim(p_policy->>'authority_reference'),residency_evidence_basis=btrim(p_policy->>'evidence_basis'),
    residency_configured_by=v_actor,residency_configured_at=now(),residency_verified_by=null,residency_verified_at=null,residency_verification_basis=null
  where id=d.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'deployment_residency_policy',public.app_current_role(),
    jsonb_build_object('deployment_id',d.id,'revision',v_rev,'action','configured','actor_user_id',v_actor,'boundary','records approved location constraints; does not relocate data'));
  return jsonb_build_object('deployment_id',d.id,'policy_revision',v_rev,'status','draft');
end $$;

create or replace function public.record_deployment_data_location(p_deployment_id uuid,p_location jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); d public.deployment_instances%rowtype; v_id uuid; v_old uuid;
  v_country text:=upper(btrim(p_location->>'country_code')); v_region text:=btrim(p_location->>'region_code'); v_dc text[]; v_acts text[];
begin
  if v_org is null or not public.residency_named_human_admin() then return jsonb_build_object('error','a named human administrator is required'); end if;
  select * into d from public.deployment_instances where id=p_deployment_id and organization_id=v_org;
  if d.id is null then return jsonb_build_object('error','deployment not found in this tenant'); end if;
  if d.residency_policy_revision=0 then return jsonb_build_object('error','configure the residency policy first'); end if;
  select coalesce(array_agg(btrim(x)),'{}') into v_dc from jsonb_array_elements_text(coalesce(p_location->'data_classes','[]')) x;
  select coalesce(array_agg(lower(btrim(x))),'{}') into v_acts from jsonb_array_elements_text(coalesce(p_location->'processing_activities','[]')) x;
  if not (v_country=any(d.residency_permitted_countries)) then return jsonb_build_object('error','country is not permitted by the current policy'); end if;
  if not (v_region=any(d.residency_permitted_regions)) then return jsonb_build_object('error','provider region is not permitted by the current policy'); end if;
  if cardinality(v_dc)=0 or not (v_dc <@ d.residency_data_classes) then return jsonb_build_object('error','data classes must be a non-empty subset of the current policy'); end if;
  if cardinality(v_acts)=0 or not (v_acts <@ array['store','process','transmit','support']::text[]) then return jsonb_build_object('error','processing activities are invalid'); end if;
  if coalesce(p_location->>'data_plane','') not in ('application','database','object_storage','backup','logging','ai_inference','analytics','support','email','integration') then return jsonb_build_object('error','data plane is invalid'); end if;
  if length(btrim(coalesce(p_location->>'provider','')))<2 or length(btrim(coalesce(p_location->>'service','')))<2 or length(btrim(coalesce(p_location->>'location_key','')))<2 then return jsonb_build_object('error','location key, provider and service are required'); end if;
  if length(btrim(coalesce(p_location->>'evidence_reference','')))<3 or length(btrim(coalesce(p_location->>'evidence_basis','')))<20 then return jsonb_build_object('error','evidence reference and substantive evidence basis are required'); end if;
  select id into v_old from public.deployment_data_locations where deployment_id=d.id and policy_revision=d.residency_policy_revision and location_key=btrim(p_location->>'location_key') and status in ('declared','verified') order by created_at desc limit 1;
  perform set_config('app.residency_governed_write','on',true);
  if v_old is not null then update public.deployment_data_locations set status='superseded' where id=v_old; end if;
  insert into public.deployment_data_locations(organization_id,deployment_id,policy_revision,location_key,data_plane,provider,service,region_code,country_code,processing_activities,data_classes,evidence_reference,evidence_basis,declared_by,supersedes_id)
  values(v_org,d.id,d.residency_policy_revision,btrim(p_location->>'location_key'),p_location->>'data_plane',btrim(p_location->>'provider'),btrim(p_location->>'service'),v_region,v_country,v_acts,v_dc,btrim(p_location->>'evidence_reference'),btrim(p_location->>'evidence_basis'),v_actor,v_old) returning id into v_id;
  if v_old is not null then update public.deployment_data_locations set superseded_by_id=v_id where id=v_old; end if;
  update public.deployment_instances set residency_status='draft',residency_verified_by=null,residency_verified_at=null,residency_verification_basis=null where id=d.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'deployment_data_location',public.app_current_role(),jsonb_build_object('location_id',v_id,'deployment_id',d.id,'policy_revision',d.residency_policy_revision,'action','declared','actor_user_id',v_actor));
  return jsonb_build_object('location_id',v_id,'status','declared','policy_revision',d.residency_policy_revision);
end $$;

create or replace function public.verify_deployment_data_location(p_location_id uuid,p_decision text,p_basis text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); l public.deployment_data_locations%rowtype;
begin
  if v_org is null or not public.residency_named_human_admin() then return jsonb_build_object('error','a named human administrator is required'); end if;
  select * into l from public.deployment_data_locations where id=p_location_id and organization_id=v_org for update;
  if l.id is null then return jsonb_build_object('error','location not found in this tenant'); end if;
  if l.status<>'declared' then return jsonb_build_object('error','only a current declared location can be verified'); end if;
  if l.declared_by=v_actor then return jsonb_build_object('error','independent review requires a verifier other than the declarer'); end if;
  if p_decision not in ('verified','rejected') or length(btrim(coalesce(p_basis,'')))<20 then return jsonb_build_object('error','verified or rejected decision and substantive verification basis are required'); end if;
  perform set_config('app.residency_governed_write','on',true);
  update public.deployment_data_locations set status=p_decision,verified_by=v_actor,verified_at=now(),verification_basis=btrim(p_basis) where id=l.id;
  if p_decision='rejected' then
    update public.deployment_instances set residency_status='blocked',residency_verified_by=null,residency_verified_at=null,residency_verification_basis=null where id=l.deployment_id;
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'deployment_data_location_review',public.app_current_role(),jsonb_build_object('location_id',l.id,'deployment_id',l.deployment_id,'action',p_decision,'actor_user_id',v_actor));
  return jsonb_build_object('location_id',l.id,'status',p_decision);
end $$;

create or replace function public.verify_deployment_residency(p_deployment_id uuid,p_basis text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); d public.deployment_instances%rowtype; v_missing text[]; v_bad integer;
  v_required constant text[]:=array['application','database','object_storage','backup','logging','ai_inference'];
begin
  if v_org is null or not public.residency_named_human_admin() then return jsonb_build_object('error','a named human administrator is required'); end if;
  select * into d from public.deployment_instances where id=p_deployment_id and organization_id=v_org for update;
  if d.id is null then return jsonb_build_object('error','deployment not found in this tenant'); end if;
  if d.residency_configured_by=v_actor then return jsonb_build_object('error','independent review requires a verifier other than the policy author'); end if;
  if length(btrim(coalesce(p_basis,'')))<20 then return jsonb_build_object('error','substantive verification basis is required'); end if;
  select array_agg(x) into v_missing from unnest(v_required) x where not exists(select 1 from public.deployment_data_locations l where l.deployment_id=d.id and l.policy_revision=d.residency_policy_revision and l.data_plane=x and l.status='verified');
  if cardinality(coalesce(v_missing,'{}'))>0 then return jsonb_build_object('error','required verified data planes are incomplete','missing_planes',v_missing); end if;
  select count(*) into v_bad from public.deployment_data_locations l where l.deployment_id=d.id and l.policy_revision=d.residency_policy_revision and l.status='verified' and (not l.country_code=any(d.residency_permitted_countries) or not l.region_code=any(d.residency_permitted_regions) or not l.data_classes <@ d.residency_data_classes);
  if v_bad>0 then return jsonb_build_object('error','verified topology no longer conforms to the current policy'); end if;
  perform set_config('app.residency_governed_write','on',true);
  update public.deployment_instances set residency_status='verified',residency_verified_by=v_actor,residency_verified_at=now(),residency_verification_basis=btrim(p_basis) where id=d.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'deployment_residency_verification',public.app_current_role(),jsonb_build_object('deployment_id',d.id,'policy_revision',d.residency_policy_revision,'action','verified','actor_user_id',v_actor,'required_planes',v_required));
  return jsonb_build_object('deployment_id',d.id,'policy_revision',d.residency_policy_revision,'status','verified','required_planes',v_required);
end $$;

create or replace function public.set_deployment_environment(p_deployment_id uuid,p_environment text,p_basis text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); d public.deployment_instances%rowtype;
begin
  if v_org is null or not public.residency_named_human_admin() then return jsonb_build_object('error','a named human administrator is required'); end if;
  if p_environment not in ('evaluation','pilot','production') then return jsonb_build_object('error','deployment environment is invalid'); end if;
  if length(btrim(coalesce(p_basis,'')))<20 then return jsonb_build_object('error','substantive transition basis is required'); end if;
  select * into d from public.deployment_instances where id=p_deployment_id and organization_id=v_org for update;
  if d.id is null then return jsonb_build_object('error','deployment not found in this tenant'); end if;
  if p_environment in ('pilot','production') and d.residency_status<>'verified' then return jsonb_build_object('error','verified residency posture is required before pilot or production'); end if;
  perform set_config('app.residency_governed_write','on',true);
  update public.deployment_instances set deployment_environment=p_environment where id=d.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'deployment_environment',public.app_current_role(),jsonb_build_object('deployment_id',d.id,'from',d.deployment_environment,'to',p_environment,'basis',btrim(p_basis),'actor_user_id',auth.uid()));
  return jsonb_build_object('deployment_id',d.id,'deployment_environment',p_environment,'residency_status',d.residency_status);
end $$;

create or replace function public.get_data_residency_workspace()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','workspace membership required'); end if;
  return jsonb_build_object(
    'actor_role',public.app_current_role(),'can_manage',public.residency_named_human_admin(),
    'governance',jsonb_build_object('claim','Verified means the named evidence was independently reviewed; it does not prove SyncAI moved data or configured cloud resources.','promotion','Pilot and production require a verified six-plane topology.','retention','Retention remains governed by the canonical retention and archive controls.'),
    'deployments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'name',d.name,'operating_region',d.operating_region,'deployment_environment',d.deployment_environment,
      'residency_status',d.residency_status,'policy_revision',d.residency_policy_revision,'jurisdictions',d.residency_jurisdictions,
      'permitted_countries',d.residency_permitted_countries,'permitted_regions',d.residency_permitted_regions,'data_classes',d.residency_data_classes,
      'authority_reference',d.residency_authority_reference,'evidence_basis',d.residency_evidence_basis,'configured_by',d.residency_configured_by,
      'configured_at',d.residency_configured_at,'verified_by',d.residency_verified_by,'verified_at',d.residency_verified_at,
      'verification_basis',d.residency_verification_basis,'locations',coalesce((select jsonb_agg(to_jsonb(l) order by l.data_plane,l.location_key) from public.deployment_data_locations l where l.deployment_id=d.id and l.policy_revision=d.residency_policy_revision and l.status<>'superseded'),'[]'::jsonb)
    ) order by d.created_at desc) from public.deployment_instances d where d.organization_id=v_org),'[]'::jsonb)
  );
end $$;

revoke all on function public.configure_deployment_residency(uuid,jsonb) from public,anon;
revoke all on function public.record_deployment_data_location(uuid,jsonb) from public,anon;
revoke all on function public.verify_deployment_data_location(uuid,text,text) from public,anon;
revoke all on function public.verify_deployment_residency(uuid,text) from public,anon;
revoke all on function public.set_deployment_environment(uuid,text,text) from public,anon;
revoke all on function public.get_data_residency_workspace() from public,anon;
revoke all on function public.guard_residency_governance_rows() from public,anon,authenticated;
revoke all on function public.guard_deployment_data_location_immutability() from public,anon,authenticated;
grant execute on function public.configure_deployment_residency(uuid,jsonb) to authenticated;
grant execute on function public.record_deployment_data_location(uuid,jsonb) to authenticated;
grant execute on function public.verify_deployment_data_location(uuid,text,text) to authenticated;
grant execute on function public.verify_deployment_residency(uuid,text) to authenticated;
grant execute on function public.set_deployment_environment(uuid,text,text) to authenticated;
grant execute on function public.get_data_residency_workspace() to authenticated;

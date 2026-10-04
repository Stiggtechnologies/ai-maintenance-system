-- ============================================================================
-- C8.01 — verified asset hierarchy, criticality and equipment boundary.
--
-- Extends the ONE canonical asset foundation:
--   sites -> asset_locations (area/unit/system/functional location) -> assets
--   -> components.
-- Existing assets, evidence_items and audit_events remain authoritative.
-- Verification is a named-human, independently reviewed act. It does not
-- approve work, accept risk, commit spend, change operating limits or release
-- equipment to service.
-- ============================================================================

alter table public.asset_locations
  add column if not exists site_id uuid references public.sites(id) on delete restrict,
  add column if not exists parent_location_id uuid references public.asset_locations(id) on delete restrict,
  add column if not exists location_kind text,
  add column if not exists location_code text,
  add column if not exists description text,
  add column if not exists evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists verification_status text not null default 'legacy',
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists verified_at timestamptz,
  add column if not exists review_note text;

alter table public.asset_locations
  drop constraint if exists asset_locations_location_kind_check;
alter table public.asset_locations
  add constraint asset_locations_location_kind_check check (
    location_kind is null or location_kind in ('area','unit','system','functional_location')
  );
alter table public.asset_locations
  drop constraint if exists asset_locations_verification_status_check;
alter table public.asset_locations
  add constraint asset_locations_verification_status_check check (
    verification_status in ('legacy','proposed','verified','rejected')
  );

create unique index if not exists idx_asset_locations_governed_code
  on public.asset_locations(organization_id,location_code)
  where location_code is not null and verification_status<>'rejected';
create index if not exists idx_asset_locations_governed_tree
  on public.asset_locations(organization_id,site_id,parent_location_id,location_kind);

create table if not exists public.asset_foundation_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  hierarchy_location_id uuid not null references public.asset_locations(id) on delete restrict,
  safety_score smallint not null check (safety_score between 1 and 5),
  environmental_score smallint not null check (environmental_score between 1 and 5),
  production_score smallint not null check (production_score between 1 and 5),
  financial_score smallint not null check (financial_score between 1 and 5),
  regulatory_score smallint not null check (regulatory_score between 1 and 5),
  criticality_class text not null check (criticality_class in ('critical','high','medium','low')),
  criticality_basis text not null check (length(btrim(criticality_basis)) between 20 and 4000),
  boundary_name text not null check (length(btrim(boundary_name)) between 3 and 240),
  included_equipment text[] not null check (cardinality(included_equipment)>0),
  excluded_equipment text[] not null default '{}'::text[],
  upstream_interface text not null check (length(btrim(upstream_interface)) between 3 and 1000),
  downstream_interface text not null check (length(btrim(downstream_interface)) between 3 and 1000),
  isolation_points text[] not null check (cardinality(isolation_points)>0),
  boundary_basis text not null check (length(btrim(boundary_basis)) between 20 and 4000),
  hierarchy_evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  criticality_evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  boundary_evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  status text not null default 'proposed' check (status in ('proposed','verified','rejected')),
  revision integer not null check (revision>0),
  supersedes_id uuid references public.asset_foundation_verifications(id) on delete restrict,
  proposed_by uuid not null references auth.users(id),
  proposed_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  unique(organization_id,asset_id,revision),
  unique(supersedes_id),
  check (
    (status='proposed' and reviewed_by is null and reviewed_at is null and review_note is null)
    or (status in ('verified','rejected') and reviewed_by is not null and reviewed_at is not null
        and length(btrim(review_note))>=20)
  )
);

alter table public.assets
  add column if not exists foundation_verification_id uuid
    references public.asset_foundation_verifications(id) on delete restrict,
  add column if not exists foundation_verified_by uuid references auth.users(id),
  add column if not exists foundation_verified_at timestamptz;

create index if not exists idx_asset_foundation_current
  on public.asset_foundation_verifications(organization_id,asset_id,revision desc);

alter table public.asset_foundation_verifications enable row level security;
drop policy if exists asset_foundation_verifications_read
  on public.asset_foundation_verifications;
create policy asset_foundation_verifications_read
  on public.asset_foundation_verifications for select to authenticated
  using (
    organization_id=public.app_current_org()
    and exists (
      select 1 from public.evidence_items e
      where e.id=hierarchy_evidence_item_id
        and e.organization_id=asset_foundation_verifications.organization_id
        and (e.risk_id is null or public.can_read_risk(e.risk_id))
    )
    and exists (
      select 1 from public.evidence_items e
      where e.id=criticality_evidence_item_id
        and e.organization_id=asset_foundation_verifications.organization_id
        and (e.risk_id is null or public.can_read_risk(e.risk_id))
    )
    and exists (
      select 1 from public.evidence_items e
      where e.id=boundary_evidence_item_id
        and e.organization_id=asset_foundation_verifications.organization_id
        and (e.risk_id is null or public.can_read_risk(e.risk_id))
    )
  );
revoke insert,update,delete,truncate on public.asset_foundation_verifications
  from public,anon,authenticated;
grant select on public.asset_foundation_verifications to authenticated;

create or replace function public.asset_criticality_class(
  p_safety integer,
  p_environmental integer,
  p_production integer,
  p_financial integer,
  p_regulatory integer
) returns text
language sql
immutable
set search_path=public
as $$
  select case greatest(p_safety,p_environmental,p_production,p_financial,p_regulatory)
    when 5 then 'critical'
    when 4 then 'high'
    when 3 then 'medium'
    else 'low'
  end
$$;

revoke all on function public.asset_criticality_class(integer,integer,integer,integer,integer)
  from public,anon;
grant execute on function public.asset_criticality_class(integer,integer,integer,integer,integer)
  to authenticated;

create or replace function public.protect_governed_asset_location()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_parent public.asset_locations%rowtype;
  v_site_org uuid;
  v_evidence public.evidence_items%rowtype;
begin
  if tg_op='DELETE' then
    raise exception 'governed asset hierarchy nodes are retained; reject or supersede, never delete';
  end if;
  if coalesce(current_setting('app.asset_hierarchy_write',true),'')<>'granted'
     or auth.uid() is null then
    raise exception 'governed asset hierarchy nodes require the named-human workflow';
  end if;
  if tg_op='UPDATE' then
    if old.verification_status in ('verified','rejected') then
      raise exception 'a decided hierarchy node is immutable; propose a new node instead';
    end if;
    if new.organization_id is distinct from old.organization_id
       or new.site_id is distinct from old.site_id
       or new.parent_location_id is distinct from old.parent_location_id
       or new.location_kind is distinct from old.location_kind
       or new.location_code is distinct from old.location_code
       or new.name is distinct from old.name
       or new.description is distinct from old.description
       or new.evidence_item_id is distinct from old.evidence_item_id
       or new.created_by is distinct from old.created_by then
      raise exception 'hierarchy proposal content is immutable; decide it or propose a replacement';
    end if;
  end if;
  if new.organization_id is null or new.site_id is null or new.location_kind is null
     or nullif(btrim(coalesce(new.location_code,'')),'') is null
     or nullif(btrim(coalesce(new.name,'')),'') is null
     or coalesce(length(btrim(new.description)),0)<20
     or new.evidence_item_id is null
     or (tg_op='INSERT' and new.created_by is distinct from auth.uid()) then
    raise exception 'hierarchy nodes require organization, site, kind, code, name, description, evidence and named proposer';
  end if;
  select organization_id into v_site_org from public.sites where id=new.site_id;
  if v_site_org is distinct from new.organization_id then
    raise exception 'hierarchy site must belong to the same organization';
  end if;
  select * into v_evidence from public.evidence_items
  where id=new.evidence_item_id and organization_id=new.organization_id
    and verification_status='verified'
    and (risk_id is null or public.can_read_risk(risk_id));
  if v_evidence.id is null then
    raise exception 'hierarchy proposal requires visible verified same-tenant evidence';
  end if;
  if new.parent_location_id is null then
    if new.location_kind<>'area' then
      raise exception 'the first governed node beneath a site must be an area';
    end if;
  else
    select * into v_parent from public.asset_locations
    where id=new.parent_location_id and organization_id=new.organization_id
      and site_id=new.site_id;
    if v_parent.id is null or v_parent.verification_status<>'verified' then
      raise exception 'a hierarchy parent must be a verified node in the same tenant and site';
    end if;
    if not (
      (v_parent.location_kind='area' and new.location_kind in ('unit','system'))
      or (v_parent.location_kind='unit' and new.location_kind='system')
      or (v_parent.location_kind='system' and new.location_kind='functional_location')
    ) then
      raise exception 'hierarchy order must be site to area, optional unit, system and optional functional location';
    end if;
  end if;
  if new.verification_status='proposed' and
     (new.verified_by is not null or new.verified_at is not null or new.review_note is not null) then
    raise exception 'a proposed hierarchy node cannot claim verification';
  end if;
  if new.verification_status in ('verified','rejected') then
    if new.verified_by is null or new.verified_at is null
       or coalesce(length(btrim(new.review_note)),0)<20
       or new.verified_by=new.created_by
       or new.verified_by is distinct from auth.uid() then
      raise exception 'hierarchy verification requires an independent named reviewer and substantive note';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.protect_governed_asset_location()
  from public,anon,authenticated;
drop trigger if exists trg_protect_governed_asset_location on public.asset_locations;
create trigger trg_protect_governed_asset_location
before insert or update or delete on public.asset_locations
for each row execute function public.protect_governed_asset_location();

create or replace function public.protect_asset_foundation_verification()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_asset public.assets%rowtype;
  v_location public.asset_locations%rowtype;
  v_evidence_count integer;
  v_expected text;
begin
  if tg_op='DELETE' then
    raise exception 'asset foundation verifications are retained and cannot be deleted';
  end if;
  if coalesce(current_setting('app.asset_foundation_review_write',true),'')<>'granted'
     or auth.uid() is null then
    raise exception 'asset foundation verification requires the governed named-human workflow';
  end if;
  if tg_op='UPDATE' then
    if old.status<>'proposed' or new.status not in ('verified','rejected') then
      raise exception 'an asset foundation decision is final; changes require a new proposal revision';
    end if;
    if new.organization_id is distinct from old.organization_id
       or new.asset_id is distinct from old.asset_id
       or new.hierarchy_location_id is distinct from old.hierarchy_location_id
       or new.safety_score is distinct from old.safety_score
       or new.environmental_score is distinct from old.environmental_score
       or new.production_score is distinct from old.production_score
       or new.financial_score is distinct from old.financial_score
       or new.regulatory_score is distinct from old.regulatory_score
       or new.criticality_class is distinct from old.criticality_class
       or new.criticality_basis is distinct from old.criticality_basis
       or new.boundary_name is distinct from old.boundary_name
       or new.included_equipment is distinct from old.included_equipment
       or new.excluded_equipment is distinct from old.excluded_equipment
       or new.upstream_interface is distinct from old.upstream_interface
       or new.downstream_interface is distinct from old.downstream_interface
       or new.isolation_points is distinct from old.isolation_points
       or new.boundary_basis is distinct from old.boundary_basis
       or new.hierarchy_evidence_item_id is distinct from old.hierarchy_evidence_item_id
       or new.criticality_evidence_item_id is distinct from old.criticality_evidence_item_id
       or new.boundary_evidence_item_id is distinct from old.boundary_evidence_item_id
       or new.revision is distinct from old.revision
       or new.supersedes_id is distinct from old.supersedes_id
       or new.proposed_by is distinct from old.proposed_by
       or new.proposed_at is distinct from old.proposed_at then
      raise exception 'asset foundation proposal content is immutable after submission';
    end if;
  end if;
  select * into v_asset from public.assets
  where id=new.asset_id and organization_id=new.organization_id;
  select * into v_location from public.asset_locations
  where id=new.hierarchy_location_id and organization_id=new.organization_id
    and verification_status='verified';
  if v_asset.id is null or v_location.id is null then
    raise exception 'asset and verified hierarchy location must resolve inside one organization';
  end if;
  if v_location.location_kind not in ('system','functional_location')
     or (v_asset.site_id is not null and v_asset.site_id is distinct from v_location.site_id) then
    raise exception 'an asset must be assigned to a verified system or functional location in its site';
  end if;
  select count(*) into v_evidence_count from public.evidence_items e
  where e.id in (new.hierarchy_evidence_item_id,new.criticality_evidence_item_id,new.boundary_evidence_item_id)
    and e.organization_id=new.organization_id and e.verification_status='verified'
    and (e.risk_id is null or public.can_read_risk(e.risk_id));
  if v_evidence_count<>3 then
    raise exception 'hierarchy, criticality and boundary each require visible verified same-tenant evidence';
  end if;
  v_expected:=public.asset_criticality_class(
    new.safety_score,new.environmental_score,new.production_score,
    new.financial_score,new.regulatory_score);
  if new.criticality_class is distinct from v_expected then
    raise exception 'stored criticality class must match the deterministic five-consequence model';
  end if;
  if new.status='proposed' and
     (new.reviewed_by is not null or new.reviewed_at is not null or new.review_note is not null) then
    raise exception 'a proposed asset foundation cannot claim verification';
  end if;
  if new.status in ('verified','rejected') and
     (new.reviewed_by is null or new.reviewed_at is null
      or coalesce(length(btrim(new.review_note)),0)<20
      or new.reviewed_by=new.proposed_by
      or new.reviewed_by is distinct from auth.uid()) then
    raise exception 'asset foundation verification requires an independent named reviewer and substantive note';
  end if;
  if tg_op='INSERT' and new.proposed_by is distinct from auth.uid() then
    raise exception 'asset foundation proposal must retain the named proposer';
  end if;
  if new.supersedes_id is null and new.revision<>1 then
    raise exception 'the first asset foundation revision must be one';
  end if;
  if new.supersedes_id is not null and not exists (
    select 1 from public.asset_foundation_verifications prior
    where prior.id=new.supersedes_id and prior.organization_id=new.organization_id
      and prior.asset_id=new.asset_id and prior.revision=new.revision-1
      and prior.status in ('verified','rejected')
  ) then
    raise exception 'a new asset foundation revision must extend the exact decided predecessor';
  end if;
  return new;
end
$$;

revoke all on function public.protect_asset_foundation_verification()
  from public,anon,authenticated;
drop trigger if exists trg_protect_asset_foundation_verification
  on public.asset_foundation_verifications;
create trigger trg_protect_asset_foundation_verification
before insert or update or delete on public.asset_foundation_verifications
for each row execute function public.protect_asset_foundation_verification();

create or replace function public.protect_verified_asset_foundation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if old.foundation_verified_at is not null and (
    new.site_id is distinct from old.site_id
    or new.location_id is distinct from old.location_id
    or new.area is distinct from old.area
    or new.system is distinct from old.system
    or new.functional_location is distinct from old.functional_location
    or new.criticality is distinct from old.criticality
    or new.foundation_verification_id is distinct from old.foundation_verification_id
    or new.foundation_verified_by is distinct from old.foundation_verified_by
    or new.foundation_verified_at is distinct from old.foundation_verified_at
  ) and coalesce(current_setting('app.asset_foundation_write',true),'')<>'granted' then
    raise exception 'verified hierarchy, criticality and boundary are changed only by a new independently reviewed foundation revision';
  end if;
  return new;
end
$$;

revoke all on function public.protect_verified_asset_foundation()
  from public,anon,authenticated;
drop trigger if exists trg_protect_verified_asset_foundation on public.assets;
create trigger trg_protect_verified_asset_foundation
before update on public.assets
for each row execute function public.protect_verified_asset_foundation();

create or replace function public.propose_asset_hierarchy_node(
  p_site_id uuid,
  p_parent_location_id uuid,
  p_location_kind text,
  p_location_code text,
  p_name text,
  p_description text,
  p_evidence_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_id uuid;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('data_steward','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','a named data steward, reliability engineer, maintenance manager or administrator must propose hierarchy nodes');
  end if;
  perform set_config('app.asset_hierarchy_write','granted',true);
  insert into public.asset_locations(
    organization_id,site_id,parent_location_id,location_kind,location_code,
    name,description,evidence_item_id,verification_status,created_by)
  values(v_org,p_site_id,p_parent_location_id,p_location_kind,btrim(p_location_code),
    btrim(p_name),btrim(p_description),p_evidence_item_id,'proposed',auth.uid())
  returning id into v_id;
  perform set_config('app.asset_hierarchy_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_hierarchy_node',v_role,jsonb_build_object(
    'action','proposed','location_id',v_id,'location_kind',p_location_kind,
    'site_id',p_site_id,'parent_location_id',p_parent_location_id,'proposed_by',auth.uid()));
  return jsonb_build_object('locationId',v_id,'status','proposed','humanVerificationRequired',true);
exception when others then
  perform set_config('app.asset_hierarchy_write','',true);
  raise;
end
$$;

create or replace function public.review_asset_hierarchy_node(
  p_location_id uuid,
  p_decision text,
  p_review_note text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_node public.asset_locations%rowtype;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','a named reliability engineer, maintenance manager or administrator must verify hierarchy nodes');
  end if;
  if coalesce(p_decision,'') not in ('verified','rejected')
     or coalesce(length(btrim(p_review_note)),0)<20 then
    return jsonb_build_object('error','decision must be verified or rejected with a substantive review note');
  end if;
  select * into v_node from public.asset_locations
  where id=p_location_id and organization_id=v_org for update;
  if v_node.id is null or v_node.verification_status<>'proposed' then
    return jsonb_build_object('error','hierarchy proposal was not found or has already been decided');
  end if;
  if v_node.created_by=auth.uid() then
    return jsonb_build_object('error','segregation of duties requires an independent hierarchy reviewer');
  end if;
  perform set_config('app.asset_hierarchy_write','granted',true);
  update public.asset_locations set verification_status=p_decision,
    verified_by=auth.uid(),verified_at=now(),review_note=btrim(p_review_note)
  where id=v_node.id;
  perform set_config('app.asset_hierarchy_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_hierarchy_node',v_role,jsonb_build_object(
    'action',p_decision,'location_id',v_node.id,'reviewed_by',auth.uid()));
  return jsonb_build_object('locationId',v_node.id,'status',p_decision);
exception when others then
  perform set_config('app.asset_hierarchy_write','',true);
  raise;
end
$$;

create or replace function public.propose_asset_foundation_verification(
  p_asset_id uuid,
  p_hierarchy_location_id uuid,
  p_scores jsonb,
  p_criticality_basis text,
  p_boundary jsonb,
  p_hierarchy_evidence_item_id uuid,
  p_criticality_evidence_item_id uuid,
  p_boundary_evidence_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_id uuid;
  v_prior public.asset_foundation_verifications%rowtype;
  v_revision integer;
  v_safety integer:=(p_scores->>'safety')::integer;
  v_environmental integer:=(p_scores->>'environmental')::integer;
  v_production integer:=(p_scores->>'production')::integer;
  v_financial integer:=(p_scores->>'financial')::integer;
  v_regulatory integer:=(p_scores->>'regulatory')::integer;
  v_class text;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('data_steward','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','a named data steward, reliability engineer, maintenance manager or administrator must propose the asset foundation');
  end if;
  if exists(select 1 from public.asset_foundation_verifications
    where organization_id=v_org and asset_id=p_asset_id and status='proposed') then
    return jsonb_build_object('error','this asset already has an undecided foundation proposal');
  end if;
  select * into v_prior from public.asset_foundation_verifications
  where organization_id=v_org and asset_id=p_asset_id
  order by revision desc limit 1;
  v_revision:=coalesce(v_prior.revision,0)+1;
  v_class:=public.asset_criticality_class(v_safety,v_environmental,v_production,v_financial,v_regulatory);
  perform set_config('app.asset_foundation_review_write','granted',true);
  insert into public.asset_foundation_verifications(
    organization_id,asset_id,hierarchy_location_id,
    safety_score,environmental_score,production_score,financial_score,regulatory_score,
    criticality_class,criticality_basis,boundary_name,included_equipment,
    excluded_equipment,upstream_interface,downstream_interface,isolation_points,
    boundary_basis,hierarchy_evidence_item_id,criticality_evidence_item_id,
    boundary_evidence_item_id,status,revision,supersedes_id,proposed_by)
  values(v_org,p_asset_id,p_hierarchy_location_id,
    v_safety,v_environmental,v_production,v_financial,v_regulatory,
    v_class,btrim(p_criticality_basis),btrim(p_boundary->>'name'),
    array(select jsonb_array_elements_text(coalesce(p_boundary->'includedEquipment','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_boundary->'excludedEquipment','[]'::jsonb))),
    btrim(p_boundary->>'upstreamInterface'),btrim(p_boundary->>'downstreamInterface'),
    array(select jsonb_array_elements_text(coalesce(p_boundary->'isolationPoints','[]'::jsonb))),
    btrim(p_boundary->>'basis'),p_hierarchy_evidence_item_id,
    p_criticality_evidence_item_id,p_boundary_evidence_item_id,
    'proposed',v_revision,v_prior.id,auth.uid())
  returning id into v_id;
  perform set_config('app.asset_foundation_review_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_foundation_verification',v_role,jsonb_build_object(
    'action','proposed','verification_id',v_id,'asset_id',p_asset_id,
    'revision',v_revision,'criticality_class',v_class,'proposed_by',auth.uid(),
    'no_operational_authority',true));
  return jsonb_build_object('verificationId',v_id,'status','proposed','revision',v_revision,
    'criticalityClass',v_class,'independentVerificationRequired',true);
exception when others then
  perform set_config('app.asset_foundation_review_write','',true);
  raise;
end
$$;

create or replace function public.review_asset_foundation_verification(
  p_verification_id uuid,
  p_decision text,
  p_review_note text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_review public.asset_foundation_verifications%rowtype;
  v_location public.asset_locations%rowtype;
  v_area text;
  v_system text;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','a named reliability engineer, maintenance manager or administrator must verify the asset foundation');
  end if;
  if coalesce(p_decision,'') not in ('verified','rejected')
     or coalesce(length(btrim(p_review_note)),0)<20 then
    return jsonb_build_object('error','decision must be verified or rejected with a substantive review note');
  end if;
  select * into v_review from public.asset_foundation_verifications
  where id=p_verification_id and organization_id=v_org for update;
  if v_review.id is null or v_review.status<>'proposed' then
    return jsonb_build_object('error','asset foundation proposal was not found or has already been decided');
  end if;
  if v_review.proposed_by=auth.uid() then
    return jsonb_build_object('error','segregation of duties requires an independent asset-foundation reviewer');
  end if;
  perform set_config('app.asset_foundation_review_write','granted',true);
  update public.asset_foundation_verifications set status=p_decision,
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_review_note)
  where id=v_review.id;
  perform set_config('app.asset_foundation_review_write','',true);
  if p_decision='verified' then
    select * into v_location from public.asset_locations where id=v_review.hierarchy_location_id;
    with recursive chain as (
      select l.id,l.parent_location_id,l.location_kind,l.name
      from public.asset_locations l where l.id=v_review.hierarchy_location_id
      union all
      select p.id,p.parent_location_id,p.location_kind,p.name
      from public.asset_locations p join chain c on p.id=c.parent_location_id
    ) select max(name) filter(where location_kind='area'),
             max(name) filter(where location_kind='system')
      into v_area,v_system from chain;
    perform set_config('app.asset_foundation_write','granted',true);
    update public.assets set site_id=v_location.site_id,location_id=v_location.id,
      area=v_area,system=v_system,functional_location=v_location.location_code,
      criticality=v_review.criticality_class,foundation_verification_id=v_review.id,
      foundation_verified_by=auth.uid(),foundation_verified_at=now()
    where id=v_review.asset_id and organization_id=v_org;
    perform set_config('app.asset_foundation_write','',true);
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_foundation_verification',v_role,jsonb_build_object(
    'action',p_decision,'verification_id',v_review.id,'asset_id',v_review.asset_id,
    'revision',v_review.revision,'reviewed_by',auth.uid(),
    'no_work_approval_risk_spend_operating_or_rts_authority',true));
  return jsonb_build_object('verificationId',v_review.id,'status',p_decision,
    'assetId',v_review.asset_id,'criticalityClass',v_review.criticality_class,
    'mayChangeWork',false,'mayApprove',false,'mayAcceptRisk',false,
    'mayCommitSpend',false,'mayChangeOperatingLimits',false,'mayReturnToService',false);
exception when others then
  perform set_config('app.asset_foundation_review_write','',true);
  perform set_config('app.asset_foundation_write','',true);
  raise;
end
$$;

create or replace function public.get_asset_foundation_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_result jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select jsonb_build_object(
    'model',jsonb_build_object(
      'dimensions',jsonb_build_array('safety','environmental','production','financial','regulatory'),
      'scale','1 negligible, 2 minor, 3 material, 4 major, 5 catastrophic',
      'rule','The highest consequence governs: 5 critical, 4 high, 3 medium, 1-2 low. No averaging can hide a severe consequence.'),
    'sites',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name)
      from public.sites s where s.organization_id=v_org),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'siteId',l.site_id,'parentLocationId',l.parent_location_id,
      'kind',l.location_kind,'code',l.location_code,'name',l.name,
      'description',l.description,'evidenceItemId',l.evidence_item_id,
      'status',l.verification_status,'createdBy',l.created_by,
      'verifiedBy',l.verified_by,'verifiedAt',l.verified_at,'reviewNote',l.review_note)
      order by l.location_code,l.name)
      from public.asset_locations l where l.organization_id=v_org
        and l.verification_status in ('proposed','verified','rejected')
        and exists (select 1 from public.evidence_items location_evidence
          where location_evidence.id=l.evidence_item_id
            and location_evidence.organization_id=v_org
            and (location_evidence.risk_id is null
              or public.can_read_risk(location_evidence.risk_id)))),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'siteId',a.site_id,'tag',coalesce(a.tag,a.asset_tag),
      'name',a.name,'criticality',a.criticality,'locationId',a.location_id,
      'area',a.area,'system',a.system,'functionalLocation',a.functional_location,
      'foundationVerificationId',a.foundation_verification_id,
      'foundationVerifiedBy',a.foundation_verified_by,
      'foundationVerifiedAt',a.foundation_verified_at)
      order by coalesce(a.tag,a.asset_tag),a.name)
      from public.assets a where a.organization_id=v_org),'[]'::jsonb),
    'proposals',coalesce((select jsonb_agg(jsonb_build_object(
      'id',f.id,'assetId',f.asset_id,'hierarchyLocationId',f.hierarchy_location_id,
      'scores',jsonb_build_object('safety',f.safety_score,'environmental',f.environmental_score,
        'production',f.production_score,'financial',f.financial_score,'regulatory',f.regulatory_score),
      'criticalityClass',f.criticality_class,'criticalityBasis',f.criticality_basis,
      'boundary',jsonb_build_object('name',f.boundary_name,'includedEquipment',f.included_equipment,
        'excludedEquipment',f.excluded_equipment,'upstreamInterface',f.upstream_interface,
        'downstreamInterface',f.downstream_interface,'isolationPoints',f.isolation_points,'basis',f.boundary_basis),
      'hierarchyEvidenceItemId',f.hierarchy_evidence_item_id,
      'criticalityEvidenceItemId',f.criticality_evidence_item_id,
      'boundaryEvidenceItemId',f.boundary_evidence_item_id,
      'status',f.status,'revision',f.revision,'supersedesId',f.supersedes_id,
      'proposedBy',f.proposed_by,'proposedAt',f.proposed_at,
      'reviewedBy',f.reviewed_by,'reviewedAt',f.reviewed_at,'reviewNote',f.review_note)
      order by f.proposed_at desc)
      from public.asset_foundation_verifications f where f.organization_id=v_org
        and exists (select 1 from public.evidence_items hierarchy_evidence
          where hierarchy_evidence.id=f.hierarchy_evidence_item_id
            and hierarchy_evidence.organization_id=v_org
            and (hierarchy_evidence.risk_id is null
              or public.can_read_risk(hierarchy_evidence.risk_id)))
        and exists (select 1 from public.evidence_items criticality_evidence
          where criticality_evidence.id=f.criticality_evidence_item_id
            and criticality_evidence.organization_id=v_org
            and (criticality_evidence.risk_id is null
              or public.can_read_risk(criticality_evidence.risk_id)))
        and exists (select 1 from public.evidence_items boundary_evidence
          where boundary_evidence.id=f.boundary_evidence_item_id
            and boundary_evidence.organization_id=v_org
            and (boundary_evidence.risk_id is null
              or public.can_read_risk(boundary_evidence.risk_id)))),'[]'::jsonb),
    'verifiedEvidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'description',e.description,'evidenceClass',e.evidence_class,
      'assetId',e.asset_id,'verifiedBy',e.verified_by,'verifiedAt',e.verified_at,
      'verificationMethod',e.verification_method) order by e.verified_at desc,e.id)
      from (select * from public.evidence_items where organization_id=v_org
        and verification_status='verified'
        and (risk_id is null or public.can_read_risk(risk_id))
        order by verified_at desc,id limit 100) e),'[]'::jsonb),
    'authority',jsonb_build_object('namedHumanVerification',true,'segregationOfDuties',true,
      'mayChangeWork',false,'mayApprove',false,'mayAcceptRisk',false,'mayCommitSpend',false,
      'mayChangeOperatingLimits',false,'mayReturnToService',false)
  ) into v_result;
  return v_result;
end
$$;

revoke all on function public.propose_asset_hierarchy_node(uuid,uuid,text,text,text,text,uuid)
  from public,anon;
revoke all on function public.review_asset_hierarchy_node(uuid,text,text)
  from public,anon;
revoke all on function public.propose_asset_foundation_verification(uuid,uuid,jsonb,text,jsonb,uuid,uuid,uuid)
  from public,anon;
revoke all on function public.review_asset_foundation_verification(uuid,text,text)
  from public,anon;
revoke all on function public.get_asset_foundation_workspace()
  from public,anon;
grant execute on function public.propose_asset_hierarchy_node(uuid,uuid,text,text,text,text,uuid)
  to authenticated;
grant execute on function public.review_asset_hierarchy_node(uuid,text,text)
  to authenticated;
grant execute on function public.propose_asset_foundation_verification(uuid,uuid,jsonb,text,jsonb,uuid,uuid,uuid)
  to authenticated;
grant execute on function public.review_asset_foundation_verification(uuid,text,text)
  to authenticated;
grant execute on function public.get_asset_foundation_workspace()
  to authenticated;

notify pgrst,'reload schema';

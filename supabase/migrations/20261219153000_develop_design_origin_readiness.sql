-- Sync Develop Slice 8 / D8.10 — operational readiness begins during design.
--
-- Canonical stores remain unchanged:
--   * design_requirements is the design requirement truth;
--   * asset_onboarding_items is the only readiness-item truth;
--   * commissioning_system_readiness_scope carries system accountability;
--   * system_handover_packages remains the operations-acceptance doorway.
--
-- These two tables are provenance associations only. They record the named
-- human decision that a design requirement creates a particular catalogued
-- readiness obligation, then preserve the requirement → canonical item links.
-- No status, completion, acceptance, or readiness score is copied here.

create table if not exists public.commissioning_system_readiness_design_origins (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  commissioning_system_id bigint not null references public.commissioning_systems(id) on delete cascade,
  design_requirement_id bigint not null references public.design_requirements(id) on delete restrict,
  onboarding_requirement_key text not null references public.onboarding_requirements(key) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  required_before date not null,
  mapping_basis text not null check (length(btrim(mapping_basis)) >= 20),
  mapping_evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (commissioning_system_id, design_requirement_id, onboarding_requirement_key)
);

create table if not exists public.commissioning_system_readiness_origin_items (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  design_origin_id bigint not null references public.commissioning_system_readiness_design_origins(id) on delete cascade,
  readiness_scope_id bigint not null references public.commissioning_system_readiness_scope(id) on delete cascade,
  generated_at timestamptz not null default now(),
  unique (design_origin_id, readiness_scope_id)
);

create index if not exists idx_readiness_design_origin_system
  on public.commissioning_system_readiness_design_origins
  (organization_id, commissioning_system_id, recorded_at);
create index if not exists idx_readiness_origin_item_origin
  on public.commissioning_system_readiness_origin_items
  (organization_id, design_origin_id);

alter table public.commissioning_system_readiness_design_origins enable row level security;
alter table public.commissioning_system_readiness_origin_items enable row level security;
drop policy if exists commissioning_system_readiness_design_origins_read
  on public.commissioning_system_readiness_design_origins;
create policy commissioning_system_readiness_design_origins_read
  on public.commissioning_system_readiness_design_origins for select to authenticated
  using (organization_id=public.app_current_org());
drop policy if exists commissioning_system_readiness_origin_items_read
  on public.commissioning_system_readiness_origin_items;
create policy commissioning_system_readiness_origin_items_read
  on public.commissioning_system_readiness_origin_items for select to authenticated
  using (organization_id=public.app_current_org());

create or replace function public.guard_system_readiness_design_origin()
returns trigger language plpgsql security definer set search_path=public as $$
declare s public.commissioning_systems%rowtype; r public.design_requirements%rowtype;
begin
  if tg_op<>'INSERT' then
    raise exception 'design-origin readiness provenance is append-only' using errcode='check_violation';
  end if;
  if current_setting('app.system_readiness_design_origin_write',true) is distinct from 'allowed' then
    raise exception 'design-origin readiness provenance requires the governed human workflow' using errcode='check_violation';
  end if;
  select * into s from public.commissioning_systems where id=new.commissioning_system_id;
  select * into r from public.design_requirements where id=new.design_requirement_id;
  if s.id is null or r.id is null or s.organization_id<>new.organization_id
     or r.organization_id<>new.organization_id or r.development_case_id is distinct from s.development_case_id
     or r.project_id is distinct from s.project_id then
    raise exception 'design-origin requirement and commissioning system must share one tenant, case, and project' using errcode='check_violation';
  end if;
  if not exists(select 1 from public.onboarding_requirements c where c.key=new.onboarding_requirement_key and c.ori_category is not null) then
    raise exception 'design origin must select an existing operational-readiness catalog item' using errcode='check_violation';
  end if;
  if not exists(select 1 from public.user_profiles p where p.id=new.owner_id and p.organization_id=new.organization_id and p.role<>'ai_admin')
     or not exists(select 1 from public.user_profiles p where p.id=new.recorded_by and p.organization_id=new.organization_id and p.role<>'ai_admin') then
    raise exception 'design-origin owner and recorder must be named humans in the same tenant' using errcode='check_violation';
  end if;
  if not exists(select 1 from public.evidence_items e where e.id=new.mapping_evidence_item_id and e.organization_id=new.organization_id) then
    raise exception 'same-tenant evidence is required for the requirement-to-readiness mapping' using errcode='check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_system_readiness_design_origin
  on public.commissioning_system_readiness_design_origins;
create trigger trg_guard_system_readiness_design_origin
  before insert or update or delete on public.commissioning_system_readiness_design_origins
  for each row execute function public.guard_system_readiness_design_origin();
revoke all on function public.guard_system_readiness_design_origin() from public,anon,authenticated;

create or replace function public.guard_system_readiness_origin_item()
returns trigger language plpgsql security definer set search_path=public as $$
declare o public.commissioning_system_readiness_design_origins%rowtype; q public.commissioning_system_readiness_scope%rowtype;
begin
  if tg_op<>'INSERT' then
    raise exception 'generated design-origin readiness links are append-only' using errcode='check_violation';
  end if;
  if current_setting('app.system_readiness_origin_materialize',true) is distinct from 'allowed' then
    raise exception 'generated design-origin readiness links require the canonical materializer' using errcode='check_violation';
  end if;
  select * into o from public.commissioning_system_readiness_design_origins where id=new.design_origin_id;
  select * into q from public.commissioning_system_readiness_scope where id=new.readiness_scope_id;
  if o.id is null or q.id is null or o.organization_id<>new.organization_id
     or q.organization_id<>new.organization_id or q.commissioning_system_id<>o.commissioning_system_id then
    raise exception 'generated readiness link must remain inside its tenant and commissioning system' using errcode='check_violation';
  end if;
  if not exists(
    select 1 from public.asset_onboarding_items i
    where i.id=q.onboarding_item_id and i.organization_id=new.organization_id
      and i.requirement_key=o.onboarding_requirement_key
  ) then
    raise exception 'generated readiness link must point to the selected canonical catalog item' using errcode='check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_system_readiness_origin_item
  on public.commissioning_system_readiness_origin_items;
create trigger trg_guard_system_readiness_origin_item
  before insert or update or delete on public.commissioning_system_readiness_origin_items
  for each row execute function public.guard_system_readiness_origin_item();
revoke all on function public.guard_system_readiness_origin_item() from public,anon,authenticated;

create or replace function public.materialize_system_readiness_design_origin(
  p_origin_id bigint, p_asset_id uuid default null
) returns integer language plpgsql security definer set search_path=public as $$
declare o public.commissioning_system_readiness_design_origins%rowtype; a record; v_item uuid; v_scope bigint; v_count int:=0;
begin
  select * into o from public.commissioning_system_readiness_design_origins where id=p_origin_id;
  if not found then raise exception 'design-origin readiness record not found' using errcode='no_data_found'; end if;
  perform set_config('app.system_readiness_origin_materialize','allowed',true);
  for a in
    select b.asset_id from public.commissioning_system_assets b
    where b.organization_id=o.organization_id and b.commissioning_system_id=o.commissioning_system_id
      and (p_asset_id is null or b.asset_id=p_asset_id)
  loop
    insert into public.asset_onboarding_items(organization_id,asset_id,requirement_key)
    values(o.organization_id,a.asset_id,o.onboarding_requirement_key)
    on conflict(asset_id,requirement_key) do nothing;
    select i.id into v_item from public.asset_onboarding_items i
      where i.organization_id=o.organization_id and i.asset_id=a.asset_id
        and i.requirement_key=o.onboarding_requirement_key;
    select q.id into v_scope from public.commissioning_system_readiness_scope q
      where q.organization_id=o.organization_id and q.commissioning_system_id=o.commissioning_system_id
        and q.onboarding_item_id=v_item;
    if v_scope is null then
      insert into public.commissioning_system_readiness_scope(
        organization_id,commissioning_system_id,onboarding_item_id,owner_id,
        required_before,basis,basis_evidence_item_id,assigned_by)
      values(o.organization_id,o.commissioning_system_id,v_item,o.owner_id,
        o.required_before,o.mapping_basis,o.mapping_evidence_item_id,o.recorded_by)
      returning id into v_scope;
    elsif exists(
      select 1 from public.commissioning_system_readiness_scope q where q.id=v_scope
        and (q.owner_id is distinct from o.owner_id or q.required_before is distinct from o.required_before)
    ) then
      raise exception 'the selected canonical readiness item already has a different system owner or required-before date' using errcode='check_violation';
    end if;
    insert into public.commissioning_system_readiness_origin_items(
      organization_id,design_origin_id,readiness_scope_id)
    values(o.organization_id,o.id,v_scope)
    on conflict(design_origin_id,readiness_scope_id) do nothing;
    if found then v_count:=v_count+1; end if;
    v_scope:=null;
  end loop;
  return v_count;
end $$;
revoke all on function public.materialize_system_readiness_design_origin(bigint,uuid) from public,anon,authenticated;

create or replace function public.record_system_readiness_design_origin(
  p_system_id bigint, p_design_requirement_id bigint, p_onboarding_requirement_key text,
  p_owner_id uuid, p_required_before date, p_mapping_basis text, p_mapping_evidence_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; s public.commissioning_systems%rowtype;
  r public.design_requirements%rowtype; v_origin bigint; v_generated int; v_category text; v_asset_count int;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if not public.commissioning_author_role(v_role) then
    return jsonb_build_object('error','named-human planning or engineering authority required');
  end if;
  select * into s from public.commissioning_systems where id=p_system_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','commissioning system not found'); end if;
  if s.commissioning_state='ACCEPTED' then return jsonb_build_object('error','accepted system readiness provenance is frozen'); end if;
  select * into r from public.design_requirements where id=p_design_requirement_id and organization_id=v_org
    and development_case_id=s.development_case_id and project_id=s.project_id;
  if not found then return jsonb_build_object('error','same-case, same-project design requirement is required'); end if;
  select ori_category into v_category from public.onboarding_requirements
    where key=p_onboarding_requirement_key and ori_category is not null;
  if v_category is null then return jsonb_build_object('error','select a catalog item in one of the thirteen operational-readiness categories'); end if;
  if not exists(select 1 from public.user_profiles where id=p_owner_id and organization_id=v_org and role<>'ai_admin') then
    return jsonb_build_object('error','same-tenant named human readiness owner is required');
  end if;
  if p_required_before is null then return jsonb_build_object('error','required-before date is required'); end if;
  if coalesce(length(btrim(p_mapping_basis)),0)<20 then return jsonb_build_object('error','a substantive requirement-to-readiness mapping basis is required'); end if;
  if not exists(select 1 from public.evidence_items where id=p_mapping_evidence_item_id and organization_id=v_org) then
    return jsonb_build_object('error','same-tenant mapping evidence is required');
  end if;
  select id into v_origin from public.commissioning_system_readiness_design_origins
    where organization_id=v_org and commissioning_system_id=s.id
      and design_requirement_id=r.id and onboarding_requirement_key=p_onboarding_requirement_key;
  if v_origin is null then
    perform set_config('app.system_readiness_design_origin_write','allowed',true);
    insert into public.commissioning_system_readiness_design_origins(
      organization_id,commissioning_system_id,design_requirement_id,onboarding_requirement_key,
      owner_id,required_before,mapping_basis,mapping_evidence_item_id,recorded_by)
    values(v_org,s.id,r.id,p_onboarding_requirement_key,p_owner_id,p_required_before,
      btrim(p_mapping_basis),p_mapping_evidence_item_id,auth.uid())
    returning id into v_origin;
  elsif exists(select 1 from public.commissioning_system_readiness_design_origins o where o.id=v_origin
      and (o.owner_id is distinct from p_owner_id or o.required_before is distinct from p_required_before
        or o.mapping_basis is distinct from btrim(p_mapping_basis)
        or o.mapping_evidence_item_id is distinct from p_mapping_evidence_item_id)) then
    return jsonb_build_object('error','an existing immutable design-origin mapping cannot be rewritten; record a different catalog obligation if another mapping is required');
  end if;
  v_generated:=public.materialize_system_readiness_design_origin(v_origin,null);
  select count(*) into v_asset_count from public.commissioning_system_assets
    where organization_id=v_org and commissioning_system_id=s.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'system_readiness_design_origin',v_role,jsonb_build_object(
    'origin_id',v_origin,'system_id',s.id,'design_requirement_id',r.id,
    'onboarding_requirement_key',p_onboarding_requirement_key,'readiness_category',v_category,
    'owner_id',p_owner_id,'required_before',p_required_before,
    'mapping_evidence_item_id',p_mapping_evidence_item_id,'items_generated',v_generated));
  return jsonb_build_object('originId',v_origin,'systemId',s.id,'designRequirementId',r.id,
    'requirementRef',r.requirement_ref,'onboardingRequirementKey',p_onboarding_requirement_key,
    'readinessCategory',v_category,'itemsGenerated',v_generated,'assetCount',v_asset_count,
    'status',case when v_asset_count=0 then 'awaiting_assets' else 'materialized' end,
    'readinessStore','asset_onboarding_items');
exception when check_violation or unique_violation then
  return jsonb_build_object('error',sqlerrm);
end $$;
revoke all on function public.record_system_readiness_design_origin(bigint,bigint,text,uuid,date,text,uuid) from public,anon;
grant execute on function public.record_system_readiness_design_origin(bigint,bigint,text,uuid,date,text,uuid) to authenticated;

create or replace function public.materialize_readiness_origins_for_bound_asset()
returns trigger language plpgsql security definer set search_path=public as $$
declare o record;
begin
  for o in select id from public.commissioning_system_readiness_design_origins
    where organization_id=new.organization_id and commissioning_system_id=new.commissioning_system_id
  loop
    perform public.materialize_system_readiness_design_origin(o.id,new.asset_id);
  end loop;
  return new;
end $$;
drop trigger if exists trg_materialize_readiness_origins_for_bound_asset on public.commissioning_system_assets;
create trigger trg_materialize_readiness_origins_for_bound_asset
  after insert on public.commissioning_system_assets
  for each row execute function public.materialize_readiness_origins_for_bound_asset();
revoke all on function public.materialize_readiness_origins_for_bound_asset() from public,anon,authenticated;

create or replace function public.get_case_system_readiness_design_origins(p_case_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=public.app_current_org(); c public.development_cases%rowtype; v_systems jsonb;
begin
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'systemId',s.id,'systemRef',s.system_ref,'title',s.title,
    'assetCount',(select count(*) from public.commissioning_system_assets b where b.organization_id=v_org and b.commissioning_system_id=s.id),
    'originCount',(select count(*) from public.commissioning_system_readiness_design_origins o where o.organization_id=v_org and o.commissioning_system_id=s.id),
    'pendingOriginCount',(select count(*) from public.commissioning_system_readiness_design_origins o where o.organization_id=v_org and o.commissioning_system_id=s.id and
      ((select count(*) from public.commissioning_system_assets b where b.organization_id=v_org and b.commissioning_system_id=s.id)=0 or
       (select count(*) from public.commissioning_system_readiness_origin_items x where x.organization_id=v_org and x.design_origin_id=o.id)<
       (select count(*) from public.commissioning_system_assets b where b.organization_id=v_org and b.commissioning_system_id=s.id))),
    'origins',(select coalesce(jsonb_agg(jsonb_build_object(
      'originId',o.id,'designRequirementId',r.id,'requirementRef',r.requirement_ref,
      'requirementCategory',r.category,'requirement',r.requirement,
      'onboardingRequirementKey',o.onboarding_requirement_key,'readinessCategory',cat.ori_category,
      'readinessItem',cat.item_label,'ownerId',o.owner_id,'owner',coalesce(p.full_name,p.email),
      'requiredBefore',o.required_before,'mappingBasis',o.mapping_basis,
      'mappingEvidenceItemId',o.mapping_evidence_item_id,'recordedBy',o.recorded_by,
      'recordedAt',o.recorded_at,
      'materializedItemCount',(select count(*) from public.commissioning_system_readiness_origin_items x where x.organization_id=v_org and x.design_origin_id=o.id),
      'fullyMaterialized',(select count(*) from public.commissioning_system_assets b where b.organization_id=v_org and b.commissioning_system_id=s.id)>0 and
        (select count(*) from public.commissioning_system_readiness_origin_items x where x.organization_id=v_org and x.design_origin_id=o.id)=
        (select count(*) from public.commissioning_system_assets b where b.organization_id=v_org and b.commissioning_system_id=s.id)
    ) order by o.recorded_at,o.id),'[]'::jsonb)
      from public.commissioning_system_readiness_design_origins o
      join public.design_requirements r on r.id=o.design_requirement_id and r.organization_id=o.organization_id
      join public.onboarding_requirements cat on cat.key=o.onboarding_requirement_key
      left join public.user_profiles p on p.id=o.owner_id and p.organization_id=o.organization_id
      where o.organization_id=v_org and o.commissioning_system_id=s.id)
  ) order by s.system_ref),'[]'::jsonb) into v_systems
  from public.commissioning_systems s where s.organization_id=v_org and s.development_case_id=c.id;
  return jsonb_build_object('caseId',c.id,'systems',v_systems,
    'requirementStore','design_requirements','readinessStore','asset_onboarding_items',
    'acceptanceStore','system_handover_packages',
    'decisionBoundary','A named human maps design intent to an existing readiness catalog item. The system creates canonical open items; only evidence completion and the governed HandoverPackage can accept operations ownership.');
end $$;
revoke all on function public.get_case_system_readiness_design_origins(uuid) from public,anon;
grant execute on function public.get_case_system_readiness_design_origins(uuid) to authenticated;

comment on table public.commissioning_system_readiness_design_origins is
  'D8.10 immutable human-approved provenance from canonical design_requirements to a selected operational-readiness catalog item; stores no readiness status.';
comment on table public.commissioning_system_readiness_origin_items is
  'D8.10 immutable trace links from a design origin to canonical commissioning_system_readiness_scope and asset_onboarding_items rows; stores no completion or acceptance.';
notify pgrst,'reload schema';

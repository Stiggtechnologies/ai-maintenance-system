-- D11.21 / spec §34: close the final two core graph relationships by adding
-- governed ASSOCIATIONS between existing canonical objects. Contract, Asset,
-- Objective and Evidence retain their one canonical stores.

create table if not exists public.contract_asset_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  development_case_id uuid not null references public.development_cases(id) on delete cascade,
  contract_package_id bigint not null references public.contract_packages(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  basis text not null check (length(btrim(basis)) >= 20),
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (contract_package_id, asset_id)
);

create table if not exists public.asset_objective_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  development_case_id uuid not null references public.development_cases(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  objective_id uuid not null references public.risk_objectives(id) on delete restrict,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  basis text not null check (length(btrim(basis)) >= 20),
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, asset_id, objective_id)
);

create index if not exists idx_contract_asset_links_case
  on public.contract_asset_links(organization_id, development_case_id, contract_package_id);
create index if not exists idx_asset_objective_links_case
  on public.asset_objective_links(organization_id, development_case_id, objective_id);

alter table public.contract_asset_links enable row level security;
alter table public.asset_objective_links enable row level security;
drop policy if exists contract_asset_links_read on public.contract_asset_links;
create policy contract_asset_links_read on public.contract_asset_links
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists asset_objective_links_read on public.asset_objective_links;
create policy asset_objective_links_read on public.asset_objective_links
  for select to authenticated using (organization_id=public.app_current_org());
-- Deliberately no client write policy: the two named-human RPCs are the doors.

create or replace function public.guard_spec34_relationship()
returns trigger language plpgsql security definer set search_path=public as $$
declare c public.development_cases%rowtype; e public.evidence_items%rowtype;
begin
  if tg_op='UPDATE' then
    raise exception 'A recorded core-graph relationship is immutable; record a new governed relationship rather than rewriting its evidence or meaning.';
  end if;
  if tg_op='DELETE' then
    if not exists(select 1 from public.development_cases where id=old.development_case_id)
       or not exists(select 1 from public.organizations where id=old.organization_id) then return old; end if;
    raise exception 'A recorded core-graph relationship is retained as provenance and cannot be deleted directly.';
  end if;
  select * into c from public.development_cases where id=new.development_case_id and organization_id=new.organization_id;
  if not found then raise exception 'relationship case does not belong to the stated organization'; end if;
  if not exists(select 1 from public.assets a join public.development_case_assets ca on ca.asset_id=a.id and ca.organization_id=a.organization_id
    where a.id=new.asset_id and a.organization_id=new.organization_id and ca.development_case_id=new.development_case_id) then
    raise exception 'relationship asset must be bound to this development case in the same tenant';
  end if;
  select * into e from public.evidence_items where id=new.evidence_item_id and organization_id=new.organization_id;
  if not found or e.verification_status<>'verified' or e.verified_by is null or e.verified_by=new.recorded_by then
    raise exception 'relationship requires same-tenant evidence independently verified by someone other than the recorder';
  end if;
  if tg_table_name='contract_asset_links' then
    if not exists(select 1 from public.contract_packages p where p.id=new.contract_package_id and p.organization_id=new.organization_id and p.development_case_id=new.development_case_id and p.awarded_at is not null) then
      raise exception 'Contract PROVIDES Asset requires an awarded contract package on this development case';
    end if;
  else
    if c.objective_id is null or new.objective_id<>c.objective_id
       or not exists(select 1 from public.risk_objectives o where o.id=new.objective_id and o.organization_id=new.organization_id and o.status='adopted') then
      raise exception 'Asset SUPPORTS Objective must name this case''s adopted canonical objective';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_spec34_relationship() from public,anon,authenticated,service_role;

drop trigger if exists trg_contract_asset_link_guard on public.contract_asset_links;
create trigger trg_contract_asset_link_guard before insert or update or delete on public.contract_asset_links
  for each row execute function public.guard_spec34_relationship();
drop trigger if exists trg_asset_objective_link_guard on public.asset_objective_links;
create trigger trg_asset_objective_link_guard before insert or update or delete on public.asset_objective_links
  for each row execute function public.guard_spec34_relationship();

revoke insert,update,delete,truncate on public.contract_asset_links,public.asset_objective_links from anon,authenticated,service_role;

create or replace function public.link_contract_to_asset(
  p_case_id uuid,p_contract_package_id bigint,p_asset_id uuid,p_evidence_item_id uuid,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','Contract PROVIDES Asset requires an authorized named human');
  end if;
  begin
    insert into public.contract_asset_links(organization_id,development_case_id,contract_package_id,asset_id,evidence_item_id,basis,recorded_by)
    values(v_org,p_case_id,p_contract_package_id,p_asset_id,p_evidence_item_id,btrim(p_basis),auth.uid()) returning id into v_id;
  exception when others then return jsonb_build_object('error',sqlerrm); end;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'contract_provides_asset',v_role,jsonb_build_object('link_id',v_id,'case_id',p_case_id,'contract_package_id',p_contract_package_id,'asset_id',p_asset_id,'evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('linkId',v_id,'edge','Contract PROVIDES Asset');
end $$;

create or replace function public.link_asset_to_objective(
  p_case_id uuid,p_asset_id uuid,p_objective_id uuid,p_evidence_item_id uuid,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','Asset SUPPORTS Objective requires an authorized named human');
  end if;
  begin
    insert into public.asset_objective_links(organization_id,development_case_id,asset_id,objective_id,evidence_item_id,basis,recorded_by)
    values(v_org,p_case_id,p_asset_id,p_objective_id,p_evidence_item_id,btrim(p_basis),auth.uid()) returning id into v_id;
  exception when others then return jsonb_build_object('error',sqlerrm); end;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_supports_objective',v_role,jsonb_build_object('link_id',v_id,'case_id',p_case_id,'asset_id',p_asset_id,'objective_id',p_objective_id,'evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('linkId',v_id,'edge','Asset SUPPORTS Objective');
end $$;

revoke all on function public.link_contract_to_asset(uuid,bigint,uuid,uuid,text) from public,anon;
revoke all on function public.link_asset_to_objective(uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.link_contract_to_asset(uuid,bigint,uuid,uuid,text) to authenticated;
grant execute on function public.link_asset_to_objective(uuid,uuid,uuid,uuid,text) to authenticated;

create or replace function public.get_case_spec34_relationships(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); c public.development_cases%rowtype;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  return jsonb_build_object(
    'caseId',c.id,
    'objective',case when c.objective_id is null then null else (select jsonb_build_object('id',o.id,'description',o.description,'status',o.status) from public.risk_objectives o where o.id=c.objective_id and o.organization_id=v_org) end,
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'tag',a.tag) order by a.name) from public.development_case_assets ca join public.assets a on a.id=ca.asset_id and a.organization_id=ca.organization_id where ca.organization_id=v_org and ca.development_case_id=c.id),'[]'::jsonb),
    'contracts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'packageCode',p.package_code,'title',p.title,'awarded',p.awarded_at is not null) order by p.package_code) from public.contract_packages p where p.organization_id=v_org and p.development_case_id=c.id),'[]'::jsonb),
    'contractProvidesAsset',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'contractPackageId',l.contract_package_id,'packageCode',p.package_code,'assetId',l.asset_id,'asset',a.name,'evidenceItemId',l.evidence_item_id,'basis',l.basis,'recordedBy',l.recorded_by,'createdAt',l.created_at) order by p.package_code,a.name) from public.contract_asset_links l join public.contract_packages p on p.id=l.contract_package_id join public.assets a on a.id=l.asset_id where l.organization_id=v_org and l.development_case_id=c.id),'[]'::jsonb),
    'assetSupportsObjective',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'assetId',l.asset_id,'asset',a.name,'objectiveId',l.objective_id,'objective',o.description,'evidenceItemId',l.evidence_item_id,'basis',l.basis,'recordedBy',l.recorded_by,'createdAt',l.created_at) order by a.name) from public.asset_objective_links l join public.assets a on a.id=l.asset_id join public.risk_objectives o on o.id=l.objective_id where l.organization_id=v_org and l.development_case_id=c.id),'[]'::jsonb),
    'decisionBoundary','These are evidence-backed graph relationships, not contract acceptance, asset commissioning, objective achievement, gate approval or authorization to act.');
end $$;
revoke all on function public.get_case_spec34_relationships(uuid) from public,anon;
grant execute on function public.get_case_spec34_relationships(uuid) to authenticated;

-- Transform the live nineteen-edge ledger; never retype entries that this
-- slice does not own.
do $ledger$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sync_spec34_edges';
  if v_def is null then raise exception 'sync_spec34_edges is missing'; end if;
  v_new:=replace(v_def,
    $old$'home','contract_packages exists; no contract→asset relation does','status','absent',$old$,
    $new$'home','contract_asset_links (20261220070000)','status','live_elsewhere',$new$);
  v_new:=replace(v_new,
    $old$'note','The §24 Contract object lands with procurement (D6.05/D6.08). The CDE''s procurement_item kind is registered by reference until then and does not pretend to be a contract.'$old$,
    $new$'note','The canonical awarded contract package names canonical assets through an immutable, independently evidenced association. The association grants no acceptance or commissioning authority.'$new$);
  v_new:=replace(v_new,
    $old$'home','none — no asset→objective relation is stored','status','absent',$old$,
    $new$'home','asset_objective_links (20261220070000)','status','live_elsewhere',$new$);
  v_new:=replace(v_new,
    $old$'note','Reachable today only transitively (asset ← requirement → objective). A transitive path is not the edge, and this ledger does not claim it is.'$old$,
    $new$'note','A canonical case-bound asset names the case''s adopted canonical objective through an immutable, independently evidenced association. The link is not proof that the objective was achieved.'$new$);
  if v_new=v_def or position('contract_asset_links (20261220070000)' in v_new)=0 or position('asset_objective_links (20261220070000)' in v_new)=0 then
    raise exception 'the two remaining §34 ledger entries were not found in their governed predecessor shape';
  end if;
  execute v_new;
end $ledger$;

create or replace function public.sync_spec34_absent_edge_audit()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'checkedAt',now(),'absentEdgeCount',0,'newlyClosableCount',0,'edges','[]'::jsonb,
    'implementedEdgeCount',19,
    'note','All nineteen §34 relationship types now have canonical homes. The final two are contract_asset_links and asset_objective_links; both are immutable, tenant-scoped, evidence-backed associations over existing canonical objects.');
$$;
revoke all on function public.sync_spec34_absent_edge_audit() from public,anon;
grant execute on function public.sync_spec34_absent_edge_audit() to authenticated,service_role;

comment on table public.contract_asset_links is 'D11.21 Contract PROVIDES Asset association. It links canonical objects and does not create a second Contract or Asset store.';
comment on table public.asset_objective_links is 'D11.21 Asset SUPPORTS Objective association. It links canonical objects and does not claim objective achievement.';
comment on function public.get_case_spec34_relationships(uuid) is 'D11.21 reachable readback for the final two §34 relationships and their evidence provenance.';
notify pgrst,'reload schema';

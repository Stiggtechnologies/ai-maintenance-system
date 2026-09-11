-- Sync Develop Slice 8 / D8.08 — system-scoped operational readiness.
-- Canonical reuse is deliberate: asset_onboarding_items remains the one readiness
-- item store. This association adds commissioning-system scope and accountability;
-- it carries no competing status, value, or completion evidence.

alter table public.asset_onboarding_items
  add column if not exists evidence_item_id uuid references public.evidence_items(id);

create table if not exists public.commissioning_system_readiness_scope (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  commissioning_system_id bigint not null references public.commissioning_systems(id) on delete cascade,
  onboarding_item_id uuid not null references public.asset_onboarding_items(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  required_before date not null,
  basis text not null check (length(btrim(basis)) >= 20),
  basis_evidence_item_id uuid not null references public.evidence_items(id),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  unique (commissioning_system_id, onboarding_item_id)
);

create index if not exists idx_commissioning_system_readiness_scope_system
  on public.commissioning_system_readiness_scope
  (organization_id, commissioning_system_id, required_before);

alter table public.commissioning_system_readiness_scope enable row level security;
drop policy if exists commissioning_system_readiness_scope_read on public.commissioning_system_readiness_scope;
create policy commissioning_system_readiness_scope_read
  on public.commissioning_system_readiness_scope for select
  using (organization_id = public.app_current_org());

create or replace function public.guard_commissioning_system_readiness_scope()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_system public.commissioning_systems%rowtype; v_item public.asset_onboarding_items%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'commissioning system readiness scope is append-only';
  end if;
  select * into v_system from public.commissioning_systems where id=new.commissioning_system_id;
  select * into v_item from public.asset_onboarding_items where id=new.onboarding_item_id;
  if v_system.id is null or v_item.id is null
     or v_system.organization_id<>new.organization_id
     or v_item.organization_id<>new.organization_id then
    raise exception 'commissioning readiness scope must remain in one tenant';
  end if;
  if not exists (
    select 1 from public.commissioning_system_assets a
    where a.organization_id=new.organization_id
      and a.commissioning_system_id=new.commissioning_system_id
      and a.asset_id=v_item.asset_id
  ) then raise exception 'readiness item asset must be bound to the commissioning system'; end if;
  if not exists(select 1 from public.user_profiles p where p.id=new.owner_id and p.organization_id=new.organization_id)
     or not exists(select 1 from public.user_profiles p where p.id=new.assigned_by and p.organization_id=new.organization_id) then
    raise exception 'readiness owner and assigner must be named humans in the same tenant';
  end if;
  if not exists(select 1 from public.evidence_items e where e.id=new.basis_evidence_item_id and e.organization_id=new.organization_id) then
    raise exception 'same-tenant assignment evidence is required';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_commissioning_system_readiness_scope on public.commissioning_system_readiness_scope;
create trigger trg_guard_commissioning_system_readiness_scope
  before insert or update or delete on public.commissioning_system_readiness_scope
  for each row execute function public.guard_commissioning_system_readiness_scope();
revoke all on function public.guard_commissioning_system_readiness_scope() from public,anon,authenticated;

create or replace function public.guard_system_readiness_item_evidence()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.evidence_item_id is not distinct from old.evidence_item_id then return new; end if;
  if current_setting('app.system_readiness_write',true)<>'allowed' then
    raise exception 'system-scoped readiness evidence must be recorded through the governed human workflow';
  end if;
  if new.evidence_item_id is not null and not exists(
    select 1 from public.evidence_items e
    where e.id=new.evidence_item_id and e.organization_id=new.organization_id
      and (e.asset_id is null or e.asset_id=new.asset_id)
  ) then raise exception 'readiness completion evidence must match the tenant and asset'; end if;
  return new;
end $$;

drop trigger if exists trg_guard_system_readiness_item_evidence on public.asset_onboarding_items;
create trigger trg_guard_system_readiness_item_evidence
  before update of evidence_item_id on public.asset_onboarding_items
  for each row execute function public.guard_system_readiness_item_evidence();
revoke all on function public.guard_system_readiness_item_evidence() from public,anon,authenticated;

create or replace function public.guard_completed_system_readiness_item()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.evidence_item_id is not null
     and current_setting('app.system_readiness_write',true)<>'allowed'
     and (new.status,new.value,new.source,new.confidence,new.note,new.filled_at,new.provided_by,new.evidence_item_id)
       is distinct from
       (old.status,old.value,old.source,old.confidence,old.note,old.filled_at,old.provided_by,old.evidence_item_id) then
    raise exception 'completed system readiness evidence is immutable';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_completed_system_readiness_item on public.asset_onboarding_items;
create trigger trg_guard_completed_system_readiness_item
  before update on public.asset_onboarding_items
  for each row execute function public.guard_completed_system_readiness_item();
revoke all on function public.guard_completed_system_readiness_item() from public,anon,authenticated;

create or replace function public.initialize_commissioning_system_readiness(
  p_system_id bigint, p_owner_id uuid, p_required_before date,
  p_basis text, p_basis_evidence_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; s public.commissioning_systems%rowtype; v_count int;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if not public.commissioning_author_role(v_role) then return jsonb_build_object('error','named-human planning or engineering authority required'); end if;
  select * into s from public.commissioning_systems where id=p_system_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','commissioning system not found'); end if;
  if not exists(select 1 from public.commissioning_system_assets a where a.organization_id=v_org and a.commissioning_system_id=s.id) then
    return jsonb_build_object('error','bind at least one asset to the commissioning system before assigning readiness items');
  end if;
  if not exists(select 1 from public.user_profiles p where p.id=p_owner_id and p.organization_id=v_org) then return jsonb_build_object('error','same-tenant named readiness owner is required'); end if;
  if p_required_before is null then return jsonb_build_object('error','required-before date is required'); end if;
  if coalesce(length(btrim(p_basis)),0)<20 then return jsonb_build_object('error','a substantive readiness assignment basis is required'); end if;
  if not exists(select 1 from public.evidence_items e where e.id=p_basis_evidence_item_id and e.organization_id=v_org) then return jsonb_build_object('error','same-tenant assignment evidence is required'); end if;

  insert into public.asset_onboarding_items(organization_id,asset_id,requirement_key)
  select v_org,a.asset_id,r.key
  from public.commissioning_system_assets a cross join public.onboarding_requirements r
  where a.organization_id=v_org and a.commissioning_system_id=s.id and r.ori_category is not null
  on conflict(asset_id,requirement_key) do nothing;

  insert into public.commissioning_system_readiness_scope(
    organization_id,commissioning_system_id,onboarding_item_id,owner_id,
    required_before,basis,basis_evidence_item_id,assigned_by)
  select v_org,s.id,i.id,p_owner_id,p_required_before,btrim(p_basis),p_basis_evidence_item_id,auth.uid()
  from public.commissioning_system_assets a
  join public.asset_onboarding_items i on i.organization_id=v_org and i.asset_id=a.asset_id
  join public.onboarding_requirements r on r.key=i.requirement_key and r.ori_category is not null
  where a.organization_id=v_org and a.commissioning_system_id=s.id
  on conflict(commissioning_system_id,onboarding_item_id) do nothing;
  get diagnostics v_count=row_count;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'commissioning_system_readiness_scope',v_role,jsonb_build_object('system_id',s.id,'items_assigned',v_count,'owner_id',p_owner_id,'required_before',p_required_before,'basis_evidence_item_id',p_basis_evidence_item_id));
  return jsonb_build_object('systemId',s.id,'itemsAssigned',v_count,'status','recorded');
end $$;

revoke all on function public.initialize_commissioning_system_readiness(bigint,uuid,date,text,uuid) from public,anon;
grant execute on function public.initialize_commissioning_system_readiness(bigint,uuid,date,text,uuid) to authenticated;

create or replace function public.record_system_operational_readiness_item(
  p_system_id bigint, p_item_id uuid, p_status text, p_evidence_item_id uuid,
  p_note text, p_value jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_item public.asset_onboarding_items%rowtype; v_scope public.commissioning_system_readiness_scope%rowtype;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if not public.commissioning_author_role(v_role) and v_role<>'operator' then return jsonb_build_object('error','named-human readiness authority required'); end if;
  select * into v_scope from public.commissioning_system_readiness_scope where organization_id=v_org and commissioning_system_id=p_system_id and onboarding_item_id=p_item_id;
  if not found then return jsonb_build_object('error','system-scoped readiness item not found'); end if;
  select * into v_item from public.asset_onboarding_items where id=p_item_id and organization_id=v_org for update;
  if p_status not in ('human_provided','not_applicable') then return jsonb_build_object('error','human readiness outcome must be human_provided or not_applicable'); end if;
  if v_item.evidence_item_id is not null then return jsonb_build_object('error','completed readiness evidence is immutable'); end if;
  if coalesce(length(btrim(p_note)),0)<20 then return jsonb_build_object('error','a substantive human readiness note is required'); end if;
  if not exists(select 1 from public.evidence_items e where e.id=p_evidence_item_id and e.organization_id=v_org and (e.asset_id is null or e.asset_id=v_item.asset_id)) then
    return jsonb_build_object('error','same-tenant evidence matching the readiness asset is required');
  end if;
  perform set_config('app.system_readiness_write','allowed',true);
  update public.asset_onboarding_items set status=p_status,value=coalesce(p_value,'{}'::jsonb),source='human',confidence='high',note=btrim(p_note),filled_at=now(),provided_by=auth.uid(),evidence_item_id=p_evidence_item_id where id=v_item.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'operational_readiness_item',v_role,jsonb_build_object('system_id',p_system_id,'item_id',v_item.id,'asset_id',v_item.asset_id,'requirement_key',v_item.requirement_key,'previous_status',v_item.status,'status',p_status,'evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('systemId',p_system_id,'itemId',v_item.id,'status',p_status,'evidenceItemId',p_evidence_item_id);
end $$;

revoke all on function public.record_system_operational_readiness_item(bigint,uuid,text,uuid,text,jsonb) from public,anon;
grant execute on function public.record_system_operational_readiness_item(bigint,uuid,text,uuid,text,jsonb) to authenticated;

create or replace function public.get_case_system_operational_readiness(p_case_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=public.app_current_org(); c public.development_cases%rowtype; v_systems jsonb;
begin
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'systemId',s.id,'systemRef',s.system_ref,'title',s.title,'currentState',s.commissioning_state,
    'assetCount',(select count(*) from public.commissioning_system_assets a where a.organization_id=v_org and a.commissioning_system_id=s.id),
    'itemCount',(select count(*) from public.commissioning_system_readiness_scope q where q.organization_id=v_org and q.commissioning_system_id=s.id),
    'satisfiedCount',(select count(*) from public.commissioning_system_readiness_scope q join public.asset_onboarding_items i on i.id=q.onboarding_item_id where q.organization_id=v_org and q.commissioning_system_id=s.id and i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null),
    'overdueOpenCount',(select count(*) from public.commissioning_system_readiness_scope q join public.asset_onboarding_items i on i.id=q.onboarding_item_id where q.organization_id=v_org and q.commissioning_system_id=s.id and q.required_before<current_date and not(i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null)),
    'items',(select coalesce(jsonb_agg(jsonb_build_object(
      'scopeId',q.id,'itemId',i.id,'assetId',i.asset_id,'asset',a.name,'assetTag',a.tag,
      'requirementKey',i.requirement_key,'item',r.item_label,'category',r.ori_category,
      'ownerId',q.owner_id,'owner',coalesce(p.full_name,p.email),'requiredBefore',q.required_before,
      'status',i.status,'evidenceItemId',i.evidence_item_id,'evidenceReady',i.evidence_item_id is not null,
      'overdue',q.required_before<current_date and not(i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null)
    ) order by q.required_before,r.sort_order,a.name),'[]'::jsonb)
      from public.commissioning_system_readiness_scope q
      join public.asset_onboarding_items i on i.id=q.onboarding_item_id
      join public.assets a on a.id=i.asset_id
      join public.onboarding_requirements r on r.key=i.requirement_key
      left join public.user_profiles p on p.id=q.owner_id
      where q.organization_id=v_org and q.commissioning_system_id=s.id)
  ) order by s.system_ref),'[]'::jsonb) into v_systems
  from public.commissioning_systems s where s.organization_id=v_org and s.development_case_id=c.id;
  return jsonb_build_object('caseId',c.id,'systems',v_systems,'readinessStore','asset_onboarding_items','decisionBoundary','System readiness records evidence and accountability; it does not accept handover, authorize energization, or approve operations ownership.');
end $$;

revoke all on function public.get_case_system_operational_readiness(uuid) from public,anon;
grant execute on function public.get_case_system_operational_readiness(uuid) to authenticated;

comment on table public.commissioning_system_readiness_scope is 'D8.08 normalized commissioning-system scope over canonical asset_onboarding_items; no readiness status is copied here.';
comment on column public.asset_onboarding_items.evidence_item_id is 'Governed evidence supporting a human-provided or not-applicable readiness outcome.';
notify pgrst,'reload schema';

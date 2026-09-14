-- ============================================================================
-- U12.01 / U12.02 — asset tenure relationships and accountable party roles.
--
-- Canonical reuse: assets, asset_tenure, risk_stakeholders, evidence_items and
-- audit_events. No second asset, party, evidence, approval or audit store.
-- A recorded relationship describes responsibility; it never grants product
-- permissions, work release, operating authority or approval authority.
-- ============================================================================

-- Complete the vocabulary on the existing ONE tenure table. The old
-- rented_temporary code is normalized to the manufacturer-neutral term used by
-- the capability register; its required end-date invariant remains.
alter table public.asset_tenure
  drop constraint if exists asset_tenure_tenure_check;
alter table public.asset_tenure
  drop constraint if exists asset_tenure_check;
update public.asset_tenure set tenure='rented' where tenure='rented_temporary';
alter table public.asset_tenure
  add constraint asset_tenure_kind_check check (tenure in
    ('owned','leased','rented','concession','oem_maintained','third_party',
     'shared','ppp','customer_owned','supplier_managed'));
alter table public.asset_tenure
  add column if not exists counterparty_stakeholder_id uuid
    references public.risk_stakeholders(id) on delete set null,
  add column if not exists evidence_item_ids uuid[] not null default '{}',
  add column if not exists relationship_basis text,
  add column if not exists relationship_status text not null default 'draft'
    check (relationship_status in ('draft','verified')),
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists verified_at timestamptz,
  add column if not exists verification_note text;
alter table public.asset_tenure
  drop constraint if exists asset_tenure_rented_end_check;
alter table public.asset_tenure
  add constraint asset_tenure_rented_end_check
    check (tenure<>'rented' or ends_on is not null);
alter table public.asset_tenure
  drop constraint if exists asset_tenure_verification_shape_check;
alter table public.asset_tenure
  add constraint asset_tenure_verification_shape_check check (
    (relationship_status='draft' and verified_by is null and verified_at is null)
    or
    (relationship_status='verified' and recorded_by is not null
      and verified_by is not null and verified_at is not null
      and recorded_by<>verified_by
      and length(trim(coalesce(verification_note,'')))>=20)
  );

revoke insert,update,delete,truncate on public.asset_tenure
  from public,anon,authenticated;

create table if not exists public.asset_party_role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  stakeholder_id uuid not null references public.risk_stakeholders(id) on delete restrict,
  party_role text not null check (party_role in
    ('owner','operator','maintainer','engineering_authority','risk_owner',
     'regulator','insurer','warranty_provider','payer')),
  responsibility_scope text not null,
  agreement_reference text,
  evidence_item_ids uuid[] not null default '{}',
  effective_from date not null,
  effective_to date,
  status text not null default 'draft' check (status in ('draft','verified','superseded')),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  verification_note text,
  supersedes_id uuid references public.asset_party_role_assignments(id),
  register_ref text not null default 'U12.02',
  check (effective_to is null or effective_to>=effective_from),
  check (length(trim(responsibility_scope))>=20),
  check (
    (status='draft' and verified_by is null and verified_at is null)
    or
    (status='verified' and verified_by is not null and verified_at is not null
      and assigned_by<>verified_by
      and length(trim(coalesce(verification_note,'')))>=20)
    or status='superseded'
  )
);
create unique index if not exists uq_asset_party_role_active
  on public.asset_party_role_assignments(
    organization_id,asset_id,stakeholder_id,party_role)
  where status in ('draft','verified');
create index if not exists idx_asset_party_role_org
  on public.asset_party_role_assignments(organization_id,asset_id,party_role);

alter table public.asset_party_role_assignments enable row level security;
drop policy if exists asset_party_role_assignments_read
  on public.asset_party_role_assignments;
create policy asset_party_role_assignments_read
  on public.asset_party_role_assignments for select to authenticated
  using (organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.asset_party_role_assignments
  from public,anon,authenticated;

create or replace function public.record_asset_relationship(
  p_asset_id uuid,
  p_tenure text,
  p_relationship_basis text,
  p_counterparty_stakeholder_id uuid default null,
  p_agreement_reference text default null,
  p_maintenance_responsibility text default null,
  p_history_visible_to_site boolean default true,
  p_strategy_constraint text default null,
  p_starts_on date default null,
  p_ends_on date default null,
  p_evidence_item_ids uuid[] default '{}'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_ids uuid[]:=coalesce(p_evidence_item_ids,'{}');
  v_previous jsonb;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error',
      'recording an asset relationship requires a named same-tenant planning, engineering or accountable management role; AI identity is not accepted');
  end if;
  if not exists(select 1 from public.assets
    where id=p_asset_id and organization_id=v_org) then
    return jsonb_build_object('error','asset not found in this organization');
  end if;
  if p_tenure not in ('owned','leased','rented','concession','oem_maintained',
    'third_party','shared','ppp','customer_owned','supplier_managed') then
    return jsonb_build_object('error','unsupported asset relationship type');
  end if;
  if coalesce(length(trim(p_relationship_basis)),0)<20 then
    return jsonb_build_object('error','state the relationship basis and limitations (20 characters minimum)');
  end if;
  if p_tenure='rented' and p_ends_on is null then
    return jsonb_build_object('error','a rented relationship requires an end date');
  end if;
  if p_ends_on is not null and p_starts_on is not null and p_ends_on<p_starts_on then
    return jsonb_build_object('error','relationship end date cannot precede start date');
  end if;
  if p_maintenance_responsibility is not null and
     p_maintenance_responsibility not in ('site','counterparty','shared') then
    return jsonb_build_object('error','maintenance responsibility must be site, counterparty, or shared');
  end if;
  if p_tenure<>'owned' and p_counterparty_stakeholder_id is null then
    return jsonb_build_object('error','a non-owned relationship requires a canonical stakeholder counterparty');
  end if;
  if p_counterparty_stakeholder_id is not null and not exists(
    select 1 from public.risk_stakeholders where id=p_counterparty_stakeholder_id
      and organization_id=v_org and active) then
    return jsonb_build_object('error','counterparty stakeholder not found in this organization');
  end if;
  if cardinality(v_ids)<>cardinality(array(select distinct unnest(v_ids))) then
    return jsonb_build_object('error','evidence item ids must be unique');
  end if;
  if exists(select 1 from unnest(v_ids) x(id)
    left join public.evidence_items e on e.id=x.id and e.organization_id=v_org
    where e.id is null or (e.asset_id is not null and e.asset_id<>p_asset_id)) then
    return jsonb_build_object('error','every evidence item must belong to this organization and asset when asset-scoped');
  end if;

  select to_jsonb(t) into v_previous from public.asset_tenure t
  where asset_id=p_asset_id and organization_id=v_org for update;
  insert into public.asset_tenure(
    asset_id,organization_id,tenure,counterparty,agreement_reference,
    starts_on,ends_on,maintenance_responsibility,history_visible_to_site,
    strategy_constraint,counterparty_stakeholder_id,evidence_item_ids,
    relationship_basis,relationship_status,recorded_by,recorded_at,
    verified_by,verified_at,verification_note
  ) values(
    p_asset_id,v_org,p_tenure,
    (select name from public.risk_stakeholders where id=p_counterparty_stakeholder_id),
    nullif(trim(coalesce(p_agreement_reference,'')),''),p_starts_on,p_ends_on,
    p_maintenance_responsibility,p_history_visible_to_site,
    nullif(trim(coalesce(p_strategy_constraint,'')),''),
    p_counterparty_stakeholder_id,v_ids,trim(p_relationship_basis),'draft',
    auth.uid(),now(),null,null,null
  ) on conflict(asset_id) do update set
    tenure=excluded.tenure,counterparty=excluded.counterparty,
    agreement_reference=excluded.agreement_reference,starts_on=excluded.starts_on,
    ends_on=excluded.ends_on,maintenance_responsibility=excluded.maintenance_responsibility,
    history_visible_to_site=excluded.history_visible_to_site,
    strategy_constraint=excluded.strategy_constraint,
    counterparty_stakeholder_id=excluded.counterparty_stakeholder_id,
    evidence_item_ids=excluded.evidence_item_ids,
    relationship_basis=excluded.relationship_basis,relationship_status='draft',
    recorded_by=auth.uid(),recorded_at=now(),verified_by=null,verified_at=null,
    verification_note=null;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_tenure',v_role,jsonb_build_object(
    'asset_id',p_asset_id,'tenure',p_tenure,'status','draft',
    'previous',v_previous,'evidence_count',cardinality(v_ids),
    'boundary','relationship record only; no permission, work, operating or approval authority granted'));
  return jsonb_build_object('asset_id',p_asset_id,'tenure',p_tenure,'status','draft',
    'note','Relationship recorded for independent review; responsibility labels do not grant authority.');
end $$;

create or replace function public.verify_asset_relationship(
  p_asset_id uuid,
  p_decision text,
  p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; v_row public.asset_tenure%rowtype;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','relationship verification requires named same-tenant engineering or accountable management');
  end if;
  select * into v_row from public.asset_tenure where asset_id=p_asset_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','asset relationship not found'); end if;
  if v_row.relationship_status<>'draft' then return jsonb_build_object('error','only a draft relationship can be verified'); end if;
  if v_row.recorded_by is null then return jsonb_build_object('error','legacy relationship must be re-attested before verification'); end if;
  if v_row.recorded_by=auth.uid() then return jsonb_build_object('error','the relationship author cannot independently verify the same record'); end if;
  if p_decision<>'verified' then return jsonb_build_object('error','decision must be verified'); end if;
  if coalesce(length(trim(p_note)),0)<20 then return jsonb_build_object('error','record a substantive verification method and conclusion (20 characters minimum)'); end if;
  update public.asset_tenure set relationship_status='verified',verified_by=auth.uid(),
    verified_at=now(),verification_note=trim(p_note) where asset_id=p_asset_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_tenure',v_role,jsonb_build_object('asset_id',p_asset_id,
    'decision','verified','independent',true,
    'boundary','verification confirms the record; it grants no authority'));
  return jsonb_build_object('asset_id',p_asset_id,'status','verified',
    'note','Relationship verified; no product permission or operating authority was granted.');
end $$;

create or replace function public.record_asset_party_role(
  p_asset_id uuid,
  p_stakeholder_id uuid,
  p_party_role text,
  p_responsibility_scope text,
  p_effective_from date,
  p_effective_to date default null,
  p_agreement_reference text default null,
  p_evidence_item_ids uuid[] default '{}'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; v_ids uuid[]:=coalesce(p_evidence_item_ids,'{}');
  v_existing public.asset_party_role_assignments%rowtype; v_id uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','assigning an asset party role requires a named same-tenant planning, engineering or accountable management role; AI identity is not accepted');
  end if;
  if not exists(select 1 from public.assets where id=p_asset_id and organization_id=v_org) then
    return jsonb_build_object('error','asset not found in this organization');
  end if;
  if not exists(select 1 from public.risk_stakeholders where id=p_stakeholder_id and organization_id=v_org and active) then
    return jsonb_build_object('error','stakeholder not found in this organization');
  end if;
  if p_party_role not in ('owner','operator','maintainer','engineering_authority','risk_owner','regulator','insurer','warranty_provider','payer') then
    return jsonb_build_object('error','unsupported asset party role');
  end if;
  if coalesce(length(trim(p_responsibility_scope)),0)<20 then
    return jsonb_build_object('error','state the responsibility scope and limitations (20 characters minimum)');
  end if;
  if p_effective_from is null or (p_effective_to is not null and p_effective_to<p_effective_from) then
    return jsonb_build_object('error','valid effective dates are required');
  end if;
  if cardinality(v_ids)<>cardinality(array(select distinct unnest(v_ids))) then return jsonb_build_object('error','evidence item ids must be unique'); end if;
  if exists(select 1 from unnest(v_ids) x(id) left join public.evidence_items e
    on e.id=x.id and e.organization_id=v_org where e.id is null or (e.asset_id is not null and e.asset_id<>p_asset_id)) then
    return jsonb_build_object('error','every evidence item must belong to this organization and asset when asset-scoped');
  end if;
  select * into v_existing from public.asset_party_role_assignments where
    organization_id=v_org and asset_id=p_asset_id and stakeholder_id=p_stakeholder_id
    and party_role=p_party_role and status in ('draft','verified') for update;
  if found then update public.asset_party_role_assignments set status='superseded' where id=v_existing.id; end if;
  insert into public.asset_party_role_assignments(organization_id,asset_id,stakeholder_id,
    party_role,responsibility_scope,agreement_reference,evidence_item_ids,effective_from,
    effective_to,assigned_by,supersedes_id) values(v_org,p_asset_id,p_stakeholder_id,
    p_party_role,trim(p_responsibility_scope),nullif(trim(coalesce(p_agreement_reference,'')),''),
    v_ids,p_effective_from,p_effective_to,auth.uid(),v_existing.id) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_party_role_assignment',v_role,jsonb_build_object('assignment_id',v_id,
    'asset_id',p_asset_id,'stakeholder_id',p_stakeholder_id,'party_role',p_party_role,
    'status','draft','evidence_count',cardinality(v_ids),
    'boundary','responsibility label only; no permission, work, operating or approval authority granted'));
  return jsonb_build_object('assignment_id',v_id,'party_role',p_party_role,'status','draft',
    'note','Party responsibility recorded for independent review; it grants no product authority.');
end $$;

create or replace function public.verify_asset_party_role(
  p_assignment_id uuid,
  p_decision text,
  p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; v_row public.asset_party_role_assignments%rowtype;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','party-role verification requires named same-tenant engineering or accountable management');
  end if;
  select * into v_row from public.asset_party_role_assignments where id=p_assignment_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','party-role assignment not found'); end if;
  if v_row.status<>'draft' then return jsonb_build_object('error','only a draft party-role assignment can be verified'); end if;
  if v_row.assigned_by=auth.uid() then return jsonb_build_object('error','the assignment author cannot independently verify the same party role'); end if;
  if p_decision not in ('verified','superseded') then return jsonb_build_object('error','decision must be verified or superseded'); end if;
  if coalesce(length(trim(p_note)),0)<20 then return jsonb_build_object('error','record a substantive verification method and conclusion (20 characters minimum)'); end if;
  update public.asset_party_role_assignments set status=p_decision,verified_by=auth.uid(),
    verified_at=now(),verification_note=trim(p_note) where id=v_row.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_party_role_assignment',v_role,jsonb_build_object('assignment_id',v_row.id,
    'asset_id',v_row.asset_id,'party_role',v_row.party_role,'decision',p_decision,
    'independent',true,'boundary','verification confirms responsibility; it grants no authority'));
  return jsonb_build_object('assignment_id',v_row.id,'status',p_decision,
    'note','Party-role disposition recorded; no product permission or operating authority was granted.');
end $$;

create or replace function public.get_asset_relationship_workspace()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.app_current_org() is null then jsonb_build_object('error','forbidden') else
    jsonb_build_object(
      'relationship_types',jsonb_build_array('owned','leased','rented','concession','oem_maintained','third_party','shared','ppp','customer_owned','supplier_managed'),
      'party_roles',jsonb_build_array('owner','operator','maintainer','engineering_authority','risk_owner','regulator','insurer','warranty_provider','payer'),
      'relationships',coalesce((select jsonb_agg(jsonb_build_object(
        'asset_id',t.asset_id,'asset',a.name,'tenure',t.tenure,
        'counterparty_stakeholder_id',t.counterparty_stakeholder_id,
        'counterparty',coalesce(s.name,t.counterparty),'agreement_reference',t.agreement_reference,
        'maintenance_responsibility',t.maintenance_responsibility,
        'history_visible_to_site',t.history_visible_to_site,
        'strategy_constraint',t.strategy_constraint,'starts_on',t.starts_on,'ends_on',t.ends_on,
        'evidence_item_ids',t.evidence_item_ids,'basis',t.relationship_basis,
        'status',t.relationship_status,'recorded_by',t.recorded_by,'recorded_at',t.recorded_at,
        'verified_by',t.verified_by,'verified_at',t.verified_at,'verification_note',t.verification_note
      ) order by a.name) from public.asset_tenure t join public.assets a
        on a.id=t.asset_id and a.organization_id=t.organization_id left join public.risk_stakeholders s
        on s.id=t.counterparty_stakeholder_id and s.organization_id=t.organization_id
        where t.organization_id=public.app_current_org()),'[]'::jsonb),
      'assignments',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'asset_id',r.asset_id,'asset',a.name,'stakeholder_id',r.stakeholder_id,
        'stakeholder',s.name,'party_role',r.party_role,'responsibility_scope',r.responsibility_scope,
        'agreement_reference',r.agreement_reference,'evidence_item_ids',r.evidence_item_ids,
        'effective_from',r.effective_from,'effective_to',r.effective_to,'status',r.status,
        'assigned_by',r.assigned_by,'assigned_at',r.assigned_at,
        'verified_by',r.verified_by,'verified_at',r.verified_at,'verification_note',r.verification_note
      ) order by a.name,r.party_role,s.name) from public.asset_party_role_assignments r
        join public.assets a on a.id=r.asset_id and a.organization_id=r.organization_id
        join public.risk_stakeholders s on s.id=r.stakeholder_id and s.organization_id=r.organization_id
        where r.organization_id=public.app_current_org() and r.status in ('draft','verified')),'[]'::jsonb),
      'basis','Relationships and party roles describe accountable responsibility. They do not grant product permissions, work release, operating authority or approval authority.'
    ) end
$$;

revoke all on function public.record_asset_relationship(uuid,text,text,uuid,text,text,boolean,text,date,date,uuid[]) from public,anon;
revoke all on function public.verify_asset_relationship(uuid,text,text) from public,anon;
revoke all on function public.record_asset_party_role(uuid,uuid,text,text,date,date,text,uuid[]) from public,anon;
revoke all on function public.verify_asset_party_role(uuid,text,text) from public,anon;
revoke all on function public.get_asset_relationship_workspace() from public,anon;
grant execute on function public.record_asset_relationship(uuid,text,text,uuid,text,text,boolean,text,date,date,uuid[]) to authenticated,service_role;
grant execute on function public.verify_asset_relationship(uuid,text,text) to authenticated,service_role;
grant execute on function public.record_asset_party_role(uuid,uuid,text,text,date,date,text,uuid[]) to authenticated,service_role;
grant execute on function public.verify_asset_party_role(uuid,text,text) to authenticated,service_role;
grant execute on function public.get_asset_relationship_workspace() to authenticated,service_role;

comment on table public.asset_party_role_assignments is
  'U12.02 accountable party-role overlay on canonical assets and risk_stakeholders. Describes responsibility and grants no authority.';
comment on function public.get_asset_relationship_workspace() is
  'U12.01/U12.02 tenant-scoped relationship and accountability read model; labels never grant permissions or operating authority.';

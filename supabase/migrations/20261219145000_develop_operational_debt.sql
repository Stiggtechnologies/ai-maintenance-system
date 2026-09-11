-- Sync Develop D8.03 — Operational Debt at handover.
-- This is a register OF REFERENCES. Source facts stay in their canonical
-- families; the register adds only case accountability, owner and operations
-- acknowledgement.

create table if not exists public.operational_debt_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  development_case_id uuid not null references public.development_cases(id) on delete cascade,
  gap_class text not null check (gap_class in ('punch_items','temporary_repairs','workarounds',
    'missing_spares','missing_pms','documentation_gaps','training_gaps','software_gaps','reliability_defects')),
  source_table text not null check (source_table in
    ('acceptance_tests','temporary_modifications','asset_onboarding_items','quality_defects')),
  source_id text not null check (btrim(source_id)<>''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  due_on date,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users(id) on delete restrict,
  acknowledged_at timestamptz,
  acknowledgement_basis text,
  unique(development_case_id,gap_class,source_table,source_id),
  check ((acknowledged_by is null and acknowledged_at is null and acknowledgement_basis is null)
    or (acknowledged_by is not null and acknowledged_at is not null and length(btrim(acknowledgement_basis))>=20)),
  check ((gap_class='punch_items' and source_table='acceptance_tests')
    or (gap_class in ('temporary_repairs','workarounds') and source_table='temporary_modifications')
    or (gap_class in ('missing_spares','missing_pms','documentation_gaps','training_gaps','software_gaps') and source_table='asset_onboarding_items')
    or (gap_class='reliability_defects' and source_table='quality_defects'))
);
create index if not exists idx_operational_debt_case on public.operational_debt_items(organization_id,development_case_id,recorded_at);
alter table public.operational_debt_items enable row level security;
drop policy if exists operational_debt_read on public.operational_debt_items;
create policy operational_debt_read on public.operational_debt_items for select to authenticated using(organization_id=app_current_org());

create or replace function public.get_case_operational_debt_candidates(p_case_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  with c as (select * from development_cases where id=p_case_id and organization_id=app_current_org()),
  candidates as (
    select 'punch_items'::text gap_class,'acceptance_tests'::text source_table,t.id::text source_id,
      t.test_ref||' — '||t.punch_items_open||' open punch item(s)' label,null::uuid asset_id
    from c join acceptance_tests t on t.organization_id=c.organization_id and t.project_id=c.capital_project_id
    where t.punch_items_open>0
    union all
    select case when t.modification_kind in ('temporary_repair','temporary_support') then 'temporary_repairs' else 'workarounds' end,
      'temporary_modifications',t.id::text,a.name||' — '||t.modification_kind||': '||t.description,t.asset_id
    from c join temporary_modifications t on t.organization_id=c.organization_id and t.removed_at is null
      and (t.origin_development_case_id=c.id or exists(select 1 from development_case_assets d where d.organization_id=c.organization_id and d.development_case_id=c.id and d.asset_id=t.asset_id))
      join assets a on a.id=t.asset_id
    union all
    select case when r.ori_category in ('spares','bom') then 'missing_spares'
      when r.ori_category in ('pm','task_list','inspection','condition_monitoring') then 'missing_pms'
      when r.ori_category in ('documentation','procedure') then 'documentation_gaps'
      when r.ori_category='training' then 'training_gaps' else 'software_gaps' end,
      'asset_onboarding_items',i.id::text,a.name||' — '||r.item_label,i.asset_id
    from c join development_case_assets d on d.organization_id=c.organization_id and d.development_case_id=c.id
      join asset_onboarding_items i on i.organization_id=c.organization_id and i.asset_id=d.asset_id
      join onboarding_requirements r on r.key=i.requirement_key
      join assets a on a.id=i.asset_id
    where i.status not in ('auto_filled','deduced','human_provided','not_applicable')
      and r.ori_category in ('spares','bom','pm','task_list','inspection','condition_monitoring','documentation','procedure','training','cyber')
    union all
    select 'reliability_defects','quality_defects',q.id::text,q.defect_ref||' — '||q.description,q.asset_id
    from c join quality_defects q on q.organization_id=c.organization_id
    where q.project_id=c.capital_project_id or exists(select 1 from development_case_assets d where d.organization_id=c.organization_id and d.development_case_id=c.id and d.asset_id=q.asset_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('gapClass',x.gap_class,'sourceTable',x.source_table,'sourceId',x.source_id,'label',x.label,'assetId',x.asset_id)
    order by x.gap_class,x.label) filter(where x.source_id is not null),'[]'::jsonb)
  from candidates x
  where not exists(select 1 from operational_debt_items o where o.organization_id=app_current_org() and o.development_case_id=p_case_id and o.gap_class=x.gap_class and o.source_table=x.source_table and o.source_id=x.source_id)
$$;

create or replace function public.record_operational_debt_reference(p_case_id uuid,p_gap_class text,p_source_table text,p_source_id text,p_owner_id uuid,p_due_on date default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org();v_uid uuid:=auth.uid();v_role text;v_id uuid;
begin
  select role into v_role from user_profiles where id=v_uid and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then raise exception 'operational-debt registration requires an authorized human planning or engineering role'; end if;
  if not exists(select 1 from user_profiles where id=p_owner_id and organization_id=v_org) then raise exception 'owner must be a member of this organization'; end if;
  if p_due_on is not null and p_due_on<current_date then raise exception 'operational-debt due date cannot be in the past'; end if;
  if not exists(select 1 from jsonb_array_elements(get_case_operational_debt_candidates(p_case_id)) x
    where x->>'gapClass'=p_gap_class and x->>'sourceTable'=p_source_table and x->>'sourceId'=p_source_id) then
    raise exception 'source is not a current canonical handover gap for this case';
  end if;
  insert into operational_debt_items(organization_id,development_case_id,gap_class,source_table,source_id,owner_id,due_on,recorded_by)
  values(v_org,p_case_id,p_gap_class,p_source_table,p_source_id,p_owner_id,p_due_on,v_uid) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data,new_state) values(v_org,'operational_debt',v_role,
    jsonb_build_object('action','registered','operational_debt_id',v_id,'case_id',p_case_id),jsonb_build_object('gap_class',p_gap_class,'source_table',p_source_table,'source_id',p_source_id,'owner_id',p_owner_id,'due_on',p_due_on));
  return jsonb_build_object('id',v_id,'status','awaiting_operations_acknowledgement');
end $$;

create or replace function public.acknowledge_operational_debt(p_item_id uuid,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org();v_uid uuid:=auth.uid();v_role text;v_item operational_debt_items%rowtype;
begin
  select role into v_role from user_profiles where id=v_uid and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager') then raise exception 'operations acknowledgement requires accountable human operations authority'; end if;
  select * into v_item from operational_debt_items where id=p_item_id and organization_id=v_org;
  if not found then raise exception 'operational-debt item not found in this organization'; end if;
  if v_item.recorded_by=v_uid then raise exception 'the recorder cannot provide operations acknowledgement for the same item'; end if;
  if v_item.acknowledged_by is not null then raise exception 'operational debt is already acknowledged'; end if;
  if length(btrim(coalesce(p_basis,'')))<20 then raise exception 'acknowledgement requires an evidence basis of at least 20 characters'; end if;
  update operational_debt_items set acknowledged_by=v_uid,acknowledged_at=now(),acknowledgement_basis=btrim(p_basis) where id=p_item_id;
  insert into audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state) values(v_org,'operational_debt',v_role,
    jsonb_build_object('action','operations_acknowledged','operational_debt_id',p_item_id,'case_id',v_item.development_case_id),
    jsonb_build_object('acknowledgement','pending'),jsonb_build_object('acknowledgement','recorded','basis',btrim(p_basis)));
  return jsonb_build_object('id',p_item_id,'status','operations_acknowledged');
end $$;

create or replace function public.get_case_operational_debt(p_case_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('id',o.id,'gapClass',o.gap_class,'sourceTable',o.source_table,'sourceId',o.source_id,
    'ownerId',o.owner_id,'ownerName',coalesce(p.full_name,p.email,o.owner_id::text),'dueOn',o.due_on,'recordedBy',o.recorded_by,
    'acknowledgedBy',o.acknowledged_by,'acknowledgedAt',o.acknowledged_at,'acknowledgementBasis',o.acknowledgement_basis)
    order by o.recorded_at desc) filter(where o.id is not null),'[]'::jsonb),'gapClasses',9,
    'note','This register references canonical source records; it does not copy or replace their facts.')
  from development_cases c left join operational_debt_items o on o.organization_id=c.organization_id and o.development_case_id=c.id
    left join user_profiles p on p.organization_id=c.organization_id and p.id=o.owner_id
  where c.id=p_case_id and c.organization_id=app_current_org()
$$;

revoke all on function public.get_case_operational_debt_candidates(uuid) from public,anon;
revoke all on function public.record_operational_debt_reference(uuid,text,text,text,uuid,date) from public,anon;
revoke all on function public.acknowledge_operational_debt(uuid,text) from public,anon;
revoke all on function public.get_case_operational_debt(uuid) from public,anon;
grant execute on function public.get_case_operational_debt_candidates(uuid),public.record_operational_debt_reference(uuid,text,text,text,uuid,date),public.acknowledge_operational_debt(uuid,text),public.get_case_operational_debt(uuid) to authenticated;
notify pgrst,'reload schema';

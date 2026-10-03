-- C2.11 — connect the canonical safety-critical equipment register to the
-- canonical regulatory-requirement chain. This is an applicability edge, not
-- another obligation store, approval flow, evidence model or audit ledger.

create table if not exists public.safety_critical_element_obligations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sce_id bigint not null references public.safety_critical_elements(id) on delete cascade,
  requirement_id bigint not null references public.regulatory_requirements(id) on delete cascade,
  applicability_status text not null check(applicability_status in ('applicable','conditional','undetermined','superseded')),
  basis text not null check(length(btrim(basis))>=20),
  evidence_item_ids uuid[] not null default '{}',
  missing_evidence text[] not null default '{}',
  linked_by uuid not null references auth.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(sce_id,requirement_id),
  check(cardinality(evidence_item_ids)+cardinality(missing_evidence)>0)
);
create index if not exists safety_obligation_org_status on public.safety_critical_element_obligations(organization_id,applicability_status);
alter table public.safety_critical_element_obligations enable row level security;
drop policy if exists safety_obligation_read on public.safety_critical_element_obligations;
create policy safety_obligation_read on public.safety_critical_element_obligations for select to authenticated
  using(organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.safety_critical_element_obligations from public,anon,authenticated;

create or replace function public.enforce_safety_obligation_tenancy() returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from public.safety_critical_elements s where s.id=new.sce_id and s.organization_id=new.organization_id)
    or not exists(select 1 from public.regulatory_requirements r where r.id=new.requirement_id and r.organization_id=new.organization_id) then
    raise exception 'safety element, regulatory requirement and link must share one organization';
  end if;
  return new;
end $$;
drop trigger if exists trg_safety_obligation_tenancy on public.safety_critical_element_obligations;
create trigger trg_safety_obligation_tenancy before insert or update on public.safety_critical_element_obligations
  for each row execute function public.enforce_safety_obligation_tenancy();
revoke all on function public.enforce_safety_obligation_tenancy() from public,anon,authenticated;

create or replace function public.save_safety_critical_obligation(
  p_sce_id bigint,
  p_requirement_id bigint,
  p_applicability_status text,
  p_basis text,
  p_evidence_item_ids uuid[] default '{}',
  p_missing_evidence text[] default '{}'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_evidence uuid[]:=coalesce(p_evidence_item_ids,'{}'); v_missing text[]:=coalesce(p_missing_evidence,'{}');
  v_requirement_status text; v_previous jsonb; v_result jsonb;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','named human engineering or accountable operating authority is required');
  end if;
  if coalesce(p_applicability_status,'') not in ('applicable','conditional','undetermined','superseded') then
    return jsonb_build_object('error','controlled applicability status is required');
  end if;
  v_missing:=array(select btrim(x.item) from unnest(v_missing) x(item) where length(btrim(x.item))>0);
  if coalesce(length(btrim(p_basis)),0)<20 then return jsonb_build_object('error','record a substantive applicability basis'); end if;
  if cardinality(v_evidence)>100 or cardinality(v_missing)>50
    or cardinality(v_evidence)<>cardinality(array(select distinct x.id from unnest(v_evidence) x(id)))
    or exists(select 1 from unnest(v_missing) x(item) where length(btrim(x.item))<5 or length(x.item)>500) then
    return jsonb_build_object('error','evidence must be unique and limited to 100 citations and 50 substantive missing-evidence statements');
  end if;
  if not exists(select 1 from public.safety_critical_elements where id=p_sce_id and organization_id=v_org) then
    return jsonb_build_object('error','safety-critical element not found in this organization');
  end if;
  select status into v_requirement_status from public.regulatory_requirements where id=p_requirement_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','regulatory requirement not found in this organization'); end if;
  if v_requirement_status in ('not_required','withdrawn') and p_applicability_status<>'superseded' then
    return jsonb_build_object('error','a closed regulatory requirement cannot be asserted as currently applicable');
  end if;
  if exists(select 1 from unnest(v_evidence) x(id) left join public.evidence_items e on e.id=x.id and e.organization_id=v_org where e.id is null) then
    return jsonb_build_object('error','every evidence item must belong to this organization');
  end if;
  if p_applicability_status in ('applicable','conditional','superseded') then
    if cardinality(v_evidence)=0 then return jsonb_build_object('error','a determinate applicability assertion requires verified canonical evidence'); end if;
    if exists(select 1 from unnest(v_evidence) x(id) join public.evidence_items e on e.id=x.id where e.verification_status is distinct from 'verified') then
      return jsonb_build_object('error','determinate applicability requires independently verified canonical evidence');
    end if;
  elsif cardinality(v_missing)=0 then
    return jsonb_build_object('error','undetermined applicability must name the missing evidence');
  end if;

  select to_jsonb(l) into v_previous from public.safety_critical_element_obligations l
    where l.sce_id=p_sce_id and l.requirement_id=p_requirement_id and l.organization_id=v_org for update;
  insert into public.safety_critical_element_obligations(
    organization_id,sce_id,requirement_id,applicability_status,basis,evidence_item_ids,missing_evidence,linked_by
  ) values(v_org,p_sce_id,p_requirement_id,p_applicability_status,btrim(p_basis),v_evidence,
    v_missing,auth.uid())
  on conflict(sce_id,requirement_id) do update set
    applicability_status=excluded.applicability_status,basis=excluded.basis,
    evidence_item_ids=excluded.evidence_item_ids,missing_evidence=excluded.missing_evidence,
    linked_by=excluded.linked_by,updated_at=now()
  returning to_jsonb(safety_critical_element_obligations) into v_result;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'safety_critical_obligation',v_role,jsonb_build_object('sce_id',p_sce_id,
    'requirement_id',p_requirement_id,'action','applicability_saved'),v_previous,v_result);
  return v_result||jsonb_build_object('status','saved','authority_boundary','Applicability record only; no permit decision, barrier test, work release, isolation or return-to-service action occurred.');
end $$;

create or replace function public.get_safety_obligation_register()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.app_current_org() is null then jsonb_build_object('error','forbidden') else jsonb_build_object(
    'elements',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'ref',s.sce_ref,'label',s.label,
      'barrier_kind',s.barrier_kind,'barrier_role',s.barrier_role,'performance_standard',s.performance_standard,
      'asset_id',s.asset_id,'asset_name',a.name) order by s.sce_ref)
      from public.safety_critical_elements s left join public.assets a on a.id=s.asset_id
      where s.organization_id=public.app_current_org()),'[]'::jsonb),
    'requirements',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'ref',r.requirement_ref,
      'regulator',r.regulator,'jurisdiction',r.jurisdiction,'instrument',r.instrument,'permit_type',r.permit_type,
      'description',r.description,'status',r.status,'case_id',r.development_case_id,'case_title',c.title) order by r.requirement_ref)
      from public.regulatory_requirements r join public.development_cases c on c.id=r.development_case_id
      where r.organization_id=public.app_current_org()),'[]'::jsonb),
    'links',coalesce((select jsonb_agg(to_jsonb(l) order by s.sce_ref,r.requirement_ref)
      from public.safety_critical_element_obligations l
      join public.safety_critical_elements s on s.id=l.sce_id
      join public.regulatory_requirements r on r.id=l.requirement_id
      where l.organization_id=public.app_current_org()),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'description',e.description,
      'verification_status',e.verification_status) order by e.created_at desc)
      from (select * from public.evidence_items where organization_id=public.app_current_org() order by created_at desc limit 200) e),'[]'::jsonb),
    'authority_boundary','This register records applicability only. Regulatory decisions remain in the canonical approval chain; barrier testing and operational authority remain in their existing governed workflows.'
  ) end
$$;

revoke all on function public.save_safety_critical_obligation(bigint,bigint,text,text,uuid[],text[]) from public,anon;
revoke all on function public.get_safety_obligation_register() from public,anon;
grant execute on function public.save_safety_critical_obligation(bigint,bigint,text,text,uuid[],text[]), public.get_safety_obligation_register() to authenticated,service_role;
comment on table public.safety_critical_element_obligations is 'C2.11 governed applicability edge between canonical safety-critical elements and canonical regulatory requirements.';
notify pgrst,'reload schema';

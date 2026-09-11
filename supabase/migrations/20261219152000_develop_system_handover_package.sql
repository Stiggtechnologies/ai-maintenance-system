-- Sync Develop Slice 8 / D8.09 — per-system HandoverPackage.
--
-- This is the transition handover package, not equipment_releases (the
-- operations/maintenance return-to-service transaction). Readiness remains in
-- acceptance_tests and asset_onboarding_items; residual risk remains in risks
-- and risk_acceptances. The package stores accountability and references only.

create table if not exists public.system_handover_packages (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  commissioning_system_id bigint not null references public.commissioning_systems(id) on delete restrict,
  version integer not null check (version > 0),
  owner_from uuid not null references auth.users(id),
  owner_to uuid not null references auth.users(id),
  required_acceptance_date date not null,
  preparation_basis text not null check (length(btrim(preparation_basis)) >= 20),
  preparation_evidence_item_id uuid not null references public.evidence_items(id),
  prepared_by uuid not null references auth.users(id),
  prepared_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft','accepted','superseded')),
  superseded_by uuid references auth.users(id),
  superseded_at timestamptz,
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  acceptance_basis text,
  acceptance_evidence_item_id uuid references public.evidence_items(id),
  unique (commissioning_system_id, version),
  check (owner_from <> owner_to),
  check ((status='draft' and accepted_by is null and accepted_at is null and acceptance_basis is null and acceptance_evidence_item_id is null)
      or (status='accepted' and accepted_by is not null and accepted_at is not null and length(btrim(acceptance_basis)) >= 20 and acceptance_evidence_item_id is not null)
      or (status='superseded' and superseded_by is not null and superseded_at is not null and accepted_at is null))
);

create unique index if not exists uq_system_handover_package_active
  on public.system_handover_packages(commissioning_system_id)
  where status in ('draft','accepted');
create index if not exists idx_system_handover_packages_case_read
  on public.system_handover_packages(organization_id, commissioning_system_id, status);

create table if not exists public.system_handover_residual_risks (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  handover_package_id bigint not null references public.system_handover_packages(id) on delete restrict,
  risk_id uuid not null references public.risks(id) on delete restrict,
  linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now(),
  unique (handover_package_id, risk_id)
);

alter table public.system_handover_packages enable row level security;
alter table public.system_handover_residual_risks enable row level security;
drop policy if exists system_handover_packages_read on public.system_handover_packages;
create policy system_handover_packages_read on public.system_handover_packages
  for select using (organization_id=public.app_current_org());
drop policy if exists system_handover_residual_risks_read on public.system_handover_residual_risks;
create policy system_handover_residual_risks_read on public.system_handover_residual_risks
  for select using (organization_id=public.app_current_org());

create or replace function public.guard_system_handover_package()
returns trigger language plpgsql security definer set search_path=public as $$
declare s public.commissioning_systems%rowtype; v_from text; v_to text;
begin
  if tg_op='DELETE' then raise exception 'system handover packages are immutable records'; end if;
  if current_setting('app.system_handover_write',true)<>'allowed' then
    raise exception 'system handover packages may change only through the governed handover workflow';
  end if;
  if tg_op='UPDATE' then
    if old.status='accepted' then raise exception 'accepted system handover packages are immutable'; end if;
    if (new.organization_id,new.commissioning_system_id,new.version,new.owner_from,new.owner_to,
        new.required_acceptance_date,new.preparation_basis,new.preparation_evidence_item_id,new.prepared_by,new.prepared_at)
       is distinct from
       (old.organization_id,old.commissioning_system_id,old.version,old.owner_from,old.owner_to,
        old.required_acceptance_date,old.preparation_basis,old.preparation_evidence_item_id,old.prepared_by,old.prepared_at) then
      raise exception 'handover package identity and preparation evidence are immutable; assemble a new version';
    end if;
  end if;
  select * into s from public.commissioning_systems where id=new.commissioning_system_id;
  if s.id is null or s.organization_id<>new.organization_id then raise exception 'handover package must match its commissioning-system tenant'; end if;
  select role into v_from from public.user_profiles where id=new.owner_from and organization_id=new.organization_id;
  select role into v_to from public.user_profiles where id=new.owner_to and organization_id=new.organization_id;
  if v_from is null or v_to is null or lower(coalesce(v_from,''))='ai_admin' then raise exception 'handover owners must be named humans in the same tenant'; end if;
  if new.owner_from<>s.owner_id then raise exception 'owner-from must be the accountable commissioning-system owner'; end if;
  if lower(coalesce(v_to,'')) not in ('operator','maintenance_manager','executive','admin') then raise exception 'owner-to must hold human operations or accountable management authority'; end if;
  if not exists(select 1 from public.user_profiles where id=new.prepared_by and organization_id=new.organization_id) then raise exception 'package preparer must belong to the same tenant'; end if;
  if not exists(select 1 from public.evidence_items where id=new.preparation_evidence_item_id and organization_id=new.organization_id) then raise exception 'same-tenant preparation evidence is required'; end if;
  if new.acceptance_evidence_item_id is not null and not exists(select 1 from public.evidence_items where id=new.acceptance_evidence_item_id and organization_id=new.organization_id) then raise exception 'same-tenant acceptance evidence is required'; end if;
  return new;
end $$;

drop trigger if exists trg_guard_system_handover_package on public.system_handover_packages;
create trigger trg_guard_system_handover_package
  before insert or update or delete on public.system_handover_packages
  for each row execute function public.guard_system_handover_package();
revoke all on function public.guard_system_handover_package() from public,anon,authenticated;

create or replace function public.guard_system_handover_residual_risk()
returns trigger language plpgsql security definer set search_path=public as $$
declare p public.system_handover_packages%rowtype; r public.risks%rowtype; s public.commissioning_systems%rowtype;
begin
  if tg_op<>'INSERT' then raise exception 'handover residual-risk references are append-only'; end if;
  if current_setting('app.system_handover_write',true)<>'allowed' then raise exception 'handover risks are assembled only through the governed package workflow'; end if;
  select * into p from public.system_handover_packages where id=new.handover_package_id;
  select * into r from public.risks where id=new.risk_id;
  select * into s from public.commissioning_systems where id=p.commissioning_system_id;
  if p.id is null or r.id is null or p.organization_id<>new.organization_id or r.organization_id<>new.organization_id then raise exception 'handover risk reference must remain in one tenant'; end if;
  if r.development_case_id is distinct from s.development_case_id
     and not exists(select 1 from public.commissioning_system_assets a where a.organization_id=new.organization_id and a.commissioning_system_id=s.id and a.asset_id=r.asset_id) then
    raise exception 'handover residual risk must belong to the case or a bound system asset';
  end if;
  if not exists(select 1 from public.user_profiles where id=new.linked_by and organization_id=new.organization_id) then raise exception 'handover risk linker must belong to the same tenant'; end if;
  return new;
end $$;

drop trigger if exists trg_guard_system_handover_residual_risk on public.system_handover_residual_risks;
create trigger trg_guard_system_handover_residual_risk
  before insert or update or delete on public.system_handover_residual_risks
  for each row execute function public.guard_system_handover_residual_risk();
revoke all on function public.guard_system_handover_residual_risk() from public,anon,authenticated;

create or replace function public.assemble_system_handover_package(
  p_system_id bigint, p_owner_from uuid, p_owner_to uuid,
  p_required_acceptance_date date, p_basis text, p_evidence_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; s public.commissioning_systems%rowtype; v_version int; v_id bigint; v_risks int;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if not public.commissioning_author_role(v_role) and v_role<>'ai_admin' then return jsonb_build_object('error','commissioning planning authority or the governed drafting agent is required'); end if;
  select * into s from public.commissioning_systems where id=p_system_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','commissioning system not found'); end if;
  if exists(select 1 from public.system_handover_packages where organization_id=v_org and commissioning_system_id=s.id and status='accepted') then return jsonb_build_object('error','the accepted handover package is immutable'); end if;
  if p_owner_from=p_owner_to then return jsonb_build_object('error','owner-from and owner-to must be different named humans'); end if;
  if p_owner_from<>s.owner_id or not exists(select 1 from public.user_profiles where id=p_owner_from and organization_id=v_org and lower(role)<>'ai_admin') then return jsonb_build_object('error','owner-from must be the same-tenant accountable commissioning-system owner'); end if;
  if not exists(select 1 from public.user_profiles where id=p_owner_to and organization_id=v_org and lower(role) in ('operator','maintenance_manager','executive','admin')) then return jsonb_build_object('error','same-tenant human operations owner-to is required'); end if;
  if p_required_acceptance_date is null then return jsonb_build_object('error','required acceptance date is required'); end if;
  if coalesce(length(btrim(p_basis)),0)<20 then return jsonb_build_object('error','a substantive package preparation basis is required'); end if;
  if not exists(select 1 from public.evidence_items where id=p_evidence_item_id and organization_id=v_org) then return jsonb_build_object('error','same-tenant package evidence is required'); end if;
  select coalesce(max(version),0)+1 into v_version from public.system_handover_packages where organization_id=v_org and commissioning_system_id=s.id;
  perform set_config('app.system_handover_write','allowed',true);
  update public.system_handover_packages set status='superseded',superseded_by=auth.uid(),superseded_at=now()
   where organization_id=v_org and commissioning_system_id=s.id and status='draft';
  insert into public.system_handover_packages(organization_id,commissioning_system_id,version,owner_from,owner_to,required_acceptance_date,preparation_basis,preparation_evidence_item_id,prepared_by)
  values(v_org,s.id,v_version,p_owner_from,p_owner_to,p_required_acceptance_date,btrim(p_basis),p_evidence_item_id,auth.uid()) returning id into v_id;
  insert into public.system_handover_residual_risks(organization_id,handover_package_id,risk_id,linked_by)
  select v_org,v_id,r.id,auth.uid() from public.risks r
   where r.organization_id=v_org and r.status not in ('closed','archived')
     and (r.development_case_id=s.development_case_id or exists(select 1 from public.commissioning_system_assets a where a.organization_id=v_org and a.commissioning_system_id=s.id and a.asset_id=r.asset_id));
  get diagnostics v_risks=row_count;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'system_handover_package',v_role,jsonb_build_object('package_id',v_id,'system_id',s.id,'version',v_version,'action','draft_assembled','owner_from',p_owner_from,'owner_to',p_owner_to,'residual_risk_count',v_risks,'evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('packageId',v_id,'systemId',s.id,'version',v_version,'status','draft','residualRiskCount',v_risks,'decisionBoundary','Draft assembly cannot accept handover or change commissioning state.');
end $$;

revoke all on function public.assemble_system_handover_package(bigint,uuid,uuid,date,text,uuid) from public,anon;
grant execute on function public.assemble_system_handover_package(bigint,uuid,uuid,date,text,uuid) to authenticated;

create or replace function public.get_system_handover_readiness(p_system_id bigint,p_package_id bigint default null)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=public.app_current_org(); s public.commissioning_systems%rowtype; p public.system_handover_packages%rowtype;
  v_physical_total int; v_physical_done int; v_info_total int; v_info_done int; v_ops_total int; v_ops_done int;
  v_open_punch int:=0; v_open_redlines int:=0; v_risk_count int:=0; v_risk_accepted int:=0;
  v_blockers jsonb:='[]'::jsonb; v_risks jsonb:='[]'::jsonb; v_physical_gaps jsonb:='[]'::jsonb; v_info_gaps jsonb:='[]'::jsonb; v_ops_gaps jsonb:='[]'::jsonb;
begin
  select * into s from public.commissioning_systems where id=p_system_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','commissioning system not found'); end if;
  if p_package_id is not null then
    select * into p from public.system_handover_packages where id=p_package_id and organization_id=v_org and commissioning_system_id=s.id;
    if not found then return jsonb_build_object('error','system handover package not found'); end if;
  end if;
  select count(*),count(*) filter(where release_status='released' and outcome in ('pass','pass_with_punch') and punch_items_open=0)
    into v_physical_total,v_physical_done from public.acceptance_tests where organization_id=v_org and commissioning_system_id=s.id;
  select coalesce(sum(punch_items_open),0),coalesce(jsonb_agg(jsonb_build_object('testId',id,'testRef',test_ref,'releaseStatus',release_status,'outcome',outcome,'openPunchCount',punch_items_open)) filter(where release_status<>'released' or outcome not in ('pass','pass_with_punch') or punch_items_open>0),'[]'::jsonb)
    into v_open_punch,v_physical_gaps from public.acceptance_tests where organization_id=v_org and commissioning_system_id=s.id;
  select count(*),count(*) filter(where i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null)
    into v_info_total,v_info_done
    from public.commissioning_system_readiness_scope q join public.asset_onboarding_items i on i.id=q.onboarding_item_id join public.onboarding_requirements r on r.key=i.requirement_key
   where q.organization_id=v_org and q.commissioning_system_id=s.id and r.ori_category in ('asset_master','bom','task_list','procedure','documentation','cyber');
  select count(*),count(*) filter(where i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null)
    into v_ops_total,v_ops_done
   from public.commissioning_system_readiness_scope q join public.asset_onboarding_items i on i.id=q.onboarding_item_id join public.onboarding_requirements r on r.key=i.requirement_key
   where q.organization_id=v_org and q.commissioning_system_id=s.id and r.ori_category in ('spares','pm','training','inspection','condition_monitoring','vendor_support','emergency_response');
  select coalesce(jsonb_agg(jsonb_build_object('itemId',i.id,'assetId',i.asset_id,'asset',a.name,'category',r.ori_category,'item',r.item_label,'status',i.status,'evidenceReady',i.evidence_item_id is not null) order by r.sort_order,a.name),'[]'::jsonb) into v_info_gaps
    from public.commissioning_system_readiness_scope q join public.asset_onboarding_items i on i.id=q.onboarding_item_id join public.onboarding_requirements r on r.key=i.requirement_key join public.assets a on a.id=i.asset_id
   where q.organization_id=v_org and q.commissioning_system_id=s.id and r.ori_category in ('asset_master','bom','task_list','procedure','documentation','cyber') and not(i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null);
  select coalesce(jsonb_agg(jsonb_build_object('itemId',i.id,'assetId',i.asset_id,'asset',a.name,'category',r.ori_category,'item',r.item_label,'status',i.status,'evidenceReady',i.evidence_item_id is not null) order by r.sort_order,a.name),'[]'::jsonb) into v_ops_gaps
    from public.commissioning_system_readiness_scope q join public.asset_onboarding_items i on i.id=q.onboarding_item_id join public.onboarding_requirements r on r.key=i.requirement_key join public.assets a on a.id=i.asset_id
   where q.organization_id=v_org and q.commissioning_system_id=s.id and r.ori_category in ('spares','pm','training','inspection','condition_monitoring','vendor_support','emergency_response') and not(i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null);
  select count(*) into v_open_redlines from public.red_line_markups r where r.organization_id=v_org and r.status in ('open','in_review') and exists(select 1 from public.commissioning_system_assets a where a.organization_id=v_org and a.commissioning_system_id=s.id and a.asset_id=r.asset_id);
  if v_open_redlines>0 then v_info_gaps:=v_info_gaps||jsonb_build_array(jsonb_build_object('category','documentation','item',format('%s open or in-review red-line markup(s) require as-built disposition.',v_open_redlines),'status','open','evidenceReady',false)); end if;
  if coalesce(s.commissioning_state,'') not in ('PERFORMANCE_VERIFIED','ACCEPTED') then v_blockers:=v_blockers||jsonb_build_array('Physical readiness requires the commissioning system to reach PERFORMANCE_VERIFIED.'); end if;
  if v_physical_total=0 then v_blockers:=v_blockers||jsonb_build_array('Physical readiness has no canonical commissioning results.');
  elsif v_physical_done<v_physical_total then v_blockers:=v_blockers||jsonb_build_array(format('%s commissioning result(s) are not independently released, passing, and punch-clear.',v_physical_total-v_physical_done)); end if;
  if v_info_total=0 then v_blockers:=v_blockers||jsonb_build_array('Information readiness has no scoped canonical items.');
  elsif v_info_done<v_info_total then v_blockers:=v_blockers||jsonb_build_array(format('%s information-readiness item(s) lack a satisfied status with evidence.',v_info_total-v_info_done)); end if;
  if v_open_redlines>0 then v_blockers:=v_blockers||jsonb_build_array(format('%s open or in-review red-line markup(s) block as-built information readiness.',v_open_redlines)); end if;
  if v_ops_total=0 then v_blockers:=v_blockers||jsonb_build_array('Operational readiness has no scoped canonical items.');
  elsif v_ops_done<v_ops_total then v_blockers:=v_blockers||jsonb_build_array(format('%s operational-readiness item(s) lack a satisfied status with evidence.',v_ops_total-v_ops_done)); end if;
  if p_package_id is not null then
    if exists(select 1 from public.risks r where r.organization_id=v_org and r.status not in ('closed','archived')
      and (r.development_case_id=s.development_case_id or exists(select 1 from public.commissioning_system_assets a where a.organization_id=v_org and a.commissioning_system_id=s.id and a.asset_id=r.asset_id))
      and not exists(select 1 from public.system_handover_residual_risks x where x.handover_package_id=p.id and x.risk_id=r.id)) then
      v_blockers:=v_blockers||jsonb_build_array('The draft is stale: reassemble it to include every current case or system residual risk.');
    end if;
    select count(*),count(*) filter(where exists(select 1 from public.risk_acceptances a where a.organization_id=v_org and a.subject_type='risk' and a.subject_id=r.id and a.status='active' and a.expires_at>now())) into v_risk_count,v_risk_accepted
      from public.system_handover_residual_risks x join public.risks r on r.id=x.risk_id
     where x.organization_id=v_org and x.handover_package_id=p.id and r.status not in ('closed','archived');
    select coalesce(jsonb_agg(jsonb_build_object('riskId',r.id,'title',r.title,'status',r.status,'riskLevel',coalesce(r.residual_risk_level,r.current_risk_level),'accepted',exists(select 1 from public.risk_acceptances a where a.organization_id=v_org and a.subject_type='risk' and a.subject_id=r.id and a.status='active' and a.expires_at>now())) order by public.risk_rank(coalesce(r.residual_risk_level,r.current_risk_level)) desc,r.title),'[]'::jsonb) into v_risks
      from public.system_handover_residual_risks x join public.risks r on r.id=x.risk_id where x.organization_id=v_org and x.handover_package_id=p.id;
    if v_risk_accepted<v_risk_count then v_blockers:=v_blockers||jsonb_build_array(format('%s residual risk(s) lack a current canonical human acceptance.',v_risk_count-v_risk_accepted)); end if;
  end if;
  return jsonb_build_object('systemId',s.id,'currentState',s.commissioning_state,
    'physicalReadiness',jsonb_build_object('status',case when s.commissioning_state in ('PERFORMANCE_VERIFIED','ACCEPTED') and v_physical_total>0 and v_physical_done=v_physical_total then 'READY' when v_physical_total=0 then 'NOT_ASSESSED' else 'NOT_READY' end,'satisfied',v_physical_done,'total',v_physical_total,'percent',case when v_physical_total=0 then null else round(100.0*v_physical_done/v_physical_total,1) end,'openPunchCount',v_open_punch,'gaps',v_physical_gaps,'source','acceptance_tests + commissioning_systems'),
    'informationReadiness',jsonb_build_object('status',case when v_info_total>0 and v_info_done=v_info_total and v_open_redlines=0 then 'READY' when v_info_total=0 then 'NOT_ASSESSED' else 'NOT_READY' end,'satisfied',v_info_done,'total',v_info_total,'percent',case when v_info_total=0 then null else round(100.0*v_info_done/v_info_total,1) end,'openRedlineCount',v_open_redlines,'gaps',v_info_gaps,'categories',jsonb_build_array('asset_master','bom','task_list','procedure','documentation','cyber'),'source','asset_onboarding_items + red_line_markups'),
    'operationalReadiness',jsonb_build_object('status',case when v_ops_total>0 and v_ops_done=v_ops_total then 'READY' when v_ops_total=0 then 'NOT_ASSESSED' else 'NOT_READY' end,'satisfied',v_ops_done,'total',v_ops_total,'percent',case when v_ops_total=0 then null else round(100.0*v_ops_done/v_ops_total,1) end,'gaps',v_ops_gaps,'categories',jsonb_build_array('spares','pm','training','inspection','condition_monitoring','vendor_support','emergency_response'),'source','asset_onboarding_items'),
    'residualRisks',v_risks,'residualRiskCount',v_risk_count,'acceptedResidualRiskCount',v_risk_accepted,
    'canAccept',jsonb_array_length(v_blockers)=0,'blockers',v_blockers,
    'decisionBoundary','Readiness is computed from canonical evidence. Only the named owner-to may accept through accept_system_handover_package; this read grants no authority.');
end $$;

revoke all on function public.get_system_handover_readiness(bigint,bigint) from public,anon;
grant execute on function public.get_system_handover_readiness(bigint,bigint) to authenticated;

-- Preserve the D8.07 function as the canonical prerequisite calculator, then
-- add the HandoverPackage gate only to its final ACCEPTED transition.
do $$ begin
  if to_regprocedure('public.get_commissioning_transition_readiness_pre_handover(bigint)') is null then
    alter function public.get_commissioning_transition_readiness(bigint) rename to get_commissioning_transition_readiness_pre_handover;
  end if;
end $$;

create or replace function public.get_commissioning_transition_readiness(p_system_id bigint)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_base jsonb;
begin
  v_base:=public.get_commissioning_transition_readiness_pre_handover(p_system_id);
  if v_base ? 'error' or coalesce(v_base->>'nextState','')<>'ACCEPTED' or current_setting('app.system_handover_acceptance',true)='allowed' then return v_base; end if;
  return jsonb_set(jsonb_set(v_base,'{canTransition}','false'::jsonb),'{blockers}',coalesce(v_base->'blockers','[]'::jsonb)||jsonb_build_array('Final ACCEPTED is recorded only through an evidence-complete system HandoverPackage.'));
end $$;

revoke all on function public.get_commissioning_transition_readiness(bigint) from public,anon;
grant execute on function public.get_commissioning_transition_readiness(bigint) to authenticated;

create or replace function public.guard_final_commissioning_acceptance_via_handover()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_package bigint;
begin
  if new.commissioning_state='ACCEPTED' and old.commissioning_state is distinct from 'ACCEPTED' then
    if current_setting('app.system_handover_acceptance',true)<>'allowed' then raise exception 'final commissioning acceptance requires the governed system HandoverPackage workflow'; end if;
    v_package:=nullif(current_setting('app.system_handover_package_id',true),'')::bigint;
    if not exists(select 1 from public.system_handover_packages p where p.id=v_package and p.organization_id=new.organization_id and p.commissioning_system_id=new.id and p.status='draft') then raise exception 'final commissioning acceptance requires the matching draft HandoverPackage'; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_final_commissioning_acceptance_via_handover on public.commissioning_systems;
create trigger trg_guard_final_commissioning_acceptance_via_handover before update of commissioning_state on public.commissioning_systems
  for each row execute function public.guard_final_commissioning_acceptance_via_handover();
revoke all on function public.guard_final_commissioning_acceptance_via_handover() from public,anon,authenticated;

create or replace function public.accept_system_handover_package(p_package_id bigint,p_basis text,p_evidence_item_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; p public.system_handover_packages%rowtype; s public.commissioning_systems%rowtype; v_ready jsonb; v_transition jsonb;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('operator','maintenance_manager','executive','admin') then return jsonb_build_object('error','final handover acceptance requires named human operations or accountable management authority'); end if;
  select * into p from public.system_handover_packages where id=p_package_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','system handover package not found'); end if;
  if p.status<>'draft' then return jsonb_build_object('error','only the current draft package may be accepted'); end if;
  if p.owner_to<>auth.uid() then return jsonb_build_object('error','only the named owner-to may accept operations ownership'); end if;
  if p.prepared_by=auth.uid() or p.owner_from=auth.uid() then return jsonb_build_object('error','segregation of duties: the package preparer or outgoing owner cannot accept operations ownership'); end if;
  if coalesce(length(btrim(p_basis)),0)<20 then return jsonb_build_object('error','a substantive human handover acceptance basis is required'); end if;
  if not exists(select 1 from public.evidence_items where id=p_evidence_item_id and organization_id=v_org) then return jsonb_build_object('error','same-tenant handover acceptance evidence is required'); end if;
  v_ready:=public.get_system_handover_readiness(p.commissioning_system_id,p.id);
  if coalesce((v_ready->>'canAccept')::boolean,false)=false then return jsonb_build_object('error','handover package prerequisites are not satisfied','blockers',v_ready->'blockers'); end if;
  select * into s from public.commissioning_systems where id=p.commissioning_system_id and organization_id=v_org for update;
  if s.commissioning_state<>'PERFORMANCE_VERIFIED' then return jsonb_build_object('error','system must be PERFORMANCE_VERIFIED before handover acceptance'); end if;
  perform set_config('app.system_handover_acceptance','allowed',true);
  perform set_config('app.system_handover_package_id',p.id::text,true);
  v_transition:=public.transition_commissioning_system(s.id,'ACCEPTED',btrim(p_basis),p_evidence_item_id);
  if v_transition ? 'error' then return v_transition; end if;
  perform set_config('app.system_handover_write','allowed',true);
  update public.system_handover_packages set status='accepted',accepted_by=auth.uid(),accepted_at=now(),acceptance_basis=btrim(p_basis),acceptance_evidence_item_id=p_evidence_item_id where id=p.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'system_handover_package',v_role,jsonb_build_object('package_id',p.id,'system_id',s.id,'version',p.version,'action','accepted','owner_from',p.owner_from,'owner_to',p.owner_to,'evidence_item_id',p_evidence_item_id,'commissioning_transition_id',v_transition->'id'));
  return jsonb_build_object('packageId',p.id,'systemId',s.id,'version',p.version,'status','accepted','acceptedAt',now(),'commissioningState','ACCEPTED');
end $$;

revoke all on function public.accept_system_handover_package(bigint,text,uuid) from public,anon;
grant execute on function public.accept_system_handover_package(bigint,text,uuid) to authenticated;

create or replace function public.get_case_system_handover_packages(p_case_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_systems jsonb;
begin
  if not exists(select 1 from public.development_cases where id=p_case_id and organization_id=v_org) then return jsonb_build_object('error','development case not found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('systemId',s.id,'systemRef',s.system_ref,'title',s.title,'systemOwnerId',s.owner_id,'currentState',s.commissioning_state,
    'package',case when p.id is null then null else jsonb_build_object('id',p.id,'version',p.version,'status',p.status,'ownerFromId',p.owner_from,'ownerFrom',coalesce(pf.full_name,pf.email),'ownerToId',p.owner_to,'ownerTo',coalesce(pt.full_name,pt.email),'requiredAcceptanceDate',p.required_acceptance_date,'preparedBy',p.prepared_by,'preparedAt',p.prepared_at,'preparationEvidenceItemId',p.preparation_evidence_item_id,'acceptedBy',p.accepted_by,'acceptedAt',p.accepted_at,'acceptanceEvidenceItemId',p.acceptance_evidence_item_id) end,
    'readiness',public.get_system_handover_readiness(s.id,p.id)) order by s.system_ref),'[]'::jsonb) into v_systems
  from public.commissioning_systems s
  left join public.system_handover_packages p on p.commissioning_system_id=s.id and p.status in ('draft','accepted')
  left join public.user_profiles pf on pf.id=p.owner_from
  left join public.user_profiles pt on pt.id=p.owner_to
  where s.organization_id=v_org and s.development_case_id=p_case_id;
  return jsonb_build_object('caseId',p_case_id,'systems',v_systems,'readinessStores',jsonb_build_object('physical','acceptance_tests + commissioning_systems','information','asset_onboarding_items','operational','asset_onboarding_items','residualRisks','risks + risk_acceptances'),'equipmentReleaseBoundary','This transition package does not replace or mutate equipment_releases, the separate operations/maintenance return-to-service transaction.','decisionBoundary','Assembly is a draft. Only the named human owner-to may accept an evidence-complete package; acceptance uses the canonical seven-state commissioning transition.');
end $$;

revoke all on function public.get_case_system_handover_packages(uuid) from public,anon;
grant execute on function public.get_case_system_handover_packages(uuid) to authenticated;

comment on table public.system_handover_packages is 'D8.09 per-system transition HandoverPackage; readiness and residual risk are referenced from canonical stores, never copied.';
comment on table public.system_handover_residual_risks is 'Immutable package-to-canonical-risk references assembled from the case/system scope.';
notify pgrst,'reload schema';

-- D11.36 / spec §86 — the architectural north-star traversal.
--
-- This adds one association, not another graph: a canonical learning_events
-- outcome + lesson explicitly informing a later canonical decisions row. All
-- other legs are read from their existing homes. The read refuses to call the
-- chain complete when any canonical leg or relationship is absent.

create table if not exists public.decision_learning_event_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  development_case_id uuid not null references public.development_cases(id) on delete cascade,
  outcome_event_id uuid not null references public.learning_events(id) on delete restrict,
  lesson_event_id uuid not null references public.learning_events(id) on delete restrict,
  next_decision_id uuid not null references public.decisions(id) on delete restrict,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  basis text not null check (length(btrim(basis)) >= 20),
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (next_decision_id)
);

create index if not exists idx_decision_learning_event_links_case
  on public.decision_learning_event_links(organization_id, development_case_id, created_at);

alter table public.decision_learning_event_links enable row level security;
drop policy if exists decision_learning_event_links_read on public.decision_learning_event_links;
create policy decision_learning_event_links_read on public.decision_learning_event_links
  for select to authenticated using (organization_id=public.app_current_org());

create or replace function public.guard_decision_learning_event_link()
returns trigger language plpgsql security definer set search_path=public as $$
declare o public.learning_events%rowtype; l public.learning_events%rowtype; d public.decisions%rowtype; e public.evidence_items%rowtype;
begin
  if tg_op='UPDATE' then
    raise exception 'A recorded outcome-to-learning-to-next-decision relationship is immutable; record a new decision when circumstances change.';
  end if;
  if tg_op='DELETE' then
    if not exists(select 1 from public.development_cases where id=old.development_case_id)
       or not exists(select 1 from public.organizations where id=old.organization_id) then return old; end if;
    raise exception 'The north-star relationship is retained as decision provenance and cannot be deleted directly.';
  end if;
  if not exists(select 1 from public.development_cases where id=new.development_case_id and organization_id=new.organization_id) then
    raise exception 'north-star relationship case does not belong to the stated organization';
  end if;
  select * into o from public.learning_events where id=new.outcome_event_id and organization_id=new.organization_id;
  select * into l from public.learning_events where id=new.lesson_event_id and organization_id=new.organization_id;
  select * into d from public.decisions where id=new.next_decision_id and organization_id=new.organization_id;
  select * into e from public.evidence_items where id=new.evidence_item_id and organization_id=new.organization_id;
  if o.id is null or o.development_case_id<>new.development_case_id or o.event_type<>'project_outcome' then
    raise exception 'the outcome leg must be this case''s canonical verified project outcome';
  end if;
  if l.id is null or l.development_case_id<>new.development_case_id or l.event_type<>'lesson_learned' then
    raise exception 'the learning leg must be this case''s canonical project lesson';
  end if;
  if d.id is null or d.development_case_id is null or d.development_case_id=new.development_case_id then
    raise exception 'the next-decision leg must be a canonical decision on a later case in the same tenant';
  end if;
  if d.created_at < l.created_at then
    raise exception 'the next decision must be created after the lesson it is said to use';
  end if;
  if e.id is null or e.verification_status<>'verified' or e.verified_by is null or e.verified_by=new.recorded_by then
    raise exception 'the learning-to-decision relationship requires same-tenant evidence independently verified by someone other than the recorder';
  end if;
  if o.project_outcome_evidence_id<>e.id then
    raise exception 'the relationship evidence must be the evidence carried by the verified project outcome';
  end if;
  return new;
end $$;

revoke all on function public.guard_decision_learning_event_link() from public,anon,authenticated,service_role;
drop trigger if exists trg_decision_learning_event_link_guard on public.decision_learning_event_links;
create trigger trg_decision_learning_event_link_guard before insert or update or delete on public.decision_learning_event_links
  for each row execute function public.guard_decision_learning_event_link();
revoke insert,update,delete,truncate on public.decision_learning_event_links from anon,authenticated,service_role;

create or replace function public.link_case_learning_to_next_decision(
  p_case_id uuid,p_outcome_event_id uuid,p_lesson_event_id uuid,p_next_decision_id uuid,p_evidence_item_id uuid,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','Linking verified learning to a next decision requires an authorized named human');
  end if;
  begin
    insert into public.decision_learning_event_links(organization_id,development_case_id,outcome_event_id,lesson_event_id,next_decision_id,evidence_item_id,basis,recorded_by)
    values(v_org,p_case_id,p_outcome_event_id,p_lesson_event_id,p_next_decision_id,p_evidence_item_id,btrim(p_basis),auth.uid()) returning id into v_id;
  exception when others then return jsonb_build_object('error',sqlerrm); end;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'learning_informs_next_decision',v_role,jsonb_build_object('link_id',v_id,'case_id',p_case_id,'outcome_event_id',p_outcome_event_id,'lesson_event_id',p_lesson_event_id,'next_decision_id',p_next_decision_id,'evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('linkId',v_id,'relationship','Outcome → Learning → Next Decision','operationalAuthorization',false);
end $$;

revoke all on function public.link_case_learning_to_next_decision(uuid,uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.link_case_learning_to_next_decision(uuid,uuid,uuid,uuid,uuid,text) to authenticated;

create or replace function public.get_case_architectural_north_star(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); c public.development_cases%rowtype;
  v_objective int; v_requirement int; v_risk int; v_decision int; v_design int; v_work int;
  v_asset int; v_operation int; v_outcome int; v_learning int; v_next int;
  v_complete boolean; v_gaps jsonb:='[]'::jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;

  select count(*) into v_objective from public.risk_objectives o where o.id=c.objective_id and o.organization_id=v_org and o.status='adopted';
  select count(*) into v_requirement from public.design_requirements r where r.organization_id=v_org and r.development_case_id=c.id and r.objective_id=c.objective_id;
  select count(*) into v_risk from public.risks r where r.organization_id=v_org and r.development_case_id=c.id and r.objective_id=c.objective_id;
  select count(*) into v_decision from public.decisions d where d.organization_id=v_org and d.development_case_id=c.id and d.objective_id=c.objective_id
    and not exists(select 1 from public.decision_learning_event_links x where x.next_decision_id=d.id);
  select count(*) into v_design from public.thread_objects t where t.organization_id=v_org and t.development_case_id=c.id and t.object_kind='equipment_specification' and t.status='live'
    and exists(select 1 from public.thread_links l join public.thread_objects u on u.id=l.upstream_object_id where l.organization_id=v_org and l.development_case_id=c.id and l.downstream_object_id=t.id and l.status='live' and u.object_kind='requirement');
  select count(*) into v_work from public.work_packages p where p.organization_id=v_org and p.development_case_id=c.id
    and exists(select 1 from public.work_package_work pw join public.work_orders w on w.id=pw.work_order_id join public.development_case_assets ca on ca.asset_id=w.asset_id and ca.organization_id=w.organization_id where pw.work_package_id=p.id and ca.development_case_id=c.id);
  select count(*) into v_asset from public.asset_objective_links a where a.organization_id=v_org and a.development_case_id=c.id and a.objective_id=c.objective_id;
  select count(*) into v_operation from public.work_orders w join public.development_case_assets ca on ca.asset_id=w.asset_id and ca.organization_id=w.organization_id
    where ca.organization_id=v_org and ca.development_case_id=c.id and w.status='completed';
  select count(*) into v_outcome from public.learning_events e where e.organization_id=v_org and e.development_case_id=c.id and e.event_type='project_outcome' and e.project_outcome_evidence_id is not null;
  select count(*) into v_learning from public.learning_events e where e.organization_id=v_org and e.development_case_id=c.id and e.event_type='lesson_learned';
  select count(*) into v_next from public.decision_learning_event_links x where x.organization_id=v_org and x.development_case_id=c.id;

  if v_objective=0 then v_gaps:=v_gaps||jsonb_build_array('adopted objective'); end if;
  if v_requirement=0 then v_gaps:=v_gaps||jsonb_build_array('objective-linked requirement'); end if;
  if v_risk=0 then v_gaps:=v_gaps||jsonb_build_array('objective-linked risk or opportunity'); end if;
  if v_decision=0 then v_gaps:=v_gaps||jsonb_build_array('objective-linked originating decision'); end if;
  if v_design=0 then v_gaps:=v_gaps||jsonb_build_array('requirement-linked design object'); end if;
  if v_work=0 then v_gaps:=v_gaps||jsonb_build_array('asset-bound project work'); end if;
  if v_asset=0 then v_gaps:=v_gaps||jsonb_build_array('asset supporting the objective'); end if;
  if v_operation=0 then v_gaps:=v_gaps||jsonb_build_array('completed operational work on the case asset'); end if;
  if v_outcome=0 then v_gaps:=v_gaps||jsonb_build_array('verified project outcome'); end if;
  if v_learning=0 then v_gaps:=v_gaps||jsonb_build_array('recorded project lesson'); end if;
  if v_next=0 then v_gaps:=v_gaps||jsonb_build_array('later decision explicitly informed by outcome and learning'); end if;
  v_complete:=jsonb_array_length(v_gaps)=0;

  return jsonb_build_object(
    'caseId',c.id,'caseTitle',c.title,'complete',v_complete,'gaps',v_gaps,
    'outcomes',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'evidenceItemId',e.project_outcome_evidence_id,'createdAt',e.created_at) order by e.created_at) from public.learning_events e where e.organization_id=v_org and e.development_case_id=c.id and e.event_type='project_outcome'),'[]'::jsonb),
    'lessons',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'createdAt',e.created_at) order by e.created_at) from public.learning_events e where e.organization_id=v_org and e.development_case_id=c.id and e.event_type='lesson_learned'),'[]'::jsonb),
    'candidateNextDecisions',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'question',d.decision_question,'caseId',d.development_case_id,'caseTitle',n.title,'createdAt',d.created_at) order by d.created_at) from public.decisions d join public.development_cases n on n.id=d.development_case_id and n.organization_id=v_org where d.organization_id=v_org and d.development_case_id<>c.id and exists(select 1 from public.learning_events l where l.organization_id=v_org and l.development_case_id=c.id and l.event_type='lesson_learned' and d.created_at>=l.created_at) and not exists(select 1 from public.decision_learning_event_links x where x.next_decision_id=d.id)),'[]'::jsonb),
    'learningDecisionLinks',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'outcomeEventId',x.outcome_event_id,'lessonEventId',x.lesson_event_id,'nextDecisionId',x.next_decision_id,'evidenceItemId',x.evidence_item_id,'basis',x.basis,'recordedBy',x.recorded_by,'createdAt',x.created_at) order by x.created_at) from public.decision_learning_event_links x where x.organization_id=v_org and x.development_case_id=c.id),'[]'::jsonb),
    'legs',jsonb_build_array(
      jsonb_build_object('key','objective','label','Objective','count',v_objective,'complete',v_objective>0),
      jsonb_build_object('key','requirement','label','Requirement','count',v_requirement,'complete',v_requirement>0),
      jsonb_build_object('key','risk_opportunity','label','Risk / opportunity','count',v_risk,'complete',v_risk>0),
      jsonb_build_object('key','decision','label','Decision','count',v_decision,'complete',v_decision>0),
      jsonb_build_object('key','design','label','Design','count',v_design,'complete',v_design>0),
      jsonb_build_object('key','project_work','label','Project work','count',v_work,'complete',v_work>0),
      jsonb_build_object('key','asset','label','Asset','count',v_asset,'complete',v_asset>0),
      jsonb_build_object('key','operation','label','Operation','count',v_operation,'complete',v_operation>0),
      jsonb_build_object('key','outcome','label','Outcome','count',v_outcome,'complete',v_outcome>0),
      jsonb_build_object('key','learning','label','Learning','count',v_learning,'complete',v_learning>0),
      jsonb_build_object('key','next_decision','label','Next decision','count',v_next,'complete',v_next>0)),
    'relationshipCount',11,'canonicalGraph',public.sync_spec34_edges(),
    'decisionBoundary','Traversal completeness is evidence visibility, not objective achievement, gate approval, risk acceptance, equipment readiness, funding approval or authorization to act. Every authority-bearing decision remains a named-human act.');
end $$;

revoke all on function public.get_case_architectural_north_star(uuid) from public,anon;
grant execute on function public.get_case_architectural_north_star(uuid) to authenticated;

comment on table public.decision_learning_event_links is 'D11.36: immutable association from canonical verified outcome and lesson to a later canonical decision; not a second learning, decision, evidence or graph store.';
comment on function public.get_case_architectural_north_star(uuid) is 'D11.36 / §86: honest eleven-leg case traversal over canonical stores. complete remains false and gaps are named until every leg is present.';
notify pgrst,'reload schema';

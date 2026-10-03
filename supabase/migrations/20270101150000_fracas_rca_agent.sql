-- ============================================================================
-- C1.07 / C8.05 — governed FRACAS / RCA agent execution.
--
-- The canonical work-order closeout is the incident capture. This migration
-- adds the missing governed investigation act, named-human ownership and a
-- controlled hand-off to the existing corrective-action effectiveness loop.
-- A reported cause is retained as a hypothesis; the agent never promotes it
-- to a verified root cause or closes any human attestation stage.
-- ============================================================================

insert into public.agent_software_tools(tool_key,title,purpose,access_kind)
values (
  'analyse_fracas_case','Analyse FRACAS case',
  'Assemble a retained causal-investigation pack from exact tenant work history, while keeping reported cause, coded mechanism and verified root cause distinct.',
  'analyse')
on conflict(tool_key) do update set
  title=excluded.title,purpose=excluded.purpose,access_kind=excluded.access_kind;

insert into public.ai_agents
  (organization_id,key,name,category,status,autonomy_mode,current_task,supervisor)
select o.id,'fracas_rca','RCA / FRACAS Investigator','specialist','active',
       'advisory','Waiting for a governed investigation request',
       'Reliability Manager'
from public.organizations o
where not exists (
  select 1 from public.ai_agents a
  where a.organization_id=o.id and a.key='fracas_rca'
);

update public.ai_agents
set name='RCA / FRACAS Investigator',category='specialist',autonomy_mode='advisory',
    supervisor='Reliability Manager',
    operating_charter=jsonb_build_object(
      'purpose','Convert completed corrective-work evidence into an auditable FRACAS investigation and verification hand-off.',
      'modes',jsonb_build_array('incident review','causal investigation','recurrence review','corrective-action follow-up'),
      'triggers',jsonb_build_array('completed corrective work','repeat failure','ineffective corrective action','human investigation request'),
      'inputs',jsonb_build_array('work-order closeout','human-coded failure mechanism','same-asset recurrence history','asset class','corrective-action verification history'),
      'outputs',jsonb_build_array('immutable investigation pack','reported-cause hypothesis','evidence gaps','evidence plan','recurrence reading','human assignment hand-off'),
      'guardrails',jsonb_build_array(
        'Never call a reported cause or statistical association a verified root cause',
        'Never invent failure evidence, mechanisms, recurrence, containment or corrective actions',
        'Never attest physical correction, causal closure, strategy update or effectiveness',
        'Never close work, approve strategy, accept risk, commit spend or return equipment to service',
        'Require a named human owner before starting corrective-action verification'),
      'routes',jsonb_build_array('/reliability'))
where key='fracas_rca';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_agents'::regclass
      and conname='ai_agents_fracas_charter_shape'
  ) then
    alter table public.ai_agents add constraint ai_agents_fracas_charter_shape
      check (key <> 'fracas_rca' or operating_charter ?&
        array['purpose','modes','triggers','inputs','outputs','guardrails','routes']);
  end if;
end $$;

-- Upgrade only untouched platform baselines. Customer-authored histories are
-- never overwritten; those agents remain closed until their administrator
-- deliberately adopts a compatible control profile.
do $$
declare
  r record;
  v_profile uuid;
  v_version integer;
  v_basis constant text :=
    'Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.';
begin
  for r in
    select a.id agent_id,a.organization_id,p.id old_profile,p.basis old_basis,
           p.required_human_approver_role,p.proposal_risk_ceiling,
           p.proposal_cost_ceiling_usd,p.proposal_downtime_ceiling_hours
    from public.ai_agents a
    left join public.agent_control_profiles p
      on p.agent_id=a.id and p.organization_id=a.organization_id
     and p.status='adopted'
    where a.key='fracas_rca'
  loop
    if r.old_profile is not null and r.old_basis <> v_basis then continue; end if;
    if r.old_profile is null and exists (
      select 1 from public.agent_control_profiles history
      where history.agent_id=r.agent_id
    ) then continue; end if;
    select coalesce(max(version),0)+1 into v_version
    from public.agent_control_profiles where agent_id=r.agent_id;
    if r.old_profile is not null then
      update public.agent_control_profiles set status='superseded'
      where id=r.old_profile;
    end if;
    insert into public.agent_control_profiles
      (organization_id,agent_id,authority_mode,required_human_approver_role,
       proposal_risk_ceiling,proposal_cost_ceiling_usd,
       proposal_downtime_ceiling_hours,may_approve,basis,status,version,adopted_at)
    values
      (r.organization_id,r.agent_id,'advisory_only',
       coalesce(r.required_human_approver_role,'reliability_engineer'),
       coalesce(r.proposal_risk_ceiling,'Critical'),
       coalesce(r.proposal_cost_ceiling_usd,0),
       coalesce(r.proposal_downtime_ceiling_hours,0),false,
       v_basis,'draft',v_version,null)
    returning id into v_profile;

    insert into public.agent_decision_right_bindings
      (organization_id,profile_id,agent_id,decision_right_id)
    select r.organization_id,v_profile,r.agent_id,d.id
    from public.decision_rights d
    where d.right_key in ('flag_repeat_failures','recommend_inspection_review');

    insert into public.agent_tool_bindings
      (organization_id,profile_id,agent_id,tool_id)
    select r.organization_id,v_profile,r.agent_id,t.id
    from public.agent_software_tools t
    where t.tool_key in
      ('analyse_fracas_case','read_work_context','draft_recommendation');

    update public.agent_control_profiles
    set status='adopted',adopted_at=now() where id=v_profile;
  end loop;
end
$$;

-- Extend the shared retained-run guard with one transaction-local FRACAS
-- writer marker. Existing planner, site-manager and reliability paths remain
-- unchanged and retain their own markers.
create or replace function public.enforce_retained_agent_run()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_planner_marker text := coalesce(current_setting('app.planner_agent_run_write',true),'');
  v_site_marker text := coalesce(current_setting('app.site_manager_agent_run_write',true),'');
  v_reliability_marker text := coalesce(current_setting('app.reliability_agent_run_write',true),'');
  v_fracas_marker text := coalesce(current_setting('app.fracas_agent_run_write',true),'');
  v_allowed boolean := v_planner_marker='granted' or v_site_marker='granted'
    or v_reliability_marker='granted' or v_fracas_marker='granted';
begin
  if tg_op='DELETE' and old.retained_for_governance then return null; end if;
  if tg_op='UPDATE' and old.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are immutable; run the agent again for a new dated reading';
  end if;
  if tg_op='INSERT' and new.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are written only by a governed agent execution path';
  end if;
  if tg_op <> 'DELETE' and new.retained_for_governance then
    if new.requested_by is null
       or (new.work_order_id is null and new.site_id is null
           and nullif(btrim(new.component_scope),'') is null)
       or new.agent_control_profile_id is null
       or coalesce(btrim(new.agent_tool_key),'')=''
       or coalesce(btrim(new.agent_decision_right_key),'')='' then
      raise exception 'retained agent runs require requester, canonical work/site/component scope, control profile, tool and decision-right provenance';
    end if;
    if not exists (select 1 from public.user_profiles p
      where p.id=new.requested_by and p.organization_id=new.organization_id) then
      raise exception 'agent-run requester is not a member of this organization';
    end if;
    if not exists (select 1 from public.ai_agents a
      where a.id=new.agent_id and a.organization_id=new.organization_id) then
      raise exception 'agent run crosses its organization boundary';
    end if;
    if new.work_order_id is not null and not exists (select 1 from public.work_orders w
      where w.id=new.work_order_id and w.organization_id=new.organization_id) then
      raise exception 'agent run names work outside its organization';
    end if;
    if new.site_id is not null and not exists (select 1 from public.sites s
      where s.id=new.site_id and s.organization_id=new.organization_id) then
      raise exception 'agent run names a site outside its organization';
    end if;
    if nullif(btrim(new.component_scope),'') is not null and not exists (
      select 1 from public.component_life_events e
      where e.organization_id=new.organization_id
        and lower(e.component)=lower(btrim(new.component_scope))) then
      raise exception 'agent run names a component population outside its organization';
    end if;
    if new.job_plan_id is not null and not exists (select 1 from public.job_plans j
      where j.id=new.job_plan_id and j.organization_id=new.organization_id) then
      raise exception 'agent run names a job plan outside its organization';
    end if;
    if not exists (select 1 from public.agent_control_profiles p
      where p.id=new.agent_control_profile_id
        and p.organization_id=new.organization_id
        and p.agent_id=new.agent_id and p.status='adopted') then
      raise exception 'agent run does not carry the adopted control profile for this agent';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

create table if not exists public.fracas_investigation_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  asset_id uuid not null references public.assets(id) on delete restrict,
  agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot)='object'),
  investigation jsonb not null check (jsonb_typeof(investigation)='object'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(work_order_id)
);
create index if not exists idx_fracas_packs_work
  on public.fracas_investigation_packs(organization_id,work_order_id,created_at desc);

create table if not exists public.fracas_investigation_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  investigation_pack_id uuid not null references public.fracas_investigation_packs(id) on delete restrict,
  assigned_to uuid not null references auth.users(id),
  due_date date not null,
  assignment_note text not null check (length(btrim(assignment_note)) between 10 and 2000),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now()
);
create index if not exists idx_fracas_assignments_pack
  on public.fracas_investigation_assignments(organization_id,investigation_pack_id,assigned_at desc);

create table if not exists public.fracas_verification_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  investigation_pack_id uuid not null unique references public.fracas_investigation_packs(id) on delete restrict,
  verification_id uuid not null unique references public.ca_verifications(id) on delete restrict,
  linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now()
);

alter table public.fracas_investigation_packs enable row level security;
alter table public.fracas_investigation_assignments enable row level security;
alter table public.fracas_verification_links enable row level security;
drop policy if exists fracas_packs_read on public.fracas_investigation_packs;
create policy fracas_packs_read on public.fracas_investigation_packs
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists fracas_assignments_read on public.fracas_investigation_assignments;
create policy fracas_assignments_read on public.fracas_investigation_assignments
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists fracas_verification_links_read on public.fracas_verification_links;
create policy fracas_verification_links_read on public.fracas_verification_links
  for select to authenticated using (organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.fracas_investigation_packs,
  public.fracas_investigation_assignments,public.fracas_verification_links
  from public,anon,authenticated;
grant select on public.fracas_investigation_packs,
  public.fracas_investigation_assignments,public.fracas_verification_links
  to authenticated;

create or replace function public.protect_fracas_records()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_marker text:=coalesce(current_setting('app.fracas_record_write',true),'');
begin
  if v_marker<>'granted' then
    raise exception 'FRACAS records are written only by the governed investigation workflow';
  end if;
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'FRACAS investigation, assignment and verification-link records are append-only';
  end if;
  return new;
end $$;
revoke all on function public.protect_fracas_records() from public,anon,authenticated;
create trigger trg_protect_fracas_packs before insert or update or delete
  on public.fracas_investigation_packs for each row execute function public.protect_fracas_records();
create trigger trg_protect_fracas_assignments before insert or update or delete
  on public.fracas_investigation_assignments for each row execute function public.protect_fracas_records();
create trigger trg_protect_fracas_links before insert or update or delete
  on public.fracas_verification_links for each row execute function public.protect_fracas_records();

create or replace function public.run_fracas_rca_agent(p_work_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  w public.work_orders%rowtype;
  a public.assets%rowtype;
  ag public.ai_agents%rowtype;
  v_control jsonb;
  v_run uuid;
  v_pack uuid;
  v_history jsonb;
  v_history_count int;
  v_mechanism_name text;
  v_mechanism_key text;
  v_snapshot jsonb;
  v_gaps jsonb:='[]'::jsonb;
  v_hypotheses jsonb:='[]'::jsonb;
  v_plan jsonb:='[]'::jsonb;
  v_result jsonb;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','running the RCA / FRACAS agent requires a named reliability engineer, maintenance manager or administrator');
  end if;
  select * into w from public.work_orders
  where id=p_work_order_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','work order not found'); end if;
  if w.work_type is distinct from 'corrective' or w.completed_at is null then
    return jsonb_build_object('error','FRACAS investigation requires completed corrective work');
  end if;
  if coalesce(length(btrim(w.actual_failure_mode)),0)<2
     or coalesce(length(btrim(w.actual_cause)),0)<2
     or coalesce(length(btrim(w.corrective_action)),0)<2 then
    return jsonb_build_object('error','complete failure mode, reported cause and corrective-action closeout fields before investigation');
  end if;
  if exists(select 1 from public.fracas_investigation_packs
    where organization_id=v_org and work_order_id=w.id) then
    return jsonb_build_object('error','this corrective work order already has a retained FRACAS investigation pack');
  end if;
  select * into a from public.assets
  where id=w.asset_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','work order asset not found'); end if;
  select * into ag from public.ai_agents
  where organization_id=v_org and key='fracas_rca'
  order by created_at limit 1;
  if not found then return jsonb_build_object('error','no RCA / FRACAS agent is configured in this organization'); end if;
  v_control:=public.evaluate_agent_control_internal(
    v_org,ag.id,'flag_repeat_failures','analyse_fracas_case',
    case when coalesce(w.safety_flag,false) or lower(coalesce(w.priority,''))='critical' then 'Critical'
         when lower(coalesce(w.priority,''))='high' then 'High'
         when lower(coalesce(w.priority,''))='medium' then 'Medium' else 'Low' end,
    null,null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','RCA / FRACAS agent refused: '||(v_control->>'reason'));
  end if;

  select dm.mechanism_key,dm.name into v_mechanism_key,v_mechanism_name
  from public.damage_mechanisms dm
  where dm.id=w.failure_mechanism_id and dm.organization_id=v_org;

  select coalesce(jsonb_agg(jsonb_build_object(
      'workOrderId',h.id,'workOrderNumber',h.wo_number,'completedAt',h.completed_at,
      'rawFailureLabel',h.actual_failure_mode,'reportedCause',h.actual_cause,
      'correctiveAction',h.corrective_action,'downtimeHours',h.downtime_hours,
      'sameMechanism',w.failure_mechanism_id is not null and h.failure_mechanism_id=w.failure_mechanism_id,
      'matchBasis',case when w.failure_mechanism_id is not null then 'human_coded_mechanism'
        else 'exact_raw_closeout_label_proxy' end)
      order by h.completed_at,h.id),'[]'::jsonb),count(*)::int
  into v_history,v_history_count
  from public.work_orders h
  where h.organization_id=v_org and h.asset_id=w.asset_id
    and h.work_type='corrective' and h.completed_at is not null and h.id<>w.id
    and (case when w.failure_mechanism_id is not null
      then h.failure_mechanism_id=w.failure_mechanism_id
      else h.actual_failure_mode is not distinct from w.actual_failure_mode end);

  v_hypotheses:=jsonb_build_array(jsonb_build_object(
    'statement',btrim(w.actual_cause),'status','reported_not_verified',
    'source','work_order_closeout','evidenceRef',w.id,
    'warning','A reported closeout cause is a hypothesis until a named human verifies the causal chain.'));
  if w.failure_mechanism_id is null then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
      'code','mechanism_coding','severity','blocker',
      'detail','No governed failure mechanism is coded. Recurrence uses the exact raw closeout label as a disclosed proxy.'));
  end if;
  if nullif(btrim(coalesce(w.technician_comments,'')),'') is null then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
      'code','physical_evidence','severity','attention',
      'detail','No technician evidence narrative is recorded for the observed physical condition.'));
  end if;
  if nullif(btrim(coalesce(w.parts_used,'')),'') is null then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
      'code','removed_parts','severity','attention',
      'detail','No replaced-part record is available for traceability or examination.'));
  end if;
  v_plan:=jsonb_build_array(
    jsonb_build_object('sequence',1,'question','What physical evidence supports or refutes the reported cause?','owner','assigned human investigator','completion','Attach inspection, photo, measurement or teardown evidence.'),
    jsonb_build_object('sequence',2,'question','What conditions and events preceded the failure?','owner','assigned human investigator','completion','Reconstruct the time-ordered event chain from verified records.'),
    jsonb_build_object('sequence',3,'question','Does the same governed mechanism recur on this asset or exposed peers?','owner','reliability engineer','completion','Confirm mechanism coding and complete similar-asset screening.'),
    jsonb_build_object('sequence',4,'question','Did the implemented action address the verified causal mechanism?','owner','accountable human authority','completion','Attest causal closure only after evidence review.'));

  v_snapshot:=jsonb_build_object(
    'asOf',now(),'subject',jsonb_build_object(
      'workOrderId',w.id,'workOrderNumber',w.wo_number,'title',w.title,
      'assetId',w.asset_id,'assetTag',coalesce(a.asset_tag,a.tag),
      'assetClass',a.asset_class,'priority',w.priority,'completedAt',w.completed_at,
      'rawFailureLabel',w.actual_failure_mode,'reportedCause',w.actual_cause,
      'correctiveAction',w.corrective_action,'technicianComments',w.technician_comments,
      'partsUsed',w.parts_used,'laborHours',w.labor_hours,'downtimeHours',w.downtime_hours,
      'failureMechanismId',w.failure_mechanism_id,'failureMechanismKey',v_mechanism_key,
      'failureMechanismName',v_mechanism_name,'mechanismCodedBy',w.mechanism_coded_by,
      'mechanismCodedAt',w.mechanism_coded_at,'mechanismNote',w.mechanism_note),
    'matchingPriorOrLaterEvents',v_history,
    'sourceTables',jsonb_build_array('work_orders','assets','damage_mechanisms'));

  perform set_config('app.fracas_agent_run_write','granted',true);
  insert into public.agent_runs
    (organization_id,agent_id,asset_id,status,summary,confidence,started_at,
     requested_by,work_order_id,agent_control_profile_id,agent_tool_key,
     agent_decision_right_key,input_snapshot,retained_for_governance)
  values
    (v_org,ag.id,w.asset_id,'running','RCA / FRACAS agent is assembling exact tenant evidence.',
     case when w.failure_mechanism_id is null then 55 else 75 end,now(),auth.uid(),w.id,
     (v_control->>'profile_id')::uuid,'analyse_fracas_case','flag_repeat_failures',
     v_snapshot,true)
  returning id into v_run;

  v_result:=jsonb_build_object(
    'runId',v_run,'agentId',ag.id,'agentKey',ag.key,'workOrderId',w.id,
    'problemStatement',format('%s on %s was closed as %s. The reported cause remains unverified pending the evidence plan.',coalesce(w.wo_number,w.id::text),coalesce(a.asset_tag,a.tag,a.name),w.actual_failure_mode),
    'knownFacts',jsonb_build_array(
      jsonb_build_object('fact','Completed corrective work order','evidenceRef',w.id),
      jsonb_build_object('fact','Recorded corrective action: '||w.corrective_action,'evidenceRef',w.id),
      jsonb_build_object('fact',v_history_count||' matching prior/later event(s) found on this asset','evidenceRefs',v_history)),
    'hypotheses',v_hypotheses,'evidenceGaps',v_gaps,'evidencePlan',v_plan,
    'recurrence',jsonb_build_object('matchingEvents',v_history_count,
      'basis',case when w.failure_mechanism_id is not null
        then 'same asset and same named-human-coded mechanism'
        else 'same asset and exact raw closeout label; proxy only until mechanism coding' end),
    'containmentCandidates',jsonb_build_array(
      jsonb_build_object('candidate','Verify the implemented physical correction before relying on it.','status','human_review_required'),
      jsonb_build_object('candidate','Screen similar assets after mechanism coding is confirmed.','status','human_review_required')),
    'limitations',jsonb_build_array(
      'This pack does not claim a verified root cause.',
      'Association and recurrence do not prove causation.',
      'The agent did not attest physical correction, causal closure, strategy update or effectiveness.'),
    'humanApprovalRequired',true,
    'mayClaimRootCause',false,'mayCloseInvestigation',false,'mayAttestVerification',false,
    'mayApproveStrategy',false,'mayAcceptRisk',false,'mayCommitSpend',false,
    'mayReturnToService',false);

  perform set_config('app.fracas_record_write','granted',true);
  insert into public.fracas_investigation_packs
    (organization_id,work_order_id,asset_id,agent_run_id,source_snapshot,
     investigation,created_by)
  values(v_org,w.id,w.asset_id,v_run,v_snapshot,v_result,auth.uid())
  returning id into v_pack;
  v_result:=v_result||jsonb_build_object('packId',v_pack);
  update public.agent_runs set status='completed',completed_at=now(),result=v_result,
    summary='Created an immutable advisory investigation pack with '
      ||v_history_count||' matching recurrence event(s) and '
      ||jsonb_array_length(v_gaps)||' evidence gap(s).'
  where id=v_run;
  perform set_config('app.fracas_record_write','',true);
  perform set_config('app.fracas_agent_run_write','',true);

  update public.ai_agents set last_action_at=now(),status='active',
    current_task='Investigated '||coalesce(w.wo_number,w.id::text),
    last_action='Created a governed FRACAS investigation pack',
    recommendations_generated=coalesce(recommendations_generated,0)+1
  where id=ag.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'fracas_agent_run',v_role,jsonb_build_object(
    'action','investigation_pack_created','work_order_id',w.id,
    'pack_id',v_pack,'agent_run_id',v_run,'requested_by',auth.uid(),
    'control_profile_id',v_control->>'profile_id','root_cause_claimed',false));
  return v_result;
end
$$;
revoke all on function public.run_fracas_rca_agent(uuid) from public,anon;
grant execute on function public.run_fracas_rca_agent(uuid) to authenticated;

create or replace function public.assign_fracas_investigation(
  p_pack_id uuid,p_assigned_to uuid,p_due_date date,p_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_assignment uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','assignment requires a named reliability engineer, maintenance manager or administrator');
  end if;
  if not exists(select 1 from public.fracas_investigation_packs
    where id=p_pack_id and organization_id=v_org) then
    return jsonb_build_object('error','investigation pack not found');
  end if;
  if not exists(select 1 from public.user_profiles
    where id=p_assigned_to and organization_id=v_org) then
    return jsonb_build_object('error','owner must be a named member of this organization');
  end if;
  if p_due_date is null or p_due_date<current_date then
    return jsonb_build_object('error','due date cannot be in the past');
  end if;
  if coalesce(length(btrim(p_note)),0) not between 10 and 2000 then
    return jsonb_build_object('error','assignment basis must contain 10–2000 characters');
  end if;
  perform set_config('app.fracas_record_write','granted',true);
  insert into public.fracas_investigation_assignments
    (organization_id,investigation_pack_id,assigned_to,due_date,
     assignment_note,assigned_by)
  values(v_org,p_pack_id,p_assigned_to,p_due_date,btrim(p_note),auth.uid())
  returning id into v_assignment;
  perform set_config('app.fracas_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'fracas_assignment',v_role,jsonb_build_object(
    'action','assigned','pack_id',p_pack_id,'assignment_id',v_assignment,
    'assigned_to',p_assigned_to,'due_date',p_due_date,'assigned_by',auth.uid()));
  return jsonb_build_object('assignmentId',v_assignment,'packId',p_pack_id,
    'assignedTo',p_assigned_to,'dueDate',p_due_date);
end $$;
revoke all on function public.assign_fracas_investigation(uuid,uuid,date,text) from public,anon;
grant execute on function public.assign_fracas_investigation(uuid,uuid,date,text) to authenticated;

create or replace function public.start_fracas_verification(
  p_pack_id uuid,p_observation_days int default 90
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_pack public.fracas_investigation_packs%rowtype;
  v_started jsonb; v_verification uuid; v_link uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','verification hand-off requires a named reliability engineer, maintenance manager or administrator');
  end if;
  select * into v_pack from public.fracas_investigation_packs
  where id=p_pack_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','investigation pack not found'); end if;
  if not exists(select 1 from public.fracas_investigation_assignments
    where investigation_pack_id=v_pack.id and organization_id=v_org) then
    return jsonb_build_object('error','assign a named human owner before starting verification');
  end if;
  if exists(select 1 from public.fracas_verification_links
    where investigation_pack_id=v_pack.id and organization_id=v_org) then
    return jsonb_build_object('error','this investigation already has a verification hand-off');
  end if;
  select id into v_verification from public.ca_verifications
  where organization_id=v_org and work_order_id=v_pack.work_order_id;
  if v_verification is null then
    v_started:=public.start_ca_verification(v_pack.work_order_id,p_observation_days);
    if v_started ? 'error' then return v_started; end if;
    v_verification:=(v_started->>'id')::uuid;
  end if;
  perform set_config('app.fracas_record_write','granted',true);
  insert into public.fracas_verification_links
    (organization_id,investigation_pack_id,verification_id,linked_by)
  values(v_org,v_pack.id,v_verification,auth.uid()) returning id into v_link;
  perform set_config('app.fracas_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'fracas_verification_handoff',v_role,jsonb_build_object(
    'action','verification_started','pack_id',v_pack.id,
    'verification_id',v_verification,'linked_by',auth.uid(),
    'agent_attested_stages',false));
  return jsonb_build_object('linkId',v_link,'packId',v_pack.id,
    'verificationId',v_verification,'observationDays',least(greatest(coalesce(p_observation_days,90),7),730),
    'humanAttestationsRequired',true);
end $$;
revoke all on function public.start_fracas_verification(uuid,int) from public,anon;
grant execute on function public.start_fracas_verification(uuid,int) to authenticated;

create or replace function public.get_fracas_workspace(p_limit int default 50)
returns jsonb language sql stable security definer set search_path=public as $$
  with caller as (select public.app_current_org() organization_id),
  candidates as (
    select w.id,w.wo_number,w.title,w.completed_at,w.actual_failure_mode,
      coalesce(a.asset_tag,a.tag,a.name) asset_tag,
      exists(select 1 from public.fracas_investigation_packs p
        where p.organization_id=w.organization_id and p.work_order_id=w.id) has_pack
    from public.work_orders w join public.assets a
      on a.id=w.asset_id and a.organization_id=w.organization_id
    join caller c on c.organization_id=w.organization_id
    where w.work_type='corrective' and w.completed_at is not null
      and nullif(btrim(w.actual_failure_mode),'') is not null
      and nullif(btrim(w.actual_cause),'') is not null
      and nullif(btrim(w.corrective_action),'') is not null
    order by w.completed_at desc,w.id limit least(greatest(coalesce(p_limit,50),1),100)
  ), packs as (
    select p.*,coalesce(a.asset_tag,a.tag,a.name) asset_tag,w.wo_number,w.title,
      latest.id assignment_id,latest.assigned_to,latest.due_date,latest.assignment_note,
      up.full_name owner_name,l.verification_id,cv.status verification_status,
      cv.effectiveness
    from public.fracas_investigation_packs p
    join caller c on c.organization_id=p.organization_id
    join public.work_orders w on w.id=p.work_order_id and w.organization_id=p.organization_id
    join public.assets a on a.id=p.asset_id and a.organization_id=p.organization_id
    left join lateral (select fa.* from public.fracas_investigation_assignments fa
      where fa.investigation_pack_id=p.id and fa.organization_id=p.organization_id
      order by fa.assigned_at desc,fa.id desc limit 1) latest on true
    left join public.user_profiles up on up.id=latest.assigned_to and up.organization_id=p.organization_id
    left join public.fracas_verification_links l on l.investigation_pack_id=p.id
      and l.organization_id=p.organization_id
    left join public.ca_verifications cv on cv.id=l.verification_id
    order by p.created_at desc limit least(greatest(coalesce(p_limit,50),1),100)
  )
  select case when (select organization_id from caller) is null then jsonb_build_object('error','forbidden')
  else jsonb_build_object(
    'candidates',coalesce((select jsonb_agg(jsonb_build_object(
      'workOrderId',id,'workOrderNumber',wo_number,'title',title,
      'completedAt',completed_at,'rawFailureLabel',actual_failure_mode,
      'assetTag',asset_tag,'hasPack',has_pack) order by completed_at desc) from candidates),'[]'::jsonb),
    'packs',coalesce((select jsonb_agg(jsonb_build_object(
      'packId',id,'workOrderId',work_order_id,'workOrderNumber',wo_number,
      'title',title,'assetTag',asset_tag,'agentRunId',agent_run_id,
      'investigation',investigation,'createdBy',created_by,'createdAt',created_at,
      'assignment',case when assignment_id is null then null else jsonb_build_object(
        'assignmentId',assignment_id,'assignedTo',assigned_to,
        'ownerName',coalesce(owner_name,assigned_to::text),'dueDate',due_date,
        'note',assignment_note) end,
      'verification',case when verification_id is null then null else jsonb_build_object(
        'verificationId',verification_id,'status',verification_status,
        'effectiveness',effectiveness) end) order by created_at desc) from packs),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'id',up.id,'name',coalesce(up.full_name,up.id::text),'role',up.role)
      order by coalesce(up.full_name,up.id::text)) from public.user_profiles up
      join caller c on c.organization_id=up.organization_id),'[]'::jsonb),
    'basis','Completed corrective closeouts are candidate incidents. Packs are immutable agent readings; assignments are append-only human acts; verification status comes from the canonical corrective-action effectiveness loop.') end;
$$;
revoke all on function public.get_fracas_workspace(int) from public,anon;
grant execute on function public.get_fracas_workspace(int) to authenticated;

comment on function public.run_fracas_rca_agent(uuid) is
  'C1.07/C8.05: creates an immutable advisory investigation pack from exact same-tenant corrective-work evidence, keeps reported cause distinct from verified root cause, calculates recurrence, and retains agent/control provenance.';
comment on function public.start_fracas_verification(uuid,int) is
  'C8.05: named-human-controlled hand-off from an assigned FRACAS investigation to the canonical corrective-action verification and recurrence-measurement lifecycle; it attests no judgment stage.';

notify pgrst,'reload schema';

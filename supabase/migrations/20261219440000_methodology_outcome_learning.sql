-- D9.08-D9.09 — governed methodology-outcome learning.
--
-- Canonical reuse is deliberate: project_frameworks/stage_gates/
-- stage_gate_criteria are the method; stage_gate_reviews/findings are the
-- execution record; learning_events project_outcomes are independently
-- evidenced outcomes; calculation_runs is the immutable analytical ledger;
-- framework_proposals is the proposal record; adopt_project_framework remains
-- the only act that can put a change in force. No parallel method, outcome,
-- evidence, calculation, proposal, or approval store is created.

-- A framework proposal may now originate in either governed document
-- ingestion or an immutable outcome-analysis run. Exactly one origin is
-- required. Existing document proposals are unchanged.
alter table public.framework_proposals alter column document_id drop not null;
alter table public.framework_proposals
  add column if not exists calculation_run_id uuid references public.calculation_runs(id) on delete restrict,
  add column if not exists source_framework_id uuid references public.project_frameworks(id) on delete restrict,
  add column if not exists target_criterion_id bigint references public.stage_gate_criteria(id) on delete restrict,
  add column if not exists improvement_action text,
  add column if not exists human_rationale text;

alter table public.framework_proposals drop constraint if exists framework_proposal_one_origin;
alter table public.framework_proposals add constraint framework_proposal_one_origin check (
  (document_id is not null and calculation_run_id is null)
  or (document_id is null and calculation_run_id is not null)
);
alter table public.framework_proposals drop constraint if exists framework_proposal_improvement_shape;
alter table public.framework_proposals add constraint framework_proposal_improvement_shape check (
  calculation_run_id is null
  or (
    source_framework_id is not null and target_criterion_id is not null
    and improvement_action in ('simplify','strengthen')
    and length(btrim(human_rationale)) >= 20
  )
);
create unique index if not exists idx_framework_proposals_analysis_target
  on public.framework_proposals(calculation_run_id,target_criterion_id)
  where calculation_run_id is not null and status='proposed';

-- Rebuild the existing provenance wall for the newly nullable document. A
-- cascade is admitted only when an actual parent is disappearing; NULL is an
-- analysis origin, not evidence that a document was deleted.
create or replace function public.enforce_framework_proposal_provenance()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_marker text:=coalesce(current_setting('app.framework_proposal_write',true),'');
  f public.project_frameworks%rowtype;
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.organizations where id=old.organization_id)
       or not exists(select 1 from public.project_frameworks where id=old.framework_id)
       or (old.document_id is not null and not exists(select 1 from public.kb_intake_documents where id=old.document_id)) then
      return old;
    end if;
    if v_marker<>'granted' then
      raise exception 'A framework proposal is an immutable record of a proposed governance change. Withdraw it with a stated reason; do not delete it.'
        using errcode='insufficient_privilege';
    end if;
    return old;
  end if;
  if v_marker<>'granted' then
    raise exception 'A framework proposal cannot be written directly. Use the governed document or outcome-learning proposal path.'
      using errcode='insufficient_privilege';
  end if;
  select * into f from public.project_frameworks where id=new.framework_id;
  if not found or f.organization_id<>new.organization_id then
    raise exception 'A framework proposal names a draft framework of its own organization.' using errcode='check_violation';
  end if;
  if tg_op='INSERT' and f.status<>'draft' then
    raise exception 'A proposal attaches only to a DRAFT framework. Human adoption is a later, separate act.' using errcode='check_violation';
  end if;
  if new.calculation_run_id is not null and not exists(
    select 1 from public.calculation_runs r where r.id=new.calculation_run_id
      and r.organization_id=new.organization_id and r.calculation_key='methodology_outcome_analysis'
      and r.status in ('computed','computed_with_refusals')
  ) then
    raise exception 'An outcome-learning proposal requires a same-tenant computed methodology analysis run.' using errcode='check_violation';
  end if;
  return new;
end $$;
revoke all on function public.enforce_framework_proposal_provenance() from public,anon,authenticated;

-- Correlate the latest finding for each completed case/gate with the verified
-- project outcome. The binary status correlation is point-biserial (Pearson
-- correlation where met=1 and not_met=0). It is descriptive association, not
-- causation, and both cohorts need at least three projects.
create or replace function public.run_methodology_outcome_analysis(
  p_framework_id uuid,
  p_minimum_cohort int default 3
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; f public.project_frameworks%rowtype;
  v_min int:=greatest(coalesce(p_minimum_cohort,3),3); v_outputs jsonb; v_refusals jsonb; v_patterns jsonb;
  v_refs jsonb; v_run uuid; v_status text; v_requirement_count int; v_eligible_count int;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','forbidden');
  end if;
  select * into f from public.project_frameworks where id=p_framework_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','framework not found in this organization'); end if;
  if f.status<>'adopted' then return jsonb_build_object('error','methodology learning analyzes an adopted framework; a draft governs no completed execution'); end if;

  select count(*) into v_requirement_count from public.stage_gate_criteria c
  join public.stage_gates g on g.id=c.gate_id where g.framework_id=f.id;
  if v_requirement_count=0 then return jsonb_build_object('error','this adopted framework has no gate requirements to correlate'); end if;

  with source_requirements as (
    select c.id criterion_id,c.criterion,g.id gate_id,g.stage_key,g.name gate_name
    from public.stage_gate_criteria c join public.stage_gates g on g.id=c.gate_id
    where g.framework_id=f.id
  ), observations as (
    select sr.*,dc.id case_id,le.id outcome_id,le.project_outcome_evidence_id,
      rv.id review_id,fi.id finding_id,fi.status,
      le.project_actual_cost/le.project_baseline_cost-1 cost_growth,
      le.project_actual_duration_days/le.project_baseline_duration_days-1 schedule_growth,
      le.commissioning_defects::numeric defects,le.startup_reliability_pct::numeric startup_reliability
    from source_requirements sr
    join public.development_cases dc on dc.organization_id=v_org and dc.status='completed'
    join public.project_frameworks used_f on used_f.id=dc.framework_id and used_f.organization_id=v_org and used_f.name=f.name
    join public.learning_events le on le.organization_id=v_org and le.development_case_id=dc.id and le.event_type='project_outcome'
    join public.evidence_items ei on ei.id=le.project_outcome_evidence_id and ei.organization_id=v_org and ei.verification_status='verified'
    join public.stage_gates used_g on used_g.framework_id=used_f.id and used_g.stage_key=sr.stage_key and lower(used_g.name)=lower(sr.gate_name)
    join lateral (
      select r.* from public.stage_gate_reviews r where r.organization_id=v_org and r.development_case_id=dc.id and r.gate_id=used_g.id
      order by r.reviewed_at desc,r.id desc limit 1
    ) rv on true
    join public.stage_gate_findings fi on fi.organization_id=v_org and fi.review_id=rv.id
      and lower(btrim(fi.criterion_text))=lower(btrim(sr.criterion)) and fi.status in ('met','not_met')
  ), aggregate_patterns as (
    select sr.criterion_id,sr.gate_id,sr.stage_key,sr.gate_name,sr.criterion,
      count(distinct o.case_id) filter(where o.status='met')::int met_n,
      count(distinct o.case_id) filter(where o.status='not_met')::int not_met_n,
      avg(o.cost_growth) filter(where o.status='met') met_cost,avg(o.cost_growth) filter(where o.status='not_met') not_met_cost,
      avg(o.schedule_growth) filter(where o.status='met') met_schedule,avg(o.schedule_growth) filter(where o.status='not_met') not_met_schedule,
      avg(o.defects) filter(where o.status='met') met_defects,avg(o.defects) filter(where o.status='not_met') not_met_defects,
      avg(o.startup_reliability) filter(where o.status='met') met_reliability,avg(o.startup_reliability) filter(where o.status='not_met') not_met_reliability,
      corr((case when o.status='met' then 1 else 0 end)::numeric,o.cost_growth) cost_corr,
      corr((case when o.status='met' then 1 else 0 end)::numeric,o.schedule_growth) schedule_corr,
      corr((case when o.status='met' then 1 else 0 end)::numeric,o.defects) defects_corr,
      corr((case when o.status='met' then 1 else 0 end)::numeric,o.startup_reliability) reliability_corr
    from source_requirements sr left join observations o on o.criterion_id=sr.criterion_id
    group by sr.criterion_id,sr.gate_id,sr.stage_key,sr.gate_name,sr.criterion
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'criterionId',criterion_id,'gateId',gate_id,'stageKey',stage_key,'gateName',gate_name,'criterion',criterion,
      'metSample',met_n,'notMetSample',not_met_n,
      'means',jsonb_build_object(
        'met',jsonb_build_object('costGrowthPct',round(100*met_cost,1),'scheduleGrowthPct',round(100*met_schedule,1),'commissioningDefects',round(met_defects,1),'startupReliabilityPct',round(met_reliability,1)),
        'notMet',jsonb_build_object('costGrowthPct',round(100*not_met_cost,1),'scheduleGrowthPct',round(100*not_met_schedule,1),'commissioningDefects',round(not_met_defects,1),'startupReliabilityPct',round(not_met_reliability,1))),
      'correlations',jsonb_build_object('metVsCostGrowth',round(cost_corr::numeric,4),'metVsScheduleGrowth',round(schedule_corr::numeric,4),'metVsCommissioningDefects',round(defects_corr::numeric,4),'metVsStartupReliability',round(reliability_corr::numeric,4)),
      'associationNotCausation',true,'automaticMethodChange',false
    ) order by stage_key,gate_name,criterion) filter(where met_n>=v_min and not_met_n>=v_min),'[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(format('%s / %s / %s withheld: met=%s, not_met=%s; each cohort requires at least %s completed projects.',stage_key,gate_name,criterion,met_n,not_met_n,v_min)))
      filter(where met_n<v_min or not_met_n<v_min),'[]'::jsonb),
    count(*) filter(where met_n>=v_min and not_met_n>=v_min)::int
  into v_patterns,v_refusals,v_eligible_count from aggregate_patterns;

  if v_eligible_count=0 then
    if jsonb_array_length(v_refusals)=0 then
      v_refusals:=jsonb_build_array('No completed project has both a verified outcome and a latest met/not_met finding matching this framework. No relationship is claimed.');
    end if;
    insert into public.calculation_runs(organization_id,calculation_key,method,code_version,inputs,input_refs,outputs,refusals,status,computed_by)
    values(v_org,'methodology_outcome_analysis','Latest same-tenant gate finding per completed project joined to independently evidenced outcomes; point-biserial correlations with a hard two-cohort floor.',
      'd9.08-v1',jsonb_build_object('frameworkId',f.id,'frameworkName',f.name,'frameworkVersion',f.version,'minimumCohort',v_min),
      jsonb_build_array(jsonb_build_object('table','project_frameworks','id',f.id)),null,v_refusals,'refused',auth.uid()) returning id into v_run;
    return jsonb_build_object('calculationRunId',v_run,'status','refused','eligiblePatterns',0,'refusals',v_refusals,
      'associationNotCausation',true,'automaticMethodChange',false);
  end if;

  -- Snapshot every included observation, not merely aggregate numbers.
  with source_requirements as (
    select c.id criterion_id,c.criterion,g.stage_key,g.name gate_name from public.stage_gate_criteria c
    join public.stage_gates g on g.id=c.gate_id where g.framework_id=f.id
  ), observations as (
    select sr.criterion_id,dc.id case_id,le.id outcome_id,le.project_outcome_evidence_id,rv.id review_id,fi.id finding_id,fi.status,
      round(100*(le.project_actual_cost/le.project_baseline_cost-1),4) cost_growth_pct,
      round(100*(le.project_actual_duration_days/le.project_baseline_duration_days-1),4) schedule_growth_pct,
      le.commissioning_defects,le.startup_reliability_pct
    from source_requirements sr join public.development_cases dc on dc.organization_id=v_org and dc.status='completed'
    join public.project_frameworks used_f on used_f.id=dc.framework_id and used_f.organization_id=v_org and used_f.name=f.name
    join public.learning_events le on le.organization_id=v_org and le.development_case_id=dc.id and le.event_type='project_outcome'
    join public.evidence_items ei on ei.id=le.project_outcome_evidence_id and ei.organization_id=v_org and ei.verification_status='verified'
    join public.stage_gates used_g on used_g.framework_id=used_f.id and used_g.stage_key=sr.stage_key and lower(used_g.name)=lower(sr.gate_name)
    join lateral (select r.* from public.stage_gate_reviews r where r.organization_id=v_org and r.development_case_id=dc.id and r.gate_id=used_g.id order by r.reviewed_at desc,r.id desc limit 1) rv on true
    join public.stage_gate_findings fi on fi.organization_id=v_org and fi.review_id=rv.id and lower(btrim(fi.criterion_text))=lower(btrim(sr.criterion)) and fi.status in ('met','not_met')
  ) select coalesce(jsonb_agg(jsonb_build_object('table','stage_gate_findings','id',finding_id,'criterionId',criterion_id,'caseId',case_id,
      'reviewId',review_id,'status',status,'outcomeId',outcome_id,'evidenceItemId',project_outcome_evidence_id,
      'costGrowthPct',cost_growth_pct,'scheduleGrowthPct',schedule_growth_pct,'commissioningDefects',commissioning_defects,
      'startupReliabilityPct',startup_reliability_pct) order by criterion_id,case_id),'[]'::jsonb)
  into v_refs from observations;

  v_outputs:=jsonb_build_object('framework',jsonb_build_object('id',f.id,'name',f.name,'version',f.version),
    'minimumCohort',v_min,'criteria',v_patterns,'associationNotCausation',true,'automaticMethodChange',false,
    'decisionBoundary','Results are descriptive associations. A named human may propose a draft change; only human adoption can put a new framework version in force.');
  v_status:=case when jsonb_array_length(v_refusals)>0 then 'computed_with_refusals' else 'computed' end;
  insert into public.calculation_runs(organization_id,calculation_key,method,code_version,inputs,input_refs,outputs,refusals,status,computed_by)
  values(v_org,'methodology_outcome_analysis','Latest same-tenant gate finding per completed project joined to independently evidenced outcomes; point-biserial correlations with a hard two-cohort floor.',
    'd9.08-v1',jsonb_build_object('frameworkId',f.id,'frameworkName',f.name,'frameworkVersion',f.version,'minimumCohort',v_min),
    jsonb_build_array(jsonb_build_object('table','project_frameworks','id',f.id))||v_refs,v_outputs,v_refusals,v_status,auth.uid()) returning id into v_run;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'methodology_outcome_analysis',v_role,
    jsonb_build_object('calculation_run_id',v_run,'framework_id',f.id,'eligible_patterns',v_eligible_count,'association_not_causation',true,'automatic_method_change',false));
  return v_outputs||jsonb_build_object('calculationRunId',v_run,'status',v_status,'eligiblePatterns',v_eligible_count,'refusals',v_refusals);
exception when others then return jsonb_build_object('error',sqlerrm); end $$;
revoke all on function public.run_methodology_outcome_analysis(uuid,int) from public,anon;
grant execute on function public.run_methodology_outcome_analysis(uuid,int) to authenticated;

-- A proposal clones the canonical framework into a DRAFT and changes one
-- cloned requirement. It never adopts. The action and rationale are human
-- inputs, and the proposal retains the exact analysis run behind them.
create or replace function public.propose_methodology_improvement(
  p_calculation_run_id uuid,p_criterion_id bigint,p_action text,p_rationale text,
  p_is_mandatory boolean default null,p_evidence_type text default null,
  p_minimum_confidence numeric default null,p_guidance text default null,p_weight numeric default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; r public.calculation_runs%rowtype;
  sf public.project_frameworks%rowtype; sc public.stage_gate_criteria%rowtype; sg public.stage_gates%rowtype;
  v_pattern jsonb; v_version jsonb; v_new_framework uuid; v_new_criterion public.stage_gate_criteria%rowtype; v_set jsonb; v_proposal uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then return jsonb_build_object('error','forbidden'); end if;
  if coalesce(v_role,'')='ai_admin' then return jsonb_build_object('error','the AI-operator identity may compute associations but cannot choose a methodology change'); end if;
  if p_action not in ('simplify','strengthen') then return jsonb_build_object('error','action must be simplify or strengthen'); end if;
  if coalesce(length(btrim(p_rationale)),0)<20 then return jsonb_build_object('error','record the human rationale for this proposed change (20 characters minimum)'); end if;
  select * into r from public.calculation_runs where id=p_calculation_run_id and organization_id=v_org
    and calculation_key='methodology_outcome_analysis' and status in ('computed','computed_with_refusals');
  if not found then return jsonb_build_object('error','a same-tenant computed methodology analysis run is required'); end if;
  select value into v_pattern from jsonb_array_elements(r.outputs->'criteria') where (value->>'criterionId')::bigint=p_criterion_id;
  if v_pattern is null then return jsonb_build_object('error','the selected requirement did not meet both cohort floors in this analysis; no change may be proposed from withheld evidence'); end if;
  select * into sf from public.project_frameworks where id=(r.inputs->>'frameworkId')::uuid and organization_id=v_org and status='adopted';
  if not found then return jsonb_build_object('error','the analyzed framework is no longer the adopted source version'); end if;
  select c.* into sc from public.stage_gate_criteria c join public.stage_gates g on g.id=c.gate_id where c.id=p_criterion_id and g.framework_id=sf.id;
  if not found then return jsonb_build_object('error','source requirement not found on the analyzed framework'); end if;
  select * into sg from public.stage_gates where id=sc.gate_id;
  if exists(select 1 from public.framework_proposals where organization_id=v_org and calculation_run_id=r.id and target_criterion_id=sc.id and status='proposed') then
    return jsonb_build_object('error','this analysis already has an open proposal for that requirement');
  end if;
  if exists(select 1 from public.project_frameworks where organization_id=v_org and name=sf.name and status='draft') then
    return jsonb_build_object('error','a draft of this framework already exists; resolve it before creating another methodology-improvement version');
  end if;
  if p_minimum_confidence is not null and (p_minimum_confidence<0 or p_minimum_confidence>1) then return jsonb_build_object('error','minimum confidence is a fraction between 0 and 1'); end if;
  if p_weight is not null and p_weight<=0 then return jsonb_build_object('error','weight must be positive'); end if;

  v_version:=public.create_project_framework_version(sf.id);
  if v_version ? 'error' then raise exception '%',v_version->>'error'; end if;
  v_new_framework:=(v_version->>'framework_id')::uuid;
  select nc.* into v_new_criterion from public.stage_gate_criteria nc join public.stage_gates ng on ng.id=nc.gate_id
    where ng.framework_id=v_new_framework and ng.stage_key=sg.stage_key and ng.name=sg.name and nc.criterion=sc.criterion;
  if not found then raise exception 'version clone did not preserve the target requirement'; end if;
  v_set:=public.set_gate_requirement(v_new_criterion.gate_id,sc.criterion,coalesce(p_is_mandatory,sc.is_mandatory),sc.source_authority,
    sc.category,coalesce(nullif(btrim(coalesce(p_evidence_type,'')),''),sc.evidence_type),coalesce(p_minimum_confidence,sc.minimum_confidence),
    coalesce(nullif(btrim(coalesce(p_guidance,'')),''),sc.guidance),sc.sort_order,coalesce(p_weight,sc.weight));
  if v_set ? 'error' then raise exception '%',v_set->>'error'; end if;
  perform set_config('app.framework_proposal_write','granted',true);
  insert into public.framework_proposals(organization_id,document_id,framework_id,calculation_run_id,source_framework_id,target_criterion_id,
    improvement_action,human_rationale,agent_key,proposal,summary,proposed_by)
  values(v_org,null,v_new_framework,r.id,sf.id,sc.id,p_action,btrim(p_rationale),'sync-develop-methodology-learning',
    jsonb_build_object('action',p_action,'rationale',btrim(p_rationale),'analysisPattern',v_pattern,'before',jsonb_build_object(
      'isMandatory',sc.is_mandatory,'evidenceType',sc.evidence_type,'minimumConfidence',sc.minimum_confidence,'guidance',sc.guidance,'weight',sc.weight),
      'after',jsonb_build_object('isMandatory',coalesce(p_is_mandatory,sc.is_mandatory),'evidenceType',coalesce(nullif(btrim(coalesce(p_evidence_type,'')),''),sc.evidence_type),
      'minimumConfidence',coalesce(p_minimum_confidence,sc.minimum_confidence),'guidance',coalesce(nullif(btrim(coalesce(p_guidance,'')),''),sc.guidance),'weight',coalesce(p_weight,sc.weight))),
    format('%s requirement "%s" based on outcome analysis %s. Draft only; human adoption remains required.',initcap(p_action),sc.criterion,r.id),auth.uid()) returning id into v_proposal;
  perform set_config('app.framework_proposal_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'methodology_improvement_proposed',v_role,
    jsonb_build_object('proposal_id',v_proposal,'calculation_run_id',r.id,'source_framework_id',sf.id,'draft_framework_id',v_new_framework,
      'target_criterion_id',sc.id,'action',p_action,'adopted',false));
  return jsonb_build_object('proposalId',v_proposal,'frameworkId',v_new_framework,'version',v_version->'version','status','draft',
    'action',p_action,'adoptionRequired',true,'automaticMethodChange',false,
    'decisionBoundary','The proposal governs nothing. An administrator or executive must inspect and adopt the draft; the AI-operator identity is refused by the adoption function.');
exception when others then return jsonb_build_object('error',sqlerrm); end $$;
revoke all on function public.propose_methodology_improvement(uuid,bigint,text,text,boolean,text,numeric,text,numeric) from public,anon;
grant execute on function public.propose_methodology_improvement(uuid,bigint,text,text,boolean,text,numeric,text,numeric) to authenticated;

-- Extend the canonical shelf rather than adding a second approval screen/read.
create or replace function public.get_framework_shelf()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object(
    'proposals',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'summary',p.summary,'agentKey',p.agent_key,'model',p.model,'status',p.status,
      'withdrawnReason',p.withdrawn_reason,'createdAt',p.created_at,
      'proposedBy',(select coalesce(u.full_name,u.email) from public.user_profiles u where u.id=p.proposed_by),
      'document',(select d.title from public.kb_intake_documents d where d.id=p.document_id),'documentId',p.document_id,
      'analysisRunId',p.calculation_run_id,'sourceFrameworkId',p.source_framework_id,'targetCriterionId',p.target_criterion_id,
      'improvementAction',p.improvement_action,'humanRationale',p.human_rationale,
      'framework',jsonb_build_object('id',f.id,'name',f.name,'version',f.version,'status',f.status,'sourceAuthority',f.source_authority,
        'stages',(select count(*) from public.project_framework_stages s where s.framework_id=f.id),
        'gates',(select count(*) from public.stage_gates g where g.framework_id=f.id),
        'requirements',(select count(*) from public.stage_gate_criteria c join public.stage_gates g on g.id=c.gate_id where g.framework_id=f.id),
        'mandatoryRequirements',(select count(*) from public.stage_gate_criteria c join public.stage_gates g on g.id=c.gate_id where g.framework_id=f.id and c.is_mandatory),
        'independentAssuranceGates',(select count(*) from public.stage_gates g where g.framework_id=f.id and g.independent_assurance_required),
        'requirementTiers',coalesce((select jsonb_object_agg(x.source_authority,x.n) from (select c.source_authority,count(*) n from public.stage_gate_criteria c join public.stage_gates g on g.id=c.gate_id where g.framework_id=f.id group by c.source_authority)x),'{}'::jsonb),
        'willSupersede',(select jsonb_build_object('id',a.id,'name',a.name,'version',a.version,'sourceAuthority',a.source_authority,'adoptedAt',a.adopted_at) from public.project_frameworks a where a.organization_id=v_org and a.name=f.name and a.status='adopted' order by a.version desc limit 1))) order by p.created_at desc)
      from public.framework_proposals p join public.project_frameworks f on f.id=p.framework_id where p.organization_id=v_org),'[]'::jsonb),
    'drafts',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'version',f.version,'sourceAuthority',f.source_authority,
      'machineProposed',exists(select 1 from public.framework_proposals p where p.framework_id=f.id),
      'stages',(select count(*) from public.project_framework_stages s where s.framework_id=f.id),
      'gates',(select count(*) from public.stage_gates g where g.framework_id=f.id),
      'requirements',(select count(*) from public.stage_gate_criteria c join public.stage_gates g on g.id=c.gate_id where g.framework_id=f.id),
      'mandatoryRequirements',(select count(*) from public.stage_gate_criteria c join public.stage_gates g on g.id=c.gate_id where g.framework_id=f.id and c.is_mandatory),
      'independentAssuranceGates',(select count(*) from public.stage_gates g where g.framework_id=f.id and g.independent_assurance_required),
      'requirementTiers',coalesce((select jsonb_object_agg(x.source_authority,x.n) from (select c.source_authority,count(*) n from public.stage_gate_criteria c join public.stage_gates g on g.id=c.gate_id where g.framework_id=f.id group by c.source_authority)x),'{}'::jsonb),
      'willSupersede',(select jsonb_build_object('id',a.id,'name',a.name,'version',a.version,'sourceAuthority',a.source_authority,'adoptedAt',a.adopted_at) from public.project_frameworks a where a.organization_id=v_org and a.name=f.name and a.status='adopted' order by a.version desc limit 1)) order by f.name,f.version)
      from public.project_frameworks f where f.organization_id=v_org and f.status='draft'),'[]'::jsonb),
    'adopted',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'version',f.version,'sourceAuthority',f.source_authority,
      'adoptedAt',f.adopted_at,'adoptedBy',(select coalesce(u.full_name,u.email) from public.user_profiles u where u.id=f.adopted_by),
      'gates',(select count(*) from public.stage_gates g where g.framework_id=f.id)) order by f.name)
      from public.project_frameworks f where f.organization_id=v_org and f.status='adopted'),'[]'::jsonb));
end $$;
revoke all on function public.get_framework_shelf() from public,anon;
grant execute on function public.get_framework_shelf() to authenticated;

notify pgrst,'reload schema';

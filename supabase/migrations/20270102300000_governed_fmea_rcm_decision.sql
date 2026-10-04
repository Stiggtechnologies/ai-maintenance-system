-- ============================================================================
-- C7.09 / C8.06 — governed FMEA/FMECA and seven-question RCM decision logic.
--
-- Canonical reuse:
--   * asset_failure_mode_libraries remains the ONE failure-mode/FMECA store;
--   * asset_maintenance_strategy_recommendations remains the ONE strategy store;
--   * recommendation_approval_workflows remains the review queue;
--   * evidence_items, assets, user_profiles and audit_events remain authoritative.
--
-- A named reliability or maintenance human records an analysis. A different
-- named AAL2 human reviews it. Approval records an engineering disposition; it
-- never changes a maintenance plan, creates work, accepts risk, commits spend,
-- changes operating limits, or returns equipment to service.
-- ============================================================================

alter table public.asset_failure_mode_libraries
  add column if not exists function_statement text,
  add column if not exists functional_failure text,
  add column if not exists consequence_category text,
  add column if not exists consequence_rationale text,
  add column if not exists hidden_failure boolean,
  add column if not exists severity_rank text,
  add column if not exists occurrence_rank text,
  add column if not exists detectability_rank text,
  add column if not exists criticality_scale_reference text,
  add column if not exists criticality_basis text,
  add column if not exists rcm_status text,
  add column if not exists rcm_version integer,
  add column if not exists supersedes_failure_mode_id uuid
    references public.asset_failure_mode_libraries(id) on delete restrict,
  add column if not exists rcm_recorded_by uuid references auth.users(id) on delete restrict,
  add column if not exists rcm_reviewed_by uuid references auth.users(id) on delete restrict,
  add column if not exists rcm_reviewed_at timestamptz,
  add column if not exists rcm_review_note text;

alter table public.asset_failure_mode_libraries
  drop constraint if exists asset_failure_mode_rcm_consequence_check;
alter table public.asset_failure_mode_libraries
  add constraint asset_failure_mode_rcm_consequence_check check (
    consequence_category is null or consequence_category in
      ('hidden','safety','environmental','operational','non_operational')
  );
alter table public.asset_failure_mode_libraries
  drop constraint if exists asset_failure_mode_rcm_status_check;
alter table public.asset_failure_mode_libraries
  add constraint asset_failure_mode_rcm_status_check check (
    rcm_status is null or rcm_status in
      ('submitted','reviewed','rejected','superseded')
  );
alter table public.asset_failure_mode_libraries
  drop constraint if exists asset_failure_mode_fmeca_ranks_complete;
alter table public.asset_failure_mode_libraries
  add constraint asset_failure_mode_fmeca_ranks_complete check (
    (severity_rank is null and occurrence_rank is null and detectability_rank is null
      and criticality_scale_reference is null and criticality_basis is null)
    or
    (length(btrim(coalesce(severity_rank,'')))>0
      and length(btrim(coalesce(occurrence_rank,'')))>0
      and length(btrim(coalesce(detectability_rank,'')))>0
      and length(btrim(coalesce(criticality_scale_reference,'')))>=3
      and length(btrim(coalesce(criticality_basis,'')))>=10)
  );
create unique index if not exists uq_governed_rcm_failure_mode_version
  on public.asset_failure_mode_libraries(organization_id,canonical_asset_id,
    lower(function_statement),lower(functional_failure),lower(failure_mode),rcm_version)
  where source='governed_rcm';

alter table public.asset_maintenance_strategy_recommendations
  add column if not exists canonical_asset_id uuid references public.assets(id) on delete restrict,
  add column if not exists failure_mode_library_id uuid
    references public.asset_failure_mode_libraries(id) on delete restrict,
  add column if not exists strategy_type text,
  add column if not exists task_applicable boolean,
  add column if not exists task_effective boolean,
  add column if not exists applicability_basis text,
  add column if not exists effectiveness_basis text,
  add column if not exists default_action text,
  add column if not exists rcm_answers jsonb,
  add column if not exists evidence_item_ids uuid[] not null default '{}',
  add column if not exists strategy_version integer,
  add column if not exists supersedes_strategy_id uuid
    references public.asset_maintenance_strategy_recommendations(id) on delete restrict,
  add column if not exists proposed_by uuid references auth.users(id) on delete restrict,
  add column if not exists reviewed_by uuid references auth.users(id) on delete restrict,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

alter table public.asset_maintenance_strategy_recommendations
  drop constraint if exists asset_strategy_type_check;
alter table public.asset_maintenance_strategy_recommendations
  add constraint asset_strategy_type_check check (
    strategy_type is null or strategy_type in
      ('condition_based','failure_finding','time_based_restoration',
       'time_based_replacement','run_to_failure','redesign','one_time_change')
  );
alter table public.asset_maintenance_strategy_recommendations
  drop constraint if exists asset_strategy_default_action_check;
alter table public.asset_maintenance_strategy_recommendations
  add constraint asset_strategy_default_action_check check (
    default_action is null or default_action in
      ('failure_finding','run_to_failure','redesign','one_time_change')
  );
alter table public.asset_maintenance_strategy_recommendations
  drop constraint if exists asset_strategy_governed_status_check;
alter table public.asset_maintenance_strategy_recommendations
  add constraint asset_strategy_governed_status_check check (
    failure_mode_library_id is null or status in
      ('submitted','approved','rejected','superseded')
  );
create unique index if not exists uq_governed_rcm_strategy_version
  on public.asset_maintenance_strategy_recommendations(
    organization_id,failure_mode_library_id,strategy_version)
  where failure_mode_library_id is not null;

alter table public.recommendation_approval_workflows
  add column if not exists strategy_recommendation_id uuid
    references public.asset_maintenance_strategy_recommendations(id) on delete restrict,
  add column if not exists assigned_to uuid references auth.users(id) on delete restrict,
  add column if not exists created_by uuid references auth.users(id) on delete restrict,
  add column if not exists reviewed_by uuid references auth.users(id) on delete restrict,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;
create unique index if not exists uq_rcm_strategy_review
  on public.recommendation_approval_workflows(strategy_recommendation_id)
  where strategy_recommendation_id is not null;

create or replace function public.protect_governed_rcm_records()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_governed boolean;
begin
  v_governed := case tg_table_name
    when 'asset_failure_mode_libraries' then
      coalesce(case when tg_op='DELETE' then old.source else new.source end,'')='governed_rcm'
      or (tg_op='UPDATE' and coalesce(old.source,'')='governed_rcm')
    when 'asset_maintenance_strategy_recommendations' then
      (case when tg_op='DELETE' then old.failure_mode_library_id else new.failure_mode_library_id end) is not null
      or (tg_op='UPDATE' and old.failure_mode_library_id is not null)
    when 'recommendation_approval_workflows' then
      (case when tg_op='DELETE' then old.strategy_recommendation_id else new.strategy_recommendation_id end) is not null
      or (tg_op='UPDATE' and old.strategy_recommendation_id is not null)
    else false end;
  if v_governed and coalesce(current_setting('app.governed_rcm_write',true),'')<>'granted' then
    raise exception 'governed RCM records are written only through the controlled workflow';
  end if;
  if v_governed and tg_op='DELETE' then
    raise exception 'governed RCM records are retained; supersede them with a new version';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.protect_governed_rcm_records()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_protect_governed_rcm_failure_modes
  on public.asset_failure_mode_libraries;
create trigger trg_protect_governed_rcm_failure_modes
  before insert or update or delete on public.asset_failure_mode_libraries
  for each row execute function public.protect_governed_rcm_records();
drop trigger if exists trg_protect_governed_rcm_strategies
  on public.asset_maintenance_strategy_recommendations;
create trigger trg_protect_governed_rcm_strategies
  before insert or update or delete on public.asset_maintenance_strategy_recommendations
  for each row execute function public.protect_governed_rcm_records();
drop trigger if exists trg_protect_governed_rcm_reviews
  on public.recommendation_approval_workflows;
create trigger trg_protect_governed_rcm_reviews
  before insert or update or delete on public.recommendation_approval_workflows
  for each row execute function public.protect_governed_rcm_records();

create or replace function public.get_governed_rcm_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  return jsonb_build_object(
    'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'tag',a.tag,'name',a.name,'assetClass',a.asset_class,
      'criticality',a.criticality) order by coalesce(a.tag,a.name),a.name)
      from public.assets a where a.organization_id=v_org),'[]'::jsonb),
    'reviewers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'name',coalesce(nullif(p.full_name,''),p.email),'role',p.role)
      order by coalesce(nullif(p.full_name,''),p.email))
      from public.user_profiles p where p.organization_id=v_org
        and p.id<>auth.uid() and lower(coalesce(p.role,'')) in
          ('admin','maintenance_manager','reliability_engineer')),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'assetId',e.asset_id,'type',e.evidence_type,
      'class',e.evidence_class,'description',e.description,
      'sourceSystem',e.source_system,'verifiedBy',e.verified_by,
      'verifiedAt',e.verified_at,'verificationMethod',e.verification_method)
      order by e.verified_at desc nulls last,e.created_at desc)
      from public.evidence_items e where e.organization_id=v_org
        and e.verification_status='verified' and e.verified_by<>auth.uid()),'[]'::jsonb),
    'analyses',coalesce((select jsonb_agg(jsonb_build_object(
      'failureModeId',f.id,'assetId',f.canonical_asset_id,
      'functionStatement',f.function_statement,'functionalFailure',f.functional_failure,
      'failureMode',f.failure_mode,'effect',f.effect,
      'consequenceCategory',f.consequence_category,'hiddenFailure',f.hidden_failure,
      'status',f.rcm_status,'version',f.rcm_version,
      'recordedBy',f.rcm_recorded_by,'reviewedBy',f.rcm_reviewed_by,
      'reviewedAt',f.rcm_reviewed_at,'reviewNote',f.rcm_review_note,
      'strategy',jsonb_build_object(
        'id',s.id,'type',s.strategy_type,'taskApplicable',s.task_applicable,
        'taskEffective',s.task_effective,'defaultAction',s.default_action,
        'recommendation',s.recommendation,'status',s.status,
        'reviewerId',w.assigned_to,'reviewStatus',w.status),
      'evidenceItemIds',to_jsonb(f.evidence_item_ids))
      order by f.created_at desc)
      from public.asset_failure_mode_libraries f
      join public.asset_maintenance_strategy_recommendations s
        on s.failure_mode_library_id=f.id and s.organization_id=f.organization_id
      left join public.recommendation_approval_workflows w
        on w.strategy_recommendation_id=s.id and w.organization_id=s.organization_id
      where f.organization_id=v_org and f.source='governed_rcm'),'[]'::jsonb),
    'decisionBoundary',jsonb_build_object(
      'recordsEngineeringDisposition',true,'changesMaintenancePlan',false,
      'createsWork',false,'acceptsRisk',false,'commitsSpend',false,
      'changesOperatingLimits',false,'returnsToService',false,
      'approvalRequiresAal','aal2','segregationOfDuties',true)
  );
end $$;
revoke all on function public.get_governed_rcm_workspace() from public,anon;
grant execute on function public.get_governed_rcm_workspace() to authenticated;

create or replace function public.submit_governed_rcm_analysis(
  p_asset_id uuid,p_answers jsonb,p_evidence_item_ids uuid[],p_reviewer_id uuid,
  p_supersedes_failure_mode_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role(); v_asset public.assets%rowtype;
  v_function text; v_functional_failure text; v_failure_mode text; v_effect text;
  v_consequence text; v_consequence_basis text; v_task text; v_default text;
  v_applicable boolean; v_effective boolean; v_hidden boolean;
  v_applicable_basis text; v_effective_basis text; v_recommendation text;
  v_fm_version integer:=1; v_strategy_version integer:=1;
  v_failure_id uuid; v_strategy_id uuid; v_review_id uuid; v_evidence uuid[];
  v_old_strategy_id uuid;
  v_has_fmeca boolean;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','authentication required'); end if;
  if v_role not in ('admin','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','RCM submission requires a named reliability engineer, maintenance manager or administrator');
  end if;
  select * into v_asset from public.assets where id=p_asset_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','asset not found in this organization'); end if;
  if jsonb_typeof(coalesce(p_answers,'null'::jsonb))<>'object' then
    return jsonb_build_object('error','the seven RCM answers must be an object');
  end if;
  v_function:=btrim(coalesce(p_answers->>'functionStatement',''));
  v_functional_failure:=btrim(coalesce(p_answers->>'functionalFailure',''));
  v_failure_mode:=btrim(coalesce(p_answers->>'failureMode',''));
  v_effect:=btrim(coalesce(p_answers->>'failureEffect',''));
  v_consequence:=coalesce(p_answers->>'consequenceCategory','');
  v_consequence_basis:=btrim(coalesce(p_answers->>'consequenceRationale',''));
  v_hidden:=case when p_answers ? 'hiddenFailure' then (p_answers->>'hiddenFailure')::boolean else null end;
  v_task:=coalesce(p_answers->>'proposedTask','none');
  v_applicable:=case when p_answers ? 'taskApplicable' then (p_answers->>'taskApplicable')::boolean else null end;
  v_effective:=case when p_answers ? 'taskEffective' then (p_answers->>'taskEffective')::boolean else null end;
  v_applicable_basis:=btrim(coalesce(p_answers->>'applicabilityBasis',''));
  v_effective_basis:=btrim(coalesce(p_answers->>'effectivenessBasis',''));
  v_default:=nullif(coalesce(p_answers->>'defaultAction',''),'');
  if length(v_function)<10 or length(v_functional_failure)<10
     or length(v_failure_mode)<5 or length(v_effect)<10 then
    return jsonb_build_object('error','questions 1–4 require a function, functional failure, failure mode and effect with engineering detail');
  end if;
  if v_consequence not in ('hidden','safety','environmental','operational','non_operational')
     or length(v_consequence_basis)<10 or v_hidden is null then
    return jsonb_build_object('error','question 5 requires an explicit consequence category, rationale and hidden-failure determination');
  end if;
  if v_task not in ('none','condition_based','failure_finding','time_based_restoration','time_based_replacement') then
    return jsonb_build_object('error','question 6 contains an unsupported proactive task');
  end if;
  if v_task<>'none' and (v_applicable is null or v_effective is null
      or length(v_applicable_basis)<10 or length(v_effective_basis)<10) then
    return jsonb_build_object('error','question 6 requires explicit applicable-and-effective determinations with bases');
  end if;
  if v_task<>'none' and v_applicable and v_effective then
    if v_default is not null then return jsonb_build_object('error','a default action is only used when no proactive task is applicable and effective'); end if;
  else
    if v_default not in ('failure_finding','run_to_failure','redesign','one_time_change') then
      return jsonb_build_object('error','question 7 requires an explicit default action when no proactive task is applicable and effective');
    end if;
    if v_consequence in ('safety','environmental') and v_default='run_to_failure' then
      return jsonb_build_object('error','run-to-failure is refused for safety or environmental consequences');
    end if;
    if v_hidden and v_default not in ('failure_finding','redesign','one_time_change') then
      return jsonb_build_object('error','a hidden failure requires failure-finding or a design/change default action');
    end if;
  end if;
  if not exists(select 1 from public.user_profiles p where p.id=p_reviewer_id
      and p.organization_id=v_org and p.id<>v_actor and lower(coalesce(p.role,'')) in
      ('admin','maintenance_manager','reliability_engineer')) then
    return jsonb_build_object('error','assign a different named same-tenant reliability, maintenance or administrator reviewer');
  end if;
  select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into v_evidence
  from unnest(coalesce(p_evidence_item_ids,'{}'::uuid[])) x;
  if cardinality(v_evidence)=0 then return jsonb_build_object('error','at least one verified asset evidence item is required'); end if;
  if cardinality(v_evidence)<>cardinality(coalesce(p_evidence_item_ids,'{}'::uuid[]))
     or exists(select 1 from unnest(v_evidence) x where not exists(
       select 1 from public.evidence_items e where e.id=x and e.organization_id=v_org
         and e.asset_id=p_asset_id and e.verification_status='verified'
         and e.verified_by<>v_actor)) then
    return jsonb_build_object('error','evidence must be unique, independently verified, same-tenant and applicable to the selected asset');
  end if;
  v_has_fmeca := coalesce(p_answers->>'severityRank','')<>''
    or coalesce(p_answers->>'occurrenceRank','')<>''
    or coalesce(p_answers->>'detectabilityRank','')<>'';
  if v_has_fmeca and (coalesce(p_answers->>'severityRank','')=''
      or coalesce(p_answers->>'occurrenceRank','')=''
      or coalesce(p_answers->>'detectabilityRank','')=''
      or length(btrim(coalesce(p_answers->>'criticalityScaleReference','')))<3
      or length(btrim(coalesce(p_answers->>'criticalityBasis','')))<10) then
    return jsonb_build_object('error','FMECA ranking requires severity, occurrence, detectability, a named scale and a criticality basis; SyncAI does not invent a scale or RPN');
  end if;
  if p_supersedes_failure_mode_id is not null then
    select f.rcm_version+1 into v_fm_version from public.asset_failure_mode_libraries f
    where f.id=p_supersedes_failure_mode_id and f.organization_id=v_org
      and f.canonical_asset_id=p_asset_id and f.source='governed_rcm'
      and f.rcm_status in ('reviewed','rejected');
    if v_fm_version is null then return jsonb_build_object('error','only a reviewed or rejected same-asset governed analysis can be superseded'); end if;
    select s.id,coalesce(s.strategy_version,0)+1 into v_old_strategy_id,v_strategy_version
    from public.asset_maintenance_strategy_recommendations s
    where s.failure_mode_library_id=p_supersedes_failure_mode_id and s.organization_id=v_org
    order by s.strategy_version desc nulls last limit 1;
  end if;
  v_recommendation:=case
    when v_task<>'none' and v_applicable and v_effective then v_task
    else v_default end;
  perform set_config('app.governed_rcm_write','granted',true);
  if p_supersedes_failure_mode_id is not null then
    update public.asset_failure_mode_libraries set rcm_status='superseded',updated_at=now()
    where id=p_supersedes_failure_mode_id and organization_id=v_org;
    update public.asset_maintenance_strategy_recommendations set status='superseded'
    where failure_mode_library_id=p_supersedes_failure_mode_id and organization_id=v_org;
  end if;
  insert into public.asset_failure_mode_libraries(
    organization_id,asset_id,canonical_asset_id,failure_mode,effect,consequence,
    source,evidence_item_ids,function_statement,functional_failure,
    consequence_category,consequence_rationale,hidden_failure,severity_rank,
    occurrence_rank,detectability_rank,criticality_scale_reference,criticality_basis,
    rcm_status,rcm_version,supersedes_failure_mode_id,rcm_recorded_by)
  values(v_org,coalesce(v_asset.tag,v_asset.name),v_asset.id,v_failure_mode,v_effect,
    v_consequence_basis,'governed_rcm',v_evidence,v_function,v_functional_failure,
    v_consequence,v_consequence_basis,v_hidden,nullif(btrim(p_answers->>'severityRank'),''),
    nullif(btrim(p_answers->>'occurrenceRank'),''),nullif(btrim(p_answers->>'detectabilityRank'),''),
    nullif(btrim(p_answers->>'criticalityScaleReference'),''),nullif(btrim(p_answers->>'criticalityBasis'),''),
    'submitted',v_fm_version,p_supersedes_failure_mode_id,v_actor)
  returning id into v_failure_id;
  insert into public.asset_maintenance_strategy_recommendations(
    organization_id,asset_id,canonical_asset_id,failure_mode_library_id,
    recommendation,failure_mode_addressed,risk_reduced,evidence_used,assumptions,
    confidence,required_approval,status,strategy_type,task_applicable,task_effective,
    applicability_basis,effectiveness_basis,default_action,rcm_answers,
    evidence_item_ids,strategy_version,supersedes_strategy_id,proposed_by)
  values(v_org,coalesce(v_asset.tag,v_asset.name),v_asset.id,v_failure_id,
    'RCM disposition: '||replace(v_recommendation,'_',' '),v_failure_mode,
    v_consequence_basis,to_jsonb(v_evidence),'[]'::jsonb,'human_review_required',
    'Independent named-human RCM review','submitted',v_recommendation,v_applicable,
    v_effective,nullif(v_applicable_basis,''),nullif(v_effective_basis,''),v_default,
    p_answers,v_evidence,v_strategy_version,v_old_strategy_id,v_actor)
  returning id into v_strategy_id;
  insert into public.recommendation_approval_workflows(
    organization_id,asset_id,approval_reason,owner_role,status,
    consequence_of_being_wrong,required_validation,strategy_recommendation_id,
    assigned_to,created_by)
  values(v_org,coalesce(v_asset.tag,v_asset.name),
    'Independent review of the seven-question RCM decision and its evidence',
    'Reliability Engineer','required',
    'An incorrect strategy can increase safety, environmental, production, cost or hidden-function risk.',
    'Re-read the exact asset evidence and all seven answers; confirm consequence and applicable/effective logic.',
    v_strategy_id,p_reviewer_id,v_actor)
  returning id into v_review_id;
  perform set_config('app.governed_rcm_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'governed_rcm_analysis',v_role,jsonb_build_object(
    'action','submitted','failure_mode_id',v_failure_id,'strategy_id',v_strategy_id,
    'review_id',v_review_id,'asset_id',p_asset_id,'reviewer_id',p_reviewer_id,
    'evidence_item_ids',to_jsonb(v_evidence),'version',v_fm_version,
    'strategy',v_recommendation,'advisory',true));
  return jsonb_build_object('failureModeId',v_failure_id,'strategyId',v_strategy_id,
    'reviewId',v_review_id,'status','submitted','version',v_fm_version,
    'strategy',v_recommendation,'advisory',true,
    'changesMaintenancePlan',false,'createsWork',false,'acceptsRisk',false,
    'commitsSpend',false,'changesOperatingLimits',false,'returnsToService',false);
exception when invalid_text_representation then
  return jsonb_build_object('error','one of the seven RCM answers has an invalid boolean value');
end $$;
revoke all on function public.submit_governed_rcm_analysis(uuid,jsonb,uuid[],uuid,uuid)
  from public,anon;
grant execute on function public.submit_governed_rcm_analysis(uuid,jsonb,uuid[],uuid,uuid)
  to authenticated;

create or replace function public.review_governed_rcm_analysis(
  p_strategy_id uuid,p_disposition text,p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role(); s public.asset_maintenance_strategy_recommendations%rowtype;
  f public.asset_failure_mode_libraries%rowtype; w public.recommendation_approval_workflows%rowtype;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','authentication required'); end if;
  if v_role not in ('admin','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','RCM review requires a named reliability engineer, maintenance manager or administrator');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor) or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','RCM disposition requires a verified factor and an AAL2 session');
  end if;
  if p_disposition not in ('approved','rejected') or length(btrim(coalesce(p_note,'')))<20 then
    return jsonb_build_object('error','record approved or rejected with a review note of at least 20 characters');
  end if;
  select * into s from public.asset_maintenance_strategy_recommendations
  where id=p_strategy_id and organization_id=v_org and status='submitted' for update;
  if not found then return jsonb_build_object('error','submitted RCM strategy not found in this organization'); end if;
  select * into f from public.asset_failure_mode_libraries
  where id=s.failure_mode_library_id and organization_id=v_org and rcm_status='submitted' for update;
  if not found then return jsonb_build_object('error','submitted canonical failure-mode analysis not found'); end if;
  select * into w from public.recommendation_approval_workflows
  where strategy_recommendation_id=s.id and organization_id=v_org and status='required' for update;
  if not found or w.assigned_to<>v_actor then return jsonb_build_object('error','this named human is not assigned to review the analysis'); end if;
  if s.proposed_by=v_actor or f.rcm_recorded_by=v_actor then
    return jsonb_build_object('error','segregation of duties requires review by a different named human');
  end if;
  if exists(select 1 from unnest(f.evidence_item_ids) x where not exists(
    select 1 from public.evidence_items e where e.id=x and e.organization_id=v_org
      and e.asset_id=f.canonical_asset_id and e.verification_status='verified'
      and e.verified_by<>f.rcm_recorded_by)) then
    return jsonb_build_object('error','the exact evidence set is no longer verified and applicable to this asset');
  end if;
  if p_disposition='approved' and s.strategy_type='run_to_failure'
     and f.consequence_category in ('safety','environmental') then
    return jsonb_build_object('error','run-to-failure remains refused for safety or environmental consequences');
  end if;
  perform set_config('app.governed_rcm_write','granted',true);
  update public.asset_maintenance_strategy_recommendations
  set status=p_disposition,reviewed_by=v_actor,reviewed_at=now(),review_note=btrim(p_note)
  where id=s.id;
  update public.asset_failure_mode_libraries
  set rcm_status=case when p_disposition='approved' then 'reviewed' else 'rejected' end,
      rcm_reviewed_by=v_actor,rcm_reviewed_at=now(),rcm_review_note=btrim(p_note),updated_at=now()
  where id=f.id;
  update public.recommendation_approval_workflows
  set status=p_disposition,reviewed_by=v_actor,reviewed_at=now(),review_note=btrim(p_note)
  where id=w.id;
  perform set_config('app.governed_rcm_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'governed_rcm_analysis',v_role,jsonb_build_object(
    'action',p_disposition,'failure_mode_id',f.id,'strategy_id',s.id,
    'review_id',w.id,'asset_id',f.canonical_asset_id,'reviewed_by',v_actor,
    'aal','aal2','verified_factor',true,'note',btrim(p_note),
    'engineeringDispositionOnly',true,'changesMaintenancePlan',false,
    'createsWork',false,'acceptsRisk',false,'commitsSpend',false,
    'changesOperatingLimits',false,'returnsToService',false));
  return jsonb_build_object('failureModeId',f.id,'strategyId',s.id,
    'status',p_disposition,'reviewedBy',v_actor,'engineeringDispositionOnly',true,
    'changesMaintenancePlan',false,'createsWork',false,'acceptsRisk',false,
    'commitsSpend',false,'changesOperatingLimits',false,'returnsToService',false);
end $$;
revoke all on function public.review_governed_rcm_analysis(uuid,text,text)
  from public,anon;
grant execute on function public.review_governed_rcm_analysis(uuid,text,text)
  to authenticated;

comment on function public.submit_governed_rcm_analysis(uuid,jsonb,uuid[],uuid,uuid) is
  'C7.09/C8.06: versioned, evidence-bound seven-question RCM submission over canonical FMEA and strategy stores. It records no operational authority.';
comment on function public.review_governed_rcm_analysis(uuid,text,text) is
  'C7.09/C8.06: independent AAL2 engineering disposition. Approval does not change the maintenance programme or authorize work, risk, spend, operation or return to service.';

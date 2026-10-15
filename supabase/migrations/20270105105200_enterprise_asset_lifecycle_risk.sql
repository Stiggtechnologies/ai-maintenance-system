-- C6.05 — governed enterprise asset lifecycle risk.
--
-- Canonical composition only. This migration creates no second risk score,
-- lifecycle record, condition store, economic register or decision object. It
-- reads the records that already own those facts:
--   * assets + asset_lifecycle_state + lifecycle_stages;
--   * ISO 31000 risks + risk_criteria_profiles;
--   * verified asset_condition_assessments;
--   * governed asset_economics;
--   * lifecycle_evaluations.
--
-- The Asset Risk Index is deliberately harder to publish than to calculate.
-- Every registered asset must have a current lifecycle state and at least one
-- complete, current asset-linked threat assessment. Every open threat record
-- must be evaluated under the SAME adopted criteria profile and have a review
-- date that has not passed. Only then is each asset's highest RECORDED current
-- score averaged across the asset population. No cross-profile score is
-- averaged, no missing score becomes zero, and assets.risk_score remains
-- ignored because it has no governed writer.

-- The original whole-life migration made lifecycle state readable and
-- supplied a database transition function, but no customer-reachable product
-- path could establish the first state. Close that gap on the canonical table
-- rather than inventing a second lifecycle register. Initial state requires a
-- named, assured human and independently verified asset-specific evidence.
alter table public.asset_lifecycle_state
  add column if not exists basis_evidence_item_id uuid
    references public.evidence_items(id) on delete restrict;

create or replace function public.guard_asset_lifecycle_state_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  -- Preserve the asset foreign-key cascade while refusing direct deletion of
  -- a live asset's state, including service-role/PostgREST mutation.
  if tg_op='DELETE' and not exists(
    select 1 from public.assets where id=old.asset_id
  ) then return old; end if;
  if coalesce(current_setting('app.asset_lifecycle_state_writer',true),'')<>'governed' then
    raise exception 'asset lifecycle state is RPC-only';
  end if;
  if tg_op='UPDATE' and (new.asset_id<>old.asset_id
      or new.organization_id<>old.organization_id) then
    raise exception 'asset lifecycle identity and tenant are immutable';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_asset_lifecycle_state_write
  on public.asset_lifecycle_state;
create trigger trg_guard_asset_lifecycle_state_write
  before insert or update or delete on public.asset_lifecycle_state
  for each row execute function public.guard_asset_lifecycle_state_write();

revoke all on function public.guard_asset_lifecycle_state_write()
  from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.asset_lifecycle_state
  from anon,authenticated,service_role;

-- Keep the established transition contract, but place its owner-powered write
-- behind the same guard and assurance wall. Its existing stage-gate logic is
-- unchanged inside the renamed internal implementation.
alter function public.advance_lifecycle_stage(uuid,text,text)
  rename to advance_lifecycle_stage_internal;
revoke all on function public.advance_lifecycle_stage_internal(uuid,text,text)
  from public,anon,authenticated,service_role;

create or replace function public.advance_lifecycle_stage(
  p_asset_id uuid,
  p_to_stage text,
  p_reason text default null
)
returns table(outcome text,detail text)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
begin
  if public.app_current_org() is null or v_actor is null
     or v_role='ai_admin'
     or v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return query select 'error'::text,
      'A named lifecycle authority is required.'::text;
    return;
  end if;
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal()<>'aal2' then
    return query select 'error'::text,
      'Lifecycle movement requires a verified factor and an AAL2 session.'::text;
    return;
  end if;
  if length(btrim(coalesce(p_reason,'')))<20 then
    return query select 'error'::text,
      'State a lifecycle movement basis of at least 20 characters.'::text;
    return;
  end if;
  if not exists(select 1 from public.asset_lifecycle_state
    where asset_id=p_asset_id and organization_id=public.app_current_org()) then
    return query select 'error'::text,
      'Initial lifecycle state requires the evidence-backed initial-state workflow.'::text;
    return;
  end if;
  perform set_config('app.asset_lifecycle_state_writer','governed',true);
  return query select * from public.advance_lifecycle_stage_internal(
    p_asset_id,p_to_stage,p_reason
  );
  perform set_config('app.asset_lifecycle_state_writer','',true);
exception when others then
  perform set_config('app.asset_lifecycle_state_writer','',true);
  raise;
end $$;

revoke all on function public.advance_lifecycle_stage(uuid,text,text)
  from public,anon,service_role;
grant execute on function public.advance_lifecycle_stage(uuid,text,text)
  to authenticated;

create or replace function public.record_initial_asset_lifecycle_state(
  p_asset_id uuid,
  p_stage_key text,
  p_evidence_item_id uuid,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
  v_verifier uuid;
begin
  if v_org is null or v_actor is null or v_role='ai_admin'
     or v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error',
      'A named administrator, executive, maintenance manager or reliability engineer is required');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error',
      'Initial lifecycle state requires a verified factor and an AAL2 session');
  end if;
  if length(btrim(coalesce(p_basis,''))) not between 20 and 4000 then
    return jsonb_build_object('error',
      'State a bounded lifecycle basis of 20 to 4000 characters');
  end if;
  perform 1 from public.assets
    where id=p_asset_id and organization_id=v_org for update;
  if not found then
    return jsonb_build_object('error','Asset scope is outside the active tenant');
  end if;
  if not exists(select 1 from public.lifecycle_stages where stage_key=p_stage_key) then
    return jsonb_build_object('error','Unknown canonical lifecycle stage');
  end if;
  if exists(select 1 from public.asset_lifecycle_state
    where asset_id=p_asset_id and organization_id=v_org) then
    return jsonb_build_object('error',
      'Lifecycle state already exists; use the governed stage-transition workflow');
  end if;
  select e.verified_by into v_verifier
  from public.evidence_items e
  join public.user_profiles verifier
    on verifier.id=e.verified_by and verifier.organization_id=v_org
      and verifier.role<>'ai_admin'
  where e.id=p_evidence_item_id and e.organization_id=v_org
    and e.asset_id=p_asset_id and e.verification_status='verified'
    and e.verified_by is not null and e.verified_at is not null
    and e.verified_by<>v_actor;
  if v_verifier is null then
    return jsonb_build_object('error',
      'Initial lifecycle state requires same-tenant, asset-specific canonical evidence independently verified by another named human');
  end if;

  perform set_config('app.asset_lifecycle_state_writer','governed',true);
  insert into public.asset_lifecycle_state(
    asset_id,organization_id,stage_key,entered_at,inherited,note,
    basis_evidence_item_id,updated_at
  ) values(
    p_asset_id,v_org,p_stage_key,now(),false,btrim(p_basis),
    p_evidence_item_id,now()
  );
  perform set_config('app.asset_lifecycle_state_writer','',true);

  insert into public.asset_lifecycle_transitions(
    organization_id,asset_id,from_stage,to_stage,moved_by,reason
  ) values(v_org,p_asset_id,null,p_stage_key,v_actor,btrim(p_basis));
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_lifecycle_state',v_role,jsonb_build_object(
    'event','initial_lifecycle_state_recorded','asset_id',p_asset_id,
    'stage_key',p_stage_key,'evidence_item_id',p_evidence_item_id,
    'recorded_by',v_actor,'independent_verifier',v_verifier,
    'aal','aal2','verified_factor',true,'operational_authority',false));

  return jsonb_build_object('assetId',p_asset_id,'stageKey',p_stage_key,
    'evidenceItemId',p_evidence_item_id,'recordedBy',v_actor,
    'independentVerifier',v_verifier,'operationalAuthority',false);
exception when others then
  perform set_config('app.asset_lifecycle_state_writer','',true);
  raise;
end $$;

revoke all on function public.record_initial_asset_lifecycle_state(uuid,text,uuid,text)
  from public,anon,service_role;
grant execute on function public.record_initial_asset_lifecycle_state(uuid,text,uuid,text)
  to authenticated;

create or replace function public.get_initial_asset_lifecycle_state_options()
returns jsonb
language plpgsql
stable
security invoker
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
begin
  if v_org is null or v_actor is null then
    return jsonb_build_object('error','forbidden');
  end if;
  if v_role='ai_admin' or v_role not in
    ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('canRecord',false,'requiredAal','aal2',
      'assets','[]'::jsonb,'stages','[]'::jsonb,'evidence','[]'::jsonb);
  end if;
  return jsonb_build_object(
    'canRecord',true,'requiredAal','aal2',
    'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'tag',coalesce(a.asset_tag,a.tag)) order by a.name)
      from public.assets a where a.organization_id=v_org and not exists(
        select 1 from public.asset_lifecycle_state s where s.asset_id=a.id
      )),'[]'::jsonb),
    'stages',coalesce((select jsonb_agg(jsonb_build_object(
      'stageKey',s.stage_key,'label',s.label,'phase',s.phase,
      'decisionOwned',s.decision_owned) order by s.stage_order)
      from public.lifecycle_stages s),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'assetId',e.asset_id,'description',e.description,
      'sourceSystem',e.source_system,'evidenceClass',e.evidence_class,
      'verifiedAt',e.verified_at) order by e.verified_at desc)
      from public.evidence_items e
      join public.user_profiles verifier on verifier.id=e.verified_by
        and verifier.organization_id=v_org and verifier.role<>'ai_admin'
      where e.organization_id=v_org and e.asset_id is not null
        and e.verification_status='verified' and e.verified_at is not null
        and e.verified_by<>v_actor and not exists(
          select 1 from public.asset_lifecycle_state s where s.asset_id=e.asset_id
        )),'[]'::jsonb));
end $$;

revoke all on function public.get_initial_asset_lifecycle_state_options()
  from public,anon,service_role;
grant execute on function public.get_initial_asset_lifecycle_state_options()
  to authenticated;

create or replace function public.sync_enterprise_asset_lifecycle_risk(
  p_organization_id uuid,
  p_detail_role text default null
)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with tenant_assets as (
    select a.id,a.name,coalesce(a.asset_tag,a.tag) tag,a.site_id,s.name site_name,
      a.asset_class,a.criticality,a.lifecycle_status
    from public.assets a
    left join public.sites s on s.id=a.site_id
      and s.organization_id=p_organization_id
    where a.organization_id=p_organization_id
  ), lifecycle as (
    select l.asset_id,l.stage_key,st.label stage_label,st.phase,
      l.entered_at,l.expected_exit,l.inherited,l.basis_evidence_item_id
    from public.asset_lifecycle_state l
    join public.lifecycle_stages st on st.stage_key=l.stage_key
    where l.organization_id=p_organization_id
  ), active_risks_raw as (
    select r.*,c.name criteria_name,c.version criteria_version,
      c.status criteria_status,public.risk_contract_gaps(r) contract_gaps
    from public.risks r
    left join public.risk_criteria_profiles c
      on c.id=r.criteria_profile_id
      and c.organization_id=p_organization_id
    where r.organization_id=p_organization_id
      and r.asset_id is not null
      and r.kind in ('threat','both')
      and r.status not in ('closed','archived')
  ), active_risks as (
    select r.*,
      (r.status in ('evaluated','treatment_active','monitoring')
        and r.criteria_status='adopted'
        and r.current_risk_score is not null
        and r.current_risk_level is not null
        and coalesce(cardinality(r.contract_gaps),0)=0) contract_complete,
      (r.review_date is not null and r.review_date>=current_date) review_current
    from active_risks_raw r
  ), qualifying_risks as (
    select r.* from active_risks r
    where r.contract_complete and r.review_current
  ), asset_scores as (
    select r.asset_id,max(r.current_risk_score) asset_score
    from qualifying_risks r
    group by r.asset_id
  ), portfolio as (
    select
      (select count(*)::int from tenant_assets) total_assets,
      (select count(*)::int from tenant_assets a
        where not exists(select 1 from lifecycle l where l.asset_id=a.id))
        assets_without_current_lifecycle,
      (select count(*)::int from tenant_assets a
        where not exists(select 1 from qualifying_risks r where r.asset_id=a.id))
        assets_without_current_risk,
      (select count(*)::int from active_risks) open_risk_records,
      (select count(*)::int from active_risks r where r.contract_complete)
        contracted_risk_records,
      (select count(*)::int from active_risks r where not r.contract_complete)
        incomplete_risk_records,
      (select count(*)::int from active_risks r
        where r.contract_complete and not r.review_current)
        stale_or_undated_risk_records,
      (select count(distinct r.criteria_profile_id)::int from active_risks r)
        distinct_criteria_profiles,
      (select count(*)::int from tenant_assets a where exists(
        select 1 from public.asset_condition_assessments ca
        where ca.organization_id=p_organization_id and ca.asset_id=a.id
          and ca.status='verified'
          and (ca.valid_through is null or ca.valid_through>=now())
      )) assets_with_verified_condition,
      (select count(*)::int from tenant_assets a where exists(
        select 1 from public.asset_economics e
        where e.organization_id=p_organization_id
          and (e.asset_id=a.id or (e.asset_id is null and e.asset_class=a.asset_class))
          and (e.review_due is null or e.review_due>=current_date)
      )) assets_with_current_economics,
      (select count(*)::int from tenant_assets a where exists(
        select 1 from public.lifecycle_evaluations e
        where e.organization_id=p_organization_id and e.asset_id=a.id
      )) assets_with_lifecycle_evaluation,
      (select round(avg(asset_score),1) from asset_scores) index_value
  ), decision as (
    select p.*,
      (p.total_assets>0
        and p.assets_without_current_lifecycle=0
        and p.assets_without_current_risk=0
        and p.open_risk_records>0
        and p.incomplete_risk_records=0
        and p.stale_or_undated_risk_records=0
        and p.distinct_criteria_profiles=1) index_computable
    from portfolio p
  ), asset_detail as (
    select a.*,l.stage_key,l.stage_label,l.phase,l.entered_at,
      l.expected_exit,l.inherited,l.basis_evidence_item_id,
      ca.id condition_id,ca.knowledge_state condition_knowledge_state,
      ca.status condition_status,ca.valid_through condition_valid_through,
      ca.verified_at condition_verified_at,
      ae.id economics_id,ae.version economics_version,
      ae.review_due economics_review_due,
      ae.evidence_item_id economics_evidence_item_id,
      le.id lifecycle_evaluation_id,le.recommended lifecycle_recommended,
      le.uncertainty_level lifecycle_uncertainty,le.decision lifecycle_decision,
      le.evaluated_at lifecycle_evaluated_at,
      score.asset_score
    from tenant_assets a
    left join lifecycle l on l.asset_id=a.id
    left join lateral (
      select c.* from public.asset_condition_assessments c
      where c.organization_id=p_organization_id and c.asset_id=a.id
        and c.status in ('draft','verified')
      order by c.assessed_at desc limit 1
    ) ca on true
    left join lateral (
      select e.* from public.asset_economics e
      where e.organization_id=p_organization_id
        and (e.asset_id=a.id or (e.asset_id is null and e.asset_class=a.asset_class))
      order by (e.asset_id is not null) desc,e.updated_at desc limit 1
    ) ae on true
    left join lateral (
      select e.* from public.lifecycle_evaluations e
      where e.organization_id=p_organization_id and e.asset_id=a.id
      order by e.evaluated_at desc limit 1
    ) le on true
    left join asset_scores score on score.asset_id=a.id
  )
  select jsonb_build_object(
    'detailAccess',p_detail_role is not null,
    'detailRestriction',case when p_detail_role is null then
      'Aggregate lifecycle-risk posture only for this role; exact asset risk evidence requires an executive, administrator, maintenance manager or reliability engineer role.'
      else null end,
    'index',jsonb_build_object(
      'indexComputable',d.index_computable,
      'value',case when d.index_computable then d.index_value end,
      'unit','score',
      'formula','Mean of each registered asset''s highest recorded current risk score under one adopted criteria profile.',
      'basis',case when d.index_computable then
        'Every registered asset has a current lifecycle state and a complete, current threat assessment under one adopted criteria profile.'
        else 'No enterprise index is published until lifecycle coverage, risk-contract completeness, one adopted criteria profile and current review dates are complete. No cross-profile score is averaged and missing values never become zero.' end,
      'criteriaProfile',case when d.distinct_criteria_profiles=1 then (
        select jsonb_build_object('id',r.criteria_profile_id,'name',r.criteria_name,
          'version',r.criteria_version,'status',r.criteria_status)
        from active_risks r where r.criteria_profile_id is not null limit 1
      ) end
    ),
    'coverage',jsonb_build_object(
      'assets',d.total_assets,
      'assetsWithoutCurrentLifecycle',d.assets_without_current_lifecycle,
      'assetsWithoutCurrentRisk',d.assets_without_current_risk,
      'openRiskRecords',d.open_risk_records,
      'contractedRiskRecords',d.contracted_risk_records,
      'incompleteRiskRecords',d.incomplete_risk_records,
      'staleOrUndatedRiskRecords',d.stale_or_undated_risk_records,
      'distinctCriteriaProfiles',d.distinct_criteria_profiles,
      'assetsWithVerifiedCondition',d.assets_with_verified_condition,
      'assetsWithCurrentEconomics',d.assets_with_current_economics,
      'assetsWithLifecycleEvaluation',d.assets_with_lifecycle_evaluation
    ),
    'evidenceGaps',to_jsonb(array_remove(array[
      case when d.total_assets=0 then 'No registered assets are available for lifecycle-risk assessment.' end,
      case when d.assets_without_current_lifecycle>0 then
        d.assets_without_current_lifecycle||' asset(s) have no canonical lifecycle state.' end,
      case when d.assets_without_current_risk>0 then
        d.assets_without_current_risk||' asset(s) have no complete current risk assessment.' end,
      case when d.incomplete_risk_records>0 then
        d.incomplete_risk_records||' open risk record(s) do not satisfy the governed risk contract.' end,
      case when d.stale_or_undated_risk_records>0 then
        d.stale_or_undated_risk_records||' contracted risk record(s) have an absent or overdue review date.' end,
      case when d.distinct_criteria_profiles<>1 and d.open_risk_records>0 then
        d.distinct_criteria_profiles||' criteria profiles are present; one adopted profile is required for a comparable enterprise index.' end
    ]::text[],null)),
    'riskLevels',coalesce((
      select jsonb_agg(jsonb_build_object('level',x.current_risk_level,
        'records',x.records) order by case x.current_risk_level
          when 'Critical' then 1 when 'High' then 2 when 'Medium' then 3
          when 'Low' then 4 when 'Very Low' then 5 else 6 end)
      from (select r.current_risk_level,count(*)::int records
        from qualifying_risks r group by r.current_risk_level) x
    ),'[]'::jsonb),
    'lifecycleStages',coalesce((
      select jsonb_agg(jsonb_build_object('stageKey',x.stage_key,
        'stageLabel',x.stage_label,'phase',x.phase,'assets',x.assets,
        'assetsWithCurrentRisk',x.assets_with_current_risk)
        order by x.stage_order)
      from (select coalesce(l.stage_key,'unassigned') stage_key,
          coalesce(l.stage_label,'Unassigned') stage_label,
          coalesce(l.phase,'unknown') phase,
          coalesce(st.stage_order,2147483647) stage_order,
          count(*)::int assets,
          count(score.asset_id)::int assets_with_current_risk
        from tenant_assets a left join lifecycle l on l.asset_id=a.id
        left join public.lifecycle_stages st on st.stage_key=l.stage_key
        left join asset_scores score on score.asset_id=a.id
        group by l.stage_key,l.stage_label,l.phase,st.stage_order) x
    ),'[]'::jsonb),
    'assets',case when p_detail_role is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'name',a.name,'tag',a.tag,'siteId',a.site_id,
        'siteName',a.site_name,'assetClass',a.asset_class,
        'criticality',a.criticality,'lifecycleStatus',a.lifecycle_status,
        'lifecycle',case when a.stage_key is null then null else jsonb_build_object(
          'stageKey',a.stage_key,'stageLabel',a.stage_label,'phase',a.phase,
          'enteredAt',a.entered_at,'expectedExit',a.expected_exit,
          'inherited',a.inherited,
          'basisEvidenceItemId',a.basis_evidence_item_id) end,
        'assetRiskScore',a.asset_score,
        'conditionKnowledgeState',a.condition_knowledge_state,
        'condition',case when a.condition_id is null then null else jsonb_build_object(
          'id',a.condition_id,'knowledgeState',a.condition_knowledge_state,
          'status',a.condition_status,'validThrough',a.condition_valid_through,
          'verifiedAt',a.condition_verified_at) end,
        'economics',case when a.economics_id is null then null else jsonb_build_object(
          'id',a.economics_id,'version',a.economics_version,
          'evidenceItemId',a.economics_evidence_item_id,
          'reviewDue',a.economics_review_due,
          'economicsReviewOverdue',a.economics_review_due is not null
            and a.economics_review_due<current_date) end,
        'latestLifecycleEvaluation',case when a.lifecycle_evaluation_id is null
          then null else jsonb_build_object('id',a.lifecycle_evaluation_id,
            'recommended',a.lifecycle_recommended,
            'uncertainty',a.lifecycle_uncertainty,
            'decision',a.lifecycle_decision,
            'evaluatedAt',a.lifecycle_evaluated_at) end,
        'currentRiskRecords',coalesce((select jsonb_agg(jsonb_build_object(
          'id',r.id,'title',r.title,'status',r.status,
          'currentRiskScore',r.current_risk_score,
          'currentRiskLevel',r.current_risk_level,
          'criteriaProfileId',r.criteria_profile_id,
          'criteriaName',r.criteria_name,'criteriaVersion',r.criteria_version,
          'analysisLevel',r.analysis_level,'uncertainty',r.uncertainty,
          'confidence',r.confidence,'riskOwnerId',r.risk_owner_id,
          'decisionOwnerId',r.decision_owner_id,'reviewDate',r.review_date,
          'reviewCurrent',r.review_current,
          'contractComplete',r.contract_complete,
          'contractGaps',to_jsonb(r.contract_gaps),
          'informationSensitivity',r.information_sensitivity)
          order by r.current_risk_score desc nulls last,r.updated_at desc)
          from active_risks r where r.asset_id=a.id and (
            r.information_sensitivity in ('public','internal')
            or (r.information_sensitivity='confidential' and p_detail_role in
              ('admin','executive','maintenance_manager','reliability_engineer'))
            or (r.information_sensitivity='restricted' and p_detail_role in
              ('admin','executive'))
          )),'[]'::jsonb),
        'restrictedRiskRecords',(select count(*)::int from active_risks r
          where r.asset_id=a.id and not (
            r.information_sensitivity in ('public','internal')
            or (r.information_sensitivity='confidential' and p_detail_role in
              ('admin','executive','maintenance_manager','reliability_engineer'))
            or (r.information_sensitivity='restricted' and p_detail_role in
              ('admin','executive'))
          )),
        'evidenceGaps',to_jsonb(array_remove(array[
          case when a.stage_key is null then 'canonical lifecycle state missing' end,
          case when a.asset_score is null then 'complete current risk assessment missing' end,
          case when a.condition_id is null or a.condition_status<>'verified'
            or (a.condition_valid_through is not null and a.condition_valid_through<now())
            then 'current independently verified condition evidence missing' end,
          case when a.economics_id is null then 'governed economic evidence missing' end,
          case when a.economics_review_due is not null and a.economics_review_due<current_date
            then 'economic evidence review overdue' end,
          case when a.lifecycle_evaluation_id is null then 'lifecycle evaluation missing' end
        ]::text[],null))
      ) order by a.name) from asset_detail a
    ),'[]'::jsonb) end,
    'basis','Lifecycle risk composes canonical lifecycle, ISO 31000 risk, condition, economics and lifecycle-decision evidence. Recorded risk scores are never recalculated or copied here.',
    'decisionBoundary','This posture does not accept risk, approve a lifecycle decision, authorize expenditure or work, change an operating limit, or return equipment to service.'
  )
  from decision d
$$;

revoke all on function public.sync_enterprise_asset_lifecycle_risk(uuid,text)
  from public,anon,authenticated;
grant execute on function public.sync_enterprise_asset_lifecycle_risk(uuid,text)
  to service_role;

create or replace function public.get_enterprise_asset_lifecycle_risk()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text:=public.app_current_role();
  v_detail_role text;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','forbidden');
  end if;
  if v_role in ('admin','executive','maintenance_manager','reliability_engineer') then
    v_detail_role:=v_role;
  end if;
  return public.sync_enterprise_asset_lifecycle_risk(v_org,v_detail_role);
end $$;

revoke all on function public.get_enterprise_asset_lifecycle_risk()
  from public,anon,service_role;
grant execute on function public.get_enterprise_asset_lifecycle_risk()
  to authenticated;

-- Replace the refused assets.risk_score proxy with a governed, coverage-gated
-- KPI definition. The scheduled writer below deletes the old rolling snapshot
-- before reevaluating coverage, so a newly stale review cannot leave a number.
update public.kpi_catalog set
  name='Asset Lifecycle Risk Index',
  page='risk_safety',
  formula='Mean of each registered asset''s highest current ISO 31000 risk score under one adopted criteria profile',
  target_label='Trend only — common adopted criteria',
  direction='down',target_low=null,target_high=null,unit='score',
  accountable='Risk Manager',responsible='Reliability',
  consulted='Operations, Finance, HSE',informed='Executive',
  agent_owner='reliability_engineering',
  computable=true,
  source_note='Published only with complete asset lifecycle coverage, fully contracted current risk records, one adopted criteria profile and current review dates. Missing, stale or cross-profile evidence yields Awaiting source.'
where kpi_key='asset_risk_index';

-- Preserve the prior public scheduler entry point and compose this measurement
-- into it. The KPI fact store remains kpi_values; this is not another queue.
alter function public.compute_kpi_snapshot()
  rename to compute_kpi_snapshot_with_hse;

revoke all on function public.compute_kpi_snapshot_with_hse()
  from public,anon,authenticated;
grant execute on function public.compute_kpi_snapshot_with_hse()
  to service_role;

create or replace function public.compute_enterprise_asset_lifecycle_risk_kpi_snapshot()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid;
  v_position jsonb;
  v_written integer:=0;
begin
  for v_org in select id from public.organizations loop
    v_position:=public.sync_enterprise_asset_lifecycle_risk(v_org,null);
    delete from public.kpi_values
    where organization_id=v_org and kpi_key='asset_risk_index';

    if coalesce((v_position->'index'->>'indexComputable')::boolean,false) then
      insert into public.kpi_values(
        organization_id,kpi_key,value,status,variance_pct,confidence,computed_from
      ) values(
        v_org,'asset_risk_index',(v_position->'index'->>'value')::numeric,
        'not_assessed',null,'high',jsonb_build_object(
          'source','Canonical ISO 31000 asset risks joined to canonical lifecycle state',
          'formula',v_position->'index'->'formula',
          'criteriaProfile',v_position->'index'->'criteriaProfile',
          'coverage',v_position->'coverage',
          'noDecisionAuthority',true));
      v_written:=v_written+1;
    end if;
  end loop;
  return jsonb_build_object('kpi_values_written',v_written,'ran_at',now());
end $$;

revoke all on function public.compute_enterprise_asset_lifecycle_risk_kpi_snapshot()
  from public,anon,authenticated;
grant execute on function public.compute_enterprise_asset_lifecycle_risk_kpi_snapshot()
  to service_role;

create or replace function public.compute_kpi_snapshot()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_existing jsonb;
  v_lifecycle_risk jsonb;
begin
  v_existing:=public.compute_kpi_snapshot_with_hse();
  v_lifecycle_risk:=public.compute_enterprise_asset_lifecycle_risk_kpi_snapshot();
  return jsonb_build_object('existing',v_existing,
    'assetLifecycleRisk',v_lifecycle_risk,'ran_at',now());
end $$;

revoke all on function public.compute_kpi_snapshot()
  from public,anon,authenticated;
grant execute on function public.compute_kpi_snapshot()
  to service_role;

comment on function public.get_enterprise_asset_lifecycle_risk() is
  'C6.05 tenant-scoped asset lifecycle-risk posture. Exact risk evidence is role and information-sensitivity restricted; no risk or lifecycle authority is granted.';
comment on function public.compute_enterprise_asset_lifecycle_risk_kpi_snapshot() is
  'C6.05 strict coverage/comparability/freshness-gated canonical Asset Risk Index writer. Stale values are removed before every attempt.';

notify pgrst,'reload schema';

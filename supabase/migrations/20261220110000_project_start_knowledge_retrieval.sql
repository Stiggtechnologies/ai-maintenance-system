-- D12.05 / spec I.39 — project-start knowledge retrieval.
--
-- This is a composition read, not a fifth knowledge store. It extends the
-- creation-time D9.12 lesson screen with three canonical families the spec
-- also names: verified completed-project estimate outcomes, measured vendor
-- performance, and recorded startup failures. It calculates no similarity
-- score, makes no recommendation, and grants no approval or work authority.

create or replace function public.get_project_start_knowledge(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  c public.development_cases%rowtype;
  v_lessons jsonb;
  v_estimates jsonb;
  v_vendors jsonb;
  v_startup jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from public.development_cases
   where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- ONE lesson matcher: reuse D9.12 verbatim rather than maintaining a second
  -- applicability predicate for the same learning_events rows.
  v_lessons := public.screen_applicable_project_lessons(p_case_id);

  select coalesce(jsonb_agg(x.item order by x.created_at desc), '[]'::jsonb)
    into v_estimates
  from (
    select jsonb_build_object(
      'learningEventId', e.id,
      'sourceCaseId', h.id,
      'sourceCaseTitle', h.title,
      'lifecycleType', h.lifecycle_type,
      'baselineCost', e.project_baseline_cost,
      'actualCost', e.project_actual_cost,
      'baselineDurationDays', e.project_baseline_duration_days,
      'actualDurationDays', e.project_actual_duration_days,
      'currency', e.project_currency,
      'estimateBasisId', b.id,
      'estimateClass', b.estimate_class,
      'scopeMaturity', b.scope_maturity,
      'quotationSupport', b.quotation_support,
      'outcomeEvidenceItemId', e.project_outcome_evidence_id,
      'sourceRefs', jsonb_build_array(
        jsonb_build_object('table','learning_events','id',e.id),
        jsonb_build_object('table','evidence_items','id',e.project_outcome_evidence_id),
        jsonb_build_object('table','development_cases','id',h.id))
        || case when b.id is null then '[]'::jsonb else
          jsonb_build_array(jsonb_build_object('table','project_estimate_basis','id',b.id)) end,
      'matchReason', 'completed project shares this lifecycle type'
    ) item, e.created_at
    from public.learning_events e
    join public.development_cases h on h.id=e.development_case_id
      and h.organization_id=v_org and h.status='completed'
    join public.evidence_items ev on ev.id=e.project_outcome_evidence_id
      and ev.organization_id=v_org and ev.verification_status='verified'
    left join lateral (
      select eb.* from public.project_estimate_basis eb
       where eb.organization_id=v_org and eb.development_case_id=h.id
       order by eb.version desc limit 1
    ) b on true
    where e.organization_id=v_org and e.event_type = 'project_outcome'
      and h.id<>c.id and h.lifecycle_type=c.lifecycle_type
  ) x;

  select coalesce(jsonb_agg(x.item order by x.supplier), '[]'::jsonb)
    into v_vendors
  from (
    select s.name supplier, jsonb_build_object(
      'supplierId', s.id,
      'supplier', s.name,
      'sourceCaseIds', jsonb_agg(distinct h.id),
      'packageIds', jsonb_agg(distinct p.id),
      'performancePeriodIds', jsonb_agg(distinct cp.id),
      'record', public.get_vendor_quality_record(s.id),
      'sourceRefs',
        jsonb_build_array(jsonb_build_object('table','suppliers','id',s.id))
        || jsonb_agg(distinct jsonb_build_object('table','contract_packages','id',p.id))
        || jsonb_agg(distinct jsonb_build_object('table','contract_performance','id',cp.id)),
      'matchReason', 'measured supplier on a completed project sharing this lifecycle type'
    ) item
    from public.development_cases h
    join public.contract_packages p on p.development_case_id=h.id
      and p.organization_id=v_org
    join public.contract_performance cp on cp.package_id=p.id
      and cp.organization_id=v_org
    join public.suppliers s on s.id=cp.supplier_id and s.organization_id=v_org
    where h.organization_id=v_org and h.status='completed'
      and h.id<>c.id and h.lifecycle_type=c.lifecycle_type
    group by s.id,s.name
  ) x;

  select coalesce(jsonb_agg(x.item order by x.created_at desc), '[]'::jsonb)
    into v_startup
  from (
    select jsonb_build_object(
      'learningEventId', e.id,
      'sourceCaseId', h.id,
      'sourceCaseTitle', h.title,
      'title', e.title,
      'cause', e.cause,
      'correctiveAction', e.corrective_action,
      'applicability', e.applicability,
      'sourceRefs', jsonb_build_array(
        jsonb_build_object('table','learning_events','id',e.id),
        jsonb_build_object('table','development_cases','id',h.id)),
      'matchReason', case when h.lifecycle_type=c.lifecycle_type
        then 'source case shares this lifecycle type'
        else 'recorded applicability matches this case' end
    ) item, e.created_at
    from public.learning_events e
    join public.development_cases h on h.id=e.development_case_id and h.organization_id=v_org
    where e.organization_id=v_org and e.event_type='lesson_learned'
      and e.failure_mode_key = 'project_delivery.startup_failure'
      and public.sync_lesson_applies_to_case(
        e.development_case_id,h.lifecycle_type,e.applicability,
        c.id,c.lifecycle_type,c.title,c.problem_statement)
  ) x;

  return jsonb_build_object(
    'caseId', c.id,
    'lifecycleType', c.lifecycle_type,
    'lessons', v_lessons,
    'historicalEstimates', jsonb_build_object(
      'count', jsonb_array_length(v_estimates), 'items', v_estimates,
      'emptyReason', case when jsonb_array_length(v_estimates)=0 then
        'No comparable completed-project estimate outcomes with independently verified project outcomes are recorded for this lifecycle type.' end),
    'vendorPerformance', jsonb_build_object(
      'count', jsonb_array_length(v_vendors), 'items', v_vendors,
      'emptyReason', case when jsonb_array_length(v_vendors)=0 then
      'No measured vendor performance period is linked to a comparable completed project. Absence is not acceptable performance.' end),
    'startupProblems', jsonb_build_object(
      'count', jsonb_array_length(v_startup), 'items', v_startup,
      'emptyReason', case when jsonb_array_length(v_startup)=0 then
        'No matching startup failure is recorded. This is not proof that startup risk is absent.' end),
    'method', 'Deterministic same-tenant retrieval from canonical project lessons, independently verified project outcomes, estimate bases and measured contract-performance vendor records. No score and no model ranking.',
    'recommendationOnly', true,
    'authorization', false,
    'decisionBoundary', 'This retrieval prepares evidence for named humans. It does not approve a project, select a supplier, set an estimate, accept a risk, pass a gate or authorize work.');
end
$$;

revoke all on function public.get_project_start_knowledge(uuid) from public, anon;
grant execute on function public.get_project_start_knowledge(uuid) to authenticated, service_role;

comment on function public.get_project_start_knowledge(uuid) is
  'D12.05 / I.39: creation-time, tenant-scoped composition of project lessons, independently verified estimate outcomes, measured vendor records and startup failures. Read-only, no score, no authorization.';

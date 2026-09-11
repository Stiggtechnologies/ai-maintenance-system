-- Sync Develop D8.05 — Sync Transition composition.
-- This is a read model over canonical readiness, debt and early-life records.
-- It creates no second handover workflow and grants no transition authority.

alter table public.early_life_failures
  add column if not exists source_reference text,
  add column if not exists evidence_class text,
  add column if not exists assessment_basis text,
  add column if not exists recorded_by uuid references auth.users(id) on delete restrict;

alter table public.early_life_failures
  drop constraint if exists early_life_failures_evidence_class_check;
alter table public.early_life_failures
  add constraint early_life_failures_evidence_class_check check (
    evidence_class is null or evidence_class in (
      'MEASURED','INSPECTED','CALCULATED','TESTED','DOCUMENTED','HISTORICAL',
      'EXPERT_JUDGEMENT','AI_INFERENCE'));

create or replace function public.record_case_early_life_failure(
  p_case_id uuid,
  p_asset_id uuid,
  p_occurred_at timestamptz,
  p_months_since_handover numeric,
  p_failure_mode text,
  p_attributed_to text,
  p_preventable_by text,
  p_source_reference text,
  p_evidence_class text,
  p_assessment_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
  c development_cases%rowtype;
  v_id bigint;
begin
  select role into v_role from user_profiles
  where id = v_uid and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner','supervisor','technician') then
    raise exception 'early-life failure evidence requires an authorized human operations, maintenance, engineering or planning role';
  end if;
  select * into c from development_cases
  where id = p_case_id and organization_id = v_org;
  if not found then
    raise exception 'development case not found in this organization';
  end if;
  if not exists(select 1 from development_case_assets ca
    where ca.organization_id = v_org and ca.development_case_id = c.id
      and ca.asset_id = p_asset_id) then
    raise exception 'asset is not bound to this development case';
  end if;
  if p_occurred_at is null or p_occurred_at > now() then
    raise exception 'occurrence time is required and cannot be in the future';
  end if;
  if p_months_since_handover is not null and
     (p_months_since_handover < 0 or lower(p_months_since_handover::text) in ('nan','infinity','-infinity')) then
    raise exception 'months since handover must be finite and non-negative when known';
  end if;
  if length(btrim(coalesce(p_failure_mode, ''))) < 3 then
    raise exception 'failure mode requires at least three characters';
  end if;
  if p_attributed_to not in ('design','manufacture','installation','commissioning',
      'operation_outside_envelope','random','not_determined') then
    raise exception 'select a governed early-life attribution';
  end if;
  if p_evidence_class not in ('MEASURED','INSPECTED','CALCULATED','TESTED','DOCUMENTED',
      'HISTORICAL','EXPERT_JUDGEMENT','AI_INFERENCE') then
    raise exception 'evidence class must use the governed eight-class provenance vocabulary';
  end if;
  if length(btrim(coalesce(p_source_reference, ''))) < 3 then
    raise exception 'source or evidence reference is required';
  end if;
  if length(btrim(coalesce(p_assessment_basis, ''))) < 20 then
    raise exception 'assessment basis requires at least 20 characters';
  end if;

  insert into early_life_failures(organization_id,asset_id,project_id,occurred_at,
    months_since_handover,failure_mode,attributed_to,preventable_by,
    source_reference,evidence_class,assessment_basis,recorded_by)
  values(v_org,p_asset_id,c.capital_project_id,p_occurred_at,p_months_since_handover,
    btrim(p_failure_mode),p_attributed_to,nullif(btrim(coalesce(p_preventable_by,'')),''),
    btrim(p_source_reference),p_evidence_class,btrim(p_assessment_basis),v_uid)
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'early_life_failure',v_role,
    jsonb_build_object('action','recorded','case_id',c.id,'asset_id',p_asset_id,'failure_id',v_id),
    jsonb_build_object('attributed_to',p_attributed_to,'evidence_class',p_evidence_class,
      'source_reference',btrim(p_source_reference),'months_since_handover',p_months_since_handover));
  return jsonb_build_object('id',v_id,'caseId',c.id,'assetId',p_asset_id,'status','recorded');
end
$$;

create or replace function public.get_case_sync_transition(
  p_case_id uuid,
  p_stabilization_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_operating_model jsonb;
  v_operational_readiness jsonb;
  v_technical_debt jsonb;
  v_operational_debt jsonb;
  v_stabilization jsonb;
  v_posture text;
  v_window_months numeric;
begin
  if v_org is null then
    raise exception 'forbidden';
  end if;
  select * into c from development_cases
  where id = p_case_id and organization_id = v_org;
  if not found then
    raise exception 'development case not found in this organization';
  end if;
  if p_stabilization_days is null or p_stabilization_days < 1 or p_stabilization_days > 365 then
    raise exception 'stabilization window must be between 1 and 365 days';
  end if;

  v_window_months := p_stabilization_days::numeric / 30.4375;
  v_operating_model := get_case_operating_model_readiness(c.id);
  v_operational_readiness := get_case_operational_readiness(c.id);
  v_technical_debt := get_case_technical_debt(c.id);
  v_operational_debt := get_case_operational_debt(c.id);

  with scoped as (
    select e.*, a.name asset_name, a.tag asset_tag
    from early_life_failures e
    join assets a on a.id = e.asset_id and a.organization_id = v_org
    where e.organization_id = v_org
      and (
        exists(select 1 from development_case_assets ca
          where ca.organization_id = v_org and ca.development_case_id = c.id
            and ca.asset_id = e.asset_id)
        or (c.capital_project_id is not null and e.project_id = c.capital_project_id)
      )
  ), windowed as (
    select * from scoped
    where months_since_handover is not null
      and months_since_handover <= v_window_months
  )
  select jsonb_build_object(
    'windowDays', p_stabilization_days,
    'windowBasis', 'Recorded months_since_handover converted using 30.4375 days per month. Missing timing stays unclassified and is never treated as outside the window.',
    'scopeAssetCount', (select count(*) from development_case_assets ca
      where ca.organization_id = v_org and ca.development_case_id = c.id),
    'recordedInWindow', (select count(*) from windowed),
    'unclassifiedTimingCount', (select count(*) from scoped where months_since_handover is null),
    'notFedBackCount', (select count(*) from windowed where not fed_back_to_design),
    'notDeterminedCount', (select count(*) from windowed where attributed_to = 'not_determined'),
    'status', case
      when not exists(select 1 from scoped) then 'NO_FAILURES_RECORDED'
      when exists(select 1 from scoped where months_since_handover is null) then 'TIMING_EVIDENCE_INCOMPLETE'
      when exists(select 1 from windowed where not fed_back_to_design or attributed_to = 'not_determined') then 'ACTION_REQUIRED'
      else 'RECORDED_ACTIONS_CLOSED'
    end,
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'assetId', asset_id, 'assetName', asset_name, 'assetTag', asset_tag,
      'occurredAt', occurred_at, 'monthsSinceHandover', months_since_handover,
      'failureMode', failure_mode, 'attributedTo', attributed_to,
      'preventableBy', preventable_by, 'fedBackToDesign', fed_back_to_design,
      'workOrderId', work_order_id, 'sourceReference', source_reference,
      'evidenceClass', evidence_class, 'assessmentBasis', assessment_basis,
      'recordedBy', recorded_by) order by occurred_at desc)
      from (select * from windowed order by occurred_at desc limit 100) visible), '[]'::jsonb),
    'note', 'No failures recorded is not proof of stable operation. This view reports persisted observations and design-feedback closure only.'
  ) into v_stabilization;

  v_posture := case
    when v_operating_model->>'verdict' <> 'READY'
      or coalesce((v_operational_readiness->'overall'->>'hardBlockerCount')::integer, 0) > 0
      or coalesce((v_operational_readiness->>'assetCount')::integer, 0) = 0
      then 'NOT_READY'
    when exists(select 1 from jsonb_array_elements(v_technical_debt->'items') i
      where i->>'approvedAt' is null)
      or exists(select 1 from jsonb_array_elements(v_operational_debt->'items') i
        where i->>'acknowledgedAt' is null)
      or coalesce((v_operational_debt->>'unvaluedCount')::integer, 0) > 0
      or v_stabilization->>'status' in ('TIMING_EVIDENCE_INCOMPLETE','ACTION_REQUIRED')
      then 'ATTENTION_REQUIRED'
    else 'HUMAN_REVIEW_REQUIRED'
  end;

  return jsonb_build_object(
    'caseId', c.id,
    'caseTitle', c.title,
    'stageKey', c.current_stage_key,
    'capitalProjectId', c.capital_project_id,
    'generatedAt', now(),
    'transitionPosture', v_posture,
    'operatingModel', v_operating_model,
    'operationalReadiness', v_operational_readiness,
    'technicalDebt', v_technical_debt,
    'operationalDebt', v_operational_debt,
    'stabilization', v_stabilization,
    'decisionBoundary', 'Composition only. Sync Transition does not approve handover, acceptance, energization, startup, go-live or stabilization exit; the canonical human approval workflows retain that authority.'
  );
end
$$;

revoke all on function public.get_case_sync_transition(uuid,integer) from public, anon;
revoke all on function public.record_case_early_life_failure(uuid,uuid,timestamptz,numeric,text,text,text,text,text,text) from public, anon;
grant execute on function public.get_case_sync_transition(uuid,integer),
  public.record_case_early_life_failure(uuid,uuid,timestamptz,numeric,text,text,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';

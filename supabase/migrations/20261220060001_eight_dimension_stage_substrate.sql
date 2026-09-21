-- D11.11: the eight canonical lifecycle dimensions beneath every governed stage.
-- This is a read model only. It does not create a parallel object store, infer
-- stage ownership for lifecycle-persistent records, or manufacture a score.

create or replace function public.get_case_stage_dimensions(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  c public.development_cases%rowtype;
  v_current_sequence integer;
  v_objective integer; v_value integer; v_risk integer; v_risk_attention integer;
  v_evidence integer; v_evidence_attention integer; v_decision integer;
  v_configuration integer; v_work integer; v_outcome integer;
  v_dimensions jsonb;
  v_stages jsonb;
begin
  if v_org is null then raise exception 'authentication required'; end if;
  select * into c from public.development_cases
   where id = p_case_id and organization_id = v_org;
  if not found then raise exception 'development case not found in current tenant'; end if;
  if c.framework_id is null then
    raise exception 'development case has no governed framework; stage substrate is unavailable';
  end if;

  select sequence into v_current_sequence
    from public.project_framework_stages
   where organization_id = v_org and framework_id = c.framework_id
     and stage_key = c.current_stage_key;

  select count(*) into v_objective from public.risk_objectives
   where organization_id = v_org and id = c.objective_id;
  select
    (select count(*) from public.business_cases
      where organization_id = v_org and development_case_id = c.id)
    +
    (select count(*) from public.value_metrics
      where organization_id = v_org and development_case_id = c.id)
    into v_value;
  select count(*), count(*) filter (
    where current_risk_level in ('High','Critical')
      and status not in ('closed','retired','superseded')
  ) into v_risk, v_risk_attention
    from public.risks where organization_id = v_org and development_case_id = c.id;
  select count(*), count(*) filter (where verification_status <> 'verified')
    into v_evidence, v_evidence_attention
    from public.evidence_items where organization_id = v_org and development_case_id = c.id;
  select count(*) into v_decision from public.decisions
   where organization_id = v_org and development_case_id = c.id;
  select
    (select count(*) from public.development_baselines
      where organization_id = v_org and development_case_id = c.id)
    +
    (select count(*) from public.thread_objects
      where organization_id = v_org and development_case_id = c.id and status <> 'retired')
    into v_configuration;
  select count(*) into v_work from public.work_packages
   where organization_id = v_org and development_case_id = c.id;
  select
    (select count(*) from public.development_success_outcomes o
      join public.development_success_contracts s on s.id = o.contract_id
       and s.organization_id = v_org
      where o.organization_id = v_org and s.development_case_id = c.id)
    +
    (select count(*) from public.learning_events
      where organization_id = v_org and development_case_id = c.id)
    into v_outcome;

  v_dimensions := jsonb_build_array(
    jsonb_build_object('key','objective','label','Objective','count',v_objective,
      'state',case when v_objective > 0 then 'recorded' else 'missing' end,
      'attentionCount',case when v_objective = 0 then 1 else 0 end,
      'sourceTables',jsonb_build_array('development_cases','risk_objectives'),
      'basis','The case objective persists through every stage; risk remains tied to it.'),
    jsonb_build_object('key','value','label','Value','count',v_value,
      'state',case when v_value > 0 then 'recorded' else 'missing' end,
      'attentionCount',case when v_value = 0 then 1 else 0 end,
      'sourceTables',jsonb_build_array('business_cases','value_metrics'),
      'basis','Economic hypotheses and measured value remain visible throughout the lifecycle.'),
    jsonb_build_object('key','risk','label','Risk','count',v_risk,
      'state',case when v_risk = 0 then 'missing' when v_risk_attention > 0 then 'attention' else 'recorded' end,
      'attentionCount',v_risk_attention,'sourceTables',jsonb_build_array('risks'),
      'basis','Canonical case risks; High or Critical active exposure requires accountable review.'),
    jsonb_build_object('key','evidence','label','Evidence','count',v_evidence,
      'state',case when v_evidence = 0 then 'missing' when v_evidence_attention > 0 then 'attention' else 'recorded' end,
      'attentionCount',v_evidence_attention,'sourceTables',jsonb_build_array('evidence_items'),
      'basis','Evidence provenance and verification state travel with the case; absence is never treated as proof.'),
    jsonb_build_object('key','decision','label','Decision','count',v_decision,
      'state',case when v_decision > 0 then 'recorded' else 'missing' end,
      'attentionCount',case when v_decision = 0 then 1 else 0 end,
      'sourceTables',jsonb_build_array('decisions'),
      'basis','Human decision records preserve question, rationale, authority and evidence across stages.'),
    jsonb_build_object('key','configuration','label','Configuration','count',v_configuration,
      'state',case when v_configuration > 0 then 'recorded' else 'missing' end,
      'attentionCount',case when v_configuration = 0 then 1 else 0 end,
      'sourceTables',jsonb_build_array('development_baselines','thread_objects'),
      'basis','Approved baselines and the canonical digital thread show what configuration is being governed.'),
    jsonb_build_object('key','work','label','Work','count',v_work,
      'state',case when v_work > 0 then 'recorded' else 'missing' end,
      'attentionCount',case when v_work = 0 then 1 else 0 end,
      'sourceTables',jsonb_build_array('work_packages'),
      'basis','Canonical work packages connect planned delivery to the case without a second work ledger.'),
    jsonb_build_object('key','outcome','label','Outcome','count',v_outcome,
      'state',case when v_outcome > 0 then 'recorded' else 'missing' end,
      'attentionCount',case when v_outcome = 0 then 1 else 0 end,
      'sourceTables',jsonb_build_array('development_success_outcomes','learning_events'),
      'basis','Success outcomes establish intent and learning events preserve observed lifecycle results.')
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'stageKey', s.stage_key,
    'stageName', s.display_name,
    'sequence', s.sequence,
    'progress', case
      when s.stage_key = c.current_stage_key then 'current'
      when v_current_sequence is null then 'unpositioned'
      when s.sequence < v_current_sequence then 'completed'
      else 'upcoming' end,
    'gateReviewCount', (select count(*) from public.stage_gate_reviews r
      where r.organization_id = v_org and r.development_case_id = c.id and r.stage_key = s.stage_key),
    'dimensions', v_dimensions
  ) order by s.sequence), '[]'::jsonb) into v_stages
  from public.project_framework_stages s
  where s.organization_id = v_org and s.framework_id = c.framework_id;

  if jsonb_array_length(v_stages) = 0 then
    raise exception 'governed framework has no stages; stage substrate is unavailable';
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'caseTitle', c.title,
    'currentStageKey', c.current_stage_key,
    'dimensionKeys', jsonb_build_array('objective','value','risk','evidence','decision','configuration','work','outcome'),
    'stages', v_stages,
    'composition','Eight lifecycle views over shared canonical case objects; records persist across stages unless their canonical source explicitly scopes them.',
    'authorityBoundary','Dimension state is visibility, not gate approval, risk acceptance, configuration release, work authorization or outcome verification. Named humans retain those authorities.'
  );
end;
$$;

revoke all on function public.get_case_stage_dimensions(uuid) from public;
grant execute on function public.get_case_stage_dimensions(uuid) to authenticated;
comment on function public.get_case_stage_dimensions(uuid) is
  'D11.11 tenant-scoped eight-dimension lifecycle substrate for every governed case stage; read-only canonical composition with no synthetic score.';
notify pgrst, 'reload schema';

-- D9.06 acceptance repair: outcomes must carry an explicit kind and
-- attribution boundary. Quantitative observations additionally carry a
-- finite value and unit; qualitative observations must not imply a number.
-- Existing observations were captured through a UI field labelled
-- "Observed outcome and attribution limits", so preserve that exact text as
-- the legacy attribution boundary instead of inventing a new claim.
alter table public.learning_events
  add column standard_outcome_kind text,
  add column standard_outcome_value numeric,
  add column standard_outcome_unit text,
  add column standard_outcome_attribution_limit text;

alter table public.learning_events disable trigger standard_work_observation_guard;
update public.learning_events
set standard_outcome_kind='qualitative',
    standard_outcome_attribution_limit=standard_outcome_description
where event_type='standard_work_observation';
alter table public.learning_events enable trigger standard_work_observation_guard;

alter table public.learning_events add constraint standard_work_observation_outcome_contract check (
  case when event_type='standard_work_observation' then
    coalesce(standard_outcome_kind in ('qualitative','quantitative'),false)
    and coalesce(length(btrim(standard_outcome_attribution_limit)) between 10 and 10000,false)
    and case when standard_outcome_kind='quantitative' then
      standard_outcome_value is not null
      and standard_outcome_value not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      and coalesce(length(btrim(standard_outcome_unit)) between 1 and 120,false)
    else
      standard_outcome_value is null and standard_outcome_unit is null
    end
  else
    standard_outcome_kind is null and standard_outcome_value is null
    and standard_outcome_unit is null and standard_outcome_attribution_limit is null
  end
);

comment on column public.learning_events.standard_outcome_kind is
  'Observed outcome representation: qualitative or quantitative. Neither kind establishes causation or improvement.';
comment on column public.learning_events.standard_outcome_attribution_limit is
  'Required boundary on what the observed outcome can and cannot be attributed to; never a fabricated counterfactual.';

create or replace function public.record_standard_work_observation(
  p_case_id uuid,p_procedure_id bigint,p_work_order_id uuid,
  p_execution_evidence_id uuid,p_outcome_evidence_id uuid,p_observed_at timestamptz,
  p_observation jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text; v_id uuid;
  v_outcome_kind text; v_outcome_value numeric; v_outcome_unit text;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if v_actor is null or v_org is null or coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','A named authorized human must record the observation');
  end if;
  if jsonb_typeof(p_observation) is distinct from 'object' then
    return jsonb_build_object('error','Observation fields must be an object');
  end if;
  if exists(select 1 from unnest(array['title','learning','applicability','execution',
    'variationKind','variationBasis','outcome','outcomeKind','attributionLimit']) as required(field)
    where jsonb_typeof(p_observation->required.field) is distinct from 'string') then
    return jsonb_build_object('error','Every observation narrative, kind and variation kind must be a JSON string');
  end if;
  v_outcome_kind:=p_observation->>'outcomeKind';
  if v_outcome_kind not in ('qualitative','quantitative') then
    return jsonb_build_object('error','Outcome kind must be qualitative or quantitative');
  end if;
  if v_outcome_kind='quantitative' then
    if jsonb_typeof(p_observation->'outcomeValue') is distinct from 'number'
      or jsonb_typeof(p_observation->'outcomeUnit') is distinct from 'string' then
      return jsonb_build_object('error','Quantitative outcomes require a numeric value and unit');
    end if;
    v_outcome_value:=(p_observation->>'outcomeValue')::numeric;
    v_outcome_unit:=nullif(btrim(p_observation->>'outcomeUnit'),'');
    if v_outcome_value in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      or coalesce(length(v_outcome_unit) between 1 and 120,false)=false then
      return jsonb_build_object('error','Quantitative outcome value must be finite and its unit must be 1 to 120 characters');
    end if;
  elsif (p_observation ? 'outcomeValue' and p_observation->'outcomeValue'<>'null'::jsonb)
    or (p_observation ? 'outcomeUnit' and nullif(btrim(p_observation->>'outcomeUnit'),'') is not null) then
    return jsonb_build_object('error','Qualitative outcomes cannot carry a numeric value or unit');
  end if;
  perform set_config('syncai.standard_observation_write','on',true);
  insert into public.learning_events(organization_id,development_case_id,event_type,title,detail,applicability,
    standard_procedure_id,standard_execution_work_order_id,standard_execution_evidence_id,
    standard_outcome_evidence_id,standard_execution_observed_at,standard_execution_recorded_by,
    standard_execution_description,standard_variation_kind,standard_variation_basis,standard_outcome_description,
    standard_outcome_kind,standard_outcome_value,standard_outcome_unit,standard_outcome_attribution_limit)
  values(v_org,p_case_id,'standard_work_observation',btrim(p_observation->>'title'),
    btrim(p_observation->>'learning'),btrim(p_observation->>'applicability'),p_procedure_id,p_work_order_id,
    p_execution_evidence_id,p_outcome_evidence_id,p_observed_at,v_actor,
    btrim(p_observation->>'execution'),p_observation->>'variationKind',
    btrim(p_observation->>'variationBasis'),btrim(p_observation->>'outcome'),
    v_outcome_kind,v_outcome_value,v_outcome_unit,btrim(p_observation->>'attributionLimit')) returning id into v_id;
  perform set_config('syncai.standard_observation_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'standard_work_observation',v_role,
    jsonb_build_object('actorId',v_actor,'learningEventId',v_id,'procedureId',p_procedure_id,
      'workOrderId',p_work_order_id,'caseId',p_case_id),
    jsonb_build_object('status','observed','outcomeKind',v_outcome_kind,'improvementEstablished',false));
  return jsonb_build_object('id',v_id,'status','observed',
    'detail','Observation recorded. Improvement and standard adoption are not established.');
exception when check_violation or foreign_key_violation or raise_exception or numeric_value_out_of_range then
  return jsonb_build_object('error',sqlerrm);
end $$;
revoke all on function public.record_standard_work_observation(uuid,bigint,uuid,uuid,uuid,timestamptz,jsonb)
  from public,anon,service_role;
grant execute on function public.record_standard_work_observation(uuid,bigint,uuid,uuid,uuid,timestamptz,jsonb)
  to authenticated;
notify pgrst,'reload schema';

-- D5.10-D5.12 — governed project assurance, reference classes and normalized benchmarking.
--
-- Canonical reuse: development_cases/capital_projects identify projects;
-- learning_events holds verified completed-project outcomes; evidence_items
-- supplies provenance; calculation_runs is the immutable analytical ledger.
-- No second project, lesson, evidence, calculation or approval store is created.

alter table public.learning_events
  add column if not exists project_baseline_cost numeric,
  add column if not exists project_actual_cost numeric,
  add column if not exists project_baseline_duration_days numeric,
  add column if not exists project_actual_duration_days numeric,
  add column if not exists project_currency text,
  add column if not exists project_outcome_evidence_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists project_complexity_rating int,
  add column if not exists project_geography text,
  add column if not exists project_technology_novelty_rating int,
  add column if not exists project_execution_strategy text,
  add column if not exists engineering_maturity_at_execution_pct numeric,
  add column if not exists unresolved_vendor_data_at_gate int,
  add column if not exists commissioning_defects int,
  add column if not exists startup_delay_days numeric,
  add column if not exists safety_incident_rate numeric,
  add column if not exists startup_reliability_pct numeric,
  add column if not exists engineering_hours numeric;

alter table public.learning_events drop constraint if exists learning_events_project_outcome_valid;
alter table public.learning_events add constraint learning_events_project_outcome_valid check (
  event_type <> 'project_outcome'
  or (
    development_case_id is not null
    and project_baseline_cost > 0 and project_actual_cost >= 0
    and project_baseline_duration_days > 0 and project_actual_duration_days >= 0
    and project_currency ~ '^[A-Z]{3}$'
    and project_outcome_evidence_id is not null
    and project_complexity_rating between 1 and 5
    and btrim(project_geography) <> ''
    and project_technology_novelty_rating between 1 and 5
    and btrim(project_execution_strategy) <> ''
    and engineering_maturity_at_execution_pct between 0 and 100
    and unresolved_vendor_data_at_gate >= 0
    and commissioning_defects >= 0 and startup_delay_days >= 0
    and safety_incident_rate >= 0 and startup_reliability_pct between 0 and 100
    and engineering_hours > 0
  )
);

-- The old case-lesson rule was intentionally written before project outcomes
-- existed. Outcomes are complete through the constraint above; ordinary case
-- lessons retain the original failure/cause/action/applicability contract.
alter table public.learning_events drop constraint if exists learning_events_case_lesson_complete;
alter table public.learning_events add constraint learning_events_case_lesson_complete check (
  development_case_id is null or event_type = 'project_outcome' or (
    failure_mode_key is not null and failure_mode_key = any (public.sync_delivery_failure_types())
    and cause is not null and btrim(cause) <> ''
    and corrective_action is not null and btrim(corrective_action) <> ''
    and applicability is not null and btrim(applicability) <> ''
  )
);

create unique index if not exists learning_events_one_project_outcome
  on public.learning_events(organization_id,development_case_id)
  where event_type='project_outcome';

create or replace function public.enforce_verified_project_outcome_provenance()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='INSERT' and new.event_type='project_outcome'
     and coalesce(current_setting('app.project_outcome_write',true),'')<>'on' then
    raise exception 'verified project outcomes are created only through record_verified_project_outcome';
  end if;
  if tg_op in ('UPDATE','DELETE') and old.event_type='project_outcome' then
    raise exception 'a verified project outcome is immutable; record a governed correction as new evidence rather than rewriting history';
  end if;
  if tg_op='UPDATE' and new.event_type='project_outcome' and old.event_type<>'project_outcome' then
    raise exception 'an existing learning event cannot be converted into a project outcome';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists trg_verified_project_outcome_provenance on public.learning_events;
create trigger trg_verified_project_outcome_provenance before insert or update or delete on public.learning_events
for each row execute function public.enforce_verified_project_outcome_provenance();

create or replace function public.record_verified_project_outcome(p_case_id uuid,p_evidence_item_id uuid,p_outcome jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; c public.development_cases%rowtype; v_id uuid; v_currency text;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then return jsonb_build_object('error','forbidden'); end if;
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','project case not found in this organization'); end if;
  if c.status <> 'completed' then return jsonb_build_object('error','only a completed project can enter the reference-class corpus'); end if;
  if not exists(select 1 from public.evidence_items where id=p_evidence_item_id and organization_id=v_org
    and verification_status='verified' and verified_by is distinct from auth.uid()) then
    return jsonb_build_object('error','project outcomes require same-tenant evidence independently verified by someone other than the recorder');
  end if;
  v_currency:=upper(btrim(coalesce(p_outcome->>'currency','')));
  if v_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('error','currency must be a three-letter ISO code'); end if;
  begin
    if (p_outcome->>'baselineCost')::numeric<=0 or (p_outcome->>'actualCost')::numeric<0
       or (p_outcome->>'baselineDurationDays')::numeric<=0 or (p_outcome->>'actualDurationDays')::numeric<0 then
      return jsonb_build_object('error','positive baselines and non-negative actual cost and duration are required');
    end if;
    if (p_outcome->>'complexityRating')::int not between 1 and 5
       or (p_outcome->>'technologyNoveltyRating')::int not between 1 and 5
       or (p_outcome->>'engineeringMaturityAtExecutionPct')::numeric not between 0 and 100
       or (p_outcome->>'unresolvedVendorDataAtGate')::int<0 or (p_outcome->>'commissioningDefects')::int<0
       or (p_outcome->>'startupDelayDays')::numeric<0 or (p_outcome->>'safetyIncidentRate')::numeric<0
       or (p_outcome->>'startupReliabilityPct')::numeric not between 0 and 100
       or (p_outcome->>'engineeringHours')::numeric<=0
       or coalesce(length(btrim(p_outcome->>'geography')),0)=0
       or coalesce(length(btrim(p_outcome->>'executionStrategy')),0)=0 then
      return jsonb_build_object('error','complete valid normalization dimensions, entry predictors and verified outcome metrics are required');
    end if;
  exception when others then return jsonb_build_object('error','complete numeric baseline and actual cost and duration are required'); end;
  if exists(select 1 from public.learning_events where organization_id=v_org and development_case_id=c.id and event_type='project_outcome') then
    return jsonb_build_object('error','this completed project already has a verified outcome; rewriting historical evidence is refused');
  end if;
  perform set_config('app.project_outcome_write','on',true);
  insert into public.learning_events(organization_id,development_case_id,capital_project_id,event_type,title,detail,
    project_baseline_cost,project_actual_cost,project_baseline_duration_days,project_actual_duration_days,
    project_currency,project_outcome_evidence_id,project_complexity_rating,project_geography,
    project_technology_novelty_rating,project_execution_strategy,engineering_maturity_at_execution_pct,
    unresolved_vendor_data_at_gate,commissioning_defects,startup_delay_days,safety_incident_rate,
    startup_reliability_pct,engineering_hours,model_confidence)
  values(v_org,c.id,c.capital_project_id,'project_outcome','Verified project outcome — '||c.title,
    'Human-recorded completed-project outcome. It is evidence for later comparisons, not an automatic standard.',
    (p_outcome->>'baselineCost')::numeric,(p_outcome->>'actualCost')::numeric,
    (p_outcome->>'baselineDurationDays')::numeric,(p_outcome->>'actualDurationDays')::numeric,
    v_currency,p_evidence_item_id,(p_outcome->>'complexityRating')::int,btrim(p_outcome->>'geography'),
    (p_outcome->>'technologyNoveltyRating')::int,btrim(p_outcome->>'executionStrategy'),
    (p_outcome->>'engineeringMaturityAtExecutionPct')::numeric,(p_outcome->>'unresolvedVendorDataAtGate')::int,
    (p_outcome->>'commissioningDefects')::int,(p_outcome->>'startupDelayDays')::numeric,
    (p_outcome->>'safetyIncidentRate')::numeric,(p_outcome->>'startupReliabilityPct')::numeric,
    (p_outcome->>'engineeringHours')::numeric,100)
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values
    (v_org,'verified_project_outcome_recorded',v_role,jsonb_build_object('learning_event_id',v_id,'development_case_id',c.id,'evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('learningEventId',v_id,'status','recorded','operationalAuthorization',false);
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.run_project_assurance_reference_class(
  p_case_id uuid,p_forecast_cost numeric,p_forecast_duration_days numeric,p_currency text,p_evidence_item_id uuid,p_profile jsonb,p_minimum_sample int default 5)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; c public.development_cases%rowtype; v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_n int; v_cost_p50 numeric; v_cost_p80 numeric; v_duration_p50 numeric; v_duration_p80 numeric;
  v_cost_percentile numeric; v_duration_percentile numeric; v_outputs jsonb; v_refusals jsonb:='[]'::jsonb; v_run uuid;
  v_baseline_cost numeric; v_baseline_duration numeric; v_complexity int; v_novelty int; v_geography text; v_strategy text; v_size text;
  v_low_n int; v_high_n int; v_low_schedule numeric; v_high_schedule numeric;
  v_vendor_n int; v_clear_n int; v_vendor_defects numeric; v_clear_defects numeric;
  v_patterns jsonb:='[]'::jsonb; v_pattern_refusals jsonb:='[]'::jsonb;
  v_startup_delay numeric; v_defects numeric; v_safety numeric; v_reliability numeric; v_engineering_intensity numeric;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then return jsonb_build_object('error','forbidden'); end if;
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','project case not found in this organization'); end if;
  if c.status in ('completed','cancelled') then return jsonb_build_object('error','assurance compares an active decision forecast with completed reference projects'); end if;
  if p_forecast_cost is null or p_forecast_cost<=0 or p_forecast_duration_days is null or p_forecast_duration_days<=0 then
    return jsonb_build_object('error','positive forecast cost and duration are required');
  end if;
  if v_currency !~ '^[A-Z]{3}$' then return jsonb_build_object('error','currency must be a three-letter ISO code'); end if;
  if not exists(select 1 from public.evidence_items where id=p_evidence_item_id and organization_id=v_org
    and verification_status='verified' and verified_by is distinct from auth.uid()) then
    return jsonb_build_object('error','the forecast requires same-tenant evidence independently verified by someone other than the analyst');
  end if;
  begin
    v_baseline_cost:=(p_profile->>'baselineCost')::numeric; v_baseline_duration:=(p_profile->>'baselineDurationDays')::numeric;
    v_complexity:=(p_profile->>'complexityRating')::int; v_novelty:=(p_profile->>'technologyNoveltyRating')::int;
    v_geography:=lower(btrim(p_profile->>'geography')); v_strategy:=lower(btrim(p_profile->>'executionStrategy'));
    if v_baseline_cost<=0 or v_baseline_duration<=0 or v_complexity not between 1 and 5 or v_novelty not between 1 and 5
       or v_geography='' or v_strategy='' then raise exception 'invalid profile'; end if;
  exception when others then return jsonb_build_object('error','baseline cost and duration plus valid size, complexity, geography, technology novelty and execution strategy normalization inputs are required'); end;
  v_size:=case when v_baseline_cost<1000000 then 'small' when v_baseline_cost<10000000 then 'medium' when v_baseline_cost<100000000 then 'large' else 'mega' end;
  p_minimum_sample:=greatest(coalesce(p_minimum_sample,5),5);
  with corpus as (
    select e.project_actual_cost/e.project_baseline_cost cost_ratio,
      e.project_actual_duration_days/e.project_baseline_duration_days duration_ratio
    from public.learning_events e join public.development_cases h on h.id=e.development_case_id and h.organization_id=v_org
    where e.organization_id=v_org and e.event_type='project_outcome' and h.status='completed'
      and h.lifecycle_type=c.lifecycle_type and e.project_currency=v_currency
      and case when e.project_baseline_cost<1000000 then 'small' when e.project_baseline_cost<10000000 then 'medium' when e.project_baseline_cost<100000000 then 'large' else 'mega' end=v_size
      and e.project_complexity_rating between greatest(1,v_complexity-1) and least(5,v_complexity+1)
      and lower(e.project_geography)=v_geography and e.project_technology_novelty_rating between greatest(1,v_novelty-1) and least(5,v_novelty+1)
      and lower(e.project_execution_strategy)=v_strategy
      and e.development_case_id<>p_case_id
  )
  select count(*)::int,percentile_cont(.5) within group(order by cost_ratio),percentile_cont(.8) within group(order by cost_ratio),
    percentile_cont(.5) within group(order by duration_ratio),percentile_cont(.8) within group(order by duration_ratio)
  into v_n,v_cost_p50,v_cost_p80,v_duration_p50,v_duration_p80 from corpus;
  if v_n<p_minimum_sample then
    v_refusals:=jsonb_build_array(format('Only %s comparable completed project(s) exist; at least %s are required. No pattern, reference-class forecast or benchmark is claimed.',v_n,p_minimum_sample));
    insert into public.calculation_runs(organization_id,development_case_id,calculation_key,method,code_version,inputs,input_refs,outputs,refusals,status,computed_by)
    values(v_org,c.id,'project_assurance_reference_class','Same-tenant lifecycle-type reference class with normalized cost and duration ratios and a hard thin-history refusal.',
      'd5.10-12-v1',jsonb_build_object('forecastCost',p_forecast_cost,'forecastDurationDays',p_forecast_duration_days,'currency',v_currency,'profile',p_profile,'minimumSample',p_minimum_sample),
      jsonb_build_array(jsonb_build_object('table','evidence_items','id',p_evidence_item_id)),null,v_refusals,'refused',auth.uid()) returning id into v_run;
    return jsonb_build_object('calculationRunId',v_run,'status','refused','sampleSize',v_n,'minimumSample',p_minimum_sample,
      'refusals',v_refusals,'operationalAuthorization',false);
  end if;
  select round(100.0*count(*) filter(where e.project_actual_cost/e.project_baseline_cost<=p_forecast_cost/v_baseline_cost)/v_n,1),
    round(100.0*count(*) filter(where e.project_actual_duration_days/e.project_baseline_duration_days<=p_forecast_duration_days/v_baseline_duration)/v_n,1),
    percentile_cont(.5) within group(order by e.startup_delay_days),percentile_cont(.5) within group(order by e.commissioning_defects),
    percentile_cont(.5) within group(order by e.safety_incident_rate),percentile_cont(.5) within group(order by e.startup_reliability_pct),
    percentile_cont(.5) within group(order by e.engineering_hours/(e.project_baseline_cost/1000000))
  into v_cost_percentile,v_duration_percentile,v_startup_delay,v_defects,v_safety,v_reliability,v_engineering_intensity
  from public.learning_events e join public.development_cases h on h.id=e.development_case_id and h.organization_id=v_org
  where e.organization_id=v_org and e.event_type='project_outcome' and h.status='completed'
    and h.lifecycle_type=c.lifecycle_type and e.project_currency=v_currency and e.development_case_id<>p_case_id
    and case when e.project_baseline_cost<1000000 then 'small' when e.project_baseline_cost<10000000 then 'medium' when e.project_baseline_cost<100000000 then 'large' else 'mega' end=v_size
    and e.project_complexity_rating between greatest(1,v_complexity-1) and least(5,v_complexity+1)
    and lower(e.project_geography)=v_geography and e.project_technology_novelty_rating between greatest(1,v_novelty-1) and least(5,v_novelty+1)
    and lower(e.project_execution_strategy)=v_strategy;

  select count(*) filter(where e.engineering_maturity_at_execution_pct<80),count(*) filter(where e.engineering_maturity_at_execution_pct>=80),
    avg(e.project_actual_duration_days/e.project_baseline_duration_days) filter(where e.engineering_maturity_at_execution_pct<80),
    avg(e.project_actual_duration_days/e.project_baseline_duration_days) filter(where e.engineering_maturity_at_execution_pct>=80),
    count(*) filter(where e.unresolved_vendor_data_at_gate>0),count(*) filter(where e.unresolved_vendor_data_at_gate=0),
    avg(e.commissioning_defects) filter(where e.unresolved_vendor_data_at_gate>0),avg(e.commissioning_defects) filter(where e.unresolved_vendor_data_at_gate=0)
  into v_low_n,v_high_n,v_low_schedule,v_high_schedule,v_vendor_n,v_clear_n,v_vendor_defects,v_clear_defects
  from public.learning_events e join public.development_cases h on h.id=e.development_case_id and h.organization_id=v_org
  where e.organization_id=v_org and e.event_type='project_outcome' and h.status='completed'
    and h.lifecycle_type=c.lifecycle_type and e.project_currency=v_currency and e.development_case_id<>p_case_id;
  if v_low_n>=3 and v_high_n>=3 then
    v_patterns:=v_patterns||jsonb_build_array(jsonb_build_object('signal','engineering_maturity_at_execution','threshold','80%',
      'lowerMaturitySample',v_low_n,'higherMaturitySample',v_high_n,'lowerMaturityMeanScheduleGrowthPct',round((v_low_schedule-1)*100,1),
      'higherMaturityMeanScheduleGrowthPct',round((v_high_schedule-1)*100,1),'associationNotCausation',true));
  else v_pattern_refusals:=v_pattern_refusals||jsonb_build_array('Engineering-maturity pattern withheld: each side of the 80% threshold requires at least 3 completed projects.'); end if;
  if v_vendor_n>=3 and v_clear_n>=3 then
    v_patterns:=v_patterns||jsonb_build_array(jsonb_build_object('signal','unresolved_vendor_data_at_gate','threshold','greater than zero',
      'exposedSample',v_vendor_n,'clearSample',v_clear_n,'exposedMeanCommissioningDefects',round(v_vendor_defects,1),
      'clearMeanCommissioningDefects',round(v_clear_defects,1),'associationNotCausation',true));
  else v_pattern_refusals:=v_pattern_refusals||jsonb_build_array('Vendor-data pattern withheld: exposed and clear cohorts each require at least 3 completed projects.'); end if;
  v_refusals:=v_pattern_refusals;
  v_outputs:=jsonb_build_object(
    'sampleSize',v_n,'minimumSample',p_minimum_sample,'referenceClass',jsonb_build_object('lifecycleType',c.lifecycle_type,'currency',v_currency,
      'sizeBand',v_size,'complexityWithinOneOf',v_complexity,'geography',v_geography,'technologyNoveltyWithinOneOf',v_novelty,'executionStrategy',v_strategy),
    'normalizedBenchmark',jsonb_build_object('teamForecastCostPercentile',v_cost_percentile,'teamForecastDurationPercentile',v_duration_percentile,
      'medianStartupDelayDays',round(v_startup_delay,1),'medianCommissioningDefects',round(v_defects,1),'medianSafetyIncidentRate',round(v_safety,3),
      'medianStartupReliabilityPct',round(v_reliability,1),'medianEngineeringHoursPerMillionBaseline',round(v_engineering_intensity,1),
      'normalization','Size band, complexity, geography, project class, technology novelty and execution strategy matched; cost and schedule compared as growth against each project original baseline; no cross-tenant or external benchmark data.'),
    'referenceForecast',jsonb_build_object('teamCostGrowthPct',round((p_forecast_cost/v_baseline_cost-1)*100,1),'teamDurationGrowthPct',round((p_forecast_duration_days/v_baseline_duration-1)*100,1),
      'costP50',round(v_baseline_cost*v_cost_p50,2),'costP80',round(v_baseline_cost*v_cost_p80,2),
      'durationDaysP50',round(v_baseline_duration*v_duration_p50,1),'durationDaysP80',round(v_baseline_duration*v_duration_p80,1)),
    'assurancePatterns',v_patterns,'patternRefusals',v_pattern_refusals,
    'recommendationOnly',true,'operationalAuthorization',false,
    'method','Same-tenant completed projects with the same lifecycle type and currency; outcomes normalized to their own original baselines before percentile comparison.');
  insert into public.calculation_runs(organization_id,development_case_id,calculation_key,method,code_version,inputs,input_refs,outputs,refusals,status,computed_by)
  values(v_org,c.id,'project_assurance_reference_class','Same-tenant lifecycle-type reference class with normalized cost and duration ratios and a hard thin-history refusal.',
    'd5.10-12-v1',jsonb_build_object('forecastCost',p_forecast_cost,'forecastDurationDays',p_forecast_duration_days,'currency',v_currency,'profile',p_profile,'minimumSample',p_minimum_sample),
    jsonb_build_array(jsonb_build_object('table','evidence_items','id',p_evidence_item_id,'role','target_forecast_basis'))||coalesce((select jsonb_agg(jsonb_build_object('table','learning_events','id',e.id,'evidenceItemId',e.project_outcome_evidence_id,
      'baselineCost',e.project_baseline_cost,'actualCost',e.project_actual_cost,
      'baselineDurationDays',e.project_baseline_duration_days,'actualDurationDays',e.project_actual_duration_days,
      'costRatio',round(e.project_actual_cost/e.project_baseline_cost,6),
      'durationRatio',round(e.project_actual_duration_days/e.project_baseline_duration_days,6),
      'complexityRating',e.project_complexity_rating,'geography',e.project_geography,
      'technologyNoveltyRating',e.project_technology_novelty_rating,'executionStrategy',e.project_execution_strategy,
      'engineeringMaturityAtExecutionPct',e.engineering_maturity_at_execution_pct,
      'unresolvedVendorDataAtGate',e.unresolved_vendor_data_at_gate,'commissioningDefects',e.commissioning_defects,
      'startupDelayDays',e.startup_delay_days,'safetyIncidentRate',e.safety_incident_rate,
      'startupReliabilityPct',e.startup_reliability_pct,'engineeringHours',e.engineering_hours,
      'includedInReferenceClass',(case when e.project_baseline_cost<1000000 then 'small' when e.project_baseline_cost<10000000 then 'medium' when e.project_baseline_cost<100000000 then 'large' else 'mega' end=v_size
        and e.project_complexity_rating between greatest(1,v_complexity-1) and least(5,v_complexity+1)
        and lower(e.project_geography)=v_geography and e.project_technology_novelty_rating between greatest(1,v_novelty-1) and least(5,v_novelty+1)
        and lower(e.project_execution_strategy)=v_strategy)) order by e.id)
      from public.learning_events e join public.development_cases h on h.id=e.development_case_id
      where e.organization_id=v_org and e.event_type='project_outcome' and h.status='completed' and h.lifecycle_type=c.lifecycle_type and e.project_currency=v_currency),'[]'::jsonb),
    v_outputs,v_refusals,case when jsonb_array_length(v_refusals)>0 then 'computed_with_refusals' else 'computed' end,auth.uid()) returning id into v_run;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values
    (v_org,'project_assurance_reference_class_run',v_role,jsonb_build_object('calculation_run_id',v_run,'development_case_id',c.id,'sample_size',v_n,'operational_authorization',false));
  return v_outputs||jsonb_build_object('calculationRunId',v_run,'status',case when jsonb_array_length(v_refusals)>0 then 'computed_with_refusals' else 'computed' end,'refusals',v_refusals);
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.get_project_assurance_workspace()
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','forbidden');
  end if;
  return jsonb_build_object(
    'cases',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status,
      'lifecycleType',c.lifecycle_type,'outcomeRecorded',exists(select 1 from public.learning_events e
        where e.organization_id=v_org and e.development_case_id=c.id and e.event_type='project_outcome'))
      order by c.status,c.title) from public.development_cases c where c.organization_id=v_org),'[]'::jsonb),
    'verifiedEvidence',coalesce((select jsonb_agg(x.item order by x.verified_at desc) from (
      select jsonb_build_object('id',e.id,'description',e.description,'verifiedAt',e.verified_at) item,e.verified_at
      from public.evidence_items e where e.organization_id=v_org and e.verification_status='verified' and e.verified_by is distinct from auth.uid()
      order by e.verified_at desc limit 100) x),'[]'::jsonb),
    'minimumSample',5,
    'decisionBoundary','Patterns, reference forecasts and normalized benchmarks are advisory evidence. Funding, sanction, risk acceptance and operational authorization remain named-human decisions.');
end $$;

grant execute on function public.record_verified_project_outcome(uuid,uuid,jsonb) to authenticated;
grant execute on function public.run_project_assurance_reference_class(uuid,numeric,numeric,text,uuid,jsonb,int) to authenticated;
grant execute on function public.get_project_assurance_workspace() to authenticated;

-- ============================================================================
-- E5.08 / E5.10 / E5.11 — governed model-performance monitoring.
--
-- The canonical model_register, model_predictions and model_input_snapshots
-- already exist. This slice makes them customer-operable without creating a
-- second model or prediction store:
--   * named humans capture evidence-backed, immutable distribution snapshots;
--   * the server compares an exact model version's reference/current inputs,
--     recorded outcomes and non-personal operational cohorts;
--   * every assessment records the exact input digests it consumed; and
--   * a different named human decides whether to accept the evidence, require
--     revalidation or retire the model. Detection grants no operational
--     authority and never silently changes an approved model.
-- ============================================================================

alter table public.model_input_snapshots
  add column if not exists model_register_id bigint
    references public.model_register(id) on delete restrict,
  add column if not exists window_start date,
  add column if not exists window_end date,
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists captured_by uuid references auth.users(id) on delete restrict,
  add column if not exists captured_at timestamptz not null default now(),
  add column if not exists distribution_checksum text;

create unique index if not exists idx_model_input_snapshot_version_label
  on public.model_input_snapshots(
    organization_id,model_register_id,feature,snapshot_label
  ) where model_register_id is not null;

create table if not exists public.model_monitoring_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_register_id bigint not null references public.model_register(id) on delete restrict,
  reference_snapshot_id bigint not null
    references public.model_input_snapshots(id) on delete restrict,
  current_snapshot_id bigint not null
    references public.model_input_snapshots(id) on delete restrict,
  feature text not null,
  reference_checksum text not null,
  current_checksum text not null,
  prediction_snapshot_checksum text not null,
  prediction_count integer not null check(prediction_count>=0),
  outcome_count integer not null check(outcome_count>=0),
  cohort_count integer not null check(cohort_count>=0),
  psi numeric,
  drift_status text not null check(drift_status in
    ('not_measurable','none','moderate','significant')),
  brier_score numeric,
  climatology_brier numeric,
  skill_score numeric,
  calibration_status text not null check(calibration_status in
    ('not_measurable','insufficient_outcomes','degenerate_outcomes','underperforming','monitored')),
  cohort_metrics jsonb not null default '[]'::jsonb
    check(jsonb_typeof(cohort_metrics)='array'),
  maximum_cohort_brier_gap numeric,
  maximum_cohort_outcome_rate_gap numeric,
  bias_screen_status text not null check(bias_screen_status in
    ('not_measurable','no_material_disparity','review_required')),
  alert_status text not null check(alert_status in
    ('no_alert','insufficient_evidence','review_required')),
  thresholds jsonb not null check(jsonb_typeof(thresholds)='object'),
  assessment_basis text not null check(length(btrim(assessment_basis))>=20),
  assessed_by uuid not null references auth.users(id) on delete restrict,
  assessed_at timestamptz not null default now(),
  check(reference_snapshot_id<>current_snapshot_id)
);

create index if not exists idx_model_monitoring_assessment_model
  on public.model_monitoring_assessments(
    organization_id,model_register_id,assessed_at desc
  );

create table if not exists public.model_monitoring_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null unique
    references public.model_monitoring_assessments(id) on delete restrict,
  decision text not null check(decision in
    ('accepted_no_change','require_revalidation','retire')),
  review_note text not null check(length(btrim(review_note))>=20),
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now()
);

alter table public.model_monitoring_assessments enable row level security;
alter table public.model_monitoring_reviews enable row level security;
drop policy if exists model_monitoring_assessment_read on public.model_monitoring_assessments;
create policy model_monitoring_assessment_read on public.model_monitoring_assessments
  for select to authenticated using(organization_id=public.app_current_org());
drop policy if exists model_monitoring_review_read on public.model_monitoring_reviews;
create policy model_monitoring_review_read on public.model_monitoring_reviews
  for select to authenticated using(organization_id=public.app_current_org());

revoke insert,update,delete,truncate on public.model_input_snapshots,
  public.model_monitoring_assessments,public.model_monitoring_reviews
  from anon,authenticated,service_role;
grant select on public.model_input_snapshots,public.model_monitoring_assessments,
  public.model_monitoring_reviews to authenticated;

create or replace function public.protect_model_monitoring_records()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.organizations where id=old.organization_id) then
      return old;
    end if;
    raise exception 'model monitoring evidence is retained and cannot be deleted';
  end if;
  if coalesce(current_setting('app.model_monitoring_write',true),'')<>'granted'
     or auth.uid() is null then
    raise exception 'model monitoring evidence is written only by the governed named-human workflow';
  end if;
  if tg_op='UPDATE' then
    raise exception 'model monitoring evidence is immutable; record a later snapshot, assessment or review';
  end if;
  if new.organization_id is distinct from public.app_current_org() then
    raise exception 'model monitoring evidence must remain inside the current organization';
  end if;
  return new;
end
$$;
revoke all on function public.protect_model_monitoring_records()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_protect_model_input_snapshots on public.model_input_snapshots;
create trigger trg_protect_model_input_snapshots
  before insert or update or delete on public.model_input_snapshots
  for each row execute function public.protect_model_monitoring_records();
drop trigger if exists trg_protect_model_monitoring_assessments on public.model_monitoring_assessments;
create trigger trg_protect_model_monitoring_assessments
  before insert or update or delete on public.model_monitoring_assessments
  for each row execute function public.protect_model_monitoring_records();
drop trigger if exists trg_protect_model_monitoring_reviews on public.model_monitoring_reviews;
create trigger trg_protect_model_monitoring_reviews
  before insert or update or delete on public.model_monitoring_reviews
  for each row execute function public.protect_model_monitoring_records();

create or replace function public.capture_model_input_snapshot(
  p_model_register_id bigint,p_feature text,p_snapshot_label text,
  p_window_start date,p_window_end date,p_distribution jsonb,
  p_is_reference boolean,p_evidence_item_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org(); v_uid uuid:=auth.uid();
  v_role text; m public.model_register%rowtype; v_id bigint;
  v_bucket text; v_value jsonb; v_total numeric:=0; v_checksum text;
begin
  select role into v_role from public.user_profiles
  where id=v_uid and organization_id=v_org;
  if v_uid is null or coalesce(v_role,'')='ai_admin' or coalesce(v_role,'') not in
     ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error',
      'model input snapshots require an authorized named human governance or reliability role');
  end if;
  select * into m from public.model_register
  where id=p_model_register_id and organization_id=v_org and lifecycle_state<>'retired';
  if not found then return jsonb_build_object('error','active model version not found in this organization'); end if;
  if coalesce(p_feature,'')!~'^[a-z][a-z0-9_]{1,63}$' then
    return jsonb_build_object('error','feature must be a stable lowercase identifier');
  end if;
  if length(btrim(coalesce(p_snapshot_label,'')))<3 then
    return jsonb_build_object('error','snapshot label requires at least three characters');
  end if;
  if p_window_start is null or p_window_end is null or p_window_start>p_window_end
     or p_window_end>current_date then
    return jsonb_build_object('error','snapshot window must be complete, ordered and not in the future');
  end if;
  if jsonb_typeof(coalesce(p_distribution,'null'::jsonb))<>'object' then
    return jsonb_build_object('error','distribution must be a named bucket object');
  end if;
  if (select count(*) from jsonb_object_keys(p_distribution))<2 then
    return jsonb_build_object('error','distribution requires at least two named buckets');
  end if;
  for v_bucket,v_value in select key,value from jsonb_each(p_distribution) loop
    if length(btrim(v_bucket))<1 or jsonb_typeof(v_value)<>'number'
       or (v_value#>>'{}')::numeric<0 then
      return jsonb_build_object('error','every distribution bucket requires a non-negative numeric count');
    end if;
    v_total:=v_total+(v_value#>>'{}')::numeric;
  end loop;
  if v_total<=0 then return jsonb_build_object('error','distribution total must be greater than zero'); end if;
  if p_evidence_item_id is null or not exists(select 1 from public.evidence_items e
    where e.id=p_evidence_item_id and e.organization_id=v_org
      and e.verification_status='verified') then
    return jsonb_build_object('error','same-tenant independently verified canonical evidence is required');
  end if;
  v_checksum:=encode(digest(p_distribution::text,'sha256'),'hex');
  perform set_config('app.model_monitoring_write','granted',true);
  insert into public.model_input_snapshots(organization_id,model_key,feature,
    snapshot_label,taken_on,distribution,is_reference,model_register_id,
    window_start,window_end,evidence_item_id,captured_by,distribution_checksum)
  values(v_org,m.model_key,p_feature,btrim(p_snapshot_label),p_window_end,
    p_distribution,coalesce(p_is_reference,false),m.id,p_window_start,p_window_end,
    p_evidence_item_id,v_uid,v_checksum)
  returning id into v_id;
  perform set_config('app.model_monitoring_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'model_input_snapshot',v_role,jsonb_build_object(
    'snapshotId',v_id,'modelRegisterId',m.id,'modelKey',m.model_key,
    'modelVersion',m.version,'feature',p_feature,'evidenceItemId',p_evidence_item_id,
    'humanRecorded',true),jsonb_build_object('checksum',v_checksum,
    'windowStart',p_window_start,'windowEnd',p_window_end,
    'reference',coalesce(p_is_reference,false),'sampleCount',v_total));
  return jsonb_build_object('snapshotId',v_id,'modelRegisterId',m.id,
    'checksum',v_checksum,'sampleCount',v_total,'reference',coalesce(p_is_reference,false));
exception when unique_violation then
  perform set_config('app.model_monitoring_write','',true);
  return jsonb_build_object('error','that model version, feature and snapshot label already exist');
when others then
  perform set_config('app.model_monitoring_write','',true); raise;
end
$$;
revoke all on function public.capture_model_input_snapshot(bigint,text,text,date,date,jsonb,boolean,uuid)
  from public,anon,service_role;
grant execute on function public.capture_model_input_snapshot(bigint,text,text,date,date,jsonb,boolean,uuid)
  to authenticated;

create or replace function public.run_model_performance_assessment(
  p_model_register_id bigint,p_reference_snapshot_id bigint,
  p_current_snapshot_id bigint,p_assessment_basis text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org(); v_uid uuid:=auth.uid(); v_role text;
  m public.model_register%rowtype; r public.model_input_snapshots%rowtype;
  c public.model_input_snapshots%rowtype; v_bucket text;
  v_ref_total numeric; v_cur_total numeric; v_expected numeric; v_actual numeric;
  v_psi numeric:=0; v_drift text; v_prediction_count integer:=0;
  v_outcome_count integer:=0; v_base_rate numeric; v_brier numeric;
  v_climatology numeric; v_skill numeric; v_calibration text;
  v_cohort_count integer:=0; v_cohort_metrics jsonb:='[]'::jsonb;
  v_brier_gap numeric; v_rate_gap numeric; v_bias text; v_alert text;
  v_prediction_checksum text; v_id uuid;
begin
  select role into v_role from public.user_profiles
  where id=v_uid and organization_id=v_org;
  if v_uid is null or coalesce(v_role,'')='ai_admin' or coalesce(v_role,'') not in
     ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error',
      'model monitoring assessments require an authorized named human governance or reliability role');
  end if;
  if length(btrim(coalesce(p_assessment_basis,'')))<20 then
    return jsonb_build_object('error','assessment basis requires at least 20 characters');
  end if;
  select * into m from public.model_register
  where id=p_model_register_id and organization_id=v_org and lifecycle_state<>'retired';
  if not found then return jsonb_build_object('error','active model version not found in this organization'); end if;
  select * into r from public.model_input_snapshots
  where id=p_reference_snapshot_id and organization_id=v_org
    and model_register_id=m.id and is_reference;
  if not found then return jsonb_build_object('error','reference snapshot not found for this exact model version'); end if;
  select * into c from public.model_input_snapshots
  where id=p_current_snapshot_id and organization_id=v_org
    and model_register_id=m.id and not is_reference;
  if not found then return jsonb_build_object('error','current snapshot not found for this exact model version'); end if;
  if r.feature<>c.feature then return jsonb_build_object('error','reference and current snapshots must describe the same feature'); end if;
  if c.window_start<=r.window_end then
    return jsonb_build_object('error','current monitoring window must begin after the reference window ends');
  end if;
  select sum((value#>>'{}')::numeric) into v_ref_total from jsonb_each(r.distribution);
  select sum((value#>>'{}')::numeric) into v_cur_total from jsonb_each(c.distribution);
  if coalesce(v_ref_total,0)<=0 or coalesce(v_cur_total,0)<=0 then
    return jsonb_build_object('error','both snapshot distributions require positive sample totals');
  end if;
  for v_bucket in
    select bucket from jsonb_object_keys(r.distribution) as ref(bucket)
    union select bucket from jsonb_object_keys(c.distribution) as cur(bucket)
  loop
    v_expected:=greatest(coalesce((r.distribution->>v_bucket)::numeric,0)/v_ref_total,0.0001);
    v_actual:=greatest(coalesce((c.distribution->>v_bucket)::numeric,0)/v_cur_total,0.0001);
    v_psi:=v_psi+(v_actual-v_expected)*ln(v_actual/v_expected);
  end loop;
  v_drift:=case when v_psi<0.1 then 'none' when v_psi<0.25 then 'moderate' else 'significant' end;

  select count(*),count(*) filter(where p.outcome is not null),
    avg(power(p.predicted_probability-(case when p.outcome then 1 else 0 end),2))
      filter(where p.outcome is not null),
    avg((case when p.outcome then 1 else 0 end)::numeric)
      filter(where p.outcome is not null),
    encode(digest(coalesce(string_agg(concat_ws(':',p.id,p.predicted_at,
      p.predicted_probability,p.outcome,p.outcome_recorded_at,
      coalesce(p.cohort_context->>'monitoringCohort','')),'|' order by p.id),''),'sha256'),'hex')
  into v_prediction_count,v_outcome_count,v_brier,v_base_rate,v_prediction_checksum
  from public.model_predictions p
  where p.organization_id=v_org and p.model_register_id=m.id
    and p.predicted_probability is not null
    and p.predicted_at::date between c.window_start and c.window_end;
  if v_outcome_count<30 then
    v_calibration:=case when v_outcome_count=0 then 'not_measurable' else 'insufficient_outcomes' end;
    v_brier:=null; v_climatology:=null; v_skill:=null;
  else
    v_climatology:=v_base_rate*(1-v_base_rate);
    if v_climatology=0 then
      v_calibration:='degenerate_outcomes'; v_skill:=null;
    else
      v_skill:=1-(v_brier/v_climatology);
      v_calibration:=case when v_skill<=0 then 'underperforming' else 'monitored' end;
    end if;
  end if;

  with cohort_source as (
    select coalesce(nullif(btrim(p.cohort_context->>'monitoringCohort'),''),a.asset_class) cohort,
      p.predicted_probability,(case when p.outcome then 1 else 0 end)::numeric observed
    from public.model_predictions p
    left join public.assets a on a.id=p.subject_asset_id and a.organization_id=p.organization_id
    where p.organization_id=v_org and p.model_register_id=m.id
      and p.predicted_probability is not null and p.outcome is not null
      and p.predicted_at::date between c.window_start and c.window_end
  ), cohort_summary as (
    select cohort,count(*) n,
      avg(power(predicted_probability-observed,2)) brier,
      avg(observed) outcome_rate
    from cohort_source where cohort is not null
    group by cohort having count(*)>=15
  )
  select count(*),coalesce(jsonb_agg(jsonb_build_object('cohort',cohort,
      'outcomes',n,'brierScore',brier,'outcomeRate',outcome_rate) order by cohort),'[]'::jsonb),
    max(brier)-min(brier),max(outcome_rate)-min(outcome_rate)
  into v_cohort_count,v_cohort_metrics,v_brier_gap,v_rate_gap from cohort_summary;
  if v_cohort_count<2 then
    v_bias:='not_measurable'; v_brier_gap:=null; v_rate_gap:=null;
  elsif v_brier_gap>=0.1 or v_rate_gap>=0.15 then
    v_bias:='review_required';
  else v_bias:='no_material_disparity'; end if;

  v_alert:=case
    when v_drift in ('moderate','significant') or v_calibration='underperforming'
      or v_bias='review_required' then 'review_required'
    when v_calibration not in ('monitored','underperforming') or v_bias='not_measurable'
      then 'insufficient_evidence'
    else 'no_alert' end;
  perform set_config('app.model_monitoring_write','granted',true);
  insert into public.model_monitoring_assessments(organization_id,model_register_id,
    reference_snapshot_id,current_snapshot_id,feature,reference_checksum,current_checksum,
    prediction_snapshot_checksum,prediction_count,outcome_count,cohort_count,psi,
    drift_status,brier_score,climatology_brier,skill_score,calibration_status,
    cohort_metrics,maximum_cohort_brier_gap,maximum_cohort_outcome_rate_gap,
    bias_screen_status,alert_status,thresholds,assessment_basis,assessed_by)
  values(v_org,m.id,r.id,c.id,r.feature,r.distribution_checksum,c.distribution_checksum,
    v_prediction_checksum,v_prediction_count,v_outcome_count,v_cohort_count,v_psi,
    v_drift,v_brier,v_climatology,v_skill,v_calibration,v_cohort_metrics,
    v_brier_gap,v_rate_gap,v_bias,v_alert,jsonb_build_object(
      'minimumCalibrationOutcomes',30,'minimumCohortOutcomes',15,
      'moderatePsi',0.1,'significantPsi',0.25,
      'cohortBrierGapReview',0.1,'cohortOutcomeRateGapReview',0.15,
      'basis','PSI thresholds are conventional screening bands; cohort gaps are conservative review triggers, not findings of unfairness.'),
    btrim(p_assessment_basis),v_uid)
  returning id into v_id;
  perform set_config('app.model_monitoring_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'model_performance_assessment',v_role,jsonb_build_object(
    'assessmentId',v_id,'modelRegisterId',m.id,'referenceSnapshotId',r.id,
    'currentSnapshotId',c.id,'humanInitiated',true,'operationalAuthorization',false),
    jsonb_build_object('driftStatus',v_drift,'calibrationStatus',v_calibration,
      'biasScreenStatus',v_bias,'alertStatus',v_alert,'predictionChecksum',v_prediction_checksum));
  return jsonb_build_object('assessmentId',v_id,'modelRegisterId',m.id,
    'driftStatus',v_drift,'psi',v_psi,'calibrationStatus',v_calibration,
    'skillScore',v_skill,'biasScreenStatus',v_bias,'alertStatus',v_alert,
    'humanReviewRequired',true,'operationalAuthorization',false);
exception when others then
  perform set_config('app.model_monitoring_write','',true); raise;
end
$$;
revoke all on function public.run_model_performance_assessment(bigint,bigint,bigint,text)
  from public,anon,service_role;
grant execute on function public.run_model_performance_assessment(bigint,bigint,bigint,text)
  to authenticated;

create or replace function public.review_model_performance_assessment(
  p_assessment_id uuid,p_decision text,p_review_note text,p_evidence_item_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org(); v_uid uuid:=auth.uid(); v_role text;
  a public.model_monitoring_assessments%rowtype; m public.model_register%rowtype;
  v_id uuid;
begin
  select role into v_role from public.user_profiles
  where id=v_uid and organization_id=v_org;
  if v_uid is null or coalesce(v_role,'')='ai_admin' or coalesce(v_role,'') not in
     ('admin','executive','reliability_engineer') then
    return jsonb_build_object('error',
      'model monitoring disposition requires an authorized named human governance or reliability approver');
  end if;
  if p_decision not in ('accepted_no_change','require_revalidation','retire') then
    return jsonb_build_object('error','select an allowed model monitoring disposition');
  end if;
  if length(btrim(coalesce(p_review_note,'')))<20 then
    return jsonb_build_object('error','independent review note requires at least 20 characters');
  end if;
  select * into a from public.model_monitoring_assessments
  where id=p_assessment_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','model monitoring assessment not found'); end if;
  if a.assessed_by=v_uid then
    return jsonb_build_object('error','the assessor cannot independently disposition the same assessment');
  end if;
  if exists(select 1 from public.model_monitoring_reviews where assessment_id=a.id) then
    return jsonb_build_object('error','that model monitoring assessment already has a retained disposition');
  end if;
  if p_evidence_item_id is null or not exists(select 1 from public.evidence_items e
    where e.id=p_evidence_item_id and e.organization_id=v_org
      and e.verification_status='verified') then
    return jsonb_build_object('error','independent disposition requires same-tenant verified canonical evidence');
  end if;
  select * into m from public.model_register
  where id=a.model_register_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','governed model version not found'); end if;
  if p_decision='require_revalidation' and m.lifecycle_state<>'production_eligible' then
    return jsonb_build_object('error','only a production-eligible model can be moved into revalidation');
  end if;
  if p_decision='retire' and m.lifecycle_state='retired' then
    return jsonb_build_object('error','model version is already retired');
  end if;
  perform set_config('app.model_monitoring_write','granted',true);
  insert into public.model_monitoring_reviews(organization_id,assessment_id,decision,
    review_note,evidence_item_id,reviewed_by)
  values(v_org,a.id,p_decision,btrim(p_review_note),p_evidence_item_id,v_uid)
  returning id into v_id;
  perform set_config('app.model_monitoring_write','',true);
  if p_decision in ('require_revalidation','retire') then
    perform set_config('app.model_registry_governed_write','granted',true);
    update public.model_register set
      lifecycle_state=case when p_decision='retire' then 'retired' else 'revalidation_required' end,
      production_eligible=false,current_for_decisions=false,approved_on=null,approved_by=null,
      approval_status=case when p_decision='retire' then 'retired' else 'revalidation_required' end,
      revalidation_started_at=case when p_decision='require_revalidation' then now() else revalidation_started_at end,
      revalidation_reason=case when p_decision='require_revalidation' then btrim(p_review_note) else revalidation_reason end,
      retired_at=case when p_decision='retire' then now() else retired_at end,
      reviewed_at=now(),review_basis=btrim(p_review_note)
    where id=m.id and organization_id=v_org;
    perform set_config('app.model_registry_governed_write','',true);
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'model_performance_review',v_role,jsonb_build_object(
    'reviewId',v_id,'assessmentId',a.id,'modelRegisterId',m.id,
    'evidenceItemId',p_evidence_item_id,'independentHumanReview',true),
    jsonb_build_object('lifecycleState',m.lifecycle_state,'alertStatus',a.alert_status),
    jsonb_build_object('decision',p_decision,'lifecycleState',case
      when p_decision='retire' then 'retired'
      when p_decision='require_revalidation' then 'revalidation_required'
      else m.lifecycle_state end,'operationalAuthorization',false));
  return jsonb_build_object('reviewId',v_id,'assessmentId',a.id,'decision',p_decision,
    'modelRegisterId',m.id,'lifecycleState',case
      when p_decision='retire' then 'retired'
      when p_decision='require_revalidation' then 'revalidation_required'
      else m.lifecycle_state end,'operationalAuthorization',false);
exception when others then
  perform set_config('app.model_monitoring_write','',true);
  perform set_config('app.model_registry_governed_write','',true); raise;
end
$$;
revoke all on function public.review_model_performance_assessment(uuid,text,text,uuid)
  from public,anon,service_role;
grant execute on function public.review_model_performance_assessment(uuid,text,text,uuid)
  to authenticated;

create or replace function public.get_model_monitoring_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authenticated organization required');
  end if;
  return jsonb_build_object(
    'boundary','Monitoring compares an exact registered model version with retained evidence. Drift and cohort gaps are screening alerts, not proof of causation or unfairness. Only a different named human can require revalidation or retirement; no monitoring result authorizes operational action.',
    'models',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'modelKey',m.model_key,'version',m.version,
      'name',coalesce(m.manifest->>'name',m.model_key),
      'lifecycleState',m.lifecycle_state,'productionEligible',m.production_eligible)
      order by m.model_key,m.version)
      from public.model_register m where m.organization_id=v_org),'[]'::jsonb),
    'snapshots',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'modelRegisterId',s.model_register_id,'feature',s.feature,
      'label',s.snapshot_label,'windowStart',s.window_start,'windowEnd',s.window_end,
      'distribution',s.distribution,'reference',s.is_reference,
      'checksum',s.distribution_checksum,'evidenceItemId',s.evidence_item_id,
      'capturedBy',s.captured_by,'capturedAt',s.captured_at)
      order by s.captured_at desc,s.id desc)
      from public.model_input_snapshots s where s.organization_id=v_org
        and s.model_register_id is not null),'[]'::jsonb),
    'assessments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'modelRegisterId',a.model_register_id,'feature',a.feature,
      'referenceSnapshotId',a.reference_snapshot_id,'currentSnapshotId',a.current_snapshot_id,
      'psi',a.psi,'driftStatus',a.drift_status,'brierScore',a.brier_score,
      'skillScore',a.skill_score,'calibrationStatus',a.calibration_status,
      'predictionCount',a.prediction_count,'outcomeCount',a.outcome_count,
      'cohortCount',a.cohort_count,'cohortMetrics',a.cohort_metrics,
      'maximumCohortBrierGap',a.maximum_cohort_brier_gap,
      'maximumCohortOutcomeRateGap',a.maximum_cohort_outcome_rate_gap,
      'biasScreenStatus',a.bias_screen_status,'alertStatus',a.alert_status,
      'thresholds',a.thresholds,'assessmentBasis',a.assessment_basis,
      'assessedBy',a.assessed_by,'assessedAt',a.assessed_at,
      'review',case when rv.id is null then null else jsonb_build_object(
        'id',rv.id,'decision',rv.decision,'note',rv.review_note,
        'evidenceItemId',rv.evidence_item_id,'reviewedBy',rv.reviewed_by,
        'reviewedAt',rv.reviewed_at) end)
      order by a.assessed_at desc)
      from public.model_monitoring_assessments a
      left join public.model_monitoring_reviews rv on rv.assessment_id=a.id
      where a.organization_id=v_org),'[]'::jsonb),
    'openOutcomes',coalesce((select jsonb_agg(jsonb_build_object(
      'calculationRunId',r.id,'modelRegisterId',r.model_register_id,
      'modelKey',m.model_key,'modelVersion',m.version,'assetId',r.asset_id,
      'computedAt',r.computed_at,'predictedProbability',r.outputs->'predictedProbability',
      'horizonDays',r.outputs->'horizonDays') order by r.computed_at desc)
      from public.calculation_runs r join public.model_register m on m.id=r.model_register_id
      where r.organization_id=v_org and r.status='computed'
        and not exists(select 1 from public.model_predictions p
          where p.organization_id=v_org and p.calculation_run_id=r.id)),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'description',coalesce(e.description,e.evidence_type,e.id::text),
      'sourceSystem',e.source_system,'qualityGrade',e.quality_grade)
      order by e.created_at desc) from (select * from public.evidence_items
        where organization_id=v_org and verification_status='verified'
        order by created_at desc limit 150) e),'[]'::jsonb)
  );
end
$$;
revoke all on function public.get_model_monitoring_workspace() from public,anon;
grant execute on function public.get_model_monitoring_workspace() to authenticated;

comment on table public.model_monitoring_assessments is
  'E5.08/E5.11 immutable exact-version monitoring output with snapshot and prediction digests. It is evidence for human review, never operating authority.';
comment on function public.review_model_performance_assessment(uuid,text,text,uuid) is
  'A different named human dispositions a retained monitoring assessment. Revalidation and retirement are conservative model-governance acts, not plant authority.';

notify pgrst,'reload schema';

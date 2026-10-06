-- Complete-chain CI baseline only. Native fixtures and all writes roll back.
-- No disabled guard, customer/seed mutation or operational approval.
begin;
-- U18 FIXTURE SEED BEGIN
create temporary table u18_fixture as select
  gen_random_uuid() as org, gen_random_uuid() as foreign_org,
  gen_random_uuid() as author, gen_random_uuid() as reviewer,
  gen_random_uuid() as foreign_user, gen_random_uuid() as criteria,
  gen_random_uuid() as risk, gen_random_uuid() as other_risk,
  gen_random_uuid() as verified, gen_random_uuid() as unverified,
  gen_random_uuid() as wrong_risk,
  '{"method":"Three-point bounded estimate",
    "basis":"Synthetic CI inspection history and bounded assumptions, not customer engineering evidence.",
    "probability_lower":0.15,"probability_central":0.30,"probability_upper":0.55,
    "confidence_level":0.90,"confidence_interval_lower":0.10,"confidence_interval_upper":0.60,
    "best_case_loss":10000,"expected_case_loss":60000,"worst_case_loss":250000,"currency":"CAD",
    "sensitivity":[{"name":"Startup exposure","basis":"Synthetic CI startup and inspection history for this exact risk.",
      "low_input":2,"base_input":5,"high_input":8,"low_output":10000,"base_output":60000,"high_output":180000}],
    "reassessment_triggers":["Two startups occur inside one operating shift"],
    "voi_action":"Inspect the seal system during the next planned outage",
    "voi_information_cost":10000,"voi_decision_cost_if_wrong":250000,
    "voi_uncertainty_reduction":0.5,"voi_probability_decision_changes":0.3}'::jsonb
    || jsonb_build_object('review_due_at',now()+interval '30 days') as input;
grant select on u18_fixture to authenticated;
insert into organizations(id,name,industry)
select org,'U18 isolated synthetic CI tenant','utilities' from u18_fixture
union all select foreign_org,'U18 isolated foreign CI tenant','utilities' from u18_fixture;
-- New random identities only; self_signup is absent. No existing user edits.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,
  email_change,email_change_token_new,email_change_token_current,phone_change,
  phone_change_token,reauthentication_token)
select '00000000-0000-0000-0000-000000000000'::uuid,uid,'authenticated','authenticated',
  uid||'@syncai-ci.invalid',extensions.crypt('U18Synthetic123!@#',extensions.gen_salt('bf')),
  now(),now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"U18 synthetic CI identity"}'::jsonb,'','','','','','','',''
from u18_fixture f cross join lateral (values(f.author),(f.reviewer),(f.foreign_user)) u(uid);
insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
select gen_random_uuid(),uid,uid::text,jsonb_build_object('sub',uid,'email',uid||'@syncai-ci.invalid'),
  'email',now(),now(),now()
from u18_fixture f cross join lateral (values(f.author),(f.reviewer),(f.foreign_user)) u(uid);
insert into user_profiles(id,organization_id,email,role)
select author,org,author||'@syncai-ci.invalid','admin' from u18_fixture
union all select reviewer,org,reviewer||'@syncai-ci.invalid','reliability_engineer' from u18_fixture
union all select foreign_user,foreign_org,foreign_user||'@syncai-ci.invalid','reliability_engineer' from u18_fixture;
-- Synthetic adopted thresholds required by U18, not customer policy.
insert into risk_criteria_profiles(id,organization_id,name,version,status,decision_thresholds,basis,adopted_by,adopted_at)
select criteria,org,'U18 synthetic threshold fixture',1,'adopted','{"escalateAbove":16,"stopAbove":24}',
  'Disposable acceptance fixture only, not engineering policy.',reviewer,now() from u18_fixture;
insert into risks(id,organization_id,criteria_profile_id,title,status,value_currency,created_by)
select risk,org,criteria,'U18 synthetic cooling risk','draft','CAD',author from u18_fixture
union all select other_risk,org,criteria,'U18 synthetic unrelated risk','draft','CAD',author from u18_fixture;
insert into evidence_items(id,organization_id,risk_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method,quality_grade,applicability_grade,revision)
select verified,org,risk,'CMMS','inspection','Synthetic verified inspection extract for the exact CI risk.',
  'INSPECTED','verified',reviewer,now(),'Synthetic independent inspection fixture','high','direct','R2' from u18_fixture
union all select unverified,org,risk,'interview','recollection','Synthetic unverified recollection.',
  'EXPERT_JUDGEMENT','unverified',null,null,null,'moderate','indirect','R1' from u18_fixture
union all select wrong_risk,org,other_risk,'CMMS','inspection','Synthetic verified evidence from another CI risk.',
  'INSPECTED','verified',reviewer,now(),'Synthetic independent inspection fixture','high','direct','R1' from u18_fixture;
-- U18 FIXTURE SEED END

create temporary table u18_packet(id uuid,digest text);
grant select,insert on u18_packet to authenticated;
-- Session-local test snapshot, not an application store or authority bypass.
create function pg_temp.u18_state() returns jsonb language sql as $$
 select jsonb_build_object(
   'risks',(select jsonb_agg(to_jsonb(r) order by r.id) from risks r where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'packets',(select jsonb_agg(to_jsonb(a) order by a.id) from risk_uncertainty_analyses a where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'bindings',(select jsonb_agg(to_jsonb(b) order by b.analysis_id,b.evidence_item_id) from risk_uncertainty_analysis_evidence b where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'approvals',(select jsonb_agg(to_jsonb(a) order by a.id) from approvals a where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'audit',(select jsonb_agg(to_jsonb(a) order by a.id) from audit_events a where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'evidence',(select jsonb_agg(to_jsonb(e) order by e.id) from evidence_items e where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'criteria',(select jsonb_agg(to_jsonb(c) order by c.id) from risk_criteria_profiles c where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'securityEvents',(select jsonb_agg(to_jsonb(s) order by s.id) from security_events s where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'decisions',(select jsonb_agg(to_jsonb(d) order by d.id) from decisions d where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'work',(select jsonb_agg(to_jsonb(w) order by w.id) from work_orders w where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'stakeholderViews',(select jsonb_agg(to_jsonb(sv) order by sv.id) from risk_stakeholder_views sv where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'scenarios',(select jsonb_agg(to_jsonb(s) order by s.id) from scenarios s where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))),
   'profiles',(select jsonb_agg(to_jsonb(p) order by p.id) from user_profiles p where organization_id in((select org from u18_fixture),(select foreign_org from u18_fixture))))
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',author::text,true) from u18_fixture;
-- U18 FINITE INPUT REFUSALS BEGIN
-- Additive cases use the same newly generated tenant and outer rollback.
-- Exact structured refusals and complete row snapshots precede the valid packet.
do $$ declare f record; result jsonb; baseline jsonb; bad jsonb;
  field text; special text; stamp text; attempts integer:=0; positive_accepted boolean; begin
  select * into f from u18_fixture;
  baseline:=pg_temp.u18_state();
  foreach field in array array['probability_lower','probability_central','probability_upper',
    'confidence_level','confidence_interval_lower','confidence_interval_upper',
    'best_case_loss','expected_case_loss','worst_case_loss',
    'voi_information_cost','voi_decision_cost_if_wrong','voi_uncertainty_reduction','voi_probability_decision_changes'] loop
    foreach special in array array['NaN','+Infinity','-Infinity'] loop
      bad:=jsonb_set(f.input,array[field],to_jsonb(special));
      result:=public.submit_risk_uncertainty_analysis(f.risk,bad,array[f.verified]);
      if result is distinct from jsonb_build_object('error',
          'probability, confidence, loss and value-of-information inputs must be finite numbers')
        or pg_temp.u18_state() is distinct from baseline then
        raise exception 'finite top-level numeric refusal or full no-artifact witness failed'; end if;
      attempts:=attempts+1;
    end loop;
  end loop;
  foreach field in array array['low_input','base_input','high_input','low_output','base_output','high_output'] loop
    foreach special in array array['NaN','+Infinity','-Infinity'] loop
      bad:=jsonb_set(f.input,array['sensitivity','0',field],to_jsonb(special));
      result:=public.submit_risk_uncertainty_analysis(f.risk,bad,array[f.verified]);
      if result is distinct from jsonb_build_object('error','sensitivity factor ranges must contain finite numbers')
        or pg_temp.u18_state() is distinct from baseline then
        raise exception 'finite sensitivity numeric refusal or full no-artifact witness failed'; end if;
      attempts:=attempts+1;
    end loop;
  end loop;
  for bad in select value from (values(null::jsonb),('null'::jsonb),('[]'::jsonb),
    ('"scalar"'::jsonb),('1'::jsonb),('true'::jsonb)) q(value) loop
    result:=public.submit_risk_uncertainty_analysis(f.risk,bad,array[f.verified]);
    if result is distinct from jsonb_build_object('error','uncertainty analysis must be an object')
      or pg_temp.u18_state() is distinct from baseline then
      raise exception 'top-level object refusal or full no-artifact witness failed'; end if;
    attempts:=attempts+1;
  end loop;
  for bad in select value from (values('null'::jsonb),('{}'::jsonb),('[]'::jsonb),
    ('"scalar"'::jsonb),('1'::jsonb),('true'::jsonb)) q(value) loop
    result:=public.submit_risk_uncertainty_analysis(f.risk,jsonb_set(f.input,'{sensitivity}',bad),array[f.verified]);
    if result is distinct from jsonb_build_object('error','record one to twenty sourced sensitivity factors')
      or pg_temp.u18_state() is distinct from baseline then
      raise exception 'sensitivity array refusal or full no-artifact witness failed'; end if;
    attempts:=attempts+1;
  end loop;
  for bad in select value from (values('null'::jsonb),('[]'::jsonb),
    ('"scalar"'::jsonb),('1'::jsonb),('true'::jsonb)) q(value) loop
    result:=public.submit_risk_uncertainty_analysis(f.risk,
      jsonb_set(f.input,'{sensitivity}',jsonb_build_array(bad)),array[f.verified]);
    if result is distinct from jsonb_build_object('error','each sensitivity factor must be an object')
      or pg_temp.u18_state() is distinct from baseline then
      raise exception 'sensitivity member object refusal or full no-artifact witness failed'; end if;
    attempts:=attempts+1;
  end loop;
  -- PostgreSQL 22007/22008 inputs; these must not escape as raw SQL errors.
  foreach stamp in array array['not-a-calendar-instant','2027-02-30T00:00:00Z',
    '2027-13-01T00:00:00Z','999999999-01-01T00:00:00Z'] loop
    result:=public.submit_risk_uncertainty_analysis(f.risk,
      jsonb_set(f.input,'{review_due_at}',to_jsonb(stamp)),array[f.verified]);
    if result is distinct from jsonb_build_object('error','review due date must be a valid timestamp')
      or pg_temp.u18_state() is distinct from baseline then
      raise exception 'malformed calendar instant refusal or full no-artifact witness failed'; end if;
    attempts:=attempts+1;
  end loop;
  foreach stamp in array array['infinity','+infinity','-infinity'] loop
    result:=public.submit_risk_uncertainty_analysis(f.risk,
      jsonb_set(f.input,'{review_due_at}',to_jsonb(stamp)),array[f.verified]);
    if result is distinct from jsonb_build_object('error','review due date must be a finite timestamp')
      or pg_temp.u18_state() is distinct from baseline then
      raise exception 'infinite calendar instant refusal or full no-artifact witness failed'; end if;
    attempts:=attempts+1;
  end loop;
  for bad in select value from (values('null'::jsonb),('""'::jsonb),
    (to_jsonb((now()-interval '1 day')::text))) q(value) loop
    result:=public.submit_risk_uncertainty_analysis(f.risk,
      jsonb_set(f.input,'{review_due_at}',bad),array[f.verified]);
    if result is distinct from jsonb_build_object('error','review due date must be in the future')
      or pg_temp.u18_state() is distinct from baseline then
      raise exception 'original future-date refusal or full no-artifact witness failed'; end if;
    attempts:=attempts+1;
  end loop;
  if attempts<>84 then raise exception 'finite input refusal coverage count failed'; end if;
  -- Existing timestamptz parsing remains accepted: UTC, explicit non-UTC offset,
  -- and offsetless session-local time. Each success is subtransaction-rolled back.
  foreach stamp in array array[
    to_char((now()+interval '30 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'Z',
    to_char((now()+interval '30 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'+05:30',
    to_char(now()+interval '30 days','YYYY-MM-DD HH24:MI:SS')] loop
    positive_accepted:=false;
    begin
      result:=public.submit_risk_uncertainty_analysis(f.risk,
        jsonb_set(f.input,'{review_due_at}',to_jsonb(stamp)),array[f.verified]);
      if result ? 'error' or result->>'riskId' is distinct from f.risk::text
        or result->>'validationStatus' is distinct from 'pending_review'
        or result->'operationalAuthorization' is distinct from 'false'::jsonb
        or not exists(select 1 from risk_uncertainty_analyses a
          where a.id=(result->>'analysisId')::uuid and a.organization_id=f.org
            and a.risk_id=f.risk and a.review_due_at=stamp::timestamptz) then
        raise exception 'original timezone parsing positive control failed'; end if;
      positive_accepted:=true;
      raise exception using errcode='ZX001',message='U18 positive-date fixture rollback';
    exception when sqlstate 'ZX001' then null;
    end;
    if not positive_accepted or pg_temp.u18_state() is distinct from baseline then
      raise exception 'positive-date acceptance or subtransaction no-artifact witness failed'; end if;
  end loop;
end $$;
-- U18 FINITE INPUT REFUSALS END
-- U18 CANONICAL VOI FINITE DOOR BEGIN
-- Quoted JSON numeric specials exercise the public SQL door, not SDK coercion.
-- The legitimate synthetic human remains authenticated; no owner bypass.
do $$ declare f record; result jsonb; baseline jsonb; input jsonb;
  field text; special text; expected_error text; attempts integer:=0; begin
  select * into f from u18_fixture;
  baseline:=pg_temp.u18_state();
  foreach field in array array['information_cost','decision_cost_if_wrong',
    'uncertainty_reduction','probability_decision_changes'] loop
    foreach special in array array['NaN','+Infinity','-Infinity'] loop
      input:=jsonb_build_object('information_action','Synthetic public finite-input refusal witness',
        'information_cost',10,'decision_cost_if_wrong',250000,
        'uncertainty_reduction',0.5,'probability_decision_changes',0.3,'currency','CAD');
      input:=jsonb_set(input,array[field],to_jsonb(special));
      expected_error:=case when field in ('information_cost','decision_cost_if_wrong')
        and special in ('NaN','+Infinity') then 'value-of-information inputs must be finite numbers'
        else 'costs must be non-negative and probability inputs must be between 0 and 1' end;
      result:=public.record_risk_value_of_information(f.risk,input);
      if result is distinct from jsonb_build_object('error',expected_error)
        or pg_temp.u18_state() is distinct from baseline then
        raise exception 'canonical VOI finite refusal or full no-artifact witness failed'; end if;
      attempts:=attempts+1;
    end loop;
  end loop;
  if attempts<>12 then raise exception 'canonical VOI finite refusal coverage count failed'; end if;
end $$;
-- U18 CANONICAL VOI FINITE DOOR END
-- U18 VOI PARITY BEGIN
-- Specification-only until the complete-chain CI actually executes this file.
-- Each canonical writer/uncertainty pair uses the same random fixture and is
-- subtransaction-rolled back before the original acceptance ledger continues.
do $$ declare f record; sample record; baseline jsonb; canonical jsonb;
  result jsonb; input jsonb; qualified boolean; attempts integer:=0; begin
  select * into f from u18_fixture;
  baseline:=pg_temp.u18_state();
  for sample in select * from (values
    ('large_positive_cents',100000000000000.03::numeric,0::numeric,0.999::numeric,1::numeric,99900000000000.03::numeric,99900000000000.03::numeric,'GATHER_INFORMATION'),
    ('large_negative_cents',0,100000000000000.03,1,1,0,-100000000000000.03,'DECIDE_WITH_CURRENT_INFORMATION'),
    ('finite_scientific_positive',1e307::numeric,0,1,1,1e307::numeric,1e307::numeric,'GATHER_INFORMATION'),
    ('finite_scientific_negative',0,1e307::numeric,1,1,0,-1e307::numeric,'DECIDE_WITH_CURRENT_INFORMATION'),
    ('maximum_finite_positive',1.7976931348623157e308::numeric,0,1,1,1.7976931348623157e308::numeric,1.7976931348623157e308::numeric,'GATHER_INFORMATION'),
    ('maximum_finite_negative',0,1.7976931348623157e308::numeric,1,1,0,-1.7976931348623157e308::numeric,'DECIDE_WITH_CURRENT_INFORMATION'),
    ('previous_false_overflow_witness',1e308::numeric,10,0.5,0.5,2.5e307::numeric,(2.5e307::numeric-10),'GATHER_INFORMATION'),
    ('maximum_finite_equality',1.7976931348623157e308::numeric,1.7976931348623157e308::numeric,1,1,1.7976931348623157e308::numeric,0,'DECIDE_WITH_CURRENT_INFORMATION'),
    ('positive_sub_cent',1.004::numeric,1::numeric,1::numeric,1::numeric,1::numeric,0::numeric,'GATHER_INFORMATION'),
    ('exact_equality',1,1,1,1,1,0,'DECIDE_WITH_CURRENT_INFORMATION'),
    ('negative_sub_cent',0.996,1,1,1,1,0,'DECIDE_WITH_CURRENT_INFORMATION'),
    ('sub_cent_benefit',0.004,0,1,1,0,0,'GATHER_INFORMATION'),
    ('positive_half_cent',0.005,0,1,1,0.01,0.01,'GATHER_INFORMATION'),
    ('negative_half_cent',0,0.005,1,1,0,-0.01,'DECIDE_WITH_CURRENT_INFORMATION'),
    ('normal',250000,10000,0.5,0.3,37500,27500,'GATHER_INFORMATION'),
    ('fractional_exact_equality',0.1,0.006,0.2,0.3,0.01,0,'DECIDE_WITH_CURRENT_INFORMATION'),
    ('no_intermediate_rounding',0.014,0.004,0.5,1,0.01,0,'GATHER_INFORMATION')
  ) q(case_name,decision_cost,information_cost,uncertainty_reduction,decision_probability,expected_display,net_display,recommendation) loop
    qualified:=false;
    begin
      canonical:=public.record_risk_value_of_information(f.risk,jsonb_build_object(
        'information_action','Synthetic CI parity enquiry, not an operational authorization',
        'information_cost',sample.information_cost,'decision_cost_if_wrong',sample.decision_cost,
        'uncertainty_reduction',sample.uncertainty_reduction,
        'probability_decision_changes',sample.decision_probability,'currency','CAD'));
      if canonical ? 'error' or (canonical->>'expected_value')::numeric is distinct from sample.expected_display
        or (canonical->>'net_value')::numeric is distinct from sample.net_display
        or canonical->>'recommendation' is distinct from sample.recommendation
        or canonical->'human_decision_required' is distinct from 'true'::jsonb
        or canonical->'advisory_only' is distinct from 'true'::jsonb then
        raise exception 'canonical VOI parity control failed'; end if;
      input:=f.input||jsonb_build_object('voi_information_cost',sample.information_cost,
        'voi_decision_cost_if_wrong',sample.decision_cost,
        'voi_uncertainty_reduction',sample.uncertainty_reduction,
        'voi_probability_decision_changes',sample.decision_probability);
      result:=public.submit_risk_uncertainty_analysis(f.risk,input,array[f.verified]);
      if result ? 'error' or result->>'riskId' is distinct from f.risk::text
        or result->>'analysisId' is null or result->>'analysisId' !~ '^[0-9a-f-]{36}$'
        or result->>'analysisDigest' is null or result->>'analysisDigest' !~ '^[0-9a-f]{64}$'
        or result->'version' is distinct from '1'::jsonb
        or result->>'validationStatus' is distinct from 'pending_review'
        or result->'operationalAuthorization' is distinct from 'false'::jsonb
        or result->'valueOfInformation' is distinct from jsonb_build_object(
          'informationCost',sample.information_cost,'decisionCostIfWrong',sample.decision_cost,
          'uncertaintyReduction',sample.uncertainty_reduction,'probabilityDecisionChanges',sample.decision_probability,
          'expectedValue',sample.expected_display,'netValue',sample.net_display,'recommendation',sample.recommendation)
        or not exists(select 1 from risk_uncertainty_analyses a
          where a.id=(result->>'analysisId')::uuid and a.organization_id=f.org and a.risk_id=f.risk
            and a.author_id=f.author and a.status='pending_review' and a.version=1
            and a.analysis_digest=result->>'analysisDigest'
            and a.voi_information_cost=sample.information_cost and a.voi_decision_cost_if_wrong=sample.decision_cost
            and a.voi_uncertainty_reduction=sample.uncertainty_reduction and a.voi_probability_decision_changes=sample.decision_probability
            and a.voi_expected_value=sample.expected_display and a.voi_net_value=sample.net_display
            and a.voi_recommendation=sample.recommendation) then
        raise exception 'bound uncertainty VOI parity receipt or canonical packet failed'; end if;
      qualified:=true;
      raise exception using errcode='ZX002',message='U18 VOI parity fixture rollback';
    exception when sqlstate 'ZX002' then null;
    end;
    if not qualified or pg_temp.u18_state() is distinct from baseline then
      raise exception 'VOI parity qualification or full no-artifact rollback witness failed'; end if;
    attempts:=attempts+1;
  end loop;
  if attempts<>17 then raise exception 'VOI parity case coverage count failed'; end if;
end $$;
-- U18 VOI PARITY END
-- U18 READ REPRESENTATION CONTROL BEGIN
-- Legitimate finite PostgreSQL values; no browser representation limit is
-- silently promoted into a server engineering constraint. Full rollback only.
do $$ declare f record; baseline jsonb; input jsonb; result jsonb; item jsonb;
  qualified boolean:=false; begin
  select * into f from u18_fixture;
  baseline:=pg_temp.u18_state();
  begin
    input:=f.input||jsonb_build_object('confidence_level',1e-999::numeric,
      'review_due_at','280000-01-01T00:00:00+00:00');
    result:=public.submit_risk_uncertainty_analysis(f.risk,input,array[f.verified]);
    if result ? 'error' or result->>'riskId' is distinct from f.risk::text
      or result->>'validationStatus' is distinct from 'pending_review'
      or result->'operationalAuthorization' is distinct from 'false'::jsonb then
      raise exception 'finite PostgreSQL read representation control refused'; end if;
    select x into item from jsonb_array_elements(public.get_risk_uncertainty_workspace(f.risk)->'analyses') x
      where x->>'id'=result->>'analysisId';
    if item is null or item->>'organizationId' is distinct from f.org::text
      or item->>'riskId' is distinct from f.risk::text
      or item->>'storedStatus' is distinct from 'pending_review'
      or (item->'confidence'->>'level')::numeric is distinct from 1e-999::numeric
      or (item->>'reviewDueAt')::timestamptz is distinct from '280000-01-01T00:00:00+00:00'::timestamptz
      or not exists(select 1 from risk_uncertainty_analyses a where a.id=(result->>'analysisId')::uuid
        and a.organization_id=f.org and a.risk_id=f.risk and a.author_id=f.author
        and a.confidence_level=1e-999::numeric and a.status='pending_review') then
      raise exception 'exact PostgreSQL read representation was not retained'; end if;
    qualified:=true;
    raise exception using errcode='ZX003',message='U18 read representation fixture rollback';
  exception when sqlstate 'ZX003' then null;
  end;
  if not qualified or pg_temp.u18_state() is distinct from baseline then
    raise exception 'read representation qualification or no-artifact rollback failed'; end if;
end $$;
-- U18 READ REPRESENTATION CONTROL END
do $$ declare f record; result jsonb; baseline jsonb; bad jsonb; evidence uuid; begin
  select * into f from u18_fixture;
  baseline:=pg_temp.u18_state();
  bad:=f.input||'{"probability_lower":0.7,"probability_central":0.3,"probability_upper":0.5}'::jsonb;
  result:=public.submit_risk_uncertainty_analysis(f.risk,bad,array[f.verified]);
  if result->>'error' is distinct from 'probability range must satisfy 0 <= lower <= central <= upper <= 1'
    or pg_temp.u18_state() is distinct from baseline then raise exception 'ordered probability refusal or no-artifact witness failed'; end if;
  for evidence in select f.unverified union all select f.wrong_risk loop
    result:=public.submit_risk_uncertainty_analysis(f.risk,f.input,array[evidence]);
    if result->>'error' is distinct from 'all cited inputs must be verified evidence linked to this exact risk'
      or pg_temp.u18_state() is distinct from baseline then raise exception 'exact verified evidence refusal or no-artifact witness failed'; end if;
  end loop;
  result:=public.submit_risk_uncertainty_analysis(f.risk,f.input,array[f.verified]);
  if result ? 'error' or result->>'riskId' is distinct from f.risk::text
    or result->>'validationStatus' is distinct from 'pending_review'
    or result->'operationalAuthorization' is distinct from 'false'::jsonb
    or result->'valueOfInformation' is distinct from '{"informationCost":10000,"decisionCostIfWrong":250000,"uncertaintyReduction":0.5,"probabilityDecisionChanges":0.3,"expectedValue":37500,"netValue":27500,"recommendation":"GATHER_INFORMATION"}'::jsonb
    or result->>'analysisId' !~ '^[0-9a-f-]{36}$' or result->>'analysisDigest' !~ '^[0-9a-f]{64}$'
    or result->>'analysisId' is null or result->>'analysisDigest' is null
    or not exists(select 1 from risk_uncertainty_analyses where id=(result->>'analysisId')::uuid
      and organization_id=f.org and risk_id=f.risk and author_id=f.author and version=1
      and status='pending_review' and analysis_digest=result->>'analysisDigest') then
    raise exception 'submission receipt is not a bound advisory packet'; end if;
  insert into u18_packet values((result->>'analysisId')::uuid,result->>'analysisDigest');
  baseline:=pg_temp.u18_state();
  result:=public.review_risk_uncertainty_analysis((result->>'analysisId')::uuid,'validated','The author cannot independently review their own synthetic packet.');
  if result->>'error' is distinct from 'analysis author cannot independently review the same packet'
    or pg_temp.u18_state() is distinct from baseline then raise exception 'independent human refusal or no-artifact witness failed'; end if;
end $$;

-- Owner-level existing-row probes prove triggers, not an RLS UPDATE 0.
reset role;
do $$ declare packet uuid; before_row jsonb; detail text; refused boolean; total bigint; begin
  select id into packet from u18_packet;
  select to_jsonb(a) into before_row from risk_uncertainty_analyses a where id=packet;
  if packet is null or before_row is null then raise exception 'direct-write target does not exist'; end if;
  refused:=false;
  begin update risk_uncertainty_analyses set method='Owner-mutated method' where id=packet;
  exception when raise_exception then get stacked diagnostics detail=message_text;
    refused:=detail='risk uncertainty analysis changes require the governed submit and review functions'; end;
  if not refused or (select to_jsonb(a) from risk_uncertainty_analyses a where id=packet) is distinct from before_row then
    raise exception 'actual direct mutation trigger or state preservation failed'; end if;
  select count(*) into total from risk_uncertainty_analyses;
  refused:=false;
  begin truncate table risk_uncertainty_analyses cascade;
  exception when raise_exception then get stacked diagnostics detail=message_text;
    refused:=detail='risk uncertainty history is retained; truncate refused'; end;
  if not refused or (select count(*) from risk_uncertainty_analyses) is distinct from total
    or (select to_jsonb(a) from risk_uncertainty_analyses a where id=packet) is distinct from before_row then
    raise exception 'actual truncate refusal or preservation failed'; end if;
  if exists(select 1 from (values
      ('public.submit_risk_uncertainty_analysis(uuid,jsonb,uuid[])'),
      ('public.review_risk_uncertainty_analysis(uuid,text,text)'),
      ('public.get_risk_uncertainty_workspace(uuid)')) q(signature)
    where to_regprocedure(signature) is null
      or has_function_privilege('service_role',signature,'EXECUTE')
      or has_function_privilege('anon',signature,'EXECUTE')
      or not has_function_privilege('authenticated',signature,'EXECUTE'))
    or exists(select 1 from (values
      ('public.risk_uncertainty_analysis_digest(uuid,uuid)'),
      ('public.risk_uncertainty_analysis_digest_v1(uuid,uuid)'),
      ('public.risk_uncertainty_current_policy_digest(uuid,uuid)'),
      ('public.risk_uncertainty_review_standing(uuid,uuid)'),
      ('public.risk_uncertainty_evidence_digest_projection(public.evidence_items)'),
      ('public.risk_uncertainty_input_binding_snapshot(uuid,uuid,uuid[])'),
      ('public.risk_uncertainty_v2_digest_payload(public.risk_uncertainty_analyses,jsonb)')) q(signature)
      cross join (values ('anon'),('authenticated'),('service_role')) roles(role_name)
      where to_regprocedure(signature) is null
        or has_function_privilege(role_name,signature,'EXECUTE')) then
    raise exception 'native uncertainty RPC/helper ACL failed'; end if;
end $$;

-- U18 SUBMITTED HISTORY REFUSALS BEGIN
-- Owner/internal-marker diagnostics deliberately exercise the row triggers;
-- they are not an authenticated API bypass, and touch only this random fixture.
create function pg_temp.u18_history_refusals(p_packet uuid,p_terminal boolean)
returns void language plpgsql as $$
declare baseline jsonb; before_row jsonb; field record; changed jsonb;
  old_marker text:=coalesce(current_setting('app.risk_uncertainty_write',true),'');
  detail text; refused boolean; attempts integer:=0; required_count bigint;
  expected_error text;
begin
  baseline:=pg_temp.u18_state();
  select to_jsonb(a) into before_row from public.risk_uncertainty_analyses a where id=p_packet;
  if before_row is null
    or (p_terminal and before_row->>'status' not in ('validated','rejected'))
    or (not p_terminal and before_row->>'status' is distinct from 'pending_review')
    or before_row->>'analysis_digest'=repeat('0',64) then
    raise exception 'history refusal target must be an actual finalized submitted packet'; end if;
  perform set_config('app.risk_uncertainty_write','granted',true);
  expected_error:=case when p_terminal
    then 'reviewed risk uncertainty analysis history is immutable; submit a new version'
    else 'submitted risk uncertainty analysis inputs are immutable; submit a new version' end;
  for field in select a.attname as name,format_type(a.atttypid,a.atttypmod) as kind
    from pg_catalog.pg_attribute a
    where a.attrelid='public.risk_uncertainty_analyses'::regclass and a.attnum>0 and not a.attisdropped
      and (p_terminal or a.attname not in
        ('status','analysis_digest','reviewer_id','reviewed_at','review_note','approval_id','derived_evidence_item_id'))
    order by a.attnum loop
    case field.kind
      when 'uuid' then changed:=to_jsonb(gen_random_uuid());
      when 'text' then changed:=to_jsonb(coalesce(before_row->>field.name,'')||'-changed');
      when 'integer' then changed:=to_jsonb((before_row->>field.name)::integer+1);
      when 'numeric' then changed:=to_jsonb((before_row->>field.name)::numeric+1);
      when 'boolean' then changed:=to_jsonb(not (before_row->>field.name)::boolean);
      when 'timestamp with time zone' then changed:=to_jsonb((before_row->>field.name)::timestamptz+interval '1 microsecond');
      when 'text[]' then changed:=(before_row->field.name)||jsonb_build_array('New immutable history probe trigger');
      when 'jsonb' then changed:=(before_row->field.name)||jsonb_build_object('history_mutation_probe',true);
      else raise exception 'new packet column type requires an explicit history witness';
    end case;
    refused:=false;
    begin
      execute format('update public.risk_uncertainty_analyses set %I=(jsonb_populate_record(null::public.risk_uncertainty_analyses,$1)).%I where id=$2',field.name,field.name)
        using jsonb_build_object(field.name,changed),p_packet;
    exception when raise_exception then
      get stacked diagnostics detail=message_text;
      refused:=detail=expected_error;
    end;
    if not refused or pg_temp.u18_state() is distinct from baseline then
      raise exception 'exact submitted/terminal history refusal or complete artifact preservation failed'; end if;
    attempts:=attempts+1;
  end loop;
  select count(*) into required_count from jsonb_object_keys(before_row);
  if not p_terminal then required_count:=required_count-7; end if;
  if attempts<>required_count or required_count<33 then
    raise exception 'submitted history all-column refusal coverage failed'; end if;
  if not p_terminal then
    refused:=false;
    begin update public.risk_uncertainty_analyses set analysis_digest=repeat('0',64) where id=p_packet;
    exception when raise_exception then get stacked diagnostics detail=message_text;
      refused:=detail='submitted risk uncertainty analysis digest is immutable; submit a new version'; end;
    if not refused or pg_temp.u18_state() is distinct from baseline then
      raise exception 'finalized digest cannot be reset or leave artifacts'; end if;
    refused:=false;
    begin update public.risk_uncertainty_analyses set review_note='Metadata-only mutation without an independent review transition.' where id=p_packet;
    exception when raise_exception then get stacked diagnostics detail=message_text;
      refused:=detail='risk uncertainty lifecycle changes require the independent review transition'; end;
    if not refused or pg_temp.u18_state() is distinct from baseline then
      raise exception 'metadata-only pending mutation refusal or artifact preservation failed'; end if;
    -- Even a valid existing evidence binding must hit the history guard before
    -- duplicate-key handling: any unrelated constraint error is NOT a pass.
    refused:=false;
    begin insert into public.risk_uncertainty_analysis_evidence(organization_id,analysis_id,evidence_item_id)
      select organization_id,p_packet,evidence_item_id from public.risk_uncertainty_analysis_evidence
      where analysis_id=p_packet limit 1;
    exception when raise_exception then get stacked diagnostics detail=message_text;
      refused:=detail='analysis evidence must be verified evidence linked to this exact risk and organization'; end;
    if not refused or pg_temp.u18_state() is distinct from baseline then
      raise exception 'finalized evidence-binding append refusal or artifact preservation failed'; end if;
    for changed in select value from (values
      (before_row||jsonb_build_object('id',gen_random_uuid())),
      (before_row||jsonb_build_object('id',gen_random_uuid(),'status','validated')),
      (before_row||jsonb_build_object('id',gen_random_uuid(),'analysis_digest',repeat('0',64),
        'review_note','A fake review tuple on an initial pending packet.'))
    ) q(value) loop
      refused:=false;
      begin insert into public.risk_uncertainty_analyses
        select (jsonb_populate_record(null::public.risk_uncertainty_analyses,changed)).*;
      exception when raise_exception then get stacked diagnostics detail=message_text;
        refused:=detail='risk uncertainty insertion requires an initial pending packet without review artifacts'; end;
      if not refused or pg_temp.u18_state() is distinct from baseline then
        raise exception 'noninitial packet insertion refusal or artifact preservation failed'; end if;
    end loop;
  end if;
  perform set_config('app.risk_uncertainty_write',old_marker,true);
end $$;
select pg_temp.u18_history_refusals((select id from u18_packet),false);
-- Initializer-only control uses the otherwise empty secondary synthetic risk.
-- Prove both exact digest refusal and successful single finalization, then
-- remove the complete temporary packet/binding footprint by subtransaction.
do $$ declare f record; baseline jsonb; initial_state jsonb; candidate jsonb;
  packet uuid:=gen_random_uuid(); digest text; wrong_digest text; detail text;
  refused boolean; qualified boolean:=false; old_marker text; begin
  select * into f from u18_fixture;
  baseline:=pg_temp.u18_state();
  old_marker:=coalesce(current_setting('app.risk_uncertainty_write',true),'');
  begin
    perform set_config('app.risk_uncertainty_write','granted',true);
    select to_jsonb(a)||jsonb_build_object('id',packet,'risk_id',f.other_risk,
      'version',1,'analysis_digest',repeat('0',64),
      'input_binding_snapshot',public.risk_uncertainty_input_binding_snapshot(f.org,f.other_risk,array[f.wrong_risk])) into candidate
      from public.risk_uncertainty_analyses a where a.id=(select id from u18_packet);
    insert into public.risk_uncertainty_analyses
      select (jsonb_populate_record(null::public.risk_uncertainty_analyses,candidate)).*;
    insert into public.risk_uncertainty_analysis_evidence(organization_id,analysis_id,evidence_item_id)
      values(f.org,packet,f.wrong_risk);
    initial_state:=pg_temp.u18_state();
    digest:=public.risk_uncertainty_analysis_digest(f.org,packet);
    if digest is null or digest=repeat('0',64) then
      raise exception 'initialization control needs the actual nonzero canonical digest'; end if;
    wrong_digest:=case when digest=repeat('a',64) then repeat('b',64) else repeat('a',64) end;
    refused:=false;
    begin update public.risk_uncertainty_analyses set analysis_digest=wrong_digest where id=packet;
    exception when raise_exception then get stacked diagnostics detail=message_text;
      refused:=detail='risk uncertainty initial digest finalization must bind the exact pending inputs and evidence'; end;
    if not refused or pg_temp.u18_state() is distinct from initial_state then
      raise exception 'incorrect initial digest refusal or complete artifact preservation failed'; end if;
    refused:=false;
    begin update public.risk_uncertainty_analyses set analysis_digest=digest,
      review_note='Initial digest finalization must not fabricate review metadata.' where id=packet;
    exception when raise_exception then get stacked diagnostics detail=message_text;
      refused:=detail='risk uncertainty initial digest finalization must bind the exact pending inputs and evidence'; end;
    if not refused or pg_temp.u18_state() is distinct from initial_state then
      raise exception 'initial digest metadata refusal or complete artifact preservation failed'; end if;
    update public.risk_uncertainty_analyses set analysis_digest=digest where id=packet;
    if not exists(select 1 from public.risk_uncertainty_analyses a
      where a.id=packet and a.organization_id=f.org and a.risk_id=f.other_risk
        and a.analysis_digest=digest and a.status='pending_review' and a.reviewer_id is null
        and a.review_note is null and a.approval_id is null and a.derived_evidence_item_id is null)
      or public.risk_uncertainty_analysis_digest(f.org,packet) is distinct from digest then
      raise exception 'exact initial digest did not finalize the unchanged pending packet'; end if;
    qualified:=true;
    raise exception using errcode='ZX005',message='U18 digest initialization fixture rollback';
  exception when sqlstate 'ZX005' then null;
  end;
  if not qualified or pg_temp.u18_state() is distinct from baseline
    or coalesce(current_setting('app.risk_uncertainty_write',true),'') is distinct from old_marker then
    raise exception 'initialization qualification or full state/marker rollback witness failed'; end if;
end $$;
-- U18 SUBMITTED HISTORY REFUSALS END

-- U18 REVIEW STANDING CONTROLS BEGIN
-- Real public reads, private ACL refusals and raw policy CAS. Each changed
-- policy/input probe rolls back all thirteen collections in both tenants.
do $$ declare f record; packet uuid; baseline jsonb; snapshot jsonb;
  workspace jsonb; item jsonb; policy_digest text; other_digest text;
  branch text; expected_standing text; helper text; client text;
  qualified boolean; refused boolean; detail text; affected integer;
  original_actor text:=current_setting('request.jwt.claim.sub',true);
  original_role text:=current_user; original_timezone text:=current_setting('TimeZone');
begin
  select * into f from u18_fixture; select id into packet from u18_packet;
  baseline:=pg_temp.u18_state();
  policy_digest:=public.risk_uncertainty_current_policy_digest(f.org,f.risk);
  other_digest:=public.risk_uncertainty_current_policy_digest(f.org,f.other_risk);
  if policy_digest is null or policy_digest !~ '^[0-9a-f]{64}$'
    or other_digest is null or other_digest=policy_digest
    or public.risk_uncertainty_current_policy_digest(f.foreign_org,f.risk) is not null
    or public.risk_uncertainty_current_policy_digest(f.org,gen_random_uuid()) is not null
    or public.risk_uncertainty_review_standing(f.foreign_org,packet) is not null
    or public.risk_uncertainty_review_standing(f.org,gen_random_uuid()) is not null
    or public.risk_uncertainty_review_standing(f.org,packet) is distinct from 'reviewable' then
    raise exception 'raw policy CAS scope or fresh structural standing failed'; end if;
  perform set_config('TimeZone','Pacific/Honolulu',true);
  if public.risk_uncertainty_current_policy_digest(f.org,f.risk) is distinct from policy_digest then
    raise exception 'policy CAS changed under a session timezone'; end if;
  perform set_config('TimeZone',original_timezone,true);
  foreach helper in array array['risk_uncertainty_current_policy_digest','risk_uncertainty_review_standing'] loop
    foreach client in array array['anon','authenticated','service_role'] loop
      refused:=false;
      begin
        execute format('set local role %I',client);
        execute format('select public.%I($1,$2)',helper) using f.org,packet;
      exception when insufficient_privilege then
        get stacked diagnostics detail=message_text;
        refused:=detail='permission denied for function '||helper;
      end;
      if not refused or current_user is distinct from original_role
        or pg_temp.u18_state() is distinct from baseline then
        raise exception 'direct client structural helper was not exactly denied'; end if;
    end loop;
  end loop;
  foreach branch in array array['draft','superseded','empty','missing','threshold','evidence'] loop
    qualified:=false;
    begin
      perform set_config('request.jwt.claim.sub','',true);
      if branch in ('draft','superseded') then
        update public.risk_criteria_profiles set status=branch where id=f.criteria;
      elsif branch='empty' then
        update public.risk_criteria_profiles set decision_thresholds='{}'::jsonb where id=f.criteria;
      elsif branch='missing' then
        update public.risks set criteria_profile_id=null where id=f.risk;
      elsif branch='threshold' then
        update public.risk_criteria_profiles set decision_thresholds=decision_thresholds
          ||jsonb_build_object('rawStandingThreshold',1.000000000000000000001::numeric)
          where id=f.criteria;
      else
        update public.evidence_items set verification_status='unverified' where id=f.verified;
      end if;
      get diagnostics affected=row_count;
      if affected<>1 then raise exception 'structural standing requires one actual scoped fixture edit'; end if;
      expected_standing:=case when branch in ('draft','superseded','empty','missing')
        then 'policy_unavailable' else 'replacement_required' end;
      snapshot:=pg_temp.u18_state();
      perform set_config('request.jwt.claim.sub',f.author::text,true);
      workspace:=public.get_risk_uncertainty_workspace(f.risk);
      select x into item from jsonb_array_elements(workspace->'analyses') x
        where x->>'id'=packet::text;
      if workspace ? 'error' or item is null
        or workspace->>'organizationId' is distinct from f.org::text
        or workspace->>'actorId' is distinct from f.author::text
        or item->>'reviewStanding' is distinct from expected_standing
        or item->>'storedStatus' is distinct from 'pending_review'
        or item->>'analysisDigest' is distinct from (select digest from u18_packet)
        or item->'operationalAuthorization' is distinct from 'false'::jsonb
        or public.risk_uncertainty_review_standing(f.org,packet) is distinct from expected_standing
        or pg_temp.u18_state() is distinct from snapshot then
        raise exception 'actual public structural standing or read no-artifact witness failed'; end if;
      if branch='missing' then
        if workspace->'criteria' is distinct from 'null'::jsonb
          or public.risk_uncertainty_current_policy_digest(f.org,f.risk) is not null then
          raise exception 'missing current policy synthesized a CAS digest'; end if;
      else
        other_digest:=public.risk_uncertainty_current_policy_digest(f.org,f.risk);
        if other_digest is null or other_digest !~ '^[0-9a-f]{64}$'
          or workspace->'criteria'->>'policyDigest' is distinct from other_digest
          or (branch='evidence' and other_digest is distinct from policy_digest)
          or (branch<>'evidence' and other_digest is not distinct from policy_digest) then
          raise exception 'raw policy CAS did not reflect only current scoped policy'; end if;
      end if;
      qualified:=true;
      raise exception using errcode='ZX015',message='U18 structural standing fixture rollback';
    exception when sqlstate 'ZX015' then null;
    end;
    if not qualified or pg_temp.u18_state() is distinct from baseline
      or current_setting('request.jwt.claim.sub',true) is distinct from original_actor then
      raise exception 'structural standing probe or complete rollback witness failed'; end if;
  end loop;
end $$;
-- U18 REVIEW STANDING CONTROLS END

-- U18 V2 DIGEST CONTROLS BEGIN
-- Owner-side diagnostics mutate only new synthetic rows and roll back each
-- probe. No guard is disabled or source approval/engineering authority inferred.
reset role;
do $$ declare f record; a public.risk_uncertainty_analyses%rowtype;
  e public.evidence_items%rowtype; evidence_variant public.evidence_items%rowtype;
  evidence_projection jsonb; variant_projection jsonb; edge_attempts integer:=0;
  baseline jsonb; original_digest text; stored_digest text; current_digest text; initial_policy text;
  snapshot jsonb; changed record; qualified boolean; attempts integer:=0;
  old_actor text; old_timezone text; detail text; refused boolean; packet uuid; affected integer;
  candidate jsonb; tag jsonb; legacy_workspace jsonb; legacy_item jsonb; legacy_review jsonb; legacy_policy text;
  invalid_tags integer:=0; begin
  select * into f from u18_fixture;
  select * into a from public.risk_uncertainty_analyses where id=(select id from u18_packet);
  baseline:=pg_temp.u18_state(); original_digest:=a.analysis_digest;
  initial_policy:=public.risk_uncertainty_current_policy_digest(f.org,f.risk);
  if a.digest_version is distinct from 2
    or a.input_binding_snapshot->'digestVersion' is distinct from '2'::jsonb
    or a.input_binding_snapshot->'bindingComplete' is distinct from 'true'::jsonb
    or a.input_binding_snapshot->'expectedEvidenceIds' is distinct from to_jsonb(array[f.verified])
    or a.input_binding_snapshot->'expectedEvidenceCount' is distinct from '1'::jsonb
    or a.input_binding_snapshot->'foundEvidenceCount' is distinct from '1'::jsonb then
    raise exception 'v2 submission lacks a typed complete exact-input stored snapshot'; end if;
  old_timezone:=current_setting('TimeZone');
  foreach old_actor in array array['UTC','America/Edmonton','Asia/Kolkata'] loop
    perform set_config('TimeZone',old_actor,true);
    stored_digest:=encode(extensions.digest(public.risk_uncertainty_v2_digest_payload(
      a,a.input_binding_snapshot)::text,'sha256'),'hex');
    current_digest:=public.risk_uncertainty_analysis_digest(f.org,a.id);
    if stored_digest is distinct from original_digest or current_digest is distinct from original_digest then
      raise exception 'v2 stored/live digest changed across session timezones'; end if;
  end loop;
  perform set_config('TimeZone',old_timezone,true);
  -- Pure payload excludes exactly the mutable review artifact tuple, not inputs.
  candidate:=to_jsonb(a)||jsonb_build_object('status','validated','reviewer_id',f.reviewer,
    'reviewed_at',now(),'review_note','Synthetic payload-only review artifacts are not persisted.',
    'approval_id',gen_random_uuid(),'derived_evidence_item_id',gen_random_uuid());
  if public.risk_uncertainty_v2_digest_payload(a,a.input_binding_snapshot) is distinct from
    public.risk_uncertainty_v2_digest_payload(
      jsonb_populate_record(null::public.risk_uncertainty_analyses,candidate),a.input_binding_snapshot) then
    raise exception 'review artifacts incorrectly alter immutable v2 payload'; end if;
  -- Sorted/deduplicated same-risk bindings; wrong-risk inputs must remain
  -- explicitly incomplete and contain no found content from the other risk.
  snapshot:=public.risk_uncertainty_input_binding_snapshot(f.org,f.risk,array[f.verified,f.verified]);
  if snapshot is distinct from a.input_binding_snapshot then
    raise exception 'v2 expected binding identity is not deterministic'; end if;
  snapshot:=public.risk_uncertainty_input_binding_snapshot(f.org,f.risk,array[f.wrong_risk]);
  if snapshot->'bindingComplete' is distinct from 'false'::jsonb
    or snapshot->'expectedEvidenceIds' is distinct from to_jsonb(array[f.wrong_risk])
    or snapshot->'expectedEvidenceCount' is distinct from '1'::jsonb
    or snapshot->'foundEvidenceCount' is distinct from '0'::jsonb
    or snapshot->'evidence' is distinct from '[]'::jsonb
    or snapshot::text like '%Synthetic verified evidence from another CI risk.%' then
    raise exception 'incomplete v2 projection leaked wrong-risk evidence or masked absence'; end if;
  snapshot:=public.risk_uncertainty_input_binding_snapshot(f.foreign_org,f.risk,array[f.verified]);
  if snapshot->'bindingComplete' is distinct from 'false'::jsonb
    or snapshot->'evidence' is distinct from '[]'::jsonb
    or snapshot->'currentCriteria' is distinct from 'null'::jsonb
    or snapshot::text like '%Synthetic verified inspection extract%' then
    raise exception 'incomplete v2 projection leaked foreign-tenant evidence or criteria'; end if;
  if public.risk_uncertainty_analysis_digest(f.foreign_org,a.id) is not null then
    raise exception 'v2 packet digest returned foreign-tenant content'; end if;
  -- U18 V2 SIGNED-FIELD PROJECTION CONTROLS BEGIN
  -- Actual projection of the bound fixture, followed by non-persisted composite
  -- variants. Canonical signed rows and their immutable guards are untouched:
  -- this is content commitment, not device ingestion/signature qualification.
  select * into e from public.evidence_items where id=f.verified;
  evidence_projection:=public.risk_uncertainty_evidence_digest_projection(e);
  if e.id is distinct from f.verified
    or evidence_projection is distinct from a.input_binding_snapshot->'evidence'->0
    or (select count(*) from jsonb_object_keys(evidence_projection)) is distinct from
       (select count(*) from information_schema.columns
        where table_schema='public' and table_name='evidence_items') then
    raise exception 'actual v2 evidence projection is incomplete or differs from captured row'; end if;
  for changed in select * from (values
    ('edge_node_id','edgeNodeId',to_jsonb(gen_random_uuid())),
    ('edge_sensor_id','edgeSensorId',to_jsonb(gen_random_uuid())),
    ('edge_model_register_id','edgeModelRegisterId',to_jsonb(9007199254740993::bigint)),
    ('edge_observation_id','edgeObservationId',to_jsonb('ci-observation-projection-only'::text)),
    ('edge_sequence','edgeSequence',to_jsonb(9007199254740993::bigint)),
    ('edge_payload_sha256','edgePayloadSha256',to_jsonb(repeat('c',64))),
    ('edge_signature_key_id','edgeSignatureKeyId',to_jsonb('ci-signature-projection-only'::text)),
    ('edge_signature_verified_at','edgeSignatureVerifiedAt',to_jsonb('2026-10-06T12:00:00.123456+00:00'::text)),
    ('edge_observation','edgeObservation','{"measurement":{"value":17,"unit":"mm/s"},"ci_projection_only":true}'::jsonb)
  ) q(field,key,value) loop
    evidence_variant:=jsonb_populate_record(null::public.evidence_items,
      to_jsonb(e)||jsonb_build_object(changed.field,changed.value));
    variant_projection:=public.risk_uncertainty_evidence_digest_projection(evidence_variant);
    snapshot:=jsonb_set(a.input_binding_snapshot,'{evidence,0}',variant_projection,false);
    current_digest:=encode(extensions.digest(
      public.risk_uncertainty_v2_digest_payload(a,snapshot)::text,'sha256'),'hex');
    if variant_projection->changed.key is distinct from changed.value
      or variant_projection is not distinct from evidence_projection
      or current_digest is null or current_digest !~ '^[0-9a-f]{64}$'
      or current_digest is not distinct from original_digest
      or public.risk_uncertainty_analysis_digest(f.org,a.id) is distinct from original_digest
      or pg_temp.u18_state() is distinct from baseline then
      raise exception 'signed-field projection did not preserve exact content, alter hash or retain unchanged artifacts'; end if;
    edge_attempts:=edge_attempts+1;
  end loop;
  if edge_attempts<>9 or pg_temp.u18_state() is distinct from baseline then
    raise exception 'signed-field projection coverage incomplete or changed persisted artifacts'; end if;
  -- U18 V2 SIGNED-FIELD PROJECTION CONTROLS END
  -- Content-only mutations are each a real row change with unchanged revision.
  -- Service corrections remain governed/audited by existing evidence triggers;
  -- every resulting audit/security row is inside the rollback witness.
  old_actor:=coalesce(current_setting('request.jwt.claim.sub',true),'');
  perform set_config('request.jwt.claim.sub','',true);
  for changed in select * from (values
    ('description',to_jsonb('Changed exact CI evidence content.'::text)),
    ('source_system',to_jsonb('Changed CI source system'::text)),
    ('evidence_type',to_jsonb('Changed CI evidence type'::text)),
    ('signal_kind',to_jsonb('Changed CI signal kind'::text)),
    ('source_reference',to_jsonb('ci://changed-bound-input'::text)),
    ('provenance','{"changed_ci_provenance":true}'::jsonb),
    ('verification_method',to_jsonb('Changed CI verification method'::text)),
    ('verification_note',to_jsonb('Changed CI verification basis.'::text)),
    ('quality_grade',to_jsonb('moderate'::text)),
    ('applicability_grade',to_jsonb('indirect'::text)),
    ('applicability',to_jsonb('Changed CI applicability basis.'::text)),
    ('related_asset',to_jsonb('Changed canonical related-asset description.'::text)),
    ('created_at',to_jsonb(e.created_at+interval '1 microsecond'))
  ) q(field,value) loop
    qualified:=false;
    begin
      execute format('update public.evidence_items set %I=(jsonb_populate_record(null::public.evidence_items,$1)).%I where id=$2',changed.field,changed.field)
        using jsonb_build_object(changed.field,changed.value),f.verified;
      get diagnostics affected=row_count;
      if affected<>1 or public.risk_uncertainty_analysis_digest(f.org,a.id) is not distinct from original_digest
        or not exists(select 1 from public.evidence_items where id=f.verified and revision='R2') then
        raise exception 'content-only evidence change did not stale the v2 digest'; end if;
      qualified:=true;
      raise exception using errcode='ZX006',message='U18 content digest fixture rollback';
    exception when sqlstate 'ZX006' then null;
    end;
    if not qualified or pg_temp.u18_state() is distinct from baseline then
      raise exception 'v2 evidence drift qualification or complete rollback witness failed'; end if;
    attempts:=attempts+1;
  end loop;
  if attempts<>13 then raise exception 'v2 content drift coverage incomplete'; end if;
  -- Current policy drift, not just the old packet's threshold copy.
  attempts:=0;
  for changed in select * from (values
    ('decision_thresholds','{"escalateAbove":17,"stopAbove":25}'::jsonb),
    ('version',to_jsonb(2)),('status',to_jsonb('draft'::text)),
    ('adopted_at',to_jsonb(now()+interval '1 microsecond')),
    ('basis',to_jsonb('Changed synthetic criteria adoption basis.'::text))
  ) q(field,value) loop
    qualified:=false;
    begin
      execute format('update public.risk_criteria_profiles set %I=(jsonb_populate_record(null::public.risk_criteria_profiles,$1)).%I where id=$2',changed.field,changed.field)
        using jsonb_build_object(changed.field,changed.value),f.criteria;
      get diagnostics affected=row_count;
      if affected<>1 or public.risk_uncertainty_analysis_digest(f.org,a.id) is not distinct from original_digest
        or public.risk_uncertainty_current_policy_digest(f.org,f.risk) is null
        or public.risk_uncertainty_current_policy_digest(f.org,f.risk) is not distinct from initial_policy then
        raise exception 'current criteria drift did not stale the v2 digest'; end if;
      qualified:=true;
      raise exception using errcode='ZX007',message='U18 criteria digest fixture rollback';
    exception when sqlstate 'ZX007' then null;
    end;
    if not qualified or pg_temp.u18_state() is distinct from baseline then
      raise exception 'v2 criteria drift qualification or complete rollback witness failed'; end if;
    attempts:=attempts+1;
  end loop;
  if attempts<>5 then raise exception 'v2 criteria drift coverage incomplete'; end if;
  qualified:=false;
  begin
    update public.risks set criteria_profile_id=null where id=f.risk;
    snapshot:=public.risk_uncertainty_input_binding_snapshot(f.org,f.risk,array[f.verified]);
    current_digest:=public.risk_uncertainty_analysis_digest(f.org,a.id);
    if snapshot->'bindingComplete' is distinct from 'false'::jsonb
      or current_digest is null or current_digest !~ '^[0-9a-f]{64}$'
      or current_digest is not distinct from original_digest then
      raise exception 'missing current criteria must yield an explicit incomplete stale hex digest'; end if;
    qualified:=true;
    raise exception using errcode='ZX008',message='U18 incomplete criteria fixture rollback';
  exception when sqlstate 'ZX008' then null;
  end;
  if not qualified or pg_temp.u18_state() is distinct from baseline then
    raise exception 'missing criteria qualification or complete rollback witness failed'; end if;
  qualified:=false;
  begin
    update public.evidence_items set risk_id=f.other_risk where id=f.verified;
    snapshot:=public.risk_uncertainty_input_binding_snapshot(f.org,f.risk,array[f.verified]);
    current_digest:=public.risk_uncertainty_analysis_digest(f.org,a.id);
    if snapshot->'bindingComplete' is distinct from 'false'::jsonb
      or snapshot->'foundEvidenceCount' is distinct from '0'::jsonb
      or snapshot->'evidence' is distinct from '[]'::jsonb
      or current_digest is null or current_digest !~ '^[0-9a-f]{64}$'
      or current_digest is not distinct from original_digest then
      raise exception 'rebound evidence must yield incomplete stale digest without foreign content'; end if;
    qualified:=true;
    raise exception using errcode='ZX009',message='U18 incomplete evidence fixture rollback';
  exception when sqlstate 'ZX009' then null;
  end;
  if not qualified or pg_temp.u18_state() is distinct from baseline then
    raise exception 'moved evidence qualification or complete rollback witness failed'; end if;
  perform set_config('request.jwt.claim.sub',old_actor,true);
  -- Wrong stored snapshot, despite correct typed tags and legitimate links,
  -- cannot be finalized against a different live digest via the internal marker.
  qualified:=false;
  begin
    perform set_config('app.risk_uncertainty_write','granted',true);
    packet:=gen_random_uuid();
    candidate:=to_jsonb(a)||jsonb_build_object('id',packet,'risk_id',f.other_risk,'version',1,
      'analysis_digest',repeat('0',64),'input_binding_snapshot',a.input_binding_snapshot);
    insert into public.risk_uncertainty_analyses
      select (jsonb_populate_record(null::public.risk_uncertainty_analyses,candidate)).*;
    insert into public.risk_uncertainty_analysis_evidence(organization_id,analysis_id,evidence_item_id)
      values(f.org,packet,f.wrong_risk);
    snapshot:=pg_temp.u18_state(); refused:=false;
    begin
      update public.risk_uncertainty_analyses set analysis_digest=public.risk_uncertainty_analysis_digest(f.org,packet)
        where id=packet;
    exception when raise_exception then get stacked diagnostics detail=message_text;
      refused:=detail='risk uncertainty initial digest finalization must bind the exact pending inputs and evidence'; end;
    if not refused or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'corrupted stored snapshot finalized or left refusal artifacts'; end if;
    qualified:=true;
    raise exception using errcode='ZX010',message='U18 stored snapshot fixture rollback';
  exception when sqlstate 'ZX010' then null;
  end;
  if not qualified or pg_temp.u18_state() is distinct from baseline then
    raise exception 'stored snapshot qualification or complete rollback witness failed'; end if;
  -- Identifiable v1 compatibility, not a backfilled claim of content coverage.
  qualified:=false;
  begin
    perform set_config('app.risk_uncertainty_write','granted',true);
    packet:=gen_random_uuid();
    candidate:=to_jsonb(a)||jsonb_build_object('id',packet,'risk_id',f.other_risk,'version',1,
      'analysis_digest',repeat('0',64),'digest_version',1,'input_binding_snapshot',null);
    insert into public.risk_uncertainty_analyses
      select (jsonb_populate_record(null::public.risk_uncertainty_analyses,candidate)).*;
    insert into public.risk_uncertainty_analysis_evidence(organization_id,analysis_id,evidence_item_id)
      values(f.org,packet,f.wrong_risk);
    current_digest:=public.risk_uncertainty_analysis_digest(f.org,packet);
    if current_digest is null or current_digest !~ '^[0-9a-f]{64}$'
      or current_digest is distinct from public.risk_uncertainty_analysis_digest_v1(f.org,packet) then
      raise exception 'legacy v1 dispatch changed or falsely claimed v2 snapshot coverage'; end if;
    update public.risk_uncertainty_analyses set analysis_digest=current_digest where id=packet;
    if not exists(select 1 from public.risk_uncertainty_analyses where id=packet
      and digest_version=1 and input_binding_snapshot is null and analysis_digest=current_digest) then
      raise exception 'legacy v1 initializer failed its original algorithm'; end if;
    perform set_config('request.jwt.claim.sub',f.author::text,true);
    legacy_workspace:=public.get_risk_uncertainty_workspace(f.other_risk);
    select x into legacy_item from jsonb_array_elements(legacy_workspace->'analyses') x
      where x->>'id'=packet::text;
    if legacy_workspace->>'organizationId' is distinct from f.org::text
      or legacy_workspace->>'actorId' is distinct from f.author::text
      or legacy_item->'digestVersion' is distinct from '1'::jsonb
      or legacy_item->>'digestCoverage' is distinct from 'legacy_metadata'
      or legacy_item->>'reviewStanding' is distinct from 'reviewable'
      or legacy_item->>'currentDigest' is distinct from current_digest
      or legacy_item->>'analysisDigest' is distinct from current_digest then
      raise exception 'legacy v1 public workspace mislabeled or omitted actual coverage'; end if;
    -- U18 LEGACY CRITERIA REFUSAL BEGIN
    -- V1 intentionally retains metadata-only hashing. Its unchanged digest
    -- must not authorize review against a different current threshold policy.
    legacy_policy:=legacy_workspace->'criteria'->>'policyDigest';
    if legacy_policy is null or legacy_policy !~ '^[0-9a-f]{64}$' then
      raise exception 'legacy current policy CAS missing'; end if;
    perform set_config('request.jwt.claim.sub','',true);
    update public.risk_criteria_profiles set decision_thresholds=decision_thresholds
      ||jsonb_build_object('ciLegacyChangedThreshold',true) where id=f.criteria;
    if public.risk_uncertainty_analysis_digest(f.org,packet) is distinct from current_digest then
      raise exception 'legacy policy refusal control changed the preserved v1 algorithm'; end if;
    perform set_config('request.jwt.claim.sub',f.reviewer::text,true);
    snapshot:=pg_temp.u18_state();
    legacy_workspace:=public.get_risk_uncertainty_workspace(f.other_risk);
    select x into legacy_item from jsonb_array_elements(legacy_workspace->'analyses') x
      where x->>'id'=packet::text;
    if legacy_item is null or legacy_item->>'reviewStanding' is distinct from 'replacement_required'
      or legacy_item->>'validationStatus' is distinct from 'pending_review'
      or legacy_item->>'analysisDigest' is distinct from current_digest
      or legacy_item->>'currentDigest' is distinct from current_digest
      or legacy_workspace->'criteria'->>'policyDigest' is null
      or legacy_workspace->'criteria'->>'policyDigest' is not distinct from legacy_policy
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'legacy equal-digest policy drift concealed structural standing'; end if;
    legacy_review:=public.review_risk_uncertainty_analysis(packet,'validated',
      'Synthetic legacy review must not approve a different current threshold policy.');
    if legacy_review is distinct from jsonb_build_object('error',
        'analysis changed after submission; submit a new version against the current evidence and thresholds')
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'legacy current-policy refusal or full artifact preservation failed'; end if;
    -- U18 LEGACY CRITERIA REFUSAL END
    qualified:=true;
    raise exception using errcode='ZX011',message='U18 legacy v1 fixture rollback';
  exception when sqlstate 'ZX011' then null;
  end;
  if not qualified or pg_temp.u18_state() is distinct from baseline then
    raise exception 'legacy v1 qualification or complete rollback witness failed'; end if;
  -- Exact null/string/false/missing tags must hit the named row CHECK, not
  -- unrelated PK/FK/trigger errors. These never persist a packet or binding.
  perform set_config('app.risk_uncertainty_write','granted',true);
  for tag in select value from (values
    ('{}'::jsonb),('{"digestVersion":"2","bindingComplete":true}'::jsonb),
    ('{"digestVersion":2,"bindingComplete":false}'::jsonb),
    ('{"digestVersion":2,"bindingComplete":null}'::jsonb),
    ('{"digestVersion":null,"bindingComplete":true}'::jsonb)
  ) q(value) loop
    candidate:=to_jsonb(a)||jsonb_build_object('id',gen_random_uuid(),'risk_id',f.other_risk,
      'version',1,'analysis_digest',repeat('0',64),'input_binding_snapshot',tag);
    refused:=false;
    begin insert into public.risk_uncertainty_analyses
      select (jsonb_populate_record(null::public.risk_uncertainty_analyses,candidate)).*;
    exception when check_violation then get stacked diagnostics detail=constraint_name;
      refused:=detail='risk_uncertainty_binding_snapshot_check'; end;
    if not refused or pg_temp.u18_state() is distinct from baseline then
      raise exception 'invalid v2 typed tag refusal or complete artifact preservation failed'; end if;
    invalid_tags:=invalid_tags+1;
  end loop;
  perform set_config('app.risk_uncertainty_write','',true);
  if invalid_tags<>5 or pg_temp.u18_state() is distinct from baseline then
    raise exception 'v2 digest controls incomplete or left artifacts'; end if;
end $$;
-- U18 V2 DIGEST CONTROLS END

-- U18 VISIBILITY CONTROLS BEGIN
-- Actual canonical policy branches, not a concurrency or private-API bypass
-- claim. Owner diagnostics use the fixture JWT actor; actual public mutation
-- RPCs retain their named-human gates. Everything below rolls back together.
do $$ declare f record; baseline jsonb; snapshot jsonb; branch text; client text;
  grandparent uuid:=gen_random_uuid(); parent uuid:=gen_random_uuid(); child uuid:=gen_random_uuid();
  parent_scenario uuid:=gen_random_uuid(); child_scenario uuid:=gen_random_uuid();
  grand_view uuid:=gen_random_uuid(); parent_view uuid:=gen_random_uuid();
  evidence uuid:=gen_random_uuid(); packet uuid; receipt jsonb; packet_digest text;
  qualified boolean:=false; refused boolean; detail text;
  original_role text:=current_user; original_actor text:=current_setting('request.jwt.claim.sub',true);
begin
  select * into f from u18_fixture;
  baseline:=pg_temp.u18_state();
  foreach client in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(client,'public.risk_uncertainty_lock_visibility_context(uuid,uuid)','execute') then
      raise exception 'private visibility fence executable by a client role'; end if;
    refused:=false;
    begin
      execute format('set local role %I',client);
      perform public.risk_uncertainty_lock_visibility_context(f.org,child);
    exception when insufficient_privilege then
      get stacked diagnostics detail=message_text;
      refused:=detail='permission denied for function risk_uncertainty_lock_visibility_context';
    end;
    if not refused or current_user is distinct from original_role
      or pg_temp.u18_state() is distinct from baseline then
      raise exception 'direct client visibility-fence execution was not exactly denied'; end if;
  end loop;
  begin
    perform set_config('request.jwt.claim.sub','',true);
    insert into public.risks(id,organization_id,criteria_profile_id,title,status,value_currency,created_by)
    values(grandparent,f.org,f.criteria,'U18 synthetic privacy grandparent','draft','CAD',f.author);
    insert into public.scenarios(id,organization_id,risk_id,key,label)
    values(parent_scenario,f.org,grandparent,'u18_privacy_parent','Synthetic privacy parent origin');
    insert into public.risks(id,organization_id,criteria_profile_id,title,status,value_currency,created_by,
      secondary_to_risk_id,arising_from_scenario_id)
    values(parent,f.org,f.criteria,'U18 synthetic privacy parent','draft','CAD',f.author,
      grandparent,parent_scenario);
    insert into public.scenarios(id,organization_id,risk_id,key,label)
    values(child_scenario,f.org,parent,'u18_privacy_child','Synthetic privacy child origin');
    insert into public.risks(id,organization_id,criteria_profile_id,title,status,value_currency,created_by,
      risk_owner_id,secondary_to_risk_id,arising_from_scenario_id)
    values(child,f.org,f.criteria,'U18 synthetic privacy child','draft','CAD',f.author,
      f.reviewer,parent,child_scenario);
    insert into public.evidence_items(id,organization_id,risk_id,source_system,evidence_type,description,
      evidence_class,verification_status,verified_by,verified_at,verification_method,quality_grade,applicability_grade,revision)
    values(evidence,f.org,child,'CMMS','inspection','Synthetic privacy child inspection, not engineering evidence.',
      'INSPECTED','verified',f.reviewer,now(),'Synthetic privacy inspection fixture','high','direct','R2');
    perform set_config('request.jwt.claim.sub',f.reviewer::text,true);
    foreach branch in array array['public','internal','confidential'] loop
      update public.risks set information_sensitivity=branch where id=grandparent;
      snapshot:=pg_temp.u18_state();
      if public.risk_uncertainty_lock_visibility_context(f.org,child) is distinct from true
        or pg_temp.u18_state() is distinct from snapshot then
        raise exception 'canonical public/internal/engineering-role visibility control failed'; end if;
    end loop;
    update public.risks set information_sensitivity='restricted' where id=grandparent;
    snapshot:=pg_temp.u18_state();
    if public.risk_uncertainty_lock_visibility_context(f.org,child) is distinct from false
      or public.can_read_risk(child) is distinct from false
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'child ownership declassified an unreadable ancestor'; end if;
    receipt:=public.submit_risk_uncertainty_analysis(child,f.input,array[evidence]);
    if receipt is distinct from jsonb_build_object('error','risk not found in this organization')
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'unreadable ancestor submission did not refuse without artifacts'; end if;
    update public.risks set risk_owner_id=f.reviewer where id=grandparent;
    snapshot:=pg_temp.u18_state();
    if public.risk_uncertainty_lock_visibility_context(f.org,child) is distinct from true
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'canonical ancestor-owner visibility control failed'; end if;
    update public.risks set risk_owner_id=null,decision_owner_id=f.reviewer where id=grandparent;
    snapshot:=pg_temp.u18_state();
    if public.risk_uncertainty_lock_visibility_context(f.org,child) is distinct from true
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'canonical ancestor-decision-owner visibility control failed'; end if;
    update public.risks set decision_owner_id=null where id=grandparent;
    insert into public.risk_stakeholder_views(id,organization_id,risk_id,stakeholder_user_id,stakeholder_name,rationale)
    values(grand_view,f.org,grandparent,f.reviewer,'Synthetic privacy reviewer','Synthetic explicit ancestor grant.');
    -- Current canonical policy consumes existence, not consultation status.
    update public.risk_stakeholder_views set status='withdrawn' where id=grand_view;
    snapshot:=pg_temp.u18_state();
    if public.risk_uncertainty_lock_visibility_context(f.org,child) is distinct from true
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'visibility fence invented a stakeholder status permission gate'; end if;
    update public.risks set information_sensitivity='restricted' where id=parent;
    snapshot:=pg_temp.u18_state();
    if public.risk_uncertainty_lock_visibility_context(f.org,child) is distinct from false
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'one ancestor grant overrode another unreadable ancestor'; end if;
    insert into public.risk_stakeholder_views(id,organization_id,risk_id,stakeholder_user_id,stakeholder_name,rationale)
    values(parent_view,f.org,parent,f.reviewer,'Synthetic privacy reviewer','Synthetic second explicit ancestor grant.');
    snapshot:=pg_temp.u18_state();
    if public.risk_uncertainty_lock_visibility_context(f.org,child) is distinct from true
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'complete canonical stakeholder ancestry was not readable'; end if;
    update public.risk_stakeholder_views set organization_id=f.foreign_org where id=grand_view;
    snapshot:=pg_temp.u18_state();
    if public.risk_uncertainty_lock_visibility_context(f.org,child) is distinct from false
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'wrong-tenant stakeholder reference granted ancestor visibility'; end if;
    update public.risk_stakeholder_views set organization_id=f.org where id=grand_view;
    perform set_config('request.jwt.claim.sub',f.author::text,true);
    snapshot:=pg_temp.u18_state();
    if public.risk_uncertainty_lock_visibility_context(f.org,child) is distinct from true
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'canonical administrator ancestor visibility control failed'; end if;
    receipt:=public.submit_risk_uncertainty_analysis(child,f.input,array[evidence]);
    if receipt ? 'error' or receipt->>'riskId' is distinct from child::text
      or receipt->>'analysisId' is null or receipt->>'analysisDigest' !~ '^[0-9a-f]{64}$'
      or receipt->>'analysisDigest' is null or receipt->>'version' is distinct from '1'
      or receipt->>'validationStatus' is distinct from 'pending_review'
      or receipt->'operationalAuthorization' is distinct from 'false'::jsonb then
      raise exception 'readable inherited privacy submission did not return its bound receipt'; end if;
    packet:=(receipt->>'analysisId')::uuid; packet_digest:=receipt->>'analysisDigest';
    perform set_config('request.jwt.claim.sub',f.reviewer::text,true);
    update public.risk_stakeholder_views set stakeholder_user_id=null where id=parent_view;
    snapshot:=pg_temp.u18_state();
    receipt:=public.review_risk_uncertainty_analysis(packet,'validated',
      'Synthetic reviewer must not approve copied context after an ancestor grant revocation.');
    if receipt is distinct from jsonb_build_object('error','same-tenant uncertainty analysis is not awaiting review')
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'revoked ancestor review did not refuse without artifacts'; end if;
    update public.risk_stakeholder_views set stakeholder_user_id=f.reviewer where id=parent_view;
    receipt:=public.review_risk_uncertainty_analysis(packet,'validated',
      'Synthetic independent review of the exact readable inherited-context packet.');
    if receipt ? 'error' or receipt->>'analysisId' is distinct from packet::text
      or receipt->>'riskId' is distinct from child::text
      or receipt->>'analysisDigest' is distinct from packet_digest
      or receipt->>'decision' is distinct from 'validated'
      or receipt->>'approvalId' is null or receipt->>'derivedEvidenceItemId' is null
      or receipt->'operationalAuthorization' is distinct from 'false'::jsonb
      or not exists(select 1 from public.risk_uncertainty_analyses a
        join public.approvals p on p.id=a.approval_id and p.organization_id=a.organization_id and p.risk_id=a.risk_id
        join public.evidence_items e on e.id=a.derived_evidence_item_id and e.organization_id=a.organization_id and e.risk_id=a.risk_id
        where a.id=packet and a.status='validated' and a.author_id=f.author and a.reviewer_id=f.reviewer
          and a.analysis_digest=packet_digest and p.status='approved' and p.approver_user_id=f.reviewer
          and p.id::text=receipt->>'approvalId' and e.id::text=receipt->>'derivedEvidenceItemId'
          and e.evidence_class='CALCULATED' and e.verification_status='unverified') then
      raise exception 'readable inherited-context review lost its actual human/approval/evidence binding'; end if;
    perform set_config('request.jwt.claim.sub',f.foreign_user::text,true);
    snapshot:=pg_temp.u18_state();
    if public.risk_uncertainty_lock_visibility_context(f.org,child) is distinct from false
      or public.get_risk_uncertainty_workspace(child) is distinct from jsonb_build_object('error','risk not found in this organization')
      or pg_temp.u18_state() is distinct from snapshot then
      raise exception 'foreign actor received inherited private context'; end if;
    qualified:=true;
    raise exception using errcode='ZX014',message='U18 privacy branch fixture rollback';
  exception when sqlstate 'ZX014' then null;
  end;
  if not qualified or pg_temp.u18_state() is distinct from baseline
    or current_setting('request.jwt.claim.sub',true) is distinct from original_actor then
    raise exception 'privacy branch qualification or complete two-tenant rollback failed'; end if;
end $$;
-- U18 VISIBILITY CONTROLS END

set local role authenticated;
select set_config('request.jwt.claim.sub',reviewer::text,true) from u18_fixture;
do $$ declare f record; packet uuid; result jsonb; workspace jsonb; item jsonb; begin
  select * into f from u18_fixture; select id into packet from u18_packet;
  result:=public.review_risk_uncertainty_analysis(packet,'validated','Independent review confirms the exact synthetic inputs, evidence, thresholds, derivations and limitations.');
  if result ? 'error' or result->>'riskId' is distinct from f.risk::text
    or result->>'analysisId' is distinct from packet::text or result->>'decision' is distinct from 'validated'
    or result->>'analysisDigest' is distinct from (select digest from u18_packet)
    or result->'operationalAuthorization' is distinct from 'false'::jsonb
    or not exists(select 1 from approvals where id=(result->>'approvalId')::uuid
      and organization_id=f.org and risk_id=f.risk and approver_user_id=f.reviewer and status='approved'
      and approval_scope->>'kind'='risk_uncertainty_analysis'
      and approval_scope->>'analysisId'=packet::text
      and approval_scope->'operationalAuthorization'='false'::jsonb)
    or not exists(select 1 from evidence_items where id=(result->>'derivedEvidenceItemId')::uuid
      and organization_id=f.org and risk_id=f.risk and evidence_class='CALCULATED'
      and verification_status='unverified') then
    raise exception 'independent review receipt lacks bound canonical artifacts'; end if;
  workspace:=public.get_risk_uncertainty_workspace(f.risk);
  select x into item from jsonb_array_elements(workspace->'analyses') x where x->>'id'=packet::text;
  if item->'digestVersion' is distinct from '2'::jsonb
    or item->>'reviewStanding' is distinct from 'reviewable'
    or workspace->'criteria'->>'policyDigest' is null
    or workspace->'criteria'->>'policyDigest' !~ '^[0-9a-f]{64}$'
    or item->>'digestCoverage' is distinct from 'evidence_content_and_current_criteria' then
    raise exception 'v2 public workspace lacks exact stored digest coverage'; end if;
  if workspace->>'organizationId' is distinct from f.org::text
    or workspace->>'actorId' is distinct from f.reviewer::text
    or workspace->'risk'->>'id' is distinct from f.risk::text
    or workspace->'risk'->>'organizationId' is distinct from f.org::text
    or workspace->'criteria'->>'organizationId' is distinct from f.org::text
    or exists(select 1 from jsonb_array_elements(workspace->'evidence') e
      where e->>'organizationId' is distinct from f.org::text or e->>'riskId' is distinct from f.risk::text)
    or item is null or item->>'validationStatus' is distinct from 'validated'
    or item->>'storedStatus' is distinct from 'validated'
    or item->>'organizationId' is distinct from f.org::text
    or item->>'riskId' is distinct from f.risk::text
    or item->'decisionThresholds' is distinct from '{"escalateAbove":16,"stopAbove":24}'::jsonb
    or item->'probability' is distinct from '{"lower":0.15,"central":0.30,"upper":0.55}'::jsonb
    or item->'sensitivityResults'->0->>'name' is distinct from 'Startup exposure'
    or (item->'sensitivityResults'->0->>'swing')::numeric is distinct from 170000::numeric
    or (item->'valueOfInformation'->>'netValue')::numeric is distinct from 27500::numeric
    or item->>'derivedEvidenceItemId' is null
    or workspace->'operationalAuthorization' is distinct from 'false'::jsonb
    or workspace->>'boundary' is null
    or position('does not verify an unverified source' in workspace->>'boundary')=0 then
    raise exception 'canonical workspace projection parity failed'; end if;
end $$;
reset role;
-- U18 TERMINAL HISTORY REFUSALS BEGIN
select pg_temp.u18_history_refusals((select id from u18_packet),true);
-- Qualify the rejected branch through the actual independent review RPC, then
-- roll back its entire successor/advisory/approval/audit footprint.
do $$ declare f record; baseline jsonb; result jsonb; packet uuid; packet_digest text; qualified boolean:=false; begin
  select * into f from u18_fixture;
  baseline:=pg_temp.u18_state();
  begin
    perform set_config('request.jwt.claim.sub',f.author::text,true);
    result:=public.submit_risk_uncertainty_analysis(f.risk,f.input,array[f.verified]);
    if result ? 'error' or result->>'riskId' is distinct from f.risk::text
      or result->>'validationStatus' is distinct from 'pending_review'
      or (result->>'version')::integer is distinct from 2
      or result->>'analysisId' is null or result->>'analysisDigest' is null
      or result->>'analysisDigest' !~ '^[0-9a-f]{64}$'
      or result->'operationalAuthorization' is distinct from 'false'::jsonb then
      raise exception 'rejected history control requires an actual new pending version'; end if;
    packet:=(result->>'analysisId')::uuid;
    packet_digest:=result->>'analysisDigest';
    perform set_config('request.jwt.claim.sub',f.reviewer::text,true);
    result:=public.review_risk_uncertainty_analysis(packet,'rejected',
      'Independent synthetic reviewer rejects this separate rollback-only history control.');
    if result ? 'error' or result->>'analysisId' is distinct from packet::text
      or result->>'riskId' is distinct from f.risk::text
      or result->>'analysisDigest' is distinct from packet_digest
      or result->>'decision' is distinct from 'rejected'
      or result->'operationalAuthorization' is distinct from 'false'::jsonb
      or not exists(select 1 from public.risk_uncertainty_analyses a
        join public.approvals p on p.id=a.approval_id and p.organization_id=a.organization_id and p.risk_id=a.risk_id
        where a.id=packet and a.organization_id=f.org and a.risk_id=f.risk and a.version=2
          and a.status='rejected' and a.author_id=f.author and a.reviewer_id=f.reviewer
          and a.analysis_digest=packet_digest and not a.operational_authorization
          and a.approval_id=(result->>'approvalId')::uuid and a.derived_evidence_item_id is null
          and p.status='rejected' and p.approver_user_id=f.reviewer
          and p.approval_scope->>'analysisId'=packet::text and p.approval_scope->>'analysisDigest'=packet_digest
          and p.approval_scope->'operationalAuthorization'='false'::jsonb) then
      raise exception 'rejected history control lacks its actual independent disposition'; end if;
    perform pg_temp.u18_history_refusals(packet,true);
    qualified:=true;
    raise exception using errcode='ZX004',message='U18 rejected history fixture rollback';
  exception when sqlstate 'ZX004' then null;
  end;
  if not qualified or pg_temp.u18_state() is distinct from baseline then
    raise exception 'rejected history qualification or full no-artifact rollback witness failed'; end if;
end $$;
-- U18 TERMINAL HISTORY REFUSALS END
-- Only the newly generated evidence; require one actual edit before stale proof.
do $$ declare affected bigint; begin
  update evidence_items set quality_grade='moderate' where id=(select verified from u18_fixture) and quality_grade='high';
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'stale witness did not change its actual evidence'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',author::text,true) from u18_fixture;
do $$ declare item jsonb; begin
  select x into item from jsonb_array_elements(public.get_risk_uncertainty_workspace((select risk from u18_fixture))->'analyses') x
    where x->>'id'=(select id::text from u18_packet);
  if item is null or item->>'validationStatus' is distinct from 'stale'
    or item->>'reviewStanding' is distinct from 'replacement_required'
    or item->>'analysisDigest' is not distinct from item->>'currentDigest' then
    raise exception 'actual evidence edit did not invalidate digest standing'; end if;
end $$;
select set_config('request.jwt.claim.sub',foreign_user::text,true) from u18_fixture;
do $$ declare result jsonb; begin
  result:=public.get_risk_uncertainty_workspace((select risk from u18_fixture));
  if result->>'error' is distinct from 'risk not found in this organization'
    or exists(select 1 from risk_uncertainty_analyses where organization_id=(select org from u18_fixture))
    or exists(select 1 from risk_uncertainty_analysis_evidence where organization_id=(select org from u18_fixture)) then
    raise exception 'foreign workspace or raw uncertainty tables leaked'; end if;
end $$;
reset role;
do $$ declare f record; packet uuid; counts text; begin
  select * into f from u18_fixture; select id into packet from u18_packet;
  select concat_ws('|',
    (select count(*) from approvals where organization_id=f.org and risk_id=f.risk and approval_scope->>'kind'='risk_uncertainty_analysis' and status='approved'),
    (select count(*) from audit_events where organization_id=f.org and entity_type in('risk_uncertainty_analysis_submitted','risk_uncertainty_analysis_reviewed') and event_data->>'analysis_id'=packet::text),
    (select count(*) from evidence_items where id=(select derived_evidence_item_id from risk_uncertainty_analyses where id=packet) and evidence_class='CALCULATED' and verification_status='unverified'),
    (select count(*) from decisions where organization_id=f.org and risk_id=f.risk),
    (select count(*) from work_orders where organization_id=f.org and risk_id=f.risk)) into counts;
  if counts is distinct from '1|2|1|0|0' then raise exception 'review ledger or operational-authority wall failed'; end if;
  if exists(select 1 from risks where id in(f.risk,f.other_risk) and status<>'draft') then
    raise exception 'uncertainty review promoted risk lifecycle'; end if;
end $$;
-- TODO: canonical source-standing/quarantine/supersession, inherited privacy,
-- post-wait human-role revalidation, finite numeric guards and stale replacement
-- belong to the coordinated backend repair. No fabricated source-standing link
-- and no full U18 qualification claim from this baseline.
rollback;
select 'U18 isolated native baseline PASS: exact evidence/order refusals/no artifacts, advisory receipts, VOI/sensitivity/thresholds, independent review, real mutation/truncate triggers, native ACLs, digest stale, tenant/raw walls, 1|2|1|0|0 ledger, fixtures rolled back; broader U18 remains partial';

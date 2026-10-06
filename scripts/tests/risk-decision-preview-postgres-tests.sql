-- Requires the actual complete migration chain. No schema/helper substitution,
-- trigger disabling, approval fabrication or permanent fixture writes.
begin;
create temporary table risk_preview_fixture as select
  gen_random_uuid() as org, gen_random_uuid() as foreign_org,
  gen_random_uuid() as administrator, gen_random_uuid() as reader,
  gen_random_uuid() as foreign_user, gen_random_uuid() as context, gen_random_uuid() as objective,
  gen_random_uuid() as restricted_risk, gen_random_uuid() as incomplete_risk;
grant select on risk_preview_fixture to authenticated;

insert into organizations(id,name,industry)
select org,'Risk preview isolated CI tenant','utilities' from risk_preview_fixture
union all select foreign_org,'Risk preview foreign CI tenant','utilities' from risk_preview_fixture;
insert into auth.users(id,email)
select administrator,administrator||'@example.invalid' from risk_preview_fixture
union all select reader,reader||'@example.invalid' from risk_preview_fixture
union all select foreign_user,foreign_user||'@example.invalid' from risk_preview_fixture;
insert into user_profiles(id,organization_id,email,role)
select administrator,org,administrator||'@example.invalid','admin' from risk_preview_fixture
union all select reader,org,reader||'@example.invalid','planner' from risk_preview_fixture
union all select foreign_user,foreign_org,foreign_user||'@example.invalid','admin' from risk_preview_fixture
on conflict(id) do update set organization_id=excluded.organization_id,email=excluded.email,role=excluded.role;
insert into risk_context_nodes(id,organization_id,scope_kind,name)
select context,org,'decision','Synthetic risk preview qualification' from risk_preview_fixture;
-- A real canonical draft objective, not a fabricated adoption/approval. The
-- secondary writer inherits this named objective without promoting its status.
insert into risk_objectives(id,organization_id,context_id,owner_id,objective_level,
  description,target,measurement,timeframe,tolerance)
select objective,org,context,administrator,'task','Synthetic qualification objective',
  'Preserve privacy','Isolated CI assertions','Fixture transaction','No operational authority'
from risk_preview_fixture;
create temporary table risk_preview_children(id uuid,parent_id uuid,scenario_id uuid);
grant select,insert on risk_preview_children to authenticated;

create temporary table risk_preview_cases (
  label text, risk_id uuid default gen_random_uuid(), criteria_id uuid default gen_random_uuid(),
  scale numeric, likelihood numeric, weight numeric, criteria_status text,
  days numeric, time_weight numeric, kind text, expected_score numeric,
  expected_level text, expected_action text, expected_opportunity numeric,
  analysis jsonb
);
grant select on risk_preview_cases to authenticated;
insert into risk_preview_cases(label,scale,likelihood,weight,criteria_status,days,time_weight,kind,
  expected_score,expected_level,expected_action,expected_opportunity) values
  ('exact sixty',5,3,1,'adopted',null,0,'threat',60,'High','TREAT',0),
  ('fractional scale',0.5,0.2,1,'adopted',null,0,'threat',40,'Medium','INVESTIGATE',0),
  ('PG repeating division',3,1,0.3,'adopted',null,0,'threat',10,'Very Low','ACCEPT',0),
  ('draft criteria',5,3,1,'draft',null,0,'threat',60,'High','INVESTIGATE',0),
  ('opportunity',5,3,1,'adopted',null,0,'opportunity',60,'High','TREAT',49),
  ('zero time weight',5,0,1,'adopted',1,0,'threat',0,'Very Low','ACCEPT',0),
  ('time pressure',5,0,1,'adopted',1,1,'threat',99.7,'Critical','STOP',0),
  ('below sixty rounds sixty',5,2.9999995,1,'adopted',null,0,'threat',60,'Medium','INVESTIGATE',0),
  ('above sixty',5,3.0000005,1,'adopted',null,0,'threat',60,'High','TREAT',0);
update risk_preview_cases set analysis=jsonb_build_object(
  'analysis_level','semi_quantitative','analysis_method','risk_matrix',
  'likelihood',likelihood,'consequences',jsonb_build_object('safety',5),
  'control_effectiveness',0,'uncertainty',0,'confidence',70,'complexity',0,
  'connectivity',0,'exposure',75,'capacity_load',0,'velocity',0,
  'time_to_unacceptable_days',days,'opportunity_value',80);
insert into risk_criteria_profiles(id,organization_id,context_id,name,status,likelihood_scale,
  consequence_dimensions,thresholds,scoring_weights,decision_thresholds,time_factors,basis)
select x.criteria_id,f.org,f.context,x.label,x.criteria_status,jsonb_build_array(x.scale),
  '["safety"]'::jsonb,
  jsonb_build_object('low',10,'medium',40,'high',60,'critical',80),
  jsonb_build_object('inherent',x.weight,'exposure',0,'uncertainty',0,'connectivity',0,'velocity',0,'capacity',0),
  jsonb_build_object('accept',0,'monitor',10,'investigate',40,'treat',60,'escalate',80),
  jsonb_build_object('weight',x.time_weight),'Synthetic numeric boundary fixture, not engineering policy'
from risk_preview_cases x cross join risk_preview_fixture f;
insert into risks(id,organization_id,context_id,objective_id,criteria_profile_id,title,kind,
  objective_at_risk,risk_source,event_description,risk_owner_id,decision_owner_id,
  scope_decision,scope_expected_outcome,scope_inclusions,scope_exclusions,time_horizon,
  location_scope,resource_scope,responsibility_scope,relationship_scope,assumptions,
  bias_review_complete,data_quality,method_limitations,reporting_profile)
select x.risk_id,f.org,f.context,f.objective,x.criteria_id,x.label,x.kind,'Synthetic service objective',
  'Controlled CI source','Controlled CI event',f.administrator,f.administrator,
  'Compare advisory calculation','Preserve governed risk boundaries','["synthetic asset"]',
  '["real operations"]','Fixture duration','Disposable CI tenant','["fixture only"]',
  '["CI author"]','["no customer relationship"]','["synthetic values"]',true,'synthetic',
  '["not engineering evidence"]','{"audiences":["CI"],"frequency":"once","method":"test","timeliness":"fixture","cost_limit":0}'
from risk_preview_cases x cross join risk_preview_fixture f;
insert into risks(id,organization_id,objective_id,title,criteria_profile_id,information_sensitivity,risk_owner_id,decision_owner_id)
select f.restricted_risk,f.org,f.objective,'Restricted synthetic risk',c.criteria_id,'restricted',f.administrator,f.administrator
from risk_preview_fixture f cross join risk_preview_cases c where c.label='exact sixty'
union all select f.incomplete_risk,f.org,f.objective,'Incomplete synthetic risk',c.criteria_id,'internal',f.administrator,f.administrator
from risk_preview_fixture f cross join risk_preview_cases c where c.label='exact sixty';

-- Both directions of a visible/private connection must be filtered; a fully
-- visible connection must retain its original nested projection.
insert into risk_links(organization_id,source_risk_id,target_risk_id,relationship,dependency_key,rationale)
select f.org,a.risk_id,b.risk_id,'common_dependency','visible-fixture-link','Visible link fixture'
from risk_preview_fixture f cross join risk_preview_cases a cross join risk_preview_cases b
where a.label='fractional scale' and b.label='draft criteria'
union all select f.org,a.risk_id,f.restricted_risk,'common_dependency','private-outbound-fixture','Private outbound fixture'
from risk_preview_fixture f cross join risk_preview_cases a where a.label='fractional scale'
union all select f.org,f.restricted_risk,b.risk_id,'common_dependency','private-inbound-fixture','Private inbound fixture'
from risk_preview_fixture f cross join risk_preview_cases b where b.label='draft criteria';

-- A future-dated canonical qualification and missing resource reproduce the
-- previously fabricated executable=true/incomplete audit snapshot together.
insert into workforce_members(organization_id,employee_ref,display_name,craft)
select org,'risk-preview-future','Synthetic future-qualified member','fixture' from risk_preview_fixture;
insert into competencies(organization_id,competency_key,title,kind)
select org,'risk-preview-future','Synthetic future qualification','certification' from risk_preview_fixture;
insert into member_competencies(organization_id,member_id,competency_id,granted_on,expires_on)
select f.org,w.id,c.id,current_date+1,current_date+30
from risk_preview_fixture f join workforce_members w on w.organization_id=f.org and w.employee_ref='risk-preview-future'
join competencies c on c.organization_id=f.org and c.competency_key='risk-preview-future';

set local role authenticated;
select set_config('request.jwt.claim.sub',administrator::text,true) from risk_preview_fixture;
do $$
declare
  f record; x record; preview jsonb; receipt jsonb; before_risk jsonb;
  ledger bigint; evidence bigint; approvals_count bigint; scenario_count bigint;
  option jsonb; correction record; blocked boolean := false;
begin
  select * into f from risk_preview_fixture;
  for x in select * from risk_preview_cases loop
    select to_jsonb(r) into before_risk from risks r where id=x.risk_id;
    select count(*) into ledger from audit_events where organization_id=f.org;
    select count(*) into evidence from evidence_items where organization_id=f.org;
    select count(*) into approvals_count from approvals where organization_id=f.org;
    preview:=public.get_risk_analysis_preview(x.risk_id,x.analysis);
    if preview ? 'error' or preview->>'risk_id' is distinct from x.risk_id::text
       or preview->>'criteria_id' is distinct from x.criteria_id::text or preview->'analysis' is distinct from x.analysis
       or preview->'advisory_only' is distinct from 'true'::jsonb or preview->'human_decision_required' is distinct from 'true'::jsonb
       or (preview->>'current_score')::numeric is distinct from x.expected_score
       or preview->>'level' is distinct from x.expected_level or preview->>'recommended_action' is distinct from x.expected_action
       or (preview->>'opportunity_score')::numeric is distinct from x.expected_opportunity then
      raise exception 'canonical preview boundary % failed: %',x.label,preview;
    end if;
    if (select to_jsonb(r) from risks r where id=x.risk_id) is distinct from before_risk
       or (select count(*) from audit_events where organization_id=f.org) is distinct from ledger
       or (select count(*) from evidence_items where organization_id=f.org) is distinct from evidence
       or (select count(*) from approvals where organization_id=f.org) is distinct from approvals_count then
      raise exception 'preview mutated canonical state';
    end if;
    receipt:=public.record_risk_analysis(x.risk_id,x.analysis);
    if receipt ? 'error' or receipt->>'risk_id' is distinct from x.risk_id::text or receipt->>'status' is distinct from 'analyzed'
       or receipt->'current_score' is distinct from preview->'current_score'
       or receipt->'level' is distinct from preview->'level' or receipt->'recommended_action' is distinct from preview->'recommended_action'
       or receipt->'inherent_score' is distinct from preview->'inherent_score'
       or receipt->'opportunity_score' is distinct from preview->'opportunity_score'
       or receipt->'authoritative' is distinct from preview->'authoritative' then
      raise exception 'preview/writer mismatch %: % / %',x.label,preview,receipt;
    end if;
    if not exists(select 1 from risks where id=x.risk_id and current_risk_score=x.expected_score
      and current_risk_level=x.expected_level and decision_action=x.expected_action) then
      raise exception 'persisted analysis does not match canonical receipt';
    end if;
    if (select count(*) from approvals where organization_id=f.org) is distinct from approvals_count then
      raise exception 'analysis created operational approval authority';
    end if;
  end loop;
  select analysis into preview from risk_preview_cases where label='exact sixty';
  receipt:=public.record_risk_analysis(f.incomplete_risk,preview);
  if receipt->>'error' is distinct from 'risk contract incomplete'
    or jsonb_typeof(receipt->'gaps') is distinct from 'array'
    or coalesce(jsonb_array_length(receipt->'gaps'),0)=0
    or exists(select 1 from audit_events where event_data->>'risk_id'=f.incomplete_risk::text) then
    raise exception 'incomplete lifecycle contract did not refuse before writing: %',receipt;
  end if;
  if (public.get_risk_analysis_preview(f.restricted_risk,'{}') ? 'error') is distinct from true then
    raise exception 'malformed analysis did not refuse';
  end if;
  begin
    perform public.calculate_risk_analysis_internal('threat',preview,
      (select c from risk_criteria_profiles c join risk_preview_cases private_case
        on c.id=private_case.criteria_id where private_case.label='exact sixty'));
  exception when insufficient_privilege then blocked:=true;
  end;
  if not blocked then raise exception 'authenticated caller directly executed private calculator'; end if;
  if has_function_privilege('authenticated',
      'public.calculate_risk_analysis_internal(text,jsonb,public.risk_criteria_profiles)','EXECUTE')
    or has_function_privilege('anon',
      'public.calculate_risk_analysis_internal(text,jsonb,public.risk_criteria_profiles)','EXECUTE')
    or has_function_privilege('service_role',
      'public.calculate_risk_analysis_internal(text,jsonb,public.risk_criteria_profiles)','EXECUTE') then
    raise exception 'private calculator retains a public role execute grant'; end if;
  blocked:=false;
  begin perform public.get_risk_operating_cockpit();
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'unfiltered legacy cockpit remains public'; end if;
  blocked:=false;
  begin perform public.get_aggregate_risk_exposure(null);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'unfiltered legacy aggregate remains public'; end if;
  blocked:=false;
  begin perform public.get_risk_management_effectiveness();
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'unfiltered legacy effectiveness remains public'; end if;
  blocked:=false;
  begin perform public.get_risk_audience_view_internal(f.restricted_risk,'manager');
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'private audience implementation remains public'; end if;
  if has_function_privilege('anon','public.get_risk_operating_cockpit()','EXECUTE')
    or has_function_privilege('service_role','public.get_risk_operating_cockpit()','EXECUTE')
    or has_function_privilege('anon','public.get_aggregate_risk_exposure(uuid)','EXECUTE')
    or has_function_privilege('service_role','public.get_aggregate_risk_exposure(uuid)','EXECUTE')
    or has_function_privilege('anon','public.get_risk_management_effectiveness()','EXECUTE')
    or has_function_privilege('service_role','public.get_risk_management_effectiveness()','EXECUTE')
    or has_function_privilege('anon','public.get_risk_audience_view_internal(uuid,text)','EXECUTE')
    or has_function_privilege('service_role','public.get_risk_audience_view_internal(uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.get_sensitive_risk_operating_cockpit_internal()','EXECUTE')
    or has_function_privilege('service_role','public.get_sensitive_risk_operating_cockpit_internal()','EXECUTE') then
    raise exception 'legacy projection helper grants were not fully revoked'; end if;
  blocked:=false;
  begin perform public.get_sensitive_risk_operating_cockpit_internal();
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'internal sensitive cockpit remains public'; end if;
  preview:=public.get_sensitive_risk_operating_cockpit();
  if (select count(*) from jsonb_array_elements(preview->'risks') r,
      lateral jsonb_array_elements(r->'links') l
      where l->>'dependency_key' in('visible-fixture-link','private-outbound-fixture','private-inbound-fixture'))
      is distinct from 6::bigint then
    raise exception 'authorized administrator nested links changed'; end if;
  if jsonb_typeof(preview) is distinct from 'object' or preview ? 'error'
    or jsonb_typeof(preview->'risks') is distinct from 'array'
    or not exists(select 1 from jsonb_array_elements(preview->'risks') item
      where item->>'id'=f.restricted_risk::text) then
    raise exception 'authorized sensitivity cockpit cannot compose its private helpers'; end if;
  option:='{"strategy":"change_likelihood","label":"Synthetic nonselected treatment","residual_risk":10,"introduced_risks":[],"required_resources":["fixture crane"],"available_resources":[],"required_competencies":["risk-preview-future"]}';
  receipt:=public.create_risk_treatment(f.restricted_risk,option,false);
  if receipt ? 'error' or receipt->'executable' is distinct from 'false'::jsonb
    or receipt->'readiness_gaps' is distinct from '["resource: fixture crane","competency: risk-preview-future"]'::jsonb then
    raise exception 'complete treatment correction failed: %',receipt;
  end if;
  select * into correction from audit_events where entity_type='risk_treatment_readiness_correction'
    and event_data->>'scenario_id'=receipt->>'scenario_id';
  if not found or correction.previous_state is distinct from '{"executable":false,"readiness_gaps":["resource: fixture crane"]}'::jsonb
    or correction.new_state is distinct from jsonb_build_object('executable',false,'readiness_gaps',receipt->'readiness_gaps') then
    raise exception 'readiness ledger fabricated its before/after state';
  end if;
  select count(*) into scenario_count from scenarios where risk_id=f.restricted_risk;
  select count(*) into approvals_count from approvals where organization_id=f.org;
  receipt:=public.create_risk_treatment(f.restricted_risk,option,true);
  if (receipt ? 'error') is distinct from true or receipt->'selected' is distinct from 'false'::jsonb
    or (select count(*) from scenarios where risk_id=f.restricted_risk) is distinct from scenario_count
    or (select count(*) from approvals where organization_id=f.org) is distinct from approvals_count then
    raise exception 'future qualification selected treatment or wrote before refusal';
  end if;
  receipt:=public.record_risk_value_of_information(f.restricted_risk,
    '{"information_action":"Inspect synthetic CI evidence","information_cost":10,"decision_cost_if_wrong":100,"uncertainty_reduction":0.5,"probability_decision_changes":0.5,"currency":"CAD"}');
  if receipt ? 'error' or receipt->>'risk_id' is distinct from f.restricted_risk::text
    or public.sync_text_as_uuid(receipt->>'evidence_id') is null
    or receipt->'advisory_only' is distinct from 'true'::jsonb or receipt->'human_decision_required' is distinct from 'true'::jsonb
    or (receipt->>'net_value')::numeric is distinct from 15 then raise exception 'unbound information receipt: %',receipt; end if;
end $$;

-- Exercise the actual canonical treatment writer (not a hand-made child),
-- current RLS, actual secondary read RPC and information/evidence writer.
do $$
declare f record; parent uuid; child uuid; scenario uuid; receipt jsonb;
  option jsonb; evidence_receipt jsonb; refused boolean; baseline bigint; affected bigint;
begin
  select * into f from risk_preview_fixture;
  for parent in select f.restricted_risk union all
    select risk_id from risk_preview_cases where label='exact sixty' loop
    option:=jsonb_build_object('strategy','change_likelihood','label','Canonical child privacy fixture',
      'residual_risk',10,'introduced_risk',20,'introduced_risks',jsonb_build_array('Synthetic secondary hazard'),
      'new_risk_created',jsonb_build_array(jsonb_build_object('title','Synthetic derived hazard',
        'event_description','Controlled CI secondary event only','current_risk_score',20,
        'current_risk_level','Low','risk_owner_id',f.administrator)));
    receipt:=public.create_risk_treatment(parent,option,false);
    child:=public.sync_text_as_uuid(receipt->'secondary_risks'->0->>'risk_id');
    scenario:=public.sync_text_as_uuid(receipt->>'scenario_id');
    if receipt ? 'error' or child is null or scenario is null
      or receipt->>'risk_id' is distinct from parent::text
      or receipt->'selected' is distinct from 'false'::jsonb
      or receipt->'recommendation_id' is distinct from 'null'::jsonb
      or receipt->'approval_id' is distinct from 'null'::jsonb
      or (select information_sensitivity from risks where id=child) is distinct from
        (select information_sensitivity from risks where id=parent)
      or (select objective_id from risks where id=child) is distinct from f.objective then
      raise exception 'canonical child did not inherit bound sensitivity/objective: %',receipt;
    end if;
    insert into risk_preview_children values(child,parent,scenario);
    evidence_receipt:=public.get_risk_audience_view(child,'manager');
    if jsonb_typeof(evidence_receipt) is distinct from 'object'
      or evidence_receipt->>'risk_id' is distinct from child::text
      or evidence_receipt->>'objective' is distinct from (select objective_at_risk from risks where id=child)
      or evidence_receipt->>'event' is distinct from (select event_description from risks where id=child) then
      raise exception 'authorized audience wrapper changed the canonical projection'; end if;
    evidence_receipt:=public.record_risk_value_of_information(child,
      '{"information_action":"Synthetic child evidence","information_cost":10,"decision_cost_if_wrong":100,"uncertainty_reduction":0.5,"probability_decision_changes":0.5,"currency":"CAD"}');
    if evidence_receipt ? 'error' or public.sync_text_as_uuid(evidence_receipt->>'evidence_id') is null then
      raise exception 'canonical child evidence writer failed';
    end if;
    -- Ordinary RLS may legitimately refuse an UPDATE by affecting zero rows.
    -- Prove no mutation AND the exact preserved origin; this is not a claim
    -- that its trigger executed. Privileged probes below prove each trigger.
    refused:=false; affected:=0;
    begin update risks set secondary_to_risk_id=null where id=child;
      get diagnostics affected=row_count;
    exception when check_violation or insufficient_privilege then refused:=true; end;
    if affected<>0 or (select secondary_to_risk_id from risks where id=child) is distinct from parent then
      raise exception 'child parent origin was severed'; end if;
    raise notice 'ordinary parent-origin refusal: exception=%, changed_rows=%',refused,affected;
    refused:=false; affected:=0;
    begin update risks set arising_from_scenario_id=null where id=child;
      get diagnostics affected=row_count;
    exception when check_violation or insufficient_privilege then refused:=true; end;
    if affected<>0 or (select arising_from_scenario_id from risks where id=child) is distinct from scenario then
      raise exception 'child scenario origin was severed'; end if;
    raise notice 'ordinary treatment-origin refusal: exception=%, changed_rows=%',refused,affected;
    refused:=false; affected:=0;
    begin update scenarios set risk_id=f.incomplete_risk where id=scenario;
      get diagnostics affected=row_count;
    exception when check_violation or insufficient_privilege then refused:=true; end;
    if affected<>0 or (select risk_id from scenarios where id=scenario) is distinct from parent then
      raise exception 'canonical originating scenario was reparented'; end if;
    raise notice 'ordinary scenario-parent refusal: exception=%, changed_rows=%',refused,affected;
    -- State-preservation proof under ordinary authenticated RLS. A zero-row
    -- DELETE is a valid refusal here; a separate privileged probe below proves
    -- the actual trigger independently of that policy.
    refused:=false;
    begin delete from scenarios where id=scenario;
      refused:=exists(select 1 from scenarios where id=scenario);
    exception when check_violation then refused:=true; end;
    if not refused then raise exception 'canonical originating scenario was deleted'; end if;
    select count(*) into baseline from audit_events where entity_type='risk_secondary_created'
      and event_data->>'risk_id'=child::text;
    refused:=false;
    begin
      insert into audit_events(organization_id,entity_type,actor,event_data,new_state)
      values(f.org,'risk_secondary_created','CI',jsonb_build_object('risk_id',child,
        'parent_risk_id',parent,'scenario_id',scenario),
        jsonb_build_object('status','draft','secondary_to_risk_id',parent,'arising_from_scenario_id',scenario));
    exception when check_violation or insufficient_privilege then refused:=true; end;
    if not refused or (select count(*) from audit_events where entity_type='risk_secondary_created'
      and event_data->>'risk_id'=child::text) is distinct from baseline then
      raise exception 'duplicate origin receipt was accepted';
    end if;
  end loop;
end $$;

-- Controlled privileged fixture probes exercise the actual triggers instead
-- of mistaking table INSERT ACL/DELETE RLS refusal for trigger qualification.
-- The real named fixture administrator remains the current actor; no trigger
-- or RLS is disabled, no customer is touched and all writes roll back.
reset role;
do $$
declare f record; c record; a record; refused boolean; detail text; baseline bigint;
begin
  select * into f from risk_preview_fixture;
  for c in select * from risk_preview_children loop
    if (select secondary_to_risk_id from risks where id=c.id) is distinct from c.parent_id
      or (select arising_from_scenario_id from risks where id=c.id) is distinct from c.scenario_id
      or (select risk_id from scenarios where id=c.scenario_id) is distinct from c.parent_id then
      raise exception 'canonical origin trigger target is not bound'; end if;
    refused:=false;
    begin update risks set secondary_to_risk_id=null where id=c.id;
    exception when check_violation then
      get stacked diagnostics detail=message_text;
      refused:=detail='Secondary risk parent provenance cannot be severed or replaced';
    end;
    if not refused or (select secondary_to_risk_id from risks where id=c.id) is distinct from c.parent_id then
      raise exception 'actual child-parent origin trigger failed'; end if;
    refused:=false;
    begin update risks set arising_from_scenario_id=null where id=c.id;
    exception when check_violation then
      get stacked diagnostics detail=message_text;
      refused:=detail='Secondary risk treatment provenance cannot be severed or replaced';
    end;
    if not refused or (select arising_from_scenario_id from risks where id=c.id) is distinct from c.scenario_id then
      raise exception 'actual child-treatment origin trigger failed'; end if;
    refused:=false;
    begin update scenarios set risk_id=f.incomplete_risk where id=c.scenario_id;
    exception when check_violation then
      get stacked diagnostics detail=message_text;
      refused:=detail='A secondary risk treatment origin identity, tenant and parent are immutable';
    end;
    if not refused or (select risk_id from scenarios where id=c.scenario_id) is distinct from c.parent_id then
      raise exception 'actual scenario-parent origin trigger failed'; end if;
    select * into a from audit_events where entity_type='risk_secondary_created'
      and event_data->>'risk_id'=c.id::text and organization_id=f.org;
    if not found then raise exception 'canonical creation lacks actual origin receipt'; end if;
    select count(*) into baseline from audit_events where organization_id=f.org;
    refused:=false;
    begin
      insert into audit_events(organization_id,entity_type,actor,event_data,new_state)
      values(f.org,'risk_secondary_created','CI',a.event_data,a.new_state);
    exception when check_violation then
      get stacked diagnostics detail=message_text;
      refused:=detail='A secondary risk canonical origin receipt already exists';
    end;
    if not refused or (select count(*) from audit_events where organization_id=f.org) is distinct from baseline then
      raise exception 'actual duplicate-origin trigger failed'; end if;
    refused:=false;
    begin delete from scenarios where id=c.scenario_id;
    exception when check_violation then
      get stacked diagnostics detail=message_text;
      refused:=detail='A secondary risk treatment origin cannot be deleted';
    end;
    if not refused or not exists(select 1 from scenarios where id=c.scenario_id) then
      raise exception 'actual scenario-origin deletion trigger failed'; end if;
  end loop;
end $$;
set local role authenticated;

-- The ordinary derived row is initially visible. Later parent reclassification
-- must revoke access without rewriting either the child or its original ledger.
select set_config('request.jwt.claim.sub',reader::text,true) from risk_preview_fixture;
do $$ declare child uuid; parent uuid; payload jsonb; begin
  select c.id,c.parent_id into child,parent from risk_preview_children c join risk_preview_cases p
    on p.risk_id=c.parent_id where p.label='exact sixty';
  payload:=public.get_risk_secondary_risks(child);
  if public.can_read_risk(child) is distinct from true or not exists(select 1 from risks where id=child)
    or payload->>'riskId' is distinct from child::text
    or payload->'createdByTreatmentOf'->>'riskId' is distinct from parent::text then
    raise exception 'ordinary child could not be read before parent reclassification'; end if;
end $$;
select set_config('request.jwt.claim.sub',administrator::text,true) from risk_preview_fixture;
-- Require an actual one-row change, not an authenticated zero-row UPDATE.
-- This fixture owner changes only its random, transaction-local parent.
reset role;
do $$ declare target uuid; affected bigint; begin
  select risk_id into target from risk_preview_cases where label='exact sixty';
  if target is null or (select information_sensitivity from risks where id=target) is distinct from 'internal' then
    raise exception 'parent reclassification lacks the actual ordinary target'; end if;
  update risks set information_sensitivity='restricted' where id=target;
  get diagnostics affected=row_count;
  if affected<>1 or (select information_sensitivity from risks where id=target) is distinct from 'restricted' then
    raise exception 'parent reclassification did not change its actual target'; end if;
end $$;

-- Same-tenant ordinary reader: the risk and its canonical ledger payloads are
-- denied together; ordinary unrelated ledger entries remain tenant-readable.
reset role;
insert into audit_events(organization_id,entity_type,actor,event_data)
select org,'risk_preview_unrelated_fixture','CI','{"synthetic":true}' from risk_preview_fixture;
set local role authenticated;
select set_config('request.jwt.claim.sub',reader::text,true) from risk_preview_fixture;
do $$ declare f record; payload jsonb; begin
  select * into f from risk_preview_fixture;
  if exists(select 1 from audit_events where event_data->>'risk_id'=f.restricted_risk::text) then
    raise exception 'restricted risk leaked through canonical audit ledger'; end if;
  if not exists(select 1 from audit_events where entity_type='risk_preview_unrelated_fixture' and organization_id=f.org) then
    raise exception 'unrelated ledger access was removed'; end if;
  select analysis into payload from risk_preview_cases where label='exact sixty';
  if (public.get_risk_analysis_preview(f.restricted_risk,payload) ? 'error') is distinct from true
    or (public.get_risk_decision_preview_context(f.restricted_risk) ? 'error') is distinct from true
    or (public.record_risk_analysis(f.restricted_risk,payload) ? 'error') is distinct from true then
    raise exception 'restricted risk or unauthorized writer boundary failed'; end if;
  if exists(select 1 from risks where id in(select id from risk_preview_children))
    or exists(select 1 from evidence_items where risk_id in(select id from risk_preview_children))
    or exists(select 1 from audit_events where event_data->>'risk_id' in
      (select id::text from risk_preview_children)) then
    raise exception 'derived risk/evidence/audit leaked after ancestor restriction'; end if;
  if exists(select 1 from risk_preview_children c where public.can_read_risk(c.id)
    or (public.get_risk_secondary_risks(c.id) ? 'error') is distinct from true
    or (public.get_risk_decision_preview_context(c.id) ? 'error') is distinct from true) then
    raise exception 'derived risk definer read bypassed ancestor restriction'; end if;
  if (public.get_risk_audience_view(f.restricted_risk,'manager')->>'error') is distinct from 'risk not available to this user'
    or exists(select 1 from risk_preview_children c where
      public.get_risk_audience_view(c.id,'manager')->>'error' is distinct from 'risk not available to this user') then
    raise exception 'public audience read bypassed parent or inherited restriction'; end if;
  payload:=public.get_sensitive_risk_operating_cockpit();
  if jsonb_typeof(payload->'risks') is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(payload->'risks') item
      where item->>'id'=f.restricted_risk::text or item->>'id' in(select id::text from risk_preview_children)) then
    raise exception 'sensitive cockpit leaked inherited private context'; end if;
  if exists(select 1 from jsonb_array_elements(payload->'risks') r,
      lateral jsonb_array_elements(r->'links') l
      where l->>'related_risk_id'=f.restricted_risk::text
        or l->>'dependency_key' in('private-outbound-fixture','private-inbound-fixture')) then
    raise exception 'nested cockpit links leaked a restricted endpoint'; end if;
  if (select count(*) from jsonb_array_elements(payload->'risks') r,
      lateral jsonb_array_elements(r->'links') l where l->>'dependency_key'='visible-fixture-link')
      is distinct from 2::bigint then
    raise exception 'fully visible nested link was not preserved in both directions'; end if;
end $$;
select set_config('request.jwt.claim.sub',foreign_user::text,true) from risk_preview_fixture;
do $$ declare target uuid; payload jsonb; begin
  select risk_id,analysis into target,payload from risk_preview_cases where label='exact sixty';
  if (public.get_risk_analysis_preview(target,payload) ? 'error') is distinct from true
    or exists(select 1 from audit_events where organization_id=(select org from risk_preview_fixture)) then
    raise exception 'foreign tenant risk preview or audit access leaked'; end if;
end $$;
reset role;
rollback;
select 'risk_decision_preview: nine canonical boundaries PASS; read-only projection PASS; writer/persistence parity PASS; lifecycle/role/private-helper refusals PASS; restricted-ledger and tenant walls PASS; actual readiness before/after PASS; exact-risk information receipt PASS; canonical secondary creation/sensitivity and immutable origin PASS; late ancestor restriction across raw risks/evidence/audit/RPCs PASS; legacy helper ACLs and authorized sensitive/audience composition PASS; fixtures rolled back';

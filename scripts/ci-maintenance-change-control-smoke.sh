#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Maintenance change-control smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
ORG2='c5110000-0000-4000-8000-000000000002'
ASSET='c5110000-0000-4000-8000-000000000001'
ASSET2='c5110000-0000-4000-8000-000000000003'
WORK='c5110000-0000-4000-8000-000000000011'
WORK_NO_ACCEPT='c5110000-0000-4000-8000-000000000012'
WORK_STALE='c5110000-0000-4000-8000-000000000013'
FOREIGN_WORK='c5110000-0000-4000-8000-000000000014'
WORK_ESCALATE='c5110000-0000-4000-8000-000000000015'
WORK_PLAN='c5110000-0000-4000-8000-000000000016'
RISK='c5110000-0000-4000-8000-000000000021'
RISK_NO_ACCEPT='c5110000-0000-4000-8000-000000000022'
RISK_CONTEXT='c5110000-0000-4000-8000-000000000023'
RISK_CRITERIA='c5110000-0000-4000-8000-000000000024'
MANAGER_ID='00000000-0000-0000-0000-000000000003'

token(){ local r; r=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$r" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); v=x.get(os.environ['KEY']) if isinstance(x,dict) else None
print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list,bool)) else v))
PY
}
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and (x.get('error') or x.get('message') or x.get('code')):
    print('unexpected error:',x); sys.exit(1)
PY
}
expect_err(){ BODY="$1" NEEDLE="$2" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY']); err=''
if isinstance(x,dict): err=x.get('error') or x.get('message') or x.get('hint') or ''
if os.environ['NEEDLE'].lower() not in str(err).lower():
    print('expected refusal containing %r, got %s' % (os.environ['NEEDLE'],x)); sys.exit(1)
PY
}
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; if [ "$rc" = 0 ]; then echo "expected SQL refusal: $1"; return 1; fi; printf '%s' "$out"; }
future(){ DAYS="$1" python3 - <<'PY'
from datetime import datetime,timedelta,timezone
import os
print((datetime.now(timezone.utc)+timedelta(days=int(os.environ['DAYS']))).strftime('%Y-%m-%dT%H:%M:%SZ'))
PY
}

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
test -n "$PLANNER"; test -n "$MANAGER"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
do $seed$
declare v_uid uuid := '99999999-9999-4999-8999-999999999999';
begin
  if not exists(select 1 from auth.users where id=v_uid) then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
      raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new,
      email_change_token_current,phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000',v_uid,'authenticated','authenticated','smoke-aibot@syncai.ca',
      extensions.crypt('AiBot123!@#',extensions.gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{"full_name":"Smoke AI operator"}',
      '','','','','','','','');
  end if;
  if not exists(select 1 from auth.identities where user_id=v_uid) then
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
    values(gen_random_uuid(),v_uid,v_uid,jsonb_build_object('sub',v_uid::text,'email','smoke-aibot@syncai.ca'),'email',now(),now(),now());
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values(v_uid,'11111111-1111-1111-1111-111111111111','smoke-aibot@syncai.ca','Smoke AI operator','ai_admin')
  on conflict(id) do update set organization_id=excluded.organization_id,role='ai_admin';
end $seed$;
SQL
AI=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#')
test -n "$AI"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<SQL
insert into organizations(id,name) values('$ORG2','C5.11 foreign tenant') on conflict(id) do nothing;
insert into assets(id,organization_id,tag,name,asset_class,criticality,status)
values('$ASSET','$ORG','C511-MCC','Governed maintenance-control asset','Process equipment','critical','healthy'),
      ('$ASSET2','$ORG2','C511-X','Foreign maintenance-control asset','Process equipment','critical','healthy')
on conflict(id) do nothing;
insert into risk_context_nodes(id,organization_id,scope_kind,asset_id,name,mission_or_service,objectives,stakeholders,
  safety_requirements,operating_limits,decision_authority,status,created_by,adopted_by,adopted_at)
values('$RISK_CONTEXT','$ORG','asset','$ASSET','C5.11 critical-maintenance decision context',
  'Preserve the pressure-protection function while governing any inspection deferral.',
  '["Maintain the safety barrier within its approved inspection interval"]',
  '["Operations","Maintenance","Process safety"]',
  '["No deferral without explicit residual-risk acceptance"]',
  '["Pressure safety valve remains available and inspected"]',
  '{"defer_critical_work":"maintenance_manager"}','adopted','$MANAGER_ID','$MANAGER_ID',now())
on conflict(id) do nothing;
insert into risk_criteria_profiles(id,organization_id,context_id,name,version,status,consequence_dimensions,
  likelihood_scale,thresholds,decision_thresholds,risk_capacity,tolerance_statements,basis,adopted_by,adopted_at)
values('$RISK_CRITERIA','$ORG','$RISK_CONTEXT','C5.11 critical-maintenance criteria',1,'adopted',
  '[{"name":"Safety","scale":"Very Low to Critical"}]',
  '[{"label":"Possible","value":3}]','{"high":15,"critical":20}',
  '{"escalateAbove":15,"stopAbove":20}','{"maximumAcceptedScore":19}',
  '["Critical maintenance exposure requires a named accountable human acceptance"]',
  'Adopted smoke fixture for governed critical-maintenance deferral decisions.','$MANAGER_ID',now())
on conflict(id) do nothing;
insert into risks(id,organization_id,context_id,criteria_profile_id,asset_id,title,kind,objective_at_risk,
  risk_source,event_description,causes,consequences,likelihood,existing_controls_summary,analysis_level,
  analysis_method,control_effectiveness,uncertainty,confidence,current_risk_score,current_risk_level,
  residual_risk_level,decision_action,risk_owner_id,decision_owner_id,scope_decision,scope_expected_outcome,
  scope_inclusions,scope_exclusions,time_horizon,location_scope,resource_scope,responsibility_scope,
  relationship_scope,assumptions,bias_review_complete,method_limitations,data_quality,reporting_profile,
  status,source_kind,created_by)
values
('$RISK','$ORG','$RISK_CONTEXT','$RISK_CRITERIA','$ASSET','Exposure while critical inspection is deferred','threat',
 'Maintain the pressure-protection function','Inspection deferral','Barrier degradation is not detected before demand',
 '["Inspection occurs after the approved interval"]','{"safety":"Loss of pressure-protection assurance"}',3,
 'Daily operator check and immediate escalation on any barrier indication','semi_quantitative','Adopted risk matrix',
 60,25,75,18,'High','High','ACCEPT','$MANAGER_ID','$MANAGER_ID',
 'Whether to approve a bounded critical-inspection deferral','A time-bounded decision with compensating controls',
 '["The identified pressure safety valve and exact work order"]','["Other assets and maintenance scopes"]',
 'Thirty days','C5.11 governed maintenance asset','["Qualified maintenance personnel"]',
 '["Maintenance manager owns acceptance and review"]','["Work order, risk acceptance and schedule change"]',
 '["Daily operator checks remain effective during the bounded interval"]',true,
 '["The fixture does not model plant-wide common-cause exposure"]','Controlled smoke-test evidence',
 '{"audiences":["Maintenance manager"],"frequency":"On change","method":"Governed record","timeliness":"Before deferral","cost_limit":"Test fixture"}',
 'evaluated','human','$MANAGER_ID'),
('$RISK_NO_ACCEPT','$ORG','$RISK_CONTEXT','$RISK_CRITERIA','$ASSET','Unaccepted critical deferral exposure','threat',
 'Maintain the pressure-protection function','Inspection deferral','Barrier degradation is not detected before demand',
 '["Inspection occurs after the approved interval"]','{"safety":"Loss of pressure-protection assurance"}',3,
 'No accepted compensating control exists for this decision','semi_quantitative','Adopted risk matrix',
 40,35,65,18,'High','High','ESCALATE','$MANAGER_ID','$MANAGER_ID',
 'Whether an unaccepted critical-inspection deferral may proceed','Refusal until a qualified human accepts the exposure',
 '["The identified pressure safety valve and exact work order"]','["Other assets and maintenance scopes"]',
 'Thirty days','C5.11 governed maintenance asset','["Qualified maintenance personnel"]',
 '["Maintenance manager owns acceptance and review"]','["Work order, risk acceptance and schedule change"]',
 '["No residual-risk acceptance has been recorded"]',true,
 '["The fixture does not model plant-wide common-cause exposure"]','Controlled smoke-test evidence',
 '{"audiences":["Maintenance manager"],"frequency":"On change","method":"Governed record","timeliness":"Before deferral","cost_limit":"Test fixture"}',
 'evaluated','human','$MANAGER_ID')
on conflict(id) do nothing;
select set_config('app.maintenance_change_control_write','granted',false);
insert into work_orders(id,organization_id,asset_id,wo_number,title,status,priority,type,scheduled_date,due_date,
  safety_flag,approval_required,risk_id,production_impact,created_at,updated_at)
values('$WORK','$ORG','$ASSET','C511-WO-1','Inspect the critical pressure safety valve','scheduled','critical','human_created',
  to_char(now()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"'),now()+interval '1 day',true,false,'$RISK','High',now(),now()),
 ('$WORK_NO_ACCEPT','$ORG','$ASSET','C511-WO-2','Inspect the unaccepted critical barrier','scheduled','critical','human_created',
  to_char(now()+interval '2 days','YYYY-MM-DD"T"HH24:MI:SS"Z"'),now()+interval '2 days',true,false,'$RISK_NO_ACCEPT','High',now(),now()),
 ('$WORK_STALE','$ORG','$ASSET','C511-WO-3','Stale safety schedule probe','scheduled','critical','human_created',
  to_char(now()+interval '3 days','YYYY-MM-DD"T"HH24:MI:SS"Z"'),now()+interval '3 days',true,false,null,'High',now(),now()),
 ('$FOREIGN_WORK','$ORG2','$ASSET2','C511-X-WO','Foreign critical work','scheduled','critical','human_created',
  to_char(now()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"'),now()+interval '1 day',true,false,null,'High',now(),now()),
 ('$WORK_ESCALATE','$ORG','$ASSET','C517-FLIP','Direct safety classification probe','scheduled','routine','human_created',
  to_char(now()+interval '4 days','YYYY-MM-DD"T"HH24:MI:SS"Z"'),now()+interval '4 days',false,false,null,'Low',now(),now()),
 ('$WORK_PLAN','$ORG','$ASSET','C517-PLAN','Permit-bearing plan approval probe','scheduled','routine','human_created',
  to_char(now()+interval '5 days','YYYY-MM-DD"T"HH24:MI:SS"Z"'),now()+interval '5 days',false,false,null,'Low',now(),now())
on conflict(id) do nothing;
select set_config('app.maintenance_change_control_write','',false);
insert into risk_acceptances(organization_id,subject_type,subject_id,risk_level,rationale,compensating_controls,
  accepted_by,accepted_role,expires_at,review_at,reassessment_trigger)
values('$ORG','risk','$RISK','High','C5.11 manager accepts the bounded residual exposure for this test',
  'Daily operator check and immediate escalation on any barrier indication','$MANAGER_ID','maintenance_manager',
  now()+interval '30 days',now()+interval '20 days',
  'Reassess immediately on any barrier indication, overdue daily check, process excursion or scope change.');
SQL

test "$(psqlc "select enforcement from decision_rights where right_key='change_pm_interval'")" = 'enforced'
test "$(psqlc "select enforcement from decision_rights where right_key='defer_critical_work'")" = 'enforced'
test "$(psqlc "select enforcement from decision_rights where right_key='schedule_safety_critical_work'")" = 'enforced'

# Persistence walls refuse forged creation, scheduling and approval.
DIRECT=$(sql_must_fail "insert into work_orders(organization_id,asset_id,title,status,priority,safety_flag) values('$ORG','$ASSET','Forged safety work','scheduled','critical',true);")
printf '%s' "$DIRECT" | grep -qi 'request_safety_critical_work'
DIRECT=$(sql_must_fail "update work_orders set due_date=now()+interval '90 days' where id='$WORK';")
printf '%s' "$DIRECT" | grep -qi 'governed maintenance change control'
DIRECT=$(sql_must_fail "update work_orders set safety_flag=true where id='$WORK_ESCALATE';")
printf '%s' "$DIRECT" | grep -qi 'governed maintenance change control'

# The existing canonical job-plan path cannot become a safety-classification bypass.
# A permit-bearing adopted plan parks the work in approval; only the independent
# C5.17 manager decision makes its schedule executable again.
PLAN=$(rpc "$PLANNER" upsert_job_plan '{"p_plan":{"plan_key":"C517-PERMIT-PLAN","title":"Permit-bearing governed plan","scope":"Execute the bounded permit-controlled maintenance scope","basis":"C5.17 runtime safety-classification probe","steps":[{"step_number":1,"description":"Isolate and execute the permit-controlled maintenance task","craft":"mechanical","crew_size":1,"estimated_hours":1}],"permits":[{"permit_type":"safe work permit","isolation_required":"Verified mechanical isolation","verification_note":"Independent permit issuer verifies the isolation"}],"checks":[{"check_description":"Verify controlled work completion","acceptance_criterion":"Permit closed and isolation restoration independently recorded","is_hold_point":true}]}}')
noerr "$PLAN"; PLAN_ID=$(field "$PLAN" job_plan_id); test -n "$PLAN_ID"
ADOPT=$(rpc "$PLANNER" adopt_job_plan "{\"p_id\":\"$PLAN_ID\",\"p_note\":\"Adopted for governed C5.17 runtime validation\"}")
noerr "$ADOPT"
APPLY=$(rpc "$PLANNER" apply_job_plan "{\"p_work_order_id\":\"$WORK_PLAN\",\"p_plan_key\":\"C517-PERMIT-PLAN\"}")
noerr "$APPLY"
test "$(field "$APPLY" schedule_approval_required)" = 'true'
test "$(psqlc "select status||':'||safety_flag||':'||approval_required||':'||control_revision from work_orders where id='$WORK_PLAN'")" = 'approval:true:true:2'
PLAN_MOVE=$(rpc "$PLANNER" request_safety_critical_reschedule "{\"p_work_order_id\":\"$WORK_PLAN\",\"p_proposed_date\":\"$(future 11)\",\"p_reason\":\"The permit-bearing plan requires an independently approved execution window\",\"p_consequence_of_wrong\":\"Unapproved execution could expose personnel to uncontrolled hazardous energy\",\"p_required_validation\":\"The manager confirms the permit window and independent isolation verification\"}")
noerr "$PLAN_MOVE"; PLAN_MOVE_ID=$(field "$PLAN_MOVE" approval_id)
PLAN_DEC=$(rpc "$MANAGER" decide_maintenance_change_control "{\"p_approval_id\":\"$PLAN_MOVE_ID\",\"p_outcome\":\"approved\",\"p_note\":\"Approved after confirming the permit window and isolation verification controls\"}")
noerr "$PLAN_DEC"
test "$(psqlc "select status||':'||approval_required||':'||control_revision from work_orders where id='$WORK_PLAN'")" = 'scheduled:false:3'

# Machine authority and cross-tenant targets refuse at the RPC door.
R=$(rpc "$AI" request_critical_work_deferral "{\"p_work_order_id\":\"$WORK\",\"p_deferred_until\":\"$(future 7)\",\"p_reason\":\"Machine identities may only advise on this decision\",\"p_consequence_of_wrong\":\"The safety barrier could remain impaired beyond tolerance\",\"p_required_validation\":\"Verify the barrier before the approved deferred date\"}")
expect_err "$R" 'AI-operator identity'
R=$(rpc "$PLANNER" request_critical_work_deferral "{\"p_work_order_id\":\"$FOREIGN_WORK\",\"p_deferred_until\":\"$(future 7)\",\"p_reason\":\"Foreign work must not be visible through this tenant\",\"p_consequence_of_wrong\":\"Cross-tenant mutation would violate the tenant boundary\",\"p_required_validation\":\"Confirm the work remains isolated to its owning tenant\"}")
expect_err "$R" 'same-tenant work order'

# Deferral stays inert until an independent manager with current accepted risk decides.
DEF=$(rpc "$PLANNER" request_critical_work_deferral "{\"p_work_order_id\":\"$WORK\",\"p_deferred_until\":\"$(future 7)\",\"p_reason\":\"Specialist support is unavailable until the planned outage window\",\"p_consequence_of_wrong\":\"The safety barrier could remain impaired beyond the tolerable period\",\"p_required_validation\":\"Complete and independently verify the valve test before the deferred date\"}")
noerr "$DEF"; DEF_ID=$(field "$DEF" approval_id); test -n "$DEF_ID"
test "$(psqlc "select control_revision from work_orders where id='$WORK'")" = '1'
DEC=$(rpc "$MANAGER" decide_maintenance_change_control "{\"p_approval_id\":\"$DEF_ID\",\"p_outcome\":\"approved\",\"p_note\":\"Approved against the current residual-risk acceptance and daily controls\"}")
noerr "$DEC"
test "$(psqlc "select control_revision from work_orders where id='$WORK'")" = '2'
test "$(psqlc "select deferral_approval_id from work_orders where id='$WORK'")" = "$DEF_ID"

# A linked risk without a current acceptance cannot be approved.
NOACC=$(rpc "$PLANNER" request_critical_work_deferral "{\"p_work_order_id\":\"$WORK_NO_ACCEPT\",\"p_deferred_until\":\"$(future 8)\",\"p_reason\":\"Specialist support is unavailable until the next governed work window\",\"p_consequence_of_wrong\":\"The unaccepted exposure could exceed the approved risk appetite\",\"p_required_validation\":\"Complete the barrier test before any approved deferred date\"}")
noerr "$NOACC"; NOACC_ID=$(field "$NOACC" approval_id)
R=$(rpc "$MANAGER" decide_maintenance_change_control "{\"p_approval_id\":\"$NOACC_ID\",\"p_outcome\":\"approved\",\"p_note\":\"This must refuse because no current acceptance exists for the risk\"}")
expect_err "$R" 'current acceptance'

# Draft creation is non-executable, self-approval refuses, and an independent request succeeds.
OWN=$(rpc "$MANAGER" request_safety_critical_work "{\"p_request\":{\"assetId\":\"$ASSET\",\"title\":\"Test emergency shutdown permissive\",\"description\":\"Functionally test the emergency shutdown permissive and capture evidence\",\"proposedDate\":\"$(future 9)\",\"reason\":\"The scheduled proof-test interval is now due for execution\",\"consequenceOfWrong\":\"A failed permissive could leave the protective function unavailable\",\"requiredValidation\":\"Independent witness verifies the complete functional test record\"}}")
noerr "$OWN"; OWN_ID=$(field "$OWN" approval_id)
R=$(rpc "$MANAGER" decide_maintenance_change_control "{\"p_approval_id\":\"$OWN_ID\",\"p_outcome\":\"approved\",\"p_note\":\"A requester must not approve the same safety-critical work request\"}")
expect_err "$R" 'cannot approve your own'

CREATED=$(rpc "$PLANNER" request_safety_critical_work "{\"p_request\":{\"assetId\":\"$ASSET\",\"title\":\"Inspect high-high trip function\",\"description\":\"Inspect and functionally test the high-high trip against approved criteria\",\"proposedDate\":\"$(future 10)\",\"reason\":\"The approved proof-test interval is approaching its committed date\",\"consequenceOfWrong\":\"The trip could be unavailable during a process demand if testing is wrong\",\"requiredValidation\":\"Independent quality witness confirms the test and evidence package\"}}")
noerr "$CREATED"; CREATE_ID=$(field "$CREATED" approval_id); CREATE_WORK=$(field "$CREATED" work_order_id)
test "$(psqlc "select status||':'||coalesce(scheduled_date,'') from work_orders where id='$CREATE_WORK'")" = 'approval:'
DEC=$(rpc "$MANAGER" decide_maintenance_change_control "{\"p_approval_id\":\"$CREATE_ID\",\"p_outcome\":\"approved\",\"p_note\":\"Approved as bounded safety-critical work against the stated validation\"}")
noerr "$DEC"
test "$(psqlc "select status||':'||control_revision from work_orders where id='$CREATE_WORK'")" = 'scheduled:2'

# Reschedule uses a second exact-version approval and stale requests fail closed.
MOVE=$(rpc "$PLANNER" request_safety_critical_reschedule "{\"p_work_order_id\":\"$CREATE_WORK\",\"p_proposed_date\":\"$(future 12)\",\"p_reason\":\"The independent witness is available only in the later controlled window\",\"p_consequence_of_wrong\":\"Moving the test could extend exposure to an unavailable protective function\",\"p_required_validation\":\"Confirm the new date remains inside the adopted proof-test interval\"}")
noerr "$MOVE"; MOVE_ID=$(field "$MOVE" approval_id)
DEC=$(rpc "$MANAGER" decide_maintenance_change_control "{\"p_approval_id\":\"$MOVE_ID\",\"p_outcome\":\"approved\",\"p_note\":\"Approved after confirming the proof-test interval and witness availability\"}")
noerr "$DEC"
test "$(psqlc "select control_revision from work_orders where id='$CREATE_WORK'")" = '3'

STALE=$(rpc "$PLANNER" request_safety_critical_reschedule "{\"p_work_order_id\":\"$WORK_STALE\",\"p_proposed_date\":\"$(future 13)\",\"p_reason\":\"A stale request probe needs a valid substantive scheduling basis\",\"p_consequence_of_wrong\":\"An outdated review could authorize the wrong execution window\",\"p_required_validation\":\"Reconfirm the exact work revision before any schedule change\"}")
noerr "$STALE"; STALE_ID=$(field "$STALE" approval_id)
psqlc "select set_config('app.maintenance_change_control_write','granted',false); update work_orders set control_revision=control_revision+1 where id='$WORK_STALE';" >/dev/null
R=$(rpc "$MANAGER" decide_maintenance_change_control "{\"p_approval_id\":\"$STALE_ID\",\"p_outcome\":\"approved\",\"p_note\":\"This decision must refuse because the reviewed revision is stale\"}")
expect_err "$R" 'request snapshot is stale'

DIRECT=$(sql_must_fail "update approvals set status='approved' where id='$NOACC_ID';")
printf '%s' "$DIRECT" | grep -qi 'change-control functions'

READ=$(rpc "$MANAGER" get_maintenance_change_control_workspace '{}')
noerr "$READ"
BODY="$READ" DEF_ID="$DEF_ID" CREATE_ID="$CREATE_ID" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY']); ids={r['id'] for r in x.get('requests',[])}
needed={os.environ['DEF_ID'],os.environ['CREATE_ID']}
if not needed.issubset(ids): print('governed requests missing from workspace',x); sys.exit(1)
if 'does not release a schedule' not in x.get('control',''): print('authority boundary missing',x); sys.exit(1)
PY
test "$(psqlc "select count(*) from work_order_status_history where work_order_id in ('$WORK','$CREATE_WORK') and comments like 'Governed %'")" -ge 3
test "$(psqlc "select count(*) from audit_events where entity_type='maintenance_change_decision' and event_data->>'approval_id' in ('$DEF_ID','$CREATE_ID','$MOVE_ID')")" = '3'
test "$(psqlc "select count(*) from audit_events where entity_type='maintenance_change_decision' and event_data->>'approval_id'='$PLAN_MOVE_ID'")" = '1'

echo "C5.11/C5.17 governed maintenance change control passed: deferral=$DEF_ID create=$CREATE_ID reschedule=$MOVE_ID"

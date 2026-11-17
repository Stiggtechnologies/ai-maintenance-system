#!/usr/bin/env bash
set -euo pipefail
# Runs only against disposable CI Supabase, after project-start-knowledge smoke.
# Reuses its real lesson/evidence, exercising authenticated RPCs, not SQL stubs.
trap 'echo "Project FRACAS smoke failed at line $LINENO"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo 'Local test API required'; exit 1;; esac
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
token(){ curl --fail-with-body -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;x=json.load(sys.stdin);assert x.get('access_token');print(x['access_token'])"; }
rpc(){ curl --fail-with-body -sS "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
# Expected trigger refusals are HTTP 400 responses. Preserve their JSON bodies
# so the smoke can prove the precise database gate rather than treating a
# transport failure as an acceptable domain outcome.
rpc_any(){ curl -sS "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
field(){ printf '%s' "$1" | python3 -c 'import json,sys;x=json.load(sys.stdin);assert "error" not in x,x;print(x[sys.argv[1]])' "$2"; }
ok(){ printf '%s' "$1" | python3 -c 'import json,sys;x=json.load(sys.stdin);assert "error" not in x,x'; }
refused(){ printf '%s' "$1" | python3 -c 'import json,sys;x=json.load(sys.stdin);assert x.get("error"),x'; }
refused_contains(){ printf '%s' "$1" | python3 -c 'import json,sys;x=json.load(sys.stdin);m=str(x.get("error") or x.get("message") or "");assert sys.argv[1].lower() in m.lower(),x' "$2"; }
# Two authenticated attempts must serialize to one accepted write and one refusal.
# HTTP/transport failures are test failures, not acceptable domain refusals.
race_revision(){ API_URL="$API_URL" ANON_KEY="$ANON_KEY" RACE_TOKEN="$1" RACE_RPC="$2" RACE_BODY="$3" python3 - <<'PY'
import concurrent.futures,json,os,threading,urllib.error,urllib.request
barrier=threading.Barrier(2)
def attempt(_):
    request=urllib.request.Request(
        os.environ['API_URL']+'/rest/v1/rpc/'+os.environ['RACE_RPC'],
        data=os.environ['RACE_BODY'].encode(),
        headers={'apikey':os.environ['ANON_KEY'],'authorization':'Bearer '+os.environ['RACE_TOKEN'],'content-type':'application/json'})
    barrier.wait(timeout=10)
    try:
        with urllib.request.urlopen(request,timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body=error.read().decode('utf-8','replace')
        raise AssertionError(f'Unexpected HTTP {error.code} from {os.environ["RACE_RPC"]}: {body}') from error
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(attempt,range(2)))
successes=[r for r in results if r.get('revisionId') and not r.get('error')]
refusals=[r for r in results if r.get('error')]
assert len(successes)==1 and len(refusals)==1,results
print(json.dumps(successes[0]))
PY
}
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
ORG='11111111-1111-1111-1111-111111111111'
EVIDENCE='98551000-0000-4000-8000-000000000001'
# A separately identifiable AI operator is allowed to assist but can neither
# request nor approve a safety-critical procedure alteration.
psqlc "do \$\$ declare u uuid := '98559999-0000-4000-8000-000000000098'; begin
 insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
   created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,
   email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token)
 values('00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
   'fracas-aibot@syncai.ca',extensions.crypt('AiBot123!@#',extensions.gen_salt('bf')),
   now(),now(),now(),'{\"provider\":\"email\",\"providers\":[\"email\"]}','{}','','','','','','','','')
 on conflict(id) do nothing;
 insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
 select gen_random_uuid(),u,u,jsonb_build_object('sub',u::text,'email','fracas-aibot@syncai.ca'),
   'email',now(),now(),now() where not exists(select 1 from auth.identities where user_id=u);
 insert into user_profiles(id,organization_id,email,role)
 values(u,'$ORG','fracas-aibot@syncai.ca','ai_admin')
 on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role;
end \$\$;"
AIBOT=$(token 'fracas-aibot@syncai.ca' 'AiBot123!@#')
# Dedicated foreign approver, created only in the explicitly local CI stack.
psqlc "do \$\$ declare u uuid := '98559999-0000-4000-8000-000000000099'; begin
 insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
   created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,
   email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token)
 values('00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
   'fracas-foreign@syncai.ca',extensions.crypt('Foreign123!@#',extensions.gen_salt('bf')),
   now(),now(),now(),'{\"provider\":\"email\",\"providers\":[\"email\"]}','{}','','','','','','','','')
 on conflict(id) do nothing;
 insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
 select gen_random_uuid(),u,u,jsonb_build_object('sub',u::text,'email','fracas-foreign@syncai.ca'),
   'email',now(),now(),now() where not exists(select 1 from auth.identities where user_id=u);
 insert into user_profiles(id,organization_id,email,role)
 values(u,'99999999-9999-9999-9999-999999999925','fracas-foreign@syncai.ca','admin')
 on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role;
end \$\$;"
FOREIGN=$(token 'fracas-foreign@syncai.ca' 'Foreign123!@#')
LESSON=$(psqlc "select id from learning_events where organization_id='$ORG' and development_case_id='98550000-0000-4000-8000-000000000001' and title='Seal failure at first start' order by created_at desc limit 1")
test -n "$LESSON"
CLOSURE=$(API_URL="$API_URL" ANON_KEY="$ANON_KEY" PLANNER="$PLANNER" LESSON="$LESSON" python3 - <<'PY'
import concurrent.futures,json,os,threading,urllib.error,urllib.request
barrier=threading.Barrier(2)
def start(_):
    request=urllib.request.Request(
        os.environ['API_URL']+'/rest/v1/rpc/start_project_ca_verification',
        data=json.dumps({'p_lesson_id':os.environ['LESSON'],'p_basis':'CI witnessed flush failure review'}).encode(),
        headers={'apikey':os.environ['ANON_KEY'],'authorization':'Bearer '+os.environ['PLANNER'],'content-type':'application/json'})
    barrier.wait(timeout=10)
    try:
        with urllib.request.urlopen(request,timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body=error.read().decode('utf-8','replace')
        raise AssertionError(f'Unexpected HTTP {error.code} from start_project_ca_verification: {body}') from error
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(start,range(2)))
successes=[r for r in results if r.get('id')]
refusals=[r for r in results if r.get('error')]
assert len(successes)==1 and len(refusals)==1,results
print(successes[0]['id'])
PY
)
test "$(psqlc "select count(*) from ca_verifications where project_lesson_id='$LESSON'")" = 1
refused "$(rpc "$PLANNER" attest_project_ca_stage "{\"p_verification_id\":\"$CLOSURE\",\"p_stage\":\"causal\",\"p_note\":\"Premature\",\"p_evidence_id\":\"$EVIDENCE\"}")"
for stage in implementation causal; do
  ok "$(rpc "$PLANNER" attest_project_ca_stage "{\"p_verification_id\":\"$CLOSURE\",\"p_stage\":\"$stage\",\"p_note\":\"Witnessed acceptance evidence reviewed\",\"p_evidence_id\":\"$EVIDENCE\"}")"
done
BASE=$(field "$(rpc "$ADMIN" register_standard_work_baseline "{\"p_work_key\":\"ci.project.fracas.flush\",\"p_title\":\"Flush acceptance\",\"p_language\":\"en\",\"p_content\":\"Review flush record\",\"p_basis\":\"Existing controlled procedure\",\"p_evidence_id\":\"$EVIDENCE\"}")" standardWorkId)
request(){ rpc "$PLANNER" request_project_standard_revision "{\"p_verification_id\":\"$CLOSURE\",\"p_previous_id\":$BASE,\"p_language\":\"en\",\"p_content\":\"$1\",\"p_change_summary\":\"Add witnessed acceptance\",\"p_basis\":\"Startup failure evidence\"}"; }
FIRST=$(field "$(race_revision "$PLANNER" request_project_standard_revision "{\"p_verification_id\":\"$CLOSURE\",\"p_previous_id\":$BASE,\"p_language\":\"en\",\"p_content\":\"Require witnessed flush acceptance\",\"p_change_summary\":\"Add witnessed acceptance\",\"p_basis\":\"Startup failure evidence\"}")" revisionId)
test "$(psqlc "select count(*) from standard_work where source_project_ca_id='$CLOSURE'")" = 1
refused "$(request 'Parallel pending proposal')"
ok "$(rpc "$ADMIN" decide_project_standard_revision "{\"p_revision_id\":$FIRST,\"p_outcome\":\"rejected\",\"p_note\":\"Include retained acceptance record\"}")"
REVISION=$(field "$(request 'Require witnessed flush acceptance and retain signed acceptance record')" revisionId)
ok "$(race_revision "$ADMIN" decide_project_standard_revision "{\"p_revision_id\":$REVISION,\"p_outcome\":\"approved\",\"p_note\":\"Exact procedure and evidence reviewed\"}")"
ok "$(rpc "$PLANNER" screen_project_ca_exposure "{\"p_verification_id\":\"$CLOSURE\",\"p_basis\":\"Review current project exposure\"}")"
SCREEN=$(rpc "$PLANNER" screen_applicable_project_lessons '{"p_case_id":"98550000-0000-4000-8000-000000000002"}')
BODY="$SCREEN" LESSON="$LESSON" REVISION="$REVISION" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
lesson=next(i for i in x['lessons'] if i['id']==os.environ['LESSON'])
s=lesson['adoptedStandard']
assert s['id']==int(os.environ['REVISION']) and s['version']==3,s
assert s['approvalId'] and s['adoptedAt'] and s['adoptedBy'],s
assert lesson['matchReason'],lesson
PY
refused "$(rpc "$PLANNER" screen_applicable_project_lessons '{"p_case_id":"98559999-0000-4000-8000-000000000001"}')"
# A logged-in caller cannot substitute a direct row update for named approval.
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$API_URL/rest/v1/ca_verifications?id=eq.$CLOSURE" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $PLANNER" -H 'content-type: application/json' \
  -d '{"strategy_note":"Unauthorized overwrite"}')
test "$CODE" = 403
CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$API_URL/rest/v1/rpc/start_project_ca_verification" \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
  -d "{\"p_lesson_id\":\"$LESSON\",\"p_basis\":\"Anonymous attempt\"}")
case "$CODE" in 401|403) ;; *) echo "Anonymous start unexpectedly returned $CODE"; exit 1;; esac
test "$(psqlc "select count(*) from ca_verifications where id='$CLOSURE' and status='closed_project_workflow' and project_adopted_standard_id=$REVISION and project_screened_at is not null and effectiveness is null and asset_id is null and work_order_id is null")" = 1
test "$(psqlc "select count(*) from approvals where standard_work_revision_id=$FIRST and status='rejected'")" = 1
refused "$(rpc "$FOREIGN" start_project_ca_verification "{\"p_lesson_id\":\"$LESSON\",\"p_basis\":\"Foreign attempt\"}")"
refused "$(rpc "$FOREIGN" attest_project_ca_stage "{\"p_verification_id\":\"$CLOSURE\",\"p_stage\":\"implementation\",\"p_note\":\"Foreign attempt\",\"p_evidence_id\":\"$EVIDENCE\"}")"
refused "$(rpc "$FOREIGN" register_standard_work_baseline "{\"p_work_key\":\"foreign-evidence-attempt\",\"p_title\":\"Foreign attempt\",\"p_language\":\"en\",\"p_content\":\"Controlled procedure\",\"p_basis\":\"Foreign evidence\",\"p_evidence_id\":\"$EVIDENCE\"}")"
refused "$(rpc "$FOREIGN" request_project_standard_revision "{\"p_verification_id\":\"$CLOSURE\",\"p_previous_id\":$BASE,\"p_language\":\"en\",\"p_content\":\"Foreign change\",\"p_change_summary\":\"Foreign attempt\",\"p_basis\":\"Foreign attempt\"}")"
refused "$(rpc "$FOREIGN" decide_project_standard_revision "{\"p_revision_id\":$REVISION,\"p_outcome\":\"approved\",\"p_note\":\"Foreign attempt\"}")"
refused "$(rpc "$FOREIGN" screen_project_ca_exposure "{\"p_verification_id\":\"$CLOSURE\",\"p_basis\":\"Foreign attempt\"}")"
curl --fail-with-body -sS "$API_URL/rest/v1/ca_verifications?id=eq.$CLOSURE&select=id" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $FOREIGN" \
  | python3 -c 'import json,sys;assert json.load(sys.stdin)==[]'
# Exercise the exact embedded relationship names consumed by the UI.
curl --fail-with-body -sS -G "$API_URL/rest/v1/standard_work" -H "apikey: $ANON_KEY" -H "authorization: Bearer $PLANNER" \
  --data-urlencode "id=eq.$REVISION" \
  --data-urlencode 'select=id,procedures:procedure_translations!procedure_translations_standard_work_id_fkey(content),approval:approvals!standard_work_revision_approval_id_fkey(status)' \
  | python3 -c 'import json,sys;x=json.load(sys.stdin);assert len(x)==1 and x[0]["procedures"] and x[0]["approval"]["status"]=="approved",x'
echo 'Project FRACAS authenticated chain passed; no asset effectiveness inferred.'

# D9.06: use the adopted CA revision as the observed baseline, proving the
# CA -> learning path without disguising the observation as another failure.
OBS_WORK=$(psqlc "with w as (insert into work_orders(organization_id,wo_number,title,status,type) values('$ORG','CI-LEARNING-OBS','Witnessed procedure execution','completed','human_created') returning id) select id from w")
OBS_PACKAGE=$(field "$(rpc "$PLANNER" record_work_package '{"p_case_id":"98550000-0000-4000-8000-000000000001","p_package":{"package_code":"CI-LEARNING-OBS","title":"Observed engineering work","package_type":"engineering","scope":"Witnessed actual execution for standard-work learning"}}')" work_package_id)
ok "$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$OBS_PACKAGE,\"p_work_order_id\":\"$OBS_WORK\",\"p_basis\":\"Actual work executed against the observed procedure\"}")"
OBS_PROC=$(psqlc "select id from procedure_translations where standard_work_id=$REVISION and language_code='en'")
OBS_BODY="{\"p_case_id\":\"98550000-0000-4000-8000-000000000001\",\"p_procedure_id\":$OBS_PROC,\"p_work_order_id\":\"$OBS_WORK\",\"p_execution_evidence_id\":\"$EVIDENCE\",\"p_outcome_evidence_id\":\"$EVIDENCE\",\"p_observed_at\":\"2026-09-01T00:00:00Z\",\"p_observation\":{\"title\":\"Witnessed controlled execution\",\"execution\":\"Witnessed all recorded inspection points\",\"variationKind\":\"conforming\",\"variationBasis\":\"Recorded sequence matched the controlled procedure\",\"outcome\":\"Inspection complete; causality not established\",\"outcomeKind\":\"qualitative\",\"attributionLimit\":\"Single witnessed execution without a counterfactual; causality and improvement are not established\",\"learning\":\"Retain clearer acceptance record instructions\",\"applicability\":\"Equivalent flush acceptance activities\"}}"
refused "$(rpc "$FOREIGN" record_standard_work_observation "$OBS_BODY")"
OBS_ID=$(field "$(rpc "$PLANNER" record_standard_work_observation "$OBS_BODY")" id)
test "$(psqlc "select count(*) from learning_events where id='$OBS_ID' and standard_outcome_kind='qualitative' and standard_outcome_value is null and standard_outcome_unit is null and standard_outcome_attribution_limit like 'Single witnessed execution%'")" = 1
MISSING_UNIT="${OBS_BODY/\"outcomeKind\":\"qualitative\"/\"outcomeKind\":\"quantitative\",\"outcomeValue\":4.75}"
refused "$(rpc "$PLANNER" record_standard_work_observation "$MISSING_UNIT")"
QUAL_WITH_VALUE="${OBS_BODY/\"outcomeKind\":\"qualitative\"/\"outcomeKind\":\"qualitative\",\"outcomeValue\":4.75,\"outcomeUnit\":\"hours\"}"
refused "$(rpc "$PLANNER" record_standard_work_observation "$QUAL_WITH_VALUE")"
QUANT_BODY="${OBS_BODY/\"outcomeKind\":\"qualitative\"/\"outcomeKind\":\"quantitative\",\"outcomeValue\":4.75,\"outcomeUnit\":\"hours\"}"
QUANT_ID=$(field "$(rpc "$PLANNER" record_standard_work_observation "$QUANT_BODY")" id)
test "$(psqlc "select count(*) from learning_events where id='$QUANT_ID' and standard_outcome_kind='quantitative' and standard_outcome_value=4.75 and standard_outcome_unit='hours' and verified_value is null")" = 1
LEARNING_BODY="{\"p_observation_id\":\"$OBS_ID\",\"p_content\":\"Retain witnessed flush acceptance record and clarify inspection sequence\",\"p_change_summary\":\"Clarify inspection sequence from observed execution\",\"p_basis\":\"Execution and outcome evidence reviewed; improvement not yet measured\"}"
# Safety request refusals: foreign tenant and AI identity.
refused "$(rpc "$FOREIGN" request_safety_critical_learning_standard_revision "$LEARNING_BODY")"
refused_contains "$(rpc "$AIBOT" request_safety_critical_learning_standard_revision "$LEARNING_BODY")" 'named same-tenant human'
LEARNING_RECEIPT=$(race_revision "$PLANNER" request_safety_critical_learning_standard_revision "$LEARNING_BODY")
LEARNING_REV=$(field "$LEARNING_RECEIPT" revisionId)
test "$(field "$LEARNING_RECEIPT" safetyCritical)" = True
test "$(field "$LEARNING_RECEIPT" requiredAuthority)" = admin
LEARNING_APPROVAL=$(psqlc "select revision_approval_id from standard_work where id=$LEARNING_REV")
test "$(psqlc "select count(*) from standard_work s join approvals a on a.id=s.revision_approval_id where s.id=$LEARNING_REV and s.safety_critical and s.engineering_change_class='safety_critical_procedure_change' and a.owner_role='admin'")" = 1
test "$(psqlc "select count(*) from engineering_approval_rules where organization_id='$ORG' and change_class='safety_critical_procedure_change' and required_role='admin' and status='adopted' and register_ref='C5.14'")" = 1
test "$(psqlc "select count(*) from decision_rights where right_key='alter_safety_procedures' and tier='approval' and enforcement='enforced' and required_authority='admin'")" = 1
# Generic client writes must not replace the governed decision/capture paths.
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$API_URL/rest/v1/approvals?id=eq.$LEARNING_APPROVAL" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"status":"approved"}')
case "$CODE" in 400|403) ;; *) echo "Direct learning approval unexpectedly returned $CODE"; exit 1;; esac
test "$(psqlc "select status from approvals where id='$LEARNING_APPROVAL'")" = required
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$API_URL/rest/v1/learning_events?id=eq.$OBS_ID" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $PLANNER" -H 'content-type: application/json' \
  -d '{"standard_variation_kind":"varied"}')
case "$CODE" in 400|403) ;; *) echo "Observation overwrite unexpectedly returned $CODE"; exit 1;; esac
test "$(psqlc "select standard_variation_kind from learning_events where id='$OBS_ID'")" = conforming
for OBS_RPC in record_standard_work_observation request_safety_critical_learning_standard_revision decide_learning_standard_revision; do
  case "$OBS_RPC" in
    record_standard_work_observation) ANON_BODY="$OBS_BODY";;
    request_safety_critical_learning_standard_revision) ANON_BODY="$LEARNING_BODY";;
    decide_learning_standard_revision) ANON_BODY="{\"p_revision_id\":$LEARNING_REV,\"p_outcome\":\"approved\",\"p_note\":\"Anonymous attempt\"}";;
  esac
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$API_URL/rest/v1/rpc/$OBS_RPC" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "$ANON_BODY")
  case "$CODE" in 401|403) ;; *) echo "Anonymous $OBS_RPC unexpectedly returned $CODE"; exit 1;; esac
done
# The requester cannot decide; a non-designated approver cannot substitute for
# the adopted rule's authority, even when they hold ordinary approval rights.
refused "$(rpc "$PLANNER" decide_learning_standard_revision "{\"p_revision_id\":$LEARNING_REV,\"p_outcome\":\"approved\",\"p_note\":\"Requester attempts own adoption\"}")"
refused "$(rpc "$FOREIGN" decide_learning_standard_revision "{\"p_revision_id\":$LEARNING_REV,\"p_outcome\":\"approved\",\"p_note\":\"Foreign adoption attempt\"}")"
refused_contains "$(rpc_any "$MANAGER" decide_learning_standard_revision "{\"p_revision_id\":$LEARNING_REV,\"p_outcome\":\"approved\",\"p_note\":\"Non-designated approver attempt\"}")" 'designated safety authority'
ok "$(race_revision "$ADMIN" decide_learning_standard_revision "{\"p_revision_id\":$LEARNING_REV,\"p_outcome\":\"approved\",\"p_note\":\"Independent human reviewed exact content and source evidence\"}")"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='safety_procedure_decision' and (event_data->>'revisionId')::bigint=$LEARNING_REV and new_state->>'status'='approved'")" = 1
curl --fail-with-body -sS "$API_URL/rest/v1/learning_events?id=eq.$OBS_ID&select=id" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $FOREIGN" \
  | python3 -c 'import json,sys;assert json.load(sys.stdin)==[]'
curl --fail-with-body -sS -G "$API_URL/rest/v1/standard_work" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $PLANNER" \
  --data-urlencode "source_learning_observation_id=eq.$OBS_ID" \
  --data-urlencode 'select=id,procedures:procedure_translations!procedure_translations_standard_work_id_fkey(id,content,translation_status),approval:approvals!standard_work_revision_approval_id_fkey(status)' \
  | python3 -c 'import json,sys;x=json.load(sys.stdin);assert len(x)==1 and x[0]["approval"]["status"]=="approved" and x[0]["procedures"][0]["translation_status"]=="human_verified",x'
echo 'Standard-work observation and learning adoption authenticated chain passed; improvement remains unproven.'

# Reverse source transition: a distinct later failure revises the adopted
# learning standard. Never relabel the conforming observation as a failure.
LATER_LESSON=$(field "$(rpc "$PLANNER" record_project_lesson '{"p_case_id":"98550000-0000-4000-8000-000000000001","p_failure_mode_key":"project_delivery.startup_failure","p_title":"Later acceptance record retrieval failure","p_cause":"Retained acceptance record could not be retrieved during startup review","p_corrective_action":"Require a witnessed retrieval check for the retained record","p_applicability":"Equivalent flush acceptance record handovers","p_detail":"Separate synthetic CI failure; not the conforming execution observation"}')" lesson_id)
LATER_CA=$(field "$(rpc "$PLANNER" start_project_ca_verification "{\"p_lesson_id\":\"$LATER_LESSON\",\"p_basis\":\"Separate later record retrieval failure\"}")" id)
for stage in implementation causal; do
  ok "$(rpc "$PLANNER" attest_project_ca_stage "{\"p_verification_id\":\"$LATER_CA\",\"p_stage\":\"$stage\",\"p_note\":\"Witnessed retrieval check and causal evidence reviewed\",\"p_evidence_id\":\"$EVIDENCE\"}")"
done
LATER_BODY="{\"p_verification_id\":\"$LATER_CA\",\"p_previous_id\":$LEARNING_REV,\"p_language\":\"en\",\"p_content\":\"Retain witnessed flush acceptance record and verify retrieval during handover\",\"p_change_summary\":\"Add witnessed record retrieval check\",\"p_basis\":\"Separate later failure evidence and causal review\"}"
# A generic door cannot revise a classified safety-critical procedure.
refused_contains "$(rpc_any "$PLANNER" request_project_standard_revision "$LATER_BODY")" 'generic door cannot revise'
# The safety door still refuses an AI identity and a foreign tenant.
refused_contains "$(rpc "$AIBOT" request_safety_critical_project_standard_revision "$LATER_BODY")" 'named same-tenant human'
refused "$(rpc "$FOREIGN" request_safety_critical_project_standard_revision "$LATER_BODY")"
LATER_RECEIPT=$(rpc "$PLANNER" request_safety_critical_project_standard_revision "$LATER_BODY")
LATER_REV=$(field "$LATER_RECEIPT" revisionId)
test "$(field "$LATER_RECEIPT" safetyCritical)" = True
test "$(field "$LATER_RECEIPT" requiredAuthority)" = admin
test "$(psqlc "select count(*) from standard_work where id=$LATER_REV and safety_critical and engineering_change_class='safety_critical_procedure_change'")" = 1
# Direct classification write and safety classification cannot be downgraded:
# the monotonic database guard rejects an attempted client-style downgrade and
# the classified row remains unchanged.
if DOWNGRADE=$(psqlc "update standard_work set safety_critical=false,engineering_change_class=null where id=$LATER_REV" 2>&1); then
  echo 'Safety classification downgrade unexpectedly succeeded'
  exit 1
fi
printf '%s' "$DOWNGRADE" | grep -qi 'direct classification write refused'
test "$(psqlc "select count(*) from standard_work where id=$LATER_REV and safety_critical and engineering_change_class='safety_critical_procedure_change'")" = 1
# Non-designated approver is refused at the canonical approval trigger.
refused_contains "$(rpc_any "$MANAGER" decide_project_standard_revision "{\"p_revision_id\":$LATER_REV,\"p_outcome\":\"approved\",\"p_note\":\"Manager attempts safety adoption\"}")" 'designated safety authority'
ok "$(rpc "$ADMIN" decide_project_standard_revision "{\"p_revision_id\":$LATER_REV,\"p_outcome\":\"approved\",\"p_note\":\"Second human reviewed later failure and exact procedure change\"}")"
test "$(psqlc "select count(*) from standard_work s join approvals a on a.id=s.revision_approval_id join procedure_translations p on p.standard_work_id=s.id where s.id=$LATER_REV and s.previous_standard_work_id=$LEARNING_REV and s.source_project_ca_id='$LATER_CA' and s.source_learning_observation_id is null and s.version=5 and s.safety_critical and s.engineering_change_class='safety_critical_procedure_change' and a.status='approved' and a.owner_role='admin' and a.approval_scope->>'safetyCritical'='true' and p.translation_status='human_verified' and p.verified_by=a.approver_user_id and p.verified_at=a.decided_at")" = 1
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='safety_procedure_decision' and (event_data->>'revisionId')::bigint=$LATER_REV and new_state->>'status'='approved'")" = 1
test "$(psqlc "select count(*) from learning_events where id='$OBS_ID' and event_type='standard_work_observation' and standard_variation_kind='conforming' and failure_mode_key is null")" = 1
echo 'Authenticated safety-critical CA-to-learning-to-CA lineage passed; original observation remains conforming.'

#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Decision Case command authority smoke FAILED at line $LINENO"' ERR
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"; : "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; OTHER_ORG='99999999-9999-4999-8999-999999999940'
APPROVER='99999999-9999-4999-8999-999999999941'; SPONSOR='99999999-9999-4999-8999-999999999942'; AI_USER='99999999-9999-4999-8999-999999999943'; FOREIGN_USER='99999999-9999-4999-8999-999999999944'
WORKSPACE='99999999-9999-4999-8999-999999999951'; SPONSOR_WORKSPACE='99999999-9999-4999-8999-999999999952'; AI_WORKSPACE='99999999-9999-4999-8999-999999999953'; LEGACY_WORKSPACE='99999999-9999-4999-8999-999999999954'; FORGE_WORKSPACE='99999999-9999-4999-8999-999999999955'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){
  local command
  command="$(PAYLOAD="$2" python3 -c "import json,os; print(json.loads(os.environ['PAYLOAD']).get('p_command','unknown'))")"
  printf 'Decision Case command request: %s\n' "$command" >&2
  curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/apply_decision_case_command" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$2"
}
body(){ printf '%s' "${1%$'\n'*}"; }; status(){ printf '%s' "${1##*$'\n'}"; }
ok(){
  local code response
  code="$(status "$1")"; response="$(body "$1")"
  test "$code" = 200 || { echo "expected HTTP 200, got $code: $response" >&2; return 1; }
  BODY="$response" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x.get('version',0)>0,x"
}
refused(){
  local code response
  code="$(status "$1")"; response="$(body "$1")"
  test "$code" != 200 || { echo "expected governed refusal, got HTTP 200: $response" >&2; return 1; }
  BODY="$response" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'].lower() in x.get('message','').lower(),x"
}

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','Decision Case foreign tenant','utilities') on conflict(id) do nothing;
do \$seed\$ declare u record; begin
  for u in select * from (values
    ('$APPROVER'::uuid,'dc-approver@syncai.ca','maintenance_manager','Decision Approver'),
    ('$SPONSOR'::uuid,'dc-sponsor@syncai.ca','assessment_sponsor','External Sponsor'),
    ('$AI_USER'::uuid,'dc-ai@syncai.ca','ai_admin','AI Administrator'),
    ('$FOREIGN_USER'::uuid,'dc-foreign@syncai.ca','admin','Foreign Administrator')) x(id,email,role,name) loop
    if not exists(select 1 from auth.users where id=u.id) then
      insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token)
      values('00000000-0000-0000-0000-000000000000',u.id,'authenticated','authenticated',u.email,extensions.crypt('Decision123!@#',extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}',jsonb_build_object('full_name',u.name),'','','','','','','','');
    end if;
    insert into user_profiles(id,organization_id,email,full_name,role) values(u.id,case when u.id='$FOREIGN_USER' then '$OTHER_ORG'::uuid else '$ORG'::uuid end,u.email,u.name,u.role)
    on conflict(id) do update set organization_id=excluded.organization_id,email=excluded.email,full_name=excluded.full_name,role=excluded.role;
  end loop;
end \$seed\$;
insert into cowork_workspaces(id,organization_id,title,objective,workspace_kind,case_state,case_version) values
('$WORKSPACE','$ORG','Decision Case smoke','Governed command smoke','cowork','{}',0),
('$SPONSOR_WORKSPACE','$ORG','Sponsor refusal','External mutation refusal','cowork','{}',0),
('$AI_WORKSPACE','$ORG','AI refusal','Machine mutation refusal','cowork','{}',0),
('$LEGACY_WORKSPACE','$ORG','Legacy normalization','Legacy evidence fixture','cowork','{}',0),
('$FORGE_WORKSPACE','$ORG','Initialization refusal','Governed record pre-seed refusal','cowork','{}',0) on conflict(id) do nothing;
SQL

DEMO=$(token 'demo@syncai.ca' 'Demo123!@#'); ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#'); APPROVER_TOKEN=$(token 'dc-approver@syncai.ca' 'Decision123!@#'); SPONSOR_TOKEN=$(token 'dc-sponsor@syncai.ca' 'Decision123!@#'); AI_TOKEN=$(token 'dc-ai@syncai.ca' 'Decision123!@#'); FOREIGN_TOKEN=$(token 'dc-foreign@syncai.ca' 'Decision123!@#')
test -n "$DEMO" && test -n "$ADMIN" && test -n "$APPROVER_TOKEN" && test -n "$SPONSOR_TOKEN" && test -n "$AI_TOKEN" && test -n "$FOREIGN_TOKEN"
ADMIN_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
ADMIN_NAME=$(psqlc "select full_name from user_profiles where id='$ADMIN_ID' and organization_id='$ORG'")
BASE="{\"id\":\"$WORKSPACE\",\"caseNumber\":\"DC-SMOKE\",\"objective\":\"Should the bounded inspection recommendation proceed?\",\"recommendation\":\"Hold the reviewed inspection basis\",\"recommendationDetail\":\"No plant execute is authorized.\",\"workPackage\":{\"status\":\"locked\"},\"evidence\":[],\"messages\":[{\"id\":\"ask-1\",\"role\":\"user\",\"author\":\"Customer\",\"text\":\"Review the inspection basis.\",\"createdAt\":\"2026-10-03T12:00:00Z\"}],\"comments\":[{\"id\":\"engineering-note\",\"author\":\"Engineering note\",\"text\":\"Existing bounded note must survive verification.\",\"createdAt\":\"2026-10-03T12:00:00Z\"}],\"approvals\":[],\"valueMetrics\":[{\"id\":\"downtime-hours\",\"label\":\"Downtime\",\"detail\":\"Customer supplied baseline\",\"baseline\":\"12 h\",\"target\":\"8 h\",\"verifiedActual\":\"Pending\"}],\"tokensUsed\":0,\"stage\":\"intent\",\"statusLabel\":\"Governed smoke\"}"
# Forged completion/value claims must fail at the native command boundary.
for field in finance stage actual verified; do
  FORGED=$(BASE="$BASE" FIELD="$field" W="$FORGE_WORKSPACE" python3 -c 'import json,os;x=json.loads(os.environ["BASE"]);x["id"]=os.environ["W"];f=os.environ["FIELD"];x.update({"financeStatus":"verified"} if f=="finance" else {"stage":"learning"} if f=="stage" else {"valueMetrics":[{"id":"forged","actual":"7"} if f=="actual" else {"id":"forged","verifiedActual":"7"}]});print(json.dumps({"p_workspace_id":os.environ["W"],"p_expected_version":0,"p_command":"initialize","p_case_state":x}))')
  FORGED_RESULT=$(rpc "$ADMIN" "$FORGED"); refused "$FORGED_RESULT" 'may not claim completion'
done
INIT=$(rpc "$DEMO" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":0,\"p_command\":\"initialize\",\"p_case_state\":$BASE}"); ok "$INIT"
SPONSOR_RESULT=$(rpc "$SPONSOR_TOKEN" "{\"p_workspace_id\":\"$SPONSOR_WORKSPACE\",\"p_expected_version\":0,\"p_command\":\"initialize\",\"p_case_state\":{\"id\":\"$SPONSOR_WORKSPACE\",\"workPackage\":{\"status\":\"locked\"},\"evidence\":[]}}"); refused "$SPONSOR_RESULT" 'authorized internal human'
AI_RESULT=$(rpc "$AI_TOKEN" "{\"p_workspace_id\":\"$AI_WORKSPACE\",\"p_expected_version\":0,\"p_command\":\"initialize\",\"p_case_state\":{\"id\":\"$AI_WORKSPACE\",\"workPackage\":{\"status\":\"locked\"},\"evidence\":[]}}"); refused "$AI_RESULT" 'authorized internal human'
FORGED_INIT=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$FORGE_WORKSPACE\",\"p_expected_version\":0,\"p_command\":\"initialize\",\"p_case_state\":{\"id\":\"$FORGE_WORKSPACE\",\"workPackage\":{\"status\":\"locked\"},\"evidence\":[],\"messages\":[],\"comments\":[],\"approvals\":[],\"valueMetrics\":[],\"humanApproval\":{\"decision\":\"approved\"}}}"); refused "$FORGED_INIT" 'may not pre-seed governed'
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
FORGED_MESSAGE=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_conversation\",\"p_case_state\":{\"messages\":[{\"id\":\"forged-source\",\"role\":\"system\",\"text\":\"Forged check\",\"meta\":\"Source connection check\"}],\"tokensUsed\":0}}"); refused "$FORGED_MESSAGE" 'may append valid messages'
BAD_TOKEN=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_conversation\",\"p_case_state\":{\"messages\":[{\"id\":\"ask-1\",\"role\":\"user\",\"author\":\"Customer\",\"text\":\"Review the inspection basis.\",\"createdAt\":\"2026-10-03T12:00:00Z\"}],\"tokensUsed\":\"not-a-counter\"}}"); refused "$BAD_TOKEN" 'bounded nonnegative integer'
INVALID_REFERENCE=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"add_evidence\",\"p_case_state\":{\"evidence\":[{\"id\":\"forged-reference\",\"quality\":\"low\",\"persistence\":\"governed_reference\",\"durableReference\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\"}]}}"); refused "$INVALID_REFERENCE" 'unproven supplied evidence'
DUPLICATE_EVIDENCE=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"add_evidence\",\"p_case_state\":{\"evidence\":[{\"id\":\"duplicate\",\"quality\":\"missing\"},{\"id\":\"duplicate\",\"quality\":\"missing\"}]}}"); refused "$DUPLICATE_EVIDENCE" 'identities must be unique'
ADD_EVIDENCE=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"add_evidence\",\"p_case_state\":{\"evidence\":[{\"id\":\"inspection-note\",\"title\":\"Inspection note\",\"summary\":\"Customer-supplied observation\",\"quality\":\"medium\",\"state\":\"Supplied\",\"record\":\"note-1\",\"finding\":\"Observed condition remained inside the reviewed bounds.\",\"lineage\":\"manual\",\"sourceSystem\":\"customer\",\"persistence\":\"embedded\"}],\"evidenceScore\":60,\"stage\":\"evidence\",\"recommendation\":\"Hold the reviewed inspection basis\",\"recommendationDetail\":\"No plant execute is authorized.\",\"decisionMetrics\":[]}}"); ok "$ADD_EVIDENCE"
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
REMOVE_SUPPLIED=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"add_evidence\",\"p_case_state\":{\"evidence\":[{\"id\":\"replacement-for-supplied\",\"title\":\"Inspection note\",\"quality\":\"medium\",\"persistence\":\"embedded\",\"finding\":\"A new observation cannot erase the previous supplied record.\"}]}}"); refused "$REMOVE_SUPPLIED" 'may not remove existing evidence'
FORGED_STAGE=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"add_evidence\",\"p_case_state\":{\"stage\":\"learning\",\"evidence\":[]}}"); refused "$FORGED_STAGE" 'later authorized stage'
FORGED_DISPOSITION=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_disposition\",\"p_case_state\":{\"humanDecision\":{\"disposition\":\"park\",\"rationale\":\"A caller cannot stamp the canonical record time.\",\"recordedAt\":\"2020-01-01T00:00:00Z\"}}}"); refused "$FORGED_DISPOSITION" 'server-owned'
DISPOSITION=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_disposition\",\"p_case_state\":{\"humanDecision\":{\"disposition\":\"accept\",\"rationale\":\"The supplied condition remains inside the reviewed basis.\",\"counterfactual\":\"A contradictory inspection finding.\"},\"people\":{\"decisionOwner\":\"Ada Owner\",\"recommendationAuthor\":\"Riley Author\",\"verificationOwner\":\"Vera Owner\"}}}"); ok "$DISPOSITION"
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
CANONICAL_RETURN=$(psqlc "select (case_state->>'objective')||'|'||(case_state#>>'{evidence,0,id}')||'|'||(case_state#>>'{humanDecision,rationale}')||'|'||(select string_agg((c->>'author')||'='||(c->>'text'),',' order by ordinality) from jsonb_array_elements(case_state->'comments') with ordinality x(c,ordinality) where c->>'author' in ('Decision Owner','Recommendation Author','Verification Owner')) from cowork_workspaces where id='$WORKSPACE'")
test "$CANONICAL_RETURN" = 'Should the bounded inspection recommendation proceed?|inspection-note|The supplied condition remains inside the reviewed basis.|Decision Owner=Ada Owner,Recommendation Author=Riley Author,Verification Owner=Vera Owner'
SOURCE_EARLY=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_source_check\",\"p_case_state\":{\"sourceCheck\":{\"detail\":\"No source connected\"}}}"); refused "$SOURCE_EARLY" 'bound required person'
MISSING_ID=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_required_person\",\"p_case_state\":{\"requiredPerson\":{}}}"); refused "$MISSING_ID" 'tenant user id'
SELF_BIND=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_required_person\",\"p_case_state\":{\"requiredPerson\":{\"userId\":\"$ADMIN_ID\"}}}"); refused "$SELF_BIND" 'may not bind themselves'
ROLE_SPOOF=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_required_person\",\"p_case_state\":{\"requiredPerson\":{\"userId\":\"$APPROVER\",\"authorityRole\":\"executive\"}}}"); refused "$ROLE_SPOOF" 'server-owned'
for COMMAND in record_conversation add_evidence record_disposition define_verification record_required_person record_source_check record_approval; do SIDELOAD=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"$COMMAND\",\"p_case_state\":{\"learningRecord\":{\"status\":\"retained\"}}}"); refused "$SIDELOAD" 'unrelated decision case fields'; done
psqlc "select set_config('syncai.decision_case_command','on',true); update cowork_workspaces set case_version=case_version+1,case_state=jsonb_set(jsonb_set(case_state,'{approvals}',(case_state->'approvals')||jsonb_build_array(jsonb_build_object('id','engineering-review','initials','ER','name','Engineering Review','role','engineering','responsibility','Independent review','status','complete')),true),'{revision}',to_jsonb(case_version+1),true) where id='$WORKSPACE'" >/dev/null
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
BIND=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_required_person\",\"p_case_state\":{\"requiredPerson\":{\"userId\":\"$APPROVER\"}}}"); ok "$BIND"
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
test "$(psqlc "select count(*) from cowork_workspaces w,jsonb_array_elements(w.case_state->'approvals') a where w.id='$WORKSPACE' and a->>'id'='engineering-review' and a->>'status'='complete'")" = 1
test "$(psqlc "select count(*) from cowork_workspaces w,jsonb_array_elements(w.case_state->'approvals') a where w.id='$WORKSPACE' and a->>'id'='required-approver'")" = 1
APPROVAL_BEFORE_VERIFY=$(rpc "$APPROVER_TOKEN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_approval\",\"p_case_state\":{\"decision\":\"approved\",\"reason\":\"Evidence basis reviewed and accepted.\"}}"); refused "$APPROVAL_BEFORE_VERIFY" 'scheduled verification plan'
VERIFY_BAD=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"define_verification\",\"p_case_state\":{\"verification\":{\"expected\":\"\",\"scheduledFor\":\"\"}}}"); refused "$VERIFY_BAD" 'expected outcome and scheduled date'
VERIFY_PARTIAL=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"define_verification\",\"p_case_state\":{\"verification\":{\"expected\":\"Independent reading remains inside the reviewed range\",\"scheduledFor\":\"2026-10-10\",\"actual\":\"Inside range\"}}}"); refused "$VERIFY_PARTIAL" 'effectiveness, actual result, and evidence'
VERIFY=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"define_verification\",\"p_case_state\":{\"verification\":{\"question\":\"Did the reading remain inside the reviewed range?\",\"expected\":\"Independent reading remains inside the reviewed range\",\"scheduledFor\":\"2026-10-10\"}}}"); ok "$VERIFY"
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'"); VERIFY_STAMP=$(psqlc "select case_state#>>'{comments,-1,actorId}' from cowork_workspaces where id='$WORKSPACE'"); test "$VERIFY_STAMP" = "$ADMIN_ID"
test "$(psqlc "select count(*) from cowork_workspaces w,jsonb_array_elements(w.case_state->'valueMetrics') m where w.id='$WORKSPACE' and m->>'id'='downtime-hours' and m->>'baseline'='12 h'")" = 1
test "$(psqlc "select count(*) from cowork_workspaces w,jsonb_array_elements(w.case_state->'comments') c where w.id='$WORKSPACE' and c->>'id'='engineering-note'")" = 1
UNAPPROVED_ACTUAL=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"define_verification\",\"p_case_state\":{\"verification\":{\"expected\":\"Inside range\",\"scheduledFor\":\"2026-10-10\",\"actual\":\"7 hours\",\"evidence\":\"Unapproved record\",\"effectiveness\":\"effective\"}}}"); refused "$UNAPPROVED_ACTUAL" 'Measured verification requires approval'
RETURN_OTHER=$(rpc "$APPROVER_TOKEN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"verification_return\",\"p_case_state\":{\"action\":\"acknowledge\",\"reason\":\"I cannot acknowledge another owner obligation\"}}"); refused "$RETURN_OTHER" 'bound verification owner'
RETURN_ACK=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"verification_return\",\"p_case_state\":{\"action\":\"acknowledge\",\"reason\":\"Returning to review the scheduled obligation\"}}"); ok "$RETURN_ACK"
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
APPROVAL_BEFORE_SOURCE=$(rpc "$APPROVER_TOKEN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_approval\",\"p_case_state\":{\"decision\":\"approved\",\"reason\":\"Evidence basis reviewed and accepted.\"}}"); refused "$APPROVAL_BEFORE_SOURCE" 'source check'
SOURCE=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_source_check\",\"p_case_state\":{\"sourceCheck\":{\"detail\":\"No governed integration is connected\"}}}"); ok "$SOURCE"
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'"); STAMP=$(psqlc "select case_state#>>'{messages,-1,actorId}' from cowork_workspaces where id='$WORKSPACE'"); test "$STAMP" = "$ADMIN_ID"
psqlc "update user_profiles set role='planner' where id='$APPROVER'"
ROLE_CHANGED=$(rpc "$APPROVER_TOKEN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_approval\",\"p_case_state\":{\"decision\":\"approved\",\"reason\":\"Evidence basis reviewed and accepted.\"}}"); refused "$ROLE_CHANGED" 'no longer matches'
psqlc "update user_profiles set role='maintenance_manager' where id='$APPROVER'"
UNSUPPORTED_DELEGATION=$(rpc "$APPROVER_TOKEN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_approval\",\"p_case_state\":{\"decision\":\"delegated\",\"reason\":\"Delegation requires a separate governed reassignment.\"}}"); refused "$UNSUPPORTED_DELEGATION" 'governed approval decision'
APPROVAL=$(rpc "$APPROVER_TOKEN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_approval\",\"p_case_state\":{\"decision\":\"approved\",\"reason\":\"Evidence basis reviewed and accepted.\"}}"); ok "$APPROVAL"
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
APPROVAL_BASIS=$(psqlc "select (case_state#>>'{humanApproval,basisVersion}')||'|'||(case_state#>>'{humanApproval,approvalVersion}')||'|'||(case_state#>>'{humanApproval,basisSha256}')||'|'||decision_case_approval_basis_sha256(case_state) from cowork_workspaces where id='$WORKSPACE'")
BASIS_VERSION=${APPROVAL_BASIS%%|*}; APPROVAL_REST=${APPROVAL_BASIS#*|}; APPROVAL_VERSION=${APPROVAL_REST%%|*}; DIGESTS=${APPROVAL_REST#*|}; STORED_DIGEST=${DIGESTS%%|*}; CURRENT_DIGEST=${DIGESTS#*|}
test "$BASIS_VERSION" -eq $((VERSION-1)); test "$APPROVAL_VERSION" -eq "$VERSION"; test "${#STORED_DIGEST}" = 64; test "$STORED_DIGEST" = "$CURRENT_DIGEST"
OVERWRITE=$(rpc "$APPROVER_TOKEN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_approval\",\"p_case_state\":{\"decision\":\"rejected\",\"reason\":\"Attempted overwrite must be refused.\"}}"); refused "$OVERWRITE" 'immutable'
LOCK_EVIDENCE=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"add_evidence\",\"p_case_state\":{\"evidence\":[]}}"); refused "$LOCK_EVIDENCE" 'approval basis is locked'
LOCK_DISPOSITION=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_disposition\",\"p_case_state\":{\"humanDecision\":{}}}"); refused "$LOCK_DISPOSITION" 'approval basis is locked'
LOCK_PERSON=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_required_person\",\"p_case_state\":{\"requiredPerson\":{}}}"); refused "$LOCK_PERSON" 'approval basis is locked'
LOCK_SOURCE=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_source_check\",\"p_case_state\":{\"sourceCheck\":{}}}"); refused "$LOCK_SOURCE" 'approval basis is locked'
CONVERSATION_PAYLOAD=$(psqlc "select jsonb_build_object('messages',(case_state->'messages')||jsonb_build_array(jsonb_build_object('id','post-approval-note','role','user','author','Customer','text','Approval was acknowledged without changing its basis.','createdAt','2026-10-03T13:00:00Z')),'tokensUsed',coalesce((case_state->>'tokensUsed')::integer,0)) from cowork_workspaces where id='$WORKSPACE'")
CONVERSATION=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_conversation\",\"p_case_state\":$CONVERSATION_PAYLOAD}"); ok "$CONVERSATION"
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
OUTCOME_PAYLOAD='{"verification":{"question":"Did the reading remain inside the reviewed range?","expected":"Independent reading remains inside the reviewed range","scheduledFor":"2026-10-10","actual":"The independent reading remained inside range","evidence":"Signed inspection result IR-42","effectiveness":"effective"}}'
OUTCOME=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"define_verification\",\"p_case_state\":$OUTCOME_PAYLOAD}"); ok "$OUTCOME"
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
test "$(psqlc "select count(*) from cowork_workspaces w,jsonb_array_elements(w.case_state->'valueMetrics') m where w.id='$WORKSPACE' and m->>'id'='downtime-hours' and m->>'baseline'='12 h'")" = 1
test "$(psqlc "select count(*) from cowork_workspaces w,jsonb_array_elements(w.case_state->'comments') c where w.id='$WORKSPACE' and c->>'id'='engineering-note'")" = 1
test "$(psqlc "select count(*) from cowork_workspaces w,jsonb_array_elements(w.case_state->'comments') c where w.id='$WORKSPACE' and c->>'id'='outcome-attribution' and c->>'actorId'='$ADMIN_ID'")" = 1
test "$(psqlc "select count(*) from cowork_workspaces where id='$WORKSPACE' and case_state#>>'{learningRecord,status}'='candidate' and case_state#>>'{learningRecord,recordedBy,id}'='$ADMIN_ID'")" = 1
PLAN_AFTER=$(psqlc "select (select m->>'baseline' from jsonb_array_elements(case_state->'valueMetrics') m where m->>'id'='verify-expected')||'|'||(select m->>'baseline' from jsonb_array_elements(case_state->'valueMetrics') m where m->>'id'='verify-evidence')||'|'||(select m->>'target' from jsonb_array_elements(case_state->'valueMetrics') m where m->>'id'='verify-evidence')||'|'||(select c->>'text' from jsonb_array_elements(case_state->'comments') c where c->>'author'='Verification Owner') from cowork_workspaces where id='$WORKSPACE'")
test "$PLAN_AFTER" = "Independent reading remains inside the reviewed range|2026-10-10|Did the reading remain inside the reviewed range?|$ADMIN_NAME"
test "$(psqlc "select (case_state#>>'{humanApproval,basisSha256}')=decision_case_approval_basis_sha256(case_state) from cowork_workspaces where id='$WORKSPACE'")" = t
SECOND_OUTCOME=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"define_verification\",\"p_case_state\":$OUTCOME_PAYLOAD}"); refused "$SECOND_OUTCOME" 'one-time and already recorded'
CROSS=$(rpc "$FOREIGN_TOKEN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_conversation\",\"p_case_state\":{\"messages\":[],\"tokensUsed\":0}}"); refused "$CROSS" 'not found in this tenant'
CONFLICT=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":1,\"p_command\":\"record_conversation\",\"p_case_state\":{\"messages\":[],\"tokensUsed\":0}}"); refused "$CONFLICT" 'conflict'
AUDIT=$(psqlc "select count(*) from audit_events where entity_type='decision_case_command' and event_data->>'workspaceId'='$WORKSPACE' and previous_state is not null and new_state is not null"); test "$AUDIT" -ge 6
APPROVAL_AUDIT=$(psqlc "select count(*) from audit_events where entity_type='decision_case_command' and event_data->>'workspaceId'='$WORKSPACE' and event_data->>'command'='record_approval' and event_data->>'reason'='Evidence basis reviewed and accepted.' and previous_state->'humanApproval' is null and new_state#>>'{humanApproval,decision}'='approved'"); test "$APPROVAL_AUDIT" = 1
test "$(psqlc "select count(*) from audit_events where entity_type='decision_case_command' and event_data->>'workspaceId'='$WORKSPACE' and event_data->>'command'='define_verification' and event_data->>'postApprovalVerificationOutcome'='true' and new_state#>>'{learningRecord,status}'='candidate'")" = 1
# Full journey continuation remains on the canonical case and audit ledger.
current_command(){
  local version payload
  version=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
  payload=$(W="$WORKSPACE" V="$version" C="$2" P="$3" python3 -c 'import json,os;print(json.dumps({"p_workspace_id":os.environ["W"],"p_expected_version":int(os.environ["V"]),"p_command":os.environ["C"],"p_case_state":json.loads(os.environ["P"])}))')
  rpc "$1" "$payload"
}
FUTURE=$(python3 -c 'import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=1)).isoformat())')
SHARE_PAYLOAD=$(U="$APPROVER" D="$FUTURE" python3 -c 'import json,os;print(json.dumps({"recipientId":os.environ["U"],"expiresAt":os.environ["D"]}))')
SHARED=$(current_command "$ADMIN" record_share "$SHARE_PAYLOAD"); ok "$SHARED"
SHARE_ID=$(psqlc "select case_state#>>'{shares,0,id}' from cowork_workspaces where id='$WORKSPACE'")
SHARE_VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
replay(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_decision_case_replay" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "{\"p_workspace_id\":\"$WORKSPACE\",\"p_version\":$SHARE_VERSION,\"p_share_id\":\"$SHARE_ID\"}"; }
REPLAY=$(replay "$APPROVER_TOKEN"); ok "$REPLAY"
FOREIGN_REPLAY=$(replay "$FOREIGN_TOKEN"); refused "$FOREIGN_REPLAY" 'unavailable'
UNINVOLVED_REPLAY=$(replay "$DEMO"); refused "$UNINVOLVED_REPLAY" 'unavailable'
REVOKE=$(current_command "$ADMIN" revoke_share "{\"shareId\":\"$SHARE_ID\"}"); ok "$REVOKE"
REVOKED_REPLAY=$(replay "$APPROVER_TOKEN"); refused "$REVOKED_REPLAY" 'unavailable'
FOREIGN_SHARE=$(current_command "$ADMIN" record_share "{\"recipientId\":\"$FOREIGN_USER\",\"expiresAt\":\"$FUTURE\"}"); refused "$FOREIGN_SHARE" 'existing same-tenant'
EXPIRED_SHARE=$(current_command "$ADMIN" record_share "{\"recipientId\":\"$APPROVER\",\"expiresAt\":\"2020-01-01T00:00:00Z\"}"); refused "$EXPIRED_SHARE" 'expiry'

SITE_A='99999999-9999-4999-8999-999999999961'; SITE_B='99999999-9999-4999-8999-999999999962'
ASSET_A='99999999-9999-4999-8999-999999999963'; ASSET_B='99999999-9999-4999-8999-999999999964'
psqlc "insert into sites(id,organization_id,name) values('$SITE_A','$ORG','Synthetic rollout A'),('$SITE_B','$ORG','Synthetic rollout B'); insert into assets(id,organization_id,site_id,name) values('$ASSET_A','$ORG','$SITE_A','Synthetic fleet A'),('$ASSET_B','$ORG','$SITE_A','Synthetic fleet B');" >/dev/null
proposal(){
  PHASE="$1" SA="$SITE_A" SB="$SITE_B" AA="$ASSET_A" AB="$ASSET_B" OWNER="$ADMIN_ID" python3 - <<'PY'
import datetime,json,os
phase=os.environ['PHASE']; sites=[os.environ['SA']]
if phase in ('enterprise','handover'):sites.append(os.environ['SB'])
print(json.dumps({'proposal':{'phase':phase,'siteIds':sites,'assetIds':[os.environ['AA'],os.environ['AB']] if phase in ('fleet','enterprise','handover') else [],
'metric':'Synthetic downtime','unit':'hours','baseline':12,'target':8,'direction':'at_most','minimumObservations':2,
'windowEnd':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=3)).isoformat(),
'acceptanceEvidenceIds':['inspection-note'],'rollbackPlan':'Return to the previously approved bounded process.',
'handoverPlan':'The receiving owner checks the retained evidence and residual controls.',
'residualRiskBasis':'Unmeasured causal attribution remains explicitly unresolved.','receivingOwnerId':os.environ['OWNER']}}))
PY
}
SKIP=$(current_command "$DEMO" propose_rollout "$(proposal enterprise)"); refused "$SKIP" 'cannot be skipped'
BAD_SCOPE=$(PAYLOAD="$(proposal pilot)" SITE="$OTHER_ORG" python3 -c 'import json,os;x=json.loads(os.environ["PAYLOAD"]);x["proposal"]["siteIds"]=[os.environ["SITE"]];print(json.dumps(x))')
OUTSIDE_SCOPE=$(current_command "$DEMO" propose_rollout "$BAD_SCOPE"); refused "$OUTSIDE_SCOPE" 'current tenant'
for phase in pilot site fleet enterprise handover; do
  PROPOSED=$(current_command "$DEMO" propose_rollout "$(proposal "$phase")"); ok "$PROPOSED"
  test "$(psqlc "select status from cowork_workspaces where id='$WORKSPACE'")" = active
  SELF_DECISION=$(current_command "$DEMO" decide_rollout '{"decision":"accepted","reason":"Synthetic self-approval must be refused independently."}'); refused "$SELF_DECISION" 'Independent bound human authority'
  if [ "$phase" = enterprise ] || [ "$phase" = handover ]; then DECIDER="$ADMIN"; else DECIDER="$APPROVER_TOKEN"; fi
  NO_RESULT=$(current_command "$DECIDER" decide_rollout '{"decision":"accepted","reason":"Synthetic attempted acceptance without a measured result."}'); refused "$NO_RESULT" 'Measured acceptance'
  WRONG_OWNER=$(current_command "$APPROVER_TOKEN" record_rollout_result '{"actual":7,"observations":2,"evidenceId":"inspection-note"}'); refused "$WRONG_OWNER" 'verification owner'
  sleep 3
  TOO_FEW=$(current_command "$ADMIN" record_rollout_result '{"actual":7,"observations":1,"evidenceId":"inspection-note"}'); refused "$TOO_FEW" 'sufficient observations'
  RESULT=$(current_command "$ADMIN" record_rollout_result '{"actual":7,"observations":2,"evidenceId":"inspection-note"}'); ok "$RESULT"
  ACCEPTED=$(current_command "$DECIDER" decide_rollout '{"decision":"accepted","reason":"Measured criteria, residual risks and handover scope independently reviewed."}'); ok "$ACCEPTED"
  test "$(psqlc "select case_state#>>'{rollout,acceptedPhase}' from cowork_workspaces where id='$WORKSPACE'")" = "$phase"
done
CLOSED_STAGE=$(current_command "$DEMO" propose_rollout "$(proposal closed)"); refused "$CLOSED_STAGE" 'cannot be skipped'
DUPLICATE_STAGE=$(current_command "$ADMIN" decide_rollout '{"decision":"accepted","reason":"Duplicate stage acceptance must not create another decision."}'); refused "$DUPLICATE_STAGE" 'proposed stage'
test "$(psqlc "select case_state#>>'{workPackage,status}' from cowork_workspaces where id='$WORKSPACE'")" = locked
echo 'Continuation passed: existing-access-only replay, revoked/foreign reference refusal, sequential measured rollout and independent enterprise handover; ACTION remains locked.'

psqlc "select set_config('syncai.decision_case_command','on',true); update cowork_workspaces set case_version=case_version+1,case_state=jsonb_set(jsonb_set(case_state,'{recommendation}',to_jsonb('Tampered after approval'::text),true),'{revision}',to_jsonb(case_version+1),true) where id='$WORKSPACE'"
VERSION=$(psqlc "select case_version from cowork_workspaces where id='$WORKSPACE'")
STALE_PAYLOAD=$(psqlc "select jsonb_build_object('messages',case_state->'messages','tokensUsed',coalesce((case_state->>'tokensUsed')::integer,0)) from cowork_workspaces where id='$WORKSPACE'")
STALE=$(rpc "$ADMIN" "{\"p_workspace_id\":\"$WORKSPACE\",\"p_expected_version\":$VERSION,\"p_command\":\"record_conversation\",\"p_case_state\":$STALE_PAYLOAD}"); refused "$STALE" 'stale or unverifiable'
UNAUTHORIZED_REOPEN=$(current_command "$ADMIN" reconsider '{"reason":"Changed evidence requires a fresh independently authorized review."}'); refused "$UNAUTHORIZED_REOPEN" 'bound human authority'
REOPENED=$(current_command "$APPROVER_TOKEN" reconsider '{"reason":"Changed evidence requires a fresh independently authorized review."}'); ok "$REOPENED"
test "$(psqlc "select (case_state ? 'humanApproval')::text||'|'||(case_state ? 'rollout')::text||'|'||status from cowork_workspaces where id='$WORKSPACE'")" = 'false|false|active'
test "$(psqlc "select count(*) from audit_events where entity_type='decision_case_command' and event_data->>'workspaceId'='$WORKSPACE' and event_data->>'command'='record_approval'")" = 1
psqlc "select set_config('syncai.decision_case_command','on',true); update cowork_workspaces set case_version=4,case_state=jsonb_build_object('id','$LEGACY_WORKSPACE','revision',4,'workPackage',jsonb_build_object('status','locked'),'evidence',jsonb_build_array(jsonb_build_object('id','legacy-file','quality','high','finding','File vibration.csv attached (text/csv, 123 bytes). Text was not extracted and the file was not uploaded.','persistence','embedded')),'messages','[]'::jsonb,'tokensUsed',0,'stage','evidence') where id='$LEGACY_WORKSPACE';"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f supabase/migrations/20270103190000_decision_case_command_authority.sql
LEGACY=$(psqlc "select case_version||'|'||(case_state->>'revision')||'|'||(case_state#>>'{evidence,0,persistence}')||'|'||(case_state#>>'{evidence,0,quality}') from cowork_workspaces where id='$LEGACY_WORKSPACE'"); test "$LEGACY" = '5|5|pending|missing'
test "$(psqlc "select count(*) from audit_events where entity_type='decision_case_legacy_normalization' and event_data->>'workspaceId'='$LEGACY_WORKSPACE' and previous_state is not null and new_state is not null")" = 1
echo 'Decision Case authority smoke passed: external_and_ai_refused=true admin_allowed=true directory_binding=true approvals_preserved=true self_binding_refused=true role_mismatch_refused=true side_loads_refused=true governed_init_refused=true forged_gate_message_refused=true bounded_tokens=true duplicate_evidence_refused=true evidence_fail_closed=true unsupported_delegation_refused=true canonical_reload=true legacy_versioned=true approval_prerequisites=true approval_basis_bound=true basis_locked=true conversation_append_only=true one_time_outcome=true metrics_and_comments_preserved=true learning_server_stamped=true stale_refused=true cross_tenant=true conflict=true replayable_audit=true'

# Real RPC retry evidence on the disposable CI database, never a customer claim.
CREATE_BASE=$(BASE="$BASE" python3 -c 'import json,os;x=json.loads(os.environ["BASE"]);x["caseNumber"]="DC-ATOMIC-CREATE";x["evidence"]=[{"id":"missing-inspection","title":"Inspection note","quality":"missing","persistence":"pending","state":"Not supplied","record":"No customer record attached"}];print(json.dumps({"p_case_state":x}))')
initialize_case(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/initialize_decision_case" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$CREATE_BASE"; }
CREATED=$(initialize_case "$ADMIN"); ok "$CREATED"
RETRIED=$(initialize_case "$ADMIN"); ok "$RETRIED"
CREATED_ID=$(BODY="$(body "$CREATED")" python3 -c 'import json,os;print(json.loads(os.environ["BODY"])["caseState"]["id"])')
RETRIED_ID=$(BODY="$(body "$RETRIED")" python3 -c 'import json,os;print(json.loads(os.environ["BODY"])["caseState"]["id"])')
test "$CREATED_ID" = "$RETRIED_ID"
test "$(psqlc "select count(*) from cowork_workspaces where organization_id='$ORG' and case_number='DC-ATOMIC-CREATE'")" = 1
test "$(psqlc "select count(*) from cowork_messages where workspace_id='$CREATED_ID'")" = 0
test "$(psqlc "select count(*) from artifacts where workspace_id='$CREATED_ID'")" = 0
SPONSOR_CREATE=$(initialize_case "$SPONSOR_TOKEN"); refused "$SPONSOR_CREATE" 'authorized internal human'
OTHER_CREATOR=$(initialize_case "$APPROVER_TOKEN"); refused "$OTHER_CREATOR" 'another creation intent'
echo 'Atomic Decision Case creation and retry passed without canned analysis artifacts.'

PROMPT_PAYLOAD=$(CASE_ID="$CREATED_ID" python3 -c 'import json,os;print(json.dumps({"p_workspace_id":os.environ["CASE_ID"],"p_expected_version":1,"p_command":"add_evidence","p_case_state":{"evidence":[{"id":"inspection-prompt-fulfilled","title":"Inspection note","quality":"medium","persistence":"embedded","finding":"Synthetic supplied observation replacing an unanswered request."}]}}))')
UNRELATED_PAYLOAD=$(PAYLOAD="$PROMPT_PAYLOAD" python3 -c 'import json,os;x=json.loads(os.environ["PAYLOAD"]);x["p_case_state"]["evidence"][0]["title"]="An unrelated evidence kind";print(json.dumps(x))')
UNRELATED_REPLACEMENT=$(rpc "$ADMIN" "$UNRELATED_PAYLOAD"); refused "$UNRELATED_REPLACEMENT" 'may not remove existing evidence'
PROMPT_FULFILLED=$(rpc "$ADMIN" "$PROMPT_PAYLOAD"); ok "$PROMPT_FULFILLED"
test "$(psqlc "select case_state#>>'{evidence,0,id}' from cowork_workspaces where id='$CREATED_ID'")" = inspection-prompt-fulfilled
echo 'Unanswered prompt replacement passed; supplied-record deletion remains refused.'

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
field(){ printf '%s' "$1" | python3 -c 'import json,sys;x=json.load(sys.stdin);assert "error" not in x,x;print(x[sys.argv[1]])' "$2"; }
ok(){ printf '%s' "$1" | python3 -c 'import json,sys;x=json.load(sys.stdin);assert "error" not in x,x'; }
refused(){ printf '%s' "$1" | python3 -c 'import json,sys;x=json.load(sys.stdin);assert x.get("error"),x'; }
# Two authenticated attempts must serialize to one accepted write and one refusal.
# HTTP/transport failures are test failures, not acceptable domain refusals.
race_revision(){ API_URL="$API_URL" ANON_KEY="$ANON_KEY" RACE_TOKEN="$1" RACE_RPC="$2" RACE_BODY="$3" python3 - <<'PY'
import concurrent.futures,json,os,threading,urllib.request
barrier=threading.Barrier(2)
def attempt(_):
    request=urllib.request.Request(
        os.environ['API_URL']+'/rest/v1/rpc/'+os.environ['RACE_RPC'],
        data=os.environ['RACE_BODY'].encode(),
        headers={'apikey':os.environ['ANON_KEY'],'authorization':'Bearer '+os.environ['RACE_TOKEN'],'content-type':'application/json'})
    barrier.wait(timeout=10)
    with urllib.request.urlopen(request,timeout=30) as response:
        return json.load(response)
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
ORG='11111111-1111-1111-1111-111111111111'
EVIDENCE='98551000-0000-4000-8000-000000000001'
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
import concurrent.futures,json,os,threading,urllib.request
barrier=threading.Barrier(2)
def start(_):
    request=urllib.request.Request(
        os.environ['API_URL']+'/rest/v1/rpc/start_project_ca_verification',
        data=json.dumps({'p_lesson_id':os.environ['LESSON'],'p_basis':'CI witnessed flush failure review'}).encode(),
        headers={'apikey':os.environ['ANON_KEY'],'authorization':'Bearer '+os.environ['PLANNER'],'content-type':'application/json'})
    barrier.wait(timeout=10)
    with urllib.request.urlopen(request,timeout=30) as response:
        return json.load(response)
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

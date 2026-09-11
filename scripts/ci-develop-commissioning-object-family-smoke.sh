#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D8.06 commissioning smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c 'import json,os,sys; body=json.loads(os.environ["BODY"]); key=os.environ["KEY"]; key in body or sys.exit(f"missing {key!r} in RPC response: {json.dumps(body, sort_keys=True)}"); print(body[key])'; }
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$PLANNER_ID"
EVIDENCE=$(psqlc "with recorded as (insert into evidence_items(organization_id,description,evidence_type,source_system) values('$ORG','D8.06 witnessed functional test record','tested','commissioning-smoke') returning id) select id from recorded")

S1=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"system\",\"p_record\":{\"ref\":\"D806-SYS-A\",\"title\":\"Process water system\",\"description\":\"Process water distribution inside the recorded commissioning boundary.\",\"ownerId\":\"$PLANNER_ID\"}}")
S1ID=$(field "$S1" id)
S2=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"system\",\"p_record\":{\"ref\":\"D806-SYS-B\",\"title\":\"Electrical system\",\"description\":\"Electrical distribution inside the separate commissioning boundary.\",\"ownerId\":\"$PLANNER_ID\"}}")
S2ID=$(field "$S2" id)
SS=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"subsystem\",\"p_record\":{\"systemId\":\"$S1ID\",\"ref\":\"D806-SS-A1\",\"title\":\"Pump train\",\"description\":\"Pump, driver, seal system and local controls inside the system boundary.\",\"ownerId\":\"$PLANNER_ID\"}}")
SSID=$(field "$SS" id)
BAD=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"test_package\",\"p_record\":{\"systemId\":\"$S2ID\",\"subsystemId\":\"$SSID\",\"ref\":\"BAD\",\"title\":\"Bad package\",\"description\":\"This package deliberately crosses commissioning-system boundaries.\",\"ownerId\":\"$PLANNER_ID\"}}")
BODY="$BAD" python3 -c 'import json,os; assert "must belong" in json.loads(os.environ["BODY"])["error"]'
PK=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"test_package\",\"p_record\":{\"systemId\":\"$S1ID\",\"subsystemId\":\"$SSID\",\"ref\":\"D806-TP-A1\",\"title\":\"Pump functional package\",\"description\":\"Functional verification of the pump train against controlled criteria.\",\"ownerId\":\"$PLANNER_ID\"}}")
PKID=$(field "$PK" id)
PR=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"procedure\",\"p_record\":{\"testPackageId\":\"$PKID\",\"ref\":\"D806-PR-A1\",\"title\":\"Pump functional test\",\"acceptanceCriteria\":\"Recorded design flow and protective trips satisfy the approved test sheet.\",\"sourceReference\":\"PROC-D806-001-R1\",\"evidenceClass\":\"DOCUMENTED\",\"assessmentBasis\":\"Approved test sheet and design requirement define the acceptance criteria.\"}}")
PRID=$(field "$PR" id)
RESULT=$(rpc "$PLANNER" record_commissioning_result "{\"p_case_id\":\"$CASE\",\"p_procedure_id\":$PRID,\"p_record\":{\"testRef\":\"D806-RESULT-A1\",\"testStage\":\"commissioning\",\"performedOn\":\"2026-09-11\",\"outcome\":\"pass\",\"punchItemsRaised\":0,\"punchItemsOpen\":0,\"witnessedByOwner\":true,\"evidenceItemId\":\"$EVIDENCE\"}}")
RID=$(field "$RESULT" id)
BODY="$RESULT" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["resultStore"]=="acceptance_tests" and x["releaseStatus"]=="pending"'
READ=$(rpc "$PLANNER" get_case_commissioning "{\"p_case_id\":\"$CASE\"}")
BODY="$READ" S="$S1ID" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); s=next(v for v in x["systems"] if str(v["id"])==os.environ["S"]); assert len(s["subsystems"])==1 and len(s["testPackages"])==1 and len(s["testPackages"][0]["procedures"])==1; assert s["rollup"]=={"resultCount":1,"releasedCount":0,"failedCount":0,"openPunchCount":0,"pendingReleaseCount":1}; assert x["resultStore"]=="acceptance_tests" and "do not authorize" not in x["decisionBoundary"] and "authorize energization" in x["decisionBoundary"]'
RELEASE=$(rpc "$MANAGER" release_quality_acceptance_test "{\"p_id\":$RID,\"p_decision\":\"release\",\"p_note\":\"Independent review confirmed the pass result, evidence and zero open punch items.\"}")
BODY="$RELEASE" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["releaseStatus"]=="released"'
FINAL=$(rpc "$PLANNER" get_case_commissioning "{\"p_case_id\":\"$CASE\"}")
BODY="$FINAL" S="$S1ID" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); s=next(v for v in x["systems"] if str(v["id"])==os.environ["S"]); assert s["rollup"]["releasedCount"]==1 and s["rollup"]["pendingReleaseCount"]==0'
CROSS=$(rpc "$PLANNER" get_case_commissioning '{"p_case_id":"00000000-0000-4000-8000-000000000099"}')
BODY="$CROSS" python3 -c 'import json,os; assert "not found" in json.loads(os.environ["BODY"])["error"]'
echo "D8.06 commissioning smoke passed: hierarchy, boundary refusal, canonical result, per-system rollup, independent release, cross-tenant refusal"

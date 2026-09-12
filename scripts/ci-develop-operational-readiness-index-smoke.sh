#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D8.11 operational-readiness index smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); print(x[os.environ["KEY"]])'; }
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); EXEC=$(token 'executive@syncai.ca' 'Exec123!@#'); AIBOT=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#')
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
SID=$(psqlc "select id from commissioning_systems where organization_id='$ORG' and development_case_id='$CASE' and system_ref='D810-SYS'")
EVIDENCE=$(psqlc "with r as (insert into evidence_items(organization_id,development_case_id,description,evidence_type,source_system) values('$ORG','$CASE','D8.11 human-approved factor mapping, weights and hard-condition policy','documented','operational-readiness-index-smoke') returning id) select id from r")
test -n "$PLANNER"; test -n "$EXEC"; test -n "$AIBOT"; test -n "$SID"; test -n "$EVIDENCE"

# No adopted case policy means no invented universal score.
EMPTY=$(rpc "$PLANNER" get_case_operational_readiness_index "{\"p_case_id\":\"$CASE\"}")
BODY="$EMPTY" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["calculation"]["refusal"]=="no_adopted_profile" and x["readinessStore"]=="asset_onboarding_items"'

# Ensure all canonical categories are in system scope; this does not complete any item.
rpc "$PLANNER" initialize_commissioning_system_readiness "{\"p_system_id\":$SID,\"p_owner_id\":\"$PLANNER_ID\",\"p_required_before\":\"2026-12-31\",\"p_basis\":\"The approved D8.11 index policy requires all canonical readiness categories in system scope.\",\"p_basis_evidence_item_id\":\"$EVIDENCE\"}" >/dev/null
INCOMPLETE='[{"key":"people","weight":1,"categories":["training"]}]'
BAD=$(rpc "$PLANNER" save_case_operational_readiness_index_profile "{\"p_case_id\":\"$CASE\",\"p_profile_id\":null,\"p_factors\":$INCOMPLETE,\"p_hard_requirement_keys\":[\"s36_emergency_procedures\"],\"p_basis\":\"An intentionally incomplete draft proves adoption refuses missing factors and category assignments.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
PID=$(field "$BAD" profileId)
REFUSED=$(rpc "$EXEC" adopt_case_operational_readiness_index_profile "{\"p_profile_id\":\"$PID\"}")
BODY="$REFUSED" python3 -c 'import json,os; assert "cannot be adopted" in json.loads(os.environ["BODY"])["error"]'

FACTORS='[{"key":"people","weight":1.2,"categories":["vendor_support"]},{"key":"procedures","weight":1.1,"categories":["procedure"]},{"key":"asset_data","weight":1.4,"categories":["asset_master","bom","documentation"]},{"key":"maintenance","weight":1.5,"categories":["pm","task_list","condition_monitoring"]},{"key":"spares","weight":1.0,"categories":["spares"]},{"key":"training","weight":1.3,"categories":["training"]},{"key":"operations","weight":1.0,"categories":["inspection"]},{"key":"safety","weight":2.0,"categories":["emergency_response"]},{"key":"cyber","weight":0.8,"categories":["cyber"]}]'
SAVED=$(rpc "$PLANNER" save_case_operational_readiness_index_profile "{\"p_case_id\":\"$CASE\",\"p_profile_id\":\"$PID\",\"p_factors\":$FACTORS,\"p_hard_requirement_keys\":[\"s36_emergency_procedures\",\"s36_emergency_drill\"],\"p_basis\":\"The project team assigned all thirteen categories once and weighted safety highest for this specific case.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$SAVED" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["status"]=="draft"'
AI=$(rpc "$AIBOT" save_case_operational_readiness_index_profile "{\"p_case_id\":\"$CASE\",\"p_profile_id\":\"$PID\",\"p_factors\":$FACTORS,\"p_hard_requirement_keys\":[\"s16_safety_critical\"],\"p_basis\":\"An AI identity attempts to rewrite a human-governed readiness-index policy and must be refused.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$AI" python3 -c 'import json,os; assert "named-human" in json.loads(os.environ["BODY"])["error"]'
ADOPTED=$(rpc "$EXEC" adopt_case_operational_readiness_index_profile "{\"p_profile_id\":\"$PID\"}")
BODY="$ADOPTED" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x.get("status")=="adopted", x'

RESULT=$(rpc "$PLANNER" get_case_operational_readiness_index "{\"p_case_id\":\"$CASE\"}")
BODY="$RESULT" PID="$PID" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); c=x["calculation"]; assert c["profileId"]==os.environ["PID"] and len(c["factors"])==9 and c["index"] is not None; assert c["status"]=="BLOCKED" and c["hardConditionOverride"] is True and c["hardBlockerCount"]>0; assert any(b["kind"]=="safety_mission_critical" for b in c["hardBlockers"]); assert "cannot accept handover" in x["decisionBoundary"]'
NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/develop-operational-readiness-agent" -H 'Content-Type: application/json' -d "{\"case_id\":\"$CASE\"}")
test "$NOAUTH" = "401"
AGENT=$(curl -sS -X POST "$API_URL/functions/v1/develop-operational-readiness-agent" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLANNER" -H 'Content-Type: application/json' -d "{\"case_id\":\"$CASE\"}")
BODY="$AGENT" PID="$PID" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); a=x["analysis"]; assert x["advisory"] is True and x["question"]=="Could operations take ownership tomorrow?"; assert a["answer"]=="no" and a["status"]=="BLOCKED" and a["index"] is not None; assert a["profileVersion"]==1 and len(a["factorFindings"])==9 and len(a["blockers"])>0; refs=a["evidenceRefs"]; assert "operational_readiness_index_profiles:"+os.environ["PID"] in refs and any(r.startswith("asset_onboarding_items:") for r in refs); assert "cannot accept handover" in x["disclaimer"]'
FOREIGN_AGENT=$(curl -sS -X POST "$API_URL/functions/v1/develop-operational-readiness-agent" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLANNER" -H 'Content-Type: application/json' -d '{"case_id":"00000000-0000-4000-8000-000000000099"}')
BODY="$FOREIGN_AGENT" python3 -c 'import json,os; assert "not found" in json.loads(os.environ["BODY"])["error"]'
if psqlc "update operational_readiness_index_profiles set basis='A direct writer attempts to rewrite the adopted policy content.' where id='$PID'" >/dev/null 2>&1; then echo 'adopted policy rewrite unexpectedly succeeded'; exit 1; fi
if psqlc "insert into operational_readiness_index_profiles(organization_id,development_case_id,version,factors,hard_requirement_keys,basis,evidence_item_id,created_by) values('$ORG','$CASE',99,'[]','{}','A direct writer attempts to bypass the governed human policy workflow.','$EVIDENCE','$PLANNER_ID')" >/dev/null 2>&1; then echo 'direct policy insert unexpectedly succeeded'; exit 1; fi
CROSS=$(rpc "$PLANNER" get_case_operational_readiness_index '{"p_case_id":"00000000-0000-4000-8000-000000000099"}')
BODY="$CROSS" python3 -c 'import json,os; assert "not found" in json.loads(os.environ["BODY"])["error"]'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='operational_readiness_index_profile' and event_data->>'action'='adopted' and event_data->>'profile_id'='$PID'")" = "1"
echo 'D8.11/D12.14 operational-readiness smoke passed: governed weights, exact category coverage, hard override, tenant-scoped advisory agent, evidence, immutability and no invented defaults'

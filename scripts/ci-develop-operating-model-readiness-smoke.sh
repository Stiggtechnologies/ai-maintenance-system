#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Operating-model readiness smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
test -n "$PLANNER"; test -n "$PLANNER_ID"

INITIAL=$(rpc "$PLANNER" get_case_operating_model_readiness "{\"p_case_id\":\"$CASE\"}")
BODY="$INITIAL" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["dimensionCount"]==13 and len(x["dimensions"])==13 and x["notAssessedCount"]==13 and x["verdict"]=="NOT_READY"'

AI=$(rpc "$PLANNER" record_operating_model_readiness "{\"p_case_id\":\"$CASE\",\"p_dimension\":\"budget\",\"p_status\":\"ready\",\"p_owner_id\":\"$PLANNER_ID\",\"p_evidence_reference\":\"AI-D801\",\"p_evidence_class\":\"AI_INFERENCE\",\"p_basis\":\"An AI suggestion cannot establish organizational readiness.\"}")
BODY="$AI" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "ai inference alone cannot establish" in (x.get("message") or x.get("error") or "").lower()'

dimensions=(organization_structure staffing competencies shift_model maintenance_strategy supply_chain contractors warehouse engineering_support operations_procedures emergency_response it_ot_support)
for dimension in "${dimensions[@]}"; do
  RESULT=$(rpc "$PLANNER" record_operating_model_readiness "{\"p_case_id\":\"$CASE\",\"p_dimension\":\"$dimension\",\"p_status\":\"ready\",\"p_owner_id\":\"$PLANNER_ID\",\"p_evidence_reference\":\"DOC-D801-$dimension\",\"p_evidence_class\":\"DOCUMENTED\",\"p_basis\":\"Accountable owner reviewed the referenced operating-model evidence.\"}")
  BODY="$RESULT" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["status"]=="ready"'
done
RISK=$(rpc "$PLANNER" record_operating_model_readiness "{\"p_case_id\":\"$CASE\",\"p_dimension\":\"budget\",\"p_status\":\"at_risk\",\"p_owner_id\":\"$PLANNER_ID\",\"p_evidence_reference\":\"BUD-D801-1\",\"p_evidence_class\":\"DOCUMENTED\",\"p_basis\":\"Operating budget is documented but final authorization remains open.\"}")
BODY="$RISK" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["version"]==1'
PARTIAL=$(rpc "$PLANNER" get_case_operating_model_readiness "{\"p_case_id\":\"$CASE\"}")
BODY="$PARTIAL" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["readyCount"]==12 and x["atRiskCount"]==1 and x["notAssessedCount"]==0 and x["verdict"]=="NOT_READY"'

READY=$(rpc "$PLANNER" record_operating_model_readiness "{\"p_case_id\":\"$CASE\",\"p_dimension\":\"budget\",\"p_status\":\"ready\",\"p_owner_id\":\"$PLANNER_ID\",\"p_evidence_reference\":\"BUD-D801-2\",\"p_evidence_class\":\"DOCUMENTED\",\"p_basis\":\"Final authorized operating budget is recorded in the referenced source.\"}")
BODY="$READY" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["version"]==2 and x["status"]=="ready"'
FINAL=$(rpc "$PLANNER" get_case_operating_model_readiness "{\"p_case_id\":\"$CASE\"}")
BODY="$FINAL" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["readyCount"]==13 and x["verdict"]=="READY" and "does not approve" in x["decisionBoundary"]'

CROSS=$(rpc "$PLANNER" get_case_operating_model_readiness '{"p_case_id":"00000000-0000-4000-8000-000000000099"}')
BODY="$CROSS" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "not found in this organization" in (x.get("message") or x.get("error") or "").lower()'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='operating_model_readiness'")" -eq 14
echo "Operating-model readiness smoke passed: 13 dimensions, versioned evidence, AI-only readiness refused, READY only at 13/13, cross-tenant refused"

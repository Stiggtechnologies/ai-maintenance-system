#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Technical-debt smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; ASSET='80200000-0000-4000-8000-000000000001'; CASE='80200000-0000-4000-8000-000000000002'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#'); EXEC=$(token 'executive@syncai.ca' 'Exec123!@#'); PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$EXEC"
psqlc "insert into assets(id,organization_id,tag,name) values('$ASSET','$ORG','D802-ASSET','D8.02 Asset') on conflict(id) do nothing; insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,created_by) values('$CASE','$ORG','D8.02 case','brownfield','Track a known imperfect handover choice without hiding its exposure.','active','$PLANNER_ID') on conflict(id) do nothing; insert into development_case_assets(organization_id,development_case_id,asset_id,added_by) values('$ORG','$CASE','$ASSET','$PLANNER_ID') on conflict(development_case_id,asset_id) do nothing;" >/dev/null
REC=$(rpc "$MANAGER" record_case_technical_debt "{\"p_case_id\":\"$CASE\",\"p_debt\":{\"asset_id\":\"$ASSET\",\"modification_kind\":\"deferred_redesign\",\"description\":\"Deferred permanent redesign of the guarded access arrangement.\",\"reason\":\"Temporary operating controls remain necessary until the redesign window.\",\"required_removal_by\":\"2099-12-31\",\"risk_assessment_ref\":\"RA-D802-001\"}}")
DEBT=$(BODY="$REC" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="awaiting_independent_approval"; print(x["id"])')
SELF=$(rpc "$MANAGER" approve_case_technical_debt "{\"p_debt_id\":$DEBT,\"p_basis\":\"Manager cannot approve their own recorded debt choice.\"}"); BODY="$SELF" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "recorder cannot approve" in (x.get("message") or x.get("error") or "").lower()'
APP=$(rpc "$EXEC" approve_case_technical_debt "{\"p_debt_id\":$DEBT,\"p_basis\":\"Independent operations review accepts controls until removal.\"}"); BODY="$APP" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["status"]=="approved"'
REG=$(rpc "$PLANNER" get_case_technical_debt "{\"p_case_id\":\"$CASE\"}"); BODY="$REG" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["unvaluedCount"]==1 and x["valuationStatus"]=="incomplete_unvalued_items_present" and x["items"][0]["approvedAt"]'
BAD=$(rpc "$PLANNER" record_case_technical_debt "{\"p_case_id\":\"$CASE\",\"p_debt\":{\"asset_id\":\"$ASSET\",\"modification_kind\":\"incomplete_monitoring\",\"description\":\"Incomplete monitoring coverage remains on the affected asset.\",\"reason\":\"Instrumentation delivery is deferred to the approved outage window.\",\"required_removal_by\":\"2099-12-31\",\"risk_assessment_ref\":\"RA-D802-002\",\"lifecycle_cost\":\"5000\"}}")
BODY="$BAD" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "supplied together" in (x.get("message") or x.get("error") or "").lower()'
echo "Technical-debt smoke passed: canonical extension, unknown valuation, independent approval, tuple refusal"

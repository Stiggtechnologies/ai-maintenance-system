#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Operational-debt valuation smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#'); ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
ITEM=$(psqlc "select id from operational_debt_items where organization_id='$ORG' and development_case_id='$CASE' order by recorded_at limit 1")
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$ADMIN"; test -n "$ITEM"

BEFORE=$(rpc "$PLANNER" get_case_operational_debt "{\"p_case_id\":\"$CASE\"}")
BODY="$BEFORE" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["valuationStatus"]=="incomplete_unvalued_items_present" and x["unvaluedCount"]==1 and x["totalsByCurrency"]==[]'

CALC=$(rpc "$MANAGER" record_operational_debt_valuation "{\"p_item_id\":\"$ITEM\",\"p_resolution_cost\":1000,\"p_annual_operating_cost\":100,\"p_annual_risk_exposure\":200,\"p_exposure_years\":2,\"p_discount_rate\":0.1,\"p_currency\":\"USD\",\"p_basis\":\"Two-year discounted exposure using approved estimating inputs.\",\"p_source_reference\":\"EST-D804-001\"}")
BODY="$CALC" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="pending_approval" and float(x["lifecycleExposure"])==1520.66 and x["currency"]=="USD"'
SELF=$(rpc "$MANAGER" approve_operational_debt_valuation "{\"p_item_id\":\"$ITEM\",\"p_version\":1,\"p_basis\":\"The calculator cannot approve their own lifecycle exposure.\"}")
BODY="$SELF" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "recorder cannot approve" in (x.get("message") or x.get("error") or "").lower()'
APP=$(rpc "$ADMIN" approve_operational_debt_valuation "{\"p_item_id\":\"$ITEM\",\"p_version\":1,\"p_basis\":\"Independent executive review confirms the inputs and method.\"}")
BODY="$APP" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="approved" and float(x["lifecycleExposure"])==1520.66'

PROJECT=$(psqlc "select capital_project_id from development_cases where id='$CASE'")
psqlc "insert into acceptance_tests(organization_id,project_id,test_ref,test_stage,outcome,punch_items_raised,punch_items_open) values('$ORG',$PROJECT,'D804-AT','commissioning','pass_with_punch',1,1);" >/dev/null
CAND=$(rpc "$PLANNER" get_case_operational_debt_candidates "{\"p_case_id\":\"$CASE\"}")
SOURCE=$(BODY="$CAND" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); p=[i for i in x if i["gapClass"]=="punch_items"]; assert len(p)==1; print(p[0]["sourceId"])')
REC2=$(rpc "$PLANNER" record_operational_debt_reference "{\"p_case_id\":\"$CASE\",\"p_gap_class\":\"punch_items\",\"p_source_table\":\"acceptance_tests\",\"p_source_id\":\"$SOURCE\",\"p_owner_id\":\"$PLANNER_ID\"}")
ITEM2=$(BODY="$REC2" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); print(x["id"])')
PARTIAL=$(rpc "$PLANNER" get_case_operational_debt "{\"p_case_id\":\"$CASE\"}")
BODY="$PARTIAL" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["unvaluedCount"]==1 and x["valuationStatus"]=="incomplete_unvalued_items_present" and len(x["totalsByCurrency"])==1 and float(x["totalsByCurrency"][0]["lifecycleExposure"])==1520.66'

MISSING=$(rpc "$PLANNER" record_operational_debt_valuation "{\"p_item_id\":\"$ITEM2\",\"p_resolution_cost\":null,\"p_annual_operating_cost\":0,\"p_annual_risk_exposure\":0,\"p_exposure_years\":2,\"p_discount_rate\":0.1,\"p_currency\":\"CAD\",\"p_basis\":\"Unknown cost must remain unknown rather than becoming zero.\",\"p_source_reference\":\"EST-D804-002\"}")
BODY="$MISSING" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "unvalued rather than substituting zero" in (x.get("message") or x.get("error") or "").lower()'
CROSS=$(rpc "$PLANNER" record_operational_debt_valuation "{\"p_item_id\":\"00000000-0000-4000-8000-000000000099\",\"p_resolution_cost\":1,\"p_annual_operating_cost\":0,\"p_annual_risk_exposure\":0,\"p_exposure_years\":1,\"p_discount_rate\":0,\"p_currency\":\"CAD\",\"p_basis\":\"Cross-tenant and absent records must be indistinguishable.\",\"p_source_reference\":\"EST-D804-X\"}")
BODY="$CROSS" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "not found in this organization" in (x.get("message") or x.get("error") or "").lower()'

test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='operational_debt_valuation'")" -ge 2
echo "Operational-debt valuation smoke passed: discounted exposure=1520.66 USD, unknown remains unvalued, self-approval and cross-tenant access refused"

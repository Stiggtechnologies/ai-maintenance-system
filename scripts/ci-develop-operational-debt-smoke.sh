#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Operational-debt smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#'); ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#'); PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
PROJECT=$(psqlc "with r as (insert into capital_projects(organization_id,project_code,title,status) values('$ORG','D803-PROJ','D8.03 handover','active') returning id) select id from r")
psqlc "insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,capital_project_id,status,created_by) values('$CASE','$ORG','D8.03 case','brownfield','Make every incomplete transfer visible to operations with accountable ownership.',$PROJECT,'active','$PLANNER_ID') on conflict(id) do nothing; insert into acceptance_tests(organization_id,project_id,test_ref,test_stage,outcome,punch_items_raised,punch_items_open) values('$ORG',$PROJECT,'D803-AT','commissioning','pass_with_punch',2,2);" >/dev/null
CAND=$(rpc "$PLANNER" get_case_operational_debt_candidates "{\"p_case_id\":\"$CASE\"}")
SOURCE=$(BODY="$CAND" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); p=[i for i in x if i["gapClass"]=="punch_items"]; assert len(p)==1; print(p[0]["sourceId"])')
REC=$(rpc "$MANAGER" record_operational_debt_reference "{\"p_case_id\":\"$CASE\",\"p_gap_class\":\"punch_items\",\"p_source_table\":\"acceptance_tests\",\"p_source_id\":\"$SOURCE\",\"p_owner_id\":\"$PLANNER_ID\",\"p_due_on\":\"2099-12-31\"}")
ITEM=$(BODY="$REC" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="awaiting_operations_acknowledgement"; print(x["id"])')
SELF=$(rpc "$MANAGER" acknowledge_operational_debt "{\"p_item_id\":\"$ITEM\",\"p_basis\":\"Recorder cannot acknowledge the same transfer for operations.\"}"); BODY="$SELF" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "recorder cannot" in (x.get("message") or x.get("error") or "").lower()'
ACK=$(rpc "$ADMIN" acknowledge_operational_debt "{\"p_item_id\":\"$ITEM\",\"p_basis\":\"Operations reviewed the open punch items and accepts ownership.\"}"); BODY="$ACK" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["status"]=="operations_acknowledged"'
READ=$(rpc "$PLANNER" get_case_operational_debt "{\"p_case_id\":\"$CASE\"}"); BODY="$READ" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["gapClasses"]==9 and len(x["items"])==1 and x["items"][0]["acknowledgedAt"]'
REUSE=$(rpc "$PLANNER" record_operational_debt_reference "{\"p_case_id\":\"$CASE\",\"p_gap_class\":\"punch_items\",\"p_source_table\":\"acceptance_tests\",\"p_source_id\":\"$SOURCE\",\"p_owner_id\":\"$PLANNER_ID\"}"); BODY="$REUSE" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "not a current canonical" in (x.get("message") or x.get("error") or "").lower()'
echo "Operational-debt smoke passed: canonical candidate, owner, independent operations acknowledgement, duplicate refusal"

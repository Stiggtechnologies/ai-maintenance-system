#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D12.02 contract-strategy smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999923'
CASE='91202000-0000-4000-8000-000000000001'
FOREIGN_CASE='91202000-0000-4000-8000-000000000002'
EVIDENCE='91202000-0000-4000-8000-000000000101'
FOREIGN_EVIDENCE='91202000-0000-4000-8000-000000000102'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

PLANNER=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$PLANNER"
PLANNER_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
test -n "$PLANNER_ID"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','D12.02 foreign','utilities') on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,created_by)
values
('$CASE','$ORG','D12.02 contracting strategy case','brownfield','Select an evidence-grounded delivery and commercial strategy before tender.','active','$PLANNER_ID'),
('$FOREIGN_CASE','$OTHER_ORG','Foreign contracting case','brownfield','This foreign case must remain outside the requesting organization.','active',null)
on conflict(id) do nothing;
insert into evidence_items(id,organization_id,development_case_id,source_system,evidence_type,description,data_quality,source_reference,evidence_class,verification_status,verified_by,verified_at,verification_method)
values
('$EVIDENCE','$ORG','$CASE','ci','document','Approved project definition, market sounding and owner capability evidence for D12.02.','high','D12.02-CI-001','DOCUMENTED','verified','$PLANNER_ID',now(),'Controlled CI fixture review'),
('$FOREIGN_EVIDENCE','$OTHER_ORG','$FOREIGN_CASE','ci','document','Foreign tenant evidence that must never support this organization recommendation.','high','D12.02-CI-FOREIGN','DOCUMENTED','verified','$PLANNER_ID',now(),'Controlled foreign CI fixture review')
on conflict(id) do nothing;
SQL

test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_contract_strategy_context" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"p_case_id\":\"$CASE\"}")" = 401
CONTEXT=$(rpc "$PLANNER" get_contract_strategy_context "{\"p_case_id\":\"$CASE\"}")
ok "$CONTEXT"
BODY="$(body "$CONTEXT")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert len(x["allowedStrategies"])==7;assert x["caseStatus"]=="active"'
FOREIGN_CONTEXT=$(rpc "$PLANNER" get_contract_strategy_context "{\"p_case_id\":\"$FOREIGN_CASE\"}")
err "$FOREIGN_CONTEXT" 'development case not found'

ASSESSMENT=$(EVIDENCE="$EVIDENCE" python3 -c 'import json,os; ds=["definition_maturity","uncertainty","market_conditions","owner_capability","interface_complexity","risk_allocation"]; print(json.dumps({d:{"level":"medium","basis":"Controlled acceptance evidence provides a substantive basis for "+d+".","evidenceItemId":os.environ["EVIDENCE"]} for d in ds}))')
ADVICE=$(python3 -c 'import json; ss=["lump_sum","unit_rate","epc","epcm","alliance","owner_executed","performance_contract"]; print(json.dumps({"recommendedStrategy":"epcm","rationale":"EPCM best preserves owner control while coordinating the documented brownfield interfaces and retaining transparent package-level competition.","limitations":"The recommendation depends on current market sounding and must be reviewed by accountable project and procurement authorities.","model":"ci-controlled-model-1","evaluations":[{"strategy":s,"fit":"strong" if s=="epcm" else "conditional","reason":"This controlled comparison considers the six supplied project factors without making an award decision."} for s in ss]}))')
PAYLOAD=$(ASSESSMENT="$ASSESSMENT" ADVICE="$ADVICE" CASE="$CASE" python3 -c 'import json,os;print(json.dumps({"p_case_id":os.environ["CASE"],"p_assessment":json.loads(os.environ["ASSESSMENT"]),"p_advice":json.loads(os.environ["ADVICE"])}))')
RECORDED=$(rpc "$PLANNER" record_contract_strategy_recommendation "$PAYLOAD")
ok "$RECORDED"
RECOMMENDATION=$(BODY="$(body "$RECORDED")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["status"]=="pending" and x["strategy"]=="epcm";print(x["recommendationId"])')

FOREIGN_ASSESSMENT=$(EVIDENCE="$FOREIGN_EVIDENCE" python3 -c 'import json,os; ds=["definition_maturity","uncertainty","market_conditions","owner_capability","interface_complexity","risk_allocation"]; print(json.dumps({d:{"level":"medium","basis":"Foreign evidence must be rejected even with a substantive-looking basis.","evidenceItemId":os.environ["EVIDENCE"]} for d in ds}))')
FOREIGN_PAYLOAD=$(ASSESSMENT="$FOREIGN_ASSESSMENT" ADVICE="$ADVICE" CASE="$CASE" python3 -c 'import json,os;print(json.dumps({"p_case_id":os.environ["CASE"],"p_assessment":json.loads(os.environ["ASSESSMENT"]),"p_advice":json.loads(os.environ["ADVICE"])}))')
FOREIGN_RESULT=$(rpc "$PLANNER" record_contract_strategy_recommendation "$FOREIGN_PAYLOAD")
err "$FOREIGN_RESULT" 'requires evidence recorded against this case'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  begin update contract_strategy_assessments set limitations='A direct mutation must never be accepted by the immutable evidence ledger.' where recommendation_id='$RECOMMENDATION';
    raise exception 'direct assessment mutation was incorrectly allowed';
  exception when others then if sqlerrm not like '%immutable%' then raise; end if; end;
end \$\$;
SQL

COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(*) from recommendations where id='$RECOMMENDATION' and organization_id='$ORG' and development_case_id='$CASE' and status='pending' and confidence is null and contract_strategy='epcm' and agent_tool_key='draft_recommendation' and agent_decision_right_key='recommend_contract_strategy'),(select count(*) from contract_strategy_assessments where recommendation_id='$RECOMMENDATION' and organization_id='$ORG' and development_case_id='$CASE' and (select count(*) from jsonb_object_keys(assessment))=6 and jsonb_array_length(evaluations)=7 and requested_by='$PLANNER_ID'),(select count(*) from approvals where recommendation_id='$RECOMMENDATION'),(select count(*) from audit_events where organization_id='$ORG' and entity_type='contract_strategy_recommendation' and event_data->>'recommendation_id'='$RECOMMENDATION');")
echo "D12.02 ledger counts pending|assessment|approval|audit=$COUNTS"
test "$COUNTS" = '1|1|0|1'
echo 'D12.02 contract-strategy smoke passed: seven_strategies=true six_factors=true evidence_bound=true tenant_wall=true pending_only=true no_self_approval=true no_award=true immutable_assessment=true'

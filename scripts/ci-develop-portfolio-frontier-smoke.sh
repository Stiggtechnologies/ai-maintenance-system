#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D10.04 portfolio-frontier smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
YEAR=$(( $(date -u +%Y) + 1 ))

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

ASSESSOR=$(token 'admin@syncai.ca' 'Admin123!@#')
VERIFIER=$(token 'demo@syncai.ca' 'Demo123!@#')
REVIEWER=$(token 'executive@syncai.ca' 'Exec123!@#')
test -n "$ASSESSOR" && test -n "$VERIFIER" && test -n "$REVIEWER"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,created_by)
select ('98460000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$ORG',
  'D10 frontier candidate '||i,'brownfield',
  'Evidence-backed decision trade-off candidate for the nine-dimension frontier acceptance test '||i||'.',
  'active','00000000-0000-0000-0000-000000000006'
from generate_series(1,4) i on conflict(id) do nothing;
insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class)
select ('98461000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$ORG','ci','document',
  'Independent evidence dossier covering all nine calibrated frontier dimensions for candidate '||i||'.','DOCUMENTED'
from generate_series(1,4) i on conflict(id) do nothing;
SQL

for i in $(seq 1 4); do
  EVIDENCE=$(printf '98461000-0000-4000-8000-%012d' "$i")
  VERIFIED=$(rpc "$VERIFIER" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent nine-dimension portfolio calibration review\",\"p_outcome\":\"verified\",\"p_note\":\"The source, common scale, direction and basis for every portfolio dimension were independently checked.\"}")
  ok "$VERIFIED"
done

for i in $(seq 1 4); do
  CASE_ID=$(printf '98460000-0000-4000-8000-%012d' "$i")
  EVIDENCE=$(printf '98461000-0000-4000-8000-%012d' "$i")
  COST=$((400000 + i*100000))
  PAYLOAD=$(python3 -c 'import json,sys; i=int(sys.argv[1]); cost=int(sys.argv[5]); print(json.dumps({"p_candidate":{"developmentCaseId":sys.argv[2],"planYear":int(sys.argv[3]),"category":["regulatory_capital","capacity","reliability","decarbonization"][i-1],"currency":"CAD","cost":cost,"costLow":cost*0.9,"costHigh":cost*1.15,"benefit":cost*2,"benefitLow":cost*1.4,"benefitHigh":cost*2.5,"benefitProbability":0.75,"riskReductionValue":50000*i,"mandatory":False,"mandatoryBasis":"","earliestStart":f"{sys.argv[3]}-01-01","latestStart":f"{sys.argv[3]}-10-01","durationMonths":4+i,"evidenceItemId":sys.argv[4],"constraintNote":"The acceptance fixture records its funding, timing, resource and delivery constraints."}}))' "$i" "$CASE_ID" "$YEAR" "$EVIDENCE" "$COST")
  CONFIGURED=$(rpc "$ASSESSOR" configure_portfolio_candidate "$PAYLOAD")
  ok "$CONFIGURED"
  DIMENSIONS=$(python3 -c 'import json,sys
i=int(sys.argv[1]); keys=["regulatory_necessity","safety_risk","production_benefit","reliability","npv","asset_life","sustainability","resource_demand","execution_risk"]
scores=[[95,90,25,40,45,55,30,80,20],[25,35,95,50,90,35,45,20,80],[30,55,45,95,60,95,40,50,50],[35,45,55,60,70,65,98,10,30]][i-1]
dimensions={k:{"score":scores[n],"basis":f"Independent evidence calibrates {k} for candidate {i} on the common governed decision scale."} for n,k in enumerate(keys)}
print(json.dumps({"p_development_case_id":sys.argv[2],"p_plan_year":int(sys.argv[3]),"p_dimensions":dimensions,"p_calibration_note":"Independent reviewers calibrated every candidate on one common 0-100 decision scale for this planning horizon."}))' "$i" "$CASE_ID" "$YEAR")
  DIMENSIONED=$(rpc "$ASSESSOR" configure_portfolio_candidate_dimensions "$DIMENSIONS")
  ok "$DIMENSIONED"
done

CASE_ONE='98460000-0000-4000-8000-000000000001'
BAD=$(rpc "$ASSESSOR" configure_portfolio_candidate_dimensions "{\"p_development_case_id\":\"$CASE_ONE\",\"p_plan_year\":$YEAR,\"p_dimensions\":{\"npv\":{\"score\":80,\"basis\":\"This deliberately omits eight required dimensions.\"}},\"p_calibration_note\":\"This deliberately incomplete scale must be refused by the governed function.\"}")
err "$BAD" 'exactly the nine governed decision dimensions'

RUN=$(rpc "$REVIEWER" run_enterprise_portfolio_frontier "{\"p_plan_year\":$YEAR,\"p_budget\":1300000,\"p_currency\":\"CAD\"}")
ok "$RUN"
RUN_ID=$(BODY="$(body "$RUN")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["candidateCount"]==4,x;assert x["frontierCount"]>=2,x;assert len(x["dimensions"])==9,x;assert x["globallyOptimal"] is False;assert x["frontierExhaustive"] is False;assert x["operationalAuthorization"] is False;print(x["calculationRunId"])')
PORTFOLIO_ID=$(BODY="$(body "$RUN")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);print(x["frontier"][0]["portfolioId"])')
PROPOSED=$(rpc "$REVIEWER" propose_enterprise_portfolio_frontier "{\"p_calculation_run_id\":\"$RUN_ID\",\"p_portfolio_id\":\"$PORTFOLIO_ID\",\"p_rationale\":\"A named human selected this non-dominated trade-off after reviewing all nine dimensions and their evidence.\"}")
ok "$PROPOSED"
BODY="$(body "$PROPOSED")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["status"]=="pending_human_review";assert x["fundsCommitted"] is False;assert x["projectsSanctioned"] is False'
FAKE=$(rpc "$REVIEWER" propose_enterprise_portfolio_frontier "{\"p_calculation_run_id\":\"$RUN_ID\",\"p_portfolio_id\":\"pf-not-recorded\",\"p_rationale\":\"A portfolio not on the immutable frontier must never enter the approval chain.\"}")
err "$FAKE" 'not on this recorded non-dominated frontier'
WORKSPACE=$(rpc "$REVIEWER" get_enterprise_portfolio_workspace "{\"p_plan_year\":$YEAR}")
ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" python3 -c '
import json,os
x=json.loads(os.environ["BODY"])
ids={
  "98460000-0000-4000-8000-000000000001",
  "98460000-0000-4000-8000-000000000002",
  "98460000-0000-4000-8000-000000000003",
  "98460000-0000-4000-8000-000000000004",
}
fixtures=[c for c in x["candidates"] if c.get("developmentCaseId") in ids]
assert len(fixtures)==4, {"workspaceCandidates":len(x["candidates"]),"fixtures":len(fixtures)}
assert all(isinstance(c.get("portfolioDimensions"), dict) and len(c["portfolioDimensions"])==9 for c in fixtures), fixtures
'

COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(*) from calculation_runs where organization_id='$ORG' and calculation_key='enterprise_portfolio_frontier' and id='$RUN_ID'),(select count(*) from recommendations where organization_id='$ORG' and portfolio_calculation_run_id='$RUN_ID'),(select count(*) from approvals a join recommendations r on r.id=a.recommendation_id where r.portfolio_calculation_run_id='$RUN_ID' and a.status='pending');")
test "$COUNTS" = '1|1|1'
echo 'D10.04 portfolio-frontier smoke passed: dimensions=9 frontier_multiple=true non_dominated=true evidence_verified=true named_human=true immutable_run=true human_final=true'

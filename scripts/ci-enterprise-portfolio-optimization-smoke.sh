#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U11 enterprise-portfolio smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999923'
YEAR=$(date -u +%Y)
CATEGORIES='sustaining_capital,growth_capital,regulatory_capital,reliability,obsolescence,decarbonization,safety_risk,life_extension,modernization,capacity,decommissioning'

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
insert into organizations(id,name,industry) values('$OTHER_ORG','U11 foreign','utilities') on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,created_by)
select ('98420000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$ORG',
  'U11 candidate '||i,
  (array['sustaining_capital','greenfield','regulatory','reliability_improvement','replacement','brownfield','regulatory','life_extension','brownfield','capacity','decommissioning'])[i],
  'A governed portfolio candidate problem statement for acceptance test category '||i||'.','active','00000000-0000-0000-0000-000000000006'
from generate_series(1,11) i on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,created_by)
values('98429999-0000-4000-8000-000000000001','$OTHER_ORG','Foreign candidate','capacity','Foreign tenant candidate must remain isolated.','active','00000000-0000-0000-0000-000000000006')
on conflict(id) do nothing;
insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class)
select ('98421000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$ORG','ci','document',
  'Independent cost benefit timing uncertainty and constraint basis for U11 candidate '||i||'.','DOCUMENTED'
from generate_series(1,11) i on conflict(id) do nothing;
SQL

for i in $(seq 1 11); do
  EVIDENCE=$(printf '98421000-0000-4000-8000-%012d' "$i")
  VERIFIED=$(rpc "$VERIFIER" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent U11 portfolio input review\",\"p_outcome\":\"verified\",\"p_note\":\"Cost, benefit, timing, uncertainty and constraint basis checked for the acceptance fixture.\"}")
  ok "$VERIFIED"
done

IFS=',' read -r -a CATEGORY_LIST <<<"$CATEGORIES"
for i in $(seq 1 11); do
  CASE_ID=$(printf '98420000-0000-4000-8000-%012d' "$i")
  EVIDENCE=$(printf '98421000-0000-4000-8000-%012d' "$i")
  CATEGORY=${CATEGORY_LIST[$((i-1))]}
  COST=$((i*100000)); LOW=$((COST*9/10)); HIGH=$((COST*12/10)); BENEFIT=$((COST*2)); BLOW=$((COST*15/10)); BHIGH=$((COST*25/10))
  MANDATORY=false; BASIS=''
  if [ "$CATEGORY" = regulatory_capital ] || [ "$CATEGORY" = safety_risk ]; then MANDATORY=true; BASIS='Recorded mandatory obligation in the independently verified acceptance evidence.'; fi
  PAYLOAD=$(python3 -c 'import json,sys; i=int(sys.argv[1]); print(json.dumps({"p_candidate":{"developmentCaseId":sys.argv[2],"planYear":int(sys.argv[3]),"category":sys.argv[4],"currency":"CAD","cost":int(sys.argv[5]),"costLow":int(sys.argv[6]),"costHigh":int(sys.argv[7]),"benefit":int(sys.argv[8]),"benefitLow":int(sys.argv[9]),"benefitHigh":int(sys.argv[10]),"benefitProbability":0.75,"riskReductionValue":50000*i,"mandatory":sys.argv[11]=="true","mandatoryBasis":sys.argv[12],"earliestStart":f"{sys.argv[3]}-01-01","latestStart":f"{sys.argv[3]}-12-01","durationMonths":i+2,"evidenceItemId":sys.argv[13],"constraintNote":"Acceptance fixture constraint basis records timing, funding and delivery dependencies."}}))' "$i" "$CASE_ID" "$YEAR" "$CATEGORY" "$COST" "$LOW" "$HIGH" "$BENEFIT" "$BLOW" "$BHIGH" "$MANDATORY" "$BASIS" "$EVIDENCE")
  CONFIGURED=$(rpc "$ASSESSOR" configure_portfolio_candidate "$PAYLOAD")
  ok "$CONFIGURED"
done

FOREIGN=$(rpc "$ASSESSOR" configure_portfolio_candidate "{\"p_candidate\":{\"developmentCaseId\":\"98429999-0000-4000-8000-000000000001\",\"evidenceItemId\":\"98421000-0000-4000-8000-000000000001\",\"planYear\":$YEAR}}")
err "$FOREIGN" 'development case not found in this organization'
WRONG_CURRENCY=$(rpc "$REVIEWER" run_enterprise_portfolio_optimization "{\"p_plan_year\":$YEAR,\"p_budget\":3000000,\"p_currency\":\"USD\"}")
err "$WRONG_CURRENCY" 'every active candidate needs one currency'

RUN=$(rpc "$REVIEWER" run_enterprise_portfolio_optimization "{\"p_plan_year\":$YEAR,\"p_budget\":3000000,\"p_currency\":\"CAD\"}")
ok "$RUN"
RUN_ID=$(BODY="$(body "$RUN")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["candidateCount"]==11;assert len(x["selected"])>0;assert len(x["deferred"])>0;assert x["globallyOptimal"] is False;assert x["operationalAuthorization"] is False;print(x["calculationRunId"])')
PROPOSED=$(rpc "$REVIEWER" propose_enterprise_portfolio_plan "{\"p_calculation_run_id\":\"$RUN_ID\",\"p_rationale\":\"Independent review should decide the budget trade-off, mandatory coverage and uncertainty exposure.\"}")
ok "$PROPOSED"
BODY="$(body "$PROPOSED")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["status"]=="pending_human_review";assert x["fundsCommitted"] is False;assert x["projectsSanctioned"] is False'
DUPLICATE=$(rpc "$REVIEWER" propose_enterprise_portfolio_plan "{\"p_calculation_run_id\":\"$RUN_ID\",\"p_rationale\":\"A duplicate proposal must not create a second recommendation or approval for the same calculation.\"}")
err "$DUPLICATE" 'already has a governed recommendation'
WORKSPACE=$(rpc "$REVIEWER" get_enterprise_portfolio_workspace "{\"p_plan_year\":$YEAR}")
ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert len(x["categories"])==11;assert len(x["candidates"])>=11;assert x["latestRun"]["id"];assert x["latestRun"]["recommendationId"]'

COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(*) from capital_plan_items where organization_id='$ORG' and plan_year=$YEAR and development_case_id is not null),(select count(*) from calculation_runs where organization_id='$ORG' and calculation_key='enterprise_portfolio_optimization'),(select count(*) from recommendations where organization_id='$ORG' and rationale like '%Calculation run: $RUN_ID%'),(select count(*) from approvals a join recommendations r on r.id=a.recommendation_id where r.organization_id='$ORG' and r.rationale like '%Calculation run: $RUN_ID%' and a.status='pending');")
echo "U11 ledger counts candidates|runs|recommendations|approvals=$COUNTS"
test "$COUNTS" = '11|1|1|1'
echo 'U11 enterprise-portfolio smoke passed: categories=11 evidence_verified=true tenant_wall=true uncertainty=true budget=true timing=true immutable_run=true human_final=true'

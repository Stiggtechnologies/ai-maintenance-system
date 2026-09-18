#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D5.10-D5.12 project-assurance smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999924'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
ok(){ test "${1##*$'\n'}" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "${1##*$'\n'}" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'].lower() in x.get('error','').lower(),x"; }

RECORDER=$(token 'admin@syncai.ca' 'Admin123!@#')
VERIFIER=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$RECORDER" && test -n "$VERIFIER"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','D5 reference foreign','utilities') on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,created_by)
select ('98510000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$ORG','Completed reference '||i,'greenfield',
  'Completed comparable project retained for governed reference-class acceptance testing.','completed','00000000-0000-0000-0000-000000000006'
from generate_series(1,10) i on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,created_by) values
('98510000-0000-4000-8000-000000000020','$ORG','Active assurance target','greenfield','Active project requires evidence-based reference-class assurance.','active','00000000-0000-0000-0000-000000000006'),
('98510000-0000-4000-8000-000000000021','$ORG','Thin history target','capacity','Capacity project must refuse a reference-class claim without sufficient history.','active','00000000-0000-0000-0000-000000000006'),
('98510000-0000-4000-8000-000000000022','$ORG','Incomplete outcome candidate','greenfield','An active project cannot be inserted into the completed-project corpus.','active','00000000-0000-0000-0000-000000000006'),
('98519999-0000-4000-8000-000000000001','$OTHER_ORG','Foreign assurance target','greenfield','Another tenant must remain invisible.','active','00000000-0000-0000-0000-000000000006')
on conflict(id) do nothing;
insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class)
select ('98511000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$ORG','ci','document',
  'Independently checked baseline and completed outcome evidence for project assurance fixture '||i||'.','DOCUMENTED'
from generate_series(1,12) i on conflict(id) do nothing;
SQL

for i in $(seq 1 12); do
  EVIDENCE=$(printf '98511000-0000-4000-8000-%012d' "$i")
  VERIFIED=$(rpc "$VERIFIER" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent project outcome review\",\"p_outcome\":\"verified\",\"p_note\":\"Baseline, actual, currency and duration records checked against the acceptance fixture.\"}")
  ok "$VERIFIED"
done

for i in $(seq 1 10); do
  CASE_ID=$(printf '98510000-0000-4000-8000-%012d' "$i")
  EVIDENCE=$(printf '98511000-0000-4000-8000-%012d' "$i")
  ACTUAL_COST=$((900000+i*100000)); ACTUAL_DAYS=$((90+i*10))
  if [ "$i" -le 5 ]; then MATURITY=70; VENDOR=4; DEFECTS=$((14+i)); else MATURITY=90; VENDOR=0; DEFECTS=$((i-4)); fi
  OUTCOME=$(rpc "$RECORDER" record_verified_project_outcome "{\"p_case_id\":\"$CASE_ID\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_outcome\":{\"baselineCost\":1000000,\"actualCost\":$ACTUAL_COST,\"baselineDurationDays\":100,\"actualDurationDays\":$ACTUAL_DAYS,\"currency\":\"CAD\",\"complexityRating\":3,\"geography\":\"Alberta\",\"technologyNoveltyRating\":2,\"executionStrategy\":\"EPCM\",\"engineeringMaturityAtExecutionPct\":$MATURITY,\"unresolvedVendorDataAtGate\":$VENDOR,\"commissioningDefects\":$DEFECTS,\"startupDelayDays\":$i,\"safetyIncidentRate\":0.2,\"startupReliabilityPct\":95,\"engineeringHours\":12000}}")
  ok "$OUTCOME"
done

DUPLICATE=$(rpc "$RECORDER" record_verified_project_outcome '{"p_case_id":"98510000-0000-4000-8000-000000000001","p_evidence_item_id":"98511000-0000-4000-8000-000000000001","p_outcome":{"baselineCost":1,"actualCost":1,"baselineDurationDays":1,"actualDurationDays":1,"currency":"CAD","complexityRating":3,"geography":"Alberta","technologyNoveltyRating":2,"executionStrategy":"EPCM","engineeringMaturityAtExecutionPct":80,"unresolvedVendorDataAtGate":0,"commissioningDefects":0,"startupDelayDays":0,"safetyIncidentRate":0,"startupReliabilityPct":95,"engineeringHours":1}}')
err "$DUPLICATE" 'already has a verified outcome'
INCOMPLETE=$(rpc "$RECORDER" record_verified_project_outcome '{"p_case_id":"98510000-0000-4000-8000-000000000022","p_evidence_item_id":"98511000-0000-4000-8000-000000000012","p_outcome":{"baselineCost":1,"actualCost":1,"baselineDurationDays":1,"actualDurationDays":1,"currency":"CAD","complexityRating":3,"geography":"Alberta","technologyNoveltyRating":2,"executionStrategy":"EPCM","engineeringMaturityAtExecutionPct":80,"unresolvedVendorDataAtGate":0,"commissioningDefects":0,"startupDelayDays":0,"safetyIncidentRate":0,"startupReliabilityPct":95,"engineeringHours":1}}')
err "$INCOMPLETE" 'only a completed project'
FOREIGN=$(rpc "$RECORDER" run_project_assurance_reference_class '{"p_case_id":"98519999-0000-4000-8000-000000000001","p_forecast_cost":1000000,"p_forecast_duration_days":100,"p_currency":"CAD","p_evidence_item_id":"98511000-0000-4000-8000-000000000012","p_profile":{"baselineCost":1000000,"baselineDurationDays":100,"complexityRating":3,"geography":"Alberta","technologyNoveltyRating":2,"executionStrategy":"EPCM"},"p_minimum_sample":5}')
err "$FOREIGN" 'not found in this organization'

RUN=$(rpc "$RECORDER" run_project_assurance_reference_class '{"p_case_id":"98510000-0000-4000-8000-000000000020","p_forecast_cost":1400000,"p_forecast_duration_days":140,"p_currency":"CAD","p_evidence_item_id":"98511000-0000-4000-8000-000000000012","p_profile":{"baselineCost":1000000,"baselineDurationDays":100,"complexityRating":3,"geography":"Alberta","technologyNoveltyRating":2,"executionStrategy":"EPCM"},"p_minimum_sample":1}')
ok "$RUN"
RUN_ID=$(BODY="$(body "$RUN")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["status"]=="computed";assert x["sampleSize"]==10;assert x["minimumSample"]==5;assert x["recommendationOnly"] is True;assert x["operationalAuthorization"] is False;assert x["referenceForecast"]["costP80"]>x["referenceForecast"]["costP50"];assert len(x["assurancePatterns"])==2;assert all(p["associationNotCausation"] for p in x["assurancePatterns"]);assert x["patternRefusals"]==[];assert "Size band, complexity, geography, project class, technology novelty and execution strategy" in x["normalizedBenchmark"]["normalization"];print(x["calculationRunId"])')

THIN=$(rpc "$RECORDER" run_project_assurance_reference_class '{"p_case_id":"98510000-0000-4000-8000-000000000021","p_forecast_cost":2000000,"p_forecast_duration_days":200,"p_currency":"CAD","p_evidence_item_id":"98511000-0000-4000-8000-000000000012","p_profile":{"baselineCost":1000000,"baselineDurationDays":100,"complexityRating":3,"geography":"Alberta","technologyNoveltyRating":2,"executionStrategy":"EPCM"},"p_minimum_sample":5}')
ok "$THIN"
BODY="$(body "$THIN")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["status"]=="refused";assert x["sampleSize"]==0;assert "No pattern" in x["refusals"][0];assert x["operationalAuthorization"] is False'

WORKSPACE=$(rpc "$RECORDER" get_project_assurance_workspace '{}')
ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["minimumSample"]==5;assert len(x["verifiedEvidence"])>=12;ids={c["id"] for c in x["cases"]};assert "98510000-0000-4000-8000-000000000020" in ids;assert "98519999-0000-4000-8000-000000000001" not in ids;assert "named-human decisions" in x["decisionBoundary"]'

DIRECT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 <<SQL || true
insert into learning_events(organization_id,development_case_id,event_type,title,project_baseline_cost,project_actual_cost,project_baseline_duration_days,project_actual_duration_days,project_currency,project_outcome_evidence_id)
values('$ORG','98510000-0000-4000-8000-000000000020','project_outcome','bypass',1,1,1,1,'CAD','98511000-0000-4000-8000-000000000007');
SQL
)
printf '%s' "$DIRECT" | grep -q 'only through record_verified_project_outcome'

COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(*) from learning_events where organization_id='$ORG' and event_type='project_outcome'),(select count(*) from calculation_runs where id='$RUN_ID' and status='computed' and jsonb_array_length(input_refs)=11),(select count(*) from calculation_runs where organization_id='$ORG' and calculation_key='project_assurance_reference_class' and status='refused');")
test "$COUNTS" = '10|1|1'
echo 'D5.10-D5.12 project-assurance smoke passed: outcomes=10 tenant_wall=true evidence=true immutable_outcomes=true thin_history_refused=true predictor_patterns=2 association_not_causation=true normalization_dimensions=6 benchmark_metrics=7 reference_class=true lineage_snapshot=true human_final=true'

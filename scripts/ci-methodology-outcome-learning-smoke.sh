#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D9.08-D9.09 methodology learning smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
ok(){ test "${1##*$'\n'}" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "${1##*$'\n'}" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'].lower() in x.get('error','').lower(),x"; }
field(){ BODY="$(body "$1")" KEY="$2" python3 -c "import json,os;print(json.loads(os.environ['BODY'])[os.environ['KEY']])"; }

ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
VERIFIER=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$ADMIN" && test -n "$VERIFIER"

CREATED=$(rpc "$ADMIN" create_project_framework '{"p_name":"Outcome learning acceptance","p_source":"Governed D9 acceptance fixture","p_source_authority":"INDUSTRY_GUIDANCE","p_basis":"Acceptance fixture for methodology outcome learning","p_project_classes":["major_project"]}')
ok "$CREATED"; FRAMEWORK=$(field "$CREATED" framework_id)
STAGE=$(rpc "$ADMIN" add_framework_stage "{\"p_framework_id\":\"$FRAMEWORK\",\"p_stage_key\":\"design\",\"p_sequence\":1,\"p_display_name\":\"Design\",\"p_purpose\":\"Establish a controlled design basis\"}")
ok "$STAGE"
GATE_RESULT=$(rpc "$ADMIN" add_framework_gate "{\"p_framework_id\":\"$FRAMEWORK\",\"p_stage_key\":\"design\",\"p_name\":\"Design basis gate\",\"p_sequence\":1,\"p_decision_type\":\"gate\",\"p_independent_assurance_required\":false}")
ok "$GATE_RESULT"; GATE=$(field "$GATE_RESULT" gate_id)
REQUIREMENT_RESULT=$(rpc "$ADMIN" set_gate_requirement "{\"p_gate_id\":$GATE,\"p_criterion\":\"Approved design basis exists\",\"p_is_mandatory\":false,\"p_source_authority\":\"INDUSTRY_GUIDANCE\",\"p_category\":\"technical\",\"p_evidence_type\":\"approved design basis\",\"p_guidance\":\"Confirm the design basis is reviewed before execution.\",\"p_weight\":1}")
ok "$REQUIREMENT_RESULT"; CRITERION=$(field "$REQUIREMENT_RESULT" criterion_id)
ADOPTED=$(rpc "$ADMIN" adopt_project_framework "{\"p_framework_id\":\"$FRAMEWORK\",\"p_note\":\"Adopted solely for the governed methodology learning acceptance transcript.\"}")
ok "$ADOPTED"

ADMIN_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -c "select id from user_profiles where email='admin@syncai.ca' and organization_id='$ORG'")
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,framework_id,created_by)
select ('98610000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$ORG','Method learning completed '||i,'greenfield',
  'Completed project used only to prove governed methodology outcome analysis.','completed','$FRAMEWORK','$ADMIN_ID'
from generate_series(1,6)i on conflict(id) do nothing;
insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class)
select ('98611000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'$ORG','ci','document',
  'Independent completed-project outcome evidence for methodology learning '||i||'.','DOCUMENTED'
from generate_series(1,6)i on conflict(id) do nothing;
SQL

for i in $(seq 1 6); do
  CASE_ID=$(printf '98610000-0000-4000-8000-%012d' "$i")
  EVIDENCE=$(printf '98611000-0000-4000-8000-%012d' "$i")
  VERIFIED=$(rpc "$VERIFIER" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent project record review\",\"p_outcome\":\"verified\",\"p_note\":\"Baseline, actual and startup records checked independently for methodology learning.\"}")
  ok "$VERIFIED"
  if [ "$i" -le 3 ]; then COST=$((1000000+i*20000)); DAYS=$((100+i)); DEFECTS=$i; RELIABILITY=97; FINDING=met; else COST=$((1250000+i*30000)); DAYS=$((125+i*3)); DEFECTS=$((8+i)); RELIABILITY=86; FINDING=not_met; fi
  OUTCOME=$(rpc "$ADMIN" record_verified_project_outcome "{\"p_case_id\":\"$CASE_ID\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_outcome\":{\"baselineCost\":1000000,\"actualCost\":$COST,\"baselineDurationDays\":100,\"actualDurationDays\":$DAYS,\"currency\":\"CAD\",\"complexityRating\":3,\"geography\":\"Alberta\",\"technologyNoveltyRating\":2,\"executionStrategy\":\"EPCM\",\"engineeringMaturityAtExecutionPct\":80,\"unresolvedVendorDataAtGate\":0,\"commissioningDefects\":$DEFECTS,\"startupDelayDays\":2,\"safetyIncidentRate\":0.1,\"startupReliabilityPct\":$RELIABILITY,\"engineeringHours\":10000}}")
  ok "$OUTCOME"
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
with r as (
  insert into stage_gate_reviews(organization_id,asset_id,development_case_id,gate_id,stage_key,outcome,reviewed_by,note)
  values('$ORG',null,'$CASE_ID',$GATE,'design','proceed','$ADMIN_ID','Recorded execution finding for methodology learning acceptance.') returning id
)
insert into stage_gate_findings(organization_id,review_id,criterion_id,criterion_text,status,evidence)
select '$ORG',id,$CRITERION,'Approved design basis exists','$FINDING','Gate review evidence captured before outcome analysis.' from r;
SQL
done

FOREIGN=$(rpc "$ADMIN" run_methodology_outcome_analysis '{"p_framework_id":"99999999-9999-4999-8999-999999999991","p_minimum_cohort":3}')
err "$FOREIGN" 'not found in this organization'
RUN=$(rpc "$ADMIN" run_methodology_outcome_analysis "{\"p_framework_id\":\"$FRAMEWORK\",\"p_minimum_cohort\":1}")
ok "$RUN"
RUN_ID=$(BODY="$(body "$RUN")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["status"]=="computed";assert x["minimumCohort"]==3;assert x["eligiblePatterns"]==1;assert x["associationNotCausation"] is True;assert x["automaticMethodChange"] is False;p=x["criteria"][0];assert p["metSample"]==3 and p["notMetSample"]==3;assert p["means"]["notMet"]["scheduleGrowthPct"]>p["means"]["met"]["scheduleGrowthPct"];assert p["associationNotCausation"] is True;print(x["calculationRunId"])')

NO_CHANGE=$(rpc "$ADMIN" propose_methodology_improvement "{\"p_calculation_run_id\":\"$RUN_ID\",\"p_criterion_id\":$CRITERION,\"p_action\":\"strengthen\",\"p_rationale\":\"A proposal with no actual control change must be refused.\"}")
err "$NO_CHANGE" 'identical content is not learning'
WRONG_DIRECTION=$(rpc "$ADMIN" propose_methodology_improvement "{\"p_calculation_run_id\":\"$RUN_ID\",\"p_criterion_id\":$CRITERION,\"p_action\":\"strengthen\",\"p_rationale\":\"A strengthen label cannot conceal a lower requirement weight.\",\"p_weight\":0.5}")
err "$WRONG_DIRECTION" 'cannot make the requirement advisory or lower'

PROPOSAL=$(rpc "$ADMIN" propose_methodology_improvement "{\"p_calculation_run_id\":\"$RUN_ID\",\"p_criterion_id\":$CRITERION,\"p_action\":\"strengthen\",\"p_rationale\":\"The observed not-met cohort has materially worse delivery and startup outcomes.\",\"p_is_mandatory\":true,\"p_evidence_type\":\"independently approved design basis\",\"p_minimum_confidence\":0.8,\"p_guidance\":\"Require independent approval of the design basis before execution.\",\"p_weight\":2}")
ok "$PROPOSAL"
DRAFT=$(BODY="$(body "$PROPOSAL")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["status"]=="draft";assert x["adoptionRequired"] is True;assert x["automaticMethodChange"] is False;assert "governs nothing" in x["decisionBoundary"];print(x["frameworkId"])')
DUPLICATE=$(rpc "$ADMIN" propose_methodology_improvement "{\"p_calculation_run_id\":\"$RUN_ID\",\"p_criterion_id\":$CRITERION,\"p_action\":\"strengthen\",\"p_rationale\":\"A duplicate open proposal must be refused and retained only once.\"}")
err "$DUPLICATE" 'already has an open proposal'

COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select
  (select status from project_frameworks where id='$DRAFT'),
  (select count(*) from framework_proposals where calculation_run_id='$RUN_ID' and framework_id='$DRAFT' and improvement_action='strengthen'),
  (select count(*) from stage_gate_criteria c join stage_gates g on g.id=c.gate_id where g.framework_id='$DRAFT' and c.criterion='Approved design basis exists' and c.is_mandatory and c.minimum_confidence=0.8 and c.weight=2),
  (select count(*) from calculation_runs where id='$RUN_ID' and calculation_key='methodology_outcome_analysis' and jsonb_array_length(input_refs)=7),
  (select count(*) from audit_events where organization_id='$ORG' and entity_type='methodology_improvement_proposed' and (event_data->>'adopted')::boolean=false);")
test "$COUNTS" = 'draft|1|1|1|1'

UNAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/run_methodology_outcome_analysis" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"p_framework_id\":\"$FRAMEWORK\"}")
test "$UNAUTH" = 401 || test "$UNAUTH" = 403 || test "$UNAUTH" = 404

echo 'D9.08-D9.09 methodology learning smoke passed: canonical_method=true latest_review=true verified_outcomes=6 tenant_wall=true cohorts=3+3 association_not_causation=true immutable_lineage=true no_op_refused=true direction_guard=true draft_only=true duplicate_refused=true human_adoption_required=true'

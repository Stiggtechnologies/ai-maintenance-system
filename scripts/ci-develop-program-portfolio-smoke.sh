#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D10 program portfolio smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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
ADMIN_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -c "select id from user_profiles where email='admin@syncai.ca' and organization_id='$ORG'")

OBJECTIVE='98620000-0000-4000-8000-000000000001'
CASE_A='98620000-0000-4000-8000-000000000002'
CASE_B='98620000-0000-4000-8000-000000000003'
EVIDENCE='98620000-0000-4000-8000-000000000004'
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into risk_objectives(id,organization_id,objective_level,description,target,measurement,timeframe,tolerance,status,version,adopted_by,adopted_at,created_by)
values('$OBJECTIVE','$ORG','enterprise','Increase constrained system throughput','6 percent sustained throughput','Percent throughput','Within the program realization window','Do not exceed independently evidenced bottleneck capacity','adopted',1,'$ADMIN_ID',now(),'$ADMIN_ID') on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,created_by)
values('$CASE_A','$ORG','Program power expansion','brownfield','Power capacity is required for the shared throughput outcome.','active','$ADMIN_ID'),
      ('$CASE_B','$ORG','Program crusher expansion','brownfield','Crusher capacity depends on the power expansion.','active','$ADMIN_ID')
on conflict(id) do nothing;
insert into capital_plan_items(organization_id,plan_year,label,cost,development_case_id,portfolio_category,currency,cost_low,cost_high,benefit_low,benefit_high,benefit_probability,risk_reduction_value,earliest_start,latest_start,duration_months,constraint_note,updated_by)
values('$ORG',2027,'Program power expansion',100, '$CASE_A','capacity','CAD',90,110,4,6,0.8,0,'2027-01-01','2027-02-01',8,'Acceptance fixture duration and timing constraint for program critical path.','$ADMIN_ID'),
      ('$ORG',2027,'Program crusher expansion',100,'$CASE_B','capacity','CAD',90,110,4,6,0.8,0,'2027-04-01','2027-05-01',6,'Acceptance fixture duration and timing constraint for program critical path.','$ADMIN_ID')
on conflict(organization_id,development_case_id,plan_year) where development_case_id is not null
do update set duration_months=excluded.duration_months,earliest_start=excluded.earliest_start,latest_start=excluded.latest_start,constraint_note=excluded.constraint_note;
insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class)
values('$EVIDENCE','$ORG','ci','document','Independent bottleneck study and dependency basis for the program portfolio acceptance transcript.','DOCUMENTED')
on conflict(id) do nothing;
SQL

VERIFIED=$(rpc "$VERIFIER" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent program bottleneck study review\",\"p_outcome\":\"verified\",\"p_note\":\"Capacity, project sequence and source records checked independently for the program transcript.\"}")
ok "$VERIFIED"

PROGRAM_RESULT=$(rpc "$ADMIN" create_development_program "{\"p_program\":{\"programCode\":\"SMOKE-D10\",\"title\":\"Mine expansion shared outcome\",\"sharedObjectiveId\":\"$OBJECTIVE\",\"ownerId\":\"$ADMIN_ID\",\"sharedOutcomeLabel\":\"Sustained throughput gain\",\"sharedOutcomeTarget\":6,\"sharedOutcomeUnit\":\"percent\",\"outcomeCapacityLimit\":6,\"outcomeBasis\":\"Independent bottleneck study limits combined program throughput benefit to six percent.\",\"evidenceItemId\":\"$EVIDENCE\",\"targetStart\":\"2027-01-01\",\"targetFinish\":\"2028-03-01\"}}")
ok "$PROGRAM_RESULT"; PROGRAM=$(field "$PROGRAM_RESULT" programId)

for CASE_ID in "$CASE_A" "$CASE_B"; do
  MEMBER=$(rpc "$ADMIN" add_project_to_development_program "{\"p_program_id\":\"$PROGRAM\",\"p_case_id\":\"$CASE_ID\",\"p_contribution_basis\":\"This project contributes a necessary part of the shared constrained throughput outcome.\"}")
  ok "$MEMBER"
  BENEFIT=$(rpc "$ADMIN" record_case_benefit "{\"p_case_id\":\"$CASE_ID\",\"p_label\":\"Claimed throughput contribution\",\"p_expected_value\":5,\"p_unit\":\"percent\",\"p_expected_date\":\"2028-03-01\",\"p_owner_id\":\"$ADMIN_ID\",\"p_basis\":\"Project business case contribution to the shared constrained throughput objective.\",\"p_objective_id\":\"$OBJECTIVE\"}")
  ok "$BENEFIT"
done

DEPENDENCY=$(rpc "$ADMIN" record_development_project_dependency "{\"p_program_id\":\"$PROGRAM\",\"p_predecessor_case_id\":\"$CASE_A\",\"p_successor_case_id\":\"$CASE_B\",\"p_dependency_kind\":\"finish_to_start\",\"p_basis\":\"Crusher energization cannot proceed until the program power expansion is available.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$DEPENDENCY"
CYCLE=$(rpc "$ADMIN" record_development_project_dependency "{\"p_program_id\":\"$PROGRAM\",\"p_predecessor_case_id\":\"$CASE_B\",\"p_successor_case_id\":\"$CASE_A\",\"p_dependency_kind\":\"finish_to_start\",\"p_basis\":\"This deliberately reversed edge must be refused because it creates a cycle.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$CYCLE" 'would create a cycle'

WORKSPACE=$(rpc "$ADMIN" get_development_program_workspace "{\"p_program_id\":\"$PROGRAM\"}")
ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert len(x['projects'])==2,x
assert len(x['dependencies'])==1,x
b=x['benefitIntegrity']
assert b['claimedOutcome']==10,b
assert b['capacityLimit']==6,b
assert b['potentialDoubleCount']==4,b
assert b['constraintAdjustedClaim']==6,b
assert b['programOutcomeAtRisk'] is False,b
assert b['assessable'] is True,b
assert 'potential benefits double counting' in b['interpretation'].lower(),b
assert 'does not pass a gate' in x['decisionBoundary'].lower(),x
PY

FOREIGN=$(rpc "$ADMIN" get_development_program_workspace '{"p_program_id":"99999999-9999-4999-8999-999999999991"}')
err "$FOREIGN" 'not found in this organization'

DIRECT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=0 -c "insert into development_program_projects(program_id,organization_id,development_case_id,contribution_basis,added_by) values('$PROGRAM','99999999-9999-4999-8999-999999999999','$CASE_A','A cross-tenant membership must always be refused by the persistence wall.','$ADMIN_ID');" 2>&1 || true)
grep -qi 'same-tenant program' <<<"$DIRECT"

echo 'D10 program portfolio smoke passed: canonical_projects=true shared_outcome=true tenant_wall=true independent_evidence=true projects=2 dependency=1 cycle_refused=true double_count=4 constraint_adjusted=6 no_automatic_authority=true'

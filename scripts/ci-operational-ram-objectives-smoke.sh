#!/usr/bin/env bash
set -euo pipefail
trap 'echo "C8.02 operational RAM objectives smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ENGINEER_ID='00000000-0000-0000-0000-000000000001'
MANAGER_ID='00000000-0000-0000-0000-000000000003'
RUN_KEY="$(date -u +%s)-$$"

psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -qAt -c "$1"
}

sql_must_fail() {
  local expected="$1" statement="$2" output status
  set +e
  output=$(psqlc "$statement" 2>&1)
  status=$?
  set -e
  test "$status" -ne 0
  case "$output" in
    *"$expected"*) ;;
    *) echo "$output"; false ;;
  esac
}

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}

rpc() {
  curl -sS -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" \
    -H 'content-type: application/json' -d "$3"
}

expect_error() {
  BODY="$1" WANT="$2" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
message=str(x.get('error') or x.get('message') or '') if isinstance(x,dict) else ''
if os.environ['WANT'].lower() not in message.lower():
    print('expected',os.environ['WANT'],'got',x)
    sys.exit(1)
PY
}

ENGINEER=$(token demo@syncai.ca 'Demo123!@#')
MANAGER=$(token manager@syncai.ca 'Manager123!@#')
TECHNICIAN=$(token technician@syncai.ca 'Tech123!@#')
test -n "$ENGINEER" && test -n "$MANAGER" && test -n "$TECHNICIAN"

# The earlier governed Asset Strategy smoke creates the independently adopted
# lifecycle-plan version. This slice consumes that canonical result rather
# than manufacturing a second lifecycle-plan store or bypassing its workflow.
PLAN=$(psqlc "select id from public.asset_lifecycle_plans
  where organization_id='$ORG' order by adopted_at desc,id desc limit 1")
ASSET=$(psqlc "select asset_id from public.asset_lifecycle_plans where id='$PLAN'")
SITE=$(psqlc "select site_id from public.assets where id='$ASSET'")
FOREIGN_ORG=$(psqlc "select id from public.organizations where id<>'$ORG' order by id limit 1")
test -n "$PLAN" && test -n "$ASSET" && test -n "$FOREIGN_ORG"

PROJECT=$(psqlc "insert into public.capital_projects(
  organization_id,site_id,project_code,title,status)
  values('$ORG',nullif('$SITE','')::uuid,'C802-$RUN_KEY',
  'C8.02 operational objective proof','active') returning id")
OBJECTIVE=$(psqlc "insert into public.risk_objectives(
  organization_id,owner_id,objective_level,description,target,measurement,
  timeframe,tolerance,status,version,adopted_by,adopted_at,created_by)
  values('$ORG','$MANAGER_ID','system',
  'Preserve the required cooling-water service through the governed asset lifecycle.',
  'At least 99.5 percent service availability',
  'Availability, MTBF and mean time to restore from approved operating evidence',
  'Five-year lifecycle planning horizon','No silent relaxation of an adopted target',
  'adopted',1,'$MANAGER_ID',now(),'$ENGINEER_ID') returning id")
CASE_ID=$(psqlc "insert into public.development_cases(
  organization_id,title,sponsor_id,business_unit,site_id,lifecycle_type,
  problem_statement,opportunity_statement,objective_id,capital_project_id,
  status,created_by)
  values('$ORG','C8.02 RAM conversion','$MANAGER_ID','Reliability',
  nullif('$SITE','')::uuid,'reliability_improvement',
  'The operational requirement needs explicit measurable reliability, availability and maintainability objectives.',
  'Bind the requirement to evidence and the adopted lifecycle strategy without granting execution authority.',
  '$OBJECTIVE','$PROJECT','active','$ENGINEER_ID') returning id")
EVIDENCE=$(psqlc "insert into public.evidence_items(
  organization_id,asset_id,development_case_id,source_system,evidence_type,
  description,evidence_class,verification_status,verified_by,verified_at,
  verification_method)
  values('$ORG','$ASSET','$CASE_ID','C8.02-SMOKE','operating_history',
  'Verified operating history and restoration observations for the exact installed asset.',
  'MEASURED','verified','$MANAGER_ID',now(),
  'Independent reconciliation to approved operating and maintenance records') returning id")
FOREIGN_EVIDENCE=$(psqlc "insert into public.evidence_items(
  organization_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method)
  values('$FOREIGN_ORG','C8.02-FOREIGN','operating_history',
  'Foreign evidence must never support another tenant RAM objective.',
  'MEASURED','verified','$MANAGER_ID',now(),'Foreign fixture review') returning id")
REQUIREMENT=$(psqlc "insert into public.design_requirements(
  organization_id,project_id,development_case_id,requirement_ref,category,
  requirement,source,verification_method,verification_status,owner_id,
  acceptance_criteria,objective_id,satisfied_by_asset_id,operating_kpi_key,
  created_by)
  values('$ORG','$PROJECT','$CASE_ID','C802-REQ-$RUN_KEY','reliability',
  'The cooling-water train shall deliver its adopted operational service objective through the lifecycle horizon.',
  'operations','analysis','open','$MANAGER_ID',
  'Availability is at least 0.995, demonstrated MTBF is at least 4000 operating hours, and mean time to restore is no more than 8 hours.',
  '$OBJECTIVE','$ASSET','availability','$ENGINEER_ID') returning id")

WORK_BEFORE=$(psqlc "select count(*) from public.work_orders where organization_id='$ORG'")
APPROVALS_BEFORE=$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")
RECOMMENDATIONS_BEFORE=$(psqlc "select count(*) from public.recommendations where organization_id='$ORG'")

payload() {
  local evidence="$1" availability="$2" reliability="$3" maintainability="$4" basis="$5"
  printf '{"p_requirement_id":%s,"p_lifecycle_plan_id":"%s","p_evidence_item_id":"%s","p_system_label":"Cooling-water train A","p_availability_target":%s,"p_reliability_target":%s,"p_reliability_unit":"operating hours between failures","p_maintainability_target":%s,"p_maintainability_unit":"hours","p_maintainability_measure":"mean time to restore service","p_configuration":"series","p_basis":"%s"}' \
    "$REQUIREMENT" "$PLAN" "$evidence" "$availability" "$reliability" "$maintainability" "$basis"
}

TECH_DENIED=$(rpc "$TECHNICIAN" propose_operational_ram_objective \
  "$(payload "$EVIDENCE" 0.995 4000 8 'Named-human engineering values supported by the verified operating record.')")
expect_error "$TECH_DENIED" 'named human'

FOREIGN_DENIED=$(rpc "$ENGINEER" propose_operational_ram_objective \
  "$(payload "$FOREIGN_EVIDENCE" 0.995 4000 8 'Foreign evidence must be rejected before a proposal is retained.')")
expect_error "$FOREIGN_DENIED" 'verified same-tenant evidence'

PROPOSED=$(rpc "$ENGINEER" propose_operational_ram_objective \
  "$(payload "$EVIDENCE" 0.995 4000 8 'Named-human engineering values supported by the verified operating record.')")
FIRST_TARGET=$(BODY="$PROPOSED" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x.get('status')=='proposed' and x.get('revision')==1,x
for key in ('mayChangeWork','mayApprove','mayAcceptRisk','mayCommitSpend','mayChangeOperatingLimits','mayReturnToService'):
    assert x.get(key) is False,(key,x)
print(x['ramTargetId'])
PY
)

PREVIEW=$(rpc "$ENGINEER" get_ram_allocation "{\"p_project_code\":\"C802-$RUN_KEY\"}")
BODY="$PREVIEW" python3 -c "import json,os; assert json.loads(os.environ['BODY'])==[],os.environ['BODY']"

SELF_DENIED=$(rpc "$ENGINEER" review_operational_ram_objective \
  "{\"p_ram_target_id\":$FIRST_TARGET,\"p_decision\":\"verified\",\"p_review_note\":\"The proposer cannot independently verify the same frozen conversion.\"}")
expect_error "$SELF_DENIED" 'independent RAM-objective reviewer'

TECH_REVIEW_DENIED=$(rpc "$TECHNICIAN" review_operational_ram_objective \
  "{\"p_ram_target_id\":$FIRST_TARGET,\"p_decision\":\"verified\",\"p_review_note\":\"Execution-only roles cannot verify the governed RAM objective.\"}")
expect_error "$TECH_REVIEW_DENIED" 'named reliability'

VERIFIED=$(rpc "$MANAGER" review_operational_ram_objective \
  "{\"p_ram_target_id\":$FIRST_TARGET,\"p_decision\":\"verified\",\"p_review_note\":\"Independent review confirms the exact requirement, evidence, values, KPI and lifecycle version.\"}")
BODY="$VERIFIED" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('status')=='verified',x"

test "$(psqlc "select count(*) from public.ram_targets where id='$FIRST_TARGET'
  and organization_id='$ORG' and project_id='$PROJECT' and development_case_id is null
  and asset_id='$ASSET' and source_requirement_id='$REQUIREMENT'
  and objective_id='$OBJECTIVE' and operating_kpi_key='availability'
  and lifecycle_plan_id='$PLAN' and evidence_item_id='$EVIDENCE'
  and target_availability=0.995 and reliability_target=4000
  and maintainability_target=8 and translation_status='verified'
  and proposed_by='$ENGINEER_ID' and reviewed_by='$MANAGER_ID'
  and translation_snapshot#>>'{requirement,id}'='$REQUIREMENT'
  and translation_snapshot#>>'{objective,id}'='$OBJECTIVE'
  and translation_snapshot#>>'{ram,availability,target}'='0.995'
  and translation_snapshot#>>'{lifecycle,id}'='$PLAN'
  and translation_snapshot#>>'{evidence,id}'='$EVIDENCE'")" = '1'

ACTIVE=$(rpc "$ENGINEER" get_ram_allocation "{\"p_project_code\":\"C802-$RUN_KEY\"}")
BODY="$ACTIVE" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert len(x)==1 and x[0]['systemLabel']=='Cooling-water train A' and float(x[0]['targetAvailability'])==0.995,x"
WARRANTY=$(rpc "$ENGINEER" get_case_operational_warranty "{\"p_case_id\":\"$CASE_ID\"}")
BODY="$WARRANTY" TARGET="$FIRST_TARGET" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert all(str(item.get('id')) != os.environ['TARGET'] for item in x.get('warranties',[])),x
PY

# A changed human target is a new frozen revision. Independent verification
# supersedes the old row; the previous evidence chain stays immutable.
REVISION=$(rpc "$ENGINEER" propose_operational_ram_objective \
  "$(payload "$EVIDENCE" 0.996 4250 7.5 'Updated named-human values after review of the latest verified operating record.')")
SECOND_TARGET=$(BODY="$REVISION" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('status')=='proposed' and x.get('revision')==2,x; print(x['ramTargetId'])")
rpc "$MANAGER" review_operational_ram_objective \
  "{\"p_ram_target_id\":$SECOND_TARGET,\"p_decision\":\"verified\",\"p_review_note\":\"Independent review confirms revision two and its complete frozen provenance chain.\"}" >/dev/null
test "$(psqlc "select count(*) from public.ram_targets where id='$FIRST_TARGET' and translation_status='superseded'")" = '1'
test "$(psqlc "select count(*) from public.ram_targets where id='$SECOND_TARGET' and translation_status='verified' and supersedes_target_id='$FIRST_TARGET'")" = '1'

sql_must_fail 'translated RAM targets are changed only through the governed conversion workflow' \
  "update public.ram_targets set target_availability=0.5 where id='$SECOND_TARGET'"
sql_must_fail 'translated RAM targets are retained' \
  "delete from public.ram_targets where id='$SECOND_TARGET'"

WORKSPACE=$(rpc "$ENGINEER" get_operational_requirement_objective_workspace '{}')
BODY="$WORKSPACE" REQUIREMENT_ID="$REQUIREMENT" TARGET_ID="$SECOND_TARGET" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
r=next(item for item in x['requirements'] if str(item['id'])==os.environ['REQUIREMENT_ID'])
t=next(item for item in x['translations'] if str(item['id'])==os.environ['TARGET_ID'])
assert r['eligible'] is True and r['gaps']==[],r
assert t['status']=='verified' and t['revision']==2,t
assert x['authority']['namedHumanProposal'] is True,x
assert x['authority']['independentReview'] is True,x
for key in ('mayChangeWork','mayApprove','mayAcceptRisk','mayCommitSpend','mayChangeOperatingLimits','mayReturnToService'):
    assert x['authority'][key] is False,(key,x)
PY

test "$(psqlc "select count(*) from public.work_orders where organization_id='$ORG'")" = "$WORK_BEFORE"
test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")" = "$APPROVALS_BEFORE"
test "$(psqlc "select count(*) from public.recommendations where organization_id='$ORG'")" = "$RECOMMENDATIONS_BEFORE"
test "$(psqlc "select count(*) from public.audit_events where organization_id='$ORG'
  and entity_type='operational_ram_objective'
  and event_data->>'requirement_id'='$REQUIREMENT'")" = '4'

echo 'Operational RAM objectives smoke passed: canonical_chain=true measurable_ram=true independent_review=true tenant_evidence_wall=true immutable_snapshot=true supersession=true no_operational_authority=true'

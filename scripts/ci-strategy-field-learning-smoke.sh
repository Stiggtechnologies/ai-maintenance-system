#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Strategy field-learning smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C8.10 runtime proof against the clean, fully migrated stack. The preceding
# Asset Strategy smoke establishes one independently reviewed, human-adopted
# lifecycle plan. This script proves that measured CA outcomes can refresh the
# retained assessment for that exact plan version without changing operations.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
PLAN='c1100000-0000-4000-8000-000000000001'
WO_EFFECTIVE='c8100000-0000-4000-8000-000000000001'
WO_INEFFECTIVE='c8100000-0000-4000-8000-000000000002'
WO_RECURRENCE='c8100000-0000-4000-8000-000000000003'
FAILURE_MODE='Age-related rolling-element bearing wear'

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

run_strategy() {
  local token_value="$1"
  curl -sS -w '\n%{http_code}' -X POST \
    "$API_URL/functions/v1/calculation-service" \
    -H "apikey: $ANON_KEY" -H "authorization: Bearer $token_value" \
    -H 'content-type: application/json' \
    -d "{\"action\":\"asset_strategy\",\"planId\":\"$PLAN\"}"
}

start_verification() {
  local work_order="$1" started
  started=$(rpc "$ENGINEER" start_ca_verification \
    "{\"p_work_order_id\":\"$work_order\",\"p_observation_days\":30}")
  STARTED="$started" python3 -c \
    "import json,os; d=json.loads(os.environ['STARTED']); assert d.get('id'),d; print(d['id'])"
}

prepare_verification() {
  local verification="$1" response
  response=$(rpc "$ENGINEER" attest_ca_stage \
    "{\"p_verification_id\":\"$verification\",\"p_stage\":\"physical\",\"p_note\":\"Physical correction independently verified against the completed work package.\"}")
  RESPONSE="$response" python3 -c \
    "import json,os; assert json.loads(os.environ['RESPONSE']).get('stage')=='physical'"
  response=$(rpc "$ENGINEER" attest_ca_stage \
    "{\"p_verification_id\":\"$verification\",\"p_stage\":\"causal\",\"p_note\":\"Recorded maintenance mechanism independently checked against the observed failure cause.\"}")
  RESPONSE="$response" python3 -c \
    "import json,os; assert json.loads(os.environ['RESPONSE']).get('stage')=='causal'"
  response=$(rpc "$ENGINEER" link_ca_strategy_update \
    "{\"p_verification_id\":\"$verification\",\"p_lifecycle_plan_id\":\"$LIFECYCLE_PLAN\",\"p_basis\":\"The independently adopted asset strategy addresses this exact governed bearing-wear failure mode.\"}")
  RESPONSE="$response" python3 -c \
    "import json,os; d=json.loads(os.environ['RESPONSE']); assert d.get('ok') is True and d.get('status')=='observing',d"
}

ENGINEER=$(token demo@syncai.ca 'Demo123!@#')
MANAGER=$(token manager@syncai.ca 'Manager123!@#')
test -n "$ENGINEER" && test -n "$MANAGER"

LIFECYCLE_PLAN=$(psqlc "
  select id from public.asset_lifecycle_plans
  where organization_id='$ORG' and asset_id='$ASSET'
    and maintenance_plan_id='$PLAN'
    and adopted_action='apply_recommended'
    and coalesce((adopted_strategy->>'programmeChanged')::boolean,false)
  order by adopted_at desc limit 1
")
test -n "$LIFECYCLE_PLAN"

insert_completed_work_order() {
  local id="$1" number="$2" title="$3" completed="$4"
  psqlc "
    insert into public.work_orders(
      id,organization_id,asset_id,wo_number,title,status,work_type,
      actual_failure_mode,actual_cause,corrective_action,labor_hours,
      downtime_hours,completed_at,closed_at
    ) values (
      '$id','$ORG','$ASSET','$number','$title','completed','corrective',
      '$FAILURE_MODE','Verified age-related degradation',
      'Replaced the affected component and verified the repair',4,6,
      '$completed'::timestamptz,'$completed'::timestamptz
    ) on conflict(id) do update set
      asset_id=excluded.asset_id,status='completed',work_type='corrective',
      actual_failure_mode=excluded.actual_failure_mode,
      actual_cause=excluded.actual_cause,
      corrective_action=excluded.corrective_action,
      labor_hours=excluded.labor_hours,downtime_hours=excluded.downtime_hours,
      completed_at=excluded.completed_at,closed_at=excluded.closed_at;
  " >/dev/null
}

# First conclude an effective outcome before creating any later recurrence.
insert_completed_work_order "$WO_EFFECTIVE" 'C8.10-EFFECTIVE' \
  'Corrective action with completed observation window' "$(date -u -d '-40 days' '+%Y-%m-%dT%H:%M:%SZ')"
EFFECTIVE_VERIFICATION=$(start_verification "$WO_EFFECTIVE")
prepare_verification "$EFFECTIVE_VERIFICATION"
psqlc "update public.ca_verifications set observation_start=now()-interval '31 days',
  observation_days=30 where id='$EFFECTIVE_VERIFICATION'" >/dev/null
psqlc "select public.evaluate_ca_effectiveness()" >/dev/null
test "$(psqlc "select effectiveness from public.ca_verifications where id='$EFFECTIVE_VERIFICATION'")" = 'effective'

# Then conclude an ineffective outcome from an exact in-window recurrence.
insert_completed_work_order "$WO_INEFFECTIVE" 'C8.10-INEFFECTIVE' \
  'Corrective action later followed by recurrence' "$(date -u -d '-20 days' '+%Y-%m-%dT%H:%M:%SZ')"
INEFFECTIVE_VERIFICATION=$(start_verification "$WO_INEFFECTIVE")
prepare_verification "$INEFFECTIVE_VERIFICATION"
psqlc "update public.ca_verifications set observation_start=now()-interval '10 days',
  observation_days=30 where id='$INEFFECTIVE_VERIFICATION'" >/dev/null
insert_completed_work_order "$WO_RECURRENCE" 'C8.10-RECURRENCE' \
  'Measured recurrence of the governed failure mode' "$(date -u -d '-5 days' '+%Y-%m-%dT%H:%M:%SZ')"
psqlc "select public.evaluate_ca_effectiveness()" >/dev/null
test "$(psqlc "select effectiveness from public.ca_verifications where id='$INEFFECTIVE_VERIFICATION'")" = 'ineffective'

test "$(psqlc "select count(*) from public.learning_events where organization_id='$ORG' and ca_verification_id in ('$EFFECTIVE_VERIFICATION','$INEFFECTIVE_VERIFICATION') and event_type='strategy_field_experience'")" = '2'
test "$(psqlc "select count(*) from public.learning_events where organization_id='$ORG' and ca_verification_id in ('$EFFECTIVE_VERIFICATION','$INEFFECTIVE_VERIFICATION') and verified_value=1")" = '1'
test "$(psqlc "select count(*) from public.learning_events where organization_id='$ORG' and ca_verification_id in ('$EFFECTIVE_VERIFICATION','$INEFFECTIVE_VERIFICATION') and verified_value=0")" = '1'

# Even postgres cannot forge a governed learning row without the internal marker.
sql_must_fail 'corrective-action field-learning events are written only by the measured effectiveness workflow' "
  insert into public.learning_events(
    organization_id,asset_id,event_type,title,detail,verified_value,
    model_confidence,ca_verification_id
  ) values (
    '$ORG','$ASSET','strategy_field_experience','forged','forged',1,100,
    '$EFFECTIVE_VERIFICATION'
  ) on conflict do nothing;
"

PLAN_VERSION_BEFORE=$(psqlc "select version from public.maintenance_plans where id='$PLAN'")
PLAN_INTERVAL_BEFORE=$(psqlc "select interval_value from public.maintenance_plans where id='$PLAN'")
RUN=$(run_strategy "$MANAGER")
RUN_STATUS=${RUN##*$'\n'}
RUN_BODY=${RUN%$'\n'*}
test "$RUN_STATUS" = '200'
ASSESSMENT=$(RUN_BODY="$RUN_BODY" python3 - <<'PY'
import json,os
d=json.loads(os.environ['RUN_BODY'])
a=d['analysis']; f=a['fieldExperience']
assert f['effectiveCount']==1 and f['ineffectiveCount']==1,f
assert f['currentEffectiveCount']==1 and f['currentIneffectiveCount']==1,f
assert f['refreshRequired'] is True and f['revisionRequired'] is True,f
assert a['recommendation']['kind']=='strategy_review',a
for key in ('changesMaintenancePlan','createsWork','acceptsRisk','commitsSpend',
            'changesOperatingLimits','returnsToService'):
    assert d[key] is False,(key,d)
print(d['assessment_id'])
PY
)
test -n "$ASSESSMENT"

test "$(psqlc "select count(*) from public.asset_strategy_assessment_learning_sources where organization_id='$ORG' and assessment_id='$ASSESSMENT'")" = '2'
test "$(psqlc "select count(distinct learning_event_id) from public.asset_strategy_assessment_learning_sources where organization_id='$ORG' and assessment_id='$ASSESSMENT'")" = '2'
test "$(psqlc "select version from public.maintenance_plans where id='$PLAN'")" = "$PLAN_VERSION_BEFORE"
test "$(psqlc "select interval_value from public.maintenance_plans where id='$PLAN'")" = "$PLAN_INTERVAL_BEFORE"

WORKSPACE=$(rpc "$MANAGER" get_asset_strategy_workspace_v2 '{}')
WORKSPACE="$WORKSPACE" PLAN="$PLAN" python3 - <<'PY'
import json,os
d=json.loads(os.environ['WORKSPACE'])
s=next(x['state'] for x in d['learning'] if x['planId']==os.environ['PLAN'])
assert len(s['eventIds'])==2,s
assert s['refreshRequired'] is False,s
assert s['revisionRequired'] is True,s
assert s['currentIneffectiveCount']==1,s
b=d['learningBoundary']
assert b['refreshesAssessment'] is True
assert b['requiresIndependentReviewAndHumanAdoption'] is True
for key in ('changesMaintenancePlan','createsWork','acceptsRisk','commitsSpend',
            'changesOperatingLimits','returnsToService'):
    assert b[key] is False,(key,b)
PY

sql_must_fail 'asset-strategy field-learning provenance is immutable' "
  update public.asset_strategy_assessment_learning_sources
  set source_snapshot=source_snapshot||'{\"forged\":true}'::jsonb
  where assessment_id='$ASSESSMENT';
"

# Browser credentials cannot bypass the v2 complete-source-set receipt.
DIRECT=$(curl -sS -o /tmp/c810-direct.txt -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/record_asset_strategy_run" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $MANAGER" \
  -H 'content-type: application/json' -d '{}')
case "$DIRECT" in 401|403|404) ;; *) false ;; esac

# A later named-human context revision creates a new maintenance-plan version.
# The outcomes remain auditable history, but no longer invalidate the new
# version or repeatedly demand another refresh.
CONTEXT=$(rpc "$ENGINEER" record_asset_strategy_context \
  "{\"p_plan_id\":\"$PLAN\",\"p_component_scope\":\"C110 governed wear-out bearing\",\"p_failure_mode\":\"$FAILURE_MODE\",\"p_strategy_kind\":\"time_based_pm\",\"p_planned_task_cost_usd\":1000,\"p_failure_consequence_cost_usd\":10000,\"p_cost_basis\":\"CI-approved labour, material, downtime and failure consequence estimate.\",\"p_safety_critical\":false,\"p_regulatory_required\":false,\"p_lifecycle_objective\":\"Minimize governed whole-life cost while retaining human authority over the PM programme.\"}")
CONTEXT="$CONTEXT" python3 -c \
  "import json,os; assert json.loads(os.environ['CONTEXT']).get('status')=='recorded'"
test "$(psqlc "select version from public.maintenance_plans where id='$PLAN'")" = "$((PLAN_VERSION_BEFORE+1))"

WORKSPACE=$(rpc "$MANAGER" get_asset_strategy_workspace_v2 '{}')
WORKSPACE="$WORKSPACE" PLAN="$PLAN" python3 - <<'PY'
import json,os
d=json.loads(os.environ['WORKSPACE'])
s=next(x['state'] for x in d['learning'] if x['planId']==os.environ['PLAN'])
assert len(s['eventIds'])==2,s
assert s['ineffectiveCount']==1,s
assert s['currentIneffectiveCount']==0,s
assert s['revisionRequired'] is False,s
assert s['refreshRequired'] is False,s
assert all(x['appliesToCurrentPlanVersion'] is False for x in s['events']),s
PY

echo 'Strategy field-learning smoke passed: canonical_learning_event=true exact_source_set=true current_version_recurrence=true historical_version_boundary=true tenant_wall=true immutable_provenance=true no_automatic_programme_change=true'

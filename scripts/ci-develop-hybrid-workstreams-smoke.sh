#!/usr/bin/env bash
# D1.03 — live per-workstream Hybrid Development transcript.
set -euo pipefail
trap 'echo "Hybrid-workstream smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"
ORG='11111111-1111-1111-1111-111111111111'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
expect_ok(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if not isinstance(x,dict) or x.get('error') or not x.get('workstream_id'):
    print('expected persisted workstream, got:',x); sys.exit(1)
PY
}
expect_error(){ BODY="$1" NEEDLE="$2" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY']); e=str(x.get('error','')) if isinstance(x,dict) else ''
if os.environ['NEEDLE'].lower() not in e.lower():
    print('expected refusal containing',os.environ['NEEDLE'],'got',x); sys.exit(1)
PY
}

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
test -n "$PLANNER"
CASE=$(psqlc "select id from development_cases where organization_id='$ORG' order by created_at limit 1")
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
test -n "$CASE"; test -n "$PLANNER_ID"

# Unknown methods refuse rather than silently collapsing to a default.
BAD=$(rpc "$PLANNER" record_development_workstream "{\"p_case_id\":\"$CASE\",\"p_workstream_code\":\"BAD\",\"p_title\":\"Bad method\",\"p_development_approach\":\"waterfall-ish\",\"p_approach_rationale\":\"This deliberately names an unsupported method.\"}")
expect_error "$BAD" 'predictive, adaptive, iterative or hybrid'

# Two workstreams in ONE case deliberately use different approaches.
CIVIL=$(rpc "$PLANNER" record_development_workstream "{\"p_case_id\":\"$CASE\",\"p_workstream_code\":\"HYB-CIVIL\",\"p_title\":\"Civil construction\",\"p_development_approach\":\"predictive\",\"p_approach_rationale\":\"Defined physical scope is sequenced against an approved construction plan.\",\"p_owner_id\":\"$PLANNER_ID\",\"p_planning_horizon_days\":90,\"p_review_cadence_days\":14}")
expect_ok "$CIVIL"
DIGITAL=$(rpc "$PLANNER" record_development_workstream "{\"p_case_id\":\"$CASE\",\"p_workstream_code\":\"HYB-DIGITAL\",\"p_title\":\"Operator experience\",\"p_development_approach\":\"adaptive\",\"p_approach_rationale\":\"Operator feedback must reshape the experience through short learning cycles.\",\"p_owner_id\":\"$PLANNER_ID\",\"p_planning_horizon_days\":30,\"p_review_cadence_days\":7}")
expect_ok "$DIGITAL"

STATE=$(rpc "$PLANNER" get_case_development_workstreams "{\"p_case_id\":\"$CASE\"}")
BODY="$STATE" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY']); methods={w['developmentApproach'] for w in x.get('workstreams',[])}
if not x.get('isHybridCase') or x.get('distinctApproaches',0)<2 or not {'predictive','adaptive'} <= methods:
    print('expected a mixed-method case with both workstreams, got:',x); sys.exit(1)
PY

# Direct client writes are refused; the human/audit RPC is the only door.
DIRECT=$(curl -sS -X POST "$API_URL/rest/v1/development_workstreams" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLANNER" -H 'Content-Type: application/json' -d "{\"organization_id\":\"$ORG\",\"development_case_id\":\"$CASE\",\"workstream_code\":\"BYPASS\",\"title\":\"Bypass attempt\",\"development_approach\":\"predictive\",\"approach_rationale\":\"This direct client write must not be admitted.\",\"adopted_by\":\"$PLANNER_ID\"}")
BODY="$DIRECT" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if not isinstance(x,dict) or not (x.get('code') or x.get('message')):
    print('expected direct write refusal, got:',x); sys.exit(1)
PY

AUDIT=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='development_workstream' and event_data->>'case_id'='$CASE'")
test "$AUDIT" -ge 2
echo "Hybrid-workstream smoke passed: case=$CASE approaches=predictive,adaptive audit_rows=$AUDIT"

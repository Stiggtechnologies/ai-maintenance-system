#!/usr/bin/env bash
# D11.14 live acceptance: a descendant case executes one adopted ancestor
# framework directly. No copied definition rows; child-owned evidence/reviews.
set -euo pipefail

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ROOT='11111111-1111-1111-1111-111111111111'
CHILD='70101110-0000-4000-8000-000000000001'
FOREIGN='70101090-0000-4000-8000-000000000001'

field(){ python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$1'); print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))"; }
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and (x.get('error') or x.get('message')):
    print('unexpected error:',x); sys.exit(1)
PY
}
expect_err(){ BODY="$1" NEEDLE="$2" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
err=(x.get('error') if isinstance(x,dict) else None) or (x.get('message') if isinstance(x,dict) else None) or ''
if os.environ['NEEDLE'].lower() not in str(err).lower():
    print('expected refusal containing %r, got: %s' % (os.environ['NEEDLE'], x)); sys.exit(1)
PY
}
token(){ local r; r=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$r"|python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }

PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ROOT' and email='planner@syncai.ca'")
MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ROOT' and email='manager@syncai.ca'")
ORIGINAL_PROFILE=$(psqlc "select coalesce(governance_profile_id::text,'') from organizations where id='$ROOT'")
FOREIGN_FW=$(psqlc "select id from project_frameworks where organization_id='$FOREIGN' order by name limit 1")
FOREIGN_STATUS=$(psqlc "select status from project_frameworks where id='$FOREIGN_FW'")
test -n "$PLANNER_ID"; test -n "$MANAGER_ID"

cleanup(){
  psqlc "update user_profiles set organization_id='$ROOT' where id in ('$PLANNER_ID','$MANAGER_ID');" >/dev/null 2>&1 || true
  psqlc "delete from organizations where id='$CHILD';" >/dev/null 2>&1 || true
  if [ -n "$ORIGINAL_PROFILE" ]; then
    psqlc "update organizations set governance_profile_id='$ORIGINAL_PROFILE' where id='$ROOT';" >/dev/null 2>&1 || true
  else
    psqlc "update organizations set governance_profile_id=null where id='$ROOT';" >/dev/null 2>&1 || true
  fi
  if [ -n "$FOREIGN_FW" ] && [ -n "$FOREIGN_STATUS" ]; then
    psqlc "update project_frameworks set status='$FOREIGN_STATUS' where id='$FOREIGN_FW';" >/dev/null 2>&1 || true
  fi
}
trap 'rc=$?; cleanup; if [ $rc -ne 0 ]; then echo "Cross-node governance smoke FAILED at line $LINENO"; fi; exit $rc' EXIT

cleanup
psqlc "delete from organizations where id='$CHILD';" >/dev/null

FW=$(psqlc "select id from project_frameworks where organization_id='$ROOT' and status='adopted' and exists (select 1 from project_framework_stages s where s.framework_id=project_frameworks.id) order by name limit 1")
test -n "$FW"
STAGE=$(psqlc "select stage_key from project_framework_stages where framework_id='$FW' order by sequence limit 1")
GATES=$(psqlc "select string_agg(id::text,',') from stage_gates where framework_id='$FW' and stage_key='$STAGE' and exists (select 1 from stage_gate_criteria c where c.gate_id=stage_gates.id and c.is_mandatory)")
test -n "$GATES"

psqlc "update organizations set governance_profile_id='$FW' where id='$ROOT';" >/dev/null
psqlc "insert into organizations(id,name,industry,org_level,parent_id) values('$CHILD','SMOKE Cross-Node Operating Site','industrial','site','$ROOT');" >/dev/null
psqlc "update user_profiles set organization_id='$CHILD' where id in ('$PLANNER_ID','$MANAGER_ID');" >/dev/null

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
test -n "$PLANNER"; test -n "$MANAGER"

echo '— 1. adopted ancestor definitions are readable; sibling/foreign adopted framework is invisible —'
VISIBLE=$(curl -sS "$API_URL/rest/v1/project_frameworks?id=eq.$FW&select=id,organization_id,status" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLANNER")
BODY="$VISIBLE" ROOT="$ROOT" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); assert len(x)==1, x
assert x[0]['organization_id']==os.environ['ROOT'] and x[0]['status']=='adopted', x
PY
test -n "$FOREIGN_FW"
psqlc "update project_frameworks set status='adopted' where id='$FOREIGN_FW';" >/dev/null
HIDDEN=$(curl -sS "$API_URL/rest/v1/project_frameworks?id=eq.$FOREIGN_FW&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLANNER")
test "$HIDDEN" = '[]'

echo '— 2. descendant case inherits the exact ancestor framework; explicit foreign selection is refused —'
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE Cross-Node Governed Case","p_problem_statement":"A descendant operating site requires the enterprise framework without copying its definitions.","p_lifecycle_type":"sustaining_capital"}')
noerr "$R"; CASE=$(printf '%s' "$R"|field case_id); test -n "$CASE"
test "$(printf '%s' "$R"|field framework_id)" = "$FW"
test "$(printf '%s' "$R"|field framework_inherited_from)" = "$ROOT"
test "$(psqlc "select organization_id from development_cases where id='$CASE'")" = "$CHILD"
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE Foreign Framework Refusal\",\"p_problem_statement\":\"A foreign framework must never cross the tenant or ancestry boundary.\",\"p_lifecycle_type\":\"sustaining_capital\",\"p_framework_id\":\"$FOREIGN_FW\"}")
expect_err "$R" 'not found'

echo '— 3. readiness, evidence binding and human review operate the ancestor definition —'
FIRST_GATE=${GATES%%,*}
CRITERION=$(psqlc "select id from stage_gate_criteria where gate_id=$FIRST_GATE and is_mandatory order by sort_order,id limit 1")
R=$(rpc "$PLANNER" get_gate_review_pack "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$FIRST_GATE}")
noerr "$R"
R=$(rpc "$PLANNER" create_case_deliverable "{\"p_case_id\":\"$CASE\",\"p_title\":\"SMOKE Cross-Node Evidence Pack\",\"p_type\":\"report\",\"p_owner_id\":\"$PLANNER_ID\",\"p_requirement_id\":$CRITERION}")
noerr "$R"

IFS=',' read -r -a GATE_IDS <<< "$GATES"
for GATE in "${GATE_IDS[@]}"; do
  FINDINGS=$(psqlc "select coalesce(jsonb_agg(jsonb_build_object('criterion_text',criterion,'status','met','evidence','Verified by the human cross-node acceptance transcript.') order by sort_order,id),'[]'::jsonb)::text from stage_gate_criteria where gate_id=$GATE")
  R=$(rpc "$MANAGER" open_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$GATE}")
  noerr "$R"; SESSION=$(printf '%s' "$R"|field session_id); test -n "$SESSION"
  R=$(rpc "$MANAGER" record_gate_review_outcome "{\"p_session_id\":$SESSION,\"p_outcome\":\"proceed\",\"p_note\":\"Human reviewer accepted the ancestor-defined gate for this descendant-owned case.\",\"p_findings\":$FINDINGS}")
  noerr "$R"
done
test "$(psqlc "select count(*) from stage_gate_reviews where development_case_id='$CASE' and organization_id='$CHILD'")" = "${#GATE_IDS[@]}"
test "$(psqlc "select count(*) from stage_gate_reviews r join stage_gates g on g.id=r.gate_id where r.development_case_id='$CASE' and r.organization_id='$CHILD' and g.organization_id='$ROOT'")" = "${#GATE_IDS[@]}"

echo '— 4. the descendant advances under the ancestor gate, with its own audit trail —'
NEXT=$(psqlc "select stage_key from project_framework_stages where framework_id='$FW' and sequence>(select sequence from project_framework_stages where framework_id='$FW' and stage_key='$STAGE') order by sequence limit 1")
test -n "$NEXT"
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE\",\"p_to_stage_key\":\"$NEXT\",\"p_reason\":\"All ancestor-defined gates were accepted by a descendant human reviewer.\"}")
noerr "$R"
test "$(psqlc "select current_stage_key from development_cases where id='$CASE'")" = "$NEXT"
test "$(psqlc "select count(*) from audit_events where organization_id='$CHILD' and event_data->>'case_id'='$CASE'")" -ge 3

echo 'Cross-node governance execution smoke passed.'

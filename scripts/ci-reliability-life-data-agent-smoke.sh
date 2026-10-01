#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Reliability life-data agent smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C1.03 / C7.01 runtime proof against a clean, fully migrated local stack.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
COMPONENT='CI governed life-data bearing'

psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -qAt -c "$1"
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

ENGINEER=$(token demo@syncai.ca 'Demo123!@#')
MANAGER=$(token manager@syncai.ca 'Manager123!@#')
test -n "$ENGINEER" && test -n "$MANAGER"

# Make local reruns deterministic without touching retained reports. Reports
# freeze a JSON source snapshot rather than owning the source event rows.
psqlc "delete from public.component_life_events where organization_id='$ORG' and component='$COMPONENT';" >/dev/null

PROFILE=$(psqlc "select p.id from public.agent_control_profiles p join public.ai_agents a on a.id=p.agent_id where a.organization_id='$ORG' and a.key='reliability_engineering' and p.status='adopted'")
test -n "$PROFILE"
test "$(psqlc "select count(*) from public.agent_tool_bindings b join public.agent_software_tools t on t.id=b.tool_id where b.profile_id='$PROFILE' and t.tool_key='analyse_censored_life_data'")" = '1'
test "$(psqlc "select count(*) from public.agent_decision_right_bindings b join public.decision_rights d on d.id=b.decision_right_id where b.profile_id='$PROFILE' and d.right_key='recommend_inspection_review'")" = '1'
test "$(psqlc "select operating_charter ?& array['purpose','inputs','outputs','guardrails','routes'] from public.ai_agents where organization_id='$ORG' and key='reliability_engineering' limit 1")" = 't'

record_event() {
  local hours="$1" kind="$2" basis="$3"
  rpc "$ENGINEER" record_component_life_event \
    "{\"p_asset_id\":\"$ASSET\",\"p_component\":\"$COMPONENT\",\"p_hours_at_change_out\":$hours,\"p_event_kind\":\"$kind\",\"p_event_date\":\"2026-09-29\",\"p_planned_interval_hours\":1700,\"p_symptom\":\"CI verified removal observation\",\"p_work_order_ref\":\"CI-LIFE-$hours\",\"p_source_file\":\"CI meter export\",\"p_source_basis\":\"Verified against CI meter and removal record $hours\"}"
}

for spec in '1000 failure failed' '1400 failure failed' \
  '1600 scheduled working' '1800 scheduled working' '1200 other excluded'; do
  set -- $spec
  RECORDED=$(record_event "$1" "$2" "$3")
  RECORDED="$RECORDED" python3 - <<'PY'
import json, os
x=json.loads(os.environ['RECORDED'])
assert x.get('event_id'), x
if x['event_kind']=='scheduled': assert x['classification']=='right_censored', x
PY
done

# A maintenance manager cannot impersonate the engineering role.
DENIED=$(curl -sS -o /tmp/reliability-life-denied.txt -w '%{http_code}' -X POST \
  "$API_URL/functions/v1/calculation-service" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $MANAGER" \
  -H 'content-type: application/json' \
  -d "{\"action\":\"reliability_life_data\",\"component\":\"$COMPONENT\"}")
if [ "$DENIED" != '403' ]; then
  echo "Reliability role refusal returned HTTP $DENIED; response body follows:" >&2
  sed -n '1,20p' /tmp/reliability-life-denied.txt >&2 || true
fi
test "$DENIED" = '403'
grep -qi 'named same-tenant reliability engineer' /tmp/reliability-life-denied.txt

BEFORE_APPROVALS=$(psqlc "select count(*) from public.approvals where organization_id='$ORG';")
RESPONSE=$(curl -sS -w '\n%{http_code}' -X POST \
  "$API_URL/functions/v1/calculation-service" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' \
  -d "{\"action\":\"reliability_life_data\",\"component\":\"$COMPONENT\"}")
STATUS=${RESPONSE##*$'\n'}
BODY=${RESPONSE%$'\n'*}
test "$STATUS" = '200'

IDS=$(BODY="$BODY" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
m=x['method_selection']
assert m['method']=='mle_censored', x
assert m['failures']==2 and m['suspensions']==2, x
assert abs(m['suspendedFraction']-0.5)<1e-9, x
assert m['beta']>0 and m['eta']>0, x
assert len(x['source_event_ids'])==5, x
for key in ('may_change_pm_interval','may_create_work','may_approve_strategy',
            'may_accept_risk','may_commit_spend','may_return_to_service'):
    assert x[key] is False, (key,x)
print(x['report_id']+'|'+x['run_id'])
PY
)
REPORT=${IDS%%|*}
RUN=${IDS##*|}

test "$(psqlc "select count(*) from public.agent_runs where id='$RUN' and organization_id='$ORG' and component_scope='$COMPONENT' and retained_for_governance and status='completed' and confidence=80")" = '1'
test "$(psqlc "select count(*) from public.reliability_life_data_reports where id='$REPORT' and organization_id='$ORG' and cardinality(source_event_ids)=5 and method_selection->>'method'='mle_censored'")" = '1'
test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG';")" = "$BEFORE_APPROVALS"

# Browser credentials cannot forge or rewrite the retained report.
DIRECT_RECORD=$(curl -sS -o /tmp/reliability-life-direct.txt -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/record_reliability_life_data_run" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -d '{}')
case "$DIRECT_RECORD" in 401|403|404) ;; *) false ;; esac

PATCH_STATUS=$(curl -sS -o /tmp/reliability-life-patch.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/reliability_life_data_reports?id=eq.$REPORT" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"component":"forged"}')
case "$PATCH_STATUS" in
  401|403) ;;
  200) test "$(cat /tmp/reliability-life-patch.txt)" = '[]' ;;
  *) false ;;
esac
test "$(psqlc "select component from public.reliability_life_data_reports where id='$REPORT'")" = "$COMPONENT"

echo 'Reliability life-data agent smoke passed: censored_method=true complete_source_set=true distinct_failure_guard=true immutable_report=true role_gate=true tenant_wall=true retained_lineage=true no_execution_authority=true'

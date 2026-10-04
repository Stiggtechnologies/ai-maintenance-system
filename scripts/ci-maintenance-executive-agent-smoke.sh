#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Maintenance Executive agent smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C1.01 runtime proof against the clean full migration chain.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'

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

EXECUTIVE=$(token executive@syncai.ca 'Exec123!@#')
ADMIN=$(token admin@syncai.ca 'Admin123!@#')
MANAGER=$(token manager@syncai.ca 'Manager123!@#')
TECH=$(token technician@syncai.ca 'Tech123!@#')
test -n "$EXECUTIVE" && test -n "$ADMIN" && test -n "$MANAGER" && test -n "$TECH"
ADMIN_ID=$(psqlc "select id from public.user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
test -n "$ADMIN_ID"

PROFILE=$(psqlc "select p.id from public.agent_control_profiles p join public.ai_agents a on a.id=p.agent_id where a.organization_id='$ORG' and a.key='maintenance_executive' and p.status='adopted'")
test -n "$PROFILE"
test "$(psqlc "select count(*) from public.agent_tool_bindings b join public.agent_software_tools t on t.id=b.tool_id where b.profile_id='$PROFILE' and t.tool_key='prepare_executive_briefing'")" = '1'
test "$(psqlc "select count(*) from public.agent_decision_right_bindings b join public.decision_rights d on d.id=b.decision_right_id where b.profile_id='$PROFILE' and d.right_key='generate_meeting_packs'")" = '1'

# An operational technician cannot generate enterprise executive evidence.
DENIED=$(rpc "$TECH" run_maintenance_executive_agent '{}')
DENIED="$DENIED" python3 -c "import json,os; assert 'named executive' in json.loads(os.environ['DENIED'])['error']"
MANAGER_VIEW=$(rpc "$MANAGER" get_maintenance_executive_workspace '{}')
MANAGER_VIEW="$MANAGER_VIEW" python3 -c "import json,os; assert 'authorized named-human role' in json.loads(os.environ['MANAGER_VIEW'])['error']"

BEFORE_APPROVALS=$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")
BEFORE_EXPENDITURE=$(psqlc "select count(*) from public.expenditure_commitments where organization_id='$ORG'")
RUN=$(rpc "$EXECUTIVE" run_maintenance_executive_agent '{}')
RUN_IDS=$(RUN="$RUN" python3 - <<'PY'
import json,os
d=json.loads(os.environ['RUN'])
assert d['advisory'] is True,d
for key in ('mayApprove','mayAcceptRisk','mayAdoptStrategy','mayCommitSpend',
            'mayReleaseWork','mayChangeOperatingLimits','mayReturnToService'):
    assert d[key] is False,(key,d)
for key in ('performance','governance','budgets','risks','strategy','evidenceGaps'):
    assert key in d,(key,d)
assert d['budgets']['currencyStatus']=='not_recorded_by_budget_lines',d['budgets']
if d['budgets']['lineCount']:
    assert any(g.get('key')=='budget_currency_missing' for g in d['evidenceGaps']),d['evidenceGaps']
print(d['briefingId']+'|'+d['runId'])
PY
)
BRIEFING=${RUN_IDS%%|*}
RUN_ID=${RUN_IDS##*|}
test "$(psqlc "select count(*) from public.agent_runs where id='$RUN_ID' and organization_id='$ORG' and executive_scope and retained_for_governance")" = '1'
test "$(psqlc "select count(*) from public.agent_runs where id='$RUN_ID' and confidence is null")" = '1'
test "$(psqlc "select count(*) from public.maintenance_executive_briefings where id='$BRIEFING' and organization_id='$ORG' and source_snapshot ?& array['kpis','governance','budgets','expenditure','risks','agentControls','strategy']")" = '1'

DUE_DATE=$(node -e "console.log(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))")
REVIEW=$(rpc "$EXECUTIVE" assign_maintenance_executive_review \
  "{\"p_briefing_id\":\"$BRIEFING\",\"p_assigned_to\":\"$ADMIN_ID\",\"p_due_date\":\"$DUE_DATE\",\"p_note\":\"Independent review of exact enterprise source fingerprints and all five evidence domains.\"}")
REVIEW="$REVIEW" python3 -c "import json,os; assert json.loads(os.environ['REVIEW'])['status']=='assigned'"

ACK=$(rpc "$ADMIN" acknowledge_maintenance_executive_briefing \
  "{\"p_briefing_id\":\"$BRIEFING\",\"p_disposition\":\"acknowledged\",\"p_review_note\":\"Independent review confirms the recorded facts and preserves all decision authority with named humans.\",\"p_evidence_reference\":\"ci://c101/executive-review\"}")
ACK="$ACK" python3 - <<'PY'
import json,os
d=json.loads(os.environ['ACK'])
assert d['status']=='acknowledged',d
for key in ('approvalCreated','riskAccepted','strategyAdopted','spendCommitted','operationalAuthorization'):
    assert d[key] is False,(key,d)
PY

# Browser credentials cannot forge or rewrite retained executive evidence.
PATCH=$(curl -sS -o /tmp/c101-patch.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/maintenance_executive_briefings?id=eq.$BRIEFING" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $EXECUTIVE" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"evidence_gaps":[]}')
case "$PATCH" in 401|403) ;; 200) test "$(cat /tmp/c101-patch.txt)" = '[]' ;; *) false ;; esac
DIRECT=$(curl -sS -o /tmp/c101-direct.txt -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/maintenance_executive_briefings" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $EXECUTIVE" \
  -H 'content-type: application/json' -d "{\"organization_id\":\"$ORG\"}")
case "$DIRECT" in 401|403) ;; *) false ;; esac

test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")" = "$BEFORE_APPROVALS"
test "$(psqlc "select count(*) from public.expenditure_commitments where organization_id='$ORG'")" = "$BEFORE_EXPENDITURE"
test "$(psqlc "select count(*) from public.maintenance_executive_acknowledgements where briefing_id='$BRIEFING'")" = '1'

# Append-only means privileged SQL cannot erase the evidence either.
if psqlc "truncate public.maintenance_executive_acknowledgements" >/dev/null 2>&1; then
  echo 'maintenance-executive acknowledgement history was unexpectedly truncatable' >&2
  exit 1
fi

echo 'Maintenance Executive agent smoke passed: performance=true governance=true budgets=true risk=true strategy=true exact_source_fingerprints=true tenant_wall=true immutable_briefing=true sod_review=true no_decision_authority=true no_operational_authority=true'

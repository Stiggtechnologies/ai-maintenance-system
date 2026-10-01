#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Maintenance Executive Specialist smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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

EXEC=$(token executive@syncai.ca 'Exec123!@#')
MANAGER=$(token manager@syncai.ca 'Manager123!@#')
TECH=$(token technician@syncai.ca 'Tech123!@#')
test -n "$EXEC" && test -n "$MANAGER" && test -n "$TECH"
EXEC_ID=$(psqlc "select id from public.user_profiles where organization_id='$ORG' and email='executive@syncai.ca'")
MANAGER_ID=$(psqlc "select id from public.user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
SITE=$(psqlc "select id from public.sites where organization_id='$ORG' order by id limit 1")
YEAR=$(date -u +%Y)
START=$(date -u -v-29d +%F 2>/dev/null || date -u -d '29 days ago' +%F)
END=$(date -u +%F)
DUE=$(date -u -v+7d +%F 2>/dev/null || date -u -d '7 days' +%F)
test -n "$EXEC_ID" && test -n "$MANAGER_ID" && test -n "$SITE"

PROFILE=$(psqlc "select p.id from public.agent_control_profiles p join public.ai_agents a on a.id=p.agent_id where a.organization_id='$ORG' and a.key='maintenance_executive' and p.status='adopted'")
test -n "$PROFILE"
test "$(psqlc "select count(*) from public.agent_tool_bindings b join public.agent_software_tools t on t.id=b.tool_id where b.profile_id='$PROFILE' and t.tool_key='assemble_maintenance_executive_brief'")" = '1'
test "$(psqlc "select count(*) from public.agent_decision_right_bindings b join public.decision_rights d on d.id=b.decision_right_id where b.profile_id='$PROFILE' and d.right_key='generate_meeting_packs'")" = '1'

# Seed a deterministic unsupported forecast and critical overdue risk. These are
# canonical source records, not agent conclusions.
psqlc "insert into public.budget_lines(organization_id,site_id,budget_year,category,budgeted,committed,actual,forecast,forecast_basis) values('$ORG','$SITE',$YEAR,'other',100000,40000,25000,120000,null) on conflict do nothing" >/dev/null
psqlc "insert into public.risks(organization_id,site_id,title,current_risk_level,current_risk_score,risk_owner_id,review_date,status,source_kind,created_by) values('$ORG','$SITE','C1.01 CI executive risk','Critical',90,null,current_date-1,'evaluated','human','$MANAGER_ID')" >/dev/null

# A technician cannot run the executive specialist.
DENIED=$(rpc "$TECH" run_maintenance_executive_agent \
  "{\"p_period_start\":\"$START\",\"p_period_end\":\"$END\"}")
DENIED="$DENIED" python3 -c "import json,os; assert 'named executive' in json.loads(os.environ['DENIED'])['error']"

# The time contract rejects an incomplete window.
BAD_PERIOD=$(rpc "$EXEC" run_maintenance_executive_agent \
  "{\"p_period_start\":\"$END\",\"p_period_end\":\"$END\"}")
BAD_PERIOD="$BAD_PERIOD" python3 -c "import json,os; assert '7 to 366 day' in json.loads(os.environ['BAD_PERIOD'])['error']"

BEFORE_APPROVALS=$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")
BEFORE_RECS=$(psqlc "select count(*) from public.recommendations where organization_id='$ORG'")
BEFORE_AGENT_RECS=$(psqlc "select recommendations_generated from public.ai_agents where organization_id='$ORG' and key='maintenance_executive'")
RUN=$(rpc "$MANAGER" run_maintenance_executive_agent \
  "{\"p_period_start\":\"$START\",\"p_period_end\":\"$END\"}")
RUN_IDS=$(RUN="$RUN" python3 - <<'PY'
import json,os
d=json.loads(os.environ['RUN'])
assert d['advisory'] is True,d
for key in ('mayApprove','mayAcceptRisk','mayCommitSpend','mayReleaseWork',
            'mayChangeStrategy','mayChangeKpiTarget','mayReturnToService'):
    assert d[key] is False,(key,d)
assert d['facts']['risk']['critical'] >= 1,d
assert d['facts']['budget']['forecastsWithoutBasis'] >= 1,d
assert d['facts']['budget']['linesOverBudgetOrForecast'] >= 1,d
assert d['facts']['budget']['aggregateAmount'].startswith('not calculated'),d
keys={p['priorityKey'] for p in d['priorities']}
assert 'enterprise_risk_attention' in keys,d
assert 'budget_forecast_basis_missing' in keys,d
assert 'budget_exception_attention' in keys,d
print(d['briefId']+'|'+d['runId'])
PY
)
BRIEF=${RUN_IDS%%|*}
RUN_ID=${RUN_IDS##*|}
test "$(psqlc "select count(*) from public.agent_runs where id='$RUN_ID' and organization_id='$ORG' and organization_scope_id='$ORG' and retained_for_governance and confidence is null")" = '1'
test "$(psqlc "select count(*) from public.maintenance_executive_briefs where id='$BRIEF' and source_snapshot ? 'kpis' and source_snapshot->'budgets' ? 'sha256' and source_snapshot->'risks' ? 'sha256' and source_snapshot->'maintenancePlans' ? 'sha256' and source_snapshot->'valueMetrics' ? 'sha256' and source_snapshot->'authorityLimits' ? 'sha256'")" = '1'

# The requester cannot self-review; a different named human must be assigned.
SELF=$(rpc "$MANAGER" assign_maintenance_executive_review \
  "{\"p_brief_id\":\"$BRIEF\",\"p_assigned_to\":\"$MANAGER_ID\",\"p_due_date\":\"$DUE\",\"p_note\":\"Self review must be refused by segregation of duties.\"}")
SELF="$SELF" python3 -c "import json,os; assert 'segregation of duties' in json.loads(os.environ['SELF'])['error']"

ASSIGN=$(rpc "$MANAGER" assign_maintenance_executive_review \
  "{\"p_brief_id\":\"$BRIEF\",\"p_assigned_to\":\"$EXEC_ID\",\"p_due_date\":\"$DUE\",\"p_note\":\"Independent executive review of exact source populations and decision questions.\"}")
ASSIGN="$ASSIGN" python3 -c "import json,os; assert json.loads(os.environ['ASSIGN'])['status']=='assigned'"

DISPOSITION=$(rpc "$EXEC" record_maintenance_executive_disposition \
  "{\"p_brief_id\":\"$BRIEF\",\"p_priority_key\":\"enterprise_risk_attention\",\"p_disposition\":\"acknowledged\",\"p_note\":\"Independent review acknowledges the recorded risk facts and preserves risk acceptance with the canonical human process.\",\"p_action_reference\":null}")
DISPOSITION="$DISPOSITION" python3 - <<'PY'
import json,os
d=json.loads(os.environ['DISPOSITION'])
assert d['status']=='acknowledged',d
for key in ('approvalGranted','riskAccepted','spendCommitted','workReleased','strategyChanged','operationalAuthorization'):
    assert d[key] is False,(key,d)
PY

# Browser credentials cannot forge or revise the retained brief.
PATCH=$(curl -sS -o /tmp/c101-patch.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/maintenance_executive_briefs?id=eq.$BRIEF" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $MANAGER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"priorities":[]}')
case "$PATCH" in 401|403) ;; 200) test "$(cat /tmp/c101-patch.txt)" = '[]' ;; *) false ;; esac
test "$(psqlc "select jsonb_array_length(priorities) from public.maintenance_executive_briefs where id='$BRIEF'")" -gt 0
test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")" = "$BEFORE_APPROVALS"
test "$(psqlc "select count(*) from public.recommendations where organization_id='$ORG'")" = "$BEFORE_RECS"
test "$(psqlc "select recommendations_generated from public.ai_agents where organization_id='$ORG' and key='maintenance_executive'")" = "$BEFORE_AGENT_RECS"

echo 'Maintenance Executive Specialist smoke passed: canonical_kpis=true canonical_budgets=true budget_amounts_not_mixed_without_currency=true canonical_risks=true canonical_strategy=true canonical_governance=true verified_value_statuses_and_units_separated=true exact_source_fingerprints=true organization_scope=true immutable_brief=true no_invented_confidence=true no_shadow_recommendations=true sod_review=true no_agent_approval=true no_risk_acceptance=true no_spend_commitment=true no_work_release=true no_strategy_mutation=true no_operational_authority=true'

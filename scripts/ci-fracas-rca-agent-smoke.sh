#!/usr/bin/env bash
set -euo pipefail
trap 'echo "RCA / FRACAS agent smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C1.07 / C8.05 runtime proof against a clean, fully migrated local stack.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
SUBJECT='fa150000-0000-4000-8000-000000000001'
HISTORY='fa150000-0000-4000-8000-000000000002'
FOREIGN='fa150000-0000-4000-8000-000000000099'
OWNER='00000000-0000-0000-0000-000000000003'

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
SUPERVISOR=$(token supervisor@syncai.ca 'Super123!@#')
test -n "$ENGINEER" && test -n "$SUPERVISOR"

PROFILE=$(psqlc "select p.id from public.agent_control_profiles p join public.ai_agents a on a.id=p.agent_id where a.organization_id='$ORG' and a.key='fracas_rca' and p.status='adopted'")
test -n "$PROFILE"
test "$(psqlc "select count(*) from public.agent_tool_bindings b join public.agent_software_tools t on t.id=b.tool_id where b.profile_id='$PROFILE' and t.tool_key='analyse_fracas_case'")" = '1'
test "$(psqlc "select count(*) from public.agent_decision_right_bindings b join public.decision_rights d on d.id=b.decision_right_id where b.profile_id='$PROFILE' and d.right_key='flag_repeat_failures'")" = '1'
test "$(psqlc "select operating_charter ?& array['purpose','inputs','outputs','guardrails','routes'] from public.ai_agents where organization_id='$ORG' and key='fracas_rca' limit 1")" = 't'

psqlc "
  insert into public.work_orders
    (id,organization_id,asset_id,wo_number,title,description,status,priority,type,
     work_type,completed_at,actual_failure_mode,actual_cause,corrective_action,
     technician_comments,parts_used,labor_hours,downtime_hours)
  values
    ('$HISTORY','$ORG','$ASSET','CI-FRACAS-000','Prior seal event','Prior exact recurrence fixture.',
     'completed','high','human_created','corrective',now()-interval '60 days','CI seal leak',
     'Startup transient may have disturbed the seal faces','Replaced the seal cartridge',
     'Seal faces photographed and retained.', 'seal cartridge CI-000',4,12),
    ('$SUBJECT','$ORG','$ASSET','CI-FRACAS-001','Investigate repeat seal event','Subject exact closeout fixture.',
     'completed','critical','human_created','corrective',now()-interval '2 days','CI seal leak',
     'Startup transient may have disturbed the seal faces','Replaced cartridge and checked alignment',
     'Observed scoring on the removed seal faces.', 'seal cartridge CI-001',6,18)
  on conflict(id) do nothing;
"

# An out-of-role human cannot run the specialist, and a same-tenant token
# cannot resolve an unknown/foreign work identity.
DENIED=$(rpc "$SUPERVISOR" run_fracas_rca_agent "{\"p_work_order_id\":\"$SUBJECT\"}")
DENIED="$DENIED" python3 - <<'PY'
import json,os
assert 'requires a named reliability engineer' in json.loads(os.environ['DENIED'])['error']
PY
FOREIGN_RESULT=$(rpc "$ENGINEER" run_fracas_rca_agent "{\"p_work_order_id\":\"$FOREIGN\"}")
FOREIGN_RESULT="$FOREIGN_RESULT" python3 - <<'PY'
import json,os
assert json.loads(os.environ['FOREIGN_RESULT'])['error']=='work order not found'
PY

BEFORE_APPROVALS=$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")
BODY=$(rpc "$ENGINEER" run_fracas_rca_agent "{\"p_work_order_id\":\"$SUBJECT\"}")
IDS=$(BODY="$BODY" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['recurrence']['matchingEvents']==1,x
assert x['hypotheses'][0]['status']=='reported_not_verified',x
assert any('does not claim a verified root cause' in item.lower()
           for item in x['limitations']),x
for key in ('mayClaimRootCause','mayCloseInvestigation','mayAttestVerification',
            'mayApproveStrategy','mayAcceptRisk','mayCommitSpend','mayReturnToService'):
    assert x[key] is False,(key,x)
print(x['packId']+'|'+x['runId'])
PY
)
PACK=${IDS%%|*}
RUN=${IDS##*|}
test "$(psqlc "select count(*) from public.agent_runs where id='$RUN' and organization_id='$ORG' and work_order_id='$SUBJECT' and retained_for_governance and status='completed' and agent_tool_key='analyse_fracas_case'")" = '1'
test "$(psqlc "select count(*) from public.fracas_investigation_packs where id='$PACK' and organization_id='$ORG' and source_snapshot->'subject'->>'reportedCause'='Startup transient may have disturbed the seal faces' and jsonb_array_length(source_snapshot->'matchingPriorOrLaterEvents')=1")" = '1'
test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")" = "$BEFORE_APPROVALS"

# Exact evidence cannot be rewritten through the browser API.
BEFORE=$(psqlc "select md5(source_snapshot::text) from public.fracas_investigation_packs where id='$PACK'")
PATCH_STATUS=$(curl -sS -o /tmp/fracas-pack-patch.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/fracas_investigation_packs?id=eq.$PACK" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"investigation":{"forged":true}}')
case "$PATCH_STATUS" in 401|403) ;; 200) test "$(cat /tmp/fracas-pack-patch.txt)" = '[]' ;; *) false ;; esac
test "$(psqlc "select md5(source_snapshot::text) from public.fracas_investigation_packs where id='$PACK'")" = "$BEFORE"

# Verification refuses an unowned investigation.
UNOWNED=$(rpc "$ENGINEER" start_fracas_verification "{\"p_pack_id\":\"$PACK\",\"p_observation_days\":90}")
UNOWNED="$UNOWNED" python3 - <<'PY'
import json,os
assert 'assign a named human owner' in json.loads(os.environ['UNOWNED'])['error']
PY

ASSIGNED=$(rpc "$ENGINEER" assign_fracas_investigation \
  "{\"p_pack_id\":\"$PACK\",\"p_assigned_to\":\"$OWNER\",\"p_due_date\":\"2027-12-31\",\"p_note\":\"Validate the causal chain and attach physical evidence before attesting closure.\"}")
ASSIGNED="$ASSIGNED" python3 - <<'PY'
import json,os
x=json.loads(os.environ['ASSIGNED']); assert x['assignedTo']=='00000000-0000-0000-0000-000000000003',x
PY

VERIFIED=$(rpc "$ENGINEER" start_fracas_verification "{\"p_pack_id\":\"$PACK\",\"p_observation_days\":90}")
VERIFICATION=$(VERIFIED="$VERIFIED" python3 - <<'PY'
import json,os
x=json.loads(os.environ['VERIFIED'])
assert x['humanAttestationsRequired'] is True,x
print(x['verificationId'])
PY
)
test "$(psqlc "select count(*) from public.fracas_verification_links where investigation_pack_id='$PACK' and verification_id='$VERIFICATION'")" = '1'
test "$(psqlc "select count(*) from public.ca_verifications where id='$VERIFICATION' and physical_verified_at is null and causal_addressed_at is null and strategy_updated_at is null and effectiveness='observing'")" = '1'
test "$(psqlc "select status from public.work_orders where id='$SUBJECT'")" = 'completed'

echo 'RCA / FRACAS agent smoke passed: exact_closeout_snapshot=true reported_cause_not_root_cause=true recurrence=true role_gate=true tenant_wall=true immutable_pack=true named_owner=true verification_handoff=true no_execution_authority=true'

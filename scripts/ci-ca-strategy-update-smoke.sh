#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Corrective-action strategy linkage smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C4.12 runtime proof against the clean, fully migrated stack.  The preceding
# Asset Strategy Specialist smoke creates a genuinely assessed, independently
# reviewed and human-adopted lifecycle-plan version; this smoke proves that the
# corrective-action loop can consume that canonical evidence and nothing weaker.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
WORK_ORDER='c4120000-0000-4000-8000-000000000001'

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
TECH=$(token technician@syncai.ca 'Tech123!@#')
test -n "$ENGINEER" && test -n "$TECH"

LIFECYCLE_PLAN=$(psqlc "
  select id
  from public.asset_lifecycle_plans
  where organization_id='$ORG'
    and asset_id='$ASSET'
    and adopted_action='apply_recommended'
    and coalesce((adopted_strategy->>'programmeChanged')::boolean,false)
  order by adopted_at desc
  limit 1
")
test -n "$LIFECYCLE_PLAN"

psqlc "
  insert into public.work_orders(
    id,organization_id,asset_id,wo_number,title,status,work_type
  ) values (
    '$WORK_ORDER','$ORG','$ASSET','C4.12-CI',
    'Corrective action requiring a canonical strategy update','in_progress',
    'corrective'
  ) on conflict(id) do update set
    asset_id=excluded.asset_id,status='in_progress',work_type='corrective',
    completed_at=null,closed_at=null,actual_failure_mode=null,
    actual_cause=null,corrective_action=null;
" >/dev/null

# C4.11: the customer-reachable work-order closeout path will not complete
# corrective work without the failure, cause, action and actual-hour evidence.
INCOMPLETE=$(rpc "$ENGINEER" close_work_order_v2 \
  "{\"p_work_order_id\":\"$WORK_ORDER\",\"p_closeout\":{\"actualFailureMode\":\"Bearing wear\",\"actualCause\":\"Age-related wear\",\"correctiveAction\":\"\",\"laborHours\":4,\"downtimeHours\":6}}")
INCOMPLETE="$INCOMPLETE" python3 -c "import json,os; assert json.loads(os.environ['INCOMPLETE'])['error']=='missing_required_closeout_fields'"

CORRECTED=$(rpc "$ENGINEER" close_work_order_v2 \
  "{\"p_work_order_id\":\"$WORK_ORDER\",\"p_closeout\":{\"actualFailureMode\":\"Bearing wear\",\"actualCause\":\"Age-related wear\",\"correctiveAction\":\"Replaced the damaged component and verified the physical repair\",\"laborHours\":4,\"downtimeHours\":6,\"partsUsed\":\"CI-BRG-001\",\"technicianComments\":\"Repair completed against the approved work package.\"}}")
CORRECTED="$CORRECTED" python3 -c "import json,os; d=json.loads(os.environ['CORRECTED']); assert d.get('closed') is True and d.get('closeoutType')=='corrective',d"
test "$(psqlc "select count(*) from public.work_orders where id='$WORK_ORDER' and organization_id='$ORG' and status='completed' and completed_at is not null and actual_failure_mode='Bearing wear' and actual_cause='Age-related wear' and corrective_action='Replaced the damaged component and verified the physical repair' and labor_hours=4 and downtime_hours=6")" = '1'

STARTED=$(rpc "$ENGINEER" start_ca_verification \
  "{\"p_work_order_id\":\"$WORK_ORDER\",\"p_observation_days\":90}")
VERIFICATION=$(STARTED="$STARTED" python3 -c "import json,os; d=json.loads(os.environ['STARTED']); assert d.get('id'),d; print(d['id'])")

# The old free-text shortcut is explicitly retired.
BLIND=$(rpc "$ENGINEER" attest_ca_stage \
  "{\"p_verification_id\":\"$VERIFICATION\",\"p_stage\":\"strategy\",\"p_note\":\"Trust me\"}")
BLIND="$BLIND" python3 -c "import json,os; assert 'adopted lifecycle-plan' in json.loads(os.environ['BLIND'])['error']"

# Strategy cannot be declared complete before the physical and causal stages.
EARLY=$(rpc "$ENGINEER" link_ca_strategy_update \
  "{\"p_verification_id\":\"$VERIFICATION\",\"p_lifecycle_plan_id\":\"$LIFECYCLE_PLAN\",\"p_basis\":\"This adopted programme change addresses the verified bearing failure mechanism.\"}")
EARLY="$EARLY" python3 -c "import json,os; assert 'physical correction and causal mechanism' in json.loads(os.environ['EARLY'])['error']"

PHYSICAL=$(rpc "$ENGINEER" attest_ca_stage \
  "{\"p_verification_id\":\"$VERIFICATION\",\"p_stage\":\"physical\",\"p_note\":\"Physical repair independently checked against the completed work order.\"}")
CAUSAL=$(rpc "$ENGINEER" attest_ca_stage \
  "{\"p_verification_id\":\"$VERIFICATION\",\"p_stage\":\"causal\",\"p_note\":\"The recorded maintenance mechanism addresses the observed failure cause.\"}")
PHYSICAL="$PHYSICAL" CAUSAL="$CAUSAL" python3 - <<'PY'
import json,os
assert json.loads(os.environ['PHYSICAL']).get('stage') == 'physical'
assert json.loads(os.environ['CAUSAL']).get('stage') == 'causal'
PY

# An operational technician cannot declare the governance link, and arbitrary
# identifiers produce the same bounded not-found response as foreign records.
DENIED=$(rpc "$TECH" link_ca_strategy_update \
  "{\"p_verification_id\":\"$VERIFICATION\",\"p_lifecycle_plan_id\":\"$LIFECYCLE_PLAN\",\"p_basis\":\"Technician attempts to claim strategy authority outside the governed role.\"}")
DENIED="$DENIED" python3 -c "import json,os; assert 'named reliability engineer or administrator' in json.loads(os.environ['DENIED'])['error']"
UNKNOWN=$(rpc "$ENGINEER" link_ca_strategy_update \
  "{\"p_verification_id\":\"$VERIFICATION\",\"p_lifecycle_plan_id\":\"c4120000-0000-4000-8000-000000000099\",\"p_basis\":\"Unknown and foreign identifiers must not expose or attach lifecycle evidence.\"}")
UNKNOWN="$UNKNOWN" python3 -c "import json,os; assert json.loads(os.environ['UNKNOWN'])['error']=='same-tenant, same-asset adopted lifecycle-plan version not found'"

LINKED=$(rpc "$ENGINEER" link_ca_strategy_update \
  "{\"p_verification_id\":\"$VERIFICATION\",\"p_lifecycle_plan_id\":\"$LIFECYCLE_PLAN\",\"p_basis\":\"The independently adopted interval change addresses the verified bearing wear mechanism on this asset.\"}")
LINKED="$LINKED" LIFECYCLE_PLAN="$LIFECYCLE_PLAN" python3 - <<'PY'
import json,os
d=json.loads(os.environ['LINKED'])
assert d.get('ok') is True,d
assert d['lifecyclePlanId']==os.environ['LIFECYCLE_PLAN'],d
assert d['status']=='observing',d
assert 'remain separate authorities' in d['authority'],d
PY

test "$(psqlc "select count(*) from public.ca_verifications where id='$VERIFICATION' and organization_id='$ORG' and asset_id='$ASSET' and strategy_lifecycle_plan_id='$LIFECYCLE_PLAN' and strategy_updated_by is not null and status='observing'")" = '1'
test "$(psqlc "select count(*) from public.audit_events where organization_id='$ORG' and entity_type='ca_strategy_update' and event_data->>'verificationId'='$VERIFICATION' and event_data->>'lifecyclePlanId'='$LIFECYCLE_PLAN'")" = '1'

# The same closure cannot be relinked or silently rewritten.
SECOND=$(rpc "$ENGINEER" link_ca_strategy_update \
  "{\"p_verification_id\":\"$VERIFICATION\",\"p_lifecycle_plan_id\":\"$LIFECYCLE_PLAN\",\"p_basis\":\"A second link attempt must retain the first immutable strategy evidence.\"}")
SECOND="$SECOND" python3 -c "import json,os; assert 'already linked and immutable' in json.loads(os.environ['SECOND'])['error']"

PATCH=$(curl -sS -o /tmp/c412-patch.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/ca_verifications?id=eq.$VERIFICATION" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"strategy_note":"forged browser rewrite"}')
case "$PATCH" in 401|403) ;; 200) test "$(cat /tmp/c412-patch.txt)" = '[]' ;; *) false ;; esac
test "$(psqlc "select count(*) from public.ca_verifications where id='$VERIFICATION' and strategy_note='forged browser rewrite'")" = '0'

echo 'Corrective-action strategy linkage smoke passed: governed_correction=true mandatory_closeout=true blind_attestation_refused=true stage_order=true same_asset_plan=true programme_changed=true immutable_link=true tenant_wall=true audit_lineage=true'

#!/usr/bin/env bash
set -euo pipefail
trap 'echo "C8.04 maintenance-induced failure smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# Proves that temporal proximity is only a screen, while a causal maintenance-
# induced classification requires a retained FRACAS pack, verified canonical
# evidence and a named human. The classification cannot alter operations.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
ENGINEER_ID='00000000-0000-0000-0000-000000000001'
MANAGER_ID='00000000-0000-0000-0000-000000000003'
PRECEDING='c8040000-0000-4000-8000-000000000001'
FAILURE='c8040000-0000-4000-8000-000000000002'

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

review_payload() {
  local verdict="$1" cause="$2" window_evidence="$3" supporting="$4" basis="$5"
  VERDICT="$verdict" CAUSE="$cause" WINDOW_EVIDENCE="$window_evidence" \
  SUPPORTING="$supporting" BASIS="$basis" FAILURE_ID="$FAILURE" \
  PRECEDING_ID="$PRECEDING" PACK_ID="$PACK" python3 - <<'PY'
import json,os
support=[x for x in os.environ['SUPPORTING'].split(',') if x]
print(json.dumps({
  'p_failure_work_order_id':os.environ['FAILURE_ID'],
  'p_preceding_work_order_id':os.environ['PRECEDING_ID'],
  'p_fracas_investigation_pack_id':os.environ['PACK_ID'],
  'p_verdict':os.environ['VERDICT'],
  'p_cause_code':os.environ['CAUSE'] or None,
  'p_exposure_window_hours':168,
  'p_window_basis_evidence_item_id':os.environ['WINDOW_EVIDENCE'],
  'p_supporting_evidence_item_ids':support,
  'p_basis':os.environ['BASIS']
},separators=(',',':')))
PY
}

ENGINEER=$(token demo@syncai.ca 'Demo123!@#')
MANAGER=$(token manager@syncai.ca 'Manager123!@#')
TECHNICIAN=$(token technician@syncai.ca 'Tech123!@#')
test -n "$ENGINEER" && test -n "$MANAGER" && test -n "$TECHNICIAN"

MECHANISM=$(psqlc "select id from public.damage_mechanisms where organization_id='$ORG' order by mechanism_key limit 1")
test -n "$MECHANISM"

psqlc "
  insert into public.work_orders(
    id,organization_id,asset_id,wo_number,title,status,work_type,created_at,
    completed_at,actual_failure_mode,actual_cause,corrective_action,
    technician_comments,parts_used,labor_hours,downtime_hours
  ) values (
    '$PRECEDING','$ORG','$ASSET','C8.04-PM','Seal inspection and reassembly',
    'completed','preventive',now()-interval '5 days',now()-interval '3 days',
    null,null,null,'Completed inspection and reassembly to the approved job plan.',
    'seal kit',4,2
  ) on conflict(id) do nothing;
  insert into public.work_orders(
    id,organization_id,asset_id,wo_number,title,status,work_type,created_at,
    completed_at,actual_failure_mode,actual_cause,corrective_action,
    technician_comments,parts_used,labor_hours,downtime_hours,
    failure_mechanism_id,mechanism_coded_by,mechanism_coded_at,mechanism_note
  ) values (
    '$FAILURE','$ORG','$ASSET','C8.04-FAIL','Seal failure recorded after maintenance',
    'completed','corrective',now()-interval '2 days',now()-interval '1 day',
    'Seal leakage','Reported reassembly concern','Replaced and correctly reassembled seal',
    'Teardown retained for independent causal review.','seal kit',8,12,
    '$MECHANISM','$ENGINEER_ID',now()-interval '1 day',
    'Named-human coding from teardown and governed failure history.'
  ) on conflict(id) do nothing;
" >/dev/null

PACK_RESPONSE=$(rpc "$ENGINEER" run_fracas_rca_agent \
  "{\"p_work_order_id\":\"$FAILURE\"}")
PACK=$(BODY="$PACK_RESPONSE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x.get('packId'),x
assert x.get('mayClaimRootCause') is False,x
print(x['packId'])
PY
)

WINDOW_EVIDENCE=$(psqlc "insert into public.evidence_items(
  organization_id,asset_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method)
  values('$ORG','$ASSET','C8.04-SMOKE','engineering_basis',
  'Approved 168-hour post-maintenance exposure window for this mechanism and duty.',
  'DOCUMENTED','verified','$MANAGER_ID',now(),'Independent engineering review') returning id")
SUPPORTING_EVIDENCE=$(psqlc "insert into public.evidence_items(
  organization_id,asset_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method)
  values('$ORG','$ASSET','C8.04-SMOKE','teardown',
  'Independent teardown record confirms the incorrect seal reassembly sequence.',
  'INSPECTED','verified','$MANAGER_ID',now(),'Independent teardown inspection') returning id")
SELF_EVIDENCE=$(psqlc "insert into public.evidence_items(
  organization_id,asset_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method)
  values('$ORG','$ASSET','C8.04-SMOKE','teardown',
  'Self-verified teardown note must not independently confirm maintenance origin.',
  'INSPECTED','verified','$ENGINEER_ID',now(),'Self review') returning id")
FOREIGN_EVIDENCE=$(psqlc "select id from public.evidence_items
  where organization_id<>'$ORG' and verification_status='verified' limit 1")
test -n "$FOREIGN_EVIDENCE"

CANDIDATES=$(rpc "$ENGINEER" get_maintenance_induced_failure_candidates \
  '{"p_exposure_window_hours":168,"p_limit":50}')
BODY="$CANDIDATES" FAILURE_ID="$FAILURE" PRECEDING_ID="$PRECEDING" \
WINDOW_EVIDENCE="$WINDOW_EVIDENCE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
c=next(i for i in x['candidates'] if i['failureWorkOrderId']==os.environ['FAILURE_ID'])
assert c['precedingWorkOrderId']==os.environ['PRECEDING_ID'],c
assert c['readyForReview'] is True,c
assert c['observedGapHours']>0,c
assert 'not a claimed physical failure time' in x['basis'],x
assert 'Temporal proximity is never causation' in x['basis'],x
assert os.environ['WINDOW_EVIDENCE'] in [e['id'] for e in x['verifiedEvidence']],x
PY

WORK_BEFORE=$(psqlc "select count(*) from public.work_orders where organization_id='$ORG'")
APPROVALS_BEFORE=$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")
RECOMMENDATIONS_BEFORE=$(psqlc "select count(*) from public.recommendations where organization_id='$ORG'")

VALID_PAYLOAD=$(review_payload confirmed reassembly "$WINDOW_EVIDENCE" \
  "$SUPPORTING_EVIDENCE" \
  'Independent teardown and the approved exposure basis establish incorrect reassembly as the dominant maintenance origin.')
VALID=$(rpc "$ENGINEER" review_maintenance_induced_failure "$VALID_PAYLOAD")
BODY="$VALID" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x.get('verdict')=='confirmed' and x.get('revision')==1,x
for k in ('mayChangeWork','mayApprove','mayAcceptRisk','mayCommitSpend',
          'mayChangeOperatingLimits','mayReturnToService'):
    assert x.get(k) is False,(k,x)
PY

test "$(psqlc "select count(*) from public.work_orders where organization_id='$ORG'")" = "$WORK_BEFORE"
test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")" = "$APPROVALS_BEFORE"
test "$(psqlc "select count(*) from public.recommendations where organization_id='$ORG'")" = "$RECOMMENDATIONS_BEFORE"
test "$(psqlc "select count(*) from public.maintenance_induced_failure_reviews where failure_work_order_id='$FAILURE' and verdict='confirmed' and cause_code='reassembly'")" = '1'
test "$(psqlc "select count(*) from public.audit_events where organization_id='$ORG' and entity_type='maintenance_induced_failure_review' and event_data->>'failure_work_order_id'='$FAILURE'")" = '1'

UNAUTHORIZED=$(rpc "$TECHNICIAN" review_maintenance_induced_failure "$VALID_PAYLOAD")
expect_error "$UNAUTHORIZED" 'named reliability engineer'

SELF_PAYLOAD=$(review_payload confirmed reassembly "$WINDOW_EVIDENCE" \
  "$SELF_EVIDENCE" \
  'A self-verified note cannot independently establish a maintenance-origin classification.')
SELF_DENIED=$(rpc "$ENGINEER" review_maintenance_induced_failure "$SELF_PAYLOAD")
expect_error "$SELF_DENIED" 'independently verified'

FOREIGN_PAYLOAD=$(review_payload inconclusive '' "$FOREIGN_EVIDENCE" '' \
  'Foreign evidence must remain outside this tenant review even when the temporal candidate is otherwise valid.')
FOREIGN_DENIED=$(rpc "$ENGINEER" review_maintenance_induced_failure "$FOREIGN_PAYLOAD")
expect_error "$FOREIGN_DENIED" 'same-tenant evidence'

REVISION_PAYLOAD=$(review_payload inconclusive '' "$WINDOW_EVIDENCE" '' \
  'A later evidence review remains inconclusive and supersedes rather than overwrites the original classification.')
REVISION=$(rpc "$ENGINEER" review_maintenance_induced_failure "$REVISION_PAYLOAD")
BODY="$REVISION" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('revision')==2 and x.get('verdict')=='inconclusive',x"
test "$(psqlc "select count(*) from public.maintenance_induced_failure_reviews where failure_work_order_id='$FAILURE'")" = '2'
test "$(psqlc "select count(*) from public.maintenance_induced_failure_reviews newer join public.maintenance_induced_failure_reviews prior on prior.id=newer.supersedes_id where newer.failure_work_order_id='$FAILURE' and newer.revision=2 and prior.revision=1")" = '1'

sql_must_fail 'maintenance-induced failure reviews are append-only' "
  update public.maintenance_induced_failure_reviews
  set basis='Forged overwrite of the retained classification record.'
  where failure_work_order_id='$FAILURE';
"
sql_must_fail 'governed named-human workflow' "
  insert into public.maintenance_induced_failure_reviews(
    organization_id,failure_work_order_id,preceding_work_order_id,
    fracas_investigation_pack_id,verdict,exposure_window_hours,observed_gap_hours,
    window_basis_evidence_item_id,basis,revision,reviewed_by)
  values('$ORG','$FAILURE','$PRECEDING','$PACK','inconclusive',168,24,
    '$WINDOW_EVIDENCE','Forged direct insert must be refused by the protected workflow.',3,'$ENGINEER_ID');
"

echo 'Maintenance-induced failure smoke passed: temporal_screen_only=true fracas_required=true verified_evidence=true independent_confirmation=true tenant_wall=true append_only_revisions=true no_operational_authority=true'

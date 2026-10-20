#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Reliability improvement case smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C1.03 runtime proof against a clean, fully migrated local stack.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
HISTORY='fa400000-0000-4000-8000-000000000001'
SUBJECT='fa400000-0000-4000-8000-000000000002'
FOREIGN='fa400000-0000-4000-8000-000000000099'
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

psqlc "
  insert into public.work_orders
    (id,organization_id,asset_id,wo_number,title,description,status,priority,type,
     work_type,completed_at,actual_failure_mode,actual_cause,corrective_action,
     technician_comments,parts_used,labor_hours,downtime_hours)
  values
    ('$HISTORY','$ORG','$ASSET','CI-RE-IMPROVE-000','Prior repeat seal event',
     'Prior event for reliability-improvement screening.','completed','high',
     'human_created','corrective',now()-interval '70 days','CI repeat seal leak',
     'Startup transient is a reported hypothesis','Replaced seal cartridge',
     'Removed faces retained for inspection.','seal cartridge CI-RI-000',5,13),
    ('$SUBJECT','$ORG','$ASSET','CI-RE-IMPROVE-001','Repeat seal event',
     'Subject event for reliability-improvement screening.','completed','critical',
     'human_created','corrective',now()-interval '3 days','CI repeat seal leak',
     'Startup transient is a reported hypothesis','Replaced cartridge and aligned coupling',
     'Scoring observed on removed faces.','seal cartridge CI-RI-001',7,19)
  on conflict(id) do nothing;
"

PACK=$(psqlc "select id from public.fracas_investigation_packs where organization_id='$ORG' and work_order_id='$SUBJECT'")
if [[ -z "$PACK" ]]; then
  CREATED=$(rpc "$ENGINEER" run_fracas_rca_agent "{\"p_work_order_id\":\"$SUBJECT\"}")
  PACK=$(CREATED="$CREATED" python3 - <<'PY'
import json,os
x=json.loads(os.environ['CREATED']); print(x['packId'])
PY
)
fi

ASSIGNMENT=$(psqlc "select id from public.fracas_investigation_assignments where organization_id='$ORG' and investigation_pack_id='$PACK' order by assigned_at desc limit 1")
if [[ -z "$ASSIGNMENT" ]]; then
  ASSIGNED=$(rpc "$ENGINEER" assign_fracas_investigation \
    "{\"p_pack_id\":\"$PACK\",\"p_assigned_to\":\"$OWNER\",\"p_due_date\":\"2027-12-31\",\"p_note\":\"Own the causal review and attach verified evidence before any strategy decision.\"}")
  ASSIGNED="$ASSIGNED" python3 - <<'PY'
import json,os
x=json.loads(os.environ['ASSIGNED']); assert x['assignedTo']=='00000000-0000-0000-0000-000000000003',x
PY
fi

# The tenant-relative intake exposes the real rank inputs and the named pack.
WORKSPACE=$(rpc "$ENGINEER" get_reliability_improvement_workspace '{"p_window_days":365}')
WORKSPACE="$WORKSPACE" ASSET="$ASSET" PACK="$PACK" python3 - <<'PY'
import json,os
x=json.loads(os.environ['WORKSPACE'])
assert x['mayApproveStrategy'] is False and x['mayAuthorizeWork'] is False,x
asset=next(a for a in x['rankedAssets'] if a['assetId']==os.environ['ASSET'])
assert asset['correctiveEvents']>=2 and float(asset['downtimeHours'])>=32,asset
pack=next(p for p in asset['fracasPacks'] if p['packId']==os.environ['PACK'])
assert pack['assignedTo']=='00000000-0000-0000-0000-000000000003',pack
assert pack['caseId'] is None,pack
PY

# Wrong role and unknown/foreign identities fail before any canonical case is made.
DENIED=$(rpc "$SUPERVISOR" start_reliability_improvement_case \
  "{\"p_fracas_pack_id\":\"$PACK\",\"p_title\":\"Denied case\",\"p_problem_statement\":\"This statement is long enough but must still be denied by role.\",\"p_opportunity_statement\":null,\"p_framework_id\":null}")
DENIED="$DENIED" python3 - <<'PY'
import json,os
assert 'requires a named reliability engineer' in json.loads(os.environ['DENIED'])['error']
PY
FOREIGN_RESULT=$(rpc "$ENGINEER" start_reliability_improvement_case \
  "{\"p_fracas_pack_id\":\"$FOREIGN\",\"p_title\":\"Foreign case\",\"p_problem_statement\":\"This foreign pack must never cross the tenant boundary into a case.\",\"p_opportunity_statement\":null,\"p_framework_id\":null}")
FOREIGN_RESULT="$FOREIGN_RESULT" python3 - <<'PY'
import json,os
assert json.loads(os.environ['FOREIGN_RESULT'])['error']=='FRACAS investigation pack not found in this organization'
PY

BEFORE_APPROVALS=$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")
CREATED=$(rpc "$ENGINEER" start_reliability_improvement_case \
  "{\"p_fracas_pack_id\":\"$PACK\",\"p_title\":\"CI governed seal reliability improvement\",\"p_problem_statement\":\"Repeated seal events caused 32 recorded downtime hours and require causal, FMEA, strategy, value and outcome review.\",\"p_opportunity_statement\":\"Reduce verified recurrence without asserting an unmeasured benefit.\",\"p_framework_id\":null}")
IDS=$(CREATED="$CREATED" python3 - <<'PY'
import json,os
x=json.loads(os.environ['CREATED'])
assert x['existing'] is False,x
for k in ('mayApproveStrategy','mayAuthorizeWork','maySanctionCase'): assert x[k] is False,(k,x)
assert x['humanApprovalRequired'] is True,x
print(x['caseId']+'|'+x['linkId'])
PY
)
CASE=${IDS%%|*}
LINK=${IDS##*|}

test "$(psqlc "select count(*) from public.development_cases where id='$CASE' and organization_id='$ORG' and lifecycle_type='reliability_improvement' and status='active' and sanctioned_at is null")" = '1'
test "$(psqlc "select count(*) from public.development_case_assets where organization_id='$ORG' and development_case_id='$CASE' and asset_id='$ASSET'")" = '1'
test "$(psqlc "select count(*) from public.fracas_improvement_case_links where id='$LINK' and organization_id='$ORG' and fracas_pack_id='$PACK' and development_case_id='$CASE' and asset_id='$ASSET'")" = '1'
test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")" = "$BEFORE_APPROVALS"
test "$(psqlc "select status from public.work_orders where id='$SUBJECT'")" = 'completed'

# The same handoff is idempotent and resolves to the one canonical case.
AGAIN=$(rpc "$ENGINEER" start_reliability_improvement_case \
  "{\"p_fracas_pack_id\":\"$PACK\",\"p_title\":\"Ignored duplicate title\",\"p_problem_statement\":\"The existing provenance link must win over a duplicate handoff attempt.\",\"p_opportunity_statement\":null,\"p_framework_id\":null}")
AGAIN="$AGAIN" CASE="$CASE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['AGAIN']); assert x['existing'] is True and x['caseId']==os.environ['CASE'],x
PY
test "$(psqlc "select count(*) from public.fracas_improvement_case_links where fracas_pack_id='$PACK'")" = '1'

# The canonical case RAM boundary sees the exact bound asset; no parallel FMEA
# or strategy store is introduced by this handoff.
RAM=$(rpc "$ENGINEER" get_case_ram_scope "{\"p_case_id\":\"$CASE\"}")
RAM="$RAM" ASSET="$ASSET" python3 - <<'PY'
import json,os
x=json.loads(os.environ['RAM'])
assert x['refused'] is False,x
assert [a['assetId'] for a in x['assets']]==[os.environ['ASSET']],x
assert 'fmea' in x and 'pmStrategies' in x,x
PY

# Browser callers cannot forge or rewrite the immutable provenance link.
PATCH_STATUS=$(curl -sS -o /tmp/reliability-improvement-link-patch.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/fracas_improvement_case_links?id=eq.$LINK" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d "{\"development_case_id\":\"$FOREIGN\"}")
case "$PATCH_STATUS" in 401|403) ;; 200) test "$(cat /tmp/reliability-improvement-link-patch.txt)" = '[]' ;; *) false ;; esac
test "$(psqlc "select development_case_id from public.fracas_improvement_case_links where id='$LINK'")" = "$CASE"

# Immutability includes the statement-level path that bypasses row triggers,
# and the API service principal has no direct mutation verb on the ledger.
test "$(psqlc "select has_table_privilege('service_role','public.fracas_improvement_case_links','INSERT,UPDATE,DELETE,TRUNCATE')")" = 'f'
psqlc "do \$\$ begin
  begin
    truncate table public.fracas_improvement_case_links;
    raise exception 'truncate unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end \$\$;"
test "$(psqlc "select count(*) from public.fracas_improvement_case_links where id='$LINK'")" = '1'

echo 'Reliability improvement case smoke passed: tenant_rank=true named_fracas_owner=true canonical_case=true canonical_asset_scope=true immutable_link=true idempotent_handoff=true role_gate=true tenant_wall=true no_execution_authority=true'

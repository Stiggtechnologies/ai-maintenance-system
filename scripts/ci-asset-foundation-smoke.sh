#!/usr/bin/env bash
set -euo pipefail
trap 'echo "C8.01 asset foundation smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ASSET='c8010000-0000-4000-8000-000000000010'
ENGINEER_ID='00000000-0000-0000-0000-000000000001'
MANAGER_ID='00000000-0000-0000-0000-000000000003'

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

ENGINEER=$(token demo@syncai.ca 'Demo123!@#')
MANAGER=$(token manager@syncai.ca 'Manager123!@#')
TECHNICIAN=$(token technician@syncai.ca 'Tech123!@#')
test -n "$ENGINEER" && test -n "$MANAGER" && test -n "$TECHNICIAN"

SITE=$(psqlc "select id from public.sites where organization_id='$ORG' order by id limit 1")
FOREIGN_ORG=$(psqlc "select id from public.organizations where id<>'$ORG' order by id limit 1")
test -n "$SITE" && test -n "$FOREIGN_ORG"

psqlc "insert into public.assets(id,organization_id,site_id,tag,name,asset_class,criticality)
  values('$ASSET','$ORG','$SITE','C801-P-1','C8.01 governed pump','pump','medium')
  on conflict(id) do nothing" >/dev/null

HIERARCHY_EVIDENCE=$(psqlc "insert into public.evidence_items(
  organization_id,asset_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method)
  values('$ORG','$ASSET','C8.01-SMOKE','hierarchy_drawing',
  'Verified site hierarchy drawing reconciled to the equipment register.',
  'DOCUMENTED','verified','$MANAGER_ID',now(),'Independent drawing reconciliation') returning id")
CRITICALITY_EVIDENCE=$(psqlc "insert into public.evidence_items(
  organization_id,asset_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method)
  values('$ORG','$ASSET','C8.01-SMOKE','consequence_assessment',
  'Verified five-dimension consequence assessment for the governed pump.',
  'ANALYZED','verified','$MANAGER_ID',now(),'Independent consequence review') returning id")
BOUNDARY_EVIDENCE=$(psqlc "insert into public.evidence_items(
  organization_id,asset_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method)
  values('$ORG','$ASSET','C8.01-SMOKE','boundary_walkdown',
  'Verified equipment boundary and isolation-point field walkdown.',
  'INSPECTED','verified','$MANAGER_ID',now(),'Independent field walkdown') returning id")
FOREIGN_EVIDENCE=$(psqlc "insert into public.evidence_items(
  organization_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method)
  values('$FOREIGN_ORG','C8.01-FOREIGN','hierarchy_drawing',
  'Foreign hierarchy evidence must never support this tenant.',
  'DOCUMENTED','verified','$MANAGER_ID',now(),'Foreign fixture review') returning id")

AREA_RESPONSE=$(rpc "$ENGINEER" propose_asset_hierarchy_node "{
  \"p_site_id\":\"$SITE\",\"p_parent_location_id\":null,
  \"p_location_kind\":\"area\",\"p_location_code\":\"C801-AREA\",
  \"p_name\":\"C8.01 process area\",
  \"p_description\":\"Process area reconciled to the verified hierarchy drawing and site register.\",
  \"p_evidence_item_id\":\"$HIERARCHY_EVIDENCE\"}")
AREA=$(BODY="$AREA_RESPONSE" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('status')=='proposed',x; print(x['locationId'])")

SELF_AREA=$(rpc "$ENGINEER" review_asset_hierarchy_node "{
  \"p_location_id\":\"$AREA\",\"p_decision\":\"verified\",
  \"p_review_note\":\"The proposer cannot independently verify their own hierarchy node.\"}")
expect_error "$SELF_AREA" 'independent hierarchy reviewer'

AREA_REVIEW=$(rpc "$MANAGER" review_asset_hierarchy_node "{
  \"p_location_id\":\"$AREA\",\"p_decision\":\"verified\",
  \"p_review_note\":\"Independent review reconciled the area to the site drawing and register.\"}")
BODY="$AREA_REVIEW" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('status')=='verified',x"

SYSTEM_RESPONSE=$(rpc "$ENGINEER" propose_asset_hierarchy_node "{
  \"p_site_id\":\"$SITE\",\"p_parent_location_id\":\"$AREA\",
  \"p_location_kind\":\"system\",\"p_location_code\":\"C801-AREA-CW\",
  \"p_name\":\"Cooling water system\",
  \"p_description\":\"Cooling water system contained inside the independently verified process area.\",
  \"p_evidence_item_id\":\"$HIERARCHY_EVIDENCE\"}")
SYSTEM=$(BODY="$SYSTEM_RESPONSE" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('status')=='proposed',x; print(x['locationId'])")
SYSTEM_REVIEW=$(rpc "$MANAGER" review_asset_hierarchy_node "{
  \"p_location_id\":\"$SYSTEM\",\"p_decision\":\"verified\",
  \"p_review_note\":\"Independent review confirms the system parent, code and site relationship.\"}")
BODY="$SYSTEM_REVIEW" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('status')=='verified',x"

FOREIGN_NODE=$(rpc "$ENGINEER" propose_asset_hierarchy_node "{
  \"p_site_id\":\"$SITE\",\"p_parent_location_id\":null,
  \"p_location_kind\":\"area\",\"p_location_code\":\"C801-FOREIGN\",
  \"p_name\":\"Foreign evidence attempt\",
  \"p_description\":\"Foreign evidence cannot substantiate a hierarchy node in this organization.\",
  \"p_evidence_item_id\":\"$FOREIGN_EVIDENCE\"}")
expect_error "$FOREIGN_NODE" 'same-tenant evidence'

WORK_BEFORE=$(psqlc "select count(*) from public.work_orders where organization_id='$ORG'")
APPROVALS_BEFORE=$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")
RECOMMENDATIONS_BEFORE=$(psqlc "select count(*) from public.recommendations where organization_id='$ORG'")

PROPOSAL_RESPONSE=$(rpc "$ENGINEER" propose_asset_foundation_verification "{
  \"p_asset_id\":\"$ASSET\",\"p_hierarchy_location_id\":\"$SYSTEM\",
  \"p_scores\":{\"safety\":5,\"environmental\":3,\"production\":4,\"financial\":3,\"regulatory\":2},
  \"p_criticality_basis\":\"Loss of containment has a catastrophic personnel consequence, so the highest dimension governs.\",
  \"p_boundary\":{\"name\":\"C8.01 maintainable pump boundary\",
    \"includedEquipment\":[\"pump casing\",\"motor\",\"coupling\"],
    \"excludedEquipment\":[\"upstream vessel\"],
    \"upstreamInterface\":\"Suction flange C801-F1\",
    \"downstreamInterface\":\"Discharge flange C801-F2\",
    \"isolationPoints\":[\"C801-XV-1\",\"C801-MCC-4\"],
    \"basis\":\"Verified drawing and field walkdown define the maintainable envelope and isolation points.\"},
  \"p_hierarchy_evidence_item_id\":\"$HIERARCHY_EVIDENCE\",
  \"p_criticality_evidence_item_id\":\"$CRITICALITY_EVIDENCE\",
  \"p_boundary_evidence_item_id\":\"$BOUNDARY_EVIDENCE\"}")
PROPOSAL=$(BODY="$PROPOSAL_RESPONSE" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('status')=='proposed' and x.get('revision')==1 and x.get('criticalityClass')=='critical',x; print(x['verificationId'])")

test "$(psqlc "select count(*) from public.assets where id='$ASSET' and foundation_verified_at is null and criticality='medium'")" = '1'

TECH_DENIED=$(rpc "$TECHNICIAN" review_asset_foundation_verification "{
  \"p_verification_id\":\"$PROPOSAL\",\"p_decision\":\"verified\",
  \"p_review_note\":\"Execution-only roles cannot verify the governed asset foundation.\"}")
expect_error "$TECH_DENIED" 'named reliability engineer'

SELF_DENIED=$(rpc "$ENGINEER" review_asset_foundation_verification "{
  \"p_verification_id\":\"$PROPOSAL\",\"p_decision\":\"verified\",
  \"p_review_note\":\"The proposer cannot independently verify their own asset foundation.\"}")
expect_error "$SELF_DENIED" 'independent asset-foundation reviewer'

VERIFIED=$(rpc "$MANAGER" review_asset_foundation_verification "{
  \"p_verification_id\":\"$PROPOSAL\",\"p_decision\":\"verified\",
  \"p_review_note\":\"Independent review confirms hierarchy, criticality evidence and the equipment boundary.\"}")
BODY="$VERIFIED" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x.get('status')=='verified' and x.get('criticalityClass')=='critical',x
for key in ('mayChangeWork','mayApprove','mayAcceptRisk','mayCommitSpend','mayChangeOperatingLimits','mayReturnToService'):
    assert x.get(key) is False,(key,x)
PY

test "$(psqlc "select count(*) from public.assets where id='$ASSET'
  and site_id='$SITE' and location_id='$SYSTEM' and area='C8.01 process area'
  and system='Cooling water system' and functional_location='C801-AREA-CW'
  and criticality='critical' and foundation_verification_id='$PROPOSAL'")" = '1'
test "$(psqlc "select count(*) from public.audit_events where organization_id='$ORG'
  and entity_type='asset_foundation_verification'
  and event_data->>'verification_id'='$PROPOSAL'")" = '2'
test "$(psqlc "select count(*) from public.work_orders where organization_id='$ORG'")" = "$WORK_BEFORE"
test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")" = "$APPROVALS_BEFORE"
test "$(psqlc "select count(*) from public.recommendations where organization_id='$ORG'")" = "$RECOMMENDATIONS_BEFORE"

sql_must_fail 'verified hierarchy, criticality and boundary are changed only' "
  update public.assets set criticality='low' where id='$ASSET';
"
sql_must_fail 'asset foundation verification requires the governed named-human workflow' "
  update public.asset_foundation_verifications set boundary_name='Forged boundary' where id='$PROPOSAL';
"
sql_must_fail 'governed asset hierarchy nodes are retained' "
  delete from public.asset_locations where id='$SYSTEM';
"

WORKSPACE=$(rpc "$ENGINEER" get_asset_foundation_workspace '{}')
BODY="$WORKSPACE" ASSET_ID="$ASSET" SYSTEM_ID="$SYSTEM" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
a=next(item for item in x['assets'] if item['id']==os.environ['ASSET_ID'])
assert a['foundationVerificationId'] and a['criticality']=='critical',a
assert any(item['id']==os.environ['SYSTEM_ID'] and item['status']=='verified' for item in x['locations']),x
assert x['model']['dimensions']==['safety','environmental','production','financial','regulatory'],x
assert x['authority']['mayReturnToService'] is False,x
PY

echo 'Asset foundation smoke passed: one_hierarchy=true independent_verification=true deterministic_criticality=true explicit_boundary=true tenant_evidence_wall=true immutable_verified_fields=true no_operational_authority=true'

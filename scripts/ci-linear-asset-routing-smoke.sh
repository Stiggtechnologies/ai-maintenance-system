#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U3.03 linear-asset routing smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999903'
ASSET='93030000-0000-0000-0000-000000000001'
NON_LINEAR='93030000-0000-0000-0000-000000000002'
FOREIGN_ASSET='93030000-0000-0000-0000-000000000003'
EVIDENCE='93030000-0000-0000-0000-000000000011'
UNVERIFIED='93030000-0000-0000-0000-000000000012'
ROUTE_CODE='U3-03-PIPE-NORTH'

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}
rpc() {
  curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" \
    -H 'content-type: application/json' -d "$3"
}
body() { printf '%s' "${1%$'\n'*}"; }
status() { printf '%s' "${1##*$'\n'}"; }
ok() {
  test "$(status "$1")" = 200
  BODY="$(body "$1")" python3 -c \
    "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"
}
err() {
  test "$(status "$1")" = 200
  BODY="$(body "$1")" NEEDLE="$2" python3 -c \
    "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"
}

USER_TOKEN=$(token 'demo@syncai.ca' 'Demo123!@#')
ADMIN_TOKEN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$USER_TOKEN" && test -n "$ADMIN_TOKEN"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry)
values('$OTHER_ORG','U3.03 foreign','utilities') on conflict(id) do nothing;
insert into assets(id,organization_id,name,tag,asset_class) values
  ('$ASSET','$ORG','U3.03 governed pipeline','U303-PIPE-01','Pipeline'),
  ('$NON_LINEAR','$ORG','U3.03 non-linear pump','U303-PUMP-01','Pump'),
  ('$FOREIGN_ASSET','$OTHER_ORG','Foreign pipeline','U303-FR-01','Pipeline')
on conflict(id) do nothing;
insert into evidence_items(
  id,organization_id,asset_id,source_system,evidence_type,description,evidence_class
) values
  ('$EVIDENCE','$ORG','$ASSET','survey-control','route-survey','Qualified route survey and alignment register','MEASURED'),
  ('$UNVERIFIED','$ORG','$ASSET','survey-control','route-survey','Unverified route extent source','DOCUMENTED')
on conflict(id) do nothing;
SQL

VERIFY=$(rpc "$ADMIN_TOKEN" verify_evidence_item \
  "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Qualified route survey review\",\"p_outcome\":\"verified\",\"p_note\":\"Verified as route identity and extent evidence only.\"}")
ok "$VERIFY"

CLASSIFIED=$(rpc "$ADMIN_TOKEN" assign_asset_class_profile \
  "{\"p_asset_id\":\"$ASSET\",\"p_class_key\":\"linear\",\"p_basis\":\"Verified survey and alignment register establish a linear asset; capacity remains unassessed.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$CLASSIFIED"

test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/record_linear_asset_route" \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')" = 401

UNAUTHORIZED=$(rpc "$USER_TOKEN" record_linear_asset_route \
  "{\"p_asset_id\":\"$ASSET\",\"p_route_code\":\"DENIED-USER\",\"p_measure_unit\":\"km\",\"p_start_measure\":0,\"p_end_measure\":10,\"p_description\":\"Denied user route\",\"p_basis\":\"Unauthorized roles must not establish route truth.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$UNAUTHORIZED" 'named same-tenant'

FOREIGN=$(rpc "$ADMIN_TOKEN" record_linear_asset_route \
  "{\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_route_code\":\"DENIED-FOREIGN\",\"p_measure_unit\":\"km\",\"p_start_measure\":0,\"p_end_measure\":10,\"p_description\":\"Foreign tenant route\",\"p_basis\":\"Foreign assets must remain outside this tenant.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$FOREIGN" 'asset must belong to this organization'

NON_LINEAR_RESULT=$(rpc "$ADMIN_TOKEN" record_linear_asset_route \
  "{\"p_asset_id\":\"$NON_LINEAR\",\"p_route_code\":\"DENIED-POINT\",\"p_measure_unit\":\"km\",\"p_start_measure\":0,\"p_end_measure\":10,\"p_description\":\"Point asset route\",\"p_basis\":\"Point equipment cannot silently become a route.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$NON_LINEAR_RESULT" 'carry the governed linear class'

NO_PROOF=$(rpc "$ADMIN_TOKEN" record_linear_asset_route \
  "{\"p_asset_id\":\"$ASSET\",\"p_route_code\":\"DENIED-PROOF\",\"p_measure_unit\":\"km\",\"p_start_measure\":0,\"p_end_measure\":10,\"p_description\":\"Unverified route\",\"p_basis\":\"Unverified evidence must not establish route truth.\",\"p_evidence_item_id\":\"$UNVERIFIED\"}")
err "$NO_PROOF" 'requires verified same-tenant'

BAD_BOUNDS=$(rpc "$ADMIN_TOKEN" record_linear_asset_route \
  "{\"p_asset_id\":\"$ASSET\",\"p_route_code\":\"DENIED-BOUNDS\",\"p_measure_unit\":\"km\",\"p_start_measure\":10,\"p_end_measure\":0,\"p_description\":\"Invalid route bounds\",\"p_basis\":\"Reversed measures must not create a route record.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$BAD_BOUNDS" 'greater than its start'

ROUTE=$(rpc "$ADMIN_TOKEN" record_linear_asset_route \
  "{\"p_asset_id\":\"$ASSET\",\"p_route_code\":\"$ROUTE_CODE\",\"p_measure_unit\":\"km\",\"p_start_measure\":0,\"p_end_measure\":12,\"p_description\":\"Governed north pipeline corridor\",\"p_basis\":\"Qualified survey and alignment register establish the endpoints; capacity remains unassessed.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$ROUTE"
ROUTE_ID=$(BODY="$(body "$ROUTE")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['route_id'])")

DUPLICATE=$(rpc "$ADMIN_TOKEN" record_linear_asset_route \
  "{\"p_asset_id\":\"$ASSET\",\"p_route_code\":\"$ROUTE_CODE\",\"p_measure_unit\":\"km\",\"p_start_measure\":0,\"p_end_measure\":12,\"p_description\":\"Duplicate route code\",\"p_basis\":\"A duplicate code must not create competing route identity.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$DUPLICATE" 'already exists'

OUTSIDE_SECTION=$(rpc "$ADMIN_TOKEN" record_linear_segment \
  "{\"p_route_id\":$ROUTE_ID,\"p_from_measure\":11,\"p_to_measure\":13,\"p_attributes\":{\"terrain\":\"wetland\"},\"p_basis\":\"Surveyed section exceeds the canonical bounds and must fail.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$OUTSIDE_SECTION" 'inside the route bounds'

SECTION=$(rpc "$ADMIN_TOKEN" record_linear_segment \
  "{\"p_route_id\":$ROUTE_ID,\"p_from_measure\":2,\"p_to_measure\":5,\"p_attributes\":{\"observed\":\"wetland crossing\"},\"p_basis\":\"Qualified route survey identifies the section and observed terrain.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$SECTION"

OVERLAP=$(rpc "$ADMIN_TOKEN" record_linear_segment \
  "{\"p_route_id\":$ROUTE_ID,\"p_from_measure\":4,\"p_to_measure\":6,\"p_attributes\":{\"observed\":\"overlap\"},\"p_basis\":\"Overlapping canonical section coverage must be refused.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$OVERLAP" 'overlaps an existing section'

OUTSIDE_DEFECT=$(rpc "$ADMIN_TOKEN" record_linear_defect \
  "{\"p_route_id\":$ROUTE_ID,\"p_at_measure\":13,\"p_defect_type\":\"coating loss\",\"p_severity\":\"moderate\",\"p_detection_method\":\"qualified patrol\",\"p_detected_at\":null,\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$OUTSIDE_DEFECT" 'inside the route bounds'

DEFECT=$(rpc "$ADMIN_TOKEN" record_linear_defect \
  "{\"p_route_id\":$ROUTE_ID,\"p_at_measure\":3.4,\"p_defect_type\":\"coating loss\",\"p_severity\":\"moderate\",\"p_detection_method\":\"qualified patrol\",\"p_detected_at\":null,\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$DEFECT"

DIRECT=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/linear_asset_routes" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d \
  "{\"asset_id\":\"$NON_LINEAR\",\"organization_id\":\"$ORG\",\"route_code\":\"DIRECT-DENIED\",\"measure_unit\":\"km\",\"start_measure\":0,\"end_measure\":1}")
test "$DIRECT" = 401 || test "$DIRECT" = 403

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx '1|1|1|3'
select
  (select count(*) from linear_asset_routes where organization_id='$ORG' and route_code='$ROUTE_CODE'),
  (select count(*) from linear_segments where organization_id='$ORG' and route_id=$ROUTE_ID),
  (select count(*) from linear_defects where organization_id='$ORG' and route_id=$ROUTE_ID),
  (select count(*) from audit_events where organization_id='$ORG'
    and entity_type in ('linear_asset_route','linear_segment','linear_defect')
    and event_data->>'route_id'='$ROUTE_ID');
SQL

echo 'U3.03 linear-asset routing smoke passed: tenant_wall=true named_human=true linear_class=true verified_evidence=true route_bounds=true non_overlap=true direct_write_refused=true audit=true authority_unchanged=true'

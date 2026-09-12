#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U20.01 layered capability packs smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"
: "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999919'
BU='88900000-0000-0000-0000-000000000001'
SITE_NODE='88900000-0000-0000-0000-000000000002'
SITE='88900000-0000-0000-0000-000000000003'
ASSET='88900000-0000-0000-0000-000000000004'
FOREIGN_ASSET='88900000-0000-0000-0000-000000000005'

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"
}
rpc() {
  curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d "$3"
}
body() { printf '%s' "${1%$'\n'*}"; }
status() { printf '%s' "${1##*$'\n'}"; }

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$AUTHOR" && test -n "$EXEC" && test -n "$ADMIN"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
update organizations set industry='mining',jurisdiction='Alberta' where id='$ORG';
insert into organizations(id,name,industry,org_level,parent_id,jurisdiction)
values
  ('$BU','U20 Operations','mining','business_unit','$ORG','Alberta'),
  ('$SITE_NODE','U20 North Site Node','mining','site','$BU','Alberta')
on conflict(id) do update set parent_id=excluded.parent_id,org_level=excluded.org_level,jurisdiction=excluded.jurisdiction;
insert into sites(id,organization_id,name,location,organization_node_id)
values('$SITE','$ORG','U20 North Plant','Alberta','$SITE_NODE')
on conflict(id) do update set organization_node_id=excluded.organization_node_id;
insert into assets(id,organization_id,site_id,tag,name,asset_class)
values('$ASSET','$ORG','$SITE','U20-P-101','U20 Pump P-101','pump')
on conflict(id) do update set site_id=excluded.site_id;
insert into organizations(id,name,industry) values('$OTHER_ORG','U20 foreign tenant','mining') on conflict(id) do nothing;
insert into assets(id,organization_id,name,asset_class) values('$FOREIGN_ASSET','$OTHER_ORG','Foreign U20 asset','pump') on conflict(id) do nothing;
SQL

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/get_capability_pack_workspace" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'

author_and_adopt() {
  local token_value=$1 payload=$2 note=$3 response layer_id adopted
  response=$(rpc "$token_value" author_capability_pack_layer "{\"p_layer\":$payload}")
  test "$(status "$response")" = '200'
  layer_id=$(BODY="$(body "$response")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='draft' and not x['override_diff'],x; print(x['layer_id'])")
  adopted=$(rpc "$token_value" adopt_capability_pack_layer "{\"p_layer_id\":\"$layer_id\",\"p_note\":\"$note\"}")
  test "$(status "$adopted")" = '200'
  BODY="$(body "$adopted")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='adopted',x"
  printf '%s' "$layer_id"
}

CORE=$(author_and_adopt "$AUTHOR" \
  '{"layer_kind":"universal_core","title":"Governed universal core","configuration":{"human_approval_required":true,"evidence_provenance_required":true,"review_cadence_days":30},"evidence_basis":"SyncAI product governance contract reviewed for all tenant configurations."}' \
  'Human review confirms the universal governance controls and evidence basis.')

SECTOR_DRAFT=$(rpc "$EXEC" author_capability_pack_layer \
  '{"p_layer":{"layer_kind":"sector","title":"Mining sector controls","industry_code":"mining","configuration":{"review_cadence_days":21,"duty_basis":"operating_hours"},"evidence_basis":"Mining maintenance standard and duty-cycle evidence reviewed for this sector."}}')
test "$(status "$SECTOR_DRAFT")" = '200'
SECTOR_ID=$(BODY="$(body "$SECTOR_DRAFT")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert len(x['override_diff'])==1 and x['override_diff'][0]=={'key':'review_cadence_days','inherited':30,'proposed':21},x; assert x['approval_id']; print(x['layer_id'])")

SELF=$(rpc "$EXEC" decide_capability_pack_override \
  "{\"p_layer_id\":\"$SECTOR_ID\",\"p_outcome\":\"approved\",\"p_note\":\"The same author must never approve this exact override request.\"}")
test "$(status "$SELF")" = '200'
BODY="$(body "$SELF")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert 'cannot approve their own' in x.get('error',''),x"

BLOCKED=$(rpc "$EXEC" adopt_capability_pack_layer \
  "{\"p_layer_id\":\"$SECTOR_ID\",\"p_note\":\"Attempted adoption before independent override approval must be refused.\"}")
test "$(status "$BLOCKED")" = '200'
BODY="$(body "$BLOCKED")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert 'completed human approval' in x.get('error',''),x"

APPROVED=$(rpc "$ADMIN" decide_capability_pack_override \
  "{\"p_layer_id\":\"$SECTOR_ID\",\"p_outcome\":\"approved\",\"p_note\":\"Independent administrator reviewed the exact inherited and proposed values.\"}")
test "$(status "$APPROVED")" = '200'
SECTOR_ADOPT=$(rpc "$EXEC" adopt_capability_pack_layer \
  "{\"p_layer_id\":\"$SECTOR_ID\",\"p_note\":\"Executive adoption follows the completed independent exact-diff approval.\"}")
test "$(status "$SECTOR_ADOPT")" = '200'
BODY="$(body "$SECTOR_ADOPT")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='adopted',x"

JURISDICTION=$(author_and_adopt "$AUTHOR" \
  '{"layer_kind":"jurisdiction","title":"Alberta jurisdiction pack","jurisdiction":"Alberta","configuration":{"inspection_record_retention_years":10},"evidence_basis":"Applicable jurisdiction register and retention basis await customer legal confirmation."}' \
  'Human review confirms jurisdiction applicability while preserving legal validation limits.')
ENTERPRISE=$(author_and_adopt "$AUTHOR" \
  '{"layer_kind":"enterprise","title":"Enterprise reliability policy","configuration":{"failure_coding_taxonomy":"enterprise_v1"},"evidence_basis":"Enterprise reliability policy and approved taxonomy governance record reviewed."}' \
  'Human review confirms the enterprise policy and controlled taxonomy source.')
BUSINESS_UNIT=$(author_and_adopt "$AUTHOR" \
  "{\"layer_kind\":\"business_unit\",\"title\":\"Operations business-unit pack\",\"organization_node_id\":\"$BU\",\"configuration\":{\"planning_horizon_days\":90},\"evidence_basis\":\"Operations planning standard and current resource cadence were reviewed.\"}" \
  'Human review confirms the business-unit planning horizon and evidence basis.')
SITE_LAYER=$(author_and_adopt "$AUTHOR" \
  "{\"layer_kind\":\"site\",\"title\":\"North Plant pack\",\"site_id\":\"$SITE\",\"configuration\":{\"winterization_required\":true},\"evidence_basis\":\"Site climate exposure and approved winter readiness standard were reviewed.\"}" \
  'Human review confirms the site exposure control and approved readiness basis.')
ASSET_LAYER=$(author_and_adopt "$AUTHOR" \
  "{\"layer_kind\":\"asset\",\"title\":\"Pump P-101 pack\",\"asset_id\":\"$ASSET\",\"configuration\":{\"condition_route_days\":7},\"evidence_basis\":\"Asset criticality and current condition-monitoring route evidence were reviewed.\"}" \
  'Human review confirms the asset-specific route without granting work authority.')

READ=$(rpc "$AUTHOR" resolve_capability_pack_stack \
  "{\"p_asset_id\":\"$ASSET\",\"p_site_id\":null,\"p_node_id\":null,\"p_jurisdiction\":null,\"p_industry_code\":null}")
test "$(status "$READ")" = '200'
BODY="$(body "$READ")" ASSET="$ASSET" SITE="$SITE" BU="$BU" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
assert [r['layer'] for r in x['stack']]==['universal_core','sector','jurisdiction','enterprise','business_unit','site','asset'],x
assert x['context']['asset_id']==os.environ['ASSET'] and x['context']['site_id']==os.environ['SITE'],x
assert x['context']['organization_node_id'] is not None,x
assert x['effective_configuration']['human_approval_required'] is True,x
assert x['value_sources']['human_approval_required']['layer']=='universal_core',x
assert x['effective_configuration']['review_cadence_days']==21,x
assert x['value_sources']['review_cadence_days']['layer']=='sector',x
assert x['effective_configuration']['winterization_required'] is True,x
assert x['value_sources']['condition_route_days']['layer']=='asset',x
assert x['missing_layers']==[],x
assert 'cannot approve work' in x['authority'],x
PY

FOREIGN=$(rpc "$AUTHOR" resolve_capability_pack_stack \
  "{\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_site_id\":null,\"p_node_id\":null,\"p_jurisdiction\":null,\"p_industry_code\":null}")
test "$(status "$FOREIGN")" = '200'
BODY="$(body "$FOREIGN")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert 'not found in this tenant' in x.get('error',''),x"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx '7|1|approved'
select
  count(*) filter(where status='adopted'),
  count(*) filter(where jsonb_array_length(override_diff)>0),
  (select status from approvals where id=(select override_approval_id from capability_pack_layers where id='$SECTOR_ID'))
from capability_pack_layers where organization_id='$ORG' and id in ('$CORE','$SECTOR_ID','$JURISDICTION','$ENTERPRISE','$BUSINESS_UNIT','$SITE_LAYER','$ASSET_LAYER');
SQL

echo 'U20.01 layered capability packs smoke passed: seven_layers=true canonical_scope=true exact_override=true independent_approval=true tenant_wall=true deterministic_resolution=true no_auto_execution=true'

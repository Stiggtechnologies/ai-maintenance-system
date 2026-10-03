#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U3.17 canonical asset hierarchy smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999917'
SITE='93170000-0000-0000-0000-000000000001'
ASSET='93170000-0000-0000-0000-000000000002'
FOREIGN_ASSET='93170000-0000-0000-0000-000000000003'
EVIDENCE='93170000-0000-0000-0000-000000000004'
ASSEMBLY='93170000-0000-0000-0000-000000000005'
ITEM='93170000-0000-0000-0000-000000000006'
COMPONENT='93170000-0000-0000-0000-000000000007'
LEGACY='93170000-0000-0000-0000-000000000008'
MODE='93170000-0000-0000-0000-000000000009'

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
values('$OTHER_ORG','U3.17 foreign','utilities') on conflict(id) do nothing;
insert into sites(id,organization_id,name,location)
values('$SITE','$ORG','U3.17 North plant','Alberta') on conflict(id) do nothing;
insert into assets(id,organization_id,site_id,name,tag,system,area,functional_location) values
  ('$ASSET','$ORG','$SITE','U3.17 process pump','CI-U317-P-01','Water transfer','Pump house','FL-P-01'),
  ('$FOREIGN_ASSET','$OTHER_ORG',null,'Foreign asset','CI-U317-FR-01','Foreign system','Foreign area','FL-FR-01')
on conflict(id) do nothing;
insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,
  description,evidence_class)
values('$EVIDENCE','$ORG','$ASSET','approved-eam-export','asset-hierarchy',
  'Approved equipment breakdown and FMMEA component allocation','DOCUMENTED')
on conflict(id) do nothing;
insert into components(id,organization_id,asset_id,name,type)
values('$LEGACY','$ORG','$ASSET','Legacy seal','seal') on conflict(id) do nothing;
SQL

VERIFY=$(rpc "$ADMIN_TOKEN" verify_evidence_item \
  "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent CI hierarchy source review\",\"p_outcome\":\"verified\",\"p_note\":\"Verified for hierarchy identity and parentage only.\"}")
ok "$VERIFY"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -qAt -v ON_ERROR_STOP=1 <<SQL
insert into asset_service_levels(asset_id,organization_id,service_name,beneficiary,
  consequence_class,notes,basis,evidence_item_id,status,version,recorded_by,
  reviewed_by,reviewed_at,review_note)
values('$ASSET','$ORG','Process water','Operations','production',
  'Loss interrupts the governed process-water service.',
  'Approved service map with limitations stated in the evidence.','$EVIDENCE',
  'verified',1,(select id from auth.users where email='demo@syncai.ca'),
  (select id from auth.users where email='admin@syncai.ca'),now(),
  'Independent reviewer confirmed this service relationship for hierarchy use.')
on conflict(asset_id) do update set status=excluded.status,service_name=excluded.service_name,
  recorded_by=excluded.recorded_by,reviewed_by=excluded.reviewed_by,
  reviewed_at=excluded.reviewed_at,review_note=excluded.review_note;
insert into asset_failure_mode_libraries(id,organization_id,asset_id,failure_mode,
  failure_mechanism,cause,effect,source,canonical_asset_id,mechanism_id)
select '$MODE','$ORG','CI-U317-P-01','Fails to contain process fluid',d.name,
  'Seal-face damage','Loss of containment','governed-fmmea','$ASSET',d.id
from damage_mechanisms d where d.organization_id='$ORG' order by d.name limit 1
on conflict(id) do nothing;
SQL

test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/record_component_hierarchy_node" \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')" = 401

UNAUTHORIZED=$(rpc "$USER_TOKEN" record_component_hierarchy_node \
  "{\"p_asset_id\":\"$ASSET\",\"p_component_id\":null,\"p_name\":\"Pump train\",\"p_type\":\"assembly\",\"p_hierarchy_level\":\"assembly\",\"p_parent_component_id\":null,\"p_basis\":\"Unauthorized actor must not shape the hierarchy.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$UNAUTHORIZED" 'named same-tenant'

FOREIGN=$(rpc "$ADMIN_TOKEN" record_component_hierarchy_node \
  "{\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_component_id\":null,\"p_name\":\"Foreign assembly\",\"p_type\":\"assembly\",\"p_hierarchy_level\":\"assembly\",\"p_parent_component_id\":null,\"p_basis\":\"Foreign tenant asset must remain inaccessible.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$FOREIGN" 'canonical asset not found'

ASSEMBLY_RESULT=$(rpc "$ADMIN_TOKEN" record_component_hierarchy_node \
  "{\"p_asset_id\":\"$ASSET\",\"p_component_id\":null,\"p_name\":\"Pump train\",\"p_type\":\"rotating assembly\",\"p_hierarchy_level\":\"assembly\",\"p_parent_component_id\":null,\"p_basis\":\"Approved equipment breakdown identifies the pump train assembly.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$ASSEMBLY_RESULT"
ASSEMBLY_ID=$(BODY="$(body "$ASSEMBLY_RESULT")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['componentId'])")

NO_PARENT=$(rpc "$ADMIN_TOKEN" record_component_hierarchy_node \
  "{\"p_asset_id\":\"$ASSET\",\"p_component_id\":null,\"p_name\":\"Orphan component\",\"p_type\":\"seal\",\"p_hierarchy_level\":\"component\",\"p_parent_component_id\":null,\"p_basis\":\"A governed component may not skip its maintainable-item parent.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$NO_PARENT" 'must name its exact parent'

ITEM_RESULT=$(rpc "$ADMIN_TOKEN" record_component_hierarchy_node \
  "{\"p_asset_id\":\"$ASSET\",\"p_component_id\":null,\"p_name\":\"Seal cartridge\",\"p_type\":\"maintainable unit\",\"p_hierarchy_level\":\"maintainable_item\",\"p_parent_component_id\":\"$ASSEMBLY_ID\",\"p_basis\":\"Approved breakdown places the cartridge below the pump assembly.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$ITEM_RESULT"
ITEM_ID=$(BODY="$(body "$ITEM_RESULT")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['componentId'])")

COMPONENT_RESULT=$(rpc "$ADMIN_TOKEN" record_component_hierarchy_node \
  "{\"p_asset_id\":\"$ASSET\",\"p_component_id\":\"$LEGACY\",\"p_name\":\"Seal faces\",\"p_type\":\"wear interface\",\"p_hierarchy_level\":\"component\",\"p_parent_component_id\":\"$ITEM_ID\",\"p_basis\":\"Approved breakdown places the seal faces below the cartridge.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$COMPONENT_RESULT"

DIRECT=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/components?id=eq.$LEGACY" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"parent_component_id":null}')
test "$DIRECT" = 400 || test "$DIRECT" = 403

BIND=$(rpc "$ADMIN_TOKEN" bind_failure_mode_to_component \
  "{\"p_failure_mode_id\":\"$MODE\",\"p_component_id\":\"$LEGACY\",\"p_basis\":\"Approved FMMEA identifies loss of containment at the seal-face component.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$BIND"

DIRECT_MODE_DELETE=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE \
  "$API_URL/rest/v1/asset_failure_mode_libraries?id=eq.$MODE" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ADMIN_TOKEN")
test "$DIRECT_MODE_DELETE" = 400 || test "$DIRECT_MODE_DELETE" = 403

WORKSPACE=$(rpc "$ADMIN_TOKEN" get_canonical_asset_hierarchy_workspace '{}')
ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" ASSET="$ASSET" python3 -c \
  "import json,os;x=json.loads(os.environ['BODY']);a=next(i for i in x['assets'] if i['id']==os.environ['ASSET']);assert a['complete'] is True,a;assert a['gaps']==[],a;assert {c['level'] for c in a['components']} >= {'assembly','maintainable_item','component'},a;assert any(m['componentId'] for m in a['failureModes']),a;assert x['summary']['completePaths']>=1,x;assert 'no condition' in x['authority'].lower(),x"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -qAt -v ON_ERROR_STOP=1 <<SQL
update asset_failure_mode_libraries
set failure_mode='Fails to contain process fluid — revised identity'
where id='$MODE';
SQL

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx '3|0|5|1'
select count(*) filter(where hierarchy_recorded_at is not null),
  (select count(*) from asset_failure_mode_libraries where id='$MODE' and hierarchy_component_id='$LEGACY'),
  (select count(*) from audit_events where organization_id='$ORG' and entity_type='asset_hierarchy'),
  (select count(*) from audit_events where organization_id='$ORG' and entity_type='asset_hierarchy'
    and event_data->>'action'='failure_mode_binding_invalidated')
from components where organization_id='$ORG' and asset_id='$ASSET';
SQL

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx '3|1|64|64'
with snapshot as (select public.sync_data_steward_source_snapshot('$ORG') value)
select value->'components'->>'count',
  value->'failureModeHierarchy'->>'count',
  length(value->'components'->>'sha256'),
  length(value->'failureModeHierarchy'->>'sha256')
from snapshot;
SQL

echo 'U3.17 canonical asset hierarchy smoke passed: canonical_reuse=true exact_parentage=true tenant_wall=true named_human=true verified_evidence=true direct_write_refused=true governed_leaf_retained=true fmmea_leaf=true identity_change_invalidates_binding=true complete_path=true data_steward_fingerprint=true audit=true no_operating_authority=true'

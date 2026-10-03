#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U3.05 asset-classification smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999905'
ASSET='93050000-0000-0000-0000-000000000001'
FOREIGN_ASSET='93050000-0000-0000-0000-000000000002'
OTHER_ASSET='93050000-0000-0000-0000-000000000003'
EVIDENCE='93050000-0000-0000-0000-000000000011'
UNVERIFIED='93050000-0000-0000-0000-000000000012'
WRONG_ASSET_EVIDENCE='93050000-0000-0000-0000-000000000013'

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
values('$OTHER_ORG','U3.05 foreign','utilities') on conflict(id) do nothing;
insert into assets(id,organization_id,name,tag,asset_class) values
  ('$ASSET','$ORG','U3.05 governed bridge','CI-U305-BR-01','Bridge'),
  ('$OTHER_ASSET','$ORG','U3.05 other structure','CI-U305-ST-02','Structure'),
  ('$FOREIGN_ASSET','$OTHER_ORG','Foreign bridge','CI-U305-FR-01','Bridge')
on conflict(id) do nothing;
insert into evidence_items(
  id,organization_id,asset_id,source_system,evidence_type,description,evidence_class
) values
  ('$EVIDENCE','$ORG','$ASSET','owner-inspection-program','asset-register','Qualified bridge inventory and element inspection','INSPECTED'),
  ('$UNVERIFIED','$ORG','$ASSET','owner-inspection-program','asset-register','Unverified bridge classification source','DOCUMENTED'),
  ('$WRONG_ASSET_EVIDENCE','$ORG','$OTHER_ASSET','owner-inspection-program','asset-register','Verified evidence for a different asset','DOCUMENTED')
on conflict(id) do nothing;
SQL

VERIFY=$(rpc "$ADMIN_TOKEN" verify_evidence_item \
  "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent CI document and inspection review\",\"p_outcome\":\"verified\",\"p_note\":\"Verified only as asset classification evidence.\"}")
ok "$VERIFY"
VERIFY_WRONG=$(rpc "$ADMIN_TOKEN" verify_evidence_item \
  "{\"p_evidence_id\":\"$WRONG_ASSET_EVIDENCE\",\"p_method\":\"Independent CI document review\",\"p_outcome\":\"verified\",\"p_note\":\"Verified for the other canonical asset only.\"}")
ok "$VERIFY_WRONG"

test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/assign_asset_class_profile" \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')" = 401

FOREIGN=$(rpc "$ADMIN_TOKEN" assign_asset_class_profile \
  "{\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_class_key\":\"civil_structural\",\"p_basis\":\"Foreign tenant asset must remain inaccessible.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$FOREIGN" 'asset not found in this organization'

UNAUTHORIZED=$(rpc "$USER_TOKEN" assign_asset_class_profile \
  "{\"p_asset_id\":\"$ASSET\",\"p_class_key\":\"civil_structural\",\"p_basis\":\"A non-engineering role must not classify the asset.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$UNAUTHORIZED" 'named same-tenant reliability engineering'

NO_PROOF=$(rpc "$ADMIN_TOKEN" assign_asset_class_profile \
  "{\"p_asset_id\":\"$ASSET\",\"p_class_key\":\"civil_structural\",\"p_basis\":\"Unverified evidence must not establish the asset class.\",\"p_evidence_item_id\":\"$UNVERIFIED\"}")
err "$NO_PROOF" 'requires verified same-tenant'

WRONG_PROOF=$(rpc "$ADMIN_TOKEN" assign_asset_class_profile \
  "{\"p_asset_id\":\"$ASSET\",\"p_class_key\":\"civil_structural\",\"p_basis\":\"Evidence for another asset must not establish this class.\",\"p_evidence_item_id\":\"$WRONG_ASSET_EVIDENCE\"}")
err "$WRONG_PROOF" 'requires verified same-tenant'

SHORT_BASIS=$(rpc "$ADMIN_TOKEN" assign_asset_class_profile \
  "{\"p_asset_id\":\"$ASSET\",\"p_class_key\":\"civil_structural\",\"p_basis\":\"bridge\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$SHORT_BASIS" '20 characters minimum'

ASSIGNED=$(rpc "$ADMIN_TOKEN" assign_asset_class_profile \
  "{\"p_asset_id\":\"$ASSET\",\"p_class_key\":\"civil_structural\",\"p_basis\":\"Owner inventory and qualified inspection identify a civil structure; capacity remains unassessed.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$ASSIGNED"

BODY="$(body "$ASSIGNED")" python3 -c \
  "import json,os;x=json.loads(os.environ['BODY']);assert x['class_key']=='civil_structural';assert x['measurement_basis']=='structure';assert x['status']=='assigned';assert 'remain separate' in x['note']"

DIRECT=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/asset_class_assignments" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d \
  "{\"asset_id\":\"$OTHER_ASSET\",\"organization_id\":\"$ORG\",\"class_key\":\"civil_structural\"}")
test "$DIRECT" = 401 || test "$DIRECT" = 403

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx 'civil_structural|$EVIDENCE|1'
select a.class_key,a.evidence_item_id,
  (select count(*) from audit_events e
   where e.organization_id='$ORG'
     and e.entity_type='asset_class_assignment'
     and e.event_data->>'asset_id'='$ASSET')
from asset_class_assignments a
where a.organization_id='$ORG' and a.asset_id='$ASSET';
SQL

echo 'U3.05 asset-classification smoke passed: tenant_wall=true named_human=true verified_evidence=true asset_scope=true direct_write_refused=true audit=true authority_unchanged=true'

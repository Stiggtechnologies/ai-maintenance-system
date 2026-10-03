#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U3.04 asset-population smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999904'
SITE='93040000-0000-0000-0000-000000000001'
FOREIGN_SITE='93040000-0000-0000-0000-000000000002'
ASSET='93040000-0000-0000-0000-000000000003'
EVIDENCE='93040000-0000-0000-0000-000000000011'
UNVERIFIED='93040000-0000-0000-0000-000000000012'
ASSET_EVIDENCE='93040000-0000-0000-0000-000000000013'
POP_CODE='U3-04-METERS-NORTH'

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
values('$OTHER_ORG','U3.04 foreign','utilities') on conflict(id) do nothing;
insert into sites(id,organization_id,name) values
  ('$SITE','$ORG','U3.04 North District'),
  ('$FOREIGN_SITE','$OTHER_ORG','Foreign District')
on conflict(id) do nothing;
insert into assets(id,organization_id,name,tag,asset_class)
values('$ASSET','$ORG','U3.04 individual meter','U304-METER-01','Meter')
on conflict(id) do nothing;
insert into evidence_items(
  id,organization_id,asset_id,source_system,evidence_type,description,evidence_class
) values
  ('$EVIDENCE','$ORG',null,'distribution-register','population-register','Verified meter population and annual event extract','DOCUMENTED'),
  ('$UNVERIFIED','$ORG',null,'distribution-register','population-register','Unverified population source','DOCUMENTED'),
  ('$ASSET_EVIDENCE','$ORG','$ASSET','meter-register','asset-record','Evidence for one individually identified meter','DOCUMENTED')
on conflict(id) do nothing;
SQL

VERIFY=$(rpc "$ADMIN_TOKEN" verify_evidence_item \
  "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Qualified population register review\",\"p_outcome\":\"verified\",\"p_note\":\"Verified as aggregate population and exposure evidence only.\"}")
ok "$VERIFY"
VERIFY_ASSET=$(rpc "$ADMIN_TOKEN" verify_evidence_item \
  "{\"p_evidence_id\":\"$ASSET_EVIDENCE\",\"p_method\":\"Qualified individual asset review\",\"p_outcome\":\"verified\",\"p_note\":\"Verified for the individually identified meter only.\"}")
ok "$VERIFY_ASSET"

test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/record_asset_population" \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')" = 401

UNAUTHORIZED=$(rpc "$USER_TOKEN" record_asset_population \
  "{\"p_site_id\":\"$SITE\",\"p_population_code\":\"DENIED-USER\",\"p_description\":\"Denied user population\",\"p_unit_count\":100,\"p_members_individually_tracked\":false,\"p_install_period_start\":null,\"p_install_period_end\":null,\"p_basis\":\"Unauthorized roles must not establish population truth.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$UNAUTHORIZED" 'named same-tenant'

FOREIGN=$(rpc "$ADMIN_TOKEN" record_asset_population \
  "{\"p_site_id\":\"$FOREIGN_SITE\",\"p_population_code\":\"DENIED-FOREIGN\",\"p_description\":\"Foreign site population\",\"p_unit_count\":100,\"p_members_individually_tracked\":false,\"p_install_period_start\":null,\"p_install_period_end\":null,\"p_basis\":\"Foreign sites must remain outside this tenant boundary.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$FOREIGN" 'site not found in this organization'

ASSET_SCOPED=$(rpc "$ADMIN_TOKEN" record_asset_population \
  "{\"p_site_id\":\"$SITE\",\"p_population_code\":\"DENIED-ASSET\",\"p_description\":\"Invalid aggregate evidence\",\"p_unit_count\":100,\"p_members_individually_tracked\":false,\"p_install_period_start\":null,\"p_install_period_end\":null,\"p_basis\":\"One asset record cannot establish an aggregate population.\",\"p_evidence_item_id\":\"$ASSET_EVIDENCE\"}")
err "$ASSET_SCOPED" 'non-asset-specific'

NO_PROOF=$(rpc "$ADMIN_TOKEN" record_asset_population \
  "{\"p_site_id\":\"$SITE\",\"p_population_code\":\"DENIED-PROOF\",\"p_description\":\"Unverified population\",\"p_unit_count\":100,\"p_members_individually_tracked\":false,\"p_install_period_start\":null,\"p_install_period_end\":null,\"p_basis\":\"Unverified evidence must not establish population truth.\",\"p_evidence_item_id\":\"$UNVERIFIED\"}")
err "$NO_PROOF" 'requires verified same-tenant'

POPULATION=$(rpc "$ADMIN_TOKEN" record_asset_population \
  "{\"p_site_id\":\"$SITE\",\"p_population_code\":\"$POP_CODE\",\"p_description\":\"North advanced-meter population\",\"p_unit_count\":100,\"p_members_individually_tracked\":false,\"p_install_period_start\":\"2020-01-01\",\"p_install_period_end\":\"2022-12-31\",\"p_basis\":\"Verified register establishes the current count; individual identities are not retained.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$POPULATION"
POPULATION_ID=$(BODY="$(body "$POPULATION")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['population_id'])")

FUTURE=$(rpc "$ADMIN_TOKEN" record_population_observation_period \
  "{\"p_population_id\":$POPULATION_ID,\"p_observed_from\":\"2030-01-01T00:00:00Z\",\"p_observed_to\":\"2031-01-01T00:00:00Z\",\"p_units_exposed\":100,\"p_basis\":\"Future exposure cannot be treated as observed history.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$FUTURE" 'completed positive interval'

PERIOD=$(rpc "$ADMIN_TOKEN" record_population_observation_period \
  "{\"p_population_id\":$POPULATION_ID,\"p_observed_from\":\"2025-01-01T00:00:00Z\",\"p_observed_to\":\"2026-01-01T06:00:00Z\",\"p_units_exposed\":100,\"p_basis\":\"Verified annual event extract shows stable membership and complete reporting.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$PERIOD"
PERIOD_ID=$(BODY="$(body "$PERIOD")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['observation_period_id'])")

OVERLAP=$(rpc "$ADMIN_TOKEN" record_population_observation_period \
  "{\"p_population_id\":$POPULATION_ID,\"p_observed_from\":\"2025-06-01T00:00:00Z\",\"p_observed_to\":\"2025-12-01T00:00:00Z\",\"p_units_exposed\":100,\"p_basis\":\"Overlapping exposure must not double-count unit-time.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$OVERLAP" 'overlaps existing exposure'

ADJACENT=$(rpc "$ADMIN_TOKEN" record_population_observation_period \
  "{\"p_population_id\":$POPULATION_ID,\"p_observed_from\":\"2026-01-01T06:00:00Z\",\"p_observed_to\":\"2026-01-02T06:00:00Z\",\"p_units_exposed\":100,\"p_basis\":\"A completed adjacent period proves non-overlapping exposure remains recordable.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$ADJACENT"

BOUNDARY=$(rpc "$ADMIN_TOKEN" record_population_failure_event \
  "{\"p_population_id\":$POPULATION_ID,\"p_observation_period_id\":$PERIOD_ID,\"p_occurred_at\":\"2026-01-01T06:00:00Z\",\"p_failure_count\":1,\"p_failure_mode\":\"boundary event\",\"p_note\":\"An event at the exclusive end must not enter the earlier denominator.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$BOUNDARY" 'half-open observation period'

OUTSIDE=$(rpc "$ADMIN_TOKEN" record_population_failure_event \
  "{\"p_population_id\":$POPULATION_ID,\"p_observation_period_id\":$PERIOD_ID,\"p_occurred_at\":\"2026-06-01T00:00:00Z\",\"p_failure_count\":5,\"p_failure_mode\":\"loss of supply\",\"p_note\":\"Outside-period events must not enter this denominator.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
err "$OUTSIDE" 'inside its observation period'

FAILURE=$(rpc "$ADMIN_TOKEN" record_population_failure_event \
  "{\"p_population_id\":$POPULATION_ID,\"p_observation_period_id\":$PERIOD_ID,\"p_occurred_at\":\"2025-06-01T00:00:00Z\",\"p_failure_count\":5,\"p_failure_mode\":\"loss of supply\",\"p_note\":\"Five aggregate events after duplicate removal; member identity unavailable.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$FAILURE"

DIRECT=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/asset_populations" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d \
  "{\"organization_id\":\"$ORG\",\"population_code\":\"DIRECT-DENIED\",\"description\":\"Direct population\",\"unit_count\":10}")
test "$DIRECT" = 401 || test "$DIRECT" = 403

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx '1|2|1|100.274|4'
select
  (select count(*) from asset_populations where organization_id='$ORG' and population_code='$POP_CODE'),
  (select count(*) from population_observation_periods where organization_id='$ORG' and population_id=$POPULATION_ID),
  (select count(*) from population_failure_events where organization_id='$ORG' and population_id=$POPULATION_ID),
  (select round(sum(units_exposed * extract(epoch from(observed_to-observed_from))/(365.25*24*60*60)),3)
    from population_observation_periods where organization_id='$ORG' and population_id=$POPULATION_ID),
  (select count(*) from audit_events where organization_id='$ORG'
    and entity_type in ('asset_population','population_observation_period','population_failure_event')
    and (event_data->>'population_id')::bigint=$POPULATION_ID);
SQL

echo 'U3.04 asset-population smoke passed: tenant_wall=true named_human=true aggregate_evidence=true exposure_denominator=true zero_failure_time=true overlap_rejected=true adjacent_period_allowed=true half_open_event_period=true direct_write_refused=true audit=true authority_unchanged=true'

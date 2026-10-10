#!/usr/bin/env bash
set -euo pipefail
trap 'echo "SC-02 operating-picture smoke FAILED at line $LINENO"' ERR
# Isolated CI only; the SC-01 smoke seeds the foreign/technician/AI users.
[[ "${GITHUB_ACTIONS:-}" = true ]] || { echo 'Context smoke refuses execution outside isolated GitHub Actions.' >&2; exit 1; }
for transport_name in PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSFILE PSQLRC PGSYSCONFDIR DOCKER_HOST DOCKER_CONTEXT CONTAINER_HOST; do
  [[ -z "${!transport_name:-}" ]] || { echo "Context smoke refuses ambient transport configuration: $transport_name" >&2; exit 1; }
done
psqlc(){ env -i PATH="$PATH" PGPASSWORD=postgres PGHOSTADDR=127.0.0.1 PGCONNECT_TIMEOUT=5 psql -X -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
psqlfile(){ env -i PATH="$PATH" PGPASSWORD=postgres PGHOSTADDR=127.0.0.1 PGCONNECT_TIMEOUT=5 psql -X -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f "$1"; }
curl_local(){ env -i PATH="$PATH" curl -q --noproxy '*' --proxy '' --connect-timeout 5 --max-time 30 --max-redirs 0 --proto '=http' "$@"; }
# Credential discovery is pinned to the runner's local Docker socket. No eval,
# remote Docker context, proxy or ambient PostgreSQL transport is accepted.
STATUS_ENV=$(timeout 30s env -i PATH="$PATH" HOME="$HOME" DOCKER_HOST=unix:///var/run/docker.sock supabase status -o env)
API_URL=$(printf '%s\n' "$STATUS_ENV" | sed -n 's/^API_URL="\([^"]*\)"$/\1/p')
ANON_KEY=$(printf '%s\n' "$STATUS_ENV" | sed -n 's/^ANON_KEY="\([A-Za-z0-9_.-]*\)"$/\1/p')
: "${API_URL:?}" "${ANON_KEY:?}"
[[ "$API_URL" = http://127.0.0.1:54321 || "$API_URL" = http://localhost:54321 ]]
token(){ curl_local -fsS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl_local -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }
field(){ BODY="$(body "$1")" KEY="$2" python3 -c "import json,os;print(json.loads(os.environ['BODY'])[os.environ['KEY']])"; }
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-4999-8999-999999999931'
SITE_A='ee020000-0000-4000-8000-000000000101'
SITE_B='ee020000-0000-4000-8000-000000000102'
SITE_FOREIGN='ee020000-0000-4000-8000-000000000103'
ASSET_A='ee020000-0000-4000-8000-000000000111'
ASSET_B='ee020000-0000-4000-8000-000000000112'
EVIDENCE='98100000-0000-0000-0000-000000000021'
AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
FOREIGN=$(token 'sync-context-foreign@syncai.ca' 'Foreign123!@#')
TECH=$(token 'sync-context-tech@syncai.ca' 'Tech123!@#')
AI_ADMIN=$(token 'sync-context-ai-admin@syncai.ca' 'AiAdmin123!@#')
test -n "$AUTHOR" && test -n "$ADMIN" && test -n "$FOREIGN" && test -n "$TECH" && test -n "$AI_ADMIN"
psqlc "insert into sites(id,organization_id,name) values('$SITE_A','$ORG','SC-02 Site A'),('$SITE_B','$ORG','SC-02 Site B'),('$SITE_FOREIGN','$OTHER_ORG','SC-02 Foreign Site'); insert into assets(id,organization_id,site_id,name) values('$ASSET_A','$ORG','$SITE_A','SC-02 Asset A'),('$ASSET_B','$ORG','$SITE_B','SC-02 Asset B')" >/dev/null
SOURCE=$(psqlc "insert into connectors(organization_id,connector_key,name,connector_type,status,enabled,expected_interval_minutes) values('$ORG','sc02-api-gis','SC-02 synthetic API fixture','gis','active',true,15) returning id")
REGISTER=$(rpc "$ADMIN" register_context_source "{\"p_connector_id\":\"$SOURCE\",\"p_source_class\":\"customer_operational\",\"p_authority\":\"tenant_authorized\",\"p_purpose\":\"Isolated synthetic customer geometry to qualify canonical scoped reads.\",\"p_rights_state\":\"customer_authorized\",\"p_rights_reference\":\"SC02-ISOLATED-TEST\",\"p_basis\":\"Named CI administrator declares a synthetic test source; this is not a customer deployment or survey certification.\"}")
ok "$REGISTER"
# A registered source with no geometry or observation must remain repairable
# in organization inventory, not silently disappear with the site query.
UNUSED_SOURCE=$(psqlc "insert into connectors(organization_id,connector_key,name,connector_type,status,enabled,expected_interval_minutes) values('$ORG','sc02-api-unused-source','SC-02 unused synthetic source','gis','active',true,15) returning id")
UNUSED_REGISTER=$(rpc "$ADMIN" register_context_source "{\"p_connector_id\":\"$UNUSED_SOURCE\",\"p_source_class\":\"customer_operational\",\"p_authority\":\"tenant_authorized\",\"p_purpose\":\"Synthetic registered source with no connection, observation or geometry.\",\"p_rights_state\":\"customer_authorized\",\"p_rights_reference\":\"SC02-UNUSED-SYNTHETIC\",\"p_basis\":\"CI fixture only; source registration is not a successful transport check or a live customer feed.\"}")
ok "$UNUSED_REGISTER"
for WHO in "$AUTHOR" "$ADMIN" "$AI_ADMIN"; do
  INVENTORY=$(rpc "$WHO" get_sync_context_source_inventory '{}'); ok "$INVENTORY"
  BODY="$(body "$INVENTORY")" UNUSED_SOURCE="$UNUSED_SOURCE" ORG="$ORG" python3 -c 'import json,os
x=json.loads(os.environ["BODY"]); assert x["organizationId"]==os.environ["ORG"] and x["scope"]=="organization" and x["complete"] is True and x["operationalAuthority"] is False
s=next(s for s in x["sources"] if s["id"]==os.environ["UNUSED_SOURCE"])
assert s["reportedHealthState"]==s["state"]=="not_connected" and s["observedAt"] is None and s["observationAgeSeconds"] is None
assert s["canEmit"] is False and s["displayAsLive"] is False and s["lastSuccessfulCheckAt"] is None and s["coverage"]["state"]=="unknown"
assert all(s["organizationId"]==os.environ["ORG"] and not ({"config","endpoint","geometry","actions"}&s.keys()) for s in x["sources"])'
done
INVENTORY_TECH=$(rpc "$TECH" get_sync_context_source_inventory '{}'); err "$INVENTORY_TECH" 'forbidden'
INVENTORY_FOREIGN=$(rpc "$FOREIGN" get_sync_context_source_inventory '{}'); ok "$INVENTORY_FOREIGN"
BODY="$(body "$INVENTORY_FOREIGN")" OTHER_ORG="$OTHER_ORG" SOURCE="$SOURCE" UNUSED_SOURCE="$UNUSED_SOURCE" python3 -c 'import json,os
x=json.loads(os.environ["BODY"]); assert x["organizationId"]==os.environ["OTHER_ORG"]
assert all(s["organizationId"]==os.environ["OTHER_ORG"] and s["id"] not in (os.environ["SOURCE"],os.environ["UNUSED_SOURCE"]) for s in x["sources"])'
NOAUTH_INVENTORY=$(curl_local -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_sync_context_source_inventory" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')
test "$NOAUTH_INVENTORY" = 401
psqlfile scripts/tests/sync-context-source-inventory-gates.sql
CHECKED=$(psqlc "select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
OBSERVED=$(psqlc "select to_char(('$CHECKED'::timestamptz-interval '1 minute') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
HEALTH=$(rpc "$ADMIN" record_context_source_health "{\"p_connector_id\":\"$SOURCE\",\"p_state\":\"connected\",\"p_checked_at\":\"$CHECKED\",\"p_observed_at\":\"$OBSERVED\",\"p_detail\":\"Synthetic fixture is connected, not a live field feed.\"}")
ok "$HEALTH"
COORDINATE='"coordinate":{"referenceSystem":"EPSG:4326","axisOrder":"longitude_latitude","basis":"Synthetic source explicitly declares longitude/latitude WGS84 encoding.","horizontalAccuracyM":null}'
# Same coordinates at different canonical sites: proximity cannot determine scope.
for SUFFIX in a b c; do
  CREATED=$(rpc "$AUTHOR" record_geospatial_feature "{\"p_feature\":{$COORDINATE,\"feature_type\":\"asset\",\"feature_key\":\"sc02-api-$SUFFIX\",\"name\":\"SC-02 synthetic $SUFFIX\",\"geometry_type\":\"Point\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[-111.38,56.73]},\"source_connector_id\":\"$SOURCE\",\"source_reference\":\"SC02-TEST-$SUFFIX\",\"observed_at\":\"$OBSERVED\",\"validity_kind\":\"permanent\",\"data_quality\":\"good\",\"evidence_item_ids\":[\"$EVIDENCE\"]}}")
  ok "$CREATED"; ID=$(field "$CREATED" feature_id)
  VERIFIED=$(rpc "$ADMIN" verify_geospatial_feature "{\"p_feature_id\":\"$ID\",\"p_note\":\"Independent synthetic fixture review; no real survey suitability or operational authority is asserted.\"}")
  ok "$VERIFIED"
  ASSET="$ASSET_A"; [[ "$SUFFIX" != b ]] || ASSET="$ASSET_B"
  LINK=$(rpc "$AUTHOR" link_geospatial_subject "{\"p_link\":{\"feature_id\":\"$ID\",\"relationship_type\":\"located_at\",\"asset_id\":\"$ASSET\",\"basis\":\"Canonical asset membership, never coordinate proximity, determines this test site scope.\"}}")
  ok "$LINK"
done
NOAUTH=$(curl_local -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_sync_context_operating_picture" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')
test "$NOAUTH" = 401
FOREIGN_SCOPE=$(rpc "$FOREIGN" get_sync_context_operating_picture "{\"p_site_id\":\"$SITE_A\"}"); err "$FOREIGN_SCOPE" 'site not available'
LOCAL_FOREIGN=$(rpc "$AUTHOR" get_sync_context_operating_picture "{\"p_site_id\":\"$SITE_FOREIGN\"}"); err "$LOCAL_FOREIGN" 'site not available'
MISSING_SCOPE=$(rpc "$AUTHOR" get_sync_context_operating_picture '{"p_site_id":"ee020000-0000-4000-8000-000000000199"}'); err "$MISSING_SCOPE" 'site not available'
test "$(body "$LOCAL_FOREIGN")" = "$(body "$MISSING_SCOPE")"
for PAYLOAD in '{"p_object_limit":0}' '{"p_object_limit":501}' '{"p_object_limit":null}' '{"p_event_limit":-1}' '{"p_event_limit":501}' '{"p_event_limit":null}'; do
  REFUSED=$(rpc "$AUTHOR" get_sync_context_operating_picture "$PAYLOAD"); err "$REFUSED" 'invalid operating scope limits'
done
READ_BEFORE=$(psqlc "select (select count(*) from audit_events)||'|'||(select count(*) from approvals)||'|'||(select count(*) from work_orders)||'|'||(select md5(coalesce(jsonb_agg(to_jsonb(f) order by f.id)::text,'')) from geospatial_features f)")
VIEW_A=$(rpc "$AUTHOR" get_sync_context_operating_picture "{\"p_site_id\":\"$SITE_A\",\"p_object_limit\":1,\"p_event_limit\":0}"); ok "$VIEW_A"
BODY="$(body "$VIEW_A")" SITE_A="$SITE_A" ASSET_A="$ASSET_A" python3 -c 'import json,os
x=json.loads(os.environ["BODY"]); assert x["scope"]=={"siteId":os.environ["SITE_A"],"objectLimit":1,"eventLimit":0}; assert x["operationalAuthority"] is False
assert len(x["objects"])==1 and x["coverage"]["objects"]["eligible"]==2 and x["coverage"]["objects"]["truncated"] is True
assert x["coverage"]["events"]=={"eligible":2,"returned":0,"truncated":True}; assert x["events"]==[]
assert x["objects"][0]["subjects"]==[{"type":"asset","id":os.environ["ASSET_A"]}]; assert x["objects"][0]["coordinate"]["horizontalAccuracyM"] is None
assert sum(l["eligibleCount"] for l in x["layers"] if l["renderMode"]!="event")==2; assert all(s["displayAsLive"] is False for s in x["sources"])'
VIEW_B=$(rpc "$AUTHOR" get_sync_context_operating_picture "{\"p_site_id\":\"$SITE_B\"}"); ok "$VIEW_B"
BODY="$(body "$VIEW_B")" ASSET_B="$ASSET_B" python3 -c 'import json,os
x=json.loads(os.environ["BODY"]); assert len(x["objects"])==1 and x["coverage"]["objects"]["eligible"]==1
assert x["objects"][0]["subjects"]==[{"type":"asset","id":os.environ["ASSET_B"]}]; assert len(x["events"])==1 and "geometry" not in x["events"][0]'
for WHO in "$TECH" "$AI_ADMIN"; do
  VIEW=$(rpc "$WHO" get_sync_context_operating_picture "{\"p_site_id\":\"$SITE_A\"}"); ok "$VIEW"
  BODY="$(body "$VIEW")" IS_TECH="$([[ "$WHO" != "$TECH" ]] && echo false || echo true)" python3 -c 'import json,os
x=json.loads(os.environ["BODY"])
if os.environ["IS_TECH"]=="true": assert not x["sources"] and not x["objects"] and all(l["authorized"] is False for l in x["layers"])
else: assert x["coverage"]["objects"]["eligible"]==2'
done
READ_AFTER=$(psqlc "select (select count(*) from audit_events)||'|'||(select count(*) from approvals)||'|'||(select count(*) from work_orders)||'|'||(select md5(coalesce(jsonb_agg(to_jsonb(f) order by f.id)::text,'')) from geospatial_features f)")
test "$READ_BEFORE" = "$READ_AFTER"
psqlfile scripts/tests/sync-context-operating-picture-gates.sql
REVOKED=$(rpc "$ADMIN" transition_context_source_rights "{\"p_connector_id\":\"$SOURCE\",\"p_rights_state\":\"blocked\",\"p_rights_reference\":\"SC02-TEST-REVOKED\",\"p_basis\":\"Named administrator withdraws these synthetic source rights to qualify immediate read-time revocation.\"}"); ok "$REVOKED"
AFTER_REVOKE=$(rpc "$AUTHOR" get_sync_context_operating_picture "{\"p_site_id\":\"$SITE_A\"}"); ok "$AFTER_REVOKE"
REVOKED_INVENTORY=$(rpc "$AUTHOR" get_sync_context_source_inventory '{}'); ok "$REVOKED_INVENTORY"
BODY="$(body "$REVOKED_INVENTORY")" SOURCE="$SOURCE" python3 -c 'import json,os
x=json.loads(os.environ["BODY"]); s=next(s for s in x["sources"] if s["id"]==os.environ["SOURCE"])
assert s["rightsState"]=="blocked" and s["rightsPermit"] is False and s["canEmit"] is False and s["displayAsLive"] is False
assert s["lastSuccessfulCheckAt"] is None and s["lastSuccessfulCheckBasis"]=="unknown_no_transport_receipt"'
BODY="$(body "$AFTER_REVOKE")" python3 -c 'import json,os
x=json.loads(os.environ["BODY"]); assert x["objects"]==[] and x["events"]==[] and x["coverage"]["objects"]["rightsBlocked"]==2
l=next(l for l in x["layers"] if l["id"]=="assets_sites"); assert l["availability"]=="unavailable" and l["empty"] is False and l["candidateCount"]==2 and l["eligibleCount"]==0'
echo 'SC-02 authenticated scoped operating-picture smoke passed: independent_feature_review=true canonical_site_membership=true two_tenant_refusals=true no_existence_oracle=true exact_limits=true read_only=true revocation_not_empty=true'
echo 'SC-02 authenticated organization-source inventory smoke passed: unused_not_connected=true blocked_visible=true two_tenants=true no_geometry_or_config=true check_success_unknown=true'

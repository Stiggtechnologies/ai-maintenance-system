#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Azure IoT Operations ingress smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
: "${API_URL:?}"
: "${ANON_KEY:?}"
: "${SERVICE_ROLE_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999917'
ASSET='88888888-0000-0000-0000-000000000051'
SENSOR='88888888-0000-0000-0000-000000000052'
RUN_SUFFIX=$(printf '%05d%05d' "$RANDOM" "$RANDOM")
CONNECTOR="aio-smoke-$RUN_SUFFIX"
KEY_ID="aio-smoke-key-$RUN_SUFFIX"
TAG="mine-a/pump-101/vibration-$RUN_SUFFIX"
EXTERNAL_ID="0:100:vibration:$RUN_SUFFIX"
DELIVERY="partition-0:offset-100:offset-100:$RUN_SUFFIX"
DIGEST='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
SOURCE_TS=$(python3 -c 'from datetime import datetime, timedelta, timezone; print((datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat().replace("+00:00", "Z"))')
RECEIVED_TS=$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))')

ADMIN_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atqc \
  "select id from auth.users where email='admin@syncai.ca' limit 1")
test -n "$ADMIN_ID"
USER_TOKEN=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"admin@syncai.ca","password":"Admin123!@#"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))")
test -n "$USER_TOKEN"

rpc_user() {
  curl -sS -X POST "$API_URL/rest/v1/rpc/$1" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H 'Content-Type: application/json' -d "$2"
}

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into public.organizations(id,name,industry)
values('$OTHER_ORG','AIO foreign smoke tenant','testing') on conflict(id) do nothing;
delete from public.condition_readings where organization_id='$ORG' and sensor_id='$SENSOR';
insert into public.assets(id,organization_id,name,criticality)
values('$ASSET','$ORG','AIO smoke pump','critical') on conflict(id) do nothing;
insert into public.sensors(id,organization_id,asset_id,name,signal_type,unit)
values('$SENSOR','$ORG','$ASSET','AIO smoke vibration','vibration','mm/s')
on conflict(id) do nothing;
SQL

MAP=$(rpc_user confirm_historian_tag_mapping \
  "{\"p_mapping_id\":null,\"p_historian_tag\":\"$TAG\",\"p_asset_id\":\"$ASSET\",\"p_sensor_id\":\"$SENSOR\",\"p_measurement\":\"velocity\",\"p_unit\":\"mm/s\",\"p_source_system\":\"$CONNECTOR\",\"p_basis\":\"Named-human confirmation against the Event Hubs source and canonical sensor.\",\"p_expected_version\":null}")
BODY="$MAP" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
assert x['status']=='confirmed', x
PY

CONFIG=$(rpc_user configure_azure_iot_operations_source \
  "{\"p_key\":\"$CONNECTOR\",\"p_name\":\"AIO smoke source\",\"p_event_hubs_namespace\":\"syncaismoke.servicebus.windows.net\",\"p_event_hub_name\":\"opcua\",\"p_expected_interval_minutes\":1,\"p_ingress_key_id\":\"$KEY_ID\",\"p_credential_binding_ref\":\"keyvault://smoke/aio\",\"p_context_purpose\":\"Smoke condition evidence\",\"p_rights_reference\":\"SMOKE-DPA-01\",\"p_enabled\":true,\"p_basis\":\"Smoke customer authorizes receiver-only telemetry for deterministic contract verification.\"}")
BODY="$CONFIG" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
assert x['ok'] is True and x['enabled'] is True, x
assert x['direction']=='read_only' and x['write_enabled'] is False, x
assert x['confirmed_tag_mappings']==1, x
PY

rpc_service() {
  curl -sS -w '\n%{http_code}' -X POST \
    "$API_URL/rest/v1/rpc/ingest_azure_iot_operations_batch" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' -d "$1"
}

SUCCESS=$(rpc_service "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$CONNECTOR\",\"p_ingress_key_id\":\"$KEY_ID\",\"p_delivery_id\":\"$DELIVERY\",\"p_body_sha256\":\"$DIGEST\",\"p_received_at\":\"$RECEIVED_TS\",\"p_points\":[{\"external_id\":\"$EXTERNAL_ID\",\"tag\":\"$TAG\",\"value\":4.2,\"source_timestamp\":\"$SOURCE_TS\",\"quality\":\"good\",\"partition_id\":\"0\",\"offset\":\"100\",\"sequence_number\":\"100\"}]}")
test "${SUCCESS##*$'\n'}" = '200'
BODY="${SUCCESS%$'\n'*}" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
assert x['ok'] is True and x['replayed'] is False, x
assert x['status']=='success' and x['read']==1 and x['accepted']==1, x
assert x['rejected']==0 and x['watermark_advanced'] is True, x
PY

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atq \
  -c "select context_health_state from public.connectors where organization_id='$ORG' and connector_key='$CONNECTOR'" \
  | grep -qx 'live'

CONTEXT=$(curl -sS -X POST "$API_URL/rest/v1/rpc/get_contextual_condition_monitoring" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"p_window_days":365,"p_limit":100}')
BODY="$CONTEXT" CONNECTOR="$CONNECTOR" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
rows=[r for r in x['readings'] if r.get('source_system')==os.environ['CONNECTOR']]
assert rows and all(r['source_posture']=='connector_backed' for r in rows), x
assert os.environ['CONNECTOR'] in x['source']['connector_keys'], x['source']
PY

BEFORE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atq \
  -c "select last_value from public.sensors where id='$SENSOR'")
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atq \
  -c 'select public.simulate_telemetry_tick();' >/dev/null
AFTER=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atq \
  -c "select last_value from public.sensors where id='$SENSOR'")
test "$BEFORE" = "$AFTER"

REPLAY=$(rpc_service "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$CONNECTOR\",\"p_ingress_key_id\":\"$KEY_ID\",\"p_delivery_id\":\"$DELIVERY\",\"p_body_sha256\":\"$DIGEST\",\"p_received_at\":\"$RECEIVED_TS\",\"p_points\":[{\"external_id\":\"$EXTERNAL_ID\",\"tag\":\"$TAG\",\"value\":4.2,\"source_timestamp\":\"$SOURCE_TS\"}]}")
test "${REPLAY##*$'\n'}" = '200'
BODY="${REPLAY%$'\n'*}" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
assert x['ok'] is True and x['replayed'] is True, x
PY

PARTIAL=$(rpc_service "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$CONNECTOR\",\"p_ingress_key_id\":\"$KEY_ID\",\"p_delivery_id\":\"partition-0:offset-101:offset-101:1\",\"p_body_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"p_received_at\":\"$RECEIVED_TS\",\"p_points\":[{\"external_id\":\"0:101:unknown\",\"tag\":\"mine-a/pump-101/unapproved\",\"value\":9.9,\"source_timestamp\":\"$SOURCE_TS\"}]}")
test "${PARTIAL##*$'\n'}" = '200'
BODY="${PARTIAL%$'\n'*}" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
assert x['status']=='partial' and x['read']==1 and x['accepted']==0, x
assert x['rejected']==1 and x['watermark_advanced'] is False, x
PY

FOREIGN=$(rpc_service "{\"p_organization_id\":\"$OTHER_ORG\",\"p_connector_key\":\"$CONNECTOR\",\"p_ingress_key_id\":\"$KEY_ID\",\"p_delivery_id\":\"foreign-attempt-0001\",\"p_body_sha256\":\"$DIGEST\",\"p_received_at\":\"$RECEIVED_TS\",\"p_points\":[{\"external_id\":\"foreign:1\",\"tag\":\"$TAG\",\"value\":99,\"source_timestamp\":\"$SOURCE_TS\"}]}")
test "${FOREIGN##*$'\n'}" = '200'
BODY="${FOREIGN%$'\n'*}" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
assert 'error' in x and 'not found' in x['error'], x
PY

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/ingest_azure_iot_operations_batch" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" != '200'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 <<SQL | grep -qx '1|1|1|partial_coverage|1'
select
  (select count(*) from public.condition_readings where organization_id='$ORG' and source_system='$CONNECTOR' and external_id='$EXTERNAL_ID'),
  (select count(*) from public.connector_runs where organization_id='$ORG' and source_delivery_id='$DELIVERY'),
  (select count(*) from public.ingest_staging s join public.connectors c on c.id=s.connector_id
    where s.organization_id='$ORG' and c.connector_key='$CONNECTOR'
      and s.status='rejected' and s.reject_reason like 'tag has no named-human%'),
  (select context_health_state from public.connectors where organization_id='$ORG' and connector_key='$CONNECTOR'),
  (select count(*) from public.ingest_watermarks w join public.connectors c on c.id=w.connector_id where c.organization_id='$ORG' and c.connector_key='$CONNECTOR');
SQL

echo 'Azure IoT Operations ingress smoke passed: service_only=true tenant_wall=true human_mapping=true replay_safe=true rejects_retained=true watermark_fail_closed=true source_label=true simulator_yield=true read_only=true'

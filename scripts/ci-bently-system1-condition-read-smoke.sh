#!/usr/bin/env bash
# C2.19 — service-attested Bently Nevada System 1 condition-data read.
set -euo pipefail
trap 'echo "C2.19 System 1 condition read smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
CONNECTOR_KEY="c219-system1-$RANDOM"
TAG="C219-VIB-$(date +%s)-$$"
NODE='ns=2;s=Plant/P101/DE/Vibration'
FETCH_ONE=$(python3 -c 'from datetime import datetime,timezone,timedelta; print((datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat().replace("+00:00","Z"))')
FETCH_TWO=$(python3 -c 'from datetime import datetime,timezone,timedelta; print((datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat().replace("+00:00","Z"))')
TAKEN_ONE=$(python3 -c 'from datetime import datetime,timezone,timedelta; print((datetime.now(timezone.utc)-timedelta(minutes=4)).isoformat().replace("+00:00","Z"))')
TAKEN_TWO=$(python3 -c 'from datetime import datetime,timezone,timedelta; print((datetime.now(timezone.utc)-timedelta(minutes=3)).isoformat().replace("+00:00","Z"))')
TAKEN_THREE=$(python3 -c 'from datetime import datetime,timezone,timedelta; print((datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat().replace("+00:00","Z"))')
DIGEST_ONE=$(python3 -c "import hashlib; print(hashlib.sha256(('a'*64).encode()).hexdigest())")
DIGEST_TWO=$(python3 -c "import hashlib; print(hashlib.sha256(('b'*64).encode()).hexdigest())")

token(){ local r; r=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$r" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
service_rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$1" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' -d "$2"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; x=json.loads(os.environ['BODY']); v=x.get(os.environ['KEY']); print('' if v is None else str(v).lower() if isinstance(v,bool) else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else 'unexpected response'; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
ENGINEER=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$ADMIN"; test -n "$ENGINEER"
ADMIN_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
ENGINEER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='demo@syncai.ca'")
ASSET=$(psqlc "select id from assets where organization_id='$ORG' order by created_at limit 1")
test -n "$ADMIN_ID"; test -n "$ENGINEER_ID"; test -n "$ASSET"

SENSOR_BODY=$(rpc "$ENGINEER" upsert_condition_sensor "{\"p_sensor_id\":null,\"p_asset_id\":\"$ASSET\",\"p_sensor_tag\":\"$TAG\",\"p_name\":\"C2.19 System 1 drive-end vibration\",\"p_signal_type\":\"vibration_velocity\",\"p_unit\":\"mm/s\",\"p_detection_technique\":\"Bently Nevada System 1 OPC UA gateway\",\"p_warning_limit\":5,\"p_alarm_limit\":8,\"p_limit_direction\":\"above\",\"p_source_system\":\"SYSTEM1\",\"p_basis\":\"Approved instrument index and named engineering review for the C2.19 System 1 measurement point.\",\"p_expected_version\":null}")
noerr "$SENSOR_BODY"; SENSOR=$(field "$SENSOR_BODY" sensorId); test -n "$SENSOR"
BINDINGS="[{\"nodeId\":\"$NODE\",\"sensorId\":\"$SENSOR\",\"unit\":\"mm/s\"}]"
BASE="{\"p_key\":\"$CONNECTOR_KEY\",\"p_name\":\"C2.19 governed System 1\",\"p_endpoint\":\"https://system1-gateway.example.com/syncai/v1/system1/readings\",\"p_credential_binding_ref\":\"vault://tenant/system1-read\",\"p_node_bindings\":$BINDINGS,\"p_max_rows\":100,\"p_page_size\":50,\"p_max_pages\":5,\"p_expected_interval_minutes\":60,\"p_enabled\":true,\"p_basis\":\"Reliability engineering approved the exact gateway, System 1 node, canonical sensor and engineering unit mapping.\"}"

expect_error "$(rpc "$ENGINEER" configure_bently_system1_source "$BASE")" 'requires an administrator'
BAD_UNIT="${BASE/mm\/s/ips}"
expect_error "$(rpc "$ADMIN" configure_bently_system1_source "$BAD_UNIT")" 'does not match canonical sensor unit'
BAD_ENDPOINT="${BASE/https:\/\/system1-gateway.example.com/https:\/\/192.168.1.50}"
expect_error "$(rpc "$ADMIN" configure_bently_system1_source "$BAD_ENDPOINT")" 'private/local targets are blocked'
CONFIGURED=$(rpc "$ADMIN" configure_bently_system1_source "$BASE"); noerr "$CONFIGURED"
CONFIGURED_ENABLED=$(field "$CONFIGURED" enabled)
CONFIGURED_WRITE_ENABLED=$(field "$CONFIGURED" write_enabled)
if test "$CONFIGURED_ENABLED" != 'true' || test "$CONFIGURED_WRITE_ENABLED" != 'false'; then
  printf 'configured System 1 response did not reflect persisted read-only state: %s\n' "$CONFIGURED" >&2
  exit 1
fi
test "$(psqlc "select enabled::text||'|'||write_enabled::text from connectors where organization_id='$ORG' and connector_key='$CONNECTOR_KEY'")" = 'true|false'
test "$(field "$CONFIGURED" source_profile)" = 'bently_system1_opcua_gateway'
SOURCE=$(rpc "$ENGINEER" get_bently_system1_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}"); noerr "$SOURCE"
test "$(field "$SOURCE" can_commit)" = 'true'; test "$(field "$SOURCE" direction)" = 'read_only'
CONTRACT_HASH=$(field "$SOURCE" contract_hash); test ${#CONTRACT_HASH} = 64
test "$(psqlc "select has_function_privilege('authenticated','public.begin_bently_system1_read_run(uuid,uuid,text,text,jsonb,jsonb,bigint)','execute');")" = 'f'
test "$(psqlc "select has_function_privilege('service_role','public.begin_bently_system1_read_run(uuid,uuid,text,text,jsonb,jsonb,bigint)','execute');")" = 't'

MANIFEST_ONE="[{\"transport\":\"system1_gateway_v1\",\"resource\":\"readings\",\"page\":1,\"cursor_in\":null,\"cursor_out\":null,\"complete\":true,\"row_count\":2,\"bytes\":180,\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}]"
CURSOR_ONE="{\"fetched_at\":\"$FETCH_ONE\",\"max_taken_at\":\"$TAKEN_TWO\",\"raw_rows\":2,\"mapped_rows\":2,\"pages\":1,\"source_digest\":\"$DIGEST_ONE\",\"contract_hash\":\"$CONTRACT_HASH\"}"
expect_error "$(service_rpc begin_bently_system1_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$ENGINEER_ID\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_contract_hash\":\"$(printf '0%.0s' {1..64})\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":180}")" 'contract changed'
psqlc "update user_profiles set role='ai_admin' where id='$ADMIN_ID'" >/dev/null
expect_error "$(rpc "$ADMIN" configure_bently_system1_source "$BASE")" 'named human administrator'
expect_error "$(service_rpc begin_bently_system1_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$ADMIN_ID\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_contract_hash\":\"$CONTRACT_HASH\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":180}")" 'not authorized'
psqlc "update user_profiles set role='admin' where id='$ADMIN_ID'" >/dev/null

BEGIN_ONE=$(service_rpc begin_bently_system1_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$ENGINEER_ID\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_contract_hash\":\"$CONTRACT_HASH\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":180}"); noerr "$BEGIN_ONE"; RUN_ONE=$(field "$BEGIN_ONE" run_id)
EXT_ONE="system1:${TAG}:1"; EXT_TWO="system1:${TAG}:2"
ROWS_ONE="[{\"external_id\":\"$EXT_ONE\",\"sensor_id\":\"$SENSOR\",\"value\":9,\"taken_at\":\"$TAKEN_ONE\",\"quality\":\"good\"},{\"external_id\":\"$EXT_TWO\",\"sensor_id\":\"$SENSOR\",\"value\":1,\"taken_at\":\"$TAKEN_TWO\",\"quality\":\"evil\"}]"
INGEST_ONE=$(service_rpc ingest_bently_system1_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$ENGINEER_ID\",\"p_run_id\":\"$RUN_ONE\",\"p_actor_aal\":\"aal1\",\"p_rows\":$ROWS_ONE}"); noerr "$INGEST_ONE"
test "$(field "$INGEST_ONE" accepted)" = '1'; test "$(field "$INGEST_ONE" rejected)" = '1'
expect_error "$(service_rpc finish_bently_system1_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_ONE\",\"p_status\":\"success\",\"p_error\":null}")" 'refused rows'
FINISH_ONE=$(service_rpc finish_bently_system1_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_ONE\",\"p_status\":\"partial\",\"p_error\":\"invalid quality retained for review\"}"); noerr "$FINISH_ONE"
test "$(field "$FINISH_ONE" watermark_advanced)" = 'false'

MANIFEST_TWO="${MANIFEST_ONE//aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
CURSOR_TWO="{\"fetched_at\":\"$FETCH_TWO\",\"max_taken_at\":\"$TAKEN_THREE\",\"raw_rows\":2,\"mapped_rows\":2,\"pages\":1,\"source_digest\":\"$DIGEST_TWO\",\"contract_hash\":\"$CONTRACT_HASH\"}"
BEGIN_TWO=$(service_rpc begin_bently_system1_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$ENGINEER_ID\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_contract_hash\":\"$CONTRACT_HASH\",\"p_manifest\":$MANIFEST_TWO,\"p_cursor_to\":$CURSOR_TWO,\"p_source_bytes\":180}"); noerr "$BEGIN_TWO"; RUN_TWO=$(field "$BEGIN_TWO" run_id)
ROWS_TWO="[{\"external_id\":\"$EXT_ONE\",\"sensor_id\":\"$SENSOR\",\"value\":9,\"taken_at\":\"$TAKEN_ONE\",\"quality\":\"good\"},{\"external_id\":\"$EXT_TWO\",\"sensor_id\":\"$SENSOR\",\"value\":1,\"taken_at\":\"$TAKEN_THREE\",\"quality\":\"suspect\"}]"
INGEST_TWO=$(service_rpc ingest_bently_system1_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$ENGINEER_ID\",\"p_run_id\":\"$RUN_TWO\",\"p_actor_aal\":\"aal1\",\"p_rows\":$ROWS_TWO}"); noerr "$INGEST_TWO"
test "$(field "$INGEST_TWO" accepted)" = '1'; test "$(field "$INGEST_TWO" duplicate)" = '1'; test "$(field "$INGEST_TWO" rejected)" = '0'
FINISH_TWO=$(service_rpc finish_bently_system1_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_TWO\",\"p_status\":\"success\",\"p_error\":null}"); noerr "$FINISH_TWO"
test "$(field "$FINISH_TWO" watermark_advanced)" = 'true'

test "$(psqlc "select count(*) from condition_readings where organization_id='$ORG' and source_system='$CONNECTOR_KEY' and external_id in ('$EXT_ONE','$EXT_TWO')")" = '2'
test "$(psqlc "select count(*) from condition_readings where organization_id='$ORG' and external_id='$EXT_TWO' and quality='suspect'")" = '1'
test "$(psqlc "select count(*) from condition_alerts where organization_id='$ORG' and sensor_id='$SENSOR' and cleared_at is null")" = '1'
test "$(psqlc "select count(*) from ingest_watermarks where organization_id='$ORG' and last_run_id='$RUN_TWO' and entity_type='condition_reading'")" = '1'

OUT=$(sql_must_fail "update connectors set write_enabled=true where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'connectors_system1_read_profile_check' <<<"$OUT"
DIRECT=$(sql_must_fail "insert into connector_runs(organization_id,connector_id,entity_type,run_type,status) select '$ORG',id,'condition_reading','sync','running' from connectors where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'service-attested complete transport evidence' <<<"$DIRECT"
test "$(psqlc "select count(*) from decisions where organization_id='$ORG' and decision_type='bently_system1_condition_read_source' and human_actor='$ADMIN_ID'")" = '1'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='bently_system1_condition_read' and (event_data->>'sourceWriteBack')::boolean=false and (event_data->>'alarmAcknowledgement')::boolean=false and (event_data->>'limitChangeAuthority')::boolean=false and (event_data->>'controlAuthority')::boolean=false")" = '2'

echo 'C2.19 System 1 condition read smoke passed: canonical_connector=true canonical_sensor_identity=true canonical_condition_writer=true named_human_admin=true ai_promotion_refused=true immutable_contract_hash=true service_attestation=true exact_page_reconciliation=true exact_node_unit_mapping=true retained_rejects=true duplicate_idempotency=true suspect_quality_retained=true clean_watermark=true source_write_back=false alarm_acknowledgement=false limit_change=false plant_control=false'

#!/usr/bin/env bash
set -euo pipefail
trap 'echo "C2.05 condition-sensor registry smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);v=x.get(os.environ['KEY']);print('' if v is None else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);sys.exit(1 if isinstance(x,dict) and x.get('error') else 0)"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }

ENGINEER=$(token 'demo@syncai.ca' 'Demo123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$ENGINEER"; test -n "$TECH"
ASSET=$(psqlc "select id from public.assets where organization_id='$ORG' order by created_at limit 1;")
FOREIGN_ASSET=$(psqlc "select id from public.assets where organization_id<>'$ORG' order by created_at limit 1;")
test -n "$ASSET"; test -n "$FOREIGN_ASSET"
TAG="C205-VIB-$(date +%s)-$$"
BASIS='Approved instrument index and named engineering review for this CI measurement point.'

DENIED=$(rpc "$TECH" upsert_condition_sensor "{\"p_sensor_id\":null,\"p_asset_id\":\"$ASSET\",\"p_sensor_tag\":\"$TAG-DENIED\",\"p_name\":\"Denied vibration\",\"p_signal_type\":\"vibration_velocity\",\"p_unit\":\"mm/s RMS\",\"p_detection_technique\":\"Vibration analysis\",\"p_warning_limit\":4.5,\"p_alarm_limit\":7.1,\"p_limit_direction\":\"above\",\"p_source_system\":\"C205-SMOKE\",\"p_basis\":\"$BASIS\",\"p_expected_version\":null}")
BODY="$DENIED" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);sys.exit(0 if 'named human' in x.get('error','').lower() else 1)"

FOREIGN=$(rpc "$ENGINEER" upsert_condition_sensor "{\"p_sensor_id\":null,\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_sensor_tag\":\"$TAG-FOREIGN\",\"p_name\":\"Foreign vibration\",\"p_signal_type\":\"vibration_velocity\",\"p_unit\":\"mm/s RMS\",\"p_detection_technique\":\"Vibration analysis\",\"p_warning_limit\":4.5,\"p_alarm_limit\":7.1,\"p_limit_direction\":\"above\",\"p_source_system\":\"C205-SMOKE\",\"p_basis\":\"$BASIS\",\"p_expected_version\":null}")
BODY="$FOREIGN" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);sys.exit(0 if 'this organization' in x.get('error','').lower() else 1)"

BAD_LIMITS=$(rpc "$ENGINEER" upsert_condition_sensor "{\"p_sensor_id\":null,\"p_asset_id\":\"$ASSET\",\"p_sensor_tag\":\"$TAG-BAD\",\"p_name\":\"Bad limits\",\"p_signal_type\":\"vibration_velocity\",\"p_unit\":\"mm/s RMS\",\"p_detection_technique\":\"Vibration analysis\",\"p_warning_limit\":8,\"p_alarm_limit\":7,\"p_limit_direction\":\"above\",\"p_source_system\":\"C205-SMOKE\",\"p_basis\":\"$BASIS\",\"p_expected_version\":null}")
BODY="$BAD_LIMITS" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);sys.exit(0 if 'inconsistent' in x.get('error','').lower() else 1)"

CREATED=$(rpc "$ENGINEER" upsert_condition_sensor "{\"p_sensor_id\":null,\"p_asset_id\":\"$ASSET\",\"p_sensor_tag\":\"$TAG\",\"p_name\":\"C2.05 drive-end vibration\",\"p_signal_type\":\"vibration_velocity\",\"p_unit\":\"mm/s RMS\",\"p_detection_technique\":\"Vibration analysis\",\"p_warning_limit\":4.5,\"p_alarm_limit\":7.1,\"p_limit_direction\":\"above\",\"p_source_system\":\"C205-SMOKE\",\"p_basis\":\"$BASIS\",\"p_expected_version\":null}")
noerr "$CREATED"; SENSOR=$(field "$CREATED" sensorId); test -n "$SENSOR"
test "$(field "$CREATED" version)" = '1'
test "$(psqlc "select count(*) from public.sensor_configuration_revisions where sensor_id='$SENSOR' and action='registered' and version=1;")" = '1'

DIRECT_CODE=$(curl -sS -o /tmp/c205-direct-sensor.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/sensors?id=eq.$SENSOR" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"alarm_limit":999}')
case "$DIRECT_CODE" in 401|403) ;; 200) test "$(cat /tmp/c205-direct-sensor.txt)" = '[]' ;; *) false ;; esac
test "$(psqlc "select alarm_limit from public.sensors where id='$SENSOR';")" = '7.1'

REVISED=$(rpc "$ENGINEER" upsert_condition_sensor "{\"p_sensor_id\":\"$SENSOR\",\"p_asset_id\":\"$ASSET\",\"p_sensor_tag\":\"$TAG\",\"p_name\":\"C2.05 drive-end vibration\",\"p_signal_type\":\"vibration_velocity\",\"p_unit\":\"mm/s RMS\",\"p_detection_technique\":\"Vibration analysis\",\"p_warning_limit\":5.0,\"p_alarm_limit\":7.5,\"p_limit_direction\":\"above\",\"p_source_system\":\"C205-SMOKE\",\"p_basis\":\"Revised after an independently reviewed instrument range verification.\",\"p_expected_version\":1}")
noerr "$REVISED"; test "$(field "$REVISED" version)" = '2'
STALE=$(rpc "$ENGINEER" upsert_condition_sensor "{\"p_sensor_id\":\"$SENSOR\",\"p_asset_id\":\"$ASSET\",\"p_sensor_tag\":\"$TAG\",\"p_name\":\"Stale overwrite\",\"p_signal_type\":\"vibration_velocity\",\"p_unit\":\"mm/s RMS\",\"p_detection_technique\":\"Vibration analysis\",\"p_warning_limit\":5.0,\"p_alarm_limit\":7.5,\"p_limit_direction\":\"above\",\"p_source_system\":\"C205-SMOKE\",\"p_basis\":\"This stale revision must be refused by optimistic concurrency.\",\"p_expected_version\":1}")
BODY="$STALE" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);sys.exit(0 if 'changed after' in x.get('error','').lower() else 1)"

TAKEN=$(psqlc "select to_char(now()-interval '1 hour','YYYY-MM-DD\"T\"HH24:MI:SSOF');")
IMPORT=$(rpc "$ENGINEER" begin_manual_import '{"p_entity_type":"condition_reading","p_source_name":"C2.05 governed sensor reading"}')
noerr "$IMPORT"; RUN=$(field "$IMPORT" run_id); test -n "$RUN"
ROWS="[{\"external_id\":\"$TAG-R1\",\"sensor_id\":\"$SENSOR\",\"value\":6.2,\"taken_at\":\"$TAKEN\",\"quality\":\"good\"}]"
INGESTED=$(rpc "$ENGINEER" ingest_rows "{\"p_run_id\":\"$RUN\",\"p_rows\":$ROWS}")
noerr "$INGESTED"; test "$(field "$INGESTED" accepted)" = '1'
test "$(psqlc "select count(*) from public.condition_readings where sensor_id='$SENSOR' and external_id='$TAG-R1';")" = '1'

REPORT=$(rpc "$ENGINEER" run_condition_monitoring_agent "{\"p_sensor_id\":\"$SENSOR\",\"p_window_days\":30,\"p_limit\":120}")
noerr "$REPORT"; PACK=$(field "$REPORT" packId); test -n "$PACK"
test "$(psqlc "select count(*) from public.condition_monitoring_agent_packs where id='$PACK' and sensor_id='$SENSOR';")" = '1'

REGISTRY=$(rpc "$ENGINEER" get_condition_sensor_registry '{}')
noerr "$REGISTRY"
BODY="$REGISTRY" SENSOR="$SENSOR" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);s=next((r for r in x['sensors'] if r['sensorId']==os.environ['SENSOR']),None);sys.exit(0 if s and s['readingCount']==1 and s['diagnosticReportCount']>=1 and s['historyCount']==2 else 1)"

DECOMMISSIONED=$(rpc "$ENGINEER" decommission_condition_sensor "{\"p_sensor_id\":\"$SENSOR\",\"p_reason\":\"Instrument removed from service after documented field verification.\",\"p_expected_version\":2}")
noerr "$DECOMMISSIONED"; test "$(field "$DECOMMISSIONED" status)" = 'decommissioned'
HISTORY_BEFORE=$(psqlc "select count(*) from public.condition_readings where sensor_id='$SENSOR';")
REPORTS_BEFORE=$(psqlc "select count(*) from public.condition_monitoring_agent_packs where sensor_id='$SENSOR';")
READ_CODE=$(curl -sS -o /tmp/c205-inactive-reading.txt -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/record_condition_reading" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" -H 'content-type: application/json' \
  -d "{\"p_sensor_id\":\"$SENSOR\",\"p_value\":6.8,\"p_taken_at\":null,\"p_quality\":\"good\",\"p_source_system\":\"C205-SMOKE\",\"p_external_id\":\"$TAG-BLOCKED\"}")
test "$READ_CODE" = '400'
grep -qi 'active governed sensor' /tmp/c205-inactive-reading.txt
test "$(psqlc "select count(*) from public.condition_readings where sensor_id='$SENSOR';")" = "$HISTORY_BEFORE"
test "$(psqlc "select count(*) from public.condition_monitoring_agent_packs where sensor_id='$SENSOR';")" = "$REPORTS_BEFORE"
test "$(psqlc "select count(*) from public.sensor_configuration_revisions where sensor_id='$SENSOR' and action='decommissioned' and version=3;")" = '1'

echo 'C2.05 condition-sensor registry smoke passed: named_human_registry=true role_gate=true tenant_wall=true direct_write_locked=true limit_ordering=true reading_ingest=true diagnostic_report=true decommission_blocks_reading=true history_preserved=true'

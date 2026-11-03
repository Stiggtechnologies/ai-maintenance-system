#!/usr/bin/env bash
# C2.19 — service-attested SAP APM indicator identity read.
set -euo pipefail
trap 'echo "C2.19 SAP APM indicator read smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); ADMIN=$(uuid); ENGINEER=$(uuid); AI_ADMIN=$(uuid); FOREIGN=$(uuid)
SITE=$(uuid); ASSET=$(uuid); SENSOR=$(uuid)
CONNECTOR_KEY="c219-apm-${ORG:0:8}"
FETCH_ONE=$(python3 -c 'from datetime import datetime,timezone,timedelta; print((datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat().replace("+00:00","Z"))')
FETCH_TWO=$(python3 -c 'from datetime import datetime,timezone,timedelta; print((datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat().replace("+00:00","Z"))')

jwt(){
  SUBJECT="$1" EMAIL="$2" JWT_SECRET_VALUE="$JWT_SECRET" python3 - <<'PY'
import base64,hashlib,hmac,json,os,time
def enc(v): return base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=').decode()
now=int(time.time()); h=enc({'alg':'HS256','typ':'JWT'})
p=enc({'aud':'authenticated','exp':now+3600,'iat':now,'sub':os.environ['SUBJECT'],
  'email':os.environ['EMAIL'],'phone':'','role':'authenticated','aal':'aal1',
  'app_metadata':{'provider':'email','providers':['email']},'user_metadata':{},
  'amr':[{'method':'password','timestamp':now}]})
body=f'{h}.{p}'; sig=base64.urlsafe_b64encode(hmac.new(os.environ['JWT_SECRET_VALUE'].encode(),body.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
print(f'{body}.{sig}')
PY
}
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
service_rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$1" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' -d "$2"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; x=json.loads(os.environ['BODY']); v=x.get(os.environ['KEY']); print('' if v is None else str(v).lower() if isinstance(v,bool) else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else 'unexpected response'; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values('$ORG','C2.19 APM tenant'),('$FOREIGN_ORG','C2.19 foreign tenant');
insert into sites(id,organization_id,name) values('$SITE','$ORG','North Plant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$ADMIN','authenticated','authenticated','c219-admin-$ADMIN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$ENGINEER','authenticated','authenticated','c219-re-$ENGINEER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI_ADMIN','authenticated','authenticated','c219-ai-$AI_ADMIN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','c219-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
('$ADMIN','$ORG','c219-admin-$ADMIN@invalid.syncai.ca','C2.19 administrator','admin'),
('$ENGINEER','$ORG','c219-re-$ENGINEER@invalid.syncai.ca','C2.19 reliability engineer','reliability_engineer'),
('$AI_ADMIN','$ORG','c219-ai-$AI_ADMIN@invalid.syncai.ca','C2.19 AI administrator','ai_admin'),
('$FOREIGN','$FOREIGN_ORG','c219-foreign-$FOREIGN@invalid.syncai.ca','C2.19 foreign administrator','admin');
insert into assets(id,organization_id,site_id,name,external_id)
values('$ASSET','$ORG','$SITE','Pump','217100092');
insert into sensors(id,organization_id,asset_id,name,unit,registry_status,last_value,alarm_limit)
values('$SENSOR','$ORG','$ASSET','Outlet flow','L/MIN','active',12,80);
PSQL

ADMIN_JWT=$(jwt "$ADMIN" "c219-admin-$ADMIN@invalid.syncai.ca")
ENGINEER_JWT=$(jwt "$ENGINEER" "c219-re-$ENGINEER@invalid.syncai.ca")
AI_ADMIN_JWT=$(jwt "$AI_ADMIN" "c219-ai-$AI_ADMIN@invalid.syncai.ca")
FOREIGN_JWT=$(jwt "$FOREIGN" "c219-foreign-$FOREIGN@invalid.syncai.ca")
BINDINGS="[{\"characteristicsInternalId\":\"53\",\"positionId\":\"24aa638b97194cb8b9d0cf4c2a46eb95\",\"categoryName\":\"M\",\"technicalObjectType\":\"EQUI\",\"sensorId\":\"$SENSOR\"}]"
BASE="{\"p_key\":\"$CONNECTOR_KEY\",\"p_name\":\"C2.19 governed SAP APM\",\"p_service_root\":\"https://apm.example.com/IndicatorService/v1\",\"p_technical_object_number\":\"217100092\",\"p_site_id\":\"$SITE\",\"p_indicator_bindings\":$BINDINGS,\"p_max_rows\":100,\"p_max_pages\":5,\"p_expected_interval_minutes\":60,\"p_credential_binding_ref\":\"vault://tenant/sap-apm-indicators\",\"p_enabled\":true,\"p_basis\":\"Named reliability engineer approved technical object 217100092 against the North Plant outlet-flow sensor.\"}"

expect_error "$(rpc "$ENGINEER_JWT" configure_sap_apm_indicator_source "$BASE")" 'requires an administrator'
expect_error "$(rpc "$AI_ADMIN_JWT" configure_sap_apm_indicator_source "$BASE")" 'named human administrator'
expect_error "$(rpc "$ADMIN_JWT" configure_sap_apm_indicator_source "${BASE/https:\/\/apm.example.com/https:\/\/10.0.0.8}")" 'private/local targets are blocked'
CONFIGURED=$(rpc "$ADMIN_JWT" configure_sap_apm_indicator_source "$BASE"); noerr "$CONFIGURED"
test "$(field "$CONFIGURED" write_enabled)" = 'false'
SOURCE=$(rpc "$ENGINEER_JWT" get_sap_apm_indicator_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}"); noerr "$SOURCE"
HASH=$(field "$SOURCE" contract_hash)
expect_error "$(rpc "$AI_ADMIN_JWT" get_sap_apm_indicator_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}")" 'access denied'
expect_error "$(rpc "$FOREIGN_JWT" get_sap_apm_indicator_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}")" 'not found'
test "$(psqlc "select has_function_privilege('authenticated','public.begin_sap_apm_indicator_read_run(uuid,uuid,text,jsonb,jsonb,bigint)','execute');")" = 'f'

MANIFEST="[{\"transport\":\"sap_apm_rest\",\"resource\":\"IndicatorService/v1/Indicators\",\"page\":1,\"technical_object_number\":\"217100092\",\"row_count\":1,\"bytes\":160,\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}]"
CURSOR_ONE="{\"fetched_at\":\"$FETCH_ONE\",\"raw_rows\":1,\"mapped_rows\":1,\"pages\":1,\"contract_hash\":\"$HASH\"}"
BEGIN_ONE=$(service_rpc begin_sap_apm_indicator_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$ENGINEER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_manifest\":$MANIFEST,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":160}"); noerr "$BEGIN_ONE"
RUN_ONE=$(field "$BEGIN_ONE" run_id)
ROWS_ONE="[{\"external_id\":\"217100092:EQUI:53:24aa638b97194cb8b9d0cf4c2a46eb95:M\",\"sensor_id\":\"$SENSOR\",\"technical_object_number\":\"217100092\",\"technical_object_type\":\"EQUI\",\"characteristics_internal_id\":\"53\",\"position_id\":\"24aa638b97194cb8b9d0cf4c2a46eb95\",\"category_name\":\"M\",\"site_id\":\"$SITE\",\"observed_at\":\"$FETCH_ONE\"}]"
INGEST_ONE=$(service_rpc ingest_sap_apm_indicator_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$ENGINEER\",\"p_run_id\":\"$RUN_ONE\",\"p_rows\":$ROWS_ONE}"); noerr "$INGEST_ONE"
test "$(field "$INGEST_ONE" accepted)" = '1'
FINISH_ONE=$(service_rpc finish_sap_apm_indicator_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_ONE\",\"p_status\":\"success\",\"p_error\":null}"); noerr "$FINISH_ONE"
test "$(field "$FINISH_ONE" watermark_advanced)" = 'true'
test "$(psqlc "select source_system||'|'||last_value||'|'||alarm_limit from sensors where id='$SENSOR';")" = "$CONNECTOR_KEY|12|80"

CURSOR_TWO="{\"fetched_at\":\"$FETCH_TWO\",\"raw_rows\":1,\"mapped_rows\":1,\"pages\":1,\"contract_hash\":\"$HASH\"}"
BEGIN_TWO=$(service_rpc begin_sap_apm_indicator_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$ENGINEER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_manifest\":$MANIFEST,\"p_cursor_to\":$CURSOR_TWO,\"p_source_bytes\":160}"); noerr "$BEGIN_TWO"
RUN_TWO=$(field "$BEGIN_TWO" run_id)
ROWS_TWO="${ROWS_ONE/$FETCH_ONE/$FETCH_TWO}"
INGEST_TWO=$(service_rpc ingest_sap_apm_indicator_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$ENGINEER\",\"p_run_id\":\"$RUN_TWO\",\"p_rows\":$ROWS_TWO}"); noerr "$INGEST_TWO"
test "$(field "$INGEST_TWO" duplicate)" = '1'
FINISH_TWO=$(service_rpc finish_sap_apm_indicator_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_TWO\",\"p_status\":\"success\",\"p_error\":null}"); noerr "$FINISH_TWO"
test "$(field "$FINISH_TWO" watermark_advanced)" = 'true'

OUT=$(sql_must_fail "update connectors set write_enabled=true where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'connectors_apm_indicator_read_profile_check' <<<"$OUT"
DIRECT=$(sql_must_fail "insert into connector_runs(organization_id,connector_id,entity_type,run_type,status) select '$ORG',id,'sensor','sync','running' from connectors where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'service-attested complete transport evidence' <<<"$DIRECT"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='sap_apm_indicator_read' and (event_data->>'measurementWrite')::boolean=false and (event_data->>'sourceWriteBack')::boolean=false;")" = '2'
test "$(psqlc "select count(*) from condition_readings where organization_id='$ORG' and sensor_id='$SENSOR';")" = '0'

echo 'C2.19 SAP APM indicator read smoke passed: canonical_sensor=true no_measurement=true no_health_score=true tenant_wall=true service_attestation=true source_write_back=false'

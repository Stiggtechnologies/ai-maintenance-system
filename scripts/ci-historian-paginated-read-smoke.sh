#!/usr/bin/env bash
# C2.13 — bounded paginated historian transport and canonical reading promotion.
set -euo pipefail
trap 'echo "C2.13 historian paginated read smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); ADMIN=$(uuid); ENGINEER=$(uuid); FOREIGN=$(uuid); ASSET=$(uuid); SENSOR=$(uuid)
CONNECTOR_KEY="c213-historian-${ORG:0:8}"
READING_ONE="2026-09-03T12:00:00Z"
READING_TWO="2026-09-03T13:00:00Z"

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
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; x=json.loads(os.environ['BODY']); v=x.get(os.environ['KEY']); print('' if v is None else str(v).lower() if isinstance(v,bool) else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else None; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','C2.13 historian tenant'),
  ('$FOREIGN_ORG','C2.13 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$ADMIN','authenticated','authenticated','c213-admin-$ADMIN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$ENGINEER','authenticated','authenticated','c213-engineer-$ENGINEER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','c213-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$ADMIN','$ORG','c213-admin-$ADMIN@invalid.syncai.ca','C2.13 administrator','admin'),
  ('$ENGINEER','$ORG','c213-engineer-$ENGINEER@invalid.syncai.ca','C2.13 engineer','reliability_engineer'),
  ('$FOREIGN','$FOREIGN_ORG','c213-foreign-$FOREIGN@invalid.syncai.ca','C2.13 foreign administrator','admin');
insert into assets(id,organization_id,name,tag,asset_class,criticality)
values('$ASSET','$ORG','C2.13 monitored pump','C213-P-101','pump','high');
insert into sensors(id,organization_id,asset_id,name,signal_type,unit)
values('$SENSOR','$ORG','$ASSET','C2.13 drive-end vibration','vibration velocity','mm/s');
PSQL

ADMIN_JWT=$(jwt "$ADMIN" "c213-admin-$ADMIN@invalid.syncai.ca")
ENGINEER_JWT=$(jwt "$ENGINEER" "c213-engineer-$ENGINEER@invalid.syncai.ca")
FOREIGN_JWT=$(jwt "$FOREIGN" "c213-foreign-$FOREIGN@invalid.syncai.ca")

BASE="{\"p_key\":\"$CONNECTOR_KEY\",\"p_name\":\"C2.13 governed historian\",\"p_system_kind\":\"historian\",\"p_endpoint_url\":\"https://historian.example.com/api/readings\",\"p_expected_interval_minutes\":15,\"p_credential_binding_ref\":\"vault://tenant/historian\",\"p_pagination_mode\":\"next_url\",\"p_pagination_next_path\":\"links.next\",\"p_pagination_max_pages\":20,\"p_enabled\":true,\"p_basis\":\"Named administrator approved the bounded read-only historian activation.\"}"

ROLE_DENIED=$(rpc "$ENGINEER_JWT" configure_plant_historian_source "$BASE")
expect_error "$ROLE_DENIED" 'requires an administrator'
BAD_KIND="${BASE/\"historian\"/null}"
KIND_DENIED=$(rpc "$ADMIN_JWT" configure_plant_historian_source "$BAD_KIND")
expect_error "$KIND_DENIED" 'source kind must be'
BAD_ENDPOINT="${BASE/https:\/\/historian.example.com/https:\/\/192.168.1.50}"
ENDPOINT_DENIED=$(rpc "$ADMIN_JWT" configure_plant_historian_source "$BAD_ENDPOINT")
expect_error "$ENDPOINT_DENIED" 'private/local targets are blocked'
BAD_REF="${BASE/vault:\/\/tenant\/historian/vault:\/\/tenant\/historian#secret}"
REF_DENIED=$(rpc "$ADMIN_JWT" configure_plant_historian_source "$BAD_REF")
expect_error "$REF_DENIED" 'opaque secret-store URI'
BAD_MODE="${BASE/\"next_url\"/\"cursor_magic\"}"
MODE_DENIED=$(rpc "$ADMIN_JWT" configure_plant_historian_source "$BAD_MODE")
expect_error "$MODE_DENIED" 'mode must be none or next_url'
BAD_PATH="${BASE/\"links.next\"/\"links[0].next\"}"
PATH_DENIED=$(rpc "$ADMIN_JWT" configure_plant_historian_source "$BAD_PATH")
expect_error "$PATH_DENIED" 'safe dotted next-page path'
BAD_LIMIT="${BASE/\"p_pagination_max_pages\":20/\"p_pagination_max_pages\":101}"
LIMIT_DENIED=$(rpc "$ADMIN_JWT" configure_plant_historian_source "$BAD_LIMIT")
expect_error "$LIMIT_DENIED" 'between 2 and 100'

CONFIGURED=$(rpc "$ADMIN_JWT" configure_plant_historian_source "$BASE")
noerr "$CONFIGURED"
test "$(field "$CONFIGURED" enabled)" = 'true'
test "$(field "$CONFIGURED" write_enabled)" = 'false'
test "$(field "$CONFIGURED" pagination_mode)" = 'next_url'
test "$(field "$CONFIGURED" pagination_max_pages)" = '20'

MAPPING='{"external_id":"external_id","sensor_name":"sensor_name","value":"value","taken_at":"taken_at","quality":"quality"}'
MAPPED=$(rpc "$ADMIN_JWT" save_plant_historian_mapping "{\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_source_array_path\":\"readings\",\"p_column_mapping\":$MAPPING,\"p_value_mappings\":{},\"p_constants\":{},\"p_approve\":true,\"p_basis\":\"Canonical condition-reading mapping reviewed against the controlled source export.\"}")
noerr "$MAPPED"; test "$(field "$MAPPED" status)" = 'approved'

SOURCE=$(rpc "$ENGINEER_JWT" get_plant_historian_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}")
noerr "$SOURCE"
test "$(field "$SOURCE" pagination_mode)" = 'next_url'
test "$(field "$SOURCE" pagination_next_path)" = 'links.next'
test "$(field "$SOURCE" pagination_max_pages)" = '20'
FOREIGN_SOURCE=$(rpc "$FOREIGN_JWT" get_plant_historian_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}")
expect_error "$FOREIGN_SOURCE" 'not found'

RUN_RESULT=$(rpc "$ENGINEER_JWT" begin_plant_historian_run "{\"p_connector_key\":\"$CONNECTOR_KEY\"}")
noerr "$RUN_RESULT"; RUN=$(field "$RUN_RESULT" run_id)
FOREIGN_INGEST=$(rpc "$FOREIGN_JWT" ingest_plant_historian_batch "{\"p_run_id\":\"$RUN\",\"p_rows\":[]}")
expect_error "$FOREIGN_INGEST" 'not found'

ROWS="[{\"external_id\":\"READING-1\",\"sensor_name\":\"C2.13 drive-end vibration\",\"value\":\"3.2\",\"taken_at\":\"$READING_ONE\",\"quality\":\"good\"},{\"external_id\":\"READING-BAD\",\"sensor_name\":\"missing sensor\",\"value\":\"8.1\",\"taken_at\":\"$READING_ONE\",\"quality\":\"good\"}]"
INGESTED=$(rpc "$ENGINEER_JWT" ingest_plant_historian_batch "{\"p_run_id\":\"$RUN\",\"p_rows\":$ROWS}")
noerr "$INGESTED"
test "$(field "$INGESTED" read)" = '2'
test "$(field "$INGESTED" accepted)" = '1'
test "$(field "$INGESTED" rejected)" = '1'
FINISHED=$(rpc "$ENGINEER_JWT" finish_connector_run "{\"p_run_id\":\"$RUN\",\"p_status\":\"partial\",\"p_error\":null}")
noerr "$FINISHED"; test "$(field "$FINISHED" watermark_advanced)" = 'false'
test "$(psqlc "select count(*) from condition_readings where organization_id='$ORG' and source_system='$CONNECTOR_KEY' and external_id='READING-1' and sensor_id='$SENSOR';")" = '1'
test "$(psqlc "select count(*) from ingest_staging where run_id='$RUN' and status='rejected' and reject_reason ilike '%unknown sensor%';")" = '1'

RUN2_RESULT=$(rpc "$ENGINEER_JWT" begin_plant_historian_run "{\"p_connector_key\":\"$CONNECTOR_KEY\"}")
noerr "$RUN2_RESULT"; RUN2=$(field "$RUN2_RESULT" run_id)
ROWS2="[{\"external_id\":\"READING-1\",\"sensor_name\":\"C2.13 drive-end vibration\",\"value\":\"3.2\",\"taken_at\":\"$READING_ONE\",\"quality\":\"good\"},{\"external_id\":\"READING-2\",\"sensor_name\":\"C2.13 drive-end vibration\",\"value\":\"3.6\",\"taken_at\":\"$READING_TWO\",\"quality\":\"good\"}]"
REPLAY=$(rpc "$ENGINEER_JWT" ingest_plant_historian_batch "{\"p_run_id\":\"$RUN2\",\"p_rows\":$ROWS2}")
noerr "$REPLAY"
test "$(field "$REPLAY" duplicate)" = '1'
test "$(field "$REPLAY" accepted)" = '1'
FINISHED2=$(rpc "$ENGINEER_JWT" finish_connector_run "{\"p_run_id\":\"$RUN2\",\"p_status\":\"success\",\"p_error\":null}")
noerr "$FINISHED2"; test "$(field "$FINISHED2" watermark_advanced)" = 'true'
test "$(psqlc "select count(*) from ingest_watermarks where organization_id='$ORG' and last_run_id='$RUN2';")" = '1'

DIRECT=$(curl -sS -o /tmp/c213-direct.txt -w '%{http_code}' -X PATCH "$API_URL/rest/v1/connectors?connector_key=eq.$CONNECTOR_KEY" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' -H 'Prefer: return=representation' -d '{"pagination_max_pages":99}')
case "$DIRECT" in 200|204|401|403) ;; *) cat /tmp/c213-direct.txt; false ;; esac
test "$(psqlc "select pagination_max_pages from connectors where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")" = '20'
OUT=$(sql_must_fail "update connectors set pagination_mode='next_url',pagination_next_path=null,pagination_max_pages=20 where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'connectors_pagination_profile_check' <<<"$OUT"
test "$(psqlc "select count(*) from decisions where organization_id='$ORG' and decision_type='plant_historian_source';")" = '1'
test "$(psqlc "select count(*) from connectors where organization_id='$ORG' and connector_key='$CONNECTOR_KEY' and direction='read_only' and not write_enabled and pagination_mode='next_url' and pagination_next_path='links.next' and pagination_max_pages=20;")" = '1'

echo 'C2.13 historian paginated read smoke passed: canonical_connector=true canonical_condition_readings=true tenant_wall=true administrator_profile=true bounded_pagination=true same_contract_mapping=true retained_rejects=true idempotent_replay=true clean_run_watermark=true direct_write_locked=true source_write_back=false unattended=false'

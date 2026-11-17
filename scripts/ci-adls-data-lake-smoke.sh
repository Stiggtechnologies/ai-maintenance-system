#!/usr/bin/env bash
# C2.14 — service-attested ADLS transport evidence and clean cursor advance.
set -euo pipefail
trap 'echo "C2.14 ADLS data-lake smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); ADMIN=$(uuid); AI_ADMIN=$(uuid); PLANNER=$(uuid); PLANNER_TWO=$(uuid); FOREIGN=$(uuid)
CONNECTOR_KEY="c214-adls-${ORG:0:8}"

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
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else None; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','C2.14 ADLS tenant'),
  ('$FOREIGN_ORG','C2.14 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$ADMIN','authenticated','authenticated','c214-admin-$ADMIN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI_ADMIN','authenticated','authenticated','c214-ai-$AI_ADMIN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$PLANNER','authenticated','authenticated','c214-planner-$PLANNER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$PLANNER_TWO','authenticated','authenticated','c214-planner2-$PLANNER_TWO@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','c214-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$ADMIN','$ORG','c214-admin-$ADMIN@invalid.syncai.ca','C2.14 administrator','admin'),
  ('$AI_ADMIN','$ORG','c214-ai-$AI_ADMIN@invalid.syncai.ca','C2.14 AI administrator','ai_admin'),
  ('$PLANNER','$ORG','c214-planner-$PLANNER@invalid.syncai.ca','C2.14 planner','planner'),
  ('$PLANNER_TWO','$ORG','c214-planner2-$PLANNER_TWO@invalid.syncai.ca','C2.14 second planner','planner'),
  ('$FOREIGN','$FOREIGN_ORG','c214-foreign-$FOREIGN@invalid.syncai.ca','C2.14 foreign administrator','admin');
PSQL

ADMIN_JWT=$(jwt "$ADMIN" "c214-admin-$ADMIN@invalid.syncai.ca")
AI_ADMIN_JWT=$(jwt "$AI_ADMIN" "c214-ai-$AI_ADMIN@invalid.syncai.ca")
PLANNER_JWT=$(jwt "$PLANNER" "c214-planner-$PLANNER@invalid.syncai.ca")
PLANNER_TWO_JWT=$(jwt "$PLANNER_TWO" "c214-planner2-$PLANNER_TWO@invalid.syncai.ca")
FOREIGN_JWT=$(jwt "$FOREIGN" "c214-foreign-$FOREIGN@invalid.syncai.ca")
BASE="{\"p_key\":\"$CONNECTOR_KEY\",\"p_name\":\"C2.14 governed ADLS\",\"p_filesystem_url\":\"https://syncaic2adls.dfs.core.windows.net/landing\",\"p_object_prefix\":\"recovery/sites/\",\"p_object_format\":\"csv\",\"p_max_files\":20,\"p_max_bytes\":26214400,\"p_expected_interval_minutes\":60,\"p_credential_binding_ref\":\"vault://tenant/adls\",\"p_enabled\":false,\"p_basis\":\"Named administrator approved the read-only ADLS activation dataset.\"}"

ROLE_DENIED=$(rpc "$PLANNER_JWT" configure_data_lake_read_source "$BASE")
expect_error "$ROLE_DENIED" 'requires a named human administrator'
AI_CONFIG_DENIED=$(rpc "$AI_ADMIN_JWT" configure_data_lake_read_source "$BASE")
expect_error "$AI_CONFIG_DENIED" 'named human administrator'
BAD_ENDPOINT="${BASE/https:\/\/syncaic2adls.dfs.core.windows.net\/landing/https:\/\/storage.example.com\/landing}"
ENDPOINT_DENIED=$(rpc "$ADMIN_JWT" configure_data_lake_read_source "$BAD_ENDPOINT")
expect_error "$ENDPOINT_DENIED" 'exact credential-free ADLS'
BAD_PREFIX="${BASE/recovery\/sites\//recovery\/..\/secret\/}"
PREFIX_DENIED=$(rpc "$ADMIN_JWT" configure_data_lake_read_source "$BAD_PREFIX")
expect_error "$PREFIX_DENIED" 'must not contain traversal'
BAD_BYTES="${BASE/26214400/1000}"
BYTES_DENIED=$(rpc "$ADMIN_JWT" configure_data_lake_read_source "$BAD_BYTES")
expect_error "$BYTES_DENIED" 'between 1 MiB and 50 MiB'

CONFIGURED=$(rpc "$ADMIN_JWT" configure_data_lake_read_source "$BASE")
noerr "$CONFIGURED"
test "$(field "$CONFIGURED" enabled)" = 'false'
test "$(field "$CONFIGURED" write_enabled)" = 'false'
test "$(field "$CONFIGURED" transport)" = 'adls_gen2_oauth'

MAPPING='{"external_id":"id","name":"name","code":"code"}'
AI_MAPPING_DENIED=$(rpc "$AI_ADMIN_JWT" save_data_lake_read_mapping "{\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_source_array_path\":\"\",\"p_column_mapping\":$MAPPING,\"p_value_mappings\":{},\"p_constants\":{},\"p_approve\":true,\"p_basis\":\"Canonical site mapping reviewed against the governed ADLS dataset.\"}")
expect_error "$AI_MAPPING_DENIED" 'named human administrator'
GENERIC_MAPPING_DENIED=$(rpc "$ADMIN_JWT" save_recovery_activation_mapping "{\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_source_array_path\":\"\",\"p_column_mapping\":$MAPPING,\"p_value_mappings\":{},\"p_constants\":{},\"p_approve\":true,\"p_basis\":\"Canonical site mapping reviewed against the governed ADLS dataset.\"}")
expect_error "$GENERIC_MAPPING_DENIED" 'named-human mapping contract'
DRAFT=$(rpc "$ADMIN_JWT" save_data_lake_read_mapping "{\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_source_array_path\":\"\",\"p_column_mapping\":$MAPPING,\"p_value_mappings\":{},\"p_constants\":{},\"p_approve\":false,\"p_basis\":\"Draft mapping prepared for write-free validation before human approval.\"}")
noerr "$DRAFT"; test "$(field "$DRAFT" status)" = 'draft'
PREVIEW=$(rpc "$PLANNER_JWT" preview_recovery_activation_batch "{\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_rows\":[{\"external_id\":\"PREVIEW-SITE\",\"name\":\"Preview only site\"}]}")
noerr "$PREVIEW"; test "$(field "$PREVIEW" accepted)" = '1'
test "$(psqlc "select (select count(*) from sites where organization_id='$ORG')::text||':'||(select count(*) from connector_runs where organization_id='$ORG')::text||':'||(select count(*) from ingest_staging where organization_id='$ORG')::text;")" = '0:0:0'
MAPPED=$(rpc "$ADMIN_JWT" save_data_lake_read_mapping "{\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_source_array_path\":\"\",\"p_column_mapping\":$MAPPING,\"p_value_mappings\":{},\"p_constants\":{},\"p_approve\":true,\"p_basis\":\"Canonical site mapping reviewed against the governed ADLS dataset.\"}")
noerr "$MAPPED"; test "$(field "$MAPPED" status)" = 'approved'
test "$(field "$MAPPED" source_disabled)" = 'true'

ACTIVE_BASE="${BASE/\"p_enabled\":false/\"p_enabled\":true}"
ACTIVATED=$(rpc "$ADMIN_JWT" configure_data_lake_read_source "$ACTIVE_BASE")
noerr "$ACTIVATED"; test "$(field "$ACTIVATED" enabled)" = 'true'

SOURCE=$(rpc "$PLANNER_JWT" get_data_lake_read_source "{\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\"}")
noerr "$SOURCE"; test "$(field "$SOURCE" object_prefix)" = 'recovery/sites/'
test "$(field "$SOURCE" mapping_status)" = 'approved'
test "$(field "$SOURCE" can_commit)" = 'true'
CONTRACT_HASH=$(field "$SOURCE" contract_hash)
[[ "$CONTRACT_HASH" =~ ^[0-9a-f]{32}$ ]]
FOREIGN_SOURCE=$(rpc "$FOREIGN_JWT" get_data_lake_read_source "{\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\"}")
expect_error "$FOREIGN_SOURCE" 'not found'

GENERIC_BEGIN=$(rpc "$PLANNER_JWT" begin_recovery_activation_run "{\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_run_type\":\"sync\"}")
expect_error "$GENERIC_BEGIN" 'service-attested transport evidence'
DIRECT_INSERT=$(sql_must_fail "insert into connector_runs(organization_id,connector_id,entity_type,run_type,status) select '$ORG',id,'site','sync','running' from connectors where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'service-attested transport evidence' <<<"$DIRECT_INSERT"

CURSOR_ONE='{"last_modified":"2026-09-01T12:00:00Z","path":"recovery/sites/sites-1.csv"}'
MANIFEST_ONE='[{"transport":"adls_gen2","path":"recovery/sites/sites-1.csv","etag":"etag-1","last_modified":"2026-09-01T12:00:00Z","content_length":120,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","row_count":2}]'
SOURCE_ONE='{"transport":"adls_gen2","path":"recovery/sites/sites-1.csv","etag":"etag-1","last_modified":"2026-09-01T12:00:00Z","content_length":120,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
BAD_CONTRACT=$(service_rpc begin_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":120,\"p_expected_contract_hash\":\"00000000000000000000000000000000\"}")
expect_error "$BAD_CONTRACT" 'changed after transport'
AI_BEGIN=$(service_rpc begin_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$AI_ADMIN\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":120,\"p_expected_contract_hash\":\"$CONTRACT_HASH\"}")
expect_error "$AI_BEGIN" 'named human'
BEGIN_ONE=$(service_rpc begin_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":120,\"p_expected_contract_hash\":\"$CONTRACT_HASH\"}")
noerr "$BEGIN_ONE"; RUN_ONE=$(field "$BEGIN_ONE" run_id)
CONCURRENT_BEGIN=$(service_rpc begin_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":120,\"p_expected_contract_hash\":\"$CONTRACT_HASH\"}")
expect_error "$CONCURRENT_BEGIN" 'already running'
INGEST_ONE=$(rpc "$PLANNER_JWT" ingest_recovery_activation_batch "{\"p_run_id\":\"$RUN_ONE\",\"p_rows\":[{\"external_id\":\"SITE-1\",\"name\":\"ADLS Site One\",\"code\":\"S1\",\"_sync_source\":{\"path\":\"recovery/sites/sites-1.csv\",\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}},{\"external_id\":\"SITE-BAD\"}]}" )
expect_error "$INGEST_ONE" 'attested ingest'
MISSING_SOURCE=$(rpc "$PLANNER_JWT" ingest_data_lake_read_batch "{\"p_run_id\":\"$RUN_ONE\",\"p_rows\":[{\"external_id\":\"SITE-1\",\"name\":\"ADLS Site One\"}]}" )
expect_error "$MISSING_SOURCE" 'requires immutable source provenance'
WRONG_SOURCE='{"transport":"adls_gen2","path":"recovery/sites/sites-1.csv","etag":"etag-1","last_modified":"2026-09-01T12:00:00Z","content_length":120,"sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}'
MISMATCHED_SOURCE=$(rpc "$PLANNER_JWT" ingest_data_lake_read_batch "{\"p_run_id\":\"$RUN_ONE\",\"p_rows\":[{\"external_id\":\"SITE-1\",\"name\":\"ADLS Site One\",\"_sync_source\":$WRONG_SOURCE}]}" )
expect_error "$MISMATCHED_SOURCE" 'does not match the immutable run manifest'
OTHER_ACTOR=$(rpc "$PLANNER_TWO_JWT" ingest_data_lake_read_batch "{\"p_run_id\":\"$RUN_ONE\",\"p_rows\":[{\"external_id\":\"SITE-1\",\"name\":\"ADLS Site One\",\"_sync_source\":$SOURCE_ONE}]}" )
expect_error "$OTHER_ACTOR" 'not found'
INGEST_ONE=$(rpc "$PLANNER_JWT" ingest_data_lake_read_batch "{\"p_run_id\":\"$RUN_ONE\",\"p_rows\":[{\"external_id\":\"SITE-1\",\"name\":\"ADLS Site One\",\"code\":\"S1\",\"_sync_source\":$SOURCE_ONE},{\"external_id\":\"SITE-BAD\",\"_sync_source\":$SOURCE_ONE}]}" )
noerr "$INGEST_ONE"; test "$(field "$INGEST_ONE" accepted)" = '1'; test "$(field "$INGEST_ONE" rejected)" = '1'
test "$(psqlc "select count(*) from ingest_staging where run_id='$RUN_ONE' and jsonb_typeof(payload->'_sync_source')='object' and payload->'_sync_source'->>'path'='recovery/sites/sites-1.csv' and payload->'_sync_source'->>'sha256'=repeat('a',64);")" = '2'
GENERIC_FINISH=$(rpc "$PLANNER_JWT" finish_connector_run "{\"p_run_id\":\"$RUN_ONE\",\"p_status\":\"partial\",\"p_error\":null}")
expect_error "$GENERIC_FINISH" 'service-only clean-finish contract'
test "$(psqlc "select has_function_privilege('authenticated','public.finish_data_lake_read_run(uuid,uuid,uuid,text,text)','EXECUTE');")" = 'f'
test "$(psqlc "select has_function_privilege('service_role','public.finish_data_lake_read_run(uuid,uuid,uuid,text,text)','EXECUTE');")" = 't'
WRONG_FINISHER=$(service_rpc finish_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_ONE\",\"p_finished_by\":\"$PLANNER_TWO\",\"p_status\":\"partial\",\"p_error\":null}")
expect_error "$WRONG_FINISHER" 'not found'
FINISH_ONE=$(service_rpc finish_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_ONE\",\"p_finished_by\":\"$PLANNER\",\"p_status\":\"partial\",\"p_error\":null}")
noerr "$FINISH_ONE"; test "$(field "$FINISH_ONE" cursor_advanced)" = 'false'
test "$(psqlc "select count(*) from ingest_watermarks where organization_id='$ORG' and last_cursor is not null;")" = '0'

CURSOR_TWO='{"last_modified":"2026-09-02T12:00:00Z","path":"recovery/sites/sites-2.csv"}'
MANIFEST_TWO='[{"transport":"adls_gen2","path":"recovery/sites/sites-2.csv","etag":"etag-2","last_modified":"2026-09-02T12:00:00Z","content_length":90,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","row_count":4}]'
SOURCE_TWO='{"transport":"adls_gen2","path":"recovery/sites/sites-2.csv","etag":"etag-2","last_modified":"2026-09-02T12:00:00Z","content_length":90,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'
BEGIN_TWO=$(service_rpc begin_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_manifest\":$MANIFEST_TWO,\"p_cursor_to\":$CURSOR_TWO,\"p_source_bytes\":90,\"p_expected_contract_hash\":\"$CONTRACT_HASH\"}")
noerr "$BEGIN_TWO"; RUN_TWO=$(field "$BEGIN_TWO" run_id)
INGEST_TWO=$(rpc "$PLANNER_JWT" ingest_data_lake_read_batch "{\"p_run_id\":\"$RUN_TWO\",\"p_rows\":[{\"external_id\":\"SITE-1\",\"name\":\"ADLS Site One\",\"code\":\"S1\",\"_sync_source\":$SOURCE_TWO},{\"external_id\":\"SITE-1\",\"name\":\"ADLS Site One Revised\",\"code\":\"S1-REV\",\"_sync_source\":$SOURCE_TWO},{\"external_id\":\"SITE-1\",\"name\":\"ADLS Site One\",\"code\":\"S1\",\"_sync_source\":$SOURCE_TWO},{\"external_id\":\"SITE-2\",\"name\":\"ADLS Site Two\",\"_sync_source\":$SOURCE_TWO}]}" )
noerr "$INGEST_TWO"; test "$(field "$INGEST_TWO" duplicate)" = '1'; test "$(field "$INGEST_TWO" accepted)" = '3'
FINISH_TWO=$(service_rpc finish_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_TWO\",\"p_finished_by\":\"$PLANNER\",\"p_status\":\"success\",\"p_error\":null}")
noerr "$FINISH_TWO"; test "$(field "$FINISH_TWO" cursor_advanced)" = 'true'
test "$(psqlc "select last_cursor->>'path' from ingest_watermarks where organization_id='$ORG' and last_run_id='$RUN_TWO';")" = 'recovery/sites/sites-2.csv'
test "$(psqlc "select count(*) from connector_runs where id='$RUN_TWO' and source_object_count=1 and source_bytes=90 and transport_manifest->0->>'sha256'=repeat('b',64);")" = '1'
test "$(psqlc "select count(*) from sites where organization_id='$ORG' and source_system='$CONNECTOR_KEY';")" = '2'
test "$(psqlc "select count(*) from sites where organization_id='$ORG' and source_system='$CONNECTOR_KEY' and external_id='SITE-1' and name='ADLS Site One' and code='S1';")" = '1'
test "$(psqlc "select count(*) from decisions where organization_id='$ORG' and decision_type='data_lake_read_source';")" = '2'

STALE_BEGIN=$(service_rpc begin_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":120,\"p_expected_contract_hash\":\"$CONTRACT_HASH\"}")
expect_error "$STALE_BEGIN" 'does not advance'

CURSOR_GAP='{"last_modified":"2026-09-02T18:00:00Z","path":"recovery/sites/sites-gap.csv"}'
MANIFEST_GAP='[{"transport":"adls_gen2","path":"recovery/sites/sites-gap.csv","etag":"etag-gap","last_modified":"2026-09-02T18:00:00Z","content_length":70,"sha256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","row_count":2}]'
SOURCE_GAP='{"transport":"adls_gen2","path":"recovery/sites/sites-gap.csv","etag":"etag-gap","last_modified":"2026-09-02T18:00:00Z","content_length":70,"sha256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}'
BEGIN_GAP=$(service_rpc begin_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_manifest\":$MANIFEST_GAP,\"p_cursor_to\":$CURSOR_GAP,\"p_source_bytes\":70,\"p_expected_contract_hash\":\"$CONTRACT_HASH\"}")
noerr "$BEGIN_GAP"; RUN_GAP=$(field "$BEGIN_GAP" run_id)
noerr "$(rpc "$PLANNER_JWT" ingest_data_lake_read_batch "{\"p_run_id\":\"$RUN_GAP\",\"p_rows\":[{\"external_id\":\"SITE-GAP\",\"name\":\"ADLS Gap Site\",\"_sync_source\":$SOURCE_GAP}]}" )"
GAP_FINISH=$(service_rpc finish_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_GAP\",\"p_finished_by\":\"$PLANNER\",\"p_status\":\"success\",\"p_error\":null}")
expect_error "$GAP_FINISH" 'row counts do not reconcile'
noerr "$(service_rpc finish_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_GAP\",\"p_finished_by\":\"$PLANNER\",\"p_status\":\"failure\",\"p_error\":\"Transport row-count mismatch proven by C2.14 smoke.\"}")"

CURSOR_THREE='{"last_modified":"2026-09-03T12:00:00Z","path":"recovery/sites/sites-3.csv"}'
MANIFEST_THREE='[{"transport":"adls_gen2","path":"recovery/sites/sites-3.csv","etag":"etag-3","last_modified":"2026-09-03T12:00:00Z","content_length":80,"sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","row_count":1}]'
SOURCE_THREE='{"transport":"adls_gen2","path":"recovery/sites/sites-3.csv","etag":"etag-3","last_modified":"2026-09-03T12:00:00Z","content_length":80,"sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'
CURSOR_FOUR='{"last_modified":"2026-09-04T12:00:00Z","path":"recovery/sites/sites-4.csv"}'
MANIFEST_FOUR='[{"transport":"adls_gen2","path":"recovery/sites/sites-4.csv","etag":"etag-4","last_modified":"2026-09-04T12:00:00Z","content_length":80,"sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","row_count":1}]'
SOURCE_FOUR='{"transport":"adls_gen2","path":"recovery/sites/sites-4.csv","etag":"etag-4","last_modified":"2026-09-04T12:00:00Z","content_length":80,"sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}'
BEGIN_THREE=$(service_rpc begin_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_manifest\":$MANIFEST_THREE,\"p_cursor_to\":$CURSOR_THREE,\"p_source_bytes\":80,\"p_expected_contract_hash\":\"$CONTRACT_HASH\"}")
noerr "$BEGIN_THREE"; RUN_THREE=$(field "$BEGIN_THREE" run_id)
BEGIN_FOUR_BLOCKED=$(service_rpc begin_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_manifest\":$MANIFEST_FOUR,\"p_cursor_to\":$CURSOR_FOUR,\"p_source_bytes\":80,\"p_expected_contract_hash\":\"$CONTRACT_HASH\"}")
expect_error "$BEGIN_FOUR_BLOCKED" 'already running'
noerr "$(rpc "$PLANNER_JWT" ingest_data_lake_read_batch "{\"p_run_id\":\"$RUN_THREE\",\"p_rows\":[{\"external_id\":\"SITE-3\",\"name\":\"ADLS Site Three\",\"_sync_source\":$SOURCE_THREE}]}")"
FINISH_THREE=$(service_rpc finish_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_THREE\",\"p_finished_by\":\"$PLANNER\",\"p_status\":\"success\",\"p_error\":null}")
noerr "$FINISH_THREE"; test "$(field "$FINISH_THREE" cursor_advanced)" = 'true'
BEGIN_FOUR=$(service_rpc begin_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_manifest\":$MANIFEST_FOUR,\"p_cursor_to\":$CURSOR_FOUR,\"p_source_bytes\":80,\"p_expected_contract_hash\":\"$CONTRACT_HASH\"}")
noerr "$BEGIN_FOUR"; RUN_FOUR=$(field "$BEGIN_FOUR" run_id)
noerr "$(rpc "$PLANNER_JWT" ingest_data_lake_read_batch "{\"p_run_id\":\"$RUN_FOUR\",\"p_rows\":[{\"external_id\":\"SITE-4\",\"name\":\"ADLS Site Four\",\"_sync_source\":$SOURCE_FOUR}]}")"
FINISH_FOUR=$(service_rpc finish_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_FOUR\",\"p_finished_by\":\"$PLANNER\",\"p_status\":\"success\",\"p_error\":null}")
noerr "$FINISH_FOUR"; test "$(field "$FINISH_FOUR" cursor_advanced)" = 'true'
test "$(psqlc "select last_cursor->>'path' from ingest_watermarks where organization_id='$ORG' and connector_id=(select id from connectors where connector_key='$CONNECTOR_KEY');")" = 'recovery/sites/sites-4.csv'

CURSOR_FIVE='{"last_modified":"2026-09-05T12:00:00Z","path":"recovery/sites/sites-5.csv"}'
MANIFEST_FIVE='[{"transport":"adls_gen2","path":"recovery/sites/sites-5.csv","etag":"etag-5","last_modified":"2026-09-05T12:00:00Z","content_length":80,"sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","row_count":1}]'
SOURCE_FIVE='{"transport":"adls_gen2","path":"recovery/sites/sites-5.csv","etag":"etag-5","last_modified":"2026-09-05T12:00:00Z","content_length":80,"sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}'
BEGIN_FIVE=$(service_rpc begin_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_entity_type\":\"site\",\"p_manifest\":$MANIFEST_FIVE,\"p_cursor_to\":$CURSOR_FIVE,\"p_source_bytes\":80,\"p_expected_contract_hash\":\"$CONTRACT_HASH\"}")
noerr "$BEGIN_FIVE"; RUN_FIVE=$(field "$BEGIN_FIVE" run_id)
UPDATED_PROFILE="${ACTIVE_BASE/\"p_max_files\":20/\"p_max_files\":21}"
noerr "$(rpc "$ADMIN_JWT" configure_data_lake_read_source "$UPDATED_PROFILE")"
MUTATED_INGEST=$(rpc "$PLANNER_JWT" ingest_data_lake_read_batch "{\"p_run_id\":\"$RUN_FIVE\",\"p_rows\":[{\"external_id\":\"SITE-5\",\"name\":\"ADLS Site Five\",\"_sync_source\":$SOURCE_FIVE}]}")
expect_error "$MUTATED_INGEST" 'changed during this run'
MUTATED_SUCCESS=$(service_rpc finish_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_FIVE\",\"p_finished_by\":\"$PLANNER\",\"p_status\":\"success\",\"p_error\":null}")
expect_error "$MUTATED_SUCCESS" 'only a failure close is permitted'
noerr "$(service_rpc finish_data_lake_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_FIVE\",\"p_finished_by\":\"$PLANNER\",\"p_status\":\"failure\",\"p_error\":\"Governed source contract changed during the run.\"}")"
test "$(psqlc "select count(*) from sites where organization_id='$ORG' and external_id='SITE-5';")" = '0'

echo 'C2.14 ADLS data-lake smoke passed: canonical_connector=true canonical_runs=true canonical_staging=true tenant_wall=true named_human_approval=true ai_approval_refused=true disabled_draft_preview=true actor_binding=true concurrent_run_guard=true immutable_contract=true midrun_contract_guard=true service_attestation=true dedicated_ingest=true immutable_manifest=true row_receipt_match=true retained_provenance=true row_reconciliation=true retained_rejects=true idempotent_replay=true monotonic_clean_cursor=true source_write_back=false'

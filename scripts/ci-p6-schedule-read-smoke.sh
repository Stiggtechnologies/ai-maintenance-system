#!/usr/bin/env bash
# C2.16 — service-attested Primavera P6 project read into the canonical schedule.
set -euo pipefail
trap 'echo "C2.16 P6 schedule read smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); ADMIN=$(uuid); PLANNER=$(uuid); FOREIGN=$(uuid); CASE_ID=$(uuid)
CONNECTOR_KEY="c216-p6-${ORG:0:8}"
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
insert into organizations(id,name) values
  ('$ORG','C2.16 P6 tenant'),
  ('$FOREIGN_ORG','C2.16 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$ADMIN','authenticated','authenticated','c216-admin-$ADMIN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$PLANNER','authenticated','authenticated','c216-planner-$PLANNER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','c216-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$ADMIN','$ORG','c216-admin-$ADMIN@invalid.syncai.ca','C2.16 administrator','admin'),
  ('$PLANNER','$ORG','c216-planner-$PLANNER@invalid.syncai.ca','C2.16 planner','planner'),
  ('$FOREIGN','$FOREIGN_ORG','c216-foreign-$FOREIGN@invalid.syncai.ca','C2.16 foreign administrator','admin');
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,created_by)
values('$CASE_ID','$ORG','C2.16 turnaround 2027','brownfield','The approved turnaround requires a governed P6 analysis copy.','$ADMIN');
PSQL

ADMIN_JWT=$(jwt "$ADMIN" "c216-admin-$ADMIN@invalid.syncai.ca")
PLANNER_JWT=$(jwt "$PLANNER" "c216-planner-$PLANNER@invalid.syncai.ca")
FOREIGN_JWT=$(jwt "$FOREIGN" "c216-foreign-$FOREIGN@invalid.syncai.ca")
BASE="{\"p_key\":\"$CONNECTOR_KEY\",\"p_name\":\"C2.16 governed Primavera\",\"p_base_url\":\"https://p6.example.com/p6ws/restapi\",\"p_project_object_id\":4101,\"p_development_case_id\":\"$CASE_ID\",\"p_schedule_name\":\"Turnaround 2027\",\"p_duration_to_hours\":8,\"p_max_activities\":50,\"p_max_relationships\":100,\"p_expected_interval_minutes\":60,\"p_credential_binding_ref\":\"vault://tenant/primavera-p6\",\"p_enabled\":true,\"p_basis\":\"Named turnaround manager approved project 4101 and verified eight-hour P6 duration units.\"}"

ROLE_DENIED=$(rpc "$PLANNER_JWT" configure_p6_schedule_read_source "$BASE")
expect_error "$ROLE_DENIED" 'requires an administrator'
BAD_ENDPOINT="${BASE/https:\/\/p6.example.com/https:\/\/192.168.1.50}"
expect_error "$(rpc "$ADMIN_JWT" configure_p6_schedule_read_source "$BAD_ENDPOINT")" 'private/local targets are blocked'
BAD_DURATION="${BASE/\"p_duration_to_hours\":8/\"p_duration_to_hours\":0}"
expect_error "$(rpc "$ADMIN_JWT" configure_p6_schedule_read_source "$BAD_DURATION")" 'finite positive number'
BAD_CASE="${BASE/$CASE_ID/$FOREIGN_ORG}"
expect_error "$(rpc "$ADMIN_JWT" configure_p6_schedule_read_source "$BAD_CASE")" 'outside the active tenant'

CONFIGURED=$(rpc "$ADMIN_JWT" configure_p6_schedule_read_source "$BASE")
noerr "$CONFIGURED"
test "$(field "$CONFIGURED" enabled)" = 'true'
test "$(field "$CONFIGURED" write_enabled)" = 'false'
test "$(field "$CONFIGURED" source_profile)" = 'primavera_p6_eppm'
test "$(field "$CONFIGURED" duration_to_hours)" = '8'

SOURCE=$(rpc "$PLANNER_JWT" get_p6_schedule_read_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}")
noerr "$SOURCE"
test "$(field "$SOURCE" project_object_id)" = '4101'
test "$(field "$SOURCE" development_case_id)" = "$CASE_ID"
FOREIGN_SOURCE=$(rpc "$FOREIGN_JWT" get_p6_schedule_read_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}")
expect_error "$FOREIGN_SOURCE" 'not found'

DIRECT_STATUS=$(curl -sS -o /tmp/c216-direct-begin.txt -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/begin_p6_schedule_read_run" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLANNER_JWT" -H 'Content-Type: application/json' -d '{}')
case "$DIRECT_STATUS" in 401|403|404) ;; *) cat /tmp/c216-direct-begin.txt; false ;; esac
test "$(psqlc "select has_function_privilege('authenticated','public.begin_p6_schedule_read_run(uuid,uuid,text,jsonb,jsonb,bigint)','execute');")" = 'f'
test "$(psqlc "select has_function_privilege('service_role','public.begin_p6_schedule_read_run(uuid,uuid,text,jsonb,jsonb,bigint)','execute');")" = 't'

MANIFEST_ONE='[{"transport":"oracle_p6_eppm_rest","resource":"activity","project_object_id":4101,"row_count":2,"bytes":100,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},{"transport":"oracle_p6_eppm_rest","resource":"relationship","project_object_id":4101,"row_count":1,"bytes":50,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]'
CURSOR_ONE="{\"fetched_at\":\"$FETCH_ONE\",\"activity_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"relationship_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}"
BAD_CURSOR="{\"fetched_at\":\"$FETCH_ONE\",\"activity_sha256\":\"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\",\"relationship_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}"
expect_error "$(service_rpc begin_p6_schedule_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$BAD_CURSOR,\"p_source_bytes\":150}")" 'does not match'

BEGIN_ONE=$(service_rpc begin_p6_schedule_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":150}")
noerr "$BEGIN_ONE"; RUN_ONE=$(field "$BEGIN_ONE" run_id)
ROWS_ONE="[{\"external_id\":\"A-100\",\"activity_id\":\"A-100\",\"development_case_id\":\"$CASE_ID\",\"schedule_name\":\"Turnaround 2027\",\"description\":\"Isolate train\",\"original_duration_hours\":8,\"planned_start\":\"2027-05-01T08:00:00Z\",\"planned_finish\":\"2027-05-01T16:00:00Z\",\"predecessors\":\"\",\"relationships\":[]},{\"external_id\":\"A-200\",\"activity_id\":\"A-200\",\"development_case_id\":\"$CASE_ID\",\"schedule_name\":\"Turnaround 2027\",\"description\":\"Open exchanger\",\"original_duration_hours\":16,\"planned_start\":\"2027-05-02T08:00:00Z\",\"planned_finish\":\"2027-05-03T00:00:00Z\",\"predecessors\":\"A-100\",\"relationships\":[{\"predecessor\":\"A-100\",\"link_type\":\"FS\",\"lag_hours\":2}]}]"
BAD_AAL=$(service_rpc ingest_p6_schedule_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_run_id\":\"$RUN_ONE\",\"p_actor_aal\":\"aal3\",\"p_rows\":$ROWS_ONE}")
expect_error "$BAD_AAL" 'verified human session assurance level'
MISMATCHED=$(service_rpc ingest_p6_schedule_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_run_id\":\"$RUN_ONE\",\"p_actor_aal\":\"aal1\",\"p_rows\":[]}")
expect_error "$MISMATCHED" 'exactly reconcile'
INGEST_ONE=$(service_rpc ingest_p6_schedule_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_run_id\":\"$RUN_ONE\",\"p_actor_aal\":\"aal1\",\"p_rows\":$ROWS_ONE}")
noerr "$INGEST_ONE"
test "$(field "$INGEST_ONE" accepted)" = '2'
test "$(field "$INGEST_ONE" rejected)" = '0'
REINGEST=$(service_rpc ingest_p6_schedule_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_run_id\":\"$RUN_ONE\",\"p_actor_aal\":\"aal1\",\"p_rows\":$ROWS_ONE}")
expect_error "$REINGEST" 'exactly once'
FINISH_ONE=$(service_rpc finish_p6_schedule_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_ONE\",\"p_status\":\"success\",\"p_error\":null}")
noerr "$FINISH_ONE"; test "$(field "$FINISH_ONE" watermark_advanced)" = 'true'
test "$(psqlc "select count(*) from shutdown_tasks t join shutdown_events e on e.id=t.event_id where e.organization_id='$ORG' and t.source_system='$CONNECTOR_KEY' and t.origin='imported';")" = '2'
test "$(psqlc "select count(*) from shutdown_task_dependencies d join shutdown_events e on e.id=d.event_id where e.organization_id='$ORG' and d.task_key='A-200' and d.predecessor_key='A-100' and d.link_type='FS' and d.lag_hours=2;")" = '1'

STALE=$(service_rpc begin_p6_schedule_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":150}")
expect_error "$STALE" 'does not advance'

MANIFEST_TWO='[{"transport":"oracle_p6_eppm_rest","resource":"activity","project_object_id":4101,"row_count":2,"bytes":110,"sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},{"transport":"oracle_p6_eppm_rest","resource":"relationship","project_object_id":4101,"row_count":1,"bytes":55,"sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}]'
CURSOR_TWO="{\"fetched_at\":\"$FETCH_TWO\",\"activity_sha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"relationship_sha256\":\"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\"}"
BEGIN_TWO=$(service_rpc begin_p6_schedule_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_manifest\":$MANIFEST_TWO,\"p_cursor_to\":$CURSOR_TWO,\"p_source_bytes\":165}")
noerr "$BEGIN_TWO"; RUN_TWO=$(field "$BEGIN_TWO" run_id)
ROWS_TWO="${ROWS_ONE/Open exchanger/Open exchanger and inspect bundle}"
INGEST_TWO=$(service_rpc ingest_p6_schedule_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER\",\"p_run_id\":\"$RUN_TWO\",\"p_actor_aal\":\"aal1\",\"p_rows\":$ROWS_TWO}")
noerr "$INGEST_TWO"; test "$(field "$INGEST_TWO" duplicate)" = '2'
FINISH_TWO=$(service_rpc finish_p6_schedule_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_TWO\",\"p_status\":\"success\",\"p_error\":null}")
noerr "$FINISH_TWO"; test "$(field "$FINISH_TWO" watermark_advanced)" = 'true'

FOREIGN_REVISION=$(rpc "$FOREIGN_JWT" propose_schedule_import_revision "{\"p_run_id\":\"$RUN_TWO\"}")
expect_error "$FOREIGN_REVISION" 'not found'
REVISION=$(rpc "$PLANNER_JWT" propose_schedule_import_revision "{\"p_run_id\":\"$RUN_TWO\"}")
noerr "$REVISION"; REVISION_ID=$(field "$REVISION" revisionId)
test "$(field "$REVISION" status)" = 'pending'
test "$(field "$REVISION" changeCount)" = '1'
DECIDED=$(rpc "$PLANNER_JWT" decide_schedule_import_revision "{\"p_revision_id\":\"$REVISION_ID\",\"p_decision\":\"approved\",\"p_note\":\"The planner compared the complete P6 snapshot and approved this changed activity.\"}")
noerr "$DECIDED"; test "$(field "$DECIDED" applied)" = 'true'
test "$(psqlc "select count(*) from shutdown_tasks t join shutdown_events e on e.id=t.event_id where e.organization_id='$ORG' and t.source_system='$CONNECTOR_KEY' and t.external_id='A-200' and t.label='Open exchanger and inspect bundle';")" = '1'

OUT=$(sql_must_fail "update connectors set write_enabled=true where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'connectors_scheduling_read_profile_check' <<<"$OUT"
DIRECT_RUN=$(sql_must_fail "insert into connector_runs(organization_id,connector_id,entity_type,run_type,status) select '$ORG',id,'schedule_activity','sync','running' from connectors where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'service-attested complete transport evidence' <<<"$DIRECT_RUN"
test "$(psqlc "select count(*) from decisions where organization_id='$ORG' and decision_type='p6_schedule_read_source';")" = '1'
test "$(psqlc "select count(*) from ingest_watermarks where organization_id='$ORG' and last_run_id='$RUN_TWO' and last_cursor->>'activity_sha256'=repeat('c',64);")" = '1'

echo 'C2.16 P6 schedule read smoke passed: canonical_connector=true canonical_schedule=true canonical_revision=true tenant_wall=true administrator_profile=true service_attestation=true exact_hashes=true exact_row_reconciliation=true one_shot_ingest=true monotonic_watermark=true retained_duplicates=true named_human_revision=true source_write_back=false'

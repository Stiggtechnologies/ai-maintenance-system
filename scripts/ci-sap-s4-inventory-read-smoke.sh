#!/usr/bin/env bash
# C2.17 — service-attested SAP S/4HANA unrestricted-stock read.
set -euo pipefail
trap 'echo "C2.17 SAP inventory read smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); ADMIN=$(uuid); MANAGER=$(uuid); FOREIGN=$(uuid); SITE=$(uuid); FOREIGN_SITE=$(uuid)
MATERIAL_ONE=$(uuid); MATERIAL_TWO=$(uuid); CONNECTOR_KEY="c217-sap-${ORG:0:8}"
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
insert into organizations(id,name) values('$ORG','C2.17 inventory tenant'),('$FOREIGN_ORG','C2.17 foreign tenant');
insert into sites(id,organization_id,name) values('$SITE','$ORG','North Plant'),('$FOREIGN_SITE','$FOREIGN_ORG','Foreign Plant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$ADMIN','authenticated','authenticated','c217-admin-$ADMIN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$MANAGER','authenticated','authenticated','c217-manager-$MANAGER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','c217-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
('$ADMIN','$ORG','c217-admin-$ADMIN@invalid.syncai.ca','C2.17 administrator','admin'),
('$MANAGER','$ORG','c217-manager-$MANAGER@invalid.syncai.ca','C2.17 inventory manager','inventory_manager'),
('$FOREIGN','$FOREIGN_ORG','c217-foreign-$FOREIGN@invalid.syncai.ca','C2.17 foreign administrator','admin');
insert into materials(id,organization_id,material_code,description,unit_of_measure,is_template,source_system)
values('$MATERIAL_ONE','$ORG','MAT-001','Seal kit','EA',false,'customer_catalogue');
insert into material_stock(organization_id,material_id,site_id,qty_on_hand,qty_reserved,qty_on_order,expected_receipt_date,source_system)
values('$ORG','$MATERIAL_ONE','$SITE',2,3,7,'2026-12-01','legacy_inventory');
PSQL

ADMIN_JWT=$(jwt "$ADMIN" "c217-admin-$ADMIN@invalid.syncai.ca")
MANAGER_JWT=$(jwt "$MANAGER" "c217-manager-$MANAGER@invalid.syncai.ca")
FOREIGN_JWT=$(jwt "$FOREIGN" "c217-foreign-$FOREIGN@invalid.syncai.ca")
BASE="{\"p_key\":\"$CONNECTOR_KEY\",\"p_name\":\"C2.17 governed SAP stock\",\"p_service_root\":\"https://sap.example.com/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV\",\"p_plant\":\"1000\",\"p_storage_location\":\"0001\",\"p_site_id\":\"$SITE\",\"p_max_rows\":100,\"p_page_size\":50,\"p_max_pages\":5,\"p_expected_interval_minutes\":60,\"p_credential_binding_ref\":\"vault://tenant/sap-s4-inventory\",\"p_enabled\":true,\"p_basis\":\"Named inventory manager approved SAP Plant 1000 StorageLocation 0001 as North Plant.\"}"

expect_error "$(rpc "$MANAGER_JWT" configure_sap_s4_inventory_source "$BASE")" 'requires an administrator'
BAD_SITE="${BASE/$SITE/$FOREIGN_SITE}"
expect_error "$(rpc "$ADMIN_JWT" configure_sap_s4_inventory_source "$BAD_SITE")" 'outside the active tenant'
BAD_ENDPOINT="${BASE/https:\/\/sap.example.com/https:\/\/192.168.1.50}"
expect_error "$(rpc "$ADMIN_JWT" configure_sap_s4_inventory_source "$BAD_ENDPOINT")" 'private/local targets are blocked'
CONFIGURED=$(rpc "$ADMIN_JWT" configure_sap_s4_inventory_source "$BASE"); noerr "$CONFIGURED"
test "$(field "$CONFIGURED" enabled)" = 'true'
test "$(field "$CONFIGURED" write_enabled)" = 'false'
test "$(field "$CONFIGURED" source_profile)" = 'sap_s4_material_stock'

SOURCE=$(rpc "$MANAGER_JWT" get_sap_s4_inventory_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}"); noerr "$SOURCE"
test "$(field "$SOURCE" site_id)" = "$SITE"
test "$(field "$SOURCE" plant)" = '1000'
expect_error "$(rpc "$FOREIGN_JWT" get_sap_s4_inventory_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}")" 'not found'
test "$(psqlc "select has_function_privilege('authenticated','public.begin_sap_s4_inventory_read_run(uuid,uuid,text,jsonb,jsonb,bigint)','execute');")" = 'f'
test "$(psqlc "select has_function_privilege('service_role','public.begin_sap_s4_inventory_read_run(uuid,uuid,text,jsonb,jsonb,bigint)','execute');")" = 't'

MANIFEST='[{"transport":"sap_s4_odata_v2","resource":"A_MatlStkInAcctMod","page":1,"plant":"1000","storage_location":"0001","row_count":2,"bytes":150,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'
CURSOR_ONE="{\"fetched_at\":\"$FETCH_ONE\",\"raw_rows\":2,\"mapped_rows\":2,\"pages\":1}"
BEGIN_ONE=$(service_rpc begin_sap_s4_inventory_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$MANAGER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_manifest\":$MANIFEST,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":150}"); noerr "$BEGIN_ONE"; RUN_ONE=$(field "$BEGIN_ONE" run_id)
ROWS_ONE="[{\"external_id\":\"1000:0001:MAT-001\",\"material_code\":\"MAT-001\",\"unit_of_measure\":\"EA\",\"qty_on_hand\":12,\"site_id\":\"$SITE\",\"observed_at\":\"$FETCH_ONE\"},{\"external_id\":\"1000:0001:MAT-002\",\"material_code\":\"MAT-002\",\"unit_of_measure\":\"EA\",\"qty_on_hand\":4,\"site_id\":\"$SITE\",\"observed_at\":\"$FETCH_ONE\"}]"
INGEST_ONE=$(service_rpc ingest_sap_s4_inventory_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$MANAGER\",\"p_run_id\":\"$RUN_ONE\",\"p_rows\":$ROWS_ONE}"); noerr "$INGEST_ONE"
test "$(field "$INGEST_ONE" accepted)" = '1'; test "$(field "$INGEST_ONE" rejected)" = '1'
expect_error "$(service_rpc finish_sap_s4_inventory_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_ONE\",\"p_status\":\"success\",\"p_error\":null}")" 'rejected rows'
FINISH_ONE=$(service_rpc finish_sap_s4_inventory_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_ONE\",\"p_status\":\"partial\",\"p_error\":\"unknown material retained\"}"); noerr "$FINISH_ONE"
test "$(field "$FINISH_ONE" watermark_advanced)" = 'false'
test "$(psqlc "select qty_on_hand||'|'||qty_reserved||'|'||qty_on_order||'|'||expected_receipt_date from material_stock where organization_id='$ORG' and material_id='$MATERIAL_ONE' and site_id='$SITE';")" = '12|3|7|2026-12-01'

psqlc "insert into materials(id,organization_id,material_code,description,unit_of_measure,is_template,source_system) values('$MATERIAL_TWO','$ORG','MAT-002','Bearing','EA',false,'customer_catalogue');" >/dev/null
CURSOR_TWO="{\"fetched_at\":\"$FETCH_TWO\",\"raw_rows\":2,\"mapped_rows\":2,\"pages\":1}"
BEGIN_TWO=$(service_rpc begin_sap_s4_inventory_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$MANAGER\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_manifest\":$MANIFEST,\"p_cursor_to\":$CURSOR_TWO,\"p_source_bytes\":150}"); noerr "$BEGIN_TWO"; RUN_TWO=$(field "$BEGIN_TWO" run_id)
ROWS_TWO="${ROWS_ONE//$FETCH_ONE/$FETCH_TWO}"
INGEST_TWO=$(service_rpc ingest_sap_s4_inventory_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$MANAGER\",\"p_run_id\":\"$RUN_TWO\",\"p_rows\":$ROWS_TWO}"); noerr "$INGEST_TWO"
test "$(field "$INGEST_TWO" duplicate)" = '1'; test "$(field "$INGEST_TWO" accepted)" = '1'; test "$(field "$INGEST_TWO" rejected)" = '0'
FINISH_TWO=$(service_rpc finish_sap_s4_inventory_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_TWO\",\"p_status\":\"success\",\"p_error\":null}"); noerr "$FINISH_TWO"
test "$(field "$FINISH_TWO" watermark_advanced)" = 'true'
test "$(psqlc "select count(*) from ingest_watermarks where organization_id='$ORG' and connector_id=(select id from connectors where organization_id='$ORG' and connector_key='$CONNECTOR_KEY') and entity_type='material_stock' and last_run_id='$RUN_TWO';")" = '1'
test "$(psqlc "select count(*) from ingest_staging where organization_id='$ORG' and run_id in ('$RUN_ONE','$RUN_TWO') and status='rejected' and reject_reason like '%governed tenant catalogue%';")" = '1'

OUT=$(sql_must_fail "update connectors set write_enabled=true where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'connectors_inventory_read_profile_check' <<<"$OUT"
DIRECT=$(sql_must_fail "insert into connector_runs(organization_id,connector_id,entity_type,run_type,status) select '$ORG',id,'material_stock','sync','running' from connectors where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'service-attested complete transport evidence' <<<"$DIRECT"
test "$(psqlc "select count(*) from decisions where organization_id='$ORG' and decision_type='sap_s4_inventory_read_source';")" = '1'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='sap_s4_inventory_read' and (event_data->>'sourceWriteBack')::boolean=false;")" = '2'

echo 'C2.17 SAP inventory read smoke passed: canonical_connector=true canonical_material_stock=true tenant_wall=true administrator_scope=true service_attestation=true exact_page_reconciliation=true exact_material_uom_site=true retained_rejects=true preserves_reserved_and_on_order=true clean_watermark=true source_write_back=false'

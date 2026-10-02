#!/usr/bin/env bash
set -euo pipefail
trap 'echo "C2.07 material-catalogue / repairable-history smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);v=x.get(os.environ['KEY']);print('' if v is None else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);sys.exit(1 if isinstance(x,dict) and x.get('error') else 0)"; }
expecterr(){ BODY="$1" NEEDLE="$2" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);sys.exit(0 if os.environ['NEEDLE'].lower() in str(x.get('error','')).lower() else 1)"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }

ENGINEER=$(token 'demo@syncai.ca' 'Demo123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$ENGINEER"; test -n "$TECH"; test -n "$ADMIN"

SUFFIX="$(date +%s)-$$"
ASSET=$(psqlc "select id from public.assets where organization_id='$ORG' order by created_at limit 1;")
test -n "$ASSET"
SUPPLIER=$(psqlc "insert into public.suppliers(organization_id,supplier_code,name,supplier_kind,approved_vendor) values('$ORG','C207-REPAIR-$SUFFIX','C2.07 governed repair supplier','repair_vendor',false) returning id;")
test -n "$SUPPLIER"

TECH_DENIED=$(rpc "$TECH" upsert_catalogue_material "{\"p_material_id\":null,\"p_material_code\":\"C207-TECH-$SUFFIX\",\"p_description\":\"Denied technician material\",\"p_category\":null,\"p_unit_of_measure\":\"each\",\"p_unit_cost_usd\":null,\"p_lead_time_days\":null,\"p_min_qty\":null,\"p_max_qty\":null,\"p_repairable_classification\":\"unknown\",\"p_criticality\":null,\"p_source_system\":\"C207-SMOKE\",\"p_basis\":\"Technician must not alter governed material master policy.\",\"p_expected_version\":null}")
expecterr "$TECH_DENIED" 'named human'

# The same human-role gate must refuse the explicit AI operator identity, not
# merely rely on the technician role falling outside the allow-list.
psqlc "update public.user_profiles set role='ai_admin' where organization_id='$ORG' and email='admin@syncai.ca';" >/dev/null
AI_DENIED=$(rpc "$ADMIN" upsert_catalogue_material "{\"p_material_id\":null,\"p_material_code\":\"C207-AI-$SUFFIX\",\"p_description\":\"Denied AI material\",\"p_category\":null,\"p_unit_of_measure\":\"each\",\"p_unit_cost_usd\":null,\"p_lead_time_days\":null,\"p_min_qty\":null,\"p_max_qty\":null,\"p_repairable_classification\":\"unknown\",\"p_criticality\":null,\"p_source_system\":\"C207-SMOKE\",\"p_basis\":\"AI operator must not alter governed material master policy.\",\"p_expected_version\":null}")
expecterr "$AI_DENIED" 'named human'
psqlc "update public.user_profiles set role='admin' where organization_id='$ORG' and email='admin@syncai.ca';" >/dev/null

UNKNOWN=$(rpc "$ENGINEER" upsert_catalogue_material "{\"p_material_id\":null,\"p_material_code\":\"C207-UNKNOWN-$SUFFIX\",\"p_description\":\"Unassessed customer material\",\"p_category\":\"Unassessed\",\"p_unit_of_measure\":\"each\",\"p_unit_cost_usd\":null,\"p_lead_time_days\":null,\"p_min_qty\":null,\"p_max_qty\":null,\"p_repairable_classification\":\"unknown\",\"p_criticality\":null,\"p_source_system\":\"C207-SMOKE\",\"p_basis\":\"Customer catalogue identity with policy evidence still unknown.\",\"p_expected_version\":null}")
noerr "$UNKNOWN"; UNKNOWN_MATERIAL=$(field "$UNKNOWN" materialId); test -n "$UNKNOWN_MATERIAL"
test "$(psqlc "select repairable_classification||'|'||coalesce(lead_time_days::text,'unknown') from public.materials where id='$UNKNOWN_MATERIAL';")" = 'unknown|unknown'

CREATED=$(rpc "$ENGINEER" upsert_catalogue_material "{\"p_material_id\":null,\"p_material_code\":\"C207-FD-$SUFFIX\",\"p_description\":\"C2.07 serialized final drive\",\"p_category\":\"Powertrain\",\"p_unit_of_measure\":\"each\",\"p_unit_cost_usd\":125000,\"p_lead_time_days\":120,\"p_min_qty\":1,\"p_max_qty\":2,\"p_repairable_classification\":\"rotable\",\"p_criticality\":\"critical\",\"p_source_system\":\"C207-SMOKE\",\"p_basis\":\"Approved customer material master and stocking policy record.\",\"p_expected_version\":null}")
noerr "$CREATED"; MATERIAL=$(field "$CREATED" materialId); test -n "$MATERIAL"
test "$(field "$CREATED" masterVersion)" = '1'

REVISED=$(rpc "$ENGINEER" upsert_catalogue_material "{\"p_material_id\":\"$MATERIAL\",\"p_material_code\":\"C207-FD-$SUFFIX\",\"p_description\":\"C2.07 serialized final drive\",\"p_category\":\"Powertrain\",\"p_unit_of_measure\":\"each\",\"p_unit_cost_usd\":125000,\"p_lead_time_days\":135,\"p_min_qty\":1,\"p_max_qty\":2,\"p_repairable_classification\":\"rotable\",\"p_criticality\":\"critical\",\"p_source_system\":\"C207-SMOKE\",\"p_basis\":\"Supplier quote revision proves a governed lead-time change.\",\"p_expected_version\":1}")
noerr "$REVISED"; test "$(field "$REVISED" masterVersion)" = '2'
STALE=$(rpc "$ENGINEER" upsert_catalogue_material "{\"p_material_id\":\"$MATERIAL\",\"p_material_code\":\"C207-FD-$SUFFIX\",\"p_description\":\"Stale overwrite attempt\",\"p_category\":\"Powertrain\",\"p_unit_of_measure\":\"each\",\"p_unit_cost_usd\":125000,\"p_lead_time_days\":1,\"p_min_qty\":1,\"p_max_qty\":2,\"p_repairable_classification\":\"rotable\",\"p_criticality\":\"critical\",\"p_source_system\":\"C207-SMOKE\",\"p_basis\":\"Stale material policy must not overwrite the accepted revision.\",\"p_expected_version\":1}")
expecterr "$STALE" 'changed after it was loaded'
test "$(psqlc "select count(*) from public.material_master_revisions where material_id='$MATERIAL';")" = '2'

FOREIGN_ORG=$(psqlc "insert into public.organizations(name,industry) values('C2.07 foreign $SUFFIX','test') returning id;")
FOREIGN_MATERIAL=$(psqlc "insert into public.materials(organization_id,material_code,description,unit_of_measure,repairable_classification,is_template,basis,source_system) values('$FOREIGN_ORG','C207-FOREIGN-$SUFFIX','Foreign rotable','each','rotable',false,'Foreign tenant material must remain isolated from the active tenant.','C207-SMOKE') returning id;")
FOREIGN=$(rpc "$ENGINEER" register_repairable_unit "{\"p_material_id\":\"$FOREIGN_MATERIAL\",\"p_serial_number\":\"FOREIGN-SERIAL\",\"p_source_system\":\"C207-SMOKE\",\"p_basis\":\"Foreign tenant serial registration must be refused in full.\",\"p_source_ref\":\"FOREIGN\"}")
expecterr "$FOREIGN" 'outside the active tenant'

UNIT_RESULT=$(rpc "$ENGINEER" register_repairable_unit "{\"p_material_id\":\"$MATERIAL\",\"p_serial_number\":\"SN-$SUFFIX\",\"p_source_system\":\"C207-SMOKE\",\"p_basis\":\"Verified customer serialized-component register transaction.\",\"p_source_ref\":\"SERIAL-$SUFFIX\"}")
noerr "$UNIT_RESULT"; UNIT=$(field "$UNIT_RESULT" repairableUnitId); test -n "$UNIT"
DUPLICATE=$(rpc "$ENGINEER" register_repairable_unit "{\"p_material_id\":\"$MATERIAL\",\"p_serial_number\":\"sn-$SUFFIX\",\"p_source_system\":\"C207-SMOKE\",\"p_basis\":\"Duplicate serial case must refuse despite letter-case differences.\",\"p_source_ref\":\"DUPLICATE\"}")
expecterr "$DUPLICATE" 'already exists'

INVALID=$(rpc "$ENGINEER" record_repairable_unit_event "{\"p_repairable_unit_id\":\"$UNIT\",\"p_event_type\":\"received_from_repair\",\"p_occurred_at\":\"$(python3 -c 'from datetime import datetime,timezone,timedelta;print((datetime.now(timezone.utc)+timedelta(minutes=1)).isoformat())')\",\"p_basis\":\"A repair receipt cannot occur before installation and removal.\",\"p_expected_version\":1,\"p_source_system\":\"C207-SMOKE\",\"p_asset_id\":null,\"p_component\":null,\"p_position\":null,\"p_meter_hours\":null,\"p_work_order_id\":null,\"p_supplier_id\":$SUPPLIER,\"p_repair_cost_usd\":1000,\"p_repair_order_ref\":\"RO-$SUFFIX\",\"p_evidence_ref\":\"REPORT-$SUFFIX\"}")
expecterr "$INVALID" 'invalid repairable-unit transition'

T1=$(python3 -c 'from datetime import datetime,timezone,timedelta;print((datetime.now(timezone.utc)+timedelta(minutes=2)).isoformat())')
T2=$(python3 -c 'from datetime import datetime,timezone,timedelta;print((datetime.now(timezone.utc)+timedelta(minutes=3)).isoformat())')
T3=$(python3 -c 'from datetime import datetime,timezone,timedelta;print((datetime.now(timezone.utc)+timedelta(minutes=4)).isoformat())')
T4=$(python3 -c 'from datetime import datetime,timezone,timedelta;print((datetime.now(timezone.utc)+timedelta(minutes=34)).isoformat())')

INSTALL=$(rpc "$ENGINEER" record_repairable_unit_event "{\"p_repairable_unit_id\":\"$UNIT\",\"p_event_type\":\"installed\",\"p_occurred_at\":\"$T1\",\"p_basis\":\"Approved installation work record for the serialized final drive.\",\"p_expected_version\":1,\"p_source_system\":\"C207-SMOKE\",\"p_asset_id\":\"$ASSET\",\"p_component\":\"Final drive\",\"p_position\":\"C207-$SUFFIX\",\"p_meter_hours\":1000,\"p_work_order_id\":null,\"p_supplier_id\":null,\"p_repair_cost_usd\":null,\"p_repair_order_ref\":null,\"p_evidence_ref\":\"INSTALL-$SUFFIX\"}")
noerr "$INSTALL"; test "$(field "$INSTALL" version)" = '2'
BACKDATED=$(rpc "$ENGINEER" record_repairable_unit_event "{\"p_repairable_unit_id\":\"$UNIT\",\"p_event_type\":\"removed\",\"p_occurred_at\":\"$(python3 -c 'from datetime import datetime,timezone;print(datetime.now(timezone.utc).isoformat())')\",\"p_basis\":\"Backdated lifecycle evidence must not reorder the serialized history.\",\"p_expected_version\":2,\"p_source_system\":\"C207-SMOKE\",\"p_asset_id\":null,\"p_component\":null,\"p_position\":null,\"p_meter_hours\":1100,\"p_work_order_id\":null,\"p_supplier_id\":null,\"p_repair_cost_usd\":null,\"p_repair_order_ref\":null,\"p_evidence_ref\":\"BACKDATED\"}")
expecterr "$BACKDATED" 'cannot precede'
REMOVE=$(rpc "$ENGINEER" record_repairable_unit_event "{\"p_repairable_unit_id\":\"$UNIT\",\"p_event_type\":\"removed\",\"p_occurred_at\":\"$T2\",\"p_basis\":\"Approved removal work record preserves the component installation stint.\",\"p_expected_version\":2,\"p_source_system\":\"C207-SMOKE\",\"p_asset_id\":null,\"p_component\":null,\"p_position\":null,\"p_meter_hours\":1100,\"p_work_order_id\":null,\"p_supplier_id\":null,\"p_repair_cost_usd\":null,\"p_repair_order_ref\":null,\"p_evidence_ref\":\"REMOVE-$SUFFIX\"}")
noerr "$REMOVE"
SENT=$(rpc "$ENGINEER" record_repairable_unit_event "{\"p_repairable_unit_id\":\"$UNIT\",\"p_event_type\":\"sent_for_repair\",\"p_occurred_at\":\"$T3\",\"p_basis\":\"Stores dispatch record binds the serial to the repair supplier and order.\",\"p_expected_version\":3,\"p_source_system\":\"C207-SMOKE\",\"p_asset_id\":null,\"p_component\":null,\"p_position\":null,\"p_meter_hours\":1100,\"p_work_order_id\":null,\"p_supplier_id\":$SUPPLIER,\"p_repair_cost_usd\":null,\"p_repair_order_ref\":\"RO-$SUFFIX\",\"p_evidence_ref\":\"DISPATCH-$SUFFIX\"}")
noerr "$SENT"
RECEIVED=$(rpc "$ENGINEER" record_repairable_unit_event "{\"p_repairable_unit_id\":\"$UNIT\",\"p_event_type\":\"received_from_repair\",\"p_occurred_at\":\"$T4\",\"p_basis\":\"Incoming inspection report records return without inferring repair acceptance.\",\"p_expected_version\":4,\"p_source_system\":\"C207-SMOKE\",\"p_asset_id\":null,\"p_component\":null,\"p_position\":null,\"p_meter_hours\":1100,\"p_work_order_id\":null,\"p_supplier_id\":null,\"p_repair_cost_usd\":25000,\"p_repair_order_ref\":null,\"p_evidence_ref\":\"INSPECTION-$SUFFIX\"}")
noerr "$RECEIVED"; test "$(field "$RECEIVED" version)" = '5'

REGISTER=$(rpc "$ENGINEER" get_repairable_unit_register '{}')
noerr "$REGISTER"
BODY="$REGISTER" UNIT="$UNIT" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);u=next((u for u in x['units'] if u['id']==os.environ['UNIT']),None);sys.exit(0 if u and u['currentState']=='available' and len(u['events'])==5 and u['repairTurnaroundHours']==0.5 and u['events'][0]['supplierId']==int('$SUPPLIER') and u['events'][0]['repairOrderRef']=='RO-$SUFFIX' else 1)"
test "$(psqlc "select evidence_snapshot->'material'->>'masterVersion' from public.repairable_unit_events where repairable_unit_id='$UNIT' and event_type='received_from_repair';")" = '2'
test "$(psqlc "select evidence_snapshot->'supplier'->>'code' from public.repairable_unit_events where repairable_unit_id='$UNIT' and event_type='received_from_repair';")" = "C207-REPAIR-$SUFFIX"
test "$(psqlc "select evidence_snapshot->'asset'->>'id' from public.repairable_unit_events where repairable_unit_id='$UNIT' and event_type='installed';")" = "$ASSET"

DIRECT_MATERIAL=$(curl -sS -o /tmp/c207-direct-material.txt -w '%{http_code}' -X PATCH "$API_URL/rest/v1/materials?id=eq.$MATERIAL" -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" -H 'content-type: application/json' -d '{"lead_time_days":1}')
DIRECT_EVENT=$(curl -sS -o /tmp/c207-direct-event.txt -w '%{http_code}' -X PATCH "$API_URL/rest/v1/repairable_unit_events?repairable_unit_id=eq.$UNIT" -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" -H 'content-type: application/json' -d '{"basis":"Direct history rewrite must remain locked."}')
case "$DIRECT_MATERIAL" in 401|403) ;; *) false ;; esac
case "$DIRECT_EVENT" in 401|403) ;; *) false ;; esac

echo 'C2.07 material-catalogue and repairable-history smoke passed: named_human_only=true tenant_wall=true optimistic_catalogue=true direct_write_locked=true serial_unique=true transition_order=true event_history=true turnaround_evidence=true unknown_visible=true'

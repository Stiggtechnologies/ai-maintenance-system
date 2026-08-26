#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Recovery activation smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"
: "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
SOURCE='ci-first-tenant'

field(){ python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$1'); print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))"; }
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and x.get('error'):
    print('unexpected activation error:',x); sys.exit(1)
PY
}
token(){ local r; r=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$r"|python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }

ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
test -n "$ADMIN"; test -n "$PLANNER"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from restoration_events where organization_id='$ORG' and asset_id in (select id from assets where organization_id='$ORG' and source_system='$SOURCE');
delete from connector_runs where organization_id='$ORG' and connector_id in (select id from connectors where organization_id='$ORG' and connector_key='$SOURCE');
delete from connectors where organization_id='$ORG' and connector_key='$SOURCE';
delete from production_records where organization_id='$ORG' and source_system='$SOURCE';
delete from operating_states where organization_id='$ORG' and source_system='$SOURCE';
delete from material_stock where organization_id='$ORG' and source_system='$SOURCE';
delete from craft_capacity where organization_id='$ORG' and source_system='$SOURCE';
delete from work_orders where organization_id='$ORG' and source_system='$SOURCE';
delete from assets where organization_id='$ORG' and source_system='$SOURCE';
delete from materials where organization_id='$ORG' and source_system='$SOURCE';
delete from sites where organization_id='$ORG' and source_system='$SOURCE';
SQL

CFG=$(rpc "$ADMIN" configure_recovery_activation_source '{"p_key":"ci-first-tenant","p_name":"CI first tenant file","p_system_kind":"file","p_endpoint_url":null,"p_expected_interval_minutes":null,"p_credential_binding_ref":null,"p_enabled":true,"p_basis":"CI administrator authorizes a disposable read-only first-tenant source"}')
noerr "$CFG"

approve(){
  local entity="$1" mapping="$2"
  local payload out
  payload=$(python3 -c 'import json,sys; print(json.dumps({"p_connector_key":"ci-first-tenant","p_entity_type":sys.argv[1],"p_source_array_path":"","p_column_mapping":json.loads(sys.argv[2]),"p_value_mappings":{},"p_constants":{},"p_approve":True,"p_basis":"CI administrator confirms canonical field and vocabulary mapping"}))' "$entity" "$mapping")
  out=$(rpc "$ADMIN" save_recovery_activation_mapping "$payload")
  noerr "$out"
}

approve site '{"external_id":"external_id","name":"name","code":"code"}'
approve asset '{"external_id":"external_id","name":"name","site_external_id":"site_external_id","tag":"tag","asset_class":"asset_class","criticality":"criticality","status":"status"}'
approve work_order '{"external_id":"external_id","title":"title","asset_external_id":"asset_external_id","wo_number":"wo_number","status":"status","priority":"priority","work_type":"work_type","planned_hours":"planned_hours","created_at":"created_at"}'
approve material '{"external_id":"external_id","material_code":"material_code","description":"description","unit_of_measure":"unit_of_measure","criticality":"criticality","basis":"basis"}'
approve material_stock '{"external_id":"external_id","material_external_id":"material_external_id","site_external_id":"site_external_id","qty_on_hand":"qty_on_hand","qty_reserved":"qty_reserved","qty_on_order":"qty_on_order","last_counted_at":"last_counted_at"}'
approve craft_capacity '{"external_id":"external_id","site_external_id":"site_external_id","craft":"craft","weekly_hours":"weekly_hours","effective_from":"effective_from","basis":"basis"}'
approve operating_state '{"external_id":"external_id","asset_external_id":"asset_external_id","state":"state","started_at":"started_at","reason_code":"reason_code"}'
approve production_record '{"external_id":"external_id","site_external_id":"site_external_id","period_start":"period_start","period_end":"period_end","units_produced":"units_produced","unit_of_measure":"unit_of_measure"}'

# Dry run rejects an unresolved identity and writes neither staging nor target.
STAGING_BEFORE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "select count(*) from ingest_staging where organization_id='$ORG' and connector_id=(select id from connectors where organization_id='$ORG' and connector_key='$SOURCE');")
BAD=$(rpc "$PLANNER" preview_recovery_activation_batch '{"p_connector_key":"ci-first-tenant","p_entity_type":"asset","p_rows":[{"external_id":"CI-ASSET-BAD","name":"Unresolved asset","site_external_id":"NO-SITE"}]}')
noerr "$BAD"
BODY="$BAD" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if not x.get('dry_run') or x.get('rejected')!=1 or x.get('accepted')!=0:
    print('dry-run did not reject unresolved identity',x); sys.exit(1)
PY
STAGING_AFTER=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "select count(*) from ingest_staging where organization_id='$ORG' and connector_id=(select id from connectors where organization_id='$ORG' and connector_key='$SOURCE');")
test "$STAGING_BEFORE" = "$STAGING_AFTER"

import_entity(){
  local entity="$1" rows="$2" begin run_id payload ing finish
  begin=$(rpc "$PLANNER" begin_recovery_activation_run "{\"p_connector_key\":\"$SOURCE\",\"p_entity_type\":\"$entity\",\"p_run_type\":\"manual\"}")
  noerr "$begin"; run_id=$(printf '%s' "$begin"|field run_id); test -n "$run_id"
  payload=$(python3 -c 'import json,sys; print(json.dumps({"p_run_id":sys.argv[1],"p_rows":json.loads(sys.argv[2])}))' "$run_id" "$rows")
  ing=$(rpc "$PLANNER" ingest_recovery_activation_batch "$payload"); noerr "$ing"
  finish=$(rpc "$PLANNER" finish_connector_run "{\"p_run_id\":\"$run_id\",\"p_status\":\"success\",\"p_error\":null}"); noerr "$finish"
  printf '%s' "$ing"
}

NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
START=$(date -u -d '-2 hours' '+%Y-%m-%dT%H:%M:%SZ')
PERIOD_START=$(date -u -d '-1 hour' '+%Y-%m-%dT%H:%M:%SZ')

SITE_RESULT=$(import_entity site '[{"external_id":"CI-SITE-1","name":"CI Recovery Mine","code":"CIRM"}]'); noerr "$SITE_RESULT"
ASSET_RESULT=$(import_entity asset '[{"external_id":"CI-ASSET-1","name":"CI Recovery Haul Truck","site_external_id":"CI-SITE-1","tag":"CI-HT-1","asset_class":"haul_truck","criticality":"high","status":"critical"}]'); noerr "$ASSET_RESULT"
WO_ROWS="[{\"external_id\":\"CI-WO-1\",\"title\":\"Repair propulsion fault for first Recovery plan\",\"asset_external_id\":\"CI-ASSET-1\",\"wo_number\":\"CI-WO-1\",\"status\":\"scheduled\",\"priority\":\"high\",\"work_type\":\"corrective\",\"planned_hours\":4,\"created_at\":\"$NOW\"}]"
WO_RESULT=$(import_entity work_order "$WO_ROWS"); noerr "$WO_RESULT"
MAT_RESULT=$(import_entity material '[{"external_id":"CI-MAT-1","material_code":"CI-COUPLING-1","description":"CI propulsion coupling","unit_of_measure":"each","criticality":"essential","basis":"CI customer catalogue export evidence"}]'); noerr "$MAT_RESULT"
STOCK_ROWS="[{\"external_id\":\"CI-STOCK-1\",\"material_external_id\":\"CI-MAT-1\",\"site_external_id\":\"CI-SITE-1\",\"qty_on_hand\":2,\"qty_reserved\":0,\"qty_on_order\":0,\"last_counted_at\":\"$NOW\"}]"
STOCK_RESULT=$(import_entity material_stock "$STOCK_ROWS"); noerr "$STOCK_RESULT"
CREW_RESULT=$(import_entity craft_capacity "[{\"external_id\":\"CI-CREW-1\",\"site_external_id\":\"CI-SITE-1\",\"craft\":\"Heavy equipment technician\",\"weekly_hours\":40,\"effective_from\":\"$(date -u +%F)\",\"basis\":\"CI customer roster after leave and indirect time\"}]"); noerr "$CREW_RESULT"
STATE_ROWS="[{\"external_id\":\"CI-STATE-1\",\"asset_external_id\":\"CI-ASSET-1\",\"state\":\"down_unplanned\",\"started_at\":\"$START\",\"reason_code\":\"propulsion_fault\"}]"
STATE_RESULT=$(import_entity operating_state "$STATE_ROWS"); noerr "$STATE_RESULT"
PROD_ROWS="[{\"external_id\":\"CI-PROD-1\",\"site_external_id\":\"CI-SITE-1\",\"period_start\":\"$PERIOD_START\",\"period_end\":\"$NOW\",\"units_produced\":100,\"unit_of_measure\":\"tonnes\"}]"
PROD_RESULT=$(import_entity production_record "$PROD_ROWS"); noerr "$PROD_RESULT"

# Immutable history replays as duplicate rather than double-counting.
PROD_REPLAY=$(import_entity production_record "$PROD_ROWS")
BODY="$PROD_REPLAY" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if x.get('duplicate')!=1 or x.get('accepted')!=0:
    print('production replay was not idempotent',x); sys.exit(1)
PY

# A committed bad row is retained with its rejection reason.
BEGIN_BAD=$(rpc "$PLANNER" begin_recovery_activation_run '{"p_connector_key":"ci-first-tenant","p_entity_type":"work_order","p_run_type":"manual"}'); noerr "$BEGIN_BAD"
BAD_RUN=$(printf '%s' "$BEGIN_BAD"|field run_id)
BAD_INGEST=$(rpc "$PLANNER" ingest_recovery_activation_batch "{\"p_run_id\":\"$BAD_RUN\",\"p_rows\":[{\"external_id\":\"CI-WO-BAD\",\"title\":\"Unresolved work order\",\"asset_external_id\":\"NO-ASSET\"}]}"); noerr "$BAD_INGEST"
BAD_FINISH=$(rpc "$PLANNER" finish_connector_run "{\"p_run_id\":\"$BAD_RUN\",\"p_status\":\"partial\",\"p_error\":null}"); noerr "$BAD_FINISH"
REJECTS=$(rpc "$PLANNER" get_recovery_activation_rejects "{\"p_run_id\":\"$BAD_RUN\",\"p_limit\":100}")
BODY="$REJECTS" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if len(x)!=1 or 'unknown asset_external_id' not in x[0].get('reject_reason',''):
    print('committed reject was not retained',x); sys.exit(1)
PY

READY=$(rpc "$PLANNER" get_recovery_activation_readiness '{}'); noerr "$READY"
BODY="$READY" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if not x.get('minimum_ready_for_draft') or not x.get('planning_inputs_complete'):
    print('activation readiness did not close all input domains',x); sys.exit(1)
states={d['key']:d['ready'] for d in x.get('domains',[])}
if not all(states.get(k) for k in ('sites','assets','work_orders','materials','crews','operating_state','production')):
    print('one or more first-tenant domains are not ready',states); sys.exit(1)
PY

ASSET_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "select id from assets where organization_id='$ORG' and source_system='$SOURCE' and external_id='CI-ASSET-1';")
WO_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "select id from work_orders where organization_id='$ORG' and source_system='$SOURCE' and external_id='CI-WO-1';")
BASELINE=$(date -u -d '+12 hours' '+%Y-%m-%dT%H:%M:%SZ')
PLAN=$(rpc "$PLANNER" prepare_first_recovery_plan "{\"p_asset_id\":\"$ASSET_ID\",\"p_work_order_ids\":[\"$WO_ID\"],\"p_reason\":\"CI first-customer unplanned propulsion recovery\",\"p_event_type\":\"unplanned\",\"p_baseline_return_at\":\"$BASELINE\",\"p_baseline_method\":\"control_estimate\",\"p_baseline_basis\":\"CI customer control estimate frozen before planning\"}")
noerr "$PLAN"
BODY="$PLAN" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if x.get('plan_status')!='draft' or x.get('approval_required') is not True or not x.get('event_id') or not x.get('plan_id'):
    print('guided first plan did not stop at governed draft',x); sys.exit(1)
PY
PLAN_ID=$(printf '%s' "$PLAN"|field plan_id)
PLAN_STATE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "select status||':'||(release_decision_id is null)::text from restoration_plan_versions where id='$PLAN_ID';")
test "$PLAN_STATE" = 'draft:true'

# Anonymous clients cannot inspect readiness or mutate activation configuration.
ANON_STATUS=$(curl -sS -o /tmp/recovery-activation-anon.txt -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_recovery_activation_readiness" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$ANON_STATUS" = '401' -o "$ANON_STATUS" = '403' -o "$ANON_STATUS" = '404'

echo "Recovery activation smoke passed: source=$SOURCE asset=$ASSET_ID plan=$PLAN_ID dry_run_no_writes=true"

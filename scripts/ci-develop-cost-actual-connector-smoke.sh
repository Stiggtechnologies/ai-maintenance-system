#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D11.33 cost/ERP actual connector smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
TITLE='D11.33 governed ERP actual connector'
BC_REF='D1133-ERP-BC'
LINE_REF='D1133-COST-001'

token(){
  local response
  response=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}")
  printf '%s' "$response" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}
rpc(){
  curl -sS -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" \
    -H 'content-type: application/json' -d "$3"
}
field(){
  BODY="$1" KEY="$2" python3 -c "import json,os; x=json.loads(os.environ['BODY']); v=x.get(os.environ['KEY']); print('' if v is None else v)"
}
noerr(){
  BODY="$1" python3 - <<'PY'
import json, os, sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and x.get('error'):
    print('unexpected error:',x); sys.exit(1)
PY
}
expect_error(){
  BODY="$1" WANT="$2" python3 - <<'PY'
import json, os, sys
x=json.loads(os.environ['BODY'])
e=x.get('error','') if isinstance(x,dict) else ''
if os.environ['WANT'].lower() not in str(e).lower():
    print('expected refusal containing',repr(os.environ['WANT']),'got',x); sys.exit(1)
PY
}
psqlc(){
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -qAt -c "$1"
}

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$PLANNER"; test -n "$TECH"

# Idempotent fixture reset. This connector key belongs only to this entity;
# deleting it clears the prior run/staging history through the canonical FKs.
psqlc "delete from connectors where organization_id='$ORG' and connector_key='manual-upload-cost_actual';" >/dev/null
psqlc "delete from business_cases where organization_id='$ORG' and case_ref='$BC_REF';" >/dev/null
psqlc "delete from development_cases where organization_id='$ORG' and title='$TITLE';" >/dev/null

BODY=$(rpc "$PLANNER" create_development_case \
  "{\"p_title\":\"$TITLE\",\"p_problem_statement\":\"Prove that cumulative ERP actuals land on the one coded Sync cost line without gaining baseline authority.\",\"p_lifecycle_type\":\"sustaining_capital\"}")
noerr "$BODY"; CASE=$(field "$BODY" case_id); test -n "$CASE"

BODY=$(rpc "$PLANNER" create_case_business_case \
  "{\"p_case_id\":\"$CASE\",\"p_case_ref\":\"$BC_REF\",\"p_title\":\"ERP actual connector economics\",\"p_driver\":\"reliability\",\"p_currency\":\"CAD\",\"p_discount_rate\":0.08,\"p_discount_rate_source\":\"Approved corporate planning rate for the connector smoke\"}")
noerr "$BODY"

BODY=$(rpc "$PLANNER" record_wbs_element \
  "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1\",\"title\":\"Mechanical installation\",\"scope_description\":\"Supply and install the governed mechanical work package\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cbs_code \
  "{\"p_case_id\":\"$CASE\",\"p_code\":{\"cbs_code\":\"C100\",\"title\":\"Mechanical works\",\"cost_type\":\"subcontract\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cost_item \
  "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"$LINE_REF\",\"wbs_code\":\"1\",\"cbs_code\":\"C100\",\"description\":\"Mechanical supply and installation\",\"basis\":\"Approved control estimate, revision A\",\"currency\":\"CAD\",\"baseline_cost\":\"1000\",\"commitment\":\"400\",\"forecast\":\"1200\",\"contingency\":\"100\",\"contingency_basis\":\"Quantified installation uncertainty allowance\"}}")
noerr "$BODY"

BASELINES_BEFORE=$(psqlc "select count(*) from development_baselines where development_case_id='$CASE';")

# The same five-role gate is on the door. A run id is not a capability.
DENIED=$(rpc "$TECH" begin_manual_import '{"p_entity_type":"cost_actual","p_source_name":"Forbidden technician ERP upload"}')
expect_error "$DENIED" 'planning, engineering or administrator role'

BODY=$(rpc "$PLANNER" begin_manual_import '{"p_entity_type":"cost_actual","p_source_name":"SAP CO month-end actuals"}')
noerr "$BODY"; RUN=$(field "$BODY" run_id); test -n "$RUN"

ROWS="[
 {\"external_id\":\"ERP-2027-01-31-001\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"$LINE_REF\",\"actual_to_date\":\"650\",\"currency\":\"CAD\",\"as_of\":\"2027-01-31T23:59:59Z\",\"basis\":\"SAP CO period 1 close, ledger 0L\"},
 {\"external_id\":\"ERP-BAD-LINE\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"NO-SUCH-LINE\",\"actual_to_date\":\"20\",\"currency\":\"CAD\",\"as_of\":\"2027-01-31T23:59:59Z\"},
 {\"external_id\":\"ERP-BAD-CURRENCY\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"$LINE_REF\",\"actual_to_date\":\"20\",\"currency\":\"USD\",\"as_of\":\"2027-01-31T23:59:59Z\"},
 {\"external_id\":\"ERP-BAD-NUMBER\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"$LINE_REF\",\"actual_to_date\":\"NaN\",\"currency\":\"CAD\",\"as_of\":\"2027-01-31T23:59:59Z\"},
 {\"external_id\":\"ERP-BAD-TIME\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"$LINE_REF\",\"actual_to_date\":\"20\",\"currency\":\"CAD\",\"as_of\":\"2027-01-31T23:59:59\"}
]"
BODY=$(rpc "$PLANNER" ingest_rows "{\"p_run_id\":\"$RUN\",\"p_rows\":$ROWS}")
noerr "$BODY"
test "$(field "$BODY" read)" = '5'
test "$(field "$BODY" accepted)" = '1'
test "$(field "$BODY" duplicate)" = '0'
test "$(field "$BODY" rejected)" = '4'
rpc "$PLANNER" finish_connector_run \
  "{\"p_run_id\":\"$RUN\",\"p_status\":\"partial\",\"p_error\":\"Four retained fixture refusals\"}" >/dev/null

# The one canonical line moved only its actual and provenance. Baseline,
# commitment, forecast, contingency, coding and original basis stayed put.
STATE=$(psqlc "select concat_ws('|',actual,baseline_cost,commitment,forecast,contingency,currency,basis,source_system,external_id) from project_cost_items where development_case_id='$CASE' and cost_item_ref='$LINE_REF';")
test "$STATE" = '650|1000|400|1200|100|CAD|Approved control estimate, revision A|manual-upload-cost_actual|ERP-2027-01-31-001'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='project_cost_actual_import' and event_data->>'case_id'='$CASE';")" = '1'
test "$(psqlc "select count(*) from development_baselines where development_case_id='$CASE';")" = "$BASELINES_BEFORE"

psqlc "select reject_reason from ingest_staging where run_id='$RUN' and status='rejected' order by id;" \
  | grep -qi 'existing coded line'
psqlc "select reject_reason from ingest_staging where run_id='$RUN' and status='rejected' order by id;" \
  | grep -qi 'exchange rate'
psqlc "select reject_reason from ingest_staging where run_id='$RUN' and status='rejected' order by id;" \
  | grep -qi 'finite number'
psqlc "select reject_reason from ingest_staging where run_id='$RUN' and status='rejected' order by id;" \
  | grep -qi 'explicit UTC offset'

# The validator itself is router-only. A browser cannot bypass ingest_rows and
# call it with a run id learned from the tenant-visible run list.
DIRECT=$(curl -sS -o /tmp/d1133-cost-direct.txt -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/ingest_cost_actual_batch" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $PLANNER" \
  -H 'content-type: application/json' \
  -d "{\"p_run_id\":\"$RUN\",\"p_rows\":[]}")
test "$DIRECT" = '401' || test "$DIRECT" = '403' || test "$DIRECT" = '404'

# Replay, conflict, stale time, no-op and a real later snapshot in one run.
BODY=$(rpc "$PLANNER" begin_manual_import '{"p_entity_type":"cost_actual","p_source_name":"SAP CO period 2 actuals"}')
noerr "$BODY"; RUN2=$(field "$BODY" run_id); test -n "$RUN2"
ROWS2="[
 {\"external_id\":\"ERP-2027-01-31-001\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"$LINE_REF\",\"actual_to_date\":\"650\",\"currency\":\"CAD\",\"as_of\":\"2027-01-31T23:59:59Z\",\"basis\":\"Exact replay\"},
 {\"external_id\":\"ERP-CONFLICT-SAME-CLOSE\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"$LINE_REF\",\"actual_to_date\":\"660\",\"currency\":\"CAD\",\"as_of\":\"2027-01-31T23:59:59Z\"},
 {\"external_id\":\"ERP-STALE\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"$LINE_REF\",\"actual_to_date\":\"640\",\"currency\":\"CAD\",\"as_of\":\"2027-01-30T23:59:59Z\"},
 {\"external_id\":\"ERP-2027-02-01-NOCHANGE\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"$LINE_REF\",\"actual_to_date\":\"650\",\"currency\":\"CAD\",\"as_of\":\"2027-02-01T23:59:59Z\"},
 {\"external_id\":\"ERP-2027-02-02-001\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"$LINE_REF\",\"actual_to_date\":\"700\",\"currency\":\"CAD\",\"as_of\":\"2027-02-02T23:59:59Z\",\"basis\":\"SAP CO period 2 close, ledger 0L\"}
]"
BODY=$(rpc "$PLANNER" ingest_rows "{\"p_run_id\":\"$RUN2\",\"p_rows\":$ROWS2}")
noerr "$BODY"
test "$(field "$BODY" read)" = '5'
test "$(field "$BODY" accepted)" = '1'
test "$(field "$BODY" duplicate)" = '2'
test "$(field "$BODY" rejected)" = '2'
rpc "$PLANNER" finish_connector_run \
  "{\"p_run_id\":\"$RUN2\",\"p_status\":\"partial\",\"p_error\":\"Two retained conflict/staleness refusals\"}" >/dev/null

test "$(psqlc "select actual from project_cost_items where development_case_id='$CASE' and cost_item_ref='$LINE_REF';")" = '700'
test "$(psqlc "select external_id from project_cost_items where development_case_id='$CASE' and cost_item_ref='$LINE_REF';")" = 'ERP-2027-02-02-001'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='project_cost_actual_import' and event_data->>'case_id'='$CASE';")" = '2'
test "$(psqlc "select count(*) from development_baselines where development_case_id='$CASE';")" = "$BASELINES_BEFORE"

psqlc "select reject_reason from ingest_staging where run_id='$RUN2' and status='rejected' order by id;" \
  | grep -qi 'different actual'
psqlc "select reject_reason from ingest_staging where run_id='$RUN2' and status='rejected' order by id;" \
  | grep -qi 'stale ERP data'

echo 'D11.33 cost/ERP actual connector smoke passed: one_import_door=true tenant_bound=true coded_line_only=true canonical_writer=true cumulative_snapshot=true currency_wall=true source_identity=true stale_refusal=true conflict_refusal=true retained_rejects=true idempotent_replay=true provenance=true baseline_authority=false'

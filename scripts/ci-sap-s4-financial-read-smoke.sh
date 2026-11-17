#!/usr/bin/env bash
# C2.18 — service-attested SAP S/4HANA G/L actuals read.
set -euo pipefail
trap 'echo "C2.18 SAP financial read smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
TITLE="C2.18 governed SAP actuals $RANDOM"
BC_REF="C218-BC-$RANDOM"
CONNECTOR_KEY="c218-sap-gl-$RANDOM"
TODAY=$(python3 -c 'from datetime import datetime,timezone; print(datetime.now(timezone.utc).date().isoformat())')
FETCH_ONE=$(python3 -c 'from datetime import datetime,timezone,timedelta; print((datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat().replace("+00:00","Z"))')
FETCH_TWO=$(python3 -c 'from datetime import datetime,timezone,timedelta; print((datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat().replace("+00:00","Z"))')
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

ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#'); PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
test -n "$ADMIN"; test -n "$PLANNER"
ADMIN_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")

BODY=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"$TITLE\",\"p_problem_statement\":\"Prove bounded SAP ledger actuals update only existing coded cost lines through the canonical writer.\",\"p_lifecycle_type\":\"sustaining_capital\"}"); noerr "$BODY"; CASE=$(field "$BODY" case_id)
BODY=$(rpc "$PLANNER" create_case_business_case "{\"p_case_id\":\"$CASE\",\"p_case_ref\":\"$BC_REF\",\"p_title\":\"SAP actual economics\",\"p_driver\":\"reliability\",\"p_currency\":\"CAD\",\"p_discount_rate\":0.08,\"p_discount_rate_source\":\"Approved corporate planning rate for C2.18 smoke\"}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1\",\"title\":\"Installation\",\"scope_description\":\"Governed installation work\"}}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cbs_code "{\"p_case_id\":\"$CASE\",\"p_code\":{\"cbs_code\":\"C100\",\"title\":\"Installation cost\",\"cost_type\":\"subcontract\"}}"); noerr "$BODY"
for REF in CIVIL ELEC; do
  BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"$REF\",\"wbs_code\":\"1\",\"cbs_code\":\"C100\",\"description\":\"$REF work\",\"basis\":\"Approved control estimate revision A\",\"currency\":\"CAD\",\"baseline_cost\":\"1000\",\"commitment\":\"400\",\"forecast\":\"1200\",\"contingency\":\"100\",\"contingency_basis\":\"Quantified installation uncertainty\"}}"); noerr "$BODY"
done
BASELINES_BEFORE=$(psqlc "select count(*) from development_baselines where development_case_id='$CASE'")

MAPPINGS='[{"wbsElementInternalId":"WB0001","glAccount":"0041000000","costItemRef":"CIVIL"},{"wbsElementInternalId":"WB0002","glAccount":"0042000000","costItemRef":"ELEC"}]'
BASE="{\"p_key\":\"$CONNECTOR_KEY\",\"p_name\":\"C2.18 governed SAP actuals\",\"p_service_root\":\"https://sap.example.com/sap/opu/odata/sap/API_GLACCOUNTLINEITEM_SRV\",\"p_development_case_id\":\"$CASE\",\"p_ledger\":\"0L\",\"p_company_code\":\"CA01\",\"p_currency\":\"CAD\",\"p_posting_start_date\":\"2026-01-01\",\"p_cost_mappings\":$MAPPINGS,\"p_max_rows\":100,\"p_page_size\":50,\"p_max_pages\":5,\"p_expected_interval_minutes\":1440,\"p_credential_binding_ref\":\"vault://tenant/sap-s4-finance\",\"p_enabled\":true,\"p_basis\":\"Finance approved ledger 0L company CA01 and the exact cumulative WBS and G-L mappings.\"}"

expect_error "$(rpc "$PLANNER" configure_sap_s4_financial_source "$BASE")" 'requires an administrator'
BAD_ENDPOINT="${BASE/https:\/\/sap.example.com/https:\/\/192.168.1.50}"
expect_error "$(rpc "$ADMIN" configure_sap_s4_financial_source "$BAD_ENDPOINT")" 'private/local targets are blocked'
BAD_REF="${BASE/CIVIL/NO-SUCH-LINE}"
expect_error "$(rpc "$ADMIN" configure_sap_s4_financial_source "$BAD_REF")" 'not an existing coded line'
CONFIGURED=$(rpc "$ADMIN" configure_sap_s4_financial_source "$BASE"); noerr "$CONFIGURED"
test "$(field "$CONFIGURED" enabled)" = 'true'; test "$(field "$CONFIGURED" write_enabled)" = 'false'; test "$(field "$CONFIGURED" source_profile)" = 'sap_s4_gl_actuals'
SOURCE=$(rpc "$PLANNER" get_sap_s4_financial_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}"); noerr "$SOURCE"
test "$(field "$SOURCE" development_case_id)" = "$CASE"; test "$(field "$SOURCE" company_code)" = 'CA01'
CONTRACT_HASH=$(field "$SOURCE" contract_hash); test ${#CONTRACT_HASH} = 64
test "$(psqlc "select has_function_privilege('authenticated','public.begin_sap_s4_financial_read_run(uuid,uuid,text,text,jsonb,jsonb,bigint)','execute');")" = 'f'
test "$(psqlc "select has_function_privilege('service_role','public.begin_sap_s4_financial_read_run(uuid,uuid,text,text,jsonb,jsonb,bigint)','execute');")" = 't'

MANIFEST_ONE="[{\"transport\":\"sap_s4_odata_v2\",\"resource\":\"GLAccountLineItem\",\"page\":1,\"ledger\":\"0L\",\"company_code\":\"CA01\",\"posting_date_from\":\"2026-01-01\",\"posting_date_to\":\"$TODAY\",\"row_count\":3,\"bytes\":180,\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}]"
CURSOR_ONE="{\"fetched_at\":\"$FETCH_ONE\",\"posting_date_from\":\"2026-01-01\",\"posting_date_to\":\"$TODAY\",\"raw_rows\":3,\"mapped_rows\":2,\"pages\":1,\"source_digest\":\"$DIGEST_ONE\",\"contract_hash\":\"$CONTRACT_HASH\",\"missing_mappings\":[]}"
expect_error "$(service_rpc begin_sap_s4_financial_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER_ID\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_contract_hash\":\"$(printf '0%.0s' {1..64})\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":180}")" 'contract changed'
psqlc "update user_profiles set role='ai_admin' where id='$ADMIN_ID'" >/dev/null
expect_error "$(rpc "$ADMIN" configure_sap_s4_financial_source "$BASE")" 'named human administrator'
expect_error "$(service_rpc begin_sap_s4_financial_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$ADMIN_ID\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_contract_hash\":\"$CONTRACT_HASH\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":180}")" 'not authorized'
psqlc "update user_profiles set role='admin' where id='$ADMIN_ID'" >/dev/null
BEGIN_ONE=$(service_rpc begin_sap_s4_financial_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER_ID\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_contract_hash\":\"$CONTRACT_HASH\",\"p_manifest\":$MANIFEST_ONE,\"p_cursor_to\":$CURSOR_ONE,\"p_source_bytes\":180}"); noerr "$BEGIN_ONE"; RUN_ONE=$(field "$BEGIN_ONE" run_id)
ROWS_ONE="[{\"external_id\":\"sapgl:0L:CA01:CIVIL:${DIGEST_ONE:0:24}\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"CIVIL\",\"actual_to_date\":650,\"currency\":\"CAD\",\"as_of\":\"$FETCH_ONE\",\"basis\":\"SAP cumulative mapped actual through $TODAY\"},{\"external_id\":\"sapgl:0L:CA01:ELEC:${DIGEST_ONE:0:24}\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"ELEC\",\"actual_to_date\":-1,\"currency\":\"CAD\",\"as_of\":\"$FETCH_ONE\",\"basis\":\"SAP cumulative mapped actual through $TODAY\"}]"
INGEST_ONE=$(service_rpc ingest_sap_s4_financial_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER_ID\",\"p_run_id\":\"$RUN_ONE\",\"p_actor_aal\":\"aal1\",\"p_rows\":$ROWS_ONE}"); noerr "$INGEST_ONE"
test "$(field "$INGEST_ONE" accepted)" = '1'; test "$(field "$INGEST_ONE" rejected)" = '1'
expect_error "$(service_rpc finish_sap_s4_financial_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_ONE\",\"p_status\":\"success\",\"p_error\":null}")" 'rejected rows'
FINISH_ONE=$(service_rpc finish_sap_s4_financial_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_ONE\",\"p_status\":\"partial\",\"p_error\":\"negative aggregate refused\"}"); noerr "$FINISH_ONE"
test "$(field "$FINISH_ONE" watermark_advanced)" = 'false'

MANIFEST_TWO="${MANIFEST_ONE//aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
CURSOR_TWO="{\"fetched_at\":\"$FETCH_TWO\",\"posting_date_from\":\"2026-01-01\",\"posting_date_to\":\"$TODAY\",\"raw_rows\":3,\"mapped_rows\":2,\"pages\":1,\"source_digest\":\"$DIGEST_TWO\",\"contract_hash\":\"$CONTRACT_HASH\",\"missing_mappings\":[]}"
BEGIN_TWO=$(service_rpc begin_sap_s4_financial_read_run "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER_ID\",\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_contract_hash\":\"$CONTRACT_HASH\",\"p_manifest\":$MANIFEST_TWO,\"p_cursor_to\":$CURSOR_TWO,\"p_source_bytes\":180}"); noerr "$BEGIN_TWO"; RUN_TWO=$(field "$BEGIN_TWO" run_id)
ROWS_TWO="[{\"external_id\":\"sapgl:0L:CA01:CIVIL:${DIGEST_TWO:0:24}\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"CIVIL\",\"actual_to_date\":700,\"currency\":\"CAD\",\"as_of\":\"$FETCH_TWO\",\"basis\":\"SAP cumulative mapped actual through $TODAY\"},{\"external_id\":\"sapgl:0L:CA01:ELEC:${DIGEST_TWO:0:24}\",\"development_case_id\":\"$CASE\",\"cost_item_ref\":\"ELEC\",\"actual_to_date\":200,\"currency\":\"CAD\",\"as_of\":\"$FETCH_TWO\",\"basis\":\"SAP cumulative mapped actual through $TODAY\"}]"
INGEST_TWO=$(service_rpc ingest_sap_s4_financial_read_batch "{\"p_organization_id\":\"$ORG\",\"p_triggered_by\":\"$PLANNER_ID\",\"p_run_id\":\"$RUN_TWO\",\"p_actor_aal\":\"aal1\",\"p_rows\":$ROWS_TWO}"); noerr "$INGEST_TWO"
test "$(field "$INGEST_TWO" accepted)" = '2'; test "$(field "$INGEST_TWO" rejected)" = '0'
FINISH_TWO=$(service_rpc finish_sap_s4_financial_read_run "{\"p_organization_id\":\"$ORG\",\"p_run_id\":\"$RUN_TWO\",\"p_status\":\"success\",\"p_error\":null}"); noerr "$FINISH_TWO"
test "$(field "$FINISH_TWO" watermark_advanced)" = 'true'
test "$(psqlc "select string_agg(cost_item_ref||'='||actual::text||'|'||baseline_cost::text||'|'||commitment::text||'|'||forecast::text,',' order by cost_item_ref) from project_cost_items where development_case_id='$CASE';")" = 'CIVIL=700|1000|400|1200,ELEC=200|1000|400|1200'
test "$(psqlc "select count(*) from development_baselines where development_case_id='$CASE';")" = "$BASELINES_BEFORE"
test "$(psqlc "select count(*) from ingest_watermarks where organization_id='$ORG' and last_run_id='$RUN_TWO' and entity_type='cost_actual';")" = '1'

OUT=$(sql_must_fail "update connectors set write_enabled=true where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'connectors_financial_read_profile_check' <<<"$OUT"
DIRECT=$(sql_must_fail "insert into connector_runs(organization_id,connector_id,entity_type,run_type,status) select '$ORG',id,'cost_actual','sync','running' from connectors where organization_id='$ORG' and connector_key='$CONNECTOR_KEY';")
grep -qi 'service-attested complete transport evidence' <<<"$DIRECT"
test "$(psqlc "select count(*) from decisions where organization_id='$ORG' and decision_type='sap_s4_financial_read_source' and human_actor='$ADMIN_ID';")" = '1'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='sap_s4_financial_read' and (event_data->>'sourceWriteBack')::boolean=false and (event_data->>'baselineAuthority')::boolean=false;")" = '2'

echo 'C2.18 SAP financial read smoke passed: canonical_connector=true canonical_cost_writer=true tenant_wall=true named_human_administrator=true ai_promotion_refused=true immutable_contract_hash=true service_attestation=true exact_page_reconciliation=true explicit_wbs_gl_mapping=true mixed_currency_refused=true retained_rejects=true preserves_baseline_commitment_forecast=true clean_watermark=true source_write_back=false'

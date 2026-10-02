#!/usr/bin/env bash
set -euo pipefail
trap 'echo "C2.06 production-loss classification smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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
test -n "$ASSET"

SUFFIX="$(date +%s)-$$"
MEASURED_STATE=$(psqlc "insert into public.operating_states(organization_id,asset_id,state,started_at,ended_at,reason_code,source_system,external_id) values('$ORG','$ASSET','down_unplanned',now()-interval '8 hours',now()-interval '4 hours','TRIP','C206-SMOKE','C206-DOWN-$SUFFIX') returning id;")
psqlc "insert into public.operating_states(organization_id,asset_id,state,started_at,ended_at,source_system,external_id) values('$ORG','$ASSET','running',now()-interval '48 hours',now()-interval '8 hours','C206-SMOKE','C206-RUN-$SUFFIX');" >/dev/null
psqlc "insert into public.production_records(organization_id,asset_id,period_start,period_end,units_produced,unit_of_measure,source_system,external_id) values('$ORG','$ASSET',now()-interval '48 hours',now()-interval '8 hours',400,'tonne','C206-SMOKE','C206-PROD-$SUFFIX');" >/dev/null
SIGNAL=$(psqlc "insert into public.operational_constraint_signals(organization_id,asset_id,signal_kind,signal_key,state,observed_at,valid_until,source_system,source_ref,basis) values('$ORG','$ASSET','production','feed-limited','unavailable',now()-interval '9 hours',now()+interval '1 day','C206-SMOKE','TAG-FEED','Historian feed pressure below the approved operating limit.') returning id;")

UNMEASURED_ASSET=$(psqlc "insert into public.assets(organization_id,tag,name,asset_class,criticality,status) values('$ORG','C206-UNKNOWN-$SUFFIX','C2.06 no-rate asset','test','low','active') returning id;")
UNMEASURED_STATE=$(psqlc "insert into public.operating_states(organization_id,asset_id,state,started_at,ended_at,reason_code,source_system,external_id) values('$ORG','$UNMEASURED_ASSET','offline',now()-interval '3 hours',now()-interval '2 hours','UNKNOWN','C206-SMOKE','C206-UNKNOWN-$SUFFIX') returning id;")

FOREIGN_ORG=$(psqlc "insert into public.organizations(name,industry) values('C2.06 foreign $SUFFIX','test') returning id;")
FOREIGN_ASSET=$(psqlc "insert into public.assets(organization_id,tag,name,asset_class,criticality,status) values('$FOREIGN_ORG','C206-FOREIGN-$SUFFIX','Foreign asset','test','low','active') returning id;")
FOREIGN_STATE=$(psqlc "insert into public.operating_states(organization_id,asset_id,state,started_at,ended_at,source_system,external_id) values('$FOREIGN_ORG','$FOREIGN_ASSET','down_unplanned',now()-interval '2 hours',now()-interval '1 hour','C206-SMOKE','C206-FOREIGN-$SUFFIX') returning id;")

DENIED=$(rpc "$TECH" classify_downtime_event "{\"p_operating_state_id\":$MEASURED_STATE,\"p_classification\":\"equipment_failure\",\"p_basis\":\"Technician role must not classify this production event.\",\"p_expected_review_id\":null,\"p_work_order_id\":null,\"p_constraint_signal_id\":null}")
BODY="$DENIED" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);sys.exit(0 if 'named human' in x.get('error','').lower() else 1)"

FOREIGN=$(rpc "$ENGINEER" classify_downtime_event "{\"p_operating_state_id\":$FOREIGN_STATE,\"p_classification\":\"equipment_failure\",\"p_basis\":\"This foreign tenant event must remain outside the active organization.\",\"p_expected_review_id\":null,\"p_work_order_id\":null,\"p_constraint_signal_id\":null}")
BODY="$FOREIGN" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);sys.exit(0 if 'outside the active tenant' in x.get('error','').lower() else 1)"

MISSING_SIGNAL=$(rpc "$ENGINEER" classify_downtime_event "{\"p_operating_state_id\":$MEASURED_STATE,\"p_classification\":\"upstream_constraint\",\"p_basis\":\"Upstream constraint claim deliberately omits its required signal.\",\"p_expected_review_id\":null,\"p_work_order_id\":null,\"p_constraint_signal_id\":null}")
BODY="$MISSING_SIGNAL" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);sys.exit(0 if 'constraint signal is required' in x.get('error','').lower() else 1)"

FIRST=$(rpc "$ENGINEER" classify_downtime_event "{\"p_operating_state_id\":$MEASURED_STATE,\"p_classification\":\"equipment_failure\",\"p_basis\":\"Operator log and trip evidence initially identified an equipment failure.\",\"p_expected_review_id\":null,\"p_work_order_id\":null,\"p_constraint_signal_id\":null}")
noerr "$FIRST"; FIRST_ID=$(field "$FIRST" classificationReviewId); test -n "$FIRST_ID"
SECOND=$(rpc "$ENGINEER" classify_downtime_event "{\"p_operating_state_id\":$MEASURED_STATE,\"p_classification\":\"upstream_constraint\",\"p_basis\":\"Historian pressure evidence supersedes the initial interpretation.\",\"p_expected_review_id\":$FIRST_ID,\"p_work_order_id\":null,\"p_constraint_signal_id\":\"$SIGNAL\"}")
noerr "$SECOND"; SECOND_ID=$(field "$SECOND" classificationReviewId); test -n "$SECOND_ID"
test "$(field "$SECOND" supersedesId)" = "$FIRST_ID"
test "$(psqlc "select count(*) from public.downtime_classification_reviews where operating_state_id=$MEASURED_STATE;")" = '2'

DIRECT_CODE=$(curl -sS -o /tmp/c206-direct-classification.txt -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/downtime_classification_reviews" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d "{\"organization_id\":\"$ORG\",\"operating_state_id\":$UNMEASURED_STATE,\"classification\":\"other\",\"basis\":\"Direct writes must remain blocked for every customer role.\"}")
case "$DIRECT_CODE" in 401|403) ;; *) false ;; esac

RECON=$(rpc "$ENGINEER" get_production_loss_reconciliation '{"p_window_days":90}')
noerr "$RECON"
BODY="$RECON" MEASURED="$MEASURED_STATE" UNMEASURED="$UNMEASURED_STATE" python3 -c "import json,os,sys;x=json.loads(os.environ['BODY']);m=next((e for e in x['events'] if str(e['operatingStateId'])==os.environ['MEASURED']),None);u=next((e for e in x['events'] if str(e['operatingStateId'])==os.environ['UNMEASURED']),None);ok=m and m['classification']=='upstream_constraint' and m['measurementState']=='demonstrated_rate' and 39<=m['estimatedUnitsLost']<=41 and u and u['classification']=='unclassified' and u['measurementState']=='not_measurable' and x['summary']['unclassifiedDownHours']>=1;sys.exit(0 if ok else 1)"

echo 'C2.06 production-loss classification smoke passed: named_human_only=true tenant_wall=true append_only=true constraint_required=true demonstrated_rate=true unknown_visible=true direct_write_locked=true'

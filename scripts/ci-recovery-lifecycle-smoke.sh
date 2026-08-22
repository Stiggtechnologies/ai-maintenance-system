#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Recovery lifecycle smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"
: "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
SITE='22222222-2222-2222-2222-222222222222'
ASSET='aaaaaaaa-0000-0000-0000-000000000005' # HT-027
PLAN='9a000000-0000-0000-0000-000000000001'
CHECK='9a000000-0000-0000-0000-000000000002'
WO1='9b000000-0000-0000-0000-000000000001'
WO2='9b000000-0000-0000-0000-000000000002'
SCHED='9c000000-0000-0000-0000-000000000001'
MANAGER_UID='00000000-0000-0000-0000-000000000003'

json_field() {
  local field="$1"
  python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$field'); print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))"
}

assert_no_error() {
  local body="$1"
  BODY="$body" python3 - <<'PY'
import json, os, sys
body=json.loads(os.environ['BODY'])
if isinstance(body, dict) and body.get('error'):
    print('unexpected Recovery error:', body['error'])
    sys.exit(1)
PY
}

assert_error_contains() {
  local body="$1" expected="$2"
  BODY="$body" EXPECTED="$expected" python3 - <<'PY'
import json, os, sys
body=json.loads(os.environ['BODY'])
err=str(body.get('error','')) if isinstance(body,dict) else ''
if os.environ['EXPECTED'].lower() not in err.lower():
    print('expected error containing:', os.environ['EXPECTED'])
    print('actual:', body)
    sys.exit(1)
PY
}

auth_token() {
  local email="$1" password="$2" resp token
  resp=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}")
  token=$(printf '%s' "$resp" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))")
  test -n "$token"
  printf '%s' "$token"
}

rpc() {
  local token="$1" function="$2" payload="$3"
  curl -sS -X POST "$API_URL/rest/v1/rpc/$function" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d "$payload"
}

# Purpose-built fixture: two real work orders on the haul-truck asset share one
# governed job plan. One material line starts SHORT. The plan also carries a
# permit/isolation and an explicit acceptance check, so the lifecycle proves
# those canonical gates rather than taking a no-permit/no-QC shortcut.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
insert into job_plans(id,organization_id,plan_key,title,scope,version,status,basis,created_by)
values('$PLAN','$ORG','RECOVERY-E2E-HT027','Recovery E2E haul-truck intervention','Two concurrent restoration work streams',1,'adopted','CI-only deterministic Recovery lifecycle fixture','00000000-0000-0000-0000-000000000004')
on conflict (id) do nothing;

insert into job_plan_permits(organization_id,job_plan_id,permit_type,isolation_required,verification_note)
values('$ORG','$PLAN','maintenance isolation','electrical/hydraulic stored energy','Operations must confirm isolation before field start')
on conflict do nothing;

insert into job_plan_checks(id,organization_id,job_plan_id,check_description,acceptance_criterion,is_hold_point)
values('$CHECK','$ORG','$PLAN','Final restoration quality check','No leaks, guards restored, work area clear and functional check accepted',true)
on conflict (id) do nothing;

insert into work_orders(id,organization_id,site_id,asset_id,wo_number,title,status,priority,type,work_type,estimated_hours,planned_hours,parts_ready,job_plan_id,description)
values
('$WO1','$ORG','$SITE','$ASSET','REC-E2E-001','Engine-system restoration stream','scheduled','critical','human_created','corrective',8,8,false,'$PLAN','CI Recovery lifecycle fixture — primary stream'),
('$WO2','$ORG','$SITE','$ASSET','REC-E2E-002','Static intervention restoration stream','scheduled','high','human_created','preventive',6,6,true,'$PLAN','CI Recovery lifecycle fixture — concurrent stream')
on conflict (id) do update set status='scheduled', completed_at=null, actual_hours=null, planned_hours=excluded.planned_hours, job_plan_id=excluded.job_plan_id;

insert into work_order_materials(organization_id,work_order_id,material_id,qty_required,status)
select '$ORG','$WO1',id,1,'short' from materials
where organization_id='$ORG' and material_code='TMPL-ENG-FILTER'
on conflict (work_order_id,material_id) do update set status='short',updated_at=now();
SQL

PLANNER=$(auth_token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(auth_token 'manager@syncai.ca' 'Manager123!@#')
TECH=$(auth_token 'technician@syncai.ca' 'Tech123!@#')
OPS=$(auth_token 'executive@syncai.ca' 'Exec123!@#')

OPEN=$(rpc "$PLANNER" open_restoration_event "{\"p_asset_id\":\"$ASSET\",\"p_reason\":\"CI validates governed multi-work restoration orchestration\",\"p_event_type\":\"planned\"}")
assert_no_error "$OPEN"
EVENT=$(printf '%s' "$OPEN" | json_field event_id)
test -n "$EVENT"

BASELINE=$(date -u -d '+24 hours' '+%Y-%m-%dT%H:%M:%SZ')
B=$(rpc "$PLANNER" set_restoration_baseline "{\"p_event_id\":\"$EVENT\",\"p_baseline_return_at\":\"$BASELINE\",\"p_method\":\"control_estimate\",\"p_basis\":\"CI control estimate fixed before deterministic plan generation\"}")
assert_no_error "$B"

A1=$(rpc "$PLANNER" add_restoration_work "{\"p_event_id\":\"$EVENT\",\"p_work_order_id\":\"$WO1\",\"p_disposition\":\"mandatory\"}")
A2=$(rpc "$PLANNER" add_restoration_work "{\"p_event_id\":\"$EVENT\",\"p_work_order_id\":\"$WO2\",\"p_disposition\":\"opportunity\"}")
assert_no_error "$A1"; assert_no_error "$A2"
EW1=$(printf '%s' "$A1" | json_field event_work_id)
EW2=$(printf '%s' "$A2" | json_field event_work_id)

# Unknown concurrency must schedule sequentially: 8 + 6 = 14 hours.
P1=$(rpc "$PLANNER" generate_restoration_plan "{\"p_event_id\":\"$EVENT\"}")
assert_no_error "$P1"
BODY="$P1" python3 - <<'PY'
import json, os, sys
p=json.loads(os.environ['BODY'])
if float(p['serial_hours']) != 14 or float(p['critical_path_hours']) != 14:
    print('unknown concurrency did not fail closed to serial plan:', p); sys.exit(1)
if not any('Unknown concurrency' in str(x.get('warning','')) for x in p.get('warnings',[])):
    print('unknown-concurrency warning absent:', p); sys.exit(1)
PY

# Human verification makes the two streams one parallel stage: max(8,6)=8 h.
VP=$(rpc "$PLANNER" verify_restoration_parallel_group "{\"p_event_id\":\"$EVENT\",\"p_event_work_ids\":[\"$EW1\",\"$EW2\"],\"p_group\":\"primary-static-overlap\",\"p_basis\":\"Separate work zones and shared isolation permit safe concurrent execution\"}")
assert_no_error "$VP"
P2=$(rpc "$PLANNER" generate_restoration_plan "{\"p_event_id\":\"$EVENT\"}")
assert_no_error "$P2"
PLAN_ID=$(printf '%s' "$P2" | json_field plan_id)
BODY="$P2" python3 - <<'PY'
import json, os, sys
p=json.loads(os.environ['BODY'])
if float(p['serial_hours']) != 14 or float(p['critical_path_hours']) != 8:
    print('verified parallel stage did not reduce deterministic path to 8h:', p); sys.exit(1)
if p.get('missing_inputs'):
    print('unexpected release-blocking inputs:', p); sys.exit(1)
PY

SUB=$(rpc "$PLANNER" submit_restoration_plan_for_approval "{\"p_plan_id\":\"$PLAN_ID\"}")
assert_no_error "$SUB"
DECISION=$(printf '%s' "$SUB" | json_field decision_id)

# Independent Maintenance Manager approval through the canonical decision table.
APPROVED=$(curl -sS -X PATCH "$API_URL/rest/v1/autonomous_decisions?id=eq.$DECISION&status=eq.pending" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $MANAGER" -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d "{\"status\":\"approved\",\"approved_by\":\"$MANAGER_UID\",\"executed_at\":\"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\"}")
BODY="$APPROVED" python3 - <<'PY'
import json, os, sys
rows=json.loads(os.environ['BODY'])
if not isinstance(rows,list) or len(rows)!=1:
    print('independent canonical approval failed:', rows); sys.exit(1)
PY

REL=$(rpc "$PLANNER" release_restoration_plan "{\"p_plan_id\":\"$PLAN_ID\"}")
assert_no_error "$REL"

# The platform context must resolve the same event/work/material/schedule truth,
# and Sync must read the same contract rather than a parallel assistant store.
CTX=$(rpc "$PLANNER" get_recovery_platform_context "{\"p_surface\":\"materials\",\"p_work_order_id\":\"$WO1\",\"p_asset_id\":\"$ASSET\"}")
assert_no_error "$CTX"
BODY="$CTX" EVENT="$EVENT" WO1="$WO1" WO2="$WO2" python3 - <<'PY'
import json, os, sys
ctx=json.loads(os.environ['BODY'])
event=os.environ['EVENT']; wo1=os.environ['WO1']; wo2=os.environ['WO2']
if ctx.get('work_order_context',{}).get('event_id') != event:
    print('work-order Recovery context did not resolve active event:', ctx); sys.exit(1)
if not any(x.get('event_id') == event for x in ctx.get('active_events',[])):
    print('active event absent from platform context:', ctx); sys.exit(1)
impact=next((x for x in ctx.get('material_impacts',[]) if x.get('work_order_id') == wo1), None)
if not impact or int(impact.get('short_lines',0)) < 1:
    print('canonical material shortage absent from Recovery context:', ctx); sys.exit(1)
commitments={x.get('work_order_id') for x in ctx.get('schedule_commitments',[])}
if not {wo1,wo2}.issubset(commitments):
    print('active Recovery schedule commitments incomplete:', ctx); sys.exit(1)
PY

SYNC_CTX=$(rpc "$PLANNER" get_sync_recovery_context "{\"p_asset_id\":\"$ASSET\",\"p_work_order_id\":\"$WO1\"}")
assert_no_error "$SYNC_CTX"
BODY="$SYNC_CTX" EVENT="$EVENT" python3 - <<'PY'
import json, os, sys
ctx=json.loads(os.environ['BODY'])
if ctx.get('surface') != 'sync' or ctx.get('work_order_context',{}).get('event_id') != os.environ['EVENT']:
    print('Sync did not receive canonical Recovery context:', ctx); sys.exit(1)
PY

# Weekly Scheduling owns capacity commitments, but it must explicitly warn if a
# draft option omits active Recovery work. This direct insert is a CI-only
# canonical schedule fixture; Recovery itself never writes schedule_options.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
insert into schedule_options(id,organization_id,week_start,label,strategy,items,total_hours,capacity_hours,status,generated_by)
values('$SCHED','$ORG',date_trunc('week',current_date)::date,'Recovery integration E2E','CI-only schedule feasibility fixture',
  jsonb_build_array(jsonb_build_object('wo_id','$WO1','wo_number','REC-E2E-001','title','Engine-system restoration stream','priority','critical','hours',8,'day',1)),
  8,24,'draft','00000000-0000-0000-0000-000000000004')
on conflict (id) do update set items=excluded.items,total_hours=excluded.total_hours,status='draft';
SQL
SCHED_F=$(rpc "$PLANNER" evaluate_schedule_feasibility "{\"p_option_id\":\"$SCHED\"}")
assert_no_error "$SCHED_F"
BODY="$SCHED_F" python3 - <<'PY'
import json, os, sys
f=json.loads(os.environ['BODY'])
check=next((x for x in f.get('checks',[]) if x.get('constraint') == 'Active Recovery commitments'), None)
if not check or check.get('severity') != 'warning' or check.get('passed') is not False or int(check.get('count',0)) < 1:
    print('weekly schedule did not surface omitted Recovery commitment:', f); sys.exit(1)
PY

# Operations records the physical isolation. Both WOs share this asset release.
ER=$(rpc "$OPS" release_equipment "{\"p_asset_id\":\"$ASSET\",\"p_work_order_id\":null,\"p_isolation_confirmed\":true,\"p_isolation_note\":\"CI operations isolation confirmed before maintenance starts\"}")
assert_no_error "$ER"

# The first start MUST still fail while its canonical material demand is short.
START_BLOCKED=$(rpc "$TECH" start_restoration_work "{\"p_event_work_id\":\"$EW1\"}")
assert_error_contains "$START_BLOCKED" 'materials are not ready'

# Simulate the inventory system resolving the shortage; Recovery itself never
# writes the material state.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "update work_order_materials set status='kitted',qty_reserved=qty_required,updated_at=now() where work_order_id='$WO1';"

S1=$(rpc "$TECH" start_restoration_work "{\"p_event_work_id\":\"$EW1\"}")
S2=$(rpc "$TECH" start_restoration_work "{\"p_event_work_id\":\"$EW2\"}")
assert_no_error "$S1"; assert_no_error "$S2"

Q="[{\"check_id\":\"$CHECK\",\"result\":\"pass\"}]"
C1=$(rpc "$TECH" complete_restoration_work "{\"p_event_work_id\":\"$EW1\",\"p_actual_hours\":8,\"p_completion_note\":\"Primary restoration complete with hold-point acceptance evidence\",\"p_quality_results\":$Q}")
C2=$(rpc "$TECH" complete_restoration_work "{\"p_event_work_id\":\"$EW2\",\"p_actual_hours\":6,\"p_completion_note\":\"Concurrent restoration complete with hold-point acceptance evidence\",\"p_quality_results\":$Q}")
assert_no_error "$C1"; assert_no_error "$C2"

RET=$(rpc "$TECH" return_equipment "{\"p_asset_id\":\"$ASSET\",\"p_note\":\"Maintenance complete; guards restored and equipment offered back to operations\"}")
assert_no_error "$RET"

HANDOVER_CTX=$(rpc "$MANAGER" get_recovery_platform_context "{\"p_surface\":\"handover\",\"p_work_order_id\":null,\"p_asset_id\":\"$ASSET\"}")
assert_no_error "$HANDOVER_CTX"
BODY="$HANDOVER_CTX" EVENT="$EVENT" python3 - <<'PY'
import json, os, sys
ctx=json.loads(os.environ['BODY'])
row=next((x for x in ctx.get('handover_impacts',[]) if x.get('event_id') == os.environ['EVENT']), None)
if not row or row.get('release_status') != 'returned' or row.get('awaiting_operations_acceptance') is not True:
    print('Recovery handover context did not mirror canonical returned state:', ctx); sys.exit(1)
PY

# Event closure must fail while Operations has not accepted the returned asset.
CLOSE_BLOCKED=$(rpc "$MANAGER" close_restoration_event "{\"p_event_id\":\"$EVENT\",\"p_note\":\"Attempting RTS before operations acceptance should be refused\"}")
assert_error_contains "$CLOSE_BLOCKED" 'handover has not been accepted'

ACC=$(rpc "$OPS" accept_equipment "{\"p_asset_id\":\"$ASSET\",\"p_note\":\"Operations functional check complete and equipment accepted for service\"}")
assert_no_error "$ACC"
CLOSE=$(rpc "$MANAGER" close_restoration_event "{\"p_event_id\":\"$EVENT\",\"p_note\":\"Operations acceptance recorded; governed restoration event closed\"}")
assert_no_error "$CLOSE"

DETAIL=$(rpc "$MANAGER" get_recovery_event "{\"p_event_id\":\"$EVENT\"}")
BODY="$DETAIL" python3 - <<'PY'
import json, os, sys
d=json.loads(os.environ['BODY'])
if d.get('event',{}).get('status')!='closed':
    print('event did not close:', d); sys.exit(1)
if d.get('kpis',{}).get('revenue_hours_recovered') is None:
    print('closed event did not compute recovered hours against frozen baseline:', d); sys.exit(1)
PY

CLOSED_CTX=$(rpc "$MANAGER" get_recovery_platform_context "{\"p_surface\":\"learning\",\"p_work_order_id\":null,\"p_asset_id\":\"$ASSET\"}")
assert_no_error "$CLOSED_CTX"
BODY="$CLOSED_CTX" EVENT="$EVENT" python3 - <<'PY'
import json, os, sys
ctx=json.loads(os.environ['BODY']); event=os.environ['EVENT']
if any(x.get('event_id') == event for x in ctx.get('active_events',[])):
    print('closed Recovery event still appears active:', ctx); sys.exit(1)
if not any(x.get('event_id') == event for x in ctx.get('recent_closed_events',[])):
    print('closed Recovery evidence absent from Reliability/Learning context:', ctx); sys.exit(1)
PY

VALUE_COUNT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select count(*) from value_metrics where organization_id='$ORG' and asset_id='$ASSET' and status='projected' and label like 'Recovery counterfactual hours recovered — REC-%';")
test "$VALUE_COUNT" -ge 1

echo "Recovery lifecycle + platform integration smoke passed: event=$EVENT plan=$PLAN_ID decision=$DECISION projected_value_records=$VALUE_COUNT"

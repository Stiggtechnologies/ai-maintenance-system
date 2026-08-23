#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Recovery close-out smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"
: "${ANON_KEY:?missing ANON_KEY}"
: "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
SITE='22222222-2222-2222-2222-222222222222'
ASSET='aaaaaaaa-0000-0000-0000-000000000005'
PLAN='9a000000-0000-0000-0000-000000000001'
WO1='9c000000-0000-0000-0000-000000000001'
WO2='9c000000-0000-0000-0000-000000000002'
CRAFT='Recovery CI HET'

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
    print('unexpected Recovery close-out error:', body['error'])
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

service_rpc() {
  local function="$1" payload="$2"
  curl -sS -X POST "$API_URL/rest/v1/rpc/$function" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' \
    -d "$payload"
}

PLANNER=$(auth_token 'planner@syncai.ca' 'Planner123!@#')
TECH=$(auth_token 'technician@syncai.ca' 'Tech123!@#')

# Two fresh work streams with explicit task/craft demand. Capacity is operator
# evidence, not inferred from headcount.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from work_order_tasks where work_order_id in ('$WO1','$WO2');
delete from work_orders where id in ('$WO1','$WO2');
delete from craft_capacity where organization_id='$ORG' and site_id='$SITE' and craft='$CRAFT';
insert into craft_capacity(organization_id,site_id,craft,weekly_hours,basis,effective_from)
values('$ORG','$SITE','$CRAFT',40,'CI verified available craft capacity for Recovery close-out runtime acceptance',current_date);

insert into work_orders(id,organization_id,site_id,asset_id,wo_number,title,status,priority,type,work_type,estimated_hours,planned_hours,parts_ready,job_plan_id,description)
values
('$WO1','$ORG','$SITE','$ASSET','REC-V2-E2E-001','Recovery v2 engine-zone stream','scheduled','critical','human_created','corrective',4,4,true,'$PLAN','CI close-out stream one'),
('$WO2','$ORG','$SITE','$ASSET','REC-V2-E2E-002','Recovery v2 service-zone stream','scheduled','high','human_created','corrective',3,3,true,'$PLAN','CI close-out stream two');

insert into work_order_tasks(organization_id,work_order_id,task_sequence,description,craft,crew_size,estimated_hours,status)
values
('$ORG','$WO1',1,'Recovery v2 primary task','$CRAFT',1,4,'pending'),
('$ORG','$WO2',1,'Recovery v2 secondary task','$CRAFT',1,3,'pending');
SQL

OPEN=$(rpc "$PLANNER" open_restoration_event "{\"p_asset_id\":\"$ASSET\",\"p_reason\":\"CI exercises full Recovery control and optimization close-out\",\"p_event_type\":\"unplanned\"}")
assert_no_error "$OPEN"
EVENT=$(printf '%s' "$OPEN" | json_field event_id)
test -n "$EVENT"
BASELINE=$(date -u -d '+18 hours' '+%Y-%m-%dT%H:%M:%SZ')
B=$(rpc "$PLANNER" set_restoration_baseline "{\"p_event_id\":\"$EVENT\",\"p_baseline_return_at\":\"$BASELINE\",\"p_method\":\"control_estimate\",\"p_basis\":\"CI frozen pre-optimization counterfactual for close-out acceptance\"}")
assert_no_error "$B"
A1=$(rpc "$PLANNER" add_restoration_work "{\"p_event_id\":\"$EVENT\",\"p_work_order_id\":\"$WO1\",\"p_disposition\":\"mandatory\"}")
A2=$(rpc "$PLANNER" add_restoration_work "{\"p_event_id\":\"$EVENT\",\"p_work_order_id\":\"$WO2\",\"p_disposition\":\"mandatory\"}")
assert_no_error "$A1"; assert_no_error "$A2"
EW1=$(printf '%s' "$A1" | json_field event_work_id)
EW2=$(printf '%s' "$A2" | json_field event_work_id)

# Human concurrency verification alone is no longer enough: Recovery v2 also
# requires physical-zone evidence before treating the pair as ready.
VP=$(rpc "$PLANNER" verify_restoration_parallel_group "{\"p_event_id\":\"$EVENT\",\"p_event_work_ids\":[\"$EW1\",\"$EW2\"],\"p_group\":\"ci-v2-parallel\",\"p_basis\":\"CI asks the physical interference engine to verify two explicit work zones\"}")
assert_no_error "$VP"
Z1=$(rpc "$PLANNER" set_restoration_work_zone "{\"p_event_work_id\":\"$EW1\",\"p_zone\":\"engine-bay-left\",\"p_component_scope\":\"Engine\",\"p_basis\":\"CI engine-side physical boundary from the governed job scope\"}")
Z2=$(rpc "$PLANNER" set_restoration_work_zone "{\"p_event_work_id\":\"$EW2\",\"p_zone\":\"service-deck-right\",\"p_component_scope\":\"Cooling System\",\"p_basis\":\"CI service-deck physical boundary from the governed job scope\"}")
assert_no_error "$Z1"; assert_no_error "$Z2"

REQ=$(rpc "$PLANNER" set_restoration_resource_requirement "{\"p_event_id\":\"$EVENT\",\"p_event_work_id\":null,\"p_kind\":\"weather\",\"p_key\":\"site-field-work\",\"p_phase\":\"planning\",\"p_is_hard\":true,\"p_basis\":\"Outdoor field work requires a fresh site weather-release signal\"}")
assert_no_error "$REQ"
NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
VALID=$(date -u -d '+2 hours' '+%Y-%m-%dT%H:%M:%SZ')
SIG=$(rpc "$PLANNER" register_operational_constraint_signal "{\"p_kind\":\"weather\",\"p_key\":\"site-field-work\",\"p_state\":\"available\",\"p_observed_at\":\"$NOW\",\"p_valid_until\":\"$VALID\",\"p_source_system\":\"ci-weather-adapter\",\"p_basis\":\"CI fresh weather evidence reports field work inside the governed operating envelope\",\"p_site_id\":\"$SITE\",\"p_asset_id\":null,\"p_source_ref\":\"CI-WX-1\",\"p_payload\":{\"temperature_c\":10}}")
assert_no_error "$SIG"

R1=$(rpc "$PLANNER" refresh_restoration_readiness "{\"p_event_id\":\"$EVENT\"}")
assert_no_error "$R1"
BODY="$R1" python3 - <<'PY'
import json, os, sys
r=json.loads(os.environ['BODY'])
if r.get('ready_for_optimization') is not False or int(r.get('hard_blocked',0)) < 1:
    print('physical-zone relationship did not fail closed:', r); sys.exit(1)
PY

ZR=$(rpc "$PLANNER" set_work_zone_relationship "{\"p_site_id\":\"$SITE\",\"p_zone_a\":\"engine-bay-left\",\"p_zone_b\":\"service-deck-right\",\"p_parallel_allowed\":true,\"p_basis\":\"CI verified separation prevents personnel, lifting, access and reassembly interference\",\"p_source_ref\":\"CI-ZONE-1\"}")
assert_no_error "$ZR"
R2=$(rpc "$PLANNER" refresh_restoration_readiness "{\"p_event_id\":\"$EVENT\"}")
assert_no_error "$R2"
BODY="$R2" python3 - <<'PY'
import json, os, sys
r=json.loads(os.environ['BODY'])
if r.get('ready_for_optimization') is not True or int(r.get('hard_blocked',0)) != 0 or int(r.get('hard_unknown',0)) != 0:
    print('evidence-complete readiness did not go green:', r); sys.exit(1)
PY

P=$(rpc "$PLANNER" generate_restoration_plan "{\"p_event_id\":\"$EVENT\"}")
assert_no_error "$P"
PLAN_ID=$(printf '%s' "$P" | json_field plan_id)
test -n "$PLAN_ID"

RISK=$(rpc "$PLANNER" run_restoration_risk_simulation "{\"p_plan_id\":\"$PLAN_ID\",\"p_iterations\":250}")
assert_no_error "$RISK"
BODY="$RISK" python3 - <<'PY'
import json, os, sys
r=json.loads(os.environ['BODY'])
for k in ('p50_hours','p80_hours','p95_hours','risk_run_id'):
    if r.get(k) is None:
        print('risk simulation missing', k, r); sys.exit(1)
PY

WHATIF=$(rpc "$PLANNER" simulate_recovery_what_if "{\"p_plan_id\":\"$PLAN_ID\",\"p_changes\":{\"duration_multipliers\":{\"$EW1\":1.25},\"additional_delay_hours\":1},\"p_basis\":\"CI scenario tests a 25 percent duration shock plus one hour access delay\"}")
assert_no_error "$WHATIF"
BODY="$WHATIF" python3 - <<'PY'
import json, os, sys
r=json.loads(os.environ['BODY'])
if r.get('releasable') is not False or r.get('scenario_critical_path_hours') is None:
    print('what-if contract failed:', r); sys.exit(1)
PY

CONSEQ=$(rpc "$PLANNER" set_recovery_consequence "{\"p_event_id\":\"$EVENT\",\"p_safety\":4,\"p_environment\":2,\"p_business\":4,\"p_production\":5,\"p_basis\":\"CI consequence case validates safety environment business and production priority dimensions\"}")
assert_no_error "$CONSEQ"
PROD=$(rpc "$PLANNER" register_operational_constraint_signal "{\"p_kind\":\"production\",\"p_key\":\"dispatch-priority\",\"p_state\":\"available\",\"p_observed_at\":\"$NOW\",\"p_valid_until\":\"$VALID\",\"p_source_system\":\"ci-mine-plan-adapter\",\"p_basis\":\"CI mine-plan signal assigns current production restoration weight\",\"p_site_id\":\"$SITE\",\"p_asset_id\":\"$ASSET\",\"p_source_ref\":\"CI-PROD-1\",\"p_payload\":{\"priority_weight\":30}}")
assert_no_error "$PROD"
FLEET=$(rpc "$PLANNER" run_recovery_fleet_optimization "{\"p_site_id\":\"$SITE\"}")
assert_no_error "$FLEET"
BODY="$FLEET" python3 - <<'PY'
import json, os, sys
r=json.loads(os.environ['BODY'])
if not isinstance(r.get('allocation'), list) or not r.get('optimization_run_id'):
    print('fleet optimizer contract failed:', r); sys.exit(1)
PY

# Database-level multi-energy enforcement: the transition itself must fail
# before a verified state exists, then pass after the field state is recorded.
ER=$(rpc "$PLANNER" set_job_plan_energy_requirement "{\"p_job_plan_id\":\"$PLAN\",\"p_energy_type\":\"electrical\",\"p_required_state\":\"verified_zero\",\"p_basis\":\"CI job plan requires verified zero electrical energy before execution\"}")
assert_no_error "$ER"
if PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "update restoration_event_work set execution_status='in_progress' where id='$EW1';" >/tmp/recovery-energy-before.txt 2>&1; then
  echo 'energy trigger incorrectly allowed work to start before verified-zero state'; cat /tmp/recovery-energy-before.txt; exit 1
fi
grep -qi 'Recovery energy gate' /tmp/recovery-energy-before.txt
ENERGY=$(rpc "$TECH" record_asset_energy_state "{\"p_asset_id\":\"$ASSET\",\"p_energy_type\":\"electrical\",\"p_state\":\"verified_zero\",\"p_basis\":\"CI technician verified zero electrical energy at the governed isolation point\",\"p_isolation_ref\":\"CI-ISO-1\",\"p_valid_until\":\"$VALID\",\"p_source_system\":\"ci-field\"}")
assert_no_error "$ENERGY"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "update restoration_event_work set execution_status='in_progress' where id='$EW1'; update restoration_event_work set execution_status='pending' where id='$EW1';" >/dev/null

METER=$(rpc "$PLANNER" record_asset_meter_reading "{\"p_asset_id\":\"$ASSET\",\"p_value\":1200,\"p_recorded_at\":\"$NOW\",\"p_source_system\":\"ci-meter\",\"p_basis\":\"CI current operating-hour reading for component-age acceptance\",\"p_meter_kind\":\"operating_hours\",\"p_source_ref\":\"CI-METER-1\"}")
assert_no_error "$METER"
COMP=$(rpc "$PLANNER" record_component_installation "{\"p_asset_id\":\"$ASSET\",\"p_component\":\"Engine\",\"p_position\":\"primary\",\"p_installed_at\":\"2026-01-01T00:00:00Z\",\"p_installed_meter_hours\":1000,\"p_source_system\":\"ci-component-history\",\"p_basis\":\"CI governed component installation history with an installation meter\",\"p_material_id\":null,\"p_serial_number\":\"CI-ENGINE-1\",\"p_source_ref\":\"CI-COMP-1\"}")
assert_no_error "$COMP"
LIFE=$(rpc "$PLANNER" get_recovery_component_life_context "{\"p_event_id\":\"$EVENT\"}")
assert_no_error "$LIFE"
BODY="$LIFE" python3 - <<'PY'
import json, os, sys
r=json.loads(os.environ['BODY'])
eng=[x for x in r.get('components',[]) if str(x.get('component','')).lower()=='engine']
if not eng or float(eng[0].get('current_component_age_hours',-1)) != 200:
    print('component current age was not evidence-derived:', r); sys.exit(1)
PY

FIELD=$(rpc "$TECH" add_recovery_field_evidence "{\"p_event_id\":\"$EVENT\",\"p_event_work_id\":\"$EW1\",\"p_kind\":\"note\",\"p_note\":\"CI mobile field evidence captured at point of work\",\"p_attachment_id\":null,\"p_metadata\":{\"client\":\"wearable-test\"},\"p_client_command_id\":\"ci-recovery-field-1\"}")
assert_no_error "$FIELD"
ECONSET=$(rpc "$PLANNER" set_recovery_economic_assumptions "{\"p_event_id\":\"$EVENT\",\"p_regular\":120,\"p_overtime\":180,\"p_overtime_share\":0.25,\"p_contractor\":500,\"p_logistics\":250,\"p_risk\":1000,\"p_life_cycle\":300,\"p_basis\":\"CI economic case records labour overtime contractor logistics risk and life-cycle assumptions\"}")
assert_no_error "$ECONSET"
ECON=$(rpc "$PLANNER" get_recovery_economics "{\"p_event_id\":\"$EVENT\"}")
assert_no_error "$ECON"
BODY="$ECON" python3 - <<'PY'
import json, os, sys
r=json.loads(os.environ['BODY'])
if r.get('available') is not True or r.get('value_status')!='projected_pending_canonical_human_verification':
    print('rich economics/verification boundary failed:', r); sys.exit(1)
PY

DUE=$(date -u -d '-5 minutes' '+%Y-%m-%dT%H:%M:%SZ')
BLOCK=$(rpc "$PLANNER" record_restoration_blocker "{\"p_event_id\":\"$EVENT\",\"p_event_work_id\":\"$EW2\",\"p_category\":\"vendor\",\"p_description\":\"CI overdue vendor callback blocks the secondary restoration stream\",\"p_owner_role\":\"planner\",\"p_severity\":\"high\",\"p_escalation_due_at\":\"$DUE\",\"p_forecast_rts_impact_hours\":2,\"p_impact_basis\":\"CI estimates two hours of RTS impact if the vendor callback remains unresolved\"}")
assert_no_error "$BLOCK"
ESC=$(service_rpc run_recovery_escalation_clock '{}')
assert_no_error "$ESC"
BODY="$ESC" python3 - <<'PY'
import json, os, sys
r=json.loads(os.environ['BODY'])
if int(r.get('escalated',0)) < 1:
    print('escalation clock did not escalate overdue blocker:', r); sys.exit(1)
PY

QUEUE=$(rpc "$PLANNER" get_recovery_decision_queue '{}'); assert_no_error "$QUEUE"
HANDOFF=$(rpc "$PLANNER" get_recovery_handoff "{\"p_event_id\":\"$EVENT\"}"); assert_no_error "$HANDOFF"
CADENCE=$(rpc "$PLANNER" publish_recovery_cadence_snapshot "{\"p_cadence\":\"shift\",\"p_event_id\":\"$EVENT\"}"); assert_no_error "$CADENCE"
FTR=$(rpc "$PLANNER" get_recovery_ftr_metrics '{"p_window_days":90}'); assert_no_error "$FTR"
SEQUENCE=$(rpc "$PLANNER" get_recovery_sequence_patterns '{"p_asset_class":null,"p_min_events":2}'); assert_no_error "$SEQUENCE"
PRODUCTIVITY=$(rpc "$PLANNER" get_recovery_productivity_norms "{\"p_site_id\":\"$SITE\",\"p_min_tasks\":5}"); assert_no_error "$PRODUCTIVITY"
PARTS=$(rpc "$PLANNER" get_recovery_parts_risk "{\"p_event_id\":\"$EVENT\"}"); assert_no_error "$PARTS"
DONOR=$(rpc "$PLANNER" get_recovery_cannibalization_options "{\"p_event_id\":\"$EVENT\"}"); assert_no_error "$DONOR"

echo "Recovery full close-out smoke passed: event=$EVENT plan=$PLAN_ID readiness=green risk=green fleet=green energy-gate=green escalation=green"

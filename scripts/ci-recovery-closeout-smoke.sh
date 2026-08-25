#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Recovery close-out smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"; : "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
SITE='22222222-2222-2222-2222-222222222222'
ASSET='aaaaaaaa-0000-0000-0000-000000000005'
PLAN='9a000000-0000-0000-0000-000000000001'
WO1='9c000000-0000-0000-0000-000000000001'
WO2='9c000000-0000-0000-0000-000000000002'
CRAFT='Recovery CI HET'

field(){ python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$1'); print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))"; }
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and x.get('error'): print('unexpected error:',x); sys.exit(1)
PY
}
token(){ local r; r=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$r"|python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
srpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$1" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' -d "$2"; }

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$TECH"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from work_order_tasks where work_order_id in ('$WO1','$WO2');
delete from work_orders where id in ('$WO1','$WO2');
delete from craft_capacity where organization_id='$ORG' and site_id='$SITE' and craft='$CRAFT';
insert into craft_capacity(organization_id,site_id,craft,weekly_hours,basis,effective_from)
values('$ORG','$SITE','$CRAFT',40,'CI verified available craft capacity for Recovery close-out runtime acceptance',current_date);
-- An unplanned restoration event is only legitimate when the asset really is down.
-- open_restoration_event() enforces that against operating_states; the seeded database
-- carries no operating history, so the fixture records the breakdown rather than
-- downgrading the event type to dodge the gate.
delete from operating_states where organization_id='$ORG' and source_system='recovery-closeout-ci' and external_id='REC-CLOSEOUT-DOWN-1';
insert into operating_states(organization_id,asset_id,state,started_at,ended_at,reason_code,source_system,external_id)
values('$ORG','$ASSET','down_unplanned',now()-interval '2 hours',null,'unplanned_breakdown','recovery-closeout-ci','REC-CLOSEOUT-DOWN-1');
insert into work_orders(id,organization_id,site_id,asset_id,wo_number,title,status,priority,type,work_type,estimated_hours,planned_hours,parts_ready,job_plan_id,description)
values
('$WO1','$ORG','$SITE','$ASSET','REC-V2-E2E-001','Recovery v2 engine-zone stream','scheduled','critical','human_created','corrective',4,4,true,'$PLAN','CI close-out stream one'),
('$WO2','$ORG','$SITE','$ASSET','REC-V2-E2E-002','Recovery v2 service-zone stream','scheduled','high','human_created','corrective',3,3,true,'$PLAN','CI close-out stream two');
insert into work_order_tasks(organization_id,work_order_id,task_sequence,description,craft,crew_size,estimated_hours,status)
values
('$ORG','$WO1',1,'Recovery v2 primary task','$CRAFT',1,4,'pending'),
('$ORG','$WO2',1,'Recovery v2 secondary task','$CRAFT',1,3,'pending');
SQL

OPEN=$(rpc "$PLANNER" open_restoration_event "{\"p_asset_id\":\"$ASSET\",\"p_reason\":\"CI full Recovery close-out acceptance\",\"p_event_type\":\"unplanned\"}"); noerr "$OPEN"
EVENT=$(printf '%s' "$OPEN"|field event_id); test -n "$EVENT"
BASELINE=$(date -u -d '+18 hours' '+%Y-%m-%dT%H:%M:%SZ')
B=$(rpc "$PLANNER" set_restoration_baseline "{\"p_event_id\":\"$EVENT\",\"p_baseline_return_at\":\"$BASELINE\",\"p_method\":\"control_estimate\",\"p_basis\":\"CI frozen counterfactual before optimization\"}"); noerr "$B"
A1=$(rpc "$PLANNER" add_restoration_work "{\"p_event_id\":\"$EVENT\",\"p_work_order_id\":\"$WO1\",\"p_disposition\":\"mandatory\"}"); noerr "$A1"
A2=$(rpc "$PLANNER" add_restoration_work "{\"p_event_id\":\"$EVENT\",\"p_work_order_id\":\"$WO2\",\"p_disposition\":\"mandatory\"}"); noerr "$A2"
EW1=$(printf '%s' "$A1"|field event_work_id); EW2=$(printf '%s' "$A2"|field event_work_id)

VP=$(rpc "$PLANNER" verify_restoration_parallel_group "{\"p_event_id\":\"$EVENT\",\"p_event_work_ids\":[\"$EW1\",\"$EW2\"],\"p_group\":\"ci-v2-parallel\",\"p_basis\":\"CI validates physical interference after concurrency verification\"}"); noerr "$VP"
Z1=$(rpc "$PLANNER" set_restoration_work_zone "{\"p_event_work_id\":\"$EW1\",\"p_zone\":\"engine-bay-left\",\"p_component_scope\":\"Engine\",\"p_basis\":\"CI governed engine-side physical work boundary\"}"); noerr "$Z1"
Z2=$(rpc "$PLANNER" set_restoration_work_zone "{\"p_event_work_id\":\"$EW2\",\"p_zone\":\"service-deck-right\",\"p_component_scope\":\"Cooling System\",\"p_basis\":\"CI governed service-deck physical work boundary\"}"); noerr "$Z2"
REQ=$(rpc "$PLANNER" set_restoration_resource_requirement "{\"p_event_id\":\"$EVENT\",\"p_event_work_id\":null,\"p_kind\":\"weather\",\"p_key\":\"site-field-work\",\"p_phase\":\"planning\",\"p_is_hard\":true,\"p_basis\":\"Outdoor work requires fresh governed weather evidence\"}"); noerr "$REQ"
NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ'); VALID=$(date -u -d '+2 hours' '+%Y-%m-%dT%H:%M:%SZ')
SIG=$(rpc "$PLANNER" register_operational_constraint_signal "{\"p_kind\":\"weather\",\"p_key\":\"site-field-work\",\"p_state\":\"available\",\"p_observed_at\":\"$NOW\",\"p_valid_until\":\"$VALID\",\"p_source_system\":\"ci-weather-adapter\",\"p_basis\":\"CI fresh weather evidence inside the work envelope\",\"p_site_id\":\"$SITE\",\"p_asset_id\":null,\"p_source_ref\":\"CI-WX-1\",\"p_payload\":{\"temperature_c\":10}}") ; noerr "$SIG"

R1=$(rpc "$PLANNER" refresh_restoration_readiness "{\"p_event_id\":\"$EVENT\"}"); noerr "$R1"
BODY="$R1" python3 - <<'PY'
import json,os,sys
r=json.loads(os.environ['BODY'])
if r.get('ready_for_optimization') is not False or int(r.get('hard_blocked',0))<1: print('zone fail-closed failed',r); sys.exit(1)
PY
ZR=$(rpc "$PLANNER" set_work_zone_relationship "{\"p_site_id\":\"$SITE\",\"p_zone_a\":\"engine-bay-left\",\"p_zone_b\":\"service-deck-right\",\"p_parallel_allowed\":true,\"p_basis\":\"CI verified separation prevents personnel lifting access and reassembly interference\",\"p_source_ref\":\"CI-ZONE-1\"}"); noerr "$ZR"
R2=$(rpc "$PLANNER" refresh_restoration_readiness "{\"p_event_id\":\"$EVENT\"}"); noerr "$R2"
BODY="$R2" python3 - <<'PY'
import json,os,sys
r=json.loads(os.environ['BODY'])
if r.get('ready_for_optimization') is not True or int(r.get('hard_blocked',0)) or int(r.get('hard_unknown',0)): print('readiness green failed',r); sys.exit(1)
PY

P=$(rpc "$PLANNER" generate_restoration_plan "{\"p_event_id\":\"$EVENT\"}"); noerr "$P"; PLAN_ID=$(printf '%s' "$P"|field plan_id); test -n "$PLAN_ID"
RISK=$(rpc "$PLANNER" run_restoration_risk_simulation "{\"p_plan_id\":\"$PLAN_ID\",\"p_iterations\":250}"); noerr "$RISK"
BODY="$RISK" python3 - <<'PY'
import json,os,sys
r=json.loads(os.environ['BODY'])
for k in ('p50_hours','p80_hours','p95_hours','risk_run_id'):
  if r.get(k) is None: print('risk output missing',k,r); sys.exit(1)
PY
WI=$(rpc "$PLANNER" simulate_recovery_what_if "{\"p_plan_id\":\"$PLAN_ID\",\"p_changes\":{\"duration_multipliers\":{\"$EW1\":1.25},\"additional_delay_hours\":1},\"p_basis\":\"CI duration shock plus one hour access delay\"}"); noerr "$WI"
BODY="$WI" python3 - <<'PY'
import json,os,sys
r=json.loads(os.environ['BODY'])
if r.get('releasable') is not False or r.get('scenario_critical_path_hours') is None: print('what-if failed',r); sys.exit(1)
PY

C=$(rpc "$MANAGER" set_recovery_consequence "{\"p_event_id\":\"$EVENT\",\"p_safety\":4,\"p_environment\":2,\"p_business\":4,\"p_production\":5,\"p_basis\":\"CI consequence assessment validates safety environment business and production priority dimensions\"}"); noerr "$C"
PS=$(rpc "$PLANNER" register_operational_constraint_signal "{\"p_kind\":\"production\",\"p_key\":\"dispatch-priority\",\"p_state\":\"available\",\"p_observed_at\":\"$NOW\",\"p_valid_until\":\"$VALID\",\"p_source_system\":\"ci-mine-plan-adapter\",\"p_basis\":\"CI fresh mine-plan restoration priority signal\",\"p_site_id\":\"$SITE\",\"p_asset_id\":\"$ASSET\",\"p_source_ref\":\"CI-PROD-1\",\"p_payload\":{\"priority_weight\":30}}") ; noerr "$PS"
FLEET=$(rpc "$PLANNER" run_recovery_fleet_optimization "{\"p_site_id\":\"$SITE\"}"); noerr "$FLEET"
BODY="$FLEET" python3 - <<'PY'
import json,os,sys
r=json.loads(os.environ['BODY'])
if not isinstance(r.get('allocation'),list) or not r.get('optimization_run_id'): print('fleet optimization failed',r); sys.exit(1)
PY

ER=$(rpc "$PLANNER" set_job_plan_energy_requirement "{\"p_job_plan_id\":\"$PLAN\",\"p_energy_type\":\"electrical\",\"p_required_state\":\"verified_zero\",\"p_basis\":\"CI requires verified-zero electrical energy before execution\"}"); noerr "$ER"
if PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "update restoration_event_work set execution_status='in_progress' where id='$EW1';" >/tmp/recovery-energy-before.txt 2>&1; then echo 'energy gate allowed unsafe start'; exit 1; fi
grep -qi 'Recovery energy gate' /tmp/recovery-energy-before.txt
ES=$(rpc "$TECH" record_asset_energy_state "{\"p_asset_id\":\"$ASSET\",\"p_energy_type\":\"electrical\",\"p_state\":\"verified_zero\",\"p_basis\":\"CI technician verified zero electrical energy at isolation point\",\"p_isolation_ref\":\"CI-ISO-1\",\"p_valid_until\":\"$VALID\",\"p_source_system\":\"ci-field\"}"); noerr "$ES"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "update restoration_event_work set execution_status='in_progress' where id='$EW1'; update restoration_event_work set execution_status='not_started' where id='$EW1';" >/dev/null

M=$(rpc "$PLANNER" record_asset_meter_reading "{\"p_asset_id\":\"$ASSET\",\"p_value\":1200,\"p_recorded_at\":\"$NOW\",\"p_source_system\":\"ci-meter\",\"p_basis\":\"CI current meter for component-age acceptance\",\"p_meter_kind\":\"operating_hours\",\"p_source_ref\":\"CI-METER-1\"}"); noerr "$M"
CI=$(rpc "$PLANNER" record_component_installation "{\"p_asset_id\":\"$ASSET\",\"p_component\":\"Engine\",\"p_position\":\"primary\",\"p_installed_at\":\"2026-01-01T00:00:00Z\",\"p_installed_meter_hours\":1000,\"p_source_system\":\"ci-component-history\",\"p_basis\":\"CI component installation history with installation meter\",\"p_material_id\":null,\"p_serial_number\":\"CI-ENGINE-1\",\"p_source_ref\":\"CI-COMP-1\"}"); noerr "$CI"
LIFE=$(rpc "$PLANNER" get_recovery_component_life_context "{\"p_event_id\":\"$EVENT\"}"); noerr "$LIFE"
BODY="$LIFE" python3 - <<'PY'
import json,os,sys
r=json.loads(os.environ['BODY']); e=[x for x in r.get('components',[]) if str(x.get('component','')).lower()=='engine']
if not e or float(e[0].get('current_component_age_hours',-1))!=200: print('component age failed',r); sys.exit(1)
PY

FE=$(rpc "$TECH" add_recovery_field_evidence "{\"p_event_id\":\"$EVENT\",\"p_event_work_id\":\"$EW1\",\"p_kind\":\"note\",\"p_note\":\"CI point-of-work mobile evidence\",\"p_attachment_id\":null,\"p_metadata\":{\"client\":\"wearable-test\"},\"p_client_command_id\":\"ci-recovery-field-1\"}"); noerr "$FE"
EA=$(rpc "$PLANNER" set_recovery_economic_assumptions "{\"p_event_id\":\"$EVENT\",\"p_regular\":120,\"p_overtime\":180,\"p_overtime_share\":0.25,\"p_contractor\":500,\"p_logistics\":250,\"p_risk\":1000,\"p_life_cycle\":300,\"p_basis\":\"CI labour overtime contractor logistics risk and life-cycle assumptions\"}"); noerr "$EA"
EC=$(rpc "$PLANNER" get_recovery_economics "{\"p_event_id\":\"$EVENT\"}"); noerr "$EC"
BODY="$EC" python3 - <<'PY'
import json,os,sys
r=json.loads(os.environ['BODY'])
if r.get('available') is not True or r.get('value_status')!='projected_pending_canonical_human_verification': print('economics boundary failed',r); sys.exit(1)
PY

DUE=$(date -u -d '-5 minutes' '+%Y-%m-%dT%H:%M:%SZ')
BL=$(rpc "$PLANNER" record_restoration_blocker "{\"p_event_id\":\"$EVENT\",\"p_event_work_id\":\"$EW2\",\"p_category\":\"vendor\",\"p_description\":\"CI overdue vendor callback blocks restoration stream\",\"p_owner_role\":\"planner\",\"p_severity\":\"high\",\"p_escalation_due_at\":\"$DUE\",\"p_forecast_rts_impact_hours\":2,\"p_impact_basis\":\"CI estimates two hours RTS impact from vendor delay\"}"); noerr "$BL"
ESC=$(srpc run_recovery_escalation_clock '{}'); noerr "$ESC"
BODY="$ESC" python3 - <<'PY'
import json,os,sys
r=json.loads(os.environ['BODY'])
if int(r.get('escalated',0))<1: print('escalation failed',r); sys.exit(1)
PY

# The supervisor decision queue must actually surface the escalated blocker, not
# merely return without error.
DQ=$(rpc "$PLANNER" get_recovery_decision_queue '{}'); noerr "$DQ"
BODY="$DQ" EVENT="$EVENT" python3 - <<'PY'
import json,os,sys
r=json.loads(os.environ['BODY']); ev=os.environ['EVENT']
b=[x for x in r.get('blockers',[]) if x.get('event_id')==ev and x.get('overdue') and int(x.get('escalation_level',0))>=1]
if not b: print('decision queue did not surface the escalated blocker',r); sys.exit(1)
PY

# The handoff must be server-generated from this event's canonical state.
HO=$(rpc "$PLANNER" get_recovery_handoff "{\"p_event_id\":\"$EVENT\"}"); noerr "$HO"
BODY="$HO" EVENT="$EVENT" python3 - <<'PY'
import json,os,sys
r=json.loads(os.environ['BODY']); ev=os.environ['EVENT']
if r.get('event',{}).get('event_id')!=ev: print('handoff is not bound to the event',r); sys.exit(1)
if len(r.get('work') or [])!=2: print('handoff lost governed event work',r); sys.exit(1)
if not (r.get('open_blockers') or []): print('handoff omits the open blocker',r); sys.exit(1)
if not (r.get('field_evidence') or []): print('handoff omits captured field evidence',r); sys.exit(1)
PY

CAD=$(rpc "$PLANNER" publish_recovery_cadence_snapshot "{\"p_cadence\":\"shift\",\"p_event_id\":\"$EVENT\"}"); noerr "$CAD"
BODY="$CAD" python3 - <<'PY'
import json,os,sys
r=json.loads(os.environ['BODY'])
if not r.get('snapshot_id'): print('cadence snapshot was not persisted',r); sys.exit(1)
PY

# Sequence mining and productivity normalization must REFUSE to claim a pattern on
# the seeded corpus rather than invent one. Asserting the refusal is the contract;
# these two are evidence-gated and produce nothing until real history exists.
SEQ=$(rpc "$PLANNER" get_recovery_sequence_patterns '{"p_asset_class":null,"p_min_events":2}'); noerr "$SEQ"
PRD=$(rpc "$PLANNER" get_recovery_productivity_norms "{\"p_site_id\":\"$SITE\",\"p_min_tasks\":5}"); noerr "$PRD"
SEQ="$SEQ" PRD="$PRD" python3 - <<'PY'
import json,os,sys
s=json.loads(os.environ['SEQ']); p=json.loads(os.environ['PRD'])
if 'patterns' not in s or 'norms' not in p: print('learning contracts changed shape',s,p); sys.exit(1)
# This FAILS rather than printing a note. Asserting only the shape while the
# control matrix (rows 17/18) tells the reader "which is what CI asserts" would
# make CI the evidence for a refusal it never checked.
#
# If this trips, the seeded corpus started yielding learning output. That is not
# automatically wrong — but rows 17 and 18 currently say these two produce
# nothing, so either the corpus grew accidentally (fix the seed) or mining
# genuinely started working (update rows 17/18, then assert the output here).
if s['patterns'] or p['norms']:
    print('seeded corpus now yields learning output; rows 17/18 of '
          'docs/sync-recovery/control-matrix.md say it produces nothing — '
          'update the matrix and assert the output here',s,p)
    sys.exit(1)
PY

for call in \
  "get_recovery_ftr_metrics|{\"p_window_days\":90}" \
  "get_recovery_parts_risk|{\"p_event_id\":\"$EVENT\"}" \
  "get_recovery_cannibalization_options|{\"p_event_id\":\"$EVENT\"}"; do
    FN=${call%%|*}; PAY=${call#*|}; OUT=$(rpc "$PLANNER" "$FN" "$PAY"); noerr "$OUT"
done

echo "Recovery close-out runtime acceptance passed: event=$EVENT plan=$PLAN_ID readiness risk fleet energy escalation handoff cadence all green"

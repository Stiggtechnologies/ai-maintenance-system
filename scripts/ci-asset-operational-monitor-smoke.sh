#!/usr/bin/env bash
set -euo pipefail
trap 'echo "C8.03 asset operational monitor smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
RUN_KEY="$(date -u +%s)-$$"

psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -qAt -c "$1"
}

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}

rpc() {
  curl -sS -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" \
    -H 'content-type: application/json' -d "$3"
}

ENGINEER=$(token demo@syncai.ca 'Demo123!@#')
test -n "$ENGINEER"

ASSET=$(psqlc "select id from public.assets where organization_id='$ORG' order by id limit 1")
FOREIGN_ORG=$(psqlc "select id from public.organizations where id<>'$ORG' order by id limit 1")
test -n "$ASSET" && test -n "$FOREIGN_ORG"
FOREIGN_ASSET=$(psqlc "select id from public.assets where organization_id='$FOREIGN_ORG' order by id limit 1")
if test -z "$FOREIGN_ASSET"; then
  FOREIGN_ASSET=$(psqlc "insert into public.assets(organization_id,tag,name,status)
    values('$FOREIGN_ORG','C803-FOREIGN-$RUN_KEY','Foreign monitor asset','healthy') returning id")
fi

SENSOR=$(psqlc "insert into public.sensors(
  organization_id,asset_id,name,signal_type,unit,warning_limit,alarm_limit,
  limit_direction,source_system)
  values('$ORG','$ASSET','C8.03 drive-end vibration $RUN_KEY',
  'vibration_velocity','mm/s RMS',4.5,7.1,'above','C803-HISTORIAN') returning id")
READING=$(psqlc "insert into public.condition_readings(
  organization_id,sensor_id,asset_id,value,quality,taken_at,source_system)
  values('$ORG','$SENSOR','$ASSET',5.2,'good',now()-interval '15 minutes',
  'C803-HISTORIAN') returning id")
ALERT=$(psqlc "insert into public.condition_alerts(
  organization_id,sensor_id,asset_id,severity,triggered_value,limit_value,
  triggered_at)
  values('$ORG','$SENSOR','$ASSET','warning',5.2,4.5,
  now()-interval '15 minutes') returning id")
WORK=$(psqlc "insert into public.work_orders(
  organization_id,asset_id,wo_number,title,status,priority,work_type,
  safety_flag,production_impact,created_at)
  values('$ORG','$ASSET','C803-WO-$RUN_KEY','Inspect rising drive-end vibration',
  'pending','high','corrective',false,'Potential throughput derate',
  now()-interval '10 minutes') returning id")

RUNNING=$(psqlc "insert into public.operating_states(
  organization_id,asset_id,state,load_pct,started_at,ended_at,reason_code,
  source_system,external_id)
  values('$ORG','$ASSET','running',85,now()-interval '12 hours',
  now()-interval '2 hours','normal_production','C803-HISTORIAN',
  'C803-RUN-$RUN_KEY') returning id")
DOWN=$(psqlc "insert into public.operating_states(
  organization_id,asset_id,state,load_pct,started_at,ended_at,reason_code,
  source_system,external_id)
  values('$ORG','$ASSET','down_unplanned',0,now()-interval '2 hours',null,
  'vibration_investigation','C803-HISTORIAN','C803-DOWN-$RUN_KEY') returning id")
PRODUCTION=$(psqlc "insert into public.production_records(
  organization_id,asset_id,period_start,period_end,units_produced,
  unit_of_measure,source_system,external_id)
  values('$ORG','$ASSET',now()-interval '12 hours',now()-interval '2 hours',
  1000,'tonnes','C803-MES','C803-PROD-$RUN_KEY') returning id")

RISK=$(psqlc "insert into public.risks(
  organization_id,asset_id,title,objective_at_risk,risk_source,event_description,
  current_risk_score,current_risk_level,risk_velocity,decision_action,status,
  source_kind,information_sensitivity)
  values('$ORG','$ASSET','C8.03 bearing degradation $RUN_KEY',
  'Maintain throughput without an unplanned bearing failure',
  'Rising verified vibration','Bearing condition may continue to degrade',
  62,'High',12,'MONITOR','draft','integration','internal') returning id")
INDICATOR=$(psqlc "insert into public.risk_indicators(
  organization_id,risk_id,sensor_id,name,source_system,signal_key,unit,
  direction,current_value,previous_value,current_state,observed_at,active)
  values('$ORG','$RISK','$SENSOR','Drive-end vibration','C803-HISTORIAN',
  'vibration_velocity','mm/s RMS','higher_is_worse',5.2,4.0,'warning',
  now()-interval '15 minutes',true) returning id")

WORK_BEFORE=$(psqlc "select count(*) from public.work_orders where organization_id='$ORG'")
APPROVALS_BEFORE=$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")
DECISIONS_BEFORE=$(psqlc "select count(*) from public.decisions where organization_id='$ORG'")
RECOMMENDATIONS_BEFORE=$(psqlc "select count(*) from public.recommendations where organization_id='$ORG'")

MONITOR=$(rpc "$ENGINEER" get_asset_operational_monitor \
  "{\"p_asset_id\":\"$ASSET\",\"p_window_days\":30}")
BODY="$MONITOR" READING="$READING" ALERT="$ALERT" WORK="$WORK" \
  RUNNING="$RUNNING" DOWN="$DOWN" RISK="$RISK" INDICATOR="$INDICATOR" \
  python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x.get('asset',{}).get('id'),x
assert x.get('windowDays')==30,x

condition=x['condition']
assert condition['summary']['readings']>=1,condition
assert condition['summary']['openAlerts']>=1,condition
assert any(str(row['id'])==os.environ['READING'] for row in condition['readings']),condition
assert any(str(row['id'])==os.environ['ALERT'] for row in condition['alerts']),condition

work=x['work']
assert work['summary']['openOrders']>=1,work
assert any(str(row['id'])==os.environ['WORK'] for row in work['orders']),work

production=x['production']
assert production['summary']['measurementState']=='demonstrated_rate',production
assert abs(float(production['summary']['demonstratedRate'])-100)<0.01,production
assert 199 <= float(production['summary']['estimatedUnitsLost']) <= 201,production
state_ids={str(row['id']) for row in production['states']}
assert os.environ['RUNNING'] in state_ids and os.environ['DOWN'] in state_ids,production

risk=x['risk']
assert risk['summary']['emergingRisks']>=1,risk
assert risk['summary']['warningIndicators']>=1,risk
found=next(row for row in risk['risks'] if str(row['id'])==os.environ['RISK'])
assert any(str(row['id'])==os.environ['INDICATOR'] for row in found['indicators']),found

authority=x['authority']
assert authority['readOnly'] is True,authority
for key in ('mayCreateWork','mayChangeWork','mayApprove','mayAcceptRisk',
            'mayCommitSpend','mayChangeOperatingLimits','mayReturnToService'):
    assert authority[key] is False,(key,authority)
PY

FOREIGN=$(rpc "$ENGINEER" get_asset_operational_monitor \
  "{\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_window_days\":30}")
BODY="$FOREIGN" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x.get('error')=='asset not found',x
PY

test "$(psqlc "select count(*) from public.work_orders where organization_id='$ORG'")" = "$WORK_BEFORE"
test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")" = "$APPROVALS_BEFORE"
test "$(psqlc "select count(*) from public.decisions where organization_id='$ORG'")" = "$DECISIONS_BEFORE"
test "$(psqlc "select count(*) from public.recommendations where organization_id='$ORG'")" = "$RECOMMENDATIONS_BEFORE"

echo 'Asset operational monitor smoke passed: exact_asset=true condition=true work_history=true demonstrated_production_impact=true sensitivity_filtered_risk=true tenant_wall=true read_only=true'

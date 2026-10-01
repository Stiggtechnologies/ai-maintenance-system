#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Condition Monitoring Analyst smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C1.06 runtime proof against a clean, fully migrated local stack.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
SENSOR='ca160000-0000-4000-8000-000000000001'
FOREIGN='ca160000-0000-4000-8000-000000000099'
OWNER='00000000-0000-0000-0000-000000000003'
SOURCE='c106-agent-smoke-historian'

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
SUPERVISOR=$(token supervisor@syncai.ca 'Super123!@#')
test -n "$ENGINEER" && test -n "$SUPERVISOR"

PROFILE=$(psqlc "select p.id from public.agent_control_profiles p join public.ai_agents a on a.id=p.agent_id where a.organization_id='$ORG' and a.key='condition_monitoring' and p.status='adopted'")
test -n "$PROFILE"
test "$(psqlc "select count(*) from public.agent_tool_bindings b join public.agent_software_tools t on t.id=b.tool_id where b.profile_id='$PROFILE' and t.tool_key='interpret_condition_evidence'")" = '1'
test "$(psqlc "select count(*) from public.agent_decision_right_bindings b join public.decision_rights d on d.id=b.decision_right_id where b.profile_id='$PROFILE' and d.right_key='recommend_inspection_review'")" = '1'
test "$(psqlc "select operating_charter ?& array['purpose','modes','inputs','outputs','guardrails','routes'] from public.ai_agents where organization_id='$ORG' and key='condition_monitoring' limit 1")" = 't'

psqlc "
  insert into public.sensors
    (id,organization_id,asset_id,name,signal_type,unit,warning_limit,
     alarm_limit,limit_direction,detection_technique,source_system)
  values('$SENSOR','$ORG','$ASSET','C1.06 drive-end vibration','vibration velocity',
    'mm/s',5,7,'above','Vibration analysis','$SOURCE')
  on conflict(id) do update set warning_limit=excluded.warning_limit,
    alarm_limit=excluded.alarm_limit,limit_direction=excluded.limit_direction,
    detection_technique=excluded.detection_technique,source_system=excluded.source_system;
  delete from public.condition_readings where sensor_id='$SENSOR';
  delete from public.operating_states where organization_id='$ORG'
    and asset_id='$ASSET' and source_system='c106-agent-duty';
  delete from public.connectors where organization_id='$ORG' and connector_key='$SOURCE';
  insert into public.connectors(
    organization_id,connector_type,name,status,last_success_at,connector_key,
    system_kind,direction,write_enabled,enabled,endpoint_hint,
    expected_interval_minutes,credential_binding_ref,contract_note,register_ref
  ) values (
    '$ORG','plant_historian','C1.06 agent smoke historian','active',now(),'$SOURCE',
    'condition_monitoring','read_only',false,true,'https://historian.example.invalid/readings',
    5,'vault://tenant/c106-agent','Read-only C1.06 smoke source.','C1.06');
  insert into public.operating_states(
    organization_id,asset_id,state,load_pct,started_at,ended_at,
    reason_code,source_system)
  values('$ORG','$ASSET','running',82,now()-interval '10 days',null,
    'normal-duty','c106-agent-duty');
  insert into public.condition_readings(
    organization_id,sensor_id,asset_id,value,quality,taken_at,source_system)
  values
    ('$ORG','$SENSOR','$ASSET',2.0,'good',now()-interval '5 days','$SOURCE'),
    ('$ORG','$SENSOR','$ASSET',3.1,'good',now()-interval '4 days','$SOURCE'),
    ('$ORG','$SENSOR','$ASSET',4.2,'good',now()-interval '3 days','$SOURCE'),
    ('$ORG','$SENSOR','$ASSET',5.4,'good',now()-interval '2 days','$SOURCE'),
    ('$ORG','$SENSOR','$ASSET',6.2,'suspect',now()-interval '1 day','$SOURCE'),
    ('$ORG','$SENSOR','$ASSET',8.1,'good',now()-interval '1 hour','$SOURCE');
"

DENIED=$(rpc "$SUPERVISOR" run_condition_monitoring_agent \
  "{\"p_sensor_id\":\"$SENSOR\",\"p_window_days\":30,\"p_limit\":120}")
DENIED="$DENIED" python3 - <<'PY'
import json,os
assert 'requires a named reliability engineer' in json.loads(os.environ['DENIED'])['error']
PY

FOREIGN_RESULT=$(rpc "$ENGINEER" run_condition_monitoring_agent \
  "{\"p_sensor_id\":\"$FOREIGN\",\"p_window_days\":30,\"p_limit\":120}")
FOREIGN_RESULT="$FOREIGN_RESULT" python3 - <<'PY'
import json,os
assert json.loads(os.environ['FOREIGN_RESULT'])['error']=='sensor not found'
PY

BEFORE_WORK=$(psqlc "select count(*) from public.work_orders where organization_id='$ORG'")
BEFORE_APPROVALS=$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")
BODY=$(rpc "$ENGINEER" run_condition_monitoring_agent \
  "{\"p_sensor_id\":\"$SENSOR\",\"p_window_days\":30,\"p_limit\":120}")
IDS=$(BODY="$BODY" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['modality']=='vibration',x
assert x['signalState']=='alarm_exceedance',x
assert x['trend']=='rising',x
assert x['population']=={'retained':6,'good':5,'nonGood':1,'contextKnown':6,'connectorBacked':6},x
assert any(g['code']=='reading_quality' for g in x['evidenceGaps']),x
assert any('waveform' in s['completion'].lower() for s in x['evidencePlan']),x
for key in ('mayDiagnoseFailure','mayChangeLimits','mayCreateOrReleaseWork',
            'mayChangeMaintenanceInterval','mayAcceptRisk','mayReturnToService'):
    assert x[key] is False,(key,x)
print(x['packId']+'|'+x['runId'])
PY
)
PACK=${IDS%%|*}
RUN=${IDS##*|}
test "$(psqlc "select count(*) from public.agent_runs where id='$RUN' and organization_id='$ORG' and asset_id='$ASSET' and retained_for_governance and status='completed' and agent_tool_key='interpret_condition_evidence'")" = '1'
test "$(psqlc "select count(*) from public.condition_monitoring_agent_packs where id='$PACK' and organization_id='$ORG' and jsonb_array_length(source_snapshot->'readings')=6 and assessment->'population'->>'nonGood'='1'")" = '1'
test "$(psqlc "select count(*) from public.work_orders where organization_id='$ORG'")" = "$BEFORE_WORK"
test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")" = "$BEFORE_APPROVALS"

BEFORE=$(psqlc "select md5(source_snapshot::text) from public.condition_monitoring_agent_packs where id='$PACK'")
PATCH_STATUS=$(curl -sS -o /tmp/condition-agent-pack-patch.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/condition_monitoring_agent_packs?id=eq.$PACK" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"assessment":{"forged":true}}')
case "$PATCH_STATUS" in 401|403) ;; 200) test "$(cat /tmp/condition-agent-pack-patch.txt)" = '[]' ;; *) false ;; esac
test "$(psqlc "select md5(source_snapshot::text) from public.condition_monitoring_agent_packs where id='$PACK'")" = "$BEFORE"

ASSIGNED=$(rpc "$ENGINEER" assign_condition_monitoring_review \
  "{\"p_pack_id\":\"$PACK\",\"p_assigned_to\":\"$OWNER\",\"p_due_date\":\"2027-12-31\",\"p_note\":\"Review waveform, exact duty and sensor configuration before any operational response.\"}")
ASSIGNED="$ASSIGNED" python3 - <<'PY'
import json,os
x=json.loads(os.environ['ASSIGNED'])
assert x['assignedTo']=='00000000-0000-0000-0000-000000000003',x
assert 'No operational action' in x['note'],x
PY
test "$(psqlc "select count(*) from public.condition_monitoring_review_assignments where pack_id='$PACK' and assigned_to='$OWNER'")" = '1'

echo 'Condition Monitoring Analyst smoke passed: exact_reading_snapshot=true operating_context=true quality_exclusion=true role_gate=true tenant_wall=true immutable_pack=true named_review=true no_execution_authority=true'

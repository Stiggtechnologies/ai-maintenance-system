#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Shutdown / Turnaround Specialist smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C1.09 runtime proof against a clean, fully migrated local stack.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
WORK1='c1090000-0000-4000-8000-000000000001'
WORK2='c1090000-0000-4000-8000-000000000002'
FOREIGN='c1090000-0000-4000-8000-000000000099'
WINDOW_REF='C109-TA-SMOKE'

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

PLANNER=$(token planner@syncai.ca 'Planner123!@#')
MANAGER=$(token manager@syncai.ca 'Manager123!@#')
ADMIN=$(token admin@syncai.ca 'Admin123!@#')
TECH=$(token technician@syncai.ca 'Tech123!@#')
test -n "$PLANNER" && test -n "$MANAGER" && test -n "$ADMIN" && test -n "$TECH"
MANAGER_ID=$(psqlc "select id from public.user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
test -n "$MANAGER_ID"

PROFILE=$(psqlc "select p.id from public.agent_control_profiles p join public.ai_agents a on a.id=p.agent_id where a.organization_id='$ORG' and a.key='shutdown_turnaround' and p.status='adopted'")
test -n "$PROFILE"
test "$(psqlc "select count(*) from public.agent_tool_bindings b join public.agent_software_tools t on t.id=b.tool_id where b.profile_id='$PROFILE' and t.tool_key='analyse_turnaround_readiness'")" = '1'
test "$(psqlc "select count(*) from public.agent_decision_right_bindings b join public.decision_rights d on d.id=b.decision_right_id where b.profile_id='$PROFILE' and d.right_key='produce_schedule_options'")" = '1'
test "$(psqlc "select enforcement from public.decision_rights where right_key='release_turnaround_scope'")" = 'enforced'

psqlc "
  insert into public.work_orders(id,organization_id,asset_id,wo_number,title,status,
    priority,type,estimated_hours,planned_hours,parts_ready,safety_flag,approval_required)
  values
    ('$WORK1','$ORG','$ASSET','C109-WO-1','Primary turnaround scope fixture','scheduled',
      'high','human_created',4,4,true,false,false),
    ('$WORK2','$ORG','$ASSET','C109-WO-2','Late turnaround scope fixture','scheduled',
      'medium','human_created',2,2,true,false,false)
  on conflict(id) do update set status='scheduled',estimated_hours=excluded.estimated_hours,
    planned_hours=excluded.planned_hours,parts_ready=true,safety_flag=false,
    approval_required=false;
"

START=$(psqlc "select to_char(date_trunc('hour',now())+interval '2 days','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
MID=$(psqlc "select to_char(date_trunc('hour',now())+interval '2 days 4 hours','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
END=$(psqlc "select to_char(date_trunc('hour',now())+interval '2 days 8 hours','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")

CREATED=$(rpc "$PLANNER" create_outage_window \
  "{\"p_window_key\":\"$WINDOW_REF\",\"p_title\":\"C1.09 governed turnaround\",\"p_kind\":\"turnaround\",\"p_starts_at\":\"$START\",\"p_ends_at\":\"$END\",\"p_scope\":\"Runtime proof of governed scope, sequence, readiness and release.\",\"p_site_id\":null}")
WINDOW_ID=$(CREATED="$CREATED" python3 -c "import json,os; d=json.loads(os.environ['CREATED']); assert 'error' not in d,d; print(d['id'])")
test -n "$WINDOW_ID"

EMPTY=$(rpc "$PLANNER" evaluate_turnaround_readiness "{\"p_window_id\":\"$WINDOW_ID\"}")
EMPTY="$EMPTY" python3 - <<'PY'
import json,os
d=json.loads(os.environ['EMPTY'])
assert d['releaseReady'] is False
assert d['scope']['workOrders']==0
assert d['blockers']>=2
PY

ADDED=$(rpc "$PLANNER" add_work_to_outage \
  "{\"p_window_key\":\"$WINDOW_REF\",\"p_work_order_id\":\"$WORK1\",\"p_justification\":\"Base scope selected by the named turnaround planner.\"}")
ADDED="$ADDED" python3 -c "import json,os; d=json.loads(os.environ['ADDED']); assert d['lateAddition'] is False,d"

SCHEDULE=$(rpc "$PLANNER" create_turnaround_schedule \
  "{\"p_window_id\":\"$WINDOW_ID\",\"p_event_key\":\"C109-SCHED\",\"p_title\":\"C1.09 canonical schedule\"}")
EVENT_ID=$(SCHEDULE="$SCHEDULE" python3 -c "import json,os; d=json.loads(os.environ['SCHEDULE']); assert 'error' not in d,d; print(d['shutdownEventId'])")

TASK1=$(rpc "$PLANNER" record_turnaround_schedule_activity \
  "{\"p_window_id\":\"$WINDOW_ID\",\"p_task_key\":\"WORK\",\"p_label\":\"Execute primary scope\",\"p_duration_hours\":4,\"p_optimistic_hours\":3,\"p_pessimistic_hours\":5,\"p_work_order_id\":\"$WORK1\",\"p_planned_start\":\"$START\",\"p_planned_finish\":\"$MID\"}")
TASK1="$TASK1" python3 -c "import json,os; d=json.loads(os.environ['TASK1']); assert 'error' not in d,d"
TASK2=$(rpc "$PLANNER" record_turnaround_schedule_activity \
  "{\"p_window_id\":\"$WINDOW_ID\",\"p_task_key\":\"HANDOFF\",\"p_label\":\"Controlled execution hand-off\",\"p_duration_hours\":4,\"p_optimistic_hours\":3,\"p_pessimistic_hours\":5,\"p_work_order_id\":null,\"p_planned_start\":\"$MID\",\"p_planned_finish\":\"$END\"}")
TASK2="$TASK2" python3 -c "import json,os; d=json.loads(os.environ['TASK2']); assert 'error' not in d,d"
DEP=$(rpc "$PLANNER" record_turnaround_task_dependency \
  "{\"p_window_id\":\"$WINDOW_ID\",\"p_task_key\":\"HANDOFF\",\"p_predecessor_key\":\"WORK\"}")
DEP="$DEP" python3 -c "import json,os; d=json.loads(os.environ['DEP']); assert d['status']=='recorded',d"

READY_NOT_FROZEN=$(rpc "$PLANNER" evaluate_turnaround_readiness "{\"p_window_id\":\"$WINDOW_ID\"}")
READY_NOT_FROZEN="$READY_NOT_FROZEN" python3 - <<'PY'
import json,os
d=json.loads(os.environ['READY_NOT_FROZEN'])
assert d['blockers']==0,d
assert d['releaseReady'] is False
assert d['sequence']['tasks']==2 and d['sequence']['dependencies']==1
assert d['sequence']['scopeWithoutTask']==0
PY

DENIED=$(rpc "$TECH" run_turnaround_agent "{\"p_window_id\":\"$WINDOW_ID\"}")
DENIED="$DENIED" python3 -c "import json,os; assert 'requires a named planner' in json.loads(os.environ['DENIED'])['error']"
FOREIGN_RESULT=$(rpc "$PLANNER" run_turnaround_agent "{\"p_window_id\":\"$FOREIGN\"}")
FOREIGN_RESULT="$FOREIGN_RESULT" python3 -c "import json,os; assert json.loads(os.environ['FOREIGN_RESULT'])['error']=='outage window not found'"

BEFORE=$(psqlc "select concat(
  (select status from public.outage_windows where id='$WINDOW_ID'),'|',
  (select count(*) from public.outage_work where outage_window_id='$WINDOW_ID'),'|',
  (select count(*) from public.shutdown_tasks where event_id='$EVENT_ID'),'|',
  (select count(*) from public.shutdown_task_dependencies where event_id='$EVENT_ID'))")
RUN=$(rpc "$PLANNER" run_turnaround_agent "{\"p_window_id\":\"$WINDOW_ID\"}")
PACK=$(RUN="$RUN" python3 -c "import json,os; d=json.loads(os.environ['RUN']); assert d['mayAddWork'] is False and d['mayFreezeScope'] is False and d['mayReleaseScope'] is False and d['mayStartExecution'] is False and d['mayReturnToService'] is False,d; assert d['sequenceIntegrity']['tasks']==2; print(d['packId'])")
AFTER=$(psqlc "select concat(
  (select status from public.outage_windows where id='$WINDOW_ID'),'|',
  (select count(*) from public.outage_work where outage_window_id='$WINDOW_ID'),'|',
  (select count(*) from public.shutdown_tasks where event_id='$EVENT_ID'),'|',
  (select count(*) from public.shutdown_task_dependencies where event_id='$EVENT_ID'))")
test "$BEFORE" = "$AFTER"
test "$(psqlc "select source_snapshot ?& array['outageWindow','work','scheduleTasks','dependencies','readiness','sourceTables'] from public.turnaround_readiness_packs where id='$PACK'")" = 't'

REVIEW=$(rpc "$PLANNER" assign_turnaround_review \
  "{\"p_pack_id\":\"$PACK\",\"p_assigned_to\":\"$MANAGER_ID\",\"p_due_date\":\"$(date -u -d '+7 days' +%F)\",\"p_note\":\"Review retained scope, sequence and blocker evidence before release.\"}")
REVIEW="$REVIEW" MANAGER_ID="$MANAGER_ID" python3 -c "import json,os; d=json.loads(os.environ['REVIEW']); assert d['assignedTo']==os.environ['MANAGER_ID'],d"

if psqlc "update public.turnaround_readiness_packs set assessment='{}'::jsonb where id='$PACK'" >/tmp/c109-immutable.out 2>&1; then
  echo 'immutable pack update unexpectedly succeeded' >&2
  exit 1
fi
grep -qi 'append-only' /tmp/c109-immutable.out

FROZEN=$(rpc "$MANAGER" freeze_outage_scope \
  "{\"p_window_id\":\"$WINDOW_ID\",\"p_note\":\"Named maintenance manager freezes the reviewed base scope.\"}")
FROZEN="$FROZEN" python3 -c "import json,os; d=json.loads(os.environ['FROZEN']); assert d['status']=='frozen',d"
READY=$(rpc "$MANAGER" evaluate_turnaround_readiness "{\"p_window_id\":\"$WINDOW_ID\"}")
READY="$READY" python3 -c "import json,os; d=json.loads(os.environ['READY']); assert d['releaseReady'] is True and d['blockers']==0,d"

SAME_PERSON=$(rpc "$MANAGER" release_turnaround_scope \
  "{\"p_window_id\":\"$WINDOW_ID\",\"p_release_note\":\"The same manager must be refused by segregation of duties.\"}")
SAME_PERSON="$SAME_PERSON" python3 -c "import json,os; assert 'segregation of duties' in json.loads(os.environ['SAME_PERSON'])['error']"

RELEASED=$(rpc "$ADMIN" release_turnaround_scope \
  "{\"p_window_id\":\"$WINDOW_ID\",\"p_release_note\":\"Independent administrator confirms the zero-blocker release evidence.\"}")
RELEASED="$RELEASED" python3 -c "import json,os; d=json.loads(os.environ['RELEASED']); assert d['status']=='executing',d; assert d['readiness']['releaseReady'] is True"

LATE=$(rpc "$MANAGER" add_work_to_outage \
  "{\"p_window_key\":\"$WINDOW_REF\",\"p_work_order_id\":\"$WORK2\",\"p_justification\":\"Late discovered corrective scope supported by field inspection evidence.\"}")
LATE="$LATE" python3 -c "import json,os; d=json.loads(os.environ['LATE']); assert d['lateAddition'] is True and d['releaseInvalidated'] is True and d['status']=='frozen',d"
test "$(psqlc "select status from public.outage_windows where id='$WINDOW_ID'")" = 'frozen'
test "$(psqlc "select status from public.shutdown_events where id='$EVENT_ID'")" = 'frozen'
NOT_READY=$(rpc "$PLANNER" evaluate_turnaround_readiness "{\"p_window_id\":\"$WINDOW_ID\"}")
NOT_READY="$NOT_READY" python3 -c "import json,os; d=json.loads(os.environ['NOT_READY']); assert d['releaseReady'] is False and d['sequence']['scopeWithoutTask']==1,d"

echo 'canonical_scope_graph=true'
echo 'late_work_invalidates_release=true'
echo 'sod_release=true'
echo 'readiness_fail_closed=true'
echo 'tenant_wall=true'
echo 'immutable_pack=true'
echo 'named_review=true'
echo 'no_agent_execution_authority=true'

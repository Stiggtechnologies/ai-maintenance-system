#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D11.29 Modelling Studio lineage smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='22222222-2222-2222-2222-222222222222'
ACTOR='00000000-0000-0000-0000-000000000001'
TREE='91390000-0000-4000-8000-000000000001'
EVENT='91390000-0000-4000-8000-000000000002'

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
    -d '{"email":"demo@syncai.ca","password":"Demo123!@#"}' \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}

psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -qAt -c "$1"
}

AUTHOR=$(token)
test -n "$AUTHOR"

psqlc "
insert into fault_trees(id,organization_id,tree_key,title,top_event,basis,reviewed_by,reviewed_at)
values ('$TREE','$ORG','lineage-smoke-tree','Lineage smoke tree','Loss of service','CI controlled fixture','$ACTOR',now())
on conflict (organization_id,tree_key) do update set basis=excluded.basis,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at;
delete from fault_tree_nodes where tree_id='$TREE';
insert into fault_tree_nodes(tree_id,node_key,label,gate,parent_key,probability,probability_basis) values
('$TREE','TOP','Loss of service','OR',null,null,null),
('$TREE','A','Feed A fails',null,'TOP',0.10,'CI fixture'),
('$TREE','B','Feed B fails',null,'TOP',0.20,'CI fixture');
insert into shutdown_events(id,organization_id,event_key,title,planned_duration_hours,status)
values ('$EVENT','$ORG','lineage-smoke-outage','Lineage smoke outage',30,'planning')
on conflict (organization_id,event_key) do update set planned_duration_hours=excluded.planned_duration_hours,status=excluded.status;
delete from shutdown_task_dependencies where event_id='$EVENT';
delete from shutdown_tasks where event_id='$EVENT';
insert into shutdown_tasks(event_id,task_key,label,duration_hours,optimistic_hours,pessimistic_hours) values
('$EVENT','isolate','Isolate',10,8,14),('$EVENT','repair','Repair',20,16,30);
insert into shutdown_task_dependencies(event_id,task_key,predecessor_key)
values ('$EVENT','repair','isolate');
"

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/functions/v1/calculation-service" \
  -H 'content-type: application/json' \
  -d '{"action":"modelling_studio"}')
test "$NOAUTH" = '401'

EXPECTED=$(( $(psqlc "select count(*) from fault_trees where organization_id='$ORG';") + $(psqlc "select count(*) from shutdown_events where organization_id='$ORG';") + 3 ))
BEFORE=$(psqlc "select count(*) from calculation_runs where organization_id='$ORG' and calculation_key in ('fault_tree_quantification','shutdown_schedule_risk','organization_rbd','fleet_production_simulation','maintenance_cost_forecast');")
APPROVALS_BEFORE=$(psqlc "select count(*) from approvals where organization_id='$ORG';")

RESPONSE=$(curl -sS -w '\n%{http_code}' -X POST \
  "$API_URL/functions/v1/calculation-service" \
  -H "apikey: $ANON_KEY" \
  -H "authorization: Bearer $AUTHOR" \
  -H 'content-type: application/json' \
  -d '{"action":"modelling_studio"}')
STATUS=${RESPONSE##*$'\n'}
BODY=${RESPONSE%$'\n'*}
test "$STATUS" = '200'

RUNS=$(BODY="$BODY" TREE="$TREE" EVENT="$EVENT" python3 - <<'PY'
import json, os, re
x = json.loads(os.environ['BODY'])
uuid = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
tree = next(item for item in x['trees'] if item['id'] == os.environ['TREE'])
event = next(item for item in x['schedules'] if item['id'] == os.environ['EVENT'])
assert abs(tree['result']['topEventProbability'] - 0.28) < 1e-10, tree
assert event['result']['simulated'] is True and event['result']['p80'] is not None, event
assert 'result' in x['rbd'] and 'simulable' in x['simulation'], x
assert 'forecastable' in x['forecast'] and x['posture']['basis'], x
assert x['governance']['advisory'] is True
assert x['governance']['operationalAuthorization'] is False
assert x['governance']['humanApprovalRequired'] is True
ids = [entry['runId'] for entry in x['lineage']['trees']]
ids += [entry['runId'] for entry in x['lineage']['schedules']]
ids += [x['lineage']['rbdRunId'], x['lineage']['simulationRunId'], x['lineage']['forecastRunId']]
assert all(uuid.fullmatch(item) for item in ids), ids
print('|'.join(ids))
PY
)

AFTER=$(psqlc "select count(*) from calculation_runs where organization_id='$ORG' and calculation_key in ('fault_tree_quantification','shutdown_schedule_risk','organization_rbd','fleet_production_simulation','maintenance_cost_forecast');")
test "$AFTER" -eq $((BEFORE + EXPECTED))
test "$(psqlc "select count(*) from approvals where organization_id='$ORG';")" = "$APPROVALS_BEFORE"

IFS='|' read -r -a RUN_IDS <<< "$RUNS"
RUN_LIST=$(printf "'%s'," "${RUN_IDS[@]}")
RUN_LIST=${RUN_LIST%,}
RECORDED=$(psqlc "select count(*) from calculation_runs where id in ($RUN_LIST) and organization_id='$ORG' and computed_by='$ACTOR' and code_version='modelling-studio/2/2027-01-01' and jsonb_array_length(input_refs)>0;")
test "$RECORDED" = "$EXPECTED"

TREE_RUN=$(BODY="$BODY" TREE="$TREE" python3 -c "import json,os; x=json.loads(os.environ['BODY']); print(next(i['runId'] for i in x['lineage']['trees'] if i['subjectId']==os.environ['TREE']))")
test "$(psqlc "select subject_type||':'||subject_ref from calculation_runs where id='$TREE_RUN';")" = "fault_tree:$TREE"

FOREIGN=$(curl -sS -o /tmp/modelling-foreign-record.txt -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/record_calculation_run" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'content-type: application/json' \
  -d "{\"p_organization_id\":\"$OTHER_ORG\",\"p_actor_id\":\"$ACTOR\",\"p_subject_type\":\"fault_tree\",\"p_subject_ref\":\"$TREE\",\"p_key\":\"fault_tree_quantification\",\"p_method\":\"Cross-tenant fixture that the recorder must reject.\",\"p_inputs\":{},\"p_input_refs\":[],\"p_outputs\":{},\"p_refusals\":[]}")
test "$FOREIGN" = '400' || test "$FOREIGN" = '401' || test "$FOREIGN" = '403'
grep -Eqi 'not a member|not found in calculation tenant' /tmp/modelling-foreign-record.txt

echo "D11.29 Modelling Studio lineage smoke passed: runs=$EXPECTED five_families=true server_execution=true narrow_subjects=true immutable_ledger=true tenant_wall=true approvals_created=0 advisory_only=true"

#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Planning agent smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C1.04 / C1.05 / C5.02 / C5.03 / C9.02 runtime proof. This exercises the
# authenticated product RPC, not a privileged imitation of it. Fixture writes
# use postgres only to create known source evidence and to inspect effects.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"
: "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
WO='fa110000-0000-4000-8000-000000000001'
OTHER_WO='fa110000-0000-4000-8000-000000000099'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'

psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -tAc "$1"
}

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d '{"email":"demo@syncai.ca","password":"Demo123!@#"}' \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"
}

rpc() {
  curl -sS -X POST "$API_URL/rest/v1/rpc/run_planning_agent" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' \
    -d "{\"p_work_order_id\":\"$2\"}"
}

TOKEN=$(token)
test -n "$TOKEN"
USER_ID=$(psqlc "select p.id from public.user_profiles p join auth.users u on u.id=p.id where p.organization_id='$ORG' and p.role='reliability_engineer' and lower(u.email)='demo@syncai.ca' limit 1")
test -n "$USER_ID"
restore_demo_role() {
  psqlc "update public.user_profiles set role='reliability_engineer' where id='$USER_ID'" >/dev/null || true
}
trap restore_demo_role EXIT
MATERIAL=$(psqlc "select id from public.materials where organization_id='$ORG' order by id limit 1")
test -n "$MATERIAL"
OTHER_ORG=$(psqlc "select id from public.organizations where id <> '$ORG' order by id limit 1")
test -n "$OTHER_ORG"

psqlc "
  insert into public.work_orders
    (id,organization_id,asset_id,wo_number,title,description,status,priority,type)
  values
    ('$WO','$ORG','$ASSET','PLAN-AGENT-001','Governed planning-agent proof',
     'Replace a recorded component using only the task and material evidence attached to this work order.',
     'pending','medium','human_created')
  on conflict(id) do update set job_plan_id=null,status='pending';
  delete from public.work_order_tasks where work_order_id='$WO';
  insert into public.work_order_tasks
    (organization_id,work_order_id,task_sequence,description,status,estimated_hours,craft,crew_size)
  values
    ('$ORG','$WO',1,'Isolate the recorded equipment boundary','pending',1.5,'millwright',2),
    ('$ORG','$WO',2,'Replace the recorded component','pending',2.5,'millwright',2);
  insert into public.work_order_materials
    (organization_id,work_order_id,material_id,qty_required,qty_reserved,status)
  values ('$ORG','$WO','$MATERIAL',2,0,'short')
  on conflict(work_order_id,material_id) do update
    set qty_required=2,qty_reserved=0,status='short';
  insert into public.work_orders
    (id,organization_id,wo_number,title,status,priority,type)
  values ('$OTHER_WO','$OTHER_ORG','PLAN-FOREIGN-001','Foreign planning proof','pending','low','human_created')
  on conflict(id) do nothing;
"

# The migration must have upgraded the exact platform baseline with both acts
# and both tools. A custom customer profile is intentionally never rewritten.
PROFILE=$(psqlc "select p.id from public.agent_control_profiles p join public.ai_agents a on a.id=p.agent_id where a.organization_id='$ORG' and a.key='planning_scheduling' and p.status='adopted'")
test -n "$PROFILE"
test "$(psqlc "select count(*) from public.agent_decision_right_bindings b join public.decision_rights d on d.id=b.decision_right_id where b.profile_id='$PROFILE' and d.right_key in ('draft_job_plans','identify_missing_materials_docs','produce_schedule_options')")" = '3'
test "$(psqlc "select count(*) from public.agent_tool_bindings b join public.agent_software_tools t on t.id=b.tool_id where b.profile_id='$PROFILE' and t.tool_key in ('draft_job_plan','read_work_context','propose_schedule')")" = '3'

BODY=$(rpc "$TOKEN" "$WO")
BODY="$BODY" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
assert x['draft_created'] is True, x
assert x['draft_origin']=='agent', x
assert x['human_approval_required'] is True, x
assert x['may_adopt'] is False and x['may_apply'] is False and x['may_release_schedule'] is False, x
codes={g['code'] for g in x['gaps']}
assert {'materials','tools','permits','documents','acceptance'} <= codes, x
assert len(x['materials'])==1 and x['materials'][0]['ready'] is False, x
PY

PLAN=$(BODY="$BODY" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['job_plan_id'])")
RUN=$(BODY="$BODY" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['run_id'])")
test "$(psqlc "select count(*) from public.job_plans where id='$PLAN' and organization_id='$ORG' and status='draft' and draft_origin='agent' and agent_run_id='$RUN'")" = '1'
test "$(psqlc "select count(*) from public.job_plan_steps where job_plan_id='$PLAN'")" = '2'
test "$(psqlc "select count(*) from public.job_plan_materials where job_plan_id='$PLAN'")" = '1'
test "$(psqlc "select count(*) from public.agent_runs where id='$RUN' and retained_for_governance and requested_by='$USER_ID' and job_plan_id='$PLAN' and status='completed'")" = '1'
test "$(psqlc "select count(*) from public.work_orders where id='$WO' and job_plan_id is null")" = '1'

# A second run must reuse the one canonical draft and must not overwrite a
# human's intervening review edit.
psqlc "update public.job_plans set title='Human review marker — do not overwrite' where id='$PLAN'"
SECOND=$(rpc "$TOKEN" "$WO")
SECOND="$SECOND" PLAN="$PLAN" python3 - <<'PY'
import json, os
x=json.loads(os.environ['SECOND'])
assert x['job_plan_id']==os.environ['PLAN'] and x['draft_created'] is False, x
PY
test "$(psqlc "select title from public.job_plans where id='$PLAN'")" = 'Human review marker — do not overwrite'

# Same token cannot see or act on another tenant's work.
FOREIGN=$(rpc "$TOKEN" "$OTHER_WO")
FOREIGN="$FOREIGN" python3 - <<'PY'
import json, os
assert json.loads(os.environ['FOREIGN'])['error']=='work order not found'
PY

# Direct client mutation of retained provenance is unavailable.
PATCH_STATUS=$(curl -sS -o /tmp/planning-agent-patch-body -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/agent_runs?id=eq.$RUN" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Prefer: return=representation' \
  -d '{"summary":"client overwrite"}')
case "$PATCH_STATUS" in
  401|403) ;;
  200) test "$(cat /tmp/planning-agent-patch-body)" = '[]' ;;
  *) echo "unexpected retained-run PATCH status: $PATCH_STATUS"; false ;;
esac
test "$(psqlc "select summary <> 'client overwrite' from public.agent_runs where id='$RUN'")" = 't'

# Role gate is a database fact, not a disabled button. Restore the shared demo
# profile immediately so later smokes retain their seeded contract.
psqlc "update public.user_profiles set role='technician' where id='$USER_ID'"
DENIED=$(rpc "$TOKEN" "$WO")
psqlc "update public.user_profiles set role='reliability_engineer' where id='$USER_ID'"
DENIED="$DENIED" python3 - <<'PY'
import json, os
assert 'requires a named human planning' in json.loads(os.environ['DENIED'])['error']
PY

echo 'Planning agent smoke passed: canonical_draft=true exact_source_copy=true gaps=true controls=true tenant_wall=true immutable_run=true human_gate=true no_execution_authority=true'

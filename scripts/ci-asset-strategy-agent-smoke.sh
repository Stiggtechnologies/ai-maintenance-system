#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Asset Strategy Specialist smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C1.10 runtime proof against a clean, fully migrated local stack.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
PLAN='c1100000-0000-4000-8000-000000000001'
RTF_PLAN='c1100000-0000-4000-8000-000000000002'
FOREIGN_PLAN='c1100000-0000-4000-8000-000000000099'
COMPONENT='C110 governed wear-out bearing'
RTF_COMPONENT='C110 governed random-life seal'

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

run_strategy() {
  local token_value="$1" plan_value="$2"
  curl -sS -w '\n%{http_code}' -X POST \
    "$API_URL/functions/v1/calculation-service" \
    -H "apikey: $ANON_KEY" -H "authorization: Bearer $token_value" \
    -H 'content-type: application/json' \
    -d "{\"action\":\"asset_strategy\",\"planId\":\"$plan_value\"}"
}

ENGINEER=$(token demo@syncai.ca 'Demo123!@#')
MANAGER=$(token manager@syncai.ca 'Manager123!@#')
TECH=$(token technician@syncai.ca 'Tech123!@#')
test -n "$ENGINEER" && test -n "$MANAGER" && test -n "$TECH"
ENGINEER_ID=$(psqlc "select id from public.user_profiles where organization_id='$ORG' and email='demo@syncai.ca'")
test -n "$ENGINEER_ID"

PROFILE=$(psqlc "select p.id from public.agent_control_profiles p join public.ai_agents a on a.id=p.agent_id where a.organization_id='$ORG' and a.key='asset_strategy' and p.status='adopted'")
test -n "$PROFILE"
test "$(psqlc "select count(*) from public.agent_tool_bindings b join public.agent_software_tools t on t.id=b.tool_id where b.profile_id='$PROFILE' and t.tool_key='optimise_asset_strategy'")" = '1'
test "$(psqlc "select count(*) from public.agent_decision_right_bindings b join public.decision_rights d on d.id=b.decision_right_id where b.profile_id='$PROFILE' and d.right_key='recommend_inspection_review'")" = '1'
test "$(psqlc "select enforcement from public.decision_rights where right_key='change_pm_interval'")" = 'enforced'

psqlc "
  delete from public.component_life_events
   where organization_id='$ORG' and component in ('$COMPONENT','$RTF_COMPONENT');
  insert into public.maintenance_plans
    (id,organization_id,asset_id,task_code,task_label,interval_basis,interval_value,
     last_performed_at,source,active)
  values
    ('$PLAN','$ORG','$ASSET','C110-WEAR','C1.10 wear-out replacement','run_hours',1700,
     now()-interval '30 days','CI imported programme',true),
    ('$RTF_PLAN','$ORG','$ASSET','C110-RTF','C1.10 random-life inspection','run_hours',2000,
     now()-interval '30 days','CI imported programme',true)
  on conflict(organization_id,asset_id,task_code) where task_code is not null
  do update set interval_basis=excluded.interval_basis,interval_value=excluded.interval_value,
    source=excluded.source,active=true;
" >/dev/null

record_event() {
  local component="$1" hours="$2"
  rpc "$ENGINEER" record_component_life_event \
    "{\"p_asset_id\":\"$ASSET\",\"p_component\":\"$component\",\"p_hours_at_change_out\":$hours,\"p_event_kind\":\"failure\",\"p_event_date\":\"2026-09-29\",\"p_planned_interval_hours\":1700,\"p_symptom\":\"CI verified component removal\",\"p_work_order_ref\":\"C110-$hours\",\"p_source_file\":\"CI component meter export\",\"p_source_basis\":\"Verified against the component meter and removal record $hours\"}"
}

for hours in 1000 1100 1200 1300 1400; do
  EVENT=$(record_event "$COMPONENT" "$hours")
  EVENT="$EVENT" python3 -c "import json,os; assert json.loads(os.environ['EVENT']).get('event_id')"
done
for hours in 100 500 1000 5000 10000; do
  EVENT=$(record_event "$RTF_COMPONENT" "$hours")
  EVENT="$EVENT" python3 -c "import json,os; assert json.loads(os.environ['EVENT']).get('event_id')"
done

CONTEXT=$(rpc "$ENGINEER" record_asset_strategy_context \
  "{\"p_plan_id\":\"$PLAN\",\"p_component_scope\":\"$COMPONENT\",\"p_failure_mode\":\"Age-related rolling-element bearing wear\",\"p_strategy_kind\":\"time_based_pm\",\"p_planned_task_cost_usd\":1000,\"p_failure_consequence_cost_usd\":10000,\"p_cost_basis\":\"CI-approved labour, material, downtime and failure consequence estimate.\",\"p_safety_critical\":false,\"p_regulatory_required\":false,\"p_lifecycle_objective\":\"Minimize governed whole-life cost while retaining human authority over the PM programme.\"}")
CONTEXT="$CONTEXT" python3 -c "import json,os; d=json.loads(os.environ['CONTEXT']); assert d['status']=='recorded',d"

# A technician cannot invoke the controlled specialist and a same-tenant caller
# cannot use an arbitrary identifier to cross the tenant wall.
DENIED=$(run_strategy "$TECH" "$PLAN")
DENIED_STATUS=${DENIED##*$'\n'}
DENIED_BODY=${DENIED%$'\n'*}
test "$DENIED_STATUS" = '403'
DENIED_BODY="$DENIED_BODY" python3 -c "import json,os; assert 'named same-tenant' in json.loads(os.environ['DENIED_BODY'])['error']"
FOREIGN=$(run_strategy "$MANAGER" "$FOREIGN_PLAN")
FOREIGN_STATUS=${FOREIGN##*$'\n'}
FOREIGN_BODY=${FOREIGN%$'\n'*}
test "$FOREIGN_STATUS" = '403'
FOREIGN_BODY="$FOREIGN_BODY" python3 -c "import json,os; assert json.loads(os.environ['FOREIGN_BODY'])['error']=='maintenance plan not found'"

BEFORE_APPROVALS=$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")
FIRST=$(run_strategy "$MANAGER" "$PLAN")
FIRST_STATUS=${FIRST##*$'\n'}
FIRST_BODY=${FIRST%$'\n'*}
test "$FIRST_STATUS" = '200'
FIRST_IDS=$(FIRST_BODY="$FIRST_BODY" python3 - <<'PY'
import json,os
d=json.loads(os.environ['FIRST_BODY'])
a=d['analysis']; m=a['methodSelection']; r=a['recommendation']
assert m['method']=='rank_regression' and m['beta']>1,m
assert a['ageReplacement']['recommended'] is True,a
assert r['kind']=='interval_change' and r['proposedIntervalBasis']=='run_hours',r
assert r['proposedIntervalValue']>0,r
for key in ('may_change_pm_interval','may_deactivate_task','may_approve_strategy',
            'may_create_work','may_accept_risk','may_commit_spend','may_return_to_service'):
    assert d[key] is False,(key,d)
print(d['assessment_id']+'|'+d['run_id'])
PY
)
FIRST_ASSESSMENT=${FIRST_IDS%%|*}
FIRST_RUN=${FIRST_IDS##*|}

REVIEW=$(rpc "$MANAGER" assign_asset_strategy_review \
  "{\"p_assessment_id\":\"$FIRST_ASSESSMENT\",\"p_assigned_to\":\"$ENGINEER_ID\",\"p_due_date\":\"$(date -u -d '+7 days' +%F)\",\"p_note\":\"Independent review of exact life data, costs and programme consequence.\"}")
REVIEW="$REVIEW" ENGINEER_ID="$ENGINEER_ID" python3 -c "import json,os; d=json.loads(os.environ['REVIEW']); assert d['assignedTo']==os.environ['ENGINEER_ID'],d"

# Optimistic locking: even an evidence-preserving human edit invalidates the old
# recommendation. The reviewer must obtain a new assessment.
CONTEXT2=$(rpc "$ENGINEER" record_asset_strategy_context \
  "{\"p_plan_id\":\"$PLAN\",\"p_component_scope\":\"$COMPONENT\",\"p_failure_mode\":\"Age-related rolling-element bearing wear\",\"p_strategy_kind\":\"time_based_pm\",\"p_planned_task_cost_usd\":1000,\"p_failure_consequence_cost_usd\":10000,\"p_cost_basis\":\"CI-approved labour, material, downtime and failure consequence estimate.\",\"p_safety_critical\":false,\"p_regulatory_required\":false,\"p_lifecycle_objective\":\"Minimize governed whole-life cost while retaining human authority over the PM programme.\"}")
CONTEXT2="$CONTEXT2" python3 -c "import json,os; assert json.loads(os.environ['CONTEXT2'])['status']=='recorded'"
STALE=$(rpc "$ENGINEER" adopt_asset_strategy_assessment \
  "{\"p_assessment_id\":\"$FIRST_ASSESSMENT\",\"p_action\":\"apply_recommended\",\"p_horizon_years\":5,\"p_objective\":\"Minimize governed whole-life cost while retaining human authority over the PM programme.\",\"p_note\":\"Independent reviewer attempts adoption against a deliberately changed plan version.\"}")
STALE="$STALE" python3 -c "import json,os; assert 'changed after assessment' in json.loads(os.environ['STALE'])['error']"

SECOND=$(run_strategy "$MANAGER" "$PLAN")
SECOND_STATUS=${SECOND##*$'\n'}
SECOND_BODY=${SECOND%$'\n'*}
test "$SECOND_STATUS" = '200'
SECOND_ASSESSMENT=$(SECOND_BODY="$SECOND_BODY" python3 -c "import json,os; d=json.loads(os.environ['SECOND_BODY']); assert d['analysis']['recommendation']['kind']=='interval_change'; print(d['assessment_id'])")
rpc "$MANAGER" assign_asset_strategy_review \
  "{\"p_assessment_id\":\"$SECOND_ASSESSMENT\",\"p_assigned_to\":\"$ENGINEER_ID\",\"p_due_date\":\"$(date -u -d '+7 days' +%F)\",\"p_note\":\"Independent review of the current plan version and exact frozen evidence.\"}" >/dev/null
OLD_INTERVAL=$(psqlc "select interval_value from public.maintenance_plans where id='$PLAN'")
ADOPTED=$(rpc "$ENGINEER" adopt_asset_strategy_assessment \
  "{\"p_assessment_id\":\"$SECOND_ASSESSMENT\",\"p_action\":\"apply_recommended\",\"p_horizon_years\":5,\"p_objective\":\"Minimize governed whole-life cost while retaining human authority over the PM programme.\",\"p_note\":\"Independent reliability review adopts the evidence-backed run-hour replacement interval.\"}")
ADOPTED=$(printf '%s' "$ADOPTED")
ADOPTED="$ADOPTED" python3 -c "import json,os; d=json.loads(os.environ['ADOPTED']); assert d['programmeChanged'] is True and d['lifecyclePlanVersion']==1,d"
NEW_INTERVAL=$(psqlc "select interval_value from public.maintenance_plans where id='$PLAN'")
test "$NEW_INTERVAL" != "$OLD_INTERVAL"
test "$(psqlc "select count(*) from public.asset_lifecycle_plans where source_assessment_id='$SECOND_ASSESSMENT' and adopted_action='apply_recommended'")" = '1'

# Random-life evidence without consequence-cost evidence remains an evidence
# gap even when safety and regulatory applicability are explicitly false.
NO_COST_CONTEXT=$(rpc "$ENGINEER" record_asset_strategy_context \
  "{\"p_plan_id\":\"$RTF_PLAN\",\"p_component_scope\":\"$RTF_COMPONENT\",\"p_failure_mode\":\"Random hydraulic seal leakage\",\"p_strategy_kind\":\"time_based_pm\",\"p_planned_task_cost_usd\":null,\"p_failure_consequence_cost_usd\":null,\"p_cost_basis\":\"\",\"p_safety_critical\":false,\"p_regulatory_required\":false,\"p_lifecycle_objective\":\"Remove ineffective age-based work without weakening safety or regulatory obligations.\"}")
NO_COST_CONTEXT="$NO_COST_CONTEXT" python3 -c "import json,os; assert json.loads(os.environ['NO_COST_CONTEXT'])['status']=='recorded'"
NO_COST=$(run_strategy "$MANAGER" "$RTF_PLAN")
NO_COST_STATUS=${NO_COST##*$'\n'}
NO_COST_BODY=${NO_COST%$'\n'*}
test "$NO_COST_STATUS" = '200'
NO_COST_BODY="$NO_COST_BODY" python3 -c "import json,os; d=json.loads(os.environ['NO_COST_BODY']); assert d['analysis']['recommendation']['kind']=='evidence_gap',d; assert any('cost' in x.lower() for x in d['analysis']['refusals']),d"

# Run-to-failure is surfaced only after explicit cost, safety and regulatory
# evidence. The same random-life evidence with safety=true stays at review.
RTF_CONTEXT=$(rpc "$ENGINEER" record_asset_strategy_context \
  "{\"p_plan_id\":\"$RTF_PLAN\",\"p_component_scope\":\"$RTF_COMPONENT\",\"p_failure_mode\":\"Random hydraulic seal leakage\",\"p_strategy_kind\":\"time_based_pm\",\"p_planned_task_cost_usd\":2000,\"p_failure_consequence_cost_usd\":1000,\"p_cost_basis\":\"CI-approved labour and failure consequence costs for the random-life screen.\",\"p_safety_critical\":true,\"p_regulatory_required\":false,\"p_lifecycle_objective\":\"Remove ineffective age-based work without weakening safety or regulatory obligations.\"}")
RTF_CONTEXT="$RTF_CONTEXT" python3 -c "import json,os; assert json.loads(os.environ['RTF_CONTEXT'])['status']=='recorded'"
SAFE=$(run_strategy "$MANAGER" "$RTF_PLAN")
SAFE_STATUS=${SAFE##*$'\n'}
SAFE_BODY=${SAFE%$'\n'*}
test "$SAFE_STATUS" = '200'
SAFE_BODY="$SAFE_BODY" python3 -c "import json,os; d=json.loads(os.environ['SAFE_BODY']); assert d['analysis']['methodSelection']['beta']<=1; assert d['analysis']['recommendation']['kind']=='strategy_review',d"

rpc "$ENGINEER" record_asset_strategy_context \
  "{\"p_plan_id\":\"$RTF_PLAN\",\"p_component_scope\":\"$RTF_COMPONENT\",\"p_failure_mode\":\"Random hydraulic seal leakage\",\"p_strategy_kind\":\"time_based_pm\",\"p_planned_task_cost_usd\":2000,\"p_failure_consequence_cost_usd\":1000,\"p_cost_basis\":\"CI-approved labour and failure consequence costs for the random-life screen.\",\"p_safety_critical\":false,\"p_regulatory_required\":false,\"p_lifecycle_objective\":\"Remove ineffective age-based work without weakening safety or regulatory obligations.\"}" >/dev/null
RTF=$(run_strategy "$MANAGER" "$RTF_PLAN")
RTF_STATUS=${RTF##*$'\n'}
RTF_BODY=${RTF%$'\n'*}
test "$RTF_STATUS" = '200'
RTF_BODY="$RTF_BODY" python3 -c "import json,os; d=json.loads(os.environ['RTF_BODY']); assert d['analysis']['recommendation']['kind']=='run_to_failure_review',d"

test "$(psqlc "select count(*) from public.agent_runs where id='$FIRST_RUN' and organization_id='$ORG' and asset_id='$ASSET' and retained_for_governance")" = '1'
test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")" = "$BEFORE_APPROVALS"

# Browser credentials cannot forge service receipts or rewrite retained records.
DIRECT=$(curl -sS -o /tmp/c110-direct.txt -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/record_asset_strategy_run" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -d '{}')
case "$DIRECT" in 401|403|404) ;; *) false ;; esac
PATCH=$(curl -sS -o /tmp/c110-patch.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/asset_strategy_assessments?id=eq.$FIRST_ASSESSMENT" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"recommendation":{"kind":"forged"}}')
case "$PATCH" in 401|403) ;; 200) test "$(cat /tmp/c110-patch.txt)" = '[]' ;; *) false ;; esac
test "$(psqlc "select recommendation->>'kind' from public.asset_strategy_assessments where id='$FIRST_ASSESSMENT'")" = 'interval_change'

echo 'Asset Strategy Specialist smoke passed: shared_kernels=true canonical_programme_writeback=true rtf_cost_screen=true rtf_safety_screen=true optimistic_lock=true sod_adoption=true tenant_wall=true immutable_assessment=true lifecycle_version=true no_agent_execution_authority=true'

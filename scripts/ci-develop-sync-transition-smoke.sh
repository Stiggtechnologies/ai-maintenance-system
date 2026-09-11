#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Sync Transition smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'; ASSET='80500000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'"); PROJECT=$(psqlc "select capital_project_id from development_cases where id='$CASE'")
test -n "$PLANNER"; test -n "$PROJECT"

psqlc "insert into assets(id,organization_id,tag,name) values('$ASSET','$ORG','D805-ASSET','D8.05 transition asset') on conflict(id) do nothing; insert into development_case_assets(organization_id,development_case_id,asset_id,added_by) values('$ORG','$CASE','$ASSET','$PLANNER_ID') on conflict(development_case_id,asset_id) do nothing;" >/dev/null
ONE=$(rpc "$PLANNER" record_case_early_life_failure "{\"p_case_id\":\"$CASE\",\"p_asset_id\":\"$ASSET\",\"p_occurred_at\":\"2026-09-01T12:00:00Z\",\"p_months_since_handover\":1,\"p_failure_mode\":\"Seal leak during first restart\",\"p_attributed_to\":\"not_determined\",\"p_preventable_by\":\"Startup review remains open\",\"p_source_reference\":\"WO-D805-1\",\"p_evidence_class\":\"INSPECTED\",\"p_assessment_basis\":\"Field inspection confirmed the seal leak after restart.\"}")
BODY="$ONE" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["status"]=="recorded"'
TWO=$(rpc "$PLANNER" record_case_early_life_failure "{\"p_case_id\":\"$CASE\",\"p_asset_id\":\"$ASSET\",\"p_occurred_at\":\"2026-09-02T12:00:00Z\",\"p_months_since_handover\":null,\"p_failure_mode\":\"Intermittent signal dropout\",\"p_attributed_to\":\"design\",\"p_preventable_by\":\"Instrument specification review\",\"p_source_reference\":\"WO-D805-2\",\"p_evidence_class\":\"MEASURED\",\"p_assessment_basis\":\"Recorded signal trend confirms intermittent dropout in service.\"}")
BODY="$TWO" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["status"]=="recorded"'

FIRST=$(rpc "$PLANNER" get_case_sync_transition "{\"p_case_id\":\"$CASE\",\"p_stabilization_days\":90}")
BODY="$FIRST" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["operatingModel"]["verdict"]=="READY"; assert x["operationalReadiness"]["assetCount"]==1 and x["operationalReadiness"]["overall"]["hardBlockerCount"]>0; assert x["operationalDebt"]["itemCount"]==2 and float(x["operationalDebt"]["totalsByCurrency"][0]["lifecycleExposure"])==1520.66; assert x["stabilization"]["status"]=="TIMING_EVIDENCE_INCOMPLETE" and x["stabilization"]["recordedInWindow"]==1 and x["stabilization"]["unclassifiedTimingCount"]==1; assert x["stabilization"]["events"][0]["sourceReference"]=="WO-D805-1"; assert x["transitionPosture"]=="NOT_READY" and "does not approve" in x["decisionBoundary"]'

BAD=$(rpc "$PLANNER" get_case_sync_transition "{\"p_case_id\":\"$CASE\",\"p_stabilization_days\":0}")
BODY="$BAD" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "between 1 and 365" in (x.get("message") or x.get("error") or "")'

psqlc "update early_life_failures set months_since_handover=2,attributed_to='design',fed_back_to_design=true where organization_id='$ORG' and asset_id='$ASSET';" >/dev/null
CLOSED=$(rpc "$PLANNER" get_case_sync_transition "{\"p_case_id\":\"$CASE\",\"p_stabilization_days\":90}")
BODY="$CLOSED" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); s=x["stabilization"]; assert s["status"]=="RECORDED_ACTIONS_CLOSED" and s["recordedInWindow"]==2 and s["notFedBackCount"]==0 and s["notDeterminedCount"]==0'

CROSS=$(rpc "$PLANNER" get_case_sync_transition '{"p_case_id":"00000000-0000-4000-8000-000000000099","p_stabilization_days":90}')
BODY="$CROSS" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "not found in this organization" in (x.get("message") or x.get("error") or "").lower()'
echo "Sync Transition smoke passed: canonical composition, bounded stabilization evidence, debt/readiness fidelity, non-authorizing posture, cross-tenant refusal"

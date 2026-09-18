#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D8.07 commissioning state-machine smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c 'import json,os,sys; body=json.loads(os.environ["BODY"]); key=os.environ["KEY"]; key in body or sys.exit(f"missing {key!r} in RPC response: {json.dumps(body,sort_keys=True)}"); print(body[key])'; }
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#'); EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
ASSET=$(psqlc "with r as (insert into assets(organization_id,tag,name,asset_class) values('$ORG','D807-A-01','D8.07 commissioning asset','pump') returning id) select id from r")
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$EXEC"; test -n "$ASSET"
EVIDENCE=$(psqlc "with r as (insert into evidence_items(organization_id,asset_id,description,evidence_type,source_system) values('$ORG','$ASSET','D8.07 signed state-transition and energy-isolation record','tested','commissioning-state-smoke') returning id) select id from r")

SYSTEM=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"system\",\"p_record\":{\"ref\":\"D807-SYS\",\"title\":\"D8.07 energization train\",\"description\":\"Commissioning boundary used to prove the governed seven-state lifecycle.\",\"ownerId\":\"$PLANNER_ID\"}}")
SID=$(field "$SYSTEM" id)
READ0=$(rpc "$PLANNER" get_case_commissioning "{\"p_case_id\":\"$CASE\"}")
BODY="$READ0" SID="$SID" python3 -c 'import json,os; s=next(x for x in json.loads(os.environ["BODY"])["systems"] if str(x["id"])==os.environ["SID"]); assert s["currentState"] is None and s["nextState"]=="CONSTRUCTION_COMPLETE"'

T1=$(rpc "$PLANNER" transition_commissioning_system "{\"p_system_id\":$SID,\"p_to_state\":\"CONSTRUCTION_COMPLETE\",\"p_rationale\":\"Signed construction completion record confirms the defined system boundary.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
field "$T1" id >/dev/null
SKIP=$(rpc "$PLANNER" transition_commissioning_system "{\"p_system_id\":$SID,\"p_to_state\":\"READY_FOR_ENERGIZATION\",\"p_rationale\":\"This deliberately attempts to skip mechanical completion and must be refused.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$SKIP" python3 -c 'import json,os; assert "without skips" in json.loads(os.environ["BODY"])["error"]'
T2=$(rpc "$PLANNER" transition_commissioning_system "{\"p_system_id\":$SID,\"p_to_state\":\"MECHANICAL_COMPLETE\",\"p_rationale\":\"Signed mechanical completion dossier confirms construction checks are complete.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
field "$T2" id >/dev/null
BLOCKED=$(rpc "$PLANNER" transition_commissioning_system "{\"p_system_id\":$SID,\"p_to_state\":\"READY_FOR_ENERGIZATION\",\"p_rationale\":\"This attempt proves missing asset and energy evidence fail closed before energization.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$BLOCKED" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "prerequisites" in x["error"] and "Bind at least" in x["blockers"][0]'

CROSS=$(rpc "$PLANNER" bind_commissioning_system_asset "{\"p_system_id\":$SID,\"p_asset_id\":\"00000000-0000-4000-8000-000000000099\",\"p_required_energy_types\":[\"electrical\"],\"p_basis\":\"Cross-tenant or absent asset binding must be refused at the boundary.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$CROSS" python3 -c 'import json,os; assert "same-tenant asset" in json.loads(os.environ["BODY"])["error"]'
BIND=$(rpc "$PLANNER" bind_commissioning_system_asset "{\"p_system_id\":$SID,\"p_asset_id\":\"$ASSET\",\"p_required_energy_types\":[\"electrical\",\"process\"],\"p_basis\":\"Electrical and process energy define the signed commissioning isolation boundary.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
field "$BIND" id >/dev/null
NO_RELEASE=$(rpc "$PLANNER" transition_commissioning_system "{\"p_system_id\":$SID,\"p_to_state\":\"READY_FOR_ENERGIZATION\",\"p_rationale\":\"This attempt proves canonical equipment release and energy states remain mandatory.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$NO_RELEASE" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert any("equipment release" in b for b in x["blockers"]) and any("energy is missing" in b for b in x["blockers"])'
rpc "$EXEC" release_equipment "{\"p_asset_id\":\"$ASSET\",\"p_work_order_id\":null,\"p_isolation_confirmed\":true,\"p_isolation_note\":\"Commissioning isolation boundary confirmed against the signed energy record.\"}" >/dev/null
psqlc "insert into asset_energy_states(organization_id,asset_id,energy_type,state,isolation_ref,basis,verified_by,source_system) values('$ORG','$ASSET','electrical','verified_zero','D807-ISO','Metered zero energy confirmed against the signed isolation record.','$PLANNER_ID','commissioning-state-smoke'),('$ORG','$ASSET','process','isolated','D807-ISO','Process block and bleed isolation confirmed against the signed record.','$PLANNER_ID','commissioning-state-smoke')" >/dev/null
T3=$(rpc "$PLANNER" transition_commissioning_system "{\"p_system_id\":$SID,\"p_to_state\":\"READY_FOR_ENERGIZATION\",\"p_rationale\":\"Human review confirms canonical release and current safe energy states for every bound asset.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
field "$T3" id >/dev/null
FROZEN=$(rpc "$PLANNER" bind_commissioning_system_asset "{\"p_system_id\":$SID,\"p_asset_id\":\"$ASSET\",\"p_required_energy_types\":[\"electrical\"],\"p_basis\":\"This attempted scope rewrite after energization readiness must be refused.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$FROZEN" python3 -c 'import json,os; assert "scope is frozen" in json.loads(os.environ["BODY"])["error"]'

PACKAGE=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"test_package\",\"p_record\":{\"systemId\":\"$SID\",\"ref\":\"D807-TP\",\"title\":\"Lifecycle verification package\",\"description\":\"Controlled test package for pre-commissioning through performance verification.\",\"ownerId\":\"$PLANNER_ID\"}}")
PID=$(field "$PACKAGE" id)
PROCEDURE=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"procedure\",\"p_record\":{\"testPackageId\":\"$PID\",\"ref\":\"D807-PR\",\"title\":\"Lifecycle verification procedure\",\"acceptanceCriteria\":\"The signed stage checks pass with no open punch items.\",\"sourceReference\":\"D807-PROC-R1\",\"evidenceClass\":\"TESTED\",\"assessmentBasis\":\"Approved commissioning procedure defines each stage acceptance criterion.\"}}")
PRID=$(field "$PROCEDURE" id)
for SPEC in 'pre_commissioning:PRECOMMISSIONED' 'commissioning:COMMISSIONED' 'performance_test:PERFORMANCE_VERIFIED'; do
  STAGE=${SPEC%%:*}; TARGET=${SPEC##*:}; REF="D807-${TARGET}"
  RESULT=$(rpc "$PLANNER" record_commissioning_result "{\"p_case_id\":\"$CASE\",\"p_procedure_id\":$PRID,\"p_record\":{\"testRef\":\"$REF\",\"testStage\":\"$STAGE\",\"performedOn\":\"2026-09-11\",\"outcome\":\"pass\",\"punchItemsRaised\":0,\"punchItemsOpen\":0,\"witnessedByOwner\":true,\"evidenceItemId\":\"$EVIDENCE\"}}")
  RID=$(field "$RESULT" id)
  RELEASE=$(rpc "$MANAGER" release_quality_acceptance_test "{\"p_id\":$RID,\"p_decision\":\"release\",\"p_note\":\"Independent review confirms the passing result and zero open punch items.\"}")
  BODY="$RELEASE" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["releaseStatus"]=="released"'
  TRANSITION_ACTOR="$PLANNER"
  if [ "$TARGET" = 'PERFORMANCE_VERIFIED' ]; then TRANSITION_ACTOR="$MANAGER"; fi
  TRANSITION=$(rpc "$TRANSITION_ACTOR" transition_commissioning_system "{\"p_system_id\":$SID,\"p_to_state\":\"$TARGET\",\"p_rationale\":\"Human review confirms the independently released $STAGE result satisfies this stage.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
  field "$TRANSITION" id >/dev/null
done
HANDOVER_GATE=$(rpc "$EXEC" transition_commissioning_system "{\"p_system_id\":$SID,\"p_to_state\":\"ACCEPTED\",\"p_rationale\":\"Direct final acceptance must now enter through the governed per-system HandoverPackage.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$HANDOVER_GATE" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "prerequisites" in x["error"] and any("HandoverPackage" in b for b in x["blockers"])'
READ=$(rpc "$PLANNER" get_case_commissioning "{\"p_case_id\":\"$CASE\"}")
BODY="$READ" SID="$SID" python3 -c 'import json,os; s=next(x for x in json.loads(os.environ["BODY"])["systems"] if str(x["id"])==os.environ["SID"]); assert s["currentState"]=="PERFORMANCE_VERIFIED" and s["nextState"]=="ACCEPTED" and s["transitionReadiness"]["canTransition"] is False and len(s["stateHistory"])==6 and len(s["assetBindings"])==1'
if psqlc "update commissioning_systems set commissioning_state='CONSTRUCTION_COMPLETE' where id=$SID" >/dev/null 2>&1; then echo 'direct state regression unexpectedly succeeded'; exit 1; fi
if psqlc "update commissioning_state_transitions set rationale='rewritten history is forbidden' where commissioning_system_id=$SID" >/dev/null 2>&1; then echo 'transition ledger rewrite unexpectedly succeeded'; exit 1; fi
echo 'D8.07 commissioning state-machine smoke passed: six prerequisite transitions, canonical release/energy gate, staged results, tenant refusal, immutable state and governed HandoverPackage final-acceptance door'

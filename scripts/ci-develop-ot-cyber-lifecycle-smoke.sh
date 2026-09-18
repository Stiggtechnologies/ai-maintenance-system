#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D4.13 OT-cyber lifecycle smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); print(x[os.environ["KEY"]])'; }
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); AIBOT=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#')
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
EVIDENCE=$(psqlc "with r as(insert into evidence_items(organization_id,development_case_id,description,evidence_type,source_system) values('$ORG','$CASE','D4.13 architecture review evidence with case applicability and verification provenance','documented','ot-cyber-lifecycle-smoke') returning id) select id from r")
test -n "$PLANNER"; test -n "$AIBOT"; test -n "$PLANNER_ID"; test -n "$EVIDENCE"

EMPTY=$(rpc "$PLANNER" get_case_ot_cyber_lifecycle "{\"p_case_id\":\"$CASE\"}")
BODY="$EMPTY" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="NOT_ASSESSED" and x["satisfiedCount"] is None and "NULL does not mean" in x["refusal"]'
AI=$(rpc "$AIBOT" set_case_ot_cyber_applicability "{\"p_case_id\":\"$CASE\",\"p_applicability\":\"applicable\",\"p_basis\":\"An AI identity attempts to decide the OT cyber scope for this case.\"}")
BODY="$AI" python3 -c 'import json,os; assert "human scope decision" in json.loads(os.environ["BODY"])["error"]'
rpc "$PLANNER" set_case_ot_cyber_applicability "{\"p_case_id\":\"$CASE\",\"p_applicability\":\"applicable\",\"p_basis\":\"The case includes network-connected control equipment and remote support interfaces.\"}" >/dev/null
REC=$(rpc "$PLANNER" record_case_ot_cyber_artifact "{\"p_case_id\":\"$CASE\",\"p_artifact\":{\"artifact_type\":\"architecture_review\",\"requirement_ref\":\"D413-ARCH\",\"requirement\":\"The OT architecture shall receive a documented security review before implementation.\",\"owner_id\":\"$PLANNER_ID\",\"acceptance_criteria\":\"The review records boundaries, findings, dispositions and accountable approvals.\",\"verification_method\":\"review\",\"basis\":\"Architecture review is required because this case introduces connected OT equipment.\",\"source\":\"engineering\"}}")
# `review` is deliberately outside the five §11 methods and must be refused.
BODY="$REC" python3 -c 'import json,os; assert "verification_method" in json.loads(os.environ["BODY"])["error"]'
REC=$(rpc "$PLANNER" record_case_ot_cyber_artifact "{\"p_case_id\":\"$CASE\",\"p_artifact\":{\"artifact_type\":\"architecture_review\",\"requirement_ref\":\"D413-ARCH\",\"requirement\":\"The OT architecture shall receive a documented security review before implementation.\",\"owner_id\":\"$PLANNER_ID\",\"acceptance_criteria\":\"The review records boundaries, findings, dispositions and accountable approvals.\",\"verification_method\":\"analysis\",\"basis\":\"Architecture review is required because this case introduces connected OT equipment.\",\"source\":\"engineering\"}}")
RID=$(field "$REC" requirementId)
PLAN=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$RID,\"p_verification\":{\"method_code\":\"analysis\",\"procedure\":\"Review the approved OT architecture and disposition log.\",\"acceptance_criteria\":\"Every boundary and finding has an accountable disposition.\",\"due_date\":\"2026-12-31\"}}")
OID=$(field "$PLAN" obligation_id)
rpc "$PLANNER" record_verification_result "{\"p_obligation_id\":\"$OID\",\"p_result\":\"achieved\",\"p_measured_note\":\"The architecture review covered every documented boundary and all findings carry dispositions.\",\"p_evidence_id\":\"$EVIDENCE\"}" >/dev/null
POS=$(rpc "$PLANNER" get_case_ot_cyber_lifecycle "{\"p_case_id\":\"$CASE\"}")
BODY="$POS" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="BLOCKED" and x["satisfiedCount"]==1 and len(x["items"])==10 and len(x["blockers"])==9; assert next(i for i in x["items"] if i["artifactType"]=="architecture_review")["state"]=="SATISFIED"'
GATE=$(psqlc "select g.id from stage_gates g join project_frameworks f on f.id=g.framework_id join development_cases c on c.framework_id=f.id where c.id='$CASE' order by g.sequence limit 1")
if test -n "$GATE"; then
  OBS=$(rpc "$PLANNER" case_gate_outstanding_obligations "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$GATE}")
  BODY="$OBS" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert sum(1 for i in x if i.get("type")=="ot_cyber_lifecycle")==9'
fi
FLIP=$(rpc "$PLANNER" set_case_ot_cyber_applicability "{\"p_case_id\":\"$CASE\",\"p_applicability\":\"not_applicable\",\"p_basis\":\"An attempted scope reversal must not erase an existing governed cyber requirement.\"}")
BODY="$FLIP" python3 -c 'import json,os; assert "cannot be erased" in json.loads(os.environ["BODY"])["error"]'
if psqlc "update development_cases set ot_cyber_applicability='not_applicable',ot_cyber_applicability_basis='A direct writer attempts to bypass the governed scope decision.' where id='$CASE'" >/dev/null 2>&1; then echo 'direct applicability rewrite unexpectedly succeeded'; exit 1; fi
if psqlc "update design_requirements set ot_cyber_artifact_type='segmentation' where id=$RID" >/dev/null 2>&1; then echo 'artifact provenance rewrite unexpectedly succeeded'; exit 1; fi
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='ot_cyber_artifact' and event_data->>'requirement_id'='$RID'")" = "1"
echo 'D4.13 OT-cyber lifecycle smoke passed: ten canonical artifacts, human scope, evidence verification, gate blockers, immutability and audit provenance'

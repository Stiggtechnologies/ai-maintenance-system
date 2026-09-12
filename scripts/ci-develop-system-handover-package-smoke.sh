#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D8.09 system HandoverPackage smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c 'import json,os,sys; body=json.loads(os.environ["BODY"]); key=os.environ["KEY"]; key in body or sys.exit(f"missing {key!r}: {json.dumps(body,sort_keys=True)}"); print(body[key])'; }
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#'); EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
EXEC_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='executive@syncai.ca'")
DEMO_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='demo@syncai.ca'")
SID=$(psqlc "select id from commissioning_systems where organization_id='$ORG' and system_ref='D807-SYS' order by id desc limit 1")
ASSET=$(psqlc "select asset_id from commissioning_system_assets where organization_id='$ORG' and commissioning_system_id=$SID limit 1")
EVIDENCE=$(psqlc "select id from evidence_items where organization_id='$ORG' and asset_id='$ASSET' and source_system='commissioning-state-smoke' order by created_at desc limit 1")
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$EXEC"; test -n "$PLANNER_ID"; test -n "$MANAGER_ID"; test -n "$EXEC_ID"; test -n "$DEMO_ID"; test -n "$SID"; test -n "$ASSET"; test -n "$EVIDENCE"

INIT=$(rpc "$PLANNER" initialize_commissioning_system_readiness "{\"p_system_id\":$SID,\"p_owner_id\":\"$PLANNER_ID\",\"p_required_before\":\"2026-12-31\",\"p_basis\":\"Approved handover plan assigns every system readiness item before ownership transfer.\",\"p_basis_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$INIT" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["itemsAssigned"]>0'
ITEMS=$(psqlc "select string_agg(onboarding_item_id::text,',') from commissioning_system_readiness_scope where organization_id='$ORG' and commissioning_system_id=$SID")
IFS=',' read -r -a ITEM_IDS <<< "$ITEMS"
for ITEM in "${ITEM_IDS[@]}"; do
  DONE=$(rpc "$PLANNER" record_system_operational_readiness_item "{\"p_system_id\":$SID,\"p_item_id\":\"$ITEM\",\"p_status\":\"human_provided\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_note\":\"Named owner verified this readiness requirement against the signed handover evidence.\",\"p_value\":{\"confirmed\":true}}")
  BODY="$DONE" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["status"]=="human_provided"'
done

# D4.15 composes digital maintainability into the canonical handover wall.
# This legacy mechanical-system fixture has no maintainable digital component,
# so a named human records that evidenced applicability decision explicitly;
# unknown must never be silently treated as not applicable.
DIGITAL=$(rpc "$PLANNER" assess_asset_digital_maintainability "{\"p_asset_id\":\"$ASSET\",\"p_baseline_kind\":\"as_built\",\"p_applicability\":\"not_applicable\",\"p_basis\":\"The witnessed mechanical-system handover boundary contains no maintainable digital component.\",\"p_source_reference\":\"D8.09 system handover fixture\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$DIGITAL" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["status"]=="NOT_APPLICABLE"'

RISK=$(psqlc "with r as (insert into risks(organization_id,development_case_id,asset_id,title,kind,current_risk_level,residual_risk_level,status,source_kind,created_by) values('$ORG','$CASE','$ASSET','D8.09 residual startup risk','threat','Medium','Medium','draft','human','$PLANNER_ID') returning id) select id from r")
CROSS=$(rpc "$PLANNER" assemble_system_handover_package "{\"p_system_id\":$SID,\"p_owner_from\":\"$PLANNER_ID\",\"p_owner_to\":\"00000000-0000-0000-0000-000000000099\",\"p_required_acceptance_date\":\"2026-12-31\",\"p_basis\":\"A foreign or absent operations owner must fail at the tenant boundary.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$CROSS" python3 -c 'import json,os; assert "same-tenant human operations owner-to" in json.loads(os.environ["BODY"])["error"]'
PACKAGE=$(rpc "$PLANNER" assemble_system_handover_package "{\"p_system_id\":$SID,\"p_owner_from\":\"$PLANNER_ID\",\"p_owner_to\":\"$EXEC_ID\",\"p_required_acceptance_date\":\"2026-12-31\",\"p_basis\":\"Signed package transfers this verified system and all current residual risks to operations.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
PID=$(field "$PACKAGE" packageId)
BODY="$PACKAGE" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="draft" and x["residualRiskCount"]>=1'

READ=$(rpc "$PLANNER" get_case_system_handover_packages "{\"p_case_id\":\"$CASE\"}")
BODY="$READ" SID="$SID" PID="$PID" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); s=next(v for v in x["systems"] if str(v["systemId"])==os.environ["SID"]); assert str(s["package"]["id"])==os.environ["PID"]; r=s["readiness"]; assert r["physicalReadiness"]["status"]=="READY" and r["informationReadiness"]["status"]=="READY" and r["operationalReadiness"]["status"]=="READY" and r["digitalMaintainability"]["status"]=="NOT_APPLICABLE"; assert r["residualRiskCount"]>=1 and r["acceptedResidualRiskCount"]==0 and r["canAccept"] is False; assert x["readinessStores"]["information"]=="asset_onboarding_items" and "does not replace" in x["equipmentReleaseBoundary"]'

WRONG_OWNER=$(rpc "$MANAGER" accept_system_handover_package "{\"p_package_id\":$PID,\"p_basis\":\"The non-designated manager attempts to take ownership and must be refused.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$WRONG_OWNER" python3 -c 'import json,os; assert "named owner-to" in json.loads(os.environ["BODY"])["error"]'
NO_RISK_ACCEPTANCE=$(rpc "$EXEC" accept_system_handover_package "{\"p_package_id\":$PID,\"p_basis\":\"Operations reviewed the package, but the residual risk is not yet accepted.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$NO_RISK_ACCEPTANCE" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert "prerequisites" in x["error"] and any("residual risk" in b for b in x["blockers"])'

psqlc "insert into risk_acceptances(organization_id,subject_type,subject_id,risk_level,rationale,compensating_controls,accepted_by,accepted_role,expires_at,review_at,status,reassessment_trigger)
select '$ORG','risk',r.id,case when coalesce(r.residual_risk_level,r.current_risk_level,'Low')='Very Low' then 'Low' else coalesce(r.residual_risk_level,r.current_risk_level,'Low') end,
 'Independent operations review accepts this bounded residual exposure for handover.',
 'Defined monitoring, review and escalation controls remain active after ownership transfer.',
 case when not exists(select 1 from recommendations rec where rec.organization_id='$ORG' and rec.risk_id=r.id and rec.treatment_owner_id='$MANAGER_ID' and coalesce(rec.status,'') not in ('rejected','dismissed')) then '$MANAGER_ID'::uuid when not exists(select 1 from recommendations rec where rec.organization_id='$ORG' and rec.risk_id=r.id and rec.treatment_owner_id='$EXEC_ID' and coalesce(rec.status,'') not in ('rejected','dismissed')) then '$EXEC_ID'::uuid else '$DEMO_ID'::uuid end,
 case when not exists(select 1 from recommendations rec where rec.organization_id='$ORG' and rec.risk_id=r.id and rec.treatment_owner_id='$MANAGER_ID' and coalesce(rec.status,'') not in ('rejected','dismissed')) then 'maintenance_manager' when not exists(select 1 from recommendations rec where rec.organization_id='$ORG' and rec.risk_id=r.id and rec.treatment_owner_id='$EXEC_ID' and coalesce(rec.status,'') not in ('rejected','dismissed')) then 'executive' else 'reliability_engineer' end,
 now()+interval '90 days',now()+interval '60 days','active','Reassess if the operating envelope, assumptions or control performance changes.'
from system_handover_residual_risks x join risks r on r.id=x.risk_id where x.organization_id='$ORG' and x.handover_package_id=$PID and r.status not in ('closed','archived') and not exists(select 1 from risk_acceptances a where a.organization_id='$ORG' and a.subject_type='risk' and a.subject_id=r.id and a.status='active' and a.expires_at>now())" >/dev/null
READY=$(rpc "$PLANNER" get_case_system_handover_packages "{\"p_case_id\":\"$CASE\"}")
BODY="$READY" SID="$SID" python3 -c 'import json,os; s=next(v for v in json.loads(os.environ["BODY"])["systems"] if str(v["systemId"])==os.environ["SID"]); assert s["readiness"]["canAccept"] is True and s["readiness"]["acceptedResidualRiskCount"]==s["readiness"]["residualRiskCount"]'
SOD_PACKAGE=$(rpc "$PLANNER" assemble_system_handover_package "{\"p_system_id\":$SID,\"p_owner_from\":\"$PLANNER_ID\",\"p_owner_to\":\"$MANAGER_ID\",\"p_required_acceptance_date\":\"2026-12-31\",\"p_basis\":\"Reassembled draft proves the performance verifier cannot also accept system ownership.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
PID=$(field "$SOD_PACKAGE" packageId)
SOD=$(rpc "$MANAGER" accept_system_handover_package "{\"p_package_id\":$PID,\"p_basis\":\"The performance verifier deliberately attempts final ownership acceptance and must fail.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$SOD" python3 -c 'import json,os; assert "performance verifier" in json.loads(os.environ["BODY"])["error"]'
FINAL_PACKAGE=$(rpc "$PLANNER" assemble_system_handover_package "{\"p_system_id\":$SID,\"p_owner_from\":\"$PLANNER_ID\",\"p_owner_to\":\"$EXEC_ID\",\"p_required_acceptance_date\":\"2026-12-31\",\"p_basis\":\"Final version names an independent operations owner after all evidence and risks are ready.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
PID=$(field "$FINAL_PACKAGE" packageId)
ACCEPTED=$(rpc "$EXEC" accept_system_handover_package "{\"p_package_id\":$PID,\"p_basis\":\"Named operations owner independently reviewed all physical, information, operational and residual-risk evidence.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$ACCEPTED" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="accepted" and x["commissioningState"]=="ACCEPTED"'
FINAL=$(rpc "$PLANNER" get_case_system_handover_packages "{\"p_case_id\":\"$CASE\"}")
BODY="$FINAL" SID="$SID" python3 -c 'import json,os; s=next(v for v in json.loads(os.environ["BODY"])["systems"] if str(v["systemId"])==os.environ["SID"]); assert s["currentState"]=="ACCEPTED" and s["package"]["status"]=="accepted" and s["package"]["acceptedAt"]'
if psqlc "update system_handover_packages set acceptance_basis='rewritten acceptance evidence is forbidden' where id=$PID" >/dev/null 2>&1; then echo 'accepted handover rewrite unexpectedly succeeded'; exit 1; fi
if psqlc "update system_handover_residual_risks set risk_id='$RISK' where handover_package_id=$PID" >/dev/null 2>&1; then echo 'handover risk reference rewrite unexpectedly succeeded'; exit 1; fi
CROSS_CASE=$(rpc "$PLANNER" get_case_system_handover_packages '{"p_case_id":"00000000-0000-4000-8000-000000000099"}')
BODY="$CROSS_CASE" python3 -c 'import json,os; assert "not found" in json.loads(os.environ["BODY"])["error"]'
echo 'D8.09 system HandoverPackage smoke passed: canonical physical, information, operational and digital readiness, complete risk references, owner transfer, human evidence, SoD, tenant refusal, immutable acceptance and canonical ACCEPTED transition'

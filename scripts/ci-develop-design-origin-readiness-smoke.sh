#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D8.10 design-origin operational-readiness smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c 'import json,os,sys; body=json.loads(os.environ["BODY"]); key=os.environ["KEY"]; key in body or sys.exit(f"missing {key!r}: {json.dumps(body,sort_keys=True)}"); print(body[key])'; }

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
AIBOT=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#')
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
ASSET=$(psqlc "with r as (insert into assets(organization_id,tag,name,asset_class) values('$ORG','D810-A-01','D8.10 design-origin asset','pump') returning id) select id from r")
EVIDENCE=$(psqlc "with r as (insert into evidence_items(organization_id,description,evidence_type,source_system) values('$ORG','D8.10 approved design-to-readiness mapping and system boundary record','documented','design-origin-readiness-smoke') returning id) select id from r")
test -n "$PLANNER"; test -n "$AIBOT"; test -n "$PLANNER_ID"; test -n "$ASSET"; test -n "$EVIDENCE"

SYSTEM=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"system\",\"p_record\":{\"ref\":\"D810-SYS\",\"title\":\"Design-origin readiness system\",\"description\":\"System boundary used to prove readiness obligations begin from approved design intent.\",\"ownerId\":\"$PLANNER_ID\"}}")
SID=$(field "$SYSTEM" id)
REQUIREMENT=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"D810-SPARES\",\"category\":\"sparing\",\"requirement\":\"Critical startup spares shall be provisioned before operations accepts the system\",\"owner_id\":\"$PLANNER_ID\"}}")
RID=$(field "$REQUIREMENT" requirement_id)

# The mapping exists during design, before an installed asset is bound. No
# guessed mapping occurs: the named human chooses one exact catalog key.
ORIGIN=$(rpc "$PLANNER" record_system_readiness_design_origin "{\"p_system_id\":$SID,\"p_design_requirement_id\":$RID,\"p_onboarding_requirement_key\":\"s14_critical_spares\",\"p_owner_id\":\"$PLANNER_ID\",\"p_required_before\":\"2026-12-31\",\"p_mapping_basis\":\"The approved sparing requirement explicitly creates the critical-spares readiness obligation.\",\"p_mapping_evidence_item_id\":\"$EVIDENCE\"}")
OID=$(field "$ORIGIN" originId)
BODY="$ORIGIN" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="awaiting_assets" and x["itemsGenerated"]==0 and x["readinessStore"]=="asset_onboarding_items"'
EARLY=$(rpc "$PLANNER" get_case_system_readiness_design_origins "{\"p_case_id\":\"$CASE\"}")
BODY="$EARLY" SID="$SID" OID="$OID" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); s=next(v for v in x["systems"] if str(v["systemId"])==os.environ["SID"]); o=next(v for v in s["origins"] if str(v["originId"])==os.environ["OID"]); assert s["assetCount"]==0 and s["pendingOriginCount"]==1 and o["fullyMaterialized"] is False; assert x["requirementStore"]=="design_requirements" and x["readinessStore"]=="asset_onboarding_items" and x["acceptanceStore"]=="system_handover_packages"'
if psqlc "insert into commissioning_system_readiness_design_origins(organization_id,commissioning_system_id,design_requirement_id,onboarding_requirement_key,owner_id,required_before,mapping_basis,mapping_evidence_item_id,recorded_by) select organization_id,commissioning_system_id,design_requirement_id,'s14_reorder_points',owner_id,required_before,'A direct service-style write attempts to bypass the governed human mapping workflow.',mapping_evidence_item_id,recorded_by from commissioning_system_readiness_design_origins where id=$OID" >/dev/null 2>&1; then echo 'direct design-origin insert unexpectedly succeeded'; exit 1; fi

AI=$(rpc "$AIBOT" record_system_readiness_design_origin "{\"p_system_id\":$SID,\"p_design_requirement_id\":$RID,\"p_onboarding_requirement_key\":\"s14_reorder_points\",\"p_owner_id\":\"$PLANNER_ID\",\"p_required_before\":\"2026-12-31\",\"p_mapping_basis\":\"An AI identity deliberately attempts a readiness mapping and must be refused.\",\"p_mapping_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$AI" python3 -c 'import json,os; assert "named-human" in json.loads(os.environ["BODY"])["error"]'
CROSS=$(rpc "$PLANNER" record_system_readiness_design_origin "{\"p_system_id\":$SID,\"p_design_requirement_id\":999999999,\"p_onboarding_requirement_key\":\"s14_reorder_points\",\"p_owner_id\":\"$PLANNER_ID\",\"p_required_before\":\"2026-12-31\",\"p_mapping_basis\":\"An absent or foreign design requirement must fail at the case and tenant boundary.\",\"p_mapping_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$CROSS" python3 -c 'import json,os; assert "same-case, same-project" in json.loads(os.environ["BODY"])["error"]'

# Binding the first installed asset automatically materializes exactly the
# selected open item into the canonical store and system scope.
BIND=$(rpc "$PLANNER" bind_commissioning_system_asset "{\"p_system_id\":$SID,\"p_asset_id\":\"$ASSET\",\"p_required_energy_types\":[\"electrical\"],\"p_basis\":\"Electrical energy defines the signed commissioning boundary for the design-origin asset.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
field "$BIND" id >/dev/null
# Asset onboarding may already have classified the canonical row before the
# system binding. Preserve that canonical state; what design-origin readiness
# must prove is that the selected obligation is scoped and remains unsatisfied
# until governed evidence completion.
test "$(psqlc "select count(*) from asset_onboarding_items i join commissioning_system_readiness_scope q on q.onboarding_item_id=i.id where i.organization_id='$ORG' and q.organization_id='$ORG' and q.commissioning_system_id=$SID and i.asset_id='$ASSET' and i.requirement_key='s14_critical_spares' and not (i.status in ('auto_filled','deduced','human_provided','not_applicable') and i.evidence_item_id is not null)")" = "1"
test "$(psqlc "select count(*) from asset_onboarding_items where organization_id='$ORG' and asset_id='$ASSET' and requirement_key='s14_reorder_points'")" = "0"
test "$(psqlc "select count(*) from commissioning_system_readiness_origin_items where organization_id='$ORG' and design_origin_id=$OID")" = "1"

FINAL=$(rpc "$PLANNER" get_case_system_readiness_design_origins "{\"p_case_id\":\"$CASE\"}")
BODY="$FINAL" SID="$SID" OID="$OID" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); s=next(v for v in x["systems"] if str(v["systemId"])==os.environ["SID"]); o=next(v for v in s["origins"] if str(v["originId"])==os.environ["OID"]); assert s["assetCount"]==1 and s["pendingOriginCount"]==0 and o["materializedItemCount"]==1 and o["fullyMaterialized"] is True and o["readinessCategory"]=="spares"'
HANDOVER=$(rpc "$PLANNER" get_system_handover_readiness "{\"p_system_id\":$SID}")
BODY="$HANDOVER" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert any(g.get("category")=="spares" for g in x["operationalReadiness"]["gaps"]); assert x["operationalReadiness"]["status"]=="NOT_READY"'

# Repeating the same immutable mapping is idempotent; attempting to alter its
# accountability is a rewrite and is refused.
REPEAT=$(rpc "$PLANNER" record_system_readiness_design_origin "{\"p_system_id\":$SID,\"p_design_requirement_id\":$RID,\"p_onboarding_requirement_key\":\"s14_critical_spares\",\"p_owner_id\":\"$PLANNER_ID\",\"p_required_before\":\"2026-12-31\",\"p_mapping_basis\":\"The approved sparing requirement explicitly creates the critical-spares readiness obligation.\",\"p_mapping_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$REPEAT" OID="$OID" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert str(x["originId"])==os.environ["OID"] and x["itemsGenerated"]==0'
REWRITE=$(rpc "$PLANNER" record_system_readiness_design_origin "{\"p_system_id\":$SID,\"p_design_requirement_id\":$RID,\"p_onboarding_requirement_key\":\"s14_critical_spares\",\"p_owner_id\":\"$PLANNER_ID\",\"p_required_before\":\"2027-01-31\",\"p_mapping_basis\":\"A later deadline attempts to rewrite the immutable design-origin accountability.\",\"p_mapping_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$REWRITE" python3 -c 'import json,os; assert "cannot be rewritten" in json.loads(os.environ["BODY"])["error"]'
if psqlc "update commissioning_system_readiness_design_origins set required_before='2027-01-31' where id=$OID" >/dev/null 2>&1; then echo 'design-origin provenance rewrite unexpectedly succeeded'; exit 1; fi
if psqlc "delete from commissioning_system_readiness_origin_items where design_origin_id=$OID" >/dev/null 2>&1; then echo 'generated origin link deletion unexpectedly succeeded'; exit 1; fi
CROSS_CASE=$(rpc "$PLANNER" get_case_system_readiness_design_origins '{"p_case_id":"00000000-0000-4000-8000-000000000099"}')
BODY="$CROSS_CASE" python3 -c 'import json,os; assert "not found" in json.loads(os.environ["BODY"])["error"]'

echo 'D8.10 design-origin readiness smoke passed: human mapping, pre-asset origin, automatic canonical item generation, exact catalog selection, tenant refusal, immutability and handover visibility'

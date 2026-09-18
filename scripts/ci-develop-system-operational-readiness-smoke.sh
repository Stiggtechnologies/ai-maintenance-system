#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D8.08 system operational-readiness smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c 'import json,os,sys; body=json.loads(os.environ["BODY"]); key=os.environ["KEY"]; key in body or sys.exit(f"missing {key!r}: {json.dumps(body,sort_keys=True)}"); print(body[key])'; }
PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
ASSET=$(psqlc "with r as (insert into assets(organization_id,tag,name,asset_class) values('$ORG','D808-A-01','D8.08 readiness asset','pump') returning id) select id from r")
EVIDENCE=$(psqlc "with r as (insert into evidence_items(organization_id,asset_id,description,evidence_type,source_system) values('$ORG','$ASSET','D8.08 signed readiness assignment and completion evidence','tested','system-readiness-smoke') returning id) select id from r")
test -n "$PLANNER"; test -n "$PLANNER_ID"; test -n "$ASSET"; test -n "$EVIDENCE"

SYSTEM=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"system\",\"p_record\":{\"ref\":\"D808-SYS\",\"title\":\"Operational readiness system\",\"description\":\"System boundary used to prove readiness accountability on canonical onboarding items.\",\"ownerId\":\"$PLANNER_ID\"}}")
SID=$(field "$SYSTEM" id)
NO_ASSET=$(rpc "$PLANNER" initialize_commissioning_system_readiness "{\"p_system_id\":$SID,\"p_owner_id\":\"$PLANNER_ID\",\"p_required_before\":\"2026-12-31\",\"p_basis\":\"Approved readiness plan assigns every scoped item before handover.\",\"p_basis_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$NO_ASSET" python3 -c 'import json,os; assert "bind at least one asset" in json.loads(os.environ["BODY"])["error"]'
rpc "$PLANNER" bind_commissioning_system_asset "{\"p_system_id\":$SID,\"p_asset_id\":\"$ASSET\",\"p_required_energy_types\":[\"electrical\"],\"p_basis\":\"Electrical energy defines the commissioning boundary for this readiness asset.\",\"p_evidence_item_id\":\"$EVIDENCE\"}" >/dev/null
CROSS=$(rpc "$PLANNER" initialize_commissioning_system_readiness "{\"p_system_id\":$SID,\"p_owner_id\":\"00000000-0000-0000-0000-000000000099\",\"p_required_before\":\"2026-12-31\",\"p_basis\":\"A foreign or absent owner must be refused at the tenant boundary.\",\"p_basis_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$CROSS" python3 -c 'import json,os; assert "same-tenant named readiness owner" in json.loads(os.environ["BODY"])["error"]'
INIT=$(rpc "$PLANNER" initialize_commissioning_system_readiness "{\"p_system_id\":$SID,\"p_owner_id\":\"$PLANNER_ID\",\"p_required_before\":\"2026-12-31\",\"p_basis\":\"Approved readiness plan assigns every scoped item before handover.\",\"p_basis_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$INIT" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["itemsAssigned"]>0 and x["status"]=="recorded"'
READ=$(rpc "$PLANNER" get_case_system_operational_readiness "{\"p_case_id\":\"$CASE\"}")
ITEM=$(BODY="$READ" SID="$SID" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); s=next(v for v in x["systems"] if str(v["systemId"])==os.environ["SID"]); assert x["readinessStore"]=="asset_onboarding_items" and s["assetCount"]==1 and s["itemCount"]>0; assert len({i["category"] for i in s["items"]})==13; assert all(i["ownerId"] and i["requiredBefore"] for i in s["items"]); print(s["items"][0]["itemId"])')
DONE=$(rpc "$PLANNER" record_system_operational_readiness_item "{\"p_system_id\":$SID,\"p_item_id\":\"$ITEM\",\"p_status\":\"human_provided\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_note\":\"Named owner reviewed the controlled evidence and confirmed this readiness item complete.\",\"p_value\":{\"confirmed\":true}}")
BODY="$DONE" python3 -c 'import json,os; assert json.loads(os.environ["BODY"])["status"]=="human_provided"'
REPEAT=$(rpc "$PLANNER" record_system_operational_readiness_item "{\"p_system_id\":$SID,\"p_item_id\":\"$ITEM\",\"p_status\":\"not_applicable\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_note\":\"A second determination must not rewrite completed readiness evidence.\",\"p_value\":{}}")
BODY="$REPEAT" python3 -c 'import json,os; assert "immutable" in json.loads(os.environ["BODY"])["error"]'
FINAL=$(rpc "$PLANNER" get_case_system_operational_readiness "{\"p_case_id\":\"$CASE\"}")
BODY="$FINAL" SID="$SID" ITEM="$ITEM" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); s=next(v for v in x["systems"] if str(v["systemId"])==os.environ["SID"]); i=next(v for v in s["items"] if v["itemId"]==os.environ["ITEM"]); assert s["satisfiedCount"]==1 and i["status"]=="human_provided" and i["evidenceReady"] is True'
if psqlc "update commissioning_system_readiness_scope set basis='rewritten readiness scope is forbidden' where commissioning_system_id=$SID" >/dev/null 2>&1; then echo 'readiness scope rewrite unexpectedly succeeded'; exit 1; fi
CROSS_CASE=$(rpc "$PLANNER" get_case_system_operational_readiness '{"p_case_id":"00000000-0000-4000-8000-000000000099"}')
BODY="$CROSS_CASE" python3 -c 'import json,os; assert "not found" in json.loads(os.environ["BODY"])["error"]'
echo 'D8.08 system operational-readiness smoke passed: canonical items, 13 categories, system scope, owner/date/evidence, tenant refusal, immutable completion and scope'

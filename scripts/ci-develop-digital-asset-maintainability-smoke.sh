#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D4.15 digital asset maintainability smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; CASE='80300000-0000-4000-8000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); print(x[os.environ["KEY"]])'; }

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#'); AIBOT=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#')
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
ASSET=$(psqlc "select a.id from assets a where a.organization_id='$ORG' and not exists(select 1 from configuration_baselines b where b.asset_id=a.id and b.baseline_kind='as_built' and b.is_current) order by a.created_at limit 1")
if test -z "$ASSET"; then ASSET=$(psqlc "select id from assets where organization_id='$ORG' order by created_at limit 1"); fi
EVIDENCE=$(psqlc "with r as(insert into evidence_items(organization_id,asset_id,description,evidence_type,source_system) values('$ORG','$ASSET','D4.15 digital asset maintainability evidence for configuration, backup and restore','documented','digital-maintainability-smoke') returning id) select id from r")
OTHER_ORG=$(psqlc "select id from organizations where id<>'$ORG' order by id limit 1")
CROSS_EVIDENCE=$(psqlc "with r as(insert into evidence_items(organization_id,description,evidence_type,source_system) values('$OTHER_ORG','Cross-tenant evidence must never satisfy D4.15','documented','digital-maintainability-smoke') returning id) select id from r")
test -n "$PLANNER"; test -n "$AIBOT"; test -n "$PLANNER_ID"; test -n "$ASSET"; test -n "$EVIDENCE"; test -n "$CROSS_EVIDENCE"

SYSTEM_RESULT=$(rpc "$PLANNER" record_commissioning_object "{\"p_case_id\":\"$CASE\",\"p_kind\":\"system\",\"p_record\":{\"ref\":\"D415-SMOKE\",\"title\":\"Digital handover smoke system\",\"description\":\"System fixture proving digital maintainability blocks canonical handover.\",\"ownerId\":\"$PLANNER_ID\"}}")
SYSTEM_ID=$(field "$SYSTEM_RESULT" id)
rpc "$PLANNER" bind_commissioning_system_asset "{\"p_system_id\":$SYSTEM_ID,\"p_asset_id\":\"$ASSET\",\"p_required_energy_types\":[\"electrical\"],\"p_basis\":\"This digital control asset is within the commissioning and handover boundary.\",\"p_evidence_item_id\":\"$EVIDENCE\"}" >/dev/null

INITIAL=$(rpc "$PLANNER" get_asset_digital_maintainability "{\"p_asset_id\":\"$ASSET\",\"p_baseline_kind\":\"as_built\"}")
BODY="$INITIAL" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="NOT_ASSESSED" and "Unknown is not not-applicable" in x["decisionBoundary"]'
BEFORE=$(rpc "$PLANNER" get_system_handover_readiness "{\"p_system_id\":$SYSTEM_ID,\"p_package_id\":null}")
BODY="$BEFORE" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert not x["canAccept"] and "Digital asset maintainability is not complete for every system asset." in x["blockers"], "handover unexpectedly remained acceptable before digital completion"'

AI=$(rpc "$AIBOT" assess_asset_digital_maintainability "{\"p_asset_id\":\"$ASSET\",\"p_baseline_kind\":\"as_built\",\"p_applicability\":\"applicable\",\"p_basis\":\"An AI identity attempts to determine the digital handover scope for this asset.\",\"p_source_reference\":\"D415-SMOKE\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$AI" python3 -c 'import json,os; assert "named human" in json.loads(os.environ["BODY"])["error"]'
CROSS=$(rpc "$PLANNER" assess_asset_digital_maintainability "{\"p_asset_id\":\"$ASSET\",\"p_baseline_kind\":\"as_built\",\"p_applicability\":\"applicable\",\"p_basis\":\"The asset contains maintainable digital components within the handover boundary.\",\"p_source_reference\":\"D415-SMOKE\",\"p_evidence_item_id\":\"$CROSS_EVIDENCE\"}")
BODY="$CROSS" python3 -c 'import json,os; assert "same-tenant" in json.loads(os.environ["BODY"])["error"], "cross-tenant digital evidence unexpectedly succeeded"'
ASSESS=$(rpc "$PLANNER" assess_asset_digital_maintainability "{\"p_asset_id\":\"$ASSET\",\"p_baseline_kind\":\"as_built\",\"p_applicability\":\"applicable\",\"p_basis\":\"The asset contains maintainable digital components within the handover boundary.\",\"p_source_reference\":\"D415-SMOKE\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BASELINE_ID=$(field "$ASSESS" baselineId)
if psqlc "update configuration_baselines set digital_maintainability_applicability='not_applicable' where id=$BASELINE_ID" >/dev/null 2>&1; then echo 'direct digital baseline rewrite unexpectedly succeeded'; exit 1; fi

CROSS_ITEM=$(rpc "$PLANNER" record_digital_configuration_item "{\"p_baseline_id\":$BASELINE_ID,\"p_position_ref\":\"PLC slot 1\",\"p_firmware_version\":\"4.2.1\",\"p_software_version\":\"12.6\",\"p_dependency_manifest\":[{\"name\":\"runtime\",\"version\":\"4\"}],\"p_license_inventory\":[{\"reference\":\"LIC-001\"}],\"p_patch_status\":\"Assessed current at handover\",\"p_vendor_support_horizon\":\"2030-12-31\",\"p_backup_evidence_item_id\":\"$EVIDENCE\",\"p_restore_procedure_evidence_item_id\":\"$EVIDENCE\",\"p_configuration_file_evidence_item_id\":\"$EVIDENCE\",\"p_field_exemptions\":[],\"p_basis\":\"Vendor dossier and witnessed restore test establish the digital configuration.\",\"p_record_evidence_item_id\":\"$CROSS_EVIDENCE\"}")
BODY="$CROSS_ITEM" python3 -c 'import json,os; assert "same-tenant record evidence" in json.loads(os.environ["BODY"])["error"], "cross-tenant digital evidence unexpectedly succeeded"'
ITEM=$(rpc "$PLANNER" record_digital_configuration_item "{\"p_baseline_id\":$BASELINE_ID,\"p_position_ref\":\"PLC slot 1\",\"p_firmware_version\":\"4.2.1\",\"p_software_version\":\"12.6\",\"p_dependency_manifest\":[{\"name\":\"runtime\",\"version\":\"4\"}],\"p_license_inventory\":[{\"reference\":\"LIC-001\"}],\"p_patch_status\":\"Assessed current at handover\",\"p_vendor_support_horizon\":\"2030-12-31\",\"p_backup_evidence_item_id\":\"$EVIDENCE\",\"p_restore_procedure_evidence_item_id\":\"$EVIDENCE\",\"p_configuration_file_evidence_item_id\":\"$EVIDENCE\",\"p_field_exemptions\":[],\"p_basis\":\"Vendor dossier and witnessed restore test establish the digital configuration.\",\"p_record_evidence_item_id\":\"$EVIDENCE\"}")
ITEM_ID=$(field "$ITEM" configurationItemId)
if psqlc "update configuration_items set patch_status='Direct rewrite' where id=$ITEM_ID" >/dev/null 2>&1; then echo 'direct digital item rewrite unexpectedly succeeded'; exit 1; fi
FLIP=$(rpc "$PLANNER" assess_asset_digital_maintainability "{\"p_asset_id\":\"$ASSET\",\"p_baseline_kind\":\"as_built\",\"p_applicability\":\"not_applicable\",\"p_basis\":\"An attempted scope reversal must not erase the already recorded digital estate.\",\"p_source_reference\":\"D415-SMOKE\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
BODY="$FLIP" python3 -c 'import json,os; assert "cannot be erased" in json.loads(os.environ["BODY"])["error"]'

READY=$(rpc "$PLANNER" get_asset_digital_maintainability "{\"p_asset_id\":\"$ASSET\",\"p_baseline_kind\":\"as_built\"}")
BODY="$READY" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="READY" and x["completeItems"]==1 and len(x["fieldContract"])==9 and not x["gaps"]'
BASE=$(rpc "$PLANNER" get_system_handover_readiness_pre_digital "{\"p_system_id\":$SYSTEM_ID,\"p_package_id\":null}")
AFTER=$(rpc "$PLANNER" get_system_handover_readiness "{\"p_system_id\":$SYSTEM_ID,\"p_package_id\":null}")
BASE_BODY="$BASE" AFTER_BODY="$AFTER" python3 -c 'import json,os; b=json.loads(os.environ["BASE_BODY"]); a=json.loads(os.environ["AFTER_BODY"]); assert a["digitalMaintainability"]["status"]=="READY"; assert "Digital asset maintainability is not complete for every system asset." not in a["blockers"]; assert a["blockers"]==b["blockers"] and a["canAccept"]==b["canAccept"], "handover did not become acceptable after digital completion"'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('configuration_baseline','configuration_item') and event_data->>'asset_id'='$ASSET'")" = "2"
echo 'D4.15 digital asset maintainability smoke passed: nine fields, human scope, tenant evidence, fail-closed writes and canonical handover composition'

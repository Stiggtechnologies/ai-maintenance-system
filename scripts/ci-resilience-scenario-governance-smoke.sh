#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Enterprise resilience scenario governance smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER='99999999-9999-9999-9999-999999999917'
OTHER_SITE='98700000-0000-0000-0000-000000000002'
OTHER_ASSET='98700000-0000-0000-0000-000000000003'
EVIDENCE='98700000-0000-0000-0000-000000000021'
FOREIGN_EVIDENCE='98700000-0000-0000-0000-000000000022'
PREFIX='E11-CI'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }
field(){ BODY="$(body "$1")" KEY="$2" python3 -c "import json,os;print(json.loads(os.environ['BODY'])[os.environ['KEY']])"; }

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$PLANNER"; test -n "$ADMIN"

ASSET=$(psqlc "select id from assets where organization_id='$ORG' order by created_at limit 1")
SITE=$(psqlc "select site_id from assets where id='$ASSET'")
test -n "$ASSET"; test -n "$SITE"

psqlc "insert into organizations(id,name,industry,org_level) values('$OTHER','E11 foreign tenant','utilities','enterprise') on conflict(id) do nothing"
psqlc "insert into sites(id,organization_id,name) values('$OTHER_SITE','$OTHER','E11 foreign site') on conflict(id) do nothing"
psqlc "insert into assets(id,organization_id,site_id,name,asset_class) values('$OTHER_ASSET','$OTHER','$OTHER_SITE','E11 foreign asset','pump') on conflict(id) do nothing"
psqlc "insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,description,evidence_class) values('$EVIDENCE','$ORG','$ASSET','ci-e11','documented','Approved enterprise hazard-source package with stated scope and currency.','DOCUMENTED') on conflict(id) do nothing"
psqlc "insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,description,evidence_class) values('$FOREIGN_EVIDENCE','$OTHER','$OTHER_ASSET','ci-e11','documented','Foreign-tenant evidence that must never cross the tenant wall.','DOCUMENTED') on conflict(id) do nothing"
AUDIT_BEFORE=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('resilience_threat_scenario','resilience_scenario_exposure','resilience_operating_mode_definition')")

NO_PROVENANCE=$(rpc "$PLANNER" save_threat_scenario "{\"p_scenario\":{\"scenario_key\":\"$PREFIX-NO-EVIDENCE\",\"title\":\"No provenance scenario\",\"threat_kind\":\"wildfire\",\"description\":\"This scenario must be refused without evidence provenance.\",\"governance_basis\":\"A substantive basis cannot replace the provenance requirement.\"}}")
err "$NO_PROVENANCE" 'cite canonical evidence or explicitly name missing evidence'

BAD_ARRAY=$(rpc "$PLANNER" save_threat_scenario "{\"p_scenario\":{\"scenario_key\":\"$PREFIX-BAD-ARRAY\",\"title\":\"Malformed evidence scenario\",\"threat_kind\":\"smoke\",\"description\":\"Malformed evidence input must produce a governed refusal.\",\"governance_basis\":\"Controlled validation rejects ambiguous evidence envelope shapes.\",\"evidence_item_ids\":\"$EVIDENCE\"}}")
err "$BAD_ARRAY" 'must be arrays'

BAD_ARRAY_MEMBER=$(rpc "$PLANNER" save_threat_scenario "{\"p_scenario\":{\"scenario_key\":\"$PREFIX-BAD-MEMBER\",\"title\":\"Malformed evidence member\",\"threat_kind\":\"smoke\",\"description\":\"Non-string evidence members must produce a governed refusal.\",\"governance_basis\":\"Controlled validation rejects ambiguous evidence member types.\",\"missing_evidence\":[42]}}")
err "$BAD_ARRAY_MEMBER" 'strings only'

FOREIGN_SITE=$(rpc "$PLANNER" save_threat_scenario "{\"p_scenario\":{\"scenario_key\":\"$PREFIX-FOREIGN-SITE\",\"title\":\"Foreign site scenario\",\"threat_kind\":\"flood\",\"description\":\"Cross-tenant site references must be refused.\",\"site_id\":\"$OTHER_SITE\",\"governance_basis\":\"Tenant isolation is mandatory for every scenario reference.\",\"missing_evidence\":[\"Site flood elevation survey\"]}}")
err "$FOREIGN_SITE" 'site not found in this organization'

FOREIGN_PROVENANCE=$(rpc "$PLANNER" save_threat_scenario "{\"p_scenario\":{\"scenario_key\":\"$PREFIX-FOREIGN-EVIDENCE\",\"title\":\"Foreign evidence scenario\",\"threat_kind\":\"cyber_incident\",\"description\":\"Cross-tenant evidence references must be refused.\",\"governance_basis\":\"Tenant isolation is mandatory for every evidence reference.\",\"evidence_item_ids\":[\"$FOREIGN_EVIDENCE\"]}}")
err "$FOREIGN_PROVENANCE" 'belong to this organization'

PARTIAL_EXERCISE=$(rpc "$PLANNER" save_threat_scenario "{\"p_scenario\":{\"scenario_key\":\"$PREFIX-PARTIAL-EXERCISE\",\"title\":\"Partial exercise record\",\"threat_kind\":\"wildfire\",\"description\":\"An exercise date without its outcome must be refused.\",\"last_exercised_on\":\"2026-01-15\",\"governance_basis\":\"Exercise provenance must be recorded as one complete fact.\",\"missing_evidence\":[\"Exercise outcome record\"]}}")
err "$PARTIAL_EXERCISE" 'date and outcome must be recorded together'

BAD_DATE=$(rpc "$PLANNER" save_threat_scenario "{\"p_scenario\":{\"scenario_key\":\"$PREFIX-BAD-DATE\",\"title\":\"Invalid exercise date\",\"threat_kind\":\"wildfire\",\"description\":\"An invalid exercise date must return a governed validation error.\",\"last_exercised_on\":\"2026-99-99\",\"exercise_outcome\":\"successful\",\"governance_basis\":\"Exercise provenance must be recorded as a valid and complete fact.\",\"missing_evidence\":[\"Exercise attendance record\"]}}")
err "$BAD_DATE" 'invalid identifier, date, number or controlled value'

save_scenario(){
  local key="$1" kind="$2" title="$3" evidence_json="$4" result
  result=$(rpc "$PLANNER" save_threat_scenario "{\"p_scenario\":{\"scenario_key\":\"$PREFIX-$key\",\"title\":\"$title\",\"threat_kind\":\"$kind\",\"description\":\"Controlled $title exposure scenario for enterprise resilience testing.\",\"site_id\":\"$SITE\",\"annual_likelihood\":\"0.02\",\"governance_basis\":\"Human-reviewed hazard scope mapped to canonical site and asset identities.\",$evidence_json}}")
  ok "$result"
  field "$result" scenario_id
}

WILDFIRE=$(save_scenario WILDFIRE wildfire 'wildfire perimeter' '"missing_evidence":["Current wildfire perimeter model"]')
SMOKE=$(save_scenario SMOKE smoke 'regional smoke' "\"evidence_item_ids\":[\"$EVIDENCE\"]")
FLOOD=$(save_scenario FLOOD flood 'flood inundation' '"missing_evidence":["Current flood-depth grid"]')
COLD=$(save_scenario COLD extreme_cold 'extreme cold' '"missing_evidence":["Cold-weather operating envelope review"]')
CYBER=$(save_scenario CYBER cyber_incident 'cyber loss of view' '"missing_evidence":["Current OT attack-path assessment"]')
test -n "$WILDFIRE"; test -n "$SMOKE"; test -n "$FLOOD"; test -n "$COLD"; test -n "$CYBER"

EXPOSURE=$(rpc "$PLANNER" replace_scenario_exposure "{\"p_scenario_id\":$SMOKE,\"p_asset_ids\":[\"$ASSET\"],\"p_basis\":\"Site HVAC intake and outdoor work exposure confirmed by named human review.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
ok "$EXPOSURE"
test "$(field "$EXPOSURE" mapped_assets)" = 1

DUPLICATE=$(rpc "$PLANNER" replace_scenario_exposure "{\"p_scenario_id\":$SMOKE,\"p_asset_ids\":[\"$ASSET\",\"$ASSET\"],\"p_basis\":\"Duplicate asset identities must not create ambiguous exposure evidence.\"}")
err "$DUPLICATE" 'unique'
FOREIGN_ASSET=$(rpc "$PLANNER" replace_scenario_exposure "{\"p_scenario_id\":$SMOKE,\"p_asset_ids\":[\"$OTHER_ASSET\"],\"p_basis\":\"Cross-tenant exposed assets must remain inaccessible to this tenant.\"}")
err "$FOREIGN_ASSET" 'belong to this organization'
FOREIGN_EXPOSURE_EVIDENCE=$(rpc "$PLANNER" replace_scenario_exposure "{\"p_scenario_id\":$SMOKE,\"p_asset_ids\":[\"$ASSET\"],\"p_basis\":\"Cross-tenant evidence must not substantiate an otherwise valid mapping.\",\"p_evidence_item_id\":\"$FOREIGN_EVIDENCE\"}")
err "$FOREIGN_EXPOSURE_EVIDENCE" 'belong to this organization'

BAD_MODE=$(rpc "$ADMIN" save_operating_mode_definition '{"p_definition":{"mode":"normal","entry_criteria":"Stable operations within approved operating envelope.","exit_criteria":"Observed condition exceeds a governed normal-operation threshold.","declared_by_role":"Site manager","authority_changes":"Normal site decision rights and approval limits remain in force.","governance_basis":"Approved site emergency-management and continuity policy source.","missing_evidence":"not-an-array"}}')
err "$BAD_MODE" 'must be arrays'

for MODE in normal degraded emergency recovery; do
  MODE_SAVE=$(rpc "$ADMIN" save_operating_mode_definition "{\"p_definition\":{\"mode\":\"$MODE\",\"entry_criteria\":\"Observed and independently reviewed criteria require entry to $MODE mode.\",\"exit_criteria\":\"Named authority confirms exit criteria and accountable handover from $MODE mode.\",\"declared_by_role\":\"Site manager\",\"authority_changes\":\"Documented decision rights and approval limits for $MODE mode apply.\",\"governance_basis\":\"Approved emergency-management policy reviewed for this site and operating scope.\",\"missing_evidence\":[\"Site-specific policy approval signature\"]}}")
  ok "$MODE_SAVE"
done

EVENTS_BEFORE=$(psqlc "select count(*) from operating_mode_events where organization_id='$ORG'")
WORKSPACE=$(rpc "$PLANNER" get_resilience_configuration_workspace '{}')
ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" PREFIX="$PREFIX" OTHER_SITE="$OTHER_SITE" OTHER_ASSET="$OTHER_ASSET" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
ours=[s for s in x['scenarios'] if s['scenario_key'].startswith(os.environ['PREFIX'])]
assert {s['threat_kind'] for s in ours} >= {'wildfire','smoke','flood','extreme_cold','cyber_incident'}, ours
assert len([m for m in x['modes'] if m['mode'] in {'normal','degraded','emergency','recovery'}]) == 4
assert all(s['id'] != os.environ['OTHER_SITE'] for s in x['sites'])
assert all(a['id'] != os.environ['OTHER_ASSET'] for a in x['assets'])
assert 'does not infer or autonomously declare' in x['authority_boundary']
PY
EVENTS_AFTER=$(psqlc "select count(*) from operating_mode_events where organization_id='$ORG'")
test "$EVENTS_BEFORE" = "$EVENTS_AFTER"

POSTURE=$(rpc "$PLANNER" get_resilience_posture '{}')
test "$(status "$POSTURE")" = 200
BODY="$(body "$POSTURE")" python3 -c "import json,os;x=json.loads(os.environ['BODY'])[0];assert x['modes_fully_specified']==4,x;assert x['current_mode'] in ('unrecorded','normal','degraded','emergency','recovery','mixed'),x"

DIRECT_STATUS=$(curl -sS -o /tmp/e11-direct-write.txt -w '%{http_code}' -X POST "$API_URL/rest/v1/threat_scenarios" -H "apikey: $ANON_KEY" -H "authorization: Bearer $PLANNER" -H 'content-type: application/json' -d "{\"organization_id\":\"$ORG\",\"scenario_key\":\"$PREFIX-DIRECT\",\"title\":\"Direct write\",\"threat_kind\":\"wildfire\"}")
test "$DIRECT_STATUS" = 401 -o "$DIRECT_STATUS" = 403

AUDIT_AFTER=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('resilience_threat_scenario','resilience_scenario_exposure','resilience_operating_mode_definition')")
test "$((AUDIT_AFTER-AUDIT_BEFORE))" -ge 10

echo 'Enterprise resilience scenario governance smoke passed: threats=5 smoke_distinct=true modes=4 tenant_wall=true evidence_or_gap=true direct_write_closed=true execution_authority_unchanged=true'

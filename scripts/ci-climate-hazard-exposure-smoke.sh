#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U15 climate hazard exposure smoke FAILED at line $LINENO"' ERR

psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999915'
FOREIGN_SITE='98500000-0000-0000-0000-000000000002'
EVIDENCE='98500000-0000-0000-0000-000000000021'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ local code; code="$(status "$1")"; test "$code" = 200 || { echo "expected 200, got $code: $(body "$1")"; return 1; }; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ local code; code="$(status "$1")"; test "$code" = 200 || { echo "expected controlled 200 refusal, got $code: $(body "$1")"; return 1; }; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }
field(){ BODY="$(body "$1")" KEY="$2" python3 -c "import json,os;print(json.loads(os.environ['BODY'])[os.environ['KEY']])"; }

RPCS=$(psqlc "select string_agg(proname,',' order by proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('create_climate_hazard_exposure','record_climate_hazard_exposure','review_climate_hazard_exposure','get_climate_hazard_exposure_workspace')")
test "$RPCS" = 'create_climate_hazard_exposure,get_climate_hazard_exposure_workspace,record_climate_hazard_exposure,review_climate_hazard_exposure'
psqlc "notify pgrst,'reload schema'" >/dev/null

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
REVIEWER=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$AUTHOR" && test -n "$REVIEWER"
ASSET=$(psqlc "select id from assets where organization_id='$ORG' order by created_at limit 1")
SITE=$(psqlc "select id from sites where organization_id='$ORG' order by created_at limit 1")
test -n "$ASSET" && test -n "$SITE"
psqlc "insert into organizations(id,name,industry,org_level) values('$OTHER_ORG','U15 foreign','utilities','enterprise') on conflict(id) do nothing"
psqlc "insert into sites(id,organization_id,name) values('$FOREIGN_SITE','$OTHER_ORG','Foreign climate site') on conflict(id) do nothing"
psqlc "insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,description,evidence_class) values('$EVIDENCE','$ORG','$ASSET','ci-climate','engineering_calculation','Controlled thirteen-hazard source package with stated scenario and horizon.','DOCUMENTED') on conflict(id) do nothing"
VERIFY_EVIDENCE=$(rpc "$REVIEWER" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent CI source and applicability review\",\"p_outcome\":\"verified\",\"p_note\":\"Source version, scenario horizon, asset applicability and ownership confirmed.\"}"); ok "$VERIFY_EVIDENCE"
FEATURE_RESULT=$(rpc "$AUTHOR" record_geospatial_feature "{\"p_feature\":{\"feature_type\":\"hazard_zone\",\"feature_key\":\"u15-climate-source\",\"name\":\"Controlled U15 hazard source\",\"geometry_type\":\"Polygon\",\"geometry\":{\"type\":\"Polygon\",\"coordinates\":[[[-113.6,53.4],[-113.3,53.4],[-113.3,53.7],[-113.6,53.4]]]},\"source_system\":\"ci-climate\",\"source_reference\":\"U15-SOURCE-1\",\"observed_at\":\"2026-09-15T08:00:00Z\",\"valid_until\":\"2027-09-15T08:00:00Z\",\"data_quality\":\"good\",\"evidence_item_ids\":[\"$EVIDENCE\"]}}"); ok "$FEATURE_RESULT"
FEATURE=$(field "$FEATURE_RESULT" feature_id)
VERIFY_FEATURE=$(rpc "$REVIEWER" verify_geospatial_feature "{\"p_feature_id\":\"$FEATURE\",\"p_note\":\"Independent review confirms the source, geometry version, validity window and evidence.\"}"); ok "$VERIFY_FEATURE"

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_climate_hazard_exposure_workspace" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')
test "$NOAUTH" = 401
NO_SCOPE=$(rpc "$AUTHOR" create_climate_hazard_exposure "{\"p_assessment\":{\"assessment_ref\":\"U15-NONE\",\"future_conditions_basis\":\"Controlled source without a canonical subject must fail.\",\"source_as_of\":\"2026-09-15T08:00:00Z\",\"evidence_item_ids\":[\"$EVIDENCE\"]}}"); err "$NO_SCOPE" 'select at least one canonical asset or site'
FOREIGN=$(rpc "$AUTHOR" create_climate_hazard_exposure "{\"p_assessment\":{\"site_id\":\"$FOREIGN_SITE\",\"assessment_ref\":\"U15-XTENANT\",\"future_conditions_basis\":\"Controlled cross-tenant source and horizon must be refused.\",\"source_as_of\":\"2026-09-15T08:00:00Z\",\"evidence_item_ids\":[\"$EVIDENCE\"]}}"); err "$FOREIGN" 'site not found in this organization'

CREATE=$(rpc "$AUTHOR" create_climate_hazard_exposure "{\"p_assessment\":{\"asset_id\":\"$ASSET\",\"site_id\":\"$SITE\",\"assessment_ref\":\"U15-CI\",\"future_conditions_basis\":\"Controlled regional scenario and source horizon through the assessed asset life.\",\"source_as_of\":\"2026-09-15T08:00:00Z\",\"valid_until\":\"2027-09-15T08:00:00Z\",\"evidence_item_ids\":[\"$EVIDENCE\"],\"geospatial_feature_ids\":[\"$FEATURE\"],\"missing_evidence\":[\"Field confirmation before any operational change\"]}}"); ok "$CREATE"
ASSESSMENT=$(field "$CREATE" assessment_id)

EFFECTS='{"design":"Evaluate the stated design basis with accountable engineering.","maintenance_interval":"Evaluate the inspection interval against observed degradation evidence.","spares":"Evaluate critical-spares coverage against the approved recovery objective.","emergency_plan":"Evaluate the emergency plan against the stated hazard scenario.","renewal":"Evaluate renewal timing through the governed capital process."}'
INCOMPLETE_EFFECTS='{"design":"Evaluate the stated design basis with accountable engineering.","maintenance_interval":"Evaluate the inspection interval against observed degradation evidence.","spares":"Evaluate critical-spares coverage against the approved recovery objective.","emergency_plan":"Evaluate the emergency plan against the stated hazard scenario."}'
INCOMPLETE=$(rpc "$AUTHOR" record_climate_hazard_exposure "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_hazard\":{\"hazard\":\"heat\",\"future_condition\":\"Supplied heat scenario through asset life\",\"exposure_statement\":\"Asset exposure is stated by the controlled source\",\"design_response\":\"Engineering response remains subject to human approval\",\"residual_gap\":\"Field confirmation pending\",\"decision_effects\":$INCOMPLETE_EFFECTS,\"evidence_item_id\":\"$EVIDENCE\"}}"); err "$INCOMPLETE" 'design, maintenance interval, spares, emergency plan and renewal'
ONE=$(rpc "$AUTHOR" record_climate_hazard_exposure "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_hazard\":{\"hazard\":\"heat\",\"future_condition\":\"Supplied heat scenario through asset life\",\"exposure_statement\":\"Asset exposure is stated by the controlled source\",\"design_response\":\"Engineering response remains subject to human approval\",\"residual_gap\":\"Field confirmation pending\",\"decision_effects\":$EFFECTS,\"evidence_item_id\":\"$EVIDENCE\",\"geospatial_feature_ids\":[\"$FEATURE\"],\"missing_evidence\":[\"Current field confirmation\"]}}"); ok "$ONE"
EARLY=$(rpc "$REVIEWER" review_climate_hazard_exposure "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_note\":\"Independent review attempted before all hazard records exist.\"}"); err "$EARLY" '1 of 13 are complete'

for HAZARD in cold flood wildfire wind ice drought sea_level permafrost seismic landslide storm_surge water_scarcity; do
  RECORD=$(rpc "$AUTHOR" record_climate_hazard_exposure "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_hazard\":{\"hazard\":\"$HAZARD\",\"future_condition\":\"Supplied $HAZARD scenario through asset life\",\"exposure_statement\":\"Asset exposure is stated by the controlled source\",\"design_response\":\"Engineering response remains subject to human approval\",\"residual_gap\":\"Field confirmation pending\",\"decision_effects\":$EFFECTS,\"evidence_item_id\":\"$EVIDENCE\",\"geospatial_feature_ids\":[\"$FEATURE\"],\"missing_evidence\":[\"Current field confirmation\"]}}"); ok "$RECORD"
done

SELF=$(rpc "$AUTHOR" review_climate_hazard_exposure "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_note\":\"The assessment author cannot perform the independent review.\"}"); err "$SELF" 'author cannot perform the independent review'
AUTHORITY_BEFORE=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')")
REVIEW=$(rpc "$REVIEWER" review_climate_hazard_exposure "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_note\":\"Independent review confirms all thirteen sources, five decision effects and stated limitations.\"}"); ok "$REVIEW"
WORKSPACE=$(rpc "$AUTHOR" get_climate_hazard_exposure_workspace '{}'); ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" ASSESSMENT="$ASSESSMENT" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert len(x['hazards']) == 13
assert x['decision_families'] == ['design','maintenance_interval','spares','emergency_plan','renewal']
a=next(row for row in x['assessments'] if row['id']==os.environ['ASSESSMENT'])
assert a['status']=='reviewed' and len(a['hazards'])==13 and a['missing_hazards']==[]
assert all(set(h['decision_effects']) >= set(x['decision_families']) for h in a['hazards'])
assert 'never fabricates' in x['basis'] and 'approves' in x['basis']
PY
AUTHORITY_AFTER=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')")
test "$AUTHORITY_AFTER" = "$AUTHORITY_BEFORE"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='climate_hazard_exposure' and event_data->>'assessment_id'='$ASSESSMENT'")" = 14
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='climate_hazard_exposure_review' and event_data->>'assessment_id'='$ASSESSMENT'")" = 1

echo 'U15 climate hazard exposure smoke passed: hazards=13 decision_families=5 tenant_wall=true verified_evidence=true independent_review=true historical_concept_contract=true authority_unchanged=true'

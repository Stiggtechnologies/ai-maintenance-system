#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U10 geospatial intelligence smoke FAILED at line $LINENO"' ERR

psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999910'
FOREIGN_ASSET='98100000-0000-0000-0000-000000000002'
EVIDENCE='98100000-0000-0000-0000-000000000021'
RECOMMENDATION='98100000-0000-0000-0000-000000000031'
MATERIAL='98100000-0000-0000-0000-000000000041'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ local code; code="$(status "$1")"; test "$code" = 200 || { echo "expected 200, got $code: $(body "$1")"; return 1; }; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ local code; code="$(status "$1")"; test "$code" = 200 || { echo "expected controlled 200 refusal, got $code: $(body "$1")"; return 1; }; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }
field(){ BODY="$(body "$1")" KEY="$2" python3 -c "import json,os;print(json.loads(os.environ['BODY'])[os.environ['KEY']])"; }

RPCS=$(psqlc "select string_agg(proname,',' order by proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('record_geospatial_feature','verify_geospatial_feature','link_geospatial_subject','record_geospatial_operational_assessment','verify_geospatial_operational_assessment','get_geospatial_operational_workspace')")
test "$RPCS" = 'get_geospatial_operational_workspace,link_geospatial_subject,record_geospatial_feature,record_geospatial_operational_assessment,verify_geospatial_feature,verify_geospatial_operational_assessment'
psqlc "notify pgrst,'reload schema'" >/dev/null

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$AUTHOR" && test -n "$ADMIN"
ASSET=$(psqlc "select id from assets where organization_id='$ORG' order by created_at limit 1")
SITE=$(psqlc "select id from sites where organization_id='$ORG' order by created_at limit 1")
test -n "$ASSET" && test -n "$SITE"
psqlc "insert into organizations(id,name,industry,org_level) values('$OTHER_ORG','U10 foreign','utilities','enterprise') on conflict(id) do nothing"
psqlc "insert into assets(id,organization_id,name) values('$FOREIGN_ASSET','$OTHER_ORG','Foreign mapped asset') on conflict(id) do nothing"
psqlc "insert into recommendations(id,organization_id,asset_id,title,issue,action,impact,status,risk_impact,rationale) values('$RECOMMENDATION','$ORG','$ASSET','Plan verified remote access','Remote access constraints require governed evidence.','Compare feasible access options.','Advisory context only.','pending','Medium','Human route approval and dispatch remain required.') on conflict(id) do nothing"
psqlc "insert into evidence_items(id,organization_id,asset_id,recommendation_id,source_system,evidence_type,description,evidence_class) values('$EVIDENCE','$ORG','$ASSET','$RECOMMENDATION','ci-gis','inspection','Surveyed access alignment and hazard-overlay source package.','DOCUMENTED') on conflict(id) do nothing"
psqlc "insert into materials(id,organization_id,material_code,description,unit_of_measure,is_template,basis) values('$MATERIAL','$ORG','U10-REGIONAL-SPARE','U10 governed regional spare','each',false,'CI canonical material fixture.') on conflict(id) do nothing"
psqlc "insert into material_stock(organization_id,material_id,site_id,qty_on_hand,qty_reserved,qty_on_order,last_counted_at,source_system) values('$ORG','$MATERIAL','$SITE',2,1,1,now(),'ci-inventory') on conflict(material_id,site_id) do update set qty_on_hand=excluded.qty_on_hand,last_counted_at=excluded.last_counted_at"
CREW=$(psqlc "insert into crew_templates(organization_id,template_key,title,description) values('$ORG','u10-remote-crew','U10 remote response crew','CI crew identity only; availability is not inferred.') on conflict(organization_id,template_key) do update set title=excluded.title returning id")
[[ "$CREW" =~ ^[0-9]+$ ]]
VERIFY_EVIDENCE=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent CI review against the surveyed source package\",\"p_outcome\":\"verified\",\"p_note\":\"Coordinate source, alignment reference and evidence ownership confirmed.\"}"); ok "$VERIFY_EVIDENCE"

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_geospatial_operational_workspace" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')
test "$NOAUTH" = 401
NO_SOURCE=$(rpc "$AUTHOR" record_geospatial_feature '{"p_feature":{"feature_type":"access_route","feature_key":"u10-empty","name":"Unsupported line","geometry_type":"LineString","geometry":{"type":"LineString","coordinates":[[-113.5,53.5],[-113.4,53.6]]},"source_system":"gis","source_reference":"draft","observed_at":"2026-09-15T06:00:00Z","data_quality":"good"}}'); err "$NO_SOURCE" 'will not invent coordinates'

ACCESS_RESULT=$(rpc "$AUTHOR" record_geospatial_feature "{\"p_feature\":{\"feature_type\":\"access_route\",\"feature_key\":\"u10-access-main\",\"name\":\"Surveyed north access\",\"geometry_type\":\"LineString\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":[[-113.5,53.5],[-113.4,53.6]]},\"source_system\":\"ci-gis\",\"source_reference\":\"SURVEY-U10-1\",\"observed_at\":\"2026-09-15T06:00:00Z\",\"valid_until\":\"2027-09-15T06:00:00Z\",\"data_quality\":\"good\",\"evidence_item_ids\":[\"$EVIDENCE\"]}}")
ok "$ACCESS_RESULT"; ACCESS=$(field "$ACCESS_RESULT" feature_id)
SELF_FEATURE=$(rpc "$AUTHOR" verify_geospatial_feature "{\"p_feature_id\":\"$ACCESS\",\"p_note\":\"The author cannot independently verify this feature.\"}"); err "$SELF_FEATURE" 'author cannot independently verify'
VERIFY_ACCESS=$(rpc "$ADMIN" verify_geospatial_feature "{\"p_feature_id\":\"$ACCESS\",\"p_note\":\"Independent survey review confirms the source alignment and coordinate reference.\"}"); ok "$VERIFY_ACCESS"

HAZARD_RESULT=$(rpc "$AUTHOR" record_geospatial_feature "{\"p_feature\":{\"feature_type\":\"hazard_zone\",\"feature_key\":\"u10-hazard-zone\",\"name\":\"Supplied flood exposure polygon\",\"geometry_type\":\"Polygon\",\"geometry\":{\"type\":\"Polygon\",\"coordinates\":[[[-113.6,53.4],[-113.3,53.4],[-113.3,53.7],[-113.6,53.4]]]},\"source_system\":\"ci-hazard\",\"source_reference\":\"HAZ-U10-1\",\"observed_at\":\"2026-09-15T06:00:00Z\",\"valid_until\":\"2027-09-15T06:00:00Z\",\"data_quality\":\"good\",\"evidence_item_ids\":[\"$EVIDENCE\"]}}")
ok "$HAZARD_RESULT"; HAZARD=$(field "$HAZARD_RESULT" feature_id)
VERIFY_HAZARD=$(rpc "$ADMIN" verify_geospatial_feature "{\"p_feature_id\":\"$HAZARD\",\"p_note\":\"Independent hazard-source review confirms the supplied polygon and publication version.\"}"); ok "$VERIFY_HAZARD"

FOREIGN_LINK=$(rpc "$AUTHOR" link_geospatial_subject "{\"p_link\":{\"feature_id\":\"$ACCESS\",\"relationship_type\":\"accessible_via\",\"asset_id\":\"$FOREIGN_ASSET\",\"basis\":\"This foreign asset must be refused by the tenant wall.\"}}")
err "$FOREIGN_LINK" 'asset not found'
LINK=$(rpc "$AUTHOR" link_geospatial_subject "{\"p_link\":{\"feature_id\":\"$ACCESS\",\"relationship_type\":\"accessible_via\",\"asset_id\":\"$ASSET\",\"site_id\":\"$SITE\",\"basis\":\"Surveyed route terminates at the canonical site and asset access point.\",\"evidence_item_ids\":[\"$EVIDENCE\"]}}")
ok "$LINK"

AUTHORITY_BEFORE=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')||'|'||(select status from recommendations where id='$RECOMMENDATION')")
AUDIT_BEFORE=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('geospatial_operational_assessment','geospatial_assessment_verification')")
for TYPE in weather_hazard_exposure access_route crew_travel remote_logistics regional_spares failure_clustering hazard_overlay linear_reference; do
  EXTRA=''
  FEATURES="\"$HAZARD\""
  if [[ "$TYPE" =~ ^(access_route|crew_travel|remote_logistics)$ ]]; then EXTRA=",\"access_route_feature_id\":\"$ACCESS\""; FEATURES="\"$ACCESS\""; fi
  if [[ "$TYPE" = crew_travel ]]; then EXTRA="$EXTRA,\"crew_template_id\":\"$CREW\",\"observed_distance\":42,\"distance_unit\":\"km\",\"observed_travel_minutes\":55"; fi
  if [[ "$TYPE" = regional_spares ]]; then EXTRA=",\"material_id\":\"$MATERIAL\",\"stock_site_id\":\"$SITE\""; fi
  RESULT=$(rpc "$AUTHOR" record_geospatial_operational_assessment "{\"p_assessment\":{\"assessment_type\":\"$TYPE\",\"title\":\"U10 $TYPE assessment\",\"asset_id\":\"$ASSET\",\"site_id\":\"$SITE\",\"recommendation_id\":\"$RECOMMENDATION\",\"input_feature_ids\":[$FEATURES],\"evidence_item_ids\":[\"$EVIDENCE\"],\"missing_evidence\":[\"Current field condition confirmation before action\"],\"exposure_rating\":\"high\",\"basis\":\"Supplied surveyed GIS evidence and canonical operational records are compared without inferred values.\",\"conclusion\":\"This bounded decision context requires independent verification and human operational approval.\"$EXTRA}}")
  ok "$RESULT"; ASSESSMENT=$(field "$RESULT" assessment_id)
  if [[ "$TYPE" = weather_hazard_exposure ]]; then
    SELF_ASSESS=$(rpc "$AUTHOR" verify_geospatial_operational_assessment "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_note\":\"The author cannot independently verify this assessment.\"}"); err "$SELF_ASSESS" 'author cannot independently verify'
  fi
  VERIFIED=$(rpc "$ADMIN" verify_geospatial_operational_assessment "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_note\":\"Independent review confirms the source evidence, scope, limitations and stated decision boundary.\"}"); ok "$VERIFIED"
done

MODEL=$(rpc "$AUTHOR" get_geospatial_operational_workspace '{}'); ok "$MODEL"
BODY="$(body "$MODEL")" ACCESS="$ACCESS" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert len(x['feature_types'])==10 and len(x['assessment_types'])==8;assert len([a for a in x['assessments'] if a['title'].startswith('U10 ') and a['status']=='verified'])==8;assert any(f['id']==os.environ['ACCESS'] and f['status']=='verified' for f in x['features']);assert any(s['material_code']=='U10-REGIONAL-SPARE' for s in x['regional_stock']);assert 'never dispatches' in x['basis'].lower()"
AUTHORITY_AFTER=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')||'|'||(select status from recommendations where id='$RECOMMENDATION')")
test "$AUTHORITY_AFTER" = "$AUTHORITY_BEFORE"
AUDIT_AFTER=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('geospatial_operational_assessment','geospatial_assessment_verification')")
test "$AUDIT_AFTER" -eq "$((AUDIT_BEFORE + 16))"
echo 'U10 geospatial intelligence smoke passed: tenant_wall=true gis_features=10 assessment_types=8 linear_reference=true weather_hazard=true access_routes=true crew_travel=true remote_logistics=true regional_spares=true failure_clustering=true hazard_overlays=true independent_review=true authority_unchanged=true'

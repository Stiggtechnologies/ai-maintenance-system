#!/usr/bin/env bash
set -euo pipefail
# Do not interpolate BASH_COMMAND: quoted curl/psql lines make the trap itself fail
# and swallow the real error (that is why CI showed only supabase status stderr).
trap 'echo "U13 service-contract risk smoke FAILED at line $LINENO"' ERR

psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c "$1"
}

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
echo "U13 smoke: supabase env loaded api=${API_URL}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999913'
FOREIGN_ASSET='98130000-0000-0000-0000-000000000002'
EVIDENCE='98130000-0000-0000-0000-000000000021'
RECOMMENDATION='98130000-0000-0000-0000-000000000031'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){
  local code
  code="$(status "$1")"
  test "$code" = 200 || { echo "expected HTTP 200, got ${code}: $(body "$1")"; return 1; }
  BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"
}
err(){
  local code
  code="$(status "$1")"
  test "$code" = 200 || { echo "expected controlled HTTP 200 refusal, got ${code}: $(body "$1")"; return 1; }
  BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"
}

RPCS=$(psqlc "select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('record_service_contract_obligation','adopt_service_contract_obligation','create_service_contract_obligation_version','record_recommendation_contract_risk','verify_recommendation_contract_risk','get_service_contract_risk_workspace')")
echo "U13 smoke: catalog RPCs=${RPCS}"
test "$RPCS" = 'adopt_service_contract_obligation,create_service_contract_obligation_version,get_service_contract_risk_workspace,record_recommendation_contract_risk,record_service_contract_obligation,verify_recommendation_contract_risk'
psqlc "notify pgrst, 'reload schema'" >/dev/null

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$AUTHOR" || { echo 'demo author authentication failed'; exit 1; }
test -n "$ADMIN" || { echo 'administrator authentication failed'; exit 1; }
echo 'U13 smoke: authentication passed'

ASSET=$(psqlc "select id from assets where organization_id='$ORG' order by created_at limit 1")
test -n "$ASSET" || { echo 'demo organization has no asset'; exit 1; }
AUDIT_BEFORE=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('service_contract_obligation','service_contract_obligation_adoption','recommendation_contract_risk','recommendation_contract_risk_verification')")

psqlc "insert into organizations(id,name,industry,org_level) values('$OTHER_ORG','U13 foreign','transportation','enterprise') on conflict(id) do nothing"
psqlc "insert into assets(id,organization_id,name) values('$FOREIGN_ASSET','$OTHER_ORG','Foreign service asset') on conflict(id) do nothing"
psqlc "insert into asset_service_levels(asset_id,organization_id,service_name,beneficiary,tolerable_downtime_hours,consequence_class,restoration_rank,notes) values('$ASSET','$ORG','Process water availability','Operating plant',4,'production',1,'Contracted availability basis for U13 acceptance.') on conflict(asset_id) do update set service_name=excluded.service_name"
SUPPLIER=$(psqlc "insert into suppliers(organization_id,supplier_code,name,supplier_kind,approved_vendor) values('$ORG','U13-OEM','U13 Service OEM','service_contractor',true) on conflict (organization_id,supplier_code) do update set name=excluded.name returning id")
CONTRACT=$(psqlc "insert into contract_packages(organization_id,package_code,title,scope_of_work,acceptance_criteria,site_conditions_stated,awarded_supplier_id,awarded_value) values('$ORG','U13-SLA','Availability service agreement','Maintain process-water service.','Monthly measured availability.',true,$SUPPLIER,250000) on conflict (organization_id,package_code) do update set awarded_supplier_id=excluded.awarded_supplier_id,awarded_value=excluded.awarded_value returning id")
WARRANTY=$(psqlc "insert into warranty_terms(organization_id,asset_id,supplier_id,starts_on,ends_on,covers,exclusions,claim_window_days) values('$ORG','$ASSET',$SUPPLIER,'2026-01-01','2028-12-31','Covered failures under service agreement.','Unauthorized modifications.',30) returning id")
psqlc "insert into recommendations(id,organization_id,asset_id,title,issue,action,impact,status,risk_impact,rationale) values('$RECOMMENDATION','$ORG','$ASSET','Adjust process-water maintenance interval','Current interval may conflict with availability commitment.','Evaluate a governed interval change.','Potential contractual exposure if service is interrupted.','pending','Medium','Human decision remains required.') on conflict(id) do nothing"
psqlc "insert into evidence_items(id,organization_id,asset_id,recommendation_id,source_system,evidence_type,description,evidence_class) values('$EVIDENCE','$ORG','$ASSET','$RECOMMENDATION','ci','contract','Executed U13 service agreement with monthly availability schedule.','DOCUMENTED') on conflict(id) do nothing"
test -n "$SUPPLIER" && test -n "$CONTRACT" && test -n "$WARRANTY"
echo "U13 smoke: fixtures ready asset=${ASSET} supplier=${SUPPLIER} contract=${CONTRACT} warranty=${WARRANTY}"

AUTHORITY_BEFORE=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')||'|'||(select status from recommendations where id='$RECOMMENDATION')")

VERIFY_EVIDENCE=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent CI review of executed service agreement\",\"p_outcome\":\"verified\",\"p_note\":\"Source and monthly availability schedule confirmed.\"}")
ok "$VERIFY_EVIDENCE"
NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_service_contract_risk_workspace" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')
echo "U13 smoke: anonymous workspace HTTP ${NOAUTH}"
test "$NOAUTH" = 401
echo 'U13 smoke: evidence verified and anonymous boundary passed'

NO_TARGET=$(rpc "$AUTHOR" record_service_contract_obligation "{\"p_obligation\":{\"service_commitment_type\":\"availability_guarantee\",\"source_type\":\"contract\",\"source_reference\":\"U13-SLA\",\"requirement\":\"Monthly availability must meet the executed agreement.\",\"applicable_scope\":\"Process-water service\",\"responsible_role\":\"maintenance_manager\",\"measurement_basis\":\"Monthly historian service-availability calculation under the executed schedule.\"}}")
err "$NO_TARGET" 'will not invent one'
FOREIGN=$(rpc "$AUTHOR" record_service_contract_obligation "{\"p_obligation\":{\"service_commitment_type\":\"availability_guarantee\",\"source_type\":\"contract\",\"source_reference\":\"U13-SLA\",\"requirement\":\"Foreign asset linkage must be refused by the tenant wall.\",\"applicable_scope\":\"Foreign service\",\"responsible_role\":\"maintenance_manager\",\"measurement_basis\":\"Monthly availability calculated from independently verified historian evidence.\",\"asset_id\":\"$FOREIGN_ASSET\",\"target_value\":99.5,\"target_unit\":\"percent\"}}")
err "$FOREIGN" 'asset not found'
OBLIGATION_RESULT=$(rpc "$AUTHOR" record_service_contract_obligation "{\"p_obligation\":{\"service_commitment_type\":\"availability_guarantee\",\"source_type\":\"contract\",\"source_reference\":\"U13-SLA\",\"requirement\":\"Process-water service availability shall be at least 99.5 percent each calendar month.\",\"applicable_scope\":\"Process-water service for the operating plant\",\"responsible_role\":\"maintenance_manager\",\"measurement_basis\":\"Monthly historian service-availability calculation excluding only contractually stated exclusions.\",\"asset_id\":\"$ASSET\",\"service_level_asset_id\":\"$ASSET\",\"contract_package_id\":\"$CONTRACT\",\"supplier_id\":\"$SUPPLIER\",\"warranty_term_id\":\"$WARRANTY\",\"metric_name\":\"service_availability\",\"target_value\":99.5,\"target_unit\":\"percent\",\"measurement_window\":\"calendar_month\",\"remedy\":\"Service credit and corrective action under the executed agreement.\",\"penalty_value\":25000,\"incentive_value\":5000,\"commercial_currency\":\"CAD\",\"evidence_item_ids\":[\"$EVIDENCE\"]}}")
ok "$OBLIGATION_RESULT"
OBLIGATION=$(BODY="$(body "$OBLIGATION_RESULT")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['obligation_id'])")
SELF_ADOPT=$(rpc "$AUTHOR" adopt_service_contract_obligation "{\"p_obligation_id\":\"$OBLIGATION\",\"p_note\":\"The author must not adopt the same contractual obligation.\"}")
err "$SELF_ADOPT" 'author cannot independently adopt'
ADOPT=$(rpc "$ADMIN" adopt_service_contract_obligation "{\"p_obligation_id\":\"$OBLIGATION\",\"p_note\":\"Independent review confirms the executed source, target, calculation basis and commercial consequences.\"}")
ok "$ADOPT"
VERSION_RESULT=$(rpc "$AUTHOR" create_service_contract_obligation_version "{\"p_obligation_id\":\"$OBLIGATION\",\"p_changes\":{\"source_reference\":\"U13-SLA-DRAFT-V2\",\"target_value\":99.6},\"p_reason\":\"Supplier proposed a revised target; preserve the adopted obligation until independent adoption.\"}")
ok "$VERSION_RESULT"
BODY="$(body "$VERSION_RESULT")" OBLIGATION="$OBLIGATION" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['status']=='draft' and x['version']==2 and x['supersedes_id']==os.environ['OBLIGATION']"

NO_BASIS=$(rpc "$AUTHOR" record_recommendation_contract_risk "{\"p_assessment\":{\"recommendation_id\":\"$RECOMMENDATION\",\"obligation_id\":\"$OBLIGATION\",\"breach_state\":\"unknown\",\"risk_rating\":\"unknown\",\"exposure_basis\":\"Too short\"}}")
err "$NO_BASIS" 'exposure basis'
ASSESSMENT_RESULT=$(rpc "$AUTHOR" record_recommendation_contract_risk "{\"p_assessment\":{\"recommendation_id\":\"$RECOMMENDATION\",\"obligation_id\":\"$OBLIGATION\",\"breach_state\":\"at_risk\",\"risk_rating\":\"high\",\"exposure_basis\":\"The proposed maintenance interval may consume the monthly downtime allowance; current outage duration evidence is incomplete.\",\"evidence_item_ids\":[\"$EVIDENCE\"],\"missing_evidence\":[\"Approved outage duration and contractual exclusion determination\"]}}")
ok "$ASSESSMENT_RESULT"
ASSESSMENT=$(BODY="$(body "$ASSESSMENT_RESULT")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['assessment_id'])")
SELF_VERIFY=$(rpc "$AUTHOR" verify_recommendation_contract_risk "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_note\":\"The author must not independently verify the same exposure.\"}")
err "$SELF_VERIFY" 'author cannot independently verify'
VERIFY=$(rpc "$ADMIN" verify_recommendation_contract_risk "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_note\":\"Independent review confirms the cited obligation and preserves the named evidence gap.\"}")
ok "$VERIFY"

MODEL=$(rpc "$AUTHOR" get_service_contract_risk_workspace '{}')
ok "$MODEL"
BODY="$(body "$MODEL")" OBLIGATION="$OBLIGATION" ASSESSMENT="$ASSESSMENT" python3 -c "import json,os;x=json.loads(os.environ['BODY']);o=next(i for i in x['obligations'] if i['id']==os.environ['OBLIGATION']);a=next(i for i in x['assessments'] if i['id']==os.environ['ASSESSMENT']);assert len(x['commitment_types'])==9;assert o['status']=='adopted' and o['target_value']==99.5 and o['penalty_value']==25000 and o['incentive_value']==5000;assert a['status']=='verified' and a['breach_state']=='at_risk' and a['risk_rating']=='high';assert len(a['missing_evidence'])==1;assert 'never approves' in x['basis'].lower()"
AUTHORITY_AFTER=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')||'|'||(select status from recommendations where id='$RECOMMENDATION')")
test "$AUTHORITY_AFTER" = "$AUTHORITY_BEFORE"
AUDIT_AFTER=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('service_contract_obligation','service_contract_obligation_adoption','recommendation_contract_risk','recommendation_contract_risk_verification')")
test "$AUDIT_AFTER" -eq "$((AUDIT_BEFORE + 5))"
echo 'U13 service-contract risk smoke passed: tenant_wall=true types=9 target_not_invented=true verified_evidence=true independent_review=true versioned=true recommendation_authority_unchanged=true'

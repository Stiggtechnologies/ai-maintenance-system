#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D12.05 project-start knowledge smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999925'
SOURCE_CASE='98550000-0000-4000-8000-000000000001'
TARGET_CASE='98550000-0000-4000-8000-000000000002'
EMPTY_CASE='98550000-0000-4000-8000-000000000003'
FOREIGN_CASE='98559999-0000-4000-8000-000000000001'
EVIDENCE='98551000-0000-4000-8000-000000000001'
SUPPLIER=9855001
PACKAGE=9855001

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
ok(){ test "${1##*$'\n'}" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "${1##*$'\n'}" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'].lower() in x.get('error','').lower(),x"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }

RECORDER=$(token 'admin@syncai.ca' 'Admin123!@#')
VERIFIER=$(token 'demo@syncai.ca' 'Demo123!@#')
RECORDER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
test -n "$RECORDER" && test -n "$VERIFIER" && test -n "$RECORDER_ID"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','D12.05 foreign tenant','utilities') on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,created_by) values
('$SOURCE_CASE','$ORG','Completed compressor modernization','brownfield','Completed brownfield project retained for governed project-start retrieval.','completed','$RECORDER_ID'),
('$TARGET_CASE','$ORG','New compressor modernization','brownfield','Retrieve applicable evidence before committing the first engineering dollar.','active','$RECORDER_ID'),
('$EMPTY_CASE','$ORG','Capacity project with no comparables','capacity','Expose honest empty states instead of fabricating project-start confidence.','active','$RECORDER_ID'),
('$FOREIGN_CASE','$OTHER_ORG','Foreign brownfield project','brownfield','This project must never be visible outside its own tenant.','active',null)
on conflict(id) do nothing;
insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class)
values('$EVIDENCE','$ORG','ci','document','Independently checked completed-project cost and duration outcome.','DOCUMENTED')
on conflict(id) do nothing;
insert into suppliers(id,organization_id,supplier_code,name,supplier_kind,approved_vendor)
values($SUPPLIER,'$ORG','D1205-MEASURED','Measured Fabrication Ltd.','service_contractor',true)
on conflict(id) do nothing;
insert into contract_packages(id,organization_id,package_code,title,development_case_id,awarded_supplier_id)
values($PACKAGE,'$ORG','D1205-PKG','Measured compressor package','$SOURCE_CASE',$SUPPLIER)
on conflict(id) do nothing;
insert into contract_performance(organization_id,package_id,supplier_id,period_start,period_end,planned_hours,actual_hours,rework_events,safety_incidents,quality_escapes,note)
select '$ORG',$PACKAGE,$SUPPLIER,date '2026-01-01',date '2026-03-31',1000,1080,1,0,0,'Measured completed-project vendor period.'
where not exists(select 1 from contract_performance where package_id=$PACKAGE and supplier_id=$SUPPLIER);
SQL

VERIFIED=$(rpc "$VERIFIER" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent project closeout review\",\"p_outcome\":\"verified\",\"p_note\":\"Cost, duration and completion evidence independently checked for D12.05 acceptance.\"}")
ok "$VERIFIED"

BASIS=$(rpc "$RECORDER" record_estimate_basis "{\"p_case_id\":\"$SOURCE_CASE\",\"p_basis\":{\"estimate_class\":\"class_3\",\"scope_maturity\":\"feed\",\"quantity_based_percent\":\"75\",\"quotation_support\":\"budgetary\",\"supporting_quotation_count\":\"2\",\"escalation_basis\":\"Published regional construction index\",\"productivity_basis\":\"Measured brownfield crew performance\",\"exclusions\":\"Owner operations labour excluded\",\"contingency_basis\":\"Quantified project risk review\"}}")
ok "$BASIS"

OUTCOME=$(rpc "$RECORDER" record_verified_project_outcome "{\"p_case_id\":\"$SOURCE_CASE\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_outcome\":{\"baselineCost\":1000000,\"actualCost\":1120000,\"baselineDurationDays\":90,\"actualDurationDays\":103,\"currency\":\"CAD\",\"complexityRating\":3,\"geography\":\"Alberta\",\"technologyNoveltyRating\":2,\"executionStrategy\":\"EPCM\",\"engineeringMaturityAtExecutionPct\":75,\"unresolvedVendorDataAtGate\":1,\"commissioningDefects\":2,\"startupDelayDays\":4,\"safetyIncidentRate\":0,\"startupReliabilityPct\":94,\"engineeringHours\":8000}}")
ok "$OUTCOME"

LESSON=$(rpc "$RECORDER" record_project_lesson "{\"p_case_id\":\"$SOURCE_CASE\",\"p_failure_mode_key\":\"project_delivery.startup_failure\",\"p_title\":\"Seal failure at first start\",\"p_cause\":\"Commissioning flush acceptance was incomplete.\",\"p_corrective_action\":\"Require witnessed flush acceptance before first start.\",\"p_applicability\":\"Brownfield rotating-equipment projects and compressor startups.\",\"p_detail\":\"Verified during completed-project closeout.\"}")
ok "$LESSON"

BEFORE=$(psqlc "select (select count(*) from learning_events where organization_id='$ORG')||'|'||(select count(*) from audit_events where organization_id='$ORG')")
RESULT=$(rpc "$RECORDER" get_project_start_knowledge "{\"p_case_id\":\"$TARGET_CASE\"}")
ok "$RESULT"
BODY="$(body "$RESULT")" SOURCE_CASE="$SOURCE_CASE" EVIDENCE="$EVIDENCE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['caseId'] and x['lessons']['count']>=1,x
e=next(i for i in x['historicalEstimates']['items'] if i['sourceCaseId']==os.environ['SOURCE_CASE'])
assert e['outcomeEvidenceItemId']==os.environ['EVIDENCE'] and e['estimateBasisId'],x
v=next(i for i in x['vendorPerformance']['items'] if i['supplier']=='Measured Fabrication Ltd.')
assert v['record']['answered'] is True and v['record']['periods']==1 and v['performancePeriodIds'],x
s=next(i for i in x['startupProblems']['items'] if i['title']=='Seal failure at first start')
assert s['sourceCaseId']==os.environ['SOURCE_CASE'],x
assert x['recommendationOnly'] is True and x['authorization'] is False,x
assert 'does not approve' in x['decisionBoundary'].lower() and 'no score' in x['method'].lower(),x
PY
AFTER=$(psqlc "select (select count(*) from learning_events where organization_id='$ORG')||'|'||(select count(*) from audit_events where organization_id='$ORG')")
test "$BEFORE" = "$AFTER"

EMPTY=$(rpc "$RECORDER" get_project_start_knowledge "{\"p_case_id\":\"$EMPTY_CASE\"}")
ok "$EMPTY"
BODY="$(body "$EMPTY")" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
for family in ('historicalEstimates','vendorPerformance','startupProblems'):
    assert x[family]['count']==0 and x[family]['items']==[] and x[family]['emptyReason'],x
assert 'not proof' in x['startupProblems']['emptyReason'].lower(),x
assert 'absence is not acceptable performance' in x['vendorPerformance']['emptyReason'].lower(),x
PY

FOREIGN=$(rpc "$RECORDER" get_project_start_knowledge "{\"p_case_id\":\"$FOREIGN_CASE\"}")
err "$FOREIGN" 'development case not found'

echo 'D12.05 project-start knowledge smoke passed: four_families=true verified_outcome_only=true measured_vendor_only=true startup_failure=true empty_states=true tenant_wall=true read_only=true human_final=true'

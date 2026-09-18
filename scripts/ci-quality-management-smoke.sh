#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Quality management smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"
: "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
EVIDENCE='7d000000-0000-4000-8000-000000000001'
WORK_ORDER='7d000000-0000-4000-8000-000000000002'
CASE_ID='7d000000-0000-4000-8000-000000000005'
WBS_ID='7d000000-0000-4000-8000-000000000006'
BASELINE_ID='7d000000-0000-4000-8000-000000000007'

token(){ local response; response=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and x.get('error'):
    print('unexpected quality error:',x); sys.exit(1)
PY
}
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; print(json.loads(os.environ['BODY']).get(os.environ['KEY'],''))"; }
expect_error(){ BODY="$1" NEEDLE="$2" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if os.environ['NEEDLE'] not in x.get('error',''):
    print('expected quality refusal was absent:',x); sys.exit(1)
PY
}

DEMO=$(token 'demo@syncai.ca' 'Demo123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$DEMO"; test -n "$ADMIN"

PROJECT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
delete from development_cases where id='$CASE_ID';
delete from evidence_items where id='$EVIDENCE';
delete from work_orders where id='$WORK_ORDER';
delete from capital_projects where organization_id='$ORG' and project_code='Q7D-CI';
insert into evidence_items(id,organization_id,source_system,evidence_type,description,data_quality)
values('$EVIDENCE','$ORG','CI controlled inspection','inspection','Slice 7D controlled quality evidence','good');
insert into work_orders(id,organization_id,wo_number,title,status,type)
values('$WORK_ORDER','$ORG','Q7D-RWK-1','CI governed rework order','in_progress','human_created');
insert into capital_projects(organization_id,project_code,title,status)
values('$ORG','Q7D-CI','Slice 7D quality acceptance','active') returning id;
SQL
)
test -n "$PROJECT"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,capital_project_id,created_by)
values('$CASE_ID','$ORG','Slice 7D COPQ attribution','brownfield','Quality-driven forecast growth must be distinguished from authorized scope growth.',$PROJECT,'00000000-0000-0000-0000-000000000001');
insert into project_wbs_elements(id,organization_id,development_case_id,wbs_code,title,scope_description,created_by)
values('$WBS_ID','$ORG','$CASE_ID','Q7D','Quality work','Controlled work used by the COPQ attribution smoke.','00000000-0000-0000-0000-000000000001');
insert into development_baselines(id,organization_id,development_case_id,baseline_type,version,status,description,created_by)
values('$BASELINE_ID','$ORG','$CASE_ID','SCOPE',1,'draft','Approved scope reference for quality attribution.','00000000-0000-0000-0000-000000000001');
begin;
select set_config('app.baseline_write','granted',true);
update development_baselines set status='approved',approved_by='00000000-0000-0000-0000-000000000006',approved_at='2026-08-31T12:00:00Z',approval_note='Independent approval for the controlled COPQ attribution smoke.' where id='$BASELINE_ID';
commit;
begin;
select set_config('app.scope_change_write','granted',true);
insert into project_scope_changes(organization_id,development_case_id,baseline_id,change_ref,wbs_element_id,description,origin,added_at,cost_effect,cost_basis,currency,recorded_by)
values('$ORG','$CASE_ID','$BASELINE_ID','Q7D-SCOPE-1','$WBS_ID','Authorized scope addition used as the comparison side of the forecast split.','owner_request','2026-09-03T12:00:00Z',220,'Approved scope estimate basis','CAD','00000000-0000-0000-0000-000000000001');
commit;
SQL
DESIGN=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into design_requirements(organization_id, project_id, requirement_ref, category, requirement, source)
values('$ORG', $PROJECT, 'Q7D-DR-1', 'quality', 'Dimensional acceptance shall be controlled against the approved drawing.', 'engineering')
on conflict (organization_id, requirement_ref)
do update set project_id = excluded.project_id
returning id;
SQL
)
test -n "$DESIGN"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry)
values('7d000000-0000-4000-8000-000000000003','Slice 7D foreign tenant','manufacturing');
insert into assets(id,organization_id,name)
values('7d000000-0000-4000-8000-000000000004','7d000000-0000-4000-8000-000000000003','Foreign tenant asset');
SQL

CROSS=$(rpc "$DEMO" record_quality_requirement '{"p_record":{"requirementRef":"Q7D-CROSS","title":"Cross tenant attempt","requirementText":"This requirement must never cross the tenant boundary.","sourceKind":"design","sourceReference":"Q7D-CROSS-SOURCE","acceptanceCriterion":"Controlled value remains within the approved limit.","verificationMethod":"measurement","severity":"major","assetId":"7d000000-0000-4000-8000-000000000004"}}')
expect_error "$CROSS" 'outside this organization'

UNBOUND=$(rpc "$DEMO" record_quality_requirement '{"p_record":{"requirementRef":"Q7D-UNBOUND","title":"Unbound quality row","requirementText":"A quality requirement with no design_requirements parent is a parallel store.","sourceKind":"design","sourceReference":"Q7D-UNBOUND-SOURCE","acceptanceCriterion":"Must never persist without a §10 binding.","verificationMethod":"measurement","severity":"major"}}')
expect_error "$UNBOUND" 'ONE project requirement table'

REQ_PAYLOAD=$(PROJECT="$PROJECT" DESIGN="$DESIGN" python3 - <<'PY'
import json,os
print(json.dumps({'p_record':{'requirementRef':'Q7D-QR-1','title':'Controlled dimensional acceptance','requirementText':'Completed item shall meet every controlled drawing dimension.','sourceKind':'design','sourceReference':'Q7D-DWG-1 revision C','acceptanceCriterion':'All controlled dimensions are within drawing tolerance.','verificationMethod':'measurement','severity':'major','projectId':int(os.environ['PROJECT']),'designRequirementId':int(os.environ['DESIGN'])}}))
PY
)
REQ_RESULT=$(rpc "$DEMO" record_quality_requirement "$REQ_PAYLOAD"); noerr "$REQ_RESULT"
REQ_ID=$(field "$REQ_RESULT" id); test -n "$REQ_ID"

SELF=$(rpc "$DEMO" approve_quality_requirement "{\"p_id\":$REQ_ID,\"p_note\":\"Author attempts their own independent requirement approval.\"}")
expect_error "$SELF" 'independent requirement approval'
APPROVED=$(rpc "$ADMIN" approve_quality_requirement "{\"p_id\":$REQ_ID,\"p_note\":\"Source and measurable acceptance criterion independently verified.\"}"); noerr "$APPROVED"

ITP_PAYLOAD=$(PROJECT="$PROJECT" REQ_ID="$REQ_ID" python3 - <<'PY'
import json,os
print(json.dumps({'p_record':{'itpRef':'Q7D-ITP-1','title':'CI fabrication ITP','revision':'A','scope':'Fabrication through final release','procedureReference':'Q7D-QP-1 revision A','projectId':int(os.environ['PROJECT']),'points':[{'sequenceNo':10,'requirementId':int(os.environ['REQ_ID']),'controlType':'hold','activity':'Final dimensional inspection','acceptanceCriterion':'All controlled dimensions are within drawing tolerance.','inspectorRole':'reliability_engineer','witnessRole':'admin'}]}}))
PY
)
ITP_RESULT=$(rpc "$DEMO" record_quality_itp "$ITP_PAYLOAD"); noerr "$ITP_RESULT"
ITP_ID=$(field "$ITP_RESULT" id); test -n "$ITP_ID"
ITP_APPROVED=$(rpc "$ADMIN" approve_quality_itp "{\"p_id\":$ITP_ID,\"p_note\":\"Every point, criterion, role and requirement independently reviewed.\"}"); noerr "$ITP_APPROVED"
POINT_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "select id from quality_itp_points where itp_id=$ITP_ID and sequence_no=10;")

WRONG_INSPECTOR=$(rpc "$ADMIN" record_quality_itp_point_result "{\"p_point_id\":$POINT_ID,\"p_result\":\"pass\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_note\":\"Unassigned role attempts this controlled inspection.\"}")
expect_error "$WRONG_INSPECTOR" 'requires assigned role reliability_engineer'
INSPECTED=$(rpc "$DEMO" record_quality_itp_point_result "{\"p_point_id\":$POINT_ID,\"p_result\":\"pass\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_note\":\"Measured result checked against controlled criterion.\"}"); noerr "$INSPECTED"
test "$(field "$INSPECTED" status)" = 'awaiting_release'
SELF_HOLD=$(rpc "$DEMO" release_quality_itp_point "{\"p_point_id\":$POINT_ID,\"p_decision\":\"release\",\"p_witness_attested\":true,\"p_note\":\"Author attempts release of their own hold-point inspection.\"}")
expect_error "$SELF_HOLD" 'independent actor'
HOLD=$(rpc "$ADMIN" release_quality_itp_point "{\"p_point_id\":$POINT_ID,\"p_decision\":\"release\",\"p_witness_attested\":true,\"p_note\":\"Evidence and acceptance result independently checked before release.\"}"); noerr "$HOLD"

NCR_PAYLOAD=$(PROJECT="$PROJECT" REQ_ID="$REQ_ID" python3 - <<'PY'
import json,os
print(json.dumps({'p_record':{'ncrRef':'Q7D-NCR-1','requirementId':int(os.environ['REQ_ID']),'projectId':int(os.environ['PROJECT']),'title':'Controlled dimension out of tolerance','description':'Measured result exceeded the approved upper tolerance.','severity':'major','detectedAt':'2026-09-01T12:00:00Z','dueAt':'2026-09-10T12:00:00Z'}}))
PY
)
NCR_RESULT=$(rpc "$DEMO" record_quality_ncr "$NCR_PAYLOAD"); noerr "$NCR_RESULT"
NCR_ID=$(field "$NCR_RESULT" id); test -n "$NCR_ID"
for TRANSITION in contain disposition correct verify; do
  case "$TRANSITION" in
    contain) DETAIL='{"containmentAction":"Affected units segregated and processing stopped."}' ;;
    disposition) DETAIL='{"disposition":"rework","dispositionBasis":"Approved engineering disposition Q7D-DISP-1."}' ;;
    correct) DETAIL='{"rootCause":"Fixture datum was not reset after changeover.","correctiveAction":"Reset datum and add independent setup verification."}' ;;
    verify) DETAIL='{"effectivenessCriterion":"Three consecutive lots pass the controlled dimensional check."}' ;;
  esac
  RESULT=$(rpc "$DEMO" transition_quality_ncr "{\"p_id\":$NCR_ID,\"p_transition\":\"$TRANSITION\",\"p_detail\":$DETAIL}"); noerr "$RESULT"
done
SELF_CLOSE=$(rpc "$DEMO" transition_quality_ncr "{\"p_id\":$NCR_ID,\"p_transition\":\"close\",\"p_detail\":{\"evidenceItemId\":\"$EVIDENCE\",\"note\":\"Author attempts to close the NCR against their own evidence review.\"}}")
expect_error "$SELF_CLOSE" 'independent NCR closure'
CLOSED=$(rpc "$ADMIN" transition_quality_ncr "{\"p_id\":$NCR_ID,\"p_transition\":\"close\",\"p_detail\":{\"evidenceItemId\":\"$EVIDENCE\",\"note\":\"Effectiveness result and closure evidence independently reviewed.\"}}")
noerr "$CLOSED"

DEFECT_PAYLOAD=$(PROJECT="$PROJECT" REQ_ID="$REQ_ID" NCR_ID="$NCR_ID" python3 - <<'PY'
import json,os
print(json.dumps({'p_record':{'defectRef':'Q7D-DEF-1','ncrId':int(os.environ['NCR_ID']),'requirementId':int(os.environ['REQ_ID']),'projectId':int(os.environ['PROJECT']),'sourceKind':'in_process','defectCode':'DIMENSIONAL','description':'Controlled dimension above upper limit.','detectedAt':'2026-09-01T12:00:00Z','inspectedQuantity':100,'defectiveQuantity':4,'firstPassAcceptedQuantity':96,'reworkedQuantity':3,'scrappedQuantity':1,'repeatDefect':False,'scrapCost':250,'currency':'CAD','costSource':'Approved material standard cost','evidenceItemId':'7d000000-0000-4000-8000-000000000001'}}))
PY
)
DEFECT_RESULT=$(rpc "$DEMO" record_quality_defect "$DEFECT_PAYLOAD"); noerr "$DEFECT_RESULT"
DEFECT_ID=$(field "$DEFECT_RESULT" id); test -n "$DEFECT_ID"

REWORK_PAYLOAD=$(DEFECT_ID="$DEFECT_ID" python3 - <<'PY'
import json,os
print(json.dumps({'p_record':{'defectId':int(os.environ['DEFECT_ID']),'workOrderId':'7d000000-0000-4000-8000-000000000002','startedAt':'2026-09-02T12:00:00Z','completedAt':'2026-09-03T12:00:00Z','reworkedQuantity':3,'acceptedQuantity':3,'labourCost':300,'materialCost':150,'equipmentCost':75,'downtimeCost':600,'externalCost':0,'currency':'CAD','costBasis':'Actual time and issued materials','costSource':'ERP work-order actuals','evidenceItemId':'7d000000-0000-4000-8000-000000000001'}}))
PY
)
REWORK=$(rpc "$DEMO" record_quality_rework "$REWORK_PAYLOAD"); noerr "$REWORK"

TEST_PAYLOAD=$(PROJECT="$PROJECT" REQ_ID="$REQ_ID" ITP_ID="$ITP_ID" python3 - <<'PY'
import json,os
print(json.dumps({'p_record':{'projectId':int(os.environ['PROJECT']),'requirementId':int(os.environ['REQ_ID']),'itpId':int(os.environ['ITP_ID']),'testRef':'Q7D-FAT-1','testStage':'factory_acceptance','scheduledOn':'2026-09-04','performedOn':'2026-09-04','outcome':'pass','punchItemsRaised':0,'punchItemsOpen':0,'witnessedByOwner':True,'acceptanceCriteria':'Every controlled test step passes with no open punch items.','testProcedureReference':'Q7D-FAT-PROC-1 revision B','testedSamples':10,'passedSamples':10,'evidenceItemId':'7d000000-0000-4000-8000-000000000001'}}))
PY
)
TEST_RESULT=$(rpc "$DEMO" record_quality_acceptance_test "$TEST_PAYLOAD"); noerr "$TEST_RESULT"
TEST_ID=$(field "$TEST_RESULT" id); test -n "$TEST_ID"
SELF_RELEASE=$(rpc "$DEMO" release_quality_acceptance_test "{\"p_id\":$TEST_ID,\"p_decision\":\"release\",\"p_note\":\"Performer attempts independent release of their own test record.\"}")
expect_error "$SELF_RELEASE" 'independent acceptance release'
TEST_RELEASE=$(rpc "$ADMIN" release_quality_acceptance_test "{\"p_id\":$TEST_ID,\"p_decision\":\"release\",\"p_note\":\"Pass result, evidence and zero punch items independently verified.\"}"); noerr "$TEST_RELEASE"

COST=$(rpc "$DEMO" record_quality_cost "{\"p_record\":{\"ncrId\":$NCR_ID,\"developmentCaseId\":\"$CASE_ID\",\"incurredAt\":\"2026-09-04T12:00:00Z\",\"category\":\"external_failure\",\"copqTerm\":\"claims\",\"amount\":500,\"currency\":\"CAD\",\"costType\":\"Customer field correction\",\"sourceReference\":\"Approved invoice Q7D-INV-1\",\"evidenceItemId\":\"$EVIDENCE\",\"forecastGrowthAmount\":780,\"forecastGrowthBasis\":\"Current approved project cost forecast\"}}")
noerr "$COST"

MISSING_TERM=$(rpc "$DEMO" record_quality_cost "{\"p_record\":{\"incurredAt\":\"2026-09-04T12:00:00Z\",\"category\":\"internal_failure\",\"amount\":10,\"currency\":\"CAD\",\"costType\":\"Unclassified failure\",\"sourceReference\":\"Controlled refusal fixture\"}}")
expect_error "$MISSING_TERM" 'requires one COPQ term'
PREVENTION_FORECAST=$(rpc "$DEMO" record_quality_cost "{\"p_record\":{\"developmentCaseId\":\"$CASE_ID\",\"incurredAt\":\"2026-09-04T12:00:00Z\",\"category\":\"prevention\",\"amount\":10,\"currency\":\"CAD\",\"costType\":\"Quality planning\",\"sourceReference\":\"Controlled refusal fixture\",\"forecastGrowthAmount\":10,\"forecastGrowthBasis\":\"Current approved project cost forecast\"}}")
expect_error "$PREVENTION_FORECAST" 'requires an internal or external failure cost'

COCKPIT=$(rpc "$DEMO" get_quality_cockpit '{"p_from":"2026-09-01T00:00:00Z","p_to":"2026-10-01T00:00:00Z"}')
noerr "$COCKPIT"
BODY="$COCKPIT" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
values={m['key']:float(m['value']) for m in x['metrics'] if m['value'] is not None}
expected={'first_pass_yield_pct':96,'defect_rate_pct':4,'rework_rate_pct':3,'scrap_rate_pct':1,'acceptance_pass_rate_pct':100,'ncr_closure_rate_pct':100}
if any(values.get(k)!=v for k,v in expected.items()): print('wrong metrics',values); sys.exit(1)
cad=next(c for c in x['costByCurrency'] if c['currency']=='CAD')
if float(cad['costOfPoorQuality']) != 1875: print('wrong COPQ',cad); sys.exit(1)
if cad['copqByTerm'] != {'rework':1125,'scrap':250,'retesting':0,'delay':0,'claims':500,'startup_failures':0}: print('wrong six-term attribution',cad); sys.exit(1)
forecast=next(f for f in x['forecastAttribution'] if f['developmentCaseId']=='7d000000-0000-4000-8000-000000000005' and f['currency']=='CAD')
if float(forecast['qualityFailureGrowth']) != 780 or float(forecast['scopeGrowth']) != 220 or float(forecast['qualitySharePct']) != 78: print('wrong forecast split',forecast); sys.exit(1)
if len(x['metrics']) != 7: print('wrong metric count',x['metrics']); sys.exit(1)
PY

APPROVALS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "select count(*) from approvals where quality_requirement_id=$REQ_ID or quality_itp_id=$ITP_ID or quality_itp_point_id=$POINT_ID or quality_ncr_id=$NCR_ID or acceptance_test_id=$TEST_ID;")
test "$APPROVALS" = '5'
echo "Quality management smoke passed: seven_metrics=true copq_CAD=1875 six_terms=true quality_share_pct=78 independent_gates=5"

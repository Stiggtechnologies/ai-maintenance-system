#!/usr/bin/env bash
set -euo pipefail

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
ORG='11111111-1111-1111-1111-111111111111'
ORG2='22222222-2222-2222-2222-222222222222'
CASE_ID='8d000000-0000-4000-8000-000000000001'
EVIDENCE_ID='8d000000-0000-4000-8000-000000000002'

token(){ local response; response=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); sys.exit(1) if isinstance(x,dict) and x.get('error') else None"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error','') if isinstance(x,dict) else ''; sys.exit(0) if os.environ['WANT'] in e else (print('expected refusal',os.environ['WANT'],'got',x) or sys.exit(1))"; }

DEMO=$(token 'demo@syncai.ca' 'Demo123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$DEMO"; test -n "$ADMIN"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
delete from business_cases where organization_id='$ORG' and case_ref='CLIMATE-CI';
delete from development_cases where id='$CASE_ID';
delete from evidence_items where id='$EVIDENCE_ID';
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,created_by)
values('$CASE_ID','$ORG','Climate-resilient concept selection','brownfield','Compare project concepts against sustainability and future environmental conditions.','00000000-0000-0000-0000-000000000001');
insert into evidence_items(id,organization_id,source_system,evidence_type,description,data_quality,ts)
values('$EVIDENCE_ID','$ORG','climate-projection-register','DOCUMENTED','Controlled future-conditions and option-estimate evidence for the climate concept-selection smoke.','good','2026-09-01T12:00:00Z');
SQL

BUSINESS=$(rpc "$DEMO" create_case_business_case "{\"p_case_id\":\"$CASE_ID\",\"p_case_ref\":\"CLIMATE-CI\",\"p_title\":\"Climate concept selection\",\"p_driver\":\"reliability\",\"p_discount_rate\":0.08,\"p_discount_rate_source\":\"Approved finance planning basis\",\"p_currency\":\"CAD\"}")
noerr "$BUSINESS"
BUSINESS_ID=$(BODY="$BUSINESS" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['business_case_id'])")
OPTION=$(rpc "$DEMO" add_business_case_option "{\"p_business_case_id\":$BUSINESS_ID,\"p_label\":\"Raised electrical building\",\"p_life_periods\":40,\"p_cash_flows\":[{\"period\":0,\"amount\":-12000000},{\"period\":1,\"amount\":900000}],\"p_benefit_probability\":0.8,\"p_is_do_nothing\":false,\"p_notes\":\"Controlled comparison option\",\"p_contingency\":1000000,\"p_contingency_basis\":\"Class 4 estimate uncertainty allowance\"}")
noerr "$OPTION"
OPTION_ID=$(BODY="$OPTION" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['option_id'])")

CROSS=$(rpc "$DEMO" record_option_sustainability_observation "{\"p_option_id\":$OPTION_ID,\"p_dimension\":\"climate_resilience\",\"p_observation\":\"Manual climate claim\",\"p_basis\":\"Unsupported direct classification\",\"p_evidence_item_id\":\"$EVIDENCE_ID\"}")
expect_error "$CROSS" 'climate_resilience is derived'

for dimension in capex opex safety reliability carbon energy water land waste social_effect; do
  RECORD=$(rpc "$DEMO" record_option_sustainability_observation "{\"p_option_id\":$OPTION_ID,\"p_dimension\":\"$dimension\",\"p_observation\":\"Recorded $dimension consequence for this option\",\"p_value\":10,\"p_unit\":\"controlled-unit\",\"p_basis\":\"Approved comparison basis for $dimension\",\"p_evidence_item_id\":\"$EVIDENCE_ID\"}")
  noerr "$RECORD"
done

ASSESSMENT=$(rpc "$DEMO" create_climate_resilience_assessment "{\"p_option_id\":$OPTION_ID,\"p_assessment_ref\":\"CRA-CI\",\"p_future_conditions_basis\":\"Controlled regional projection through the 40-year design life\"}")
noerr "$ASSESSMENT"
ASSESSMENT_ID=$(BODY="$ASSESSMENT" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['assessmentId'])")

ONE=$(rpc "$DEMO" record_climate_resilience_hazard "{\"p_assessment_id\":\"$ASSESSMENT_ID\",\"p_hazard\":\"wildfire\",\"p_future_condition\":\"Longer severe fire-weather season\",\"p_design_response\":\"Defensible-space and smoke-control design\",\"p_residual_gap\":\"Emergency access evidence pending\",\"p_evidence_item_id\":\"$EVIDENCE_ID\"}")
noerr "$ONE"
EARLY=$(rpc "$ADMIN" review_climate_resilience_assessment "{\"p_assessment_id\":\"$ASSESSMENT_ID\",\"p_note\":\"Independent review attempted before the hazard set was complete.\"}")
expect_error "$EARLY" '1 of 8 are recorded'

for hazard in extreme_temperature flood precipitation water_availability freeze_thaw permafrost storm_severity; do
  HAZARD=$(rpc "$DEMO" record_climate_resilience_hazard "{\"p_assessment_id\":\"$ASSESSMENT_ID\",\"p_hazard\":\"$hazard\",\"p_future_condition\":\"Future $hazard condition through design life\",\"p_design_response\":\"Recorded engineering response for $hazard\",\"p_residual_gap\":\"No residual claim beyond recorded evidence\",\"p_evidence_item_id\":\"$EVIDENCE_ID\"}")
  noerr "$HAZARD"
done

SELF=$(rpc "$DEMO" review_climate_resilience_assessment "{\"p_assessment_id\":\"$ASSESSMENT_ID\",\"p_note\":\"Author attempts to review their own complete assessment.\"}")
expect_error "$SELF" 'author cannot perform the independent review'
REVIEW=$(rpc "$ADMIN" review_climate_resilience_assessment "{\"p_assessment_id\":\"$ASSESSMENT_ID\",\"p_note\":\"All eight hazard records checked against the cited controlled evidence.\"}")
noerr "$REVIEW"

COMPARISON=$(rpc "$DEMO" get_case_option_comparison "{\"p_case_id\":\"$CASE_ID\"}")
noerr "$COMPARISON"
BODY="$COMPARISON" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if not x['available'] or not x['comparisonComplete']: print('comparison incomplete',x); sys.exit(1)
o=x['options'][0]
if len(o['dimensions'])!=11 or o['missingDimensions']!=[]: print('wrong dimensions',o); sys.exit(1)
c=o['climateAssessment']
if c['status']!='reviewed' or len(c['hazards'])!=8 or c['missingHazards']!=[]: print('wrong climate assessment',c); sys.exit(1)
if 'does not score, rank, certify or select' not in x['decisionBoundary']: print('missing boundary',x); sys.exit(1)
PY

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
do \$\$
begin
  begin
    insert into option_sustainability_observations(organization_id,option_id,dimension,observation,basis,evidence_item_id,recorded_by)
    values('$ORG2',$OPTION_ID,'capex','Cross-tenant observation must fail','Controlled cross-tenant refusal','$EVIDENCE_ID','00000000-0000-0000-0000-000000000001');
    raise exception 'cross-tenant observation unexpectedly succeeded';
  exception when others then
    if sqlerrm='cross-tenant observation unexpectedly succeeded' then raise; end if;
  end;
  begin
    update climate_resilience_assessments set future_conditions_basis='Tampered reviewed basis that must be refused' where id='$ASSESSMENT_ID';
    raise exception 'reviewed assessment mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm='reviewed assessment mutation unexpectedly succeeded' then raise; end if;
  end;
end \$\$;
SQL

echo "Climate concept-selection smoke passed: dimensions=11 hazards=8 independent_review=true tenant_wall=true auto_selection=false"


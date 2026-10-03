#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D2.09 operational-disruption smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
ORG='11111111-1111-1111-1111-111111111111'
ORG2='22222222-2222-2222-2222-222222222222'
CASE='d2090000-0000-4000-8000-000000000001'
E1='d2090000-0000-4000-8000-000000000011'
E2='d2090000-0000-4000-8000-000000000012'
E3='d2090000-0000-4000-8000-000000000013'
OUT1='d2090000-0000-4000-8000-000000000021'
OUT2='d2090000-0000-4000-8000-000000000022'

token(){ local response; response=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); sys.exit(1) if isinstance(x,dict) and x.get('error') else None"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error','') if isinstance(x,dict) else ''; sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected refusal',os.environ['WANT'],'got',x) or sys.exit(1))"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; print(json.loads(os.environ['BODY']).get(os.environ['KEY'],''))"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
test -n "$PLANNER"
SITE=$(psqlc "select id from sites where organization_id='$ORG' order by created_at,id limit 1")
ACTOR=$(psqlc "select id from user_profiles where organization_id='$ORG' and role='planner' limit 1")
test -n "$SITE"; test -n "$ACTOR"

psqlc "delete from development_cases where id='$CASE';" >/dev/null
psqlc "delete from evidence_items where id in ('$E1','$E2','$E3');" >/dev/null
psqlc "delete from outage_windows where id in ('$OUT1','$OUT2');" >/dev/null

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into development_cases(id,organization_id,title,site_id,lifecycle_type,problem_statement,created_by)
values('$CASE','$ORG','D2.09 brownfield option comparison','$SITE','brownfield','Compare tie-in concepts after construction disruption, production loss and simultaneous-operations risk.','$ACTOR');
insert into evidence_items(id,organization_id,development_case_id,source_system,evidence_type,description,data_quality)
values
('$E1','$ORG','$CASE','controlled-estimate','CALCULATED','Construction disruption estimate and execution boundary.','good'),
('$E2','$ORG','$CASE','production-plan','CALCULATED','Production loss forecast for the controlled outage windows.','good'),
('$E3','$ORG','$CASE','simops-review','DOCUMENTED','Reviewed SIMOPS exposure and quantified risk-cost basis.','good');
insert into outage_windows(id,organization_id,site_id,window_key,title,kind,starts_at,ends_at,scope,status)
values
('$OUT1','$ORG','$SITE','D209-OUT-1','D2.09 spring tie-in','shutdown','2027-04-01T00:00:00Z','2027-04-03T00:00:00Z','Option construction tie-in','planned'),
('$OUT2','$ORG','$SITE','D209-OUT-2','D2.09 autumn tie-in','opportunity','2027-10-01T00:00:00Z','2027-10-02T00:00:00Z','Option commissioning tie-in','planned');
SQL

BUSINESS=$(rpc "$PLANNER" create_case_business_case "{\"p_case_id\":\"$CASE\",\"p_case_ref\":\"D209-CI\",\"p_title\":\"D2.09 option disruption\",\"p_driver\":\"reliability\",\"p_discount_rate\":0.08,\"p_discount_rate_source\":\"Approved planning discount-rate basis\",\"p_currency\":\"CAD\"}")
noerr "$BUSINESS"; BUSINESS_ID=$(field "$BUSINESS" business_case_id)
OPTION_A=$(rpc "$PLANNER" add_business_case_option "{\"p_business_case_id\":$BUSINESS_ID,\"p_label\":\"Two-outage low-capex tie-in\",\"p_life_periods\":20,\"p_cash_flows\":[{\"period\":0,\"amount\":-5000000},{\"period\":1,\"amount\":1800000}],\"p_is_do_nothing\":false}")
noerr "$OPTION_A"; A=$(field "$OPTION_A" option_id)
OPTION_B=$(rpc "$PLANNER" add_business_case_option "{\"p_business_case_id\":$BUSINESS_ID,\"p_label\":\"One-outage modular tie-in\",\"p_life_periods\":20,\"p_cash_flows\":[{\"period\":0,\"amount\":-6500000},{\"period\":1,\"amount\":2100000}],\"p_is_do_nothing\":false}")
noerr "$OPTION_B"; B=$(field "$OPTION_B" option_id)

VALUE=$(rpc "$PLANNER" record_case_value_evaluation "{\"p_case_id\":\"$CASE\",\"p_option_id\":$A,\"p_expected_value\":10000000,\"p_value_basis\":\"Approved economic evaluation before operational disruption deductions.\",\"p_uncertainty_level\":\"moderate\",\"p_uncertainty_reasons\":[\"outage exposure assessed separately\"],\"p_computed\":{\"npv\":10000000},\"p_engine_version\":\"develop-value/1\"}")
noerr "$VALUE"; VALUE_ID=$(field "$VALUE" evaluation_id)

BEFORE=$(rpc "$PLANNER" get_case_operational_disruption "{\"p_case_id\":\"$CASE\"}")
noerr "$BEFORE"
BODY="$BEFORE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['available'] and not x['comparisonComplete'], x
assert len(x['options'])==2 and len(x['availableOutageWindows'])==2, x
a=next(o for o in x['options'] if o['label'].startswith('Two-outage'))
b=next(o for o in x['options'] if o['label'].startswith('One-outage'))
assert len(a['valueEvaluations'])==1 and a['assessment'] is None, a
assert b['valueEvaluations']==[] and b['missing']==['ProjectValue evaluation','ConstructionDisruption','ProductionLoss','SIMOPSRisk','outage scope'], b
PY

WRONG=$(rpc "$PLANNER" record_option_operational_disruption_assessment "{\"p_option_id\":$B,\"p_value_evaluation_id\":\"$VALUE_ID\",\"p_construction_disruption_cost\":1000000,\"p_construction_disruption_basis\":\"Controlled construction estimate basis\",\"p_construction_disruption_evidence_item_id\":\"$E1\",\"p_production_loss_cost\":2000000,\"p_production_loss_basis\":\"Approved production plan loss basis\",\"p_production_loss_evidence_item_id\":\"$E2\",\"p_simops_risk_cost\":500000,\"p_simops_risk_basis\":\"Reviewed SIMOPS quantified risk basis\",\"p_simops_risk_evidence_item_id\":\"$E3\",\"p_outage_window_ids\":[\"$OUT1\"],\"p_outage_scope_basis\":\"Controlled complete outage scope for option B\"}")
expect_error "$WRONG" 'exact option'

RECORD=$(rpc "$PLANNER" record_option_operational_disruption_assessment "{\"p_option_id\":$A,\"p_value_evaluation_id\":\"$VALUE_ID\",\"p_construction_disruption_cost\":1000000,\"p_construction_disruption_basis\":\"Controlled construction estimate basis\",\"p_construction_disruption_evidence_item_id\":\"$E1\",\"p_production_loss_cost\":2000000,\"p_production_loss_basis\":\"Approved production plan loss basis\",\"p_production_loss_evidence_item_id\":\"$E2\",\"p_simops_risk_cost\":500000,\"p_simops_risk_basis\":\"Reviewed SIMOPS quantified risk basis\",\"p_simops_risk_evidence_item_id\":\"$E3\",\"p_outage_window_ids\":[\"$OUT1\",\"$OUT2\"],\"p_outage_scope_basis\":\"Both controlled site windows form the complete tie-in scope\"}")
noerr "$RECORD"
test "$(field "$RECORD" projectValue)" = "10000000"
test "$(field "$RECORD" netOptionValue)" = "6500000"
test "$(field "$RECORD" outageCount)" = "2"
ASSESSMENT=$(field "$RECORD" assessmentId)

AFTER=$(rpc "$PLANNER" get_case_operational_disruption "{\"p_case_id\":\"$CASE\"}")
noerr "$AFTER"
BODY="$AFTER" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
a=next(o for o in x['options'] if o['label'].startswith('Two-outage'))['assessment']
assert a['projectValue']==10000000 and a['constructionDisruption']==1000000, a
assert a['productionLoss']==2000000 and a['simopsRisk']==500000 and a['netOptionValue']==6500000, a
assert len(a['outages'])==2 and {w['windowKey'] for w in a['outages']}=={'D209-OUT-1','D209-OUT-2'}, a
assert 'does not rank, recommend, approve or select' in x['decisionBoundary'], x
PY

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
do \$\$
begin
  begin
    update option_operational_disruption_assessments set simops_risk_cost=0 where id='$ASSESSMENT';
    raise exception 'immutable disruption assessment unexpectedly changed';
  exception when others then
    if sqlerrm='immutable disruption assessment unexpectedly changed' then raise; end if;
  end;
  begin
    insert into option_operational_disruption_assessments(
      organization_id,option_id,value_evaluation_id,revision,
      construction_disruption_cost,construction_disruption_basis,construction_disruption_evidence_item_id,
      production_loss_cost,production_loss_basis,production_loss_evidence_item_id,
      simops_risk_cost,simops_risk_basis,simops_risk_evidence_item_id,outage_scope_basis,recorded_by)
    values('$ORG2',$B,'$VALUE_ID',1,0,'Cross-tenant construction basis','$E1',0,'Cross-tenant production basis','$E2',0,'Cross-tenant SIMOPS basis','$E3','Cross-tenant outage scope basis','$ACTOR');
    raise exception 'cross-tenant disruption assessment unexpectedly succeeded';
  exception when others then
    if sqlerrm='cross-tenant disruption assessment unexpectedly succeeded' then raise; end if;
  end;
end \$\$;
SQL

REVISION=$(rpc "$PLANNER" record_option_operational_disruption_assessment "{\"p_option_id\":$A,\"p_value_evaluation_id\":\"$VALUE_ID\",\"p_construction_disruption_cost\":900000,\"p_construction_disruption_basis\":\"Revised controlled construction estimate basis\",\"p_construction_disruption_evidence_item_id\":\"$E1\",\"p_production_loss_cost\":1800000,\"p_production_loss_basis\":\"Revised approved production plan loss basis\",\"p_production_loss_evidence_item_id\":\"$E2\",\"p_simops_risk_cost\":400000,\"p_simops_risk_basis\":\"Revised reviewed SIMOPS quantified risk basis\",\"p_simops_risk_evidence_item_id\":\"$E3\",\"p_outage_window_ids\":[\"$OUT1\"],\"p_outage_scope_basis\":\"Revised complete scope uses the spring outage only\"}")
noerr "$REVISION"; test "$(field "$REVISION" revision)" = "2"
test "$(psqlc "select count(*) from option_operational_disruption_assessments where option_id=$A and superseded_at is null")" = "1"
test "$(psqlc "select count(*) from option_operational_disruption_assessments where option_id=$A and superseded_at is not null")" = "1"

echo 'D2.09 operational-disruption smoke passed: exact_formula=true option_value_provenance=true three_term_evidence=true outage_scope=true tenant_wall=true immutable_revisions=true auto_selection=false'

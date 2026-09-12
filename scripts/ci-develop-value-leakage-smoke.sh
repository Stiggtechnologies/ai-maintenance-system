#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Value-leakage smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='22222222-2222-2222-2222-222222222222'
CASE='8e000000-0000-4000-8000-000000000001'
EVIDENCE='8e000000-0000-4000-8000-000000000002'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); sys.exit(1) if isinstance(x,dict) and x.get('error') else None"; }
contains(){ BODY="$1" WANT="$2" python3 -c "import os,sys; sys.exit(0) if os.environ['WANT'].lower() in os.environ['BODY'].lower() else (print('expected',os.environ['WANT'],'got',os.environ['BODY']) or sys.exit(1))"; }

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
REVIEWER=$(token 'admin@syncai.ca' 'Admin123!@#')
AUTHOR_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='demo@syncai.ca'")
REVIEWER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
test -n "$AUTHOR"; test -n "$REVIEWER"; test -n "$AUTHOR_ID"; test -n "$REVIEWER_ID"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
delete from development_cases where id='$CASE';
delete from evidence_items where id='$EVIDENCE';
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,created_by)
values('$CASE','$ORG','Value leakage acceptance','brownfield','Prove expected, forecast, actual, variance and attributed leakage without inventing values.','$AUTHOR_ID');
insert into evidence_items(id,organization_id,development_case_id,source_system,evidence_type,description,data_quality,ts)
values('$EVIDENCE','$ORG','$CASE','benefits-evidence-register','DOCUMENTED','Controlled lifecycle value and causal attribution evidence.','good','2026-09-01T12:00:00Z');
with benefit as (
  insert into value_metrics(organization_id,development_case_id,owner_id,metric_type,label,value,unit,status,period,expected_date,basis)
  values('$ORG','$CASE','$AUTHOR_ID','projected_annualized_value','Annual throughput value',90,'CADm','projected','lifecycle','2027-12-31','Approved economic case benefit definition') returning id
)
insert into value_metrics(organization_id,development_case_id,owner_id,metric_type,label,value,unit,status,period,expected_date,basis,
  checkpoint_horizon_days,parent_metric_id,observed_value,observation_method,observation_evidence,observed_by,observed_at,due_on,verified_by,verified_at,verification_note)
select '$ORG','$CASE','$AUTHOR_ID','realization_checkpoint','Annual throughput value · day 365',90,'CADm','verified','checkpoint','2027-12-31',
  'Generated from the approved benefit',365,id,64,'Measured annual production value','Approved operating and finance records','$AUTHOR_ID',now(),'2027-12-31','$REVIEWER_ID',now(),'Human review confirms the observed annual value.' from benefit;
insert into development_baselines(organization_id,development_case_id,baseline_type,version,status,description,content,approved_by,approved_at,approval_note,created_by)
values('$ORG','$CASE','BENEFITS',1,'approved','Approved benefits baseline for value leakage',
  '{"approvedExpectedBenefit":90,"approvedExpectedUnit":"CADm","mixedUnits":false,"approvedBenefitLegs":[]}'::jsonb,
  '$REVIEWER_ID',now(),'Independent approval freezes the expected benefit denominator.','$AUTHOR_ID');
SQL

for pair in 'original:100' 'design:95' 'execution_forecast:82' 'startup:71'; do
  POINT=${pair%%:*}; VALUE=${pair##*:}
  REC=$(rpc "$AUTHOR" record_case_value_trajectory_point "{\"p_case_id\":\"$CASE\",\"p_point\":\"$POINT\",\"p_value\":$VALUE,\"p_unit\":\"CADm\",\"p_basis\":\"Controlled $POINT value from the approved lifecycle record\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
  noerr "$REC"
  ID=$(BODY="$REC" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['metricId'])")
  SELF=$(rpc "$AUTHOR" verify_value_metric "{\"p_metric_id\":\"$ID\",\"p_verified\":true,\"p_note\":\"Author attempts to verify their own lifecycle value record.\"}")
  contains "$SELF" 'author cannot perform its independent verification'
  OK=$(rpc "$REVIEWER" verify_value_metric "{\"p_metric_id\":\"$ID\",\"p_verified\":true,\"p_note\":\"Independent review confirms this lifecycle value against cited evidence.\"}")
  noerr "$OK"
done

for triple in 'scope:8:causal' 'cost:5:contributing' 'schedule:7:causal' 'reliability:2:contributing' 'ramp_up:2:causal' 'operating_cost:1:contributing' 'market_assumption:1:contributing'; do
  BUCKET=${triple%%:*}; REST=${triple#*:}; VALUE=${REST%%:*}; KIND=${REST##*:}
  REC=$(rpc "$AUTHOR" record_case_value_leakage_attribution "{\"p_case_id\":\"$CASE\",\"p_bucket\":\"$BUCKET\",\"p_value\":$VALUE,\"p_attribution_kind\":\"$KIND\",\"p_basis\":\"Controlled causal assessment for $BUCKET supported by the cited record\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
  noerr "$REC"
  ID=$(BODY="$REC" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['metricId'])")
  OK=$(rpc "$REVIEWER" verify_value_metric "{\"p_metric_id\":\"$ID\",\"p_verified\":true,\"p_note\":\"Independent review confirms the stated relationship and amount against evidence.\"}")
  noerr "$OK"
done

READ=$(rpc "$AUTHOR" get_case_value_leakage "{\"p_case_id\":\"$CASE\"}")
noerr "$READ"
BODY="$READ" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['leakageEvaluable'] and x['trajectoryComplete']
assert [r['point'] for r in x['trajectory']]==['original','design','sanction','execution_forecast','startup','realized']
assert float(x['approvedValue'])==90 and float(x['realizedValue'])==64
assert float(x['approvedToRealizedLeakage'])==26 and float(x['originalToRealizedChange'])==36
assert len(x['attributions'])==7 and float(x['attributedValue'])==26
assert float(x['unattributedResidual'])==0 and x['attributionValid']
assert x['pendingVerificationCount']==0 and x['missingPoints']==[]
assert 'not proof of causation' in x['decisionBoundary']
PY

SCREEN=$(rpc "$AUTHOR" get_case_benefits_screen "{\"p_case_id\":\"$CASE\"}")
noerr "$SCREEN"
BODY="$SCREEN" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); b=x['benefits'][0]
assert float(b['expected'])==90 and float(b['currentForecast'])==64 and float(b['actual'])==64
assert float(b['variance'])==-26 and b['owner']
assert x['valueLeakage']['trajectoryComplete']
PY

OVER=$(rpc "$AUTHOR" record_case_value_leakage_attribution "{\"p_case_id\":\"$CASE\",\"p_bucket\":\"scope\",\"p_value\":30,\"p_attribution_kind\":\"causal\",\"p_basis\":\"Deliberate over-attribution must be refused during independent verification\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
OVER_ID=$(BODY="$OVER" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['metricId'])")
REFUSED=$(rpc "$REVIEWER" verify_value_metric "{\"p_metric_id\":\"$OVER_ID\",\"p_verified\":true,\"p_note\":\"Independent review must refuse this over-attributed replacement record.\"}")
contains "$REFUSED" 'cannot exceed positive approved-to-realized leakage'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
do \$\$
begin
  begin
    insert into value_metrics(organization_id,development_case_id,metric_type,label,value,unit,status,period,basis,value_lifecycle_point,evidence_item_id,recorded_by)
    values('$OTHER_ORG','$CASE','project_value_trajectory','Cross-tenant value',1,'CADm','projected','lifecycle','Cross-tenant record must be refused','original','$EVIDENCE','$AUTHOR_ID');
    raise exception 'direct specialized insert unexpectedly succeeded';
  exception when others then
    if sqlerrm='direct specialized insert unexpectedly succeeded' then raise; end if;
  end;
  begin
    delete from value_metrics where organization_id='$ORG' and development_case_id='$CASE' and metric_type='project_value_trajectory';
    raise exception 'append-only deletion unexpectedly succeeded';
  exception when others then
    if sqlerrm='append-only deletion unexpectedly succeeded' then raise; end if;
  end;
end \$\$;
SQL

echo "Value-leakage smoke passed: trajectory=6/6 buckets=7 leakage=26 residual=0 independent=true tenant_wall=true"

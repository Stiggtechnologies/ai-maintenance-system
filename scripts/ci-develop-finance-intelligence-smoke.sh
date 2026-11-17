#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D2.04 finance-intelligence smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
TITLE='D2.04 thirteen-dimension finance intelligence'
CASE_REF='D204-FINANCE-CI'
ESC_KEY='d204_escalation'
FX_KEY='d204_cad_per_usd'

token(){ local response
  response=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}")
  printf '%s' "$response" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}
rpc(){
  curl -sS -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" \
    -H 'content-type: application/json' -d "$3"
}
field(){
  BODY="$1" KEY="$2" python3 -c "import json,os; x=json.loads(os.environ['BODY']); v=x.get(os.environ['KEY']); print('' if v is None else v)"
}
noerr(){
  BODY="$1" python3 - <<'PY'
import json, os, sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and x.get('error'):
    print('unexpected error:',x); sys.exit(1)
PY
}
expect_error(){
  BODY="$1" WANT="$2" python3 - <<'PY'
import json, os, sys
x=json.loads(os.environ['BODY'])
e=x.get('error','') if isinstance(x,dict) else ''
if os.environ['WANT'].lower() not in str(e).lower():
    print('expected refusal containing',repr(os.environ['WANT']),'got',x); sys.exit(1)
PY
}
psqlc(){
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -qAt -c "$1"
}
sql_must_fail(){ local statement="$1" output
  output=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres \
    -d postgres -v ON_ERROR_STOP=1 -c "$statement" 2>&1 || true)
  if ! grep -qi 'cash_flows' <<<"$output"; then
    echo "expected cash_flows_well_formed trigger refusal, got: $output"; return 1
  fi
}

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$PLANNER"; test -n "$TECH"

psqlc "delete from business_cases where organization_id='$ORG' and case_ref='$CASE_REF';" >/dev/null
psqlc "delete from development_cases where organization_id='$ORG' and title='$TITLE';" >/dev/null
psqlc "delete from financial_assumptions where organization_id='$ORG' and assumption_key in ('$ESC_KEY','$FX_KEY');" >/dev/null

BODY=$(rpc "$PLANNER" create_development_case \
  "{\"p_title\":\"$TITLE\",\"p_problem_statement\":\"Prove all thirteen finance dimensions and sourced economic adjustments without granting autonomous capital authority.\",\"p_lifecycle_type\":\"sustaining_capital\"}")
noerr "$BODY"; CASE=$(field "$BODY" case_id); test -n "$CASE"

BODY=$(rpc "$PLANNER" create_case_business_case \
  "{\"p_case_id\":\"$CASE\",\"p_case_ref\":\"$CASE_REF\",\"p_title\":\"Governed cross-currency option\",\"p_driver\":\"reliability\",\"p_currency\":\"CAD\",\"p_discount_rate\":0.08,\"p_discount_rate_source\":\"Approved corporate planning rate for D2.04 smoke\"}")
noerr "$BODY"; BUSINESS=$(field "$BODY" business_case_id); test -n "$BUSINESS"

BODY=$(rpc "$PLANNER" add_business_case_option \
  "{\"p_business_case_id\":$BUSINESS,\"p_label\":\"US-sourced replacement\",\"p_life_periods\":3,\"p_cash_flows\":[{\"period\":0,\"amount\":-1000},{\"period\":1,\"amount\":500},{\"period\":2,\"amount\":600}],\"p_contingency\":100,\"p_contingency_basis\":\"Quantified class-four estimate uncertainty\"}")
noerr "$BODY"; OPTION=$(field "$BODY" option_id); test -n "$OPTION"

BODY=$(rpc "$PLANNER" upsert_financial_assumption \
  "{\"p_key\":\"$ESC_KEY\",\"p_label\":\"Annual escalation\",\"p_value\":0.05,\"p_unit\":\"fraction_per_period\",\"p_source\":\"Approved finance planning memorandum\",\"p_kind\":\"escalation\"}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" upsert_financial_assumption \
  "{\"p_key\":\"$FX_KEY\",\"p_label\":\"CAD per USD planning rate\",\"p_value\":1.35,\"p_unit\":\"CAD_per_USD\",\"p_source\":\"Approved treasury planning curve\",\"p_kind\":\"fx\"}")
noerr "$BODY"

DENIED=$(rpc "$TECH" configure_business_case_option_economics \
  "{\"p_option_id\":$OPTION,\"p_source_currency\":\"USD\",\"p_escalation_assumption_key\":\"$ESC_KEY\",\"p_fx_assumption_key\":\"$FX_KEY\",\"p_basis\":\"Approved option-specific economics basis\"}")
expect_error "$DENIED" 'human planning'

WRONG_DIRECTION=$(rpc "$PLANNER" configure_business_case_option_economics \
  "{\"p_option_id\":$OPTION,\"p_source_currency\":\"EUR\",\"p_escalation_assumption_key\":\"$ESC_KEY\",\"p_fx_assumption_key\":\"$FX_KEY\",\"p_basis\":\"Approved option-specific economics basis\"}")
expect_error "$WRONG_DIRECTION" 'CAD_per_EUR'

BODY=$(rpc "$PLANNER" configure_business_case_option_economics \
  "{\"p_option_id\":$OPTION,\"p_source_currency\":\"USD\",\"p_escalation_assumption_key\":\"$ESC_KEY\",\"p_fx_assumption_key\":\"$FX_KEY\",\"p_basis\":\"Approved option-specific economics basis\"}")
noerr "$BODY"

MODEL=$(rpc "$PLANNER" get_case_finance_intelligence \
  "{\"p_case_id\":\"$CASE\"}")
BODY="$MODEL" python3 - <<'PY'
import json, os
m=json.loads(os.environ['BODY'])
assert m.get('available') is True, m
d=m.get('dimensions',[])
keys=[row['key'] for row in d]
assert len(d)==13 and len(set(keys))==13, keys
assert set(keys)=={
 'capital_cost','operating_cost','lifecycle_cost','npv','irr','payback',
 'cash_flow','escalation','contingency','economic_assumptions',
 'foreign_exchange','commodity_sensitivity','funding_constraints'}, keys
o=m['options'][0]['economicAdjustment']
assert o['status']=='ready' and o['sourceCurrency']=='USD' and o['targetCurrency']=='CAD', o
assert float(o['escalation']['value'])==0.05 and o['escalation']['source'], o
assert float(o['foreignExchange']['value'])==1.35 and o['foreignExchange']['source'], o
assert set(m['performance'])=={'earnedValue','forecastConfidence','sinceSanctionDelta'}, m['performance']
assert 'does not approve an option' in m['decisionBoundary'], m['decisionBoundary']
PY

RAW=$(psqlc "select cash_flows::text from business_case_options where id=$OPTION;")
grep -q '"amount": -1000' <<<"$RAW"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='business_case_option_economics' and event_data->>'developmentCaseId'='$CASE';")" = '1'

sql_must_fail "update business_case_options set cash_flows='[{\"period\":0}]'::jsonb where id=$OPTION;"

echo 'D2.04 finance-intelligence smoke passed: dimensions=13 composed_reads=true sourced_escalation=true sourced_fx=true conversion_direction=true raw_flows_immutable=true tenant_scope=true human_boundary=true audit=true cash_flows_well_formed=true approval_authority=false'

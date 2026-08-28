#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 2 — the value spine, proven live with refusals.
#
# Steps (each a live transcript against a real local database):
#   1  objective typed target + nesting (D11.15): unit-less numeric target
#      refused; adoption; child nesting; cycle refused at the boundary;
#      get_objective_tree renders depth + typed target.
#   2  risk→objective invariant (D11.16): creation without an objective
#      refused with the invariant named; with a DRAFT objective refused
#      (adopted standard); with an adopted objective created; clearing the
#      link refused for an RLS-bypassed client; a service insert without a
#      link is admitted AND audited.
#   3  case + D1.02: a design-stage gate proceed with every mandatory met is
#      refused until a success contract is RECORDED; readiness names the
#      missing contract as a blocker first.
#   4  success contract (D1.01): outcome without basis/owner refused; RAM
#      dimension with a linked ram_target refuses a duplicated number and
#      accepts the reference; empty contract not recordable; ai_admin
#      refused by name at the record step; recorded contract immutable to
#      clients (RLS-bypassed included), service admitted-and-audited.
#   5  finance model (D2.04/D2.01): model refuses without a business case;
#      discount rate without a source refused; hypothesis all-or-refuse;
#      options with undated/out-of-life/contingency-without-basis refusals;
#      NPV refusal list until inputs complete.
#   6  viability envelope (D2.06/D2.03 tripwire): floor requires basis and
#      review role; the tripwire is revisable, never removable.
#   7  assumption family (ruling 5) + monitoring (D2.07): threshold naming
#      an unrecorded series refused ("alarm wired to nothing"); numeric-leg
#      write without a source refused; declared threshold wires an
#      indicator; a new version below the threshold deterministically
#      invalidates the assumption, reopens the dependent decision (D3.30)
#      and records the observation trail.
#   8  value evaluations + trajectory (D2.02): evaluation refuses a foreign
#      option and a short basis; records with server-frozen inputs; gate
#      review links the evaluation; the trajectory shows ONE real point and
#      "not evaluated at this gate" everywhere else — no carry-forward.
#   9  collapse trigger (D2.03): below-floor evaluation raises ONE pending
#      sanction-reconsideration recommendation through the canonical store
#      (C8 fields populated, case-bound); a second signal lands on the
#      record, not as a duplicate; the workspace actions section renders it.
#  10  since-sanction delta (D2.05): 'not sanctioned' refusal; after
#      sanction, the delta stands on the two recorded ends with dimension
#      rows and named not-comparables.
#  11  benefits (D9.10): ownerless case benefit refused at the RPC AND as a
#      direct service insert (schema CHECK); cross-org owner refused by the
#      membership trigger; recorded benefit is projected until verified.
#  12  workspace read v4 (D13.04): objective, successContract,
#      businessCases, caseAssumptions, benefits and schedule all render
#      from one call.
#
# Run: supabase start && scripts/ci-develop-slice2-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-2 smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'

sql_must_fail(){ local out
  out=$( { PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 <<<"$1"; } || true )
  if PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<<"$1"; then
    echo "expected SQL to be refused, it succeeded: $1"; return 1
  fi
  printf '%s' "$out"
}
field(){ python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$1'); print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))"; }
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and x.get('error'): print('unexpected error:',x); sys.exit(1)
PY
}
expect_err(){ BODY="$1" NEEDLE="$2" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
err=(x.get('error') if isinstance(x,dict) else None) or (x.get('message') if isinstance(x,dict) else None) or ''
if os.environ['NEEDLE'].lower() not in str(err).lower():
    print('expected refusal containing %r, got: %s' % (os.environ['NEEDLE'], x)); sys.exit(1)
PY
}
token(){ local r; r=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$r"|python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$EXEC"

# Idempotent re-run: clear this smoke's artifacts. Deletes run as the audited
# service path by design.
psqlc "delete from recommendations where organization_id='$ORG' and development_case_id in (select id from development_cases where organization_id='$ORG' and title like 'SMOKE2 %');" >/dev/null
psqlc "delete from development_cases where organization_id='$ORG' and title like 'SMOKE2 %';" >/dev/null
psqlc "delete from risks where organization_id='$ORG' and title like 'SMOKE2 %';" >/dev/null
psqlc "delete from business_cases where organization_id='$ORG' and case_ref like 'SMOKE2-%';" >/dev/null
psqlc "delete from financial_assumptions where organization_id='$ORG' and assumption_key like 'smoke2_%';" >/dev/null
psqlc "delete from risk_assumptions where organization_id='$ORG' and statement like 'SMOKE2 %';" >/dev/null
psqlc "delete from risk_objectives where organization_id='$ORG' and description like 'SMOKE2 %';" >/dev/null
psqlc "delete from value_metrics where organization_id='$ORG' and label like 'SMOKE2 %';" >/dev/null
psqlc "delete from capital_projects where organization_id='$ORG' and project_code like 'SMOKE2-%';" >/dev/null
psqlc "delete from organizations where name='SMOKE2 probe org';" >/dev/null
psqlc "update authority_limits set status='draft', adopted_by=null, adopted_at=null where organization_id='$ORG' and action_type='sanction' and status='adopted';" >/dev/null

FW=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Reference Heavy-Industry Stage Gate' and status='adopted' order by version limit 1")
test -n "$FW"
OWNER=$(psqlc "select id from user_profiles where organization_id='$ORG' and role='reliability_engineer' limit 1")
test -n "$OWNER"
DUE=$(python3 -c "import datetime; print((datetime.date.today()+datetime.timedelta(days=45)).isoformat())")

echo '— 1. objective: typed target + nesting on the ONE store (D11.15) —'
R=$(rpc "$MANAGER" upsert_risk_objective '{"p_objective":{"objective_level":"site","description":"SMOKE2 unit-less typed target","target":"92","measurement":"monthly availability","timeframe":"FY2027","tolerance":"no month below 88","owner_id":"'"$OWNER"'","target_value":92}}')
expect_err "$R" 'states its unit'
R=$(rpc "$MANAGER" upsert_risk_objective '{"p_objective":{"objective_level":"site","description":"SMOKE2 crusher availability objective","target":">= 92% availability","measurement":"monthly availability","timeframe":"FY2027","tolerance":"no month below 88%","owner_id":"'"$OWNER"'","target_value":92,"unit":"%","target_date":"2027-06-30"}}')
noerr "$R"; OBJ=$(printf '%s' "$R"|field objective_id); test -n "$OBJ"
R=$(rpc "$EXEC" adopt_risk_objective '{"p_objective_id":"'"$OBJ"'","p_note":"Adopted for the slice-2 CI transcript."}')
noerr "$R"
R=$(rpc "$MANAGER" upsert_risk_objective '{"p_objective":{"objective_level":"asset","description":"SMOKE2 liner life child objective","target":"liner life 8 weeks","measurement":"weeks between liner failures","timeframe":"FY2027","tolerance":"minimum 6 weeks","owner_id":"'"$OWNER"'","parent_id":"'"$OBJ"'"}}')
noerr "$R"; CHILD=$(printf '%s' "$R"|field objective_id); test -n "$CHILD"
OUT=$(sql_must_fail "update risk_objectives set parent_id='$CHILD' where id='$OBJ';")
printf '%s' "$OUT" | grep -q 'close a cycle'
TREE=$(rpc "$PLANNER" get_objective_tree '{}')
BODY="$TREE" python3 - <<'PY'
import json,os
t=json.loads(os.environ['BODY'])
mine={n['description']:n for n in t if n['description'].startswith('SMOKE2 ')}
root=mine['SMOKE2 crusher availability objective']; child=mine['SMOKE2 liner life child objective']
assert root['depth']==0 and root['targetValue']==92 and root['unit']=='%', root
assert child['depth']==1 and child['parentId']==root['id'], child
assert child['targetValue'] is None, child
print('objective tree: nesting + typed target render; absent typed target stays null')
PY

echo '— 2. risk→objective invariant (D11.16) —'
CTX=$(psqlc "select id from risk_context_nodes where organization_id='$ORG' limit 1")
if [ -z "$CTX" ]; then
  CTX=$(psqlc "with r as (insert into risk_context_nodes (organization_id, scope_kind, name, status) values ('$ORG','enterprise','SMOKE2 context','adopted') returning id) select id from r")
fi
CRIT=$(psqlc "select id from risk_criteria_profiles where organization_id='$ORG' limit 1")
if [ -z "$CRIT" ]; then
  CRIT=$(psqlc "with r as (insert into risk_criteria_profiles (organization_id, name, status, basis) values ('$ORG','SMOKE2 criteria','adopted','CI transcript fixture profile') returning id) select id from r")
fi
R=$(rpc "$MANAGER" create_risk_assessment '{"p_assessment":{"title":"SMOKE2 risk without objective","context_id":"'"$CTX"'","criteria_profile_id":"'"$CRIT"'"}}')
expect_err "$R" 'always links to an objective'
R=$(rpc "$MANAGER" create_risk_assessment '{"p_assessment":{"title":"SMOKE2 risk on draft objective","context_id":"'"$CTX"'","criteria_profile_id":"'"$CRIT"'","objective_id":"'"$CHILD"'"}}')
expect_err "$R" 'ADOPTED objective'
R=$(rpc "$MANAGER" create_risk_assessment '{"p_assessment":{"title":"SMOKE2 liner supply exposure","context_id":"'"$CTX"'","criteria_profile_id":"'"$CRIT"'","objective_id":"'"$OBJ"'","current_risk_level":"High"}}')
noerr "$R"; RISK=$(printf '%s' "$R"|field risk_id); test -n "$RISK"
test "$(psqlc "select objective_id from risks where id='$RISK'")" = "$OBJ"
# clearing the link refused even with RLS bypassed (simulated client)
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update risks set objective_id=null where id='$RISK';
rollback;")
printf '%s' "$OUT" | grep -q 'cannot be cleared'
# service insert without a link: admitted AND audited
AUD_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Risk % inserted without an objective link%'")
LEGACY=$(psqlc "with r as (insert into risks (organization_id, title, status) values ('$ORG','SMOKE2 service legacy risk','draft') returning id) select id from r")
test -n "$LEGACY"
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Risk % inserted without an objective link%'")" = "$((AUD_B+1))"
echo 'invariant: client refused (insert + unlink), service admitted-and-audited'

echo '— 3. case + D1.02: design gates blocked before a recorded contract —'
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE2 crusher value case","p_problem_statement":"Crusher availability is 82% against a 92% plan; liner failures drive an estimated 140k lost tonnes a year.","p_lifecycle_type":"reliability_improvement","p_framework_id":"'"$FW"'","p_estimated_capex":4500000,"p_expected_value":2100000,"p_objective_id":"'"$OBJ"'"}')
noerr "$R"; CASE=$(printf '%s' "$R"|field case_id); test -n "$CASE"
G3=$(psqlc "select id from stage_gates where framework_id='$FW' and name like 'G3%'")
C31=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G3 and sort_order=10")
C32=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G3 and sort_order=20")
C33=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G3 and sort_order=30")
C34=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G3 and sort_order=40")
F3=$(python3 -c "import json;print(json.dumps([{'criterion_text':c,'status':'met','evidence':'Recorded in the case file for CI'} for c in ['$C31','$C32','$C33','$C34']]))")
READY=$(rpc "$PLANNER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G3}")
BODY="$READY" python3 - <<'PY'
import json,os
r=json.loads(os.environ['BODY'])
sc=[b for b in r['blockers'] if b['type']=='success_contract']
assert len(sc)==1 and 'success is established before design begins' in sc[0]['name'], sc
assert r.get('successContract') is None
print('readiness names the missing contract as a blocker on a design gate')
PY
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G3,\"p_outcome\":\"proceed\",\"p_note\":\"Every mandatory met, but no contract exists yet.\",\"p_findings\":$F3}")
expect_err "$R" 'success is established before design begins'

echo '— 4. success contract: bases, owners, RAM reference, record act, immutability —'
R=$(rpc "$PLANNER" draft_success_contract '{"p_case_id":"'"$CASE"'"}')
noerr "$R"; SC=$(printf '%s' "$R"|field contract_id); test -n "$SC"
R=$(rpc "$MANAGER" record_success_contract '{"p_contract_id":"'"$SC"'","p_note":"An empty contract must be refused before this note matters."}')
expect_err "$R" 'no outcomes defines no success'
R=$(rpc "$PLANNER" set_success_outcome '{"p_contract_id":"'"$SC"'","p_dimension":"business","p_outcome_statement":"Recover 140k lost tonnes per year","p_basis":"short","p_owner_id":"'"$OWNER"'"}')
expect_err "$R" 'states its basis'
R=$(rpc "$PLANNER" set_success_outcome '{"p_contract_id":"'"$SC"'","p_dimension":"business","p_outcome_statement":"Recover 140k lost tonnes per year","p_basis":"Loss accounting in the FY26 production ledger","p_owner_id":"'"$OWNER"'","p_target_value":140000,"p_unit":"t/a"}')
noerr "$R"
# RAM reference rule: seed a capital project + ram target, bind to the case.
CP=$(psqlc "with r as (insert into capital_projects (organization_id, project_code, title) values ('$ORG','SMOKE2-CP-01','SMOKE2 crusher replacement') returning id) select id from r")
RT=$(psqlc "with r as (insert into ram_targets (organization_id, project_id, system_label, target_availability, target_basis) values ('$ORG',$CP,'SMOKE2 crushing train',0.96,'Duty-standby RBD from the FEL2 study') returning id) select id from r")
psqlc "update development_cases set capital_project_id=$CP where id='$CASE'" >/dev/null
R=$(rpc "$PLANNER" set_success_outcome '{"p_contract_id":"'"$SC"'","p_dimension":"availability","p_outcome_statement":"Crushing train availability at or above target","p_basis":"RAM allocation from the FEL2 study","p_owner_id":"'"$OWNER"'","p_target_value":96,"p_unit":"%"}')
expect_err "$R" 'REFERENCES one'
R=$(rpc "$PLANNER" set_success_outcome '{"p_contract_id":"'"$SC"'","p_dimension":"availability","p_outcome_statement":"Crushing train availability at or above target","p_basis":"RAM allocation from the FEL2 study","p_owner_id":"'"$OWNER"'","p_target_value":96,"p_unit":"%","p_ram_target_id":'"$RT"'}')
expect_err "$R" 'no second copy'
R=$(rpc "$PLANNER" set_success_outcome '{"p_contract_id":"'"$SC"'","p_dimension":"availability","p_outcome_statement":"Crushing train availability at or above target","p_basis":"RAM allocation from the FEL2 study","p_owner_id":"'"$OWNER"'","p_ram_target_id":'"$RT"'}')
noerr "$R"
AIBOT=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#')
if [ -n "$AIBOT" ]; then
  R=$(rpc "$AIBOT" record_success_contract '{"p_contract_id":"'"$SC"'","p_note":"the AI-operator identity must be refused by name"}')
  expect_err "$R" 'AI-operator identity'
fi
R=$(rpc "$MANAGER" record_success_contract '{"p_contract_id":"'"$SC"'","p_note":"Recorded from stated loss accounting and the FEL2 RAM study."}')
noerr "$R"
# immutable to clients once recorded — RLS-bypassed simulated client refused
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update development_success_outcomes set basis='rewritten after the fact' where contract_id='$SC';
rollback;")
printf '%s' "$OUT" | grep -q 'immutable'
SCAUD_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Recorded success-contract content%'")
psqlc "update development_success_outcomes set basis=basis||' (service touch)' where contract_id='$SC' and dimension='business'" >/dev/null
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Recorded success-contract content%'")" = "$((SCAUD_B+1))"
# the D1.02 gate now passes with the same findings that were refused
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G3,\"p_outcome\":\"proceed\",\"p_note\":\"All four sanction-readiness mandatories explicitly met.\",\"p_findings\":$F3}")
noerr "$R"
echo 'contract: refusals live, RAM reference enforced, record human-only, immutability audited'

echo '— 5. finance model: refusal-first inputs (D2.04/D2.01) —'
FM=$(rpc "$PLANNER" get_case_finance_model '{"p_case_id":"'"$CASE"'"}')
BODY="$FM" python3 - <<'PY'
import json,os
m=json.loads(os.environ['BODY'])
assert m['available'] is False and 'No business case is recorded' in m['reason'], m
print('finance model refuses without a business case, reason named')
PY
R=$(rpc "$PLANNER" create_case_business_case '{"p_case_id":"'"$CASE"'","p_case_ref":"SMOKE2-BC-01","p_title":"Crusher liner reliability case","p_driver":"reliability","p_discount_rate":0.08,"p_discount_rate_source":"  "}')
expect_err "$R" 'nobody owns'
R=$(rpc "$PLANNER" create_case_business_case '{"p_case_id":"'"$CASE"'","p_case_ref":"SMOKE2-BC-01","p_title":"Crusher liner reliability case","p_driver":"reliability","p_discount_rate":0.08,"p_discount_rate_source":"Corporate WACC memo FY26, treasury"}')
noerr "$R"; BC=$(printf '%s' "$R"|field business_case_id); test -n "$BC"
FM=$(rpc "$PLANNER" get_case_finance_model '{"p_case_id":"'"$CASE"'"}')
BODY="$FM" python3 - <<'PY'
import json,os
m=json.loads(os.environ['BODY'])
assert m['available'] is True and m['npvInputsComplete'] is False
assert any('no options with dated cash flows' in r for r in m['refusals']), m['refusals']
print('NPV refusal named until dated flows exist:', m['refusals'][0][:60])
PY
R=$(rpc "$PLANNER" record_value_hypothesis '{"p_business_case_id":'"$BC"',"p_spend":4500000,"p_effect":"eliminate 120 h/year of unplanned liner downtime","p_effect_quantity":120,"p_effect_unit":"h/year","p_value_per_year":1500000,"p_basis":"tiny"}')
expect_err "$R" 'slogan'
R=$(rpc "$PLANNER" record_value_hypothesis '{"p_business_case_id":'"$BC"',"p_spend":4500000,"p_effect":"eliminate 120 h/year of unplanned liner downtime","p_effect_quantity":120,"p_effect_unit":"h/year","p_value_per_year":1500000,"p_basis":"Downtime ledger FY24-FY26 x contribution margin per operating hour"}')
noerr "$R"
R=$(rpc "$PLANNER" add_business_case_option '{"p_business_case_id":'"$BC"',"p_label":"Replace liner system","p_life_periods":5,"p_cash_flows":[{"period":0,"amount":-4500000},{"period":9,"amount":1500000}]}')
expect_err "$R" 'outside the option'
R=$(rpc "$PLANNER" add_business_case_option '{"p_business_case_id":'"$BC"',"p_label":"Replace liner system","p_life_periods":5,"p_cash_flows":[{"period":0,"amount":-4500000}],"p_contingency":400000}')
expect_err "$R" 'contingency states its basis'
# REPAIR PROOF (economic-honesty finding 1): a flow with an ABSENT period or
# amount key slipped the guard via jsonb_typeof(NULL) and rendered NaN USD.
# Refused now at the RPC and — for every writer — by the schema CHECK.
R=$(rpc "$PLANNER" add_business_case_option '{"p_business_case_id":'"$BC"',"p_label":"Undated flow","p_life_periods":5,"p_cash_flows":[{"amount":-100}]}')
expect_err "$R" 'undated or unquantified flow cannot be discounted'
R=$(rpc "$PLANNER" add_business_case_option '{"p_business_case_id":'"$BC"',"p_label":"Unquantified flow","p_life_periods":5,"p_cash_flows":[{"period":0,"amount":-100},{"period":1}]}')
expect_err "$R" 'undated or unquantified flow cannot be discounted'
OUT=$(sql_must_fail "insert into business_case_options (organization_id, case_id, label, life_periods, cash_flows) values ('$ORG', $BC, 'SMOKE2 malformed direct', 5, '[{\"amount\":-100}]'::jsonb);")
printf '%s' "$OUT" | grep -q 'business_case_options_cash_flows_shape'
echo 'absent-key cash flows refused at the RPC and by the schema CHECK'
R=$(rpc "$PLANNER" add_business_case_option '{"p_business_case_id":'"$BC"',"p_label":"Replace liner system","p_life_periods":5,"p_cash_flows":[{"period":0,"amount":-4500000},{"period":1,"amount":1500000},{"period":2,"amount":1500000},{"period":3,"amount":1500000},{"period":4,"amount":1500000},{"period":5,"amount":1500000}],"p_contingency":400000,"p_contingency_basis":"P50-P80 spread from the FEL2 estimate"}')
noerr "$R"; OPT=$(printf '%s' "$R"|field option_id); test -n "$OPT"
R=$(rpc "$PLANNER" add_business_case_option '{"p_business_case_id":'"$BC"',"p_label":"Do nothing","p_life_periods":5,"p_cash_flows":[{"period":1,"amount":-800000}],"p_is_do_nothing":true}')
noerr "$R"
FM=$(rpc "$PLANNER" get_case_finance_model '{"p_case_id":"'"$CASE"'"}')
BODY="$FM" python3 - <<'PY'
import json,os
m=json.loads(os.environ['BODY'])
assert m['npvInputsComplete'] is True and m['refusals']==[]
assert m['hypothesis']['valuePerYear']==1500000
print('inputs complete; hypothesis machine-readable; kernel computes client-side')
PY

echo '— 6. viability floor: basis mandatory, revisable, never removable —'
R=$(rpc "$PLANNER" set_case_viability_floor '{"p_business_case_id":'"$BC"',"p_floor":1000000,"p_basis":"Board hurdle memo: below 1.0M NPV the case does not clear WACC"}')
expect_err "$R" 'governance or engineering role'
R=$(rpc "$MANAGER" set_case_viability_floor '{"p_business_case_id":'"$BC"',"p_floor":1000000,"p_basis":"short"}')
expect_err "$R" 'basis'
R=$(rpc "$MANAGER" set_case_viability_floor '{"p_business_case_id":'"$BC"',"p_floor":1000000,"p_basis":"Board hurdle memo FY26: below 1.0M NPV the case does not clear WACC"}')
noerr "$R"
R=$(rpc "$MANAGER" set_case_viability_floor '{"p_business_case_id":'"$BC"',"p_floor":null,"p_basis":"trying to remove the tripwire silently should be refused"}')
expect_err "$R" 'never removed'

echo '— 7. assumption family + deterministic monitoring (D2.06/D2.07/D3.30) —'
R=$(rpc "$PLANNER" record_case_assumption '{"p_case_id":"'"$CASE"'","p_assumption":{"statement":"SMOKE2 works only if production gain >= 5.2%","trigger_for_review":"quarterly production reconciliation","owner_id":"'"$OWNER"'","business_case_id":'"$BC"',"threshold_parameter":"smoke2_production_gain_pct","threshold_comparator":">=","threshold_value":5.2,"threshold_unit":"%"}}')
expect_err "$R" 'alarm wired to nothing'
R=$(rpc "$PLANNER" upsert_financial_assumption '{"p_key":"smoke2_production_gain_pct","p_label":"SMOKE2 production gain","p_value":5.6,"p_unit":"%","p_source":""}')
expect_err "$R" 'number somebody liked'
D2AGO=$(date -v-2d +%Y-%m-%d 2>/dev/null || date -d '2 days ago' +%Y-%m-%d)
R=$(rpc "$PLANNER" upsert_financial_assumption '{"p_key":"smoke2_production_gain_pct","p_label":"SMOKE2 production gain","p_value":5.6,"p_unit":"%","p_source":"FY26 metallurgical balance, plant engineer","p_effective_from":"'"$D2AGO"'"}')
noerr "$R"
# a decision the assumption underpins (D3.30 reopening target)
R=$(rpc "$PLANNER" create_case_decision '{"p_case_id":"'"$CASE"'","p_question":"SMOKE2: proceed with the liner replacement concept?"}')
noerr "$R"; DEC=$(printf '%s' "$R"|field decision_id); test -n "$DEC"
R=$(rpc "$PLANNER" record_case_assumption '{"p_case_id":"'"$CASE"'","p_assumption":{"statement":"SMOKE2 works only if production gain >= 5.2%","trigger_for_review":"quarterly production reconciliation","owner_id":"'"$OWNER"'","business_case_id":'"$BC"',"threshold_parameter":"smoke2_production_gain_pct","threshold_comparator":">=","threshold_value":5.2,"threshold_unit":"%","dependencies":[{"subject_type":"decision","subject_id":"'"$DEC"'"}]}}')
noerr "$R"; ASSUM=$(printf '%s' "$R"|field assumption_id); IND=$(printf '%s' "$R"|field indicator_id)
test -n "$ASSUM"; test -n "$IND"
test "$(psqlc "select direction from risk_indicators where id='$IND'")" = "lower_is_worse"
# above the threshold: observation recorded, nothing invalidated
R=$(rpc "$PLANNER" upsert_financial_assumption '{"p_key":"smoke2_production_gain_pct","p_label":"SMOKE2 production gain","p_value":5.4,"p_unit":"%","p_source":"Q3 reconciliation, plant engineer","p_effective_from":"'"$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d yesterday +%Y-%m-%d)"'"}')
noerr "$R"
test "$(printf '%s' "$R"|field threshold_observations)" = "1"
test "$(printf '%s' "$R"|python3 -c "import json,sys; print(len(json.load(sys.stdin)['threshold_violations']))")" = "0"
test "$(psqlc "select status from risk_assumptions where id='$ASSUM'")" = "active"
# below the threshold: deterministic invalidation + D3.30 reopening
R=$(rpc "$PLANNER" upsert_financial_assumption '{"p_key":"smoke2_production_gain_pct","p_label":"SMOKE2 production gain","p_value":4.9,"p_unit":"%","p_source":"Q4 reconciliation, plant engineer"}')
noerr "$R"
test "$(printf '%s' "$R"|python3 -c "import json,sys; print(len(json.load(sys.stdin)['threshold_violations']))")" = "1"
test "$(psqlc "select status from risk_assumptions where id='$ASSUM'")" = "invalidated"
test "$(psqlc "select current_state from risk_indicators where id='$IND'")" = "critical"
test "$(psqlc "select reassessment_required::text from decisions where id='$DEC'")" = "true"
test "$(psqlc "select count(*) from risk_indicator_observations where indicator_id='$IND'")" = "2"
echo 'threshold chain: declared -> indicator -> observation -> invalidation -> decision reopened'

echo '— 8. value evaluations + the recorded-only trajectory (D2.02) —'
R=$(rpc "$PLANNER" record_case_value_evaluation '{"p_case_id":"'"$CASE"'","p_option_id":999999,"p_expected_value":1489065,"p_value_basis":"NPV of the replace option at the recorded WACC","p_uncertainty_level":"moderate"}')
expect_err "$R" 'must be one of this business case'
R=$(rpc "$PLANNER" record_case_value_evaluation '{"p_case_id":"'"$CASE"'","p_option_id":'"$OPT"',"p_expected_value":1489065,"p_value_basis":"short","p_uncertainty_level":"moderate"}')
expect_err "$R" 'liability'
R=$(rpc "$PLANNER" record_case_value_evaluation '{"p_case_id":"'"$CASE"'","p_option_id":'"$OPT"',"p_expected_value":1489065,"p_value_basis":"NPV of the replace option at the recorded corporate WACC (kernel develop-value/1)","p_uncertainty_level":"moderate","p_computed":{"npv":1489065.11,"irr":0.199,"paybackPeriods":3}}')
noerr "$R"; EV1=$(printf '%s' "$R"|field evaluation_id); test -n "$EV1"
BODY="$R" python3 - <<'PY'
import json,os
r=json.loads(os.environ['BODY'])
c=r['collapse']
assert c['evaluated'] is True and c['collapsed'] is False, c
assert c['headroom']==489065, c
print('collapse rule evaluated: above floor, headroom carried in the response')
PY
# the frozen inputs are the SERVER's record
test "$(psqlc "select inputs->>'discountRateSource' from lifecycle_evaluations where id='$EV1'")" = "Corporate WACC memo FY26, treasury"
# REPAIR PROOF (tenancy hardening 1): a recorded evaluation is immutable at
# the persistence boundary — an RLS-bypassed simulated client cannot rewrite
# the sold number; a raw service rewrite is admitted AND audited.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update lifecycle_evaluations set expected_value=expected_value+1000000 where id='$EV1';
rollback;")
printf '%s' "$OUT" | grep -q 'A recorded value evaluation is immutable'
EVAUD_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Case-value evaluation on lifecycle_evaluations%'")
psqlc "update lifecycle_evaluations set engine_version=engine_version||' (service touch)' where id='$EV1'" >/dev/null
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Case-value evaluation on lifecycle_evaluations%'")" = "$((EVAUD_B+1))"
echo 'recorded evaluation: client rewrite refused, service rewrite audited'
# link a fake evaluation to a review: refused
G1=$(psqlc "select id from stage_gates where framework_id='$FW' and name like 'G1%'")
C11=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G1 and sort_order=10")
C12=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G1 and sort_order=20")
F1=$(python3 -c "import json;print(json.dumps([{'criterion_text':'$C11','status':'met','evidence':'Problem quantified'},{'criterion_text':'$C12','status':'met','evidence':'Do-nothing loss stated'}]))")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Screens met; linking a foreign evaluation must be refused.\",\"p_findings\":$F1,\"p_evaluation_id\":\"deadbeef-dead-4bad-8bad-deadbeefdead\"}")
expect_err "$R" 'not a value evaluation of this case'
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Both screens met; the recorded evaluation is linked as the G1 point.\",\"p_findings\":$F1,\"p_evaluation_id\":\"$EV1\"}")
noerr "$R"
TRAJ=$(rpc "$PLANNER" get_case_value_trajectory '{"p_case_id":"'"$CASE"'"}')
BODY="$TRAJ" python3 - <<'PY'
import json,os
t=json.loads(os.environ['BODY'])
gates={g['gateName']:g for g in t['gates']}
g1=[g for n,g in gates.items() if n.startswith('G1')][0]
g2=[g for n,g in gates.items() if n.startswith('G2')][0]
assert g1['evaluated'] is True and g1['point']['expectedValue']==1489065, g1
assert g2['evaluated'] is False and g2['note']=='not evaluated at this gate — no review recorded', g2
assert t['sanction'] is None
print('trajectory: ONE recorded point at G1; every other gate says so in words')
PY

echo '— 9. collapse trigger through the canonical store (D2.03) —'
R=$(rpc "$MANAGER" set_case_viability_floor '{"p_business_case_id":'"$BC"',"p_floor":2000000,"p_basis":"Revised board hurdle FY27: strategic reallocation raises the floor to 2.0M"}')
noerr "$R"
R=$(rpc "$PLANNER" record_case_value_evaluation '{"p_case_id":"'"$CASE"'","p_option_id":'"$OPT"',"p_expected_value":1489065,"p_value_basis":"Re-evaluated after the floor revision; same recorded inputs and kernel","p_uncertainty_level":"moderate"}')
noerr "$R"
BODY="$R" python3 - <<'PY'
import json,os
r=json.loads(os.environ['BODY'])
c=r['collapse']
assert c['collapsed'] is True and c.get('already_open') is None, c
assert c['gap']==510935, c
print('collapse: EV below the revised floor; recommendation', c['recommendation_id'][:8])
PY
REC=$(printf '%s' "$R"|python3 -c "import json,sys; print(json.load(sys.stdin)['collapse']['recommendation_id'])")
test "$(psqlc "select status from recommendations where id='$REC'")" = "pending"
test "$(psqlc "select development_case_id from recommendations where id='$REC'")" = "$CASE"
test "$(psqlc "select required_approver_role from recommendations where id='$REC'")" = "executive"
psqlc "select title from recommendations where id='$REC'" | grep -q 'Reconsider sanction'
# every C8 approver field is populated (nothing blank on the contract)
test "$(psqlc "select count(*) from recommendations where id='$REC' and btrim(coalesce(issue,''))<>'' and btrim(coalesce(rationale,''))<>'' and btrim(coalesce(action,''))<>'' and btrim(coalesce(consequence_summary,''))<>'' and btrim(coalesce(alternatives_considered,''))<>'' and required_completion_date is not null and btrim(coalesce(verification_method,''))<>'' and confidence is not null")" = "1"
# a second signal lands on the record, never as a duplicate
R=$(rpc "$PLANNER" record_case_value_evaluation '{"p_case_id":"'"$CASE"'","p_option_id":'"$OPT"',"p_expected_value":1450000,"p_value_basis":"Second below-floor evaluation to prove deduplication of the open signal","p_uncertainty_level":"moderate"}')
noerr "$R"
BODY="$R" python3 - <<'PY'
import json,os
r=json.loads(os.environ['BODY'])
c=r['collapse']
assert c['collapsed'] is True and c['already_open'] is True, c
print('second signal: already_open, no duplicate recommendation')
PY
test "$(psqlc "select count(*) from recommendations where organization_id='$ORG' and development_case_id='$CASE' and title like 'Reconsider sanction%'")" = "1"
WS=$(rpc "$PLANNER" get_development_case '{"p_case_id":"'"$CASE"'"}')
BODY="$WS" python3 - <<'PY'
import json,os
w=json.loads(os.environ['BODY'])
acts=[a for a in w['actions'] if a['title'].startswith('Reconsider sanction')]
assert len(acts)==1 and acts[0]['binding']=='direct', acts
print('the reconsideration renders in the Case Workspace actions section')
PY

echo '— 10. since-sanction delta: both ends or no delta (D2.05) —'
D=$(rpc "$PLANNER" get_since_sanction_delta '{"p_case_id":"'"$CASE"'"}')
BODY="$D" python3 - <<'PY'
import json,os
d=json.loads(os.environ['BODY'])
assert d['available'] is False and 'not sanctioned' in d['reason'], d
print('delta refuses honestly before sanction:', d['reason'][:50])
PY
SANC_LIMIT=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='executive' and action_type='sanction' and status='draft' order by version desc limit 1")
test -n "$SANC_LIMIT"
R=$(rpc "$EXEC" adopt_authority_limit '{"p_id":"'"$SANC_LIMIT"'","p_note":"Adopted for the slice-2 CI transcript from the demo delegation."}')
noerr "$R"
R=$(rpc "$EXEC" sanction_development_case '{"p_case_id":"'"$CASE"'","p_note":"Sanctioned for the slice-2 transcript within the adopted delegation.","p_sanctioned_value":4500000}')
noerr "$R"
R=$(rpc "$PLANNER" record_case_value_evaluation '{"p_case_id":"'"$CASE"'","p_option_id":'"$OPT"',"p_expected_value":1250000,"p_value_basis":"Post-sanction re-evaluation on the Q4 reconciliation and revised gain","p_uncertainty_level":"high"}')
noerr "$R"
D=$(rpc "$PLANNER" get_since_sanction_delta '{"p_case_id":"'"$CASE"'"}')
BODY="$D" python3 - <<'PY'
import json,os
d=json.loads(os.environ['BODY'])
assert d['available'] is True, d
dims={x['dimension']:x for x in d['dimensions']}
assert dims['expected_value']['delta']==-200000, dims['expected_value']
assert dims['viability_floor']['atSanction']==2000000, dims['viability_floor']
assert dims['discount_rate']['delta']==0
assert d['sanctionBaseline']['expectedValue']==1450000
print('delta: -200000 on recorded ends; dimensions diffed; floor anchored')
PY

echo '— 11. benefits: owner mandatory at every boundary (D9.10) —'
R=$(rpc "$PLANNER" record_case_benefit '{"p_case_id":"'"$CASE"'","p_label":"SMOKE2 recovered tonnes","p_expected_value":1500000,"p_unit":"usd","p_expected_date":"'"$DUE"'","p_owner_id":null,"p_basis":"Downtime ledger x margin"}')
expect_err "$R" 'benefit owner'
OUT=$(sql_must_fail "insert into value_metrics (organization_id, development_case_id, metric_type, label, value, unit, status) values ('$ORG','$CASE','projected_annualized_value','SMOKE2 ownerless direct',1,'usd','projected');")
printf '%s' "$OUT" | grep -q 'value_metrics_case_benefit_owner'
FOREIGN=$(psqlc "select id from user_profiles where organization_id<>'$ORG' limit 1")
if [ -n "$FOREIGN" ]; then
  OUT=$(sql_must_fail "insert into value_metrics (organization_id, development_case_id, metric_type, label, value, unit, status, owner_id, expected_date, basis) values ('$ORG','$CASE','projected_annualized_value','SMOKE2 foreign owner',1,'usd','projected','$FOREIGN','$DUE','probe basis text');")
  printf '%s' "$OUT" | grep -q 'does not cross tenants'
fi
# REPAIR PROOF (tenancy hardening 2): an own-org benefit dangling onto
# ANOTHER tenant's case is refused by the membership trigger, direct path
# included.
PORG=$(psqlc "with r as (insert into organizations (name) values ('SMOKE2 probe org') returning id) select id from r")
PCASE=$(psqlc "with r as (insert into development_cases (organization_id, title, lifecycle_type, problem_statement) select '$PORG', 'SMOKE2 probe case', lifecycle_type, 'Foreign-case tenancy probe fixture for the slice-2 transcript.' from development_cases where id='$CASE' returning id) select id from r")
OUT=$(sql_must_fail "insert into value_metrics (organization_id, development_case_id, metric_type, label, value, unit, status, owner_id, expected_date, basis) values ('$ORG','$PCASE','projected_annualized_value','SMOKE2 cross-case direct',1,'usd','projected','$OWNER','$DUE','probe basis text');")
printf '%s' "$OUT" | grep -q "another tenant's development case is refused"
psqlc "delete from organizations where id='$PORG';" >/dev/null
R=$(rpc "$PLANNER" record_case_benefit '{"p_case_id":"'"$CASE"'","p_label":"SMOKE2 recovered tonnes value","p_expected_value":1500000,"p_unit":"usd","p_expected_date":"'"$DUE"'","p_owner_id":"'"$OWNER"'","p_basis":"Downtime ledger FY24-26 x contribution margin"}')
noerr "$R"
test "$(psqlc "select status from value_metrics where organization_id='$ORG' and label='SMOKE2 recovered tonnes value'")" = "projected"

echo '— 12. the workspace read carries the whole value spine (D13.04) —'
WS=$(rpc "$PLANNER" get_development_case '{"p_case_id":"'"$CASE"'"}')
BODY="$WS" python3 - <<'PY'
import json,os
w=json.loads(os.environ['BODY'])
assert w['objective']['description']=='SMOKE2 crusher availability objective'
assert w['objective']['targetValue']==92 and w['objective']['unit']=='%'
sc=w['successContract']
assert sc['status']=='recorded' and sc['dimensionsTotal']==11
dims={o['dimension'] for o in sc['outcomes']}
assert dims=={'business','availability'}, dims
ram=[o for o in sc['outcomes'] if o['ramTarget']][0]
assert ram['ramTarget']['targetAvailability']==0.96 and ram['targetValue'] is None
bc=w['businessCases'][0]
assert bc['caseRef']=='SMOKE2-BC-01' and bc['viability']['floor']==2000000
assert bc['hypothesis']['spend']==4500000
assums=[a for a in w['caseAssumptions'] if a['statement'].startswith('SMOKE2')]
assert assums and assums[0]['status']=='invalidated' and assums[0]['threshold']['parameter']=='smoke2_production_gain_pct'
bens=[b for b in w['benefits'] if b['label']=='SMOKE2 recovered tonnes value']
assert bens and bens[0]['owner'] is not None and bens[0]['basis'] is not None
assert isinstance(w['schedule'], list)  # the P6 section is intact in v4
print('workspace v4: objective + contract (RAM by reference) + business case + assumptions + benefits + schedule')
PY

echo 'DEVELOP SLICE 2 SMOKE: ALL TRANSCRIPT STEPS PASSED'

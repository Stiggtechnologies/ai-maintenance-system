#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 4B — Performance: rules of credit, earned value, the
# estimate basis, progress integrity and the §51 forecast. Every step is a
# live transcript against a real local database.
#
# THE THING THIS TRANSCRIPT EXISTS TO PROVE: an earned-value number with no
# basis is worse than no number. So the metrics are watched coming into
# existence ONE INPUT AT A TIME, and at every stage the metrics that cannot
# yet be computed REFUSE BY NAME instead of defaulting.
#
# Steps:
#   1  rules of credit (D5.06): weights that do not sum to 100 refused for
#      every writer; a step with no label refused; two rules for one work
#      type refused; §70 refuses the AI identity BY NAME; a direct client
#      write refused and a service write admitted AND audited.
#   2  reporting periods and the planned curve (D5.06, §70): a second open
#      period refused; a non-finite planned percent refused; a curve that
#      goes down refused; setting the curve refused to the AI identity as a
#      BASELINE act; a closed period immutable.
#   3  progress claims (D5.06): a claim with no applicable rule of credit
#      REFUSED BY NAME; a claim names a STEP and the percent comes back
#      DERIVED; a caller-supplied percent has no path at all; a second claim
#      in one period refused; §70 refuses the AI identity.
#   4  the earned value suite (D5.05): EV, PV, AC, CPI, SPI, ES, EAC, VAC —
#      each refusing by name as its own input is missing, each computing as
#      the input arrives; an empty claim set is NOT zero; a missing actual is
#      NOT zero; EAC names its formula and refuses rather than swapping it;
#      double counting an element and its subtree refused by name.
#   5  the estimate basis (D5.16) and its confidence (D5.17): all eight
#      dimensions demanded one at a time by name; UNRATED before a basis and
#      never "LOW"; the rating derived, not declared; the basis immutable.
#   6  progress integrity (D5.20): no evidence → NO rating and the refusal
#      says absence of evidence is not confirmation; the lowest source binds
#      and is named; coverage travels with the rating; the spec's own
#      92%-vs-71% sentence produced from data; §70 refuses the AI identity.
#   7  forecast confidence (D5.07/D5.32, §51): deterministic cost and
#      schedule shown, P50 and P80 ABSENT with a reason naming what is
#      missing, confidence travelling with the number, and the run recording
#      the absence as a refusal.
#   8  performance trending (D5.06): the trend reads runs recorded while each
#      period was current, leaves a period with no run as a GAP, and records
#      a run whose input refs are the runs it read.
#   9  D5.04's eleventh structure: `progress` has a home, refuses with no
#      rule of credit, and can be captured against an approved baseline.
#  10  lineage (D11.29): every 4B calculation records a run including its
#      refusals; a run is immutable to clients; TRUNCATE refused on all four
#      new ledgers.
#  11  tenancy (the gap that let a cross-tenant read ship): every
#      client-callable 4B read and act probed as a FOREIGN TENANT and as an
#      ORPHAN JWT holder, and the internal estimate-basis helper proved
#      callable by nobody and org-gated in its own body.
#
# Run: supabase start && scripts/ci-develop-slice4b-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-4b smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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
jqp(){ BODY="$1" EXPR="$2" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
print(eval(os.environ['EXPR'], {'x': x, 'json': json}))
PY
}
# A named metric's value / refusal out of the earned-value payload.
metric(){ BODY="$1" KEY="$2" WHAT="$3" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
m=x['metrics'][os.environ['KEY']]
v=m[os.environ['WHAT']]
print('' if v is None else v)
PY
}

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$TECH"

MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
test -n "$MANAGER_ID"
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
test -n "$PLANNER_ID"

# The AI-operator identity, seeded exactly as the 3B/3C/3D/4A transcripts
# seed it, so the smokes share one fixture in CI and each still stands alone.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
declare v_uid uuid := '99999999-9999-4999-8999-999999999999';
begin
  if not exists (select 1 from auth.users where email = 'smoke-aibot@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke-aibot@syncai.ca',
      extensions.crypt('AiBot123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'Smoke AI operator'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  update auth.users set
    confirmation_token = coalesce(confirmation_token, ''),
    recovery_token = coalesce(recovery_token, ''),
    email_change = coalesce(email_change, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    email_change_token_current = coalesce(email_change_token_current, ''),
    phone_change = coalesce(phone_change, ''),
    phone_change_token = coalesce(phone_change_token, ''),
    reauthentication_token = coalesce(reauthentication_token, '')
  where id = v_uid;
  if not exists (select 1 from auth.identities where user_id = v_uid) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke-aibot@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_uid, '11111111-1111-1111-1111-111111111111', 'smoke-aibot@syncai.ca', 'ai_admin')
  on conflict (id) do update set role = 'ai_admin',
    organization_id = '11111111-1111-1111-1111-111111111111';
end $seed$;
PSQL
AIBOT=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#')
test -n "$AIBOT"

# Idempotent re-run. The 4B ledgers all refuse client deletes by design, so
# the service path is used and the triggers audit it — which is the posture,
# not a workaround.
CLEAN="select id from development_cases where title like 'SMOKE4B %'"
psqlc "delete from calculation_runs where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_progress_evidence where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_progress_claims where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_progress_periods where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_rules_of_credit where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_estimate_basis where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from controls_baseline_structures where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from shutdown_events where organization_id='$ORG' and development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_cost_items where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from development_cases where title like 'SMOKE4B %';" >/dev/null
psqlc "delete from business_cases where case_ref like 'SMOKE4B%';" >/dev/null

# ── the substrate this slice computes ON TOP OF (Slice 4A) ────────────────
BODY=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE4B performance case","p_problem_statement":"The engineering contractor reports percent complete monthly and nothing in the system can tell whether the reported figure is earned or asserted.","p_lifecycle_type":"reliability_improvement"}')
noerr "$BODY"; CASE=$(printf '%s' "$BODY" | field case_id); test -n "$CASE"

for E in '{"wbs_code":"1","title":"Engineering","scope_description":"All engineering scope for the crusher upgrade"}' \
         '{"wbs_code":"1.1","parent_wbs_code":"1","title":"Mechanical design","scope_description":"Mechanical design deliverables for the liner set"}' \
         '{"wbs_code":"1.2","parent_wbs_code":"1","title":"Electrical design","scope_description":"Electrical design deliverables for the drive upgrade"}' \
         '{"wbs_code":"2","title":"Construction","scope_description":"All construction scope for the crusher upgrade"}' \
         '{"wbs_code":"3","title":"Civil works","scope_description":"Civil works: typed, but with no rule of credit recorded for its type"}' \
         '{"wbs_code":"4","title":"Untyped package","scope_description":"A package nobody has said what kind of work it is"}'; do
  BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":$E}")
  noerr "$BODY"
done
BODY=$(rpc "$PLANNER" record_cbs_code "{\"p_case_id\":\"$CASE\",\"p_code\":{\"cbs_code\":\"SMOKE4B-C100\",\"title\":\"Engineering hours\",\"cost_type\":\"labour\"}}")
noerr "$BODY"
for A in '{"control_account_ref":"SMOKE4B-CA1","wbs_code":"1.1","cbs_code":"SMOKE4B-C100"}' \
         '{"control_account_ref":"SMOKE4B-CA2","wbs_code":"1.2","cbs_code":"SMOKE4B-C100"}' \
         '{"control_account_ref":"SMOKE4B-CA3","wbs_code":"2","cbs_code":"SMOKE4B-C100"}'; do
  BODY=$(rpc "$PLANNER" designate_control_account "{\"p_case_id\":\"$CASE\",\"p_account\":$(python3 -c "import json,sys; d=json.loads('''$A'''); d['accountable_owner_id']='$MANAGER_ID'; print(json.dumps(d))")}")
  noerr "$BODY"
done

echo "── 1. rules of credit (D5.06) ───────────────────────────────────────────"

# The earned-value suite has NOTHING yet, and says so rather than reporting
# zeros. This is the baseline every later assertion is measured against.
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
grep -qi 'no cost line is recorded' <<<"$(metric "$BODY" ev refusal)$(jqp "$BODY" "x['bacRefusal']")"
test "$(metric "$BODY" cpi value)" = ""
echo "   an empty case reports no metrics and names why — not a CPI of 1.0"

# A rule whose weights do not add to the whole caps every element it governs.
BODY=$(rpc "$PLANNER" record_rule_of_credit "{\"p_case_id\":\"$CASE\",\"p_rule\":{\"rule_ref\":\"SMOKE4B-ROC1\",\"title\":\"Engineering deliverable credit\",\"applies_to\":\"engineering_deliverable\",\"basis\":\"Contract Schedule G milestone weighting\",\"steps\":[{\"step\":\"Issued for review\",\"weight\":30},{\"step\":\"Issued for approval\",\"weight\":30}]}}")
expect_err "$BODY" '60 percent of credit between them, not 100'

# A step with no label cannot be claimed against by name.
BODY=$(rpc "$PLANNER" record_rule_of_credit "{\"p_case_id\":\"$CASE\",\"p_rule\":{\"rule_ref\":\"SMOKE4B-ROC1\",\"title\":\"Engineering deliverable credit\",\"applies_to\":\"engineering_deliverable\",\"basis\":\"Contract Schedule G milestone weighting\",\"steps\":[{\"step\":\"x\",\"weight\":100}]}}")
expect_err "$BODY" 'has no label'

# A non-finite weight is refused by explicit literal comparison.
BODY=$(rpc "$PLANNER" record_rule_of_credit "{\"p_case_id\":\"$CASE\",\"p_rule\":{\"rule_ref\":\"SMOKE4B-ROC1\",\"title\":\"Engineering deliverable credit\",\"applies_to\":\"engineering_deliverable\",\"basis\":\"Contract Schedule G milestone weighting\",\"steps\":[{\"step\":\"Issued for review\",\"weight\":\"NaN\"},{\"step\":\"Complete\",\"weight\":100}]}}")
expect_err "$BODY" 'not a finite number'

# §70: the convention decides the answer before any claim is made.
BODY=$(rpc "$AIBOT" record_rule_of_credit "{\"p_case_id\":\"$CASE\",\"p_rule\":{\"rule_ref\":\"SMOKE4B-ROCAI\",\"title\":\"AI-authored credit\",\"applies_to\":\"engineering_deliverable\",\"basis\":\"Proposed by the methodology agent\",\"steps\":[{\"step\":\"Issued\",\"weight\":100}]}}")
expect_err "$BODY" 'progress judgement'
expect_err "$BODY" '§70'
echo "   §70 refuses the AI identity the convention, not just the claim"

BODY=$(rpc "$TECH" record_rule_of_credit "{\"p_case_id\":\"$CASE\",\"p_rule\":{\"rule_ref\":\"SMOKE4B-ROC1\",\"title\":\"Engineering deliverable credit\",\"applies_to\":\"engineering_deliverable\",\"basis\":\"Contract Schedule G milestone weighting\",\"steps\":[{\"step\":\"Issued for review\",\"weight\":30},{\"step\":\"Issued for approval\",\"weight\":30},{\"step\":\"Issued for construction\",\"weight\":40}]}}")
expect_err "$BODY" 'requires a planning, engineering or governance role'

BODY=$(rpc "$PLANNER" record_rule_of_credit "{\"p_case_id\":\"$CASE\",\"p_rule\":{\"rule_ref\":\"SMOKE4B-ROC1\",\"title\":\"Engineering deliverable credit\",\"applies_to\":\"engineering_deliverable\",\"basis\":\"Contract Schedule G milestone weighting\",\"steps\":[{\"step\":\"Issued for review\",\"weight\":30},{\"step\":\"Issued for approval\",\"weight\":30},{\"step\":\"Issued for construction\",\"weight\":40}]}}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field step_count)" = "3"

# Two rules for one work type would make "which rule applies" a choice made
# at claim time, which is a percent chosen at claim time.
BODY=$(rpc "$PLANNER" record_rule_of_credit "{\"p_case_id\":\"$CASE\",\"p_rule\":{\"rule_ref\":\"SMOKE4B-ROC1B\",\"title\":\"A second engineering rule\",\"applies_to\":\"engineering_deliverable\",\"basis\":\"A competing weighting nobody agreed\",\"steps\":[{\"step\":\"Done\",\"weight\":100}]}}")
expect_err "$BODY" 'a choice made at claim time'

# A direct client write is refused; a direct SERVICE write is admitted AND
# audited, and the weight wall holds for it too.
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
  insert into project_rules_of_credit (organization_id, development_case_id, rule_ref, title, applies_to, steps, basis)
  values ('$ORG','$CASE','SMOKE4B-DIRECT','Direct','construction_work_package','[{\"step\":\"All of it\",\"weight\":100}]','Written straight into the table'); rollback;")
grep -qi 'written through record_rule_of_credit' <<<"$OUT"
OUT=$(sql_must_fail "insert into project_rules_of_credit (organization_id, development_case_id, rule_ref, title, applies_to, steps, basis)
  values ('$ORG','$CASE','SMOKE4B-BADSUM','Bad sum','construction_work_package','[{\"step\":\"Half of it\",\"weight\":50}]','Service write with weights that do not add up');")
grep -qi 'not 100' <<<"$OUT"
SEC_BEFORE=$(psqlc "select count(*) from security_events")
psqlc "insert into project_rules_of_credit (organization_id, development_case_id, rule_ref, title, applies_to, steps, basis)
  values ('$ORG','$CASE','SMOKE4B-SVC','Service authored','fabrication_lot','[{\"step\":\"Released\",\"weight\":100}]','Written by a service caller outside the RPC');" >/dev/null
test "$(psqlc "select count(*) from security_events")" -gt "$SEC_BEFORE"
test "$(psqlc "select count(*) from security_events where detail like '%SMOKE4B-SVC%'")" -ge "1"
# ...and DELETING one is walled too. A rule deleted takes the RPC's own
# immutability refusal with it, so a differently weighted rule can take its
# place under the same work type with nothing recording the swap.
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
  delete from project_rules_of_credit where development_case_id='$CASE' and rule_ref='SMOKE4B-SVC'; rollback;")
grep -qi 'a rule of credit is not deletable' <<<"$OUT"
SEC_BEFORE=$(psqlc "select count(*) from security_events where detail like '%was DELETED by a service caller%'")
psqlc "delete from project_rules_of_credit where development_case_id='$CASE' and rule_ref='SMOKE4B-SVC';" >/dev/null
test "$(psqlc "select count(*) from security_events where detail like '%was DELETED by a service caller%'")" -gt "$SEC_BEFORE"
# Put it back — the rest of the transcript claims under it.
psqlc "insert into project_rules_of_credit (organization_id, development_case_id, rule_ref, title, applies_to, steps, basis)
  values ('$ORG','$CASE','SMOKE4B-SVC','Service authored','fabrication_lot','[{\"step\":\"Released\",\"weight\":100}]','Written by a service caller outside the RPC');" >/dev/null
echo "   a rule of credit is authored through the one door, and every other writer is walled or audited — including DELETE"

echo "── 1b. the work type lives on the ELEMENT, not in the claim (D5.06) ─────"

# THE HOLE THIS CLOSES: the percent is derived from the rule, the rule is
# resolved from the work type — so a claim that could NAME its work type
# would let the claimant pick the convention, and picking the convention is
# picking the percent. Recorded on the element, by its own §70-walled act.
BODY=$(rpc "$AIBOT" set_wbs_element_work_type "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1.1\",\"work_type\":\"engineering_deliverable\",\"basis\":\"The agent inferred it from the element title\"}}")
expect_err "$BODY" '§70'
expect_err "$BODY" 'progress judgement one level up'
BODY=$(rpc "$TECH" set_wbs_element_work_type "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1.1\",\"work_type\":\"engineering_deliverable\",\"basis\":\"Contract Schedule G work breakdown\"}}")
expect_err "$BODY" 'requires a planning, engineering or governance role'
BODY=$(rpc "$PLANNER" set_wbs_element_work_type "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1.1\",\"work_type\":\"engineering_deliverable\",\"basis\":\"short\"}}")
expect_err "$BODY" 'a percent complete nobody can defend'
BODY=$(rpc "$PLANNER" set_wbs_element_work_type "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1.1\",\"work_type\":\"whatever_earns_most\",\"basis\":\"Contract Schedule G work breakdown\"}}")
expect_err "$BODY" 'is not one of the recorded work types'
for WT in "1:engineering_deliverable" "1.1:engineering_deliverable" \
          "1.2:engineering_deliverable" "2:fabrication_lot" \
          "3:construction_work_package"; do
  BODY=$(rpc "$PLANNER" set_wbs_element_work_type "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"${WT%%:*}\",\"work_type\":\"${WT##*:}\",\"basis\":\"Contract Schedule G work breakdown, section 4\"}}")
  noerr "$BODY"
done
# Element 4 is deliberately left untyped: a claim against it must refuse.
test "$(psqlc "select work_type is null from project_wbs_elements where development_case_id='$CASE' and wbs_code='4'")" = "t"
echo "   the work type is recorded on the element, refused to the AI identity BY NAME, and needs a basis"

echo "── 2. reporting periods and the planned curve (D5.06, §70) ──────────────"

BODY=$(rpc "$PLANNER" open_progress_period "{\"p_case_id\":\"$CASE\",\"p_period\":{\"period_ref\":\"SMOKE4B-M01\"}}")
expect_err "$BODY" 'a period with no end is not a period'

BODY=$(rpc "$PLANNER" open_progress_period "{\"p_case_id\":\"$CASE\",\"p_period\":{\"period_ref\":\"SMOKE4B-M01\",\"period_end\":\"2026-01-31\"}}")
noerr "$BODY"; P1=$(printf '%s' "$BODY" | field period_id); test -n "$P1"
grep -qi 'planned value refuses' <<<"$(printf '%s' "$BODY" | field note)"

BODY=$(rpc "$AIBOT" open_progress_period "{\"p_case_id\":\"$CASE\",\"p_period\":{\"period_ref\":\"SMOKE4B-AI\",\"period_end\":\"2026-03-31\"}}")
expect_err "$BODY" '§70'
expect_err "$BODY" 'moves the data date'
echo "   §70 refuses the AI identity the next period too — opening one un-fixes the position closing the last one fixed"

BODY=$(rpc "$PLANNER" open_progress_period "{\"p_case_id\":\"$CASE\",\"p_period\":{\"period_ref\":\"SMOKE4B-M02\",\"period_end\":\"2026-02-28\"}}")
expect_err "$BODY" 'is still open on this case'
echo "   two open periods would split the claims — refused by name"

# §70: the planned curve IS the time-phased baseline.
BODY=$(rpc "$AIBOT" set_period_planned_progress "{\"p_period_id\":\"$P1\",\"p_percent\":\"20\",\"p_basis\":\"Level 3 schedule spend curve\"}")
expect_err "$BODY" 'SETTING A BASELINE'
expect_err "$BODY" '§70'
BODY=$(rpc "$PLANNER" set_period_planned_progress "{\"p_period_id\":\"$P1\",\"p_percent\":\"20\",\"p_basis\":\"Level 3 schedule spend curve\"}")
expect_err "$BODY" 'requires a governance or engineering role'
BODY=$(rpc "$MANAGER" set_period_planned_progress "{\"p_period_id\":\"$P1\",\"p_percent\":\"Infinity\",\"p_basis\":\"Level 3 schedule spend curve\"}")
expect_err "$BODY" 'must be a finite number'
BODY=$(rpc "$MANAGER" set_period_planned_progress "{\"p_period_id\":\"$P1\",\"p_percent\":\"20\",\"p_basis\":\"short\"}")
expect_err "$BODY" 'measured against a guess'
BODY=$(rpc "$MANAGER" set_period_planned_progress "{\"p_period_id\":\"$P1\",\"p_percent\":\"20\",\"p_basis\":\"Level 3 schedule spend curve, rev C\"}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field planned_percent_complete)" = "20"
echo "   the planned curve is a baseline act: AI refused BY NAME, non-finite refused, basis mandatory"

echo "── 3. progress claims (D5.06) ───────────────────────────────────────────"

# THE REFUSAL THIS ROW EXISTS FOR: no applicable rule of credit → no claim.
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P1\",\"p_claim\":{\"wbs_code\":\"3\",\"step_index\":\"1\",\"basis\":\"Foundations poured on the north side\"}}")
expect_err "$BODY" 'no rule of credit is recorded for construction_work_package'
expect_err "$BODY" 'a number chosen, not a number earned'
echo "   progress claimed with no applicable rule of credit is REFUSED, not credited"

# ...and an element with NO RECORDED WORK TYPE cannot be claimed against at
# all: resolving the rule from a type supplied with the claim would let the
# claimant pick the convention.
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P1\",\"p_claim\":{\"wbs_code\":\"4\",\"step_index\":\"1\",\"basis\":\"Claiming against a package nobody has typed\"}}")
expect_err "$BODY" 'carries no recorded work type'
expect_err "$BODY" 'picking the convention is picking the percent'

# ...and a claim that NAMES a work type other than the element's is refused
# rather than quietly resolving to the rule the caller nominated. Without
# this, a mechanical design package could be put at 100 percent under a
# single-step owner rule and nothing on screen would say where the credit
# came from.
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P1\",\"p_claim\":{\"wbs_code\":\"1.1\",\"applies_to\":\"fabrication_lot\",\"step_index\":\"1\",\"basis\":\"Trying to earn 100 percent under the single-step lot rule\"}}")
expect_err "$BODY" 'is recorded as engineering_deliverable, not fabrication_lot'
# The same wall holds for a SERVICE caller writing the row directly: the
# trigger resolves the rule from the element, not from the row.
OUT=$(sql_must_fail "insert into project_progress_claims (organization_id, development_case_id, period_id, wbs_element_id, rule_id, step_index, step_label, claimed_percent, basis)
       select '$ORG','$CASE','$P1', w.id, r.id, 1, 'x', 0, 'A service caller nominating a more generous rule'
         from project_wbs_elements w, project_rules_of_credit r
        where w.development_case_id='$CASE' and w.wbs_code='1.1'
          and r.development_case_id='$CASE' and r.rule_ref='SMOKE4B-SVC';")
grep -qi 'not under one nominated at claim time' <<<"$OUT"
echo "   the rule is resolved from the ELEMENT for every writer — a claim cannot nominate the convention it earns under"

BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P1\",\"p_claim\":{\"wbs_code\":\"NOPE\",\"step_index\":\"1\",\"basis\":\"Nothing resolves this code\"}}")
expect_err "$BODY" 'does not resolve on this case'

BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P1\",\"p_claim\":{\"wbs_code\":\"1.1\",\"step_index\":\"9\",\"basis\":\"A step this rule does not have\"}}")
expect_err "$BODY" 'step 9 does not exist in it'

BODY=$(rpc "$AIBOT" record_progress_claim "{\"p_period_id\":\"$P1\",\"p_claim\":{\"wbs_code\":\"1.1\",\"step_index\":\"1\",\"basis\":\"The agent read the transmittal log\"}}")
expect_err "$BODY" 'cannot record a progress judgement'

# THE PERCENT IS DERIVED. The claim named step 2; 30 + 30 = 60 comes back
# from the rule, and there is no parameter through which 92 could be typed.
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P1\",\"p_claim\":{\"wbs_code\":\"1.1\",\"step_index\":\"2\",\"claimed_percent\":\"92\",\"basis\":\"IFA transmittal 4471 acknowledged by the owner engineer\"}}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field claimed_percent)" = "60"
test "$(psqlc "select claimed_percent from project_progress_claims where period_id='$P1' and wbs_element_id=(select id from project_wbs_elements where development_case_id='$CASE' and wbs_code='1.1')")" = "60"
echo "   a claim names a STEP; the 92 percent the caller sent was ignored and 60 was derived from the rule"

BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P1\",\"p_claim\":{\"wbs_code\":\"1.1\",\"step_index\":\"3\",\"basis\":\"A second position in one period\"}}")
expect_err "$BODY" 'different facts and the ledger must be able to tell them apart'

# Even a service caller cannot choose the percent: the trigger re-derives it.
psqlc "insert into project_progress_claims (organization_id, development_case_id, period_id, wbs_element_id, rule_id, step_index, step_label, claimed_percent, basis)
       select '$ORG','$CASE','$P1', w.id, r.id, 1, 'forged', 99, 'A service caller trying to choose the number'
         from project_wbs_elements w, project_rules_of_credit r
        where w.development_case_id='$CASE' and w.wbs_code='1.2'
          and r.development_case_id='$CASE' and r.rule_ref='SMOKE4B-ROC1';" >/dev/null
test "$(psqlc "select claimed_percent from project_progress_claims where period_id='$P1' and wbs_element_id=(select id from project_wbs_elements where development_case_id='$CASE' and wbs_code='1.2')")" = "30"
test "$(psqlc "select step_label from project_progress_claims where period_id='$P1' and wbs_element_id=(select id from project_wbs_elements where development_case_id='$CASE' and wbs_code='1.2')")" = "Issued for review"
echo "   a service caller writing 99 directly still stores 30 — the derivation is the database's, not one RPC's"

echo "── 4. the earned value suite (D5.05) ────────────────────────────────────"

# STAGE A — claims exist, no cost lines. EV has no budget to be a share of.
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
grep -qi 'no cost line is recorded' <<<"$(metric "$BODY" ev refusal)"
test "$(metric "$BODY" eac value)" = ""

BODY=$(rpc "$PLANNER" create_case_business_case "{\"p_case_id\":\"$CASE\",\"p_case_ref\":\"SMOKE4B-BC\",\"p_title\":\"Crusher upgrade engineering\",\"p_driver\":\"reliability\",\"p_currency\":\"CAD\",\"p_discount_rate\":0.08,\"p_discount_rate_source\":\"Corporate treasury WACC memo 2026-Q2\"}")
noerr "$BODY"; BCASE=$(printf '%s' "$BODY" | field business_case_id)
BODY=$(rpc "$PLANNER" add_business_case_option "{\"p_business_case_id\":$BCASE,\"p_label\":\"Do the engineering in house\",\"p_life_periods\":10,\"p_cash_flows\":[{\"period\":0,\"amount\":-100000},{\"period\":1,\"amount\":40000}]}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4B-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4B-C100\",\"description\":\"Mechanical design hours\",\"basis\":\"Estimated from the 2025 analogue package\",\"baseline_cost\":\"60000\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4B-CI2\",\"wbs_code\":\"1.2\",\"cbs_code\":\"SMOKE4B-C100\",\"description\":\"Electrical design hours\",\"basis\":\"Estimated from the 2025 analogue package\",\"baseline_cost\":\"40000\"}}")
noerr "$BODY"

# STAGE B — BAC 100000, EV = 60% of 60000 + 30% of 40000 = 48000.
#           PV = 20% of 100000 = 20000. AC is ABSENT, so CPI/EAC/VAC refuse.
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['bac']")" = "100000"
test "$(jqp "$BODY" "round(float(x['metrics']['ev']['value']), 2)")" = "48000.0"
test "$(jqp "$BODY" "round(float(x['metrics']['pv']['value']), 2)")" = "20000.0"
test "$(metric "$BODY" ac value)" = ""
grep -qi 'nothing has been booked yet' <<<"$(metric "$BODY" ac refusal)"
grep -qi 'infinite cost efficiency' <<<"$(metric "$BODY" ac refusal)"
test "$(metric "$BODY" cpi value)" = ""
test "$(metric "$BODY" eac value)" = ""
test "$(metric "$BODY" vac value)" = ""
grep -qi 'does not fall back to AC + (BAC - EV)' <<<"$(metric "$BODY" eac refusal)"
echo "   a missing actual cost refuses CPI, EAC and VAC BY NAME — it is never coalesced to zero"

# SPI computes: 48000 / 20000 = 2.4. Ahead of a plan that expected 20%.
test "$(jqp "$BODY" "round(float(x['metrics']['spi']['value']), 4)")" = "2.4"
# ES needs at least two planned points; one is a point, not a curve.
test "$(metric "$BODY" es value)" = ""
grep -qi 'One period of plan is a point, not a curve' <<<"$(metric "$BODY" es refusal)"
echo "   SPI computes from a planned curve; earned schedule refuses one planned point BY NAME"

# STAGE C — actuals arrive. CPI = 48000/50000 = 0.96; EAC = 100000/0.96.
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4B-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4B-C100\",\"description\":\"Mechanical design hours\",\"basis\":\"Estimated from the 2025 analogue package\",\"baseline_cost\":\"60000\",\"actual\":\"38000\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4B-CI2\",\"wbs_code\":\"1.2\",\"cbs_code\":\"SMOKE4B-C100\",\"description\":\"Electrical design hours\",\"basis\":\"Estimated from the 2025 analogue package\",\"baseline_cost\":\"40000\",\"actual\":\"12000\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "round(float(x['metrics']['ac']['value']), 2)")" = "50000.0"
test "$(jqp "$BODY" "round(float(x['metrics']['cpi']['value']), 4)")" = "0.96"
test "$(jqp "$BODY" "round(float(x['metrics']['eac']['value']), 2)")" = "104166.67"
test "$(jqp "$BODY" "round(float(x['metrics']['vac']['value']), 2)")" = "-4166.67"
test "$(jqp "$BODY" "x['eacFormula']")" = "EAC = BAC / CPI (past cost performance continues)"
echo "   with an actual cost the suite completes, and the EAC states which formula produced it"

# THE DOUBLE-COUNT WALL: claiming on 1 (the parent of 1.1 and 1.2) as well
# counts the same money twice.
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P1\",\"p_claim\":{\"wbs_code\":\"1\",\"step_index\":\"1\",\"basis\":\"A roll-up claim over elements already claimed\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(metric "$BODY" ev value)" = ""
grep -qi 'counts the same money twice' <<<"$(metric "$BODY" ev refusal)"
grep -qi '1 contains 1.1' <<<"$(metric "$BODY" ev refusal)"
echo "   claiming a parent and its child in one period refuses BY NAME rather than inflating EV"
psqlc "delete from project_progress_claims where period_id='$P1' and wbs_element_id=(select id from project_wbs_elements where development_case_id='$CASE' and wbs_code='1');" >/dev/null

# The compute records a run — the figures the surface shows come from IT.
BODY=$(rpc "$PLANNER" compute_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"; RUN1=$(printf '%s' "$BODY" | field calculationRunId); test -n "$RUN1"
test "$(psqlc "select code_version from calculation_runs where id='$RUN1'")" = "develop-performance/4B/2026-12-01"
test "$(psqlc "select status from calculation_runs where id='$RUN1'")" = "computed_with_refusals"
test "$(psqlc "select (outputs->>'cpi')::numeric >= 0.9599 from calculation_runs where id='$RUN1'")" = "t"
test "$(psqlc "select outputs->>'eacFormula' from calculation_runs where id='$RUN1'")" = "EAC = BAC / CPI (past cost performance continues)"
# The refusals are recorded WITH the figures: a run that recorded only its
# successes would make a caveated number look complete.
test "$(psqlc "select jsonb_array_length(refusals) > 0 from calculation_runs where id='$RUN1'")" = "t"
test "$(psqlc "select refusals::text like '%not been cross-checked against independent evidence%' from calculation_runs where id='$RUN1'")" = "t"
test "$(psqlc "select refusals::text like '%UNRATED%' from calculation_runs where id='$RUN1'")" = "t"
echo "   the run records the figures AND the refusals — unverified progress and an unrated estimate are on the record"

# ── THE STALENESS DIGEST SEES A REVISED AMOUNT, NOT ONLY A NEW ROW ───────
# record_cost_item revises baseline_cost and actual IN PLACE and `actual` is
# a running total by design, so every COUNT stays identical while the CPI
# moves. A fingerprint of counts left a three-times-wrong EAC on screen
# captioned "recorded ... code version ...".
DIG_RUN=$(psqlc "select inputs->>'basisDigest' from calculation_runs where id='$RUN1'")
test -n "$DIG_RUN"
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['basisDigest']")" = "$DIG_RUN"
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4B-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4B-C100\",\"description\":\"Mechanical design hours\",\"basis\":\"Estimated from the 2025 analogue package\",\"baseline_cost\":\"60000\",\"actual\":\"140000\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['claimCount']")" = "$(psqlc "select (inputs->>'claimCount') from calculation_runs where id='$RUN1'")"
test "$(jqp "$BODY" "x['costLineCount']")" = "$(psqlc "select (inputs->>'costLineCount') from calculation_runs where id='$RUN1'")"
test "$(jqp "$BODY" "x['basisDigest'] == '$DIG_RUN'")" = "False"
echo "   a revised cost figure moves the basis digest while every count stays identical — the run reads STALE"
# Put it back, so the transcript's later figures are the ones it states.
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4B-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4B-C100\",\"description\":\"Mechanical design hours\",\"basis\":\"Estimated from the 2025 analogue package\",\"baseline_cost\":\"60000\",\"actual\":\"38000\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['basisDigest']")" = "$DIG_RUN"

# ── A CLAIM SET THAT IS NOT IN THE BUDGET REFUSES, IT DOES NOT PRINT 0.000 ──
# On a case whose only claimed element carries no baselined cost anywhere in
# its subtree, EV would sum to zero and CPI/SPI would print 0.000 — the most
# alarming statement earned value can make, produced by arithmetic performed
# on nothing and indistinguishable on screen from a real collapse.
BODY=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE4B unbudgeted claim case","p_problem_statement":"A case whose claimed scope is not in the cost baseline, used to prove the suite refuses rather than reporting a CPI of zero.","p_lifecycle_type":"reliability_improvement"}')
noerr "$BODY"; CASE3=$(printf '%s' "$BODY" | field case_id)
for E in '{"wbs_code":"A","title":"Budgeted scope","scope_description":"The scope the cost lines are coded to"}' \
         '{"wbs_code":"B","title":"Unbudgeted scope","scope_description":"Scope with no cost line anywhere in its subtree"}'; do
  BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE3\",\"p_element\":$E}"); noerr "$BODY"
done
BODY=$(rpc "$PLANNER" record_cbs_code "{\"p_case_id\":\"$CASE3\",\"p_code\":{\"cbs_code\":\"SMOKE4B-C300\",\"title\":\"Engineering hours\",\"cost_type\":\"labour\"}}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" designate_control_account "{\"p_case_id\":\"$CASE3\",\"p_account\":{\"control_account_ref\":\"SMOKE4B-CA31\",\"wbs_code\":\"A\",\"cbs_code\":\"SMOKE4B-C300\",\"accountable_owner_id\":\"$MANAGER_ID\"}}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" create_case_business_case "{\"p_case_id\":\"$CASE3\",\"p_case_ref\":\"SMOKE4B-BC3\",\"p_title\":\"Unbudgeted claim case\",\"p_driver\":\"reliability\",\"p_currency\":\"CAD\",\"p_discount_rate\":0.08,\"p_discount_rate_source\":\"Corporate treasury WACC memo 2026-Q2\"}"); noerr "$BODY"
BC3=$(printf '%s' "$BODY" | field business_case_id)
BODY=$(rpc "$PLANNER" add_business_case_option "{\"p_business_case_id\":$BC3,\"p_label\":\"Proceed\",\"p_life_periods\":10,\"p_cash_flows\":[{\"period\":0,\"amount\":-50000},{\"period\":1,\"amount\":20000}]}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE3\",\"p_item\":{\"cost_item_ref\":\"SMOKE4B-CI31\",\"wbs_code\":\"A\",\"cbs_code\":\"SMOKE4B-C300\",\"description\":\"Budgeted engineering\",\"basis\":\"Estimated from the 2025 analogue package\",\"baseline_cost\":\"50000\",\"actual\":\"50000\"}}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" record_rule_of_credit "{\"p_case_id\":\"$CASE3\",\"p_rule\":{\"rule_ref\":\"SMOKE4B-ROC3\",\"title\":\"Construction credit\",\"applies_to\":\"construction_work_package\",\"basis\":\"Contract Schedule G milestone weighting\",\"steps\":[{\"step\":\"Erection complete\",\"weight\":100}]}}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" set_wbs_element_work_type "{\"p_case_id\":\"$CASE3\",\"p_element\":{\"wbs_code\":\"B\",\"work_type\":\"construction_work_package\",\"basis\":\"Contract Schedule G work breakdown, section 9\"}}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" open_progress_period "{\"p_case_id\":\"$CASE3\",\"p_period\":{\"period_ref\":\"SMOKE4B-U01\",\"period_end\":\"2026-01-31\"}}"); noerr "$BODY"
PU1=$(printf '%s' "$BODY" | field period_id)
BODY=$(rpc "$MANAGER" set_period_planned_progress "{\"p_period_id\":\"$PU1\",\"p_percent\":\"50\",\"p_basis\":\"Level 3 schedule spend curve, rev A\"}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$PU1\",\"p_claim\":{\"wbs_code\":\"B\",\"step_index\":\"1\",\"basis\":\"Erection complete on the unbudgeted package\"}}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE3\"}")
noerr "$BODY"
test "$(metric "$BODY" ev value)" = ""
test "$(metric "$BODY" cpi value)" = ""
test "$(metric "$BODY" spi value)" = ""
grep -qi 'the scope being claimed is not in the budget at completion' <<<"$(metric "$BODY" ev refusal)"
grep -qi 'rather than as a coding gap' <<<"$(metric "$BODY" ev refusal)"
echo "   a claim set with no baselined cost behind it refuses BY NAME rather than printing CPI 0.000"

# ── EARNED SCHEDULE REFUSES BELOW THE FIRST PLANNED POINT ────────────────
# ...for the same reason it refuses above the last one: reading below the
# start means interpolating from an assumed origin at period zero and zero
# percent, which is a planned point nobody recorded.
BODY=$(rpc "$PLANNER" set_wbs_element_work_type "{\"p_case_id\":\"$CASE3\",\"p_element\":{\"wbs_code\":\"A\",\"work_type\":\"engineering_deliverable\",\"basis\":\"Contract Schedule G work breakdown, section 2\"}}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" record_rule_of_credit "{\"p_case_id\":\"$CASE3\",\"p_rule\":{\"rule_ref\":\"SMOKE4B-ROC3E\",\"title\":\"Engineering credit\",\"applies_to\":\"engineering_deliverable\",\"basis\":\"Contract Schedule G milestone weighting\",\"steps\":[{\"step\":\"Issued for review\",\"weight\":10},{\"step\":\"Issued for construction\",\"weight\":90}]}}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$PU1\",\"p_claim\":{\"wbs_code\":\"A\",\"step_index\":\"1\",\"basis\":\"IFR transmittal issued for the budgeted package\"}}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" close_progress_period "{\"p_period_id\":\"$PU1\",\"p_note\":\"January position on the unbudgeted claim case\"}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" open_progress_period "{\"p_case_id\":\"$CASE3\",\"p_period\":{\"period_ref\":\"SMOKE4B-U02\",\"period_end\":\"2026-02-28\"}}"); noerr "$BODY"
PU2=$(printf '%s' "$BODY" | field period_id)
BODY=$(rpc "$MANAGER" set_period_planned_progress "{\"p_period_id\":\"$PU2\",\"p_percent\":\"80\",\"p_basis\":\"Level 3 schedule spend curve, rev A, February\"}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE3\"}")
noerr "$BODY"
# EV = 10% of the 50000 budgeted element = 5000, i.e. 10% against a curve
# whose first recorded point is 50%.
test "$(jqp "$BODY" "round(float(x['metrics']['ev']['value']), 2)")" = "5000.0"
test "$(metric "$BODY" es value)" = ""
grep -qi 'cannot be read below the start of the curve' <<<"$(metric "$BODY" es refusal)"
grep -qi 'a planned point nobody recorded' <<<"$(metric "$BODY" es refusal)"
echo "   earned schedule refuses BELOW the first planned point, symmetrically with above the last"

# ── AND THE POSITION IS CUMULATIVE: an element that did not move keeps it ──
# The only claim in U02 is against B; A was last claimed in U01. Summing the
# period's rows would drop A's 5000 out of the earned value entirely and
# manufacture a collapse out of ordinary reporting practice.
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$PU2\",\"p_claim\":{\"wbs_code\":\"B\",\"step_index\":\"1\",\"basis\":\"Erection still complete on the unbudgeted package\"}}"); noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE3\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['claimsInLatestPeriod']")" = "1"
test "$(jqp "$BODY" "x['claimCount']")" = "2"
test "$(jqp "$BODY" "x['carriedForwardCount']")" = "1"
test "$(jqp "$BODY" "round(float(x['metrics']['ev']['value']), 2)")" = "5000.0"
grep -qi 'carried forward at the percent they were recorded at' <<<"$(jqp "$BODY" "' '.join(x['caveats'])")"
echo "   earned value is cumulative to the data date — an element that did not move keeps its position, and the carry-forward is said out loud"

echo "── 5. the estimate basis (D5.16) and its confidence (D5.17) ─────────────"

# UNRATED, and the word is not LOW.
BODY=$(rpc "$PLANNER" get_case_estimate_basis "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['confidence']['band']")" = "unrated"
test "$(jqp "$BODY" "x['confidence']['rating'] is None")" = "True"
grep -qi 'UNRATED — not LOW' <<<"$(jqp "$BODY" "x['confidence']['refusal']")"
test "$(jqp "$BODY" "len(x['dimensions'])")" = "8"
echo "   with no basis the forecast is UNRATED, and unrated is not LOW"

# All eight, demanded one at a time BY NAME.
BODY=$(rpc "$PLANNER" record_estimate_basis "{\"p_case_id\":\"$CASE\",\"p_basis\":{}}")
expect_err "$BODY" 'dimension 1 of 8 is missing'
BODY=$(rpc "$PLANNER" record_estimate_basis "{\"p_case_id\":\"$CASE\",\"p_basis\":{\"estimate_class\":\"class_4\"}}")
expect_err "$BODY" 'dimension 2 of 8 is missing'
BODY=$(rpc "$PLANNER" record_estimate_basis "{\"p_case_id\":\"$CASE\",\"p_basis\":{\"estimate_class\":\"class_4\",\"scope_maturity\":\"feasibility\"}}")
expect_err "$BODY" 'dimension 3 of 8 is missing'
BODY=$(rpc "$PLANNER" record_estimate_basis "{\"p_case_id\":\"$CASE\",\"p_basis\":{\"estimate_class\":\"class_4\",\"scope_maturity\":\"feasibility\",\"quantity_based_percent\":\"NaN\"}}")
expect_err "$BODY" 'must be a finite number'
BODY=$(rpc "$PLANNER" record_estimate_basis "{\"p_case_id\":\"$CASE\",\"p_basis\":{\"estimate_class\":\"class_4\",\"scope_maturity\":\"feasibility\",\"quantity_based_percent\":\"35\",\"quotation_support\":\"firm\",\"supporting_quotation_count\":\"0\",\"escalation_basis\":\"StatCan non-residential construction index\",\"productivity_basis\":\"2025 analogue package actuals\",\"exclusions\":\"Excludes owner team and permitting\",\"contingency_basis\":\"P50 risk model output\"}}")
expect_err "$BODY" 'the dimension answering itself'
BODY=$(rpc "$PLANNER" record_estimate_basis "{\"p_case_id\":\"$CASE\",\"p_basis\":{\"estimate_class\":\"class_4\",\"scope_maturity\":\"feasibility\",\"quantity_based_percent\":\"35\",\"quotation_support\":\"indicative\",\"supporting_quotation_count\":\"2\",\"escalation_basis\":\"StatCan non-residential construction index\",\"productivity_basis\":\"2025 analogue package actuals\",\"exclusions\":\"Excludes owner team and permitting\"}}")
expect_err "$BODY" 'dimension 8 of 8 is missing'
echo "   an estimate basis is eight dimensions or none — each missing one is named"

BODY=$(rpc "$AIBOT" record_estimate_basis "{\"p_case_id\":\"$CASE\",\"p_basis\":{\"estimate_class\":\"class_1\",\"scope_maturity\":\"detailed_design\",\"quantity_based_percent\":\"95\",\"quotation_support\":\"firm\",\"supporting_quotation_count\":\"9\",\"escalation_basis\":\"Assumed by the agent from the corpus\",\"productivity_basis\":\"Assumed by the agent from the corpus\",\"exclusions\":\"None identified by the agent\",\"contingency_basis\":\"Assumed by the agent from the corpus\"}}")
expect_err "$BODY" '§70'
echo "   §70 refuses the AI identity an estimate basis — it would be approving a forecast's confidence"

BODY=$(rpc "$PLANNER" record_estimate_basis "{\"p_case_id\":\"$CASE\",\"p_basis\":{\"estimate_class\":\"class_4\",\"scope_maturity\":\"feasibility\",\"quantity_based_percent\":\"35\",\"quotation_support\":\"indicative\",\"supporting_quotation_count\":\"2\",\"escalation_basis\":\"StatCan non-residential construction index, 2026 Q2\",\"productivity_basis\":\"2025 analogue package actuals, 1.15 factor\",\"exclusions\":\"Excludes owner team, permitting and site power\",\"contingency_basis\":\"P50 output of the 2026-Q2 risk model\"}}")
noerr "$BODY"
test "$(jqp "$BODY" "x['confidence']['band']")" = "low"
test "$(jqp "$BODY" "len(x['confidence']['drivers']) >= 3")" = "True"
echo "   class 4, mostly factored, indicative quotations, feasibility scope → LOW, with the drivers named"

# The basis is immutable: a forecast published against it cannot be
# retro-justified by editing what it rested on.
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
  update project_estimate_basis set estimate_class='class_1' where development_case_id='$CASE'; rollback;")
grep -qi 'an estimate basis is immutable' <<<"$OUT"

BODY=$(rpc "$PLANNER" compute_case_estimate_confidence "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(psqlc "select outputs->>'band' from calculation_runs where development_case_id='$CASE' and calculation_key='case_estimate_confidence' order by computed_at desc limit 1")" = "low"

echo "── 6. progress integrity (D5.20, spec II.9) ─────────────────────────────"

BODY=$(rpc "$PLANNER" get_case_progress_integrity "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['confidence'] is None")" = "True"
grep -qi 'absence of evidence is not confirmation' <<<"$(jqp "$BODY" "x['refusal']")"
grep -qi 'rating this HIGH because nothing contradicts it' <<<"$(jqp "$BODY" "x['refusal']")"
echo "   claimed progress with no independent evidence has NO rating — not HIGH"

BODY=$(rpc "$AIBOT" record_progress_evidence "{\"p_period_id\":\"$P1\",\"p_evidence\":{\"wbs_code\":\"1.1\",\"evidence_source\":\"deliverables_accepted\",\"observed_complete\":\"71\",\"observed_total\":\"100\",\"unit\":\"IFC deliverables\",\"basis\":\"Document control register export 2026-01-31\"}}")
expect_err "$BODY" '§70'
BODY=$(rpc "$PLANNER" record_progress_evidence "{\"p_period_id\":\"$P1\",\"p_evidence\":{\"wbs_code\":\"1.1\",\"evidence_source\":\"deliverables_accepted\",\"observed_complete\":\"71\",\"observed_total\":\"0\",\"unit\":\"IFC deliverables\",\"basis\":\"Document control register export 2026-01-31\"}}")
expect_err "$BODY" 'division by zero wearing a percentage sign'
BODY=$(rpc "$PLANNER" record_progress_evidence "{\"p_period_id\":\"$P1\",\"p_evidence\":{\"wbs_code\":\"1.1\",\"evidence_source\":\"deliverables_accepted\",\"observed_complete\":\"120\",\"observed_total\":\"100\",\"unit\":\"IFC deliverables\",\"basis\":\"Document control register export 2026-01-31\"}}")
expect_err "$BODY" 'cannot be negative or exceed the whole'
BODY=$(rpc "$PLANNER" record_progress_evidence "{\"p_period_id\":\"$P1\",\"p_evidence\":{\"wbs_code\":\"1.1\",\"evidence_source\":\"deliverables_accepted\",\"observed_complete\":\"71\",\"observed_total\":\"100\",\"unit\":\"IFC deliverables\",\"basis\":\"Document control register export 2026-01-31\"}}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field observed_percent)" = "71.0"
BODY=$(rpc "$PLANNER" record_progress_evidence "{\"p_period_id\":\"$P1\",\"p_evidence\":{\"wbs_code\":\"1.1\",\"evidence_source\":\"deliverables_accepted\",\"observed_complete\":\"90\",\"observed_total\":\"100\",\"unit\":\"IFC deliverables\",\"basis\":\"A second, more generous reading of the same register\"}}")
expect_err "$BODY" 'makes "the lowest source" a lottery'
# A SECOND, more generous source. The LOWEST binds, so it cannot cover the
# damning one.
BODY=$(rpc "$PLANNER" record_progress_evidence "{\"p_period_id\":\"$P1\",\"p_evidence\":{\"wbs_code\":\"1.1\",\"evidence_source\":\"drawings_issued\",\"observed_complete\":\"88\",\"observed_total\":\"100\",\"unit\":\"drawings\",\"basis\":\"Transmittal log export 2026-01-31\"}}")
noerr "$BODY"

BODY=$(rpc "$PLANNER" get_case_progress_integrity "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['confidence']")" = "medium"
test "$(jqp "$BODY" "next(e for e in x['elements'] if e['wbsCode']=='1.1')['bindingSource']")" = "deliverables_accepted"
test "$(jqp "$BODY" "next(e for e in x['elements'] if e['wbsCode']=='1.1')['sourceCount']")" = "2"
test "$(jqp "$BODY" "next(e for e in x['elements'] if e['wbsCode']=='1.1')['divergencePoints']")" = "11.0"
# The uncovered element is UNRATED and says so, and coverage travels with
# the rating.
test "$(jqp "$BODY" "next(e for e in x['elements'] if e['wbsCode']=='1.2')['confidence'] is None")" = "True"
grep -qi 'nothing contradicts it and nothing confirms it' <<<"$(jqp "$BODY" "next(e for e in x['elements'] if e['wbsCode']=='1.2')['refusal']")"
test "$(jqp "$BODY" "x['coverage']")" = "50.0"
grep -qi 'This rating covers 1 of 2 claimed element' <<<"$(jqp "$BODY" "x['headline']")"
echo "   the lowest source binds and is named; coverage travels with the rating; the uncovered element is UNRATED"

# THE SPEC'S OWN SENTENCE, produced from data: engineering reported far
# ahead of what the IFC register accepts.
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P1\",\"p_claim\":{\"wbs_code\":\"2\",\"step_index\":\"1\",\"basis\":\"Fabrication released for the whole lot\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_progress_evidence "{\"p_period_id\":\"$P1\",\"p_evidence\":{\"wbs_code\":\"2\",\"evidence_source\":\"field_installation\",\"observed_complete\":\"30\",\"observed_total\":\"100\",\"unit\":\"tonnes erected\",\"basis\":\"Site survey 2026-01-31\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" compute_case_progress_integrity "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['confidence']")" = "low"
grep -qi 'is reported 100 percent complete' <<<"$(jqp "$BODY" "x['headline']")"
grep -qi 'only 30 of 100 tonnes erected are field installation' <<<"$(jqp "$BODY" "x['headline']")"
RUNPI=$(printf '%s' "$BODY" | field calculationRunId)
test "$(psqlc "select outputs->>'confidence' from calculation_runs where id='$RUNPI'")" = "low"
test "$(psqlc "select jsonb_array_length(refusals) >= 2 from calculation_runs where id='$RUNPI'")" = "t"
echo "   the spec's own 'reported X, only Y accepted -> confidence LOW' sentence, produced from data and recorded"

# ...and the earned-value run now carries the LOW progress confidence.
BODY=$(rpc "$PLANNER" compute_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"; RUN2=$(printf '%s' "$BODY" | field calculationRunId)
test "$(psqlc "select outputs->>'progressConfidence' from calculation_runs where id='$RUN2'")" = "low"
test "$(psqlc "select refusals::text like '%LOW progress confidence rating%' from calculation_runs where id='$RUN2'")" = "t"
echo "   the earned value carries the progress confidence it rests on, into its own lineage row"

echo "── 7. forecast confidence, §51 (D5.07, D5.32) ───────────────────────────"

BODY=$(rpc "$PLANNER" compute_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"; RUNFC=$(printf '%s' "$BODY" | field calculationRunId)
# The deterministic figure is real and named.
test "$(jqp "$BODY" "round(float(x['cost']['deterministic']), 2)")" = "104166.67"
test "$(jqp "$BODY" "x['cost']['deterministicFormula']")" = "EAC = BAC / CPI (past cost performance continues)"
# THE POINT: the percentiles are ABSENT, on both sides, with a reason.
test "$(jqp "$BODY" "x['cost']['p50'] is None and x['cost']['p80'] is None")" = "True"
test "$(jqp "$BODY" "x['schedule']['p50Finish'] is None and x['schedule']['p80Finish'] is None")" = "True"
test "$(jqp "$BODY" "x['distribution']['exists']")" = "False"
grep -qi 'A P80 is a statement about a distribution' <<<"$(jqp "$BODY" "x['cost']['percentileRefusal']")"
grep -qi 'Slice 4C' <<<"$(jqp "$BODY" "x['cost']['percentileRefusal']")"
grep -qi 'no schedule activity is recorded' <<<"$(jqp "$BODY" "x['schedule']['deterministicRefusal']")"
grep -qi 'the day somebody signed' <<<"$(jqp "$BODY" "x['againstSanctionRefusal']")"
grep -qi 'no schedule activities, so a schedule simulation would have nothing to sample' <<<"$(jqp "$BODY" "x['schedule']['percentileRefusal']")"
# The confidence travels with the number — §51's fourth field.
test "$(jqp "$BODY" "x['estimateConfidence']['band']")" = "low"
test "$(jqp "$BODY" "x['progressConfidence']['band']")" = "low"
# ...and the ABSENCE is on the record, so a forecast with no distribution is
# distinguishable in the ledger from one that had a distribution and did not
# show it.
test "$(psqlc "select outputs->>'costP50' is null or outputs->>'costP50'='' from calculation_runs where id='$RUNFC'")" = "t"
test "$(psqlc "select (outputs->>'distributionExists')::boolean from calculation_runs where id='$RUNFC'")" = "f"
test "$(psqlc "select refusals::text like '%statement about a distribution%' from calculation_runs where id='$RUNFC'")" = "t"
echo "   deterministic shown, P50/P80 shown ABSENT with the reason, and the absence recorded on the run"

# THE SCHEDULE SIDE, once the case has a schedule through the D5.28 door: a
# real deterministic finish appears and the percentile refusal CHANGES to
# name what is actually missing — the binding, not the data.
BODY=$(rpc "$PLANNER" record_local_schedule_activity "{\"p_case_id\":\"$CASE\",\"p_activity\":{\"activity_id\":\"SMOKE4B-L1\",\"description\":\"Mechanical design issue for construction\",\"duration_hours\":\"320\",\"planned_start\":\"2026-02-01T00:00:00Z\",\"planned_finish\":\"2026-04-30T00:00:00Z\",\"wbs_code\":\"1.1\"}}")
noerr "$BODY"
ACT=$(psqlc "select t.id from shutdown_tasks t join shutdown_events e on e.id=t.event_id
             where e.development_case_id='$CASE' and t.task_key='SMOKE4B-L1'")
test -n "$ACT"
BODY=$(rpc "$PLANNER" compute_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['schedule']['deterministicFinish'][:10]")" = "2026-04-30"
test "$(jqp "$BODY" "x['schedule']['activityCount']")" = "1"
test "$(jqp "$BODY" "x['schedule']['activitiesWithDurationRange']")" = "0"
test "$(jqp "$BODY" "x['schedule']['p50Finish'] is None and x['schedule']['p80Finish'] is None")" = "True"
grep -qi 'no range to sample' <<<"$(jqp "$BODY" "x['schedule']['percentileRefusal']")"
# ...and with a duration range on the activity the refusal changes AGAIN, to
# say the missing piece is the binding rather than the data. Naming which of
# the two it is, from data, is the difference between a refusal and a shrug.
psqlc "update shutdown_tasks set optimistic_hours=260, pessimistic_hours=460 where id=$ACT;" >/dev/null
BODY=$(rpc "$PLANNER" compute_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['schedule']['activitiesWithDurationRange']")" = "1"
grep -qi 'the missing piece here is the binding, not the data' <<<"$(jqp "$BODY" "x['schedule']['percentileRefusal']")"
test "$(jqp "$BODY" "x['schedule']['p80Finish'] is None")" = "True"
echo "   the deterministic finish is real; the percentile refusal names whether the gap is the data or the binding"

echo "── 8. performance trending, over recorded periods (D5.06) ───────────────"

BODY=$(rpc "$PLANNER" close_progress_period "{\"p_period_id\":\"$P1\",\"p_note\":\"January engineering position agreed at the monthly controls meeting\"}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field status)" = "closed"
# A closed period is history: claims and curve edits are both refused.
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P1\",\"p_claim\":{\"wbs_code\":\"1.2\",\"step_index\":\"3\",\"basis\":\"Trying to claim into a closed period\"}}")
expect_err "$BODY" 'is closed'
BODY=$(rpc "$MANAGER" set_period_planned_progress "{\"p_period_id\":\"$P1\",\"p_percent\":\"5\",\"p_basis\":\"Trying to move the plan under a recorded run\"}")
expect_err "$BODY" 'cannot be edited afterwards'
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
  update project_progress_periods set status='open' where id='$P1'; rollback;")
grep -qi 'written through open_progress_period' <<<"$OUT"
# ...and the wall holds for the SERVICE caller too, which passes the write
# door and is audited rather than refused there. A period that could be
# re-opened would put new claims behind performance runs already recorded
# against it, and recomputed history would stop being distinguishable from
# recorded history.
OUT=$(sql_must_fail "update project_progress_periods set status='open' where id='$P1';")
grep -qi 'Re-opening it would put new claims behind performance runs' <<<"$OUT"
echo "   a closed period is history — no claims, no curve edits, no re-opening"

# Period 2: a period with NO recorded run stays a GAP in the trend.
BODY=$(rpc "$PLANNER" open_progress_period "{\"p_case_id\":\"$CASE\",\"p_period\":{\"period_ref\":\"SMOKE4B-M02\",\"period_end\":\"2026-02-28\"}}")
noerr "$BODY"; P2=$(printf '%s' "$BODY" | field period_id)
BODY=$(rpc "$PLANNER" get_case_performance_trend "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['measuredPointCount']")" = "1"
test "$(jqp "$BODY" "len(x['gaps'])")" = "1"
grep -qi 'One measured point is a position, not a trend' <<<"$(jqp "$BODY" "x['refusal']")"
grep -qi 'an interpolated point is a measurement nobody took' <<<"$(jqp "$BODY" "x['gaps'][0]['reason']")"
echo "   one point is a position; the unmeasured period stays a gap rather than being interpolated across"

# Period 2 gets a plan, a claim and a run, so the trend has a direction.
BODY=$(rpc "$MANAGER" set_period_planned_progress "{\"p_period_id\":\"$P2\",\"p_percent\":\"10\",\"p_basis\":\"Trying to bend the cumulative curve downwards\"}")
expect_err "$BODY" 'A cumulative planned curve does not go down'
BODY=$(rpc "$MANAGER" set_period_planned_progress "{\"p_period_id\":\"$P2\",\"p_percent\":\"55\",\"p_basis\":\"Level 3 schedule spend curve, rev C, February\"}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P2\",\"p_claim\":{\"wbs_code\":\"1.1\",\"step_index\":\"3\",\"basis\":\"IFC transmittal 4502 accepted by the owner engineer\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$P2\",\"p_claim\":{\"wbs_code\":\"1.2\",\"step_index\":\"2\",\"basis\":\"IFA transmittal 4507 acknowledged\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4B-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4B-C100\",\"description\":\"Mechanical design hours\",\"basis\":\"Estimated from the 2025 analogue package\",\"baseline_cost\":\"60000\",\"actual\":\"84000\"}}")
noerr "$BODY"

# EARNED SCHEDULE BEYOND THE END OF THE CURVE. 84 percent has been earned and
# the recorded plan reaches 55; reading a date off it would state a date the
# plan never contained.
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "round(float(x['metrics']['ev']['value']), 2)")" = "84000.0"
test "$(metric "$BODY" es value)" = ""
grep -qi 'cannot be read beyond the end of the curve' <<<"$(metric "$BODY" es refusal)"
echo "   earned value past the end of the planned curve refuses BY NAME rather than extrapolating a date"

# Re-plan the OPEN period (an open period's curve may still move; a closed
# one's may not) and earned schedule interpolates: ES = 1 + (84-20)/(90-20).
BODY=$(rpc "$MANAGER" set_period_planned_progress "{\"p_period_id\":\"$P2\",\"p_percent\":\"90\",\"p_basis\":\"Level 3 schedule spend curve, rev D, February re-plan\"}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "round(float(x['metrics']['es']['value']), 4)")" = "1.9143"
test "$(jqp "$BODY" "round(float(x['metrics']['spit']['value']), 4)")" = "0.9571"
echo "   earned schedule reads the earned value back onto the planned curve, in periods"
BODY=$(rpc "$PLANNER" compute_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"

BODY=$(rpc "$PLANNER" compute_case_performance_trend "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"; RUNT=$(printf '%s' "$BODY" | field calculationRunId)
test "$(jqp "$BODY" "x['measuredPointCount']")" = "2"
test "$(jqp "$BODY" "len(x['gaps'])")" = "0"
test "$(jqp "$BODY" "x['costTrend']")" = "deteriorating"
test "$(jqp "$BODY" "[p['periodRef'] for p in x['points']]")" = "['SMOKE4B-M01', 'SMOKE4B-M02']"
# The trend reads RECORDED history: M01's point is the run recorded while
# M01 was current, and it is unchanged by everything that happened since.
test "$(jqp "$BODY" "round(float(x['points'][0]['cpi']), 4)")" = "0.96"
# A run whose lineage is other runs.
test "$(psqlc "select input_refs->0->>'table' from calculation_runs where id='$RUNT'")" = "calculation_runs"
test "$(psqlc "select jsonb_array_length(input_refs) from calculation_runs where id='$RUNT'")" = "2"
echo "   the trend is read from the runs recorded per period, and its own lineage cites them"

# ── A CLOSED PERIOD'S POINT DOES NOT MOVE ────────────────────────────────
# Claims freeze on close; the cost ledger does not. compute_case_earned_value
# always computes at the LATEST period, so without the closed_at predicate a
# run recorded AFTER a period closed became that period's history and the
# recorded point moved whenever somebody revised a cost line — a trend whose
# past points move is not a trend, and hiding the superseded run behind the
# distinct-on is worse than not having the point.
M02_CPI_BEFORE=$(jqp "$BODY" "round(float(x['points'][1]['cpi']), 4)")
BODY=$(rpc "$PLANNER" close_progress_period "{\"p_period_id\":\"$P2\",\"p_note\":\"February engineering position agreed at the monthly controls meeting\"}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4B-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4B-C100\",\"description\":\"Mechanical design hours\",\"basis\":\"Estimated from the 2025 analogue package\",\"baseline_cost\":\"60000\",\"actual\":\"300000\"}}")
noerr "$BODY"
# The suite still computes at the closed latest period — and says what it is.
BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
grep -qi 'is closed, so the claimed positions behind this earned value are frozen' <<<"$(jqp "$BODY" "x['periodClosedNote']")"
BODY=$(rpc "$PLANNER" compute_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "round(float(x['metrics']['cpi']['value']), 4) != $M02_CPI_BEFORE")" = "True"
BODY=$(rpc "$PLANNER" get_case_performance_trend "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "round(float(x['points'][1]['cpi']), 4)")" = "$M02_CPI_BEFORE"
grep -qi 'recorded at or before the instant the period closed' <<<"$(jqp "$BODY" "x['basis']")"
echo "   a run recorded after a period closed cannot rewrite that period's point — the trend point is unmoved"
# Put the cost line back so nothing downstream reads a probe figure.
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4B-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4B-C100\",\"description\":\"Mechanical design hours\",\"basis\":\"Estimated from the 2025 analogue package\",\"baseline_cost\":\"60000\",\"actual\":\"84000\"}}")
noerr "$BODY"

# A DIRECTION IS THE LAST INTERVAL, AND A SERIES THAT CHANGED DIRECTION SAYS
# SO. First-versus-last ignored everything between, so 1.20 → 0.24 → 2.00
# reported "improving" — a shape the series never had.
BODY=$(rpc "$PLANNER" get_case_performance_trend "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['costTrendInterval']")" = "SMOKE4B-M01 to SMOKE4B-M02"
test "$(jqp "$BODY" "x['refusedPointCount']")" = "0"
test "$(jqp "$BODY" "x['measuredPointCount']")" = "2"
echo "   the direction names the interval it was measured across, and a refused run is not counted as a measured point"

# THE RULE OF CREDIT IS IMMUTABLE ONCE CLAIMS CITE IT, for every writer.
# Rewriting its steps leaves the recorded claims holding percents the rule no
# longer produces, and there is no rule version to reconstruct them from.
OUT=$(sql_must_fail "update project_rules_of_credit set steps='[{\"step\":\"Issued for review\",\"weight\":80},{\"step\":\"Issued for approval\",\"weight\":10},{\"step\":\"Issued for construction\",\"weight\":10}]'::jsonb where development_case_id='$CASE' and rule_ref='SMOKE4B-ROC1';")
grep -qi 'impossible to reconstruct from the convention it names' <<<"$OUT"
echo "   a rule of credit with claims citing it cannot be rewritten, by any writer"

echo "── 9. D5.04's eleventh structure now has a home ─────────────────────────"

BODY=$(rpc "$PLANNER" get_case_controls "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "next(s for s in x['controlsBaseline']['structures'] if s['structure']=='progress')['refusal'] is None")" = "True"
test "$(jqp "$BODY" "next(s for s in x['controlsBaseline']['structures'] if s['structure']=='progress')['home']")" = "project_rules_of_credit + project_progress_periods.planned_percent_complete"
# The count is ONE KIND OF THING — the conventions — with the curve reported
# beside it. Adding rules to periods made "5" a number that could not tell a
# reader which half was present, and the drift report compared it against an
# equally meaningless captured one.
test "$(jqp "$BODY" "next(s for s in x['controlsBaseline']['structures'] if s['structure']=='progress')['currentCount']")" = "2"
# ...and on a case with no rule of credit it still REFUSES rather than
# reporting a progress baseline of zero.
BODY=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE4B empty progress case","p_problem_statement":"A case with no measurement convention, used to prove the progress structure still refuses rather than reporting a zero.","p_lifecycle_type":"reliability_improvement"}')
noerr "$BODY"; CASE2=$(printf '%s' "$BODY" | field case_id)
BODY=$(rpc "$PLANNER" get_case_controls "{\"p_case_id\":\"$CASE2\"}")
noerr "$BODY"
grep -qi 'baselined at 0% complete' <<<"$(jqp "$BODY" "next(s for s in x['controlsBaseline']['structures'] if s['structure']=='progress')['refusal']")"
# BOTH HALVES OR NEITHER. A convention with no planned curve fixes half of
# what a progress baseline claims to fix, while every planned value and every
# SPI measured against it refuses for want of the other half.
BODY=$(rpc "$PLANNER" record_rule_of_credit "{\"p_case_id\":\"$CASE2\",\"p_rule\":{\"rule_ref\":\"SMOKE4B-ROC2\",\"title\":\"Engineering deliverable credit\",\"applies_to\":\"engineering_deliverable\",\"basis\":\"Contract Schedule G milestone weighting\",\"steps\":[{\"step\":\"Issued for construction\",\"weight\":100}]}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_controls "{\"p_case_id\":\"$CASE2\"}")
noerr "$BODY"
grep -qi 'no planned curve to baseline' <<<"$(jqp "$BODY" "next(s for s in x['controlsBaseline']['structures'] if s['structure']=='progress')['refusal']")"
grep -qi 'while every planned value and every schedule performance index measured against it refuses' <<<"$(jqp "$BODY" "next(s for s in x['controlsBaseline']['structures'] if s['structure']=='progress')['refusal']")"
echo "   progress is the eleventh structure; an unmeasured case refuses, and so does one with a convention and no curve"

# Capture it against an approved baseline (§70 still refuses the AI identity).
BODY=$(rpc "$PLANNER" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"SCOPE\",\"p_description\":\"Scope and progress measurement basis fixed for the January position\"}")
noerr "$BODY"; BL=$(printf '%s' "$BODY" | field baseline_id)
BODY=$(rpc "$MANAGER" approve_case_baseline "{\"p_baseline_id\":\"$BL\",\"p_note\":\"Approved at the monthly controls meeting with the rules of credit attached\"}")
noerr "$BODY"
BODY=$(rpc "$AIBOT" capture_controls_baseline_structure "{\"p_baseline_id\":\"$BL\",\"p_structure\":\"progress\"}")
expect_err "$BODY" '§70'
BODY=$(rpc "$MANAGER" capture_controls_baseline_structure "{\"p_baseline_id\":\"$BL\",\"p_structure\":\"progress\"}")
noerr "$BODY"; test -n "$(printf '%s' "$BODY" | field digest)"
echo "   the progress structure can be captured against an approved baseline, and the AI identity cannot capture it"

echo "── 10. lineage and the ledgers (D11.29) ─────────────────────────────────"

for K in case_earned_value case_progress_integrity case_estimate_confidence case_forecast_confidence case_performance_trend; do
  test "$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE' and calculation_key='$K'")" -ge "1"
  test "$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE' and calculation_key='$K' and code_version='develop-performance/4B/2026-12-01'")" -ge "1"
done
echo "   all five 4B calculations record a run, under the server-side code version"

BODY=$(rpc "$PLANNER" get_case_calculation_lineage "{\"p_case_id\":\"$CASE\",\"p_limit\":50}")
noerr "$BODY"
test "$(jqp "$BODY" "len(set(r['calculationKey'] for r in x['runs'])) >= 5")" = "True"

OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
  update calculation_runs set outputs='{}'::jsonb where development_case_id='$CASE'; rollback;")
grep -qi 'a recorded calculation is immutable' <<<"$OUT"

for T in project_rules_of_credit project_progress_periods project_progress_claims project_progress_evidence project_estimate_basis; do
  OUT=$(sql_must_fail "truncate table $T;")
  grep -qi 'truncat' <<<"$OUT"
  test "$(psqlc "select count(*) from information_schema.role_table_grants where table_name='$T' and privilege_type='TRUNCATE' and grantee in ('anon','authenticated','service_role')")" = "0"
done
echo "   every new ledger refuses TRUNCATE at statement level and the verb is revoked"

# The one performance read the surface consumes answers with everything.
BODY=$(rpc "$PLANNER" get_case_performance "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "sorted(x['latestCalculations'].keys()) == ['case_earned_value','case_estimate_confidence','case_forecast_confidence','case_performance_trend','case_progress_integrity']")" = "True"
test "$(jqp "$BODY" "x['latestCalculations']['case_earned_value']['status']")" = "computed_with_refusals"
test "$(jqp "$BODY" "len(x['notInThisSlice']) >= 3")" = "True"
grep -qi 'Slice 4C' <<<"$(jqp "$BODY" "x['notInThisSlice'][0]")"
# A technician can read the case but cannot compute or claim anything on it.
BODY=$(rpc "$TECH" compute_case_earned_value "{\"p_case_id\":\"$CASE\"}")
expect_err "$BODY" 'requires a planning, engineering or governance role'
echo "   one read behind the surface, carrying the recorded runs and the honest list of what is missing"


echo "── 11. tenancy over every client-callable 4B function ───────────────────"

# THE GAP THAT LET A CROSS-TENANT READ SHIP. 4A seeds a foreign-tenant
# planner and an orphan JWT holder and loops every read through them; 4B had
# no such block at all, and estimate_confidence_rating — a SECURITY DEFINER
# granted to `authenticated` with no org predicate — handed any JWT holder
# any tenant's eight-dimension estimate defence in plaintext.
FOREIGN_ORG=$(psqlc "select id from organizations where name='SMOKE4B Foreign Tenant Corp' limit 1")
if [ -z "$FOREIGN_ORG" ]; then
  FOREIGN_ORG=$(psqlc "select provision_organization('SMOKE4B Foreign Tenant Corp')->>'organization_id'")
fi
test -n "$FOREIGN_ORG"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
do \$seed\$
declare
  v_foreign uuid := '66666666-6666-4666-8666-666666666666';
  v_orphan  uuid := '55555555-5555-4555-8555-555555555555';
begin
  if not exists (select 1 from auth.users where email = 'smoke4b-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_foreign,
      'authenticated', 'authenticated', 'smoke4b-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(), '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'Smoke 4B foreign planner'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  if not exists (select 1 from auth.identities where user_id = v_foreign) then
    insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                 created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), v_foreign, v_foreign,
            jsonb_build_object('sub', v_foreign::text, 'email', 'smoke4b-foreign@syncai.ca'),
            'email', now(), now(), now());
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_foreign, '$FOREIGN_ORG', 'smoke4b-foreign@syncai.ca', 'planner')
  on conflict (id) do update set organization_id = excluded.organization_id, role = 'planner';

  -- ...and a JWT holder with NO organization at all: the caller the
  -- dual-caller guard exists for, and the one current_user can never see.
  if not exists (select 1 from auth.users where email = 'smoke4b-orphan@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_orphan,
      'authenticated', 'authenticated', 'smoke4b-orphan@syncai.ca',
      extensions.crypt('Orphan123!@#', extensions.gen_salt('bf')),
      now(), now(), now(), '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'Smoke 4B orphan'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  if not exists (select 1 from auth.identities where user_id = v_orphan) then
    insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                 created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), v_orphan, v_orphan,
            jsonb_build_object('sub', v_orphan::text, 'email', 'smoke4b-orphan@syncai.ca'),
            'email', now(), now(), now());
  end if;
  delete from user_profiles where id = v_orphan;
end
\$seed\$;
PSQL
FOREIGNER=$(token 'smoke4b-foreign@syncai.ca' 'Foreign123!@#'); test -n "$FOREIGNER"
ORPHAN=$(token 'smoke4b-orphan@syncai.ca' 'Orphan123!@#'); test -n "$ORPHAN"

for FN in get_case_performance get_case_progress get_case_estimate_basis \
          get_case_earned_value get_case_progress_integrity \
          get_case_forecast_confidence get_case_performance_trend \
          compute_case_earned_value compute_case_progress_integrity \
          compute_case_estimate_confidence compute_case_forecast_confidence \
          compute_case_performance_trend; do
  BODY=$(rpc "$FOREIGNER" "$FN" "{\"p_case_id\":\"$CASE\"}")
  expect_err "$BODY" 'development case not found'
  BODY=$(rpc "$ORPHAN" "$FN" "{\"p_case_id\":\"$CASE\"}")
  expect_err "$BODY" 'forbidden'
done
BODY=$(rpc "$FOREIGNER" set_wbs_element_work_type "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1.1\",\"work_type\":\"owner_activity\",\"basis\":\"A foreign tenant retyping somebody else's element\"}}")
expect_err "$BODY" 'development case not found'
BODY=$(rpc "$FOREIGNER" open_progress_period "{\"p_case_id\":\"$CASE\",\"p_period\":{\"period_ref\":\"FOREIGN\",\"period_end\":\"2026-09-30\"}}")
expect_err "$BODY" 'development case not found'
BODY=$(rpc "$FOREIGNER" record_rule_of_credit "{\"p_case_id\":\"$CASE\",\"p_rule\":{\"rule_ref\":\"FOREIGN\",\"title\":\"Foreign rule\",\"applies_to\":\"owner_activity\",\"basis\":\"A rule written by another tenant\",\"steps\":[{\"step\":\"Signed\",\"weight\":100}]}}")
expect_err "$BODY" 'development case not found'
BODY=$(rpc "$FOREIGNER" record_estimate_basis "{\"p_case_id\":\"$CASE\",\"p_basis\":{\"estimate_class\":\"class_1\",\"scope_maturity\":\"detailed_design\",\"quantity_based_percent\":\"95\",\"quotation_support\":\"firm\",\"supporting_quotation_count\":\"9\",\"escalation_basis\":\"x\",\"productivity_basis\":\"x\",\"exclusions\":\"x\",\"contingency_basis\":\"x\"}}")
expect_err "$BODY" 'development case not found'
echo "   every client-callable 4B read and act refuses a foreign tenant and an orphan JWT BY NAME"

# estimate_confidence_rating is an INTERNAL helper: its only callers are the
# definers in this slice that scope the case first, so it has no EXECUTE for
# anyone at all — the 4A posture for controls_structure_state, for the reason
# 4A recorded. Its BODY carries the dual-caller gate too, so a future grant
# cannot re-open the hole.
for WHO in "$FOREIGNER" "$PLANNER" "$ORPHAN"; do
  BODY=$(rpc "$WHO" estimate_confidence_rating "{\"p_case_id\":\"$CASE\"}")
  expect_err "$BODY" 'permission denied'
done
test "$(psqlc "select count(*) from information_schema.role_routine_grants where routine_name='estimate_confidence_rating' and grantee in ('anon','authenticated','service_role','PUBLIC')")" = "0"
FOREIGN_UID=$(psqlc "select id from user_profiles where email='smoke4b-foreign@syncai.ca'")
test -n "$FOREIGN_UID"
OUT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tA \
        -c "select set_config('request.jwt.claim.sub','$FOREIGN_UID',false)" \
        -c "select coalesce(estimate_confidence_rating('$CASE')->>'error','LEAKED')")
grep -q 'development case not found' <<<"$OUT"
grep -qv 'LEAKED' <<<"$OUT"
echo "   the estimate-basis helper is callable by nobody, and its body refuses a foreign tenant even if a grant returns"

# ...and the eight-dimension prose is genuinely unreachable to the foreigner
# through every other door: the table read is empty and the scoped read
# refuses by name.
test "$(psqlc "select count(*) from project_estimate_basis where development_case_id='$CASE'")" -ge "1"
BODY=$(rpc "$FOREIGNER" get_case_estimate_basis "{\"p_case_id\":\"$CASE\"}")
expect_err "$BODY" 'development case not found'
test "$(curl -sS "$API_URL/rest/v1/project_estimate_basis?development_case_id=eq.$CASE" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $FOREIGNER")" = "[]"
echo "   no door hands another tenant the estimate defence — RPC, helper and table all refuse"

echo
echo "Develop slice-4b smoke PASSED — rules of credit, derived progress, the earned value suite with every refusal named, the eight-dimension estimate basis, the progress integrity cross-check, an honest absent P50/P80, and lineage on all five calculations."

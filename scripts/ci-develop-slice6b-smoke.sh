#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 6B — the commercial life of a contract after signature:
# the ChangeOrder that routes through the award's own delegated ceiling, the
# Invoice that cannot be paid twice, the Claim that freezes when it is
# answered, the Warranty that expires and stops covering, the vendor quality
# record that accrues from acts, the specification-to-failure thread, and the
# §78 procurement-status connector. Every step is a live transcript against a
# real local database, run TWICE in a row on one database before it was
# committed.
#
# Steps:
#   0  fixtures: a case, its cost model, two suppliers, an awarded contract.
#   1  D6.06 ChangeOrder — the refusals: before the award, outside every case,
#      NaN, a change that moves nothing, a contract taken negative.
#   2  D6.06 ChangeOrder — the decision: §70 refused, self-approval refused,
#      ABOVE the cumulative ceiling refused BY NAME with a security_events row,
#      approved, and FROZEN for every writer afterwards.
#   3  D6.06 × D6.05 — the commitment feeds the ONE cost model and nothing
#      here becomes a second writer: over-committed BEFORE the change order,
#      approved after it, and a reduction below the approved commitment
#      refused by name.
#   4  D6.06 Invoice — payable ONCE: the duplicate number, the second payment,
#      the un-payment and the reused bank reference, each refused.
#   5  D6.06 Claim — frozen once answered, §70 at the door and at the table,
#      and the settled-but-not-carried gap NAMED rather than added.
#   6  D6.06 Warranty — a term with no expiry refused; an EXPIRED term stops
#      covering, provably; a legacy unbounded term REFUSES to answer cover;
#      the claim window; time_barred; the §70 settlement.
#   7  D6.01 VendorQualityRecord — refuses with no periods, accrues from acts,
#      refuses each ratio it cannot compute, refuses an overlapping period.
#   8  D6.07 — the specification-to-failure thread refuses at each broken hop
#      and runs the whole way once the hops exist; the reverse direction comes
#      from the live design-feedback traversal.
#   9  D11.33 / §78 — the procurement-status connector moves real data through
#      the ONE ingest contract and the ONE §25 status writer, and cannot type
#      an award or a goods receipt.
#  10  cross-tenant: a foreign member sees no change order, no invoice, no
#      claim and no warranty.
#  11  the ledgers are untruncatable and the §70 walls hold for every writer.
#
# Run: supabase start && scripts/ci-develop-slice6b-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-6b smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
ORG2='6b000000-0000-4000-8000-6b000000000b'

# ONE execution, capturing output and status together (the 5B lesson): running
# the candidate twice means a REGRESSED guard performs the write on the first
# run and only trips on the second.
sql_must_fail(){ local out rc
  out=$( { PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 <<<"$1"; } ); rc=$?
  if [ "$rc" = "0" ]; then
    echo "expected SQL to be refused, it succeeded: $1"; return 1
  fi
  printf '%s' "$out"
}
field(){ python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$1'); print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))"; }
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and (x.get('error') or x.get('message') or x.get('code')):
    print('unexpected error:',x); sys.exit(1)
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
rest(){ curl -sS "$API_URL/rest/v1/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
jqp(){ BODY="$1" EXPR="$2" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
print(eval(os.environ['EXPR'], {'x': x, 'json': json}))
PY
}

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
ENGINEER=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$EXEC"; test -n "$ENGINEER"

PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
EXEC_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='executive@syncai.ca'")
test -n "$PLANNER_ID"; test -n "$MANAGER_ID"; test -n "$EXEC_ID"

# The AI-operator identity, seeded exactly as the sibling transcripts seed it,
# so the smokes share one fixture in CI and each still stands alone.
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
AIBOT_ID=$(psqlc "select id from user_profiles where email='smoke-aibot@syncai.ca'")
test -n "$AIBOT"; test -n "$AIBOT_ID"

# The FOREIGN tenant, provisioned by this smoke rather than borrowed: a
# cross-tenant negative that SKIPS when the other tenant happens not to exist
# is a negative test that passes by not running.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
declare v_uid uuid := '6b6b6b6b-6666-4666-8666-6b6b6b6b6b6b';
        v_org uuid := '6b000000-0000-4000-8000-6b000000000b';
begin
  insert into organizations (id, name) values (v_org, 'S6B foreign tenant')
    on conflict (id) do nothing;
  if not exists (select 1 from auth.users where email = 'smoke6b-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke6b-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'S6B foreign member'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  if not exists (select 1 from auth.identities where user_id = v_uid) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke6b-foreign@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_uid, v_org, 'smoke6b-foreign@syncai.ca', 'maintenance_manager')
  on conflict (id) do update set organization_id = v_org, role = 'maintenance_manager';
end $seed$;
PSQL
FOREIGN=$(token 'smoke6b-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGN"

# ── Idempotent re-run. Fixture keys are kept SHORT on purpose — long fixture
#    identifiers have been read as secrets by the repository's scanner and have
#    blocked merges.
#
#    An AWARDED package refuses deletion while its case exists, and so do its
#    invoices, its claims, its change orders, its warranty terms and their
#    claims. That is the product working, so this teardown does what the
#    product allows: it deletes the CASES, and every one of those rows goes
#    with them through the declared cascades each wall admits mid-cascade.
#    Nothing here deletes something the product forbids deleting.
psqlc "delete from development_cases where organization_id='$ORG' and title like 'S6B %';" >/dev/null
psqlc "delete from development_cases where organization_id='$ORG' and title like 'S6R %';" >/dev/null
psqlc "delete from contract_packages where organization_id='$ORG' and package_code like 'S6R-%';" >/dev/null
psqlc "delete from warranty_terms where organization_id='$ORG' and warranty_ref like 'S6R-%';" >/dev/null
psqlc "delete from suppliers where organization_id='$ORG' and supplier_code like 'S6R-%';" >/dev/null
psqlc "delete from business_cases where organization_id='$ORG' and case_ref like 'S6B-%';" >/dev/null
psqlc "delete from contract_packages where organization_id='$ORG' and package_code like 'S6B-%';" >/dev/null
psqlc "delete from warranty_terms where organization_id='$ORG' and warranty_ref like 'S6B-%';" >/dev/null
psqlc "delete from design_requirements where organization_id='$ORG' and requirement_ref like 'S6B-%';" >/dev/null
psqlc "delete from bom_lines where organization_id='$ORG' and position_note like 'S6B%';" >/dev/null
psqlc "delete from work_orders where organization_id='$ORG' and wo_number like 'S6B-%';" >/dev/null
psqlc "delete from material_suppliers where organization_id='$ORG' and supplier_part_number like 'S6B-%';" >/dev/null
psqlc "delete from materials where organization_id='$ORG' and material_code like 'S6B-%';" >/dev/null
psqlc "delete from suppliers where organization_id='$ORG' and supplier_code like 'S6B-%';" >/dev/null
psqlc "delete from assets where organization_id='$ORG' and tag like 'S6B-%';" >/dev/null
psqlc "delete from capital_projects where organization_id='$ORG' and project_code like 'S6B-%';" >/dev/null
psqlc "update authority_limits set status='superseded' where organization_id='$ORG' and action_type='contract_award' and status='adopted';" >/dev/null
psqlc "delete from authority_limits where organization_id='$ORG' and action_type='contract_award' and status='draft';" >/dev/null
test "$(psqlc "select count(*) from contract_packages where organization_id='$ORG' and package_code like 'S6B-%'")" = "0"
test "$(psqlc "select count(*) from warranty_terms where organization_id='$ORG' and warranty_ref like 'S6B-%'")" = "0"

echo "── 0. fixtures: a case, its cost model and an awarded contract ──────────"

PROJ=$(psqlc "with r as (insert into capital_projects (organization_id, project_code, title, status)
  values ('$ORG','S6B-P','S6B delivery project','active') returning id) select id from r")
test -n "$PROJ"

R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S6B commercial case\",\"p_problem_statement\":\"The mill motor contract is signed and nothing in this product records what happens to it afterwards: the variations, the invoices, the claims and the warranty are all in somebody else's spreadsheet.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE=$(printf '%s' "$R" | field case_id); test -n "$CASE"
psqlc "update development_cases set capital_project_id=$PROJ where id='$CASE';" >/dev/null

R=$(rpc "$PLANNER" create_case_business_case "{\"p_case_id\":\"$CASE\",\"p_case_ref\":\"S6B-BC\",\"p_title\":\"Mill motor replacement\",\"p_driver\":\"reliability\",\"p_currency\":\"CAD\",\"p_discount_rate\":0.08,\"p_discount_rate_source\":\"Corporate treasury WACC memo 2026-Q2\"}")
noerr "$R"
R=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1\",\"title\":\"Mill motor package\",\"scope_description\":\"Everything inside the mill motor replacement package as scoped for the slice 6B transcript\"}}")
noerr "$R"
R=$(rpc "$PLANNER" record_cbs_code "{\"p_case_id\":\"$CASE\",\"p_code\":{\"cbs_code\":\"S6B-C100\",\"title\":\"Mechanical works\",\"cost_type\":\"subcontract\"}}")
noerr "$R"
R=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"S6B-CI1\",\"wbs_code\":\"1\",\"cbs_code\":\"S6B-C100\",\"description\":\"Mill motor supply\",\"basis\":\"Budget estimate from the concept study, 2026-Q3\",\"baseline_cost\":\"700000\"}}")
noerr "$R"

psqlc "insert into suppliers (organization_id, supplier_code, name, supplier_kind, approved_vendor, safety_qualification_status)
       values ('$ORG','S6B-SA','S6B Motors A','oem',true,'qualified'),
              ('$ORG','S6B-SB','S6B Motors B','oem',true,'qualified');" >/dev/null
SUP_A=$(psqlc "select id from suppliers where organization_id='$ORG' and supplier_code='S6B-SA'")
SUP_B=$(psqlc "select id from suppliers where organization_id='$ORG' and supplier_code='S6B-SB'")
test -n "$SUP_A"; test -n "$SUP_B"

REQ=$(psqlc "select (current_date + 400)::text")
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6B-P1\",\"title\":\"Mill motor\",\"equipment_or_scope\":\"One 4.2 MW synchronous mill motor with its VSD and cooling package\",\"scope_of_work\":\"Design, manufacture, factory-test and deliver the motor, VSD and cooling package to site\",\"acceptance_criteria\":\"Factory acceptance test at rated load, and site acceptance on no-load run\",\"required_date\":\"$REQ\",\"lead_time_days\":\"90\",\"wbs_code\":\"1\"}}")
noerr "$R"; P1=$(printf '%s' "$R" | field package_id); test -n "$P1"

# A SECOND package, never awarded, so every "there is no contract yet" refusal
# has a real row to be refused against.
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6B-P2\",\"title\":\"Spares kit\",\"equipment_or_scope\":\"Two years of recommended operating spares for the motor and VSD\"}}")
noerr "$R"; P2=$(printf '%s' "$R" | field package_id); test -n "$P2"

R=$(rpc "$PLANNER" invite_package_bidder "{\"p_package_id\":$P1,\"p_supplier_id\":$SUP_A,\"p_prequalification_basis\":\"Supplied four motors of this frame size on the 2024 concentrator, all inside their promised window\"}")
noerr "$R"
R=$(rpc "$PLANNER" invite_package_bidder "{\"p_package_id\":$P1,\"p_supplier_id\":$SUP_B,\"p_prequalification_basis\":\"Rebuilt the 2019 mill motor to specification and inside the outage window\"}")
noerr "$R"
R=$(rpc "$PLANNER" open_package_bidding "{\"p_package_id\":$P1,\"p_close_at\":\"$(psqlc "select (now() + interval '1 hour')::text")\"}")
noerr "$R"
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6B-SA\",\"price\":\"600000\",\"currency\":\"CAD\",\"labour_hours\":\"1200\",\"assumed_productivity_factor\":\"1.0\",\"duration_days\":\"210\"}}")
noerr "$R"; BID_A=$(printf '%s' "$R" | field bid_id); test -n "$BID_A"
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6B-SB\",\"price\":\"720000\",\"currency\":\"CAD\",\"duration_days\":\"260\"}}")
noerr "$R"; BID_B=$(printf '%s' "$R" | field bid_id); test -n "$BID_B"
psqlc "update contract_packages set bids_close_at = now() - interval '1 minute' where id=$P1;" >/dev/null
R=$(rpc "$MANAGER" open_package_bids "{\"p_package_id\":$P1,\"p_note\":\"Opening the envelopes at the stated close, with the register present.\"}")
noerr "$R"
# The two evaluations are separate judgements by SEPARATE PEOPLE, and neither
# of them may be the person who lodged the bid — the tender family enforces
# both. The planner lodged, so the engineer takes the technical leg and the
# executive the commercial one; the manager, who evaluated nothing, awards.
for B in "$BID_A" "$BID_B"; do
  R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$B,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"compliant\",\"rationale\":\"Assessed against the issued specification and found compliant on the technical leg\"}}")
  noerr "$R"
  R=$(rpc "$EXEC" record_bid_evaluation "{\"p_bid_id\":$B,\"p_evaluation\":{\"evaluation_kind\":\"commercial\",\"outcome\":\"compliant\",\"rationale\":\"Priced against the issued schedule of rates and found compliant on the commercial leg\"}}")
  noerr "$R"
done

# The delegation: a stated ceiling of 700,000 CAD for the project manager.
psqlc "insert into authority_limits (organization_id, role_key, tier_label, action_type, max_commitment_usd, escalates_to_role, basis, status)
       values ('$ORG','maintenance_manager','Project manager','contract_award', null,'executive','Reseeded for the slice-6B transcript.','draft');" >/dev/null
LIMIT_ID=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='maintenance_manager' and action_type='contract_award' and status='draft' order by version desc limit 1")
test -n "$LIMIT_ID"
R=$(rpc "$EXEC" state_authority_ceiling "{\"p_id\":\"$LIMIT_ID\",\"p_ceiling\":{\"max_commitment\":\"700000\",\"currency\":\"CAD\",\"basis\":\"The capital delegation instrument dated this year, section 6.1 (procurement).\"}}")
noerr "$R"
R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$LIMIT_ID\",\"p_note\":\"Adopted from the capital delegation instrument dated this year.\"}")
noerr "$R"

R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P1,\"p_award\":{\"bid_id\":\"$BID_A\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Deliver the motor to the site acceptance criteria in the issued specification\",\"award_basis\":\"Lowest compliant price on a fully evaluated field of two bidders\",\"contract_start_date\":\"$(psqlc "select current_date::text")\",\"contract_completion_date\":\"$REQ\"}}")
noerr "$R"
test "$(printf '%s' "$R" | field value)" = "600000"

echo "── 1. D6.06 ChangeOrder — the refusals before anything is decided ───────"

# A change order changes a CONTRACT. Before the award there is nothing to
# change, and recording one would put a value movement on the ledger against an
# agreement nobody has made.
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$P2,\"p_change\":{\"change_order_ref\":\"CO-X\",\"description\":\"A variation on a package nobody has awarded yet\",\"reason\":\"Recorded before there is any contract to vary at all\",\"value_delta\":\"1000\"}}")
expect_err "$R" 'is not awarded'

# NaN is a legal numeric value in Postgres and survives every comparison.
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$P1,\"p_change\":{\"change_order_ref\":\"CO-X\",\"description\":\"A variation priced with a value that is not a number\",\"reason\":\"Testing that NaN never reaches a contract value at all\",\"value_delta\":\"NaN\"}}")
expect_err "$R" 'must be a finite number'
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$P1,\"p_change\":{\"change_order_ref\":\"CO-X\",\"description\":\"A variation priced at infinity, which sums to infinity\",\"reason\":\"Testing that infinity never reaches a contract value either\",\"value_delta\":\"Infinity\"}}")
expect_err "$R" 'must be a finite number'

# A change order that moves neither money nor time changes nothing.
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$P1,\"p_change\":{\"change_order_ref\":\"CO-X\",\"description\":\"A variation that moves neither money nor any time\",\"reason\":\"Recorded so that a change of nothing is refused by name\",\"value_delta\":\"0\"}}")
expect_err "$R" 'moves neither money nor time'

# A contract cannot be taken negative.
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$P1,\"p_change\":{\"change_order_ref\":\"CO-X\",\"description\":\"A reduction larger than the whole contract value\",\"reason\":\"Recorded so a negative contract value is refused at the door\",\"value_delta\":\"-900000\"}}")
expect_err "$R" 'negative value is not a contract'

# THE ONE THAT WILL BE APPROVED.
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$P1,\"p_change\":{\"change_order_ref\":\"CO-1\",\"description\":\"Add the second cooling circuit and its instrumentation to the motor package\",\"reason\":\"The ambient design temperature was revised upward after the award and one circuit no longer meets it\",\"value_delta\":\"60000\",\"time_delta_days\":\"21\"}}")
noerr "$R"
test "$(printf '%s' "$R" | field contractValueNow)" = "600000"
test "$(printf '%s' "$R" | field contractValueIfApproved)" = "660000"
CO1=$(printf '%s' "$R" | field change_order_id); test -n "$CO1"
# A DRAFT changes nothing until it is decided.
test "$(psqlc "select contract_current_value($P1)")" = "600000"

# ...and one that will be refused above the CUMULATIVE ceiling.
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$P1,\"p_change\":{\"change_order_ref\":\"CO-2\",\"description\":\"Add the spare rotor and its transport frame to the motor package\",\"reason\":\"The spares strategy changed after the award and the rotor is now bought with the motor\",\"value_delta\":\"100000\"}}")
noerr "$R"
CO2=$(printf '%s' "$R" | field change_order_id); test -n "$CO2"

echo "── 2. D6.06 ChangeOrder — the decision, and the SAME delegated ceiling ──"

# §70: no AI identity approves a change order.
R=$(rpc "$AIBOT" decide_contract_change_order "{\"p_change_order_id\":$CO1,\"p_decision\":\"approved\",\"p_note\":\"The machine approving a variation on the owner's behalf\"}")
expect_err "$R" '§70 human act'

# A planner does not decide; a manager does.
R=$(rpc "$PLANNER" decide_contract_change_order "{\"p_change_order_id\":$CO1,\"p_decision\":\"approved\",\"p_note\":\"The person who wrote the variation approving their own variation\"}")
expect_err "$R" 'management or executive role'

# ...and the person who RECORDED it does not decide it either. The planner
# recorded these, so the manager may — this proves the other direction.
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$P1,\"p_change\":{\"change_order_ref\":\"CO-SELF\",\"description\":\"A variation recorded by the very person who will try to approve it\",\"reason\":\"Recorded so the self-approval control can be exercised in both directions\",\"value_delta\":\"1000\"}}")
noerr "$R"; CO_SELF=$(printf '%s' "$R" | field change_order_id)
psqlc "update contract_change_orders set recorded_by='$MANAGER_ID' where id=$CO_SELF;" >/dev/null
R=$(rpc "$MANAGER" decide_contract_change_order "{\"p_change_order_id\":$CO_SELF,\"p_decision\":\"approved\",\"p_note\":\"Approving a change order this same person recorded\"}")
expect_err "$R" 'Approving your own change order is not an approval'

# THE DECISION. Routed through authority_limits.action_type = contract_award —
# the same store, the same evaluator and the same adopted row the award used.
R=$(rpc "$MANAGER" decide_contract_change_order "{\"p_change_order_id\":$CO1,\"p_decision\":\"approved\",\"p_note\":\"Approved against the revised ambient design case and inside the project manager delegation\"}")
noerr "$R"
test "$(printf '%s' "$R" | field contractValue)" = "660000"
test "$(printf '%s' "$R" | field contractValueBefore)" = "600000"
test "$(printf '%s' "$R" | field ceiling)" = "700000"
test "$(psqlc "select contract_current_value($P1)")" = "660000"
# The award itself is UNCHANGED: a contract moves through change orders and
# nowhere else.
test "$(psqlc "select awarded_value from contract_packages where id=$P1")" = "600000"
# The approval quotes the ceiling it passed.
test "$(psqlc "select authority_limit_id::text from contract_change_orders where id=$CO1")" = "$LIMIT_ID"

# THE CUMULATIVE CEILING (4D-R8, extended to change orders): 600,000 awarded
# plus 60,000 already approved leaves 40,000 of headroom, so a further 100,000
# is refused BY NAME — a delegation defeated by awarding small and changing
# five times is not a delegation.
R=$(rpc "$MANAGER" decide_contract_change_order "{\"p_change_order_id\":$CO2,\"p_decision\":\"approved\",\"p_note\":\"Approving a second variation that takes the cumulative commitment past the ceiling\"}")
expect_err "$R" 'already awarded'
test "$(printf '%s' "$R" | field alreadyCommittedOnCase)" = "660000"
test "$(psqlc "select count(*) from security_events where organization_id='$ORG'
                and detail like '%Change order CO-2 on package S6B-P1%'")" -ge 1
test "$(psqlc "select status from contract_change_orders where id=$CO2")" = "draft"

# A DECIDED change order is frozen for every writer, service paths included.
OUT=$(sql_must_fail "update contract_change_orders set value_delta = 999999 where id=$CO1;")
grep -qi 'FROZEN for every caller' <<<"$OUT"
OUT=$(sql_must_fail "update contract_change_orders set status='draft', decided_at=null, decided_by=null, decision_note=null where id=$CO1;")
grep -qi 'FROZEN for every caller' <<<"$OUT"
# ...and it is not deleted.
OUT=$(sql_must_fail "delete from contract_change_orders where id=$CO1;")
grep -qi 'not deleted' <<<"$OUT"
# A second decision is refused at the door.
R=$(rpc "$MANAGER" decide_contract_change_order "{\"p_change_order_id\":$CO1,\"p_decision\":\"rejected\",\"p_note\":\"Deciding an already-decided change order a second time\"}")
expect_err "$R" 'A change order is decided once'

# A change order in a currency the contract is not denominated in never reaches
# contract_current_value — the wall refuses it for every writer.
OUT=$(sql_must_fail "insert into contract_change_orders (organization_id, package_id, change_order_ref, description, reason, value_delta, currency)
  values ('$ORG',$P1,'CO-USD','A variation priced in another currency entirely','Recorded so a cross-currency contract value is refused', 1000, 'USD');")
grep -qi 'no exchange rate' <<<"$OUT"

echo "── 3. D6.06 × D6.05 — the ONE cost model, and the single writer ─────────"

# BEFORE the change order the commitment would have exceeded the contract; the
# refusal is the same predicate the screen reads.
R=$(rpc "$PLANNER" record_contract_commitment_line "{\"p_package_id\":$P1,\"p_line\":{\"line_ref\":\"L1\",\"cost_item_ref\":\"S6B-CI1\",\"description\":\"Motor supply, whole contract\",\"basis\":\"The awarded lump sum plus the approved variation\",\"amount\":\"640000\"}}")
noerr "$R"
R=$(rpc "$MANAGER" approve_contract_commitments "{\"p_package_id\":$P1,\"p_note\":\"Approving the commitment lines against the contract as it now stands\"}")
noerr "$R"
test "$(printf '%s' "$R" | field total)" = "640000"
# THE ONE WRITER: project_cost_items.commitment is the sum of the approved
# lines, written through record_cost_item's own door.
test "$(psqlc "select commitment from project_cost_items where organization_id='$ORG' and cost_item_ref='S6B-CI1'")" = "640000"
# The commitment position now compares against the CURRENT contract value, and
# reports both halves.
POS=$(psqlc "select contract_commitment_position($P1)::text")
test "$(printf '%s' "$POS" | field contractValue)" = "660000"
test "$(printf '%s' "$POS" | field awardedValue)" = "600000"
test "$(printf '%s' "$POS" | field changeOrderDelta)" = "60000"
test "$(printf '%s' "$POS" | field overCommitted)" = "False"

# A REDUCTION BELOW THE APPROVED COMMITMENT is refused and NAMES the lines:
# taking the contract there would leave the cost model explaining money no
# contract obliges, with the single-writer rule holding it in place.
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$P1,\"p_change\":{\"change_order_ref\":\"CO-3\",\"description\":\"Remove the second cooling circuit again and credit the difference\",\"reason\":\"A de-scope recorded so that a reduction below the approved commitment is refused\",\"value_delta\":\"-50000\"}}")
noerr "$R"; CO3=$(printf '%s' "$R" | field change_order_id)
R=$(rpc "$MANAGER" decide_contract_change_order "{\"p_change_order_id\":$CO3,\"p_decision\":\"approved\",\"p_note\":\"Approving a de-scope that would take the contract below what is already committed\"}")
expect_err "$R" 'below what is already committed'
test "$(printf '%s' "$R" | field approvedCommitment)" = "640000"
# The cost model is untouched by the refusal.
test "$(psqlc "select commitment from project_cost_items where organization_id='$ORG' and cost_item_ref='S6B-CI1'")" = "640000"

# A SMALLER de-scope is allowed, and the committed figure is unmoved by it —
# nothing in this slice writes project_cost_items.
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$P1,\"p_change\":{\"change_order_ref\":\"CO-4\",\"description\":\"Remove the transport frame from the supplier scope and self-perform it\",\"reason\":\"A de-scope inside the headroom between the contract value and the approved commitment\",\"value_delta\":\"-10000\"}}")
noerr "$R"; CO4=$(printf '%s' "$R" | field change_order_id)
R=$(rpc "$MANAGER" decide_contract_change_order "{\"p_change_order_id\":$CO4,\"p_decision\":\"approved\",\"p_note\":\"Approved as a credit against the transport frame now being self-performed\"}")
noerr "$R"
test "$(psqlc "select contract_current_value($P1)")" = "650000"
test "$(psqlc "select commitment from project_cost_items where organization_id='$ORG' and cost_item_ref='S6B-CI1'")" = "640000"

echo "── 4. D6.06 Invoice — payable ONCE ─────────────────────────────────────"

R=$(rpc "$PLANNER" record_contract_invoice "{\"p_package_id\":$P2,\"p_invoice\":{\"invoice_ref\":\"INV-X\",\"invoice_date\":\"$(psqlc "select current_date::text")\",\"description\":\"An invoice against a package nobody awarded\",\"gross_amount\":\"1000\"}}")
expect_err "$R" 'is not awarded'
R=$(rpc "$PLANNER" record_contract_invoice "{\"p_package_id\":$P1,\"p_invoice\":{\"invoice_ref\":\"INV-X\",\"invoice_date\":\"$(psqlc "select current_date::text")\",\"description\":\"An invoice priced at a value that is not a number\",\"gross_amount\":\"NaN\"}}")
expect_err "$R" 'finite amount greater than zero'
R=$(rpc "$PLANNER" record_contract_invoice "{\"p_package_id\":$P1,\"p_invoice\":{\"invoice_ref\":\"INV-X\",\"invoice_date\":\"$(psqlc "select (current_date + 3)::text")\",\"description\":\"An invoice dated three days from now\",\"gross_amount\":\"1000\"}}")
expect_err "$R" 'dated in the future'

# An empty invoice set REFUSES rather than reporting a confident zero.
IPOS=$(psqlc "select contract_invoice_position($P1)::text")
test "$(printf '%s' "$IPOS" | field answered)" = "False"
grep -qi 'nothing outstanding' <<<"$IPOS"

TODAY=$(psqlc "select current_date::text")
R=$(rpc "$PLANNER" record_contract_invoice "{\"p_package_id\":$P1,\"p_invoice\":{\"invoice_ref\":\"INV-1\",\"invoice_date\":\"$TODAY\",\"description\":\"First progress claim against the motor package\",\"gross_amount\":\"300000\"}}")
noerr "$R"; INV1=$(printf '%s' "$R" | field invoice_id); test -n "$INV1"

# WALL 1 — the same supplier's invoice number exists once in the organization,
# and the refusal names the package the first one is on.
R=$(rpc "$PLANNER" record_contract_invoice "{\"p_package_id\":$P2,\"p_invoice\":{\"invoice_ref\":\"INV-1\",\"invoice_date\":\"$TODAY\",\"description\":\"The same invoice number lodged against another package\",\"gross_amount\":\"300000\"}}")
expect_err "$R" 'is not awarded'
OUT=$(sql_must_fail "insert into contract_invoices (organization_id, package_id, invoice_ref, supplier_id, invoice_date, description, gross_amount, currency)
  values ('$ORG',$P1,'inv-1',$SUP_A,current_date,'The same number in a different case','300000','CAD');")
grep -qi 'duplicate key value' <<<"$OUT"

# §70 and the separation of duties on certification.
R=$(rpc "$AIBOT" certify_contract_invoice "{\"p_invoice_id\":$INV1,\"p_decision\":\"certified\",\"p_note\":\"The machine certifying that money is due to a counterparty\"}")
expect_err "$R" '§70 human act'
R=$(rpc "$PLANNER" certify_contract_invoice "{\"p_invoice_id\":$INV1,\"p_decision\":\"certified\",\"p_note\":\"The person who entered the invoice certifying it themselves\"}")
expect_err "$R" 'management or executive role'
psqlc "update contract_invoices set recorded_by='$MANAGER_ID' where id=$INV1;" >/dev/null
R=$(rpc "$MANAGER" certify_contract_invoice "{\"p_invoice_id\":$INV1,\"p_decision\":\"certified\",\"p_note\":\"Certifying an invoice this same person entered into the system\"}")
expect_err "$R" 'Certifying an invoice you entered'
psqlc "update contract_invoices set recorded_by='$PLANNER_ID' where id=$INV1;" >/dev/null

# Certifying more than was invoiced pays money nobody billed for.
R=$(rpc "$MANAGER" certify_contract_invoice "{\"p_invoice_id\":$INV1,\"p_decision\":\"certified\",\"p_note\":\"Certifying more than the supplier actually invoiced\",\"p_certified_amount\":\"400000\"}")
expect_err "$R" 'Certifying more than was invoiced'

R=$(rpc "$MANAGER" certify_contract_invoice "{\"p_invoice_id\":$INV1,\"p_decision\":\"certified\",\"p_note\":\"Certified against the measured progress at the end of the period\",\"p_certified_amount\":\"280000\"}")
noerr "$R"
test "$(printf '%s' "$R" | field certifiedAmount)" = "280000"
test "$(printf '%s' "$R" | field withheld)" = "20000"
test "$(printf '%s' "$R" | field remainingToCertify)" = "370000"

# A certified invoice is FROZEN for every writer.
OUT=$(sql_must_fail "update contract_invoices set gross_amount = 999999 where id=$INV1;")
grep -qi 'FROZEN for every caller' <<<"$OUT"
R=$(rpc "$PLANNER" record_contract_invoice "{\"p_package_id\":$P1,\"p_invoice\":{\"invoice_ref\":\"INV-1\",\"invoice_date\":\"$TODAY\",\"description\":\"Re-pricing the certified invoice through the door\",\"gross_amount\":\"999999\"}}")
expect_err "$R" 'is frozen'

# OVER-CERTIFICATION against the CURRENT contract value, refused by name.
R=$(rpc "$PLANNER" record_contract_invoice "{\"p_package_id\":$P1,\"p_invoice\":{\"invoice_ref\":\"INV-2\",\"invoice_date\":\"$TODAY\",\"description\":\"Second progress claim against the motor package\",\"gross_amount\":\"400000\"}}")
noerr "$R"; INV2=$(printf '%s' "$R" | field invoice_id)
R=$(rpc "$MANAGER" certify_contract_invoice "{\"p_invoice_id\":$INV2,\"p_decision\":\"certified\",\"p_note\":\"Certifying beyond what the contract obliges the owner to pay at all\"}")
expect_err "$R" 'beyond what the contract obliges the owner to pay'
test "$(printf '%s' "$R" | field contractValue)" = "650000"

# WALL 2 — only a CERTIFIED invoice is payable, and it is payable once.
R=$(rpc "$MANAGER" record_invoice_payment "{\"p_invoice_id\":$INV2,\"p_payment_reference\":\"BANK-6B-1\",\"p_note\":\"Paying an invoice nobody certified\"}")
expect_err "$R" 'Only a CERTIFIED invoice is payable'
R=$(rpc "$MANAGER" record_invoice_payment "{\"p_invoice_id\":$INV1,\"p_payment_reference\":\"BANK-6B-1\",\"p_note\":\"Settled from the project account on the weekly payment run\"}")
noerr "$R"
test "$(printf '%s' "$R" | field paidAmount)" = "280000"
R=$(rpc "$MANAGER" record_invoice_payment "{\"p_invoice_id\":$INV1,\"p_payment_reference\":\"BANK-6B-2\",\"p_note\":\"Paying the same invoice a second time on a later run\"}")
expect_err "$R" 'not payable a second time'
grep -qi 'BANK-6B-1' <<<"$R"

# WALL 3 — un-paying is refused at the TABLE, for every caller.
OUT=$(sql_must_fail "update contract_invoices set paid_at=null, paid_by=null, payment_reference=null, status='certified' where id=$INV1;")
grep -qi 'immutable for every caller' <<<"$OUT"

# WALL 4 — one bank payment settles one invoice.
R=$(rpc "$MANAGER" certify_contract_invoice "{\"p_invoice_id\":$INV2,\"p_decision\":\"certified\",\"p_note\":\"Certified at the amount remaining inside the contract value\",\"p_certified_amount\":\"370000\"}")
noerr "$R"
R=$(rpc "$MANAGER" record_invoice_payment "{\"p_invoice_id\":$INV2,\"p_payment_reference\":\"bank-6b-1\",\"p_note\":\"Reusing the bank reference the first payment already carries\"}")
expect_err "$R" 'already recorded against invoice'
R=$(rpc "$MANAGER" record_invoice_payment "{\"p_invoice_id\":$INV2,\"p_payment_reference\":\"BANK-6B-2\",\"p_note\":\"Settled from the project account on the following payment run\"}")
noerr "$R"
IPOS=$(psqlc "select contract_invoice_position($P1)::text")
test "$(printf '%s' "$IPOS" | field certifiedTotal)" = "650000"
test "$(printf '%s' "$IPOS" | field paidTotal)" = "650000"
test "$(printf '%s' "$IPOS" | field overCertified)" = "False"
# An invoice is never deleted — a paid one is the only record the money went.
OUT=$(sql_must_fail "delete from contract_invoices where id=$INV1;")
grep -qi 'not deleted' <<<"$OUT"

echo "── 5. D6.06 Claim — frozen once answered ───────────────────────────────"

R=$(rpc "$PLANNER" record_contract_claim "{\"p_package_id\":$P1,\"p_claim\":{\"claim_ref\":\"CL-X\",\"direction\":\"sideways\",\"grounds\":\"A claim in a direction the contract has no side for\",\"claimed_value\":\"1000\"}}")
expect_err "$R" 'state the direction'
R=$(rpc "$PLANNER" record_contract_claim "{\"p_package_id\":$P1,\"p_claim\":{\"claim_ref\":\"CL-X\",\"direction\":\"from_supplier\",\"grounds\":\"A claim whose value is not a finite number at all\",\"claimed_value\":\"NaN\"}}")
expect_err "$R" 'finite amount of at least zero'

R=$(rpc "$PLANNER" record_contract_claim "{\"p_package_id\":$P1,\"p_claim\":{\"claim_ref\":\"CL-1\",\"direction\":\"from_supplier\",\"grounds\":\"Clause 12.4 — site access was withheld for eleven days during the winter shutdown window\",\"claimed_value\":\"45000\",\"time_claimed_days\":\"11\"}}")
noerr "$R"; CL1=$(printf '%s' "$R" | field claim_id); test -n "$CL1"

# §70 and the separation of duties on the answer.
R=$(rpc "$AIBOT" answer_contract_claim "{\"p_claim_id\":$CL1,\"p_answer\":\"accepted\",\"p_note\":\"The machine determining a contractual entitlement between two parties\"}")
expect_err "$R" '§70 human act'
psqlc "update contract_claims set raised_by='$MANAGER_ID' where id=$CL1;" >/dev/null
R=$(rpc "$MANAGER" answer_contract_claim "{\"p_claim_id\":$CL1,\"p_answer\":\"accepted\",\"p_note\":\"Answering a claim this same person raised in the first place\"}")
expect_err "$R" 'Answering your own claim is not an answer'
psqlc "update contract_claims set raised_by='$PLANNER_ID' where id=$CL1;" >/dev/null

# "Accepted" at less than the amount claimed would make a negotiated reduction
# indistinguishable from a claim paid in full, in every total.
R=$(rpc "$MANAGER" answer_contract_claim "{\"p_claim_id\":$CL1,\"p_answer\":\"accepted\",\"p_note\":\"Calling a negotiated reduction a full acceptance of the claim\",\"p_settled_value\":\"20000\"}")
expect_err "$R" 'Accepting in full means settling at the amount claimed'
# ...and an answer cannot grant more time than was claimed.
R=$(rpc "$MANAGER" answer_contract_claim "{\"p_claim_id\":$CL1,\"p_answer\":\"partially_accepted\",\"p_note\":\"Granting more extension of time than the supplier ever claimed\",\"p_settled_value\":\"20000\",\"p_settled_time_days\":\"40\"}")
expect_err "$R" 'cannot grant more time than was claimed'

R=$(rpc "$MANAGER" answer_contract_claim "{\"p_claim_id\":$CL1,\"p_answer\":\"partially_accepted\",\"p_note\":\"Six of the eleven days are the owner's on the site diary; the balance is the contractor's own sequencing\",\"p_settled_value\":\"20000\",\"p_settled_time_days\":\"6\"}")
noerr "$R"
test "$(printf '%s' "$R" | field settledValue)" = "20000"
test "$(printf '%s' "$R" | field frozen)" = "True"
grep -qi 'record a change order carrying this settlement' <<<"$R"

# FROZEN, for every writer, and a second answer refused at the door.
OUT=$(sql_must_fail "update contract_claims set claimed_value = 999999 where id=$CL1;")
grep -qi 'FROZEN for every caller' <<<"$OUT"
OUT=$(sql_must_fail "update contract_claims set settled_value = 45000 where id=$CL1;")
grep -qi 'FROZEN for every caller' <<<"$OUT"
R=$(rpc "$MANAGER" answer_contract_claim "{\"p_claim_id\":$CL1,\"p_answer\":\"rejected\",\"p_note\":\"Re-answering a claim that has already been answered once\"}")
expect_err "$R" 'A claim is answered once'
R=$(rpc "$PLANNER" record_contract_claim "{\"p_package_id\":$P1,\"p_claim\":{\"claim_ref\":\"CL-1\",\"direction\":\"from_supplier\",\"grounds\":\"Re-writing the grounds of a claim that has already been answered\",\"claimed_value\":\"90000\"}}")
expect_err "$R" 'is frozen'
OUT=$(sql_must_fail "delete from contract_claims where id=$CL1;")
grep -qi 'never deleted' <<<"$OUT"

# THE SETTLED-BUT-NOT-CARRIED GAP, named rather than added. The contract's
# value is unchanged by the settlement — a change order carries money into a
# contract, an accepted claim does not.
test "$(psqlc "select contract_current_value($P1)")" = "650000"
COMM=$(rpc "$MANAGER" get_contract_commercial "{\"p_package_id\":$P1}")
noerr "$COMM"
# BOTH totals, stated separately, and NO difference between them. The read used
# to subtract the approved change-order delta from the net settlement and call
# the remainder "agreed money that no change order carries" — but nothing links
# a claim to the change order that carries it, and the delta is mostly scope, so
# that figure was wrong in both directions: an unrelated change order of the
# same size reported a false all-clear, and a scope change beside a settlement
# invented a shortfall.
grep -qi 'These are two separate facts and their difference is NOT a figure' <<<"$COMM"
! grep -qi 'agreed money that no change order carries' <<<"$COMM"
test "$(printf '%s' "$COMM" | field currentValue)" = "650000"

# A SECOND claim, left OPEN, so step 11 can probe the §70 wall on this table —
# the answer is the reserved act, and an ANSWERED claim is refused by the
# freeze wall before §70 is reached.
R=$(rpc "$PLANNER" record_contract_claim "{\"p_package_id\":$P1,\"p_claim\":{\"claim_ref\":\"CL-2\",\"direction\":\"against_supplier\",\"grounds\":\"Liquidated damages accruing against the supplier for the delayed factory acceptance test\",\"claimed_value\":\"15000\"}}")
noerr "$R"; CL2=$(printf '%s' "$R" | field claim_id); test -n "$CL2"

echo "── 6. D6.06 Warranty — it must expire, and an expired one stops covering ─"

ASSET=$(psqlc "with r as (insert into assets (organization_id, tag, name, asset_class, criticality)
  values ('$ORG','S6B-A1','S6B mill motor','motor','critical') returning id) select id from r")
test -n "$ASSET"

# A WARRANTY MUST EXPIRE. A term with neither an end date nor a usage limit is
# refused at the door.
R=$(rpc "$PLANNER" record_warranty_term "{\"p_term\":{\"warranty_ref\":\"S6B-WX\",\"covers\":\"Everything about the motor, apparently for ever\",\"basis\":\"Vendor quotation\",\"starts_on\":\"$TODAY\",\"asset_id\":\"$ASSET\",\"package_id\":\"$P1\"}}")
expect_err "$R" 'state when this warranty ends'
# ...and a usage limit with no unit is a number, not a warranty.
R=$(rpc "$PLANNER" record_warranty_term "{\"p_term\":{\"warranty_ref\":\"S6B-WX\",\"covers\":\"Covered to a usage limit nobody stated the unit of\",\"basis\":\"Vendor quotation\",\"starts_on\":\"$TODAY\",\"usage_limit\":\"12000\",\"asset_id\":\"$ASSET\",\"package_id\":\"$P1\"}}")
expect_err "$R" 'needs its unit'
# ...and a stated-but-unreadable usage limit is refused rather than dropped.
R=$(rpc "$PLANNER" record_warranty_term "{\"p_term\":{\"warranty_ref\":\"S6B-WX\",\"covers\":\"Covered to a usage limit that is not a finite quantity\",\"basis\":\"Vendor quotation\",\"starts_on\":\"$TODAY\",\"usage_limit\":\"NaN\",\"usage_unit\":\"operating hours\",\"ends_on\":\"$(psqlc "select (current_date + 365)::text")\",\"asset_id\":\"$ASSET\",\"package_id\":\"$P1\"}}")
expect_err "$R" 'must be a finite quantity'

# THE EXPIRED TERM.
W_EXP_START=$(psqlc "select (current_date - 800)::text")
W_EXP_END=$(psqlc "select (current_date - 400)::text")
R=$(rpc "$PLANNER" record_warranty_term "{\"p_term\":{\"warranty_ref\":\"S6B-W1\",\"covers\":\"Repair or replacement of the stator winding on failure attributable to manufacture\",\"basis\":\"Contract S6B-P1 clause 18\",\"starts_on\":\"$W_EXP_START\",\"ends_on\":\"$W_EXP_END\",\"claim_window_days\":\"30\",\"asset_id\":\"$ASSET\",\"package_id\":\"$P1\"}}")
noerr "$R"; W1=$(printf '%s' "$R" | field warranty_id); test -n "$W1"
COVER=$(printf '%s' "$R" | field coverToday)
test "$(printf '%s' "$COVER" | field covered)" = "False"
grep -qi 'EXPIRED' <<<"$COVER"

# AN EXPIRED WARRANTY STOPS COVERING, PROVABLY: a claim for a failure after the
# end date is refused in the ONE predicate's own words.
R=$(rpc "$PLANNER" raise_warranty_claim "{\"p_warranty_id\":$W1,\"p_claim\":{\"claim_ref\":\"S6B-WC-X\",\"failure_on\":\"$(psqlc "select (current_date - 300)::text")\",\"claim_value\":\"50000\",\"currency\":\"CAD\"}}")
expect_err "$R" 'EXPIRED'
grep -qi 'does not keep covering quietly' <<<"$R"
test "$(psqlc "select count(*) from warranty_claims where organization_id='$ORG' and claim_ref='S6B-WC-X'")" = "0"

# A failure BEFORE cover began is not covered either.
R=$(rpc "$PLANNER" raise_warranty_claim "{\"p_warranty_id\":$W1,\"p_claim\":{\"claim_ref\":\"S6B-WC-X\",\"failure_on\":\"$(psqlc "select (current_date - 900)::text")\",\"claim_value\":\"50000\",\"currency\":\"CAD\"}}")
expect_err "$R" 'before cover began'

# A failure INSIDE cover whose claim window closed long ago is TIME-BARRED at
# the door: the cover was real and the entitlement lapsed.
R=$(rpc "$PLANNER" raise_warranty_claim "{\"p_warranty_id\":$W1,\"p_claim\":{\"claim_ref\":\"S6B-WC-X\",\"failure_on\":\"$(psqlc "select (current_date - 500)::text")\",\"claim_value\":\"50000\",\"currency\":\"CAD\"}}")
expect_err "$R" 'TIME-BARRED'

# THE LIVE TERM.
W_START=$(psqlc "select (current_date - 100)::text")
W_END=$(psqlc "select (current_date + 265)::text")
R=$(rpc "$PLANNER" record_warranty_term "{\"p_term\":{\"warranty_ref\":\"S6B-W2\",\"covers\":\"Repair or replacement of the VSD power stack on failure attributable to manufacture\",\"basis\":\"Contract S6B-P1 clause 18.2\",\"starts_on\":\"$W_START\",\"ends_on\":\"$W_END\",\"usage_limit\":\"12000\",\"usage_unit\":\"operating hours\",\"claim_window_days\":\"60\",\"asset_id\":\"$ASSET\",\"package_id\":\"$P1\"}}")
noerr "$R"; W2=$(printf '%s' "$R" | field warranty_id); test -n "$W2"

# THE USAGE LEG. A reading past the limit is not covered whatever the calendar
# says; a term with no reading answers the DATE leg and NAMES the other.
COVER=$(psqlc "select warranty_cover_position($W2, (current_date - 10)::date, 13000)::text")
test "$(printf '%s' "$COVER" | field covered)" = "False"
grep -qi 'whatever the calendar says' <<<"$COVER"
COVER=$(psqlc "select warranty_cover_position($W2, (current_date - 10)::date, null)::text")
test "$(printf '%s' "$COVER" | field covered)" = "True"
test "$(printf '%s' "$COVER" | field usageAssessed)" = "False"
grep -qi 'not both' <<<"$COVER"

R=$(rpc "$PLANNER" raise_warranty_claim "{\"p_warranty_id\":$W2,\"p_claim\":{\"claim_ref\":\"S6B-WC1\",\"failure_on\":\"$(psqlc "select (current_date - 20)::text")\",\"claim_value\":\"38000\",\"currency\":\"CAD\",\"usage_at_failure\":\"5400\"}}")
noerr "$R"; WC1=$(printf '%s' "$R" | field claim_id); test -n "$WC1"
test "$(printf '%s' "$R" | field status)" = "raised"

R=$(rpc "$PLANNER" submit_warranty_claim "{\"p_claim_id\":$WC1,\"p_note\":\"Lodged with the vendor warranty desk under the contract reference\"}")
noerr "$R"
test "$(printf '%s' "$R" | field status)" = "submitted"

# §70 and the separation of duties on the settlement.
R=$(rpc "$AIBOT" answer_warranty_claim "{\"p_claim_id\":$WC1,\"p_outcome\":\"accepted\",\"p_note\":\"The machine closing an entitlement against a supplier for an agreed sum\",\"p_recovered_value\":\"38000\"}")
expect_err "$R" '§70 human act'
R=$(rpc "$MANAGER" answer_warranty_claim "{\"p_claim_id\":$WC1,\"p_outcome\":\"accepted\",\"p_note\":\"Accepting a settlement without stating what was actually recovered\"}")
expect_err "$R" 'states what was recovered'
R=$(rpc "$MANAGER" answer_warranty_claim "{\"p_claim_id\":$WC1,\"p_outcome\":\"accepted\",\"p_note\":\"Recovering more from the supplier than was ever claimed from them\",\"p_recovered_value\":\"90000\"}")
expect_err "$R" 'cannot recover more than was claimed'
R=$(rpc "$MANAGER" answer_warranty_claim "{\"p_claim_id\":$WC1,\"p_outcome\":\"accepted\",\"p_note\":\"Vendor accepted the power stack failure as a manufacturing defect and credited the parts\",\"p_recovered_value\":\"31000\"}")
noerr "$R"
test "$(printf '%s' "$R" | field recoveredValue)" = "31000"
test "$(printf '%s' "$R" | field shortfall)" = "7000"

# FROZEN, and a second answer refused.
OUT=$(sql_must_fail "update warranty_claims set recovered_value = 38000 where id=$WC1;")
grep -qi 'FROZEN for every caller' <<<"$OUT"
R=$(rpc "$MANAGER" answer_warranty_claim "{\"p_claim_id\":$WC1,\"p_outcome\":\"rejected\",\"p_note\":\"Re-answering a warranty claim the supplier already settled\"}")
expect_err "$R" 'A claim is answered once'
# The term is frozen too, now that a claim has been admitted under it.
R=$(rpc "$PLANNER" record_warranty_term "{\"p_term\":{\"warranty_ref\":\"S6B-W2\",\"covers\":\"Extending the cover after a claim has already been admitted under it\",\"basis\":\"Contract S6B-P1 clause 18.2\",\"starts_on\":\"$W_START\",\"ends_on\":\"$(psqlc "select (current_date + 2000)::text")\",\"claim_window_days\":\"60\",\"asset_id\":\"$ASSET\",\"package_id\":\"$P1\"}}")
expect_err "$R" 'frozen'
OUT=$(sql_must_fail "delete from warranty_claims where id=$WC1;")
grep -qi 'never deleted' <<<"$OUT"

# THE LEGACY SHAPE, which is why the predicate refuses rather than answering.
# warranty_terms predates this slice and every row in it could carry no expiry
# at all; a row of that shape is arranged here by the SERVICE path the wall
# admits-and-records, and the cover question REFUSES over it.
psqlc "insert into warranty_terms (organization_id, warranty_ref, asset_id, package_id, starts_on, covers, basis)
       values ('$ORG','S6B-W3','$ASSET',$P1,current_date - 30,'A legacy term whose end nobody ever recorded','Arranged by the slice 6B transcript');" >/dev/null
W3=$(psqlc "select id from warranty_terms where organization_id='$ORG' and warranty_ref='S6B-W3'")
test -n "$W3"
COVER=$(psqlc "select warranty_cover_position($W3, current_date, null)::text")
test "$(printf '%s' "$COVER" | field answered)" = "False"
grep -qi 'silently permanent cover' <<<"$COVER"
R=$(rpc "$PLANNER" raise_warranty_claim "{\"p_warranty_id\":$W3,\"p_claim\":{\"claim_ref\":\"S6B-WC-X\",\"failure_on\":\"$TODAY\",\"claim_value\":\"1000\",\"currency\":\"CAD\"}}")
expect_err "$R" 'neither an end date nor a usage limit'
# ...and the service-path write left the provenance backstop behind it.
test "$(psqlc "select count(*) from security_events where organization_id='$ORG'
                and detail like '%Warranty term S6B-W3%'")" -ge 1

# TIME_BARRED AT SUBMISSION. A claim raised inside its window and lodged after
# it closed is a real and expensive state, and the only way to reach it is for
# time to pass — so the claim row is arranged through the same service path,
# and the PRODUCT is what records the bar.
psqlc "insert into warranty_claims (organization_id, warranty_id, asset_id, claim_ref, failure_on, raised_on, claim_value, currency, cover_basis, status)
       values ('$ORG',$W2,'$ASSET','S6B-WC2', current_date - 90, current_date - 89, 5000, 'CAD','Arranged by the slice 6B transcript as a claim raised inside its window','raised');" >/dev/null
WC2=$(psqlc "select id from warranty_claims where organization_id='$ORG' and claim_ref='S6B-WC2'")
test -n "$WC2"
R=$(rpc "$PLANNER" submit_warranty_claim "{\"p_claim_id\":$WC2,\"p_note\":\"Lodging a claim whose sixty-day window closed while it sat\"}")
noerr "$R"
test "$(printf '%s' "$R" | field status)" = "time_barred"
test "$(printf '%s' "$R" | field daysLate)" = "30"
test "$(psqlc "select status from warranty_claims where id=$WC2")" = "time_barred"

echo "── 7. D6.01 VendorQualityRecord — accrued, and refused over nothing ─────"

# NO PERIODS: the record REFUSES rather than reporting a perfect supplier.
R=$(rpc "$MANAGER" get_vendor_quality_record "{\"p_supplier_id\":$SUP_B}")
test "$(printf '%s' "$R" | field answered)" = "False"
grep -qi 'rather than averaging nothing' <<<"$R"
test "$(printf '%s' "$R" | field periods)" = "0"

# A period that has not finished understates every actual in it.
R=$(rpc "$PLANNER" record_contract_performance_period "{\"p_package_id\":$P1,\"p_period\":{\"period_start\":\"$(psqlc "select (current_date - 20)::text")\",\"period_end\":\"$(psqlc "select (current_date + 10)::text")\",\"basis\":\"Weekly timesheet export\"}}")
expect_err "$R" 'has not happened yet'
# Non-finite and negative quantities never reach a ratio.
R=$(rpc "$PLANNER" record_contract_performance_period "{\"p_package_id\":$P1,\"p_period\":{\"period_start\":\"$(psqlc "select (current_date - 60)::text")\",\"period_end\":\"$(psqlc "select (current_date - 31)::text")\",\"basis\":\"Weekly timesheet export\",\"actual_hours\":\"NaN\"}}")
expect_err "$R" 'finite quantity of at least zero'
R=$(rpc "$PLANNER" record_contract_performance_period "{\"p_package_id\":$P1,\"p_period\":{\"period_start\":\"$(psqlc "select (current_date - 60)::text")\",\"period_end\":\"$(psqlc "select (current_date - 31)::text")\",\"basis\":\"Weekly timesheet export\",\"actual_hours\":\"-40\"}}")
expect_err "$R" 'finite quantity of at least zero'
R=$(rpc "$PLANNER" record_contract_performance_period "{\"p_package_id\":$P1,\"p_period\":{\"period_start\":\"$(psqlc "select (current_date - 60)::text")\",\"period_end\":\"$(psqlc "select (current_date - 31)::text")\",\"basis\":\"Weekly timesheet export\",\"rework_events\":\"-2\"}}")
expect_err "$R" 'cannot be negative'

R=$(rpc "$PLANNER" record_contract_performance_period "{\"p_package_id\":$P1,\"p_period\":{\"period_start\":\"$(psqlc "select (current_date - 60)::text")\",\"period_end\":\"$(psqlc "select (current_date - 31)::text")\",\"basis\":\"Weekly timesheet export and the vendor progress report\",\"planned_hours\":\"600\",\"actual_hours\":\"680\",\"planned_cost\":\"300000\",\"actual_cost\":\"330000\",\"rework_events\":\"3\",\"safety_incidents\":\"1\",\"quality_escapes\":\"2\"}}")
noerr "$R"
R=$(rpc "$PLANNER" record_contract_performance_period "{\"p_package_id\":$P1,\"p_period\":{\"period_start\":\"$(psqlc "select (current_date - 30)::text")\",\"period_end\":\"$(psqlc "select (current_date - 1)::text")\",\"basis\":\"Weekly timesheet export and the vendor progress report\",\"planned_hours\":\"600\",\"actual_hours\":\"520\",\"planned_cost\":\"300000\",\"actual_cost\":\"290000\",\"rework_events\":\"1\"}}")
noerr "$R"

# AN OVERLAP double-counts every number the record accrues.
R=$(rpc "$PLANNER" record_contract_performance_period "{\"p_package_id\":$P1,\"p_period\":{\"period_start\":\"$(psqlc "select (current_date - 40)::text")\",\"period_end\":\"$(psqlc "select (current_date - 10)::text")\",\"basis\":\"An overlapping window recorded by mistake\",\"actual_hours\":\"100\"}}")
expect_err "$R" 'overlaps'

R=$(rpc "$MANAGER" get_vendor_quality_record "{\"p_supplier_id\":$SUP_A}")
noerr "$R"
test "$(printf '%s' "$R" | field answered)" = "True"
test "$(printf '%s' "$R" | field periods)" = "2"
test "$(printf '%s' "$R" | field actualHours)" = "1200"
test "$(printf '%s' "$R" | field reworkEvents)" = "4"
test "$(printf '%s' "$R" | field safetyIncidents)" = "1"
# 1200 planned over 1200 actual. The JSON number is read back as a float, so
# the assertion is on the value and not on its rendering.
test "$(jqp "$R" "x['productivityFactor'] == 1")" = "True"
# The warranty history accrues from the acts above — including the time-barred
# claim, which is money the owner was entitled to and did not recover.
WARR=$(printf '%s' "$R" | field warranty)
test "$(printf '%s' "$WARR" | field claims)" = "2"
test "$(printf '%s' "$WARR" | field accepted)" = "1"
test "$(printf '%s' "$WARR" | field timeBarred)" = "1"
test "$(printf '%s' "$WARR" | field recoveredValue)" = "31000"
# No delivery event carries both dates, so an on-time rate REFUSES.
DEL=$(printf '%s' "$R" | field deliveries)
grep -qi 'REFUSED' <<<"$DEL"
# The record is a READ over the acts: there is no column to type a score into.
test "$(psqlc "select count(*) from information_schema.columns
                where table_name='suppliers' and column_name like '%quality_score%'")" = "0"

# A period is not deleted — deleting one silently improves the record.
PERF=$(psqlc "select id from contract_performance where organization_id='$ORG' and supplier_id=$SUP_A order by period_start limit 1")
OUT=$(sql_must_fail "delete from contract_performance where id=$PERF;")
grep -qi 'silently IMPROVES the record' <<<"$OUT"

echo "── 8. D6.07 — the specification-to-failure commercial thread ────────────"

R=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S6B-R1\",\"category\":\"reliability\",\"requirement\":\"The mill motor stator insulation system shall withstand the site duty cycle for twenty years\"}}")
noerr "$R"

# NOT LINKED: the thread refuses at the first hop rather than reporting that
# this specification caused no failures.
R=$(rpc "$MANAGER" get_specification_failure_thread "{\"p_requirement_ref\":\"S6B-R1\"}")
test "$(printf '%s' "$R" | field answered)" = "False"
grep -qi 'not linked to any procurement package' <<<"$R"
grep -qi 'caused no failures' <<<"$R"

# A specification that is not a requirement is a document nothing can trace.
R=$(rpc "$PLANNER" link_package_specification "{\"p_package_id\":$P1,\"p_requirement_ref\":\"S6B-NOPE\",\"p_basis\":\"Linking a specification that is not in the requirement table at all\"}")
expect_err "$R" 'no requirement'

R=$(rpc "$PLANNER" link_package_specification "{\"p_package_id\":$P2,\"p_requirement_ref\":\"S6B-R1\",\"p_basis\":\"The spares package quotes the same insulation clause as its parent specification\"}")
noerr "$R"
# LINKED BUT UNAWARDED: the thread stops at the tender, and says so.
R=$(rpc "$MANAGER" get_specification_failure_thread "{\"p_requirement_ref\":\"S6B-R1\"}")
test "$(printf '%s' "$R" | field answered)" = "False"
grep -qi 'NONE of them is awarded' <<<"$R"

R=$(rpc "$PLANNER" link_package_specification "{\"p_package_id\":$P1,\"p_requirement_ref\":\"S6B-R1\",\"p_basis\":\"Clause 4.2 of the issued motor specification is the source of this requirement\"}")
noerr "$R"
# AWARDED BUT THE VENDOR SUPPLIES NOTHING IN THE CATALOGUE: the thread stops at
# the vendor, and that is a gap in the material master, not evidence.
R=$(rpc "$MANAGER" get_specification_failure_thread "{\"p_requirement_ref\":\"S6B-R1\"}")
test "$(printf '%s' "$R" | field answered)" = "False"
grep -qi 'supplies no material recorded' <<<"$R"

MAT=$(psqlc "with r as (insert into materials (organization_id, material_code, description, unit_of_measure)
  values ('$ORG','S6B-M1','Stator winding set for the S6B mill motor','each') returning id) select id from r")
test -n "$MAT"
psqlc "insert into material_suppliers (organization_id, material_id, supplier_id, approved_for_this_material, supplier_part_number)
       values ('$ORG','$MAT',$SUP_A,true,'S6B-PN-1');" >/dev/null
# THE PART IS ON NO BILL OF MATERIALS: the thread stops at the part.
R=$(rpc "$MANAGER" get_specification_failure_thread "{\"p_requirement_ref\":\"S6B-R1\"}")
test "$(printf '%s' "$R" | field answered)" = "False"
grep -qi 'none of them appears on any asset' <<<"$R"

psqlc "insert into bom_lines (organization_id, asset_id, material_id, qty_per, position_note)
       values ('$ORG','$ASSET','$MAT',1,'S6B stator position');" >/dev/null
# THE WHOLE WAY, with no corrective history yet — a fact about the maintenance
# record, not a warranty.
R=$(rpc "$MANAGER" get_specification_failure_thread "{\"p_requirement_ref\":\"S6B-R1\"}")
test "$(printf '%s' "$R" | field answered)" = "True"
test "$(printf '%s' "$R" | field failureTotal)" = "0"
grep -qi 'not a warranty' <<<"$R"

psqlc "insert into work_orders (organization_id, asset_id, wo_number, title, work_type, actual_failure_mode, status)
       values ('$ORG','$ASSET','S6B-WO1','Stator earth fault','corrective','stator insulation failure','completed'),
              ('$ORG','$ASSET','S6B-WO2','Stator earth fault again','corrective','stator insulation failure','completed'),
              ('$ORG','$ASSET','S6B-WO3','Bearing knock','corrective','bearing wear','completed');" >/dev/null
psqlc "update design_requirements set derived_from_failure_mode='stator insulation failure'
        where organization_id='$ORG' and requirement_ref='S6B-R1';" >/dev/null

R=$(rpc "$MANAGER" get_specification_failure_thread "{\"p_requirement_ref\":\"S6B-R1\"}")
test "$(printf '%s' "$R" | field answered)" = "True"
test "$(printf '%s' "$R" | field packageCount)" = "2"
test "$(printf '%s' "$R" | field awardedPackages)" = "1"
test "$(printf '%s' "$R" | field installedAssets)" = "1"
test "$(printf '%s' "$R" | field failureTotal)" = "3"
# The failure list is ordered on the COUNT, so the most common mode is first.
test "$(jqp "$R" "x['failures'][0]['failureMode']")" = "stator insulation failure"
test "$(jqp "$R" "x['failures'][0]['occurrences']")" = "2"
# THE REVERSE DIRECTION comes from the LIVE design-feedback traversal, called
# rather than re-derived.
test "$(jqp "$R" "len(x['backward'])")" = "1"
test "$(jqp "$R" "x['backward'][0]['loopClosed']")" = "True"

echo "── 9. D11.33 / §78 — the procurement-status connector moves real data ───"

R=$(rpc "$PLANNER" begin_manual_import "{\"p_entity_type\":\"procurement_status\",\"p_source_name\":\"S6B ERP export\"}")
noerr "$R"; RUN=$(printf '%s' "$R" | field run_id); test -n "$RUN"

BEFORE=$(psqlc "select manufacturing_status from contract_packages where id=$P1")
ROWS='[
 {"external_id":"S6B-PO-1","package_code":"S6B-P1","dimension":"manufacturing","status":"in_manufacture","basis":"SAP PO 4501 line 10, status MANF"},
 {"external_id":"S6B-PO-2","package_code":"S6B-NOPE","dimension":"manufacturing","status":"in_manufacture"},
 {"external_id":"S6B-PO-3","package_code":"S6B-P1","dimension":"commercial","status":"awarded"},
 {"external_id":"S6B-PO-4","package_code":"S6B-P1","dimension":"delivery","status":"received_and_inspected"},
 {"external_id":"S6B-PO-5","package_code":"S6B-P1","dimension":"manufacturing","status":"in_manufacture"},
 {"external_id":"S6B-PO-6","package_code":"S6B-P1","dimension":"manufacturing","status":"orbit"},
 {"external_id":"S6B-PO-7","package_code":"S6B-P1","dimension":"manufacturing","status":"in_manufacture","forecast_delivery_date":"2027-01-01"},
 {"external_id":"S6B-PO-8","package_code":"S6B-P1","forecast_delivery_date":"'"$(psqlc "select (current_date + 380)::text")"'"},
 {"package_code":"S6B-P1","dimension":"technical","status":"technically_evaluated"}
]'
R=$(rpc "$PLANNER" ingest_rows "{\"p_run_id\":\"$RUN\",\"p_rows\":$ROWS}")
noerr "$R"
test "$(printf '%s' "$R" | field read)" = "9"
test "$(printf '%s' "$R" | field accepted)" = "2"
test "$(printf '%s' "$R" | field duplicate)" = "1"
test "$(printf '%s' "$R" | field rejected)" = "6"

# THE DATA MOVED — through the ONE §25 status writer, which recorded the basis
# and the audit row exactly as a typed status does.
test "$(psqlc "select manufacturing_status from contract_packages where id=$P1")" = "in_manufacture"
test "$(psqlc "select forecast_delivery_date::text from contract_packages where id=$P1")" = "$(psqlc "select (current_date + 380)::text")"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG'
                and entity_type='procurement_package_status'
                and new_state->>'basis' = 'SAP PO 4501 line 10, status MANF'")" -ge 1
# ...and a row that states no reason gets a DERIVED one naming the file and the
# source row, because the ONE writer will not accept a blank basis and a status
# that changed for no recorded reason is a status nobody can question later.
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG'
                and entity_type='procurement_package_forecast'
                and new_state->>'basis' like 'Imported from manual-upload-procurement_status, source row S6B-PO-8%'")" -ge 1

# AN ERP FEED CANNOT MANUFACTURE AN AWARD, AND CANNOT TYPE A GOODS RECEIPT.
test "$(psqlc "select count(*) from ingest_staging where run_id='$RUN' and status='rejected'
                and external_id='S6B-PO-3' and reject_reason like '%award_contract%'")" = "1"
test "$(psqlc "select count(*) from ingest_staging where run_id='$RUN' and status='rejected'
                and external_id='S6B-PO-4' and reject_reason like '%record_package_delivery_receipt%'")" = "1"
# An unknown package is refused rather than created.
test "$(psqlc "select count(*) from ingest_staging where run_id='$RUN' and status='rejected'
                and external_id='S6B-PO-2' and reject_reason like '%unknown package_code%'")" = "1"
# One fact per row.
test "$(psqlc "select count(*) from ingest_staging where run_id='$RUN' and status='rejected'
                and external_id='S6B-PO-7' and reject_reason like '%One fact per row%'")" = "1"
# A row with no identity cannot be replayed safely.
test "$(psqlc "select count(*) from ingest_staging where run_id='$RUN' and status='rejected'
                and reject_reason like '%missing external_id%'")" = "1"
# The re-upload of a status that has not changed is a DUPLICATE, in the status
# writer's own words — there is nothing else to deduplicate against.
test "$(psqlc "select count(*) from ingest_staging where run_id='$RUN' and status='duplicate'
                and external_id='S6B-PO-5'")" = "1"

# The validator is reachable ONLY through the router.
R=$(rpc "$PLANNER" ingest_procurement_status_batch "{\"p_run_id\":\"$RUN\",\"p_rows\":[]}")
grep -qi 'not find the function\|does not exist\|permission denied' <<<"$R"

echo "── 10. cross-tenant ────────────────────────────────────────────────────"

test "$(rest "$FOREIGN" "contract_change_orders?select=id" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" = "0"
test "$(rest "$FOREIGN" "contract_invoices?select=id" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" = "0"
test "$(rest "$FOREIGN" "contract_claims?select=id" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" = "0"
test "$(rest "$FOREIGN" "warranty_terms?select=id" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" = "0"
test "$(rest "$FOREIGN" "contract_package_specifications?select=id" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" = "0"
R=$(rpc "$FOREIGN" get_contract_commercial "{\"p_package_id\":$P1}")
expect_err "$R" 'not found'
R=$(rpc "$FOREIGN" get_vendor_quality_record "{\"p_supplier_id\":$SUP_A}")
expect_err "$R" 'not found'
R=$(rpc "$FOREIGN" get_specification_failure_thread "{\"p_requirement_ref\":\"S6B-R1\"}")
expect_err "$R" 'no requirement'

echo "── 11. the ledgers hold for every writer ───────────────────────────────"

for T in contract_change_orders contract_claims contract_invoices warranty_terms warranty_claims contract_performance contract_package_specifications; do
  OUT=$(sql_must_fail "truncate $T cascade;")
  grep -qi 'Not truncatable by any caller' <<<"$OUT"
done

# A client-shaped caller reaching the tables directly is refused by name.
for PAIR in "contract_change_orders|record_contract_change_order" "contract_claims|record_contract_claim" "contract_invoices|record_contract_invoice"; do
  T="${PAIR%%|*}"; D="${PAIR##*|}"
  case "$T" in
    contract_change_orders) COLS="(organization_id, package_id, change_order_ref, description, reason, value_delta, currency)"
                            VALS="('$ORG',$P1,'CO-D','A direct write bypassing the definer door entirely','Recorded so the wall can refuse a client-shaped caller',1000,'CAD')";;
    contract_claims)        COLS="(organization_id, package_id, claim_ref, direction, grounds, claimed_value, currency)"
                            VALS="('$ORG',$P1,'CL-D','from_supplier','A direct write bypassing the definer door entirely',1000,'CAD')";;
    contract_invoices)      COLS="(organization_id, package_id, invoice_ref, supplier_id, invoice_date, description, gross_amount, currency)"
                            VALS="('$ORG',$P1,'INV-D',$SUP_A,current_date,'A direct write',1000,'CAD')";;
  esac
  OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$PLANNER_ID', true);
insert into $T $COLS values $VALS;
rollback;")
  grep -q "$D" <<<"$OUT"
done

# §70 AT THE TABLE, for every writer including a service path with no session.
OUT=$(sql_must_fail "update contract_change_orders set decided_by='$AIBOT_ID', decided_at=now(), decision_note='A machine recorded as the person who approved this variation', status='approved', authority_limit_id='$LIMIT_ID', contract_value_before=1, contract_value_after=2 where id=$CO2;")
grep -qi 'AI-operator identity cannot decide or withdraw a contract change order' <<<"$OUT"
OUT=$(sql_must_fail "update contract_invoices set certified_by='$AIBOT_ID', certified_at=now(), certification_note='A machine recorded as the person who certified this invoice', status='certified', certified_amount=1 where id=$INV2;")
grep -qi 'AI-operator identity cannot certify an invoice' <<<"$OUT"
OUT=$(sql_must_fail "update warranty_claims set answered_by='$AIBOT_ID', answered_at=now(), answer_note='A machine recorded as the person who settled this warranty claim', status='rejected' where id=$WC2;")
grep -qi 'AI-operator identity cannot accept or refuse a warranty settlement' <<<"$OUT"
# contract_claims is the one table whose §70 wall is its ONLY §70 wall — the
# answer is the reserved act — and the transcript did not probe it.
OUT=$(sql_must_fail "update contract_claims set answered_by='$AIBOT_ID', answered_at=now(), answer_note='A machine determining a contractual entitlement between two parties', status='rejected' where id=$CL2;")
grep -qi 'AI-operator identity cannot answer or withdraw a claim under a contract' <<<"$OUT"

# The cost model still carries exactly what the contracts committed.
test "$(psqlc "select commitment from project_cost_items where organization_id='$ORG' and cost_item_ref='S6B-CI1'")" = "640000"

echo "── 12. the money gates, after repair — each step is a MEASURED defect ───"

# A SECOND case, so the manager's cumulative award total on it starts at zero
# and every figure below is this case's alone.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S6R ceiling case\",\"p_problem_statement\":\"A second case whose only purpose is to measure the cumulative award ceiling: the delegation is per project, and a ceiling measured on a case with history in it proves nothing about the arithmetic.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; RCASE=$(printf '%s' "$R" | field case_id); test -n "$RCASE"

psqlc "insert into suppliers (organization_id, supplier_code, name, supplier_kind, approved_vendor, safety_qualification_status)
       values ('$ORG','S6R-SC','S6R Motors C','oem',true,'qualified');" >/dev/null
SUP_C=$(psqlc "select id from suppliers where organization_id='$ORG' and supplier_code='S6R-SC'")
test -n "$SUP_C"

# The EXECUTIVE gets a ceiling of its own, large enough to award without ever
# being the constraint under test, so the manager's ceiling is the only one
# being measured.
psqlc "insert into authority_limits (organization_id, role_key, tier_label, action_type, max_commitment_usd, escalates_to_role, basis, status)
       values ('$ORG','executive','Executive','contract_award', null,'board','Reseeded for the slice-6B repair transcript.','draft');" >/dev/null
XLIMIT=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='executive' and action_type='contract_award' and status='draft' order by version desc limit 1")
test -n "$XLIMIT"
# An executive may not state its own ceiling — stating your own delegation is
# not a delegation — so the administrator does it, exactly as the family
# requires.
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#'); test -n "$ADMIN"
R=$(rpc "$ADMIN" state_authority_ceiling "{\"p_id\":\"$XLIMIT\",\"p_ceiling\":{\"max_commitment\":\"5000000\",\"currency\":\"CAD\",\"basis\":\"The capital delegation instrument dated this year, section 6.2 (executive).\"}}")
noerr "$R"
R=$(rpc "$ADMIN" adopt_authority_limit "{\"p_id\":\"$XLIMIT\",\"p_note\":\"Adopted from the capital delegation instrument dated this year.\"}")
noerr "$R"

# One awarded contract, arranged the way the product arranges one.
# Sets two globals rather than echoing: the award RESPONSE is the thing under
# test in three of the four calls, and a command substitution runs the body in
# a subshell where an assignment to it would be lost.
award_pkg(){ # <code> <title> <price> <awarder-token> <commercial-evaluator> -> sets PKG_ID and AWARD
  local code="$1" title="$2" price="$3" who="$4" ceval="$5" r pid bid
  r=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$RCASE\",\"p_package\":{\"package_code\":\"$code\",\"title\":\"$title\",\"equipment_or_scope\":\"Scope for $code as arranged for the slice-6B repair transcript\",\"scope_of_work\":\"Design, manufacture and deliver the $title package to site\",\"acceptance_criteria\":\"Factory acceptance test at rated load\",\"required_date\":\"$REQ\",\"lead_time_days\":\"90\"}}")
  noerr "$r"; pid=$(printf '%s' "$r" | field package_id)
  r=$(rpc "$PLANNER" invite_package_bidder "{\"p_package_id\":$pid,\"p_supplier_id\":$SUP_C,\"p_prequalification_basis\":\"Delivered the 2025 rebuild inside its promised window and to specification\"}")
  noerr "$r"
  r=$(rpc "$PLANNER" open_package_bidding "{\"p_package_id\":$pid,\"p_close_at\":\"$(psqlc "select (now() + interval '1 hour')::text")\"}")
  noerr "$r"
  r=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$pid,\"p_bid\":{\"supplier_code\":\"S6R-SC\",\"price\":\"$price\",\"currency\":\"CAD\",\"duration_days\":\"210\"}}")
  noerr "$r"; bid=$(printf '%s' "$r" | field bid_id)
  psqlc "update contract_packages set bids_close_at = now() - interval '1 minute' where id=$pid;" >/dev/null
  r=$(rpc "$MANAGER" open_package_bids "{\"p_package_id\":$pid,\"p_note\":\"Opening the envelope at the stated close, with the register present.\"}")
  noerr "$r"
  r=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$bid,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"compliant\",\"rationale\":\"Assessed against the issued specification and found compliant on the technical leg\"}}")
  noerr "$r"
  # The awarder may not have evaluated: an award taken on one's own assessment
  # is what makes a competitive tender ceremonial, and the tender family refuses
  # it. So the commercial leg is taken by whoever is NOT awarding this one.
  r=$(rpc "$ceval" record_bid_evaluation "{\"p_bid_id\":$bid,\"p_evaluation\":{\"evaluation_kind\":\"commercial\",\"outcome\":\"compliant\",\"rationale\":\"Priced against the issued schedule of rates and found compliant on the commercial leg\"}}")
  noerr "$r"
  AWARD=$(rpc "$who" award_contract "{\"p_package_id\":$pid,\"p_award\":{\"bid_id\":\"$bid\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Deliver to the site acceptance criteria in the issued specification\",\"award_basis\":\"Sole compliant price on a fully evaluated field\",\"contract_start_date\":\"$(psqlc "select current_date::text")\",\"contract_completion_date\":\"$REQ\"}}")
  PKG_ID="$pid"
}
PKG_ID=''; AWARD=''

# ---------------------------------------------------------------------------
# 12a. A NEGATIVE CHANGE ORDER BUYS NO AWARD HEADROOM.
#
# MEASURED before the repair: the cumulative arm summed value_delta SIGNED, and
# the award side attributes on cp.awarded_by while the change-order side
# attributes on co.decided_by — different sets. A de-scope approved on a
# contract somebody ELSE awarded subtracted from a total it had never been
# added to, taking the running total to zero or below, where 6A's
# `v_committed > 0` short-circuit skipped the whole cumulative arm with real
# history behind it. One manager holding a CAD 700,000 ceiling awarded CAD
# 1,300,000 on one case this way, and the award response printed the tell:
# "alreadyAwardedOnCase": -600000.
# ---------------------------------------------------------------------------
award_pkg 'S6R-PA' 'Executive-awarded motor' 600000 "$EXEC" "$MANAGER"; RA="$PKG_ID"; noerr "$AWARD"
test "$(printf '%s' "$AWARD" | field value)" = "600000"

# THE CASE SCREEN CARRIES THE ONE POSITION'S REFUSAL, NOT A ZERO. Freshly
# awarded, nothing billed: contract_invoice_position REFUSES over that set in so
# many words, while the summary used to count the rows itself and report
# `invoices: 0, invoicesAwaitingPayment: 0` — two surfaces of one slice giving
# opposite answers to one question, with the refusal-first one the one the
# planner does not see.
CS=$(psqlc "select contract_commercial_summary($RA)")
test "$(jqp "$CS" "x['invoices'] is None")" = "True"
test "$(jqp "$CS" "x['invoicesAwaitingPayment'] is None")" = "True"
# The refusal arrives inside JSON, where its own quotes are escaped — match on
# the unquoted span rather than on punctuation the encoder owns.
grep -qi 'nothing outstanding' <<<"$CS"
grep -qi 'paid in full' <<<"$CS"
grep -qi 'No invoice has been recorded against contract S6R-PA' <<<"$CS"
# ...and the warranty counts come off the ONE cover predicate, with the terms it
# REFUSES over counted separately rather than falling into neither bucket.
test "$(jqp "$CS" "'warrantyNotAssessable' in x")" = "True"
test "$(jqp "$CS" "'warrantyUnbounded' in x")" = "False"
test "$(jqp "$CS" "'settlementNotCarried' in x")" = "False"
# "Nobody has claimed" and "every claim has been answered" are opposite facts.
test "$(jqp "$CS" "x['claimsRaised']")" = "0"
test "$(jqp "$CS" "x['claimsSettledNet'] is None")" = "True"

R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$RA,\"p_change\":{\"change_order_ref\":\"S6R-CO1\",\"description\":\"De-scope the cooling package, which the owner will now supply free issue\",\"reason\":\"The owner has a spare cooling package in store and will free issue it\",\"value_delta\":\"-500000\"}}")
noerr "$R"; RCO1=$(printf '%s' "$R" | field change_order_id); test -n "$RCO1"

# 12b. THE REDUCTION IS PERMITTED, AND IS NOT MEASURED AS IF IT COMMITTED.
# sync_contract_award_authority's first line is abs(p_value), which was harmless
# while awarded_value >= 0 was its only input. Handed a signed delta it measured
# a CAD 500,000 de-scope as a CAD 500,000 commitment and refused it with a
# sentence that stated the opposite of its own arithmetic. Releasing the owner's
# exposure consumes no ceiling.
R=$(rpc "$MANAGER" decide_contract_change_order "{\"p_change_order_id\":$RCO1,\"p_decision\":\"approved\",\"p_note\":\"The cooling package is free issue from store; the de-scope is agreed at the contract rate\"}")
noerr "$R"
test "$(printf '%s' "$R" | field status)" = "approved"
test "$(printf '%s' "$R" | field contractValue)" = "100000"
# The measure the ceiling reads did NOT go negative, and did not move at all.
test "$(printf '%s' "$R" | field alreadyCommittedOnCase)" = "0"

# ...so the manager's own ceiling is untouched by it. 600,000 fits.
award_pkg 'S6R-PB' 'Manager-awarded motor' 600000 "$MANAGER" "$EXEC"; RB="$PKG_ID"; noerr "$AWARD"
test "$(printf '%s' "$AWARD" | field value)" = "600000"

# ...and the SECOND 600,000 is refused BY NAME. Before the repair the -500,000
# above had bought exactly this much headroom and this award succeeded.
award_pkg 'S6R-PC' 'The award the ceiling must refuse' 600000 "$MANAGER" "$EXEC"; RC="$PKG_ID"
expect_err "$AWARD" 'you have already awarded'
grep -qi 'Escalate to executive' <<<"$AWARD"
test "$(psqlc "select coalesce(sum(awarded_value),0) from contract_packages where development_case_id='$RCASE' and awarded_by='$MANAGER_ID'")" = "600000"
test "$(psqlc "select awarded_at is null from contract_packages where id=$RC")" = "t"

# A POSITIVE change order still counts cumulatively, which is what this row is
# for: awarding small and changing five times was the same hole splitting one
# procurement across two packages was.
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$RB,\"p_change\":{\"change_order_ref\":\"S6R-CO2\",\"description\":\"Add the second cooling circuit the site standard now requires on this frame\",\"reason\":\"The site standard changed after award and the second circuit is now mandatory\",\"value_delta\":\"150000\"}}")
noerr "$R"; RCO2=$(printf '%s' "$R" | field change_order_id)
R=$(rpc "$MANAGER" decide_contract_change_order "{\"p_change_order_id\":$RCO2,\"p_decision\":\"approved\",\"p_note\":\"The second circuit is required by the site standard and is priced at the contract rate\"}")
expect_err "$R" 'you have already awarded'
test "$(psqlc "select contract_current_value($RB)")" = "600000"

# ---------------------------------------------------------------------------
# 12c. A REDUCTION MAY NOT GO BELOW MONEY ALREADY CERTIFIED AND PAID.
#
# MEASURED before the repair: the guard consulted contract_commitment_lines
# only. With no approved commitment line it did not fire at all, so a CAD
# 1,800,000 contract with 1,000,000 certified and PAID was reduced to 100,000 —
# leaving the ledger explaining a payment no contract obliges, and un-paying is
# refused for every caller, so it could not be reversed.
# ---------------------------------------------------------------------------
R=$(rpc "$PLANNER" record_contract_invoice "{\"p_package_id\":$RB,\"p_invoice\":{\"invoice_ref\":\"S6R-I1\",\"invoice_date\":\"$(psqlc "select current_date::text")\",\"description\":\"Progress claim 1 — manufacture to 60 per cent\",\"gross_amount\":\"400000\"}}")
noerr "$R"; RI1=$(printf '%s' "$R" | field invoice_id); test -n "$RI1"
R=$(rpc "$MANAGER" certify_contract_invoice "{\"p_invoice_id\":$RI1,\"p_decision\":\"certified\",\"p_note\":\"Manufacture verified at the works against the issued progress schedule\"}")
noerr "$R"
R=$(rpc "$EXEC" record_invoice_payment "{\"p_invoice_id\":$RI1,\"p_payment_reference\":\"S6R-BANK-1\",\"p_note\":\"Paid on the weekly run against the certified amount\"}")
noerr "$R"
test "$(psqlc "select count(*) from contract_commitment_lines where package_id=$RB and approved_at is not null")" = "0"

R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$RB,\"p_change\":{\"change_order_ref\":\"S6R-CO3\",\"description\":\"Reduce the contract below the money the owner has already certified and paid\",\"reason\":\"Testing that the reduction guard consults certified money and not only commitments\",\"value_delta\":\"-500000\"}}")
noerr "$R"; RCO3=$(printf '%s' "$R" | field change_order_id)
R=$(rpc "$MANAGER" decide_contract_change_order "{\"p_change_order_id\":$RCO3,\"p_decision\":\"approved\",\"p_note\":\"Approving a reduction that would take the contract below what has been paid\"}")
expect_err "$R" 'below what is already committed or certified'
grep -qi 'CERTIFIED' <<<"$R"
grep -qi 'not reversible here' <<<"$R"
test "$(psqlc "select contract_current_value($RB)")" = "600000"

# ---------------------------------------------------------------------------
# 12d. THE PERSON WHO SET THE NUMBER MAY NOT APPROVE IT.
#
# MEASURED before the repair: record_contract_change_order revises a draft in
# place and does NOT move recorded_by, so a second person rewrote the value on
# somebody else's draft and approved their own figure. A planner's 1,000 draft
# became 400,000 and was approved by the person who wrote the 400,000.
# ---------------------------------------------------------------------------
R=$(rpc "$PLANNER" record_contract_change_order "{\"p_package_id\":$RA,\"p_change\":{\"change_order_ref\":\"S6R-CO4\",\"description\":\"A small variation opened by the planner and priced by somebody else\",\"reason\":\"Opened at a nominal figure pending the supplier quotation\",\"value_delta\":\"1000\"}}")
noerr "$R"; RCO4=$(printf '%s' "$R" | field change_order_id)
R=$(rpc "$MANAGER" record_contract_change_order "{\"p_package_id\":$RA,\"p_change\":{\"change_order_ref\":\"S6R-CO4\",\"description\":\"A small variation opened by the planner and priced by somebody else\",\"reason\":\"Repriced against the supplier quotation received this week\",\"value_delta\":\"400000\"}}")
noerr "$R"; test "$(printf '%s' "$R" | field revised)" = "True"
test "$(psqlc "select recorded_by = '$PLANNER_ID' from contract_change_orders where id=$RCO4")" = "t"
R=$(rpc "$MANAGER" decide_contract_change_order "{\"p_change_order_id\":$RCO4,\"p_decision\":\"approved\",\"p_note\":\"Approving the very figure this same person wrote onto somebody else's draft\"}")
expect_err "$R" 'neither recorded nor priced it'
test "$(psqlc "select status from contract_change_orders where id=$RCO4")" = "draft"

# The identical shape on the invoice: a certifier who raised the gross.
R=$(rpc "$PLANNER" record_contract_invoice "{\"p_package_id\":$RA,\"p_invoice\":{\"invoice_ref\":\"S6R-I2\",\"invoice_date\":\"$(psqlc "select current_date::text")\",\"description\":\"Progress claim opened by the planner at the applied-for figure\",\"gross_amount\":\"10000\"}}")
noerr "$R"; RI2=$(printf '%s' "$R" | field invoice_id)
R=$(rpc "$MANAGER" record_contract_invoice "{\"p_package_id\":$RA,\"p_invoice\":{\"invoice_ref\":\"S6R-I2\",\"invoice_date\":\"$(psqlc "select current_date::text")\",\"description\":\"Progress claim opened by the planner at the applied-for figure\",\"gross_amount\":\"90000\"}}")
noerr "$R"
R=$(rpc "$MANAGER" certify_contract_invoice "{\"p_invoice_id\":$RI2,\"p_decision\":\"certified\",\"p_note\":\"Certifying the very amount this same person wrote onto the invoice\"}")
expect_err "$R" 'neither recorded nor priced it'
test "$(psqlc "select status from contract_invoices where id=$RI2")" = "received"

# ---------------------------------------------------------------------------
# 12e. TWO CERTIFICATIONS ON ONE CONTRACT ARE SERIALIZED.
#
# MEASURED before the repair: the FOR UPDATE locked the INVOICE row only, while
# the ceiling the act is checked against sums the certified amounts of every
# OTHER invoice on the package. Two 400,000 invoices on a CAD 650,000 contract,
# certified concurrently, each read certifiedTotal = 0 and each passed; both
# were then payable through their own once-only walls and CAD 800,000 left the
# bank, with un-paying refused for every caller so it could not be reversed.
#
# Deterministic, not timed: session A holds the package lock inside an open
# transaction and session B is given a lock_timeout. B blocking IS the property.
# ---------------------------------------------------------------------------
R=$(rpc "$PLANNER" record_contract_invoice "{\"p_package_id\":$RB,\"p_invoice\":{\"invoice_ref\":\"S6R-I3\",\"invoice_date\":\"$(psqlc "select current_date::text")\",\"description\":\"Progress claim 2 — manufacture to 75 per cent\",\"gross_amount\":\"50000\"}}")
noerr "$R"; RI3=$(printf '%s' "$R" | field invoice_id)
R=$(rpc "$PLANNER" record_contract_invoice "{\"p_package_id\":$RB,\"p_invoice\":{\"invoice_ref\":\"S6R-I4\",\"invoice_date\":\"$(psqlc "select current_date::text")\",\"description\":\"Progress claim 3 — manufacture to 80 per cent\",\"gross_amount\":\"50000\"}}")
noerr "$R"; RI4=$(printf '%s' "$R" | field invoice_id)

LOCKLOG=$(mktemp)
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA >"$LOCKLOG" 2>&1 <<PSQLA &
begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
select certify_contract_invoice($RI3, 'certified', 'Certified inside a transaction held open so the sibling certification meets the lock');
select pg_sleep(12) /* S6R-LOCKPROBE */;
rollback;
PSQLA
LOCKPID=$!
# Wait for A to be observably inside that transaction — no sleep-and-hope.
READY=0
for _ in $(seq 1 100); do
  # psql sends one statement at a time, so the marker lives INSIDE the
  # statement A is running while it holds the locks — not in a leading comment.
  if [ "$(psqlc "select count(*) from pg_stat_activity where query like '%S6R-LOCKPROBE%' and pid <> pg_backend_pid()")" = "1" ]; then READY=1; break; fi
  sleep 0.2
done
test "$READY" = "1"
# begin; matters: set_config(..., true) is transaction-local, and outside one
# it lasts a single statement — auth.uid() would then be NULL and the door would
# answer 'forbidden' rather than reaching the lock, which is a green step that
# proves nothing.
OUT=$(sql_must_fail "begin;
set lock_timeout='2500ms';
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
select certify_contract_invoice($RI4, 'certified', 'The sibling certification, which must wait for the package rather than reading past it');
rollback;")
grep -qi 'lock timeout\|canceling statement' <<<"$OUT"
# ...and A really did hold the lock through a SUCCESSFUL certification, not
# through an error payload psql would have printed and walked past.
grep -qi '"status" *: *"certified"' "$LOCKLOG"
kill "$LOCKPID" 2>/dev/null || true
wait "$LOCKPID" 2>/dev/null || true
rm -f "$LOCKLOG"
# Drain: `wait` returns when the CLIENT exits, and the backend releases the
# package lock a moment later. Every step after this one goes through PostgREST,
# which has a statement timeout — a lingering lock would show up as a timeout on
# an unrelated step, which is the least readable failure there is.
for _ in $(seq 1 100); do
  [ "$(psqlc "select count(*) from pg_stat_activity where query like '%S6R-LOCKPROBE%' and pid <> pg_backend_pid()")" = "0" ] && break
  sleep 0.2
done
test "$(psqlc "select count(*) from pg_stat_activity where query like '%S6R-LOCKPROBE%' and pid <> pg_backend_pid()")" = "0"
# Nothing landed: A rolled back and B never got the lock.
test "$(psqlc "select count(*) from contract_invoices where package_id=$RB and status <> 'received' and id in ($RI3,$RI4)")" = "0"

# ---------------------------------------------------------------------------
# 12f. THE VENDOR RECORD NETS CLAIMS BY DIRECTION.
#
# MEASURED before the repair: sum(settled_value) with no direction filter, so a
# supplier who claimed 200k off the owner and had 200k of liquidated damages
# recovered from them read identically to one who simply won 400k — in the
# record spec I.15 says decides the next award.
# ---------------------------------------------------------------------------
R=$(rpc "$MANAGER" record_contract_performance_period "{\"p_package_id\":$RB,\"p_period\":{\"period_start\":\"$(psqlc "select (current_date - 60)::text")\",\"period_end\":\"$(psqlc "select (current_date - 30)::text")\",\"planned_hours\":\"800\",\"actual_hours\":\"900\",\"rework_events\":\"2\",\"basis\":\"Monthly progress return signed off at the works\"}}")
noerr "$R"
# REFUSAL FIRST: with a measured period but NO claim, the record refuses a
# settled position rather than reporting one of zero. "Nobody has claimed" and
# "every claim netted to nothing" are opposite facts about a supplier.
VQ=$(rpc "$MANAGER" get_vendor_quality_record "{\"p_supplier_id\":$SUP_C}")
noerr "$VQ"
test "$(jqp "$VQ" "x['contractClaims']['raised']")" = "0"
test "$(jqp "$VQ" "x['contractClaims']['settledNet'] is None")" = "True"
grep -qi 'not a settled position of zero' <<<"$VQ"

R=$(rpc "$PLANNER" record_contract_claim "{\"p_package_id\":$RB,\"p_claim\":{\"claim_ref\":\"S6R-CLA\",\"direction\":\"from_supplier\",\"grounds\":\"Clause 12.4 — the works were suspended for nine days while the owner reworked the plinth\",\"claimed_value\":\"200000\"}}")
noerr "$R"; RCLA=$(printf '%s' "$R" | field claim_id)
R=$(rpc "$MANAGER" answer_contract_claim "{\"p_claim_id\":$RCLA,\"p_answer\":\"accepted\",\"p_note\":\"The suspension is the owner's on the site diary and the claim is accepted in full\",\"p_settled_value\":\"200000\"}")
noerr "$R"
R=$(rpc "$PLANNER" record_contract_claim "{\"p_package_id\":$RB,\"p_claim\":{\"claim_ref\":\"S6R-CLB\",\"direction\":\"against_supplier\",\"grounds\":\"Liquidated damages for the twenty-day overrun of the factory acceptance test\",\"claimed_value\":\"200000\"}}")
noerr "$R"; RCLB=$(printf '%s' "$R" | field claim_id)
R=$(rpc "$MANAGER" answer_contract_claim "{\"p_claim_id\":$RCLB,\"p_answer\":\"accepted\",\"p_note\":\"The overrun is the supplier's and the damages are recovered at the contract rate\",\"p_settled_value\":\"200000\"}")
noerr "$R"

VQ=$(rpc "$MANAGER" get_vendor_quality_record "{\"p_supplier_id\":$SUP_C}")
noerr "$VQ"
test "$(jqp "$VQ" "x['contractClaims']['raised']")" = "2"
test "$(jqp "$VQ" "x['contractClaims']['settledFromSupplier']")" = "200000"
test "$(jqp "$VQ" "x['contractClaims']['settledAgainstSupplier']")" = "200000"
# The NET is zero and it is not 400,000. An unsigned sum would report the second
# supplier's worst month as the first supplier's best.
test "$(jqp "$VQ" "x['contractClaims']['settledNet']")" = "0"
test "$(jqp "$VQ" "'settledValue' in x['contractClaims']")" = "False"

# ---------------------------------------------------------------------------
# 12g. A WARRANTY CLAIM CARRIES A CURRENCY, OR IT IS NOT MONEY.
#
# count(distinct currency) IGNORES NULLs, so a claim with no stated currency was
# silently added to the CAD claims and the total labelled CAD.
# ---------------------------------------------------------------------------
R=$(rpc "$MANAGER" record_warranty_term "{\"p_term\":{\"package_id\":\"$RB\",\"asset_id\":\"$ASSET\",\"warranty_ref\":\"S6R-W1\",\"starts_on\":\"$(psqlc "select (current_date - 30)::text")\",\"ends_on\":\"$(psqlc "select (current_date + 300)::text")\",\"covers\":\"Motor windings and bearings against defective material and workmanship\",\"basis\":\"Clause 24 of the executed contract\"}}")
noerr "$R"; RW1=$(printf '%s' "$R" | field warranty_id); test -n "$RW1"
R=$(rpc "$PLANNER" raise_warranty_claim "{\"p_warranty_id\":$RW1,\"p_claim\":{\"claim_ref\":\"S6R-WC1\",\"failure_on\":\"$(psqlc "select (current_date - 5)::text")\",\"claim_value\":\"9000\"}}")
expect_err "$R" 'state the currency of the claim'
R=$(rpc "$PLANNER" raise_warranty_claim "{\"p_warranty_id\":$RW1,\"p_claim\":{\"claim_ref\":\"S6R-WC1\",\"failure_on\":\"$(psqlc "select (current_date - 5)::text")\",\"claim_value\":\"9000\",\"currency\":\"CAD\"}}")
noerr "$R"

# ---------------------------------------------------------------------------
# 12h. §70 ON THE PAYMENT DOOR — the act that actually moves the money, and the
#      one door the transcript did not probe.
# ---------------------------------------------------------------------------
R=$(rpc "$AIBOT" record_invoice_payment "{\"p_invoice_id\":$RI3,\"p_payment_reference\":\"S6R-BANK-AI\",\"p_note\":\"The machine asserting that the owner's money left the bank\"}")
expect_err "$R" 'human act'

# ---------------------------------------------------------------------------
# 12i. A RE-UPLOAD OF THE FORECAST HALF IS SKIPPED, NOT RE-APPLIED.
#
# MEASURED before the repair: the status half deduplicated through the ONE
# writer answering "already at that value"; record_package_delivery_forecast has
# no such answer, so the same forecast row uploaded twice reported accepted:1
# both times and filed an audit row whose previous_state and new_state were the
# same day — on a connector whose surface promise is that it skips.
# ---------------------------------------------------------------------------
FC=$(psqlc "select (current_date + 200)::text")
FROWS="[{\"external_id\":\"S6R-F1\",\"package_code\":\"S6R-PB\",\"forecast_delivery_date\":\"$FC\",\"basis\":\"Supplier shipping schedule issued this week\"}]"
R=$(rpc "$PLANNER" begin_manual_import "{\"p_entity_type\":\"procurement_status\",\"p_source_name\":\"S6R forecast upload\"}")
noerr "$R"; RUN1=$(printf '%s' "$R" | field run_id); test -n "$RUN1"
R=$(rpc "$PLANNER" ingest_rows "{\"p_run_id\":\"$RUN1\",\"p_rows\":$FROWS}")
noerr "$R"; test "$(printf '%s' "$R" | field accepted)" = "1"
AUDIT_BEFORE=$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='procurement_package_forecast'")
R=$(rpc "$PLANNER" begin_manual_import "{\"p_entity_type\":\"procurement_status\",\"p_source_name\":\"S6R forecast upload, again\"}")
noerr "$R"; RUN2=$(printf '%s' "$R" | field run_id)
R=$(rpc "$PLANNER" ingest_rows "{\"p_run_id\":\"$RUN2\",\"p_rows\":$FROWS}")
noerr "$R"
test "$(printf '%s' "$R" | field duplicate)" = "1"
test "$(printf '%s' "$R" | field accepted)" = "0"
# A no-op recorded as a change is what the duplicate arm exists to prevent.
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='procurement_package_forecast'")" = "$AUDIT_BEFORE"

echo
echo "Develop slice-6b smoke PASSED"

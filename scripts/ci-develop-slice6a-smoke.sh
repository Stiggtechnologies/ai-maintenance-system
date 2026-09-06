#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 6A — the ProcurementPackage and its four §25 status
# dimensions, the sealed-bid tender, the §24 Contract awarded under a delegated
# authority, and the commitments that feed Slice 4's ONE cost model. Every step
# is a live transcript against a real local database, run TWICE in a row on one
# database before it was committed.
#
# Steps:
#   1  D6.03 — the package object: refusals by name (no stated scope, a
#      mandatory flag with no basis, a WBS element from another case), all four
#      §25 dimensions present from birth, and an awarded package's scope frozen.
#   2  D6.09 — the four dimensions move one at a time with a stated basis, and
#      `commercial = awarded` is refused BY NAME because only the award act
#      writes it.
#   3  D6.09 — THE GATE BLOCK IS REAL: a mandatory long-lead package whose
#      award-by date has passed appears in the ONE predicate, refuses a gate
#      review at the RPC AND at the persistence wall for a caller with RLS
#      switched off, and a package that cannot be assessed blocks nothing.
#   4  D6.04 — the bidder register, and a tender that cannot be issued against
#      a package with no scope of work or acceptance criteria.
#   5  D6.04 — SEALED: a lodged bid is invisible to every client and its price
#      is absent from the definer read and from the audit ledger; opening before
#      the close is refused; opening over zero bids is refused.
#   6  D6.04 — THE OPEN ACT, once, by a human: §70 refused at the door and at
#      the wall, a second opening refused, and the seal comes off.
#   7  D6.04 — a submitted bid is FROZEN for every writer, and is withdrawn
#      rather than deleted.
#   8  D6.04 — the two evaluations: refused before the envelope is open, frozen
#      once recorded, refused a second time, §70 refused, and the submitter
#      cannot score their own bid.
#   9  D6.05/D6.08 — the award: refused over zero bids ("nothing to award", not
#      "0 bids evaluated"), refused with an evaluation missing BY NAME, refused
#      on a non-compliant bid, refused with no adopted delegation, refused on a
#      null ceiling, refused ABOVE the ceiling by name with a security_events
#      row, and refused for an awarder who evaluated — at the door AND at the
#      table.
#  10  D6.08 — the §24 field set is all-or-none at the schema, and the award
#      clears the unawarded gate blocker.
#  11  D6.09 — mandatory long-lead SLIPPAGE: a forecast after the required date
#      raises the second blocker through the same predicate and the same wall.
#  12  D6.05 — the commitment: refused before the award, the total REFUSES and
#      NAMES the unpriced line, NaN refused, self-approval refused, §70 refused,
#      and approval posts onto project_cost_items.commitment — Slice 4's ONE
#      cost model, not a second one.
#  13  D11.29 — the lineage run, recorded WITH its refusals, and on the refusing
#      path too.
#  14  cross-tenant: a foreign member sees no package, no bid, no evaluation and
#      no obligation.
#  15  the ledgers are untruncatable and the §70 walls hold for every writer.
#
# Run: supabase start && scripts/ci-develop-slice6a-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-6a smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
ORG2='22222222-2222-2222-2222-222222222222'

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
ENGINEER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='demo@syncai.ca'")
test -n "$PLANNER_ID"; test -n "$MANAGER_ID"; test -n "$EXEC_ID"; test -n "$ENGINEER_ID"

# The AI-operator identity, seeded exactly as the 3B/3C/3D/4A/5A/5B/5D
# transcripts seed it, so the smokes share one fixture in CI and each still
# stands alone.
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
AIBOT_ID=$(psqlc "select id from user_profiles where email='smoke-aibot@syncai.ca'")
test -n "$AIBOT_ID"

# The FOREIGN tenant, provisioned by this smoke rather than borrowed: a
# cross-tenant negative that SKIPS when the other tenant happens not to exist is
# a negative test that passes by not running. Its own uuid, because the sibling
# smokes share a database in CI and a reused id collides on auth.users.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
declare v_uid uuid := '6a6a6a6a-6666-4666-8666-6a6a6a6a6a6a';
        v_org uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into organizations (id, name) values (v_org, 'S6A foreign tenant')
    on conflict (id) do nothing;
  if not exists (select 1 from auth.users where email = 'smoke6a-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke6a-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'S6A foreign member'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  if not exists (select 1 from auth.identities where user_id = v_uid) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke6a-foreign@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_uid, v_org, 'smoke6a-foreign@syncai.ca', 'maintenance_manager')
  on conflict (id) do update set organization_id = v_org, role = 'maintenance_manager';
end $seed$;
PSQL
FOREIGN=$(token 'smoke6a-foreign@syncai.ca' 'Foreign123!@#')
FOREIGN_ID=$(psqlc "select id from user_profiles where email='smoke6a-foreign@syncai.ca'")
test -n "$FOREIGN_ID"
test -n "$FOREIGN"

# ── Idempotent re-run. Fixture keys are kept SHORT on purpose — long fixture
#    identifiers have been read as secrets by the repository's scanner and have
#    blocked merges.
#
#    A package that has been AWARDED or OPENED refuses deletion while its case
#    exists, and so do its bids, its evaluations and its commitment lines. That
#    is the product working, so this teardown does what the product allows:
#    it deletes the CASES, and every one of those rows goes with them through
#    the declared cascade that each wall admits mid-cascade. Nothing here
#    deletes something the product forbids deleting.
psqlc "delete from development_cases where organization_id='$ORG' and title like 'S6A %';" >/dev/null
# business_cases.development_case_id is ON DELETE SET NULL, not CASCADE, so a
# business case OUTLIVES the case it belonged to and its case_ref is unique per
# organization. Without this line the second run refuses at fixture time on a
# reference the first run left behind — which is the sibling smokes' own
# teardown lesson (4A:159, 4B:180, 4C:226).
psqlc "delete from business_cases where organization_id='$ORG' and case_ref like 'S6A-%';" >/dev/null
psqlc "delete from contract_packages where organization_id='$ORG' and package_code like 'S6A-%';" >/dev/null
psqlc "delete from suppliers where organization_id='$ORG' and supplier_code like 'S6A-%';" >/dev/null
psqlc "delete from capital_projects where organization_id='$ORG' and project_code like 'S6A-%';" >/dev/null
psqlc "delete from project_frameworks where organization_id='$ORG' and name like 'S6A %';" >/dev/null
psqlc "update authority_limits set status='superseded' where organization_id='$ORG' and action_type='contract_award' and status='adopted';" >/dev/null
psqlc "delete from authority_limits where organization_id='$ORG' and action_type='contract_award' and status='draft';" >/dev/null
test "$(psqlc "select count(*) from contract_packages where organization_id='$ORG' and package_code like 'S6A-%'")" = "0"

echo "── 0. fixtures ──────────────────────────────────────────────────────────"

PROJ=$(psqlc "with r as (insert into capital_projects (organization_id, project_code, title, status)
  values ('$ORG','S6A-P','S6A delivery project','active') returning id) select id from r")
test -n "$PROJ"

R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S6A procurement case\",\"p_problem_statement\":\"The long-lead mill motor has no award behind it and nothing in this product knows that the gate it sits in front of is standing on an assumption about a purchase order nobody has raised.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE=$(printf '%s' "$R" | field case_id); test -n "$CASE"
psqlc "update development_cases set capital_project_id=$PROJ where id='$CASE';" >/dev/null

# A SECOND case, never given a package, so the empty read can be proven to be a
# sentence and not a count of zero.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S6A quiet case\",\"p_problem_statement\":\"A case with no procurement package at all, kept so that the empty procurement read can be read and proven to be a refusal rather than a report of zero late packages.\",\"p_lifecycle_type\":\"greenfield\"}")
noerr "$R"; QUIET=$(printf '%s' "$R" | field case_id); test -n "$QUIET"

# A framework, one gate, one criterion — the gate the procurement blocker stops.
FW=$(psqlc "with r as (insert into project_frameworks (organization_id,name,source,basis,status)
  values ('$ORG','S6A framework','internal','A framework recorded by the slice 6A transcript so the procurement gate blocker has a gate to stop.','draft') returning id) select id from r")
test -n "$FW"
psqlc "insert into project_framework_stages (organization_id, framework_id, stage_key, sequence, display_name)
       values ('$ORG','$FW','need_identification',1,'Need identification');" >/dev/null
GATE=$(psqlc "with r as (insert into stage_gates (organization_id, framework_id, stage_key, name, sequence)
  values ('$ORG','$FW','need_identification','S6A-G1',1) returning id) select id from r")
test -n "$GATE"
psqlc "insert into stage_gate_criteria (organization_id, stage_key, criterion, is_mandatory, gate_id)
       values ('$ORG','need_identification','Long-lead equipment is under contract', true, $GATE);" >/dev/null
psqlc "update development_cases set framework_id='$FW', current_stage_key='need_identification' where id='$CASE';" >/dev/null

# The Slice 4A chain the commitment posts into: a business case, a WBS element,
# a CBS code and two coded cost lines. Nothing here is re-implemented — these
# are D5.01/D5.02/D5.29's own doors.
R=$(rpc "$PLANNER" create_case_business_case "{\"p_case_id\":\"$CASE\",\"p_case_ref\":\"S6A-BC\",\"p_title\":\"Mill motor replacement\",\"p_driver\":\"reliability\",\"p_currency\":\"CAD\",\"p_discount_rate\":0.08,\"p_discount_rate_source\":\"Corporate treasury WACC memo 2026-Q2\"}")
noerr "$R"
R=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1\",\"title\":\"Mill motor package\",\"scope_description\":\"Everything inside the mill motor replacement package as scoped for the slice 6A transcript\"}}")
noerr "$R"
R=$(rpc "$PLANNER" record_cbs_code "{\"p_case_id\":\"$CASE\",\"p_code\":{\"cbs_code\":\"S6A-C100\",\"title\":\"Mechanical works\",\"cost_type\":\"subcontract\"}}")
noerr "$R"
R=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"S6A-CI1\",\"wbs_code\":\"1\",\"cbs_code\":\"S6A-C100\",\"description\":\"Mill motor supply\",\"basis\":\"Budget estimate from the concept study, 2026-Q3\",\"baseline_cost\":\"600000\"}}")
noerr "$R"
R=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"S6A-CI2\",\"wbs_code\":\"1\",\"cbs_code\":\"S6A-C100\",\"description\":\"Mill motor installation\",\"basis\":\"Budget estimate from the concept study, 2026-Q3\",\"baseline_cost\":\"150000\"}}")
noerr "$R"

# Two bidders, ours, so the transcript never leans on the demo seed.
psqlc "insert into suppliers (organization_id, supplier_code, name, supplier_kind, approved_vendor, safety_qualification_status)
       values ('$ORG','S6A-SA','S6A Motors A','oem',true,'qualified'),
              ('$ORG','S6A-SB','S6A Motors B','oem',true,'qualified'),
              ('$ORG','S6A-SC','S6A Motors C','oem',false,'not_assessed'),
              ('$ORG','S6A-SD','S6A Motors D','oem',true,'qualified');" >/dev/null
SUP_A=$(psqlc "select id from suppliers where organization_id='$ORG' and supplier_code='S6A-SA'")
SUP_B=$(psqlc "select id from suppliers where organization_id='$ORG' and supplier_code='S6A-SB'")
SUP_C=$(psqlc "select id from suppliers where organization_id='$ORG' and supplier_code='S6A-SC'")
SUP_D=$(psqlc "select id from suppliers where organization_id='$ORG' and supplier_code='S6A-SD'")
test -n "$SUP_A"; test -n "$SUP_B"; test -n "$SUP_C"; test -n "$SUP_D"

echo "── 1. D6.03 — the ProcurementPackage object, and its refusals ───────────"

# An empty case REFUSES rather than reporting zero late packages.
R=$(rpc "$PLANNER" get_case_procurement "{\"p_case_id\":\"$QUIET\"}")
test "$(printf '%s' "$R" | field answered)" = "False"
# The refusal arrives inside JSON, so the sentence's own quotation marks are
# backslash-escaped in the body; match on the part that carries no quotes.
grep -qi 'nothing is late' <<<"$R"
test "$(printf '%s' "$R" | field packageCount)" = "0"

# A package titled but not described is refused BY NAME.
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P1\",\"title\":\"Mill motor\",\"equipment_or_scope\":\"Pumps\"}}")
expect_err "$R" 'equipment_or_scope, 20 characters minimum'

# A mandatory flag with no basis is refused: this flag is the only thing that
# blocks a gate.
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P1\",\"title\":\"Mill motor\",\"equipment_or_scope\":\"One 4.2 MW synchronous mill motor with its VSD and cooling package\",\"is_mandatory\":true}}")
expect_err "$R" 'mandatory_basis, 20 characters minimum'

# A WBS element from another case is refused by name.
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P1\",\"title\":\"Mill motor\",\"equipment_or_scope\":\"One 4.2 MW synchronous mill motor with its VSD and cooling package\",\"wbs_code\":\"99.99\"}}")
expect_err "$R" 'does not exist on this case'

# A technician cannot author a package.
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$TECH"
R=$(rpc "$TECH" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-PX\",\"title\":\"Nope\",\"equipment_or_scope\":\"A technician should not be authoring procurement scope at all\"}}")
expect_err "$R" 'planning, engineering or governance role'

# THE PACKAGE. Mandatory, long-lead, and its award-by date is already in the
# past — which is what makes step 3's gate block real rather than hypothetical.
REQ=$(psqlc "select (current_date + 30)::text")
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P1\",\"title\":\"Mill motor\",\"equipment_or_scope\":\"One 4.2 MW synchronous mill motor with its VSD and cooling package\",\"scope_of_work\":\"Design, manufacture, factory-test and deliver the motor, VSD and cooling package to site\",\"acceptance_criteria\":\"Factory acceptance test at rated load, and site acceptance on no-load run\",\"required_date\":\"$REQ\",\"lead_time_days\":\"90\",\"is_mandatory\":true,\"mandatory_basis\":\"The motor is on the shutdown critical path and no alternative supply exists inside the window\",\"wbs_code\":\"1\"}}")
noerr "$R"
P1=$(printf '%s' "$R" | field package_id); test -n "$P1"
test "$(printf '%s' "$R" | field isMandatory)" = "True"
test "$(printf '%s' "$R" | field assessable)" = "True"

# A MANDATORY package with no lead time is NOT ASSESSABLE and says so — it will
# be listed and it will block nothing.
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P2\",\"title\":\"Switchgear\",\"equipment_or_scope\":\"One 11 kV switchgear lineup for the mill motor feeder\",\"required_date\":\"$REQ\",\"is_mandatory\":true,\"mandatory_basis\":\"The feeder cannot be energised without it and there is no temporary supply\"}}")
noerr "$R"
P2=$(printf '%s' "$R" | field package_id); test -n "$P2"
test "$(printf '%s' "$R" | field assessable)" = "False"
grep -qi 'states no lead_time_days' <<<"$R"

# A NON-mandatory package with no dates at all.
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P3\",\"title\":\"Spares kit\",\"equipment_or_scope\":\"Two years of recommended operating spares for the motor and VSD\"}}")
noerr "$R"
P3=$(printf '%s' "$R" | field package_id); test -n "$P3"

# ALL FOUR §25 DIMENSIONS EXIST FROM BIRTH — a package carrying three would read
# as complete on the one nobody tracked.
test "$(psqlc "select array_length(sync_procurement_status_dimensions(),1)")" = "4"
test "$(psqlc "select count(*) from unnest(sync_procurement_status_dimensions()) d
                where d in ('technical','commercial','manufacturing','delivery')")" = "4"
test "$(psqlc "select technical_status||'/'||commercial_status||'/'||manufacturing_status||'/'||delivery_status
                from contract_packages where id=$P1")" = "not_started/not_started/not_started/not_started"

echo "── 2. D6.09 — the four dimensions move, one at a time, with a basis ─────"

R=$(rpc "$PLANNER" set_procurement_package_status "{\"p_package_id\":$P1,\"p_dimension\":\"design\",\"p_status\":\"done\",\"p_basis\":\"A dimension the spec does not name\"}")
expect_err "$R" 'spec III.§25 names four'
R=$(rpc "$PLANNER" set_procurement_package_status "{\"p_package_id\":$P1,\"p_dimension\":\"technical\",\"p_status\":\"finished\",\"p_basis\":\"A value outside the vocabulary\"}")
expect_err "$R" 'the technical dimension takes one of'
R=$(rpc "$PLANNER" set_procurement_package_status "{\"p_package_id\":$P1,\"p_dimension\":\"technical\",\"p_status\":\"specification_issued\",\"p_basis\":\"short\"}")
expect_err "$R" 'basis, 10 characters minimum'

# `commercial = awarded` is refused BY NAME: only the award act writes it.
R=$(rpc "$PLANNER" set_procurement_package_status "{\"p_package_id\":$P1,\"p_dimension\":\"commercial\",\"p_status\":\"awarded\",\"p_basis\":\"Trying to type an award into the status dimension directly\"}")
expect_err "$R" 'reaches `awarded` through award_contract'

R=$(rpc "$PLANNER" set_procurement_package_status "{\"p_package_id\":$P1,\"p_dimension\":\"technical\",\"p_status\":\"specification_issued\",\"p_basis\":\"Specification MS-4201 rev B issued to the market on the tender date\"}")
noerr "$R"
test "$(printf '%s' "$R" | field previousStatus)" = "not_started"
# Moving it to where it already is is refused rather than recorded as a change.
R=$(rpc "$PLANNER" set_procurement_package_status "{\"p_package_id\":$P1,\"p_dimension\":\"technical\",\"p_status\":\"specification_issued\",\"p_basis\":\"The same value again, which is not a change\"}")
expect_err "$R" 'already specification_issued'

# The audit row carries previous_state AND new_state.
test "$(psqlc "select count(*) from audit_events where entity_type='procurement_package_status'
                and event_data->>'package_id'='$P1'
                and previous_state->>'status'='not_started' and new_state->>'status'='specification_issued'")" = "1"

# A §25 dimension moved by a direct client-shaped write is refused at the table…
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$PLANNER_ID', true);
update contract_packages set delivery_status='received_and_inspected' where id=$P1;
rollback;")
grep -q 'set_procurement_package_status' <<<"$OUT"
# …and so is ANY other client-shaped write to this table. A signed-in caller
# reaching it at all has bypassed row-level security, so it is refused rather
# than recorded (the enforce_cost_item_coding posture).
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$PLANNER_ID', true);
update contract_packages set title='renamed by hand' where id=$P1;
rollback;")
grep -qi 'bypassing row-level security' <<<"$OUT"
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$PLANNER_ID', true);
insert into contract_packages (organization_id, package_code, title, development_case_id, is_mandatory, mandatory_basis)
values ('$ORG','S6A-RAW','A package born mandatory with nobody behind it','$CASE',true,'Born mandatory by a direct insert, which is what this refuses');
rollback;")
grep -qi 'bypassing row-level security' <<<"$OUT"

echo "── 3. D6.09 — THE GATE BLOCK IS REAL ────────────────────────────────────"

# The mandatory package whose award-by date has passed is in the ONE predicate…
test "$(psqlc "select count(*) from jsonb_array_elements(case_procurement_gate_obligations('$CASE', $GATE)) x
                where x->>'type'='procurement_package_unawarded'")" = "1"
# …and the SAME row is in case_gate_outstanding_obligations, because that is
# the predicate the readiness screen renders and the wall refuses over. No
# second evaluator was written for this slice.
test "$(psqlc "select count(*) from jsonb_array_elements(case_gate_outstanding_obligations('$CASE',$GATE)) x
                where x->>'type'='procurement_package_unawarded'")" = "1"
# The two packages that cannot be assessed block NOTHING.
test "$(psqlc "select count(*) from jsonb_array_elements(case_procurement_gate_obligations('$CASE', $GATE)) x
                where x->>'name' like 'S6A-P2%' or x->>'name' like 'S6A-P3%'")" = "0"

# The gate review REFUSES at the RPC…
FIND6A=$(psqlc "select coalesce(jsonb_agg(jsonb_build_object('criterion_text', sc.criterion, 'status', 'met')), '[]'::jsonb)::text from stage_gate_criteria sc where sc.gate_id=$GATE and sc.organization_id='$ORG'")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$GATE,\"p_outcome\":\"proceed\",\"p_note\":\"A proceed recorded while the mandatory long-lead motor has no award behind it must be refused.\",\"p_findings\":$FIND6A}")
grep -qi 'cannot pass while' <<<"$R"
grep -q 'S6A-P1' <<<"$R"
grep -q 'III.§25' <<<"$R"

# …and at the PERSISTENCE WALL, for a writer with RLS switched off entirely.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
select set_config('app.gate_review_write','granted',true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_by, reviewed_at, note)
values ('$ORG','$CASE',$GATE,'need_identification','proceed','$MANAGER_ID',now(),'bypass attempt over an unawarded mandatory long-lead package');
rollback;")
grep -qi 'cannot pass while' <<<"$OUT"
grep -q 'III.§25' <<<"$OUT"
grep -q 'award_contract' <<<"$OUT"

# The read shows the same rows AND names what it cannot assess.
R=$(rpc "$PLANNER" get_case_procurement "{\"p_case_id\":\"$CASE\"}")
test "$(printf '%s' "$R" | field answered)" = "True"
test "$(printf '%s' "$R" | field packageCount)" = "3"
test "$(printf '%s' "$R" | field blockerCount)" = "1"
test "$(printf '%s' "$R" | field mandatoryNotAssessable)" = "1"
grep -qi 'cannot be assessed for lateness' <<<"$R"

echo "── 4. D6.04 — the bidder register, and the tender that cannot be issued ─"

# A tender cannot be issued against a package with no acceptance criteria.
R=$(rpc "$PLANNER" open_package_bidding "{\"p_package_id\":$P3,\"p_close_at\":\"$(psqlc "select (now() + interval '2 hour')::text")\"}")
expect_err "$R" 'acceptance criteria'

# The bidder register: three invited, one with no prequalification basis and one
# never assessed for safety — both NAMED rather than passed over.
R=$(rpc "$PLANNER" invite_package_bidder "{\"p_package_id\":$P1,\"p_supplier_id\":$SUP_A,\"p_prequalification_basis\":\"Supplied four motors of this frame size on the 2024 concentrator, all inside their promised window\"}")
noerr "$R"
test "$(printf '%s' "$R" | field prequalificationStated)" = "True"
R=$(rpc "$PLANNER" invite_package_bidder "{\"p_package_id\":$P1,\"p_supplier_id\":$SUP_B,\"p_prequalification_basis\":\"Rebuilt the 2019 mill motor to specification and inside the outage window\"}")
noerr "$R"
R=$(rpc "$PLANNER" invite_package_bidder "{\"p_package_id\":$P1,\"p_supplier_id\":$SUP_C}")
noerr "$R"
grep -qi 'not a prequalification' <<<"$R"
grep -qi 'never been assessed for safety qualification' <<<"$R"
# A second invitation of the same supplier is refused.
R=$(rpc "$PLANNER" invite_package_bidder "{\"p_package_id\":$P1,\"p_supplier_id\":$SUP_A}")
expect_err "$R" 'already on the bidder register'

# A bid before the tender is issued is refused by name.
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6A-SA\",\"price\":\"600000\",\"currency\":\"CAD\"}}")
expect_err "$R" 'has not been issued for tender'

CLOSE=$(psqlc "select (now() + interval '2 hour')::text")
R=$(rpc "$PLANNER" open_package_bidding "{\"p_package_id\":$P1,\"p_close_at\":\"$CLOSE\"}")
noerr "$R"
test "$(printf '%s' "$R" | field commercialStatus)" = "tendered"
test "$(printf '%s' "$R" | field invitedBidders)" = "3"

echo "── 5. D6.04 — SEALED: the price is not readable before the open act ─────"

R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6A-SA\",\"price\":\"NaN\",\"currency\":\"CAD\"}}")
expect_err "$R" 'finite amount of at least zero'
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6A-SA\",\"price\":\"-1\",\"currency\":\"CAD\"}}")
expect_err "$R" 'finite amount of at least zero'
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6A-SA\",\"price\":\"Infinity\",\"currency\":\"CAD\"}}")
expect_err "$R" 'finite amount of at least zero'
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6A-SA\",\"price\":\"600000\"}}")
expect_err "$R" 'three-letter code'
# A bid from somebody nobody invited is refused: the register is where the
# prequalification lives.
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6A-SD\",\"price\":\"1\",\"currency\":\"CAD\"}}")
expect_err "$R" 'not on the bidder register'

R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6A-SA\",\"price\":\"640000\",\"currency\":\"CAD\",\"labour_hours\":\"1200\",\"assumed_productivity_factor\":\"1.0\",\"duration_days\":\"210\",\"price_basis\":\"Firm price, fixed for 90 days\"}}")
noerr "$R"
BID_A=$(printf '%s' "$R" | field bid_id); test -n "$BID_A"
test "$(printf '%s' "$R" | field sealed)" = "True"
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6A-SB\",\"price\":\"560000\",\"currency\":\"CAD\",\"duration_days\":\"260\"}}")
noerr "$R"
BID_B=$(printf '%s' "$R" | field bid_id); test -n "$BID_B"
grep -qi 'no assumed productivity factor' <<<"$R"
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6A-SC\",\"price\":\"9000000\",\"currency\":\"CAD\",\"assumed_productivity_factor\":\"1.0\"}}")
noerr "$R"
BID_C=$(printf '%s' "$R" | field bid_id); test -n "$BID_C"

# A second bid from the same bidder is refused.
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6A-SA\",\"price\":\"1\",\"currency\":\"CAD\"}}")
expect_err "$R" 'already has a bid'

# THE SEAL, LAYER 1 — the row-level policy. A signed-in member of the OWNING
# tenant sees no sealed bid at all through the table.
test "$(rest "$PLANNER" "contract_bids?package_id=eq.$P1&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")" = "0"
# The rows are there; it is the policy that is hiding them.
test "$(psqlc "select count(*) from contract_bids where package_id=$P1")" = "3"

# THE SEAL, LAYER 2 — the definer read, which RLS does NOT constrain. Every
# content field is absent, and this is the layer that matters for the product.
R=$(rpc "$PLANNER" get_package_tender "{\"p_package_id\":$P1}")
test "$(printf '%s' "$R" | field sealed)" = "True"
test "$(jqp "$R" "len(x['bids'])")" = "3"
test "$(jqp "$R" "sum(1 for b in x['bids'] if b['price'] is not None)")" = "0"
test "$(jqp "$R" "sum(1 for b in x['bids'] if b['labourHours'] is not None or b['durationDays'] is not None or b['qualifications'] is not None or b['assumedProductivityFactor'] is not None)")" = "0"
grep -qi 'envelopes are sealed' <<<"$R"

# THE SEAL, LAYER 3 — the audit ledger is readable by the tenant, so the audit
# row deliberately carries no price either.
test "$(psqlc "select count(*) from audit_events where entity_type='sealed_bid'
                and event_data->>'package_id'='$P1' and new_state ? 'price'")" = "0"
test "$(psqlc "select count(*) from audit_events where entity_type='sealed_bid'
                and event_data->>'package_id'='$P1'")" = "3"

# Opening BEFORE the close is the leak sealing exists to prevent.
R=$(rpc "$MANAGER" open_package_bids "{\"p_package_id\":$P1,\"p_note\":\"Trying to read the prices while bidders can still submit.\"}")
expect_err "$R" 'does not close until'

# Opening a tender that received NOTHING refuses rather than recording a tender
# that was opened and found empty as one that was evaluated.
CLOSE3=$(psqlc "select (now() + interval '2 hour')::text")
R=$(rpc "$PLANNER" open_package_bidding "{\"p_package_id\":$P2,\"p_close_at\":\"$CLOSE3\"}")
expect_err "$R" 'scope of work'
psqlc "update contract_packages set scope_of_work='Supply and deliver the 11 kV switchgear lineup complete with protection relays', acceptance_criteria='Type-tested to IEC 62271 and site-tested on primary injection' where id=$P2;" >/dev/null
R=$(rpc "$PLANNER" open_package_bidding "{\"p_package_id\":$P2,\"p_close_at\":\"$CLOSE3\"}")
noerr "$R"
psqlc "update contract_packages set bids_close_at = now() - interval '1 minute' where id=$P2;" >/dev/null
R=$(rpc "$MANAGER" open_package_bids "{\"p_package_id\":$P2,\"p_note\":\"Opening a tender that received nothing at all, to see what is said.\"}")
expect_err "$R" 'There is nothing to open'
grep -qi 'not a package that was evaluated and found wanting' <<<"$R"

echo "── 6. D6.04 — THE OPEN ACT, once, by a human ───────────────────────────"

psqlc "update contract_packages set bids_close_at = now() - interval '1 minute' where id=$P1;" >/dev/null

# A late bid is refused: accepting one is the same act as re-opening the tender
# for one bidder. Proven on an INVITED bidder, so the refusal is unambiguously
# about the clock and not about the register (inviting is still permitted here —
# it is the OPEN act, not the close, that shuts the register).
R=$(rpc "$PLANNER" invite_package_bidder "{\"p_package_id\":$P1,\"p_supplier_id\":$SUP_D,\"p_prequalification_basis\":\"Invited after the close so the late-bid refusal can be proven on a registered bidder\"}")
noerr "$R"
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P1,\"p_bid\":{\"supplier_code\":\"S6A-SD\",\"price\":\"1\",\"currency\":\"CAD\"}}")
expect_err "$R" 'A late bid is refused'

# §70 AT THE DOOR.
R=$(rpc "$AIBOT" open_package_bids "{\"p_package_id\":$P1,\"p_note\":\"The AI operator opening the envelopes on its own initiative.\"}")
expect_err "$R" '§70 human act'
# §70 AT THE WALL, for a caller with RLS switched off entirely.
OUT=$(sql_must_fail "update contract_packages set bids_opened_at=now(), bids_opened_by='$AIBOT_ID' where id=$P1;")
grep -q 'AI-operator identity cannot open the sealed bids' <<<"$OUT"

R=$(rpc "$MANAGER" open_package_bids "{\"p_package_id\":$P1,\"p_note\":\"short\"}")
expect_err "$R" '20 characters minimum'

R=$(rpc "$MANAGER" open_package_bids "{\"p_package_id\":$P1,\"p_note\":\"Opened in the presence of the project manager and the contracts lead; three envelopes, all intact.\"}")
noerr "$R"
test "$(printf '%s' "$R" | field liveBids)" = "3"
test "$(printf '%s' "$R" | field commercialStatus)" = "bids_received"
# An envelope is opened ONCE.
R=$(rpc "$MANAGER" open_package_bids "{\"p_package_id\":$P1,\"p_note\":\"Opening the same envelopes a second time to see whether it is permitted.\"}")
expect_err "$R" 'An envelope is opened once'

# And NOW the seal is off, on both layers.
test "$(rest "$PLANNER" "contract_bids?package_id=eq.$P1&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")" = "3"
R=$(rpc "$PLANNER" get_package_tender "{\"p_package_id\":$P1}")
test "$(printf '%s' "$R" | field sealed)" = "False"
test "$(jqp "$R" "sum(1 for b in x['bids'] if b['price'] is not None)")" = "3"

echo "── 7. D6.04 — a submitted bid is FROZEN for every writer ────────────────"

OUT=$(sql_must_fail "update contract_bids set price = 1 where id=$BID_A;")
grep -qi 'was submitted under seal' <<<"$OUT"
OUT=$(sql_must_fail "update contract_bids set assumed_productivity_factor = 9 where id=$BID_A;")
grep -qi 'is not a sealed bid' <<<"$OUT"
# A client-shaped update is refused outright, before the column freeze — which
# is what protects the pre-Slice-6A rows that carry no seal at all.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$PLANNER_ID', true);
update contract_bids set bid_ref='renamed by hand' where id=$BID_A;
rollback;")
grep -qi 'bypassing row-level security' <<<"$OUT"
OUT=$(sql_must_fail "delete from contract_bids where id=$BID_A;")
grep -qi 'withdrawn, never deleted' <<<"$OUT"
OUT=$(sql_must_fail "truncate contract_bids cascade;")
grep -qi 'Not truncatable by any caller' <<<"$OUT"
# A direct insert bypassing the door is refused for a client-shaped caller.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$PLANNER_ID', true);
insert into contract_bids (organization_id, package_id, supplier_id, price, sealed_at)
values ('$ORG',$P1,$SUP_A,1,now());
rollback;")
grep -q 'submit_sealed_bid' <<<"$OUT"
# A withdrawal after the envelope is open is refused.
R=$(rpc "$PLANNER" withdraw_sealed_bid "{\"p_bid_id\":$BID_C,\"p_reason\":\"Trying to remove the expensive bid now that the field is known\"}")
expect_err "$R" 'not withdrawn after the envelope is open'

echo "── 8. D6.04 — the two evaluations, frozen once recorded ─────────────────"

# On the UNOPENED package, an evaluation is refused at the door AND at the table.
psqlc "insert into contract_bids (organization_id, package_id, supplier_id, price, currency)
       values ('$ORG',$P2,$SUP_A,100,'CAD') on conflict do nothing;" >/dev/null
BID_P2=$(psqlc "select id from contract_bids where package_id=$P2 limit 1")
test -n "$BID_P2"
R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_P2,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"compliant\",\"rationale\":\"Evaluating a bid whose envelope has not been opened at all\"}}")
expect_err "$R" 'have not been opened'
OUT=$(sql_must_fail "insert into bid_evaluations (organization_id, package_id, bid_id, evaluation_kind, evaluator_id, outcome, rationale)
  values ('$ORG',$P2,$BID_P2,'technical','$ENGINEER_ID','compliant','A judgement recorded before anybody could see the offer');")
grep -qi 'have not been opened' <<<"$OUT"

R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_A,\"p_evaluation\":{\"evaluation_kind\":\"design\",\"outcome\":\"compliant\",\"rationale\":\"A third kind of evaluation the spec does not name\"}}")
expect_err "$R" 'TechnicalEvaluation and CommercialEvaluation'
R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_A,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"compliant\",\"rationale\":\"short\"}}")
expect_err "$R" 'rationale, 20 characters minimum'
R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_A,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"compliant\",\"score\":\"NaN\",\"rationale\":\"A score that is not a number at all, offered to the door\"}}")
expect_err "$R" 'finite number between 0 and 100'

# §70: the AI-operator identity cannot score a bid, at the door and at the table.
R=$(rpc "$AIBOT" record_bid_evaluation "{\"p_bid_id\":$BID_A,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"compliant\",\"rationale\":\"The machine deciding whether an offer meets the specification\"}}")
expect_err "$R" '§70 human act'
OUT=$(sql_must_fail "insert into bid_evaluations (organization_id, package_id, bid_id, evaluation_kind, evaluator_id, outcome, rationale)
  values ('$ORG',$P1,$BID_A,'technical','$AIBOT_ID','compliant','The machine scoring a bid straight past the door');")
grep -q 'AI-operator identity cannot score a bid' <<<"$OUT"

# The planner LODGED these bids, so the planner cannot score them.
R=$(rpc "$PLANNER" record_bid_evaluation "{\"p_bid_id\":$BID_A,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"compliant\",\"rationale\":\"The person who lodged this bid scoring their own offer\"}}")
expect_err "$R" 'Nobody evaluates their own offer'

R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_A,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"compliant\",\"score\":\"88\",\"rationale\":\"Meets MS-4201 rev B in full; cooling package matches the site ambient design case\"}}")
noerr "$R"
test "$(printf '%s' "$R" | field frozen)" = "True"
test "$(printf '%s' "$R" | field awaiting)" = "commercial"
test "$(psqlc "select technical_status from contract_packages where id=$P1")" = "technically_evaluated"

# A SECOND evaluation of the same kind is a re-score, and is refused.
R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_A,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"non_compliant\",\"rationale\":\"Changing my mind now that the prices are on the table\"}}")
expect_err "$R" 'already recorded'

# An evaluation is IMMUTABLE — no update, no delete, no truncate.
EVAL_A=$(psqlc "select id from bid_evaluations where bid_id=$BID_A and evaluation_kind='technical'")
test -n "$EVAL_A"
OUT=$(sql_must_fail "update bid_evaluations set outcome='non_compliant' where id=$EVAL_A;")
grep -qi 'recorded evaluation is FROZEN' <<<"$OUT"
OUT=$(sql_must_fail "delete from bid_evaluations where id=$EVAL_A;")
grep -qi 'recorded evaluation is not deleted' <<<"$OUT"
OUT=$(sql_must_fail "truncate bid_evaluations cascade;")
grep -qi 'Not truncatable by any caller' <<<"$OUT"

# THE COMMERCIAL EVALUATION IS A SECOND PERSON. `unique (bid_id,
# evaluation_kind)` was the only cross-evaluation rule, so one evaluator held
# both scores and award_contract treated the bid as fully evaluated — which is
# the collapse spec I.16's two separate objects exist to prevent, and this
# transcript itself did it.
R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_A,\"p_evaluation\":{\"evaluation_kind\":\"commercial\",\"outcome\":\"compliant\",\"score\":\"74\",\"rationale\":\"The engineer who wrote the technical score also pricing the commercial side\"}}")
expect_err "$R" 'already recorded the technical evaluation of this bid'
R=$(rpc "$EXEC" record_bid_evaluation "{\"p_bid_id\":$BID_A,\"p_evaluation\":{\"evaluation_kind\":\"commercial\",\"outcome\":\"compliant\",\"score\":\"74\",\"rationale\":\"Firm price for 90 days, payment terms accepted, no material qualifications\"}}")
noerr "$R"
test "$(psqlc "select commercial_status from contract_packages where id=$P1")" = "commercially_evaluated"

# The cheapest bid is evaluated NON-COMPLIANT — the case I.16's two separate
# objects exist for.
R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_B,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"non_compliant\",\"rationale\":\"Offered frame size cannot deliver rated torque at the stated ambient temperature\"}}")
noerr "$R"
R=$(rpc "$EXEC" record_bid_evaluation "{\"p_bid_id\":$BID_B,\"p_evaluation\":{\"evaluation_kind\":\"commercial\",\"outcome\":\"compliant\",\"rationale\":\"Lowest price of the three and payment terms are acceptable as offered\"}}")
noerr "$R"

echo "── 9. D6.05/D6.08 — the award ──────────────────────────────────────────"

# A package with NO BIDS refuses — "nothing to award", never "0 bids evaluated".
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P3,\"p_award\":{\"bid_id\":\"1\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Deliver the recommended spares list in full\",\"award_basis\":\"There is nothing to award here and the transcript says so\",\"contract_start_date\":\"$REQ\",\"contract_completion_date\":\"$REQ\"}}")
expect_err "$R" 'have not been opened'

# The MISSING evaluation, named.
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P1,\"p_award\":{\"bid_id\":\"$BID_C\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Deliver the motor to the site acceptance criteria in the specification\",\"award_basis\":\"Awarding a bid that nobody has evaluated at all, to see what is said\",\"contract_start_date\":\"$REQ\",\"contract_completion_date\":\"$REQ\"}}")
expect_err "$R" 'has no commercial and technical evaluation'

# The NON-COMPLIANT bid, refused with the evaluation quoted.
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P1,\"p_award\":{\"bid_id\":\"$BID_B\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Deliver the motor to the site acceptance criteria in the specification\",\"award_basis\":\"Awarding the cheapest bid despite the technical evaluation, to see what is said\",\"contract_start_date\":\"$REQ\",\"contract_completion_date\":\"$REQ\"}}")
expect_err "$R" 'evaluated NON-COMPLIANT'
grep -qi 'cannot deliver rated torque' <<<"$R"

# §70 at the award door.
R=$(rpc "$AIBOT" award_contract "{\"p_package_id\":$P1,\"p_award\":{\"bid_id\":\"$BID_A\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Deliver the motor to the site acceptance criteria in the specification\",\"award_basis\":\"The machine committing the owner capital on its own initiative\",\"contract_start_date\":\"$REQ\",\"contract_completion_date\":\"$REQ\"}}")
expect_err "$R" '§70 human act'

# SEPARATION OF DUTIES, at the door: the engineer evaluated, so the engineer
# cannot award. (The engineer holds no award role either; both refusals are real
# and this asserts the SoD one specifically by making the engineer an admin for
# one statement is NOT what happens — instead the reverse leg is proven at the
# table below, which binds every writer.)
OUT=$(sql_must_fail "update contract_packages set awarded_at=now(), awarded_by='$ENGINEER_ID',
  awarded_bid_id=$BID_A,
  awarded_supplier_id=$SUP_A, awarded_value=640000, contract_currency='CAD', contract_type='lump_sum',
  contract_start_date=current_date, contract_completion_date=current_date+200,
  performance_requirements='Deliver the motor to the site acceptance criteria in the specification',
  award_basis='An award recorded by the very person who wrote the technical evaluation'
  where id=$P1;")
grep -qi 'who wrote its' <<<"$OUT"
grep -qi 'ceremonial' <<<"$OUT"
# …and the reverse leg: an evaluation by somebody already recorded as the
# awarder. Proven on a package awarded in a rolled-back transaction so the
# transcript leaves nothing behind.
OUT=$(sql_must_fail "begin;
update contract_packages set awarded_at=now(), awarded_by='$MANAGER_ID',
  awarded_bid_id=$BID_A,
  awarded_supplier_id=$SUP_A, awarded_value=640000, contract_currency='CAD', contract_type='lump_sum',
  contract_start_date=current_date, contract_completion_date=current_date+200,
  performance_requirements='Deliver the motor to the site acceptance criteria in the specification',
  award_basis='An award recorded so that the reverse separation-of-duties leg can be proven'
  where id=$P1;
insert into bid_evaluations (organization_id, package_id, bid_id, evaluation_kind, evaluator_id, outcome, rationale)
values ('$ORG',$P1,$BID_C,'technical','$MANAGER_ID','compliant','The awarder scoring a bid on the package they just awarded');
rollback;")
grep -qi 'recorded by the person who awarded package' <<<"$OUT"

# THE AUTHORITY. No adopted contract-award delegation yet → refused.
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P1,\"p_award\":{\"bid_id\":\"$BID_A\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Deliver the motor to the site acceptance criteria in the specification\",\"award_basis\":\"Awarding with no delegation of authority adopted anywhere in the organization\",\"contract_start_date\":\"$REQ\",\"contract_completion_date\":\"$REQ\"}}")
expect_err "$R" 'no adopted contract-award delegation exists'
# …and the refusal left a security_events row, because an unauthorised attempt
# on the owner's capital is security-relevant.
test "$(psqlc "select count(*) from security_events where organization_id='$ORG'
                and detail like '%Contract award on package S6A-P1%' and detail like '%no adopted contract-award delegation%'")" -ge 1

psqlc "insert into authority_limits (organization_id, role_key, tier_label, action_type, max_commitment_usd, escalates_to_role, basis, status)
       values ('$ORG','maintenance_manager','Project manager','contract_award', null,'executive','Reseeded for the slice-6A transcript: the amount is deliberately null so a null ceiling refuses.','draft');" >/dev/null
LIMIT_ID=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='maintenance_manager' and action_type='contract_award' and status='draft' order by version desc limit 1")
test -n "$LIMIT_ID"

# A blank ceiling is an unfinished delegation, not an unlimited one — refused at
# adoption (the 4D rule, now extended to contract_award by transformation).
R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$LIMIT_ID\",\"p_note\":\"Adopted from the capital delegation instrument dated this year.\"}")
expect_err "$R" 'states no money ceiling'
# You do not state your own contract-award ceiling.
R=$(rpc "$MANAGER" state_authority_ceiling "{\"p_id\":\"$LIMIT_ID\",\"p_ceiling\":{\"max_commitment\":\"500000\",\"currency\":\"CAD\",\"basis\":\"The manager stating the ceiling on their own delegation.\"}}")
expect_err "$R" 'requires an executive or administrator'
# §70: the AI does not decide how much of the owner's capital anyone may commit.
R=$(rpc "$AIBOT" state_authority_ceiling "{\"p_id\":\"$LIMIT_ID\",\"p_ceiling\":{\"max_commitment\":\"500000\",\"currency\":\"CAD\",\"basis\":\"The machine stating a contract-award ceiling on its own initiative.\"}}")
expect_err "$R" '§70'

R=$(rpc "$EXEC" state_authority_ceiling "{\"p_id\":\"$LIMIT_ID\",\"p_ceiling\":{\"max_commitment\":\"500000\",\"currency\":\"CAD\",\"basis\":\"The capital delegation instrument dated this year, section 6.1 (procurement).\"}}")
noerr "$R"
R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$LIMIT_ID\",\"p_note\":\"Adopted from the capital delegation instrument dated this year.\"}")
noerr "$R"

# ABOVE THE CEILING, refused BY NAME with the escalation stated.
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P1,\"p_award\":{\"bid_id\":\"$BID_A\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Deliver the motor to the site acceptance criteria in the specification\",\"award_basis\":\"A 640,000 award attempted under a 500,000 project-manager ceiling\",\"contract_start_date\":\"$REQ\",\"contract_completion_date\":\"$REQ\"}}")
expect_err "$R" 'exceeds the Project manager contract-award ceiling'
grep -qi 'Escalate to executive' <<<"$R"
test "$(psqlc "select count(*) from security_events where organization_id='$ORG'
                and detail like '%Contract award on package S6A-P1%' and detail like '%exceeds the Project manager%'")" -ge 1

# Raise the ceiling the way the product allows — a NEW draft, adopted; an
# adopted delegation is never edited.
psqlc "insert into authority_limits (organization_id, role_key, tier_label, action_type, max_commitment_usd, escalates_to_role, basis, status)
       values ('$ORG','maintenance_manager','Project manager','contract_award', null,'executive','Reseeded higher for the slice-6A transcript, as a fresh draft because an adopted ceiling is never edited.','draft');" >/dev/null
LIMIT2=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='maintenance_manager' and action_type='contract_award' and status='draft' order by version desc limit 1")
R=$(rpc "$EXEC" state_authority_ceiling "{\"p_id\":\"$LIMIT2\",\"p_ceiling\":{\"max_commitment\":\"750000\",\"currency\":\"CAD\",\"basis\":\"The capital delegation instrument dated this year, section 6.1, revised limit.\"}}")
noerr "$R"
R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$LIMIT2\",\"p_note\":\"Adopted from the revised capital delegation instrument.\"}")
noerr "$R"

# The §24 field set is demanded at the door, one field at a time.
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P1,\"p_award\":{\"bid_id\":\"$BID_A\",\"contract_type\":\"handshake\",\"performance_requirements\":\"Deliver the motor to the site acceptance criteria in the specification\",\"award_basis\":\"A contract type the I.17 vocabulary does not contain at all\",\"contract_start_date\":\"$REQ\",\"contract_completion_date\":\"$REQ\"}}")
expect_err "$R" 'contract_type must be one of'
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P1,\"p_award\":{\"bid_id\":\"$BID_A\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"fast\",\"award_basis\":\"A contract with nothing to hold the counterparty to at all\",\"contract_start_date\":\"$REQ\",\"contract_completion_date\":\"$REQ\"}}")
expect_err "$R" 'performance requirements'
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P1,\"p_award\":{\"bid_id\":\"$BID_A\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Deliver the motor to the site acceptance criteria in the specification\",\"award_basis\":\"An award with no start or completion date recorded at all\"}}")
expect_err "$R" 'states its start and its completion'

# THE CONTRACT COMPLETES BEFORE THE PROJECT NEEDS THE EQUIPMENT. This
# transcript's first draft awarded with a completion date 170 days AFTER the
# required date and then asserted that the gate blockers were clear — which is
# exactly the state D6.09's third leg now refuses, and it went unnoticed
# because nothing measured it. Proven the other way round below on S6A-P4.
START=$(psqlc "select current_date::text")
FINISH=$(psqlc "select (current_date + 25)::text")
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P1,\"p_award\":{\"bid_id\":\"$BID_A\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Rated torque at 40C ambient, factory acceptance at full load, 98% availability in the first operating year\",\"award_basis\":\"Only technically compliant offer; 80,000 above the lowest bid, which cannot deliver rated torque\",\"contract_start_date\":\"$START\",\"contract_completion_date\":\"$FINISH\"}}")
noerr "$R"
test "$(printf '%s' "$R" | field value)" = "640000"
test "$(printf '%s' "$R" | field awardedUnder)" = "Project manager"
test "$(printf '%s' "$R" | field ceiling)" = "750000"
grep -qi 'references no warranty term' <<<"$R"
grep -qi 'not yet a commitment in the controls model' <<<"$R"

# An award is made ONCE.
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P1,\"p_award\":{\"bid_id\":\"$BID_C\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Rated torque at 40C ambient, factory acceptance at full load\",\"award_basis\":\"A second award on a package that already carries one\",\"contract_start_date\":\"$START\",\"contract_completion_date\":\"$FINISH\"}}")
expect_err "$R" 'An award is made once'

echo "── 10. D6.08 — §24 all-or-none, and the blocker clears ─────────────────"

# The §24 field set is held ALL-OR-NONE at the schema, for every writer —
# proven on a FRESH award, because on an already-awarded row the frozen-award
# arm refuses the field change first and that refusal is the stronger one.
OUT=$(sql_must_fail "begin;
update contract_packages set awarded_at=now(), awarded_by='$MANAGER_ID', awarded_bid_id=$BID_A,
  awarded_supplier_id=$SUP_A, awarded_value=1000, contract_currency='CAD', contract_type='lump_sum',
  contract_start_date=current_date, contract_completion_date=current_date+1,
  award_basis='An award carrying every §24 field except the one the counterparty is held to'
  where id=$P3;
rollback;")
grep -qi 'contract_package_section24_complete' <<<"$OUT"
OUT=$(sql_must_fail "begin;
update contract_packages set awarded_at=now(), awarded_by='$MANAGER_ID', awarded_bid_id=$BID_A,
  awarded_supplier_id=$SUP_A, awarded_value=1000, contract_currency='CAD',
  contract_start_date=current_date, contract_completion_date=current_date+1,
  performance_requirements='Rated torque at 40C ambient, factory acceptance at full load',
  award_basis='An award with no contract strategy recorded against it at all'
  where id=$P3;
rollback;")
grep -qi 'contract_package_section24_complete' <<<"$OUT"
# …and on the AWARDED row the whole §24 set is frozen, which is stronger than
# all-or-none: it cannot be rewritten even into another complete set.
OUT=$(sql_must_fail "update contract_packages set performance_requirements=null where id=$P1;")
grep -qi 'is FROZEN for every caller' <<<"$OUT"
OUT=$(sql_must_fail "update contract_packages set contract_type='epc' where id=$P1;")
grep -qi 'is FROZEN for every caller' <<<"$OUT"
# An awarded contract is not deleted.
OUT=$(sql_must_fail "delete from contract_packages where id=$P1;")
grep -qi 'holds an awarded contract' <<<"$OUT"
OUT=$(sql_must_fail "truncate contract_packages cascade;")
grep -qi 'Not truncatable by any caller' <<<"$OUT"

# The §25 commercial dimension and the award record AGREE.
test "$(psqlc "select commercial_status from contract_packages where id=$P1")" = "awarded"
# THE GATE BLOCKER CLEARS — the same predicate, now empty.
test "$(psqlc "select count(*) from jsonb_array_elements(case_gate_outstanding_obligations('$CASE',$GATE)) x
                where x->>'type' like 'procurement_package_%'")" = "0"
# …and the SAME write the wall refused in step 3 now goes through. Rolled back
# so the transcript leaves no gate review behind and re-runs identically.
psqlc "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
select set_config('app.gate_review_write','granted',true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_by, reviewed_at, note)
values ('$ORG','$CASE',$GATE,'need_identification','proceed','$MANAGER_ID',now(),'recorded once the mandatory long-lead package was under contract');
rollback;" >/dev/null

echo "── 11. D6.09 — mandatory long-lead SLIPPAGE blocks the same gate ────────"

R=$(rpc "$PLANNER" record_package_delivery_forecast "{\"p_package_id\":$P3,\"p_forecast_date\":\"$REQ\",\"p_basis\":\"A forecast on a package with no required date at all\"}")
expect_err "$R" 'nothing to be early or late against'
R=$(rpc "$PLANNER" record_package_delivery_forecast "{\"p_package_id\":$P1,\"p_forecast_date\":\"$REQ\",\"p_basis\":\"short\"}")
expect_err "$R" 'basis, 10 characters minimum'

LATE=$(psqlc "select (current_date + 75)::text")
R=$(rpc "$PLANNER" record_package_delivery_forecast "{\"p_package_id\":$P1,\"p_forecast_date\":\"$LATE\",\"p_basis\":\"Vendor manufacturing schedule issued after contract award; casting slot moved by six weeks\"}")
noerr "$R"
test "$(printf '%s' "$R" | field slippageDays)" = "45"
test "$(printf '%s' "$R" | field blocksGate)" = "True"

test "$(psqlc "select count(*) from jsonb_array_elements(case_gate_outstanding_obligations('$CASE',$GATE)) x
                where x->>'type'='procurement_package_late'")" = "1"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$GATE,\"p_outcome\":\"proceed\",\"p_note\":\"A proceed recorded while the mandatory motor is forecast 45 days after the project needs it.\",\"p_findings\":$FIND6A}")
grep -qi 'cannot pass while' <<<"$R"
grep -qi '45 day' <<<"$R"

# THE DISCHARGE IS A DATED RECEIPT, NEVER A TYPED STATUS. One planner with a
# ten-character basis used to move delivery_status to `received_and_inspected`
# and the blocker went from firing to silent while the recorded dates still said
# the motor was 45 days late — the gate review the wall had just refused was
# then accepted with nothing arrived. The status value is refused BY NAME.
R=$(rpc "$PLANNER" set_procurement_package_status "{\"p_package_id\":$P1,\"p_dimension\":\"delivery\",\"p_status\":\"received_and_inspected\",\"p_basis\":\"Motor received on site and inspected against the packing list and the FAT report\"}")
expect_err "$R" 'reaches `received_and_inspected` through record_package_delivery_receipt'
grep -qi 'not evidence that anything arrived' <<<"$R"
# …and the blocker is still firing, because nothing arrived.
test "$(psqlc "select count(*) from jsonb_array_elements(case_gate_outstanding_obligations('$CASE',$GATE)) x
                where x->>'type'='procurement_package_late'")" = "1"

# The receipt refuses a date in the future — a receipt records what happened.
R=$(rpc "$PLANNER" record_package_delivery_receipt "{\"p_package_id\":$P1,\"p_received_date\":\"$(psqlc "select (current_date + 30)::text")\",\"p_note\":\"Recording an arrival that has not happened yet, to see what is said\"}")
expect_err "$R" 'which is in the future'
R=$(rpc "$PLANNER" record_package_delivery_receipt "{\"p_package_id\":$P1,\"p_received_date\":\"$(psqlc "select current_date::text")\",\"p_note\":\"short\"}")
expect_err "$R" '20 characters minimum'

R=$(rpc "$PLANNER" record_package_delivery_receipt "{\"p_package_id\":$P1,\"p_received_date\":\"$(psqlc "select current_date::text")\",\"p_note\":\"Motor received on site and inspected against the packing list and the FAT report\"}")
noerr "$R"
# The motor arrived ahead of the date the project needed it, and the receipt
# says how far ahead rather than reporting a bare discharge.
test "$(printf '%s' "$R" | field daysLate)" = "-30"
test "$(psqlc "select actual_delivery_date is not null and delivery_status='received_and_inspected'
                 from contract_packages where id=$P1")" = "t"
test "$(psqlc "select count(*) from jsonb_array_elements(case_gate_outstanding_obligations('$CASE',$GATE)) x
                where x->>'type' like 'procurement_package_%'")" = "0"
# …and the delivery dimension is now frozen with its date: the two are one fact.
R=$(rpc "$PLANNER" set_procurement_package_status "{\"p_package_id\":$P1,\"p_dimension\":\"delivery\",\"p_status\":\"in_transit\",\"p_basis\":\"Putting the motor back on a truck after it was received\"}")
expect_err "$R" 'are one fact'
# A receipt happens once.
R=$(rpc "$PLANNER" record_package_delivery_receipt "{\"p_package_id\":$P1,\"p_received_date\":\"$(psqlc "select current_date::text")\",\"p_note\":\"Recording the same arrival a second time, to see what is said\"}")
expect_err "$R" 'A receipt happens once'

# A RECEIPT SETTLES THE LATENESS, IT DOES NOT ERASE IT. On a package the
# project needed ten days ago, the discharge says how late the thing was —
# the typed status it replaces said nothing at all.
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P6\",\"title\":\"Instrument air dryer\",\"equipment_or_scope\":\"One refrigerant instrument air dryer for the motor cooling package\",\"required_date\":\"$(psqlc "select (current_date - 10)::text")\",\"lead_time_days\":\"5\"}}")
noerr "$R"
P6=$(printf '%s' "$R" | field package_id); test -n "$P6"
R=$(rpc "$PLANNER" record_package_delivery_receipt "{\"p_package_id\":$P6,\"p_received_date\":\"$(psqlc "select current_date::text")\",\"p_note\":\"Dryer received on site and inspected against the packing list and the datasheet\"}")
noerr "$R"
test "$(printf '%s' "$R" | field daysLate)" = "10"
grep -qi 'discharged because the equipment is here, not because it was on time' <<<"$R"

echo "── 12. D6.05 — the commitment feeds Slice 4's ONE cost model ────────────"

# Before an award there is no contract to commit against.
R=$(rpc "$PLANNER" record_contract_commitment_line "{\"p_package_id\":$P3,\"p_line\":{\"line_ref\":\"L1\",\"cost_item_ref\":\"S6A-CI1\",\"description\":\"Spares\",\"basis\":\"Nothing has been awarded here\"}}")
expect_err "$R" 'is not awarded'

# The commitment position REFUSES over zero lines — that is not a commitment of
# zero, and the sentence says so.
R=$(rpc "$PLANNER" get_package_tender "{\"p_package_id\":$P1}")
test "$(jqp "$R" "x['commitment']['answered']")" = "False"
grep -qi 'not a commitment of zero' <<<"$R"

R=$(rpc "$PLANNER" record_contract_commitment_line "{\"p_package_id\":$P1,\"p_line\":{\"line_ref\":\"L1\",\"cost_item_ref\":\"S6A-NOPE\",\"description\":\"Motor supply\",\"basis\":\"Contract schedule 2, line 1\",\"amount\":\"500000\"}}")
expect_err "$R" 'does not exist on this contract'
R=$(rpc "$PLANNER" record_contract_commitment_line "{\"p_package_id\":$P1,\"p_line\":{\"line_ref\":\"L1\",\"cost_item_ref\":\"S6A-CI1\",\"description\":\"Motor supply\",\"basis\":\"Contract schedule 2, line 1\",\"amount\":\"NaN\"}}")
expect_err "$R" 'finite amount of at least zero'
R=$(rpc "$PLANNER" record_contract_commitment_line "{\"p_package_id\":$P1,\"p_line\":{\"line_ref\":\"L1\",\"cost_item_ref\":\"S6A-CI1\",\"description\":\"Motor supply\",\"basis\":\"Contract schedule 2, line 1\",\"amount\":\"-5\"}}")
expect_err "$R" 'finite amount of at least zero'

R=$(rpc "$PLANNER" record_contract_commitment_line "{\"p_package_id\":$P1,\"p_line\":{\"line_ref\":\"L1\",\"cost_item_ref\":\"S6A-CI1\",\"description\":\"Motor supply\",\"basis\":\"Contract schedule 2, line 1\",\"amount\":\"520000\"}}")
noerr "$R"
test "$(printf '%s' "$R" | field priced)" = "True"
# The UNPRICED line — a real state, kept as NULL rather than as zero.
R=$(rpc "$PLANNER" record_contract_commitment_line "{\"p_package_id\":$P1,\"p_line\":{\"line_ref\":\"L2\",\"cost_item_ref\":\"S6A-CI2\",\"description\":\"Installation supervision\",\"basis\":\"Contract schedule 2, line 2, rate to be agreed\"}}")
noerr "$R"
test "$(printf '%s' "$R" | field priced)" = "False"
grep -qi 'will REFUSE and name it' <<<"$R"

# THE TOTAL REFUSES AND NAMES THE LINE.
R=$(rpc "$PLANNER" get_package_tender "{\"p_package_id\":$P1}")
test "$(jqp "$R" "x['commitment']['answered']")" = "False"
grep -qi 'L2 (Installation supervision)' <<<"$R"
grep -qi 'understates it by exactly the amount nobody has agreed yet' <<<"$R"
# …and the approval refuses on the SAME predicate, not a second one.
R=$(rpc "$MANAGER" approve_contract_commitments "{\"p_package_id\":$P1,\"p_note\":\"Approving while one line still has no agreed amount.\"}")
expect_err "$R" 'L2 (Installation supervision)'

R=$(rpc "$PLANNER" record_contract_commitment_line "{\"p_package_id\":$P1,\"p_line\":{\"line_ref\":\"L2\",\"cost_item_ref\":\"S6A-CI2\",\"description\":\"Installation supervision\",\"basis\":\"Contract schedule 2, line 2, rate agreed at award +10 days\",\"amount\":\"120000\"}}")
noerr "$R"

# Committing MORE than the contract obliges is a change order, not a commitment.
# The mis-keyed line is CORRECTED rather than deleted: a line recorded against
# an awarded contract is not deletable (that is the wall doing its job, proven
# below), and correcting it is what actually happens.
R=$(rpc "$PLANNER" record_contract_commitment_line "{\"p_package_id\":$P1,\"p_line\":{\"line_ref\":\"L3\",\"cost_item_ref\":\"S6A-CI2\",\"description\":\"Commissioning spares\",\"basis\":\"Contract schedule 4, keyed at the list price by mistake\",\"amount\":\"200000\"}}")
noerr "$R"
R=$(rpc "$MANAGER" approve_contract_commitments "{\"p_package_id\":$P1,\"p_note\":\"Approving a total that exceeds what the contract obliges the owner to pay.\"}")
expect_err "$R" 'is a change order'
OUT=$(sql_must_fail "delete from contract_commitment_lines where package_id=$P1 and line_ref='L3';")
grep -qi 'recorded against an awarded contract' <<<"$OUT"
R=$(rpc "$PLANNER" record_contract_commitment_line "{\"p_package_id\":$P1,\"p_line\":{\"line_ref\":\"L3\",\"cost_item_ref\":\"S6A-CI2\",\"description\":\"Commissioning spares\",\"basis\":\"Corrected: free-issue under contract schedule 4 and carrying no charge\",\"amount\":\"0\"}}")
noerr "$R"
# A genuine ZERO is an agreed amount and is summed; it is the ABSENCE of an
# amount that refuses, and the two are not the same thing.
test "$(printf '%s' "$R" | field priced)" = "True"

# §70 at the approval door.
R=$(rpc "$AIBOT" approve_contract_commitments "{\"p_package_id\":$P1,\"p_note\":\"The machine approving the commitment and moving money in the controls model.\"}")
expect_err "$R" '§70 human act'
# …and at the table for every writer.
OUT=$(sql_must_fail "update contract_commitment_lines set approved_by='$AIBOT_ID', approved_at=now(),
  approval_note='Approved straight past the door by the AI-operator identity.' where package_id=$P1;")
grep -q 'AI-operator identity cannot approve a commitment' <<<"$OUT"

# SELF-APPROVAL: the planner recorded these lines, so the planner may not
# approve them. (Proven through a role that CAN approve but did record them.)
psqlc "update contract_commitment_lines set recorded_by='$MANAGER_ID' where package_id=$P1 and line_ref='L1';" >/dev/null
R=$(rpc "$MANAGER" approve_contract_commitments "{\"p_package_id\":$P1,\"p_note\":\"Approving commitment lines this same person recorded.\"}")
expect_err "$R" 'Approving your own commitment lines is not an approval'
psqlc "update contract_commitment_lines set recorded_by='$PLANNER_ID' where package_id=$P1 and line_ref='L1';" >/dev/null

BEFORE_C1=$(psqlc "select coalesce(commitment::text,'NULL') from project_cost_items where development_case_id='$CASE' and cost_item_ref='S6A-CI1'")
test "$BEFORE_C1" = "NULL"

R=$(rpc "$MANAGER" approve_contract_commitments "{\"p_package_id\":$P1,\"p_note\":\"Approved against contract schedule 2 as executed; both lines are firm.\"}")
noerr "$R"
test "$(printf '%s' "$R" | field total)" = "640000"
test "$(printf '%s' "$R" | field costLinesPosted)" = "2"
test "$(psqlc "select count(*) from contract_commitment_lines where package_id=$P1 and approved_at is not null")" = "3"

# THE ONE COST MODEL. project_cost_items.commitment moved — not a second total.
test "$(psqlc "select commitment from project_cost_items where development_case_id='$CASE' and cost_item_ref='S6A-CI1'")" = "520000"
test "$(psqlc "select commitment from project_cost_items where development_case_id='$CASE' and cost_item_ref='S6A-CI2'")" = "120000"
# …with an audit row per cost line carrying previous_state and new_state.
# Scoped to THIS run's case, not to the package CODE: audit_events is
# append-only and survives the case teardown, so a code-scoped count grows by
# two on every re-run and the assertion would pass once and then fail.
test "$(psqlc "select count(*) from audit_events where entity_type='project_cost_item'
                and event_data->>'action'='commitment_posted_from_contract'
                and event_data->>'case_id'='$CASE' and new_state->>'commitment' is not null")" = "2"
# An approved line is frozen and a posted line is not deleted.
OUT=$(sql_must_fail "update contract_commitment_lines set amount=1 where package_id=$P1 and line_ref='L1';")
grep -qi 'was approved on' <<<"$OUT"
OUT=$(sql_must_fail "delete from contract_commitment_lines where package_id=$P1 and line_ref='L1';")
grep -qi 'posted to the controls model' <<<"$OUT"
# …and the cost line it commits against cannot be deleted out from under it.
OUT=$(sql_must_fail "delete from project_cost_items where development_case_id='$CASE' and cost_item_ref='S6A-CI1';")
grep -qi 'committed money that no contract explains' <<<"$OUT"
OUT=$(sql_must_fail "truncate contract_commitment_lines cascade;")
grep -qi 'Not truncatable by any caller' <<<"$OUT"
# Approving again says everything is already approved rather than posting twice.
R=$(rpc "$MANAGER" approve_contract_commitments "{\"p_package_id\":$P1,\"p_note\":\"Approving a second time to see whether the figures move again.\"}")
expect_err "$R" 'already approved and posted'
test "$(psqlc "select commitment from project_cost_items where development_case_id='$CASE' and cost_item_ref='S6A-CI1'")" = "520000"

echo "── 13. D11.29 — the lineage run, recorded WITH its refusals ─────────────"

RUNS_BEFORE=$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE' and calculation_key='case_procurement_position'")
R=$(rpc "$PLANNER" compute_case_procurement_position "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(printf '%s' "$R" | field codeVersion)" = "develop-procurement/6A/2026-12-08"
RUN=$(printf '%s' "$R" | field calculationRunId); test -n "$RUN"
test "$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE' and calculation_key='case_procurement_position'")" -gt "$RUNS_BEFORE"
# The mandatory package it could not assess travelled into the run as a refusal.
test "$(psqlc "select status from calculation_runs where id='$RUN'")" = "computed_with_refusals"
test "$(psqlc "select count(*) from jsonb_array_elements(refusals) x where x->>'scope'='mandatory packages'
                from calculation_runs where id='$RUN'" 2>/dev/null || psqlc "select count(*) from calculation_runs r, jsonb_array_elements(r.refusals) x where r.id='$RUN' and x->>'scope'='mandatory packages'")" = "1"
# A REFUSING report records a run too — an absent lineage row on the refusing
# path is how a report that never ran becomes indistinguishable from one that
# ran clean.
R=$(rpc "$PLANNER" compute_case_procurement_position "{\"p_case_id\":\"$QUIET\"}")
test "$(printf '%s' "$R" | field answered)" = "False"
QRUN=$(printf '%s' "$R" | field calculationRunId); test -n "$QRUN"
test "$(psqlc "select status from calculation_runs where id='$QRUN'")" = "refused"
# A technician cannot mint lineage rows through it.
R=$(rpc "$TECH" compute_case_procurement_position "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'planning, engineering or governance role'

echo "── 14. cross-tenant: the foreign member sees none of it ─────────────────"

R=$(rpc "$FOREIGN" get_case_procurement "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'development case not found'
R=$(rpc "$FOREIGN" get_package_tender "{\"p_package_id\":$P1}")
expect_err "$R" 'procurement package not found'
test "$(psqlc "select jsonb_array_length(case_procurement_gate_obligations('$CASE', $GATE))")" = "0"
test "$(rest "$FOREIGN" "contract_packages?package_code=eq.S6A-P1&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")" = "0"
test "$(rest "$FOREIGN" "contract_bids?package_id=eq.$P1&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")" = "0"
test "$(rest "$FOREIGN" "bid_evaluations?package_id=eq.$P1&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")" = "0"
test "$(rest "$FOREIGN" "package_bidders?package_id=eq.$P1&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")" = "0"
test "$(rest "$FOREIGN" "contract_commitment_lines?package_id=eq.$P1&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")" = "0"
# A package filed under one tenant against another tenant's case is refused at
# the wall for EVERY writer.
OUT=$(sql_must_fail "insert into contract_packages (organization_id, package_code, title, development_case_id)
  values ('$ORG2','S6A-XT','Cross-tenant package','$CASE');")
grep -qi 'does not own its development case' <<<"$OUT"

echo "── 15. the anon boundary ────────────────────────────────────────────────"

for FN in get_case_procurement get_package_tender award_contract submit_sealed_bid open_package_bids record_bid_evaluation approve_contract_commitments record_procurement_package case_procurement_gate_obligations; do
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/$FN" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
  test "$CODE" = "404" || test "$CODE" = "401" || test "$CODE" = "403" \
    || { echo "anon reached $FN with $CODE"; exit 1; }
done
# sync_contract_award_authority takes an organization argument and is therefore
# not callable by ANY client role — the sync_change_authority posture.
test "$(psqlc "select count(*) from information_schema.role_routine_grants
                where routine_name='sync_contract_award_authority'
                  and grantee in ('authenticated','anon','service_role')")" = "0"
test "$(psqlc "select count(*) from information_schema.role_routine_grants
                where routine_name='contract_commitment_position'
                  and grantee in ('authenticated','anon','service_role')")" = "0"

echo "── 16. the adversarial pass: what an award can be rigged with ──────────"

# ─ THE AWARD IS FROZEN, FOR EVERY CALLER (the double award, the rewrite and the
#   laundering loop are one gap). Two overlapping award_contract calls each
#   returned a full success payload and two suppliers were each told they had
#   won at their own price; a service caller rewrote awarded_value 640000 -> 1
#   with the commitments still posted at 640000; and awarded_at -> NULL
#   re-opened the package for a second award under a different ceiling.
OUT=$(sql_must_fail "update contract_packages set awarded_value=1 where id=$P1;")
grep -qi 'is FROZEN for every caller' <<<"$OUT"
OUT=$(sql_must_fail "update contract_packages set awarded_at=null, awarded_by=null where id=$P1;")
grep -qi 'set back to unawarded can be made a second time under a different ceiling' <<<"$OUT"
OUT=$(sql_must_fail "update contract_packages set award_authority_limit_id=null where id=$P1;")
grep -qi 'under which delegated ceiling' <<<"$OUT"
# An award NAMES THE OFFER IT ACCEPTS, at the schema and not only at the door.
OUT=$(sql_must_fail "begin;
update contract_packages set awarded_at=now(), awarded_by='$MANAGER_ID', awarded_supplier_id=$SUP_A,
  awarded_value=1, contract_currency='CAD', contract_type='lump_sum',
  contract_start_date=current_date, contract_completion_date=current_date+1,
  performance_requirements='An award that names no offer at all, which is a purchase order',
  award_basis='An award naming no bid, to prove the schema holds the rule the door states'
  where id=$P3;
rollback;")
grep -qi 'contract_package_award_bid' <<<"$OUT"
# The winning SUPPLIER is not deleted out from under the contract, and the
# refusal is a sentence rather than a raw CHECK violation dumping the row.
OUT=$(sql_must_fail "delete from suppliers where id=$SUP_A;")
grep -qi 'holds the award on package' <<<"$OUT"
grep -qiv 'Failing row contains' <<<"$OUT"

# ─ THE §70 WALL DOES NOT ADMIT AN IDENTITY IT CANNOT RESOLVE. `select role
#   into v_role` over a uuid with no user_profiles row returns NULL,
#   `coalesce(NULL,'') = 'ai_admin'` is FALSE, and the function returned NEW —
#   so any AI or system account provisioned without a profile walked straight
#   through. The lookup was also unscoped, so ANOTHER TENANT's user was
#   accepted as the person who opened, scored or awarded, and get_package_tender
#   then rendered that foreign user's email as `awardedBy`.
OUT=$(sql_must_fail "begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000','44444444-4444-4444-8444-444444444444',
  'authenticated','authenticated','smoke6a-noprofile@syncai.ca','x', now(), now(), now(),
  '{}'::jsonb, '{}'::jsonb);
update contract_packages set bids_opened_by='44444444-4444-4444-8444-444444444444' where id=$P3;
rollback;")
grep -qi 'must be a member of the organization that owns this record' <<<"$OUT"
grep -qi 'admits every identity nobody registered' <<<"$OUT"
# …and a user of ANOTHER organization is refused on the same wall.
OUT=$(sql_must_fail "update contract_packages set bids_opened_by='$FOREIGN_ID' where id=$P3;")
grep -qi 'must be a member of the organization that owns this record' <<<"$OUT"
OUT=$(sql_must_fail "insert into bid_evaluations (organization_id, package_id, bid_id, evaluation_kind, evaluator_id, outcome, rationale)
  values ('$ORG',$P1,$BID_C,'commercial','$FOREIGN_ID','compliant','A foreign tenant scoring this organization''s bid');")
grep -qi 'must be a member of the organization that owns this record' <<<"$OUT"

# ─ THE SCOPE FREEZES AT THE OPEN ACT, NOT AT THE AWARD. Guarding only on
#   `awarded_at` left the window every bidder is exposed in: read the prices,
#   then rewrite the scope, the exclusions and the acceptance criteria so the
#   cheap non-compliant offer becomes the compliant one, then award it.
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P1\",\"title\":\"Mill motor\",\"equipment_or_scope\":\"One 4.2 MW synchronous mill motor WITHOUT the cooling package\",\"exclusions\":\"Excludes the cooling package and all site piping.\"}}")
expect_err "$R" 'is awarded'
# ─ THE §25 COMMERCIAL DIMENSION CANNOT BE MADE TO LIE ABOUT A SIGNED CONTRACT.
R=$(rpc "$PLANNER" set_procurement_package_status "{\"p_package_id\":$P1,\"p_dimension\":\"commercial\",\"p_status\":\"cancelled\",\"p_basis\":\"Cancelling a contract that is signed, funded and posted\"}")
expect_err "$R" 'holds an awarded contract'
grep -qi 'not a status edit' <<<"$R"
test "$(psqlc "select commercial_status from contract_packages where id=$P1")" = "awarded"

# ─ A CANCELLED MANDATORY PACKAGE WOULD BLOCK EVERY GATE FOR EVER, and the
#   wall's own remedy (award it) is the one thing left that cannot be done. So
#   the flag is released first, as its own twenty-character judgement.
R=$(rpc "$PLANNER" set_procurement_package_status "{\"p_package_id\":$P2,\"p_dimension\":\"commercial\",\"p_status\":\"cancelled\",\"p_basis\":\"Folding this scope into the main mechanical package\"}")
expect_err "$R" 'Release the mandatory flag first'
# …and releasing the flag is itself refused without a stated reason.
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P2\",\"title\":\"Switchgear\",\"equipment_or_scope\":\"One 11 kV switchgear lineup for the mill motor feeder\",\"is_mandatory\":false}}")
expect_err "$R" 'is its own judgement and states its own reason'
# OMITTING the flag leaves it exactly as it is — the cosmetic retitle that used
# to clear it, and with it a live gate blocker, with the payload recording
# `is_mandatory: false` as though the author had asked for it.
BLOCK_BEFORE=$(psqlc "select count(*) from jsonb_array_elements(case_procurement_gate_obligations('$CASE', null)) x where (x->>'id')::bigint=$P2")
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P2\",\"title\":\"Switchgear (rev B)\",\"equipment_or_scope\":\"One 11 kV switchgear lineup for the mill motor feeder\"}}")
noerr "$R"
test "$(printf '%s' "$R" | field isMandatory)" = "True"
test "$(psqlc "select is_mandatory and mandatory_basis is not null from contract_packages where id=$P2")" = "t"
test "$(psqlc "select count(*) from jsonb_array_elements(case_procurement_gate_obligations('$CASE', null)) x where (x->>'id')::bigint=$P2")" = "$BLOCK_BEFORE"
# Released WITH a reason, it is an act of its own in the ledger.
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P2\",\"title\":\"Switchgear (rev B)\",\"equipment_or_scope\":\"One 11 kV switchgear lineup for the mill motor feeder\",\"is_mandatory\":false,\"mandatory_release_basis\":\"The feeder is being energised from the existing spare cubicle, so this lineup is no longer on the critical path\"}}")
noerr "$R"
test "$(printf '%s' "$R" | field mandatoryReleased)" = "True"
test "$(psqlc "select count(*) from audit_events where entity_type='procurement_package'
                and event_data->>'package_id'='$P2' and event_data->>'action'='mandatory_released'")" = "1"
# …and NOW the cancellation is permitted, because nothing is left blocked on it.
R=$(rpc "$PLANNER" set_procurement_package_status "{\"p_package_id\":$P2,\"p_dimension\":\"commercial\",\"p_status\":\"cancelled\",\"p_basis\":\"Folding this scope into the main mechanical package\"}")
noerr "$R"
test "$(psqlc "select count(*) from jsonb_array_elements(case_procurement_gate_obligations('$CASE', null)) x where (x->>'id')::bigint=$P2")" = "0"

# ─ THE WRITE MARKER IS CLEARED. Granted before the door's own refusals and
#   never cleared, it left the wall open for the whole transaction: a direct
#   update that had just been refused went through, and
#   record_procurement_service_write — the only thing that makes a service-path
#   write findable afterwards — went silent with it.
TRACE_BEFORE=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like '%did not come through a definer RPC%'")
psqlc "begin;
select record_procurement_package('$CASE'::uuid, '{\"package_code\":\"S6A-P1\",\"title\":\"Rewriting an awarded package\",\"equipment_or_scope\":\"An edit that the door refuses, leaving the marker behind it\"}'::jsonb);
update contract_packages set title='pushed through behind a refused call' where id=$P3;
commit;" >/dev/null
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like '%did not come through a definer RPC%'")" -gt "$TRACE_BEFORE"

# ─ THE BIDDER REGISTER HAS A WALL. It shipped with no triggers at all: it was
#   truncatable, service-deletable with no security_events row, and a row
#   stamped with one tenant against another's package inserted cleanly and was
#   then READ by the foreign tenant.
OUT=$(sql_must_fail "truncate package_bidders cascade;")
grep -qi 'Not truncatable by any caller' <<<"$OUT"
OUT=$(sql_must_fail "delete from package_bidders where package_id=$P1;")
grep -qi 'is not deleted' <<<"$OUT"
OUT=$(sql_must_fail "insert into package_bidders (organization_id, package_id, supplier_id)
  values ('$ORG2', $P1, $SUP_A);")
grep -qi 'does not own its procurement package' <<<"$OUT"
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$PLANNER_ID', true);
insert into package_bidders (organization_id, package_id, supplier_id) values ('$ORG',$P3,$SUP_A);
rollback;")
grep -qi 'bypassing row-level security' <<<"$OUT"

# ─ THE TWO EVALUATIONS ARE TWO PEOPLE. `unique (bid_id, evaluation_kind)` was
#   the only cross-evaluation rule, so one person held both scores on a bid and
#   award_contract treated it as fully evaluated.
R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_C,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"compliant\",\"rationale\":\"Meets the specification on every clause, at a price nobody would pay\"}}")
noerr "$R"
R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_C,\"p_evaluation\":{\"evaluation_kind\":\"commercial\",\"outcome\":\"compliant\",\"rationale\":\"The same person scoring the commercial side of a bid they already passed\"}}")
expect_err "$R" 'already recorded the technical evaluation of this bid'
# …and at the TABLE for every writer, not only at the door.
OUT=$(sql_must_fail "insert into bid_evaluations (organization_id, package_id, bid_id, evaluation_kind, evaluator_id, outcome, rationale)
  values ('$ORG',$P1,$BID_C,'commercial','$ENGINEER_ID','compliant','A service-path second score by the same evaluator');")
grep -qi 'separate judgements by separate people' <<<"$OUT"

echo "── 17. the tender window, the seal and the money ────────────────────────"

# ─ A LIVE TENDER'S CLOSE IS NOT PULLED FORWARD, and a re-issue is its own act.
CLOSE4=$(psqlc "select (now() + interval '4 hour')::text")
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P4\",\"title\":\"Cooling pumps\",\"equipment_or_scope\":\"Two motor cooling water pumps with their local control panels\",\"scope_of_work\":\"Supply, deliver and commission two cooling water pumps with local control panels\",\"acceptance_criteria\":\"Witnessed performance test at duty point and a 4-hour run at site\",\"required_date\":\"$REQ\",\"lead_time_days\":\"30\",\"is_mandatory\":true,\"mandatory_basis\":\"The motor cannot be run without its cooling water and no temporary skid is available\"}}")
noerr "$R"
P4=$(printf '%s' "$R" | field package_id); test -n "$P4"
R=$(rpc "$PLANNER" open_package_bidding "{\"p_package_id\":$P4,\"p_close_at\":\"$CLOSE4\"}")
noerr "$R"
test "$(printf '%s' "$R" | field reissued)" = "False"
R=$(rpc "$PLANNER" invite_package_bidder "{\"p_package_id\":$P4,\"p_supplier_id\":$SUP_A,\"p_prequalification_basis\":\"Supplied the same pump frame on the 2024 concentrator inside its promised window\"}")
noerr "$R"
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P4,\"p_bid\":{\"supplier_code\":\"S6A-SA\",\"price\":\"90000\",\"currency\":\"CAD\",\"assumed_productivity_factor\":\"1.0\"}}")
noerr "$R"
BID_P4=$(printf '%s' "$R" | field bid_id); test -n "$BID_P4"
R=$(rpc "$PLANNER" open_package_bidding "{\"p_package_id\":$P4,\"p_close_at\":\"$(psqlc "select (now() + interval '1 second')::text")\"}")
expect_err "$R" 'A close is extended, not shortened'
# Extending it is permitted, and the ledger records a RE-ISSUE rather than a
# second `issued`.
R=$(rpc "$PLANNER" open_package_bidding "{\"p_package_id\":$P4,\"p_close_at\":\"$(psqlc "select (now() + interval '8 hour')::text")\"}")
noerr "$R"
test "$(printf '%s' "$R" | field reissued)" = "True"
test "$(psqlc "select count(*) from audit_events where entity_type='procurement_tender'
                and event_data->>'package_id'='$P4' and event_data->>'action'='reissued'")" = "1"

# ─ A BID IS WITHDRAWN BEFORE THE CLOSE, NOT AFTER IT. The function contained no
#   reference to bids_close_at at all: a bid could be pulled out of a CLOSED
#   tender in the window before the opening, and because one bidder holds one
#   row per package that bidder could never re-lodge.
R=$(rpc "$PLANNER" withdraw_sealed_bid "{\"p_bid_id\":$BID_P4,\"p_reason\":\"Withdrawn well before the close, which is permitted\"}")
noerr "$R"
psqlc "update contract_packages set bids_close_at = now() - interval '1 minute' where id=$P4;" >/dev/null
R=$(rpc "$PLANNER" invite_package_bidder "{\"p_package_id\":$P4,\"p_supplier_id\":$SUP_B,\"p_prequalification_basis\":\"Invited so the post-close withdrawal refusal can be proven on a live bid\"}")
noerr "$R"
psqlc "update contract_packages set bids_close_at = now() + interval '2 hour' where id=$P4;" >/dev/null
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P4,\"p_bid\":{\"supplier_code\":\"S6A-SB\",\"price\":\"95000\",\"currency\":\"CAD\",\"assumed_productivity_factor\":\"1.0\"}}")
noerr "$R"
BID_P4B=$(printf '%s' "$R" | field bid_id); test -n "$BID_P4B"
psqlc "update contract_packages set bids_close_at = now() - interval '1 minute' where id=$P4;" >/dev/null
R=$(rpc "$PLANNER" withdraw_sealed_bid "{\"p_bid_id\":$BID_P4B,\"p_reason\":\"Removing the inconvenient bid after the deadline has passed\"}")
expect_err "$R" 'withdrawn before the close, not after it'

# ─ THE SEAL ASKS ONE QUESTION. The row policy asked "does this ROW carry a
#   seal?" while the definer read asked "is this PACKAGE open?", so any bid that
#   reached the table unsealed — the admitted service path, an import — was
#   fully readable by every client on a live tender. Proven with a bid inserted
#   the way the service path inserts one.
psqlc "insert into contract_bids (organization_id, package_id, supplier_id, price, currency, submitted_on)
       values ('$ORG',$P4,$SUP_C,111111,'CAD',current_date);" >/dev/null
test "$(rest "$PLANNER" "contract_bids?package_id=eq.$P4&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")" = "0"
test "$(psqlc "select count(*) from contract_bids where package_id=$P4")" = "3"
# …and the pre-existing /materials read says what it cannot see rather than
# returning a short list as a complete one.
R=$(rpc "$PLANNER" get_package_bids "{\"p_package_code\":\"S6A-P4\"}")
test "$(printf '%s' "$R" | field tenderSealed)" = "True"
test "$(printf '%s' "$R" | field withheldBidCount)" = "3"
grep -qi 'an empty one here is not a tender nobody entered' <<<"$R"

# ─ A PACKAGE NOBODY TENDERED IS NOT "SEALED", and an empty bid list refuses
#   rather than reading as a tender that ran.
R=$(rpc "$PLANNER" get_package_tender "{\"p_package_id\":$P3}")
test "$(printf '%s' "$R" | field sealed)" = "False"
test "$(printf '%s' "$R" | field tendered)" = "False"
grep -qi 'has not been issued for tender, so there are no envelopes' <<<"$R"

# ─ THE AWARD CEILING IS CUMULATIVE (4D-R8). One manager under a single adopted
#   CAD 750,000 delegation awarded 640,000 + 640,000 + 200,000 on ONE case,
#   every award individually "within authority".
psqlc "update contract_packages set bids_opened_at=now(), bids_opened_by='$EXEC_ID', commercial_status='bids_received' where id=$P4;" >/dev/null
R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_P4B,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"compliant\",\"rationale\":\"Pump curve meets the duty point with margin at the stated speed\"}}")
noerr "$R"
R=$(rpc "$EXEC" record_bid_evaluation "{\"p_bid_id\":$BID_P4B,\"p_evaluation\":{\"evaluation_kind\":\"commercial\",\"outcome\":\"compliant\",\"rationale\":\"Price and payment terms are acceptable as offered against the schedule\"}}")
noerr "$R"
# A second award on the same case is checked against what this awarder has
# ALREADY committed here, and reports it.
LATE_FINISH=$(psqlc "select (current_date + 60)::text")
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P4,\"p_award\":{\"bid_id\":\"$BID_P4B\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Deliver two cooling pumps to the witnessed duty-point performance test\",\"award_basis\":\"A second award on the same case, inside the cumulative delegation ceiling\",\"contract_start_date\":\"$START\",\"contract_completion_date\":\"$LATE_FINISH\"}}")
noerr "$R"
test "$(printf '%s' "$R" | field alreadyAwardedOnCase)" = "640000"
# THE FIELD THIS AWARD WAS CHOSEN FROM WAS NOT ALL ASSESSED. Both evaluation
# checks are scoped to the NOMINATED bid, so a tender can be awarded with the
# other live offers never opened for assessment — no refusal and, until now,
# nothing said. It does not refuse (a non-responsive field is a real state) but
# it is named in the response and written into the award audit row.
grep -qi 'live bid(s) on S6A-P4 carried NO evaluation at all' <<<"$R"
test "$(psqlc "select count(*) from audit_events where entity_type='contract_award'
                and event_data->>'package_id'='$P4'
                and new_state->>'unevaluatedLiveBids' is not null")" = "1"

# ─ THE CONTRACT THAT CANNOT DELIVER ON TIME BY ITS OWN TERMS. Legs 1 and 2 both
#   went quiet the moment anything was awarded and leg 2 needed a forecast
#   nobody is required to record, so "mandatory, awarded, contract completing
#   after the date the project needs it" raised NOTHING and the screen reported
#   the package as assessable and clean. §24 makes contract_completion_date
#   mandatory on every awarded package, so this evidence is always there.
test "$(psqlc "select count(*) from jsonb_array_elements(case_procurement_gate_obligations('$CASE', null)) x
                where x->>'type'='procurement_package_contract_late' and (x->>'id')::bigint=$P4")" = "1"
grep -qi 'cannot deliver on time by its own terms' <<<"$(psqlc "select case_procurement_gate_obligations('$CASE', null)::text")"
# …and it rides the SAME wall, for a caller with RLS switched off.
test "$(psqlc "select count(*) from jsonb_array_elements(case_gate_outstanding_obligations('$CASE',$GATE)) x
                where x->>'type'='procurement_package_contract_late'")" = "1"
OUT=$(sql_must_fail "insert into stage_gate_reviews (organization_id, development_case_id, gate_id, outcome, reviewed_by, note)
  values ('$ORG','$CASE',$GATE,'proceed','$MANAGER_ID','A proceed recorded while a mandatory contract cannot deliver on time by its own terms');")
grep -qi 'cannot pass while' <<<"$OUT"
# The dated receipt discharges it, as it does the other two legs.
R=$(rpc "$PLANNER" record_package_delivery_receipt "{\"p_package_id\":$P4,\"p_received_date\":\"$(psqlc "select current_date::text")\",\"p_note\":\"Both cooling pumps received on site and inspected against the packing list\"}")
noerr "$R"
test "$(psqlc "select count(*) from jsonb_array_elements(case_procurement_gate_obligations('$CASE', null)) x
                where (x->>'id')::bigint=$P4")" = "0"

# ─ AND NOW THE CEILING. 640,000 + 95,000 stands against a 750,000 delegation,
#   so a third award on the same case is refused CUMULATIVELY — the 4D-R8 rule
#   this slice shipped without. One manager awarded 1,480,000 on one case,
#   every award individually "within authority".
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P5\",\"title\":\"Lubrication skid\",\"equipment_or_scope\":\"One lubrication oil skid with duty and standby pumps\",\"scope_of_work\":\"Supply, deliver and commission the lubrication oil skid complete with its coolers\",\"acceptance_criteria\":\"Witnessed flow and pressure test at the vendor works before despatch\",\"required_date\":\"$REQ\",\"lead_time_days\":\"20\"}}")
noerr "$R"
P5=$(printf '%s' "$R" | field package_id); test -n "$P5"
R=$(rpc "$PLANNER" open_package_bidding "{\"p_package_id\":$P5,\"p_close_at\":\"$(psqlc "select (now() + interval '2 hour')::text")\"}")
noerr "$R"
R=$(rpc "$PLANNER" invite_package_bidder "{\"p_package_id\":$P5,\"p_supplier_id\":$SUP_A,\"p_prequalification_basis\":\"Supplied the lubrication skid on the 2023 mill, commissioned without a defect\"}")
noerr "$R"
R=$(rpc "$PLANNER" submit_sealed_bid "{\"p_package_id\":$P5,\"p_bid\":{\"supplier_code\":\"S6A-SA\",\"price\":\"200000\",\"currency\":\"CAD\",\"assumed_productivity_factor\":\"1.0\"}}")
noerr "$R"
BID_P5=$(printf '%s' "$R" | field bid_id); test -n "$BID_P5"
psqlc "update contract_packages set bids_close_at = now() - interval '1 minute' where id=$P5;" >/dev/null
R=$(rpc "$MANAGER" open_package_bids "{\"p_package_id\":$P5,\"p_note\":\"Opened in the presence of the project manager and the contracts lead; one envelope.\"}")
noerr "$R"
R=$(rpc "$ENGINEER" record_bid_evaluation "{\"p_bid_id\":$BID_P5,\"p_evaluation\":{\"evaluation_kind\":\"technical\",\"outcome\":\"compliant\",\"rationale\":\"Skid meets the flow and pressure duty with the specified duty-standby arrangement\"}}")
noerr "$R"
R=$(rpc "$EXEC" record_bid_evaluation "{\"p_bid_id\":$BID_P5,\"p_evaluation\":{\"evaluation_kind\":\"commercial\",\"outcome\":\"compliant\",\"rationale\":\"Price and payment terms are acceptable against the schedule as offered\"}}")
noerr "$R"
R=$(rpc "$MANAGER" award_contract "{\"p_package_id\":$P5,\"p_award\":{\"bid_id\":\"$BID_P5\",\"contract_type\":\"lump_sum\",\"performance_requirements\":\"Deliver the lubrication skid to the witnessed flow and pressure test at the works\",\"award_basis\":\"A third award on the same case, splitting one procurement across packages\",\"contract_start_date\":\"$START\",\"contract_completion_date\":\"$FINISH\"}}")
expect_err "$R" 'already awarded'
grep -qi 'not what you may commit per contract' <<<"$R"
grep -qi 'splitting a procurement across two packages is not a way through it' <<<"$R"
test "$(psqlc "select awarded_at is null from contract_packages where id=$P5")" = "t"

# …and S6A-P5's scope is FROZEN anyway, because its envelopes are open. The
# guard was on `awarded_at` alone, which left the window every bidder is
# exposed in: read the prices, then rewrite the scope, the exclusions and the
# acceptance criteria so the cheap non-compliant offer becomes the compliant
# one, then award it.
R=$(rpc "$PLANNER" record_procurement_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S6A-P5\",\"title\":\"Lubrication skid\",\"equipment_or_scope\":\"Lubrication skid WITHOUT coolers, pumps only\",\"exclusions\":\"Excludes coolers and all site piping.\",\"acceptance_criteria\":\"Rewritten after the prices became legible, which is the point\"}}")
expect_err "$R" 'frozen from the moment the prices became legible'

# ─ THE COMMITMENT IS NOT COMPARED TO THE CONTRACT ACROSS CURRENCIES, and the
#   `commitment` column on the cost line has ONE writer.
test "$(psqlc "select count(*) from pg_trigger where tgrelid='project_cost_items'::regclass
                and tgname='trg_cost_item_contract_commitment'")" = "1"
OUT=$(sql_must_fail "update project_cost_items set commitment = 1
        where development_case_id='$CASE' and cost_item_ref='S6A-CI1';")
grep -qi 'of APPROVED contract commitment from contract' <<<"$OUT"
# An OMITTED commitment is not a clearance: the cosmetic cost-line edit that
# used to wipe a posted 640,000 leaves it exactly where the contract put it.
R=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"S6A-CI1\",\"description\":\"Mill motor supply (corrected description)\",\"basis\":\"Re-typed to correct a spelling mistake and nothing else\",\"wbs_code\":\"1\",\"cbs_code\":\"S6A-C100\"}}")
noerr "$R"
test "$(psqlc "select commitment from project_cost_items where development_case_id='$CASE' and cost_item_ref='S6A-CI1'")" = "520000"

echo
echo "Develop slice-6a smoke PASSED"

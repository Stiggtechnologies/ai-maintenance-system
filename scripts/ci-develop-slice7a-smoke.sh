#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 7A — Advanced Work Packaging: the typed EWP → PWP → CWP →
# IWP chain enforced at the DATABASE, the §27 WorkPackage on the canonical work
# identity, the §28 Constraint on the canonical constraint store, and a
# FORWARD-LOOKING burn-down that is recorded rather than recomputed. Every step
# is a live transcript against a real local database, run TWICE in a row on one
# database before it was committed.
#
# Steps:
#   0  fixtures: a case, its WBS, four work orders, a foreign tenant.
#   1  D7.17 §27 — the package: the five types, and the refusals (a sixth
#      type, a label with no scope, a package with no code).
#   2  D7.10 II.4 — THE CHAIN, at the database: a head with a parent, a
#      non-head without one, a SKIPPED LEVEL, a WRONG-TYPED PARENT, a
#      cross-case parent and a direct client write, each refused by name.
#   3  D7.17 — membership: work_orders is untouched, another tenant's work
#      order refused, a duplicate refused, an unexplained one refused.
#   4  D7.18 §28 — all TEN spec types map onto the canonical store, an
#      eleventh is refused, and a constraint on work the package does not
#      contain is refused.
#   5  D7.18 × §70 — the AI identity cannot close a constraint through the
#      door OR by direct write; permit and isolation cannot be hand-cleared
#      at all; satisfied without a verifier is impossible.
#   6  D7.07 I.28 — the FORWARD burn-down: refused over an unassessed package,
#      over an already-clear set, over a window nothing is dated into, and
#      over a horizon that projects nothing; the four forecast buckets; the
#      projected constraint-free date REFUSED over a partly-forecast set; and
#      every non-finite, out-of-range and unsourced number refused.
#   7  D7.07 — RECORDED, not recomputed: two runs recorded, refusals recorded
#      as runs, the history read back verbatim, and a recorded run that no
#      client can update, delete or truncate.
#   8  D7.06/D7.17 × §70 — the release: refused over an unassessed package, an
#      empty one, an unreleased parent and open hard constraints (named);
#      refused for the AI identity; granted; then frozen for every writer.
#   9  cross-tenant: a foreign member sees no package, no membership and no
#      constraint.
#  10  the ledgers are untruncatable, the §34 edge is closed at the column the
#      5D audit named, and the case read refuses a case with no packages.
#  11  the repair pass: a LAPSED forecast is not a clearance and produces no
#      date in the past; the blocking impact is the impact of what BLOCKS; ONE
#      verdict — the screen's readiness sentence is compared, character for
#      character, with the door's refusal for the same package in five states;
#      the chain validated DOWNWARD; a package code already used on another
#      case refused rather than MOVING that package; one job refused in two
#      same-level packages; the cancellation the refusals name; a released
#      package's constraints and membership frozen on UPDATE as well as
#      DELETE, with a DETACH recorded; every bad input answered with a
#      refusal rather than a raw Postgres error; the §70 verifier wall's SCOPE
#      proven against Recovery's own caller — the AI identity that
#      `refresh_restoration_readiness` admits still completes it, while the
#      same identity is still refused on this slice's package-anchored rows;
#      and a SOFT-ONLY open set naming its reason instead of printing a blank.
#
# Run: supabase start && scripts/ci-develop-slice7a-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-7a smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
ORG2='7a000000-0000-4000-8000-7a000000000a'

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
expect_refusal(){ BODY="$1" NEEDLE="$2" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if not isinstance(x,dict) or x.get('answered') is not False:
    print('expected an unanswered refusal, got:',x); sys.exit(1)
if os.environ['NEEDLE'].lower() not in str(x.get('refusal','')).lower():
    print('expected refusal containing %r, got: %s' % (os.environ['NEEDLE'], x)); sys.exit(1)
PY
}
expect_text(){ HAY="$1" NEEDLE="$2" python3 - <<'PY'
import os,sys
if os.environ['NEEDLE'].lower() not in os.environ['HAY'].lower():
    print('expected text containing %r, got: %s' % (os.environ['NEEDLE'], os.environ['HAY'][:600])); sys.exit(1)
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
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$EXEC"; test -n "$ENGINEER"; test -n "$TECH"

PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
test -n "$PLANNER_ID"; test -n "$MANAGER_ID"

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
declare v_uid uuid := '7a7a7a7a-7777-4777-8777-7a7a7a7a7a7a';
        v_org uuid := '7a000000-0000-4000-8000-7a000000000a';
begin
  insert into organizations (id, name) values (v_org, 'S7A foreign tenant')
    on conflict (id) do nothing;
  if not exists (select 1 from auth.users where email = 'smoke7a-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke7a-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'S7A foreign member'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  if not exists (select 1 from auth.identities where user_id = v_uid) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke7a-foreign@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_uid, v_org, 'smoke7a-foreign@syncai.ca', 'maintenance_manager')
  on conflict (id) do update set organization_id = v_org, role = 'maintenance_manager';
end $seed$;
PSQL
FOREIGN=$(token 'smoke7a-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGN"

# ── Idempotent re-run. Fixture keys are kept SHORT on purpose — long fixture
#    identifiers have been read as secrets by the repository's scanner and have
#    blocked merges.
#
#    A RELEASED package refuses deletion while its case exists, and so do its
#    constraints and its membership rows. That is the product working, so this
#    teardown does what the product allows: it deletes the CASES, and every one
#    of those rows goes with them through the declared cascades each wall
#    admits mid-cascade. Nothing here deletes something the product forbids
#    deleting.
psqlc "delete from development_cases where organization_id='$ORG' and title like 'S7A %';" >/dev/null
psqlc "delete from development_cases where organization_id='$ORG2' and title like 'S7A %';" >/dev/null
psqlc "delete from work_orders where organization_id='$ORG' and wo_number like 'S7A-%';" >/dev/null
psqlc "delete from work_orders where organization_id='$ORG2' and wo_number like 'S7A-%';" >/dev/null
psqlc "delete from work_packages where organization_id='$ORG' and package_code like 'S7A-%';" >/dev/null
test "$(psqlc "select count(*) from work_packages where organization_id='$ORG' and package_code like 'S7A-%'")" = "0"
test "$(psqlc "select count(*) from work_orders where organization_id='$ORG' and wo_number like 'S7A-%'")" = "0"

echo "── 0. fixtures: a case, its WBS and four work orders ────────────────────"

R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S7A work packaging case\",\"p_problem_statement\":\"The mill drive replacement is planned as a list of work orders and nothing records which of them travel together, what has to be true before each set can start, or when the things that are not true will become true.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE=$(printf '%s' "$R" | field case_id); test -n "$CASE"

R=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1\",\"title\":\"Mill drive\",\"scope_description\":\"Everything inside the mill drive replacement as scoped for the slice 7A transcript\"}}")
noerr "$R"

# A SECOND case, so a cross-case parent has a real row to be refused against.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S7A neighbouring case\",\"p_problem_statement\":\"A separate development case on the same site, used here only so a cross-case AWP parent has a genuine package to point at rather than an invented identifier.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE2=$(printf '%s' "$R" | field case_id); test -n "$CASE2"

psqlc "insert into work_orders (organization_id, wo_number, title, status)
       values ('$ORG','S7A-W1','Remove the existing mill drive','pending'),
              ('$ORG','S7A-W2','Install the replacement drive','pending'),
              ('$ORG','S7A-W3','Align and grout the base','pending'),
              ('$ORG','S7A-W4','Commission the drive','pending');" >/dev/null
W1=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7A-W1'")
W2=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7A-W2'")
W3=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7A-W3'")
W4=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7A-W4'")
test -n "$W1"; test -n "$W2"; test -n "$W3"; test -n "$W4"

# A work order in the FOREIGN tenant, so "another tenant's work" is a real row.
psqlc "insert into work_orders (organization_id, wo_number, title, status)
       values ('$ORG2','S7A-F1','Foreign tenant work order','pending');" >/dev/null
WF=$(psqlc "select id from work_orders where organization_id='$ORG2' and wo_number='S7A-F1'")
test -n "$WF"

echo "── 1. D7.17 §27 — the WorkPackage, five types, and what it refuses ──────"

# The head of the chain.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-E1\",\"title\":\"Mill drive engineering\",\"package_type\":\"engineering\",\"scope\":\"Issue the drive general arrangement, the base design and the electrical single line\",\"wbs_code\":\"1\",\"required_by\":\"$(psqlc "select (current_date + 60)::text")\"}}")
noerr "$R"; E1=$(printf '%s' "$R" | field work_package_id); test -n "$E1"
test "$(printf '%s' "$R" | field level)" = "1"

# A sixth type does not exist.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-X\",\"title\":\"Field execution\",\"package_type\":\"field_execution\",\"scope\":\"Whatever the crew does on the day, which is not one of the five\"}}")
expect_err "$R" "five §27 types"

# A package with no scope statement is a label.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-E2\",\"title\":\"Label only\",\"package_type\":\"engineering\",\"scope\":\"drive work\"}}")
expect_err "$R" "scope statement"

R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"title\":\"No code\",\"package_type\":\"engineering\",\"scope\":\"A scope statement that is long enough to pass the door\"}}")
expect_err "$R" "package code"

echo "── 2. D7.10 II.4 — the typed chain, at the DATABASE ─────────────────────"

# THE HEAD HANGS FROM NOTHING.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-E9\",\"title\":\"Second engineering package\",\"package_type\":\"engineering\",\"scope\":\"An engineering package that wrongly names a parent above it in the chain\",\"parent_package_code\":\"S7A-E1\"}}")
expect_err "$R" "head of the AWP chain"

# A NON-HEAD MUST HAVE ONE.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-P9\",\"title\":\"Orphan procurement\",\"package_type\":\"procurement\",\"scope\":\"A procurement package with nothing planned above it in the chain\"}}")
expect_err "$R" "must hang from a engineering package"

# A SKIPPED LEVEL: construction under engineering.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-C9\",\"title\":\"Skipped level\",\"package_type\":\"construction\",\"scope\":\"A construction package hung straight off engineering, skipping procurement\",\"parent_package_code\":\"S7A-E1\"}}")
expect_err "$R" "SKIPPED-LEVEL"

# The real chain: E1 → P1 → C1 → I1 → M1.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-P1\",\"title\":\"Mill drive procurement\",\"package_type\":\"procurement\",\"scope\":\"Buy the drive, the base steel and the grout to the issued engineering\",\"parent_package_code\":\"S7A-E1\"}}")
noerr "$R"; P1=$(printf '%s' "$R" | field work_package_id); test -n "$P1"
test "$(printf '%s' "$R" | field level)" = "2"

R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-C1\",\"title\":\"Mill drive civils\",\"package_type\":\"construction\",\"scope\":\"Break out the existing plinth and pour the new base to the issued design\",\"parent_package_code\":\"S7A-P1\"}}")
noerr "$R"; C1=$(printf '%s' "$R" | field work_package_id); test -n "$C1"

# A WRONG-TYPED PARENT: installation under procurement (level 4 under level 2).
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-I9\",\"title\":\"Wrong parent\",\"package_type\":\"installation\",\"scope\":\"An installation package hung off procurement rather than off construction\",\"parent_package_code\":\"S7A-P1\"}}")
expect_err "$R" "WRONG-PARENT"

R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-I1\",\"title\":\"Mill drive installation\",\"package_type\":\"installation\",\"scope\":\"Set, align and grout the drive on the completed base and terminate it\",\"parent_package_code\":\"S7A-C1\",\"required_by\":\"$(psqlc "select (current_date + 120)::text")\"}}")
noerr "$R"; I1=$(printf '%s' "$R" | field work_package_id); test -n "$I1"
test "$(printf '%s' "$R" | field level)" = "4"

R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-M1\",\"title\":\"Mill drive commissioning\",\"package_type\":\"commissioning\",\"scope\":\"Run the drive on no load and then on load against the acceptance criteria\",\"parent_package_code\":\"S7A-I1\"}}")
noerr "$R"; M1=$(printf '%s' "$R" | field work_package_id); test -n "$M1"
test "$(printf '%s' "$R" | field level)" = "5"

# A CROSS-CASE PARENT. The neighbouring case gets its own engineering head, and
# a procurement package on THIS case may not hang from it.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE2\",\"p_package\":{\"package_code\":\"S7A-E2X\",\"title\":\"Neighbouring engineering\",\"package_type\":\"engineering\",\"scope\":\"The neighbouring case's own engineering package, on its own development case\"}}")
noerr "$R"; E2X=$(printf '%s' "$R" | field work_package_id); test -n "$E2X"
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-PX\",\"title\":\"Cross-case child\",\"package_type\":\"procurement\",\"scope\":\"A procurement package trying to hang from another development case's engineering\",\"parent_package_code\":\"S7A-E2X\"}}")
expect_err "$R" "another organization or another development case"

# ── THE CHAIN IS VALIDATED DOWNWARD TOO. Everything above validates a row
#    against its PARENT, which on INSERT is the whole rule — a new row has no
#    children. On UPDATE it is not: re-typing a package that ALREADY HAS
#    CHILDREN leaves them holding a parent of the wrong type at the wrong
#    level, verbatim the SKIPPED-LEVEL state refused above, reached in two
#    ordinary steps through the revise branch. S7A-C1 (construction) hangs
#    from S7A-P1, so S7A-P1 cannot become an engineering package while it does.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-P1\",\"title\":\"Mill drive procurement\",\"package_type\":\"engineering\",\"scope\":\"Re-typing a middle package to the head type while a construction package hangs from it\"}}")
expect_err "$R" "has children and cannot be re-typed"
# The chain it protects is unchanged — nothing was half-written.
test "$(psqlc "select package_type from work_packages where organization_id='$ORG' and package_code='S7A-P1'")" = "procurement"
test "$(psqlc "select parent_package_id from work_packages where organization_id='$ORG' and package_code='S7A-C1'")" = "$P1"

# ── A PACKAGE CODE ALREADY IN USE ON ANOTHER CASE. Codes are unique per
#    ORGANIZATION, not per case, and the revise branch writes the case — so
#    recording "S7A-P1" on the neighbouring case did not refuse and did not
#    create: it MOVED this case's package, with its constraints, its work and
#    its release state, out of the case whose people are working to it, and
#    left this case naming a parent its own people could not open. "EWP-01" on
#    two projects is the default naming, not an exotic input.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE2\",\"p_package\":{\"package_code\":\"S7A-P1\",\"title\":\"Same code on the neighbouring case\",\"package_type\":\"engineering\",\"scope\":\"A package on the neighbouring case reusing a code that already belongs to this one\"}}")
expect_err "$R" "already belongs to another development case"
test "$(psqlc "select development_case_id from work_packages where organization_id='$ORG' and package_code='S7A-P1'")" = "$CASE"

# THE CHAIN IS AT THE DATABASE, not only in the door: a direct client write is
# refused, and so is a skipped level written as the table owner.
OUT=$(sql_must_fail "set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','$PLANNER_ID','role','authenticated')::text, false);
insert into work_packages (organization_id, development_case_id, package_code, title, package_type, scope)
values ('$ORG','$CASE','S7A-DIRECT','Direct','engineering','A package written straight into the table with no door at all');")
expect_text "$OUT" "record_work_package"

OUT=$(sql_must_fail "insert into work_packages (organization_id, development_case_id, package_code, title, package_type, scope, parent_package_id)
values ('$ORG','$CASE','S7A-OWNER','Owner write','installation','A skipped level written as the table owner, with the marker set', $P1);")
expect_text "$OUT" "WRONG-PARENT"

echo "── 3. D7.17 — membership: the package REFERENCES work_orders ────────────"

R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$I1,\"p_work_order_id\":\"$W2\",\"p_basis\":\"Setting the drive is the physical installation this package exists to release\"}")
noerr "$R"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$I1,\"p_work_order_id\":\"$W3\",\"p_basis\":\"Alignment and grouting complete the same installation and share its access window\"}")
noerr "$R"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$C1,\"p_work_order_id\":\"$W1\",\"p_basis\":\"Removing the existing drive is civils scope and precedes the new base pour\"}")
noerr "$R"

# The work order itself is untouched: work_orders IS the work identity.
test "$(psqlc "select status from work_orders where id='$W2'")" = "pending"
test "$(psqlc "select count(*) from work_package_work where work_package_id=$I1")" = "2"

R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$I1,\"p_work_order_id\":\"$W2\",\"p_basis\":\"Adding the same work order to the same package for a second time\"}")
expect_err "$R" "already in package"

R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$I1,\"p_work_order_id\":\"$WF\",\"p_basis\":\"Another tenant's work order, which this package has no business containing\"}")
expect_err "$R" "work order not found"

R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$I1,\"p_work_order_id\":\"$W1\",\"p_basis\":\"because\"}")
expect_err "$R" "why this work belongs"

echo "── 4. D7.18 §28 — all TEN types on the CANONICAL constraint store ───────"

REQ=$(psqlc "select (current_date + 100)::text")
for T in drawing material access labour crane permit isolation scaffold predecessor inspection; do
  # SCAFFOLD is recorded WITHOUT a required-by date, deliberately: I.28's
  # burn-down has to have a genuinely undated constraint to classify as NOT
  # ASSESSABLE, and inventing the date to make the transcript tidy is exactly
  # the fabrication this slice refuses.
  if [ "$T" = "scaffold" ]; then RB=""; else RB=",\"required_by\":\"$REQ\""; fi
  R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$I1,\"p_constraint\":{\"constraint_type\":\"$T\",\"description\":\"The $T position for the mill drive installation\",\"basis\":\"Stated at the constructability review on the issued drawings\",\"owner_role\":\"planner\"$RB}}")
  noerr "$R"
  test -n "$(printf '%s' "$R" | field constraint_id)"
done
test "$(psqlc "select required_by is null from restoration_constraints where work_package_id=$I1 and constraint_kind='scaffold'")" = "t"

# The mapping is the ruling: PREDECESSOR is `precedence`, INSPECTION is
# `quality_hold`, and no parallel table holds ten of eighteen.
test "$(psqlc "select constraint_kind from restoration_constraints where work_package_id=$I1 and description like 'The predecessor%'")" = "precedence"
test "$(psqlc "select constraint_kind from restoration_constraints where work_package_id=$I1 and description like 'The inspection%'")" = "quality_hold"
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$I1")" = "10"
# Anchored to the package and NOT to a restoration event — one anchor, never both.
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$I1 and event_id is not null")" = "0"

R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$I1,\"p_constraint\":{\"constraint_type\":\"weather\",\"description\":\"An eleventh type the spec does not name\",\"basis\":\"Invented for this transcript to prove the door is closed\"}}")
expect_err "$R" "ten §28 types"

R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$I1,\"p_constraint\":{\"constraint_type\":\"access\",\"description\":\"Access for work this package does not contain\",\"basis\":\"Pointing at a work order that belongs to the civils package instead\",\"work_order_id\":\"$W1\"}}")
expect_err "$R" "not in this package"

# The one anchor rule, at the table, for every writer.
OUT=$(sql_must_fail "insert into restoration_constraints (organization_id, constraint_kind, phase, description, basis)
values ('$ORG','access','planning','A constraint anchored to nothing at all','Written with neither an event nor a package');")
expect_text "$OUT" "restoration_constraint_one_anchor"

echo "── 5. D7.18 × §70 — no machine closes a constraint ──────────────────────"

DRAW=$(psqlc "select id from restoration_constraints where work_package_id=$I1 and constraint_kind='drawing'")
PERMIT=$(psqlc "select id from restoration_constraints where work_package_id=$I1 and constraint_kind='permit'")
ISOL=$(psqlc "select id from restoration_constraints where work_package_id=$I1 and constraint_kind='isolation'")
test -n "$DRAW"; test -n "$PERMIT"; test -n "$ISOL"

# The AI identity, through the door.
R=$(rpc "$AIBOT" clear_package_constraint "{\"p_constraint_id\":\"$DRAW\",\"p_state\":\"satisfied\",\"p_basis\":\"The drawing was issued for construction this morning\"}")
expect_err "$R" "§70 reserves it for a person"

# The AI identity, by direct write, past the door entirely.
OUT=$(sql_must_fail "update restoration_constraints set state='satisfied', verified_by='$AIBOT_ID', verified_at=now() where id='$DRAW';")
expect_text "$OUT" "AI-operator identity cannot close a constraint"

# Permit and isolation truth is not a toggle — Recovery's rule, preserved.
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$PERMIT\",\"p_state\":\"satisfied\",\"p_basis\":\"The permit is in the folder and somebody says it is signed\"}")
expect_err "$R" "canonical operating and release controls"
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$ISOL\",\"p_state\":\"satisfied\",\"p_basis\":\"The isolation is understood to be in place\"}")
expect_err "$R" "canonical operating and release controls"

# Satisfied with no verifier is impossible at the table, for every writer.
OUT=$(sql_must_fail "update restoration_constraints set state='satisfied' where id='$DRAW';")
expect_text "$OUT" "check"

# Clearing with no evidence is refused at the door.
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$DRAW\",\"p_state\":\"satisfied\",\"p_basis\":\"ok\"}")
expect_err "$R" "evidence or basis is required"

# A person clears it, and the verifier is recorded.
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$DRAW\",\"p_state\":\"satisfied\",\"p_basis\":\"General arrangement 4412-GA-002 issued for construction on the drawing register\"}")
noerr "$R"
test "$(psqlc "select verified_by from restoration_constraints where id='$DRAW'")" = "$PLANNER_ID"

echo "── 6. D7.07 I.28 — the FORWARD burn-down, and what it refuses ───────────"

# An UNASSESSED package: nothing recorded, so nothing to burn down.
R=$(rpc "$PLANNER" get_package_constraint_burndown "{\"p_package_id\":$M1,\"p_horizon_days\":90}")
expect_refusal "$R" "UNASSESSED"

# A horizon that projects nothing.
for H in 0 -30 5000; do
  R=$(rpc "$PLANNER" get_package_constraint_burndown "{\"p_package_id\":$I1,\"p_horizon_days\":$H}")
  expect_refusal "$R" "1 to 1825"
done

# A window nothing is dated into: the constraints are required in 100 days.
R=$(rpc "$PLANNER" get_package_constraint_burndown "{\"p_package_id\":$I1,\"p_horizon_days\":10}")
expect_refusal "$R" "nothing to burn down"

# THE FORWARD ANSWER. Nine constraints are open; eight carry no expected clear
# date and one carries no required-by date. Not one of them is counted as clear.
R=$(rpc "$PLANNER" get_package_constraint_burndown "{\"p_package_id\":$I1,\"p_horizon_days\":180}")
noerr "$R"
test "$(printf '%s' "$R" | field answered)" = "True"
test "$(printf '%s' "$R" | field constraintsRecorded)" = "10"
test "$(printf '%s' "$R" | field openConstraints)" = "9"
test "$(printf '%s' "$R" | field unforecast)" = "8"
test "$(printf '%s' "$R" | field notAssessable)" = "1"
test "$(printf '%s' "$R" | field willBlock)" = "0"
test "$(printf '%s' "$R" | field expectedClear)" = "0"
# NOTHING is summed over a set nobody has stated an impact for.
test "$(printf '%s' "$R" | field statedScheduleImpactDays)" = ""
# NO projected constraint-free date over a set nobody has forecast.
test "$(printf '%s' "$R" | field forecastComplete)" = "False"
test "$(printf '%s' "$R" | field projectedConstraintFreeDate)" = ""
expect_text "$(printf '%s' "$R" | field projectedConstraintFreeRefusal)" "invented number wearing a calendar"

# The forward-looking numbers refuse every shape that would be invented.
MAT=$(psqlc "select id from restoration_constraints where work_package_id=$I1 and constraint_kind='material'")
CRANE=$(psqlc "select id from restoration_constraints where work_package_id=$I1 and constraint_kind='crane'")
SCAF=$(psqlc "select id from restoration_constraints where work_package_id=$I1 and constraint_kind='scaffold'")
test -n "$MAT"; test -n "$CRANE"; test -n "$SCAF"

PBASIS="Vendor confirmed the shipping date in writing against the purchase order"
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$MAT\",\"p_forecast\":{\"probability_of_clearance\":\"NaN\",\"probability_basis\":\"$PBASIS\"}}")
expect_err "$R" "finite number between 0 and 1"
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$MAT\",\"p_forecast\":{\"probability_of_clearance\":\"Infinity\",\"probability_basis\":\"$PBASIS\"}}")
expect_err "$R" "finite number between 0 and 1"
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$MAT\",\"p_forecast\":{\"probability_of_clearance\":\"1.5\",\"probability_basis\":\"$PBASIS\"}}")
expect_err "$R" "not a probability"
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$MAT\",\"p_forecast\":{\"probability_of_clearance\":\"-0.2\",\"probability_basis\":\"$PBASIS\"}}")
expect_err "$R" "not a probability"
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$MAT\",\"p_forecast\":{\"probability_of_clearance\":\"0.8\",\"probability_basis\":\"too short\"}}")
expect_err "$R" "needs its basis"
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$MAT\",\"p_forecast\":{\"schedule_impact_days\":\"-4\",\"impact_basis\":\"A negative delay\"}}")
expect_err "$R" "zero or more"
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$MAT\",\"p_forecast\":{\"schedule_impact_days\":\"NaN\",\"impact_basis\":\"Not a number of days\"}}")
expect_err "$R" "finite number of days"
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$MAT\",\"p_forecast\":{\"schedule_impact_days\":\"4\",\"impact_basis\":\"short\"}}")
expect_err "$R" "needs its basis"

# The table refuses the same shapes for every writer, not only at the door.
OUT=$(sql_must_fail "update restoration_constraints set probability_of_clearance='NaN'::numeric, probability_basis='$PBASIS' where id='$MAT';")
expect_text "$OUT" "restoration_constraint_probability_sane"
OUT=$(sql_must_fail "update restoration_constraints set probability_of_clearance=0.8 where id='$MAT';")
expect_text "$OUT" "restoration_constraint_probability_basis"

# A forecast that CLEARS in time, and one that WILL BLOCK.
EARLY=$(psqlc "select (current_date + 40)::text")
LATE=$(psqlc "select (current_date + 140)::text")
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$MAT\",\"p_forecast\":{\"expected_clear_date\":\"$EARLY\",\"probability_of_clearance\":\"0.9\",\"probability_basis\":\"$PBASIS\",\"schedule_impact_days\":\"0\",\"impact_basis\":\"Arrives inside the window\"}}")
noerr "$R"
test "$(printf '%s' "$R" | field probability_of_clearance)" = "0.9"
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$CRANE\",\"p_forecast\":{\"expected_clear_date\":\"$LATE\",\"probability_of_clearance\":\"0.4\",\"probability_basis\":\"The only 250t crane on site is committed to the concentrator until then\",\"schedule_impact_days\":\"40\",\"impact_basis\":\"Forty days between the crane being free and the date the lift is needed\"}}")
noerr "$R"

R=$(rpc "$PLANNER" get_package_constraint_burndown "{\"p_package_id\":$I1,\"p_horizon_days\":180}")
noerr "$R"
test "$(printf '%s' "$R" | field willBlock)" = "1"
test "$(printf '%s' "$R" | field expectedClear)" = "1"
test "$(printf '%s' "$R" | field notAssessable)" = "1"
test "$(printf '%s' "$R" | field unforecast)" = "6"
DAYS_LATE=$(jqp "$R" "[c['daysLate'] for c in x['constraints'] if c['kind']=='crane'][0]")
test "$DAYS_LATE" = "40"
FORECAST_SCAF=$(jqp "$R" "[c['forecast'] for c in x['constraints'] if c['kind']=='scaffold'][0]")
test "$FORECAST_SCAF" = "not_assessable"
FORECAST_MAT=$(jqp "$R" "[c['forecast'] for c in x['constraints'] if c['kind']=='material'][0]")
test "$FORECAST_MAT" = "expected_clear"
test "$(printf '%s' "$R" | field statedScheduleImpactDays)" = "40"

echo "── 7. D7.07 — recorded, not recomputed ──────────────────────────────────"

R=$(rpc "$PLANNER" compute_package_constraint_burndown "{\"p_package_id\":$I1,\"p_horizon_days\":180}")
noerr "$R"
RUN1=$(printf '%s' "$R" | field calculationRunId); test -n "$RUN1"
test "$(printf '%s' "$R" | field codeVersion)" = "develop-awp/7A/2026-12-10"
WILL_BLOCK_1=$(printf '%s' "$R" | field willBlock); test "$WILL_BLOCK_1" = "1"

# A REFUSAL IS RECORDED TOO: the unassessed package's refusal becomes a run.
R=$(rpc "$PLANNER" compute_package_constraint_burndown "{\"p_package_id\":$M1,\"p_horizon_days\":90}")
expect_refusal "$R" "UNASSESSED"
RUN_REFUSED=$(printf '%s' "$R" | field calculationRunId); test -n "$RUN_REFUSED"
test "$(psqlc "select status from calculation_runs where id='$RUN_REFUSED'")" = "refused"

# THE PAST DOES NOT MOVE. Clear the crane constraint, take a second burn-down,
# and the FIRST run still says what it said.
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$CRANE\",\"p_state\":\"not_applicable\",\"p_basis\":\"The drive is set with the overhead travelling crane, so the mobile crane is not required\"}")
noerr "$R"
R=$(rpc "$PLANNER" compute_package_constraint_burndown "{\"p_package_id\":$I1,\"p_horizon_days\":180}")
noerr "$R"
RUN2=$(printf '%s' "$R" | field calculationRunId); test -n "$RUN2"
test "$RUN1" != "$RUN2"
test "$(printf '%s' "$R" | field willBlock)" = "0"
test "$(psqlc "select outputs->>'willBlock' from calculation_runs where id='$RUN1'")" = "1"

# The history reads the recorded rows back, newest first, and refuses an empty one.
R=$(rpc "$PLANNER" get_package_burndown_history "{\"p_package_id\":$I1,\"p_limit\":10}")
noerr "$R"
test "$(printf '%s' "$R" | field runCount)" = "2"
test "$(jqp "$R" "x['runs'][0]['runId']")" = "$RUN2"
test "$(jqp "$R" "x['runs'][1]['outputs']['willBlock']")" = "1"
R=$(rpc "$PLANNER" get_package_burndown_history "{\"p_package_id\":$C1,\"p_limit\":10}")
expect_refusal "$R" "No burn-down has been recorded"

# A recorded run is beyond a CLIENT's reach entirely: calculation_runs carries
# a SELECT-only policy, so an update as `authenticated` matches no row and the
# projection is unchanged. The immutability trigger is the second wall behind
# that, and the SERVICE path is admitted AND AUDITED by design
# (20261130090600) — so this transcript proves the AUDIT with a write that
# changes nothing, rather than falsifying a recorded projection in order to
# demonstrate a refusal.
psqlc "set role authenticated;
       select set_config('request.jwt.claims', json_build_object('sub','$PLANNER_ID','role','authenticated')::text, false);
       update calculation_runs set outputs = jsonb_build_object('willBlock', 0) where id='$RUN1';" >/dev/null
test "$(psqlc "select outputs->>'willBlock' from calculation_runs where id='$RUN1'")" = "1"

SEC_BEFORE=$(psqlc "select count(*) from security_events where detail like '%calculation lineage row%'")
psqlc "update calculation_runs set method = method where id='$RUN1';" >/dev/null
SEC_AFTER=$(psqlc "select count(*) from security_events where detail like '%calculation lineage row%'")
test "$SEC_AFTER" -gt "$SEC_BEFORE"
test "$(psqlc "select outputs->>'willBlock' from calculation_runs where id='$RUN1'")" = "1"

# The lineage ledger's own TRUNCATE guard is asserted from the catalogue rather
# than executed: `truncate calculation_runs` is refused by a foreign key before
# the guard is reached, and the only way to reach the guard is `... CASCADE`,
# which would wipe two real tables if the guard were ever removed. Proving a
# guard by running the statement it protects against is not worth the day the
# guard is gone.
test "$(psqlc "select count(*) from pg_trigger where tgrelid='public.calculation_runs'::regclass and tgname='trg_calculation_run_no_truncate' and not tgisinternal")" = "1"
test "$(psqlc "select has_table_privilege('authenticated','public.calculation_runs','TRUNCATE')")" = "f"
test "$(psqlc "select has_table_privilege('service_role','public.calculation_runs','TRUNCATE')")" = "f"

echo "── 8. D7.06/D7.17 × §70 — the release ───────────────────────────────────"

# UNASSESSED refuses. This is the row's whole point: zero open constraints on a
# package nobody assessed reads as ready.
R=$(rpc "$MANAGER" release_work_package "{\"p_package_id\":$M1,\"p_note\":\"Releasing the commissioning package for the crew to start on Monday\"}")
expect_err "$R" "UNASSESSED"

# An unreleased PARENT refuses, before the constraints are even reached.
R=$(rpc "$MANAGER" release_work_package "{\"p_package_id\":$I1,\"p_note\":\"Releasing the installation package while its civils parent is still open\"}")
expect_err "$R" "which is not released"

# Release the chain from the head down. Each package needs its own constraint
# set — that is the rule, and the transcript obeys it rather than exempting it.
for PKG_ID in $E1 $P1 $C1; do
  R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$PKG_ID,\"p_constraint\":{\"constraint_type\":\"predecessor\",\"description\":\"Everything above this package in the chain is complete\",\"basis\":\"Checked against the issued chain at the constructability review\",\"required_by\":\"$REQ\"}}")
  noerr "$R"
done

# An EMPTY package refuses: E1 has a constraint but contains no work.
R=$(rpc "$MANAGER" release_work_package "{\"p_package_id\":$E1,\"p_note\":\"Releasing an engineering package that contains no work orders at all\"}")
expect_err "$R" "contains no work orders"

R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$E1,\"p_work_order_id\":\"$W4\",\"p_basis\":\"The commissioning procedure is drafted as part of the engineering package's scope\"}")
noerr "$R"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$P1,\"p_work_order_id\":\"$W4\",\"p_basis\":\"The same work order appears one level down: that is the AWP thread, not a duplicate\"}")
noerr "$R"

# OPEN HARD CONSTRAINTS refuse, and are NAMED rather than counted.
R=$(rpc "$MANAGER" release_work_package "{\"p_package_id\":$E1,\"p_note\":\"Releasing engineering with its predecessor constraint still unknown\"}")
expect_err "$R" "NOT READY"
test "$(jqp "$R" "len(x['openConstraints'])")" = "1"
test "$(jqp "$R" "x['openConstraints'][0]['kind']")" = "precedence"

for PKG_ID in $E1 $P1 $C1; do
  CID=$(psqlc "select id from restoration_constraints where work_package_id=$PKG_ID and constraint_kind='precedence'")
  R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$CID\",\"p_state\":\"satisfied\",\"p_basis\":\"The chain above this package is complete and signed off on the register\"}")
  noerr "$R"
done

# THE AI IDENTITY CANNOT RELEASE, at the door and past it.
R=$(rpc "$AIBOT" release_work_package "{\"p_package_id\":$E1,\"p_note\":\"An AI operator declaring that this work is safe for a crew to start\"}")
expect_err "$R" "supervisory, management or governance role"
OUT=$(sql_must_fail "update work_packages set status='released', released_by='$AIBOT_ID', released_at=now(), release_note='A release recorded by a machine identity past every door' where id=$E1;")
expect_text "$OUT" "AI-operator identity cannot release a work package"

# A release with no note is refused: the note IS the record of the judgement.
R=$(rpc "$MANAGER" release_work_package "{\"p_package_id\":$E1,\"p_note\":\"ok\"}")
expect_err "$R" "say what you are releasing"

R=$(rpc "$MANAGER" release_work_package "{\"p_package_id\":$E1,\"p_note\":\"Engineering is issued for construction and its predecessor position is cleared\"}")
noerr "$R"
test "$(printf '%s' "$R" | field status)" = "released"
test "$(psqlc "select released_by from work_packages where id=$E1")" = "$MANAGER_ID"

# FROZEN afterwards, for every writer, and its work cannot be changed.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7A-E1\",\"title\":\"Rescoped after release\",\"package_type\":\"engineering\",\"scope\":\"A different scope statement recorded after the release was made\"}}")
expect_err "$R" "frozen"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$E1,\"p_work_order_id\":\"$W1\",\"p_basis\":\"Adding work to a package that was already released against a different set\"}")
expect_err "$R" "released"
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$E1,\"p_constraint\":{\"constraint_type\":\"access\",\"description\":\"A constraint added after the release\",\"basis\":\"Recorded after the package was already released\"}}")
expect_err "$R" "does not grow afterwards"
OUT=$(sql_must_fail "update work_packages set scope='A scope rewritten after the release, past every door' where id=$E1;")
expect_text "$OUT" "frozen"
OUT=$(sql_must_fail "delete from work_packages where id=$E1;")
expect_text "$OUT" "A released package is not deleted"

echo "── 9. cross-tenant ──────────────────────────────────────────────────────"

R=$(rpc "$FOREIGN" get_case_work_packages "{\"p_case_id\":\"$CASE\"}")
expect_refusal "$R" "development case not found"
R=$(rpc "$FOREIGN" get_package_constraint_burndown "{\"p_package_id\":$I1,\"p_horizon_days\":90}")
expect_refusal "$R" "work package not found"
R=$(rpc "$FOREIGN" release_work_package "{\"p_package_id\":$C1,\"p_note\":\"Another tenant releasing a package that is not theirs to release\"}")
expect_err "$R" "work package not found"
test "$(rest "$FOREIGN" "work_packages?select=id" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" = "0"
test "$(rest "$FOREIGN" "work_package_work?select=id" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" = "0"
test "$(rest "$FOREIGN" "restoration_constraints?select=id" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" = "0"

echo "── 10. the ledgers, the §34 edge and the case read ──────────────────────"

# The two leaf ledgers are truncated FOR REAL and refused by their own guard.
for T in work_package_work restoration_constraints; do
  OUT=$(sql_must_fail "truncate table $T;")
  expect_text "$OUT" "not truncatable"
done
# `work_packages` is referenced by three foreign keys, so a plain TRUNCATE is
# refused before its guard is reached and the only way to reach the guard is
# CASCADE — which would take the membership rows and the constraints with it if
# the guard were ever removed. Asserted from the catalogue instead.
test "$(psqlc "select count(*) from pg_trigger where tgrelid='public.work_packages'::regclass and tgname='trg_work_package_no_truncate' and not tgisinternal")" = "1"
for R in authenticated anon service_role; do
  test "$(psqlc "select has_table_privilege('$R','public.work_packages','TRUNCATE')")" = "f"
  test "$(psqlc "select has_table_privilege('$R','public.work_package_work','TRUNCATE')")" = "f"
  test "$(psqlc "select has_table_privilege('$R','public.restoration_constraints','TRUNCATE')")" = "f"
done

# §34: the edge sync_spec34_absent_edge_audit() said would close at
# restoration_constraints.work_order_id is closed, and the ledger agrees.
# TWO remaining after D9 realize (20261218090001) also closed Lesson
# APPLIES_TO AssetClass at learning_events.applicability — the other column
# this audit named. The count goes DOWN when an endpoint is built.
test "$(psqlc "select sync_spec34_absent_edge_audit()->>'absentEdgeCount'")" = "2"
# The audit ACTED ON rather than left alarming: each closed edge is out of its
# list, so `newlyClosableCount` is zero again and its note says TWO.
test "$(psqlc "select sync_spec34_absent_edge_audit()->>'newlyClosableCount'")" = "0"
test "$(psqlc "select jsonb_array_length(sync_spec34_absent_edge_audit()->'edges')")" = "2"
AUDIT=$(psqlc "select sync_spec34_absent_edge_audit()->>'note'")
expect_text "$AUDIT" "states TWO of"
expect_text "$AUDIT" "20261210090100 closed WorkPackage DEPENDS_ON Constraint"
expect_text "$AUDIT" "20261218090001 closed Lesson APPLIES_TO AssetClass"
EDGES=$(psqlc "select count(*) from jsonb_array_elements(sync_spec34_edges()) x where x->>'status'='absent'")
test "$EDGES" = "2"
LEDGER=$(psqlc "select x->>'note' from jsonb_array_elements(sync_spec34_edges()) x where x->>'edge'='WorkPackage DEPENDS_ON Constraint'")
expect_text "$LEDGER" "CORRECTED 20261210090100"
LESSON=$(psqlc "select x->>'note' from jsonb_array_elements(sync_spec34_edges()) x where x->>'edge'='Lesson APPLIES_TO AssetClass'")
expect_text "$LESSON" "CORRECTED 20261218090001"

# The case read: the chain, the work it references, the constraint position.
R=$(rpc "$PLANNER" get_case_work_packages "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(printf '%s' "$R" | field packageCount)" = "5"
test "$(jqp "$R" "[p['packageCode'] for p in x['packages']]")" = "['S7A-E1', 'S7A-P1', 'S7A-C1', 'S7A-I1', 'S7A-M1']"
test "$(jqp "$R" "[p['level'] for p in x['packages']]")" = "[1, 2, 3, 4, 5]"
test "$(jqp "$R" "[p['parentPackageCode'] for p in x['packages']]")" = "[None, 'S7A-E1', 'S7A-P1', 'S7A-C1', 'S7A-I1']"
# The execution status comes from work_orders and is not copied.
test "$(jqp "$R" "[w['executionStatus'] for p in x['packages'] if p['packageCode']=='S7A-I1' for w in p['workOrders']]")" = "['pending', 'pending']"
# The readiness sentence is the VERDICT's sentence, not a second one written
# here — step 11b compares it character for character with the door's refusal.
test "$(jqp "$R" "[p['readinessVerdict'] for p in x['packages'] if p['packageCode']=='S7A-M1'][0]")" = "unassessed"
expect_text "$(jqp "$R" "[p['readiness'] for p in x['packages'] if p['packageCode']=='S7A-M1'][0]")" "UNASSESSED — no constraint has been recorded against work package S7A-M1"
test "$(jqp "$R" "[p['canRelease'] for p in x['packages'] if p['packageCode']=='S7A-M1'][0]")" = "False"
test "$(jqp "$R" "[p['readinessVerdict'] for p in x['packages'] if p['packageCode']=='S7A-E1'][0]")" = "released"
expect_text "$(jqp "$R" "[p['readiness'] for p in x['packages'] if p['packageCode']=='S7A-E1'][0]")" "RELEASED on"
# `parentType` is the parent's ACTUAL type, with the prescribed one beside it —
# a read computing it from the RULE could not report a mismatch under any
# circumstances, and rendered any broken chain as a well-typed one.
test "$(jqp "$R" "[p['parentType'] for p in x['packages']]")" = "[None, 'engineering', 'procurement', 'construction', 'installation']"
test "$(jqp "$R" "[p['parentTypeExpected'] for p in x['packages']]")" = "[None, 'engineering', 'procurement', 'construction', 'installation']"
test "$(jqp "$R" "[p['parentTypeDiverges'] for p in x['packages']]")" = "[False, False, False, False, False]"

# A case with no packages refuses rather than rendering an empty chain.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S7A empty case\",\"p_problem_statement\":\"A development case with no work packages at all, used here to prove the read refuses instead of rendering an empty AWP chain as a complete one.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE3=$(printf '%s' "$R" | field case_id)
R=$(rpc "$PLANNER" get_case_work_packages "{\"p_case_id\":\"$CASE3\"}")
expect_refusal "$R" "No work package has been recorded"

# The audit trail exists for every act, with both states. `audit_events` is an
# append-only ledger keyed to the ORGANIZATION, so it survives this transcript's
# own teardown and its rows accumulate across runs — the assertion is therefore
# about the LATEST release, not about a count that would only hold on a fresh
# database.
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('work_package','work_package_constraint') and event_data->>'package_code' like 'S7A-%'")" != "0"
LATEST_RELEASE=$(psqlc "select new_state::text from audit_events where organization_id='$ORG' and entity_type='work_package' and event_data->>'action'='released' and event_data->>'package_code'='S7A-E1' order by created_at desc limit 1")
expect_text "$LATEST_RELEASE" "constraintsChecked"
expect_text "$LATEST_RELEASE" "\"workOrders\": 1"
# Both states are captured on a revision, which is what makes the ledger a
# record of a CHANGE rather than of a value.
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='work_package_constraint' and event_data->>'action'='state_set' and previous_state ? 'state' and new_state ? 'state'")" != "0"

echo "── 11. the repair pass: one verdict, a lapsed forecast, and the exits ───"

# ── 11a. A LAPSED FORECAST IS NOT A CLEARANCE, AND THE IMPACT IS THE IMPACT
#    OF WHAT BLOCKS. Its own package and its own work order, so the arithmetic
#    below is about two constraints and nothing else.
#
#    The classifier compared the expected clear date only against the
#    required-by date and against the end of the horizon, never against TODAY.
#    A still-OPEN constraint whose forecast clear date had already passed
#    therefore fell into `expected_clear`, and the projection reported
#    `forecastComplete: true` with a `projectedConstraintFreeDate` in the PAST
#    and an empty refusal list — for a package with an open hard constraint.
#    No adversarial write reaches that state: a forecast recorded today for ten
#    days' time becomes it on day eleven, by the passage of time alone.
psqlc "insert into work_orders (organization_id, wo_number, title, status)
       values ('$ORG','S7A-W5','Issue the drive foundation drawings','pending'),
              ('$ORG','S7A-W6','Set out the foundation','pending'),
              ('$ORG','S7A-W7','Procure the anchor bolts','pending');" >/dev/null
W5=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7A-W5'")
W6=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7A-W6'")
W7=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7A-W7'")
test -n "$W5"; test -n "$W6"; test -n "$W7"

R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE2\",\"p_package\":{\"package_code\":\"S7A-E3X\",\"title\":\"Lapsed forecast package\",\"package_type\":\"engineering\",\"scope\":\"An engineering package used here to prove that a forecast whose date has passed is not a clearance\"}}")
noerr "$R"; E3X=$(printf '%s' "$R" | field work_package_id); test -n "$E3X"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$E3X,\"p_work_order_id\":\"$W5\",\"p_basis\":\"Issuing the foundation drawings is the work this engineering package exists to release\"}")
noerr "$R"

NEED=$(psqlc "select (current_date + 30)::text")
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$E3X,\"p_constraint\":{\"constraint_type\":\"drawing\",\"description\":\"The foundation general arrangement has not been issued for construction\",\"basis\":\"Checked against the drawing register at the weekly engineering review\",\"required_by\":\"$NEED\"}}")
noerr "$R"; DRW=$(printf '%s' "$R" | field constraint_id); test -n "$DRW"
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$E3X,\"p_constraint\":{\"constraint_type\":\"material\",\"description\":\"The anchor bolts for the foundation are on order and not yet delivered\",\"basis\":\"Checked against the purchase order acknowledgement from the supplier\",\"required_by\":\"$NEED\"}}")
noerr "$R"; MAT2=$(printf '%s' "$R" | field constraint_id); test -n "$MAT2"

R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$DRW\",\"p_forecast\":{\"expected_clear_date\":\"$(psqlc "select (current_date + 10)::text")\",\"schedule_impact_days\":\"3\",\"impact_basis\":\"Three days between the drawing being issued and the date the crew needs it\"}}")
noerr "$R"
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$MAT2\",\"p_forecast\":{\"expected_clear_date\":\"$(psqlc "select (current_date + 5)::text")\",\"schedule_impact_days\":\"5\",\"impact_basis\":\"Five days between the bolts arriving and the date the pour is scheduled\"}}")
noerr "$R"

# Both are forecast to clear in time, so NOTHING is forecast to block.
R=$(rpc "$PLANNER" get_package_constraint_burndown "{\"p_package_id\":$E3X,\"p_horizon_days\":90}")
noerr "$R"
test "$(printf '%s' "$R" | field expectedClear)" = "2"
test "$(printf '%s' "$R" | field lapsed)" = "0"
test "$(printf '%s' "$R" | field forecastComplete)" = "True"
# EIGHT days of stated impact stand against these two constraints and NEITHER
# blocks, so the blocking impact is not eight — it is unstated. A summing loop
# with no bucket filter reported eight, and wrote it into a lineage row.
test "$(printf '%s' "$R" | field statedScheduleImpactDays)" = ""

# TIME PASSES. Nothing goes through a door here: the drawing forecast is moved
# into the past exactly as a fortnight on a calendar would move it, and
# `created_at` moves with it because a forecast cannot predate its constraint.
psqlc "update restoration_constraints
          set created_at = now() - interval '60 days', expected_clear_date = current_date - 5
        where id = '$DRW';" >/dev/null

R=$(rpc "$PLANNER" get_package_constraint_burndown "{\"p_package_id\":$E3X,\"p_horizon_days\":90}")
noerr "$R"
test "$(jqp "$R" "[c['forecast'] for c in x['constraints'] if c['kind']=='drawing'][0]")" = "lapsed"
test "$(jqp "$R" "[c['daysLate'] for c in x['constraints'] if c['kind']=='drawing'][0]")" = "5"
test "$(printf '%s' "$R" | field lapsed)" = "1"
test "$(printf '%s' "$R" | field expectedClear)" = "1"
# NO constraint-free date in the past for work that is still blocked.
test "$(printf '%s' "$R" | field forecastComplete)" = "False"
test "$(printf '%s' "$R" | field projectedConstraintFreeDate)" = ""
expect_text "$(printf '%s' "$R" | field projectedConstraintFreeRefusal)" "already passed"
test "$(jqp "$R" "any('already passed' in r['reason'] for r in x['refusals'])")" = "True"
# THREE days of blocking impact, not eight: the other five belong to a
# constraint that is still forecast to clear in time.
test "$(printf '%s' "$R" | field statedScheduleImpactDays)" = "3"

# The RECORDED history says how many rows it handed back, not how many were
# asked for: one run, `returned` 1, against a default limit of 20.
R=$(rpc "$PLANNER" compute_package_constraint_burndown "{\"p_package_id\":$E3X,\"p_horizon_days\":90}")
noerr "$R"
R=$(rpc "$PLANNER" get_package_burndown_history "{\"p_package_id\":$E3X}")
noerr "$R"
test "$(printf '%s' "$R" | field runCount)" = "1"
test "$(printf '%s' "$R" | field returned)" = "1"
test "$(jqp "$R" "len(x['runs'])")" = "1"

# ── 11b. ONE VERDICT. `get_case_work_packages` carried its own inline
#    readiness `case` over TWO of the door's conditions, under a comment
#    claiming it was "stated by the same rules release_work_package refuses
#    through". A package with no work orders, one under an unreleased parent
#    and a CANCELLED one each rendered as "Every hard constraint is cleared;
#    release is a §70 human act and has not been performed" while the door
#    refused them — the weaker copy on the surface a supervisor acts on, and it
#    read as READY. So the screen's sentence is compared here CHARACTER FOR
#    CHARACTER with what the door says about the same package.
verdict_agrees(){ # $1 case  $2 package id  $3 package code  $4 expected verdict
  local READ_R DOOR_R SENTENCE
  READ_R=$(rpc "$PLANNER" get_case_work_packages "{\"p_case_id\":\"$1\"}")
  noerr "$READ_R"
  test "$(jqp "$READ_R" "[p['readinessVerdict'] for p in x['packages'] if p['packageCode']=='$3'][0]")" = "$4"
  test "$(jqp "$READ_R" "[p['canRelease'] for p in x['packages'] if p['packageCode']=='$3'][0]")" = "False"
  SENTENCE=$(jqp "$READ_R" "[p['readiness'] for p in x['packages'] if p['packageCode']=='$3'][0]")
  DOOR_R=$(rpc "$MANAGER" release_work_package "{\"p_package_id\":$2,\"p_note\":\"Releasing $3 to see whether the door says exactly what the screen says\"}")
  test "$(printf '%s' "$DOOR_R" | field verdict)" = "$4"
  test "$(printf '%s' "$DOOR_R" | field error)" = "$SENTENCE"
}

# NOT READY — an open hard constraint.
verdict_agrees "$CASE2" "$E3X" S7A-E3X not_ready
# UNASSESSED — nothing recorded at all.
verdict_agrees "$CASE2" "$E2X" S7A-E2X unassessed
# EMPTY — assessed, cleared, and containing no work.
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$E2X,\"p_constraint\":{\"constraint_type\":\"access\",\"description\":\"The route to the neighbouring worksite is shared with a live conveyor\",\"basis\":\"Walked the route with the area supervisor and recorded the interference\"}}")
noerr "$R"; ACC=$(printf '%s' "$R" | field constraint_id)
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$ACC\",\"p_state\":\"satisfied\",\"p_basis\":\"The conveyor is isolated for the duration and the route is barricaded and signed\"}")
noerr "$R"
verdict_agrees "$CASE2" "$E2X" S7A-E2X empty

# ONE JOB IS NOT IN TWO PACKAGES AT THE SAME LEVEL. S7A-W5 is already in
# S7A-E3X, and S7A-E2X is an engineering package too: those would be two
# release decisions over one job, each checked against a constraint set the
# other cannot see, and BOTH could be released.
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$E2X,\"p_work_order_id\":\"$W5\",\"p_basis\":\"The same work order in a second engineering package, at the very same AWP level\"}")
expect_err "$R" "not to two at the same level"
OUT=$(sql_must_fail "insert into work_package_work (organization_id, work_package_id, work_order_id, assignment_basis)
values ('$ORG',$E2X,'$W5','The same job in a second same-level package, written past the door entirely');")
expect_text "$OUT" "which is at the same AWP level"

R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$E2X,\"p_work_order_id\":\"$W6\",\"p_basis\":\"Setting out the foundation is the work the neighbouring engineering package releases\"}")
noerr "$R"

# READY FOR A PERSON — and the screen says so in the same words, with
# canRelease TRUE rather than a sentence the door would contradict.
R=$(rpc "$PLANNER" get_case_work_packages "{\"p_case_id\":\"$CASE2\"}")
noerr "$R"
test "$(jqp "$R" "[p['readinessVerdict'] for p in x['packages'] if p['packageCode']=='S7A-E2X'][0]")" = "ready_for_human"
test "$(jqp "$R" "[p['canRelease'] for p in x['packages'] if p['packageCode']=='S7A-E2X'][0]")" = "True"
# A HEAD package has no parent, so the sentence does not claim one is released.
expect_text "$(jqp "$R" "[p['readiness'] for p in x['packages'] if p['packageCode']=='S7A-E2X'][0]")" "it is the head of its chain"

# PARENT UNRELEASED — a procurement package under the still-unreleased head.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE2\",\"p_package\":{\"package_code\":\"S7A-P2X\",\"title\":\"Neighbouring procurement\",\"package_type\":\"procurement\",\"scope\":\"Buy the anchor bolts and the grout for the neighbouring foundation\",\"parent_package_code\":\"S7A-E2X\"}}")
noerr "$R"; P2X=$(printf '%s' "$R" | field work_package_id); test -n "$P2X"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$P2X,\"p_work_order_id\":\"$W7\",\"p_basis\":\"Procuring the anchor bolts is the work this procurement package exists to release\"}")
noerr "$R"
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$P2X,\"p_constraint\":{\"constraint_type\":\"predecessor\",\"description\":\"The bolt schedule comes from the foundation drawings, which are not issued\",\"basis\":\"Checked against the drawing register and the bill of materials\"}}")
noerr "$R"; PRE2=$(printf '%s' "$R" | field constraint_id)
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$PRE2\",\"p_state\":\"satisfied\",\"p_basis\":\"The bolt schedule was issued separately and checked against the foundation layout\"}")
noerr "$R"
verdict_agrees "$CASE2" "$P2X" S7A-P2X parent_unreleased

# ── 11c. THE CANCELLATION THE REFUSALS NAME. Three refusals in this slice say
#    "Cancel it instead" / "Cancel the package instead". Without a door, the
#    only route to `cancelled` was a superuser UPDATE, and a released package
#    that should not proceed had no exit at all.
R=$(rpc "$MANAGER" cancel_work_package "{\"p_package_id\":$E2X,\"p_reason\":\"Withdrawing the head while a procurement package still hangs from it\"}")
expect_err "$R" "still hangs from it"
R=$(rpc "$AIBOT" cancel_work_package "{\"p_package_id\":$P2X,\"p_reason\":\"A machine identity withdrawing work that a person is responsible for\"}")
expect_err "$R" "supervisory, management or governance role"
R=$(rpc "$MANAGER" cancel_work_package "{\"p_package_id\":$P2X,\"p_reason\":\"The neighbouring foundation is deferred to the next shutdown and the bolts are not needed\"}")
noerr "$R"
test "$(printf '%s' "$R" | field status)" = "cancelled"
test "$(printf '%s' "$R" | field wasReleased)" = "False"
verdict_agrees "$CASE2" "$P2X" S7A-P2X cancelled
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='work_package' and event_data->>'action'='cancelled' and event_data->>'package_code'='S7A-P2X' and previous_state ? 'status' and new_state ? 'status'")" != "0"

# ── 11d. A RELEASED PACKAGE IS FROZEN ON UPDATE, NOT ONLY ON DELETE. An
#    UPDATE performs a removal and an addition in ONE statement, so a freeze
#    naming only INSERT and DELETE admitted exactly what the DELETE arms
#    refuse: a released package's membership re-pointed at another work order,
#    and its constraint flipped back to `unknown`, re-anchored, or DETACHED —
#    after which the package's own burn-down answered UNASSESSED for work a
#    named person had released.
E1_CID=$(psqlc "select id from restoration_constraints where work_package_id=$E1 limit 1")
test -n "$E1_CID"
OUT=$(sql_must_fail "update restoration_constraints set state='unknown', verified_by=null, verified_at=null where id='$E1_CID';")
expect_text "$OUT" "rewrites what the release was checked against"
OUT=$(sql_must_fail "update restoration_constraints set is_hard = not is_hard where id='$E1_CID';")
expect_text "$OUT" "rewrites what the release was checked against"
OUT=$(sql_must_fail "update restoration_constraints set work_package_id=$C1 where id='$E1_CID';")
expect_text "$OUT" "rewrites what the release was checked against"
# Re-pointing the row at a different job is refused on the NEW side…
OUT=$(sql_must_fail "update work_package_work set work_order_id='$W1' where work_package_id=$E1;")
expect_text "$OUT" "was not released with it"
# …and moving it OFF the released package is refused on the OLD side, which is
# the half a freeze written only against NEW would have missed entirely.
OUT=$(sql_must_fail "update work_package_work set work_package_id=$C1 where work_package_id=$E1;")
expect_text "$OUT" "rewrites what the release covered"

# A DETACH IS RECORDED. The marker door was gated on NEW alone, so moving a
# constraint OFF its package — setting work_package_id to NULL with an event
# anchor in its place — walked past it and left no security_events row at all:
# the one act that empties a package's constraint set was the one act nothing
# recorded. Anchored on coalesce(NEW, OLD), it is recorded.
psqlc "insert into restoration_events (organization_id, asset_id, event_code, reason)
       select '$ORG', a.id, 'S7A-EVT', 'A restoration event used here only so a DETACH has a second anchor to land on'
         from assets a where a.organization_id='$ORG' limit 1
       on conflict do nothing;" >/dev/null
EVT=$(psqlc "select id from restoration_events where organization_id='$ORG' and event_code='S7A-EVT'")
test -n "$EVT"
DETACH_BEFORE=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like '%DETACHED from its work package%'")
psqlc "update restoration_constraints set work_package_id=null, event_id='$EVT' where id='$MAT2';" >/dev/null
DETACH_AFTER=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like '%DETACHED from its work package%'")
test "$DETACH_AFTER" -gt "$DETACH_BEFORE"
# …and the constraint really did move, so the record is of something that
# happened rather than of an attempt that was refused.
test "$(psqlc "select work_package_id is null and event_id='$EVT' from restoration_constraints where id='$MAT2'")" = "t"

# ── 11e. EVERY BAD INPUT IS A REFUSAL, NEVER A RAW POSTGRES ERROR — and the
#    ROLE is answered first. `(p_constraint->>'is_hard')::boolean` in DECLARE
#    ran BEFORE the body, so an unauthorised caller got a raw 22P02 where every
#    other bad input gets a refusal.
BAD='{"constraint_type":"access","description":"A constraint recorded with inputs that are not what they claim to be","basis":"Recorded here only to prove the door refuses rather than raising"'
R=$(rpc "$TECH" record_package_constraint "{\"p_package_id\":$E3X,\"p_constraint\":$BAD,\"is_hard\":\"maybe\"}}")
expect_err "$R" "requires a planning, engineering, supervisory or governance role"
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$E3X,\"p_constraint\":$BAD,\"is_hard\":\"maybe\"}}")
expect_err "$R" "is_hard must be true or false"
# ABSENT and PRESENT-BUT-UNPARSEABLE are different answers. `sync_text_as_uuid`
# returns NULL on unparseable text and the guards then skipped it as "not
# supplied", so a constraint the caller believes names a job and an owner was
# recorded with the §34 edge column NULL and nobody to chase.
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$E3X,\"p_constraint\":$BAD,\"work_order_id\":\"not-a-uuid\"}}")
expect_err "$R" "is not an identifier"
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$E3X,\"p_constraint\":$BAD,\"owner_id\":\"not-a-uuid\"}}")
expect_err "$R" "is not an identifier"
# Nothing was written by any of them.
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$E3X and constraint_kind='access'")" = "0"

# ── 11f. THE §70 WALL'S SCOPE, PROVEN AGAINST RECOVERY'S OWN CALLER.
#    `trg_constraint_verifier_human` is scoped `when (new.work_package_id is
#    not null)`. Bound to EVERY row of restoration_constraints instead — which
#    is what the first draft did — it broke two shipped Recovery RPCs:
#    `refresh_restoration_readiness` and `refresh_recovery_planning_inputs`
#    both name `ai_admin` in their OWN authority list and both stamp
#    `verified_by = auth.uid()` on the DERIVED constraints they resolve to
#    `satisfied`, so an authorized AI caller got an unhandled check_violation,
#    the surrounding `delete ... source_kind='derived'` rolled back with it,
#    and the event kept STALE derived constraints.
#
#    It is asserted HERE because nothing else in CI can reach it: the three
#    Recovery transcripts all drive as a planner, and they use GNU-only
#    `date -u -d` so they do not run on a developer's macOS at all. A static
#    test can pin the trigger's WHEN clause; only this can show the caller
#    still works. The labour item must resolve SATISFIED for the branch to
#    exist at all — that is the only state that stamps a verifier — so the
#    event is given the site whose Millwright capacity is already recorded and
#    a task well inside it.
psqlc "update restoration_events e set site_id = a.site_id
         from assets a
        where a.id = e.asset_id and e.event_code='S7A-EVT'
          and e.organization_id='$ORG' and e.site_id is null;" >/dev/null
psqlc "insert into work_orders (organization_id, wo_number, title, status)
       select '$ORG','S7A-W8','Recovery readiness probe work order','pending'
       where not exists (select 1 from work_orders
                          where organization_id='$ORG' and wo_number='S7A-W8');" >/dev/null
W8=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7A-W8'")
test -n "$W8"
psqlc "insert into restoration_event_work (organization_id, event_id, work_order_id, plan_state, execution_status, sequence_no)
       select '$ORG','$EVT','$W8','included','not_started',9
       where not exists (select 1 from restoration_event_work
                          where event_id='$EVT' and work_order_id='$W8');" >/dev/null
psqlc "insert into work_order_tasks (work_order_id, organization_id, task_sequence, description, craft, estimated_hours)
       select '$W8','$ORG',9,'Millwright hours well inside recorded weekly capacity','Millwright',4
       where not exists (select 1 from work_order_tasks
                          where work_order_id='$W8' and task_sequence=9);" >/dev/null

# CONTROL: a person runs it, and the labour item really does resolve SATISFIED
# with a verifier stamped — otherwise the AI call below proves nothing, because
# the wall is only reachable through that branch.
R=$(rpc "$PLANNER" refresh_restoration_readiness "{\"p_event_id\":\"$EVT\"}")
noerr "$R"
test "$(psqlc "select count(*) from restoration_constraints
                where event_id='$EVT' and source_kind='derived'
                  and constraint_kind='labour' and state='satisfied'
                  and verified_by is not null")" = "1"

# THE BRANCH: the SAME call as the AI identity the RPC's own role list admits.
R=$(rpc "$AIBOT" refresh_restoration_readiness "{\"p_event_id\":\"$EVT\"}")
noerr "$R"
test "$(printf '%s' "$R" | field ok)" = "True"
R=$(rpc "$AIBOT" refresh_recovery_planning_inputs "{\"p_event_id\":\"$EVT\"}")
noerr "$R"
# …and the derived rows SURVIVED rather than rolling back with a raised wall.
test "$(psqlc "select count(*) from restoration_constraints
                where event_id='$EVT' and source_kind='derived'
                  and constraint_kind='labour' and state='satisfied'")" = "1"

# THE COST OF THE SCOPE, ASSERTED RATHER THAN GLOSSED. On an EVENT-anchored
# derived row the verifier stamp is `auth.uid()` — the CALLING IDENTITY, and
# here that identity is the AI. This is the residual the ruling names: it is
# Recovery's pre-existing derived-provenance decision, not something Slice 7A
# introduced, and the transcript states it rather than letting "verified" read
# as "a person checked".
test "$(psqlc "select count(*) from restoration_constraints
                where event_id='$EVT' and source_kind='derived'
                  and constraint_kind='labour' and state='satisfied'
                  and verified_by='$AIBOT_ID'")" = "1"

# THE OTHER HALF: on THIS slice's own package-anchored rows the same identity
# is still refused, so the scope is a boundary and not a hole.
PKG_CID=$(psqlc "select c.id from restoration_constraints c
                   join work_packages p on p.id = c.work_package_id
                  where c.organization_id='$ORG' and p.released_at is null
                    and p.status <> 'cancelled' order by c.id limit 1")
test -n "$PKG_CID"
OUT=$(sql_must_fail "update restoration_constraints set state='satisfied', verified_by='$AIBOT_ID', verified_at=now() where id='$PKG_CID';")
expect_text "$OUT" "cannot close a constraint"

# ── 11g. A SOFT-ONLY OPEN SET STILL NAMES ITS REASON. `v_latest` is computed
#    over open HARD rows only, while the completeness counters count EVERY open
#    row — so a package whose open constraints are all soft-and-forecast
#    produced `forecastComplete: true`, `projectedConstraintFreeDate: null`,
#    `projectedConstraintFreeRefusal: null` and an empty refusal list, and the
#    panel printed nothing at all beside "Projected constraint-free:". A bare
#    null with no explanation is the shape this file refuses everywhere else.
#    Asserted LIVE, not just as a string in the function body: a static check
#    cannot tell whether the arm is reachable.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE2\",\"p_package\":{\"package_code\":\"S7A-S1\",\"title\":\"Soft-only constraint package\",\"package_type\":\"engineering\",\"scope\":\"Issue the layout mark-up whose only open constraint does not stop a release\"}}")
noerr "$R"; S1=$(printf '%s' "$R" | field work_package_id); test -n "$S1"
if [ "$(psqlc "select count(*) from restoration_constraints where work_package_id=$S1")" = "0" ]; then
  R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$S1,\"p_constraint\":{\"constraint_type\":\"DRAWING\",\"description\":\"A mark-up that is wanted but does not stop the package\",\"basis\":\"Recorded soft because the crew can start from the issued general arrangement\",\"is_hard\":false,\"required_by\":\"$(psqlc "select (current_date + 30)::text")\"}}")
  noerr "$R"; S1_CID=$(printf '%s' "$R" | field constraint_id); test -n "$S1_CID"
  R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$S1_CID\",\"p_forecast\":{\"expected_clear_date\":\"$(psqlc "select (current_date + 10)::text")\",\"probability_of_clearance\":0.9,\"probability_basis\":\"The drafter has the mark-up scheduled for next week\",\"schedule_impact_days\":1,\"impact_basis\":\"One day of rework if it arrives after the crew starts\"}}")
  noerr "$R"
fi
R=$(rpc "$PLANNER" get_package_constraint_burndown "{\"p_package_id\":$S1,\"p_horizon_days\":90}")
noerr "$R"
# Nothing is unforecast, undated or lapsed, so the forecast IS complete…
test "$(printf '%s' "$R" | field forecastComplete)" = "True"
# …and there is still NO date, because no open HARD constraint carries one.
test "$(printf '%s' "$R" | field projectedConstraintFreeDate)" = ""
# The refusal says WHY, rather than leaving the surface to print a blank.
expect_text "$(printf '%s' "$R" | field projectedConstraintFreeRefusal)" "no OPEN HARD constraint carries an expected clear date"
expect_text "$(printf '%s' "$R" | field projectedConstraintFreeRefusal)" "The open set here is soft"

echo
echo "Develop slice-7a smoke PASSED — the AWP chain typed and validated in BOTH
directions at the database, ONE release verdict whose sentence the screen and
the door state identically in six states, a burn-down that asks what day it is
before calling a forecast a clearance, every exit the refusals name, and a §70
verifier wall scoped to this slice's rows — refusing the AI identity there
while Recovery's own AI-admitting caller still completes — and a soft-only open
set that names why it has no date instead of printing a blank."

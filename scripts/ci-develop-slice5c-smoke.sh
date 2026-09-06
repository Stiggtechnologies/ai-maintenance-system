#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 5C — the digital thread. Every step is a live transcript
# against a real local database.
#
# THIS SCRIPT WAS NOT RUN BEFORE IT WAS COMMITTED. Docker was reported dead on
# the machine the slice was written on; the report was wrong (the check used
# `timeout`, which does not exist on that machine), and the transcript has
# since been executed locally, twice in a row against one database. Nothing
# here was weakened to make it pass. What the first execution found is on the
# record instead: two §34 edges in step 8 were being handed a locally computed
# case count that the ruling says must be null, which was a second
# implementation of one predicate and was fixed in the MIGRATION; and step
# 10(j) was reaching for `canonical_cascade` through a DELETE of a
# design_requirements row, which slice 5A refuses by name and always would
# have. That route is now driven the only way it can be reached — see 10(j).
#
# Steps:
#   1  the anchor (D11.19): an object with NO anchor is refused at the door, an
#      anchor in another tenant is refused, and §26's enterprise identity lands
#      on the ONE asset row — with the duplicate and the re-point both refused.
#   2  the link model (D11.05): the ten kinds, a forward hop with a mandatory
#      basis, and a BACKWARD hop refused at the door AND at the wall.
#   3  the authoritative version (D11.06): recording is not releasing; a
#      supersession with no statement of what changed is refused; the release
#      moves the incumbent to `superseded` with BOTH pointers; and a second
#      authoritative row is refused by the partial unique index, not a report.
#   4  §70 at five doors and five walls: the AI-operator identity refused by
#      name as a registrar, a linker, a declarer, a severer and an
#      acknowledger — for EVERY writer, service key included.
#   5  the continuity invariant (D11.20): DELETE and TRUNCATE refused on all
#      five tables; an anchor moved by UPDATE refused; a retirement or a
#      severance done by flipping a column refused; deleting the anchoring
#      asset refused BY NAME while live objects hang from it; and every
#      permitted severance recorded in thread_severances.
#   6  change receipts (D11.07): a first issue raises none, a supersession
#      raises one per downstream object UNACKNOWLEDGED, the declarer cannot
#      answer their own change (§42), and an answered receipt cannot be
#      re-answered.
#   7  refusal-first traversal: an object with no hop REFUSES rather than
#      reporting 0 downstream impacts; a traversal crossing a chain skip
#      REFUSES and NAMES it with a NULL count; a clean one answers.
#   8  the ONE graph (D11.21): thread hops, anchor edges and asset_dependencies
#      edges in one node space with no dangling endpoint, and §34's nineteen
#      relationships with THREE honestly absent (five when this file was
#      written; two of those endpoints have since been built, and step 8
#      NAMES the three that remain so a different edge going quiet cannot be
#      absorbed by the same number).
#   9  cross-tenant: the foreign member sees none of it.
#  10  the repair pass: a receipt cannot be answered by nobody, §42 covers the
#      INSERT, the §26 identity columns are walled for every caller, the
#      severance ledger has a door, a released revision is immutable in what it
#      says, a retired object has no current revision, the impact traversal
#      refuses over a severed hop, and a CAPITAL PROJECT is still deletable —
#      taking the thread objects that ARE its requirement and its acceptance
#      test with it, permitted and RECORDED as `canonical_cascade`, not
#      refused, while the requirement itself stays undeletable.
#
# Run: supabase start && scripts/ci-develop-slice5c-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-5c smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
jqp(){ BODY="$1" EXPR="$2" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
print(eval(os.environ['EXPR'], {'x': x, 'json': json}))
PY
}
# thread_severances is append-only and does NOT cascade with the development
# case (its case column is deliberately not a foreign key — a ledger that
# vanishes with its subject is not a ledger). So every assertion about it is a
# DELTA measured across the act, never an absolute count, and a re-run cannot
# read a previous run's rows.
sevcount(){ psqlc "select count(*) from thread_severances where organization_id='$ORG'"; }

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$EXEC"

PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
test -n "$PLANNER_ID"; test -n "$MANAGER_ID"

# The AI-operator identity, seeded exactly as the 3B/3C/3D/4A/5A/5B transcripts
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
AIBOT_ID=$(psqlc "select id from user_profiles where email='smoke-aibot@syncai.ca'")
test -n "$AIBOT_ID"

# The FOREIGN tenant, provisioned by this smoke rather than borrowed: a
# cross-tenant negative that SKIPS when the other tenant happens not to exist
# is a negative test that passes by not running. Its own uuid, because the
# sibling smokes share a database in CI and a reused id collides on auth.users.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
declare v_uid uuid := '5c5c5c5c-5555-4555-8555-5c5c5c5c5c5c';
        v_org uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into organizations (id, name) values (v_org, 'S4D foreign tenant')
    on conflict (id) do nothing;
  if not exists (select 1 from auth.users where email = 'smoke5c-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke5c-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'S5C foreign member'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  if not exists (select 1 from auth.identities where user_id = v_uid) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke5c-foreign@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_uid, v_org, 'smoke5c-foreign@syncai.ca', 'maintenance_manager')
  on conflict (id) do update set organization_id = v_org, role = 'maintenance_manager';
  if not exists (select 1 from assets where organization_id = v_org and asset_tag = 'S5C-FGN') then
    insert into assets (organization_id, asset_tag, name, criticality)
    values (v_org, 'S5C-FGN', 'Foreign tenant asset', 'medium');
  end if;
end $seed$;
PSQL
FOREIGN_ASSET=$(psqlc "select id from assets where organization_id='$ORG2' and asset_tag='S5C-FGN'")
test -n "$FOREIGN_ASSET"

# ── Idempotent re-run. Fixture keys are kept SHORT on purpose — long fixture
# identifiers have been read as secrets by the repository's scanner and have
# blocked merges. The cleanup deletes exactly the prefixes this script WRITES;
# a cleanup matching a prefix the script no longer writes is how slice 4C's
# transcript stopped being re-runnable.
#
# Thread objects, hops, versions and receipts are NOT deleted directly: every
# one of those tables refuses DELETE for every caller, this script included.
# They go when the case goes, through the declared cascade the walls admit
# mid-cascade. If a cascade ever stops working, the assertions below fail
# loudly rather than leaving stale fixtures that quietly change every count.
#
# The capital project step 10(j) deletes goes here too, for the run that dies
# between creating it and cascading it away: it owns that block's requirement
# and its acceptance test, whose refs are unique per tenant, so a leftover
# project is the one thing that would make the second run collide.
psqlc "delete from development_cases where organization_id='$ORG' and title like 'S5C %';" >/dev/null
psqlc "delete from capital_projects where organization_id='$ORG' and project_code like 'S5C-%';" >/dev/null
test "$(psqlc "select count(*) from thread_objects where organization_id='$ORG' and object_ref like 'S5C-%'")" = "0"
test "$(psqlc "select count(*) from design_requirements where organization_id='$ORG' and requirement_ref like 'S5C-%'")" = "0"
test "$(psqlc "select count(*) from acceptance_tests where organization_id='$ORG' and test_ref like 'S5C-%'")" = "0"
test "$(psqlc "select count(*) from thread_links where organization_id='$ORG'")" = "$(psqlc "select count(*) from thread_links l join development_cases c on c.id=l.development_case_id where l.organization_id='$ORG'")"
psqlc "delete from asset_dependencies where organization_id='$ORG'
        and dependent_asset_id in (select id from assets where organization_id='$ORG' and asset_tag like 'S5C-%');" >/dev/null
psqlc "delete from assets where organization_id='$ORG' and asset_tag like 'S5C-%';" >/dev/null

# Two assets and ONE recorded dependency between them, so step 8 can prove the
# thread graph and the asset graph are one graph rather than two.
psqlc "insert into assets (organization_id, asset_tag, name, criticality)
       values ('$ORG','S5C-A1','Thickener underflow pump','high'),
              ('$ORG','S5C-A2','Underflow sampler','low');" >/dev/null
A1=$(psqlc "select id from assets where organization_id='$ORG' and asset_tag='S5C-A1'")
A2=$(psqlc "select id from assets where organization_id='$ORG' and asset_tag='S5C-A2'")
test -n "$A1"; test -n "$A2"
psqlc "insert into asset_dependencies (organization_id, dependent_asset_id, supplier_asset_id, dependency_kind, evidence, source)
       values ('$ORG','$A2','$A1','functional','S5C fixture edge','human');" >/dev/null

echo "── 1. the Asset is the ONE anchor (D11.19) ──────────────────────────────"

R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S5C thread case\",\"p_problem_statement\":\"The underflow package documentation is scattered across four systems and nobody can say which drawing revision the fabricator built to.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE=$(printf '%s' "$R" | field case_id); test -n "$CASE"

# An UNANCHORED object is not registrable. This is the rule the whole
# continuity invariant is built on, so it is refused at the door by name.
R=$(rpc "$PLANNER" register_thread_object "{\"p_case_id\":\"$CASE\",\"p_object\":{\"object_kind\":\"drawing\",\"object_ref\":\"S5C-X1\",\"title\":\"Unanchored drawing\"}}")
expect_err "$R" 'name the asset this object hangs from'

# An anchor in ANOTHER tenant is not an anchor.
R=$(rpc "$PLANNER" register_thread_object "{\"p_case_id\":\"$CASE\",\"p_object\":{\"object_kind\":\"drawing\",\"object_ref\":\"S5C-X2\",\"title\":\"Cross tenant anchor\",\"anchor_asset_id\":\"$FOREIGN_ASSET\"}}")
expect_err "$R" 'not in this organization'

# A `requirement` object names the row in the ONE requirement store; it never
# holds a second copy of it.
R=$(rpc "$PLANNER" register_thread_object "{\"p_case_id\":\"$CASE\",\"p_object\":{\"object_kind\":\"requirement\",\"object_ref\":\"S5C-X3\",\"title\":\"Requirement with no row behind it\",\"anchor_asset_id\":\"$A1\"}}")
expect_err "$R" 'names the requirement it IS'
# ...and only that kind carries the pointer.
R=$(rpc "$PLANNER" register_thread_object "{\"p_case_id\":\"$CASE\",\"p_object\":{\"object_kind\":\"drawing\",\"object_ref\":\"S5C-X4\",\"title\":\"Drawing wearing a requirement id\",\"anchor_asset_id\":\"$A1\",\"requirement_id\":1}}")
expect_err "$R" 'only a `requirement` object carries requirement_id'

# §26's enterprise identity, on the ONE asset row.
R=$(rpc "$PLANNER" set_asset_enterprise_identity "{\"p_asset_id\":\"$A1\",\"p_enterprise_asset_id\":\"S5C-EAM-1\",\"p_functional_location\":\"PL1-AR2-UN3-SY4\"}")
noerr "$R"
test "$(psqlc "select enterprise_asset_id from assets where id='$A1'")" = "S5C-EAM-1"
test "$(psqlc "select functional_location from assets where id='$A1'")" = "PL1-AR2-UN3-SY4"
# One enterprise identity names one asset.
R=$(rpc "$PLANNER" set_asset_enterprise_identity "{\"p_asset_id\":\"$A2\",\"p_enterprise_asset_id\":\"S5C-EAM-1\",\"p_functional_location\":null}")
expect_err "$R" 'already belongs to'
# ...and it is not re-pointed once recorded.
R=$(rpc "$PLANNER" set_asset_enterprise_identity "{\"p_asset_id\":\"$A1\",\"p_enterprise_asset_id\":\"S5C-EAM-9\",\"p_functional_location\":null}")
expect_err "$R" 'already registered as'
# There is no second asset table, and this is the assertion that says so.
test "$(psqlc "select count(*) from information_schema.tables where table_schema='public' and table_name in ('thread_assets','cde_assets','digital_thread_assets')")" = "0"

echo "── 2. the CDE link model (D11.05) ───────────────────────────────────────"

reg(){ # kind ref title -> id
  local r; r=$(rpc "$PLANNER" register_thread_object "{\"p_case_id\":\"$CASE\",\"p_object\":{\"object_kind\":\"$1\",\"object_ref\":\"$2\",\"title\":\"$3\",\"anchor_asset_id\":\"$A1\"}}")
  noerr "$r"; printf '%s' "$r" | field object_id
}
TAG=$(reg tag 'S5C-TG1' 'Underflow pump tag'); test -n "$TAG"
ES=$(reg equipment_specification 'S5C-ES1' 'Underflow pump datasheet'); test -n "$ES"
DR=$(reg drawing 'S5C-DR1' 'Underflow general arrangement'); test -n "$DR"
PO=$(reg procurement_item 'S5C-PO1' 'Underflow pump purchase line'); test -n "$PO"
EQ=$(reg installed_equipment 'S5C-EQ1' 'Underflow pump as installed'); test -n "$EQ"

# The chain positions this slice pins: tag 2, equipment specification 3,
# drawing 5, procurement item 6, installed equipment 7.
test "$(psqlc "select sync_thread_chain_position('tag')")" = "2"
test "$(psqlc "select sync_thread_chain_position('operating_history')")" = "10"
test -z "$(psqlc "select coalesce(sync_thread_chain_position('neo4j_node')::text,'')")"

link(){ # up down type basis
  local r; r=$(rpc "$PLANNER" link_thread_objects "{\"p_upstream_id\":$1,\"p_downstream_id\":$2,\"p_link_type\":\"$3\",\"p_basis\":\"$4\"}")
  noerr "$r"; printf '%s' "$r" | field link_id
}
L1=$(link "$TAG" "$ES" identifies 'The tag names the equipment this datasheet describes'); test -n "$L1"
# 3 -> 5: this hop SKIPS the vendor document. Legal, and reported as a gap.
L2=$(link "$ES" "$DR" specifies 'The general arrangement is drawn from this datasheet'); test -n "$L2"
L3=$(link "$DR" "$PO" procures 'The purchase line was raised against this arrangement'); test -n "$L3"
L4=$(link "$PO" "$EQ" becomes 'The pump delivered on this purchase line is the one installed'); test -n "$L4"

R=$(rpc "$PLANNER" link_thread_objects "{\"p_upstream_id\":$ES,\"p_downstream_id\":$DR,\"p_link_type\":\"documents\",\"p_basis\":\"short\"}")
expect_err "$R" 'state why this hop holds'

# BACKWARD, at the door…
R=$(rpc "$PLANNER" link_thread_objects "{\"p_upstream_id\":$EQ,\"p_downstream_id\":$TAG,\"p_link_type\":\"identifies\",\"p_basis\":\"A hop that runs against the specification chain\"}")
expect_err "$R" 'runs forward along the spec II.2 chain'
# …and at the wall, for a caller with RLS switched off entirely.
OUT=$(sql_must_fail "insert into thread_links (organization_id, development_case_id, upstream_object_id, downstream_object_id, link_type, basis, linked_by)
  values ('$ORG','$CASE',$EQ,$TAG,'identifies','A backward hop written straight past the door','$PLANNER_ID');")
grep -q 'runs forward' <<<"$OUT"

echo "── 3. the authoritative version (D11.06) ────────────────────────────────"

ver(){ # object_id label summary -> version id
  local r
  if [ -z "${3:-}" ]; then
    r=$(rpc "$PLANNER" record_thread_version "{\"p_object_id\":$1,\"p_version\":{\"version_label\":\"$2\"}}")
  else
    r=$(rpc "$PLANNER" record_thread_version "{\"p_object_id\":$1,\"p_version\":{\"version_label\":\"$2\",\"change_summary\":\"$3\"}}")
  fi
  noerr "$r"; printf '%s' "$r" | field version_id
}
declare_ver(){ rpc "$MANAGER" declare_thread_version_authoritative "{\"p_version_id\":$1,\"p_basis\":\"$2\"}"; }

TAG_A=$(ver "$TAG" 'Rev A'); ES_A=$(ver "$ES" 'Rev A'); DR_A=$(ver "$DR" 'Rev A')
PO_A=$(ver "$PO" 'Rev 1'); EQ_A=$(ver "$EQ" 'Rev 1')
# Recording is NOT releasing.
test "$(psqlc "select status from thread_object_versions where id=$ES_A")" = "draft"
R=$(rpc "$PLANNER" resolve_thread_authoritative_version "{\"p_object_id\":$ES}")
test "$(jqp "$R" "x['resolved']")" = "False"
grep -q 'NONE has been declared authoritative' <<<"$(jqp "$R" "x['refusal']")"

for V in "$TAG_A" "$ES_A" "$DR_A" "$PO_A" "$EQ_A"; do
  R=$(declare_ver "$V" 'Checked against the approved datasheet by the responsible engineer')
  noerr "$R"
  test "$(jqp "$R" "x['firstIssue']")" = "True"
done
R=$(rpc "$PLANNER" resolve_thread_authoritative_version "{\"p_object_id\":$ES}")
test "$(jqp "$R" "x['resolved']")" = "True"
test "$(jqp "$R" "x['versionLabel']")" = "Rev A"

# A supersession with no statement of what changed is refused BEFORE it happens.
ES_B=$(ver "$ES" 'Rev B')
R=$(declare_ver "$ES_B" 'Second issue of the underflow pump datasheet, checked')
expect_err "$R" 'has no statement of what changed'
test "$(psqlc "select status from thread_object_versions where id=$ES_B")" = "draft"

# The release that DOES supersede, with both pointers written.
ES_C=$(ver "$ES" 'Rev C' 'Design pressure raised from 12 to 16 barg after the surge study')
R=$(declare_ver "$ES_C" 'Reissued after the surge study, checked by the process engineer')
noerr "$R"
test "$(jqp "$R" "x['firstIssue']")" = "False"
test "$(jqp "$R" "x['supersededVersionLabel']")" = "Rev A"
test "$(psqlc "select status from thread_object_versions where id=$ES_A")" = "superseded"
test "$(psqlc "select superseded_by_version_id from thread_object_versions where id=$ES_A")" = "$ES_C"
test "$(psqlc "select supersedes_version_id from thread_object_versions where id=$ES_C")" = "$ES_A"
# EXACTLY ONE authoritative revision — held by a partial unique index, not a
# report, so it survives two people releasing at once.
test "$(psqlc "select count(*) from thread_object_versions where thread_object_id=$ES and status='authoritative'")" = "1"
OUT=$(sql_must_fail "insert into thread_object_versions (organization_id, development_case_id, thread_object_id, version_label, status, declared_by, declared_at, declaration_basis, recorded_by)
  values ('$ORG','$CASE',$ES,'Rev Z','authoritative','$PLANNER_ID',now(),'A second current revision written straight past the door','$PLANNER_ID');")
grep -q 'idx_thread_version_one_authoritative' <<<"$OUT"
# A superseded revision stays superseded — refused at the door…
R=$(declare_ver "$ES_A" 'Putting the superseded revision back without saying the project went back')
expect_err "$R" 'was superseded'
# …and at the wall, where the marker guard catches it first: a status moved by
# a raw UPDATE never reaches the recorded act at all.
OUT=$(sql_must_fail "update thread_object_versions set status='draft', superseded_by_version_id=null where id=$ES_A;")
grep -q 'declare_thread_version_authoritative' <<<"$OUT"
# What a revision IS cannot be rewritten by any caller.
OUT=$(sql_must_fail "update thread_object_versions set version_label='Rev Q' where id=$ES_C;")
grep -q 'cannot be rewritten by any caller' <<<"$OUT"

echo "── 4. §70 — no machine declares, links, severs or acknowledges ──────────"

R=$(rpc "$AIBOT" declare_thread_version_authoritative "{\"p_version_id\":$ES_B,\"p_basis\":\"A machine declaring the revision to build from\"}")
expect_err "$R" 'cannot declare a revision authoritative'
R=$(rpc "$AIBOT" sever_thread_link "{\"p_link_id\":$L3,\"p_reason\":\"A machine deciding a hop no longer holds\"}")
expect_err "$R" 'cannot sever a thread link'
R=$(rpc "$AIBOT" retire_thread_object "{\"p_object_id\":$DR,\"p_reason\":\"A machine taking an object out of the thread\"}")
expect_err "$R" 'cannot retire a thread object'
R=$(rpc "$AIBOT" reanchor_thread_object "{\"p_object_id\":$DR,\"p_new_asset_id\":\"$A2\",\"p_reason\":\"A machine moving what the thread hangs from\"}")
expect_err "$R" 'cannot move a thread object'

# At the WALL, for a caller with no JWT and RLS switched off.
OUT=$(sql_must_fail "insert into thread_objects (organization_id, development_case_id, object_kind, object_ref, title, anchor_asset_id, registered_by)
  values ('$ORG','$CASE','drawing','S5C-BOT','Registered by a machine','$A1','$AIBOT_ID');")
grep -q 'AI-operator identity cannot' <<<"$OUT"
OUT=$(sql_must_fail "insert into thread_links (organization_id, development_case_id, upstream_object_id, downstream_object_id, link_type, basis, linked_by)
  values ('$ORG','$CASE',$TAG,$ES,'specifies','A hop asserted by a machine rather than an engineer','$AIBOT_ID');")
grep -q 'AI-operator identity cannot' <<<"$OUT"
OUT=$(sql_must_fail "insert into thread_object_versions (organization_id, development_case_id, thread_object_id, version_label, status, declared_by, declared_at, declaration_basis, recorded_by)
  values ('$ORG','$CASE',$DR,'Rev BOT','authoritative','$AIBOT_ID',now(),'A machine releasing a drawing','$PLANNER_ID');")
grep -q 'AI-operator identity cannot' <<<"$OUT"

echo "── 5. the continuity invariant (D11.20) ────────────────────────────────"

# (3) SILENT SEVERANCE — refused on every table, for every caller.
OUT=$(sql_must_fail "delete from thread_objects where id=$DR;")
grep -q 'A thread object is not deleted' <<<"$OUT"
OUT=$(sql_must_fail "delete from thread_links where id=$L3;")
grep -q 'A thread link is not deleted' <<<"$OUT"
OUT=$(sql_must_fail "delete from thread_object_versions where id=$DR_A;")
grep -q 'not deleted' <<<"$OUT"
OUT=$(sql_must_fail "truncate table thread_severances;")
grep -q 'not truncatable' <<<"$OUT"
# CASCADE, deliberately: a plain TRUNCATE of thread_objects is refused by the
# foreign keys pointing at it before any trigger runs, which would prove the
# FKs rather than the guard. CASCADE gets past that and the statement trigger
# is what refuses.
OUT=$(sql_must_fail "truncate table thread_objects cascade;")
grep -q 'not truncatable' <<<"$OUT"
OUT=$(sql_must_fail "truncate table thread_links;")
grep -q 'not truncatable' <<<"$OUT"

# (1) ANCHOR LOSS — the anchor does not move by UPDATE, and does not move with
# nobody named on it.
OUT=$(sql_must_fail "update thread_objects set anchor_asset_id='$A2' where id=$DR;")
grep -q 'anchor is not moved by an UPDATE' <<<"$OUT"
# ...and the asset that anchors LIVE objects cannot be deleted at all.
OUT=$(sql_must_fail "delete from assets where id='$A1';")
grep -q 'anchors' <<<"$OUT"
grep -q 'retire_thread_object' <<<"$OUT"

# A retirement or a severance done by flipping a column is refused.
OUT=$(sql_must_fail "update thread_objects set status='retired', retired_at=now(), retired_by='$PLANNER_ID', retired_reason='Retired by a column move rather than the recorded act' where id=$DR;")
grep -q 'retire_thread_object' <<<"$OUT"
OUT=$(sql_must_fail "update thread_links set status='severed', severed_at=now(), severed_by='$PLANNER_ID', severance_reason='Severed by a column move rather than the recorded act' where id=$L3;")
grep -q 'sever_thread_link' <<<"$OUT"

# THE PERMITTED SEVERANCES, each one RECORDED. Deltas, because the ledger does
# not cascade with the case.
VD=$(reg vendor_document 'S5C-VD1' 'Underflow pump vendor data book'); test -n "$VD"
LV=$(link "$ES" "$VD" documents 'The vendor data book was issued against this datasheet'); test -n "$LV"

BEFORE=$(sevcount)
R=$(rpc "$PLANNER" sever_thread_link "{\"p_link_id\":$LV,\"p_reason\":\"The vendor data book was reissued against the replacement datasheet\"}")
noerr "$R"
test "$(sevcount)" = "$((BEFORE + 1))"
test "$(psqlc "select route from thread_severances where organization_id='$ORG' order by id desc limit 1")" = "link_severed"
test "$(psqlc "select status from thread_links where id=$LV")" = "severed"
# A severed hop is not un-severed by a column move.
OUT=$(sql_must_fail "update thread_links set status='live', severed_at=null, severed_by=null, severance_reason=null where id=$LV;")
grep -q 'sever_thread_link' <<<"$OUT"
# A reason is not optional.
R=$(rpc "$PLANNER" sever_thread_link "{\"p_link_id\":$L4,\"p_reason\":\"too short\"}")
expect_err "$R" '20 characters minimum'

# Retiring an object severs every live hop touching it, in the same
# transaction, and records ONE severance carrying the count.
LV2=$(link "$ES" "$VD" identifies 'A second hop onto the vendor data book, to be cut by the retirement'); test -n "$LV2"
BEFORE=$(sevcount)
R=$(rpc "$PLANNER" retire_thread_object "{\"p_object_id\":$VD,\"p_reason\":\"The vendor data book belongs to the superseded pump selection\"}")
noerr "$R"
test "$(jqp "$R" "x['linksSevered']")" = "1"
test "$(sevcount)" = "$((BEFORE + 1))"
test "$(psqlc "select status from thread_objects where id=$VD")" = "retired"
test "$(psqlc "select count(*) from thread_links where (upstream_object_id=$VD or downstream_object_id=$VD) and status='live'")" = "0"
# A retired object is not brought back by a column move.
OUT=$(sql_must_fail "update thread_objects set status='live', retired_at=null, retired_by=null, retired_reason=null where id=$VD;")
grep -q 'retire_thread_object' <<<"$OUT"
# ...and no live hop may be made onto it.
R=$(rpc "$PLANNER" link_thread_objects "{\"p_upstream_id\":$TAG,\"p_downstream_id\":$VD,\"p_link_type\":\"identifies\",\"p_basis\":\"A live hop onto an object that has left the thread\"}")
expect_err "$R" 'dangling endpoint'

# Re-anchoring keeps the asset it used to hang from.
BEFORE=$(sevcount)
R=$(rpc "$PLANNER" reanchor_thread_object "{\"p_object_id\":$TAG,\"p_new_asset_id\":\"$A2\",\"p_reason\":\"The tag was reassigned to the sampler during detailed design\"}")
noerr "$R"
test "$(sevcount)" = "$((BEFORE + 1))"
test "$(psqlc "select route from thread_severances where organization_id='$ORG' order by id desc limit 1")" = "object_reanchored"
test "$(psqlc "select subject_snapshot->>'previous_anchor_asset_id' from thread_severances where organization_id='$ORG' order by id desc limit 1")" = "$A1"
test "$(psqlc "select anchor_asset_id from thread_objects where id=$TAG")" = "$A2"
test -n "$(psqlc "select anchor_moved_by from thread_objects where id=$TAG")"
# An `installed_equipment` object IS its asset and does not move.
R=$(rpc "$PLANNER" reanchor_thread_object "{\"p_object_id\":$EQ,\"p_new_asset_id\":\"$A2\",\"p_reason\":\"Moving an object that is the asset it hangs from\"}")
expect_err "$R" 'IS its asset'

# THE INVARIANT, REPORTED: no BREAKS, and the gaps named separately.
R=$(rpc "$MANAGER" check_thread_continuity "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(jqp "$R" "x['refused']")" = "False"
test "$(jqp "$R" "x['intact']")" = "True"
test "$(jqp "$R" "len(x['breaks'])")" = "0"
test "$(jqp "$R" "len([g for g in x['gaps'] if g['kind']=='chain_skip'])")" = "1"
test "$(jqp "$R" "x['severanceCount'] >= 3")" = "True"

# ...and it REFUSES over a case with no CDE rather than reporting zero breaks.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S5C empty case\",\"p_problem_statement\":\"A case with nothing registered in the common data environment, to prove the refusal.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; EMPTY=$(printf '%s' "$R" | field case_id); test -n "$EMPTY"
R=$(rpc "$MANAGER" check_thread_continuity "{\"p_case_id\":\"$EMPTY\"}")
test "$(jqp "$R" "x['refused']")" = "True"
test "$(jqp "$R" "x['intact'] is None")" = "True"
grep -q 'indistinguishable from a perfectly maintained thread' <<<"$(jqp "$R" "x['refusal']")"

echo "── 6. change receipts (D11.07) ─────────────────────────────────────────"

# The five first issues raised NOTHING: there was no previous revision for
# anything downstream to have been built on.
test "$(psqlc "select count(*) from thread_change_receipts where source_version_id in ($TAG_A,$DR_A,$PO_A,$EQ_A)")" = "0"
# The Rev A → Rev C supersession on the datasheet raised one per downstream
# object, UNACKNOWLEDGED. Downstream of S5C-ES1: the drawing, the purchase line
# and the installed equipment.
test "$(psqlc "select count(*) from thread_change_receipts where source_version_id=$ES_C")" = "3"
test "$(psqlc "select count(*) from thread_change_receipts where source_version_id=$ES_C and status='unacknowledged'")" = "3"
test "$(psqlc "select change_summary from thread_change_receipts where source_version_id=$ES_C limit 1")" = "Design pressure raised from 12 to 16 barg after the surge study"

RCPT=$(psqlc "select id from thread_change_receipts where source_version_id=$ES_C and thread_object_id=$DR")
test -n "$RCPT"
# §42 — the person who released the revision cannot record that the downstream
# object received it. MANAGER declared it.
R=$(rpc "$MANAGER" acknowledge_thread_receipt "{\"p_receipt_id\":$RCPT,\"p_disposition\":\"acknowledged\",\"p_note\":\"The arrangement has been reissued for the new design pressure\"}")
expect_err "$R" 'you declared this revision authoritative'
# ...and at the wall, for a caller with RLS switched off.
OUT=$(sql_must_fail "update thread_change_receipts set status='acknowledged', acknowledged_by='$MANAGER_ID', acknowledged_at=now(), acknowledgement_note='Signed by the same person who sent it' where id=$RCPT;")
grep -q 'delivery confirmation the sender wrote' <<<"$OUT"
# A machine cannot answer either.
R=$(rpc "$AIBOT" acknowledge_thread_receipt "{\"p_receipt_id\":$RCPT,\"p_disposition\":\"acknowledged\",\"p_note\":\"A machine confirming a change it cannot have seen\"}")
expect_err "$R" 'cannot acknowledge a change receipt'
# A note is not optional.
R=$(rpc "$PLANNER" acknowledge_thread_receipt "{\"p_receipt_id\":$RCPT,\"p_disposition\":\"acknowledged\",\"p_note\":\"seen\"}")
expect_err "$R" '20 characters minimum'
# The real answer.
R=$(rpc "$PLANNER" acknowledge_thread_receipt "{\"p_receipt_id\":$RCPT,\"p_disposition\":\"acknowledged\",\"p_note\":\"The arrangement has been reissued at the new design pressure\"}")
noerr "$R"
test "$(psqlc "select status from thread_change_receipts where id=$RCPT")" = "acknowledged"
# Answered once.
R=$(rpc "$PLANNER" acknowledge_thread_receipt "{\"p_receipt_id\":$RCPT,\"p_disposition\":\"not_applicable\",\"p_note\":\"Changing the answer after the fact rather than raising a new one\"}")
expect_err "$R" 'already answered'
# `not_applicable` is a DISTINCT state, not a synonym for acknowledged.
RCPT2=$(psqlc "select id from thread_change_receipts where source_version_id=$ES_C and thread_object_id=$PO")
R=$(rpc "$PLANNER" acknowledge_thread_receipt "{\"p_receipt_id\":$RCPT2,\"p_disposition\":\"not_applicable\",\"p_note\":\"The purchase line closed before the reissue, nothing to change\"}")
noerr "$R"
test "$(psqlc "select status from thread_change_receipts where id=$RCPT2")" = "not_applicable"
# ...and the read keeps them apart.
R=$(rpc "$MANAGER" get_case_thread_receipts "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(jqp "$R" "x['refused']")" = "False"
test "$(jqp "$R" "x['acknowledged']")" = "1"
test "$(jqp "$R" "x['notApplicable']")" = "1"
test "$(jqp "$R" "x['outstanding']")" = "1"
# The receipts read REFUSES over a case with no CDE rather than reporting zero.
R=$(rpc "$MANAGER" get_case_thread_receipts "{\"p_case_id\":\"$EMPTY\"}")
test "$(jqp "$R" "x['refused']")" = "True"
test "$(jqp "$R" "x['outstanding'] is None")" = "True"
# A receipt is not deleted; an unanswered one is the finding.
RCPT3=$(psqlc "select id from thread_change_receipts where source_version_id=$ES_C and thread_object_id=$EQ")
OUT=$(sql_must_fail "delete from thread_change_receipts where id=$RCPT3;")
grep -q 'A change receipt is not deleted' <<<"$OUT"

echo "── 7. the traversal refuses rather than under-reporting (D11.07) ───────"

# An object with no live hop leaving it: REFUSED, and never "0 downstream".
R=$(rpc "$MANAGER" get_case_thread_impact "{\"p_case_id\":\"$CASE\",\"p_object_id\":$EQ}")
test "$(jqp "$R" "x['refused']")" = "True"
test "$(jqp "$R" "x['downstreamCount'] is None")" = "True"
grep -q 'it is unassessed' <<<"$(jqp "$R" "x['refusal']")"

# A traversal that crosses the datasheet → drawing SKIP: refused, gap named,
# count NULL even though it reached objects.
R=$(rpc "$MANAGER" get_case_thread_impact "{\"p_case_id\":\"$CASE\",\"p_object_id\":$ES}")
test "$(jqp "$R" "x['refused']")" = "True"
test "$(jqp "$R" "x['downstreamCount'] is None")" = "True"
test "$(jqp "$R" "x['reachedCount'] >= 3")" = "True"
test "$(jqp "$R" "len([g for g in x['gaps'] if g['kind']=='chain_skip'])")" = "1"
grep -q 'a floor and not the affected set' <<<"$(jqp "$R" "x['refusal']")"

# A clean one: drawing → purchase line → installed equipment, adjacent hops,
# every object released.
R=$(rpc "$MANAGER" get_case_thread_impact "{\"p_case_id\":\"$CASE\",\"p_object_id\":$DR}")
noerr "$R"
test "$(jqp "$R" "x['refused']")" = "False"
test "$(jqp "$R" "x['downstreamCount']")" = "2"
test "$(jqp "$R" "len(x['gaps'])")" = "0"
test "$(jqp "$R" "sorted([a['objectRef'] for a in x['affected']])")" = "['S5C-EQ1', 'S5C-PO1']"

echo "── 8. ONE graph, and §34's nineteen (D11.21) ───────────────────────────"

R=$(rpc "$MANAGER" get_case_thread_graph "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(jqp "$R" "x['refused']")" = "False"
test "$(jqp "$R" "len(x['spec34Edges'])")" = "19"
# THREE, not five (corrected 2026-09-01 by 20261207090300, and again
# 2026-09-03 by 20261210090100). This transcript asserted five because this
# slice's ledger said five — and one of them, Benefit MEASURES Objective, was
# already built: `value_metrics.objective_id` has existed since Slice 2
# (20261115090600) and register row D9.10 is ✅ and names this edge. The claim
# was prose that nothing checked, and it survived a slice.
# sync_spec34_absent_edge_audit() now asks the catalogue instead, and Slice 7A
# built the second one: §27's WorkPackage and §28's Constraint both exist and
# the constraint store names the canonical work identity directly, which is the
# exact condition that audit stated. This assertion goes DOWN when an endpoint
# is built, which is what its own note said it was for.
test "$(jqp "$R" "len([e for e in x['spec34Edges'] if e['status']=='absent'])")" = "3"
# …and the count is not trusted on its own: the three that remain are NAMED, so
# a different edge going quiet cannot be absorbed by the same number.
test "$(jqp "$R" "sorted(e['edge'] for e in x['spec34Edges'] if e['status']=='absent')")" = "['Asset SUPPORTS Objective', 'Contract PROVIDES Asset', 'Lesson APPLIES_TO AssetClass']"
test "$(jqp "$R" "[e['status'] for e in x['spec34Edges'] if e['edge']=='WorkPackage DEPENDS_ON Constraint'][0]")" = "live_elsewhere"
test "$(jqp "$R" "len([e for e in x['spec34Edges'] if e['status']=='live_on_thread']) >= 2")" = "True"
# The edges this read did NOT compute say so instead of reporting zero.
test "$(jqp "$R" "all(e.get('caseCount') is None for e in x['spec34Edges'] if e['status']=='live_elsewhere')")" = "True"
# ONE graph: thread hops, anchor edges, and the recorded asset dependency
# between the two fixture assets, in one node space.
test "$(jqp "$R" "x['threadEdgeCount'] >= 4")" = "True"
test "$(jqp "$R" "x['anchorEdgeCount'] >= 5")" = "True"
test "$(jqp "$R" "x['assetEdgeCount'] >= 1")" = "True"
# NO edge whose far endpoint is missing from `nodes` — a synthesised node
# carries no criticality, and the shared traversal reads criticality.
DANGLING=$(jqp "$R" "len([e for e in x['graph']['edges'] if e['dependent'] not in [n['id'] for n in x['graph']['nodes']] or e['supplier'] not in [n['id'] for n in x['graph']['nodes']]])")
test "$DANGLING" = "0"
test "$(jqp "$R" "[n['name'] for n in x['graph']['nodes'] if n['id']=='$A1'][0]")" = "Thickener underflow pump"
test "$(jqp "$R" "[n['criticality'] for n in x['graph']['nodes'] if n['id']=='$A1'][0]")" = "high"
# The asset the thread hangs from is a SUPPLIER of its objects, so losing it
# takes them with it on the SHARED traversal.
test "$(jqp "$R" "len([e for e in x['graph']['edges'] if e['source']=='thread_anchor' and e['supplier']=='$A1']) >= 3")" = "True"
# ...and the empty case refuses rather than drawing a clean picture.
R=$(rpc "$MANAGER" get_case_thread_graph "{\"p_case_id\":\"$EMPTY\"}")
test "$(jqp "$R" "x['refused']")" = "True"
grep -q 'an unmapped plant has none' <<<"$(jqp "$R" "x['refusal']")"

echo "── 9. cross-tenant ─────────────────────────────────────────────────────"

FGN=$(token 'smoke5c-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FGN"
R=$(rpc "$FGN" get_case_thread_graph "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'not found'
R=$(rpc "$FGN" check_thread_continuity "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'not found'
R=$(rpc "$FGN" get_case_thread_receipts "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'not found'
R=$(rpc "$FGN" get_case_thread_severances "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'not found'
R=$(rpc "$FGN" get_case_thread_impact "{\"p_case_id\":\"$CASE\",\"p_object_id\":$DR}")
expect_err "$R" 'not found'
R=$(rpc "$FGN" resolve_thread_authoritative_version "{\"p_object_id\":$ES}")
expect_err "$R" 'not found'
R=$(rpc "$FGN" retire_thread_object "{\"p_object_id\":$DR,\"p_reason\":\"Retiring an object in somebody else s tenant\"}")
expect_err "$R" 'not found'

# The severance ledger is readable in its own tenant, and says which severances
# a person decided on and which a cascade caused.
R=$(rpc "$MANAGER" get_case_thread_severances "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(jqp "$R" "x['refused']")" = "False"
test "$(jqp "$R" "all(s['byAPerson'] for s in x['severances'])")" = "True"
test "$(jqp "$R" "x['total'] >= 3")" = "True"
# ...and REFUSES over a case with no CDE rather than saying nothing was cut.
R=$(rpc "$MANAGER" get_case_thread_severances "{\"p_case_id\":\"$EMPTY\"}")
test "$(jqp "$R" "x['refused']")" = "True"
test "$(jqp "$R" "x['total'] is None")" = "True"
# The tenant-scoped ledger is readable and stays in tenant.
R=$(rpc "$MANAGER" get_org_thread_severances "{\"p_limit\":50}")
noerr "$R"
test "$(jqp "$R" "x['total'] >= 3")" = "True"
R=$(rpc "$FGN" get_org_thread_severances "{\"p_limit\":50}")
noerr "$R"
test "$(jqp "$R" "x['total']")" = "0"

echo "── 10. REPAIR PASS — the defects adversarial review found ──────────────"

# (a) A receipt cannot be answered by NOBODY. The single-conjunction CHECK let
#     status='acknowledged' through with a NULL actor, which is an early return
#     in the §70 wall and skips the §42 check entirely.
OUT=$(sql_must_fail "update thread_change_receipts set status='acknowledged', acknowledged_at=now(), acknowledged_by=null, acknowledgement_note='Answered by nobody at all, in one statement' where id=$RCPT;")
grep -q 'thread_receipt_answered_by\|violates check constraint' <<<"$OUT"

# (b) §42 on INSERT, not only UPDATE: a receipt born answered by its declarer.
# $TAG, not a downstream object: the three real receipts already occupy
# (source_version_id, thread_object_id) for every object below the datasheet,
# and a unique violation would prove nothing about §42.
OUT=$(sql_must_fail "insert into thread_change_receipts (organization_id, development_case_id, thread_object_id, source_object_id, source_version_id, source_object_ref, source_version_label, change_summary, hops, status, acknowledged_by, acknowledged_at, acknowledgement_note) values ('$ORG','$CASE',$TAG,$ES,$ES_C,'S5C-ES1','Rev C','A receipt that signs itself on the way in',1,'acknowledged','$MANAGER_ID',now(),'Signed by the sender in the insert itself');")
grep -q 'delivery confirmation the sender wrote' <<<"$OUT"

# (c) The §26 enterprise identity is walled for EVERY caller, not only the RPC.
#     `assets` carries a permissive for-all policy, so a direct UPDATE is the
#     realistic path.
OUT=$(sql_must_fail "update assets set enterprise_asset_id='S5C-EAM-STOLEN' where id='$A1';")
grep -q 'recorded through set_asset_enterprise_identity' <<<"$OUT"
OUT=$(sql_must_fail "update assets set functional_location='PL9-OTHER' where id='$A1';")
grep -q 'recorded through set_asset_enterprise_identity' <<<"$OUT"
test "$(psqlc "select enterprise_asset_id from assets where id='$A1'")" = "S5C-EAM-1"
# ...and an anchoring asset cannot be moved to another tenant.
OUT=$(sql_must_fail "update assets set organization_id='$ORG2' where id='$A1';")
grep -q 'cannot be moved to another organization' <<<"$OUT"

# (d) The severance ledger has a door: a direct insert is refused, so a forged
#     row cannot become permanently uncorrectable behind the append-only guard.
OUT=$(sql_must_fail "insert into thread_severances (organization_id, development_case_id, route, subject_kind, subject_ref, reason, severed_by) values ('$ORG','$CASE','link_severed','thread_link','S5C forged','A severance nobody performed, naming a real engineer','$PLANNER_ID');")
grep -q 'ONE insert site' <<<"$OUT"
# ...and record_thread_severance is not callable by anybody but the walls.
test "$(psqlc "select has_function_privilege('service_role','public.record_thread_severance(uuid,uuid,text,text,text,jsonb,int,text,uuid)','execute')")" = "f"
test "$(psqlc "select has_function_privilege('authenticated','public.record_thread_severance(uuid,uuid,text,text,text,jsonb,int,text,uuid)','execute')")" = "f"

# (e) A released revision is immutable in what it SAYS, not only in its label.
OUT=$(sql_must_fail "update thread_object_versions set content_ref='a sheet nobody released' where id=$ES_C;")
grep -q 'A released revision is not edited' <<<"$OUT"

# (f) A retired object has no current revision. Retiring never touched the
#     version rows, so the incumbent stayed `authoritative` for ever.
R=$(rpc "$PLANNER" retire_thread_object "{\"p_object_id\":$PO,\"p_reason\":\"The purchase line belongs to the superseded pump selection\"}")
noerr "$R"
R=$(rpc "$MANAGER" resolve_thread_authoritative_version "{\"p_object_id\":$PO}")
test "$(jqp "$R" "x['resolved']")" = "False"
test "$(jqp "$R" "x['objectStatus']")" = "retired"
grep -q 'RETIRED' <<<"$(jqp "$R" "x['refusal']")"
# ...and the same state is a GAP on the case, never a break.
R=$(rpc "$MANAGER" check_thread_continuity "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "x['intact']")" = "True"
test "$(jqp "$R" "len([g for g in x['gaps'] if g['kind']=='retired_object_holds_released_version']) >= 1")" = "True"

# (g) The impact traversal REFUSES over a hop it cannot see. Retiring S5C-PO1
#     severed its hops and recorded them; a traversal from the datasheet must
#     now name that rather than reporting the smaller reachable set as complete.
R=$(rpc "$MANAGER" get_case_thread_impact "{\"p_case_id\":\"$CASE\",\"p_object_id\":$ES}")
test "$(jqp "$R" "x['refused']")" = "True"
test "$(jqp "$R" "x['downstreamCount'] is None")" = "True"
test "$(jqp "$R" "len([g for g in x['gaps'] if g['kind'] in ('severed_hop_out_of_region','retired_object_in_path')]) >= 1")" = "True"

# (h) The drafts the release act needs are on the wire, by id.
R=$(rpc "$MANAGER" get_case_thread_graph "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(jqp "$R" "all('drafts' in o for o in x['objects'])")" = "True"
test "$(jqp "$R" "all(isinstance(o['drafts'], list) for o in x['objects'])")" = "True"
# ...and every live thread hop carries the id severThreadLink takes.
test "$(jqp "$R" "all(e.get('linkId') for e in x['graph']['edges'] if e['source']=='thread_link')")" = "True"
# The absent count in the prose is COMPUTED, so it cannot drift from the array.
ABSENT=$(jqp "$R" "len([e for e in x['spec34Edges'] if e['status']=='absent'])")
grep -q "$ABSENT are ABSENT" <<<"$(jqp "$R" "x['note']")"

# (i) The receipts read distinguishes the two zeros and marks a gapped region.
R=$(rpc "$MANAGER" get_case_thread_receipts "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(jqp "$R" "x['supersessions'] >= 1")" = "True"
test "$(jqp "$R" "all('regionGapped' in r for r in x['receipts'])")" = "True"
test "$(jqp "$R" "x['raisedOverAGappedRegion'] >= 1")" = "True"

# (j) THE FIFTH SEVERANCE ROUTE — `canonical_cascade` — driven by the act that
#     actually reaches it. A thread object of kind `requirement` or
#     `commissioning_test` IS a row in design_requirements / acceptance_tests
#     (ruling 5C-R5: registering is not copying), and BOTH of those tables
#     cascade from capital_projects. So the operator act behind this route is
#     `delete from capital_projects` — a project cancelled or unwound — and the
#     thread objects that WERE its requirements and its acceptance tests go
#     with it while the case, the organization and the anchoring asset are all
#     still standing. Before the repair the object wall refused there, which
#     made a capital project undeletable and explained the refusal with a
#     sentence about digital-thread objects the operator never named.
#
#     This block used to try to reach the route by deleting the
#     design_requirements row itself. That could never have worked: slice 5A
#     refuses a requirement DELETE by name — a requirement is WAIVED, never
#     deleted, because deleting it removes it from the numerator AND the
#     denominator, so coverage IMPROVES and every verification recorded against
#     it disappears with it. The refusal is ASSERTED below rather than removed:
#     it is the reason the route has to be driven from the parent, and if it
#     ever stopped holding, this transcript would be the thing that noticed.
#
# `psql -tAc` prints the command tag for a data-modifying statement, so a bare
# INSERT ... RETURNING yields "9\nINSERT 0 1" — the id would land in the JSON
# below with a newline and a word after it. Every other smoke here wraps such
# an insert in a CTE for exactly that reason; this one did not, and the
# register call died on PGRST102 "Empty or invalid json" the first time it was
# ever executed. The project, its requirement and its acceptance test are all
# created fresh each run and all three go in the cascade this block performs;
# the cleanup at the top removes the leftovers of a run that died in between.
PROJ=$(psqlc "with p as (
                insert into capital_projects (organization_id, project_code, title, status)
                values ('$ORG','S5C-P1','S5C underflow package, later cancelled','active')
                returning id
              ) select id from p")
test -n "$PROJ"
REQ_ID=$(psqlc "with r as (
                  insert into design_requirements (organization_id, project_id, development_case_id, requirement_ref, category, requirement, source)
                  values ('$ORG',$PROJ,'$CASE','S5C-RQ1','reliability','The pump shall achieve 8000 hours mean time between failures in underflow duty.','engineering')
                  returning id
                ) select id from r")
test -n "$REQ_ID"
TEST_ID=$(psqlc "with t as (
                  insert into acceptance_tests (organization_id, project_id, test_ref, test_stage)
                  values ('$ORG',$PROJ,'S5C-AT1','site_acceptance')
                  returning id
                ) select id from t")
test -n "$TEST_ID"

R=$(rpc "$PLANNER" register_thread_object "{\"p_case_id\":\"$CASE\",\"p_object\":{\"object_kind\":\"requirement\",\"object_ref\":\"S5C-RQ1\",\"title\":\"Underflow pump reliability requirement\",\"anchor_asset_id\":\"$A1\",\"requirement_id\":$REQ_ID}}")
noerr "$R"; RQ=$(printf '%s' "$R" | field object_id); test -n "$RQ"
test "$(printf '%s' "$R" | field canonicalHome)" = "design_requirements"
R=$(rpc "$PLANNER" register_thread_object "{\"p_case_id\":\"$CASE\",\"p_object\":{\"object_kind\":\"commissioning_test\",\"object_ref\":\"S5C-AT1\",\"title\":\"Underflow pump site acceptance test\",\"anchor_asset_id\":\"$A1\",\"commissioning_test_id\":$TEST_ID}}")
noerr "$R"; CT=$(printf '%s' "$R" | field object_id); test -n "$CT"
test "$(printf '%s' "$R" | field canonicalHome)" = "acceptance_tests"
# One live hop out of the requirement onto an object that SURVIVES the cascade,
# so links_severed below is a real count and not a zero that would pass either
# way. Position 1 -> position 2, so it runs forward.
LRQ=$(link "$RQ" "$TAG" specifies 'The reliability requirement is what this tag was raised to satisfy'); test -n "$LRQ"

# The 5A rule, still holding, on the row this route is about to lose anyway.
OUT=$(sql_must_fail "delete from design_requirements where id=$REQ_ID;")
grep -q 'A requirement is not deleted' <<<"$OUT"
test "$(psqlc "select count(*) from thread_objects where id=$RQ")" = "1"

SEVBEFORE=$(sevcount)
CANONBEFORE=$(psqlc "select count(*) from thread_severances where organization_id='$ORG' and route='canonical_cascade'")
# The operator deletes the PROJECT. Nothing here names a thread object.
psqlc "delete from capital_projects where id=$PROJ;" >/dev/null

# The canonical rows went with their project…
test "$(psqlc "select count(*) from design_requirements where id=$REQ_ID")" = "0"
test "$(psqlc "select count(*) from acceptance_tests where id=$TEST_ID")" = "0"
# …the two thread objects that WERE those rows went with them, and the hop out
# of the requirement went too…
test "$(psqlc "select count(*) from thread_objects where id in ($RQ,$CT)")" = "0"
test "$(psqlc "select count(*) from thread_links where id=$LRQ")" = "0"
# …and this was NOT a case cascade wearing another name: the case, the tenant
# and the anchoring asset are all still there.
test "$(psqlc "select count(*) from development_cases where id='$CASE'")" = "1"
test "$(psqlc "select count(*) from assets where id='$A1'")" = "1"
test "$(psqlc "select count(*) from thread_objects where id=$TAG")" = "1"
# …so each lost object is on the record as a canonical_cascade, not as silence.
test "$(psqlc "select count(*) from thread_severances where organization_id='$ORG' and route='canonical_cascade'")" = "$((CANONBEFORE + 2))"
test "$(sevcount)" = "$((SEVBEFORE + 2))"
canon(){ psqlc "select $1 from thread_severances where organization_id='$ORG' and route='canonical_cascade' and subject_ref='$2' order by id desc limit 1"; }
# RECORDED ALSO MEANS READABLE: the case is stamped, so the person looking
# afterwards can find these rows from the case they were lost from.
test "$(canon development_case_id 'requirement S5C-RQ1')" = "$CASE"
test "$(canon development_case_id 'commissioning_test S5C-AT1')" = "$CASE"
# The snapshot keeps the canonical pointer of a row that no longer exists —
# the ledger carries snapshots precisely because the foreign key is gone.
test "$(canon "subject_snapshot->>'requirement_id'" 'requirement S5C-RQ1')" = "$REQ_ID"
test "$(canon "subject_snapshot->>'commissioning_test_id'" 'commissioning_test S5C-AT1')" = "$TEST_ID"
test "$(canon "subject_snapshot->>'anchor_asset_id'" 'requirement S5C-RQ1')" = "$A1"
# …and it counted what it took with it.
test "$(canon links_severed 'requirement S5C-RQ1')" -ge 1
grep -q 'was deleted' <<<"$(canon reason 'requirement S5C-RQ1')"

echo
echo 'Develop slice-5c smoke PASSED — every thread object resolves to one asset and one authoritative revision, a change downstream produces a receipt somebody has to answer, an impact traversal refuses over a gap rather than reporting a floor, and the thread cannot be broken silently by any caller.'

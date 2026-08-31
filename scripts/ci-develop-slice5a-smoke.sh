#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 5A — design integrity and the digital thread. Every step
# is a live transcript against a real local database.
#
# Steps:
#   1  the §10 Requirement object (D4.16): all eleven categories accepted
#      through the real write path, a category outside both vocabularies
#      refused BY NAME, an owner outside the tenant refused, and the
#      hierarchy — self-parent, cycle, cross-case parent — refused at the RPC
#      door AND at the persistence wall with RLS bypassed.
#   2  the digital thread: objective → requirement → installed asset →
#      commissioning test → operating KPI, each link refused across tenants
#      for EVERY writer; CLEARING a link refused by name while re-pointing is
#      allowed; the two spec links that are not built reported as DEFERRED
#      rather than omitted.
#   3  traceability, refusal-first: over an empty requirement set the report
#      REFUSES instead of reporting zero orphans, both coverage percentages
#      are null rather than 0 or 100, the requirement→WBS question is
#      DELEGATED to the ONE predicate, and a lineage run is recorded — for
#      the refusal as well as for the answer.
#   4  the §11 Verification object (D4.17): the five methods including
#      OPERATIONAL_VALIDATION, a measured method with no acceptance criteria
#      refused, a second open verification of the same method refused, a
#      result recorded by a named human MOVING the requirement's status, a
#      second result refused, evidence from another organization refused.
#   5  §70 at three doors and one wall: the AI-operator identity refused at
#      create_requirement_verification and record_verification_result by
#      name, and a verification attributed to it refused for EVERY writer,
#      service key and marker included; a direct UPDATE of a result refused;
#      an obligation born verified refused; DELETE and TRUNCATE refused.
#   6  the LEARN posture does not drift, and requirement obligations are
#      VISIBLE on the open-verification surface (the INNER JOIN that would
#      have dropped them).
#   7  the Requirements Agent (D12.09): five deterministic families with
#      record links, a refusal over an empty set, an AI finding whose
#      reference does not resolve DROPPED and REPORTED, `source` forced to
#      ai_suggestion in SQL, a report table with no column that could hold a
#      status, immutability, and the edge function refusing every
#      unauthenticated shape.
#
# Run: supabase start && scripts/ci-develop-slice5a-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-5a smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
ORG2='22222222-2222-2222-2222-222222222222'

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

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
# A supervisor: a role the sibling compute_case_* functions exclude, used in
# step 8g to prove this slice's compute now excludes it too.
SUPER=$(token 'supervisor@syncai.ca' 'Super123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$TECH"; test -n "$SUPER"

MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
test -n "$MANAGER_ID"; test -n "$PLANNER_ID"

# The AI-operator identity, seeded exactly as the 3B/3C/3D/4A transcripts seed
# it, so the smokes share one fixture in CI and each still stands alone.
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

# The FOREIGN tenant, provisioned by this smoke rather than borrowed from an
# earlier one. A cross-tenant negative that SKIPS when the other tenant happens
# not to exist is a negative test that passes by not running, which is the
# failure mode this suite exists to catch. It carries its own objective, asset
# and evidence item so every cross-tenant probe below has a real target.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
-- Its OWN uuid: 4A/4B/4C/4D each seed a foreign member, and reusing one of
-- their ids collides on auth.users' primary key when two smokes run in the
-- same database, which is exactly what CI does.
declare v_uid uuid := '5a5a5a5a-5555-4555-8555-5a5a5a5a5a5a';
        v_org uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into organizations (id, name) values (v_org, 'S4D foreign tenant')
    on conflict (id) do nothing;
  if not exists (select 1 from auth.users where email = 'smoke5a-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke5a-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'S5A foreign member'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  if not exists (select 1 from auth.identities where user_id = v_uid) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke5a-foreign@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_uid, v_org, 'smoke5a-foreign@syncai.ca', 'maintenance_manager')
  on conflict (id) do update set organization_id = v_org, role = 'maintenance_manager';

  if not exists (select 1 from risk_objectives where organization_id = v_org) then
    insert into risk_objectives (organization_id, owner_id, objective_level,
      description, target, measurement, timeframe, tolerance)
    values (v_org, v_uid, 'site',
      'A foreign tenant objective no requirement of ours may point at',
      'n/a', 'n/a', 'n/a', 'n/a');
  end if;
  if not exists (select 1 from assets where organization_id = v_org) then
    insert into assets (organization_id, asset_tag, name, criticality)
    values (v_org, 'S5A-FGN-1', 'Foreign tenant asset', 'medium');
  end if;
  if not exists (select 1 from evidence_items where organization_id = v_org) then
    insert into evidence_items (organization_id, description, evidence_type)
    values (v_org, 'S5A foreign tenant evidence', 'measured');
  end if;
  -- A foreign tenant REQUIREMENT, for the repair's tenancy wall (step 8a).
  -- Before the repair an org-1 obligation could point at this row, after which
  -- an ordinary org-1 planner moved it to `verified` through the production
  -- RPC and its text rendered on the org-1 open-verification list.
  if not exists (select 1 from development_cases where organization_id = v_org) then
    insert into development_cases (organization_id, title, problem_statement,
      lifecycle_type, created_by)
    values (v_org, 'S5A foreign case',
      'A foreign tenant case that exists only so a cross-tenant requirement has somewhere to live.',
      'greenfield', v_uid);
  end if;
  if not exists (select 1 from design_requirements where organization_id = v_org
                  and requirement_ref = 'S5A-F2') then
    insert into design_requirements (organization_id, development_case_id,
      requirement_ref, category, requirement, source)
    select v_org, c.id, 'S5A-F2', 'safety',
      'FOREIGN TENANT CONFIDENTIAL: the bund wall shall contain 110 percent of tank volume',
      'engineering'
    from development_cases c where c.organization_id = v_org limit 1;
  end if;
end $seed$;
PSQL

# Idempotent re-run: clear this smoke's own artifacts. Fixture keys are kept
# SHORT on purpose — long fixture identifiers have been read as secrets by the
# repository's secret scanner and have blocked merges.
psqlc "delete from calculation_runs where organization_id='$ORG'
        and development_case_id in (select id from development_cases where organization_id='$ORG' and title like 'S5A %');" >/dev/null
# Agent readings are NOT deleted directly either — the family refuses that for
# every caller. They go when their case goes, through the declared cascade the
# provenance trigger admits mid-cascade.
# NOT deleted directly — the family refuses that by design, for every caller.
# The obligations go when their requirement goes, through the declared cascade
# the provenance trigger admits mid-cascade. If that cascade ever stops
# working this cleanup fails loudly rather than leaving stale fixtures.
psqlc "delete from development_cases where organization_id='$ORG' and title like 'S5A %';" >/dev/null
# A requirement is NOT deleted directly — the repair's provenance wall refuses
# that for every caller, including this script, because deleting one removes it
# from the numerator AND the denominator and takes every verification recorded
# against it (a failure included) with it. The cleanup therefore ASSERTS the
# declared cascade did its work rather than reaching past the wall: if the
# cascade ever stops working, this fails loudly here instead of leaving stale
# fixtures that quietly change every count below.
test "$(psqlc "select count(*) from design_requirements where organization_id='$ORG' and requirement_ref like 'S5A%'")" = "0"
psqlc "delete from acceptance_tests where test_ref like 'S5A%';" >/dev/null
# Scoped to THIS tenant: the foreign tenant's fixture evidence is seeded above
# and the cross-tenant probe in step 4 needs it to still be there.
psqlc "delete from evidence_items where organization_id='$ORG' and description like 'S5A %';" >/dev/null

echo "── 1. the §10 Requirement object (D4.16) ────────────────────────────────"

BODY=$(rpc "$PLANNER" create_development_case '{"p_title":"S5A requirements case","p_problem_statement":"The thickener underflow pumps have no stated availability requirement, so no design decision on sparing can be defended at a gate.","p_lifecycle_type":"reliability_improvement"}')
noerr "$BODY"; CASE=$(printf '%s' "$BODY" | field case_id); test -n "$CASE"

# THE REFUSAL THAT MATTERS, taken FIRST — before a single requirement exists.
# A report of "0 orphans, 0 unverified, 0 missing methods" over an empty set is
# indistinguishable from a fully traced project and renders the same colour.
BODY=$(rpc "$PLANNER" get_case_requirement_traceability "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['refused']")" = "True"
test "$(jqp "$BODY" "x['threadCoveragePct'] is None")" = "True"
test "$(jqp "$BODY" "x['verifiedPct'] is None")" = "True"
test "$(jqp "$BODY" "'indistinguishable from a fully traced project' in x['refusal']")" = "True"
test "$(jqp "$BODY" "len(x['chain'])")" = "0"

BODY=$(rpc "$PLANNER" get_case_requirement_findings "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['refused']")" = "True"
test "$(jqp "$BODY" "x['findingCount'] is None")" = "True"

# ...and the agent will not record a dated "0 findings" row either.
BODY=$(rpc "$AIBOT" record_requirements_agent_report "{\"p_case_id\":\"$CASE\"}")
expect_err "$BODY" 'no requirements'
test "$(psqlc "select count(*) from requirement_agent_reports where development_case_id='$CASE'")" = "0"

# All eleven §10 categories are writable through the real customer path.
i=0
for CAT in functional performance safety reliability availability maintainability environmental cyber regulatory operability quality; do
  i=$((i+1))
  BODY=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S5A-C$i\",\"category\":\"$CAT\",\"requirement\":\"A $CAT requirement stated for the §10 category coverage transcript\"}}")
  noerr "$BODY"
  test "$(jqp "$BODY" "x['spec10Category']")" = "True"
done
test "$(psqlc "select count(distinct category) from design_requirements where development_case_id='$CASE'")" = "11"

# A reliability-by-design category is still accepted, and REPORTED as outside
# the eleven rather than silently mapped onto one of them.
BODY=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S5A-C12\",\"category\":\"sparing\",\"requirement\":\"Two thickener underflow pumps installed, one running one standby\"}}")
noerr "$BODY"
test "$(jqp "$BODY" "x['spec10Category']")" = "False"

# A category in neither vocabulary is refused BY NAME, and the refusal names
# both vocabularies rather than a retyped list.
BODY=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S5A-X1\",\"category\":\"vibes\",\"requirement\":\"A requirement in a category that does not exist\"}}")
expect_err "$BODY" 'eleven §10 categories'

# An owner outside the tenant is refused: accountability pointing outside the
# organization is not accountability.
OUTSIDER=$(psqlc "select id from user_profiles where organization_id='$ORG2' limit 1")
test -n "$OUTSIDER"
BODY=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S5A-X2\",\"category\":\"safety\",\"requirement\":\"A requirement owned by somebody in another organization\",\"owner_id\":\"$OUTSIDER\"}}")
expect_err "$BODY" 'member of this organization'

# The parent/child hierarchy the row said was missing.
BODY=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S5A-P1\",\"category\":\"availability\",\"requirement\":\"Thickener underflow availability shall be at least 98 percent\",\"owner_id\":\"$MANAGER_ID\",\"acceptance_criteria\":\"Rolling 12-month availability from the historian at or above 98.0 percent\"}}")
noerr "$BODY"; PARENT=$(printf '%s' "$BODY" | field requirement_id); test -n "$PARENT"

BODY=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S5A-P2\",\"category\":\"maintainability\",\"requirement\":\"Underflow pump seal replacement shall take no more than four hours\",\"owner_id\":\"$MANAGER_ID\",\"parent_requirement_id\":\"$PARENT\"}}")
noerr "$BODY"; CHILD=$(printf '%s' "$BODY" | field requirement_id); test -n "$CHILD"
test "$(psqlc "select parent_requirement_id from design_requirements where id=$CHILD")" = "$PARENT"

# A parent on another case is refused at the door.
BODY=$(rpc "$PLANNER" create_development_case '{"p_title":"S5A second case","p_problem_statement":"A second case that exists only so a cross-case requirement parent has somewhere to point.","p_lifecycle_type":"greenfield"}')
noerr "$BODY"; CASE2=$(printf '%s' "$BODY" | field case_id)
BODY=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE2\",\"p_requirement\":{\"requirement_ref\":\"S5A-O1\",\"category\":\"functional\",\"requirement\":\"A requirement on the other case entirely\"}}")
noerr "$BODY"; OTHER=$(printf '%s' "$BODY" | field requirement_id)
BODY=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S5A-X3\",\"category\":\"functional\",\"requirement\":\"A child whose parent lives on another case\",\"parent_requirement_id\":\"$OTHER\"}}")
expect_err "$BODY" 'same case'

# ...and refused at the WALL, with RLS bypassed and the service role in play.
# A cycle is corrupt data, not a provenance question: there is no marker.
OUT=$(sql_must_fail "update design_requirements set parent_requirement_id=$CHILD where id=$PARENT;")
grep -qi 'close a cycle' <<<"$OUT"
OUT=$(sql_must_fail "update design_requirements set parent_requirement_id=$PARENT where id=$PARENT;")
grep -qi 'cannot be its own parent' <<<"$OUT"
OUT=$(sql_must_fail "update design_requirements set parent_requirement_id=$OTHER where id=$CHILD;")
grep -qi 'different development case' <<<"$OUT"

echo "── 2. the digital thread (§10 traceability, II.2) ───────────────────────"

# The objective the thread hangs off, created through the ONE objective store's
# own write path (D11.15) — not inserted behind it, because the point of the
# link is that it points at a real objective a customer authored.
OBJ=$(psqlc "select id from risk_objectives where organization_id='$ORG' and description like 'S5A %' limit 1")
if [ -z "$OBJ" ]; then
  BODY=$(rpc "$MANAGER" upsert_risk_objective "{\"p_objective\":{\"objective_level\":\"asset\",\"description\":\"S5A thickener underflow pumping is available when the plant needs it\",\"target\":\"98 percent availability\",\"measurement\":\"Historian runtime over calendar time\",\"timeframe\":\"Rolling twelve months\",\"tolerance\":\"No month below 95 percent\",\"owner_id\":\"$MANAGER_ID\"}}")
  noerr "$BODY"; OBJ=$(printf '%s' "$BODY" | field objective_id)
fi
ASSET=$(psqlc "select id from assets where organization_id='$ORG' limit 1")
KPI=$(psqlc "select kpi_key from kpi_catalog order by kpi_key limit 1")
test -n "$OBJ"; test -n "$ASSET"; test -n "$KPI"

# A commissioning test on the ONE acceptance-test store.
PROJ=$(psqlc "select id from capital_projects where organization_id='$ORG' limit 1")
test -n "$PROJ"
psqlc "insert into acceptance_tests (organization_id, project_id, test_ref, test_stage)
       values ('$ORG', $PROJ, 'S5A-T1', 'commissioning')
       on conflict do nothing;" >/dev/null
ATEST=$(psqlc "select id from acceptance_tests where organization_id='$ORG' and test_ref='S5A-T1'")
test -n "$ATEST"

BODY=$(rpc "$PLANNER" link_requirement_thread "{\"p_requirement_id\":$PARENT,\"p_link\":{\"objective_id\":\"$OBJ\",\"satisfied_by_asset_id\":\"$ASSET\",\"commissioning_test_id\":$ATEST,\"operating_kpi_key\":\"$KPI\"}}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field linksTouched)" = "4"

# CLEARING a link is refused BY NAME. Re-pointing is a correction; erasing is
# the thread losing a hop, and a hop that disappears is indistinguishable from
# one that never existed.
BODY=$(rpc "$PLANNER" link_requirement_thread "{\"p_requirement_id\":$PARENT,\"p_link\":{\"objective_id\":\"\"}}")
expect_err "$BODY" 'clearing the objective link is refused'
BODY=$(rpc "$PLANNER" link_requirement_thread "{\"p_requirement_id\":$PARENT,\"p_link\":{\"operating_kpi_key\":\"\"}}")
expect_err "$BODY" 'clearing the operating-KPI link is refused'
BODY=$(rpc "$PLANNER" link_requirement_thread "{\"p_requirement_id\":$PARENT,\"p_link\":{\"owner_id\":\"\"}}")
expect_err "$BODY" 'clearing the owner is refused'
BODY=$(rpc "$PLANNER" link_requirement_thread "{\"p_requirement_id\":$PARENT,\"p_link\":{}}")
expect_err "$BODY" 'nothing to link'

# A KPI that is not in the catalogue is refused, and the refusal states the
# one-KPI-per-requirement ruling rather than silently accepting a second.
BODY=$(rpc "$PLANNER" link_requirement_thread "{\"p_requirement_id\":$PARENT,\"p_link\":{\"operating_kpi_key\":\"not-a-kpi\"}}")
expect_err "$BODY" 'not an operating KPI in the catalogue'

# Cross-tenant thread links are refused for EVERY writer, service key included.
OBJ2=$(psqlc "select id from risk_objectives where organization_id='$ORG2' limit 1")
ASSET2=$(psqlc "select id from assets where organization_id='$ORG2' limit 1")
test -n "$OBJ2"; test -n "$ASSET2"
BODY=$(rpc "$PLANNER" link_requirement_thread "{\"p_requirement_id\":$PARENT,\"p_link\":{\"objective_id\":\"$OBJ2\"}}")
expect_err "$BODY" 'not in this organization'
OUT=$(sql_must_fail "update design_requirements set objective_id='$OBJ2' where id=$PARENT;")
grep -qi 'belongs to another organization' <<<"$OUT"
OUT=$(sql_must_fail "update design_requirements set satisfied_by_asset_id='$ASSET2' where id=$PARENT;")
grep -qi 'belongs to another organization' <<<"$OUT"

echo "── 3. traceability: delegated, deferred and lineage-backed ──────────────"

BODY=$(rpc "$PLANNER" get_case_requirement_traceability "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['refused']")" = "False"
test "$(jqp "$BODY" "x['requirementCount'] >= 14")" = "True"
test "$(jqp "$BODY" "x['threadCoveragePct'] is not None")" = "True"
test "$(jqp "$BODY" "x['hierarchy']['children'] >= 1")" = "True"
test "$(jqp "$BODY" "x['hierarchy']['maxDepth'] >= 2")" = "True"
# The seven §10 links are ALL reported, and exactly two of them say they are
# not built. A deferred link dropped from the chain reads as a link that does
# not exist rather than one this slice has not reached.
test "$(jqp "$BODY" "len(x['chain'])")" = "7"
test "$(jqp "$BODY" "sum(1 for l in x['chain'] if not l['built'])")" = "2"
test "$(jqp "$BODY" "all(l.get('deferral') for l in x['chain'] if not l['built'])")" = "True"
test "$(jqp "$BODY" "sorted(l['link'] for l in x['chain'] if not l['built'])")" = "['design object', 'procurement specification']"
# The requirement→WBS answer is the SCOPE chain's, named as its owner.
test "$(jqp "$BODY" "'get_case_scope_traceability' in x['scopeChain']['owner']")" = "True"
test "$(jqp "$BODY" "len(x['scopeChain']['requirementsWithoutWbs']) == x['requirementCount']")" = "True"
# The gap families the Requirements Agent reads.
test "$(jqp "$BODY" "len(x['gaps']['withoutVerificationMethod']) >= 1")" = "True"
test "$(jqp "$BODY" "len(x['gaps']['outsideSpec10Taxonomy'])")" = "1"

# The lineage run, for the ANSWER…
BODY=$(rpc "$PLANNER" compute_case_requirement_traceability "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
RUN=$(printf '%s' "$BODY" | field calculationRunId); test -n "$RUN"
test "$(psqlc "select calculation_key from calculation_runs where id='$RUN'")" = "case_requirement_traceability"
test "$(psqlc "select code_version from calculation_runs where id='$RUN'")" = "develop-requirements/5A/2026-12-04"
test "$(psqlc "select status from calculation_runs where id='$RUN'")" = "computed"

# …and for the REFUSAL. A refusal with no lineage is a refusal nobody can
# later prove happened. (A case with NO requirements at all — CASE2 carries
# one, which is the point of it.)
BODY=$(rpc "$PLANNER" create_development_case '{"p_title":"S5A empty case","p_problem_statement":"A case deliberately left with no requirements, so the refusal path has somewhere honest to run.","p_lifecycle_type":"greenfield"}')
noerr "$BODY"; CASE3=$(printf '%s' "$BODY" | field case_id); test -n "$CASE3"
BODY=$(rpc "$PLANNER" compute_case_requirement_traceability "{\"p_case_id\":\"$CASE3\"}")
test "$(jqp "$BODY" "x['refused']")" = "True"
RUN2=$(printf '%s' "$BODY" | field calculationRunId); test -n "$RUN2"
test "$(psqlc "select status from calculation_runs where id='$RUN2'")" = "refused"
test "$(psqlc "select jsonb_array_length(refusals) from calculation_runs where id='$RUN2'")" = "1"

echo "── 4. the §11 Verification object (D4.17) ───────────────────────────────"

# All five methods, OPERATIONAL_VALIDATION included.
test "$(psqlc "select array_to_string(sync_verification_methods(), ',')")" = "analysis,inspection,demonstration,test,operational_validation"

# A method outside the five is refused by name.
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$PARENT,\"p_verification\":{\"method_code\":\"vibes\"}}")
expect_err "$BODY" 'five §11 methods'

# A measured method against a requirement with no acceptance criteria and no
# criteria of its own is refused: there is nothing to test against.
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$CHILD,\"p_verification\":{\"method_code\":\"test\"}}")
expect_err "$BODY" 'nothing to test against'

# A verification with no due date gets one ASSUMED, and SAYS it is assumed.
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$PARENT,\"p_verification\":{\"method_code\":\"operational_validation\",\"procedure\":\"Read rolling availability from the historian for twelve months after handover\"}}")
noerr "$BODY"
OBL=$(printf '%s' "$BODY" | field obligation_id); test -n "$OBL"
test "$(jqp "$BODY" "x['dueDateAssumed']")" = "True"
test "$(printf '%s' "$BODY" | field methodCode)" = "operational_validation"
# The requirement's stated method follows the verification that was planned.
test "$(psqlc "select verification_method from design_requirements where id=$PARENT")" = "operational_validation"

# A second OPEN verification of the same method is refused — two would disagree
# about whether the requirement is verified.
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$PARENT,\"p_verification\":{\"method_code\":\"operational_validation\"}}")
expect_err "$BODY" 'already stands against'

# A DIFFERENT method against the same requirement is legitimate (§11 admits an
# analysis at design and a validation after startup) and is accepted.
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$PARENT,\"p_verification\":{\"method_code\":\"analysis\",\"due_date\":\"2027-03-01\"}}")
noerr "$BODY"
OBL2=$(printf '%s' "$BODY" | field obligation_id)
test "$(jqp "$BODY" "x['dueDateAssumed']")" = "False"

# A result with no measurement is an opinion.
BODY=$(rpc "$MANAGER" record_verification_result "{\"p_obligation_id\":\"$OBL\",\"p_result\":\"achieved\",\"p_measured_note\":\"  \"}")
test "$(jqp "$BODY" "x[0]['outcome']")" = "refused"
test "$(jqp "$BODY" "'no measurement is an opinion' in x[0]['detail']")" = "True"

# Evidence from another organization is refused.
EV2=$(psqlc "select id from evidence_items where organization_id='$ORG2' limit 1")
test -n "$EV2"
BODY=$(rpc "$MANAGER" record_verification_result "{\"p_obligation_id\":\"$OBL\",\"p_result\":\"achieved\",\"p_measured_note\":\"Rolling availability 98.4 percent over twelve months\",\"p_evidence_id\":\"$EV2\"}")
test "$(jqp "$BODY" "x[0]['outcome']")" = "refused"
test "$(jqp "$BODY" "'not in this organization' in x[0]['detail']")" = "True"

# The result, recorded by a named human, with §11's evidence pointer — and the
# REQUIREMENT's status moves as a consequence, never by being typed.
psqlc "insert into evidence_items (organization_id, description, evidence_type)
       values ('$ORG', 'S5A historian availability extract', 'measured');" >/dev/null
EV=$(psqlc "select id from evidence_items where organization_id='$ORG' and description='S5A historian availability extract' limit 1")
test "$(psqlc "select verification_status from design_requirements where id=$PARENT")" = "open"
BODY=$(rpc "$MANAGER" record_verification_result "{\"p_obligation_id\":\"$OBL\",\"p_result\":\"achieved\",\"p_measured_note\":\"Rolling availability 98.4 percent against the 98.0 percent criterion, twelve months to 2027-01-31\",\"p_evidence_id\":\"$EV\"}")
test "$(jqp "$BODY" "x[0]['outcome']")" = "recorded"
test "$(psqlc "select verification_status from design_requirements where id=$PARENT")" = "verified"
test "$(psqlc "select evidence_id from verification_obligations where id='$OBL'")" = "$EV"
test "$(psqlc "select verified_by from verification_obligations where id='$OBL'")" = "$MANAGER_ID"
test "$(psqlc "select count(*) from audit_events where entity_type='requirement_verification_result' and event_data->>'obligation_id'='$OBL' and previous_state->>'verification_status'='open' and new_state->>'verification_status'='verified'")" = "1"

# A verification is recorded once.
BODY=$(rpc "$MANAGER" record_verification_result "{\"p_obligation_id\":\"$OBL\",\"p_result\":\"not_achieved\",\"p_measured_note\":\"A second opinion recorded over the first\"}")
test "$(jqp "$BODY" "x[0]['outcome']")" = "refused"
test "$(jqp "$BODY" "'recorded once' in x[0]['detail']")" = "True"

# INCONCLUSIVE leaves the requirement where it was: a verification that could
# not decide has not decided.
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$CHILD,\"p_verification\":{\"method_code\":\"inspection\",\"acceptance_criteria\":\"Seal change timed on the next planned outage\"}}")
noerr "$BODY"; OBL3=$(printf '%s' "$BODY" | field obligation_id)
BODY=$(rpc "$MANAGER" record_verification_result "{\"p_obligation_id\":\"$OBL3\",\"p_result\":\"inconclusive\",\"p_measured_note\":\"The outage was deferred, so the seal change was never timed\"}")
test "$(jqp "$BODY" "x[0]['outcome']")" = "recorded"
test "$(psqlc "select verification_status from design_requirements where id=$CHILD")" = "open"

echo "── 5. §70 — no machine verifies anything (three doors, one wall) ────────"

# Door 1: the AI-operator identity may not state HOW a requirement is verified,
# because that is the finding the Requirements Agent exists to raise.
BODY=$(rpc "$AIBOT" create_requirement_verification "{\"p_requirement_id\":$CHILD,\"p_verification\":{\"method_code\":\"analysis\"}}")
expect_err "$BODY" '§70 human act'

# Door 2: nor record a result.
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$CHILD,\"p_verification\":{\"method_code\":\"demonstration\",\"acceptance_criteria\":\"Demonstrated on the pump test rig\"}}")
noerr "$BODY"; OBL4=$(printf '%s' "$BODY" | field obligation_id)
BODY=$(rpc "$AIBOT" record_verification_result "{\"p_obligation_id\":\"$OBL4\",\"p_result\":\"achieved\",\"p_measured_note\":\"The machine says it worked\"}")
test "$(jqp "$BODY" "x[0]['outcome']")" = "refused"
test "$(jqp "$BODY" "'§70 human act' in x[0]['detail']")" = "True"

# Door 3: a technician is not refused (verification is a named act by a named
# person, and a technician can be one) — the gate is on accountability, not
# seniority. This asserts the role set admits the person who actually looks.
#
# The result recorded is NOT_ACHIEVED, and deliberately: a requirement that was
# looked at and did not meet its criteria goes to FAILED, which is a different
# state from "nobody has looked yet". A transcript that only ever records
# successes never exercises the branch that matters.
BODY=$(rpc "$TECH" record_verification_result "{\"p_obligation_id\":\"$OBL4\",\"p_result\":\"not_achieved\",\"p_measured_note\":\"Demonstrated on the rig at 5.6 hours against the four-hour criterion\"}")
test "$(jqp "$BODY" "x[0]['outcome']")" = "recorded"
test "$(psqlc "select verification_status from design_requirements where id=$CHILD")" = "failed"

# THE WALL. Every writer, service role included, marker or no marker.
AIBOT_ID='99999999-9999-4999-8999-999999999999'
OUT=$(sql_must_fail "update verification_obligations set verified_by='$AIBOT_ID' where id='$OBL2';")
grep -qi 'cannot be attributed to the AI-operator identity' <<<"$OUT"
# ...and holds even with the RPC's own marker set, because the §70 trigger is
# not the provenance trigger and does not consult it.
OUT=$(sql_must_fail "select set_config('app.verification_result_write','granted',false);
                     update verification_obligations set verified_by='$AIBOT_ID' where id='$OBL2';")
grep -qi 'cannot be attributed to the AI-operator identity' <<<"$OUT"

# A result written directly, with no marker, is refused.
OUT=$(sql_must_fail "update verification_obligations set result='achieved', status='completed' where id='$OBL2';")
grep -qi 'record_verification_result' <<<"$OUT"

# An obligation born verified is refused: a loop that was never open.
OUT=$(sql_must_fail "insert into verification_obligations
        (organization_id, requirement_id, method, method_code, due_date, result, status, measured_note)
        values ('$ORG', $CHILD, 'analysis', 'analysis', current_date, 'achieved', 'completed', 'born verified');")
grep -qi 'born verified' <<<"$OUT"

# Deletion and TRUNCATE are refused for every caller.
OUT=$(sql_must_fail "delete from verification_obligations where id='$OBL2';")
grep -qi 'is not deleted' <<<"$OUT"
OUT=$(sql_must_fail "truncate table verification_obligations;")
grep -qi 'not truncatable' <<<"$OUT"

# Exactly one subject per obligation.
OUT=$(sql_must_fail "insert into verification_obligations
        (organization_id, method, method_code, due_date) values ('$ORG','analysis','analysis',current_date);")
grep -qi 'verification_obligation_subject_xor' <<<"$OUT"

echo "── 6. the LEARN posture does not drift; requirement rows are VISIBLE ────"

# get_verification_posture counts obligations against ACTIONED RECOMMENDATIONS.
# The requirement-scoped rows this smoke just created must not appear in it.
BODY=$(rpc "$MANAGER" get_verification_posture '{}')
POSTURE_OPEN=$(jqp "$BODY" "x[0]['openObligations']")
REC_OPEN=$(psqlc "select count(*) from verification_obligations where organization_id='$ORG' and recommendation_id is not null and status='open'")
test "$POSTURE_OPEN" = "$REC_OPEN"

# ...and the open-verification surface DOES show them. An INNER JOIN on
# recommendations would have dropped every one: created, overdue and invisible.
BODY=$(rpc "$MANAGER" get_open_verifications '{"p_limit":100}')
test "$(jqp "$BODY" "sum(1 for r in x if r['subjectKind'] == 'requirement') >= 1")" = "True"
test "$(jqp "$BODY" "all(r['requirementRef'] for r in x if r['subjectKind'] == 'requirement')")" = "True"

BODY=$(rpc "$PLANNER" get_case_requirement_verifications "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['refused']")" = "False"
test "$(jqp "$BODY" "x['verificationCoveragePct'] is not None")" = "True"
test "$(jqp "$BODY" "len(x['methods'])")" = "5"
BODY=$(rpc "$PLANNER" get_case_requirement_verifications "{\"p_case_id\":\"$CASE3\"}")
test "$(jqp "$BODY" "x['refused']")" = "True"
test "$(jqp "$BODY" "x['verificationCoveragePct'] is None")" = "True"

echo "── 7. the Requirements Agent (D12.09) ───────────────────────────────────"

BODY=$(rpc "$PLANNER" get_case_requirement_findings "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['refused']")" = "False"
test "$(jqp "$BODY" "x['advisory']")" = "True"
# The spec's own example is a deterministic count, and it is one here.
test "$(jqp "$BODY" "x['byFamily']['missingVerificationMethod'] >= 1")" = "True"
test "$(jqp "$BODY" "'have no verification method' in x['headline']")" = "True"
# SIX families, every finding carrying a record link and a deterministic
# source. `outside_spec10_taxonomy` is the repair: ruling 2's whole
# justification for keeping the five legacy categories is that a requirement
# outside the eleven is REPORTED as outside the taxonomy, and until the repair
# NOTHING reported it — the register row claimed two reporters and there were
# zero.
test "$(jqp "$BODY" "sorted(set(f['family'] for f in x['findings'])) == ['inconsistent', 'missing_verification_method', 'orphan', 'outside_spec10_taxonomy', 'unowned', 'unverified']")" = "True"
test "$(jqp "$BODY" "all(f['source'] == 'deterministic' for f in x['findings'])")" = "True"
test "$(jqp "$BODY" "all(f.get('requirementRef') for f in x['findings'])")" = "True"
# The deterministic inconsistency classes fire on real data: the parent is
# verified while its child is not.
test "$(jqp "$BODY" "any(f.get('subFamily') == 'parent_verified_before_child' for f in x['findings'])")" = "True"
# ...and the three unverified states stay apart. A single 'unverified' count
# would flatten "nobody looked", "somebody looked and it failed" and "the date
# has passed" into one comfortable number.
test "$(jqp "$BODY" "any(f.get('subFamily') == 'verification_failed' and f['severity'] == 'blocking' for f in x['findings'])")" = "True"

# Two requirements measured by one KPI: in service the pair is unfalsifiable.
BODY=$(rpc "$PLANNER" link_requirement_thread "{\"p_requirement_id\":$CHILD,\"p_link\":{\"operating_kpi_key\":\"$KPI\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_requirement_findings "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "any(f.get('subFamily') == 'shared_operating_kpi' for f in x['findings'])")" = "True"

# The agent identity MAY record a reading. That is the act §59 describes, and
# it is the only door in this slice that admits it.
BODY=$(rpc "$AIBOT" record_requirements_agent_report "{\"p_case_id\":\"$CASE\",\"p_narrative\":\"Fourteen requirements carry no verification method.\",\"p_model\":\"smoke-model\",\"p_ai_findings\":[{\"requirement_ref\":\"S5A-P1\",\"related_requirement_ref\":\"S5A-C12\",\"concern\":\"The 98 percent availability target sits beside a sparing philosophy that installs no standby capacity.\",\"source\":\"deterministic\",\"severity\":\"blocking\"},{\"requirement_ref\":\"S5A-NOPE\",\"concern\":\"A finding about a requirement reference this case does not carry.\"}]}")
noerr "$BODY"
REPORT=$(printf '%s' "$BODY" | field report_id); test -n "$REPORT"
test "$(jqp "$BODY" "x['aiSuggestedCount']")" = "1"
test "$(jqp "$BODY" "len(x['aiDropped'])")" = "1"
test "$(jqp "$BODY" "'does not resolve' in x['aiDropped'][0]['reason']")" = "True"
test "$(jqp "$BODY" "x['advisory']")" = "True"

# The model's own `source` and `severity` were IGNORED: labelled ai_suggestion
# from a SQL literal and capped at attention. A model does not get to call its
# guess deterministic, or mark it blocking.
test "$(psqlc "select count(*) from requirement_agent_reports r, jsonb_array_elements(r.findings) f
                where r.id=$REPORT and f->>'subFamily'='semantic_inconsistency'
                  and f->>'source'='ai_suggestion' and f->>'severity'='attention'")" = "1"
test "$(psqlc "select count(*) from requirement_agent_reports r, jsonb_array_elements(r.findings) f
                where r.id=$REPORT and f->>'source'='deterministic' and f->>'severity'='blocking'")" != "0"

# THE COLUMNS THAT ARE NOT THERE. A requirements agent that could store the
# string 'verified' anywhere would eventually have it read as one.
test "$(psqlc "select count(*) from information_schema.columns
                where table_schema='public' and table_name='requirement_agent_reports'
                  and (column_name like '%status%' or column_name like '%result%'
                       or column_name like '%outcome%' or column_name like '%approv%'
                       or column_name like '%decision%' or column_name like '%verdict%')")" = "0"
test "$(psqlc "select advisory from requirement_agent_reports where id=$REPORT")" = "t"

# A reading is immutable, undeletable and not truncatable.
OUT=$(sql_must_fail "update requirement_agent_reports set narrative='edited' where id=$REPORT;")
grep -qi 'immutable' <<<"$OUT"
OUT=$(sql_must_fail "delete from requirement_agent_reports where id=$REPORT;")
grep -qi 'not deleted' <<<"$OUT"
OUT=$(sql_must_fail "truncate table requirement_agent_reports;")
grep -qi 'not truncatable' <<<"$OUT"
OUT=$(sql_must_fail "insert into requirement_agent_reports
        (organization_id, development_case_id, requested_by) values ('$ORG','$CASE','$MANAGER_ID');")
grep -qi 'record_requirements_agent_report is the path' <<<"$OUT"

# A technician cannot author an agent-attributed reading.
BODY=$(rpc "$TECH" record_requirements_agent_report "{\"p_case_id\":\"$CASE\"}")
expect_err "$BODY" 'requires a governance, engineering, planning or AI-operator role'

BODY=$(rpc "$PLANNER" get_requirement_agent_reports "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "len(x['reports']) >= 1")" = "True"
test "$(jqp "$BODY" "x['reports'][0]['advisory']")" = "True"

# THE AGENT'S REACH, MEASURED. Everything it can do to a verification, it
# cannot do. Nothing in the whole database lets its identity carry a result.
test "$(psqlc "select count(*) from verification_obligations where verified_by='$AIBOT_ID'")" = "0"
test "$(psqlc "select count(*) from design_requirements d
                join audit_events a on a.event_data->>'requirement_id' = d.id::text
                where a.entity_type='requirement_verification_result' and a.actor='ai_admin'")" = "0"

echo '  7b. the edge function refuses every unauthenticated shape'
efn(){ curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/$1" ${2:+-H "Authorization: Bearer $2"} -H 'Content-Type: application/json' -d "${3:-{\}}"; }
test "$(efn develop-requirements-agent)" = "401"
test "$(efn develop-requirements-agent "$ANON_KEY")" = "401"
# The service key is not an identity: the org comes from the token's user.
test "$(efn develop-requirements-agent "$SERVICE_ROLE_KEY")" = "401"

# And it REACHES its own fixture. With no model provider configured it returns
# the deterministic findings and says the semantic check was not attempted —
# which it can only reach if the deterministic read succeeded.
ARESP=$(curl -sS -X POST "$API_URL/functions/v1/develop-requirements-agent" -H "Authorization: Bearer $AIBOT" -H 'Content-Type: application/json' -d "{\"case_id\":\"$CASE\"}")
case "$ARESP" in
  *'"refused":true'*) echo "requirements agent refused over its own populated fixture: $ARESP"; exit 1;;
  *'"reading"'*) : ;;
  *) echo "unexpected requirements agent response: $ARESP"; exit 1;;
esac
# ...and over the EMPTY case it refuses, without calling a model at all.
ARESP2=$(curl -sS -X POST "$API_URL/functions/v1/develop-requirements-agent" -H "Authorization: Bearer $AIBOT" -H 'Content-Type: application/json' -d "{\"case_id\":\"$CASE3\"}")
case "$ARESP2" in
  *'"refused":true'*) : ;;
  *) echo "requirements agent did not refuse over an empty requirement set: $ARESP2"; exit 1;;
esac

echo "── 8. THE REPAIR: every defect below was reproduced live before it was fixed"

# A requirement with no owner, no objective and no verification against it —
# the shape the Requirements Agent has findings about, used below to prove the
# agent cannot clear them.
ORPHAN=$(psqlc "select id from design_requirements where development_case_id='$CASE' and requirement_ref='S5A-C1'")
test -n "$ORPHAN"

echo '  8a. ruling 7 — the tenancy wall verification_obligations never had'
# BEFORE: an org-1 obligation pointing at an org-2 requirement was ACCEPTED,
# after which an ORDINARY org-1 planner moved that org-2 requirement to
# `verified` through the production RPC — and the audit row landed in org 1.
FR=$(psqlc "select id from design_requirements where organization_id='$ORG2' and requirement_ref='S5A-F2'")
test -n "$FR"
OUT=$(sql_must_fail "insert into verification_obligations
        (organization_id, requirement_id, method, method_code, due_date)
        values ('$ORG', $FR, 'test', 'test', current_date + 10);")
grep -qi 'belongs to another organization' <<<"$OUT"
# ...and on UPDATE, so an existing row cannot be re-pointed across the wall.
# TWO walls stand here and either answer is correct: the provenance wall
# freezes the SUBJECT of an obligation always (it fires first, alphabetically)
# and the tenancy wall refuses a foreign target. Asserting the pair rather than
# one message keeps the test from pinning trigger ORDER as if it were the rule.
OUT=$(sql_must_fail "update verification_obligations set requirement_id=$FR where id='$OBL2';")
grep -qiE 'belongs to another organization|fixed when it is created' <<<"$OUT"
# and with the subject freeze out of the way — a brand-new obligation, still
# open — the tenancy wall is the one that speaks.
OUT=$(sql_must_fail "update verification_obligations set organization_id='$ORG2' where id='$OBL2';")
grep -qiE 'belongs to another organization|fixed when it is created' <<<"$OUT"
# ...and the READ agrees with the wall: no org-2 requirement text is reachable
# through an org-1 session on either verification surface.
BODY=$(rpc "$PLANNER" get_open_verifications '{"p_limit":200}')
test "$(jqp "$BODY" "len([r for r in x if r.get('requirementRef')=='S5A-F2'])")" = "0"
BODY=$(rpc "$PLANNER" get_case_requirement_verifications "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "len([v for v in x['verifications'] if v.get('requirementRef')=='S5A-F2'])")" = "0"

echo '  8b. ruling 8 — a later pass does not un-fail an earlier failure'
# BEFORE: a 12-month TEST recorded not_achieved (status -> failed), then a
# desktop ANALYSIS recorded achieved (status -> verified), and NOTHING raised
# the contradiction. The 'failed' assertion in step 5 is the setup; this is the
# one extra step that turned it green.
test "$(psqlc "select verification_status from design_requirements where id=$CHILD")" = "failed"
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$CHILD,\"p_verification\":{\"method_code\":\"analysis\",\"acceptance_criteria\":\"RAM model, four-hour seal change\"}}")
noerr "$BODY"; OBL5=$(printf '%s' "$BODY" | field obligation_id)
# the door SAYS the failure is standing rather than letting the planner find out later
test "$(jqp "$BODY" "'stay FAILED' in (x.get('standingFailureNote') or '')")" = "True"
BODY=$(rpc "$MANAGER" record_verification_result "{\"p_obligation_id\":\"$OBL5\",\"p_result\":\"achieved\",\"p_measured_note\":\"RAM model predicts a 3.4 hour seal change\"}")
test "$(jqp "$BODY" "x[0]['outcome']")" = "recorded"
test "$(jqp "$BODY" "'STAYS FAILED' in x[0]['detail']")" = "True"
test "$(psqlc "select verification_status from design_requirements where id=$CHILD")" = "failed"

# ...and the contradiction is REPORTED, not merely prevented.
BODY=$(rpc "$PLANNER" get_case_requirement_findings "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "len([f for f in x['findings'] if f.get('subFamily')=='passed_without_superseding_the_failure'])")" = "1"
test "$(jqp "$BODY" "[f['severity'] for f in x['findings'] if f.get('subFamily')=='passed_without_superseding_the_failure'][0]")" = "blocking"

# The failure is retracted ONLY by a verification that NAMES it — and the
# failed result stays on the record afterwards.
FAILED_OBL=$(psqlc "select id from verification_obligations where requirement_id=$CHILD and result='not_achieved' limit 1")
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$CHILD,\"p_verification\":{\"method_code\":\"test\",\"acceptance_criteria\":\"Timed seal change on the rig\",\"supersedes_obligation_id\":\"$FAILED_OBL\"}}")
noerr "$BODY"; OBL6=$(printf '%s' "$BODY" | field obligation_id)
BODY=$(rpc "$MANAGER" record_verification_result "{\"p_obligation_id\":\"$OBL6\",\"p_result\":\"achieved\",\"p_measured_note\":\"Seal changed in 3.8 hours on the rig after the bearing housing rework\"}")
test "$(jqp "$BODY" "x[0]['outcome']")" = "recorded"
test "$(psqlc "select verification_status from design_requirements where id=$CHILD")" = "verified"
test "$(psqlc "select count(*) from verification_obligations where requirement_id=$CHILD and result='not_achieved'")" = "1"
# one failure gets one answer
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$CHILD,\"p_verification\":{\"method_code\":\"demonstration\",\"acceptance_criteria\":\"x\",\"supersedes_obligation_id\":\"$FAILED_OBL\"}}")
expect_err "$BODY" 'already answered by another verification'
# and a PASSED verification cannot be "superseded" — it has nothing to answer for
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$CHILD,\"p_verification\":{\"method_code\":\"demonstration\",\"acceptance_criteria\":\"x\",\"supersedes_obligation_id\":\"$OBL6\"}}")
expect_err "$BODY" 'result was not_achieved'

echo '  8c. ruling 9 — a requirement and its recorded failures are not deletable'
# BEFORE: one DELETE removed a parent, its child and the child's recorded
# not_achieved TEST, with zero audit rows — and coverage IMPROVED.
OUT=$(sql_must_fail "delete from design_requirements where id=$PARENT;")
grep -qi 'A requirement is not deleted' <<<"$OUT"
# CASCADE, because a plain TRUNCATE is refused by the foreign key before the
# guard is ever reached — and a guard that only ever hides behind an FK error
# is a guard nobody has tested.
OUT=$(sql_must_fail "truncate table design_requirements cascade;")
grep -qi 'not truncatable by any caller' <<<"$OUT"
# the status is DERIVED, never typed — for every writer, service key included
OUT=$(sql_must_fail "update design_requirements set verification_status='verified', verified_at=now() where id=$ORPHAN;")
grep -qi 'DERIVED from the verifications recorded against it' <<<"$OUT"
OUT=$(sql_must_fail "insert into design_requirements
        (organization_id, development_case_id, requirement_ref, category, requirement, source, verification_status)
        values ('$ORG','$CASE','S5A-B1','safety','A requirement born already verified','engineering','verified');")
grep -qi 'cannot be created already carrying a verification status' <<<"$OUT"
# a genuine cascade still works: the case goes, its requirements go
psqlc "delete from development_cases where id='$CASE3';" >/dev/null

# A thread hop severed by a foreign key is RECORDED. link_requirement_thread
# refuses to clear a link by name; deleting the target used to do it silently.
psqlc "insert into assets (organization_id, asset_tag, name, criticality) values ('$ORG','S5A-A9','S5A severance asset','medium');" >/dev/null
SEVA=$(psqlc "select id from assets where organization_id='$ORG' and asset_tag='S5A-A9'")
BODY=$(rpc "$PLANNER" link_requirement_thread "{\"p_requirement_id\":$ORPHAN,\"p_link\":{\"satisfied_by_asset_id\":\"$SEVA\"}}")
noerr "$BODY"
psqlc "delete from assets where id='$SEVA';" >/dev/null
test "$(psqlc "select satisfied_by_asset_id is null from design_requirements where id=$ORPHAN")" = "t"
test "$(psqlc "select count(*) from audit_events where entity_type='requirement_thread_severed'
                and event_data->>'requirement_id'='$ORPHAN'
                and previous_state->>'satisfied_by_asset_id'='$SEVA'")" = "1"

echo '  8d. ruling 10 — the agent may not clear its own findings'
# BEFORE: as ai_admin, ONE link_requirement_thread call took a requirement from
# 4 findings to 2 (unowned and no_objective both vanished) and the audit row
# recorded actor='ai_admin'. The §70 block below used to check only that no
# verification carried the AI identity.
BEFORE_N=$(rpc "$PLANNER" get_case_requirement_findings "{\"p_case_id\":\"$CASE\"}" | field findingCount)
BODY=$(rpc "$AIBOT" link_requirement_thread "{\"p_requirement_id\":$ORPHAN,\"p_link\":{\"owner_id\":\"$MANAGER_ID\"}}")
expect_err "$BODY" 'could clear its own finding'
BODY=$(rpc "$AIBOT" link_requirement_thread "{\"p_requirement_id\":$ORPHAN,\"p_link\":{\"objective_id\":\"$OBJ\",\"acceptance_criteria\":\"Whatever the model decided counts as met\"}}")
expect_err "$BODY" '§70 human act'
BODY=$(rpc "$AIBOT" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S5A-B2\",\"category\":\"safety\",\"requirement\":\"A requirement the agent gave itself a method for\",\"verification_method\":\"test\"}}")
expect_err "$BODY" '§70 human act'
AFTER_N=$(rpc "$PLANNER" get_case_requirement_findings "{\"p_case_id\":\"$CASE\"}" | field findingCount)
test "$BEFORE_N" = "$AFTER_N"
# it may still REPORT: recording a requirement with no method ADDS findings.
BODY=$(rpc "$AIBOT" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S5A-B3\",\"category\":\"safety\",\"requirement\":\"A requirement the agent recorded and cannot verify\"}}")
noerr "$BODY"
test "$(psqlc "select count(*) from audit_events where entity_type='requirement_thread' and actor='ai_admin'")" = "0"

echo '  8e. the numbers on the page account for every requirement'
# A requirement somebody looked at and REJECTED, standing unretracted, so the
# partition below is proved over data that exercises the bucket rather than
# over a case where it happens to be empty.
FAILR=$(psqlc "select id from design_requirements where development_case_id='$CASE' and requirement_ref='S5A-C2'")
test -n "$FAILR"
BODY=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$FAILR,\"p_verification\":{\"method_code\":\"test\",\"acceptance_criteria\":\"Trip within two seconds\"}}")
noerr "$BODY"; OBL7=$(printf '%s' "$BODY" | field obligation_id)
BODY=$(rpc "$MANAGER" record_verification_result "{\"p_obligation_id\":\"$OBL7\",\"p_result\":\"not_achieved\",\"p_measured_note\":\"Trip measured at 6.4 seconds against the two-second criterion\"}")
test "$(jqp "$BODY" "x[0]['outcome']")" = "recorded"

BODY=$(rpc "$PLANNER" get_case_requirement_traceability "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
# The buckets PARTITION the denominator. BEFORE the repair a requirement that
# was verified and FAILED sat in neither the numerator nor any gap list, and
# the on-screen headline accounted for 13 of 14 requirements — the missing one
# being the only row anybody had actually looked at and rejected.
VER_N=$(psqlc "select count(*) from design_requirements where development_case_id='$CASE' and verification_status='verified'")
WAI_N=$(psqlc "select count(*) from design_requirements where development_case_id='$CASE' and verification_status='waived'")
test "$(jqp "$BODY" "len(x['gaps']['awaitingVerification']) + len(x['gaps']['verificationFailed']) + $VER_N + $WAI_N == x['requirementCount']")" = "True"
# and the failed bucket is not empty on this transcript — the partition is
# being proved over data that exercises it.
test "$(jqp "$BODY" "len(x['gaps']['verificationFailed']) >= 1")" = "True"
# the old ambiguous key is gone — two numbers cannot share one word again
test "$(jqp "$BODY" "'unverified' in x['gaps']")" = "False"
# the WBS delegate SAYS whether it answered
test "$(jqp "$BODY" "x['scopeChain']['answered']")" = "True"
# a requirement outside the §10 taxonomy is REPORTED by BOTH reporters the
# register row claims, not by neither.
test "$(jqp "$BODY" "len([g for g in x['gaps']['outsideSpec10Taxonomy'] if g['requirementRef']=='S5A-C12'])")" = "1"
BODY=$(rpc "$PLANNER" get_case_requirement_findings "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "len([f for f in x['findings'] if f['family']=='outside_spec10_taxonomy' and f['requirementRef']=='S5A-C12'])")" = "1"
test "$(jqp "$BODY" "[f['severity'] for f in x['findings'] if f['family']=='outside_spec10_taxonomy'][0]")" = "informational"

echo '  8f. the provenance wall covers what made the result mean something'
# BEFORE, as a service writer with no marker on a COMPLETED obligation: the
# MEASUREMENT was rewritable, the METHOD was rewritable after the fact, the
# SUBJECT was re-pointable and the TENANT was movable.
OUT=$(sql_must_fail "update verification_obligations set measured_note='REWRITTEN 99.9 percent, no evidence needed' where id='$OBL';")
grep -qi 'frozen once a verification is no longer open' <<<"$OUT"
OUT=$(sql_must_fail "update verification_obligations set method_code='analysis', method='analysis' where id='$OBL';")
grep -qi 'frozen once a verification is no longer open' <<<"$OUT"
OUT=$(sql_must_fail "update verification_obligations set requirement_id=$ORPHAN where id='$OBL';")
grep -qi 'fixed when it is created' <<<"$OUT"
OUT=$(sql_must_fail "update verification_obligations set organization_id='$ORG2' where id='$OBL';")
grep -qi 'belongs to another organization\|fixed when it is created' <<<"$OUT"

# ...and deleting an EVIDENCE ITEM is an ordinary act again. BEFORE: it failed
# with "A verification result is recorded through record_verification_result",
# for something the user did not do — ON DELETE SET NULL is an UPDATE, and the
# UPDATE branch had no escape.
psqlc "delete from evidence_items where id='$EV';" >/dev/null
test "$(psqlc "select evidence_id is null from verification_obligations where id='$OBL'")" = "t"
test "$(psqlc "select count(*) from audit_events where entity_type='verification_evidence_severed'
                and event_data->>'obligation_id'='$OBL'")" = "1"

echo '  8g. a compute is gated like every sibling compute, and the reports are bounded'
BODY=$(rpc "$TECH" compute_case_requirement_traceability "{\"p_case_id\":\"$CASE\"}")
expect_err "$BODY" 'requires a planning, engineering or governance role'
BODY=$(rpc "$SUPER" compute_case_requirement_traceability "{\"p_case_id\":\"$CASE\"}")
expect_err "$BODY" 'requires a planning, engineering or governance role'
BIGMODEL=$(python3 -c "print('m'*250)")
BODY=$(rpc "$PLANNER" record_requirements_agent_report "{\"p_case_id\":\"$CASE\",\"p_model\":\"$BIGMODEL\"}")
expect_err "$BODY" 'capped at 200'

echo '  8h. /design counts the PROJECT side of the one table'
# BEFORE: get_project_posture counted every row, so a case requirement moving
# to verified changed the reliability-by-design "unverified" figure.
PROJ_N=$(psqlc "select count(*) from design_requirements where organization_id='$ORG' and development_case_id is null")
BODY=$(rpc "$PLANNER" get_project_posture '{}')
test "$(jqp "$BODY" "x[0]['requirements_total']")" = "$PROJ_N"
test "$(jqp "$BODY" "'counted on the case' in x[0]['basis']")" = "True"

echo
echo 'Develop slice-5a smoke PASSED — the §10 Requirement with its hierarchy and thread, the §11 Verification with five methods no machine can record, and an agent that finds everything and fixes nothing — including its own findings.'

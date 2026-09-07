#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 7B — ONE field-readiness engine, two doors.
#
# RULING 22 (amended on review): `sync_field_readiness_elements` is THE
# field-ready predicate, anchored on the WORK IDENTITY (RULING 19), and THREE
# consumers read it — Recovery's `start_restoration_work` for one job,
# Recovery's `refresh_restoration_readiness` for the material position it used
# to derive itself, and `assess_package_field_readiness` for every job in a §27
# package. `sync_work_package_release_verdict` is still the ONE release
# predicate and gains a SEVENTH refusing state (`stale`) rather than a twin:
# a recorded assessment the canonical stores have moved past is not evidence.
#
# Every step is a live transcript against a real local database, run TWICE in
# a row on one database before it was committed.
#
# Steps:
#   0  fixtures: a case, four work orders (one bare, two job-planned), an
#      adopted job plan with steps/tools/permits/checks, material demand, an
#      asset, the AI identity and a foreign tenant.
#   1  D7.12 — the TEN elements: seven derived from canonical stores, three
#      reported `unverifiable` with the reason named. A bare work order blocks
#      on the five the job plan answers; a planned one is ready on them. No
#      element without a store is EVER ready.
#   2  RULING 22 — Recovery's door refuses THROUGH the predicate: the material
#      refusal and the permit/isolation refusal are the ELEMENT's own
#      sentences, compared character for character with what the door returns;
#      the gate is still the historical two, proven by a work order with FIVE
#      blocked elements that starts anyway. THE THIRD CONSUMER too:
#      `refresh_restoration_readiness` no longer holds a second material rule,
#      proven by the two agreeing on one work order in both directions.
#   2b THE PREDICATE FAILS CLOSED — an unreadable job plan is a REFUSAL and
#      not "no permit required"; a gate naming a typo or nothing at all raises
#      instead of admitting everything.
#   3  D7.05 — the assessment, generalized: derived blockers recorded,
#      declared questions raised, nothing marked satisfied, one lineage row,
#      and the refusals (an empty package, a cancelled one, a released one).
#   4  §70 in BOTH directions on one identity: the AI CAN assess (a guard that
#      refuses the right thing must not refuse the wrong one) and CANNOT
#      clear, release, or write a verifier by direct SQL.
#   5  re-assessment: evidence overwrites, judgement does not. A cleared
#      DECLARED question survives a re-run; a derived blocker disappears when
#      the canonical store changes.
#   6  D7.11 — the itemization: which element, beside the constraint holding
#      it, and `assessed: false` stated in words for a package nobody walked.
#   7  D13.09 — the board: ONE verdict compared character for character across
#      the door, the package read and the board; owners named; undated last;
#      released and cancelled packages off it; an empty board refused.
#   8  D7.06 — the release through the one verdict, and the package's
#      constraint set frozen afterwards.
#   8b STALENESS — the recorded assessment must still be true. A store that
#      moves after a clean assessment, a job added afterwards, and a hand
#      toggle over a store-derived blocker: the first two turn the ONE verdict
#      `stale` on the door AND the screen AND the board, and the third is
#      refused outright.
#   9  cross-tenant: a foreign member sees no package and no board row.
#
# Run: supabase start && scripts/ci-develop-slice7b-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-7b smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
ORG2='7b000000-0000-4000-8000-7b000000000b'

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
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
jqp(){ BODY="$1" EXPR="$2" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
print(eval(os.environ['EXPR'], {'x': x, 'json': json}))
PY
}
# The element predicate is REVOKED from every client role by design — it
# carries no session org filter and is only ever called from inside a definer
# that has established the tenant. Reading it here goes through psql, as the
# owner, which is exactly how it is reached in production.
elements(){ psqlc "select sync_field_readiness_elements('$1'::uuid, $2)"; }
element_field(){ BODY="$1" KEY="$2" NAME="$3" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
for e in x.get('elements', []):
    if e.get('key') == os.environ['KEY']:
        print(e.get(os.environ['NAME'], '')); sys.exit(0)
print('no element %r in payload' % os.environ['KEY'], file=sys.stderr); sys.exit(1)
PY
}

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
# `release_equipment` is an OPERATIONS act; the seeded tenant carries no
# `operator` role, so the executive stands in exactly as the recovery lifecycle
# transcript does (scripts/ci-recovery-lifecycle-smoke.sh:99).
OPS=$(token 'executive@syncai.ca' 'Exec123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$TECH"; test -n "$OPS"

PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
test -n "$PLANNER_ID"

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
declare v_uid uuid := '7b7b7b7b-7777-4777-8777-7b7b7b7b7b7b';
        v_org uuid := '7b000000-0000-4000-8000-7b000000000b';
begin
  insert into organizations (id, name) values (v_org, 'S7B foreign tenant')
    on conflict (id) do nothing;
  if not exists (select 1 from auth.users where email = 'smoke7b-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke7b-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'S7B foreign member'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  if not exists (select 1 from auth.identities where user_id = v_uid) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke7b-foreign@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_uid, v_org, 'smoke7b-foreign@syncai.ca', 'maintenance_manager')
  on conflict (id) do update set organization_id = v_org, role = 'maintenance_manager';
end $seed$;
PSQL
FOREIGN=$(token 'smoke7b-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGN"

# ── Idempotent re-run. Fixture keys are kept SHORT on purpose — long fixture
#    identifiers have been read as secrets by the repository's scanner and have
#    blocked merges.
#
#    A RELEASED package refuses deletion while its case exists, and so do its
#    constraints. That is the product working, so this teardown does what the
#    product allows: it deletes the CASES and the EVENTS, and every dependent
#    row goes with them through the declared cascades each wall admits
#    mid-cascade. Nothing here deletes something the product forbids deleting.
psqlc "delete from development_cases where organization_id='$ORG' and title like 'S7B %';" >/dev/null
psqlc "delete from restoration_events where organization_id='$ORG' and event_code like 'S7B-%';" >/dev/null
psqlc "delete from work_orders where organization_id='$ORG' and wo_number like 'S7B-%';" >/dev/null
psqlc "delete from job_plans where organization_id='$ORG' and plan_key like 'S7B-%';" >/dev/null
psqlc "delete from job_plans where organization_id='$ORG2' and plan_key like 'S7B-%';" >/dev/null
psqlc "delete from assets where organization_id='$ORG' and name like 'S7B %';" >/dev/null
psqlc "delete from work_packages where organization_id='$ORG' and package_code like 'S7B-%';" >/dev/null
test "$(psqlc "select count(*) from work_packages where organization_id='$ORG' and package_code like 'S7B-%'")" = "0"
test "$(psqlc "select count(*) from work_orders where organization_id='$ORG' and wo_number like 'S7B-%'")" = "0"

echo "── 0. fixtures: a case, an adopted job plan and four work orders ────────"

R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S7B field readiness case\",\"p_problem_statement\":\"Work packages are recorded and released, but nothing walks the ten things that must be true before a crew can start, so a package reads as constraint-free when in fact nobody has checked it.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE=$(printf '%s' "$R" | field case_id); test -n "$CASE"

R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S7B neighbouring case\",\"p_problem_statement\":\"A separate development case used here only so a board scoped to one case has a second case to exclude, and so an empty board has a genuine case to refuse over.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE2=$(printf '%s' "$R" | field case_id); test -n "$CASE2"

# The asset the isolation release is recorded against. It carries a SITE, and
# that is not decoration: `get_recovery_activation_readiness` reports the
# assets domain as ready only when EVERY asset in the tenant is linked to a
# site, so a fixture asset without one turns another transcript's readiness
# assertion red on a shared database. A smoke that arranges its own fixtures
# arranges complete ones.
SITE=$(psqlc "select id from sites where organization_id='$ORG' order by created_at limit 1")
test -n "$SITE"
ASSET=$(psqlc "with ins as (
  insert into assets (organization_id, site_id, name, criticality)
  values ('$ORG','$SITE','S7B drive train','high') returning id)
  select id from ins")
test -n "$ASSET"

# The job plan: adopted, with steps, a tool, a permit and two checks. Every
# derived element except materials and isolation is answered by this row.
JP=$(psqlc "with ins as (
  insert into job_plans (organization_id, plan_key, title, scope, status, version, basis)
  values ('$ORG','S7B-JP1','S7B drive change','Remove, replace and align the drive train',
          'adopted', 1, 'Written for the slice 7B transcript') returning id)
  select id from ins")
test -n "$JP"
psqlc "insert into job_plan_steps (organization_id, job_plan_id, step_number, description, craft, crew_size, estimated_hours)
       values ('$ORG','$JP',1,'Isolate and prove dead','electrical',2,2),
              ('$ORG','$JP',2,'Remove the drive','mechanical',3,6);" >/dev/null
psqlc "insert into job_plan_tools (organization_id, job_plan_id, tool, note)
       values ('$ORG','$JP','20 t gantry','Rated for the drive mass');" >/dev/null
psqlc "insert into job_plan_permits (organization_id, job_plan_id, permit_type, isolation_required, verification_note)
       values ('$ORG','$JP','electrical isolation','LOTO at MCC-3','Proved dead at the terminals');" >/dev/null
psqlc "insert into job_plan_checks (organization_id, job_plan_id, check_description, acceptance_criterion, is_hold_point)
       values ('$ORG','$JP','Alignment','Within 0.05 mm TIR', true),
              ('$ORG','$JP','Torque','All bolts to 450 Nm', false);" >/dev/null

psqlc "insert into work_orders (organization_id, asset_id, wo_number, title, status, job_plan_id)
       values ('$ORG','$ASSET','S7B-W1','Strip the drive guarding','pending', null),
              ('$ORG','$ASSET','S7B-W2','Change the drive train','pending','$JP'),
              ('$ORG','$ASSET','S7B-W3','Recovery probe — change the drive','pending','$JP'),
              ('$ORG','$ASSET','S7B-W4','Recovery probe — no job plan at all','pending', null),
              ('$ORG','$ASSET','S7B-W6','Lay-down preparation','pending', null);" >/dev/null
W1=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7B-W1'")
W2=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7B-W2'")
W3=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7B-W3'")
W4=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7B-W4'")
W6=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7B-W6'")
test -n "$W1"; test -n "$W2"; test -n "$W3"; test -n "$W4"; test -n "$W6"

MAT=$(psqlc "select id from materials where organization_id='$ORG' limit 1")
test -n "$MAT"
psqlc "insert into work_order_materials (organization_id, work_order_id, material_id, qty_required, status)
       values ('$ORG','$W2','$MAT',2,'requested'),
              ('$ORG','$W3','$MAT',2,'requested')
       on conflict (work_order_id, material_id) do update set status='requested';" >/dev/null

echo "── 1. D7.12 — ten elements, seven derived and three unverifiable ────────"

E1=$(elements "$W1" null)
test "$(jqp "$E1" "len(x['elements'])")" = "10"
# The vocabulary, in the order the TypeScript module also states it.
test "$(jqp "$E1" "','.join(e['key'] for e in x['elements'])")" = "scope,procedure,materials,tools,permits,isolation,quality,crew,access,predecessor"
test "$(jqp "$E1" "sum(1 for e in x['elements'] if e['basisKind']=='derived')")" = "7"
test "$(jqp "$E1" "sum(1 for e in x['elements'] if e['basisKind']=='declared')")" = "3"

# A BARE work order: the five elements a job plan answers are blocked, and the
# blocked ones say WHY rather than reporting an empty count.
test "$(element_field "$E1" scope state)" = "blocked"
test "$(element_field "$E1" procedure state)" = "blocked"
test "$(element_field "$E1" tools state)" = "blocked"
test "$(element_field "$E1" permits state)" = "blocked"
test "$(element_field "$E1" quality state)" = "blocked"
expect_text "$(element_field "$E1" scope detail)" "has no job plan attached"
# NOT APPLICABLE is a positive finding from a canonical store and is NOT the
# same answer as ready: no material was ordered, so none can be short.
test "$(element_field "$E1" materials state)" = "not_applicable"
expect_text "$(element_field "$E1" materials detail)" "No material demand is recorded"
# AND "NOT ASSESSED" IS NOT "NOT APPLICABLE", on the safety element. With no
# job plan attached nothing identifies whether a permit is required, so the
# isolation position is UNVERIFIABLE. The first draft reported it
# `not_applicable` with the sentence "The job plan identifies no permit" —
# a positive finding from a store that is not there.
test "$(element_field "$E1" isolation state)" = "unverifiable"
expect_text "$(element_field "$E1" isolation detail)" "nothing identifies whether a permit"
expect_text "$(element_field "$E1" isolation detail)" "not the same finding as"

# THE THIRD ANSWER. Three elements have no canonical object and say so.
for KEY in crew access predecessor; do
  test "$(element_field "$E1" "$KEY" state)" = "unverifiable"
  test "$(element_field "$E1" "$KEY" source)" = "none"
  expect_text "$(element_field "$E1" "$KEY" detail)" "No canonical store"
  expect_text "$(element_field "$E1" "$KEY" detail)" "a named person clears"
done

# A JOB-PLANNED work order: the same five are ready, materials are blocked
# because the demand is short, and isolation is blocked because the plan
# requires a permit and no equipment release confirms one.
E2=$(elements "$W2" null)
test "$(element_field "$E2" scope state)" = "ready"
test "$(element_field "$E2" procedure state)" = "ready"
test "$(element_field "$E2" tools state)" = "ready"
test "$(element_field "$E2" permits state)" = "ready"
test "$(element_field "$E2" quality state)" = "ready"
test "$(element_field "$E2" materials state)" = "blocked"
test "$(element_field "$E2" isolation state)" = "blocked"
test "$(jqp "$E2" "x['permitsRequired']")" = "1"
expect_text "$(element_field "$E2" quality detail)" "1 of them hold points"

# NO ELEMENT WITHOUT A STORE IS EVER READY, whatever the work order looks like.
for BODY in "$E1" "$E2"; do
  test "$(jqp "$BODY" "sum(1 for e in x['elements'] if e['basisKind']=='declared' and e['state']!='unverifiable')")" = "0"
done

# A DRAFT job plan is not approved scope. Proved by moving the row and moving
# it back, so the assertion is about the rule rather than about a fixture.
psqlc "update job_plans set status='draft' where id='$JP';" >/dev/null
test "$(element_field "$(elements "$W2" null)" scope state)" = "blocked"
expect_text "$(element_field "$(elements "$W2" null)" scope detail)" "not adopted"
psqlc "update job_plans set status='adopted' where id='$JP';" >/dev/null
test "$(element_field "$(elements "$W2" null)" scope state)" = "ready"

# A work order that does not exist is refused, not answered with ten blanks.
test "$(jqp "$(psqlc "select sync_field_readiness_elements('00000000-0000-0000-0000-0000000000ff'::uuid, null)")" "x['answered']")" = "False"

echo "── 2. RULING 22 — Recovery's door refuses THROUGH the one predicate ─────"

# A minimal restoration event with a RELEASED plan containing the item. The
# recovery lifecycle transcript builds this through the RPCs; here it is
# arranged directly, because what is under test is the START door, not the
# planning chain that precedes it.
EVT=$(psqlc "with ins as (
  insert into restoration_events (organization_id, asset_id, event_code, event_type, reason, status)
  values ('$ORG','$ASSET','S7B-E1','unplanned','Drive train failure, used as the field-start probe','released')
  returning id) select id from ins")
test -n "$EVT"
EW3=$(psqlc "with ins as (
  insert into restoration_event_work (organization_id, event_id, work_order_id, plan_state, sequence_no, execution_status)
  values ('$ORG','$EVT','$W3','included',10,'not_started') returning id) select id from ins")
EW4=$(psqlc "with ins as (
  insert into restoration_event_work (organization_id, event_id, work_order_id, plan_state, sequence_no, execution_status)
  values ('$ORG','$EVT','$W4','included',20,'not_started') returning id) select id from ins")
test -n "$EW3"; test -n "$EW4"
psqlc "insert into restoration_plan_versions
        (organization_id, event_id, version, status, engine_version, schedule,
         historical_min_sample, missing_inputs, warnings,
         unresolved_planning_hard_constraints, baseline_snapshot, generated_by,
         released_by, released_at)
       values ('$ORG','$EVT',1,'released','smoke-7b',
         jsonb_build_array(jsonb_build_object('tasks', jsonb_build_array(
           jsonb_build_object('event_work_id','$EW3'),
           jsonb_build_object('event_work_id','$EW4')))),
         0,'[]'::jsonb,'[]'::jsonb,0,'{}'::jsonb,'$PLANNER_ID','$PLANNER_ID',now());" >/dev/null

# THE PARITY PROOF. The door's refusal is the ELEMENT's own sentence, compared
# character for character — the shape Slice 7A used to prove its screen and its
# door agree, applied here to the two rules that MOVED.
S=$(rpc "$TECH" start_restoration_work "{\"p_event_work_id\":\"$EW3\"}")
expect_err "$S" 'materials are not ready'
test "$(printf '%s' "$S" | field element)" = "materials"
DOOR_SENTENCE=$(printf '%s' "$S" | field error)
ELEMENT_SENTENCE=$(element_field "$(elements "$W3" "'$ASSET'")" materials detail)
test "$DOOR_SENTENCE" = "$ELEMENT_SENTENCE"
# AND AGAINST A LITERAL, not only against itself. The first draft claimed in
# four places that this sentence was 20260921090000's to the character; it is
# not — it names the count and ENDS with the historical wording. A substring
# assertion passed over exactly the change it said it guarded, so the string
# is pinned here in full and any further reword turns this line red.
test "$DOOR_SENTENCE" = "1 of 1 material line(s) on work order S7B-W3 remain requested or short — required materials are not ready."

# The inventory system resolves the shortage; Recovery itself never writes the
# material state.
psqlc "update work_order_materials set status='kitted', qty_reserved=qty_required where work_order_id='$W3';" >/dev/null

S=$(rpc "$TECH" start_restoration_work "{\"p_event_work_id\":\"$EW3\"}")
expect_err "$S" 'canonical equipment release does not confirm active isolation'
test "$(printf '%s' "$S" | field element)" = "isolation"
DOOR_SENTENCE=$(printf '%s' "$S" | field error)
ELEMENT_SENTENCE=$(element_field "$(elements "$W3" "'$ASSET'")" isolation detail)
test "$DOOR_SENTENCE" = "$ELEMENT_SENTENCE"
# THIS one IS 20260921090000:628 to the character, and is pinned as such.
test "$DOOR_SENTENCE" = "job plan requires permit/isolation; canonical equipment release does not confirm active isolation"

# THE GATE DID NOT WIDEN. S7B-W4 has NO job plan, so five of its ten elements
# are BLOCKED — and it starts anyway, because Recovery's blocking set is the
# historical two and moving where a rule lives is not licence to change what it
# refuses.
E4=$(elements "$W4" "'$ASSET'")
test "$(jqp "$E4" "sum(1 for e in x['elements'] if e['state']=='blocked')")" = "5"
S=$(rpc "$TECH" start_restoration_work "{\"p_event_work_id\":\"$EW4\"}")
noerr "$S"
test "$(printf '%s' "$S" | field permits_required)" = "0"
# …and the eight it does not gate on are REPORTED, so a supervisor can see the
# job has no approved scope even though the door let it start.
test "$(jqp "$S" "len(x['fieldReadiness'])")" = "10"

# SCOPED TO THIS WORK ORDER, deliberately. A release with a null work order
# covers every job on the asset, which would silently answer S7B-W2's isolation
# element as well and make step 3's count a fixture accident rather than a fact.
R=$(rpc "$OPS" release_equipment "{\"p_asset_id\":\"$ASSET\",\"p_work_order_id\":\"$W3\",\"p_isolation_confirmed\":true,\"p_isolation_note\":\"S7B operations isolation confirmed before maintenance starts\"}")
noerr "$R"
S=$(rpc "$TECH" start_restoration_work "{\"p_event_work_id\":\"$EW3\"}")
noerr "$S"
test "$(printf '%s' "$S" | field permits_required)" = "1"

# ── THE THIRD CONSUMER. `refresh_restoration_readiness` (20261001090000:305)
#    held a SECOND reading of work_order_materials with its own sentences, and
#    those rows gate the very door this slice routed through the shared
#    predicate — so the two disagreed live: the store said kitted, the
#    predicate said ready, and the recovery-derived row still said blocked,
#    refusing the start with a sentence that named no element at all. All
#    three mappings are proved here in ONE refresh, against the ELEMENT's own
#    sentence rather than a paraphrase of it.
#
#    A SECOND event, because the readiness refresh writes hard EXECUTION
#    constraints that gate a start, and this transcript's start assertions
#    above are about the DOOR rather than about what a refresh left behind.
# A SECOND ASSET, because one asset carries at most one active restoration
# event. The material element does not read the asset at all — only isolation
# does — so the readiness refresh reports the same material position here.
ASSET2=$(psqlc "with ins as (
  insert into assets (organization_id, site_id, name, criticality)
  values ('$ORG','$SITE','S7B lay-down bay','medium') returning id)
  select id from ins")
test -n "$ASSET2"
EVT2=$(psqlc "with ins as (
  insert into restoration_events (organization_id, asset_id, event_code, event_type, reason, status)
  values ('$ORG','$ASSET2','S7B-E2','planned','A second event used only to prove the readiness refresh reads the one predicate','released')
  returning id) select id from ins")
test -n "$EVT2"
psqlc "insert into restoration_event_work (organization_id, event_id, work_order_id, plan_state, sequence_no, execution_status)
       values ('$ORG','$EVT2','$W2','included',10,'not_started'),
              ('$ORG','$EVT2','$W3','included',20,'not_started'),
              ('$ORG','$EVT2','$W4','included',30,'not_started');" >/dev/null
R=$(rpc "$PLANNER" refresh_restoration_readiness "{\"p_event_id\":\"$EVT2\"}")
noerr "$R"
mat_agrees(){ # $1 work order id
  local ROW ELEM
  ROW=$(psqlc "select basis from restoration_constraints where event_id='$EVT2' and source_ref='recovery-v2:material:$1'")
  ELEM=$(element_field "$(elements "$1" "'$ASSET'")" materials detail)
  test -n "$ROW"; test "$ROW" = "$ELEM"
}
# BLOCKED — W2's demand is still short.
test "$(psqlc "select state from restoration_constraints where event_id='$EVT2' and source_ref='recovery-v2:material:$W2'")" = "blocked"
mat_agrees "$W2"
# SATISFIED — W3's demand was staged in the store, by the store.
test "$(psqlc "select state from restoration_constraints where event_id='$EVT2' and source_ref='recovery-v2:material:$W3'")" = "satisfied"
mat_agrees "$W3"
# NOT APPLICABLE — W4 has no demand at all, which is not the same answer as
# ready: nothing was ordered, so nothing can be short.
test "$(psqlc "select state from restoration_constraints where event_id='$EVT2' and source_ref='recovery-v2:material:$W4'")" = "not_applicable"
mat_agrees "$W4"

echo "── 2b. the predicate and the gate FAIL CLOSED ───────────────────────────"

# A JOB PLAN THAT CANNOT BE READ IS A REFUSAL, NOT A CLEAN BILL. The first
# draft added an organization filter to the plan lookup and let it fall through
# to `permits = 0` — so an unreadable plan became "the job plan identifies no
# permit, so no isolation is required", and a start the historical door refused
# went through reporting `permits_required: 0`.
psqlc "insert into work_orders (organization_id, asset_id, wo_number, title, status, job_plan_id)
       values ('$ORG','$ASSET','S7B-W5','Recovery probe — an unreadable job plan','pending', null);" >/dev/null
W5=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7B-W5'")
test -n "$W5"
# It joins the SECOND event, whose released plan is written once with this
# item already in it — a released restoration plan is immutable, which is the
# product working, so nothing here edits one.
EW5=$(psqlc "with ins as (
  insert into restoration_event_work (organization_id, event_id, work_order_id, plan_state, sequence_no, execution_status)
  values ('$ORG','$EVT2','$W5','included',40,'not_started') returning id) select id from ins")
test -n "$EW5"
psqlc "insert into restoration_plan_versions
        (organization_id, event_id, version, status, engine_version, schedule,
         historical_min_sample, missing_inputs, warnings,
         unresolved_planning_hard_constraints, baseline_snapshot, generated_by,
         released_by, released_at)
       values ('$ORG','$EVT2',1,'released','smoke-7b',
         jsonb_build_array(jsonb_build_object('tasks', jsonb_build_array(
           jsonb_build_object('event_work_id','$EW5')))),
         0,'[]'::jsonb,'[]'::jsonb,0,'{}'::jsonb,'$PLANNER_ID','$PLANNER_ID',now());" >/dev/null
FJP=$(psqlc "with ins as (
  insert into job_plans (organization_id, plan_key, title, scope, status, version, basis)
  values ('$ORG2','S7B-JPX','Foreign plan','A job plan belonging to another tenant','adopted',1,'Foreign fixture for the unreadable-plan probe')
  returning id) select id from ins")
test -n "$FJP"
psqlc "insert into job_plan_permits (organization_id, job_plan_id, permit_type, isolation_required, verification_note)
       values ('$ORG2','$FJP','electrical isolation','LOTO at MCC-3','Foreign fixture');" >/dev/null
psqlc "update work_orders set job_plan_id='$FJP' where id='$W5';" >/dev/null
FR=$(elements "$W5" "'$ASSET'")
test "$(jqp "$FR" "x['answered']")" = "False"
expect_text "$(printf '%s' "$FR" | field refusal)" "cannot be read in its own organization"
expect_text "$(printf '%s' "$FR" | field refusal)" "disarm the permit and isolation gate"
# AND THE DOOR REFUSES THROUGH IT rather than reading an empty element list as
# "nothing blocks" — which is what it did, starting the work and handing the
# caller ten elements rendered as zero.
S=$(rpc "$TECH" start_restoration_work "{\"p_event_work_id\":\"$EW5\"}")
expect_err "$S" "cannot be read in its own organization"
test "$(psqlc "select execution_status from restoration_event_work where id='$EW5'")" = "not_started"
psqlc "update work_orders set job_plan_id=null where id='$W5';" >/dev/null
psqlc "delete from job_plans where id='$FJP';" >/dev/null

# A GATE THAT NAMES NOTHING, OR NAMES A TYPO, RAISES. Both returned an empty
# blocker list — a door that looks armed and refuses nothing.
OUT=$(sql_must_fail "select sync_field_readiness_blockers(sync_field_readiness_elements('$W2'::uuid, null), array[]::text[]);")
expect_text "$OUT" "refuses nothing while looking armed"
OUT=$(sql_must_fail "select sync_field_readiness_blockers(sync_field_readiness_elements('$W2'::uuid, null), array['material','isolaton']);")
expect_text "$OUT" "which is not one of the ten elements"
# …and a payload the predicate REFUSED is not "no blockers" either.
OUT=$(sql_must_fail "select sync_field_readiness_blockers(sync_field_readiness_elements('00000000-0000-0000-0000-0000000000ff'::uuid, null), array['materials','isolation']);")
expect_text "$OUT" "did not answer"

# The gate keys a door may name are the ten the predicate returns, and the two
# lists are compared rather than trusted to match.
test "$(psqlc "select sync_field_readiness_element_keys()::text")" = "{scope,procedure,materials,tools,permits,isolation,quality,crew,access,predecessor}"

echo "── 3. D7.05 — the assessment, generalized to a §27 package ──────────────"

R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7B-P1\",\"title\":\"Drive train engineering\",\"package_type\":\"engineering\",\"scope\":\"Everything that must be issued before the drive train can be changed in the field\",\"required_by\":\"2027-03-01\"}}")
noerr "$R"; P1=$(printf '%s' "$R" | field work_package_id); test -n "$P1"

# An EMPTY package refuses assessment: an assessment over no work is an
# assessment of nothing, and "no blockers found" would read as ready.
RUNS_BEFORE=$(psqlc "select count(*) from calculation_runs where calculation_key='package_field_readiness' and (inputs->>'workPackageId')='$P1'")
R=$(rpc "$PLANNER" assess_package_field_readiness "{\"p_package_id\":$P1}")
expect_refusal "$R" "contains no work orders"
# A REFUSAL OVER A PACKAGE THIS FUNCTION COULD RESOLVE IS A LEDGER EVENT.
# D7.05 claimed "refusals included" and every refusal returned before the
# ledger write; `record_calculation_run` has minted `status = 'refused'` for a
# null outputs payload since 20261130090600:218.
REFRUN=$(printf '%s' "$R" | field calculationRunId); test -n "$REFRUN"
test "$(psqlc "select status from calculation_runs where id='$REFRUN'")" = "refused"
expect_text "$(psqlc "select refusals->0->>'reason' from calculation_runs where id='$REFRUN'")" "contains no work orders"
test "$(psqlc "select count(*) from calculation_runs where calculation_key='package_field_readiness' and (inputs->>'workPackageId')='$P1'")" \
   = "$((RUNS_BEFORE + 1))"
# …and a refusal is NOT read back as an assessment. `assessed` stays false.
R=$(rpc "$PLANNER" get_package_field_readiness "{\"p_package_id\":$P1}")
expect_refusal "$R" "contains no work orders, so there is no work"

R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$P1,\"p_work_order_id\":\"$W1\",\"p_basis\":\"Stripping the guarding is part of this engineering package\"}")
noerr "$R"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$P1,\"p_work_order_id\":\"$W2\",\"p_basis\":\"The drive change is the work this package exists to release\"}")
noerr "$R"

R=$(rpc "$PLANNER" assess_package_field_readiness "{\"p_package_id\":$P1}")
noerr "$R"
test "$(jqp "$R" "x['answered']")" = "True"
test "$(jqp "$R" "x['workOrders']")" = "2"
test "$(jqp "$R" "x['elementsPerWorkOrder']")" = "10"
# Five blocked on the bare work order, two on the planned one.
test "$(jqp "$R" "x['derivedBlockersRecorded']")" = "7"
# Three per work order, and nothing had raised them before.
test "$(jqp "$R" "x['declaredQuestionsRaised']")" = "6"
test "$(jqp "$R" "x['unverifiableElements']")" = "6"
# ONE DERIVED element the store could not answer: S7B-W1 has no job plan, so
# nothing identifies whether a permit and an isolation are required for it.
# That is recorded as a QUESTION (unknown), never as silence — an element with
# no reading recorded as no row at all is the empty checklist that passes.
test "$(jqp "$R" "x['derivedQuestionsRaised']")" = "1"
test "$(psqlc "select state from restoration_constraints where work_package_id=$P1 and source_ref='awp-field-ready:derived:isolation:$W1'")" = "unknown"
test "$(jqp "$R" "x['constraintsWritten']")" = "14"
RUN1=$(printf '%s' "$R" | field calculationRunId); test -n "$RUN1"
# THE ELEMENT COUNT IS DERIVED FROM THE PAYLOAD, not typed beside it: a lineage
# row stating "ten elements per work order" while the predicate returned nine
# records a claim about code that no longer exists.
test "$(psqlc "select outputs->>'elementsPerWorkOrder' from calculation_runs where id='$RUN1'")" = "10"
test "$(printf '%s' "$R" | field codeVersion)" = "develop-awp/7B/2026-12-11"

# NOTHING WAS MARKED SATISFIED. §70 reserves that for a person, and the
# assessment cannot reach it whoever runs it.
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$P1 and source_kind='derived' and state='satisfied'")" = "0"
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$P1 and source_kind='derived' and verified_by is not null")" = "0"
# The two states it may write, and no others.
test "$(psqlc "select string_agg(distinct state, ',' order by state) from restoration_constraints where work_package_id=$P1 and source_kind='derived'")" = "blocked,unknown"

# The run is a row in the ONE lineage ledger, under the pinned key.
test "$(psqlc "select count(*) from calculation_runs where id='$RUN1' and calculation_key='package_field_readiness'")" = "1"

# The verdict MOVED because the constraints moved — and it is the one verdict,
# not a second one the assessment states.
test "$(printf '%s' "$R" | field verdict)" = "not_ready"
test "$(jqp "$R" "x['canRelease']")" = "False"

echo "── 4. §70 in BOTH directions, on one identity ───────────────────────────"

# THE POSITIVE CONTROL FIRST. Slice 7A's §70 wall was over-broad in its first
# draft and refused two Recovery RPCs that legitimately admit ai_admin. A guard
# that refuses the right thing must not refuse the wrong one: gathering
# evidence is what §70 leaves to the machine, so the AI CAN assess.
R=$(rpc "$AIBOT" assess_package_field_readiness "{\"p_package_id\":$P1}")
noerr "$R"
test "$(jqp "$R" "x['answered']")" = "True"
test "$(jqp "$R" "x['derivedBlockersRecorded']")" = "7"
# …and even so it wrote no verifier and no satisfied state.
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$P1 and verified_by='$AIBOT_ID'")" = "0"

# AND THE REFUSALS, on the same identity in the same run.
CID=$(psqlc "select id from restoration_constraints where work_package_id=$P1 and constraint_kind='labour' order by id limit 1")
test -n "$CID"
R=$(rpc "$AIBOT" clear_package_constraint "{\"p_constraint_id\":\"$CID\",\"p_state\":\"satisfied\",\"p_basis\":\"The AI trying to close a constraint it raised itself\"}")
expect_err "$R" "reserves it for a person"
R=$(rpc "$AIBOT" release_work_package "{\"p_package_id\":$P1,\"p_note\":\"The AI trying to declare this package safe to start\"}")
expect_err "$R" "spec §70 reserves"

# The wall, not just the door: a direct write naming the AI as verifier.
OUT=$(sql_must_fail "update restoration_constraints set state='satisfied', verified_by='$AIBOT_ID', verified_at=now() where id='$CID';")
expect_text "$OUT" "cannot close a constraint"
# And a direct CLIENT write with no marker at all — simulated as the
# `authenticated` role carrying a real JWT, because as the table OWNER
# `auth.uid()` is null and 7A's wall deliberately ADMITS a service caller while
# recording it. A negative test run as the owner would prove the wrong thing.
OUT=$(sql_must_fail "set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','$PLANNER_ID','role','authenticated')::text, false);
insert into restoration_constraints (organization_id, work_package_id, constraint_kind, phase, is_hard, state, description, basis, source_kind)
values ('$ORG',$P1,'access','execution',true,'unknown','Written past every door','A direct client write with no role check and no audit row','manual');")
expect_text "$OUT" "A package constraint is recorded through record_package_constraint"

echo "── 5. re-assessment: evidence overwrites, judgement does not ────────────"

# A PERSON answers a question the machine cannot: the crew element on S7B-W1.
CREW=$(psqlc "select id from restoration_constraints where work_package_id=$P1 and work_order_id='$W1' and constraint_kind='labour' limit 1")
test -n "$CREW"
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$CREW\",\"p_state\":\"satisfied\",\"p_basis\":\"Two electricians and a rigger named on the shift roster, both tickets current\"}")
noerr "$R"
test "$(psqlc "select state from restoration_constraints where id='$CREW'")" = "satisfied"

# The inventory system stages S7B-W2's material — a change in a CANONICAL
# store, which the next assessment must honour without anybody touching a
# constraint. Recovery itself never writes the material state and neither does
# this path.
psqlc "update work_order_materials set status='kitted', qty_reserved=qty_required where work_order_id='$W2';" >/dev/null

A5=$(rpc "$PLANNER" assess_package_field_readiness "{\"p_package_id\":$P1}")
noerr "$A5"
# EVIDENCE OVERWRITES: the material blocker is gone, with nobody having
# verified anything — the store answered and the row simply is not there.
test "$(jqp "$A5" "x['derivedBlockersRecorded']")" = "6"
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$P1 and source_ref='awp-field-ready:derived:materials:$W2'")" = "0"
# The ISOLATION blocker is still there, and that is the rule working rather
# than a gap: permit, isolation and asset-state truth comes from the canonical
# operating and release controls, not from a toggle. Recovery's rule, preserved
# for the project path rather than exempted.
ISO=$(psqlc "select id from restoration_constraints where work_package_id=$P1 and source_ref='awp-field-ready:derived:isolation:$W2'")
test -n "$ISO"
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$ISO\",\"p_state\":\"satisfied\",\"p_basis\":\"Trying to declare an isolation satisfied from the work-package screen\"}")
expect_err "$R" "not a work-package toggle"
# JUDGEMENT DOES NOT: the answer a person gave is still there, still satisfied,
# and the machine did not re-ask the question by resurrecting it as unknown.
test "$(psqlc "select state from restoration_constraints where id='$CREW'")" = "satisfied"
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$P1 and source_ref='awp-field-ready:declared:crew:$W1'")" = "1"
# No question was raised twice.
test "$(jqp "$A5" "x['declaredQuestionsRaised']")" = "0"
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$P1 and source_kind='derived' and source_ref like 'awp-field-ready:declared:%'")" = "6"

# A DECLARED question a person already recorded by hand AGAINST THIS JOB is not
# asked again — and one recorded against the PACKAGE AS A WHOLE is not an
# answer to it. The first draft treated the two the same: one package-level
# `access` row silenced the access question for every work order in the
# package and for every work order added afterwards, whatever state it was
# left in, and the read then rendered that unrelated clearance beside the
# element. Both directions are proved here in ONE assessment.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7B-P2\",\"title\":\"Drive train procurement\",\"package_type\":\"procurement\",\"scope\":\"Buying the drive, the couplings and the alignment service for the change\",\"parent_package_code\":\"S7B-P1\"}}")
noerr "$R"; P2=$(printf '%s' "$R" | field work_package_id); test -n "$P2"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$P2,\"p_work_order_id\":\"$W3\",\"p_basis\":\"The drive purchase is the work this procurement package releases\"}")
noerr "$R"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$P2,\"p_work_order_id\":\"$W6\",\"p_basis\":\"Preparing the lay-down area is bought in with the drive delivery\"}")
noerr "$R"
# ONE PACKAGE-WIDE note, naming no job at all…
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$P2,\"p_constraint\":{\"constraint_type\":\"access\",\"description\":\"The lay-down area is shared with the shutdown crew\",\"basis\":\"Walked the route with the area supervisor and recorded the interference\"}}")
noerr "$R"
# …and ONE that names S7B-W6, which IS an answer about S7B-W6.
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$P2,\"p_constraint\":{\"constraint_type\":\"access\",\"description\":\"The lay-down bay for the preparation work is behind the shutdown hoarding\",\"basis\":\"Walked the bay with the area supervisor against the hoarding plan\",\"work_order_id\":\"$W6\"}}")
noerr "$R"
R=$(rpc "$PLANNER" assess_package_field_readiness "{\"p_package_id\":$P2}")
noerr "$R"
# FIVE of six: three for S7B-W3, whose access question the package-wide note
# does not answer, and two for S7B-W6, whose access question a person did.
test "$(jqp "$R" "x['declaredQuestionsRaised']")" = "5"
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$P2 and source_ref='awp-field-ready:declared:access:$W3'")" = "1"
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$P2 and source_ref='awp-field-ready:declared:access:$W6'")" = "0"
# …AND THE READ AGREES WITH THAT DECISION, on both jobs. Without the fallback
# the assessor's skip rule mirrors, S7B-W6's access element rendered with
# nothing against it and read as though nobody had addressed access at all — a
# screen strictly weaker than the store it is reporting. And S7B-W3's element
# must NOT borrow the package-wide row, which is about a different work face.
R=$(rpc "$PLANNER" get_package_field_readiness "{\"p_package_id\":$P2}")
noerr "$R"
test "$(jqp "$R" "[e['constraint']['sourceKind'] for i in x['items'] if i['workOrderId']=='$W6' for e in i['elements'] if e['key']=='access'][0]")" = "manual"
expect_text "$(jqp "$R" "[e['constraint']['basis'] for i in x['items'] if i['workOrderId']=='$W6' for e in i['elements'] if e['key']=='access'][0]")" "against the hoarding plan"
test "$(jqp "$R" "[e['constraint']['sourceKind'] for i in x['items'] if i['workOrderId']=='$W3' for e in i['elements'] if e['key']=='access'][0]")" = "derived"
expect_text "$(jqp "$R" "[e['constraint']['basis'] for i in x['items'] if i['workOrderId']=='$W3' for e in i['elements'] if e['key']=='access'][0]")" "No canonical store records physical access"
# A DERIVED element is NOT given the same fallback: a person's constraint about
# some other material is not evidence about this element's store position.
test "$(jqp "$R" "[e['constraint'] for i in x['items'] if i['workOrderId']=='$W3' for e in i['elements'] if e['key']=='materials'][0]")" = "None"

echo "── 6. D7.11 — which element, beside the constraint holding it ───────────"

R=$(rpc "$PLANNER" get_package_field_readiness "{\"p_package_id\":$P1}")
noerr "$R"
test "$(jqp "$R" "x['answered']")" = "True"
test "$(jqp "$R" "len(x['items'])")" = "2"
test "$(jqp "$R" "set(len(i['elements']) for i in x['items'])")" = "{10}"
test "$(jqp "$R" "x['assessed']")" = "True"
# The element a person answered carries THAT person's verdict, against the
# element it answers rather than against a count.
test "$(jqp "$R" "[e['constraint']['state'] for i in x['items'] if i['workOrderId']=='$W1' for e in i['elements'] if e['key']=='crew'][0]")" = "satisfied"
test "$(jqp "$R" "[e['constraint']['verifiedAt'] is not None for i in x['items'] if i['workOrderId']=='$W1' for e in i['elements'] if e['key']=='crew'][0]")" = "True"
# An element the stores answered has NO constraint at all — nothing to
# discharge, so nothing was recorded and nobody was named as having verified it.
test "$(jqp "$R" "[e['constraint'] for i in x['items'] if i['workOrderId']=='$W2' for e in i['elements'] if e['key']=='materials'][0]")" = "None"
# A blocked element names the constraint that holds it.
test "$(jqp "$R" "[e['constraint']['state'] for i in x['items'] if i['workOrderId']=='$W1' for e in i['elements'] if e['key']=='scope'][0]")" = "blocked"

# A package NOBODY has assessed says so in words, rather than rendering ten
# live element states as though somebody had walked them.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7B-P3\",\"title\":\"Drive train construction\",\"package_type\":\"construction\",\"scope\":\"Site works for the drive train change, recorded but never assessed for readiness\",\"parent_package_code\":\"S7B-P2\"}}")
noerr "$R"; P3=$(printf '%s' "$R" | field work_package_id); test -n "$P3"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$P3,\"p_work_order_id\":\"$W4\",\"p_basis\":\"The site works are the construction package's own scope of work\"}")
noerr "$R"
R=$(rpc "$PLANNER" get_package_field_readiness "{\"p_package_id\":$P3}")
noerr "$R"
test "$(jqp "$R" "x['assessed']")" = "False"
expect_text "$(printf '%s' "$R" | field assessmentNote)" "No field-readiness assessment has been recorded"
# …and its release verdict is the ONE verdict, which refuses it as UNASSESSED
# because nobody has recorded a constraint against it either.
test "$(printf '%s' "$R" | field readinessVerdict)" = "unassessed"

echo "── 7. D13.09 — ONE verdict across the door, the read and the board ──────"

B=$(rpc "$PLANNER" get_execution_readiness_board '{"p_case_id":null}')
noerr "$B"
test "$(jqp "$B" "x['answered']")" = "True"
# THE PARITY, three ways. The board's sentence, the package read's sentence and
# the release door's refusal are one string.
BOARD_SENTENCE=$(jqp "$B" "[p['readiness'] for p in x['packages'] if p['packageCode']=='S7B-P1'][0]")
R=$(rpc "$PLANNER" get_package_field_readiness "{\"p_package_id\":$P1}")
READ_SENTENCE=$(printf '%s' "$R" | field readiness)
D=$(rpc "$MANAGER" release_work_package "{\"p_package_id\":$P1,\"p_note\":\"Trying to release the package while its assessment still names open items\"}")
DOOR_SENTENCE=$(printf '%s' "$D" | field error)
test "$BOARD_SENTENCE" = "$READ_SENTENCE"
test "$BOARD_SENTENCE" = "$DOOR_SENTENCE"
test "$(jqp "$B" "[p['readinessVerdict'] for p in x['packages'] if p['packageCode']=='S7B-P1'][0]")" = "not_ready"
test "$(printf '%s' "$D" | field verdict)" = "not_ready"

# WHOSE IT IS. Every open hard constraint on the board carries an owner and
# says whether the assessment raised it or a person recorded it.
test "$(jqp "$B" "min(len(p['blockingItems']) for p in x['packages'] if p['packageCode']=='S7B-P1')" )" != "0"
test "$(jqp "$B" "all(i['ownerRole'] for p in x['packages'] if p['packageCode']=='S7B-P1' for i in p['blockingItems'])")" = "True"
test "$(jqp "$B" "sorted(set(i['sourceKind'] for p in x['packages'] if p['packageCode']=='S7B-P1' for i in p['blockingItems']))")" = "['derived']"

# THE RECORDED ASSESSMENT, read back rather than recomputed.
test "$(jqp "$B" "[p['fieldReadinessAssessed'] for p in x['packages'] if p['packageCode']=='S7B-P1'][0]")" = "True"
test "$(jqp "$B" "[p['fieldReadinessOutputs']['derivedBlockersRecorded'] for p in x['packages'] if p['packageCode']=='S7B-P1'][0]")" = "6"
# …and a package nobody walked says so on the board too.
test "$(jqp "$B" "[p['fieldReadinessAssessed'] for p in x['packages'] if p['packageCode']=='S7B-P3'][0]")" = "False"
expect_text "$(jqp "$B" "[p['fieldReadinessNote'] for p in x['packages'] if p['packageCode']=='S7B-P3'][0]")" "Not assessed"

# CASE SCOPE — asserted on the case-scoped board rather than the org-wide one,
# which legitimately carries other cases' packages and would make any ordering
# claim about it a claim about the seed.
B2=$(rpc "$PLANNER" get_execution_readiness_board "{\"p_case_id\":\"$CASE\"}")
noerr "$B2"
test "$(jqp "$B2" "sorted(p['packageCode'] for p in x['packages'])")" = "['S7B-P1', 'S7B-P2', 'S7B-P3']"
# UNDATED PACKAGES SORT LAST, in the ORDER RETURNED. S7B-P1 carries a
# required-by; P2 and P3 do not, and at the top of a list a supervisor works
# down, "nobody said when" would read as most urgent.
test "$(jqp "$B2" "[p['packageCode'] for p in x['packages']][0]")" = "S7B-P1"
test "$(jqp "$B2" "[p['requiredBy'] for p in x['packages']][0]")" = "2027-03-01"
test "$(jqp "$B2" "[p['requiredBy'] for p in x['packages']][1:]")" = "[None, None]"
B3=$(rpc "$PLANNER" get_execution_readiness_board "{\"p_case_id\":\"$CASE2\"}")
expect_refusal "$B3" "No work package has been recorded on this case"
expect_refusal "$B3" "nothing is waiting on anybody"

echo "── 8. D7.06 — the release, through the one verdict, and the freeze ──────"

# A DERIVED blocker is discharged by fixing what the store says, never by a
# toggle. Engineering issues the plan for the guarding strip…
psqlc "update work_orders set job_plan_id='$JP' where id='$W1';" >/dev/null
# …and operations hands the asset back and re-releases it for the whole asset,
# through the product's own doors, so both jobs have a confirmed isolation.
R=$(rpc "$TECH" return_equipment "{\"p_asset_id\":\"$ASSET\",\"p_note\":\"S7B probe work complete; guards restored and equipment offered back\"}")
noerr "$R"
R=$(rpc "$OPS" accept_equipment "{\"p_asset_id\":\"$ASSET\",\"p_note\":\"S7B operations accepts the equipment back before the package isolation\"}")
noerr "$R"
R=$(rpc "$OPS" release_equipment "{\"p_asset_id\":\"$ASSET\",\"p_work_order_id\":null,\"p_isolation_confirmed\":true,\"p_isolation_note\":\"S7B asset isolated for the whole drive-train package, LOTO applied at MCC-3\"}")
noerr "$R"

R=$(rpc "$PLANNER" assess_package_field_readiness "{\"p_package_id\":$P1}")
noerr "$R"
# Every DERIVED blocker is gone, and not one of them was cleared by hand.
test "$(jqp "$R" "x['derivedBlockersRecorded']")" = "0"
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$P1 and source_ref like 'awp-field-ready:derived:%' and source_ref not like '%:declared:%'")" = "0"
# What remains is exactly the DECLARED half: the questions no store can answer.
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$P1 and is_hard and state in ('unknown','blocked')")" = "5"

# And those are discharged one at a time by a named person, with a basis.
psqlc "select id from restoration_constraints where work_package_id=$P1 and is_hard and state in ('unknown','blocked') order by id" \
  | while IFS='|' read -r CX; do
      test -n "$CX"
      OUT=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$CX\",\"p_state\":\"satisfied\",\"p_basis\":\"Walked with the area supervisor and recorded against the roster, the route and the sequence\"}")
      noerr "$OUT"
    done
test "$(psqlc "select count(*) from restoration_constraints where work_package_id=$P1 and is_hard and state in ('unknown','blocked')")" = "0"

R=$(rpc "$PLANNER" get_package_field_readiness "{\"p_package_id\":$P1}")
test "$(printf '%s' "$R" | field readinessVerdict)" = "ready_for_human"
# READY FOR A PERSON is not RELEASED, and the sentence says so.
expect_text "$(printf '%s' "$R" | field readiness)" "Release is a §70 human act and has not been performed"

R=$(rpc "$MANAGER" release_work_package "{\"p_package_id\":$P1,\"p_note\":\"Every element walked, every open item cleared by a named person, safe to start\"}")
noerr "$R"
test "$(printf '%s' "$R" | field status)" = "released"

# A released package's constraint set is what the release was checked against
# and does not grow — so it cannot be re-assessed either.
R=$(rpc "$PLANNER" assess_package_field_readiness "{\"p_package_id\":$P1}")
expect_refusal "$R" "does not grow afterwards"

# …and it leaves the board, because the board is the packages a person must
# still act on.
B=$(rpc "$PLANNER" get_execution_readiness_board "{\"p_case_id\":\"$CASE\"}")
noerr "$B"
test "$(jqp "$B" "sorted(p['packageCode'] for p in x['packages'])")" = "['S7B-P2', 'S7B-P3']"
test "$(jqp "$B" "x['packageCount']")" = "3"
test "$(jqp "$B" "x['awaitingRelease']")" = "2"

# A CANCELLED package is refused an assessment too: a readiness position for
# work nobody intends to do is a number with nothing behind it.
R=$(rpc "$MANAGER" cancel_work_package "{\"p_package_id\":$P3,\"p_reason\":\"The construction scope moved to the neighbouring case and this package is withdrawn\"}")
noerr "$R"
R=$(rpc "$PLANNER" assess_package_field_readiness "{\"p_package_id\":$P3}")
expect_refusal "$R" "was cancelled"

echo "── 8b. the recorded assessment must still be TRUE ───────────────────────"

# THE DEFECT THIS STEP EXISTS FOR. A package is assessed, its questions are
# cleared by a named person, and then a canonical store moves. Nothing
# re-derived, nothing expired, and every surface read `ready_for_human` with
# `assessed: true` and a date beside it — while Recovery's start door, on the
# SAME work order at the SAME instant, refused. The ONE verdict now carries a
# seventh REFUSING state for exactly this, so the door and the screen still say
# one thing.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7B-P4\",\"title\":\"Drive train field works\",\"package_type\":\"engineering\",\"scope\":\"The field works for the drive change, used to prove a recorded assessment can go stale\",\"required_by\":\"2027-04-01\"}}")
noerr "$R"; P4=$(printf '%s' "$R" | field work_package_id); test -n "$P4"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$P4,\"p_work_order_id\":\"$W3\",\"p_basis\":\"The drive change is the field work this package releases\"}")
noerr "$R"
R=$(rpc "$PLANNER" assess_package_field_readiness "{\"p_package_id\":$P4}")
noerr "$R"
# Every store answers for S7B-W3 by now, so nothing derived is recorded and the
# only open items are the three no store can answer.
test "$(jqp "$R" "x['derivedBlockersRecorded']")" = "0"
test "$(jqp "$R" "x['derivedQuestionsRaised']")" = "0"
test "$(jqp "$R" "x['declaredQuestionsRaised']")" = "3"
psqlc "select id from restoration_constraints where work_package_id=$P4 and is_hard and state in ('unknown','blocked') order by id" \
  | while IFS='|' read -r CX; do
      test -n "$CX"
      OUT=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$CX\",\"p_state\":\"satisfied\",\"p_basis\":\"Walked with the area supervisor and recorded against the roster, the route and the sequence\"}")
      noerr "$OUT"
    done

# The three surfaces, before anything moves.
verdict_of(){ # $1 package id  $2 package code -> "verdict|read sentence|board sentence"
  local RR BB
  RR=$(rpc "$PLANNER" get_package_field_readiness "{\"p_package_id\":$1}")
  BB=$(rpc "$PLANNER" get_execution_readiness_board "{\"p_case_id\":\"$CASE\"}")
  printf '%s|%s|%s|%s' \
    "$(printf '%s' "$RR" | field readinessVerdict)" \
    "$(printf '%s' "$RR" | field readiness)" \
    "$(jqp "$BB" "[p['readinessVerdict'] for p in x['packages'] if p['packageCode']=='$2'][0]")" \
    "$(jqp "$BB" "[p['readiness'] for p in x['packages'] if p['packageCode']=='$2'][0]")"
}
IFS='|' read -r V1 RS1 V2 BS1 <<<"$(verdict_of "$P4" S7B-P4)"
test "$V1" = "ready_for_human"; test "$V2" = "ready_for_human"; test "$RS1" = "$BS1"

# ── TRIGGER A: the canonical store moves under a clean assessment. The
#    inventory system marks the drive parts short again; nobody touches a
#    constraint and nobody re-assesses.
psqlc "update work_order_materials set status='short' where work_order_id='$W3';" >/dev/null
IFS='|' read -r V1 RS1 V2 BS1 <<<"$(verdict_of "$P4" S7B-P4)"
test "$V1" = "stale"; test "$V2" = "stale"; test "$RS1" = "$BS1"
expect_text "$RS1" "no longer describes the work"
expect_text "$RS1" "Materials staged on work order S7B-W3 is blocked"
expect_text "$RS1" "Re-assess it"
# THE DOOR SAYS THE SAME WORDS. This is the parity 7A proved for six states,
# holding for the seventh — and holding in the direction that matters: the
# screen refuses because the DOOR refuses, not instead of it.
D=$(rpc "$MANAGER" release_work_package "{\"p_package_id\":$P4,\"p_note\":\"Releasing a package whose assessment the stores have moved past\"}")
test "$(printf '%s' "$D" | field verdict)" = "stale"
test "$(printf '%s' "$D" | field error)" = "$RS1"
test "$(psqlc "select released_at is null from work_packages where id=$P4")" = "t"
# …and `assessed` is still TRUE. The surfaces do not hide the assessment; the
# verdict says the assessment is no longer a description of the work.
R=$(rpc "$PLANNER" get_package_field_readiness "{\"p_package_id\":$P4}")
test "$(jqp "$R" "x['assessed']")" = "True"
test "$(jqp "$R" "x['canRelease']")" = "False"

# ── THE TOGGLE. Re-assess so the shortage is recorded, then try to close it by
#    hand with a plausible basis. A DERIVED row carries a store's answer, not a
#    judgement: the migration's own smoke stated that rule in a comment and
#    never tested it, and the toggle worked.
R=$(rpc "$PLANNER" assess_package_field_readiness "{\"p_package_id\":$P4}")
noerr "$R"
test "$(jqp "$R" "x['derivedBlockersRecorded']")" = "1"
MATC=$(psqlc "select id from restoration_constraints where work_package_id=$P4 and source_ref='awp-field-ready:derived:materials:$W3'")
test -n "$MATC"
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$MATC\",\"p_state\":\"satisfied\",\"p_basis\":\"The storeman says the parts are on the truck and will be here in the morning\"}")
expect_err "$R" "DERIVED from a canonical store"
expect_err "$R" "materials"
# `not_applicable` is the same bypass wearing another word, and is refused too.
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$MATC\",\"p_state\":\"not_applicable\",\"p_basis\":\"Deciding from the work-package screen that the shortage does not apply\"}")
expect_err "$R" "DERIVED from a canonical store"
test "$(psqlc "select state from restoration_constraints where id='$MATC'")" = "blocked"
# It is discharged by fixing what the store says, and only that way.
psqlc "update work_order_materials set status='kitted' where work_order_id='$W3';" >/dev/null
R=$(rpc "$PLANNER" assess_package_field_readiness "{\"p_package_id\":$P4}")
noerr "$R"
test "$(jqp "$R" "x['derivedBlockersRecorded']")" = "0"
IFS='|' read -r V1 RS1 V2 BS1 <<<"$(verdict_of "$P4" S7B-P4)"
test "$V1" = "ready_for_human"; test "$V2" = "ready_for_human"

# ── TRIGGER B: a job added to the package AFTER the assessment, through the
#    product's own door. Five of its elements are blocked, its permit position
#    is unreadable and nobody has been asked about its crew, access or
#    predecessors — and the board carried the live work-order count beside the
#    recorded one and stated no disagreement.
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$P4,\"p_work_order_id\":\"$W4\",\"p_basis\":\"The guard reinstatement was added to the field package after it was walked\"}")
noerr "$R"
IFS='|' read -r V1 RS1 V2 BS1 <<<"$(verdict_of "$P4" S7B-P4)"
test "$V1" = "stale"; test "$V2" = "stale"; test "$RS1" = "$BS1"
expect_text "$RS1" "S7B-W4"
# The gaps are ITEMIZED, not counted: which element, on which job, and why.
GAPS=$(psqlc "select sync_work_package_release_verdict($P4)->'fieldReadinessGaps'")
test "$(jqp "$GAPS" "sorted(set(g['reason'] for g in x))")" = "['blocked_and_unheld', 'never_asked', 'unanswerable_and_unheld']"
test "$(jqp "$GAPS" "sorted(set(g['woNumber'] for g in x))")" = "['S7B-W4']"
# Assessing it is what discharges the staleness — and it lands on NOT READY,
# because the new job really is not ready.
R=$(rpc "$PLANNER" assess_package_field_readiness "{\"p_package_id\":$P4}")
noerr "$R"
test "$(jqp "$R" "x['workOrders']")" = "2"
IFS='|' read -r V1 RS1 V2 BS1 <<<"$(verdict_of "$P4" S7B-P4)"
test "$V1" = "not_ready"; test "$V2" = "not_ready"; test "$RS1" = "$BS1"
# AND THE BOUNDARY, STATED RATHER THAN IMPLIED. The seventh state fires only
# where an assessment was RECORDED — a package nobody ever walked still reaches
# `ready_for_human` on a person's own cleared constraints, exactly as Slice 7A
# shipped it. That residual is D7.06's, it is named on the row, and this
# transcript does not pretend it was closed here.
test "$(psqlc "select count(*) from calculation_runs where calculation_key='package_field_readiness' and status='computed' and (inputs->>'workPackageId')='$P2'")" != "0"

echo "── 9. cross-tenant ──────────────────────────────────────────────────────"

B=$(rpc "$FOREIGN" get_execution_readiness_board '{"p_case_id":null}')
FOREIGN_CODES=$(jqp "$B" "sorted(p['packageCode'] for p in x.get('packages') or []) if x.get('answered') else []")
test "$FOREIGN_CODES" = "[]"
R=$(rpc "$FOREIGN" get_package_field_readiness "{\"p_package_id\":$P2}")
expect_refusal "$R" "work package not found"
R=$(rpc "$FOREIGN" assess_package_field_readiness "{\"p_package_id\":$P2}")
expect_refusal "$R" "work package not found"

echo
echo "Sync Develop slice 7B smoke PASSED — one field-readiness predicate on the"
echo "work identity, consumed by Recovery's start door and by the AWP"
echo "assessment; ten elements with three named as unverifiable rather than"
echo "invented; nothing marked satisfied by a machine; the AI admitted to"
echo "assess and refused to clear or release; and ONE release verdict compared"
echo "character for character across the door, the package read and the board."

#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 7C — resources, competency readiness and the workface
# metrics. Four of these rows are PERCENTAGES, and this transcript exists
# mostly to prove they refuse.
#
#   D7.01  ResourceDemand / ResourceCapacity — nine categories, time-phased,
#          on the EXTENDED craft_capacity family rather than a second store.
#   D7.02  Portfolio resource-conflict detection — collective feasibility
#          across cases, and the weekly feasibility door reading it.
#   D7.03  Competency requirement + the availability record's write paths.
#   D7.04  Qualified WHEN NEEDED — the expiring-certificate flip.
#   D7.08  Forward constraint-free work        ┐ ONE calculation, two rows.
#   D7.20  Constraint-Free Work Index (§49)    ┘
#   D7.13  Planned-work-ready %.
#   D7.14  Ready-work-executed %.
#   D7.16  The composed Sync Field module, with its open parts named.
#
# Every step is a live transcript against a real local database, run TWICE in
# a row on one database before it was committed.
#
# Steps:
#   0  fixtures: two cases, a site, an asset, an adopted job plan, work
#      orders, four engineering work packages, and the AI and foreign
#      identities.
#   1  D7.01 — the balance REFUSES over a case with no demand (UNASSESSED is
#      not "no resources required"), NaN and Infinity are refused by name at
#      the door AND at the table, a double-counted cell is refused, and the
#      answer is time-phased with a not-assessable category reported as such.
#   2  §70 — the AI identity may RECORD demand (evidence assembly) and may
#      NOT approve it, refused at the DATABASE by direct SQL as well as at the
#      RPC. The legitimate callers on every table this slice walls still work.
#   3  D7.02 — the portfolio refuses with nothing approved, then two projects
#      that each fit alone and do not fit together are reported
#      `collective_only`; the weekly feasibility door carries the same
#      predicate's answer and its own labour arithmetic is unchanged.
#   4  D7.03 — the write paths: a competency, a member, a holding, a shift and
#      a requirement, each refusing what it should.
#   5  D7.04 — readiness refuses with no window and with no requirement, then
#      THE FLIP: a member qualified today whose ticket lapses before the work
#      is NOT counted as available, and says so by name.
#   6  D7.08 + D7.20 — ONE calculation. The index refuses over no packages,
#      over an undated set and over a wholly unassessed one; the forward half
#      refuses while anything is unprojectable; both are recorded as ONE
#      lineage run under ONE key.
#   7  D7.13 + D7.14 — the empty denominator, and the difference between
#      "assessed and none ready" and "nothing assessable" stated in words.
#   8  D7.16 — the composition, and the parts it says are still open.
#   9  cross-tenant: a foreign member sees no demand, no requirement and no
#      metric.
#
# Run: supabase start && scripts/ci-develop-slice7c-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-7c smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
ORG2='7c000000-0000-4000-8000-7c000000000c'

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
expect_answered(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if not isinstance(x,dict) or x.get('answered') is not True:
    print('expected an answered payload, got:',str(x)[:800]); sys.exit(1)
PY
}
expect_text(){ HAY="$1" NEEDLE="$2" python3 - <<'PY'
import os,sys
if os.environ['NEEDLE'].lower() not in os.environ['HAY'].lower():
    print('expected text containing %r, got: %s' % (os.environ['NEEDLE'], os.environ['HAY'][:800])); sys.exit(1)
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
# A named sub-object of a payload, so an assertion about the ratio itself
# reads as one instead of being buried in a python expression.
sub(){ BODY="$1" KEY="$2" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
print(json.dumps(x.get(os.environ['KEY'])))
PY
}

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$TECH"

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
declare v_uid uuid := '7c7c7c7c-7777-4777-8777-7c7c7c7c7c7c';
        v_org uuid := '7c000000-0000-4000-8000-7c000000000c';
begin
  insert into organizations (id, name) values (v_org, 'S7C foreign tenant')
    on conflict (id) do nothing;
  if not exists (select 1 from auth.users where email = 'smoke7c-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke7c-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'S7C foreign member'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  if not exists (select 1 from auth.identities where user_id = v_uid) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke7c-foreign@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_uid, v_org, 'smoke7c-foreign@syncai.ca', 'maintenance_manager')
  on conflict (id) do update set organization_id = v_org, role = 'maintenance_manager';
end $seed$;
PSQL
FOREIGN=$(token 'smoke7c-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGN"

# ── Idempotent re-run. Fixture keys are kept SHORT on purpose — long fixture
#    identifiers have been read as secrets by the repository's scanner and have
#    blocked merges.
#
#    Nothing here deletes something the product forbids deleting. An APPROVED
#    demand line refuses deletion while its case exists and a competency
#    requirement refuses deletion outright, so the teardown deletes the
#    OWNERS — the cases and the competencies — and every dependent row goes
#    with them through the declared cascades each wall admits mid-cascade.
psqlc "delete from development_cases where organization_id='$ORG' and title like 'S7C %';" >/dev/null
psqlc "delete from development_cases where organization_id='$ORG2' and title like 'S7C %';" >/dev/null
psqlc "delete from competencies where organization_id='$ORG' and competency_key like 'S7C-%';" >/dev/null
psqlc "delete from workforce_members where organization_id='$ORG' and employee_ref like 'S7C-%';" >/dev/null
psqlc "delete from craft_capacity where organization_id='$ORG' and craft like 'S7C-%';" >/dev/null
psqlc "delete from capacity_deductions where organization_id='$ORG' and craft like 'S7C-%';" >/dev/null
psqlc "delete from work_orders where organization_id='$ORG' and wo_number like 'S7C-%';" >/dev/null
psqlc "delete from job_plans where organization_id='$ORG' and plan_key like 'S7C-%';" >/dev/null
psqlc "delete from assets where organization_id='$ORG' and name like 'S7C %';" >/dev/null
psqlc "delete from work_packages where organization_id='$ORG' and package_code like 'S7C-%';" >/dev/null
psqlc "delete from schedule_options where organization_id='$ORG' and label like 'S7C %';" >/dev/null
# The connector, its mapping, its runs and its staged rows go with it; the
# capacity rows it imported carry S7C- crafts and are deleted above.
psqlc "delete from connectors where organization_id='$ORG' and connector_key='S7CCONN';" >/dev/null
psqlc "delete from ingest_staging where organization_id='$ORG' and external_id like 'S7C-CC-%';" >/dev/null
psqlc "delete from sites where organization_id='$ORG2' and name like 'S7C %';" >/dev/null
psqlc "update sites set source_system=null, external_id=null where organization_id='$ORG' and source_system='S7CCONN';" >/dev/null
# SCOPED TO THIS SLICE'S OWN FIXTURES, like the work_packages line below it.
# These two asserted a GLOBAL zero over the whole demo org, so any row in
# either table from any source — a sibling smoke earlier in the same CI job,
# a seed that gains one, a developer exercising the now-live write paths —
# would abort this transcript at a precondition with a message pointing at 7C.
# Observed failing exactly that way during review, caused by another session's
# fixtures rather than by anything this slice does.
test "$(psqlc "select count(*) from resource_demand d join development_cases c on c.id = d.development_case_id where d.organization_id='$ORG' and c.title like 'S7C %'")" = "0"
test "$(psqlc "select count(*) from competency_requirements r join competencies c on c.id = r.competency_id where r.organization_id='$ORG' and c.competency_key like 'S7C-%'")" = "0"
test "$(psqlc "select count(*) from work_packages where organization_id='$ORG' and package_code like 'S7C-%'")" = "0"

TODAY=$(psqlc "select current_date::text")
D30=$(psqlc "select (current_date + 30)::text")
D45=$(psqlc "select (current_date + 45)::text")
D60=$(psqlc "select (current_date + 60)::text")
D10=$(psqlc "select (current_date + 10)::text")

echo "── 0. fixtures: two cases, an adopted job plan, work orders, packages ───"

R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S7C workforce case\",\"p_problem_statement\":\"Crew demand and crew capacity are recorded in different shapes and never compared, so a project reads as resourced until the week it is not, and nothing says whether the people who will do the work are still qualified on the day.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE=$(printf '%s' "$R" | field case_id); test -n "$CASE"

R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S7C neighbouring case\",\"p_problem_statement\":\"A second development case competing for the same commissioning team, used here to prove that two individually feasible projects can be collectively impossible and that nothing in a per-project view can see it.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE2=$(printf '%s' "$R" | field case_id); test -n "$CASE2"

SITE=$(psqlc "select id from sites where organization_id='$ORG' order by created_at limit 1")
test -n "$SITE"
ASSET=$(psqlc "with ins as (
  insert into assets (organization_id, site_id, name, criticality)
  values ('$ORG','$SITE','S7C mill drive','high') returning id)
  select id from ins")
test -n "$ASSET"

JP=$(psqlc "with ins as (
  insert into job_plans (organization_id, plan_key, title, scope, status, version, basis)
  values ('$ORG','S7C-JP1','S7C drive change','Remove, replace and align the mill drive',
          'adopted', 1, 'Written for the slice 7C transcript') returning id)
  select id from ins")
test -n "$JP"
psqlc "insert into job_plan_steps (organization_id, job_plan_id, step_number, description, craft, crew_size, estimated_hours)
       values ('$ORG','$JP',1,'Isolate and prove dead','S7C-elec',2,4),
              ('$ORG','$JP',2,'Remove the drive','S7C-mech',3,8);" >/dev/null
psqlc "insert into job_plan_tools (organization_id, job_plan_id, tool, note)
       values ('$ORG','$JP','20 t gantry','Rated for the drive mass');" >/dev/null
psqlc "insert into job_plan_permits (organization_id, job_plan_id, permit_type, isolation_required, verification_note)
       values ('$ORG','$JP','electrical isolation','LOTO at MCC-3','Proved dead at the terminals');" >/dev/null
psqlc "insert into job_plan_checks (organization_id, job_plan_id, check_description, acceptance_criterion, is_hold_point)
       values ('$ORG','$JP','Alignment','Within 0.05 mm TIR', true);" >/dev/null

psqlc "insert into work_orders (organization_id, asset_id, wo_number, title, status, job_plan_id)
       values ('$ORG','$ASSET','S7C-W1','Change the mill drive','pending','$JP'),
              ('$ORG','$ASSET','S7C-W2','Align and grout the drive','pending','$JP'),
              ('$ORG','$ASSET','S7C-W3','Strip the guarding','pending', null),
              ('$ORG','$ASSET','S7C-W4','Lay-down preparation','in_progress','$JP');" >/dev/null
W1=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7C-W1'")
W2=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7C-W2'")
W3=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7C-W3'")
W4=$(psqlc "select id from work_orders where organization_id='$ORG' and wo_number='S7C-W4'")
test -n "$W1"; test -n "$W2"; test -n "$W3"; test -n "$W4"

psqlc "insert into work_order_tasks (organization_id, work_order_id, task_sequence, description, craft, estimated_hours)
       values ('$ORG','$W1',1,'Drive change','S7C-mech',40);" >/dev/null

# FOUR ENGINEERING packages. Engineering is the head of the AWP chain and has
# no parent (RULING 19/D7.10), so this transcript exercises the metrics
# without re-testing 7A's chain rules, which have their own transcript.
for spec in "S7C-E1|First drive package|$D30" "S7C-E2|Second drive package|$D45" "S7C-E3|Third drive package|$D60"; do
  IFS='|' read -r code title req <<<"$spec"
  R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"$code\",\"title\":\"$title\",\"package_type\":\"engineering\",\"scope\":\"Issue the drive general arrangement and the electrical single line for this package\",\"required_by\":\"$req\"}}")
  noerr "$R"
done
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE\",\"p_package\":{\"package_code\":\"S7C-E4\",\"title\":\"Undated package\",\"package_type\":\"engineering\",\"scope\":\"An engineering package nobody has dated, so it belongs to no planning window\"}}")
noerr "$R"
E1=$(psqlc "select id from work_packages where organization_id='$ORG' and package_code='S7C-E1'")
E2=$(psqlc "select id from work_packages where organization_id='$ORG' and package_code='S7C-E2'")
E3=$(psqlc "select id from work_packages where organization_id='$ORG' and package_code='S7C-E3'")
E4=$(psqlc "select id from work_packages where organization_id='$ORG' and package_code='S7C-E4'")
test -n "$E1"; test -n "$E2"; test -n "$E3"; test -n "$E4"

R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$E1,\"p_work_order_id\":\"$W1\",\"p_basis\":\"Changing the drive is the physical work this engineering package is issued for\"}")
noerr "$R"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$E1,\"p_work_order_id\":\"$W2\",\"p_basis\":\"Alignment and grouting complete the same drive change and share its access window\"}")
noerr "$R"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$E2,\"p_work_order_id\":\"$W3\",\"p_basis\":\"Stripping the guarding is separate scope released under the second package\"}")
noerr "$R"
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$E3,\"p_work_order_id\":\"$W4\",\"p_basis\":\"Lay-down preparation is the third package's only job and it is already under way\"}")
noerr "$R"

echo "── 1. D7.01 — refusal first, then a time-phased balance ─────────────────"

# THE ROW. A case with no demand recorded is UNASSESSED, and the refusal says
# so in those words rather than reporting a clean resource position.
R=$(rpc "$PLANNER" get_case_resource_balance "{\"p_case_id\":\"$CASE\",\"p_horizon_weeks\":12}")
expect_refusal "$R" "no resource demand has been recorded"
expect_refusal "$R" "it is UNASSESSED"

# A horizon that is not a horizon.
R=$(rpc "$PLANNER" get_case_resource_balance "{\"p_case_id\":\"$CASE\",\"p_horizon_weeks\":0}")
expect_refusal "$R" "1 to 260"
R=$(rpc "$PLANNER" get_case_resource_balance "{\"p_case_id\":\"$CASE\",\"p_horizon_weeks\":-4}")
expect_refusal "$R" "1 to 260"

# Capacity, on the EXTENDED store. Two categories, so the balance has one it
# can assess and one it must refuse.
R=$(rpc "$PLANNER" record_resource_capacity "{\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-mech\",\"weeklyHours\":120,\"basis\":\"Three fitters at forty delivered hours each, from the current roster\",\"siteId\":\"$SITE\"}}")
expect_answered "$R"
R=$(rpc "$PLANNER" record_resource_capacity "{\"p_payload\":{\"category\":\"commissioning\",\"pool\":\"S7C-comm\",\"weeklyHours\":80,\"basis\":\"Two commissioning engineers at forty delivered hours each, shared across the portfolio\",\"siteId\":\"$SITE\"}}")
expect_answered "$R"
R=$(rpc "$PLANNER" record_capacity_deduction "{\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-mech\",\"deductionKind\":\"training\",\"weeklyHours\":6,\"basis\":\"Mandatory refresher training, two hours per fitter per week\",\"siteId\":\"$SITE\"}}")
expect_answered "$R"

# NON-FINITE NUMBERS, REFUSED BY NAME. `weekly_hours > 0` admits NaN in
# Postgres — NaN compares GREATER than every other numeric — so this is the
# guard the range check could never be.
R=$(rpc "$PLANNER" record_resource_capacity "{\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-nan\",\"weeklyHours\":\"NaN\",\"basis\":\"A capacity figure that is not a number at all, offered to the door\"}}")
expect_refusal "$R" "finite number greater than zero"
R=$(rpc "$PLANNER" record_resource_capacity "{\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-inf\",\"weeklyHours\":\"Infinity\",\"basis\":\"A capacity figure of infinite hours, offered to the door\"}}")
expect_refusal "$R" "finite number greater than zero"
R=$(rpc "$PLANNER" record_resource_capacity "{\"p_payload\":{\"category\":\"warp_drive\",\"pool\":\"S7C-mech\",\"weeklyHours\":10,\"basis\":\"A category that is not one of the nine the specification lists\"}}")
expect_refusal "$R" "not one of the nine resource categories"

# AND AT THE TABLE, not only at the door. A direct write with no RPC in front
# of it is refused by the CHECK constraint, which is what makes the door's
# refusal a policy rather than the only guard.
OUT=$(sql_must_fail "insert into craft_capacity (organization_id, craft, weekly_hours, basis, resource_category)
  values ('$ORG','S7C-direct','NaN','A direct write bypassing every RPC','skilled_trades');")
expect_text "$OUT" "craft_capacity_hours_finite"

# Demand, TIME-PHASED. A line with no period cannot be recorded at all.
R=$(rpc "$PLANNER" record_resource_demand "{\"p_case_id\":\"$CASE\",\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-mech\",\"demandHours\":800,\"basis\":\"Eight hundred fitter hours from the adopted job plan for the drive change\"}}")
expect_refusal "$R" "TIME-PHASED by definition"
R=$(rpc "$PLANNER" record_resource_demand "{\"p_case_id\":\"$CASE\",\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-mech\",\"demandHours\":\"NaN\",\"periodStart\":\"$TODAY\",\"periodEnd\":\"$D30\",\"basis\":\"A demand line whose hours are not a number, offered to the door\"}}")
expect_refusal "$R" "NaN and infinity are refused by name"

R=$(rpc "$PLANNER" record_resource_demand "{\"p_case_id\":\"$CASE\",\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-mech\",\"demandHours\":800,\"periodStart\":\"$TODAY\",\"periodEnd\":\"$D30\",\"sourceKind\":\"job_plan\",\"basis\":\"Eight hundred fitter hours from the adopted job plan for the drive change\",\"workPackageId\":\"$E1\"}}")
expect_answered "$R"; DEM1=$(printf '%s' "$R" | field demandId); test -n "$DEM1"
test "$(printf '%s' "$R" | field approved)" = "False"

# A SECOND LINE FOR THE SAME CELL IS A DOUBLE COUNT, and a double count is the
# one arithmetic error a portfolio view cannot survive.
R=$(rpc "$PLANNER" record_resource_demand "{\"p_case_id\":\"$CASE\",\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-mech\",\"demandHours\":50,\"periodStart\":\"$TODAY\",\"periodEnd\":\"$D30\",\"sourceKind\":\"estimate\",\"basis\":\"The same cell restated, which would silently double the hours in the balance\",\"workPackageId\":\"$E1\"}}")
expect_refusal "$R" "double-count"

# A category with NO recorded capacity. Reported NOT ASSESSABLE, never zero.
R=$(rpc "$PLANNER" record_resource_demand "{\"p_case_id\":\"$CASE\",\"p_payload\":{\"category\":\"cranes\",\"pool\":\"S7C-gantry\",\"demandHours\":60,\"periodStart\":\"$TODAY\",\"periodEnd\":\"$D30\",\"sourceKind\":\"estimate\",\"basis\":\"Sixty gantry hours estimated for the lift, with no crane capacity recorded anywhere\"}}")
expect_answered "$R"; DEMCRANE=$(printf '%s' "$R" | field demandId); test -n "$DEMCRANE"

R=$(rpc "$PLANNER" get_case_resource_balance "{\"p_case_id\":\"$CASE\",\"p_horizon_weeks\":12}")
expect_answered "$R"
test "$(jqp "$R" "x['liveDemandLines']")" = "2"
test "$(jqp "$R" "x['categoriesInSpec']")" = "9"
test "$(jqp "$R" "len(x['cells'])")" = "2"
test "$(jqp "$R" "sum(1 for c in x['cells'] if c['state']=='not_assessable')")" = "1"
# The trades cell IS assessable and IS over-committed: 200 hours asked of a
# pool delivering 120 a week over a window shorter than two weeks.
test "$(jqp "$R" "[c['state'] for c in x['cells'] if c['category']=='skilled_trades'][0]")" = "over_committed"
expect_text "$(jqp "$R" "[c['detail'] for c in x['cells'] if c['category']=='cranes'][0]")" "not assessable"
expect_text "$(jqp "$R" "[c['detail'] for c in x['cells'] if c['category']=='cranes'][0]")" "not inferred from headcount"
# The deductions are ITEMIZED beside the declared figure and NOT subtracted
# from it — craft_capacity.weekly_hours is net by its own definition, and
# deducting twice would halve every crew in the product.
test "$(jqp "$R" "[c['weeklyHours'] for c in x['cells'] if c['category']=='skilled_trades'][0]")" = "120"
test "$(jqp "$R" "len([c for c in x['cells'] if c['category']=='skilled_trades'][0]['deductionsItemised'])")" = "1"

# A window nobody has phased work into is NOT a window with capacity to spare.
psqlc "update resource_demand set period_start = current_date + 200, period_end = current_date + 240
       where organization_id='$ORG' and development_case_id='$CASE';" >/dev/null
R=$(rpc "$PLANNER" get_case_resource_balance "{\"p_case_id\":\"$CASE\",\"p_horizon_weeks\":4}")
expect_refusal "$R" "nobody has phased work into"
psqlc "update resource_demand set period_start = current_date, period_end = current_date + 30
       where organization_id='$ORG' and development_case_id='$CASE';" >/dev/null

echo "── 2. §70 — the AI may draft the demand and may not approve it ──────────"

# A GUARD THAT REFUSES THE RIGHT THING MUST NOT REFUSE THE WRONG ONE. The AI
# identity CAN record demand: assembling evidence is the half §70 leaves to
# the machine (RULING 22's scoping), and a wall over the drafting act would be
# the over-broad §70 Slice 7A had to narrow.
R=$(rpc "$AIBOT" record_resource_demand "{\"p_case_id\":\"$CASE\",\"p_payload\":{\"category\":\"commissioning\",\"pool\":\"S7C-comm\",\"demandHours\":250,\"periodStart\":\"$TODAY\",\"periodEnd\":\"$D30\",\"sourceKind\":\"job_plan\",\"basis\":\"Two hundred and fifty commissioning hours read off the adopted job plan by the agent\"}}")
expect_answered "$R"; DEMC=$(printf '%s' "$R" | field demandId); test -n "$DEMC"

# And CANNOT approve it — at the RPC by role list, and at the DATABASE by the
# ONE §70 wall, which is what makes the refusal survive every other path.
R=$(rpc "$AIBOT" approve_resource_demand "{\"p_demand_id\":$DEMC,\"p_note\":\"The agent attempting to commit named people's hours to a project window\"}")
expect_refusal "$R" "requires a planning, supervisory or governance role"
OUT=$(sql_must_fail "update resource_demand set approved_by='$AIBOT_ID', approved_at=now(),
  approval_note='A direct write committing the crew, bypassing every RPC in the product'
  where id=$DEMC;")
expect_text "$OUT" "approve a roster"
expect_text "$OUT" "reserved for a person"

# A person approves, and the approval states what is being committed.
R=$(rpc "$MANAGER" approve_resource_demand "{\"p_demand_id\":$DEMC,\"p_note\":\"short\"}")
expect_refusal "$R" "at least 20 characters"
R=$(rpc "$MANAGER" approve_resource_demand "{\"p_demand_id\":$DEMC,\"p_note\":\"Committing both commissioning engineers to this project for the whole of the window\"}")
expect_answered "$R"
R=$(rpc "$MANAGER" approve_resource_demand "{\"p_demand_id\":$DEMC,\"p_note\":\"A second approval over a commitment that has already been approved once\"}")
expect_refusal "$R" "already approved"

# THE APPROVAL IS NOT REWRITABLE and the approved line is not deletable while
# its case stands. Withdrawal is the product's act and it keeps both the
# commitment and its retraction legible.
OUT=$(sql_must_fail "update resource_demand set demand_hours = 5 where id=$DEMC;")
expect_text "$OUT" "is approved: its hours, period, category and pool"
OUT=$(sql_must_fail "delete from resource_demand where id=$DEMC;")
expect_text "$OUT" "withdraw it with a reason instead"

# The audit ledger carries the act with both states.
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='resource_demand'
                and event_data->>'act'='approve' and previous_state->>'approved'='false'
                and new_state->>'approved'='true'")" != "0"

echo "── 3. D7.02 — individually feasible, collectively impossible ────────────"

# Nothing approved on the neighbouring case yet, but a portfolio with SOME
# approved demand answers. Prove the empty case first on a window nothing
# reaches into.
R=$(rpc "$PLANNER" get_portfolio_resource_conflicts "{\"p_horizon_weeks\":0}")
expect_refusal "$R" "1 to 260"

# The neighbouring project books the SAME commissioning pool for the same
# window. Each fits alone; together they do not.
R=$(rpc "$PLANNER" record_resource_demand "{\"p_case_id\":\"$CASE2\",\"p_payload\":{\"category\":\"commissioning\",\"pool\":\"S7C-comm\",\"demandHours\":250,\"periodStart\":\"$TODAY\",\"periodEnd\":\"$D30\",\"sourceKind\":\"estimate\",\"basis\":\"Two hundred and fifty commissioning hours for the neighbouring project over the same window\"}}")
expect_answered "$R"; DEMC2=$(printf '%s' "$R" | field demandId); test -n "$DEMC2"

# WHILE IT IS ONLY A DRAFT it is counted and reported, never summed into a
# conflict: a draft is a planner thinking out loud.
R=$(rpc "$PLANNER" get_portfolio_resource_conflicts "{\"p_horizon_weeks\":5}")
expect_answered "$R"
test "$(jqp "$R" "x['draftDemandLines']")" != "0"
test "$(jqp "$R" "x['collectiveOnlyConflicts']")" = "0"

R=$(rpc "$MANAGER" approve_resource_demand "{\"p_demand_id\":$DEMC2,\"p_note\":\"Committing the same commissioning pair to the neighbouring project across the same weeks\"}")
expect_answered "$R"

R=$(rpc "$PLANNER" get_portfolio_resource_conflicts "{\"p_horizon_weeks\":5}")
expect_answered "$R"
test "$(jqp "$R" "x['casesWithCommitments']")" = "2"
test "$(jqp "$R" "x['collectiveOnlyConflicts']")" = "1"
COMM=$(jqp "$R" "json.dumps([p for p in x['pools'] if p['category']=='commissioning'][0])")
test "$(jqp "$COMM" "x['state']")" = "collective_only"
expect_text "$(jqp "$COMM" "x['detail']")" "individually executable, collectively impossible"
test "$(jqp "$COMM" "len(x['contributions'])")" = "2"
# EACH project fits alone: the largest single-case ask is inside the capacity,
# which is what makes "individually executable" a computed claim.
test "$(jqp "$COMM" "x['largestSingleCaseHours'] <= x['capacityHours']")" = "True"
test "$(jqp "$COMM" "x['committedHours'] > x['capacityHours']")" = "True"

# THE WEEKLY DOOR reads the same predicate — one engine, a collective arm.
OPT=$(psqlc "with ins as (
  insert into schedule_options (organization_id, week_start, label, strategy, items, total_hours, capacity_hours)
  values ('$ORG', current_date, 'S7C week', 'balanced',
          jsonb_build_array(jsonb_build_object('wo_id','$W1','hours',40)), 40, 200)
  returning id) select id from ins")
test -n "$OPT"
R=$(rpc "$PLANNER" evaluate_schedule_feasibility "{\"p_option_id\":\"$OPT\"}")
noerr "$R"
PORT=$(jqp "$R" "json.dumps([c for c in x['checks'] if c['constraint']=='Portfolio resource commitments'][0])")
test "$(jqp "$PORT" "x['severity']")" = "warning"
test "$(jqp "$PORT" "x['scope']")" = "every development case in this organization, this week"
test "$(jqp "$PORT" "x['passed']")" = "False"
expect_text "$(jqp "$PORT" "x['detail']")" "every project fits alone and the set does not"
# The LABOUR check's own arithmetic is untouched and it now says what it sees.
LAB=$(jqp "$R" "json.dumps([c for c in x['checks'] if c['constraint']=='Labour capacity'][0])")
test "$(jqp "$LAB" "x['scope']")" = "this weekly option only"
# And the checks the door has always carried are all still there.
test "$(jqp "$R" "sum(1 for c in x['checks'] if c['constraint']=='Safety consequence clearance')")" = "1"
test "$(jqp "$R" "sum(1 for c in x['checks'] if c['constraint']=='Active Recovery commitments')")" = "1"
test "$(jqp "$R" "sum(1 for c in x['checks'] if c['constraint']=='Production window')")" = "1"

# A withdrawn commitment stops counting, and says why it stopped.
R=$(rpc "$MANAGER" withdraw_resource_demand "{\"p_demand_id\":$DEMC2,\"p_reason\":\"The neighbouring project moved its commissioning window into the following quarter\"}")
expect_answered "$R"
R=$(rpc "$PLANNER" get_portfolio_resource_conflicts "{\"p_horizon_weeks\":5}")
expect_answered "$R"
test "$(jqp "$R" "x['collectiveOnlyConflicts']")" = "0"
test "$(psqlc "select count(*) from resource_demand where id=$DEMC2 and withdrawn_at is not null")" = "1"

echo "── 4. D7.03 — the write paths the register called demoted ───────────────"

R=$(rpc "$PLANNER" record_competency "{\"p_payload\":{\"competencyKey\":\"S7C-CSE\",\"title\":\"S7C confined space entrant\",\"kind\":\"statutory_authorisation\",\"isStatutory\":true}}")
expect_refusal "$R" "would never expire anybody"
R=$(rpc "$PLANNER" record_competency "{\"p_payload\":{\"competencyKey\":\"S7C-CSE\",\"title\":\"S7C confined space entrant\",\"kind\":\"statutory_authorisation\",\"isStatutory\":true,\"validityMonths\":24}}")
expect_answered "$R"; COMP=$(printf '%s' "$R" | field competencyId); test -n "$COMP"
R=$(rpc "$PLANNER" record_competency "{\"p_payload\":{\"competencyKey\":\"S7C-RIG\",\"title\":\"S7C rigging ticket\",\"kind\":\"certification\",\"validityMonths\":36}}")
expect_answered "$R"; COMP2=$(printf '%s' "$R" | field competencyId); test -n "$COMP2"

R=$(rpc "$PLANNER" record_workforce_member "{\"p_payload\":{\"employeeRef\":\"S7C-M1\",\"displayName\":\"S7C fitter one\",\"craft\":\"S7C-mech\",\"siteId\":\"$SITE\"}}")
expect_answered "$R"; M1=$(printf '%s' "$R" | field memberId); test -n "$M1"
R=$(rpc "$PLANNER" record_workforce_member "{\"p_payload\":{\"employeeRef\":\"S7C-M2\",\"displayName\":\"S7C fitter two\",\"craft\":\"S7C-mech\",\"siteId\":\"$SITE\"}}")
expect_answered "$R"; M2=$(printf '%s' "$R" | field memberId); test -n "$M2"
R=$(rpc "$PLANNER" record_workforce_member "{\"p_payload\":{\"employeeRef\":\"S7C-M1\",\"displayName\":\"S7C duplicate\",\"craft\":\"S7C-mech\"}}")
expect_refusal "$R" "already exists"

# A holding needs its evidence named. A qualification with nothing behind it
# is an assertion.
R=$(rpc "$PLANNER" record_member_competency "{\"p_payload\":{\"memberId\":$M1,\"competencyId\":$COMP}}")
expect_refusal "$R" "names its evidence"
# M1 is qualified THROUGH the work: expiry is derived from the competency's
# own stated validity period, which is master data somebody recorded.
R=$(rpc "$PLANNER" record_member_competency "{\"p_payload\":{\"memberId\":$M1,\"competencyId\":$COMP,\"evidenceReference\":\"Certificate CSE-1187\"}}")
expect_answered "$R"
# M2 holds the same ticket and it LAPSES BEFORE THE WORK. This is the row.
R=$(rpc "$PLANNER" record_member_competency "{\"p_payload\":{\"memberId\":$M2,\"competencyId\":$COMP,\"grantedOn\":\"$TODAY\",\"expiresOn\":\"$D10\",\"evidenceReference\":\"Certificate CSE-1188, expiring inside the work window\"}}")
expect_answered "$R"

# §70 AT THE DATABASE: the AI identity cannot be recorded as having declared a
# person competent, by any path.
OUT=$(sql_must_fail "insert into member_competencies (organization_id, member_id, competency_id, granted_on, verified_by)
  values ('$ORG', $M1, $COMP2, current_date, '$AIBOT_ID');")
expect_text "$OUT" "declare a person competent"
# AND THE WALL DOES NOT BLOCK THE LEGITIMATE PATH. The pre-existing writer of
# this table sets NO verifier, so a verifier-less insert still lands — the
# scoping check RULING 20's residual asks for.
psqlc "insert into member_competencies (organization_id, member_id, competency_id, granted_on)
       values ('$ORG', $M2, $COMP2, current_date);" >/dev/null
test "$(psqlc "select count(*) from member_competencies where member_id=$M2 and competency_id=$COMP2")" = "1"

# The roster, and the requirement.
R=$(rpc "$PLANNER" record_shift_assignment "{\"p_payload\":{\"memberId\":$M1,\"startsAt\":\"${TODAY}T06:00:00Z\",\"endsAt\":\"${TODAY}T18:00:00Z\",\"shiftKind\":\"day\"}}")
expect_answered "$R"
R=$(rpc "$PLANNER" record_shift_assignment "{\"p_payload\":{\"memberId\":$M2,\"startsAt\":\"${TODAY}T06:00:00Z\",\"endsAt\":\"${TODAY}T18:00:00Z\",\"shiftKind\":\"day\"}}")
expect_answered "$R"
R=$(rpc "$PLANNER" record_shift_assignment "{\"p_payload\":{\"memberId\":$M1,\"startsAt\":\"${TODAY}T18:00:00Z\",\"endsAt\":\"${TODAY}T06:00:00Z\"}}")
expect_refusal "$R" "ends after it starts"

R=$(rpc "$PLANNER" record_competency_requirement "{\"p_payload\":{\"competencyId\":$COMP,\"craft\":\"S7C-mech\",\"workPackageId\":\"$E1\",\"minHolders\":2,\"basis\":\"A requirement anchored to both a craft and a package, which is two answers to one question\"}}")
expect_refusal "$R" "EXACTLY one"
R=$(rpc "$PLANNER" record_competency_requirement "{\"p_payload\":{\"competencyId\":$COMP,\"craft\":\"S7C-mech\",\"minHolders\":2,\"basis\":\"The drive change is a confined-space job and the standard requires two authorised entrants\"}}")
expect_answered "$R"; REQ=$(printf '%s' "$R" | field requirementId); test -n "$REQ"

# A requirement is retired, never deleted: one that disappears leaves every
# past readiness answer standing over a question nobody can see was asked.
OUT=$(sql_must_fail "delete from competency_requirements where id=$REQ;")
expect_text "$OUT" "retire it with a reason instead"

echo "── 5. D7.04 — qualified WHEN NEEDED, and the certificate that lapses ────"

# No window: "qualified when needed" has no answer when nothing says when.
R=$(rpc "$PLANNER" get_competency_readiness "{\"p_package_id\":$E4}")
expect_refusal "$R" "has no \"when\""

# No requirement in scope for that package's crafts: UNASSESSED, not clean.
R=$(rpc "$PLANNER" get_competency_readiness "{\"p_package_id\":$E2}")
expect_refusal "$R" "That is UNASSESSED"

R=$(rpc "$PLANNER" get_competency_readiness "{\"p_package_id\":$E1}")
expect_answered "$R"
test "$(jqp "$R" "x['requirementsInScope']")" = "1"
REQROW=$(jqp "$R" "json.dumps(x['requirements'][0])")
# TWO holders today. ONE of them is qualified through the work. The other's
# ticket lapses inside the window, and that is stated by name rather than
# folded into "not qualified".
test "$(jqp "$REQROW" "x['minHolders']")" = "2"
test "$(jqp "$REQROW" "x['holdersQualifiedWhenNeeded']")" = "1"
test "$(jqp "$REQROW" "x['holdersExpiringInWindow']")" = "1"
test "$(jqp "$REQROW" "x['state']")" = "short"
expect_text "$(jqp "$REQROW" "x['detail']")" "qualified today, not qualified when the work happens"
test "$(jqp "$REQROW" "[h['whenNeeded'] for h in x['holders'] if h['displayName']=='S7C fitter two'][0]")" = "expires_during_window"
test "$(jqp "$REQROW" "[h['whenNeeded'] for h in x['holders'] if h['displayName']=='S7C fitter one'][0]")" = "qualified_through"
test "$(jqp "$R" "x['readyToCrew']")" = "False"
expect_text "$(jqp "$R" "json.dumps(x['refusals'])")" "qualified TODAY and not qualified WHEN THE WORK HAPPENS"

# THE FLIP, PROVED IN BOTH DIRECTIONS. Push the second ticket beyond the work
# and the same predicate now counts that person; nothing else changed.
psqlc "update member_competencies set expires_on = current_date + 400
       where member_id=$M2 and competency_id=$COMP;" >/dev/null
R=$(rpc "$PLANNER" get_competency_readiness "{\"p_package_id\":$E1}")
expect_answered "$R"
test "$(jqp "$R" "x['requirements'][0]['holdersQualifiedWhenNeeded']")" = "2"
test "$(jqp "$R" "x['requirements'][0]['holdersExpiringInWindow']")" = "0"
test "$(jqp "$R" "x['requirements'][0]['state']")" = "met"
test "$(jqp "$R" "x['readyToCrew']")" = "True"
psqlc "update member_competencies set expires_on = current_date + 10
       where member_id=$M2 and competency_id=$COMP;" >/dev/null

# The recorded position, into the ONE lineage ledger.
R=$(rpc "$PLANNER" compute_competency_readiness "{\"p_package_id\":$E1}")
expect_answered "$R"
RUN=$(printf '%s' "$R" | field calculationRunId); test -n "$RUN"
test "$(psqlc "select calculation_key from calculation_runs where id='$RUN'")" = "competency_readiness"
test "$(psqlc "select code_version from calculation_runs where id='$RUN'")" = "develop-workforce/7C/2026-12-12"
test "$(psqlc "select status from calculation_runs where id='$RUN'")" = "computed_with_refusals"
# A REFUSAL IS RECORDED TOO, so a history cannot show a clean run of readiness
# positions with the unassessed weeks silently missing.
R=$(rpc "$PLANNER" compute_competency_readiness "{\"p_package_id\":$E2}")
expect_refusal "$R" "UNASSESSED"
RUN2=$(printf '%s' "$R" | field calculationRunId); test -n "$RUN2"
test "$(psqlc "select status from calculation_runs where id='$RUN2'")" = "refused"

echo "── 6. D7.08 + D7.20 — ONE calculation, two register rows ────────────────"

# An empty case, so the refusal over an unpackaged project is exercised on a
# case that genuinely has none.
R=$(rpc "$PLANNER" get_constraint_free_work_index "{\"p_case_id\":\"$CASE2\",\"p_horizon_days\":90}")
expect_refusal "$R" "NOT 100% constraint-free"
expect_refusal "$R" "has not been packaged"

R=$(rpc "$PLANNER" get_constraint_free_work_index "{\"p_case_id\":\"$CASE\",\"p_horizon_days\":0}")
expect_refusal "$R" "1 to 1825"

# A horizon that reaches no dated package. Three of the four are dated at 30,
# 45 and 60 days out, so a five-day window reaches none of them.
R=$(rpc "$PLANNER" get_constraint_free_work_index "{\"p_case_id\":\"$CASE\",\"p_horizon_days\":5}")
expect_refusal "$R" "is not a constraint-free one"

# THE WHOLE SET IS UNASSESSED — no constraint recorded against any package.
# 0% here would say "constraints are blocking this work" about work nobody has
# looked at, so it refuses and says which fact it is refusing to state.
R=$(rpc "$PLANNER" get_constraint_free_work_index "{\"p_case_id\":\"$CASE\",\"p_horizon_days\":90}")
expect_answered "$R"
test "$(jqp "$R" "x['plannedPackages']")" = "3"
test "$(jqp "$R" "x['assessedPackages']")" = "0"
test "$(jqp "$R" "x['unassessedPackages']")" = "3"
IDX=$(sub "$R" constraintFreeWorkIndex)
test "$(jqp "$IDX" "x['answered']")" = "False"
test "$(jqp "$IDX" "x['kind']")" = "not_assessed"
expect_text "$(jqp "$IDX" "x['refusal']")" "opposite facts"
FWD=$(sub "$R" forwardConstraintFreeWork)
test "$(jqp "$FWD" "x['answered']")" = "False"

# Record constraints. E1 gets a hard one that is cleared; E2 gets a hard one
# that stays open and is FORECAST clear before it is needed; E3 gets one with
# no forecast at all, which is what makes the forward half refuse.
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$E1,\"p_constraint\":{\"constraint_type\":\"DRAWING\",\"description\":\"Issued-for-construction drawing for the drive base\",\"basis\":\"The design is complete and the drawing is in the review queue\",\"is_hard\":\"true\",\"owner_role\":\"planner\",\"required_by\":\"$D30\"}}")
noerr "$R"; C1=$(printf '%s' "$R" | field constraint_id); test -n "$C1"
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$E2,\"p_constraint\":{\"constraint_type\":\"MATERIAL\",\"description\":\"Long-lead guarding steel for the second package\",\"basis\":\"Ordered against the framework agreement with a stated delivery date\",\"is_hard\":\"true\",\"owner_role\":\"planner\",\"required_by\":\"$D45\"}}")
noerr "$R"; C2=$(printf '%s' "$R" | field constraint_id); test -n "$C2"
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$E3,\"p_constraint\":{\"constraint_type\":\"ACCESS\",\"description\":\"Access to the lay-down area for the third package\",\"basis\":\"Nobody has yet forecast when the area will be handed over\",\"is_hard\":\"true\",\"owner_role\":\"supervisor\",\"required_by\":\"$D60\"}}")
noerr "$R"; C3=$(printf '%s' "$R" | field constraint_id); test -n "$C3"

R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$C1\",\"p_state\":\"satisfied\",\"p_basis\":\"The issued-for-construction drawing was released to the site this morning\"}")
noerr "$R"
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$C2\",\"p_forecast\":{\"expected_clear_date\":\"$D30\",\"probability_of_clearance\":0.8,\"probability_basis\":\"The supplier has confirmed the shipping date against the framework agreement\",\"schedule_impact_days\":0,\"impact_basis\":\"No impact is expected while the delivery lands ahead of the required-by date\"}}")
noerr "$R"

R=$(rpc "$PLANNER" get_constraint_free_work_index "{\"p_case_id\":\"$CASE\",\"p_horizon_days\":90}")
expect_answered "$R"
test "$(jqp "$R" "x['assessedPackages']")" = "3"
test "$(jqp "$R" "x['readyPackages']")" = "1"
test "$(jqp "$R" "x['unassessedPackages']")" = "0"
IDX=$(sub "$R" constraintFreeWorkIndex)
test "$(jqp "$IDX" "x['answered']")" = "True"
test "$(jqp "$IDX" "x['pct']")" = "33.3"
test "$(jqp "$IDX" "x['numerator']")" = "1"
test "$(jqp "$IDX" "x['denominator']")" = "3"
# THE FORWARD HALF REFUSES while E3's constraint carries no forecast at all: a
# forward figure over a partly unprojectable set states a future nobody made.
FWD=$(sub "$R" forwardConstraintFreeWork)
test "$(jqp "$FWD" "x['answered']")" = "False"
test "$(jqp "$FWD" "x['kind']")" = "not_projectable"
test "$(jqp "$R" "x['notProjectable']")" = "1"
# THE READINESS SENTENCES ARE THE ONE VERDICT'S OWN, character for character.
VERD=$(psqlc "select sync_work_package_release_verdict($E1)->>'reason'")
test "$(jqp "$R" "[p['readiness'] for p in x['packages'] if p['packageCode']=='S7C-E1'][0]")" = "$VERD"

# Forecast the third one and the forward half answers, over the SAME
# denominator as the index — one calculation with two faces.
R=$(rpc "$PLANNER" forecast_package_constraint "{\"p_constraint_id\":\"$C3\",\"p_forecast\":{\"expected_clear_date\":\"$D45\",\"probability_of_clearance\":0.6,\"probability_basis\":\"Operations have indicated the lay-down area frees up after the shutdown\",\"schedule_impact_days\":0,\"impact_basis\":\"No impact is expected while the handover lands ahead of the required-by date\"}}")
noerr "$R"
R=$(rpc "$PLANNER" get_constraint_free_work_index "{\"p_case_id\":\"$CASE\",\"p_horizon_days\":90}")
expect_answered "$R"
FWD=$(sub "$R" forwardConstraintFreeWork)
IDX=$(sub "$R" constraintFreeWorkIndex)
test "$(jqp "$FWD" "x['answered']")" = "True"
test "$(jqp "$FWD" "x['pct']")" = "100.0"
test "$(jqp "$FWD" "x['denominator']")" = "$(jqp "$IDX" "x['denominator']")"
test "$(jqp "$R" "x['forecastClearInTime']")" = "2"

# OVERDUE IS ITS OWN SET, OUTSIDE THE WINDOW. A package needed on a date that
# has passed while still unreleased is LATE — a fact about the calendar rather
# than a gap in the constraint register — and it is neither a forward position
# nor a silence. It is listed with the days by which it has slipped, and it
# defines NO denominator: a percentage the screen labels "the next N days"
# cannot be computed from work that was due last week.
PLANNED_BEFORE=$(jqp "$R" "x['plannedPackages']")
psqlc "update work_packages set required_by = current_date - 5 where id=$E3;" >/dev/null
R=$(rpc "$PLANNER" get_constraint_free_work_index "{\"p_case_id\":\"$CASE\",\"p_horizon_days\":90}")
expect_answered "$R"
test "$(jqp "$R" "x['overduePackages']")" = "1"
test "$(jqp "$R" "x['plannedPackages']")" = "$((PLANNED_BEFORE - 1))"
test "$(jqp "$R" "x['overdue'][0]['packageCode']")" = "S7C-E3"
test "$(jqp "$R" "x['overdue'][0]['forward']")" = "overdue"
test "$(jqp "$R" "x['overdue'][0]['daysOverdue']")" = "5"
test "$(jqp "$R" "x['overdue'][0]['inWindow']")" = "False"
# And it is NOT in the in-window list, where it would have been counted.
test "$(jqp "$R" "sum(1 for p in x['packages'] if p['packageCode']=='S7C-E3')")" = "0"
expect_text "$(jqp "$R" "x['overdue'][0]['projectionRefusal']")" "5 day(s) ago, and is still unreleased"
expect_text "$(jqp "$R" "json.dumps(x['refusals'])")" "ALREADY PASSED"
# THE KNOCK-ON THAT USED TO BE PERMANENT. Folding the overdue package into
# `not_projectable` meant that on any project which had ever missed a package
# date the I.28 forward figure never answered again. It answers.
test "$(jqp "$R" "x['forwardConstraintFreeWork']['answered']")" = "True"
psqlc "update work_packages set required_by = '$D60' where id=$E3;" >/dev/null

# ONE KEY, ONE RUN, TWO ROWS. D7.08 and D7.20 are the same calculation and the
# lineage ledger holds one row for both, carrying both faces.
R=$(rpc "$PLANNER" compute_constraint_free_work_index "{\"p_case_id\":\"$CASE\",\"p_horizon_days\":90}")
expect_answered "$R"
RUN3=$(printf '%s' "$R" | field calculationRunId); test -n "$RUN3"
test "$(psqlc "select calculation_key from calculation_runs where id='$RUN3'")" = "constraint_free_work_index"
test "$(psqlc "select outputs ? 'constraintFreeWorkIndex' from calculation_runs where id='$RUN3'")" = "t"
test "$(psqlc "select outputs ? 'forwardConstraintFreeWork' from calculation_runs where id='$RUN3'")" = "t"
# There is exactly ONE calculation key in this repository for the two rows.
test "$(psqlc "select count(distinct calculation_key) from calculation_runs
                where organization_id='$ORG' and development_case_id='$CASE'
                  and calculation_key like '%constraint_free%'")" = "1"

echo "── 7. D7.13 + D7.14 — the empty denominator, and which empty it is ──────"

# A window with no planned work in it. NOT 0%, NOT 100%.
R=$(rpc "$PLANNER" get_workface_execution_metrics "{\"p_case_id\":\"$CASE\",\"p_window_start\":\"$TODAY\",\"p_window_end\":\"$D10\"}")
expect_refusal "$R" "the workface denominator is empty"
expect_refusal "$R" "NOT 0%"

R=$(rpc "$PLANNER" get_workface_execution_metrics "{\"p_case_id\":\"$CASE\",\"p_window_start\":\"$D30\",\"p_window_end\":\"$TODAY\"}")
expect_refusal "$R" "ends on or before it starts"

# The real window. E1's two jobs, E2's one job and E3's one job are all in it.
R=$(rpc "$PLANNER" get_workface_execution_metrics "{\"p_case_id\":\"$CASE\",\"p_window_start\":\"$TODAY\",\"p_window_end\":\"$D60\"}")
expect_answered "$R"
test "$(jqp "$R" "x['plannedWorkOrders']")" = "4"
test "$(jqp "$R" "x['assessableWorkOrders']")" = "4"
# Every job is BLOCKED on at least one element — no material is ordered, no
# isolation is confirmed — so planned-work-ready is a real, reportable 0%.
test "$(jqp "$R" "x['readyWorkOrders']")" = "0"
PWR=$(sub "$R" plannedWorkReady)
test "$(jqp "$PWR" "x['answered']")" = "True"
test "$(jqp "$PWR" "x['pct']")" = "0.0"
# AND READY-WORK-EXECUTED REFUSES, because ITS denominator is the ready set —
# and the refusal says WHICH kind of empty this is.
RWE=$(sub "$R" readyWorkExecuted)
test "$(jqp "$RWE" "x['answered']")" = "False"
test "$(jqp "$RWE" "x['kind']")" = "empty_denominator"
expect_text "$(jqp "$RWE" "x['refusal']")" "were assessed and NONE of them is field-ready"
expect_text "$(jqp "$RWE" "x['refusal']")" "different fact"
# The three unverifiable elements are named beside the number rather than
# letting a reader assume ten were checked.
test "$(jqp "$R" "x['unverifiableElementPositions']")" = "13"
# THREE of the ten elements have no canonical store for ANY job in this
# product (D7.12), so no assessed work order can ever report fewer.
test "$(jqp "$R" "min(w['unverifiableElements'] for w in x['workOrders'])")" = "3"
expect_text "$(jqp "$R" "json.dumps(x['refusals'])")" "ready on the elements a store can answer, not on all ten"

# Make one job field-ready on every ELEMENT. It is still NOT planned-work-
# ready, and that is the repair this step exists to pin: its work package
# still carries an open hard constraint, so the ONE release verdict holds it
# back, and a percentage that called it ready would state a position the
# release door refuses to state about the same package on the same screen.
psqlc "insert into equipment_releases (organization_id, asset_id, work_order_id, status, isolation_confirmed, released_at, released_by)
       values ('$ORG','$ASSET','$W4','released', true, now(), '$PLANNER_ID');" >/dev/null
R=$(rpc "$PLANNER" get_workface_execution_metrics "{\"p_case_id\":\"$CASE\",\"p_window_start\":\"$TODAY\",\"p_window_end\":\"$D60\"}")
expect_answered "$R"
test "$(jqp "$R" "x['readyWorkOrders']")" = "0"
test "$(jqp "$R" "x['packageBlockedWorkOrders']")" = "1"
test "$(jqp "$R" "[w['blockedElements'] for w in x['workOrders'] if w['woNumber']=='S7C-W4'][0]")" = "0"
test "$(jqp "$R" "[w['fieldReady'] for w in x['workOrders'] if w['woNumber']=='S7C-W4'][0]")" = "blocked"
test "$(jqp "$R" "[w['packageVerdict'] for w in x['workOrders'] if w['woNumber']=='S7C-W4'][0]")" = "not_ready"
# THE VERDICT'S OWN SENTENCE, character for character. This door writes none.
VERD3=$(psqlc "select sync_work_package_release_verdict($E3)->>'reason'")
test "$(jqp "$R" "[w['detail'] for w in x['workOrders'] if w['woNumber']=='S7C-W4'][0]")" = "$VERD3"
expect_text "$(jqp "$R" "json.dumps(x['refusals'])")" "the ONE release verdict holds their work package back"

# Clear the package's last open hard constraint and the SAME job becomes
# ready. Nothing about the metric changed — the ONE verdict did.
R=$(rpc "$PLANNER" clear_package_constraint "{\"p_constraint_id\":\"$C3\",\"p_state\":\"satisfied\",\"p_basis\":\"Operations handed the lay-down area over and the access constraint is closed\"}")
noerr "$R"
R=$(rpc "$PLANNER" get_workface_execution_metrics "{\"p_case_id\":\"$CASE\",\"p_window_start\":\"$TODAY\",\"p_window_end\":\"$D60\"}")
expect_answered "$R"
test "$(jqp "$R" "x['readyWorkOrders']")" = "1"
test "$(jqp "$R" "x['packageBlockedWorkOrders']")" = "0"
test "$(jqp "$R" "[w['packageVerdict'] for w in x['workOrders'] if w['woNumber']=='S7C-W4'][0]")" = "ready_for_human"
PWR=$(sub "$R" plannedWorkReady)
test "$(jqp "$PWR" "x['pct']")" = "25.0"
# COVERAGE ships beside the two percentages: all four jobs were assessable.
COV=$(sub "$R" assessmentCoverage)
test "$(jqp "$COV" "x['answered']")" = "True"
test "$(jqp "$COV" "x['pct']")" = "100.0"
RWE=$(sub "$R" readyWorkExecuted)
test "$(jqp "$RWE" "x['answered']")" = "True"
# W4 is the ready one and its work_orders.status is already in_progress —
# execution is read from the work identity (RULING 19), never from a package.
test "$(jqp "$RWE" "x['pct']")" = "100.0"
test "$(jqp "$R" "x['executedReadyWorkOrders']")" = "1"

# A job the ONE predicate REFUSES to answer for is NOT ASSESSABLE — never
# silently ready. Point a work order at a job plan in another tenant's name.
FJP=$(psqlc "with ins as (
  insert into job_plans (organization_id, plan_key, title, scope, status, version, basis)
  values ('$ORG2','S7C-JPX','S7C foreign plan','A job plan owned by the other tenant',
          'adopted', 1, 'Arranged so a work order can name a plan it cannot read') returning id)
  select id from ins")
psqlc "update work_orders set job_plan_id='$FJP' where id='$W3';" >/dev/null
R=$(rpc "$PLANNER" get_workface_execution_metrics "{\"p_case_id\":\"$CASE\",\"p_window_start\":\"$TODAY\",\"p_window_end\":\"$D60\"}")
expect_answered "$R"
test "$(jqp "$R" "x['notAssessableWorkOrders']")" = "1"
test "$(jqp "$R" "x['assessableWorkOrders']")" = "3"
expect_text "$(jqp "$R" "[w['detail'] for w in x['workOrders'] if w['woNumber']=='S7C-W3'][0]")" "cannot be read in its own organization"
psqlc "update work_orders set job_plan_id='$JP' where id='$W3';" >/dev/null
psqlc "delete from job_plans where id='$FJP';" >/dev/null

R=$(rpc "$PLANNER" compute_workface_execution_metrics "{\"p_case_id\":\"$CASE\",\"p_window_start\":\"$TODAY\",\"p_window_end\":\"$D60\"}")
expect_answered "$R"
RUN4=$(printf '%s' "$R" | field calculationRunId); test -n "$RUN4"
test "$(psqlc "select calculation_key from calculation_runs where id='$RUN4'")" = "workface_execution_metrics"
test "$(psqlc "select outputs ? 'plannedWorkReady' from calculation_runs where id='$RUN4'")" = "t"
test "$(psqlc "select outputs ? 'readyWorkExecuted' from calculation_runs where id='$RUN4'")" = "t"

echo "── 8. D7.16 — composed, with the parts still open named ─────────────────"

R=$(rpc "$PLANNER" get_sync_field_module "{\"p_case_id\":\"$CASE\",\"p_horizon_days\":90}")
expect_answered "$R"
test "$(jqp "$R" "len(x['composition'])")" = "6"
test "$(jqp "$R" "len(x['openParts'])")" = "2"
test "$(jqp "$R" "','.join(sorted(p['row'] for p in x['openParts']))")" = "D7.06,D7.12"
# COMPOSED, NEVER RECOMPUTED: the index inside the module is character for
# character the index the owning function returns.
DIRECT=$(rpc "$PLANNER" get_constraint_free_work_index "{\"p_case_id\":\"$CASE\",\"p_horizon_days\":90}")
test "$(jqp "$R" "json.dumps(x['constraintFreeWork']['constraintFreeWorkIndex'], sort_keys=True)")" = "$(jqp "$DIRECT" "json.dumps(x['constraintFreeWorkIndex'], sort_keys=True)")"
test "$(jqp "$R" "x['executionReadiness']['answered']")" = "True"

echo "── 9. the repairs this chunk's review produced ──────────────────────────"

# ── (a) OVERLAPPING DEMAND ON ONE POOL ACCUMULATES, and the project view and
#        the portfolio view now agree about the identical rows. The first
#        shape put the clipped window in the GROUP BY key, so two overlapping
#        lines never summed and each was compared against the FULL capacity of
#        its own window — the same crew-hours credited twice.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S7C overlap case\",\"p_problem_statement\":\"Two overlapping demand lines on one pool, used to prove the per-project balance and the portfolio roll-up cannot disagree about the same hours.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE3=$(printf '%s' "$R" | field case_id); test -n "$CASE3"
D56=$(psqlc "select (current_date + 56)::text")
D28=$(psqlc "select (current_date + 28)::text")
D84=$(psqlc "select (current_date + 84)::text")
R=$(rpc "$PLANNER" record_resource_demand "{\"p_case_id\":\"$CASE3\",\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-mech\",\"demandHours\":900,\"periodStart\":\"$TODAY\",\"periodEnd\":\"$D56\",\"sourceKind\":\"estimate\",\"basis\":\"Nine hundred fitter hours across the first eight weeks of the mechanical scope\"}}")
expect_answered "$R"
R=$(rpc "$PLANNER" record_resource_demand "{\"p_case_id\":\"$CASE3\",\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-mech\",\"demandHours\":900,\"periodStart\":\"$D28\",\"periodEnd\":\"$D84\",\"sourceKind\":\"estimate\",\"basis\":\"Nine hundred more fitter hours from week five to week twelve, overlapping the first line\"}}")
expect_answered "$R"
R=$(rpc "$PLANNER" get_case_resource_balance "{\"p_case_id\":\"$CASE3\",\"p_horizon_weeks\":12}")
expect_answered "$R"
# Three DISJOINT segments, and the overlapping one is over-committed rather
# than two comfortable cells and an empty refusal list.
test "$(jqp "$R" "len(x['cells'])")" = "3"
test "$(jqp "$R" "x['overCommitted']")" = "1"
test "$(jqp "$R" "round(sum(c['demandHours'] for c in x['cells']))")" = "1800"

# ── (b) THE ONE CAPACITY FIGURE IN FORCE. A closed crew and another
#        category's pool of the same name do not become available labour.
R=$(rpc "$PLANNER" record_resource_capacity "{\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-sup\",\"weeklyHours\":40,\"basis\":\"The welding crew as it stood when the project was first estimated\",\"siteId\":\"$SITE\"}}")
expect_answered "$R"; CAPSUP=$(printf '%s' "$R" | field capacityId); test -n "$CAPSUP"
# The collision refusal names an act that EXISTS.
R=$(rpc "$PLANNER" record_resource_capacity "{\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-sup\",\"weeklyHours\":60,\"basis\":\"The welding crew after the two additional hands joined it this quarter\",\"siteId\":\"$SITE\"}}")
expect_refusal "$R" "close_resource_capacity"
D1=$(psqlc "select (current_date + 1)::text")
R=$(rpc "$PLANNER" close_resource_capacity "{\"p_payload\":{\"capacityId\":\"$CAPSUP\",\"effectiveTo\":\"$D1\"}}")
expect_answered "$R"
R=$(rpc "$PLANNER" close_resource_capacity "{\"p_payload\":{\"capacityId\":\"$CAPSUP\",\"effectiveTo\":\"$D30\"}}")
expect_refusal "$R" "already closed"
R=$(rpc "$PLANNER" record_resource_capacity "{\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-sup\",\"weeklyHours\":60,\"effectiveFrom\":\"$D1\",\"basis\":\"The welding crew after the two additional hands joined it this quarter\",\"siteId\":\"$SITE\"}}")
expect_answered "$R"
# SUPERSEDED, not summed: the predicate says 60 while the table holds 100.
test "$(psqlc "select sum(weekly_hours)::int from craft_capacity where organization_id='$ORG' and craft='S7C-sup'")" = "100"
test "$(psqlc "select (sync_resource_capacity_hours('$ORG','skilled_trades','S7C-sup',current_date+1,current_date+8)->>'weeklyHours')::int")" = "60"

# ── (c) A CROSS-TENANT SITE ID IS REFUSED on both capacity write paths. The
#        FK cascades on delete with no organization correlation, so a foreign
#        site id let another tenant's cleanup silently delete these rows.
FSITE=$(psqlc "with ins as (insert into sites (organization_id, name) values ('$ORG2','S7C foreign site') returning id) select id from ins")
test -n "$FSITE"
R=$(rpc "$PLANNER" record_resource_capacity "{\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-x\",\"weeklyHours\":40,\"siteId\":\"$FSITE\",\"basis\":\"A capacity figure aimed at another tenant's site id, pasted from a stale export\"}}")
expect_refusal "$R" "does not belong to this organization"
R=$(rpc "$PLANNER" record_capacity_deduction "{\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-x\",\"deductionKind\":\"leave\",\"weeklyHours\":5,\"siteId\":\"$FSITE\",\"basis\":\"A deduction aimed at another tenant's site id, pasted from a stale export\"}}")
expect_refusal "$R" "does not belong to this organization"
# A SENTENCE, not a raw constraint violation leaking the failing row.
R=$(rpc "$PLANNER" record_capacity_deduction "{\"p_payload\":{\"category\":\"skilled_trades\",\"pool\":\"S7C-x\",\"deductionKind\":\"leave\",\"weeklyHours\":5,\"effectiveFrom\":\"$D30\",\"effectiveTo\":\"$TODAY\",\"basis\":\"A deduction whose window ends before it starts, offered to the door\"}}")
expect_refusal "$R" "ends on or before it starts"

# ── (d) THE RELEASE DOOR does not pass over a portfolio nothing assessed, and
#        does not drop an unsized craft out of the check that computes passed.
OPT=$(psqlc "with ins as (
  insert into schedule_options (organization_id, week_start, label, strategy, capacity_hours, items, status)
  values ('$ORG', current_date, 'S7C week', 'balanced', 200, '[]'::jsonb, 'draft') returning id)
  select id from ins")
test -n "$OPT"
psqlc "insert into work_order_tasks (organization_id, work_order_id, craft, estimated_hours, task_sequence, description)
       values ('$ORG','$W1','S7C-unsized',40,1,'Work booked against a craft nobody has sized');" >/dev/null
psqlc "update schedule_options set items = jsonb_build_array(jsonb_build_object('wo_id','$W1')) where id='$OPT';" >/dev/null
R=$(rpc "$PLANNER" evaluate_schedule_feasibility "{\"p_option_id\":\"$OPT\"}")
noerr "$R"
test "$(jqp "$R" "[c['passed'] for c in x['checks'] if c['constraint']=='Labour capacity'][0]")" = "None"
test "$(jqp "$R" "[c['not_assessable_crafts'] for c in x['checks'] if c['constraint']=='Labour capacity'][0]")" = "1"
expect_text "$(jqp "$R" "[c['detail'] for c in x['checks'] if c['constraint']=='Labour capacity'][0]")" "NOT ASSESSABLE"
# And the portfolio check on the same door. Only APPROVED demand is summed, so
# the cranes commitment — against a pool nobody has sized — is committed here
# to make the portfolio genuinely unassessable.
R=$(rpc "$MANAGER" approve_resource_demand "{\"p_demand_id\":$DEMCRANE,\"p_note\":\"Committing the gantry hours for the lift, against a pool with no recorded capacity\"}")
expect_answered "$R"
R=$(rpc "$PLANNER" evaluate_schedule_feasibility "{\"p_option_id\":\"$OPT\"}")
noerr "$R"
test "$(jqp "$R" "[c['not_assessable_pools'] for c in x['checks'] if c['constraint']=='Portfolio resource commitments'][0]")" = "1"
test "$(jqp "$R" "[c['count'] for c in x['checks'] if c['constraint']=='Portfolio resource commitments'][0]")" = "0"
# ZERO CONFLICTS AND ZERO POOLS ASSESSED IS NOT A CLEARANCE.
test "$(jqp "$R" "[c['passed'] for c in x['checks'] if c['constraint']=='Portfolio resource commitments'][0]")" = "None"
expect_text "$(jqp "$R" "[c['detail'] for c in x['checks'] if c['constraint']=='Portfolio resource commitments'][0]")" "NOT ASSESSABLE"
psqlc "delete from work_order_tasks where organization_id='$ORG' and craft='S7C-unsized';" >/dev/null

# ── (e) THE FOUR PERCENTAGES AGREE ABOUT ONE UNASSESSED PACKAGE. Two amber
#        NOT ASSESSED tiles beside two 100% tiles, about the same package, on
#        the same screen, is the defect this step exists to keep out.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S7C agreement case\",\"p_problem_statement\":\"One package with no constraint recorded and one in-progress job inside it, used to prove the workface percentages and the constraint index never state opposite things about the same package.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE4=$(printf '%s' "$R" | field case_id); test -n "$CASE4"
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE4\",\"p_package\":{\"package_code\":\"S7C-A1\",\"title\":\"Unassessed package\",\"package_type\":\"engineering\",\"scope\":\"A package nobody has recorded a single constraint against, holding one in-progress job\",\"required_by\":\"$D10\"}}")
noerr "$R"
A1=$(psqlc "select id from work_packages where organization_id='$ORG' and package_code='S7C-A1'")
WA=$(psqlc "with ins as (
  insert into work_orders (organization_id, asset_id, wo_number, title, status)
  values ('$ORG','$ASSET','S7C-WA','A job inside a package nobody assessed','in_progress') returning id)
  select id from ins")
R=$(rpc "$PLANNER" assign_work_to_package "{\"p_package_id\":$A1,\"p_work_order_id\":\"$WA\",\"p_basis\":\"The one job this package exists to release, used for the agreement assertion\"}")
noerr "$R"
R=$(rpc "$PLANNER" get_sync_field_module "{\"p_case_id\":\"$CASE4\",\"p_horizon_days\":90}")
expect_answered "$R"
test "$(jqp "$R" "x['constraintFreeWork']['constraintFreeWorkIndex']['kind']")" = "not_assessed"
test "$(jqp "$R" "x['constraintFreeWork']['forwardConstraintFreeWork']['kind']")" = "not_assessed"
# NOT 100%. The same fact, in the same words, from the other half of the page.
test "$(jqp "$R" "x['workface']['plannedWorkReady']['kind']")" = "not_assessed"
test "$(jqp "$R" "x['workface']['readyWorkExecuted']['kind']")" = "not_assessed"
test "$(jqp "$R" "x['workface']['plannedWorkReady']['pct']")" = "None"
test "$(jqp "$R" "x['workface']['packageUnassessedWorkOrders']")" = "1"
test "$(jqp "$R" "x['workface']['workOrders'][0]['packageVerdict']")" = "unassessed"
test "$(jqp "$R" "x['workface']['workOrders'][0]['fieldReady']")" = "package_unassessed"
# COVERAGE ships beside the workface percentages, as it always did beside the index.
test "$(jqp "$R" "x['workface']['assessmentCoverage']['answered']")" = "True"
# THE COMPOSED WINDOW is the caller's, and it is stated rather than assumed.
test "$(jqp "$R" "x['horizonDays']")" = "90"
test -n "$(jqp "$R" "x['workfaceWindowEnd']")"

# ── (f) A NULL HORIZON REFUSES THE WHOLE MODULE. GREATEST/LEAST ignore nulls
#        in Postgres, so the first shape refused the index and answered a
#        five-year resource position from the same unusable input.
R=$(rpc "$PLANNER" get_sync_field_module "{\"p_case_id\":\"$CASE4\",\"p_horizon_days\":null}")
expect_refusal "$R" "refuses the whole module rather than half of it"

# ── (g) THE WINDOW IS BOUNDED BELOW. A package needed four hundred days ago
#        is LATE, is listed as such, and defines no denominator.
R=$(rpc "$PLANNER" record_work_package "{\"p_case_id\":\"$CASE4\",\"p_package\":{\"package_code\":\"S7C-A2\",\"title\":\"Overdue package\",\"package_type\":\"engineering\",\"scope\":\"A package that was needed four hundred days ago and has never been released\"}}")
noerr "$R"
A2=$(psqlc "select id from work_packages where organization_id='$ORG' and package_code='S7C-A2'")
psqlc "update work_packages set required_by = current_date - 400 where id=$A2;" >/dev/null
R=$(rpc "$PLANNER" record_package_constraint "{\"p_package_id\":$A2,\"p_constraint\":{\"constraint_type\":\"DRAWING\",\"description\":\"A drawing for the overdue package that was never issued\",\"basis\":\"The design stalled and the package slipped past its date\",\"is_hard\":\"true\",\"owner_role\":\"planner\"}}")
noerr "$R"
# A ONE-DAY horizon must not answer a percentage computed from it.
R=$(rpc "$PLANNER" get_constraint_free_work_index "{\"p_case_id\":\"$CASE4\",\"p_horizon_days\":1}")
expect_refusal "$R" "ALREADY PASSED"
test "$(jqp "$R" "x['overduePackages']")" = "1"
# Over ninety days it is OUTSIDE the window, listed, and in no denominator.
R=$(rpc "$PLANNER" get_constraint_free_work_index "{\"p_case_id\":\"$CASE4\",\"p_horizon_days\":90}")
expect_answered "$R"
test "$(jqp "$R" "x['plannedPackages']")" = "1"
test "$(jqp "$R" "x['overduePackages']")" = "1"
test "$(jqp "$R" "x['overdue'][0]['packageCode']")" = "S7C-A2"
test "$(jqp "$R" "x['overdue'][0]['daysOverdue']")" = "400"
test "$(jqp "$R" "x['overdue'][0]['inWindow']")" = "False"
test "$(jqp "$R" "sum(1 for p in x['packages'] if p['packageCode']=='S7C-A2')")" = "0"

# ── (h) THE ACTS THE REFUSALS PROMISE, on the competency half.
R=$(rpc "$PLANNER" record_member_competency "{\"p_payload\":{\"memberId\":\"$M1\",\"competencyId\":\"$COMP\",\"evidenceReference\":\"S7C-CERT-DUP\",\"expiresOn\":\"$D60\"}}")
expect_refusal "$R" "renew_member_competency"
MC1=$(psqlc "select id from member_competencies where organization_id='$ORG' and member_id=$M1 and competency_id=$COMP")
test -n "$MC1"
R=$(rpc "$PLANNER" renew_member_competency "{\"p_payload\":{\"memberCompetencyId\":\"$MC1\",\"evidenceReference\":\"S7C-CERT-RENEW\",\"expiresOn\":\"$TODAY\"}}")
expect_refusal "$R" "shortening one is a correction"
D1000=$(psqlc "select (current_date + 1000)::text")
R=$(rpc "$PLANNER" renew_member_competency "{\"p_payload\":{\"memberCompetencyId\":\"$MC1\",\"evidenceReference\":\"S7C-CERT-RENEW\",\"expiresOn\":\"$D1000\"}}")
expect_answered "$R"
# SUPERSEDED IN PLACE. One member holds one competency once.
test "$(psqlc "select count(*) from member_competencies where organization_id='$ORG' and member_id=$M1 and competency_id=$COMP")" = "1"
test "$(psqlc "select expires_on::text from member_competencies where id=$MC1")" = "$D1000"
# The AI identity cannot renew: it is a declaration of competency.
R=$(rpc "$AIBOT" renew_member_competency "{\"p_payload\":{\"memberCompetencyId\":\"$MC1\",\"evidenceReference\":\"S7C-CERT-AI\",\"expiresOn\":\"$D1000\"}}")
expect_refusal "$R" "requires a planning, supervisory or governance role"

# The leaver act. `active` gates every readiness count above.
R=$(rpc "$PLANNER" set_workforce_member_active "{\"p_payload\":{\"memberId\":\"$M1\",\"active\":false}}")
expect_refusal "$R" "reason of at least 10 characters"
R=$(rpc "$PLANNER" set_workforce_member_active "{\"p_payload\":{\"memberId\":\"$M1\",\"active\":false,\"reason\":\"Left the site at the end of the shutdown\"}}")
expect_answered "$R"
R=$(rpc "$PLANNER" set_workforce_member_active "{\"p_payload\":{\"memberId\":\"$M1\",\"active\":false,\"reason\":\"Left the site at the end of the shutdown\"}}")
expect_refusal "$R" "already inactive"
# THE HOLDING IS RETAINED. A record of what somebody held is not deleted.
test "$(psqlc "select count(*) from member_competencies where organization_id='$ORG' and member_id=$M1")" = "1"
R=$(rpc "$PLANNER" set_workforce_member_active "{\"p_payload\":{\"memberId\":\"$M1\",\"active\":true,\"reason\":\"Returned for the following campaign\"}}")
expect_answered "$R"

# ── (i) §70's THIRD ACT, at the DATABASE. `shift_assignments` had no actor
#        column at all, so "no AI identity may approve a roster" rested on one
#        RPC's role list.
AIUID=$(psqlc "select id from user_profiles where organization_id='$ORG' and role='ai_admin' limit 1")
test -n "$AIUID"
OUT=$(sql_must_fail "insert into shift_assignments (organization_id, member_id, starts_at, ends_at, shift_kind, assigned_by)
  values ('$ORG',$M1, now(), now() + interval '8 hours', 'day', '$AIUID');")
expect_text "$OUT" "cannot approve a roster"
# NOT OVER-BROAD: the seed shape, naming no actor, still writes. The 2026-08-17
# demo seed uses exactly this column list, so the wall's NULL-actor early
# return admits it unchanged.
SEEDSHIFT=$(psqlc "with ins as (
  insert into shift_assignments (organization_id, member_id, starts_at, ends_at, shift_kind)
  values ('$ORG',$M1, now() + interval '30 days', now() + interval '30 days 8 hours','day')
  returning id) select id from ins")
test -n "$SEEDSHIFT"
test "$(psqlc "select assigned_by is null from shift_assignments where id=$SEEDSHIFT")" = "t"
# And the UPDATE dodge onto that null actor is refused too — a wall covering
# only INSERT is a wall with a door beside it.
OUT=$(sql_must_fail "update shift_assignments set assigned_by='$AIUID' where id=$SEEDSHIFT;")
expect_text "$OUT" "cannot approve a roster"
# The RPC path stamps a real person, so the column is not decorative.
test "$(psqlc "select count(*) from shift_assignments sa join workforce_members wm on wm.id = sa.member_id
                where wm.organization_id='$ORG' and wm.employee_ref like 'S7C-%' and sa.assigned_by is not null")" != "0"

# ── (j) A TIGHTENING MUST NOT BREAK THE WRITER THAT ALREADY EXISTED.
#        `'NaN'::numeric <= 0` is FALSE, so the pre-existing connector
#        validator admitted NaN and the new CHECK aborted the whole batch.
psqlc "update sites set source_system='S7CCONN', external_id='S7C-SITE' where id='$SITE';" >/dev/null
CONN=$(psqlc "with ins as (
  insert into connectors (organization_id, connector_key, connector_type, name, direction, enabled, write_enabled)
  values ('$ORG','S7CCONN','recovery_activation','S7C probe connector','read_only',true,false) returning id)
  select id from ins")
test -n "$CONN"
psqlc "insert into connector_entity_mappings (organization_id, connector_id, entity_type, status, basis, approved_by, approved_at)
       values ('$ORG','$CONN','craft_capacity','approved','Approved so the transcript can exercise the connector import path', (select id from user_profiles where organization_id='$ORG' and role='planner' limit 1), now());" >/dev/null
# THROUGH THE REAL CLIENT PATH, which is where the 400 was observed.
R=$(rpc "$PLANNER" begin_recovery_activation_run "{\"p_connector_key\":\"S7CCONN\",\"p_entity_type\":\"craft_capacity\",\"p_run_type\":\"manual\"}")
noerr "$R"; RUN=$(printf '%s' "$R" | field run_id); test -n "$RUN"
# A NEGATIVE row is the control: rejected per row, the good row lands.
R=$(rpc "$PLANNER" ingest_recovery_activation_batch "{\"p_run_id\":\"$RUN\",\"p_rows\":[{\"external_id\":\"S7C-CC-OK\",\"site_external_id\":\"S7C-SITE\",\"craft\":\"S7C-cgood\",\"weekly_hours\":\"80\",\"basis\":\"A perfectly good capacity row from the probe connector\",\"effective_from\":\"$TODAY\"},{\"external_id\":\"S7C-CC-NEG\",\"site_external_id\":\"S7C-SITE\",\"craft\":\"S7C-cneg\",\"weekly_hours\":\"-5\",\"basis\":\"A negative capacity row from the probe connector\",\"effective_from\":\"$TODAY\"}]}")
noerr "$R"
test "$(jqp "$R" "x['accepted']")" = "1"
test "$(jqp "$R" "x['rejected']")" = "1"
# NaN BEHAVES IDENTICALLY. It used to abort the whole batch with a raw 23514
# that also leaked the failing row — organization_id and site_id included —
# to the client through PostgREST's `details`.
R=$(rpc "$PLANNER" begin_recovery_activation_run "{\"p_connector_key\":\"S7CCONN\",\"p_entity_type\":\"craft_capacity\",\"p_run_type\":\"manual\"}")
noerr "$R"; RUN=$(printf '%s' "$R" | field run_id); test -n "$RUN"
R=$(rpc "$PLANNER" ingest_recovery_activation_batch "{\"p_run_id\":\"$RUN\",\"p_rows\":[{\"external_id\":\"S7C-CC-OK2\",\"site_external_id\":\"S7C-SITE\",\"craft\":\"S7C-cgood2\",\"weekly_hours\":\"80\",\"basis\":\"A perfectly good capacity row from the probe connector\",\"effective_from\":\"$TODAY\"},{\"external_id\":\"S7C-CC-NAN\",\"site_external_id\":\"S7C-SITE\",\"craft\":\"S7C-cnan\",\"weekly_hours\":\"NaN\",\"basis\":\"A NaN capacity row from the probe connector\",\"effective_from\":\"$TODAY\"}]}")
noerr "$R"
test "$(jqp "$R" "x['accepted']")" = "1"
test "$(jqp "$R" "x['rejected']")" = "1"
test "$(psqlc "select count(*) from craft_capacity where organization_id='$ORG' and craft='S7C-cgood2'")" = "1"
test "$(psqlc "select count(*) from craft_capacity where organization_id='$ORG' and craft='S7C-cnan'")" = "0"

# ── (k) THE TWO INTERNAL PREDICATES ARE REVOKED FROM CLIENTS, service_role
#        included — the 7B posture their own comments claim.
test "$(psqlc "select has_function_privilege('service_role','public.sync_resource_capacity_hours(uuid,text,text,date,date)','execute')")" = "f"
test "$(psqlc "select has_function_privilege('service_role','public.sync_portfolio_resource_conflicts(uuid,date,date)','execute')")" = "f"

echo "── 10. cross-tenant ────────────────────────────────────────────────────"

R=$(rpc "$FOREIGN" get_case_resource_balance "{\"p_case_id\":\"$CASE\",\"p_horizon_weeks\":12}")
expect_refusal "$R" "development case not found"
R=$(rpc "$FOREIGN" get_constraint_free_work_index "{\"p_case_id\":\"$CASE\",\"p_horizon_days\":90}")
expect_refusal "$R" "development case not found"
R=$(rpc "$FOREIGN" get_workface_execution_metrics "{\"p_case_id\":\"$CASE\"}")
expect_refusal "$R" "development case not found"
R=$(rpc "$FOREIGN" get_competency_readiness "{\"p_package_id\":$E1}")
expect_refusal "$R" "work package not found"
R=$(rpc "$FOREIGN" get_sync_field_module "{\"p_case_id\":\"$CASE\"}")
expect_refusal "$R" "development case not found"
R=$(rpc "$FOREIGN" get_competency_requirements '{}')
expect_answered "$R"
test "$(jqp "$R" "len(x['requirements'])")" = "0"
test "$(jqp "$R" "len(x['members'])")" = "0"
R=$(rpc "$FOREIGN" get_portfolio_resource_conflicts "{\"p_horizon_weeks\":12}")
expect_refusal "$R" "UNASSESSED, not conflict-free"

echo
echo "Develop slice-7c smoke PASSED — resources time-phased and comparable, a"
echo "collective conflict detectable rather than discovered on site, competency"
echo "answered in the future tense, and four percentages that refuse rather"
echo "than divide over an empty denominator."

#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 4A — the Integrated Controls substrate. Every step is a
# live transcript against a real local database.
#
# Steps:
#   1  the scope architecture chain (D5.01): need → requirement → system →
#      WBS → … → control account, authored from real callers; an
#      unresolvable parent, a foreign owner, a duplicate code and a nested
#      control account are each refused BY NAME, at the RPC door and again
#      at the persistence wall.
#   2  traceability gap detection (D5.02): the ONE predicate reports every
#      break in both directions — needs with no requirement, requirements
#      not in the WBS, WBS branches with no control account, and the four
#      orphan classes including the spec's own "schedule activities have no
#      authorized scope"; the two deferred links are NAMED, not omitted; a
#      percentage over an empty set is null, never 100.
#   3  ScheduleActivity with P6 as system of record (D5.28): activities
#      import through the ONE governed door, an imported row's P6-owned
#      fields are refused to a client and admitted-AND-AUDITED for service,
#      origin never flips for any writer, the WBS annotation IS allowed, and
#      a locally authored activity stays distinguishable forever.
#   4  CostItem (D5.29): a line whose WBS code does not resolve REFUSES; a
#      non-finite figure refuses at the RPC and at the table; contingency
#      without a basis refuses; the line reconciles to the Slice 2 business
#      case, and the reconciliation REFUSES when either side is missing.
#   5  post-baseline scope cost attribution (D5.03): no approved SCOPE
#      baseline → no figure; scope predating the baseline is refused as
#      baseline scope; an un-costed addition is counted, never priced at
#      zero; unapproved growth is reported separately; §70 refuses the
#      AI-operator identity an approved-change assertion.
#   6  the eleven controls structures (D5.04): all eleven always reported,
#      two refusing BY NAME; capture is refused to the AI identity and to a
#      draft baseline; a capture is immutable; drift is detected per
#      structure after the underlying rows move.
#   7  calculation lineage (D11.29): every controls number carries a run
#      recording method, server-side code version, inputs, outputs and the
#      refusals it hit; a run is immutable to clients; TRUNCATE is refused
#      on both new ledgers.
#
# Run: supabase start && scripts/ci-develop-slice4a-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-4a smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$TECH"

MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
test -n "$MANAGER_ID"; test -n "$PLANNER_ID"

# The AI-operator identity, seeded exactly as the 3B/3C/3D transcripts seed
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

# Idempotent re-run: clear this smoke's own artifacts. The scope-change and
# capture ledgers refuse client deletes by design, so the service path is
# used and the trigger audits it — which is the posture, not a workaround.
psqlc "delete from calculation_runs where organization_id='$ORG'
        and development_case_id in (select id from development_cases where organization_id='$ORG' and title like 'SMOKE4A %');" >/dev/null
psqlc "delete from controls_baseline_structures where organization_id='$ORG'
        and development_case_id in (select id from development_cases where organization_id='$ORG' and title like 'SMOKE4A %');" >/dev/null
psqlc "delete from project_scope_changes where organization_id='$ORG'
        and development_case_id in (select id from development_cases where organization_id='$ORG' and title like 'SMOKE4A %');" >/dev/null
psqlc "delete from shutdown_events where organization_id='$ORG'
        and development_case_id in (select id from development_cases where organization_id='$ORG' and title like 'SMOKE4A %');" >/dev/null
psqlc "delete from development_cases where organization_id='$ORG' and title like 'SMOKE4A %';" >/dev/null
psqlc "delete from design_requirements where organization_id='$ORG' and requirement_ref like 'SMOKE4A%';" >/dev/null
# business_cases.development_case_id does not cascade (the finance family
# predates the case), so the Slice 2 anchor this smoke creates is cleared by
# its own reference.
psqlc "delete from business_cases where organization_id='$ORG' and case_ref like 'SMOKE4A%';" >/dev/null
psqlc "delete from connectors where organization_id='$ORG' and name='SMOKE4A P6 export';" >/dev/null

echo "── 1. the scope architecture chain (D5.01) ──────────────────────────────"

BODY=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE4A controls case","p_problem_statement":"Primary crusher liner wear is driving unplanned downtime and the current replacement interval has no defensible basis.","p_lifecycle_type":"reliability_improvement"}')
noerr "$BODY"; CASE=$(printf '%s' "$BODY" | field case_id); test -n "$CASE"

# A business need with no owner is refused: a need nobody owns is a wish.
BODY=$(rpc "$PLANNER" record_scope_need "{\"p_case_id\":\"$CASE\",\"p_need\":{\"need_ref\":\"SMOKE4A-N1\",\"statement\":\"Restore crusher availability to 94 percent\"}}")
expect_err "$BODY" 'name the owner of this need'

BODY=$(rpc "$PLANNER" record_scope_need "{\"p_case_id\":\"$CASE\",\"p_need\":{\"need_ref\":\"SMOKE4A-N1\",\"statement\":\"Restore primary crusher availability to 94 percent\",\"owner_id\":\"$MANAGER_ID\"}}")
noerr "$BODY"; NEED=$(printf '%s' "$BODY" | field need_id); test -n "$NEED"

# §70 tier cap: the AI-operator identity may prepare a need, at its own tier.
BODY=$(rpc "$AIBOT" record_scope_need "{\"p_case_id\":\"$CASE\",\"p_need\":{\"need_ref\":\"SMOKE4A-N9\",\"statement\":\"An AI-suggested need at a corporate tier\",\"owner_id\":\"$MANAGER_ID\",\"source_authority\":\"CORPORATE_STANDARD\"}}")
expect_err "$BODY" 'AI_SUGGESTION tier'
BODY=$(rpc "$AIBOT" record_scope_need "{\"p_case_id\":\"$CASE\",\"p_need\":{\"need_ref\":\"SMOKE4A-N9\",\"statement\":\"An AI-suggested need, correctly tiered\",\"owner_id\":\"$MANAGER_ID\",\"source_authority\":\"AI_SUGGESTION\"}}")
noerr "$BODY"

# A technician cannot author scope structure.
BODY=$(rpc "$TECH" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"9\",\"title\":\"Nope\",\"scope_description\":\"A technician should not author scope\"}}")
expect_err "$BODY" 'requires a planning, engineering or governance role'

# A WBS element with no scope statement is a label, and refused as one.
BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1\",\"title\":\"Crusher upgrade\",\"scope_description\":\"short\"}}")
expect_err "$BODY" 'a label'

BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1\",\"title\":\"Crusher upgrade\",\"scope_description\":\"All scope for the primary crusher liner upgrade\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1.1\",\"parent_wbs_code\":\"1\",\"title\":\"Liner replacement\",\"scope_description\":\"Supply and install the new liner set\"}}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field depth)" = "2"
BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1.2\",\"parent_wbs_code\":\"1\",\"title\":\"Lube system\",\"scope_description\":\"Recommission the lubrication system after the rebuild\"}}")
noerr "$BODY"

# An unresolvable parent is named, not silently rooted.
BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"9.9\",\"parent_wbs_code\":\"NOPE\",\"title\":\"Orphan\",\"scope_description\":\"Should be refused by name, not rooted\"}}")
expect_err "$BODY" 'parent WBS code "NOPE" does not exist'

# A cyclic or cross-case WBS is corrupt data no writer may create — the wall
# holds with RLS bypassed and the service role in play.
W1=$(psqlc "select id from project_wbs_elements where development_case_id='$CASE' and wbs_code='1'")
W11=$(psqlc "select id from project_wbs_elements where development_case_id='$CASE' and wbs_code='1.1'")
OUT=$(sql_must_fail "update project_wbs_elements set parent_id='$W11' where id='$W1';")
grep -qi 'a WBS is a tree' <<<"$OUT"

BODY=$(rpc "$PLANNER" record_cbs_code "{\"p_case_id\":\"$CASE\",\"p_code\":{\"cbs_code\":\"SMOKE4A-C100\",\"title\":\"Mechanical works\",\"cost_type\":\"subcontract\"}}")
noerr "$BODY"

BODY=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"SMOKE4A-R1\",\"category\":\"reliability\",\"requirement\":\"Liner life must exceed 2400 operating hours\"}}")
noerr "$BODY"; REQ=$(printf '%s' "$BODY" | field requirement_id)
BODY=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"SMOKE4A-R2\",\"category\":\"maintainability\",\"requirement\":\"Liner change must be achievable within a 36 hour window\"}}")
noerr "$BODY"; REQ2=$(printf '%s' "$BODY" | field requirement_id)

BODY=$(rpc "$PLANNER" link_requirement_to_need "{\"p_requirement_id\":$REQ,\"p_need_id\":\"$NEED\"}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" link_requirement_to_wbs "{\"p_requirement_id\":$REQ,\"p_wbs_element_id\":\"$W11\"}")
noerr "$BODY"

# A control account: WBS x OBS x CBS, with a named accountable person.
BODY=$(rpc "$PLANNER" designate_control_account "{\"p_case_id\":\"$CASE\",\"p_account\":{\"control_account_ref\":\"SMOKE4A-CA1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4A-C100\"}}")
expect_err "$BODY" 'name the accountable owner'
BODY=$(rpc "$PLANNER" designate_control_account "{\"p_case_id\":\"$CASE\",\"p_account\":{\"control_account_ref\":\"SMOKE4A-CA1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4A-C100\",\"accountable_owner_id\":\"$MANAGER_ID\"}}")
noerr "$BODY"

# Control accounts do not nest — refused at the door AND at the wall.
BODY=$(rpc "$PLANNER" designate_control_account "{\"p_case_id\":\"$CASE\",\"p_account\":{\"control_account_ref\":\"SMOKE4A-CA2\",\"wbs_code\":\"1\",\"cbs_code\":\"SMOKE4A-C100\",\"accountable_owner_id\":\"$MANAGER_ID\"}}")
expect_err "$BODY" 'control accounts do not nest'
OUT=$(sql_must_fail "insert into project_control_accounts (organization_id, development_case_id, control_account_ref, wbs_element_id, accountable_owner_id, cbs_code_id)
  select '$ORG','$CASE','SMOKE4A-CA-RAW','$W1','$MANAGER_ID', id from project_cbs_codes where development_case_id='$CASE' limit 1;")
grep -qi 'control accounts do not nest' <<<"$OUT"

echo "   scope chain authored: need → requirement → WBS → control account"

echo "── 2. traceability gap detection (D5.02) ────────────────────────────────"

BODY=$(rpc "$PLANNER" get_case_scope_traceability "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
# The AI-suggested need has no requirement; R2 has no WBS; 1.2 has no
# requirement and (with CA1 on 1.1) no control account on its branch.
test "$(jqp "$BODY" "len(x['forwardGaps']['needsWithoutRequirement'])")" = "1"
test "$(jqp "$BODY" "len(x['forwardGaps']['requirementsWithoutWbs'])")" = "1"
test "$(jqp "$BODY" "[r['requirementRef'] for r in x['orphans']['requirementsWithoutNeed']]")" = "['SMOKE4A-R2']"
test "$(jqp "$BODY" "'1.2' in [w['wbsCode'] for w in x['forwardGaps']['wbsElementsWithoutControlAccount']]")" = "True"
# The element carrying the control account is NOT reported as a gap, and nor
# is its parent — a branch with an account anywhere on it is covered.
test "$(jqp "$BODY" "'1.1' in [w['wbsCode'] for w in x['forwardGaps']['wbsElementsWithoutControlAccount']]")" = "False"
test "$(jqp "$BODY" "'1' in [w['wbsCode'] for w in x['forwardGaps']['wbsElementsWithoutControlAccount']]")" = "False"
# The two deferred links are NAMED in the chain, not omitted from it.
test "$(jqp "$BODY" "sorted(l['link'] for l in x['chain'] if not l['built'])")" = "['contract', 'work package']"
test "$(jqp "$BODY" "all('deferral' in l for l in x['chain'] if not l['built'])")" = "True"
# No activities yet: the percentage is null, NOT 100.
test "$(jqp "$BODY" "x['activitiesWithScopePct'] is None")" = "True"
echo "   gaps detected in both directions; deferred links named; 0/0 is null"

echo "── 3. ScheduleActivity, P6 still the system of record (D5.28) ───────────"

# The ONE governed import door: begin_manual_import → ingest_rows.
BODY=$(rpc "$PLANNER" begin_manual_import '{"p_entity_type":"schedule_activity","p_source_name":"SMOKE4A P6 export"}')
noerr "$BODY"; RUN=$(printf '%s' "$BODY" | field run_id); test -n "$RUN"
ROWS="[{\"activity_id\":\"SMOKE4A-A1000\",\"external_id\":\"SMOKE4A-A1000\",\"case_title\":\"SMOKE4A controls case\",\"description\":\"Order long-lead liner set\",\"original_duration_hours\":\"240\",\"planned_start\":\"2027-01-04T06:00:00Z\",\"planned_finish\":\"2027-01-14T06:00:00Z\",\"wbs_path\":\"CRUSH.1.1\",\"calendar\":\"7x24\"},
{\"activity_id\":\"SMOKE4A-A1010\",\"external_id\":\"SMOKE4A-A1010\",\"case_title\":\"SMOKE4A controls case\",\"description\":\"Install liner set\",\"original_duration_hours\":\"NaN\",\"planned_start\":\"2027-02-01T06:00:00Z\",\"planned_finish\":\"2027-02-03T06:00:00Z\"}]"
BODY=$(rpc "$PLANNER" ingest_rows "{\"p_run_id\":\"$RUN\",\"p_rows\":$ROWS}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field accepted)" = "1"
test "$(printf '%s' "$BODY" | field rejected)" = "1"
# The reject is RETAINED with its reason — the non-finite duration by name.
psqlc "select reject_reason from ingest_staging where run_id='$RUN' and status='rejected'" | grep -ci 'finite number of hours' >/dev/null
rpc "$PLANNER" finish_connector_run "{\"p_run_id\":\"$RUN\"}" >/dev/null

ACT=$(psqlc "select t.id from shutdown_tasks t join shutdown_events e on e.id=t.event_id
             where e.development_case_id='$CASE' and t.task_key='SMOKE4A-A1000'")
test -n "$ACT"
test "$(psqlc "select origin from shutdown_tasks where id=$ACT")" = "imported"

# Sync ANNOTATES an imported activity — its WBS element is Sync's column.
BODY=$(rpc "$PLANNER" set_schedule_activity_wbs "{\"p_activity_id\":$ACT,\"p_wbs_code\":\"NOPE\"}")
expect_err "$BODY" 'never to a string nobody can resolve'
BODY=$(rpc "$PLANNER" set_schedule_activity_wbs "{\"p_activity_id\":$ACT,\"p_wbs_code\":\"1.1\"}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field origin)" = "imported"

# …and NEVER rewrites what P6 exported. RLS-bypassed simulated client.
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
                     update shutdown_tasks set duration_hours = 1 where id = $ACT; rollback;")
grep -qi 'P6 is its system of record' <<<"$OUT"
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
                     delete from shutdown_tasks where id = $ACT; rollback;")
grep -qi 'P6 is its system of record' <<<"$OUT"

# The service path is admitted AND audited — never silent.
BEFORE=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'P6-owned schedule fields%'")
psqlc "update shutdown_tasks set label = 'service correction' where id = $ACT" >/dev/null
AFTER=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'P6-owned schedule fields%'")
test "$AFTER" -gt "$BEFORE"

# Origin never flips, for ANY writer — no marker, no service branch.
OUT=$(sql_must_fail "update shutdown_tasks set origin='local', source_system=null, external_id=null, authored_by=null where id = $ACT;")
grep -qi "origin is fixed at creation" <<<"$OUT"

# A locally authored activity: distinguishable forever, refusals by name.
BODY=$(rpc "$PLANNER" record_local_schedule_activity "{\"p_case_id\":\"$CASE\",\"p_activity\":{\"activity_id\":\"SMOKE4A-L1\",\"description\":\"Owner scope-freeze workshop\",\"duration_hours\":\"Infinity\"}}")
expect_err "$BODY" 'must be a finite number of hours'
BODY=$(rpc "$PLANNER" record_local_schedule_activity "{\"p_case_id\":\"$CASE\",\"p_activity\":{\"activity_id\":\"SMOKE4A-L1\",\"description\":\"Owner scope-freeze workshop\",\"duration_hours\":\"16\",\"planned_start\":\"2027-01-20T00:00:00Z\",\"planned_finish\":\"2027-01-19T00:00:00Z\"}}")
expect_err "$BODY" 'cannot finish before it begins'
BODY=$(rpc "$PLANNER" record_local_schedule_activity "{\"p_case_id\":\"$CASE\",\"p_activity\":{\"activity_id\":\"SMOKE4A-L1\",\"description\":\"Owner scope-freeze workshop\",\"duration_hours\":\"16\"}}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field origin)" = "local"
test "$(psqlc "select source_system is null and external_id is null and authored_by is not null
               from shutdown_tasks t join shutdown_events e on e.id=t.event_id
               where e.development_case_id='$CASE' and t.task_key='SMOKE4A-L1'")" = "t"

# The uncoded local activity is now what D5.02 reports as unauthorized scope.
BODY=$(rpc "$PLANNER" get_case_scope_traceability "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "[a['activityKey'] for a in x['orphans']['scheduleActivitiesWithoutScope']]")" = "['SMOKE4A-L1']"
echo "   P6 fields walled, annotation allowed, local activity distinguishable"

echo "── 4. CostItem, coded and reconciled (D5.29) ────────────────────────────"

# A line whose WBS code does not resolve REFUSES — no unassigned bucket.
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CI1\",\"wbs_code\":\"NOPE\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"Liner supply\",\"basis\":\"Vendor firm quote dated 2026-08-11\",\"baseline_cost\":\"250000\"}}")
expect_err "$BODY" 'does not resolve on this case'

# A non-finite figure refuses at the RPC…
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"Liner supply\",\"basis\":\"Vendor firm quote dated 2026-08-11\",\"baseline_cost\":\"NaN\"}}")
expect_err "$BODY" 'must be a finite number'

# …and there is no business case yet, so the line has nothing to decompose.
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"Liner supply\",\"basis\":\"Vendor firm quote dated 2026-08-11\",\"baseline_cost\":\"250000\"}}")
expect_err "$BODY" 'cost control lines sit UNDER the economics'

# A reconciliation with neither side present REFUSES — and the refusal is
# RECORDED with lineage, so "we could not compute this" is as defensible as a
# figure would have been.
BODY=$(rpc "$PLANNER" compute_case_cost_reconciliation "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['reconciles'] is None")" = "True"
test "$(jqp "$BODY" "len(x['refusals']) >= 2")" = "True"
test "$(psqlc "select status from calculation_runs where development_case_id='$CASE' and calculation_key='case_cost_reconciliation' order by computed_at limit 1")" = "refused"

BODY=$(rpc "$PLANNER" create_case_business_case "{\"p_case_id\":\"$CASE\",\"p_case_ref\":\"SMOKE4A-BC\",\"p_title\":\"Crusher liner upgrade\",\"p_driver\":\"reliability\",\"p_currency\":\"CAD\",\"p_discount_rate\":0.08,\"p_discount_rate_source\":\"Corporate treasury WACC memo 2026-Q2\"}")
noerr "$BODY"; BCASE=$(printf '%s' "$BODY" | field business_case_id)
BODY=$(rpc "$PLANNER" add_business_case_option "{\"p_business_case_id\":$BCASE,\"p_label\":\"Upgrade the liner set\",\"p_life_periods\":10,\"p_cash_flows\":[{\"period\":0,\"amount\":-250000},{\"period\":1,\"amount\":90000},{\"period\":2,\"amount\":90000}]}")
noerr "$BODY"

BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"Liner supply and install\",\"basis\":\"Vendor firm quote dated 2026-08-11\",\"baseline_cost\":\"250000\",\"commitment\":\"120000\"}}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field control_account)" = "SMOKE4A-CA1"

# Contingency without a stated basis is refused.
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CI2\",\"wbs_code\":\"1.2\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"Lube recommissioning\",\"basis\":\"Internal labour estimate, 2 crews\",\"contingency\":\"5000\"}}")
expect_err "$BODY" 'contingency carries its basis'
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CI2\",\"wbs_code\":\"1.2\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"Lube recommissioning\",\"basis\":\"Internal labour estimate, 2 crews\",\"contingency\":\"5000\",\"contingency_basis\":\"Covers a two-shift overrun at the observed crew rate\"}}")
noerr "$BODY"
# 1.2 carries no control account yet, so this line is an orphan D5.02 reports.
test "$(psqlc "select control_account_id is null from project_cost_items where development_case_id='$CASE' and cost_item_ref='SMOKE4A-CI2'")" = "t"

# COST COLLECTS UP THE BRANCH. A line coded BELOW a control account rolls up
# to it — an exact-match lookup would report every such line as uncoded and
# D5.02 would show a gap that is not there.
BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1.1.1\",\"parent_wbs_code\":\"1.1\",\"title\":\"Liner fasteners\",\"scope_description\":\"Fastener set supplied with the new liners\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CI3\",\"wbs_code\":\"1.1.1\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"Fastener set\",\"basis\":\"Same vendor quote, line 4\"}}")
# The RESPONSE names the roll-up point the trigger actually stored — nearest
# account at or above. An exact-match lookup here reported "none" on a line
# whose stored control account was set, i.e. it contradicted its own write.
noerr "$BODY"; test "$(printf '%s' "$BODY" | field control_account)" = "SMOKE4A-CA1"
test "$(psqlc "select ca.control_account_ref from project_cost_items ci
               join project_control_accounts ca on ca.id = ci.control_account_id
               where ci.development_case_id='$CASE' and ci.cost_item_ref='SMOKE4A-CI3'")" = "SMOKE4A-CA1"

# …and a line recorded BEFORE its control account existed acquires the
# roll-up point when the account is designated, rather than staying an
# orphan until somebody re-types it.
BODY=$(rpc "$PLANNER" designate_control_account "{\"p_case_id\":\"$CASE\",\"p_account\":{\"control_account_ref\":\"SMOKE4A-CA2\",\"wbs_code\":\"1.2\",\"cbs_code\":\"SMOKE4A-C100\",\"accountable_owner_id\":\"$MANAGER_ID\"}}")
noerr "$BODY"
test "$(psqlc "select ca.control_account_ref from project_cost_items ci
               join project_control_accounts ca on ca.id = ci.control_account_id
               where ci.development_case_id='$CASE' and ci.cost_item_ref='SMOKE4A-CI2'")" = "SMOKE4A-CA2"
BODY=$(rpc "$PLANNER" get_case_scope_traceability "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "len(x['orphans']['costItemsOutsideAControlAccount'])")" = "0"

# ONE CURRENCY. A line stated in another currency than the business case it
# decomposes is refused BY NAME — their difference would be an exchange rate
# reported as a project variance.
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CIX\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"A line in the wrong money\",\"basis\":\"Quote in United States dollars\",\"currency\":\"USD\",\"baseline_cost\":\"1000\"}}")
expect_err "$BODY" 'reconcile in one currency'
# ...and the wall holds for a service writer too: no re-denomination by UPDATE.
OUT=$(sql_must_fail "update project_cost_items set currency='USD' where development_case_id='$CASE' and cost_item_ref='SMOKE4A-CI1';")
grep -qi 'reconcile in one currency' <<<"$OUT"
# An omitted currency on a REVISE means UNCHANGED, never a silent default.
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"Liner supply and install\",\"basis\":\"Vendor firm quote dated 2026-08-11\",\"baseline_cost\":\"250000\",\"commitment\":\"120000\",\"actual\":\"1200\"}}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field currency)" = "CAD"
# ...and the audit snapshots carry the unit on BOTH sides, so a figure that
# moved because its currency moved is visible in the trail.
test "$(psqlc "select (previous_state ? 'currency') and (new_state ? 'currency')
               from audit_events where entity_type='project_cost_item'
                and event_data->>'action'='revised' order by created_at desc limit 1")" = "t"

# The table's own finite check binds every writer, service included.
OUT=$(sql_must_fail "update project_cost_items set actual = 'NaN'::numeric where development_case_id='$CASE' and cost_item_ref='SMOKE4A-CI1';")
grep -qi 'cost_item_amounts_finite' <<<"$OUT"
# A line coded to another case's WBS is refused for every writer.
OTHER=$(psqlc "select id from project_wbs_elements where development_case_id <> '$CASE' limit 1")
if [ -n "$OTHER" ]; then
  OUT=$(sql_must_fail "update project_cost_items set wbs_element_id='$OTHER' where development_case_id='$CASE' and cost_item_ref='SMOKE4A-CI1';")
  grep -qi 'belonging to another development case' <<<"$OUT"
fi

# A PARTIAL BASELINE IS NOT AGREEMENT. Two of the three lines carry no
# baseline cost; comparing the sum over the one that does against the WHOLE
# capital figure would price the other two at zero and report "they agree".
BODY=$(rpc "$PLANNER" compute_case_cost_reconciliation "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['baselinedLineCount'] < x['lineCount']")" = "True"
test "$(jqp "$BODY" "x['reconciles'] is None")" = "True"
test "$(jqp "$BODY" "x['variance'] is None")" = "True"
test "$(jqp "$BODY" "any('carry no baseline cost' in r for r in x['refusals'])")" = "True"
test "$(psqlc "select status from calculation_runs where development_case_id='$CASE' and calculation_key='case_cost_reconciliation' order by computed_at desc limit 1")" = "refused"

# Baseline the other two, and the reconciliation has an answer.
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CI1\",\"wbs_code\":\"1.1\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"Liner supply and install\",\"basis\":\"Vendor firm quote dated 2026-08-11\",\"baseline_cost\":\"243000\",\"commitment\":\"120000\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CI2\",\"wbs_code\":\"1.2\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"Lube recommissioning\",\"basis\":\"Internal labour estimate, 2 crews\",\"baseline_cost\":\"5000\",\"contingency\":\"5000\",\"contingency_basis\":\"Covers a two-shift overrun at the observed crew rate\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"SMOKE4A-CI3\",\"wbs_code\":\"1.1.1\",\"cbs_code\":\"SMOKE4A-C100\",\"description\":\"Fastener set\",\"basis\":\"Same vendor quote, line 4\",\"baseline_cost\":\"2000\"}}")
noerr "$BODY"

BODY=$(rpc "$PLANNER" compute_case_cost_reconciliation "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['baselinedLineCount'] == x['lineCount'] == 3")" = "True"
test "$(printf '%s' "$BODY" | field lineBaselineTotal)" = "250000"
test "$(printf '%s' "$BODY" | field businessCaseCapital)" = "250000"
test "$(printf '%s' "$BODY" | field currency)" = "CAD"
# The option it reconciled against is NAMED, so a reader can see which.
test "$(printf '%s' "$BODY" | field optionLabel)" = "Upgrade the liner set"
test "$(jqp "$BODY" "x['reconciles']")" = "True"
test "$(printf '%s' "$BODY" | field codeVersion)" = "develop-controls/4A/2026-11-24"
echo "   cost lines coded, one currency enforced, partial baseline refuses, full set agrees at 250000"

echo "── 5. post-baseline scope cost attribution (D5.03) ──────────────────────"

BODY=$(rpc "$PLANNER" attribute_post_baseline_scope "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"SMOKE4A-SC1\",\"description\":\"Additional guarding required by the inspector\",\"origin\":\"regulatory\",\"wbs_code\":\"1.1\",\"added_at\":\"2027-03-01T00:00:00Z\",\"cost_effect\":\"40000\",\"cost_basis\":\"Fabricator budget quote for the guard package\"}}")
expect_err "$BODY" 'no approved SCOPE baseline'

BODY=$(rpc "$PLANNER" get_case_scope_growth "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['evaluable']")" = "False"
printf '%s' "$BODY" | field refusal | grep -ci 'no reference is fixed' >/dev/null

BODY=$(rpc "$PLANNER" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"SCOPE\",\"p_description\":\"Scope baseline at concept completion\"}")
noerr "$BODY"; BL=$(printf '%s' "$BODY" | field baseline_id)
BODY=$(rpc "$MANAGER" approve_case_baseline "{\"p_baseline_id\":\"$BL\",\"p_note\":\"Approved at the concept gate against the WBS as recorded today\"}")
noerr "$BODY"

# Scope predating the baseline is baseline scope, not growth.
BODY=$(rpc "$PLANNER" attribute_post_baseline_scope "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"SMOKE4A-SC0\",\"description\":\"Something from before the baseline\",\"origin\":\"design_development\",\"wbs_code\":\"1.1\",\"added_at\":\"2020-01-01T00:00:00Z\",\"cost_effect\":\"1000\",\"cost_basis\":\"An old estimating sheet from the archive\"}}")
expect_err "$BODY" 'it is baseline scope, not growth'

# A cost with no basis is refused; an UNPRICED addition is allowed and counted.
BODY=$(rpc "$PLANNER" attribute_post_baseline_scope "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"SMOKE4A-SC1\",\"description\":\"Additional guarding required by the inspector\",\"origin\":\"regulatory\",\"wbs_code\":\"1.1\",\"added_at\":\"2027-03-01T00:00:00Z\",\"cost_effect\":\"40000\"}}")
expect_err "$BODY" 'a stated cost carries its basis'
BODY=$(rpc "$PLANNER" attribute_post_baseline_scope "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"SMOKE4A-SC1\",\"description\":\"Additional guarding required by the inspector\",\"origin\":\"regulatory\",\"wbs_code\":\"1.1\",\"added_at\":\"2027-03-01T00:00:00Z\",\"cost_effect\":\"40000\",\"cost_basis\":\"Fabricator budget quote for the guard package\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" attribute_post_baseline_scope "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"SMOKE4A-SC2\",\"description\":\"Interface tie-in discovered during survey\",\"origin\":\"interface\",\"wbs_code\":\"1.2\",\"added_at\":\"2027-04-01T00:00:00Z\"}}")
noerr "$BODY"

# §70: asserting an approved change request is a governance claim.
BODY=$(rpc "$AIBOT" attribute_post_baseline_scope "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"SMOKE4A-SC3\",\"description\":\"An AI-asserted approved change\",\"origin\":\"owner_request\",\"wbs_code\":\"1.1\",\"added_at\":\"2027-05-01T00:00:00Z\",\"approved_change_ref\":\"MOC-999\"}}")
expect_err "$BODY" 'governance determination'

BODY=$(rpc "$PLANNER" compute_case_scope_growth "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field costTotal)" = "40000"
test "$(printf '%s' "$BODY" | field uncostedCount)" = "1"
test "$(printf '%s' "$BODY" | field unapprovedCount)" = "2"
# The un-costed addition is NOT priced at zero — the caveat says so.
test "$(jqp "$BODY" "any('not yet costed' in c or 'no cost estimate' in c for c in x['caveats'])")" = "True"
# An attribution cannot be erased by a client — growth that is deleted stops
# being growth.
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
                     delete from project_scope_changes where development_case_id='$CASE'; rollback;")
grep -qi 'not deletable' <<<"$OUT"
echo "   growth refuses without a baseline; 40000 attributed, 1 un-costed, 2 unapproved"

echo "── 6. the eleven controls structures (D5.04) ────────────────────────────"

BODY=$(rpc "$PLANNER" get_case_controls_baseline "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field structureCount)" = "11"
test "$(jqp "$BODY" "[s['structure'] for s in x['structures']]")" = "['wbs', 'cbs', 'obs', 'schedule', 'cost_baseline', 'progress', 'commitments', 'actuals', 'forecast', 'changes', 'contingency']"
# Progress refuses on THIS case and says so; nothing reports a zero it did not
# measure. Slice 4B gave the structure a home (project_rules_of_credit + the
# planned curve), so the refusal is no longer "there is nowhere to look" — it
# is "nothing has been recorded to look at", which is the refusal that made
# the hole honest in the first place and must survive the hole being filled.
test "$(jqp "$BODY" "next(s for s in x['structures'] if s['structure']=='progress')['refusal'] is not None")" = "True"
test "$(jqp "$BODY" "next(s for s in x['structures'] if s['structure']=='actuals')['refusal'] is not None")" = "True"
# No capture yet: 'complete' is null, not false.
test "$(jqp "$BODY" "x['baselineComplete'] is None")" = "True"

# §70: capturing is part of setting a baseline — humans only.
BODY=$(rpc "$AIBOT" capture_controls_baseline_structure "{\"p_baseline_id\":\"$BL\",\"p_structure\":\"wbs\"}")
expect_err "$BODY" 'human accountability act'
# A planner may draft a baseline but not fix a controls structure against it.
BODY=$(rpc "$PLANNER" capture_controls_baseline_structure "{\"p_baseline_id\":\"$BL\",\"p_structure\":\"wbs\"}")
expect_err "$BODY" 'governance or engineering role'
# A structure with nothing recorded in it refuses BY NAME rather than
# capturing a zero: this case has no rule of credit, so a progress baseline
# would fix no measurement convention and would read as "baselined at 0%
# complete", which is a measurement nobody took. (Slice 4B's own transcript,
# step 9, proves the same structure CAPTURES once a rule of credit exists.)
BODY=$(rpc "$MANAGER" capture_controls_baseline_structure "{\"p_baseline_id\":\"$BL\",\"p_structure\":\"progress\"}")
expect_err "$BODY" 'baselined at 0% complete'
BODY=$(rpc "$MANAGER" capture_controls_baseline_structure "{\"p_baseline_id\":\"$BL\",\"p_structure\":\"not_a_structure\"}")
expect_err "$BODY" 'not one of the eleven controls structures'

BODY=$(rpc "$MANAGER" capture_controls_baseline_structure "{\"p_baseline_id\":\"$BL\",\"p_structure\":\"wbs\"}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field element_count)" = "4"
DIGEST=$(printf '%s' "$BODY" | field digest)
# A capture is immutable: re-capturing against the same version is refused…
BODY=$(rpc "$MANAGER" capture_controls_baseline_structure "{\"p_baseline_id\":\"$BL\",\"p_structure\":\"wbs\"}")
expect_err "$BODY" 'a capture is immutable'
# …and so is editing the row, even with RLS bypassed.
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$MANAGER_ID',true);
                     update controls_baseline_structures set element_count = 99 where content_digest='$DIGEST'; rollback;")
grep -qi 'capture is immutable' <<<"$OUT"

# Drift: the WBS moves after being fixed, and the report names the structure.
BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"1.3\",\"parent_wbs_code\":\"1\",\"title\":\"Guard package\",\"scope_description\":\"The additional guarding the inspector required\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_controls_baseline "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "next(s for s in x['structures'] if s['structure']=='wbs')['drifted']")" = "True"
test "$(printf '%s' "$BODY" | field driftedCount)" = "1"
# A structure nobody captured reports drift as null, not false.
test "$(jqp "$BODY" "next(s for s in x['structures'] if s['structure']=='cbs')['drifted'] is None")" = "True"
echo "   eleven reported, two refuse by name, capture immutable, drift detected"

echo "── 7. calculation lineage (D11.29) ──────────────────────────────────────"

BODY=$(rpc "$PLANNER" get_case_calculation_lineage "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "len(x['runs']) >= 3")" = "True"
test "$(jqp "$BODY" "all(r['codeVersion'] == 'develop-controls/4A/2026-11-24' for r in x['runs'])")" = "True"
test "$(jqp "$BODY" "all(len(r['method']) >= 10 for r in x['runs'])")" = "True"
# The scope-growth run carries its refusals AND its outputs — a caveated
# figure is distinguishable from a complete one.
test "$(jqp "$BODY" "next(r for r in x['runs'] if r['calculationKey']=='case_scope_growth')['status']")" = "computed_with_refusals"
test "$(jqp "$BODY" "len(next(r for r in x['runs'] if r['calculationKey']=='case_scope_growth')['refusals']) > 0")" = "True"
test "$(jqp "$BODY" "len(next(r for r in x['runs'] if r['calculationKey']=='case_scope_growth')['inputRefs']) > 0")" = "True"
# The reconciliation run from before the business case existed REFUSED and
# recorded that — the history shows what could not be computed, and why.
test "$(jqp "$BODY" "any(r['status']=='refused' for r in x['runs'])")" = "True"
test "$(jqp "$BODY" "all(r['outputs'] is None for r in x['runs'] if r['status']=='refused')")" = "True"

# A client cannot write a lineage row directly: the recorder is not theirs.
BODY=$(rpc "$PLANNER" record_calculation_run "{\"p_case_id\":\"$CASE\",\"p_key\":\"case_scope_growth\",\"p_method\":\"a forged run\",\"p_inputs\":{},\"p_input_refs\":[],\"p_outputs\":{\"costTotal\":0},\"p_refusals\":[]}")
expect_err "$BODY" 'permission denied'
# Nor edit one, even with RLS bypassed.
RUNID=$(psqlc "select id from calculation_runs where development_case_id='$CASE' limit 1")
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
                     update calculation_runs set outputs='{\"costTotal\":999999}'::jsonb where id='$RUNID'; rollback;")
grep -qi 'a recorded calculation is immutable' <<<"$OUT"
# Nor truncate either ledger — no row-level trigger fires for TRUNCATE.
#
# SLICE 4C ADDED A THIRD ROUTE TO CHECK. `schedule_simulation_runs` carries an
# FK to `calculation_runs`, so a bare `truncate calculation_runs` is now stopped
# by the FK check BEFORE the statement trigger runs. The table is still refused,
# but by a weaker mechanism and with a different message — and the two forms
# that get PAST the FK check (naming both tables, and CASCADE) are the ones the
# guard has to catch. All three are asserted, so a later change that dropped the
# statement trigger would fail here instead of passing on the FK's coat-tails.
OUT=$(sql_must_fail "truncate calculation_runs;")
grep -qi 'foreign key constraint' <<<"$OUT"
OUT=$(sql_must_fail "truncate calculation_runs, schedule_simulation_runs;")
grep -qi 'append-only for every caller' <<<"$OUT"
OUT=$(sql_must_fail "truncate calculation_runs cascade;")
grep -qi 'append-only for every caller' <<<"$OUT"
OUT=$(sql_must_fail "truncate controls_baseline_structures;")
grep -qi 'append-only for every caller' <<<"$OUT"

# The composed Integrated Controls read the surface calls.
BODY=$(rpc "$PLANNER" get_case_controls "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "len(x['wbs'])")" = "5"
test "$(jqp "$BODY" "len(x['costItems'])")" = "3"
test "$(jqp "$BODY" "len(x['scheduleActivities'])")" = "2"
test "$(jqp "$BODY" "sorted(x['latestCalculations'].keys())")" = "['case_cost_reconciliation', 'case_scope_growth']"
test "$(jqp "$BODY" "x['traceability']['brokenLinkCount'] > 0")" = "True"
test "$(jqp "$BODY" "len(x['notInThisSlice']) > 0")" = "True"

echo "   every number carries a run; runs immutable; ledgers untruncatable"

echo "── 8. the walls the adversarial review found missing ────────────────────"

# ── (a) TENANT ISOLATION, probed as another tenant rather than asserted by
#        a query that is structurally zero. Every controls read refuses a
#        foreign case BY NAME, and controls_structure_state — which used to
#        hand out element counts and content digests for any case uuid — is
#        not callable at all.
# Idempotent: the smoke is run repeatedly against one database in CI.
FOREIGN_ORG=$(psqlc "select id from organizations where name='SMOKE4A Foreign Tenant Corp' limit 1")
if [ -z "$FOREIGN_ORG" ]; then
  FOREIGN_ORG=$(psqlc "select provision_organization('SMOKE4A Foreign Tenant Corp')->>'organization_id'")
fi
test -n "$FOREIGN_ORG"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
do \$seed\$
declare v_uid uuid := '88888888-8888-4888-8888-888888888888';
begin
  if not exists (select 1 from auth.users where email = 'smoke4a-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke4a-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'Smoke 4A foreign planner'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  insert into user_profiles (id, organization_id, email, full_name, role)
  values (v_uid, '$FOREIGN_ORG', 'smoke4a-foreign@syncai.ca', 'Smoke 4A foreign planner', 'planner')
  on conflict (id) do update set organization_id = excluded.organization_id, role = 'planner';
end
\$seed\$;
PSQL
FOREIGNER=$(token 'smoke4a-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGNER"
for FN in get_case_controls get_case_scope_traceability get_case_scope_growth \
          get_case_cost_reconciliation get_case_controls_baseline get_case_calculation_lineage; do
  BODY=$(rpc "$FOREIGNER" "$FN" "{\"p_case_id\":\"$CASE\"}")
  expect_err "$BODY" 'development case not found'
done
BODY=$(rpc "$FOREIGNER" compute_case_scope_growth "{\"p_case_id\":\"$CASE\"}")
expect_err "$BODY" 'development case not found'
# controls_structure_state has no EXECUTE for anyone: its only callers are the
# two definers in its own migration, which run as the owner.
BODY=$(rpc "$FOREIGNER" controls_structure_state "{\"p_case_id\":\"$CASE\",\"p_structure\":\"wbs\"}")
expect_err "$BODY" 'permission denied'
BODY=$(rpc "$PLANNER" controls_structure_state "{\"p_case_id\":\"$CASE\",\"p_structure\":\"wbs\"}")
expect_err "$BODY" 'permission denied'
# ...and a JWT holder with NO organization at all — the caller the dual-caller
# guard was written for and could never catch, because `current_user` inside a
# SECURITY DEFINER owned by postgres is postgres and never 'authenticated'.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
do \$seed\$
declare v_uid uuid := '77777777-7777-4777-8777-777777777777';
begin
  if not exists (select 1 from auth.users where email = 'smoke4a-orphan@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke4a-orphan@syncai.ca',
      extensions.crypt('Orphan123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'Smoke 4A profileless caller'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  delete from user_profiles where id = v_uid;
end
\$seed\$;
PSQL
ORPHAN=$(token 'smoke4a-orphan@syncai.ca' 'Orphan123!@#')
test -n "$ORPHAN"
for FN in get_case_scope_traceability get_case_scope_growth get_case_cost_reconciliation           get_case_controls_baseline get_case_calculation_lineage; do
  BODY=$(rpc "$ORPHAN" "$FN" "{\"p_case_id\":\"$CASE\"}")
  expect_err "$BODY" 'forbidden'
done
# The same repair applied to the three already-merged Slice 3C reads that
# carried the dead form (20261130090700).
BODY=$(rpc "$ORPHAN" get_case_commitment_coverage "{\"p_case_id\":\"$CASE\"}")
expect_err "$BODY" 'forbidden'
BODY=$(rpc "$ORPHAN" get_case_assurance_position "{\"p_case_id\":\"$CASE\",\"p_gate_id\":null}")
expect_err "$BODY" 'forbidden'
# ...and a member in good standing is unaffected.
BODY=$(rpc "$PLANNER" get_case_commitment_coverage "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
echo "   foreign tenant refused at every controls read; structure digests unreachable; a JWT with no organization is refused"

# ── (b) TRUNCATE. RLS does not gate it and no row trigger fires for it, so
#        every wall above is one statement away from irrelevant.
for T in project_scope_needs project_cbs_codes project_wbs_elements \
         project_requirement_wbs project_control_accounts project_cost_items \
         project_scope_changes shutdown_tasks; do
  OUT=$(sql_must_fail "truncate $T cascade;")
  grep -qi 'one statement' <<<"$OUT"
  test "$(psqlc "select count(*) from information_schema.role_table_grants
                 where table_name='$T' and privilege_type='TRUNCATE'
                   and grantee in ('anon','authenticated','service_role')")" = "0"
done
echo "   TRUNCATE refused and revoked on all eight scope/cost/schedule tables"

# ── (c) A SERVICE WRITE to the chain is admitted AND RECORDED, and a row
#        whose tenant and whose case disagree is refused for every writer.
SEC_BEFORE=$(psqlc "select count(*) from security_events")
psqlc "insert into project_cbs_codes (organization_id, development_case_id, cbs_code, title, cost_type)
       values ('$ORG','$CASE','SMOKE4A-RAWCBS','Raw service code','indirect')" >/dev/null
test "$(psqlc "select count(*) from security_events")" -gt "$SEC_BEFORE"
test "$(psqlc "select count(*) from security_events where detail like '%project_cbs_codes row%outside the%scope-architecture RPCs%'")" -ge "1"
OUT=$(sql_must_fail "insert into project_cbs_codes (organization_id, development_case_id, cbs_code, title, cost_type)
                     values ('$FOREIGN_ORG','$CASE','SMOKE4A-XORG','Cross tenant','indirect');")
grep -qi 'development case belongs to' <<<"$OUT"
echo "   service writes to the chain audited; cross-tenant stamping refused"

# ── (d) §70 ON THE ROW, not only at the door. Asserting that an approved
#        change request covers a scope addition zeroes the "changed without
#        one" signal (spec I.7); a client cannot, and a service caller is
#        recorded.
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
                     update project_scope_changes set approved_change_ref='CR-FORGED',
                       approved_change_recorded_by='$PLANNER_ID', approved_change_recorded_at=now()
                     where development_case_id='$CASE'; rollback;")
grep -qi 'governance determination' <<<"$OUT"
SEC_BEFORE=$(psqlc "select count(*) from security_events")
psqlc "update project_scope_changes set approved_change_ref='CR-SERVICE',
         approved_change_recorded_by='$PLANNER_ID', approved_change_recorded_at=now()
       where development_case_id='$CASE' and change_ref='SMOKE4A-SC2'" >/dev/null
test "$(psqlc "select count(*) from security_events")" -gt "$SEC_BEFORE"
test "$(psqlc "select count(*) from security_events where detail like '%approved-change reference%CR-SERVICE%'")" -ge "1"
psqlc "update project_scope_changes set approved_change_ref=null,
         approved_change_recorded_by=null, approved_change_recorded_at=null
       where development_case_id='$CASE' and change_ref='SMOKE4A-SC2'" >/dev/null
echo "   forging an approved change refused for a client, audited for service"

# ── (e) A CAPTURE DESCRIBES THE APPROVAL INSTANT. The scope changes landed
#        AFTER the baseline was approved, so capturing 'changes' against it
#        would record content that did not exist at the approval.
BODY=$(rpc "$MANAGER" capture_controls_baseline_structure "{\"p_baseline_id\":\"$BL\",\"p_structure\":\"changes\"}")
expect_err "$BODY" 'AFTER'
expect_err "$BODY" 'Approve a new baseline version'
echo "   a structure that moved after approval refuses to be captured against it"

# ── (f) RE-BASELINING DOES NOT ERASE RECORDED GROWTH. Approving SCOPE v2
#        moves the question ("growth since v2"), and everything attributed to
#        v1 is reported beside it rather than vanishing.
GROWTH_BEFORE=$(rpc "$PLANNER" get_case_scope_growth "{\"p_case_id\":\"$CASE\"}")
test "$(printf '%s' "$GROWTH_BEFORE" | field additionCount)" = "2"
BODY=$(rpc "$PLANNER" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"SCOPE\",\"p_description\":\"Scope re-baselined after the guarding change\"}")
noerr "$BODY"; BL2=$(printf '%s' "$BODY" | field baseline_id)
BODY=$(rpc "$MANAGER" approve_case_baseline "{\"p_baseline_id\":\"$BL2\",\"p_note\":\"Re-baselined to absorb the approved guarding scope\"}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_scope_growth "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['baseline']['version']")" = "2"
test "$(printf '%s' "$BODY" | field additionCount)" = "0"
# The $2.3M problem: nothing disappears.
test "$(jqp "$BODY" "x['priorBaselines']['additionCount']")" = "2"
test "$(jqp "$BODY" "x['priorBaselines']['costTotal']")" = "40000"
test "$(jqp "$BODY" "any('superseded SCOPE baseline' in c for c in x['caveats'])")" = "True"
# ...and the lineage row's input refs are exactly the rows the aggregate
# summed, so replaying the record reproduces the recorded output.
BODY=$(rpc "$PLANNER" compute_case_scope_growth "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "len(x['inputRefs']) if 'inputRefs' in x else 0")" = "0"
test "$(psqlc "select jsonb_array_length(input_refs) from calculation_runs
               where development_case_id='$CASE' and calculation_key='case_scope_growth'
               order by computed_at desc limit 1")" = "0"
echo "   re-baselining moves the question and strands nothing; input refs match the sum"

# ── (g) A NEED CAN BE WITHDRAWN, and a requirement that traced to it stops
#        counting as traced — the chain cannot look complete from both ends.
BODY=$(rpc "$PLANNER" set_scope_need_status "{\"p_need_id\":\"$NEED\",\"p_status\":\"withdrawn\"}")
expect_err "$BODY" 'state why'
TRACE_BEFORE=$(rpc "$PLANNER" get_case_scope_traceability "{\"p_case_id\":\"$CASE\"}")
BODY=$(rpc "$PLANNER" set_scope_need_status "{\"p_need_id\":\"$NEED\",\"p_status\":\"withdrawn\",\"p_reason\":\"Superseded by the regulator's own guarding requirement\"}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field status)" = "withdrawn"
BODY=$(rpc "$PLANNER" get_case_scope_traceability "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "len(x['orphans']['requirementsWithoutNeed']) > len($(printf '%s' "$TRACE_BEFORE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["orphans"]["requirementsWithoutNeed"])'))")" = "True"
test "$(jqp "$BODY" "any(r.get('withdrawnNeedRef') for r in x['orphans']['requirementsWithoutNeed'])")" = "True"
echo "   withdrawing a need un-traces the requirements that rested on it"

# ── (h) A cross-case requirement→need link is refused for every writer, so
#        a need cannot be made to look covered by another project's paperwork.
OTHER_REQ=$(psqlc "select id from design_requirements where development_case_id is not null
                    and development_case_id <> '$CASE' limit 1")
if [ -n "$OTHER_REQ" ]; then
  OUT=$(sql_must_fail "update design_requirements set scope_need_id='$NEED' where id=$OTHER_REQ;")
  grep -qi 'does not jump between cases' <<<"$OUT"
fi
echo "   a requirement on another case cannot close this case's need"

# ── (i) RE-PARENTING REFRESHES THE WHOLE SUBTREE'S DEPTH.
BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"8\",\"title\":\"Depth probe root\",\"scope_description\":\"A root element used to prove subtree depth refresh\"}}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field depth)" = "1"
BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"8.1\",\"parent_wbs_code\":\"8\",\"title\":\"Depth probe child\",\"scope_description\":\"A child element used to prove subtree depth refresh\"}}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field depth)" = "2"
W111=$(psqlc "select id from project_wbs_elements where development_case_id='$CASE' and wbs_code='1.1.1'")
psqlc "update project_wbs_elements set parent_id='$W111'
       where development_case_id='$CASE' and wbs_code='8'" >/dev/null
test "$(psqlc "select depth from project_wbs_elements where development_case_id='$CASE' and wbs_code='8'")" = "4"
test "$(psqlc "select depth from project_wbs_elements where development_case_id='$CASE' and wbs_code='8.1'")" = "5"
# ...and the ROLL-UP POINT moves with it. 1.1.1 collects at SMOKE4A-CA1 only
# because CA1 sits above it; moved to the root, its cost line must stop
# counting against an account that is no longer on its branch.
test "$(psqlc "select ca.control_account_ref from project_cost_items ci
               join project_control_accounts ca on ca.id=ci.control_account_id
               where ci.development_case_id='$CASE' and ci.cost_item_ref='SMOKE4A-CI3'")" = "SMOKE4A-CA1"
psqlc "update project_wbs_elements set parent_id=null
       where development_case_id='$CASE' and wbs_code='1.1.1'" >/dev/null
test "$(psqlc "select depth from project_wbs_elements where development_case_id='$CASE' and wbs_code='1.1.1'")" = "1"
test "$(psqlc "select depth from project_wbs_elements where development_case_id='$CASE' and wbs_code='8.1'")" = "3"
test "$(psqlc "select control_account_id is null from project_cost_items
               where development_case_id='$CASE' and cost_item_ref='SMOKE4A-CI3'")" = "t"
echo "   a moved branch carries its descendants' levels and its cost lines' roll-up point"

# ── (j) SEVERAL OPTIONS, NO DECISION. Choosing an option is a decision; the
#        reconciliation names them and refuses rather than taking the oldest.
BODY=$(rpc "$PLANNER" add_business_case_option "{\"p_business_case_id\":$BCASE,\"p_label\":\"Replace the whole crusher\",\"p_life_periods\":10,\"p_cash_flows\":[{\"period\":0,\"amount\":-900000},{\"period\":1,\"amount\":200000}]}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_cost_reconciliation "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['reconciles'] is None")" = "True"
test "$(jqp "$BODY" "any('nothing records which one is the plan of record' in r for r in x['refusals'])")" = "True"
test "$(jqp "$BODY" "any('Replace the whole crusher' in r for r in x['refusals'])")" = "True"
echo "   two spending options and no recorded decision: named and refused, never the oldest"

# ── (k) THE CHAIN'S SYSTEM LINK IS REACHABLE. record_wbs_element takes a
#        system node, validates it against the ONE five-level tree and
#        refuses a node outside this tenant's subtree.
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#'); test -n "$EXEC"
org_node(){ # name, level, parent — lookup or create, so the step is idempotent
  local existing; existing=$(psqlc "select id from organizations where name='$1' limit 1")
  if [ -n "$existing" ]; then printf '%s' "$existing"; return; fi
  rpc "$EXEC" create_sub_organization "{\"p_name\":\"$1\",\"p_node_level\":\"$2\",\"p_parent_node_id\":\"$3\"}" | field node_id
}
SITE=$(org_node 'SMOKE4A Site' site "$ORG")
AREA=$(org_node 'SMOKE4A Area' area "$SITE")
SYSNODE=$(org_node 'SMOKE4A Crusher system' system "$AREA")
test -n "$SYSNODE"
BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"9\",\"title\":\"System-coded element\",\"scope_description\":\"An element that serves one named system\",\"system_node_id\":\"$AREA\"}}")
expect_err "$BODY" 'system level'
BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"9\",\"title\":\"System-coded element\",\"scope_description\":\"An element that serves one named system\",\"system_node_id\":\"$SYSNODE\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_scope_traceability "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "next(l for l in x['chain'] if l['link']=='system')['count']")" = "1"
echo "   the chain's system link is populated through the same door that validates it"

echo
echo "Develop slice-4a smoke PASSED — scope chain, gaps, P6 boundary, cost lines, growth, eleven structures, lineage."

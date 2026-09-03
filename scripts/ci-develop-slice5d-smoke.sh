#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 5D — the event bus, the Change Impact Agent, the
# case-scoped RAM kernel, §34's edges and the composed Sync Information
# module. Every step is a live transcript against a real local database, run
# TWICE in a row on one database before it was committed.
#
# Steps:
#   1  the five §71-78 events are emitted BY THE ACTS THAT CAUSE THEM
#      (D11.26): a gate criterion changed, a risk indicator crossing into
#      critical, a schedule activity moved, a work order going blocked, a
#      commissioning test failing.
#   2  the scope boundary (5D-R3) in BOTH directions, and the per-transaction
#      collapse (5D-R4): a batch is one event, not fifty.
#   3  THE CONSUMER ACTED (5D-R5): one delivery per event, the rule that fired,
#      and the severity the RiskThresholdExceeded rule READ OUT OF THE PAYLOAD —
#      critical blocks, warning asks.
#   4  the consequence is REAL: an unanswered blocking consequence refuses a
#      gate review at the PERSISTENCE WALL, and answering it clears the refusal.
#   5  §70 and §42 on the answer: the AI-operator identity refused by name at
#      the door AND at the wall for every writer; the person whose act emitted
#      the event refused; a note nobody could act on refused; a second answer
#      refused; and both bus tables undeletable and untruncatable.
#   6  an empty event list is a SENTENCE, never "0 events" (5D-R7).
#   7  the Change Impact Agent (D12.10): it runs 5C's ONE traversal, REFUSES
#      over a gapped thread with a NULL count, answers over a clean one, drops
#      a model consequence naming an object the walk never reached, drops every
#      model consequence when the traversal refused, fixes source and severity
#      in SQL, and its report is immutable.
#   8  the agent PROPOSES: the AI-operator identity can record a report and
#      cannot acknowledge a receipt, declare a revision, sever a hop, retire an
#      object or answer an event consequence.
#   9  the RAM kernel scoped to a case (D12.13): three refusals by name, the
#      inputs when they are all there, the absent-RBD refusal carried, a wrong
#      kernel version refused, and a lineage run recording the refusals.
#  10  §34 (D11.21): nineteen edges, FOUR absent, and the absence claim now
#      CHECKED against the catalogue — including the fifth, which was found
#      already built and is closed.
#  11  the composed Sync Information module (D11.09): no composite score, the
#      asset-data leg named as missing.
#  12  cross-tenant: the foreign member sees none of it — INCLUDING
#      case_event_consequence_obligations, which had no org filter at all.
#  13  the bus ledger has ONE door and service_role is not it, and the org and
#      the case must AGREE (5D-R20).
#  14  the per-transaction collapse never swallows an ESCALATION (5D-R19).
#  15  every emitter covers the act: RiskThresholdExceeded on UPDATE,
#      WorkPackageBlocked on create-then-link, ScheduleUpdated on DELETE.
#  16  the change-impact edge function refuses an unauthenticated caller.
#
# Run: supabase start && scripts/ci-develop-slice5d-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-5d smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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
# develop_events and develop_event_deliveries are APPEND-ONLY for every caller
# — no UPDATE, no DELETE, no TRUNCATE, and the only INSERT door is
# emit_develop_event. They DO cascade with the development case
# (`development_case_id ... references development_cases(id) on delete cascade`,
# the repo convention thread_objects/calculation_runs/stage_gate_reviews all
# follow), and the append-only guards carry an explicit mid-cascade escape for
# exactly that. An earlier version of this comment claimed the opposite — that
# the case column was deliberately not a foreign key — which was simply false
# about the schema this file tests, and a future reader would have trusted it.
#
# So the teardown below drops the CASES and the rows go with them, and every
# assertion is a DELTA measured across the act rather than an absolute count:
# the sibling smokes share a database in CI and this one must not read their
# rows or a previous run's.
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
declare v_uid uuid := '5d5d5d5d-5555-4555-8555-5d5d5d5d5d5d';
        v_org uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into organizations (id, name) values (v_org, 'S4D foreign tenant')
    on conflict (id) do nothing;
  if not exists (select 1 from auth.users where email = 'smoke5d-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke5d-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'S5D foreign member'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  if not exists (select 1 from auth.identities where user_id = v_uid) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke5d-foreign@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_uid, v_org, 'smoke5d-foreign@syncai.ca', 'maintenance_manager')
  on conflict (id) do update set organization_id = v_org, role = 'maintenance_manager';
  if not exists (select 1 from assets where organization_id = v_org and asset_tag = 'S5D-FGN') then
    insert into assets (organization_id, asset_tag, name, criticality)
    values (v_org, 'S5D-FGN', 'Foreign tenant asset', 'medium');
  end if;
end $seed$;
PSQL
FOREIGN_ASSET=$(psqlc "select id from assets where organization_id='$ORG2' and asset_tag='S5D-FGN'")
test -n "$FOREIGN_ASSET"
# ── Idempotent re-run. Fixture keys are kept SHORT on purpose — long fixture
# identifiers have been read as secrets by the repository's scanner and have
# blocked merges.
#
# develop_events, develop_event_deliveries, change_impact_reports and
# ram_agent_reports all refuse DELETE for every caller, this script included.
# They go when the CASE goes, through the declared cascade the walls admit
# mid-cascade. Deleting the case first also means the framework teardown below
# cannot emit GateRequirementChanged onto a live case.
psqlc "delete from development_cases where organization_id='$ORG' and title like 'S5D %';" >/dev/null
psqlc "delete from risks where organization_id='$ORG' and title like 'S5D %';" >/dev/null
psqlc "delete from project_frameworks where organization_id='$ORG' and name like 'S5D %';" >/dev/null
psqlc "delete from work_orders where organization_id='$ORG' and title like 'S5D %';" >/dev/null
psqlc "delete from shutdown_events where organization_id='$ORG' and event_key like 'S5D-%';" >/dev/null
psqlc "delete from capital_projects where organization_id='$ORG' and project_code like 'S5D-%';" >/dev/null
psqlc "delete from component_life_events where organization_id='$ORG' and unit_number like 'S5D-%';" >/dev/null
psqlc "delete from assets where organization_id='$ORG' and asset_tag like 'S5D-A%';" >/dev/null
test "$(psqlc "select count(*) from develop_events e join development_cases c on c.id=e.development_case_id where c.title like 'S5D %'")" = "0"
test "$(psqlc "select count(*) from change_impact_reports r join development_cases c on c.id=r.development_case_id where c.title like 'S5D %'")" = "0"

echo "── 0. fixtures ──────────────────────────────────────────────────────────"

PROJ=$(psqlc "with r as (insert into capital_projects (organization_id, project_code, title, status)
  values ('$ORG','S5D-P1','S5D delivery project','active') returning id) select id from r")
test -n "$PROJ"

R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S5D bus case\",\"p_problem_statement\":\"Nothing tells this project that a commissioning test failed or that a gate requirement moved under it, so the readiness answer is computed over facts that have already changed.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; CASE=$(printf '%s' "$R" | field case_id); test -n "$CASE"
psqlc "update development_cases set capital_project_id=$PROJ where id='$CASE';" >/dev/null

# A SECOND case, never touched by any act, so step 6 can prove the empty read
# is a sentence rather than a zero.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S5D quiet case\",\"p_problem_statement\":\"A case nothing has happened to, kept so the empty event list can be read and proven to be a sentence and not a count of zero.\",\"p_lifecycle_type\":\"greenfield\"}")
noerr "$R"; QUIET=$(printf '%s' "$R" | field case_id); test -n "$QUIET"

# Two assets: one BOUND to the case, one deliberately not (step 2's boundary).
psqlc "insert into assets (organization_id, asset_tag, name, criticality)
       values ('$ORG','S5D-A1','Underflow pump','high'),
              ('$ORG','S5D-A2','Unwatched conveyor','medium');" >/dev/null
A1=$(psqlc "select id from assets where organization_id='$ORG' and asset_tag='S5D-A1'")
A2=$(psqlc "select id from assets where organization_id='$ORG' and asset_tag='S5D-A2'")
test -n "$A1"; test -n "$A2"
psqlc "insert into development_case_assets (organization_id, development_case_id, asset_id)
       values ('$ORG','$CASE','$A1');" >/dev/null

# A framework the case is on, with a gate carrying one criterion.
FW=$(psqlc "with r as (insert into project_frameworks (organization_id,name,source,basis,status)
  values ('$ORG','S5D framework','internal','A framework recorded by the slice 5D transcript so a gate criterion has a gate to hang from.','draft') returning id) select id from r")
test -n "$FW"
psqlc "insert into project_framework_stages (organization_id, framework_id, stage_key, sequence, display_name)
       values ('$ORG','$FW','need_identification',1,'Need identification');" >/dev/null
GATE=$(psqlc "with r as (insert into stage_gates (organization_id, framework_id, stage_key, name, sequence)
  values ('$ORG','$FW','need_identification','S5D-G1',1) returning id) select id from r")
test -n "$GATE"
psqlc "update development_cases set framework_id='$FW', current_stage_key='need_identification' where id='$CASE';" >/dev/null

echo "── 1. the five events, emitted by the acts that cause them (D11.26) ─────"

evcount(){ psqlc "select count(*) from develop_events where development_case_id='$CASE' and event_name='$1'"; }

# (a) GateRequirementChanged — a gate-scoped criterion is authored.
CRIT=$(psqlc "with r as (insert into stage_gate_criteria (organization_id, stage_key, criterion, is_mandatory, gate_id)
  values ('$ORG','need_identification','Availability requirement is supported by a RAM study', true, $GATE) returning id) select id from r")
test -n "$CRIT"
test "$(evcount GateRequirementChanged)" = "1"

# (b) RiskThresholdExceeded — a CROSSING, not a level.
RISK=$(psqlc "with r as (insert into risks (organization_id, title, development_case_id)
  values ('$ORG','S5D bearing risk','$CASE') returning id) select id from r")
IND=$(psqlc "with r as (insert into risk_indicators (organization_id, risk_id, name, source_system)
  values ('$ORG','$RISK','Bearing vibration','condition monitoring') returning id) select id from r")
test -n "$IND"
psqlc "insert into risk_indicator_observations (organization_id, indicator_id, value, state, observed_at)
       values ('$ORG','$IND',1.2,'normal', now() - interval '3 hour');" >/dev/null
test "$(evcount RiskThresholdExceeded)" = "0"   # normal is not a crossing
psqlc "insert into risk_indicator_observations (organization_id, indicator_id, value, state, observed_at)
       values ('$ORG','$IND',7.4,'warning', now() - interval '2 hour');" >/dev/null
test "$(evcount RiskThresholdExceeded)" = "1"
psqlc "insert into risk_indicator_observations (organization_id, indicator_id, value, state, observed_at)
       values ('$ORG','$IND',9.9,'critical', now() - interval '1 hour');" >/dev/null
test "$(evcount RiskThresholdExceeded)" = "2"
# A SECOND critical is not a second crossing.
psqlc "insert into risk_indicator_observations (organization_id, indicator_id, value, state, observed_at)
       values ('$ORG','$IND',10.1,'critical', now());" >/dev/null
test "$(evcount RiskThresholdExceeded)" = "2"

# (c) ScheduleUpdated — through the WBS element a human resolved.
WBS=$(psqlc "with r as (insert into project_wbs_elements (organization_id, development_case_id, wbs_code, title, scope_description)
  values ('$ORG','$CASE','1.1','Underflow package','Everything inside the underflow pump package, as scoped for the slice 5D transcript.') returning id) select id from r")
SD=$(psqlc "with r as (insert into shutdown_events (organization_id, event_key, title)
  values ('$ORG','S5D-SD','S5D outage') returning id) select id from r")
test -n "$WBS"; test -n "$SD"
psqlc "insert into shutdown_tasks (event_id, task_key, label, duration_hours, wbs_element_id)
       values ('$SD','A1','Isolate underflow',8,'$WBS');" >/dev/null
test "$(evcount ScheduleUpdated)" = "1"

# (d) WorkPackageBlocked — on an asset in this case's scope.
WO=$(psqlc "with r as (insert into work_orders (organization_id, asset_id, title, status)
  values ('$ORG','$A1','S5D underflow strip-down','pending') returning id) select id from r")
test -n "$WO"
test "$(evcount WorkPackageBlocked)" = "0"   # pending is not blocked
psqlc "update work_orders set status='blocked' where id='$WO';" >/dev/null
test "$(evcount WorkPackageBlocked)" = "1"
# Still blocked is not blocked again.
psqlc "update work_orders set status='blocked', priority='high' where id='$WO';" >/dev/null
test "$(evcount WorkPackageBlocked)" = "1"

# (e) CommissioningTestFailed — through the capital project the case references.
TEST=$(psqlc "with r as (insert into acceptance_tests (organization_id, project_id, test_ref, test_stage, outcome, punch_items_raised, punch_items_open)
  values ('$ORG',$PROJ,'S5D-T1','commissioning','pass',0,0) returning id) select id from r")
test -n "$TEST"
test "$(evcount CommissioningTestFailed)" = "0"
psqlc "update acceptance_tests set outcome='fail', punch_items_raised=3, punch_items_open=3 where id=$TEST;" >/dev/null
test "$(evcount CommissioningTestFailed)" = "1"

# All five names present, and they are §71-78's, verbatim.
test "$(psqlc "select count(distinct event_name) from develop_events where development_case_id='$CASE'")" = "5"
test "$(psqlc "select array_length(sync_develop_event_names(),1)")" = "5"
test "$(psqlc "select count(*) from unnest(sync_develop_event_names()) n where n in ('GateRequirementChanged','RiskThresholdExceeded','ScheduleUpdated','WorkPackageBlocked','CommissioningTestFailed')")" = "5"

echo "── 2. the scope boundary, both ways, and the per-transaction collapse ───"

# A work order on an asset NO case is watching emits nothing (5D-R3).
BEFORE=$(psqlc "select count(*) from develop_events where organization_id='$ORG'")
psqlc "insert into work_orders (organization_id, asset_id, title, status)
       values ('$ORG','$A2','S5D unwatched package','blocked');" >/dev/null
test "$(psqlc "select count(*) from develop_events where organization_id='$ORG'")" = "$BEFORE"

# A STAGE-scoped criterion belongs to no framework and so to no case.
psqlc "insert into stage_gate_criteria (organization_id, stage_key, criterion, is_mandatory)
       values ('$ORG','need_identification','S5D catalogue criterion with no gate', false)
       on conflict do nothing;" >/dev/null
test "$(psqlc "select count(*) from develop_events where organization_id='$ORG'")" = "$BEFORE"

# A cosmetic edit is not a requirement change.
psqlc "update stage_gate_criteria set sort_order = 42 where id = $CRIT;" >/dev/null
test "$(evcount GateRequirementChanged)" = "1"

# RULING 5D-R4: two activities moved in ONE transaction is ONE ScheduleUpdated.
psqlc "begin;
       insert into shutdown_tasks (event_id, task_key, label, duration_hours, wbs_element_id)
         values ('$SD','A2','Scaffold underflow',12,'$WBS');
       insert into shutdown_tasks (event_id, task_key, label, duration_hours, wbs_element_id)
         values ('$SD','A3','Strip underflow',16,'$WBS');
       commit;" >/dev/null
test "$(evcount ScheduleUpdated)" = "2"

echo "── 3. THE CONSUMER ACTED (5D-R5) ────────────────────────────────────────"

# Every event has exactly one delivery. An emitter with no subscriber is the
# thing this slice refuses to ship, and this is the assertion that says so.
test "$(psqlc "select count(*) from develop_events e where e.development_case_id='$CASE'
                and not exists (select 1 from develop_event_deliveries d where d.event_id=e.id)")" = "0"
test "$(psqlc "select count(distinct subscription_key) from develop_event_deliveries where development_case_id='$CASE'")" = "1"

# The rule that fired is named, per event.
test "$(psqlc "select d.rule_key from develop_events e join develop_event_deliveries d on d.event_id=e.id
                where e.development_case_id='$CASE' and e.event_name='CommissioningTestFailed'")" = "commissioning_test_failed_disposition"

# The GateRequirementChanged rule READ THE CASE'S HISTORY: this gate has never
# been reviewed, so the criterion authored above asks rather than blocks. A
# rule set that blocked on framework authoring is one people clear in bulk.
test "$(psqlc "select d.consequence from develop_events e join develop_event_deliveries d on d.event_id=e.id
                where e.development_case_id='$CASE' and e.event_name='GateRequirementChanged'")" = "attention"

# The RiskThresholdExceeded rule READ THE PAYLOAD: critical blocks, warning asks.
test "$(psqlc "select d.consequence from develop_events e join develop_event_deliveries d on d.event_id=e.id
                where e.development_case_id='$CASE' and e.event_name='RiskThresholdExceeded'
                  and e.payload->>'state'='critical'")" = "blocking"
test "$(psqlc "select d.consequence from develop_events e join develop_event_deliveries d on d.event_id=e.id
                where e.development_case_id='$CASE' and e.event_name='RiskThresholdExceeded'
                  and e.payload->>'state'='warning'")" = "attention"

# The bus is NOT a third audit ledger: the emission wrote an audit_events row
# carrying previous_state and new_state (5D-R1c).
test "$(psqlc "select count(*) from audit_events where entity_type='develop_event'
                and event_data->>'case_id'='$CASE' and new_state is not null")" \
  = "$(psqlc "select count(*) from develop_events where development_case_id='$CASE'")"

echo "── 4. the consequence is REAL: it stops a gate review at the wall ───────"

# The blocking, unanswered consequences are gate obligations on the ONE
# predicate — the screen and the wall read the same rows.
BLOCKING=$(psqlc "select count(*) from jsonb_array_elements(case_event_consequence_obligations('$CASE', $GATE)) x")
# TWO of the five: the failed commissioning test, and the risk indicator that
# went CRITICAL. The warning-level crossing, the schedule move, the blocked
# work order and the criterion authored before any review all ASK rather than
# block — a rule set where every class blocks is one nobody reads.
test "$BLOCKING" = "2"
test "$(psqlc "select count(*) from jsonb_array_elements(case_gate_outstanding_obligations('$CASE',$GATE)) x
                where x->>'type'='event_consequence_unanswered'")" = "$BLOCKING"

# ...and the gate REFUSES, by name, through the SHIPPED wall — for every
# writer, not only through the RPC (the 3C idiom, verbatim). No second
# evaluator was written for this slice.
FIND5D=$(psqlc "select coalesce(jsonb_agg(jsonb_build_object('criterion_text', sc.criterion, 'status', 'met')), '[]'::jsonb)::text from stage_gate_criteria sc where sc.gate_id=$GATE and sc.organization_id='$ORG'")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$GATE,\"p_outcome\":\"proceed\",\"p_note\":\"A proceed recorded while a failed commissioning test stands unanswered must be refused.\",\"p_findings\":$FIND5D}")
grep -qi 'cannot pass while' <<<"$R"
grep -qi 'CommissioningTestFailed' <<<"$R"
grep -qi 'answer_develop_event_consequence' <<<"$R"
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
select set_config('app.gate_review_write','granted',true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_by, reviewed_at, note)
values ('$ORG','$CASE',$GATE,'need_identification','proceed','$MANAGER_ID',now(),'bypass attempt over an unanswered blocking event consequence');
rollback;")
grep -qi 'cannot pass while' <<<"$OUT"
grep -q 'III.§71-78' <<<"$OUT"

echo "── 5. §70 and §42 on the answer, at the door and at the wall ───────────"

DEL_TEST=$(psqlc "select d.id from develop_events e join develop_event_deliveries d on d.event_id=e.id
                   where e.development_case_id='$CASE' and e.event_name='CommissioningTestFailed'")
test -n "$DEL_TEST"

# §70 at the door.
R=$(rpc "$AIBOT" answer_develop_event_consequence "{\"p_delivery_id\":$DEL_TEST,\"p_note\":\"The AI operator says the failed test has been dealt with.\"}")
expect_err "$R" 'spec §70'
# §70 at the WALL, for a caller with RLS switched off entirely.
OUT=$(sql_must_fail "update develop_event_deliveries set answered_by='$AIBOT_ID', answered_at=now(),
  answer_note='Answered straight past the door by the AI operator identity.' where id=$DEL_TEST;")
grep -q 'AI-operator identity cannot' <<<"$OUT"

# A note nobody could act on.
R=$(rpc "$PLANNER" answer_develop_event_consequence "{\"p_delivery_id\":$DEL_TEST,\"p_note\":\"done\"}")
expect_err "$R" '20 characters minimum'

# A direct INSERT into either table is refused: one door each.
OUT=$(sql_must_fail "insert into develop_events (organization_id, development_case_id, event_name, source_table, source_ref, subject_label, dedupe_key, emitted_tx)
  values ('$ORG','$CASE','ScheduleUpdated','shutdown_tasks','999','A forged event','ScheduleUpdated:999', txid_current());")
grep -q 'emit_develop_event' <<<"$OUT"
OUT=$(sql_must_fail "insert into develop_event_deliveries (organization_id, event_id, development_case_id, subscription_key, rule_key, consequence, obligation)
  select '$ORG', e.id, '$CASE', 'forged', 'forged_rule', 'blocking', 'A consequence nobody''s act produced at all.'
    from develop_events e where e.development_case_id='$CASE' limit 1;")
grep -q 'dispatch_develop_event' <<<"$OUT"

# An emitted event is not editable and not deletable; neither is a delivery.
OUT=$(sql_must_fail "update develop_events set subject_label='rewritten' where development_case_id='$CASE';")
grep -qi 'not editable' <<<"$OUT"
OUT=$(sql_must_fail "delete from develop_events where development_case_id='$CASE';")
grep -qi 'not deleted' <<<"$OUT"
OUT=$(sql_must_fail "delete from develop_event_deliveries where development_case_id='$CASE';")
grep -qi 'answered, never deleted' <<<"$OUT"
OUT=$(sql_must_fail "truncate develop_events cascade;")
grep -qi 'not truncatable' <<<"$OUT"
OUT=$(sql_must_fail "truncate develop_event_deliveries cascade;")
grep -qi 'not truncatable' <<<"$OUT"

# The answer, by a human with a sentence.
R=$(rpc "$MANAGER" answer_develop_event_consequence "{\"p_delivery_id\":$DEL_TEST,\"p_note\":\"Re-ran the commissioning test after the seal change; it passed and the three punch items are closed.\"}")
noerr "$R"
test "$(printf '%s' "$R" | field consequence)" = "blocking"
# Answered once.
R=$(rpc "$MANAGER" answer_develop_event_consequence "{\"p_delivery_id\":$DEL_TEST,\"p_note\":\"Answering the same consequence a second time to see whether it is permitted.\"}")
expect_err "$R" 'already answered'

# Answer the remaining blocking one (the indicator that went critical), and the
# case has no outstanding blocker left.
for D in $(psqlc "select d.id from develop_event_deliveries d where d.development_case_id='$CASE' and d.answered_at is null and d.consequence='blocking'"); do
  R=$(rpc "$MANAGER" answer_develop_event_consequence "{\"p_delivery_id\":$D,\"p_note\":\"Reassessed the risk against the new observation and re-stated the treatment plan with the owner.\"}")
  noerr "$R"
done
test "$(psqlc "select count(*) from jsonb_array_elements(case_event_consequence_obligations('$CASE', $GATE)) x")" = "0"

# ...and the SAME write the wall refused above now goes through. Rolled back so
# the transcript leaves no gate review behind and re-runs identically.
psqlc "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
select set_config('app.gate_review_write','granted',true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_by, reviewed_at, note)
values ('$ORG','$CASE',$GATE,'need_identification','proceed','$MANAGER_ID',now(),'recorded once every blocking event consequence had been answered');
rollback;" >/dev/null

echo "── 5b. the SAME rule, a different answer, and §42 ───────────────────────"

# A criterion that moves under a gate the case HAS been reviewed at BLOCKS —
# the same act and the same rule, classified differently because the case's
# history is different. The act is performed with a signed-in identity, so the
# event carries an emitter and §42 has somebody to segregate.
psqlc "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
select set_config('app.gate_review_write','granted',true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_by, reviewed_at, note)
values ('$ORG','$CASE',$GATE,'need_identification','proceed','$MANAGER_ID',now(),'a recorded review, so the next criterion edit lands on decided ground');
update stage_gate_criteria set criterion='Availability requirement is supported by a RAM study and a spares model' where id=$CRIT;
commit;" >/dev/null
DEL_GATE=$(psqlc "select d.id from develop_events e join develop_event_deliveries d on d.event_id=e.id
                   where e.development_case_id='$CASE' and e.event_name='GateRequirementChanged' and d.answered_at is null
                   order by e.id desc limit 1")
test -n "$DEL_GATE"
test "$(psqlc "select consequence from develop_event_deliveries where id=$DEL_GATE")" = "blocking"

# A direct UPDATE is refused at the marker — one door, and it is the RPC that
# checks the role, refuses the AI identity and writes the audit row.
OUT=$(sql_must_fail "update develop_event_deliveries set consequence='attention' where id=$DEL_GATE;")
grep -qi 'A direct UPDATE clears a gate blocker' <<<"$OUT"
# ...and a caller who HAS reached the door still cannot re-classify: downgrading
# `blocking` to `attention` is how a gate blocker disappears without being
# answered, so it is refused by name inside the wall too.
OUT=$(sql_must_fail "begin;
select set_config('app.develop_event_delivery_write','granted',true);
update develop_event_deliveries set consequence='attention' where id=$DEL_GATE;
rollback;")
grep -q 'Downgrading' <<<"$OUT"

# §42: the manager's act emitted this event, so the manager does not also
# record that its consequence has been dealt with.
R=$(rpc "$MANAGER" answer_develop_event_consequence "{\"p_delivery_id\":$DEL_GATE,\"p_note\":\"The person who changed the requirement confirming the evidence still answers it.\"}")
expect_err "$R" 'spec §42'
# Somebody else can.
R=$(rpc "$PLANNER" answer_develop_event_consequence "{\"p_delivery_id\":$DEL_GATE,\"p_note\":\"Checked the RAM study and the spares model against the reworded criterion; both still answer it.\"}")
noerr "$R"
psqlc "delete from stage_gate_reviews where development_case_id='$CASE' and gate_id=$GATE;" >/dev/null
test "$(psqlc "select count(*) from jsonb_array_elements(case_event_consequence_obligations('$CASE', $GATE)) x")" = "0"

echo "── 6. an empty event list is a SENTENCE, never a zero (5D-R7) ───────────"

R=$(rpc "$PLANNER" get_case_develop_events "{\"p_case_id\":\"$QUIET\"}")
noerr "$R"
test "$(printf '%s' "$R" | field eventCount)" = "0"
HEAD=$(printf '%s' "$R" | field headline)
grep -q 'FIVE acts this bus watches' <<<"$HEAD"
grep -q 'never a clean bill of health' <<<"$HEAD"
grep -q 'bounded window' <<<"$HEAD"
if grep -qi '0 event' <<<"$HEAD"; then echo "the empty read printed a zero"; exit 1; fi

echo "── 7. the Change Impact Agent runs 5C's ONE traversal (D12.10) ──────────"

reg(){ # kind ref title -> id
  local r; r=$(rpc "$PLANNER" register_thread_object "{\"p_case_id\":\"$CASE\",\"p_object\":{\"object_kind\":\"$1\",\"object_ref\":\"$2\",\"title\":\"$3\",\"anchor_asset_id\":\"$A1\"}}")
  noerr "$r"; printf '%s' "$r" | field object_id
}
link(){ local r; r=$(rpc "$PLANNER" link_thread_objects "{\"p_upstream_id\":$1,\"p_downstream_id\":$2,\"p_link_type\":\"$3\",\"p_basis\":\"$4\"}")
  noerr "$r"; printf '%s' "$r" | field link_id
}
TAG=$(reg tag 'S5D-TG1' 'Underflow pump tag')
ES=$(reg equipment_specification 'S5D-ES1' 'Underflow pump datasheet')
DR=$(reg drawing 'S5D-DR1' 'Underflow general arrangement')
test -n "$TAG"; test -n "$ES"; test -n "$DR"
link "$TAG" "$ES" identifies 'The tag names the equipment this datasheet describes' >/dev/null
# 3 -> 5 SKIPS the vendor document. Legal, and a GAP the traversal refuses on.
link "$ES" "$DR" specifies 'The general arrangement is drawn from this datasheet' >/dev/null

# (a) THE REFUSAL. The thread is gapped, so the agent records a refusal with a
#     NULL count — never the reachable count.
R=$(rpc "$PLANNER" record_change_impact_report "{\"p_case_id\":\"$CASE\",\"p_object_id\":$TAG,\"p_narrative\":\"A reading taken over a thread that skips a chain position.\"}")
noerr "$R"
test "$(printf '%s' "$R" | field refused)" = "True"
test -z "$(printf '%s' "$R" | field downstreamCount)"
test "$(printf '%s' "$R" | field gapCount)" -ge "1"
RPT=$(printf '%s' "$R" | field report_id); test -n "$RPT"
test "$(psqlc "select downstream_count is null from change_impact_reports where id=$RPT")" = "t"
# The chain skip is NAMED among the gaps — with the missing revisions beside
# it, since neither object has been released either. The report stores the
# traversal's answer whole, so every gap it found is in the row.
test "$(psqlc "select count(*) from change_impact_reports r, jsonb_array_elements(r.impact->'gaps') g
                where r.id=$RPT and g->>'kind'='chain_skip'")" = "1"
test "$(psqlc "select count(*) from change_impact_reports r, jsonb_array_elements(r.impact->'gaps') g
                where r.id=$RPT and g->>'kind'='source_has_no_authoritative_version'")" = "1"

# (b) MODEL OUTPUT OVER A REFUSED TRAVERSAL IS DROPPED ENTIRELY — consequences
#     AND the narrative beside them. The consequence path was guarded from the
#     start and the prose was not: the edge function does not ask a model over a
#     refused walk, but the RPC took `p_narrative` and `p_model` unconditionally,
#     so a direct caller holding the ai_admin role this door admits could record
#     `refused = true` next to a paragraph describing the floor as the answer,
#     in a row that is immutable, org-readable and undeletable. Narrating a
#     refusal is how "0 downstream impacts" arrives by another route.
R=$(rpc "$PLANNER" record_change_impact_report "{\"p_case_id\":\"$CASE\",\"p_object_id\":$TAG,\"p_narrative\":\"Second reading, with a model consequence attached to a floor.\",\"p_model\":\"probe-model\",\"p_ai_consequences\":[{\"objectRef\":\"S5D-ES1\",\"consequence\":\"The datasheet would need re-issuing before the arrangement can be trusted.\"}]}")
noerr "$R"
test "$(jqp "$R" "len(x['aiConsequences'])")" = "0"
grep -q 'floor' <<<"$(jqp "$R" "' '.join(x['dropped'])")"
REFUSED_REPORT=$(printf '%s' "$R" | field report_id)
test "$(psqlc "select narrative is null and model is null from change_impact_reports where id=$REFUSED_REPORT")" = "t"
grep -q 'read as the answer the refusal declined to give' <<<"$(jqp "$R" "' '.join(x['dropped'])")"
# An over-long model label is refused rather than made permanent.
BIGMODEL=$(python3 -c "print('m'*250)")
R=$(rpc "$PLANNER" record_change_impact_report "{\"p_case_id\":\"$CASE\",\"p_object_id\":$TAG,\"p_model\":\"$BIGMODEL\"}")
expect_err "$R" 'longer than 200 characters'

# (c) A CLEAN CHAIN on the same case, so the SAME traversal answers rather than
#     refuses — two ADJACENT chain positions, both with a released revision.
ver(){ local r
  if [ -z "${3:-}" ]; then
    r=$(rpc "$PLANNER" record_thread_version "{\"p_object_id\":$1,\"p_version\":{\"version_label\":\"$2\"}}")
  else
    r=$(rpc "$PLANNER" record_thread_version "{\"p_object_id\":$1,\"p_version\":{\"version_label\":\"$2\",\"change_summary\":\"$3\"}}")
  fi
  noerr "$r"; printf '%s' "$r" | field version_id; }
DR2=$(reg drawing 'S5D-DR2' 'Sampler general arrangement')
PO2=$(reg procurement_item 'S5D-PO2' 'Sampler purchase line')
test -n "$DR2"; test -n "$PO2"
link "$DR2" "$PO2" procures 'The purchase line was raised against this arrangement' >/dev/null
V1=$(ver "$DR2" 'Rev A'); V2=$(ver "$PO2" 'Rev 1')
R=$(rpc "$MANAGER" declare_thread_version_authoritative "{\"p_version_id\":$V1,\"p_basis\":\"Issued for construction after the sampler review\"}"); noerr "$R"
R=$(rpc "$MANAGER" declare_thread_version_authoritative "{\"p_version_id\":$V2,\"p_basis\":\"Purchase line raised against the issued arrangement\"}"); noerr "$R"

R=$(rpc "$PLANNER" get_case_thread_impact "{\"p_case_id\":\"$CASE\",\"p_object_id\":$DR2}")
noerr "$R"; test "$(printf '%s' "$R" | field refused)" = "False"
test "$(printf '%s' "$R" | field downstreamCount)" = "1"

# (d) THE AGENT'S REPORT OVER THE CLEAN WALK. Two model consequences: one
#     naming an object the walk reached, one naming an object it never did.
#     The second is DROPPED and REPORTED, never matched to the nearest.
R=$(rpc "$PLANNER" record_change_impact_report "{\"p_case_id\":\"$CASE\",\"p_object_id\":$DR2,\"p_narrative\":\"A reading over a clean walk.\",\"p_model\":\"probe-model\",\"p_ai_consequences\":[{\"objectRef\":\"S5D-PO2\",\"consequence\":\"The purchase line needs re-issuing against the revised arrangement before fabrication.\",\"source\":\"deterministic\",\"severity\":\"blocking\"},{\"objectRef\":\"S5D-DR1\",\"consequence\":\"This drawing is not downstream of the sampler arrangement at all.\"}]}")
noerr "$R"
test "$(printf '%s' "$R" | field refused)" = "False"
test "$(printf '%s' "$R" | field downstreamCount)" = "1"
test "$(jqp "$R" "len(x['aiConsequences'])")" = "1"
# SQL LITERALS: the payload said 'deterministic' and 'blocking'; the row says
# neither. A model does not label its own output deterministic, and does not
# mark its own guess blocking.
test "$(jqp "$R" "x['aiConsequences'][0]['source']")" = "ai_suggestion"
test "$(jqp "$R" "x['aiConsequences'][0]['severity']")" = "attention"
grep -q 'S5D-DR1' <<<"$(jqp "$R" "' '.join(x['dropped'])")"
grep -q 'nearest reference' <<<"$(jqp "$R" "' '.join(x['dropped'])")"

# The count in the row came from the TRAVERSAL, not from the caller: there is
# no parameter that could carry one.
CLEAN=$(printf '%s' "$R" | field report_id)
test "$(psqlc "select downstream_count from change_impact_reports where id=$CLEAN")" = "1"
test "$(psqlc "select advisory from change_impact_reports where id=$CLEAN")" = "t"
# No column on this table can hold a disposition.
test "$(psqlc "select count(*) from information_schema.columns where table_name='change_impact_reports'
                and column_name in ('status','outcome','disposition','approval','acknowledged','decision')")" = "0"
# Immutable, undeletable, untruncatable.
OUT=$(sql_must_fail "update change_impact_reports set narrative='rewritten' where id=$CLEAN;")
grep -qi 'immutable' <<<"$OUT"
OUT=$(sql_must_fail "delete from change_impact_reports where id=$CLEAN;")
grep -qi 'not deleted' <<<"$OUT"
OUT=$(sql_must_fail "truncate change_impact_reports cascade;")
grep -qi 'not truncatable' <<<"$OUT"
OUT=$(sql_must_fail "insert into change_impact_reports (organization_id, development_case_id, thread_object_id, object_ref, object_kind, impact, refused, requested_by)
  values ('$ORG','$CASE',$DR2,'S5D-DR2','drawing','{}'::jsonb,false,'$PLANNER_ID');")
grep -q 'record_change_impact_report is the path' <<<"$OUT"

echo "── 8. the Change Impact Agent PROPOSES and can change nothing ───────────"

# It CAN record a reading — this is the act §60 describes and the only door in
# this slice that admits the identity.
R=$(rpc "$AIBOT" record_change_impact_report "{\"p_case_id\":\"$CASE\",\"p_object_id\":$DR2,\"p_narrative\":\"A reading recorded by the agent identity itself.\"}")
noerr "$R"
test "$(printf '%s' "$R" | field advisory)" = "True"

# ...and it can do NOTHING else. Five refusals, by name.
R=$(rpc "$AIBOT" declare_thread_version_authoritative "{\"p_version_id\":$V1,\"p_basis\":\"A machine declaring the revision to build from\"}")
expect_err "$R" 'spec §70'
R=$(rpc "$AIBOT" sever_thread_link "{\"p_link_id\":1,\"p_reason\":\"A machine cutting the digital thread on its own reading\"}")
expect_err "$R" 'spec §70'
R=$(rpc "$AIBOT" retire_thread_object "{\"p_object_id\":$PO2,\"p_reason\":\"A machine retiring the object it has just reported on\"}")
expect_err "$R" 'spec §70'
# A receipt to try to acknowledge: supersede the released revision.
V3=$(ver "$DR2" 'Rev B' 'Nozzle relocated 400mm and the platform cut back to suit.')
R=$(rpc "$MANAGER" declare_thread_version_authoritative "{\"p_version_id\":$V3,\"p_basis\":\"Revised after the sampler nozzle moved\"}")
noerr "$R"
RCPT=$(psqlc "select id from thread_change_receipts where development_case_id='$CASE' and status='unacknowledged' order by id desc limit 1")
test -n "$RCPT"
R=$(rpc "$AIBOT" acknowledge_thread_receipt "{\"p_receipt_id\":$RCPT,\"p_disposition\":\"acknowledged\",\"p_note\":\"A machine confirming the downstream package received the change.\"}")
expect_err "$R" 'spec §70'
DEL_ANY=$(psqlc "select id from develop_event_deliveries where development_case_id='$CASE' limit 1")
R=$(rpc "$AIBOT" answer_develop_event_consequence "{\"p_delivery_id\":$DEL_ANY,\"p_note\":\"A machine clearing the gate blocker its own reading produced.\"}")
expect_err "$R" 'spec §70'

echo "── 9. the RAM kernel scoped to a case (D12.13) ──────────────────────────"

# (a) NO ASSET SET. The first refusal, by name.
R=$(rpc "$PLANNER" get_case_ram_scope "{\"p_case_id\":\"$QUIET\"}")
noerr "$R"
test "$(printf '%s' "$R" | field refused)" = "True"
grep -qi 'No asset is bound' <<<"$(printf '%s' "$R" | field refusal)"

# (b) NO CAPITAL PROJECT. Bind an asset to the quiet case and the refusal moves
#     on to the next missing input rather than producing a figure.
psqlc "insert into development_case_assets (organization_id, development_case_id, asset_id)
       values ('$ORG','$QUIET','$A2');" >/dev/null
R=$(rpc "$PLANNER" get_case_ram_scope "{\"p_case_id\":\"$QUIET\"}")
test "$(printf '%s' "$R" | field refused)" = "True"
grep -qi 'references no capital project' <<<"$(printf '%s' "$R" | field refusal)"

# (c) NO RECORDED TARGET. The bus case has assets and a project and still
#     refuses, because "the target is 98%" with no recorded target is the
#     sentence this product exists to refuse.
R=$(rpc "$PLANNER" get_case_ram_scope "{\"p_case_id\":\"$CASE\"}")
test "$(printf '%s' "$R" | field refused)" = "True"
grep -qi 'No availability target is recorded' <<<"$(printf '%s' "$R" | field refusal)"

# A REFUSED scope still records a run — a refusal with no lineage is a refusal
# nobody can later prove happened.
R=$(rpc "$PLANNER" record_ram_agent_report "{\"p_case_id\":\"$CASE\",\"p_kernel_version\":\"develop-ram/5D/2026-12-07\"}")
noerr "$R"
test "$(printf '%s' "$R" | field refused)" = "True"
RUN=$(printf '%s' "$R" | field run_id); test -n "$RUN"
test "$(psqlc "select status from calculation_runs where id='$RUN'")" = "refused"
test "$(psqlc "select outputs is null from calculation_runs where id='$RUN'")" = "t"
test "$(psqlc "select jsonb_array_length(refusals) > 0 from calculation_runs where id='$RUN'")" = "t"

# (d) THE INPUTS, once they are all there.
TGT=$(psqlc "with r as (insert into ram_targets (organization_id, project_id, system_label, target_availability, target_basis, configuration)
  values ('$ORG',$PROJ,'S5D underflow train',0.96,'Vendor guarantee plus fleet history','series') returning id) select id from r")
test -n "$TGT"
psqlc "insert into ram_allocations (organization_id, target_id, subsystem_label, demonstrated_availability, evidence, complexity_weight)
       values ('$ORG',$TGT,'Pump',0.99,'Fleet history, 14 units',2),
              ('$ORG',$TGT,'Motor',null,'No demonstrated figure recorded',1);" >/dev/null
psqlc "insert into component_life_events (organization_id, asset_id, unit_number, component, hours_at_change_out, event_date, event_kind, source_file)
       values ('$ORG','$A1','S5D-U1','impeller',900,current_date-400,'failure','S5D fixture'),
              ('$ORG','$A1','S5D-U1','impeller',1400,current_date-300,'failure','S5D fixture'),
              ('$ORG','$A1','S5D-U1','impeller',2100,current_date-200,'failure','S5D fixture'),
              ('$ORG','$A1','S5D-U1','impeller',2600,current_date-100,'failure','S5D fixture'),
              ('$ORG','$A1','S5D-U1','impeller',3300,current_date-10,'scheduled','S5D fixture');" >/dev/null

R=$(rpc "$PLANNER" get_case_ram_scope "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(printf '%s' "$R" | field refused)" = "False"
test "$(printf '%s' "$R" | field assetCount)" = "1"
test "$(printf '%s' "$R" | field targetCount)" = "1"
test "$(jqp "$R" "len(x['assets'][0]['failureTimes'])")" = "4"
test "$(jqp "$R" "len(x['assets'][0]['suspensionTimes'])")" = "1"
# THE ABSENT RBD IS A REFUSAL, not an omission (5D-R13).
grep -qi 'RBD' <<<"$(jqp "$R" "' '.join(x['refusals'])")"
grep -qi 'invented model' <<<"$(jqp "$R" "' '.join(x['refusals'])")"
# The read COMPUTES NOTHING: no fitted parameter appears in it.
if grep -qi '"beta"' <<<"$R"; then echo "the scope read produced a fitted parameter"; exit 1; fi

# (e) A WRONG KERNEL VERSION IS REFUSED BY NAME. A lineage row whose kernel
#     identity the caller chooses certifies nothing.
R=$(rpc "$PLANNER" record_ram_agent_report "{\"p_case_id\":\"$CASE\",\"p_kernel_version\":\"develop-ram/9Z/2099-01-01\"}")
expect_err "$R" 'the server pins'

# (f) THE PROFILE MUST TIE TO THE SERVER'S OWN SCOPE (ruling 5D-R21).
#
# 5D-R14 re-read the INPUTS and merged the REFUSALS and refused a kernel
# version the server does not pin — and none of that constrained the NUMBERS.
# `p_profile` went into ram_agent_reports.profile AND into
# record_calculation_run's `outputs` verbatim, stamped
# code_version = sync_ram_kernel_version() under a method string reading "from
# the shipped reliability kernel". A caller holding any project role — the
# ai_admin identity this door admits included — could post a fabricated
# availability against an asset tag that does not exist and a target id that
# was never allocated, and the immutable lineage row certified it. That is the
# D11.29 failure this row exists to close, arriving by the one route nothing
# checked. Three refusals, each proven live.
R=$(rpc "$PLANNER" record_ram_agent_report "{\"p_case_id\":\"$CASE\",\"p_kernel_version\":\"develop-ram/5D/2026-12-07\",\"p_profile\":{\"targets\":[{\"targetId\":999999,\"systemLabel\":\"A system that was never allocated\",\"allocation\":{\"feasible\":true,\"achievable\":0.9999}}],\"assets\":[{\"assetId\":\"$A1\"}]},\"p_refusals\":[]}")
expect_err "$R" 'not a target on this case'
R=$(rpc "$PLANNER" record_ram_agent_report "{\"p_case_id\":\"$CASE\",\"p_kernel_version\":\"develop-ram/5D/2026-12-07\",\"p_profile\":{\"targets\":[{\"targetId\":$TGT}],\"assets\":[{\"assetId\":\"$A2\",\"assetTag\":\"NEVER-IN-SCOPE\"}]},\"p_refusals\":[]}")
expect_err "$R" 'not bound to this development case'
# A profile over PART of the population, recorded under the whole population's
# scope and the server's kernel version, reads as a reading of the whole — so
# it is refused rather than trimmed. (This is the shape the first draft of this
# very transcript posted and asserted as a success.)
R=$(rpc "$PLANNER" record_ram_agent_report "{\"p_case_id\":\"$CASE\",\"p_kernel_version\":\"develop-ram/5D/2026-12-07\",\"p_profile\":{\"kernelVersion\":\"develop-ram/5D/2026-12-07\",\"targets\":[],\"assets\":[]},\"p_refusals\":[]}")
expect_err "$R" 'refused rather than trimmed'
# An over-long model label is refused rather than made permanent in an
# immutable, org-readable, undeletable row.
BIGMODEL=$(python3 -c "print('m'*250)")
R=$(rpc "$PLANNER" record_ram_agent_report "{\"p_case_id\":\"$CASE\",\"p_kernel_version\":\"develop-ram/5D/2026-12-07\",\"p_model\":\"$BIGMODEL\"}")
expect_err "$R" 'longer than 200 characters'

# (g) THE RUN, with a profile that DOES tie to the scope, and the server's
#     refusals merged OVER the caller's — a client cannot record a clean
#     profile over a scope short of inputs.
R=$(rpc "$PLANNER" record_ram_agent_report "{\"p_case_id\":\"$CASE\",\"p_kernel_version\":\"develop-ram/5D/2026-12-07\",\"p_profile\":{\"kernelVersion\":\"develop-ram/5D/2026-12-07\",\"targets\":[{\"targetId\":$TGT,\"systemLabel\":\"S5D underflow train\"}],\"assets\":[{\"assetId\":\"$A1\",\"assetTag\":\"S5D-A1\"}]},\"p_refusals\":[]}")
noerr "$R"
test "$(printf '%s' "$R" | field refused)" = "False"
test "$(printf '%s' "$R" | field refusalCount)" -ge "1"
RUN=$(printf '%s' "$R" | field run_id)
test "$(psqlc "select status from calculation_runs where id='$RUN'")" = "computed_with_refusals"
test "$(psqlc "select code_version from calculation_runs where id='$RUN'")" = "develop-ram/5D/2026-12-07"
test "$(psqlc "select calculation_key from calculation_runs where id='$RUN'")" = "case_ram_profile"
# The kernel version on the row is the SERVER's, never the caller's.
test "$(psqlc "select kernel_version from ram_agent_reports order by id desc limit 1")" = "$(psqlc "select sync_ram_kernel_version()")"
# The report is advisory, immutable and holds no target.
test "$(psqlc "select count(*) from information_schema.columns where table_name='ram_agent_reports'
                and column_name in ('target','target_availability','accepted','approval','decision')")" = "0"
OUT=$(sql_must_fail "update ram_agent_reports set narrative='rewritten' where id=(select max(id) from ram_agent_reports);")
grep -qi 'immutable' <<<"$OUT"
OUT=$(sql_must_fail "truncate ram_agent_reports cascade;")
grep -qi 'not truncatable' <<<"$OUT"

echo "── 10. §34's nineteen edges, and the absence claim CHECKED (D11.21) ─────"

test "$(psqlc "select jsonb_array_length(sync_spec34_edges())")" = "19"
# THREE since 2026-09-03. This file's own audit said what to do when an
# endpoint gets built — "`newlyClosableCount` above zero means the endpoint got
# built and the ledger's prose is stale" — and Slice 7A (20261210090100) is
# that happening: §27's WorkPackage and §28's Constraint both exist and
# `restoration_constraints.work_order_id`, the column THIS audit named as the
# closing condition, is there. The edge moved out of `absent` and out of the
# audit's list, so the count goes down and `newlyClosableCount` returns to zero
# rather than alarming forever.
test "$(psqlc "select count(*) from jsonb_array_elements(sync_spec34_edges()) x where x->>'status'='absent'")" = "3"
test "$(psqlc "select (sync_spec34_absent_edge_audit()->>'absentEdgeCount')")" = "3"
# ZERO newly closable: every REMAINING absence claim still holds against the
# catalogue.
test "$(psqlc "select (sync_spec34_absent_edge_audit()->>'newlyClosableCount')")" = "0"
# THE TWO THAT CLOSED. 5C recorded both as absent from prose nothing checked.
test "$(psqlc "select x->>'status' from jsonb_array_elements(sync_spec34_edges()) x where x->>'edge'='Benefit MEASURES Objective'")" = "live_elsewhere"
test "$(psqlc "select x->>'home' from jsonb_array_elements(sync_spec34_edges()) x where x->>'edge'='Benefit MEASURES Objective'" | grep -c 'value_metrics.objective_id')" = "1"
test "$(psqlc "select x->>'status' from jsonb_array_elements(sync_spec34_edges()) x where x->>'edge'='WorkPackage DEPENDS_ON Constraint'")" = "live_elsewhere"
test "$(psqlc "select x->>'home' from jsonb_array_elements(sync_spec34_edges()) x where x->>'edge'='WorkPackage DEPENDS_ON Constraint'" | grep -c 'restoration_constraints.work_package_id')" = "1"
# ...and the columns they name really are there, which is what made them closable.
test "$(psqlc "select count(*) from information_schema.columns where table_schema='public' and table_name='value_metrics' and column_name='objective_id'")" = "1"
test "$(psqlc "select count(*) from information_schema.columns where table_schema='public' and table_name='restoration_constraints' and column_name='work_order_id'")" = "1"
# The three that did not close each name the column that would close them.
test "$(psqlc "select count(*) from jsonb_array_elements(sync_spec34_absent_edge_audit()->'edges') x where x->>'closesWhen' is not null")" = "3"

echo "── 11. the Sync Information module, composed (D11.09) ───────────────────"

R=$(rpc "$PLANNER" get_case_information_engine "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
# NO COMPOSITE SCORE. Averaging the legs that exist over the one that does not
# is how a partial module reads as a finished one.
test "$(printf '%s' "$R" | field complete)" = "False"
test "$(jqp "$R" "x['legs']['digitalThread']['built']")" = "True"
test "$(jqp "$R" "x['legs']['documentation']['built']")" = "True"
test "$(jqp "$R" "x['legs']['assetDataReadiness']['built']")" = "False"
grep -q 'D11.08' <<<"$(jqp "$R" "' '.join(x['legs']['assetDataReadiness']['registerRows'])")"
grep -qi 'ASSET-DATA READINESS IS NOT COMPUTED' <<<"$(jqp "$R" "' '.join(x['refusals'])")"
test "$(jqp "$R" "x['graph']['absentEdgeCount']")" = "3"
if grep -qi '"score"' <<<"$R"; then echo "the composed module produced a score"; exit 1; fi
# THE SENTENCE COUNTS WITH A VARIABLE, NOT A SPELLED NUMBER. The first draft
# of this refusal was parameterised on the count and then hard-coded "The five
# are named" beside it, so the shipped payload read "4 of ... The five are
# named" — a self-contradiction on screen, in the very file whose thesis is
# that unchecked prose survives a slice. The absent count is asserted above;
# this asserts the sentence cannot drift from it again.
ENG_REF=$(jqp "$R" "' '.join(x['refusals'])")
grep -q '3 of spec' <<<"$ENG_REF"
if grep -qi 'the five are named' <<<"$ENG_REF"; then
  echo "the engine refusal states a count in prose that its own variable contradicts"; exit 1
fi

echo "── 12. cross-tenant: the foreign member sees none of it ─────────────────"

FOREIGN=$(token 'smoke5d-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGN"
R=$(rpc "$FOREIGN" get_case_develop_events "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'not found'
R=$(rpc "$FOREIGN" get_case_ram_scope "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'not found'
R=$(rpc "$FOREIGN" get_change_impact_reports "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'not found'
R=$(rpc "$FOREIGN" get_case_information_engine "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'not found'
R=$(rpc "$FOREIGN" answer_develop_event_consequence "{\"p_delivery_id\":$DEL_ANY,\"p_note\":\"A member of another tenant answering this organization's gate blocker.\"}")
expect_err "$R" 'not found'
test "$(psqlc "select count(*) from develop_events where organization_id='$ORG2'")" = "0"

# case_event_consequence_obligations is asserted cross-tenant in STEP 14, not
# here: by this point every blocking consequence on $CASE has been answered, so
# an empty list for the foreign member would prove nothing. Step 14's case
# carries a live, unanswered blocking consequence and the assertion is made
# against that.

echo "── 13. the bus ledger has ONE door, and service_role is not it ──────────"

# THE DEFECT: Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on every new
# function to anon, authenticated AND service_role, so revoking three of four
# left emit_develop_event open to every edge function in this repository — all
# of which hold the service key. And emit_develop_event is the ONLY way a
# non-superuser can put a row in develop_events, because the append-only guard
# demands a GUC only this function sets. One POST manufactured a permanent,
# undeletable, gate-blocking consequence naming a commissioning test that does
# not exist; a second, with a mismatched org/case pair, produced a row a
# FOREIGN tenant then read AND answered. Both proven live.
# The REFUSAL is asserted, not just a status code: PostgREST answers a revoked
# function with 403 and Postgres's own `permission denied for function <name>`,
# and it is the named refusal that proves the grant is gone rather than the
# request merely having failed.
svc_rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$1" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' -d "$2"; }
FORGE_BODY="{\"p_org\":\"$ORG\",\"p_case_id\":\"$CASE\",\"p_event_name\":\"CommissioningTestFailed\",\"p_source_ref\":\"S5D-FORGE\",\"p_subject_label\":\"a test that does not exist\",\"p_payload\":{},\"p_previous_state\":null,\"p_new_state\":null}"
R=$(svc_rpc emit_develop_event "$FORGE_BODY")
expect_err "$R" 'permission denied for function emit_develop_event'
R=$(svc_rpc dispatch_develop_event '{"p_event_id":1}')
expect_err "$R" 'permission denied for function dispatch_develop_event'
# The anon key is refused at the same door, and so is a signed-in planner.
R=$(rpc "$PLANNER" emit_develop_event "$FORGE_BODY")
expect_err "$R" 'permission denied for function emit_develop_event'
test "$(psqlc "select count(*) from develop_events where source_ref='S5D-FORGE'")" = "0"
# The grants themselves, asserted rather than assumed: no client role at all.
test "$(psqlc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public'
                  and p.proname in ('emit_develop_event','dispatch_develop_event','sync_develop_event_consequence')
                  and array_to_string(p.proacl,',') ~ '(anon|authenticated|service_role)='")" = "0"

# THE ORG AND THE CASE MUST AGREE, at the wall, for every writer including the
# emitter. Exercised as superuser with RLS off, which is the only caller left
# that can reach the emitter at all — a mismatched pair is a permanent gate
# blocker on one tenant that another tenant reads, answers and clears.
OUT=$(sql_must_fail "select emit_develop_event('$ORG2','$CASE','CommissioningTestFailed','S5D-XORG','cross-tenant forgery','{}'::jsonb,null,null);")
grep -qi 'does not belong to that organization' <<<"$OUT"
test "$(psqlc "select count(*) from develop_events where source_ref='S5D-XORG'")" = "0"

echo "── 14. the collapse never swallows an ESCALATION (5D-R19) ───────────────"

# THE DEFECT: with the collapse keyed on (case, dedupe_key, txid) alone, the
# FIRST crossing in a transaction took the key and every later one on the same
# indicator was discarded by `on conflict do nothing` — including a CRITICAL
# arriving after a WARNING. The indicator was critical, the bus said warning,
# the consequence was `attention`, no gate was blocked, and because the audit
# insert sits after the collapse, audit_events had no record of the critical
# either. Emitted in separate transactions it worked, which is why the
# transcript's own multi-row batch (two ACTIVITIES, one case-scoped event)
# never reached it. The two payload/history-dependent rules are the ones at
# risk, so the class is now part of the key.
#
# Its OWN case and its OWN fixtures: every assertion in steps 3–6 is an
# absolute count on $CASE, and adding crossings there would have moved them.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S5D escalation case\",\"p_problem_statement\":\"A case kept apart from the main transcript so a batch containing an escalation can be emitted without moving any count the earlier steps assert.\",\"p_lifecycle_type\":\"brownfield\"}")
noerr "$R"; ESC=$(printf '%s' "$R" | field case_id); test -n "$ESC"
RISK2=$(psqlc "with r as (insert into risks (organization_id, title, development_case_id)
  values ('$ORG','S5D escalation risk','$ESC') returning id) select id from r")
IND2=$(psqlc "with r as (insert into risk_indicators (organization_id, risk_id, name, source_system)
  values ('$ORG','$RISK2','Discharge pressure','condition monitoring') returning id) select id from r")
test -n "$IND2"
psqlc "begin;
       insert into risk_indicator_observations (organization_id, indicator_id, value, state, observed_at)
         values ('$ORG','$IND2',1.0,'normal', now() - interval '3 hour');
       insert into risk_indicator_observations (organization_id, indicator_id, value, state, observed_at)
         values ('$ORG','$IND2',7.0,'warning', now() - interval '2 hour');
       insert into risk_indicator_observations (organization_id, indicator_id, value, state, observed_at)
         values ('$ORG','$IND2',11.0,'critical', now() - interval '1 hour');
       commit;" >/dev/null
# TWO events, not one: a warning and a critical are not the same obligation.
test "$(psqlc "select count(*) from develop_events where development_case_id='$ESC'")" = "2"
test "$(psqlc "select string_agg(consequence_class, ',' order by id) from develop_events
                where development_case_id='$ESC'")" = "attention,blocking"
# The delivery agrees with the class recorded on the event — ONE classifier.
test "$(psqlc "select count(*) from develop_events e join develop_event_deliveries d on d.event_id=e.id
                where e.development_case_id='$ESC' and d.consequence <> e.consequence_class")" = "0"
# The critical BLOCKS, and the audit ledger records BOTH crossings, so the bus
# is still never the only account of anything.
test "$(psqlc "select jsonb_array_length(case_event_consequence_obligations('$ESC'))")" = "1"
test "$(psqlc "select count(*) from audit_events where entity_type='develop_event'
                and event_data->>'case_id'='$ESC'")" = "2"
# AND THE COLLAPSE STILL COLLAPSES: a run of criticals in one transaction is
# one event, because the class is the same and so is the key.
psqlc "begin;
       insert into risk_indicator_observations (organization_id, indicator_id, value, state, observed_at)
         values ('$ORG','$IND2',12.0,'critical', now());
       insert into risk_indicator_observations (organization_id, indicator_id, value, state, observed_at)
         values ('$ORG','$IND2',13.0,'critical', now() + interval '1 minute');
       commit;" >/dev/null
test "$(psqlc "select count(*) from develop_events where development_case_id='$ESC'")" = "2"

# case_event_consequence_obligations, CROSS-TENANT — asserted here because this
# case has a live, unanswered BLOCKING consequence and $CASE no longer does.
#
# THE DEFECT: it is SECURITY DEFINER, granted to `authenticated`, takes a
# caller-supplied case uuid, and its entire `where` was
# `development_case_id = p_case_id`. A signed-in member of any tenant could
# read any other tenant's unanswered blocking obligations — the verbatim gate
# criterion text, the source table and row id, the timestamps — by uuid.
# Nothing caught it because every place this transcript exercised the predicate
# ran it through psql as `postgres`, where there is no session org to compare
# against, and definerTenancy's scan only reaches functions whose ARGUMENT LIST
# names an organization; this one takes (uuid, bigint).
#
# ASSIGNED FIRST, then compared — the idiom every other call in this file uses.
# `test "$(rpc ... "{\"a\":1,\"b\":2}")"` is not portable: bash 3.2 (what
# /usr/bin/env bash resolves to on macOS) loses the inner quoting inside a
# command substitution nested in double quotes, brace-expands the JSON body on
# its comma and hands curl two arguments. CI's bash 5 does not, so that shape
# would have passed there and failed on a developer's machine.
FOREIGN=$(token 'smoke5d-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGN"
test "$(psqlc "select jsonb_array_length(case_event_consequence_obligations('$ESC'))")" = "1"
R=$(rpc "$FOREIGN" case_event_consequence_obligations "{\"p_case_id\":\"$ESC\",\"p_gate_id\":null}")
test "$R" = "[]"
R=$(rpc "$FOREIGN" case_event_consequence_obligations "{\"p_case_id\":\"$ESC\",\"p_gate_id\":$GATE}")
test "$R" = "[]"
# The OWNER still sees it, and the trigger/service path (no auth.uid()) is
# still admitted — refusing that one would switch the persistence wall off for
# exactly the writers the wall exists to catch.
R=$(rpc "$MANAGER" case_event_consequence_obligations "{\"p_case_id\":\"$ESC\",\"p_gate_id\":null}")
test "$(jqp "$R" "len(x)")" = "1"

echo "── 15. every emitter covers the act, including the two that were missed ─"

# (i) RiskThresholdExceeded on UPDATE. risk_indicator_observations carries NO
#     append-only guard, so an observation EDITED into a higher state moves the
#     indicator — and this was the one emitter of the five that did not cover
#     UPDATE, on the one source table where the edit is not refused.
RISK3=$(psqlc "with r as (insert into risks (organization_id, title, development_case_id)
  values ('$ORG','S5D edited-observation risk','$ESC') returning id) select id from r")
IND3=$(psqlc "with r as (insert into risk_indicators (organization_id, risk_id, name, source_system)
  values ('$ORG','$RISK3','Seal temperature','condition monitoring') returning id) select id from r")
OBS3=$(psqlc "with r as (insert into risk_indicator_observations (organization_id, indicator_id, value, state, observed_at)
  values ('$ORG','$IND3',1.0,'normal', now()) returning id) select id from r")
test -n "$OBS3"
test "$(psqlc "select count(*) from develop_events where development_case_id='$ESC' and source_ref='$IND3'")" = "0"
psqlc "update risk_indicator_observations set state='critical', value=99 where id='$OBS3';" >/dev/null
test "$(psqlc "select count(*) from develop_events where development_case_id='$ESC' and source_ref='$IND3'")" = "1"
test "$(psqlc "select consequence_class from develop_events where development_case_id='$ESC' and source_ref='$IND3'")" = "blocking"
# A further edit that does not RAISE the state is not a second crossing.
psqlc "update risk_indicator_observations set value=100 where id='$OBS3';" >/dev/null
test "$(psqlc "select count(*) from develop_events where development_case_id='$ESC' and source_ref='$IND3'")" = "1"

# (ii) WorkPackageBlocked when the work order is BORN blocked and the asset is
#      attached afterwards. The "already blocked, do not re-emit" guard fired
#      on a row whose first pass emitted NOTHING because its scope was
#      unresolvable, so create-then-link — an ordinary sequence — missed one of
#      the five named events entirely, with nothing recording the miss.
ESC_A=$(psqlc "with r as (insert into assets (organization_id, asset_tag, name, criticality)
  values ('$ORG','S5D-A3','Escalation-case pump','high') returning id) select id from r")
psqlc "insert into development_case_assets (organization_id, development_case_id, asset_id)
       values ('$ORG','$ESC','$ESC_A');" >/dev/null
WOB=$(psqlc "with r as (insert into work_orders (organization_id, wo_number, title, status, work_type)
  values ('$ORG','S5D-WOB','S5D born-blocked package','blocked','corrective') returning id) select id from r")
test -n "$WOB"
test "$(psqlc "select count(*) from develop_events where development_case_id='$ESC' and event_name='WorkPackageBlocked'")" = "0"
psqlc "update work_orders set asset_id='$ESC_A' where id='$WOB';" >/dev/null
test "$(psqlc "select count(*) from develop_events where development_case_id='$ESC' and event_name='WorkPackageBlocked'")" = "1"
# A noise edit on the same still-blocked row is NOT a second event.
psqlc "update work_orders set priority='high' where id='$WOB';" >/dev/null
test "$(psqlc "select count(*) from develop_events where development_case_id='$ESC' and event_name='WorkPackageBlocked'")" = "1"

# (iii) ScheduleUpdated on DELETE. Removing a scheduled activity restates every
#       forecast, float and P80 computed before it exactly as moving one does —
#       that is this rule's own obligation sentence — and the emitter did not
#       cover DELETE, so the act was dodgeable by deletion.
ESC_WBS=$(psqlc "with r as (insert into project_wbs_elements (organization_id, development_case_id, wbs_code, title, scope_description)
  values ('$ORG','$ESC','2.1','Escalation package','Scope recorded so a schedule activity on this case has a WBS element to hang from.') returning id) select id from r")
ESC_TSK=$(psqlc "with r as (insert into shutdown_tasks (event_id, task_key, label, duration_hours, wbs_element_id)
  values ('$SD','B1','Reinstate escalation package',6,'$ESC_WBS') returning id) select id from r")
test -n "$ESC_TSK"
test "$(psqlc "select count(*) from develop_events where development_case_id='$ESC' and event_name='ScheduleUpdated'")" = "1"
psqlc "delete from shutdown_tasks where id='$ESC_TSK';" >/dev/null
test "$(psqlc "select count(*) from develop_events where development_case_id='$ESC' and event_name='ScheduleUpdated'")" = "2"
grep -q 'REMOVED from the schedule' <<<"$(psqlc "select subject_label from develop_events
  where development_case_id='$ESC' and event_name='ScheduleUpdated' order by id desc limit 1")"

echo "── 16. the change-impact edge function's own door ───────────────────────"

# The AUTHENTICATED hop cannot be exercised on this CLI (2.75.0 signs user
# tokens with ES256 while its edge-runtime worker verifies with a symmetric
# secret, so any authenticated function call returns {"msg":"Invalid JWT"}
# whatever the code does; CI pins 2.84.2 and is unaffected). The UNAUTHENTICATED
# door is not affected by that and is asserted here rather than left unstated:
# this function is deliberately NOT in config/edge-function-boundary.json's
# allowedNoVerifyJwt, so a call with no bearer and a call with the anon key
# must both be refused before any of its code runs.
#
# A 404 here rather than a 401 is an ENVIRONMENT state, not a code fault: the
# local edge-runtime container bundles the functions directory at boot, so one
# started before this function existed does not know about it. `supabase stop
# && supabase start` remounts it. CI starts a fresh stack and never sees this.
FN_BODY="{\"caseId\":\"$CASE\",\"objectId\":1}"
FN_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/develop-change-impact-agent" \
  -H 'Content-Type: application/json' -d "$FN_BODY")
test "$FN_STATUS" = "401"
FN_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/develop-change-impact-agent" \
  -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' -d "$FN_BODY")
test "$FN_STATUS" = "401"

echo
echo "Develop slice-5D smoke PASSED — five named events emitted by their acts and"
echo "consumed, the consumer's blocking consequences stopping a gate review at the"
echo "wall, the Change Impact Agent refusing over a gapped thread on 5C's ONE"
echo "traversal, the RAM kernel scoped to a case with every missing input named,"
echo "two of §34's five absent edges honestly closed — each at the column the audit"
echo "itself named — and the three that remain named, not merely counted."

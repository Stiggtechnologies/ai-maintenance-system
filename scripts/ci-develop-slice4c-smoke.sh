#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 4C — Schedule assurance: the nine II.6 defect classes,
# the §50 Schedule Quality Score, the distinct Schedule Confidence Score, the
# risk→schedule→economics chain, and the SEEDED Monte Carlo that refuses to
# run on a schedule failing its diagnostics. Every step is a live transcript
# against a real local database.
#
# THE THING THIS TRANSCRIPT EXISTS TO PROVE: a P50/P80 may only exist when a
# real simulation with real inputs produced it. So the percentiles are watched
# NOT existing — through an empty schedule, a sparse one, a failing gate, a
# schedule where nothing varies, a stale run — and then existing exactly once,
# after a kernel run over pinned inputs at a recorded seed.
#
# The simulation itself is the PRODUCT's kernel: step 6 shells out to
# scripts/develop-slice4c-simulate.ts, which runs src/lib/modelling/
# integrated-risk.ts against the live get_case_simulation_inputs payload. A
# hand-written result would have proved the door and nothing about the
# simulation the product runs.
#
# Steps:
#   1  the empty and sparse schedule (D5.31): a schedule with no activities is
#      REFUSED, not scored 100; a three-activity schedule is refused against
#      the published floor; the individual classes still report.
#   2  the nine defect classes (D5.13): each fires on data authored to trip
#      it; classes the imported data cannot answer report NOT DIAGNOSABLE with
#      the reason, and never "pass".
#   3  P6 imports its OWN float, constraints and lags (D5.13/D5.28): the new
#      fields ride the one governed door with named refusals, join the P6
#      field wall on INSERT/UPDATE/DELETE, and unlock the two classes that
#      need a computed network without Sync recomputing one.
#   4  §50 and the Schedule Confidence Score (D5.31/D5.14): published weights,
#      coverage stated, confidence refused whenever the score is.
#   5  the risk→schedule→economics chain (D5.08): a single-point impact
#      refused, an unbounded likelihood NOT read as a probability, an unbound
#      risk refused, §70 refuses the AI identity, and the days→money hop
#      refused BY NAME until a cost of delay exists.
#   6  the gate (D5.15): the simulation is REFUSED by name on a failing
#      schedule and the refusal is RECORDED as a run; then permitted, run by
#      the real kernel, and recorded with its seed.
#   7  reproducibility: the same seed over the same inputs reproduces the
#      percentiles exactly; a different seed does not.
#   8  the door's own refusals: a mismatched digest, too few iterations, a
#      sample shorter than the run, crossed percentiles, a zero-width
#      "distribution", an attributed risk that is not an edge.
#   8b the door checks CONTENT, not only shape (repair 20261202090300): a
#      fabricated cost base, a fabricated cost-of-delay rate, a deterministic
#      anchor that is not a path through this network, an out-of-range
#      probability, an attribution row whose numbers the run could not have
#      produced, and a criticality row naming an activity that does not exist
#      are each refused BY NAME.
#   8c the LEDGER refuses what the door refuses: a service key cannot mint an
#      AI-attributed, un-lineaged distribution over a schedule with nothing to
#      sample.
#   8d the logic ledger has the wall the activity ledger has: deleting a
#      relationship cannot clear an open-ends finding by typing.
#   9a the COST percentiles on a case that HAS a deterministic base — the
#      produce arm, which had no coverage anywhere: every recorded run in the
#      database had a null cost base. The total is asserted to equal the EAC
#      plus the simulated exposure to the penny, the client's own base is
#      refused, and moving the base makes the TOTAL stale while the schedule
#      half stays current.
#   9  §51 with the percentiles (D5.07/D5.32): P50/P80 appear beside the
#      deterministic figures, carry their confidence and their lineage, and go
#      back to ABSENT the moment the schedule moves under them.
#   9b a RE-DATED schedule is stale: the planned dates are the anchor of the
#      published P50/P80 dates and are inside the digest.
#   9c a schedule that DEGRADES after a run was recorded stops serving it —
#      the §50 gate is checked where the number is SERVED, not only where it
#      is recorded.
#   9d a schedule whose logic the kernel cannot read (non-FS links, lags)
#      REFUSES rather than simulating over a different network.
#   9e a CLOSED risk leaves the forecast, and its departure is NAMED.
#  10  per-risk attribution (D5.09): ranked out of the simulation, naming the
#      risks the register left outside it.
#  11  lineage (D11.29): every 4C calculation records a run including its seed
#      and its refusals; runs and simulations are immutable; TRUNCATE refused
#      on both new ledgers.
#  12  tenancy: every client-callable 4C read and act probed as a REAL
#      provisioned FOREIGN TENANT (4A/4B's block, which an earlier draft of
#      this file computed and then never used) and as an ORPHAN JWT holder.
#
# Run: supabase start && scripts/ci-develop-slice4c-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-4c smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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
# A MALFORMED REQUEST IS NOT A SUCCESS. PostgREST answers a bad body with
# {"code":"PGRST1xx","message":...} and NO `error` key, so a step whose JSON
# was mangled by shell quoting did nothing at all and still read as green.
if isinstance(x,dict) and str(x.get('code','')).startswith('PGRST'):
    print('request refused by PostgREST:',x); sys.exit(1)
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
# `psql -tAc` prints the COMMAND TAG ("INSERT 0 1") on stdout after a RETURNING
# row, so a bare psqlc capture of an insert yields two lines and every JSON body
# built from it is malformed. This is the one to use for a returning write.
psqlv(){ psqlc "$1" | head -1; }
jqp(){ BODY="$1" EXPR="$2" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
print(eval(os.environ['EXPR'], {'x': x, 'json': json}))
PY
}
# One defect class out of the quality payload: severity, count or reason.
cls(){ BODY="$1" KEY="$2" WHAT="$3" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
row=[c for c in x['classes'] if c['key']==os.environ['KEY']][0]
v=row[os.environ['WHAT']]
print('' if v is None else v)
PY
}

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$TECH"

MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
test -n "$MANAGER_ID"; test -n "$PLANNER_ID"

# The AI-operator identity, seeded exactly as the 3B/3C/3D/4A/4B transcripts
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

# Idempotent re-run. The 4C ledgers refuse client deletes by design, so the
# service path is used and the triggers audit it — which is the posture, not a
# workaround.
CLEAN="select id from development_cases where title like 'SMOKE4C %'"
psqlc "delete from schedule_simulation_runs where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from risk_schedule_impacts where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from calculation_runs where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from risks where organization_id='$ORG' and title like 'SMOKE4C %';" >/dev/null
psqlc "delete from shutdown_task_dependencies where event_id in (select id from shutdown_events where organization_id='$ORG' and development_case_id in ($CLEAN));" >/dev/null
psqlc "delete from shutdown_tasks where event_id in (select id from shutdown_events where organization_id='$ORG' and development_case_id in ($CLEAN));" >/dev/null
psqlc "delete from shutdown_events where organization_id='$ORG' and development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_progress_claims where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_progress_periods where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_rules_of_credit where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_cost_items where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from development_cases where title like 'SMOKE4C %';" >/dev/null
psqlc "delete from business_cases where case_ref like 'SMOKE4C%';" >/dev/null
psqlc "delete from financial_assumptions where organization_id='$ORG' and assumption_key like 'develop.case.%delay_cost_per_day';" >/dev/null
psqlc "delete from connectors where organization_id='$ORG' and name='SMOKE4C P6 export';" >/dev/null
psqlc "delete from ingest_watermarks where organization_id='$ORG' and entity_type='schedule_activity' and connector_id in (select id from connectors where organization_id='$ORG' and connector_key='manual-upload-schedule_activity');" >/dev/null

BODY=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE4C schedule case","p_problem_statement":"The contractor issues a completion date every month and nothing in the system can say how much confidence that date deserves.","p_lifecycle_type":"reliability_improvement"}')
noerr "$BODY"; CASE=$(printf '%s' "$BODY" | field case_id); test -n "$CASE"

echo "── 1. an empty schedule is REFUSED, never scored 100 (D5.31) ────────────"

BODY=$(rpc "$PLANNER" get_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['score'] is None")" = "True"
test "$(jqp "$BODY" "x['confidence'] is None")" = "True"
grep -qi 'no schedule activities at all' <<<"$(printf '%s' "$BODY" | field scoreRefusal)"
grep -qi 'empty schedule passes every defect test' <<<"$(printf '%s' "$BODY" | field scoreRefusal)"
# ...and the gate is CLOSED, so nothing can be simulated over nothing.
test "$(jqp "$BODY" "x['gate']['permitted']")" = "False"
echo "   an empty schedule scores nothing and gates nothing — the refusal names why"

# Three activities and one relationship: below the published floor.
# Windows are staggered and each is LONGER than its own duration: a window
# equal to its duration across more than a week is the 24x7-calendar finding,
# and five activities sharing one window is the concurrency finding. Both are
# exercised deliberately below, on data written to trip them.
for A in "S4C-A10:Mobilise site:400:320:560:2027-01-04T06:00:00Z:2027-02-01T06:00:00Z" \
         "S4C-A20:Fabricate skid:600:480:960:2027-02-01T06:00:00Z:2027-03-15T06:00:00Z" \
         "S4C-A3:Install skid:300:240:480:2027-03-15T06:00:00Z:2027-04-10T06:00:00Z"; do
  IFS=: read -r K L D O P S1 S2 S3 F1 F2 F3 <<<"$A"
  ST="$S1:$S2:$S3"; FI="$F1:$F2:$F3"
  BODY=$(rpc "$PLANNER" record_local_schedule_activity "{\"p_case_id\":\"$CASE\",\"p_activity\":{\"activity_id\":\"$K\",\"description\":\"$L\",\"duration_hours\":\"$D\",\"planned_start\":\"$ST\",\"planned_finish\":\"$FI\"}}")
  noerr "$BODY"
  # THE RANGE IS THE DISTRIBUTION, SO IT GOES THROUGH A DOOR. This used to be
  # a raw superuser UPDATE, which meant the only P50/P80 this transcript ever
  # proved came off ranges no product path could write and no human had signed.
  BODY=$(rpc "$PLANNER" set_schedule_activity_duration_range "{\"p_case_id\":\"$CASE\",\"p_range\":{\"activity_id\":\"$K\",\"optimistic_hours\":\"$O\",\"pessimistic_hours\":\"$P\",\"basis\":\"Planner three-point estimate from the last two comparable turnarounds on this unit\"}}")
  noerr "$BODY"
done
BODY=$(rpc "$PLANNER" record_local_schedule_relationship "{\"p_case_id\":\"$CASE\",\"p_relationship\":{\"activity_id\":\"S4C-A20\",\"predecessor\":\"S4C-A10\",\"link_type\":\"FS\",\"lag_hours\":\"0\"}}")
noerr "$BODY"

BODY=$(rpc "$PLANNER" get_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['score'] is None")" = "True"
grep -qi 'is not configurable' <<<"$(printf '%s' "$BODY" | field scoreRefusal)"
# The individual classes still report — the SCORE is what is refused.
test "$(jqp "$BODY" "len(x['classes'])")" = "9"
echo "   below the published floor the score is refused and the classes still report"

echo "── 2. the nine II.6 defect classes (D5.13) ──────────────────────────────"

# Finish the network: A30 after A20, plus a parallel branch and a commission
# activity, so the schedule is a real network with a start and a finish.
BODY=$(rpc "$PLANNER" record_local_schedule_relationship "{\"p_case_id\":\"$CASE\",\"p_relationship\":{\"activity_id\":\"S4C-A3\",\"predecessor\":\"S4C-A20\",\"link_type\":\"FS\",\"lag_hours\":\"0\"}}")
noerr "$BODY"
for A in "S4C-A40:Cable and terminate:200:160:300:2027-02-01T06:00:00Z:2027-02-25T06:00:00Z" \
         "S4C-A50:Commission and hand over:160:120:280:2027-04-10T06:00:00Z:2027-04-25T06:00:00Z"; do
  IFS=: read -r K L D O P S1 S2 S3 F1 F2 F3 <<<"$A"
  ST="$S1:$S2:$S3"; FI="$F1:$F2:$F3"
  BODY=$(rpc "$PLANNER" record_local_schedule_activity "{\"p_case_id\":\"$CASE\",\"p_activity\":{\"activity_id\":\"$K\",\"description\":\"$L\",\"duration_hours\":\"$D\",\"planned_start\":\"$ST\",\"planned_finish\":\"$FI\"}}")
  noerr "$BODY"
  BODY=$(rpc "$PLANNER" set_schedule_activity_duration_range "{\"p_case_id\":\"$CASE\",\"p_range\":{\"activity_id\":\"$K\",\"optimistic_hours\":\"$O\",\"pessimistic_hours\":\"$P\",\"basis\":\"Planner three-point estimate from the last two comparable turnarounds on this unit\"}}")
  noerr "$BODY"
done
for R in "S4C-A40:S4C-A10" "S4C-A50:S4C-A3" "S4C-A50:S4C-A40"; do
  BODY=$(rpc "$PLANNER" record_local_schedule_relationship "{\"p_case_id\":\"$CASE\",\"p_relationship\":{\"activity_id\":\"${R%%:*}\",\"predecessor\":\"${R##*:}\",\"link_type\":\"FS\",\"lag_hours\":\"0\"}}")
  noerr "$BODY"
done

BODY=$(rpc "$PLANNER" get_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
# A clean five-activity network: no orphans, no open ends beyond the one start
# and the one finish, no hard constraints, no long durations.
test "$(cls "$BODY" missing_logic severity)" = "pass"
test "$(cls "$BODY" open_ends severity)" = "pass"
test "$(cls "$BODY" excessive_constraints severity)" = "pass"
test "$(cls "$BODY" long_durations severity)" = "pass"
# ...and the two classes that need a computed network are NOT DIAGNOSABLE on a
# Sync-authored schedule, because Sync does not recompute the network.
test "$(cls "$BODY" negative_float severity)" = "not_diagnosable"
test "$(cls "$BODY" broken_critical_path severity)" = "not_diagnosable"
grep -qi 're-export with total_float_hours' <<<"$(cls "$BODY" negative_float notDiagnosableReason)"
grep -qi 'second critical path' <<<"$(cls "$BODY" negative_float notDiagnosableReason)"
# ...and the RECORDED RUN says so too: a score computed over four components
# must be distinguishable in the ledger from one computed over six.
BODY=$(rpc "$PLANNER" compute_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
psqlc "select refusals::text from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_quality' order by computed_at desc limit 1" | grep -qi 'Re-export with total_float_hours'
# FIVE of §50's six: critical-path continuity is blind without P6's float.
# Constraints ARE diagnosable here because every activity is Sync-authored —
# Sync owns that column, so its absence is an absence rather than an unknown.
test "$(psqlc "select outputs->>'diagnosableComponents' from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_quality' order by computed_at desc limit 1")" = "5"
echo "   a class the data cannot answer says NOT DIAGNOSABLE and names why — it never says pass, and the run records the blind spot"

# MISSING LOGIC: an activity with neither a predecessor nor a successor.
BODY=$(rpc "$PLANNER" record_local_schedule_activity "{\"p_case_id\":\"$CASE\",\"p_activity\":{\"activity_id\":\"S4C-ORP\",\"description\":\"Owner decision workshop nobody linked\",\"duration_hours\":\"40\",\"planned_start\":\"2027-01-10T06:00:00Z\",\"planned_finish\":\"2027-01-12T06:00:00Z\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
test "$(cls "$BODY" missing_logic count)" = "1"
test "$(cls "$BODY" missing_logic severity)" = "fail"

# LONG DURATION: over the published 1056 elapsed hours (44 calendar days).
BODY=$(rpc "$PLANNER" record_local_schedule_activity "{\"p_case_id\":\"$CASE\",\"p_activity\":{\"activity_id\":\"S4C-LONG\",\"description\":\"Detailed engineering, summarised into one bar\",\"duration_hours\":\"2000\",\"planned_start\":\"2027-01-04T06:00:00Z\",\"planned_finish\":\"2027-05-01T06:00:00Z\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
test "$(cls "$BODY" long_durations count)" = "1"

# UNREALISTIC CALENDAR: a duration that exceeds its own planned window is
# impossible under any calendar. The name of the calendar is not consulted.
BODY=$(rpc "$PLANNER" record_local_schedule_activity "{\"p_case_id\":\"$CASE\",\"p_activity\":{\"activity_id\":\"S4C-CAL\",\"description\":\"Ten days of work inside a two-day window\",\"duration_hours\":\"240\",\"planned_start\":\"2027-02-01T06:00:00Z\",\"planned_finish\":\"2027-02-03T06:00:00Z\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "[c['count'] for c in x['classes'] if c['key']=='unrealistic_calendars'][0] >= 1")" = "True"

# UNREALISTIC LAG: negative lag pulls a successor back inside its predecessor.
BODY=$(rpc "$PLANNER" record_local_schedule_relationship "{\"p_case_id\":\"$CASE\",\"p_relationship\":{\"activity_id\":\"S4C-A3\",\"predecessor\":\"S4C-A10\",\"link_type\":\"FS\",\"lag_hours\":\"-200\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "[c['count'] for c in x['classes'] if c['key']=='unrealistic_lags'][0] >= 1")" = "True"
echo "   missing logic, long durations, calendar arithmetic and negative lag each fire on their own data"

# A non-finite lag is refused at the act, so a lag nobody can compare cannot
# sit behind a finding that is never true and never false.
BODY=$(rpc "$PLANNER" record_local_schedule_relationship "{\"p_case_id\":\"$CASE\",\"p_relationship\":{\"activity_id\":\"S4C-A50\",\"predecessor\":\"S4C-A10\",\"lag_hours\":\"NaN\"}}")
expect_err "$BODY" 'finite number of hours'

echo "── 3. P6 imports its OWN float, constraints and lags (D5.13, D5.28) ─────"

BODY=$(rpc "$PLANNER" begin_manual_import '{"p_entity_type":"schedule_activity","p_source_name":"SMOKE4C P6 export"}')
noerr "$BODY"; RUN=$(printf '%s' "$BODY" | field run_id); test -n "$RUN"

# A non-finite float is REFUSED: 'NaN' is a valid numeric in Postgres and
# sorts above every number, so a negative-float finding built on it could
# never be true or false.
BODY=$(rpc "$PLANNER" ingest_rows "{\"p_run_id\":\"$RUN\",\"p_rows\":[{\"activity_id\":\"S4C-P1\",\"external_id\":\"S4C-P1\",\"development_case_id\":\"$CASE\",\"description\":\"P6 activity with a NaN float\",\"original_duration_hours\":\"100\",\"planned_start\":\"2027-01-04T06:00:00Z\",\"planned_finish\":\"2027-01-09T06:00:00Z\",\"total_float_hours\":\"NaN\",\"schedule_name\":\"SMOKE4C P6\"}]}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field rejected)" = "1"
psqlc "select reject_reason from ingest_staging where run_id='$RUN' and status='rejected'" | grep -qi 'float must be a finite number of hours'

# A date constraint with no date constrains nothing and would be counted as
# one that does.
BODY=$(rpc "$PLANNER" ingest_rows "{\"p_run_id\":\"$RUN\",\"p_rows\":[{\"activity_id\":\"S4C-P2\",\"external_id\":\"S4C-P2\",\"development_case_id\":\"$CASE\",\"description\":\"P6 activity constrained to nothing\",\"original_duration_hours\":\"100\",\"planned_start\":\"2027-01-04T06:00:00Z\",\"planned_finish\":\"2027-01-09T06:00:00Z\",\"constraint_type\":\"mandatory_finish\",\"schedule_name\":\"SMOKE4C P6\"}]}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field rejected)" = "1"
psqlc "select reject_reason from ingest_staging where run_id='$RUN' and status='rejected' and external_id='S4C-P2'" | grep -qi 'constraint with no date constrains nothing'

# A relationship annotating a predecessor the row does not declare is a lag
# nobody applied.
BODY=$(rpc "$PLANNER" ingest_rows "{\"p_run_id\":\"$RUN\",\"p_rows\":[{\"activity_id\":\"S4C-P3\",\"external_id\":\"S4C-P3\",\"development_case_id\":\"$CASE\",\"description\":\"P6 activity with an unmatched relationship\",\"original_duration_hours\":\"100\",\"planned_start\":\"2027-01-04T06:00:00Z\",\"planned_finish\":\"2027-01-09T06:00:00Z\",\"relationships\":[{\"predecessor\":\"SOMETHING-ELSE\",\"link_type\":\"FS\",\"lag_hours\":\"8\"}],\"schedule_name\":\"SMOKE4C P6\"}]}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field rejected)" = "1"
psqlc "select reject_reason from ingest_staging where run_id='$RUN' and status='rejected' and external_id='S4C-P3'" | grep -qi 'a lag nobody applied'

# The good rows, carrying P6's own float and constraints. P1000 is critical
# (zero float), P1010 follows it and is critical too, P1020 has float, and
# P1030 is already LATE — negative float, which is a statement that the plan
# is arithmetically impossible as written.
ROWS="[{\"activity_id\":\"S4C-P1000\",\"external_id\":\"S4C-P1000\",\"development_case_id\":\"$CASE\",\"description\":\"Award compressor package\",\"original_duration_hours\":\"200\",\"planned_start\":\"2027-05-03T06:00:00Z\",\"planned_finish\":\"2027-05-20T06:00:00Z\",\"total_float_hours\":\"0\",\"calendar\":\"5x8\",\"schedule_name\":\"SMOKE4C P6\"},
{\"activity_id\":\"S4C-P1010\",\"external_id\":\"S4C-P1010\",\"development_case_id\":\"$CASE\",\"description\":\"Manufacture compressor\",\"original_duration_hours\":\"1000\",\"planned_start\":\"2027-05-20T06:00:00Z\",\"planned_finish\":\"2027-07-20T06:00:00Z\",\"total_float_hours\":\"0\",\"calendar\":\"5x8\",\"predecessors\":\"S4C-P1000\",\"relationships\":[{\"predecessor\":\"S4C-P1000\",\"link_type\":\"FS\",\"lag_hours\":\"0\"}],\"schedule_name\":\"SMOKE4C P6\"},
{\"activity_id\":\"S4C-P9\",\"external_id\":\"S4C-P9\",\"development_case_id\":\"$CASE\",\"description\":\"Prepare foundations\",\"original_duration_hours\":\"300\",\"planned_start\":\"2027-05-20T06:00:00Z\",\"planned_finish\":\"2027-06-20T06:00:00Z\",\"total_float_hours\":\"400\",\"constraint_type\":\"start_on_or_after\",\"constraint_date\":\"2027-05-20T06:00:00Z\",\"calendar\":\"5x8\",\"predecessors\":\"S4C-P1000\",\"relationships\":[{\"predecessor\":\"S4C-P1000\",\"link_type\":\"FS\",\"lag_hours\":\"0\"}],\"schedule_name\":\"SMOKE4C P6\"},
{\"activity_id\":\"S4C-P10\",\"external_id\":\"S4C-P10\",\"development_case_id\":\"$CASE\",\"description\":\"Set compressor on foundations\",\"original_duration_hours\":\"120\",\"planned_start\":\"2027-07-20T06:00:00Z\",\"planned_finish\":\"2027-08-01T06:00:00Z\",\"total_float_hours\":\"-96\",\"constraint_type\":\"mandatory_finish\",\"constraint_date\":\"2027-07-24T06:00:00Z\",\"calendar\":\"5x8\",\"predecessors\":\"S4C-P1010,S4C-P9\",\"relationships\":[{\"predecessor\":\"S4C-P1010\",\"link_type\":\"FS\",\"lag_hours\":\"0\"},{\"predecessor\":\"S4C-P9\",\"link_type\":\"FS\",\"lag_hours\":\"600\"}],\"schedule_name\":\"SMOKE4C P6\"}]"
BODY=$(rpc "$PLANNER" ingest_rows "{\"p_run_id\":\"$RUN\",\"p_rows\":$ROWS}")
noerr "$BODY"; test "$(printf '%s' "$BODY" | field accepted)" = "4"
rpc "$PLANNER" finish_connector_run "{\"p_run_id\":\"$RUN\"}" >/dev/null

PACT=$(psqlc "select t.id from shutdown_tasks t join shutdown_events e on e.id=t.event_id where e.development_case_id='$CASE' and t.task_key='S4C-P10'")
test -n "$PACT"
test "$(psqlc "select origin from shutdown_tasks where id=$PACT")" = "imported"
test "$(psqlc "select total_float_hours from shutdown_tasks where id=$PACT")" = "-96"
test "$(psqlc "select lag_hours from shutdown_task_dependencies d join shutdown_events e on e.id=d.event_id where e.development_case_id='$CASE' and d.task_key='S4C-P10' and d.predecessor_key='S4C-P9'")" = "600"

# THE FIELD WALL GREW. P6 computed the float; a client that could edit it
# could clear a negative-float finding and open the Monte Carlo gate by typing.
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
  update shutdown_tasks set total_float_hours = 500 where id = $PACT; rollback;")
grep -qi 'total_float_hours' <<<"$OUT"
grep -qi 'system of record' <<<"$OUT"
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
  update shutdown_tasks set constraint_type = null where id = $PACT; rollback;")
grep -qi 'constraint_type' <<<"$OUT"
# A SERVICE rewrite is admitted AND audited — it changes what the analysis reads.
SEC_BEFORE=$(psqlc "select count(*) from security_events where detail like '%total_float_hours%'")
psqlc "update shutdown_tasks set total_float_hours = -96.0 where id = $PACT;" >/dev/null || true
psqlc "update shutdown_tasks set total_float_hours = -97 where id = $PACT;" >/dev/null
test "$(psqlc "select count(*) from security_events where detail like '%total_float_hours%'")" -gt "$SEC_BEFORE"
psqlc "update shutdown_tasks set total_float_hours = -96 where id = $PACT;" >/dev/null
echo "   P6's float and constraints ride the one door, join the field wall, and a service rewrite is audited"

BODY=$(rpc "$PLANNER" get_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
# The two classes that needed a computed network are answerable now, WITHOUT
# Sync recomputing one.
test "$(cls "$BODY" negative_float severity)" = "fail"
test "$(cls "$BODY" negative_float count)" = "1"
test "$(cls "$BODY" excessive_constraints diagnosable)" = "True"
test "$(jqp "$BODY" "x['activitiesWithFloat']")" = "4"
echo "   negative float and constraints become answerable from P6's own answers"

echo "── 4. §50 score and the gate refuse this schedule (D5.31, D5.15) ────────"

BODY=$(rpc "$PLANNER" get_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['gate']['permitted']")" = "False"
test "$(jqp "$BODY" "'negative_float' in x['gate']['failingClasses']")" = "True"
test "$(jqp "$BODY" "'missing_logic' in x['gate']['failingClasses']")" = "True"
grep -qi 'monte carlo on poor logic is not useful' <<<"$(jqp "$BODY" "x['gate']['refusal']")"

# THE SIMULATION IS REFUSED, BY NAME, AND THE REFUSAL IS RECORDED.
RUNS_BEFORE=$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_simulation'")
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":{\"seed\":\"1\",\"iterations\":\"2000\",\"sampleCount\":\"2000\",\"kernelVersion\":\"x\",\"activityDigest\":\"x\",\"riskDigest\":\"x\",\"deterministicHours\":\"100\",\"p10Hours\":\"100\",\"p50Hours\":\"110\",\"p80Hours\":\"130\",\"p90Hours\":\"140\"}}")
expect_err "$BODY" 'monte carlo'
test "$(jqp "$BODY" "'negative_float' in x['failingClasses']")" = "True"
test "$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_simulation'")" -gt "$RUNS_BEFORE"
test "$(psqlc "select status from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_simulation' order by computed_at desc limit 1")" = "refused"
echo "   a Monte Carlo over a failing schedule is REFUSED and the refusal is a run in the ledger"

# Repair the schedule the only way there is: fix it and re-import. There is no
# waiver act, for any role.
psqlc "delete from shutdown_task_dependencies where event_id in (select id from shutdown_events where development_case_id='$CASE') and task_key='S4C-A3' and predecessor_key='S4C-A10';" >/dev/null
psqlc "delete from shutdown_tasks where task_key in ('S4C-ORP','S4C-LONG','S4C-CAL') and event_id in (select id from shutdown_events where development_case_id='$CASE');" >/dev/null
psqlc "update shutdown_tasks set total_float_hours = 0, constraint_type = null, constraint_date = null where id = $PACT;" >/dev/null
psqlc "update shutdown_task_dependencies set lag_hours = 0 where event_id in (select id from shutdown_events where development_case_id='$CASE') and lag_hours > 120;" >/dev/null
# The P6 schedule and the Sync-authored one are separate events by design, so
# each keeps its own start and finish; give the P6 chain its own ranges.
#
# STATED, NOT DERIVED. This used to be `optimistic = duration * 0.8,
# pessimistic = duration * 1.6` — a spread computed from a deterministic
# number, which is the first item on this slice's forbidden list, applied by
# the fixture that produced the only P50/P80 in the transcript. Each range is
# now a pair somebody stated, and each goes through the governed door.
for RG in "S4C-P1000:160:420" "S4C-P1010:820:1900" "S4C-P9:240:610" \
          "S4C-P10:90:280"; do
  IFS=: read -r RK RO RP <<<"$RG"
  if [ "$(psqlc "select count(*) from shutdown_tasks t join shutdown_events e on e.id=t.event_id where e.development_case_id='$CASE' and t.task_key='$RK'")" = "1" ]; then
    BODY=$(rpc "$PLANNER" set_schedule_activity_duration_range "{\"p_case_id\":\"$CASE\",\"p_range\":{\"activity_id\":\"$RK\",\"optimistic_hours\":\"$RO\",\"pessimistic_hours\":\"$RP\",\"basis\":\"Turnaround planner estimate against the two most recent comparable executions\"}}")
    noerr "$BODY"
  fi
done

# THE DOOR'S OWN REFUSALS (D5.28/D5.14/D5.07).
BODY=$(rpc "$PLANNER" set_schedule_activity_duration_range "{\"p_case_id\":\"$CASE\",\"p_range\":{\"activity_id\":\"S4C-P1010\",\"optimistic_hours\":\"820\",\"pessimistic_hours\":\"1900\",\"basis\":\"too short\"}}")
expect_err "$BODY" 'state the basis for this range'
BODY=$(rpc "$PLANNER" set_schedule_activity_duration_range "{\"p_case_id\":\"$CASE\",\"p_range\":{\"activity_id\":\"S4C-P1010\",\"optimistic_hours\":\"1000\",\"pessimistic_hours\":\"1000\",\"basis\":\"A triple whose ends meet is not a range\"}}")
expect_err "$BODY" 'a point estimate with three columns'
BODY=$(rpc "$PLANNER" set_schedule_activity_duration_range "{\"p_case_id\":\"$CASE\",\"p_range\":{\"activity_id\":\"S4C-P1010\",\"optimistic_hours\":\"1\",\"pessimistic_hours\":\"5\",\"basis\":\"A range that excludes the stated duration entirely\"}}")
expect_err "$BODY" 'does not bracket'
BODY=$(rpc "$AIBOT" set_schedule_activity_duration_range "{\"p_case_id\":\"$CASE\",\"p_range\":{\"activity_id\":\"S4C-P1010\",\"optimistic_hours\":\"820\",\"pessimistic_hours\":\"1900\",\"basis\":\"The agent inferred this spread from the corpus\"}}")
expect_err "$BODY" '§70'
# ...and every accepted range is on the record with its author and its basis.
test "$(psqlc "select count(*) from schedule_duration_range_basis where development_case_id='$CASE'")" -ge "9"
test "$(psqlc "select count(*) from schedule_duration_range_basis where development_case_id='$CASE' and recorded_by is null")" = "0"
echo "   the range that IS the distribution now has a governed door, a named author and a basis"

BODY=$(rpc "$PLANNER" get_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['score'] is not None")" = "True"
test "$(jqp "$BODY" "x['gate']['permitted']")" = "True"
test "$(jqp "$BODY" "x['diagnosableComponents'] >= 4")" = "True"
# D5.14 is a DIFFERENT question and travels with its own components.
test "$(jqp "$BODY" "x['confidence'] is not None")" = "True"
test "$(jqp "$BODY" "sorted(x['confidenceComponents'].keys())")" = "['importHistory', 'scopeAnchoring', 'structure', 'uncertaintyExpressed']"
grep -qi 'no track record of being maintained' <<<"$(jqp "$BODY" "x['confidenceComponents']['importHistory']['basis']")"
# The score and the confidence are different numbers: a structurally sound
# schedule with no scope anchoring does not inherit its own quality score.
test "$(jqp "$BODY" "x['confidence'] != x['score']")" = "True"
echo "   §50 scores, the gate opens, and schedule confidence is a separate number with its own basis"

echo "── 5. risk → schedule → economics (D5.08) ───────────────────────────────"

BODY=$(rpc "$PLANNER" get_case_risk_schedule_chain "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
grep -qi 'no open risk is bound to this case' <<<"$(printf '%s' "$BODY" | field coverageNote)"
grep -qi 'not a statement that the project is safe' <<<"$(printf '%s' "$BODY" | field coverageNote)"
grep -qi 'no cost of delay is recorded' <<<"$(jqp "$BODY" "x['delayCostRate']['refusal']")"
grep -qi 'honestly truncated' <<<"$(jqp "$BODY" "x['delayCostRate']['refusal']")"

# `draft` is the only status the ISO 31000 contract trigger admits without a
# full analysis record (20260921110101). The register's `likelihood` column is
# populated deliberately — the whole D5.08 ruling is that this UNBOUNDED score
# is not a probability, and the link below states its own.
RISK1=$(psqlv "insert into risks (organization_id, title, kind, likelihood, current_risk_level, status, created_by)
  values ('$ORG','SMOKE4C compressor delivery slips','threat',4,'High','draft','$PLANNER_ID') returning id")
RISK2=$(psqlv "insert into risks (organization_id, title, kind, likelihood, current_risk_level, status, created_by)
  values ('$ORG','SMOKE4C environmental permit late','threat',3,'Medium','draft','$PLANNER_ID') returning id")
test -n "$RISK1"; test -n "$RISK2"

# A risk the case's own register does not carry is a driver nobody reviews.
BODY=$(rpc "$PLANNER" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"S4C-P1010\",\"probability\":\"0.4\",\"delay_days_optimistic\":\"5\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"30\",\"basis\":\"Vendor schedule review, October, plus two comparable orders\"}}")
expect_err "$BODY" 'a driver nobody reviews'
rpc "$PLANNER" bind_risk_to_development_case "{\"p_risk_id\":\"$RISK1\",\"p_case_id\":\"$CASE\"}" >/dev/null
rpc "$PLANNER" bind_risk_to_development_case "{\"p_risk_id\":\"$RISK2\",\"p_case_id\":\"$CASE\"}" >/dev/null

# §70: the AI identity cannot author the number a P80 is built on.
BODY=$(rpc "$AIBOT" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"S4C-P1010\",\"probability\":\"0.4\",\"delay_days_optimistic\":\"5\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"30\",\"basis\":\"Inferred by the risk agent from the vendor correspondence\"}}")
expect_err "$BODY" '§70'
expect_err "$BODY" 'forbidden to determine'
BODY=$(rpc "$TECH" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"S4C-P1010\",\"probability\":\"0.4\",\"delay_days_optimistic\":\"5\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"30\",\"basis\":\"Vendor schedule review, October, plus two comparable orders\"}}")
expect_err "$BODY" 'requires a planning, engineering or governance role'

# THE CENTRAL REFUSAL, AT THE INPUT END: a single-point impact.
BODY=$(rpc "$PLANNER" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"S4C-P1010\",\"probability\":\"0.4\",\"delay_days_optimistic\":\"12\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"12\",\"basis\":\"Vendor schedule review, October, plus two comparable orders\"}}")
expect_err "$BODY" 'single-point estimate wearing three columns'
BODY=$(rpc "$PLANNER" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"S4C-P1010\",\"delay_days_optimistic\":\"5\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"30\",\"basis\":\"Vendor schedule review, October, plus two comparable orders\"}}")
expect_err "$BODY" 'unbounded score, not a probability'
BODY=$(rpc "$PLANNER" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"S4C-P1010\",\"probability\":\"4\",\"delay_days_optimistic\":\"5\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"30\",\"basis\":\"Vendor schedule review, October, plus two comparable orders\"}}")
expect_err "$BODY" 'at most 1'
BODY=$(rpc "$PLANNER" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"S4C-P1010\",\"probability\":\"0.4\",\"delay_days_optimistic\":\"5\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"30\",\"basis\":\"too short\"}}")
expect_err "$BODY" 'three numbers somebody liked'
BODY=$(rpc "$PLANNER" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"NOT-AN-ACTIVITY\",\"probability\":\"0.4\",\"delay_days_optimistic\":\"5\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"30\",\"basis\":\"Vendor schedule review, October, plus two comparable orders\"}}")
expect_err "$BODY" "is not in this case's schedule"
# A "likely cost" with no range is the single point again, wearing a currency.
BODY=$(rpc "$PLANNER" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"S4C-P1010\",\"probability\":\"0.4\",\"delay_days_optimistic\":\"5\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"30\",\"cost_likely\":\"400000\",\"currency\":\"USD\",\"basis\":\"Vendor schedule review, October, plus two comparable orders\"}}")
expect_err "$BODY" 'wearing a currency sign'
echo "   §70, the unbounded-likelihood ruling, and the single-point refusal all hold at the input end"

BODY=$(rpc "$PLANNER" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"S4C-P1010\",\"probability\":\"0.4\",\"delay_days_optimistic\":\"5\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"30\",\"cost_optimistic\":\"100000\",\"cost_likely\":\"400000\",\"cost_pessimistic\":\"1200000\",\"currency\":\"USD\",\"basis\":\"Vendor schedule review, October, plus two comparable orders on the same frame\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK2\",\"activity_key\":\"S4C-P1000\",\"probability\":\"0.25\",\"delay_days_optimistic\":\"2\",\"delay_days_likely\":\"6\",\"delay_days_pessimistic\":\"20\",\"basis\":\"Regulator statutory clock plus the last two applications on this site\"}}")
noerr "$BODY"

BODY=$(rpc "$PLANNER" get_case_risk_schedule_chain "{\"p_case_id\":\"$CASE\"}")
test "$(printf '%s' "$BODY" | field linkCount)" = "2"
grep -qi 'no cost of delay is recorded' <<<"$(jqp "$BODY" "x['links'][0]['economicHop']")"
test "$(jqp "$BODY" "x['links'][0]['economicHopAvailable']")" = "False"

# The days→money hop, through the CANONICAL numeric-assumption store.
DKEY=$(psqlc "select sync_case_delay_cost_key('$CASE')")
BODY=$(rpc "$MANAGER" upsert_financial_assumption "{\"p_key\":\"$DKEY\",\"p_label\":\"SMOKE4C cost of one day of delay\",\"p_value\":45000,\"p_unit\":\"USD/day\",\"p_source\":\"Deferred margin at nameplate less avoided operating cost, finance model rev C\"}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_risk_schedule_chain "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['delayCostRate']['value']")" = "45000"
test "$(jqp "$BODY" "x['links'][0]['economicHopAvailable']")" = "True"
echo "   the chain is walkable; the days→money hop is refused by name until a rate with a source exists"

echo "── 6. the gate opens and the REAL kernel runs (D5.15) ───────────────────"

SIM=$(npx --yes tsx scripts/develop-slice4c-simulate.ts "$API_URL" "$ANON_KEY" "$PLANNER" "$CASE" 2000 20261202)
test -n "$SIM"
# It is the product's kernel, named in the payload it produced.
grep -q 'integrated-risk/4C/' <<<"$SIM"

# §70 first: the P80 is the number a sanction paper is written against.
BODY=$(rpc "$AIBOT" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$SIM}")
expect_err "$BODY" '§70'
expect_err "$BODY" 'a human records it'
BODY=$(rpc "$TECH" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$SIM}")
expect_err "$BODY" 'requires a planning, engineering or governance role'

BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$SIM}")
noerr "$BODY"
SIMID=$(printf '%s' "$BODY" | field simulation_id); test -n "$SIMID"
test "$(printf '%s' "$BODY" | field seed)" = "20261202"
test "$(printf '%s' "$BODY" | field iterations)" = "2000"
echo "   the kernel ran, the door accepted it, and the seed is on the record"

echo "── 7. the same seed reproduces it exactly ───────────────────────────────"

SIM2=$(npx --yes tsx scripts/develop-slice4c-simulate.ts "$API_URL" "$ANON_KEY" "$PLANNER" "$CASE" 2000 20261202)
P80A=$(printf '%s' "$SIM"  | field p80Hours)
P80B=$(printf '%s' "$SIM2" | field p80Hours)
test "$P80A" = "$P80B"
A80A=$(printf '%s' "$SIM"  | python3 -c "import json,sys; print(json.load(sys.stdin)['attribution'][0]['p80HoursContribution'])")
A80B=$(printf '%s' "$SIM2" | python3 -c "import json,sys; print(json.load(sys.stdin)['attribution'][0]['p80HoursContribution'])")
test "$A80A" = "$A80B"
SIM3=$(npx --yes tsx scripts/develop-slice4c-simulate.ts "$API_URL" "$ANON_KEY" "$PLANNER" "$CASE" 2000 777)
test "$(printf '%s' "$SIM3" | field p80Hours)" != "$P80A"
echo "   same seed → identical P80 AND identical attribution; different seed → a different answer"

echo "── 8. the door's own refusals ───────────────────────────────────────────"

mutate(){ SIM="$1" PATCHES="$2" python3 - <<'PY'
import json,os
x=json.loads(os.environ['SIM'])
x.update(json.loads(os.environ['PATCHES']))
print(json.dumps(x))
PY
}

BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"activityDigest":"not-the-digest"}')}")
expect_err "$BODY" 'name inputs it never saw'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"iterations":"500","sampleCount":"500"}')}")
expect_err "$BODY" 'below the published minimum'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"sampleCount":"1200"}')}")
expect_err "$BODY" 'percentiles of something else'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"seed":"-4"}')}")
expect_err "$BODY" 'cannot be reproduced'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"seed":""}')}")
expect_err "$BODY" 'cannot be reproduced'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"p50Hours":"9","p80Hours":"8"}')}")
expect_err "$BODY" 'did not come off a sample'
# THE ONE THAT MATTERS MOST: a "distribution" of zero width is a deterministic
# answer with percentile labels on it.
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"p10Hours":"1000","p50Hours":"1000","p80Hours":"1000","p90Hours":"1000"}')}")
expect_err "$BODY" 'zero width'
# ...and the near-miss: exact equality was the whole test, so a "distribution"
# 3.6 MILLISECONDS wide passed it.
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"p10Hours":"1460","p50Hours":"1460","p80Hours":"1460","p90Hours":"1460.0000001"}')}")
expect_err "$BODY" 'rounding error'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"kernelVersion":""}')}")
expect_err "$BODY" 'kernelVersion'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"attribution":[{"riskId":"00000000-0000-0000-0000-000000000000","riskTitle":"A risk the simulation never saw"}]}')}")
expect_err "$BODY" 'assumed ordering wearing a computed'
# A direct client insert cannot put a P80 in the ledger with nothing behind it.
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
  insert into schedule_simulation_runs (organization_id, development_case_id, seed, iterations, kernel_version,
    activity_digest, risk_digest, activity_count, sampled_range_count, risk_link_count, quality_score,
    deterministic_hours, p10_hours, p50_hours, p80_hours, p90_hours)
  values ('$ORG','$CASE',1,2000,'hand-written','x','y',1,1,0,100,10,10,10,10,10); rollback;")
grep -qi 'record_case_schedule_simulation' <<<"$OUT"
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"p10Hours":"-Infinity"}')}")
expect_err "$BODY" 'finite number of hours'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"kernelVersion":"totally-made-up-kernel"}')}")
expect_err "$BODY" 'not one this server recognises'

echo "── 8b. the door checks CONTENT, not only shape ──────────────────────────"

# THE ONE THAT MATTERED MOST IN REVIEW. This case has no cost lines, so the
# earned-value EAC REFUSES — and the door used to take `costBase` verbatim,
# so a planner token could POST a billion and §51 printed a billion-dollar
# cost P80 beside `deterministic: null`, under the sentence "these percentiles
# came off the recorded simulation".
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"costBase":"999999999","costExposureP50":"1000","costExposureP80":"2000"}')}")
expect_err "$BODY" 'not a number the client supplies'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"costBase":"-1000000000"}')}")
expect_err "$BODY" 'not a number the client supplies'
test "$(psqlc "select count(*) from schedule_simulation_runs where development_case_id='$CASE' and cost_base is not null")" = "0"

# The cost of delay is read from the assumption that owns it. A negative rate
# would turn every simulated slip into a benefit, and the rate's own function
# already refuses one — the door used to never call it.
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"delayCostPerDay":"-1"}')}")
expect_err "$BODY" "recorded rate is"
test "$(psqlc "select count(*) from schedule_simulation_runs where development_case_id='$CASE' and delay_cost_per_day < 0")" = "0"

# THE ANCHOR OF THE PUBLISHED DATES. `deterministicHours: 99999` on this
# network produced a "P80 completion date" eleven years before the plan's own
# finish, accepted and served as the §51 forecast.
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"deterministicHours":"99999"}')}")
expect_err "$BODY" 'not a path through this schedule'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"deterministicHours":"1"}')}")
expect_err "$BODY" 'not a path through this schedule'
test "$(psqlc "select count(*) from schedule_simulation_runs where development_case_id='$CASE' and (p80_finish < deterministic_finish - interval '1 day')")" = "0"

# probabilityOnPlan reached the screen as "9999900%" and as "NaN%".
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"probabilityOnPlan":"42"}')}")
expect_err "$BODY" 'between 0 and 1'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" '{"probabilityOnPlan":"NaN"}')}")
expect_err "$BODY" 'between 0 and 1'
test "$(psqlc "select count(*) from schedule_simulation_runs where probability_on_plan is not null and (probability_on_plan < 0 or probability_on_plan > 1 or probability_on_plan <> probability_on_plan)")" = "0"

# THE ATTRIBUTION NUMBERS, not only the risk ids. "4200.0 day(s) of P80
# schedule exposure and 777,000,000 of expected economic exposure" was
# accepted and rendered under a heading claiming the simulation measured it.
REALRISK=$(psqlc "select risk_id from risk_schedule_impacts where development_case_id='$CASE' limit 1")
test -n "$REALRISK"
attr_patch(){ RID="$1" RATE="$2" HOURS="$3" DAYS="$4" python3 -c '
import json, os
print(json.dumps({"attribution": [{
  "riskId": os.environ["RID"],
  "riskTitle": "WHATEVER I WANT",
  "activityId": "a",
  "occurrenceRate": float(os.environ["RATE"]),
  "p80HoursContribution": float(os.environ["HOURS"]),
  "p80DaysContribution": float(os.environ["DAYS"]),
  "meanCostContribution": 777000000,
  "p80CostContribution": 1000000000,
  "reason": "a ranking nobody simulated"}]}))'
}
crit_patch(){ CID="$1" IDX="$2" python3 -c '
import json, os
print(json.dumps({"criticality": [{
  "id": os.environ["CID"],
  "label": "A TASK THAT DOES NOT EXIST",
  "criticalityIndex": float(os.environ["IDX"]),
  "deterministicFloat": -1}]}))'
}
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" "$(attr_patch "$REALRISK" 9.9 100800 4200)")}")
expect_err "$BODY" 'occurrence rate'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" "$(attr_patch "$REALRISK" 0.4 100800 4200)")}")
expect_err "$BODY" 'cannot exceed the run'
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" "$(attr_patch "$REALRISK" 0.4 10 4200)")}")
expect_err "$BODY" 'hours and'

# THE CRITICALITY ARRAY, which was not validated at all — and which is the
# driver list §51 shows whenever a case has no risk edges.
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" "$(crit_patch 'not-a-real-activity' 1)")}")
expect_err "$BODY" 'not on this case'
FIRSTACT=$(psqlc "select t.id from shutdown_tasks t join shutdown_events e on e.id=t.event_id where e.development_case_id='$CASE' order by t.id limit 1")
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIM" "$(crit_patch "$FIRSTACT" 7.5)")}")
expect_err "$BODY" 'between 0 and 1'
echo "   a fabricated cost base, rate, anchor, probability, attribution or criticality is refused BY NAME"

echo "── 8c. the ledger refuses what the door refuses, for a SERVICE caller ───"

# The audited service path admitted an INSERT with no lineage row, nothing to
# sample, and computed_by set to the AI-operator identity — and the read served
# it as the case's current run. Every one of those is refused at the row now,
# for every caller.
AIBOT_ID=$(psqlc "select id from user_profiles where email='smoke-aibot@syncai.ca'")
BASEROW="'$ORG','$CASE',1,2000,'integrated-risk/4C/2026-12-02','x','y',1"
OUT=$(sql_must_fail "insert into schedule_simulation_runs (organization_id, development_case_id, seed, iterations,
  kernel_version, activity_digest, risk_digest, activity_count, sampled_range_count, risk_link_count,
  quality_score, deterministic_hours, p10_hours, p50_hours, p80_hours, p90_hours, computed_by, calculation_run_id)
  values ($BASEROW,1,0,100,1000,1,2,3,4,'$AIBOT_ID',(select id from calculation_runs where development_case_id='$CASE' limit 1));")
grep -qi '§70' <<<"$OUT"
OUT=$(sql_must_fail "insert into schedule_simulation_runs (organization_id, development_case_id, seed, iterations,
  kernel_version, activity_digest, risk_digest, activity_count, sampled_range_count, risk_link_count,
  quality_score, deterministic_hours, p10_hours, p50_hours, p80_hours, p90_hours)
  values ($BASEROW,1,0,100,1000,1,2,3,4);")
grep -qi 'carries its lineage run' <<<"$OUT"
OUT=$(sql_must_fail "insert into schedule_simulation_runs (organization_id, development_case_id, seed, iterations,
  kernel_version, activity_digest, risk_digest, activity_count, sampled_range_count, risk_link_count,
  quality_score, deterministic_hours, p10_hours, p50_hours, p80_hours, p90_hours, calculation_run_id)
  values ($BASEROW,0,0,100,1000,1,2,3,4,(select id from calculation_runs where development_case_id='$CASE' limit 1));")
grep -qi 'NOTHING varies' <<<"$OUT"
echo "   a service key cannot mint an AI-attributed, un-lineaged distribution over nothing"

echo "── 8d. the logic ledger has the wall the activity ledger has ────────────"

OUT=$(sql_must_fail "truncate table shutdown_task_dependencies;")
grep -qi 'no open ends, no missing logic' <<<"$OUT"
test "$(psqlc "select count(*) from information_schema.role_table_grants where table_name='shutdown_task_dependencies' and privilege_type='TRUNCATE' and grantee in ('anon','authenticated','service_role')")" = "0"
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
  delete from shutdown_task_dependencies where event_id in (select id from shutdown_events where development_case_id='$CASE'); rollback;")
grep -qi 'record_local_schedule_relationship' <<<"$OUT"
echo "   deleting a relationship cannot clear an open-ends finding by typing"

echo "   every way of getting an unsimulated percentile into the ledger is refused BY NAME"

echo "── 9. §51 finally shows P50 and P80 (D5.07, D5.32) ──────────────────────"

BODY=$(rpc "$PLANNER" compute_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" compute_case_risk_schedule_economics "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" compute_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['distribution']['exists']")" = "True"
test "$(jqp "$BODY" "x['schedule']['p50Hours'] is not None")" = "True"
test "$(jqp "$BODY" "x['schedule']['p80Hours'] >= x['schedule']['p50Hours']")" = "True"
test "$(jqp "$BODY" "x['schedule']['p80Finish'] is not None")" = "True"
test "$(jqp "$BODY" "x['schedule']['p50Finish'] <= x['schedule']['p80Finish']")" = "True"
# §51's fourth field travels with the numbers, and the schedule confidence
# these percentiles came off travels with them too.
test "$(jqp "$BODY" "x['scheduleConfidence']['score'] is not None")" = "True"
test "$(jqp "$BODY" "'estimateConfidence' in x and 'progressConfidence' in x")" = "True"
# I.9's "original sanction" is still REFUSED — this repository records no
# baselined completion date, and the approval timestamp is not one.
grep -qi 'the day somebody signed' <<<"$(printf '%s' "$BODY" | field againstSanctionRefusal)"
# The recorded run carries the percentiles and the simulation identity, so the
# surface renders the RUN and not the read.
test "$(psqlc "select outputs->>'distributionExists' from calculation_runs where development_case_id='$CASE' and calculation_key='case_forecast_confidence' order by computed_at desc limit 1")" = "true"
test "$(psqlc "select (outputs->>'scheduleP80Hours') is not null from calculation_runs where development_case_id='$CASE' and calculation_key='case_forecast_confidence' order by computed_at desc limit 1")" = "t"
echo "   P50 and P80 sit beside the deterministic figures, carrying their confidence and their lineage"

# The COST percentiles: this case has no cost lines, so the earned-value EAC
# refuses and the TOTAL cost percentiles refuse with it — while the risk-driven
# EXPOSURE is real and is labelled as exposure.
test "$(jqp "$BODY" "x['cost']['p50'] is None")" = "True"
grep -qi 'a forecast missing the project' <<<"$(jqp "$BODY" "' '.join(x['simulation']['refusals'])")"
test "$(jqp "$BODY" "x['cost']['exposureP80'] is not None")" = "True"
echo "   with no deterministic cost base the TOTAL cost percentiles refuse; the exposure is shown as exposure"

# STALENESS. Move the schedule under the recorded run and the percentiles go
# back to ABSENT: a P80 a schedule change has already invalidated is more
# dangerous than no P80, because it is specific.
BODY=$(rpc "$PLANNER" set_schedule_activity_duration_range "{\"p_case_id\":\"$CASE\",\"p_range\":{\"activity_id\":\"S4C-P1010\",\"optimistic_hours\":\"820\",\"pessimistic_hours\":\"1960\",\"basis\":\"Revised after the vendor confirmed a longer worst case on the frame\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_schedule_simulation "{\"p_case_id\":\"$CASE\"}")
test "$(printf '%s' "$BODY" | field current)" = "False"
grep -qi 'more dangerous than no p80' <<<"$(printf '%s' "$BODY" | field staleReason)"
BODY=$(rpc "$PLANNER" get_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['schedule']['p80Hours'] is None")" = "True"
test "$(jqp "$BODY" "x['cost']['p80'] is None")" = "True"
test "$(jqp "$BODY" "x['distribution']['exists']")" = "False"
echo "   a schedule edit makes the recorded percentiles STALE and the forecast says ABSENT again"

# Re-run over the moved schedule and they come back.
SIM4=$(npx --yes tsx scripts/develop-slice4c-simulate.ts "$API_URL" "$ANON_KEY" "$PLANNER" "$CASE" 2000 20261202)
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$SIM4}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['schedule']['p80Hours'] is not None")" = "True"

echo "── 9a. the COST percentiles, on a case that HAS a deterministic base ────"

# THE PRODUCE ARM, which had no coverage anywhere: every recorded run in the
# database had `cost_base IS NULL`, so the ✅ on the cost half of D5.07/D5.32
# rested on a path nothing exercised. Give this case a real earned-value chain
# — coded scope, a rule of credit, a period with a planned curve, a claim, and
# cost lines with a baseline and an actual — so `get_case_earned_value` returns
# an EAC, and then assert the recorded TOTAL is exactly that EAC plus the
# simulated exposure.
for E in '{"wbs_code":"C1","title":"Compressor package","scope_description":"All scope for the compressor replacement"}' \
         '{"wbs_code":"C1.1","parent_wbs_code":"C1","title":"Compressor engineering","scope_description":"Engineering deliverables for the compressor package"}'; do
  BODY=$(rpc "$PLANNER" record_wbs_element "{\"p_case_id\":\"$CASE\",\"p_element\":$E}")
  noerr "$BODY"
done
# A cost line sits UNDER the economics, so the business case comes first.
BODY=$(rpc "$PLANNER" create_case_business_case "{\"p_case_id\":\"$CASE\",\"p_case_ref\":\"S4C-BC\",\"p_title\":\"Compressor replacement\",\"p_driver\":\"reliability\",\"p_currency\":\"CAD\",\"p_discount_rate\":0.08,\"p_discount_rate_source\":\"Corporate treasury WACC memo 2026-Q2\"}")
noerr "$BODY"; CBCASE=$(printf '%s' "$BODY" | field business_case_id); test -n "$CBCASE"
BODY=$(rpc "$PLANNER" add_business_case_option "{\"p_business_case_id\":$CBCASE,\"p_label\":\"Replace the compressor\",\"p_life_periods\":10,\"p_cash_flows\":[{\"period\":0,\"amount\":-100000},{\"period\":1,\"amount\":40000}]}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cbs_code "{\"p_case_id\":\"$CASE\",\"p_code\":{\"cbs_code\":\"S4C-C100\",\"title\":\"Engineering hours\",\"cost_type\":\"labour\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" designate_control_account "{\"p_case_id\":\"$CASE\",\"p_account\":{\"control_account_ref\":\"S4C-CA1\",\"wbs_code\":\"C1.1\",\"cbs_code\":\"S4C-C100\",\"accountable_owner_id\":\"$MANAGER_ID\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" set_wbs_element_work_type "{\"p_case_id\":\"$CASE\",\"p_element\":{\"wbs_code\":\"C1.1\",\"work_type\":\"engineering_deliverable\",\"basis\":\"Contract Schedule G work breakdown, section 4\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_rule_of_credit "{\"p_case_id\":\"$CASE\",\"p_rule\":{\"rule_ref\":\"S4C-ROC1\",\"title\":\"Engineering deliverable credit\",\"applies_to\":\"engineering_deliverable\",\"basis\":\"Contract Schedule G milestone weighting\",\"steps\":[{\"step\":\"Issued for review\",\"weight\":40},{\"step\":\"Issued for construction\",\"weight\":60}]}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"S4C-CI1\",\"wbs_code\":\"C1.1\",\"cbs_code\":\"S4C-C100\",\"description\":\"Compressor engineering hours\",\"basis\":\"Estimated from the 2025 analogue package\",\"baseline_cost\":\"100000\",\"actual\":\"30000\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" open_progress_period "{\"p_case_id\":\"$CASE\",\"p_period\":{\"period_ref\":\"S4C-M01\",\"period_end\":\"2026-01-31\"}}")
noerr "$BODY"; CP1=$(printf '%s' "$BODY" | field period_id); test -n "$CP1"
BODY=$(rpc "$MANAGER" set_period_planned_progress "{\"p_period_id\":\"$CP1\",\"p_percent\":\"40\",\"p_basis\":\"Level 3 schedule spend curve, rev C\"}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" record_progress_claim "{\"p_period_id\":\"$CP1\",\"p_claim\":{\"wbs_code\":\"C1.1\",\"step_index\":\"1\",\"basis\":\"Issued for review, transmittal 0041\"}}")
noerr "$BODY"

BODY=$(rpc "$PLANNER" get_case_earned_value "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
EAC=$(jqp "$BODY" "x['metrics']['eac']['value']")
test "$EAC" != "None"
echo "   this case now has a deterministic estimate at completion of $EAC"

# The kernel reads the cost base from the SAME function the door does, so the
# round trip is a proof that both sides agree rather than that the client was
# believed.
SIMC=$(npx --yes tsx scripts/develop-slice4c-simulate.ts "$API_URL" "$ANON_KEY" "$PLANNER" "$CASE" 2000 20261202)
# String-vs-numeric: the read hands the kernel a JSON number and the payload
# carries it as text, so the comparison is numeric.
test "$(python3 -c "import sys; print(abs(float(sys.argv[1]) - float(sys.argv[2])) < 0.01)" "$(printf '%s' "$SIMC" | field costBase)" "$EAC")" = "True"
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$SIMC}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" compute_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['cost']['p50'] is not None")" = "True"
test "$(jqp "$BODY" "x['cost']['p80'] >= x['cost']['p50']")" = "True"
# THE COMPOSITION, ASSERTED RATHER THAN DESCRIBED: the total IS the
# deterministic EAC plus the simulated exposure at that percentile, to the
# penny. The old surface sentence said the deterministic figure "was not used
# to produce them", which was false on exactly this branch.
test "$(jqp "$BODY" "abs((x['cost']['p80'] - x['cost']['exposureP80']) - x['cost']['deterministic']) < 0.01")" = "True"
grep -qi 'PLUS the risk exposure the recorded simulation sampled' <<<"$(jqp "$BODY" "x['cost']['percentileRefusal']")"
test "$(jqp "$BODY" "x['cost']['composition']")" = "deterministic estimate at completion + simulated risk exposure at this percentile"

# ...and a client cannot substitute its own base: the door reads it.
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$(mutate "$SIMC" '{"costBase":"999999999"}')}")
expect_err "$BODY" 'not a number the client supplies'

# MOVING THE COST BASIS makes the recorded TOTAL stale while the schedule half
# stays current — a current-looking cost P80 built on a superseded EAC was
# invisible before, because no cost input moved the digest.
BODY=$(rpc "$PLANNER" record_cost_item "{\"p_case_id\":\"$CASE\",\"p_item\":{\"cost_item_ref\":\"S4C-CI1\",\"wbs_code\":\"C1.1\",\"cbs_code\":\"S4C-C100\",\"description\":\"Compressor engineering hours\",\"basis\":\"Re-estimated after the vendor quotation landed\",\"baseline_cost\":\"180000\",\"actual\":\"30000\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_schedule_simulation "{\"p_case_id\":\"$CASE\"}")
test "$(printf '%s' "$BODY" | field current)" = "True"
test "$(printf '%s' "$BODY" | field costCurrent)" = "False"
BODY=$(rpc "$PLANNER" get_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['schedule']['p80Hours'] is not None")" = "True"
test "$(jqp "$BODY" "x['cost']['p80'] is None")" = "True"
grep -qi 'cost inputs this run added its exposure to have moved' <<<"$(jqp "$BODY" "x['cost']['percentileRefusal']")"
grep -qi 'schedule half of this run is still current' <<<"$(jqp "$BODY" "x['cost']['percentileRefusal']")"
echo "   the cost P50/P80 are EAC + simulated exposure, refuse a client-supplied base, and go stale when the base moves"

echo "── 9b. re-dating the schedule makes the recorded DATES stale ────────────"

# The digest used to hash durations, ranges and logic and NOT the planned
# dates — while the P50/P80 DATES were anchored to max(planned_finish) at
# record time and the deterministic finish was read live. Shifting the plan by
# 90 days left `current: true` and served a P80 date 78 days BEFORE the
# deterministic finish. Nothing else about the schedule changes here.
psqlc "update shutdown_tasks set planned_start = planned_start + interval '90 days', planned_finish = planned_finish + interval '90 days' where event_id in (select id from shutdown_events where development_case_id='$CASE');" >/dev/null
BODY=$(rpc "$PLANNER" get_case_schedule_simulation "{\"p_case_id\":\"$CASE\"}")
test "$(printf '%s' "$BODY" | field current)" = "False"
BODY=$(rpc "$PLANNER" get_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['schedule']['p80Finish'] is None")" = "True"
test "$(jqp "$BODY" "x['distribution']['exists']")" = "False"
echo "   a re-dated schedule is STALE: a P80 date anchored to a superseded plan is not offered"

SIM5=$(npx --yes tsx scripts/develop-slice4c-simulate.ts "$API_URL" "$ANON_KEY" "$PLANNER" "$CASE" 2000 20261202)
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$SIM5}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['schedule']['p80Finish'] is not None")" = "True"
# ...and the P80 date is never BEFORE the plan's own finish once the anchor is
# bounded by the network it describes.
test "$(psqlc "select count(*) from schedule_simulation_runs where development_case_id='$CASE' and p80_finish < deterministic_finish - interval '1 day'")" = "0"

echo "── 9c. a schedule that DEGRADES stops serving its recorded P80 ──────────"

# D5.15 gated RECORDING. It did not gate SERVING, so a schedule that failed its
# §50 diagnostics AFTER a simulation was recorded kept serving that P80 with
# `current: true` and an affirmative statement of provenance.
#
# The degradation used here is P6's OWN float going negative — an input the
# digest deliberately does not hash (it is P6's answer about a network, not an
# input to the sampler), so the recorded run stays CURRENT and the only reason
# to withhold its percentiles is the gate. That is the case the repair is about.
psqlc "update shutdown_tasks set total_float_hours = -900 where origin='imported' and event_id in (select id from shutdown_events where development_case_id='$CASE');" >/dev/null
BODY=$(rpc "$PLANNER" get_case_schedule_quality "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['gate']['permitted']")" = "False"
test "$(jqp "$BODY" "'negative_float' in x['gate']['failingClasses']")" = "True"
BODY=$(rpc "$PLANNER" get_case_schedule_simulation "{\"p_case_id\":\"$CASE\"}")
test "$(printf '%s' "$BODY" | field current)" = "True"
BODY=$(rpc "$PLANNER" get_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['distribution']['exists']")" = "False"
test "$(jqp "$BODY" "x['schedule']['p80Hours'] is None")" = "True"
test "$(jqp "$BODY" "x['schedule']['p80Finish'] is None")" = "True"
test "$(jqp "$BODY" "x['cost']['p80'] is None")" = "True"
grep -qi 'NO LONGER passes its §50 quality diagnostics' <<<"$(jqp "$BODY" "x['schedule']['percentileRefusal']")"
echo "   a P80 recorded before the schedule degraded is withdrawn, not re-served with a caveat"

# Put P6's float back and confirm the same recorded run is served again — the
# run never changed; only whether it may be offered did.
psqlc "update shutdown_tasks set total_float_hours = 0 where origin='imported' and event_id in (select id from shutdown_events where development_case_id='$CASE');" >/dev/null
BODY=$(rpc "$PLANNER" get_case_forecast_confidence "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['distribution']['exists']")" = "True"
test "$(jqp "$BODY" "x['schedule']['p80Finish'] is not None")" = "True"

echo "── 9d. a schedule using logic the kernel cannot read REFUSES ────────────"

# `criticalPath` reads every edge as finish-to-start with zero lag while the
# digest hashes the link type and the lag. Changing one relationship from FS/0h
# to SS/120h produced BYTE-IDENTICAL percentiles under a different digest.
SIMOK=$(npx --yes tsx scripts/develop-slice4c-simulate.ts "$API_URL" "$ANON_KEY" "$PLANNER" "$CASE" 2000 20261202)
LOGICROW=$(psqlc "select d.id from shutdown_task_dependencies d join shutdown_events e on e.id=d.event_id where e.development_case_id='$CASE' and coalesce(d.link_type,'FS')='FS' and coalesce(d.lag_hours,0)=0 limit 1")
test -n "$LOGICROW"
psqlc "update shutdown_task_dependencies set link_type='SS', lag_hours=120 where id='$LOGICROW';" >/dev/null
BODY=$(rpc "$PLANNER" get_case_simulation_inputs "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['logicSupport']['supported']")" = "False"
SIM7=$(npx --yes tsx scripts/develop-slice4c-simulate.ts "$API_URL" "$ANON_KEY" "$PLANNER" "$CASE" 2000 20261202 || true)
grep -qi 'finish-to-start' <<<"$SIM7"
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$SIMOK}")
expect_err "$BODY" 'finish-to-start'
test "$(psqlc "select status from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_simulation' order by computed_at desc limit 1")" = "refused"
psqlc "update shutdown_task_dependencies set link_type='FS', lag_hours=0 where id='$LOGICROW';" >/dev/null
echo "   a distribution is never computed over a network the kernel reads differently"

echo "── 9e. a CLOSED risk stops driving the P80 ──────────────────────────────"

BODY=$(rpc "$PLANNER" get_case_risk_schedule_chain "{\"p_case_id\":\"$CASE\"}")
LINKS_BEFORE=$(printf '%s' "$BODY" | field linkCount)
# 'archived' rather than 'closed': the ISO 31000 risk contract (20260921110101)
# refuses a move to 'closed' until the whole treatment record is complete, and
# this step is about what a RETIRED risk does to a forecast, not about that
# contract. Both statuses are excluded by the chain for the same reason.
psqlc "update risks set status='archived' where id='$RISK2';" >/dev/null
BODY=$(rpc "$PLANNER" get_case_risk_schedule_chain "{\"p_case_id\":\"$CASE\"}")
test "$(printf '%s' "$BODY" | field linkCount)" -lt "$LINKS_BEFORE"
grep -qi 'exposure nobody still carries' <<<"$(printf '%s' "$BODY" | field retiredLinkNote)"
# ...and closing it moved the digest, so the recorded run is no longer current.
BODY=$(rpc "$PLANNER" get_case_schedule_simulation "{\"p_case_id\":\"$CASE\"}")
test "$(printf '%s' "$BODY" | field current)" = "False"
psqlc "update risks set status='draft' where id='$RISK2';" >/dev/null
SIM8=$(npx --yes tsx scripts/develop-slice4c-simulate.ts "$API_URL" "$ANON_KEY" "$PLANNER" "$CASE" 2000 20261202)
BODY=$(rpc "$PLANNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$SIM8}")
noerr "$BODY"
echo "   a mitigated risk leaves the forecast, and its departure is named rather than silent"

echo "── 10. per-risk attribution, out of the simulation (D5.09) ──────────────"

BODY=$(rpc "$PLANNER" get_case_schedule_simulation "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "len(x['attribution'])")" = "2"
# Ranked by MEASURED P80 contribution, descending — not by title, level or
# insertion order.
test "$(jqp "$BODY" "x['attribution'][0]['p80HoursContribution'] >= x['attribution'][1]['p80HoursContribution']")" = "True"
test "$(jqp "$BODY" "all('measured by re-running' in a['reason'] or 'float' in a['reason'] for a in x['attribution'])")" = "True"
# The occurrence rate is a property of the run, close to the stated probability.
test "$(jqp "$BODY" "any(abs(a['occurrenceRate'] - 0.4) < 0.06 for a in x['attribution'])")" = "True"
# A risk with a cost carries the money half; one without leaves it NULL.
test "$(jqp "$BODY" "any(a['meanCostContribution'] is not None for a in x['attribution'])")" = "True"

# A risk left outside the chain is NAMED, not counted, on the record.
RISK3=$(psqlv "insert into risks (organization_id, title, kind, current_risk_level, status, created_by, development_case_id)
  values ('$ORG','SMOKE4C tie-in window missed','threat','Critical','draft','$PLANNER_ID','$CASE') returning id")
test -n "$RISK3"
BODY=$(rpc "$PLANNER" compute_case_risk_schedule_economics "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
grep -qi 'SMOKE4C tie-in window missed' <<<"$(jqp "$BODY" "[r['riskTitle'] for r in x['unlinkedRisks']]")"
psqlc "select refusals::text from calculation_runs where development_case_id='$CASE' and calculation_key='case_risk_schedule_economics' order by computed_at desc limit 1" | grep -qi 'tie-in window missed'
echo "   drivers ranked by the simulation; risks outside the chain named in the ledger, not counted"

echo "── 11. lineage on every 4C calculation (D11.29) ─────────────────────────"

for K in case_schedule_quality case_risk_schedule_economics case_schedule_simulation; do
  test "$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE' and calculation_key='$K'")" -ge "1"
  test "$(psqlc "select code_version from calculation_runs where development_case_id='$CASE' and calculation_key='$K' order by computed_at desc limit 1")" = "develop-schedule/4C/2026-12-02"
done
# THE SEED AND THE ITERATION COUNT ARE IN THE LINEAGE ROW, so the run is
# replayable from the record rather than from the table.
test "$(psqlc "select inputs->>'seed' from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_simulation' and status <> 'refused' order by computed_at desc limit 1")" = "20261202"
test "$(psqlc "select inputs->>'iterations' from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_simulation' and status <> 'refused' order by computed_at desc limit 1")" = "2000"
test "$(psqlc "select (inputs->>'activityDigest') is not null from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_simulation' and status <> 'refused' order by computed_at desc limit 1")" = "t"
# The LATEST quality run is over a schedule where P6 supplied everything, so
# it has NO blind classes — and the ledger shows that, against the run recorded
# in step 2 which named two. A score over four components and a score over six
# are different facts and are recorded as different facts.
test "$(psqlc "select outputs->>'diagnosableComponents' from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_quality' order by computed_at desc limit 1")" = "6"
psqlc "select refusals::text from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_quality' order by computed_at desc limit 1" | grep -qiv 'Re-export with total_float_hours'
test "$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE' and calculation_key='case_schedule_quality' and refusals::text like '%Re-export with total_float_hours%'")" -ge "1"

# Immutability, both ledgers, both verbs, plus TRUNCATE.
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
  update schedule_simulation_runs set p80_hours = 1 where id='$SIMID'; rollback;")
grep -qi 'a recorded simulation is immutable' <<<"$OUT"
OUT=$(sql_must_fail "begin; select set_config('request.jwt.claim.sub','$PLANNER_ID',true);
  delete from risk_schedule_impacts where development_case_id='$CASE'; rollback;")
grep -qi 'record_risk_schedule_impact' <<<"$OUT"
OUT=$(sql_must_fail "truncate table schedule_simulation_runs;")
grep -qi 'un-makes every forecast in one statement' <<<"$OUT"
OUT=$(sql_must_fail "truncate table risk_schedule_impacts;")
grep -qi 'every driver of every recorded distribution' <<<"$OUT"
for T in schedule_simulation_runs risk_schedule_impacts; do
  test "$(psqlc "select count(*) from information_schema.role_table_grants where table_name='$T' and privilege_type='TRUNCATE' and grantee in ('anon','authenticated','service_role')")" = "0"
done
echo "   every 4C calculation records a run with its seed and its refusals; both ledgers are append-only"

echo "── 12. tenancy (the gap that let a cross-tenant read ship) ──────────────"

# A REAL FOREIGN TENANT, provisioned and driven — not computed and discarded.
# An earlier draft of this step selected a foreign organization and a foreign
# user_profiles ID and then never used either, so the half of the proof the
# heading claims ("probed as a FOREIGN TENANT") did not execute at all. 4A and
# 4B both do this properly; this is their block.
FOREIGN_ORG=$(psqlc "select id from organizations where name='SMOKE4C Foreign Tenant Corp' limit 1")
if [ -z "$FOREIGN_ORG" ]; then
  FOREIGN_ORG=$(psqlc "select provision_organization('SMOKE4C Foreign Tenant Corp')->>'organization_id'")
fi
test -n "$FOREIGN_ORG"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
do \$seed\$
declare v_uid uuid := '8c8c8c8c-8888-4888-8888-8c8c8c8c8c8c';
begin
  if not exists (select 1 from auth.users where email = 'smoke4c-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke4c-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'Smoke 4C foreign planner'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  insert into user_profiles (id, organization_id, email, full_name, role)
  values (v_uid, '$FOREIGN_ORG', 'smoke4c-foreign@syncai.ca', 'Smoke 4C foreign planner', 'planner')
  on conflict (id) do update set organization_id = excluded.organization_id, role = 'planner';
end
\$seed\$;
PSQL
FOREIGNER=$(token 'smoke4c-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGNER"
for FN in get_case_schedule_quality get_case_risk_schedule_chain get_case_delay_cost_rate \
          get_case_schedule_simulation get_case_simulation_inputs get_case_forecast_confidence \
          get_case_performance compute_case_schedule_quality compute_case_risk_schedule_economics \
          compute_case_forecast_confidence; do
  BODY=$(rpc "$FOREIGNER" "$FN" "{\"p_case_id\":\"$CASE\"}")
  expect_err "$BODY" 'development case not found'
done
BODY=$(rpc "$FOREIGNER" sync_case_schedule_digest "{\"p_case_id\":\"$CASE\"}")
expect_err "$BODY" 'forbidden'
# The logic-support read is granted to `authenticated` directly, so it carries
# its own tenant gate: whether another tenant's schedule uses lags is a fact
# about that tenant's schedule.
BODY=$(rpc "$FOREIGNER" sync_case_schedule_logic_support "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['relationshipCount']")" = "0"
test "$(jqp "$BODY" "x['nonFinishToStartCount']")" = "0"
BODY=$(rpc "$FOREIGNER" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"S4C-P1010\",\"probability\":\"0.4\",\"delay_days_optimistic\":\"5\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"30\",\"basis\":\"A foreign tenant writing into another tenant case\"}}")
expect_err "$BODY" 'development case not found'
BODY=$(rpc "$FOREIGNER" record_local_schedule_relationship "{\"p_case_id\":\"$CASE\",\"p_relationship\":{\"activity_id\":\"S4C-A20\",\"predecessor\":\"S4C-A10\"}}")
expect_err "$BODY" 'development case not found'
BODY=$(rpc "$FOREIGNER" set_schedule_activity_duration_range "{\"p_case_id\":\"$CASE\",\"p_range\":{\"activity_id\":\"S4C-A20\",\"optimistic_hours\":\"1\",\"pessimistic_hours\":\"2\",\"basis\":\"A foreign tenant widening another tenant distribution\"}}")
expect_err "$BODY" 'development case not found'
BODY=$(rpc "$FOREIGNER" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$SIM}")
expect_err "$BODY" 'development case not found'
# ...and the tables themselves are empty to that token.
for T in schedule_simulation_runs risk_schedule_impacts schedule_duration_range_basis; do
  ROWS=$(curl -sS "$API_URL/rest/v1/$T?select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $FOREIGNER")
  test "$ROWS" = "[]"
done
echo "   a real foreign tenant is refused on every 4C read, act and table"

# An ORPHAN JWT: authenticated, and a member of no organization at all.
psqlc "update user_profiles set organization_id = null where email = 'smoke-aibot@syncai.ca';" >/dev/null
ORPHAN=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#')
for FN in get_case_schedule_quality get_case_risk_schedule_chain get_case_delay_cost_rate \
          get_case_schedule_simulation get_case_simulation_inputs get_case_forecast_confidence \
          get_case_performance compute_case_schedule_quality compute_case_risk_schedule_economics; do
  BODY=$(rpc "$ORPHAN" "$FN" "{\"p_case_id\":\"$CASE\"}")
  test "$(printf '%s' "$BODY" | field error)" = "forbidden"
done
BODY=$(rpc "$ORPHAN" record_risk_schedule_impact "{\"p_case_id\":\"$CASE\",\"p_impact\":{\"risk_id\":\"$RISK1\",\"activity_key\":\"S4C-P1010\",\"probability\":\"0.4\",\"delay_days_optimistic\":\"5\",\"delay_days_likely\":\"12\",\"delay_days_pessimistic\":\"30\",\"basis\":\"An orphan JWT holder writing into somebody else's case\"}}")
test "$(printf '%s' "$BODY" | field error)" = "forbidden"
BODY=$(rpc "$ORPHAN" record_case_schedule_simulation "{\"p_case_id\":\"$CASE\",\"p_result\":$SIM}")
test "$(printf '%s' "$BODY" | field error)" = "forbidden"
BODY=$(rpc "$ORPHAN" set_schedule_activity_duration_range "{\"p_case_id\":\"$CASE\",\"p_range\":{\"activity_id\":\"S4C-A20\",\"optimistic_hours\":\"1\",\"pessimistic_hours\":\"2\",\"basis\":\"An orphan JWT holder widening a distribution\"}}")
test "$(printf '%s' "$BODY" | field error)" = "forbidden"
BODY=$(rpc "$ORPHAN" record_local_schedule_relationship "{\"p_case_id\":\"$CASE\",\"p_relationship\":{\"activity_id\":\"S4C-A20\",\"predecessor\":\"S4C-A10\"}}")
test "$(printf '%s' "$BODY" | field error)" = "forbidden"
BODY=$(rpc "$ORPHAN" sync_case_schedule_digest "{\"p_case_id\":\"$CASE\"}")
test "$(printf '%s' "$BODY" | field error)" = "forbidden"
psqlc "update user_profiles set organization_id = '$ORG' where email = 'smoke-aibot@syncai.ca';" >/dev/null

# Every client-callable 4C function is revoked from anon and from service_role
# (the definer path is the app's, not a raw key's).
for FN in get_case_schedule_quality compute_case_schedule_quality get_case_risk_schedule_chain \
          compute_case_risk_schedule_economics record_risk_schedule_impact get_case_delay_cost_rate \
          get_case_schedule_simulation record_case_schedule_simulation get_case_simulation_inputs \
          set_schedule_activity_duration_range sync_case_schedule_logic_support \
          sync_case_schedule_digest; do
  test "$(psqlc "select has_function_privilege('anon', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='$FN' limit 1")" = "f"
done
# The recorder itself stays revoked from authenticated: a lineage row a user
# could write is a claim that a calculation happened, made by the party the
# claim is for.
test "$(psqlc "select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_calculation_run' limit 1")" = "f"
echo "   foreign and orphan callers are refused on every 4C read and act; the recorder stays closed"

echo
echo "Develop slice-4c smoke PASSED — the schedule is diagnosed against nine"
echo "classes, a Monte Carlo refuses to run on a schedule that fails them, and"
echo "P50/P80 exist exactly where a real seeded simulation produced them."

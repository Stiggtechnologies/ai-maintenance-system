#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 5B — the frontline design review, the disposition record,
# six-axis design scoring and the §19 Interface. Every step is a live
# transcript against a real local database.
#
# Steps:
#   1  the review (D4.10): a case-bound design study through the real write
#      path, the three I.25 disciplines recorded BY NAME, the participation
#      flags DERIVED from the roster (a typed flag refused for every writer),
#      and a finding refused when it is attributed to somebody who was not in
#      the room — at the door AND at the wall.
#   2  the disposition (D4.11): all eight I.25 dimensions raised, the three
#      outcomes recorded with a reason mandatory on EVERY one, conditions
#      mandatory on the conditional outcome and refused on a flat acceptance,
#      self-disposition refused, and a revision that supersedes without
#      erasing.
#   3  CONSEQUENCE: an un-dispositioned finding is a NAMED blocker on
#      get_gate_readiness and record_case_gate_review REFUSES over it — the
#      same predicate, the same rows, through the Slice 3C machinery and not a
#      second evaluator. Then an ACCEPTED recommendation no requirement
#      carries keeps blocking, and carrying it clears the gate.
#   4  refusal-first: no review REFUSES rather than reporting 0 open findings;
#      a review with no findings refuses too; and the counts are null, not 0.
#   5  §70 at five doors and five walls: the AI-operator identity refused by
#      name at every act, and refused for EVERY writer — service key, RLS
#      bypassed, no marker — as a participant, a raiser, a dispositioner, a
#      scorer and an interface owner.
#   6  six-axis scoring (D4.12): five of six scored REFUSES the composite and
#      NAMES the axis; the sixth produces it; a lineage run is recorded for
#      the refusal as well as for the answer; the scale and the basis are
#      enforced.
#   7  the §19 Interface (D4.18): all seven types, overdue DERIVED, a closed
#      interface leaves the graph, and ONE graph carries both the interface
#      edges and the asset_dependencies edges among the assets they touch.
#   8  immutability: dispositions, findings, attendance, scores and interfaces
#      are append-only for every caller; DELETE and TRUNCATE refused; the
#      project side of /design is unchanged by any of it.
#
# Run: supabase start && scripts/ci-develop-slice5b-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-5b smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
ORG2='22222222-2222-2222-2222-222222222222'

# ONE execution, capturing output and status together. Running the candidate
# twice — once to capture, once to judge — means a REGRESSED guard performs the
# write on the first run and only trips on the second (usually on a unique
# constraint), so the helper would report the wrong refusal AND leave the row it
# was asserting could not exist behind on an append-only table.
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
# BOTH failure shapes: the {"error": ...} an RPC returns deliberately, and the
# {"code":..., "message":...} PostgREST returns when the function RAISES.
# Checking only the first let a real server-side exception read as a success.
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

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
SUPER=$(token 'supervisor@syncai.ca' 'Super123!@#')
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$TECH"; test -n "$SUPER"; test -n "$EXEC"

MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
TECH_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='technician@syncai.ca'")
SUPER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='supervisor@syncai.ca'")
test -n "$MANAGER_ID"; test -n "$PLANNER_ID"; test -n "$TECH_ID"; test -n "$SUPER_ID"

# The AI-operator identity, seeded exactly as the 3B/3C/3D/4A/5A transcripts
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

# The FOREIGN tenant, provisioned by this smoke rather than borrowed from an
# earlier one: a cross-tenant negative that SKIPS when the other tenant happens
# not to exist is a negative test that passes by not running.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
-- Its OWN uuid: 4A/4B/4C/4D/5A each seed a foreign member and reusing one of
-- their ids collides on auth.users' primary key when the smokes share a
-- database, which is exactly what CI does.
declare v_uid uuid := '5b5b5b5b-5555-4555-8555-5b5b5b5b5b5b';
        v_org uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into organizations (id, name) values (v_org, 'S4D foreign tenant')
    on conflict (id) do nothing;
  if not exists (select 1 from auth.users where email = 'smoke5b-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke5b-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'S5B foreign member'),
      '', '', '', '', '', '', '', ''
    );
  end if;
  if not exists (select 1 from auth.identities where user_id = v_uid) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke5b-foreign@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_uid, v_org, 'smoke5b-foreign@syncai.ca', 'maintenance_manager')
  on conflict (id) do update set organization_id = v_org, role = 'maintenance_manager';
  if not exists (select 1 from assets where organization_id = v_org and asset_tag = 'S5B-FGN') then
    insert into assets (organization_id, asset_tag, name, criticality)
    values (v_org, 'S5B-FGN', 'Foreign tenant asset', 'medium');
  end if;
end $seed$;
PSQL
FOREIGN_ID=$(psqlc "select id from user_profiles where email='smoke5b-foreign@syncai.ca'")
FOREIGN_ASSET=$(psqlc "select id from assets where organization_id='$ORG2' and asset_tag='S5B-FGN'")
test -n "$FOREIGN_ID"; test -n "$FOREIGN_ASSET"

# ── Idempotent re-run: clear this smoke's own artifacts. Fixture keys are kept
# SHORT on purpose — long fixture identifiers have been read as secrets by the
# repository's secret scanner and have blocked merges.
psqlc "delete from calculation_runs where organization_id='$ORG'
        and development_case_id in (select id from development_cases where organization_id='$ORG' and title like 'S5B %');" >/dev/null
# Findings, dispositions, attendance, scores and interfaces are NOT deleted
# directly — every one of those tables refuses that for every caller, this
# script included. They go when their case goes, through the declared cascade
# the provenance triggers admit mid-cascade. If a cascade ever stops working
# this cleanup fails loudly below rather than leaving stale fixtures that
# quietly change every count.
# audit_events and security_events are NOT cleaned: both are append-only for
# every caller and this smoke does not go around that. Every assertion against
# them below is a DELTA measured across the act, never an absolute count, so a
# re-run cannot read a previous run's rows.
psqlc "delete from development_cases where organization_id='$ORG' and title like 'S5B %';" >/dev/null
test "$(psqlc "select count(*) from design_review_findings where organization_id='$ORG' and finding_ref like 'S5B%'")" = "0"
test "$(psqlc "select count(*) from case_interfaces where organization_id='$ORG' and interface_ref like 'S5B%'")" = "0"
psqlc "delete from asset_dependencies where organization_id='$ORG'
        and dependent_asset_id in (select id from assets where organization_id='$ORG' and asset_tag like 'S5B-%');" >/dev/null
psqlc "delete from assets where organization_id='$ORG' and asset_tag like 'S5B-%';" >/dev/null

# Two assets and ONE recorded dependency between them, so step 7 can prove the
# interface graph and the asset graph are one graph rather than two.
psqlc "insert into assets (organization_id, asset_tag, name, criticality)
       values ('$ORG','S5B-A1','Tails header tie-in point','high'),
              ('$ORG','S5B-A2','Downstream sampler','low');" >/dev/null
A1=$(psqlc "select id from assets where organization_id='$ORG' and asset_tag='S5B-A1'")
A2=$(psqlc "select id from assets where organization_id='$ORG' and asset_tag='S5B-A2'")
psqlc "insert into asset_dependencies (organization_id, dependent_asset_id, supplier_asset_id, dependency_kind, evidence, source)
       values ('$ORG','$A2','$A1','functional','S5B fixture edge','human');" >/dev/null

# One adopted framework, so the case has real gates. Reused when a sibling
# smoke already adopted it — re-adopting would supersede a version another
# transcript is asserting against.
BROWN=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Brownfield Modification — Operating Site' and status='adopted' order by version desc limit 1")
if [ -z "$BROWN" ]; then
  FWID=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Brownfield Modification — Operating Site' and status='draft' order by version desc limit 1")
  test -n "$FWID"
  R=$(rpc "$EXEC" adopt_project_framework "{\"p_framework_id\":\"$FWID\",\"p_note\":\"Adopted for the slice-5b CI transcript as demo governance.\"}")
  noerr "$R"
  BROWN=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Brownfield Modification — Operating Site' and status='adopted' order by version desc limit 1")
fi
test -n "$BROWN"
G1=$(psqlc "select id from stage_gates where framework_id='$BROWN' and name like 'G1%' limit 1")
test -n "$G1"

echo "── 1. the frontline design review (D4.10) ───────────────────────────────"

R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"S5B frontline case\",\"p_problem_statement\":\"The new thickener underflow package is being detailed and nobody who will pull the pumps has seen the general arrangement.\",\"p_lifecycle_type\":\"brownfield\",\"p_framework_id\":\"$BROWN\"}")
noerr "$R"; CASE=$(printf '%s' "$R" | field case_id); test -n "$CASE"

# THE REFUSAL TAKEN FIRST — before any review exists. "0 open findings" over an
# empty set renders the same colour as a design somebody actually examined.
R=$(rpc "$PLANNER" get_case_frontline_review "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "x['refused']")" = "True"
test "$(jqp "$R" "x['findingCount'] is None")" = "True"
test "$(jqp "$R" "x['openFindingCount'] is None")" = "True"
test "$(jqp "$R" "'no review' in x['refusal']")" = "True"

# The review itself, through the real customer write path. design_studies has
# never had one — the table was demo-seed only.
R=$(rpc "$PLANNER" record_case_design_study "{\"p_case_id\":\"$CASE\",\"p_study\":{\"study_kind\":\"frontline_design_review\",\"summary\":\"Frontline review of the thickener underflow general arrangement\"}}")
noerr "$R"; STUDY=$(printf '%s' "$R" | field study_id); test -n "$STUDY"
test "$(jqp "$R" "x['frontlineKind']")" = "True"

# A study of a kind I.25 demands the frontline attends, with nobody in the
# room, is a BLOCKER from the moment it is recorded.
R=$(rpc "$PLANNER" case_frontline_design_obligations "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "len([b for b in x if b['type']=='frontline_review_unattended'])")" = "1"

# A summary that says nothing is refused, and so is a future review.
R=$(rpc "$PLANNER" record_case_design_study "{\"p_case_id\":\"$CASE\",\"p_study\":{\"study_kind\":\"frontline_design_review\",\"summary\":\"tbc\"}}")
expect_err "$R" 'what the review covered'
FUTURE=$(psqlc "select (current_date + 30)::text")
R=$(rpc "$PLANNER" record_case_design_study "{\"p_case_id\":\"$CASE\",\"p_study\":{\"study_kind\":\"frontline_design_review\",\"summary\":\"A review recorded as having happened next month\",\"performed_on\":\"$FUTURE\"}}")
expect_err "$R" 'future'

# Who was in the room, BY NAME and by each of the three I.25 disciplines —
# including constructors, which design_studies never had.
for PAIR in "$TECH_ID:maintenance" "$SUPER_ID:operations" "$PLANNER_ID:construction"; do
  WHO="${PAIR%%:*}"; DISC="${PAIR##*:}"
  R=$(rpc "$MANAGER" add_design_study_participant "{\"p_study_id\":$STUDY,\"p_participant\":{\"participant_id\":\"$WHO\",\"discipline\":\"$DISC\",\"basis\":\"Named for the S5B transcript as the $DISC voice\"}}")
  noerr "$R"
done
test "$(psqlc "select maintainer_participated and operator_participated and constructor_participated from design_studies where id=$STUDY")" = "t"
# ...and the blocker is gone, because the flags are DERIVED from the roster.
R=$(rpc "$PLANNER" case_frontline_design_obligations "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "len([b for b in x if b['type']=='frontline_review_unattended'])")" = "0"

# A participation flag TYPED by hand is refused for every writer, RLS bypassed
# and the service role in play — the flags are a claim about people, and a
# claim about people needs the people.
# NOTE the value: setting the flag to what the roster already derives is a
# permitted no-op, so asserting on `= true` here proved nothing. The claim is
# that a flag CONTRADICTING the room is refused.
OUT=$(sql_must_fail "update design_studies set operator_participated=false where id=$STUDY;")
grep -qi 'derived from the people recorded in the room' <<<"$OUT"
OUT=$(sql_must_fail "update design_studies set findings_count=9 where id=$STUDY;")
grep -qi 'cannot be typed' <<<"$OUT"

# A discipline outside the three, and a participant outside the tenant.
R=$(rpc "$MANAGER" add_design_study_participant "{\"p_study_id\":$STUDY,\"p_participant\":{\"participant_id\":\"$MANAGER_ID\",\"discipline\":\"procurement\"}}")
expect_err "$R" 'three spec I.25 frontline disciplines'
R=$(rpc "$MANAGER" add_design_study_participant "{\"p_study_id\":$STUDY,\"p_participant\":{\"participant_id\":\"$FOREIGN_ID\",\"discipline\":\"maintenance\"}}")
expect_err "$R" 'not a member of this organization'

echo "── 2. the disposition record (D4.11) ────────────────────────────────────"

# A finding attributed to somebody who was NOT in the room — refused at the
# door, and refused at the wall with RLS bypassed.
R=$(rpc "$MANAGER" raise_design_review_finding "{\"p_study_id\":$STUDY,\"p_finding\":{\"finding_ref\":\"S5B-X1\",\"dimension\":\"lifting\",\"recommendation\":\"A finding attributed to somebody who never attended the review\",\"raised_by\":\"$MANAGER_ID\"}}")
expect_err "$R" 'not recorded as a participant'
OUT=$(sql_must_fail "insert into design_review_findings (organization_id, study_id, finding_ref, dimension, raised_by, raised_by_discipline, recommendation)
                     values ('$ORG',$STUDY,'S5B-X2','lifting','$MANAGER_ID','maintenance','A finding minted straight past the door by the service path');")
grep -qi 'was in the room' <<<"$OUT"

# All eight I.25 dimensions, raised by the maintenance voice who was there.
i=0
for DIM in accessibility isolation lifting inspection lubrication ergonomics removal_route emergency_response; do
  i=$((i+1))
  R=$(rpc "$TECH" raise_design_review_finding "{\"p_study_id\":$STUDY,\"p_finding\":{\"finding_ref\":\"S5B-D$i\",\"dimension\":\"$DIM\",\"recommendation\":\"A $DIM recommendation raised for the eight-dimension transcript\"}}")
  noerr "$R"
  test "$(jqp "$R" "x['discipline']")" = "maintenance"
done
test "$(psqlc "select count(distinct dimension) from design_review_findings where study_id=$STUDY")" = "8"
# The aggregates are DERIVED from the rows, so the two can never disagree.
test "$(psqlc "select findings_count from design_studies where id=$STUDY")" = "8"
test "$(psqlc "select findings_closed from design_studies where id=$STUDY")" = "0"

# A dimension outside the eight, and a recommendation that says nothing.
R=$(rpc "$TECH" raise_design_review_finding "{\"p_study_id\":$STUDY,\"p_finding\":{\"finding_ref\":\"S5B-X3\",\"dimension\":\"vibes\",\"recommendation\":\"A finding on a dimension that does not exist\"}}")
expect_err "$R" 'eight spec I.25 review dimensions'
R=$(rpc "$TECH" raise_design_review_finding "{\"p_study_id\":$STUDY,\"p_finding\":{\"finding_ref\":\"S5B-X4\",\"dimension\":\"lifting\",\"recommendation\":\"too short\"}}")
expect_err "$R" 'state the recommendation'

F1=$(psqlc "select id from design_review_findings where finding_ref='S5B-D1'")
F2=$(psqlc "select id from design_review_findings where finding_ref='S5B-D2'")
F3=$(psqlc "select id from design_review_findings where finding_ref='S5B-D3'")
test -n "$F1"; test -n "$F2"; test -n "$F3"

# SELF-DISPOSITION IS REFUSED. The person who raised a concern does not record
# the answer to it — at the door, and at the wall for every writer.
R=$(rpc "$TECH" disposition_design_finding "{\"p_finding_id\":$F1,\"p_disposition\":{\"outcome\":\"accepted\",\"reason\":\"I accept my own recommendation, which is not an accountability record\",\"discipline\":\"maintenance\"}}")
expect_err "$R" 'you raised this finding'
OUT=$(sql_must_fail "insert into design_finding_dispositions (organization_id, finding_id, disposition_no, outcome, reason, dispositioned_by, disposition_discipline)
                     values ('$ORG',$F1,1,'accepted','A self-disposition minted straight past the door','$TECH_ID','maintenance');")
grep -qi 'cannot record the answer' <<<"$OUT"

# A reason is mandatory on EVERY outcome, not only on a rejection.
R=$(rpc "$MANAGER" disposition_design_finding "{\"p_finding_id\":$F1,\"p_disposition\":{\"outcome\":\"accepted\",\"reason\":\"ok\",\"discipline\":\"engineering\"}}")
expect_err "$R" 'every outcome'
# Conditions are mandatory on the conditional outcome and refused on a flat one.
R=$(rpc "$MANAGER" disposition_design_finding "{\"p_finding_id\":$F1,\"p_disposition\":{\"outcome\":\"accepted_with_conditions\",\"reason\":\"Accepted subject to something nobody wrote down\",\"discipline\":\"engineering\"}}")
expect_err "$R" 'carries the conditions'
R=$(rpc "$MANAGER" disposition_design_finding "{\"p_finding_id\":$F1,\"p_disposition\":{\"outcome\":\"accepted\",\"reason\":\"A flat acceptance carrying conditions nothing will track\",\"discipline\":\"engineering\",\"conditions\":\"some condition\"}}")
expect_err "$R" 'condition nothing tracks'

# The three outcomes, recorded.
R=$(rpc "$MANAGER" disposition_design_finding "{\"p_finding_id\":$F1,\"p_disposition\":{\"outcome\":\"accepted\",\"reason\":\"The platform will be extended to reach the gland; the cost is carried by this project\",\"discipline\":\"engineering\"}}")
noerr "$R"; test "$(jqp "$R" "x['requirementCarried']")" = "False"
grep -qi 'still blocks the gate' <<<"$R"
R=$(rpc "$MANAGER" disposition_design_finding "{\"p_finding_id\":$F2,\"p_disposition\":{\"outcome\":\"rejected\",\"reason\":\"The isolation point is already double-block-and-bleed on the P and ID revision C\",\"discipline\":\"engineering\"}}")
noerr "$R"
# A FRONTLINE discipline is answered for by somebody who attended in it. The
# supervisor was recorded as the operations voice, so they may answer as
# operations — this is the differentiator working: the operator answers.
R=$(rpc "$SUPER" disposition_design_finding "{\"p_finding_id\":$F3,\"p_disposition\":{\"outcome\":\"accepted_with_conditions\",\"reason\":\"A davit is affordable only if the vendor confirms the lifting lug rating\",\"discipline\":\"operations\",\"conditions\":\"Vendor confirmation of the lug rating before IFC issue\"}}")
noerr "$R"
# ...and the manager, who was never in the room, CANNOT answer as maintenance —
# at the door and at the wall. This column is what makes the record read
# "maintenance accepted this"; it was a free choice among four.
R=$(rpc "$MANAGER" disposition_design_finding "{\"p_finding_id\":$F3,\"p_disposition\":{\"outcome\":\"accepted\",\"reason\":\"A manager who never attended, answering in the maintenance voice\",\"discipline\":\"maintenance\"}}")
expect_err "$R" 'not recorded at this review as maintenance'
OUT=$(sql_must_fail "insert into design_finding_dispositions (organization_id, finding_id, disposition_no, outcome, reason, dispositioned_by, disposition_discipline)
                     values ('$ORG',$F3,9,'accepted','A maintenance voice minted past the door by the service path','$MANAGER_ID','maintenance');")
grep -qi 'being recorded in that discipline' <<<"$OUT"
test "$(psqlc "select findings_closed from design_studies where id=$STUDY")" = "3"

# A REVISION supersedes without erasing: both dispositions stay on the record.
# The audit assertion is a DELTA across this one act — audit_events is
# append-only and never cleaned, and surrogate ids repeat after a reset, so an
# absolute count here would read earlier runs.
AUD_BEFORE=$(psqlc "select count(*) from audit_events where entity_type='design_finding_disposition'
                     and previous_state->>'outcome'='rejected' and new_state->>'outcome'='accepted'")
R=$(rpc "$MANAGER" disposition_design_finding "{\"p_finding_id\":$F2,\"p_disposition\":{\"outcome\":\"accepted\",\"reason\":\"Re-opened: revision C was superseded and the bleed was removed in revision D\",\"discipline\":\"engineering\"}}")
noerr "$R"; test "$(jqp "$R" "x['dispositionNo']")" = "2"
test "$(jqp "$R" "x['supersedes']['outcome']")" = "rejected"
test "$(psqlc "select count(*) from design_finding_dispositions where finding_id=$F2")" = "2"
# audit_events carries previous_state AND new_state for the revision.
AUD_AFTER=$(psqlc "select count(*) from audit_events where entity_type='design_finding_disposition'
                    and previous_state->>'outcome'='rejected' and new_state->>'outcome'='accepted'")
test "$((AUD_AFTER - AUD_BEFORE))" = "1"

echo "── 3. CONSEQUENCE — the gate refuses over it (Slice 3C machinery) ───────"

# The blockers are read from the ONE predicate get_gate_readiness renders and
# the persistence wall refuses over. Five of the eight are unanswered.
R=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='frontline_finding_open'])")" = "5"
# THREE: D1 accepted, D2 accepted on its revision, D3 accepted with conditions.
# A REJECTED recommendation is answered and carries nothing by definition — it
# is not in this family, which is the distinction that makes the family mean
# something.
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='frontline_acceptance_uncarried'])")" = "3"
grep -q 'S5B-D4' <<<"$R"

# ...and the gate REFUSES, by name, through the shipped wall — no second
# evaluator was written for this slice.
FIND5B=$(psqlc "select coalesce(jsonb_agg(jsonb_build_object('criterion_text', sc.criterion, 'status', 'met')), '[]'::jsonb)::text from stage_gate_criteria sc where sc.gate_id=$G1 and sc.organization_id='$ORG'")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"A proceed recorded over five unanswered frontline recommendations must be refused.\",\"p_findings\":$FIND5B}")
grep -qi 'cannot pass while' <<<"$R"
grep -q 'S5B-D4' <<<"$R"
grep -qi 'disposition_design_finding' <<<"$R"

# Answer the five that are open. The one accepted with conditions and the one
# accepted flat still block, because NO REQUIREMENT CARRIES THEM — accepting a
# recommendation in the room and never building it is the failure I.25 exists
# to stop, and it is the second blocker family.
for N in 4 5 6 7 8; do
  FID=$(psqlc "select id from design_review_findings where finding_ref='S5B-D$N'")
  R=$(rpc "$MANAGER" disposition_design_finding "{\"p_finding_id\":$FID,\"p_disposition\":{\"outcome\":\"rejected\",\"reason\":\"Answered for the S5B transcript with a stated engineering reason\",\"discipline\":\"engineering\"}}")
  noerr "$R"
done
R=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='frontline_finding_open'])")" = "0"
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='frontline_acceptance_uncarried'])")" = "3"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"A proceed recorded over three accepted recommendations nothing carries must be refused.\",\"p_findings\":$FIND5B}")
grep -qi 'cannot pass while' <<<"$R"

# Carrying an acceptance into a design requirement is what clears it.
R=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S5B-R1\",\"category\":\"maintainability\",\"requirement\":\"A maintenance platform shall give standing access to the pump gland\",\"source\":\"maintenance\"}}")
noerr "$R"; REQ=$(printf '%s' "$R" | field requirement_id); test -n "$REQ"
R=$(rpc "$PLANNER" carry_design_finding_to_requirement "{\"p_finding_id\":$F1,\"p_requirement_id\":$REQ}")
noerr "$R"
R=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='frontline_acceptance_uncarried'])")" = "2"

# Carrying an UNANSWERED recommendation is refused: a requirement raised
# against a recommendation nobody has answered records an acceptance that
# never happened.
R=$(rpc "$PLANNER" record_case_design_study "{\"p_case_id\":\"$CASE\",\"p_study\":{\"study_kind\":\"removal_route\",\"summary\":\"Removal route review of the same package, held later\"}}")
noerr "$R"; STUDY2=$(printf '%s' "$R" | field study_id)
R=$(rpc "$MANAGER" add_design_study_participant "{\"p_study_id\":$STUDY2,\"p_participant\":{\"participant_id\":\"$SUPER_ID\",\"discipline\":\"operations\"}}")
noerr "$R"
R=$(rpc "$SUPER" raise_design_review_finding "{\"p_study_id\":$STUDY2,\"p_finding\":{\"finding_ref\":\"S5B-D9\",\"dimension\":\"removal_route\",\"recommendation\":\"The removal route crosses the operating aisle with no alternative\",\"severity\":\"blocking\"}}")
noerr "$R"; F9=$(printf '%s' "$R" | field finding_id)
R=$(rpc "$PLANNER" carry_design_finding_to_requirement "{\"p_finding_id\":$F9,\"p_requirement_id\":$REQ}")
expect_err "$R" 'has not been dispositioned'

echo "── 4. refusal-first over an empty set ──────────────────────────────────"

# A case with a review and NOT ONE finding refuses too. "0 open findings" and
# "nobody raised anything" render identically and mean opposite things.
R=$(rpc "$PLANNER" create_development_case '{"p_title":"S5B empty review case","p_problem_statement":"A second case that exists only so an empty review set can be asked to report itself.","p_lifecycle_type":"greenfield"}')
noerr "$R"; CASE2=$(printf '%s' "$R" | field case_id)
R=$(rpc "$PLANNER" record_case_design_study "{\"p_case_id\":\"$CASE2\",\"p_study\":{\"study_kind\":\"maintainability_review\",\"summary\":\"A review at which nobody raised a single thing\"}}")
noerr "$R"; STUDY3=$(printf '%s' "$R" | field study_id)
R=$(rpc "$MANAGER" add_design_study_participant "{\"p_study_id\":$STUDY3,\"p_participant\":{\"participant_id\":\"$TECH_ID\",\"discipline\":\"maintenance\"}}")
noerr "$R"
R=$(rpc "$PLANNER" get_case_frontline_review "{\"p_case_id\":\"$CASE2\"}")
test "$(jqp "$R" "x['refused']")" = "True"
test "$(jqp "$R" "x['openFindingCount'] is None")" = "True"
test "$(jqp "$R" "'never as zero open findings' in x['refusal']")" = "True"
# The populated case does NOT refuse, and its counts are real.
R=$(rpc "$PLANNER" get_case_frontline_review "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "x['refused']")" = "False"
test "$(jqp "$R" "x['findingCount']")" = "9"
test "$(jqp "$R" "x['openFindingCount']")" = "1"
test "$(jqp "$R" "x['byDiscipline']['maintenance']")" = "8"
test "$(jqp "$R" "x['byDiscipline']['operations']")" = "1"

echo "── 5. §70 at five doors and five walls ─────────────────────────────────"

# The doors: refused BY NAME, with the reason stated.
R=$(rpc "$AIBOT" record_case_design_study "{\"p_case_id\":\"$CASE\",\"p_study\":{\"study_kind\":\"frontline_design_review\",\"summary\":\"A review the AI identity asserts took place\"}}")
expect_err "$R" '§70'
R=$(rpc "$AIBOT" add_design_study_participant "{\"p_study_id\":$STUDY,\"p_participant\":{\"participant_id\":\"$TECH_ID\",\"discipline\":\"maintenance\"}}")
expect_err "$R" '§70'
R=$(rpc "$AIBOT" raise_design_review_finding "{\"p_study_id\":$STUDY,\"p_finding\":{\"finding_ref\":\"S5B-X5\",\"dimension\":\"lifting\",\"recommendation\":\"A maintainer opinion held by a machine\"}}")
expect_err "$R" '§70'
R=$(rpc "$AIBOT" disposition_design_finding "{\"p_finding_id\":$F9,\"p_disposition\":{\"outcome\":\"accepted\",\"reason\":\"The machine manufactures the frontline consent this record exists to capture\",\"discipline\":\"maintenance\"}}")
expect_err "$R" '§70'
R=$(rpc "$AIBOT" score_design_axis "{\"p_case_id\":\"$CASE\",\"p_score\":{\"axis\":\"constructability\",\"score\":5,\"basis\":\"The machine scores the design it helped produce\"}}")
expect_err "$R" '§70'
# ...and the AI identity cannot be RECORDED as a participant either, whoever asks.
R=$(rpc "$MANAGER" add_design_study_participant "{\"p_study_id\":$STUDY,\"p_participant\":{\"participant_id\":\"$AIBOT_ID\",\"discipline\":\"operations\"}}")
expect_err "$R" 'cannot attend a design review'

# The walls: every writer, service key, RLS bypassed, no marker to hold.
OUT=$(sql_must_fail "insert into design_study_participants (organization_id, study_id, participant_id, discipline, recorded_by)
                     values ('$ORG',$STUDY,'$AIBOT_ID','operations','$MANAGER_ID');")
grep -qi 'spec §70' <<<"$OUT"
OUT=$(sql_must_fail "insert into design_finding_dispositions (organization_id, finding_id, disposition_no, outcome, reason, dispositioned_by, disposition_discipline)
                     values ('$ORG',$F9,1,'accepted','A machine-recorded acceptance written straight to the table','$AIBOT_ID','maintenance');")
grep -qi 'spec §70' <<<"$OUT"
OUT=$(sql_must_fail "insert into design_axis_scores (organization_id, development_case_id, axis, score_no, score, basis, scored_by)
                     values ('$ORG','$CASE','operability',99,5,'A machine-written score straight to the table','$AIBOT_ID');")
grep -qi 'spec §70' <<<"$OUT"

echo "── 6. six-axis design scoring (D4.12, spec I.26) ───────────────────────"

# Nothing scored: the scorecard REFUSES, and the refusal itself records a run.
R=$(rpc "$PLANNER" compute_case_design_scorecard "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "x['refused']")" = "True"
test "$(jqp "$R" "x['composite'] is None")" = "True"
test "$(jqp "$R" "len(x['missingAxes'])")" = "6"
RUN=$(printf '%s' "$R" | field calculationRunId); test -n "$RUN"
test "$(psqlc "select status from calculation_runs where id='$RUN'")" = "refused"
test "$(psqlc "select outputs is null from calculation_runs where id='$RUN'")" = "t"

# A basis is mandatory, and the scale is enforced.
R=$(rpc "$MANAGER" score_design_axis "{\"p_case_id\":\"$CASE\",\"p_score\":{\"axis\":\"constructability\",\"score\":4,\"basis\":\"short\"}}")
expect_err "$R" 'basis for this score'
R=$(rpc "$MANAGER" score_design_axis "{\"p_case_id\":\"$CASE\",\"p_score\":{\"axis\":\"constructability\",\"score\":9,\"basis\":\"A score outside the stated 1 to 5 scale\"}}")
expect_err "$R" 'integer from 1'
R=$(rpc "$MANAGER" score_design_axis "{\"p_case_id\":\"$CASE\",\"p_score\":{\"axis\":\"aesthetics\",\"score\":4,\"basis\":\"An axis the specification does not name\"}}")
expect_err "$R" 'six spec I.26 axes'

# FIVE of six scored — the composite still REFUSES and NAMES the sixth.
for PAIR in "design_readiness:4" "constructability:2" "operability:4" "maintainability:3" "reliability:5"; do
  AXIS="${PAIR%%:*}"; SC="${PAIR##*:}"
  R=$(rpc "$MANAGER" score_design_axis "{\"p_case_id\":\"$CASE\",\"p_score\":{\"axis\":\"$AXIS\",\"score\":$SC,\"basis\":\"Scored for the S5B six-axis transcript with a stated basis\"}}")
  noerr "$R"
done
R=$(rpc "$PLANNER" get_case_design_scorecard "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "x['refused']")" = "True"
test "$(jqp "$R" "x['composite'] is None")" = "True"
test "$(jqp "$R" "x['scoredAxisCount']")" = "5"
test "$(jqp "$R" "x['missingAxes']")" = "['commissionability']"
test "$(jqp "$R" "'commissionability' in x['refusal']")" = "True"
# The mean of the five that DO exist is 3.6 and is nowhere in the payload.
test "$(jqp "$R" "'3.6' in json.dumps(x)")" = "False"

# The sixth axis produces the composite — and the weakest axis beside it.
R=$(rpc "$MANAGER" score_design_axis "{\"p_case_id\":\"$CASE\",\"p_score\":{\"axis\":\"commissionability\",\"score\":3,\"basis\":\"Scored last for the S5B six-axis transcript with a stated basis\"}}")
noerr "$R"; test "$(jqp "$R" "len(x['missingAxes'])")" = "0"
R=$(rpc "$PLANNER" compute_case_design_scorecard "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "x['refused']")" = "False"
test "$(jqp "$R" "float(x['composite'])")" = "3.5"
test "$(jqp "$R" "x['weakestAxis']['axis']")" = "constructability"
RUN2=$(printf '%s' "$R" | field calculationRunId); test -n "$RUN2"
test "$(psqlc "select status from calculation_runs where id='$RUN2'")" = "computed"
test "$(psqlc "select code_version from calculation_runs where id='$RUN2'")" = "develop-design/5B/2026-12-05"

# A re-score SUPERSEDES and the earlier judgement stays visible.
R=$(rpc "$MANAGER" score_design_axis "{\"p_case_id\":\"$CASE\",\"p_score\":{\"axis\":\"constructability\",\"score\":4,\"basis\":\"Re-scored after the sequencing study moved the crane pick\"}}")
noerr "$R"; test "$(jqp "$R" "x['supersedes']['score']")" = "2"
test "$(psqlc "select count(*) from design_axis_scores where development_case_id='$CASE' and axis='constructability'")" = "2"
R=$(rpc "$PLANNER" get_case_design_scorecard "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "[a for a in x['axes'] if a['axis']=='constructability'][0]['score']")" = "4"
test "$(jqp "$R" "len([a for a in x['axes'] if a['axis']=='constructability'][0]['history'])")" = "2"

echo "── 7. the §19 Interface object, on the SHARED graph (D4.18) ────────────"

# The refusal first: an empty register traverses perfectly, which is the same
# result an unmapped brownfield project produces.
R=$(rpc "$PLANNER" get_case_interface_graph "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "x['refused']")" = "True"
test "$(jqp "$R" "x['overdueCount'] is None")" = "True"
test "$(jqp "$R" "'critical brownfield' in x['refusal']")" = "True"

# All seven §19 types through the real write path.
PAST=$(psqlc "select (current_date - 9)::text")
SOON=$(psqlc "select (current_date + 45)::text")
i=0
for T in physical process electrical control data organizational contractual; do
  i=$((i+1))
  R=$(rpc "$PLANNER" record_case_interface "{\"p_case_id\":\"$CASE\",\"p_interface\":{\"interface_ref\":\"S5B-I$i\",\"source_object\":\"Package $i delivers\",\"target_object\":\"Existing plant $i needs\",\"interface_type\":\"$T\",\"owner_id\":\"$MANAGER_ID\",\"requirement\":\"What must be true across the $T boundary, stated\",\"due_date\":\"$SOON\"}}")
  noerr "$R"
done
test "$(psqlc "select count(distinct interface_type) from case_interfaces where development_case_id='$CASE'")" = "7"

# The refusals: an unowned interface, an owner outside the tenant, a machine
# owner, an interface with itself, and a type outside the seven.
R=$(rpc "$PLANNER" record_case_interface "{\"p_case_id\":\"$CASE\",\"p_interface\":{\"interface_ref\":\"S5B-X6\",\"source_object\":\"A\",\"target_object\":\"B\",\"interface_type\":\"physical\",\"requirement\":\"An interface nobody has been made accountable for\"}}")
expect_err "$R" 'name the owner'
R=$(rpc "$PLANNER" record_case_interface "{\"p_case_id\":\"$CASE\",\"p_interface\":{\"interface_ref\":\"S5B-X7\",\"source_object\":\"A\",\"target_object\":\"B\",\"interface_type\":\"physical\",\"owner_id\":\"$FOREIGN_ID\",\"requirement\":\"An interface owned by somebody in another organization\"}}")
expect_err "$R" 'member of this organization'
R=$(rpc "$PLANNER" record_case_interface "{\"p_case_id\":\"$CASE\",\"p_interface\":{\"interface_ref\":\"S5B-X8\",\"source_object\":\"A\",\"target_object\":\"B\",\"interface_type\":\"physical\",\"owner_id\":\"$AIBOT_ID\",\"requirement\":\"An interface the AI identity is accountable for\"}}")
expect_err "$R" 'cannot own an interface'
R=$(rpc "$PLANNER" record_case_interface "{\"p_case_id\":\"$CASE\",\"p_interface\":{\"interface_ref\":\"S5B-X9\",\"source_object\":\"Same\",\"target_object\":\"same\",\"interface_type\":\"physical\",\"owner_id\":\"$MANAGER_ID\",\"requirement\":\"A boundary between an object and itself\"}}")
expect_err "$R" 'must be different objects'
R=$(rpc "$PLANNER" record_case_interface "{\"p_case_id\":\"$CASE\",\"p_interface\":{\"interface_ref\":\"S5B-XA\",\"source_object\":\"A\",\"target_object\":\"B\",\"interface_type\":\"telepathic\",\"owner_id\":\"$MANAGER_ID\",\"requirement\":\"An interface of a type the specification does not name\"}}")
expect_err "$R" 'seven §19 types'
R=$(rpc "$PLANNER" record_case_interface "{\"p_case_id\":\"$CASE\",\"p_interface\":{\"interface_ref\":\"S5B-XB\",\"source_object\":\"A\",\"target_object\":\"B\",\"interface_type\":\"physical\",\"owner_id\":\"$MANAGER_ID\",\"requirement\":\"An interface pointing at another tenant's asset\",\"source_asset_id\":\"$FOREIGN_ASSET\"}}")
expect_err "$R" 'not in this organization'

# The ASSET-BOUND interface: its endpoint IS an asset, so it joins the SAME
# node space the recorded asset dependency lives in — one graph, two edge
# sources. Overdue is DERIVED, never stored.
R=$(rpc "$PLANNER" record_case_interface "{\"p_case_id\":\"$CASE\",\"p_interface\":{\"interface_ref\":\"S5B-I8\",\"source_object\":\"Tails header tie-in point\",\"target_object\":\"New underflow skid\",\"interface_type\":\"process\",\"owner_id\":\"$MANAGER_ID\",\"requirement\":\"Hot-tap spool agreed, isolated and pressure tested before tie-in\",\"due_date\":\"$PAST\",\"source_asset_id\":\"$A1\"}}")
noerr "$R"; IF8=$(printf '%s' "$R" | field interface_id); test -n "$IF8"
test "$(jqp "$R" "x['traversalKind']")" = "functional"

R=$(rpc "$PLANNER" get_case_interface_graph "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "x['refused']")" = "False"
test "$(jqp "$R" "x['total']")" = "8"
test "$(jqp "$R" "x['overdueCount']")" = "1"
test "$(jqp "$R" "[i for i in x['interfaces'] if i['interfaceRef']=='S5B-I8'][0]['overdue']")" = "True"
test "$(jqp "$R" "[i for i in x['interfaces'] if i['interfaceRef']=='S5B-I8'][0]['daysLate']")" = "9"
# THE POINT OF D4.18: the recorded asset dependency is IN the same graph.
test "$(jqp "$R" "x['interfaceEdgeCount']")" = "8"
test "$(jqp "$R" "x['assetEdgeCount']")" = "1"
test "$(jqp "$R" "len([e for e in x['graph']['edges'] if e['source']=='asset_dependency'])")" = "1"
test "$(jqp "$R" "'$A1' in [e['supplier'] for e in x['graph']['edges']]")" = "True"
# ...and the interface edge and the asset edge meet at ONE node id.
test "$(jqp "$R" "len([e for e in x['graph']['edges'] if e['supplier']=='$A1'])")" = "2"

# A terminal move demands a note, and a CLOSED interface leaves the graph:
# the boundary has been dealt with.
R=$(rpc "$PLANNER" set_case_interface_status "{\"p_interface_id\":$IF8,\"p_status\":\"delivered\",\"p_note\":\"no\"}")
expect_err "$R" 'note saying what happened'
R=$(rpc "$PLANNER" set_case_interface_status "{\"p_interface_id\":$IF8,\"p_status\":\"delivered\",\"p_note\":\"Spool fabricated, fitted and pressure tested on the shutdown\"}")
noerr "$R"; test "$(jqp "$R" "x['stillOverdue']")" = "False"
R=$(rpc "$PLANNER" get_case_interface_graph "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "x['overdueCount']")" = "0"
IF1=$(psqlc "select id from case_interfaces where interface_ref='S5B-I1'")
R=$(rpc "$PLANNER" set_case_interface_status "{\"p_interface_id\":$IF1,\"p_status\":\"closed\",\"p_note\":\"The package was descoped and the boundary no longer exists\"}")
noerr "$R"
R=$(rpc "$PLANNER" get_case_interface_graph "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "x['interfaceEdgeCount']")" = "7"

echo "── 8. immutability, deletion and the project side of /design ───────────"

D1=$(psqlc "select id from design_finding_dispositions where finding_id=$F1 limit 1")
OUT=$(sql_must_fail "update design_finding_dispositions set outcome='rejected' where id=$D1;")
grep -qi 'not an accountability record' <<<"$OUT"
OUT=$(sql_must_fail "update design_finding_dispositions set reason='A reason edited after the fact' where id=$D1;")
grep -qi 'cannot be rewritten' <<<"$OUT"
OUT=$(sql_must_fail "delete from design_finding_dispositions where id=$D1;")
grep -qi 'not deleted' <<<"$OUT"
OUT=$(sql_must_fail "truncate design_finding_dispositions;")
grep -qi 'not truncatable' <<<"$OUT"
OUT=$(sql_must_fail "update design_review_findings set recommendation='A recommendation re-worded after it was answered' where id=$F1;")
grep -qi 'cannot be rewritten' <<<"$OUT"
OUT=$(sql_must_fail "delete from design_review_findings where id=$F1;")
grep -qi 'not deleted' <<<"$OUT"
OUT=$(sql_must_fail "delete from design_study_participants where study_id=$STUDY;")
grep -qi 'not deleted' <<<"$OUT"
OUT=$(sql_must_fail "update design_axis_scores set score=5 where development_case_id='$CASE' and axis='constructability';")
grep -qi 'cannot be rewritten' <<<"$OUT"
OUT=$(sql_must_fail "truncate design_axis_scores;")
grep -qi 'not truncatable' <<<"$OUT"
OUT=$(sql_must_fail "update case_interfaces set interface_type='data' where id=$IF8;")
grep -qi 'cannot be rewritten' <<<"$OUT"
OUT=$(sql_must_fail "delete from case_interfaces where id=$IF8;")
grep -qi 'not deleted' <<<"$OUT"
OUT=$(sql_must_fail "truncate case_interfaces;")
grep -qi 'not truncatable' <<<"$OUT"

# A client cannot write any of it directly either — every table is SELECT-only.
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/design_finding_dispositions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $MANAGER" -H 'Content-Type: application/json' \
  -d "{\"organization_id\":\"$ORG\",\"finding_id\":$F9,\"disposition_no\":1,\"outcome\":\"accepted\",\"reason\":\"A disposition posted straight at the table by a client\",\"dispositioned_by\":\"$MANAGER_ID\",\"disposition_discipline\":\"maintenance\"}")
test "$CODE" != "201"

# /design counts the PROJECT side of the one table. A case-bound review must
# not change the reliability-by-design reading.
PROJ_S=$(psqlc "select count(*) from design_studies where organization_id='$ORG' and development_case_id is null")
R=$(rpc "$PLANNER" get_project_posture '{}')
test "$(jqp "$R" "x[0]['studies_total']")" = "$PROJ_S"

echo "── 9. the repair set (5B-R1…R10) ───────────────────────────────────────"

# ── 5B-R6. THE PARENT. Every wall above is on a CHILD of design_studies, and
# each child's DELETE branch steps aside mid-cascade — so deleting the parent
# once erased every participant, finding and disposition AND cleared every gate
# blocker. Refused now for every writer, service path included.
BLOCK_BEFORE=$(psqlc "select jsonb_array_length(case_frontline_design_obligations('$CASE'::uuid))")
OUT=$(sql_must_fail "delete from design_studies where id=$STUDY;")
grep -qi 'not deleted' <<<"$OUT"
OUT=$(sql_must_fail "truncate design_studies cascade;")
grep -qi 'not truncatable' <<<"$OUT"
# ...and the two weaker shapes of the same dodge: detaching the study from the
# case, and re-kinding it so the unattended family stops matching.
OUT=$(sql_must_fail "update design_studies set development_case_id=null where id=$STUDY;")
grep -qi 'cannot be changed by ANY caller' <<<"$OUT"
OUT=$(sql_must_fail "update design_studies set study_kind='ram_study' where id=$STUDY;")
grep -qi 'cannot be changed by ANY caller' <<<"$OUT"
# TRUNCATE is revoked outright as well, as it is on the other five tables.
test "$(psqlc "select count(*) from information_schema.role_table_grants where table_name='design_studies' and privilege_type='TRUNCATE' and grantee in ('anon','authenticated','service_role')")" = "0"
# Nothing moved.
test "$(psqlc "select jsonb_array_length(case_frontline_design_obligations('$CASE'::uuid))")" = "$BLOCK_BEFORE"

# ── 5B-R3. THE SCRIBE. Recording for the room is ordinary and stays allowed —
# but it is RECORDED, and the scribe may not then answer what they wrote. The
# raiser-≠-dispositioner wall compares the ATTRIBUTED raiser, so without this
# one person could put a recommendation in a colleague's mouth and close it.
R=$(rpc "$SUPER" raise_design_review_finding "{\"p_study_id\":$STUDY,\"p_finding\":{\"finding_ref\":\"S5B-P1\",\"dimension\":\"ergonomics\",\"recommendation\":\"A recommendation the supervisor types on the technician s behalf\",\"raised_by\":\"$TECH_ID\",\"discipline\":\"maintenance\"}}")
noerr "$R"; test "$(jqp "$R" "x['byProxy']")" = "True"
FP1=$(printf '%s' "$R" | field finding_id)
test "$(psqlc "select recorded_by='$SUPER_ID' and raised_by='$TECH_ID' from design_review_findings where id=$FP1")" = "t"
# The audit ledger names the CALLER, not only the role string and the attributee.
test "$(psqlc "select count(*) from audit_events where entity_type='design_review_finding'
                and event_data->>'finding_ref'='S5B-P1' and new_state->>'recorded_by'='$SUPER_ID'
                and (new_state->>'by_proxy')::boolean")" -ge "1"
# The attributed raiser cannot answer it (as before)...
R=$(rpc "$TECH" disposition_design_finding "{\"p_finding_id\":$FP1,\"p_disposition\":{\"outcome\":\"rejected\",\"reason\":\"The person it was attributed to answering their own attributed finding\",\"discipline\":\"maintenance\"}}")
expect_err "$R" 'you raised this finding'
# ...and NEITHER CAN THE SCRIBE. This is the dodge that existed.
R=$(rpc "$SUPER" disposition_design_finding "{\"p_finding_id\":$FP1,\"p_disposition\":{\"outcome\":\"rejected\",\"reason\":\"The scribe answering the words they put in somebody else s mouth\",\"discipline\":\"operations\"}}")
expect_err "$R" 'you recorded this finding'
OUT=$(sql_must_fail "insert into design_finding_dispositions (organization_id, finding_id, disposition_no, outcome, reason, dispositioned_by, disposition_discipline)
                     values ('$ORG',$FP1,1,'rejected','The scribe answering their own scribed finding past the door','$SUPER_ID','operations');")
grep -qi 'RECORDED this finding' <<<"$OUT"
# The finding carries the scribe onto the screen, and only when it differs.
R=$(rpc "$MANAGER" get_case_frontline_review "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "[f for st in x['studies'] for f in st['findings'] if f['findingRef']=='S5B-P1'][0]['byProxy']")" = "True"
test "$(jqp "$R" "[f for st in x['studies'] for f in st['findings'] if f['findingRef']=='S5B-D1'][0]['byProxy']")" = "False"
# Answer it properly so it stops blocking the rest of the transcript.
R=$(rpc "$MANAGER" disposition_design_finding "{\"p_finding_id\":$FP1,\"p_disposition\":{\"outcome\":\"rejected\",\"reason\":\"Answered by somebody who neither raised nor recorded it\",\"discipline\":\"engineering\"}}")
noerr "$R"

# ── 5B-R4. MEMBERSHIP on the two actor columns that carried the accountability
# record. Without it §70 was string equality against a profile that need not
# exist, so an identity with NO user_profiles row — the shape of an
# unprovisioned system account — answered a maintainer, and a FOREIGN tenant s
# member did too and was then rendered onto this tenant s screen.
# Its OWN uuid, for the reason the foreign-tenant seed above states: every
# sibling smoke seeds fixture identities into the SHARED auth.users, and
# reusing one of their ids collides on the primary key when the smokes run
# in one database — which is exactly what CI does. 5555… is slice 4B's
# orphan; this one is 5b-g.
GHOST='5b9d5b9d-5b5b-4b5b-8b5b-5b9d5b9d5b9d'
psqlc "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
       values ('00000000-0000-0000-0000-000000000000','$GHOST','authenticated','authenticated','s5b-ghost@syncai.ca', extensions.crypt('Ghost123!@#', extensions.gen_salt('bf')), now(), now(), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}','{}','','','','','','','','')
       on conflict (id) do nothing;" >/dev/null
OUT=$(sql_must_fail "insert into design_finding_dispositions (organization_id, finding_id, disposition_no, outcome, reason, dispositioned_by, disposition_discipline)
                     values ('$ORG',$F9,1,'accepted','An identity with no profile at all answering a maintainer','$GHOST','engineering');")
grep -qi 'must be a member of this organization' <<<"$OUT"
OUT=$(sql_must_fail "insert into design_finding_dispositions (organization_id, finding_id, disposition_no, outcome, reason, dispositioned_by, disposition_discipline)
                     values ('$ORG',$F9,1,'accepted','A member of another tenant answering this tenant s maintainer','$FOREIGN_ID','engineering');")
grep -qi 'must be a member of this organization' <<<"$OUT"
OUT=$(sql_must_fail "insert into design_axis_scores (organization_id, development_case_id, axis, score_no, score, basis, scored_by)
                     values ('$ORG','$CASE','reliability',9,5,'A score by an identity this tenant has no profile for','$GHOST');")
grep -qi 'must be a member of this organization' <<<"$OUT"
OUT=$(sql_must_fail "insert into design_axis_scores (organization_id, development_case_id, axis, score_no, score, basis, scored_by)
                     values ('$ORG','$CASE','reliability',9,5,'A score by a member of another tenant entirely','$FOREIGN_ID');")
grep -qi 'must be a member of this organization' <<<"$OUT"

# ── 5B-R2. THE PROVENANCE BACKSTOP. The walls refuse what must never happen;
# what they ADMIT outside the RPCs used to leave nothing at all. A service-path
# participant insert is admitted (it is a real row) and now leaves a
# security_events row, so a roster written past the door is findable.
SEC_BEFORE=$(psqlc "select count(*) from security_events where organization_id='$ORG'")
psqlc "insert into design_study_participants (organization_id, study_id, participant_id, discipline, recorded_by)
       values ('$ORG',$STUDY2,'$TECH_ID','maintenance','$MANAGER_ID');" >/dev/null
SEC_AFTER=$(psqlc "select count(*) from security_events where organization_id='$ORG'")
test "$SEC_AFTER" -gt "$SEC_BEFORE"
test "$(psqlc "select count(*) from security_events where organization_id='$ORG'
                and detail like '%Design-review attendance%' and actor_label like 'service (%'")" -ge "1"

# ── 5B-R7. A CARRIER THAT CARRIES NOTHING. `frontline_acceptance_uncarried`
# cleared on requirement_id alone, so an acceptance could be discharged onto a
# requirement whose verification had FAILED — the exact failure the family
# exists to stop, with a link in front of it.
R=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"S5B-R2\",\"category\":\"maintainability\",\"requirement\":\"A davit shall be provided over the pump for lifting the rotating element\",\"source\":\"maintenance\"}}")
noerr "$R"; REQ2=$(printf '%s' "$R" | field requirement_id); test -n "$REQ2"
# A REJECTED finding carries nothing by definition.
R=$(rpc "$PLANNER" carry_design_finding_to_requirement "{\"p_finding_id\":$FP1,\"p_requirement_id\":$REQ2}")
expect_err "$R" 'there is nothing to carry'
# A requirement already known not to hold cannot discharge an acceptance. The
# FAILED state is reached the only way this platform allows — a recorded
# verification whose result was not achieved (Slice 5A refuses a typed status,
# correctly, and this smoke does not go around it).
R=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$REQ2,\"p_verification\":{\"method_code\":\"inspection\",\"procedure\":\"Walk the pump bay and confirm a davit is fitted over the rotating element\",\"acceptance_criteria\":\"A davit rated for the rotating element mass is fitted and certified\"}}")
noerr "$R"; OBL2=$(printf '%s' "$R" | field obligation_id); test -n "$OBL2"
R=$(rpc "$MANAGER" record_verification_result "{\"p_obligation_id\":\"$OBL2\",\"p_result\":\"not_achieved\",\"p_measured_note\":\"No davit is fitted and no lifting beam exists over the pump bay\"}")
noerr "$R"
test "$(psqlc "select verification_status from design_requirements where id=$REQ2")" = "failed"
R=$(rpc "$PLANNER" carry_design_finding_to_requirement "{\"p_finding_id\":$F3,\"p_requirement_id\":$REQ2}")
expect_err "$R" 'cannot carry an accepted recommendation'
# ...and when a carrier goes terminal-bad AFTERWARDS — the ordinary way it
# happens — the acceptance is a NAMED blocker again rather than silently
# discharged. Same predicate, same wall, no second evaluator.
R=$(rpc "$PLANNER" create_requirement_verification "{\"p_requirement_id\":$REQ,\"p_verification\":{\"method_code\":\"inspection\",\"procedure\":\"Walk the pump bay and confirm standing access to the gland from the platform\",\"acceptance_criteria\":\"A person of average height reaches the gland standing on the platform\"}}")
noerr "$R"; OBL1=$(printf '%s' "$R" | field obligation_id); test -n "$OBL1"
R=$(rpc "$MANAGER" record_verification_result "{\"p_obligation_id\":\"$OBL1\",\"p_result\":\"not_achieved\",\"p_measured_note\":\"The platform as built stops short of the gland by about a metre\"}")
noerr "$R"
test "$(psqlc "select verification_status from design_requirements where id=$REQ")" = "failed"
R=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='frontline_acceptance_carried_by_failed_requirement'])")" = "1"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"A proceed over an acceptance carried only by a failed requirement must be refused.\",\"p_findings\":$FIND5B}")
grep -qi 'cannot pass while' <<<"$R"
# The screen shows the carrier s state, so a reader can see it too.
R=$(rpc "$MANAGER" get_case_frontline_review "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "[f for st in x['studies'] for f in st['findings'] if f['findingRef']=='S5B-D1'][0]['requirementVerification']")" = "failed"

# ── 5B-R8. A STATUS NOTE BELONGS TO THE STATUS THAT PRODUCED IT. Carrying it
# forward rendered `Agreed — "the vendor disputes the flange rating"`.
IF2=$(psqlc "select id from case_interfaces where interface_ref='S5B-I2'")
R=$(rpc "$PLANNER" set_case_interface_status "{\"p_interface_id\":$IF2,\"p_status\":\"disputed\",\"p_note\":\"The vendor disputes the flange rating on this tie-in\"}")
noerr "$R"
R=$(rpc "$PLANNER" set_case_interface_status "{\"p_interface_id\":$IF2,\"p_status\":\"agreed\",\"p_note\":null}")
noerr "$R"
test -z "$(psqlc "select coalesce(status_note,'') from case_interfaces where id=$IF2")"
# Reopening a terminal status clears closed_at, so it demands a stated reason.
R=$(rpc "$PLANNER" set_case_interface_status "{\"p_interface_id\":$IF1,\"p_status\":\"identified\",\"p_note\":null}")
expect_err "$R" 'reopening it clears the date'

# ── 5B-R11. The gate refusal DESCRIBES WHAT IT CHECKED, and carries no stray
# quote. A refusal naming the wrong specification section is a false sentence
# on the differentiator s own path.
HINT=$(psqlc "select pg_get_functiondef(oid) from pg_proc where proname='enforce_gate_review_outstanding_obligations'")
grep -q 'spec I.18, I.19, I.25' <<<"$HINT"
grep -q "frontline design" <<<"$HINT"
if grep -q "''disposition_design_finding" <<<"$HINT"; then
  echo "the refusal hint still carries the doubled-quote seam"; exit 1
fi

# ── 5B-R12. Severity orders by SEVERITY, not alphabetically (which put
# `minor` above `significant` in the very list a gate refusal prints).
psqlc "select 1" >/dev/null
R=$(rpc "$MANAGER" get_case_frontline_review "{\"p_case_id\":\"$CASE\"}")
ORDERED=$(jqp "$R" "[f['severity'] for st in x['studies'] for f in st['findings']]")
BLOCKING_FIRST=$(jqp "$R" "all(['blocking','significant','minor'].index(a) <= ['blocking','significant','minor'].index(b) for st in x['studies'] for a,b in zip([f['severity'] for f in st['findings']], [f['severity'] for f in st['findings']][1:]))")
test "$BLOCKING_FIRST" = "True"

# ── 5B-R13. The shared graph emits NO edge whose far endpoint is missing from
# `nodes`. A synthesised node carries no criticality, so `underrated` and
# `servicesLost` could never fire across the interface→asset join — which is
# the join D4.18 exists to enable.
R=$(rpc "$PLANNER" get_case_interface_graph "{\"p_case_id\":\"$CASE\"}")
DANGLING=$(jqp "$R" "len([e for e in x['graph']['edges'] if e['dependent'] not in [n['id'] for n in x['graph']['nodes']] or e['supplier'] not in [n['id'] for n in x['graph']['nodes']]])")
test "$DANGLING" = "0"
# ...and the far asset arrives with its NAME and its CRITICALITY, not as a bare id.
test "$(jqp "$R" "[n['name'] for n in x['graph']['nodes'] if n['id']=='$A2'][0]")" = "Downstream sampler"
test "$(jqp "$R" "[n['criticality'] for n in x['graph']['nodes'] if n['id']=='$A2'][0]")" = "low"

# Cross-tenant: the foreign member sees none of it, through the read and
# through the predicate.
FGN=$(token 'smoke5b-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FGN"
R=$(rpc "$FGN" get_case_frontline_review "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'not found'
R=$(rpc "$FGN" case_frontline_design_obligations "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "len(x)")" = "0"
R=$(rpc "$FGN" get_case_design_scorecard "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'not found'
R=$(rpc "$FGN" get_case_interface_graph "{\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'not found'

echo
echo 'Develop slice-5b smoke PASSED — the frontline dispositions the design before it is built, an unanswered recommendation stops the gate on the machinery that already existed, the composite refuses the axis nobody scored, and the interfaces traverse one graph rather than a second one.'

#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 1 — two-role transcript against a REAL local database.
#
# Proves, with live refusals rather than assertions:
#   * problem-first intake (D1.05): no problem statement, no case;
#   * role boundaries: technician cannot create, cannot record gates;
#   * §70 gate outcomes (D3.24/D11.24): mandatory-fail/silence blocks a
#     proceed at the DB; direct writes refused by trigger even when RLS is
#     bypassed (simulated-client psql), and invisible under real RLS;
#   * conditions contract (D3.06/II.16): conditional proceed requires owner,
#     due date, evidence requirement, consequence — each individually;
#   * stage movement gated on passing reviews; checkpoints without mandatory
#     criteria do not block (D3.37);
#   * sanction (D1.05/D3.34): fail-closed without an ADOPTED sanction
#     delegation; ceiling enforced; blocking gates enforced; no overwrite;
#     ai_admin refused by name; §70 trigger blocks the direct write;
#   * provenance promotion invariant (D3.15): AI_SUGGESTION never silently
#     promoted — refused for clients AND for the service role without the
#     recorded-human path; demotion stays easy;
#   * framework versioning (D3.22): clone → draft → adopt supersedes.
#
# Run: supabase start && scripts/ci-develop-slice1-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-1 smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'

# Runs SQL that MUST fail; captures output without tripping the ERR trap.
sql_must_fail(){ local out rc
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

DUE=$(python3 -c "import datetime; print((datetime.date.today()+datetime.timedelta(days=30)).isoformat())")

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$TECH"; test -n "$EXEC"

# Idempotent re-run: clear this smoke's artifacts (service context — the §70
# triggers admit and audit the service path by design).
psqlc "delete from development_cases where organization_id='$ORG' and title like 'SMOKE1 %';" >/dev/null
psqlc "update project_frameworks set superseded_by=null where organization_id='$ORG' and name='Reference Heavy-Industry Stage Gate';" >/dev/null
psqlc "delete from project_frameworks where organization_id='$ORG' and name='Reference Heavy-Industry Stage Gate' and version>1;" >/dev/null
psqlc "update project_frameworks set status='adopted' where organization_id='$ORG' and name='Reference Heavy-Industry Stage Gate' and version=1;" >/dev/null
psqlc "update authority_limits set status='draft', adopted_by=null, adopted_at=null where organization_id='$ORG' and action_type='sanction' and status='adopted';" >/dev/null

FW=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Reference Heavy-Industry Stage Gate' and status='adopted' limit 1")
test -n "$FW"

echo '— 1. problem-first intake —'
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE1 cold project","p_problem_statement":"","p_lifecycle_type":"brownfield"}')
expect_err "$R" 'begins with the problem'
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE1 thin","p_problem_statement":"too thin","p_lifecycle_type":"brownfield"}')
expect_err "$R" 'begins with the problem'
R=$(rpc "$TECH" create_development_case '{"p_title":"SMOKE1 tech","p_problem_statement":"Crusher availability is 82% against an 92% plan and drives lost tonnes.","p_lifecycle_type":"brownfield"}')
expect_err "$R" 'requires a planning'
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE1 crusher availability\",\"p_problem_statement\":\"Crusher availability is 82% against a 92% plan; unplanned liner failures drive an estimated 140k lost tonnes a year.\",\"p_lifecycle_type\":\"reliability_improvement\",\"p_framework_id\":\"$FW\",\"p_estimated_capex\":4500000,\"p_expected_value\":2100000}")
noerr "$R"
CASE=$(printf '%s' "$R"|field case_id); test -n "$CASE"
STAGE0=$(printf '%s' "$R"|field current_stage_key)
test "$STAGE0" = "need_identification"

echo '— 2. direct writes: invisible under RLS, refused by trigger without it —'
# (a) real client via PostgREST: RLS has no UPDATE policy — zero rows touched.
curl -sS -X PATCH "$API_URL/rest/v1/development_cases?id=eq.$CASE" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLANNER" \
  -H 'Content-Type: application/json' -d '{"status":"sanctioned"}' >/dev/null
test "$(psqlc "select status from development_cases where id='$CASE'")" = "active"
# (b) simulated client with RLS bypassed (postgres + sub claim): the §70
#     trigger itself must refuse.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='planner@syncai.ca'), true);
update development_cases set status='sanctioned', sanctioned_at=now() where id='$CASE';
rollback;")
printf '%s' "$OUT" | grep -q 'sanction_development_case'
# (c) gate review by direct insert, same simulated client: refused.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome)
select '$ORG', '$CASE', g.id, g.stage_key, 'proceed' from stage_gates g where g.framework_id='$FW' and g.name like 'G1%';
rollback;")
printf '%s' "$OUT" | grep -q 'record_case_gate_review'

echo '— 3. gate decisions: silence blocks, conditions carry their contract —'
G1=$(psqlc "select id from stage_gates where framework_id='$FW' and name like 'G1%'")
G2=$(psqlc "select id from stage_gates where framework_id='$FW' and name like 'G2%'")
G3=$(psqlc "select id from stage_gates where framework_id='$FW' and name like 'G3%'")
R=$(rpc "$TECH" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"technician should not be able to do this\"}")
expect_err "$R" 'governance or engineering role'
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_outcome\":\"pass\",\"p_note\":\"legacy vocabulary should be refused here\"}")
expect_err "$R" 'reconciled vocabulary'
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"no findings recorded at all - silence must block\"}")
expect_err "$R" 'not explicitly met'
C1=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G1 and sort_order=10")
C2=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G1 and sort_order=20")
F1=$(python3 -c "import json;print(json.dumps([{'criterion_text':'$C1','status':'met','evidence':'Problem statement quantified at 140k t/a'},{'criterion_text':'$C2','status':'met','evidence':'Do-nothing loss stated in the case record'}]))")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Both mandatory screens are explicitly met on recorded evidence.\",\"p_findings\":$F1}")
noerr "$R"

echo '— 4. stage movement is gated —'
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE\",\"p_to_stage_key\":\"design\"}")
expect_err "$R" 'one stage at a time'
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE\",\"p_to_stage_key\":\"options_analysis\"}")
noerr "$R"
# Evaluate: checkpoint has no mandatory criteria and must NOT block; G2 must.
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE\",\"p_to_stage_key\":\"design\"}")
expect_err "$R" 'no passing review'
BL=$(printf '%s' "$R"|field blocking_gates); case "$BL" in *"G2"*) ;; *) echo "expected G2 in blockers, got $BL"; exit 1;; esac
case "$BL" in *"checkpoint"*|*"Checkpoint"*) echo "checkpoint wrongly blocks: $BL"; exit 1;; *) ;; esac
# Conditional proceed on G2 — the conditions contract, piece by piece.
C21=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G2 and sort_order=10")
C22=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G2 and sort_order=20")
F2=$(python3 -c "import json;print(json.dumps([{'criterion_text':'$C21','status':'met','evidence':'Two rejected options recorded with reasons'},{'criterion_text':'$C22','status':'met','evidence':'20-year NPV per option in the case file'}]))")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G2,\"p_outcome\":\"proceed_with_conditions\",\"p_note\":\"Concept selected; liner trial data still owed.\",\"p_findings\":$F2,\"p_conditions\":[]}")
expect_err "$R" 'at least one condition'
OWNER=$(psqlc "select id from user_profiles where organization_id='$ORG' and role='reliability_engineer' limit 1")
COND_BAD=$(python3 -c "import json;print(json.dumps([{'description':'Complete the liner wear trial on crusher 2','owner_id':'$OWNER','due_date':'$DUE','evidence_requirement':'Trial report attached','consequence_if_missed':''}]))")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G2,\"p_outcome\":\"proceed_with_conditions\",\"p_note\":\"Concept selected; liner trial data still owed.\",\"p_findings\":$F2,\"p_conditions\":$COND_BAD}")
expect_err "$R" 'consequence'
COND=$(python3 -c "import json;print(json.dumps([{'description':'Complete the liner wear trial on crusher 2','owner_id':'$OWNER','due_date':'$DUE','evidence_requirement':'Trial report attached to the case','consequence_if_missed':'Concept selection reopens at G2'}]))")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G2,\"p_outcome\":\"proceed_with_conditions\",\"p_note\":\"Concept selected; liner trial data still owed.\",\"p_findings\":$F2,\"p_conditions\":$COND}")
noerr "$R"
test "$(psqlc "select count(*) from gate_conditions gc join stage_gate_reviews r on r.id=gc.review_id where r.development_case_id='$CASE'")" = "1"
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE\",\"p_to_stage_key\":\"design\"}")
noerr "$R"

echo '— 5. independent assurance SoD (slice-1 minimum) —'
R=$(rpc "$EXEC" create_development_case "{\"p_title\":\"SMOKE1 own-case assurance\",\"p_problem_statement\":\"Executive-sponsored case used to prove the sponsor cannot clear an assurance gate alone.\",\"p_lifecycle_type\":\"sustaining_capital\",\"p_framework_id\":\"$FW\"}")
noerr "$R"
CASE2=$(printf '%s' "$R"|field case_id)
R=$(rpc "$EXEC" record_case_gate_review "{\"p_case_id\":\"$CASE2\",\"p_gate_id\":$G3,\"p_outcome\":\"proceed\",\"p_note\":\"sponsor recording own assurance gate must be refused\"}")
expect_err "$R" 'segregation of duties'

echo '— 6. sanction: fail-closed authority, ceiling, gates, no overwrite —'
R=$(rpc "$PLANNER" sanction_development_case "{\"p_case_id\":\"$CASE\",\"p_note\":\"planner attempting sanction must be refused\",\"p_sanctioned_value\":4500000}")
expect_err "$R" 'no ADOPTED sanction authority'
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE\",\"p_note\":\"executive before adoption must also be refused\",\"p_sanctioned_value\":4500000}")
expect_err "$R" 'no ADOPTED sanction authority'
SANC_LIMIT=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='executive' and action_type='sanction' and status='draft' order by version desc limit 1")
test -n "$SANC_LIMIT"
R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$SANC_LIMIT\",\"p_note\":\"Adopted for CI transcript from the demo delegation instrument.\"}")
noerr "$R"
# The general recommendation/risk ladder must still resolve the GENERAL row:
GENROW=$(psqlc "select action_type from authority_limits where organization_id='$ORG' and role_key='executive' and action_type='general' and status='adopted' order by version desc limit 1" || true)
ADOPTED_KINDS=$(psqlc "select string_agg(distinct action_type, ',' order by action_type) from authority_limits where organization_id='$ORG' and role_key='executive' and status='adopted'")
case "$ADOPTED_KINDS" in *sanction*) ;; *) echo "sanction limit not adopted: $ADOPTED_KINDS"; exit 1;; esac
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE\",\"p_note\":\"value above the executive ceiling must be refused\",\"p_sanctioned_value\":26000000}")
expect_err "$R" 'exceeds the'
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE\",\"p_note\":\"gates of the current stage are not passed yet\",\"p_sanctioned_value\":4500000}")
expect_err "$R" 'no passing review'
C31=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G3 and sort_order=10")
C32=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G3 and sort_order=20")
C33=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G3 and sort_order=30")
C34=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G3 and sort_order=40")
F3=$(python3 -c "import json;print(json.dumps([{'criterion_text':c,'status':'met','evidence':'Recorded in the case file for CI'} for c in ['$C31','$C32','$C33','$C34']]))")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G3,\"p_outcome\":\"proceed\",\"p_note\":\"All four sanction-readiness mandatories explicitly met.\",\"p_findings\":$F3}")
noerr "$R"
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE\",\"p_note\":\"Sanctioned within the adopted executive delegation for the CI transcript.\",\"p_sanctioned_value\":4500000}")
noerr "$R"
test "$(psqlc "select status from development_cases where id='$CASE'")" = "sanctioned"
test "$(psqlc "select sanctioned_value::text from development_cases where id='$CASE'")" = "4500000"
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like '%sanctioned at %4500000%'")" != "0"
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE\",\"p_note\":\"second sanction must be refused - no overwrite\",\"p_sanctioned_value\":4500000}")
expect_err "$R" 'already sanctioned'

echo '— 7. ai_admin cannot sanction or record a gate (§70) —'
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
  -- Heal a user left by an earlier partial run with NULL token columns —
  -- GoTrue cannot scan them and 500s on login.
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
  -- Guarded separately: a prior partial run may have left the user without
  -- its identity row, and GoTrue 500s on an identity-less user.
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
R=$(rpc "$AIBOT" sanction_development_case "{\"p_case_id\":\"$CASE2\",\"p_note\":\"the AI-operator identity must be refused by name\",\"p_sanctioned_value\":1}")
expect_err "$R" 'AI-operator identity'
R=$(rpc "$AIBOT" record_case_gate_review "{\"p_case_id\":\"$CASE2\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"the AI-operator identity must be refused by name\"}")
expect_err "$R" 'AI-operator identity'

echo '— 8. provenance promotion invariant —'
AIROW=$(psqlc "select id from stage_gate_criteria where gate_id=$G3 and source_authority='AI_SUGGESTION' limit 1")
test -n "$AIROW"
# (a) client raise via RPC: role-gated.
R=$(rpc "$PLANNER" promote_requirement_authority "{\"p_criterion_id\":$AIROW,\"p_to_authority\":\"CORPORATE_STANDARD\",\"p_note\":\"planner must not be able to promote provenance\"}")
expect_err "$R" 'executive or administrator'
# (b) service-side raise WITHOUT the recorded-human path: refused by trigger.
OUT=$(sql_must_fail "update stage_gate_criteria set source_authority='CORPORATE_STANDARD' where id=$AIROW;")
printf '%s' "$OUT" | grep -q 'promote_requirement_authority'
# (c) simulated client, RLS bypassed: still refused.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='executive@syncai.ca'), true);
update stage_gate_criteria set source_authority='CORPORATE_STANDARD' where id=$AIROW;
rollback;")
test -n "$OUT" 
# (d) the sanctioned path works and records the human.
R=$(rpc "$EXEC" promote_requirement_authority "{\"p_criterion_id\":$AIROW,\"p_to_authority\":\"BEST_PRACTICE\",\"p_note\":\"Confirmed against our own procurement practice notes for the transcript.\"}")
noerr "$R"
test "$(psqlc "select source_authority from stage_gate_criteria where id=$AIROW")" = "BEST_PRACTICE"
test "$(psqlc "select authority_promoted_by is not null from stage_gate_criteria where id=$AIROW")" = "t"
# (e) demotion needs no ceremony (service context, no marker) — then restore.
psqlc "update stage_gate_criteria set source_authority='AI_SUGGESTION', authority_promoted_by=null, authority_promoted_at=null, authority_promotion_note=null where id=$AIROW;" >/dev/null
test "$(psqlc "select source_authority from stage_gate_criteria where id=$AIROW")" = "AI_SUGGESTION"

echo '— 9. framework versioning: clone → draft → adopt supersedes —'
R=$(rpc "$EXEC" create_project_framework_version "{\"p_source_id\":\"$FW\"}")
noerr "$R"
FW2=$(printf '%s' "$R"|field framework_id); test -n "$FW2"
test "$(psqlc "select count(*) from stage_gates where framework_id='$FW2'")" = "6"
test "$(psqlc "select count(*) from stage_gate_criteria sc join stage_gates g on g.id=sc.gate_id where g.framework_id='$FW2'")" = "16"
R=$(rpc "$MANAGER" adopt_project_framework "{\"p_framework_id\":\"$FW2\",\"p_note\":\"manager adoption must be refused - executive act\"}")
expect_err "$R" 'executive or administrator'
R=$(rpc "$EXEC" adopt_project_framework "{\"p_framework_id\":\"$FW2\",\"p_note\":\"Adopted v2 for the CI transcript as the demo governance profile.\"}")
noerr "$R"
test "$(psqlc "select status from project_frameworks where id='$FW'")" = "superseded"
test "$(psqlc "select status from project_frameworks where id='$FW2'")" = "adopted"

echo '— 10. the workspace read renders the whole chain —'
WS=$(rpc "$PLANNER" get_development_case "{\"p_case_id\":\"$CASE\"}")
BODY="$WS" python3 - <<'PY'
import json,os,sys
w=json.loads(os.environ['BODY'])
assert w['status']=='sanctioned', w['status']
assert w['sanction']['sanctionedValue']==4500000
assert w['framework']['sourceAuthority']=='INDUSTRY_GUIDANCE'
stages=w['stages']
assert [s['displayName'] for s in stages]==['Identify','Evaluate','Define','Execute','Operate & Close']
g1=[g for s in stages for g in s['gates'] if g['name'].startswith('G1')][0]
assert g1['latestReview']['outcome']=='proceed'
g2=[g for s in stages for g in s['gates'] if g['name'].startswith('G2')][0]
assert g2['latestReview']['outcome']=='proceed_with_conditions'
assert len(g2['latestReview']['conditions'])==1
cond=g2['latestReview']['conditions'][0]
assert cond['consequenceIfMissed'] and cond['evidenceRequirement'] and cond['owner']
cp=[g for s in stages for g in s['gates'] if g['decisionType']=='checkpoint']
assert len(cp)==1, 'checkpoint row missing'
print('workspace JSON verified: stages, gates, checkpoint, conditions, sanction')
PY

echo 'DEVELOP SLICE 1 SMOKE: ALL TRANSCRIPT STEPS PASSED'

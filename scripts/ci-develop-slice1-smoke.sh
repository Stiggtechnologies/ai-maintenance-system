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
#   * stage movement gated on passing LATEST reviews — a later terminate on
#     a gate re-blocks advance AND sanction despite an earlier proceed, and a
#     fresh proceed re-clears it; checkpoints without mandatory criteria do
#     not block (D3.37);
#   * the service path is admitted AND audited for INSERTs and DELETEs of
#     gate outcomes, not just updates — a fabricated or erased outcome always
#     leaves a security_events row;
#   * adopted-framework immutability has a persistence-boundary backstop:
#     client writes to an adopted framework's gates/criteria are refused by
#     trigger even with RLS bypassed; a service rewrite is admitted-and-
#     audited;
#   * sanction (D1.05/D3.34): fail-closed without an ADOPTED sanction
#     delegation; refused outright on a case with no governing framework
#     (zero gates is not gate discipline); ceiling enforced; blocking gates
#     enforced; no overwrite; ai_admin refused by name; §70 trigger blocks
#     the direct write;
#   * intake refuses a sponsor who is not a member of the organization;
#   * set_gate_requirement live: authoring lands on a draft clone, a tier
#     raise through it is routed to the promotion RPC, and it refuses an
#     adopted version;
#   * provenance promotion invariant (D3.15): AI_SUGGESTION never silently
#     promoted — refused for clients AND for the service role without the
#     recorded-human path; demotion stays easy;
#   * framework versioning (D3.22): clone → draft → adopt supersedes.
#
# Slice 1 rows 4–8 (steps 11–16):
#   * evidence (D11.17/D11.18): eight-class model on canonical evidence_items;
#     verification human-only (role-gated, ai_admin refused by name, method
#     mandatory, terminal states not overwritable); direct writes refused for
#     real clients (restrictive RLS) AND simulated clients with RLS bypassed;
#     THE negative test — an AI_INFERENCE row cannot reach verified without
#     the recorded human, refused for every caller INCLUDING the service
#     role; the complete-record service path is admitted and audited;
#   * deliverables (D3.26): the KB intake rail (C2.15) is the only document
#     door — submission refuses anything not in the tenant's intake register;
#     acceptance is governed (role-gated, ai_admin refused by name, owner
#     refused by segregation of duties, rejection states its reason, no
#     overwrite, trigger-backstopped, service admitted-and-audited);
#   * risks (D5.22): case binding on the ONE risks table — bind/double-bind/
#     unbind-without-reason refusals; the ROS contract gate stays untouched;
#   * decisions (D3.27/D3.28): options with the §17 vector on generalized
#     scenarios; selection human-only with mandatory rationale, evidence
#     links validated org-scoped, assumption links through the existing
#     risk_assumption_dependencies family; a made decision is frozen — no
#     re-selection, no late options, option set immutable to clients at the
#     persistence boundary, case decisions un-POSTable past restrictive RLS;
#   * actions (D11.37): pure reuse — binding on canonical recommendations,
#     approval spawning the verification obligation on the same machinery,
#     treatments of case-bound risks arriving as via_risk;
#   * the workspace read (step 16) renders all five sections from one call.
#
# Slice 1 rows 9–12 (steps 18–22):
#   * baselines (D5.26): six §20 types verbatim; versioned per (case, type);
#     approval is a recorded human act (ai_admin refused by name); PRIOR
#     VERSIONS IMMUTABLE — client writes refused even with RLS bypassed,
#     forged-approval inserts refused, the service path admitted-and-audited;
#     approval supersedes the prior approved version;
#   * gate readiness (D3.35/D13.05): GR = Σ(w·r)/Σw with the §45 override —
#     an unmet or never-assessed mandatory BLOCKS at any percentage; per-
#     category rollup with 'uncategorized' visible; blockers NAMED (mandatory
#     criteria + unresolved High/Critical case risks + open conditions); the
#     closure-rate projection refuses honestly below its thresholds (3
#     closure events; ≥1 day span) and projects a real date above them;
#   * operational readiness (D8.08/D8.11): the ONE onboarding catalog carries
#     the 13 §30 categories; case-scope membership is an audited governed
#     act; a missing item row counts as OPEN; safety/mission-critical items
#     surface as NAMED hard blockers;
#   * evidence-agent boundary (D12.07/§70): the retrieval rail answers
#     org-scoped; the agent's only write (AI_INFERENCE evidence) moves NO
#     readiness number and NO blocker — asserted by diffing get_gate_readiness
#     before and after the write;
#   * readiness integrity (20261110090400): a review carrying two findings
#     for one criterion is refused at the RPC (btrim-matched); a duplicate
#     landed through the admitted-and-audited service path collapses to the
#     latest finding instead of fanning out any count, percentage or category
#     denominator; `weight` sits inside the adopted-framework immutability
#     wall (client refused RLS-bypassed, service audited both directions).
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
# triggers admit and audit the service path by design; the deletes of verified
# evidence, accepted deliverables and decided decisions each leave their
# security_events row, which is the trigger doing its job).
psqlc "delete from development_cases where organization_id='$ORG' and title like 'SMOKE1 %';" >/dev/null
psqlc "delete from evidence_items where organization_id='$ORG' and description like 'SMOKE1 %';" >/dev/null
psqlc "delete from recommendations where organization_id='$ORG' and title like 'SMOKE1 %';" >/dev/null
psqlc "delete from risks where organization_id='$ORG' and title like 'SMOKE1 %';" >/dev/null
psqlc "delete from reliability_kb_chunks where organization_id='$ORG' and source_id like 'smoke1-%';" >/dev/null
psqlc "delete from kb_intake_documents where organization_id='$ORG' and source_id like 'smoke1-%';" >/dev/null
psqlc "delete from stage_gate_criteria where organization_id='$ORG' and criterion='SMOKE1 uncategorized advisory probe';" >/dev/null
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
# A sponsor outside the organization (or not a member at all) is refused.
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE1 foreign sponsor","p_problem_statement":"Sponsor references must resolve inside this organization, never dangle.","p_lifecycle_type":"brownfield","p_sponsor_id":"deadbeef-dead-4bad-8bad-deadbeefdead"}')
expect_err "$R" 'member of this organization'
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
# (d) the SERVICE path is admitted for insert and delete — and AUDITED for
#     both. A fabricated outcome, and its erasure, each leave a trace.
INS_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Gate review%inserted by a service caller%'")
DEL_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Gate review%deleted by a service caller%'")
SRID=$(psqlc "with r as (
  insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome)
  select '$ORG', '$CASE', g.id, g.stage_key, 'proceed' from stage_gates g where g.framework_id='$FW' and g.name like 'G1%'
  returning id
) select id from r")
test -n "$SRID"
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Gate review%inserted by a service caller%'")" = "$((INS_B+1))"
psqlc "delete from stage_gate_reviews where id=$SRID" >/dev/null
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Gate review%deleted by a service caller%'")" = "$((DEL_B+1))"
test "$(psqlc "select count(*) from stage_gate_reviews where id=$SRID")" = "0"

echo '— 2e. adopted-framework immutability: backstopped at the persistence boundary —'
G1=$(psqlc "select id from stage_gates where framework_id='$FW' and name like 'G1%'")
G2=$(psqlc "select id from stage_gates where framework_id='$FW' and name like 'G2%'")
G3=$(psqlc "select id from stage_gates where framework_id='$FW' and name like 'G3%'")
G1NAME=$(psqlc "select name from stage_gates where id=$G1")
# (a) real client via PostgREST: RLS has no write policy — zero rows touched.
curl -sS -X PATCH "$API_URL/rest/v1/stage_gates?id=eq.$G1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $MANAGER" \
  -H 'Content-Type: application/json' -d '{"name":"MUTATED AFTER ADOPTION"}' >/dev/null
test "$(psqlc "select name from stage_gates where id=$G1")" = "$G1NAME"
# (b) simulated client with RLS bypassed: the immutability trigger refuses.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update stage_gates set name='MUTATED AFTER ADOPTION' where id=$G1;
rollback;")
printf '%s' "$OUT" | grep -q 'immutable'
# (c) so does flipping a mandatory flag on the adopted framework's criteria —
#     silently disarming a gate is the same mutation.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update stage_gate_criteria set is_mandatory=false where gate_id=$G1 and is_mandatory;
rollback;")
printf '%s' "$OUT" | grep -q 'immutable'
# (d) and unmaking (or forging) an adoption by writing the status column
#     directly is refused even for an executive.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='executive@syncai.ca'), true);
update project_frameworks set status='superseded' where id='$FW';
rollback;")
printf '%s' "$OUT" | grep -q 'immutable'
# (e) the service path is admitted AND audited (then restores, audited again).
IMM_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Adopted-framework content on stage_gates%'")
psqlc "update stage_gates set risk_threshold='smoke-immutability-probe' where id=$G1" >/dev/null
test "$(psqlc "select risk_threshold from stage_gates where id=$G1")" = "smoke-immutability-probe"
psqlc "update stage_gates set risk_threshold=null where id=$G1" >/dev/null
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Adopted-framework content on stage_gates%'")" = "$((IMM_B+2))"

echo '— 3. gate decisions: silence blocks, conditions carry their contract —'
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
expect_err "$R" 'no passing latest review'
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
expect_err "$R" 'no passing latest review'
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

echo '— 6b. LATEST review is the operative one: a later terminate re-blocks —'
# CASE2 sits at need_identification. A proceed on G1, then a terminate on the
# same gate: the historical proceed must NOT keep the gate satisfied.
F1B=$(python3 -c "import json;print(json.dumps([{'criterion_text':'$C1','status':'met','evidence':'Problem statement quantified for the transcript'},{'criterion_text':'$C2','status':'met','evidence':'Do-nothing loss stated for the transcript'}]))")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE2\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"First determination: both mandatory screens explicitly met.\",\"p_findings\":$F1B}")
noerr "$R"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE2\",\"p_gate_id\":$G1,\"p_outcome\":\"terminate\",\"p_note\":\"Re-review with what we now know: the case should not proceed.\"}")
noerr "$R"
# advance must re-block on the terminated gate...
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE2\",\"p_to_stage_key\":\"options_analysis\"}")
expect_err "$R" 'no passing latest review'
BL=$(printf '%s' "$R"|field blocking_gates); case "$BL" in *"G1"*) ;; *) echo "expected G1 in blockers after terminate, got $BL"; exit 1;; esac
# ...and so must sanction, despite the adopted authority and the old proceed.
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE2\",\"p_note\":\"sanctioning past a terminated gate must be refused\",\"p_sanctioned_value\":1000}")
expect_err "$R" 'no passing latest review'
# A fresh human proceed re-clears the gate — latest wins in both directions.
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE2\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Third determination: concerns resolved, both mandatory screens met.\",\"p_findings\":$F1B}")
noerr "$R"
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE2\",\"p_to_stage_key\":\"options_analysis\"}")
noerr "$R"

echo '— 6c. a case with no governing framework cannot be sanctioned —'
R=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE1 unframed","p_problem_statement":"A case framed without a framework must still be creatable, but never sanctionable.","p_lifecycle_type":"sustaining_capital","p_estimated_capex":1000}')
noerr "$R"
CASE3=$(printf '%s' "$R"|field case_id); test -n "$CASE3"
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE3\",\"p_note\":\"sanction with zero gates configured must be refused\",\"p_sanctioned_value\":1000}")
expect_err "$R" 'no governing framework'

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

echo '— 9b. requirement authoring lives on the draft clone (set_gate_requirement) —'
G1V2=$(psqlc "select id from stage_gates where framework_id='$FW2' and name like 'G1%'")
G3V2=$(psqlc "select id from stage_gates where framework_id='$FW2' and name like 'G3%'")
R=$(rpc "$EXEC" set_gate_requirement "{\"p_gate_id\":$G1V2,\"p_criterion\":\"SMOKE1 advisory: a constructability review is scheduled\",\"p_is_mandatory\":false,\"p_source_authority\":\"BEST_PRACTICE\",\"p_category\":\"technical\",\"p_evidence_type\":\"DOCUMENTED\"}")
noerr "$R"
test "$(psqlc "select count(*) from stage_gate_criteria sc join stage_gates g on g.id=sc.gate_id where g.framework_id='$FW2'")" = "17"
# A tier raise through the authoring path is routed to the promotion RPC.
AICRIT=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G3V2 and source_authority='AI_SUGGESTION' limit 1")
test -n "$AICRIT"
R=$(rpc "$EXEC" set_gate_requirement "{\"p_gate_id\":$G3V2,\"p_criterion\":\"$AICRIT\",\"p_is_mandatory\":false,\"p_source_authority\":\"CORPORATE_STANDARD\",\"p_guidance\":\"Raising a tier through authoring must be refused and routed.\"}")
expect_err "$R" 'promote_requirement_authority'

R=$(rpc "$MANAGER" adopt_project_framework "{\"p_framework_id\":\"$FW2\",\"p_note\":\"manager adoption must be refused - executive act\"}")
expect_err "$R" 'executive or administrator'
R=$(rpc "$EXEC" adopt_project_framework "{\"p_framework_id\":\"$FW2\",\"p_note\":\"Adopted v2 for the CI transcript as the demo governance profile.\"}")
noerr "$R"
test "$(psqlc "select status from project_frameworks where id='$FW'")" = "superseded"
test "$(psqlc "select status from project_frameworks where id='$FW2'")" = "adopted"
# Once adopted, the authoring path refuses the version — change is a new clone.
R=$(rpc "$EXEC" set_gate_requirement "{\"p_gate_id\":$G1V2,\"p_criterion\":\"SMOKE1 advisory: a constructability review is scheduled\",\"p_is_mandatory\":true,\"p_source_authority\":\"BEST_PRACTICE\"}")
expect_err "$R" 'immutable'

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

echo '— 11. evidence: eight-class model; AI_INFERENCE never silently verified —'
R=$(rpc "$PLANNER" record_case_evidence "{\"p_case_id\":\"$CASE\",\"p_evidence\":{\"evidence_class\":\"GUESSED\",\"description\":\"SMOKE1 class outside the eight must be refused\",\"source_system\":\"smoke\"}}")
expect_err "$R" 'eight'
R=$(rpc "$PLANNER" record_case_evidence "{\"p_case_id\":\"$CASE\",\"p_evidence\":{\"evidence_class\":\"MEASURED\",\"description\":\"SMOKE1 vibration trend on crusher 2 drive end over a 12-week window\",\"source_system\":\"condition-monitoring\",\"data_quality\":\"good\"}}")
noerr "$R"
EV1=$(printf '%s' "$R"|field evidence_id); test -n "$EV1"
R=$(rpc "$PLANNER" record_case_evidence "{\"p_case_id\":\"$CASE\",\"p_evidence\":{\"evidence_class\":\"AI_INFERENCE\",\"description\":\"SMOKE1 model-inferred remaining liner life of nine months\",\"source_system\":\"reliability-copilot\"}}")
noerr "$R"
EV2=$(printf '%s' "$R"|field evidence_id); test -n "$EV2"
# (a) real client via PostgREST: the restrictive case policy refuses direct
#     writes to case-bound evidence — the row is untouched.
curl -sS -X PATCH "$API_URL/rest/v1/evidence_items?id=eq.$EV2" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLANNER" \
  -H 'Content-Type: application/json' -d '{"description":"MUTATED"}' >/dev/null
test "$(psqlc "select description like 'SMOKE1 %' from evidence_items where id='$EV2'")" = "t"
# (b) verification is role-gated, human-only, method-mandatory.
R=$(rpc "$TECH" verify_evidence_item "{\"p_evidence_id\":\"$EV1\",\"p_method\":\"technician verification must be refused\"}")
expect_err "$R" 'governance or engineering role'
R=$(rpc "$AIBOT" verify_evidence_item "{\"p_evidence_id\":\"$EV1\",\"p_method\":\"the AI-operator identity must be refused by name\"}")
expect_err "$R" 'AI-operator identity'
R=$(rpc "$MANAGER" verify_evidence_item "{\"p_evidence_id\":\"$EV1\",\"p_method\":\"x\"}")
expect_err "$R" 'method'
R=$(rpc "$MANAGER" verify_evidence_item "{\"p_evidence_id\":\"$EV1\",\"p_method\":\"Cross-checked against the historian export for the same window\"}")
noerr "$R"
test "$(psqlc "select verification_status from evidence_items where id='$EV1'")" = "verified"
test "$(psqlc "select verified_by is not null and verified_at is not null from evidence_items where id='$EV1'")" = "t"
R=$(rpc "$MANAGER" verify_evidence_item "{\"p_evidence_id\":\"$EV1\",\"p_method\":\"a second determination must be refused\"}")
expect_err "$R" 'not overwritable'
# (c) simulated client with RLS bypassed: the provenance trigger refuses —
#     including a rewrite of an EXISTING verification record.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update evidence_items set verification_method='forged after the fact' where id='$EV1';
rollback;")
printf '%s' "$OUT" | grep -q 'verify_evidence_item'
#     On the AI row the AI-specific rule answers first, for clients too.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update evidence_items set verification_status='verified', verified_at=now(), verification_method='forged' where id='$EV2';
rollback;")
printf '%s' "$OUT" | grep -q 'AI inference never silently'
# (d) THE negative test (D11.18): an AI_INFERENCE row cannot reach verified
#     without the recorded human — refused for EVERY caller, service included.
OUT=$(sql_must_fail "update evidence_items set verification_status='verified' where id='$EV2';")
printf '%s' "$OUT" | grep -q 'AI inference never silently'
test "$(psqlc "select verification_status from evidence_items where id='$EV2'")" = "unverified"
# (e) the service path WITH the complete recorded human is admitted AND audited.
VER_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Verification state on evidence item%service caller%'")
psqlc "update evidence_items set verification_status='verified', verified_by=(select id from auth.users where email='manager@syncai.ca'), verified_at=now(), verification_method='service correction carrying the recorded human' where id='$EV2';" >/dev/null
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Verification state on evidence item%service caller%'")" = "$((VER_B+1))"

echo '— 12. deliverables: the KB rail is the only door; acceptance is governed —'
R=$(rpc "$TECH" create_case_deliverable "{\"p_case_id\":\"$CASE\",\"p_title\":\"SMOKE1 tech deliverable\",\"p_type\":\"report\",\"p_owner_id\":\"$OWNER\"}")
expect_err "$R" 'planning'
C34ID=$(psqlc "select id from stage_gate_criteria where gate_id=$G3 and sort_order=40")
R=$(rpc "$PLANNER" create_case_deliverable "{\"p_case_id\":\"$CASE\",\"p_title\":\"SMOKE1 Estimate basis memo\",\"p_type\":\"report\",\"p_owner_id\":\"$OWNER\",\"p_requirement_id\":$C34ID,\"p_required_date\":\"$DUE\"}")
noerr "$R"
DLV=$(printf '%s' "$R"|field deliverable_id); test -n "$DLV"
R=$(rpc "$MANAGER" accept_deliverable "{\"p_deliverable_id\":\"$DLV\",\"p_decision\":\"accepted\",\"p_note\":\"accepting before submission must be refused\"}")
expect_err "$R" 'submitted'
R=$(rpc "$PLANNER" submit_deliverable "{\"p_deliverable_id\":\"$DLV\",\"p_document_id\":\"deadbeef-dead-4bad-8bad-deadbeefdead\"}")
expect_err "$R" 'intake register'
# The document arrives through the ONE rail: kb_ingest_document (C2.15).
RE=$(token 'demo@syncai.ca' 'Demo123!@#'); test -n "$RE"
R=$(rpc "$RE" kb_ingest_document "{\"p_source_id\":\"smoke1-estimate-basis\",\"p_title\":\"SMOKE1 Estimate basis memo r0\",\"p_chunks\":[{\"chunk_index\":0,\"content\":\"Estimate basis: class 3, contingency stated per line, quantities from the 60% model takeoff.\"}]}")
noerr "$R"
DOC=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='smoke1-estimate-basis'")
test -n "$DOC"
R=$(rpc "$PLANNER" submit_deliverable "{\"p_deliverable_id\":\"$DLV\",\"p_document_id\":\"$DOC\",\"p_revision\":\"B\"}")
noerr "$R"
# Segregation: the owner (the RE) cannot accept their own deliverable.
test "$(psqlc "select id::text from user_profiles where organization_id='$ORG' and role='reliability_engineer' limit 1")" = "$OWNER"
R=$(rpc "$RE" accept_deliverable "{\"p_deliverable_id\":\"$DLV\",\"p_decision\":\"accepted\",\"p_note\":\"owner self-acceptance must be refused\"}")
expect_err "$R" 'segregation of duties'
R=$(rpc "$AIBOT" accept_deliverable "{\"p_deliverable_id\":\"$DLV\",\"p_decision\":\"accepted\",\"p_note\":\"the AI-operator identity must be refused by name\"}")
expect_err "$R" 'AI-operator identity'
R=$(rpc "$MANAGER" accept_deliverable "{\"p_deliverable_id\":\"$DLV\",\"p_decision\":\"accepted\",\"p_note\":\"Estimate basis reviewed against the case file.\"}")
noerr "$R"
test "$(psqlc "select status from develop_deliverables where id='$DLV'")" = "accepted"
test "$(psqlc "select accepted_by is not null and accepted_at is not null from develop_deliverables where id='$DLV'")" = "t"
R=$(rpc "$MANAGER" accept_deliverable "{\"p_deliverable_id\":\"$DLV\",\"p_decision\":\"rejected\",\"p_note\":\"flipping an accepted record must be refused\"}")
expect_err "$R" 'not overwritable'
# Second deliverable: rejection requires its reason; direct writes are refused.
R=$(rpc "$PLANNER" create_case_deliverable "{\"p_case_id\":\"$CASE\",\"p_title\":\"SMOKE1 HAZOP close-out report\",\"p_type\":\"report\",\"p_owner_id\":\"$OWNER\"}")
noerr "$R"
DLV2=$(printf '%s' "$R"|field deliverable_id)
R=$(rpc "$PLANNER" submit_deliverable "{\"p_deliverable_id\":\"$DLV2\",\"p_document_id\":\"$DOC\"}")
noerr "$R"
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update develop_deliverables set status='accepted', accepted_by=(select id from auth.users where email='manager@syncai.ca'), accepted_at=now() where id='$DLV2';
rollback;")
printf '%s' "$OUT" | grep -q 'accept_deliverable'
R=$(rpc "$MANAGER" accept_deliverable "{\"p_deliverable_id\":\"$DLV2\",\"p_decision\":\"rejected\",\"p_note\":\"x\"}")
expect_err "$R" 'rejection states'
R=$(rpc "$MANAGER" accept_deliverable "{\"p_deliverable_id\":\"$DLV2\",\"p_decision\":\"rejected\",\"p_note\":\"Missing the sensitivity table for the liner option.\"}")
noerr "$R"
test "$(psqlc "select status from develop_deliverables where id='$DLV2'")" = "rejected"
# Service review-writes are admitted AND audited (then restored, audited again).
ACC_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Review state on deliverable%service caller%'")
psqlc "update develop_deliverables set status='accepted', accepted_by=(select id from auth.users where email='manager@syncai.ca'), accepted_at=now() where id='$DLV2';" >/dev/null
psqlc "update develop_deliverables set status='rejected', accepted_by=null, accepted_at=null where id='$DLV2';" >/dev/null
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Review state on deliverable%service caller%'")" = "$((ACC_B+2))"

echo '— 13. risks: one column on the one risks table; binding is a governed act —'
# Draft status: the ROS contract gate (enforce_risk_contract) rightly refuses
# 'identified' without the full ISO 31000 field set — risk AUTHORING is the
# live /risk surface's transcript, not this one; a draft High risk is exactly
# the "unresolved" state the readiness rollup must name.
RISK=$(psqlc "with r as (insert into risks (organization_id, title, current_risk_level, status) values ('$ORG','SMOKE1 liner supply single-source exposure','High','draft') returning id) select id from r")
test -n "$RISK"
R=$(rpc "$TECH" bind_risk_to_development_case "{\"p_risk_id\":\"$RISK\",\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'planning'
R=$(rpc "$PLANNER" bind_risk_to_development_case "{\"p_risk_id\":\"$RISK\",\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(psqlc "select development_case_id::text from risks where id='$RISK'")" = "$CASE"
R=$(rpc "$PLANNER" bind_risk_to_development_case "{\"p_risk_id\":\"$RISK\",\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'already bound'
R=$(rpc "$PLANNER" bind_risk_to_development_case "{\"p_risk_id\":\"$RISK\",\"p_case_id\":null}")
expect_err "$R" 'records why'

echo '— 14. decisions: comparable options, evidence+assumption links, human-only selection, frozen record —'
R=$(rpc "$TECH" create_case_decision "{\"p_case_id\":\"$CASE\",\"p_question\":\"technician framing must be refused\"}")
expect_err "$R" 'planning'
R=$(rpc "$PLANNER" create_case_decision "{\"p_case_id\":\"$CASE\",\"p_question\":\"SMOKE1 Which liner strategy carries the 20-year crusher duty?\",\"p_required_date\":\"$DUE\"}")
noerr "$R"
DEC=$(printf '%s' "$R"|field decision_id); test -n "$DEC"
R=$(rpc "$PLANNER" add_decision_option "{\"p_decision_id\":\"$DEC\",\"p_label\":\"Composite liner, 2-year change-out\",\"p_capex\":1800000,\"p_lifecycle_cost\":5200000,\"p_risk_effect\":\"single-source supply exposure\",\"p_reliability_effect\":\"wear rate halved on trial data\"}")
noerr "$R"
OPT1=$(printf '%s' "$R"|field option_id); test -n "$OPT1"
R=$(rpc "$PLANNER" add_decision_option "{\"p_decision_id\":\"$DEC\",\"p_label\":\"OEM steel liner, annual change-out\",\"p_capex\":900000,\"p_lifecycle_cost\":6100000}")
noerr "$R"
OPT2=$(printf '%s' "$R"|field option_id); test -n "$OPT2"
# A supporting assumption on the case-bound risk (the one assumption family).
ASM=$(psqlc "with r as (insert into risk_assumptions (organization_id, risk_id, statement, owner_id, confidence, trigger_for_review) values ('$ORG','$RISK','SMOKE1 the liner OEM continues to supply the composite variant','$OWNER',70,'OEM notifies discontinuation or lead time exceeds 26 weeks') returning id) select id from r")
test -n "$ASM"
R=$(rpc "$AIBOT" select_decision_option "{\"p_decision_id\":\"$DEC\",\"p_option_id\":\"$OPT1\",\"p_rationale\":\"the AI-operator identity must be refused by name\"}")
expect_err "$R" 'AI-operator identity'
R=$(rpc "$TECH" select_decision_option "{\"p_decision_id\":\"$DEC\",\"p_option_id\":\"$OPT1\",\"p_rationale\":\"technician selection must be refused outright\"}")
expect_err "$R" 'governance or engineering'
R=$(rpc "$MANAGER" select_decision_option "{\"p_decision_id\":\"$DEC\",\"p_option_id\":\"$OPT1\",\"p_rationale\":\"too thin\"}")
expect_err "$R" '20 characters'
R=$(rpc "$MANAGER" select_decision_option "{\"p_decision_id\":\"$DEC\",\"p_option_id\":\"$OPT1\",\"p_rationale\":\"Foreign evidence links must be refused before anything is written.\",\"p_evidence_item_ids\":[\"deadbeef-dead-4bad-8bad-deadbeefdead\"]}")
expect_err "$R" 'does not resolve'
R=$(rpc "$MANAGER" select_decision_option "{\"p_decision_id\":\"$DEC\",\"p_option_id\":\"$OPT1\",\"p_rationale\":\"Composite lifecycle cost is lower on the verified wear data; supply exposure carried on the case risk.\",\"p_evidence_item_ids\":[\"$EV1\"],\"p_assumption_ids\":[\"$ASM\"]}")
noerr "$R"
test "$(psqlc "select selected_option_id::text from decisions where id='$DEC'")" = "$OPT1"
test "$(psqlc "select selected_by is not null and selected_at is not null from decisions where id='$DEC'")" = "t"
test "$(psqlc "select count(*) from risk_assumption_dependencies where subject_type='decision' and subject_id='$DEC'")" = "1"
R=$(rpc "$MANAGER" select_decision_option "{\"p_decision_id\":\"$DEC\",\"p_option_id\":\"$OPT2\",\"p_rationale\":\"a second selection must be refused - no overwrite of a made decision\"}")
expect_err "$R" 'already been made'
R=$(rpc "$PLANNER" add_decision_option "{\"p_decision_id\":\"$DEC\",\"p_label\":\"late option after the decision\"}")
expect_err "$R" 'cannot be extended'
# The decided record is frozen at the persistence boundary too.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update scenarios set capex=1 where id='$OPT1';
rollback;")
printf '%s' "$OUT" | grep -q 'judged against'
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update decisions set selected_option_id='$OPT2' where id='$DEC';
rollback;")
printf '%s' "$OUT" | grep -q 'select_decision_option'
# A real client cannot POST a case-bound decision row past the restrictive policy.
DEC_B=$(psqlc "select count(*) from decisions where development_case_id='$CASE'")
curl -sS -X POST "$API_URL/rest/v1/decisions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLANNER" \
  -H 'Content-Type: application/json' \
  -d "{\"organization_id\":\"$ORG\",\"development_case_id\":\"$CASE\",\"decision_type\":\"forged\"}" >/dev/null
test "$(psqlc "select count(*) from decisions where development_case_id='$CASE'")" = "$DEC_B"

echo '— 15. actions: pure reuse — the canonical store, bound and surfaced —'
# Approver-grade by construction: the C8 contract gate (a live guard this
# transcript must not weaken) demands the full field set before 'approved'.
DEMO_ASSET=$(psqlc "select id from assets where organization_id='$ORG' order by created_at limit 1")
test -n "$DEMO_ASSET"
REC=$(psqlc "with r as (insert into recommendations (organization_id, asset_id, title, issue, action, rationale, consequence_summary, alternatives_considered, confidence, required_approver_role, status, urgency, verification_method, required_completion_date) values ('$ORG','$DEMO_ASSET','SMOKE1 Expedite composite liner trial','Liner wear rate exceeds plan on crusher 2','Run the 90-day wear trial on crusher 2','Verified 12-week vibration and wear evidence on the case','Production: avoids repeat unplanned liner stops; safety: no change','Do nothing (keeps current wear rate); annual OEM steel change-out',75,'maintenance_manager','pending','action','Wear rate within 10 percent of model at the 90-day inspection', current_date + 90) returning id) select id from r")
test -n "$REC"
R=$(rpc "$TECH" bind_recommendation_to_case "{\"p_recommendation_id\":\"$REC\",\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'planning'
R=$(rpc "$PLANNER" bind_recommendation_to_case "{\"p_recommendation_id\":\"$REC\",\"p_case_id\":\"$CASE\"}")
noerr "$R"
# Approval spawns the verification obligation on the SAME canonical machinery.
psqlc "update recommendations set status='approved' where id='$REC';" >/dev/null
test "$(psqlc "select count(*) from verification_obligations where recommendation_id='$REC'")" = "1"
# A treatment of the case-bound risk reaches the case as via_risk — no second binding.
REC2=$(psqlc "with r as (insert into recommendations (organization_id, title, status, risk_id) values ('$ORG','SMOKE1 Dual-source the composite liner supply','pending','$RISK') returning id) select id from r")
test -n "$REC2"

echo '— 16. the workspace read renders all five sections —'
WS=$(rpc "$PLANNER" get_development_case "{\"p_case_id\":\"$CASE\"}")
BODY="$WS" EV1="$EV1" OPT1="$OPT1" python3 - <<'PY'
import json,os
w=json.loads(os.environ['BODY'])
dv=w['deliverables']; assert len(dv)==2, len(dv)
acc=[d for d in dv if d['status']=='accepted'][0]
assert acc['acceptance']['by'] and acc['requirement']['criterion'], acc
assert acc['document']['title'].startswith('SMOKE1'), acc['document']
rej=[d for d in dv if d['status']=='rejected'][0]
assert rej['reviewNote'], rej
ev=w['evidence']; assert len(ev)==2, len(ev)
ver=[e for e in ev if e['id']==os.environ['EV1']][0]
assert ver['verificationStatus']=='verified' and ver['verification']['method'], ver
ai=[e for e in ev if e['evidenceClass']=='AI_INFERENCE'][0]
assert ai['verificationStatus']=='verified'  # service correction carried the recorded human
risks=w['risks']; assert len(risks)==1 and risks[0]['currentRiskLevel']=='High', risks
decs=w['decisions']; assert len(decs)==1, len(decs)
d=decs[0]
assert len(d['options'])==2, d['options']
sel=[o for o in d['options'] if o['isSelected']]
assert len(sel)==1 and sel[0]['id']==os.environ['OPT1'], sel
assert d['selection']['rationale'] and d['selection']['by'], d['selection']
assert os.environ['EV1'] in d['evidenceItemIds'], d['evidenceItemIds']
assert len(d['assumptions'])==1 and d['assumptions'][0]['statement'].startswith('SMOKE1'), d['assumptions']
acts=w['actions']; assert len(acts)==2, acts
direct=[a for a in acts if a['binding']=='direct'][0]
assert direct['verification'] and direct['verification']['status']=='open', direct
via=[a for a in acts if a['binding']=='via_risk'][0]
assert via['riskTitle'] and 'single-source' in via['riskTitle'], via
print('workspace JSON verified: deliverables, evidence, risks, decisions, actions')
PY

echo '— 17. hardening: provenance-laundering and silent-unlink refusals —'
# The columns and links this slice adds are governed BY value at write time —
# but a governed value can also be defeated by moving it AFTER the fact. These
# are the refusals that close that: reclassifying a verified item, and clearing
# a case/decision link outside the audited RPC.
#
# (a) D11.18 laundering: relabel a VERIFIED MEASURED row to AI_INFERENCE. Even
#     with RLS bypassed (simulated client), the class-immutability trigger
#     refuses — otherwise a human verifies "MEASURED" and the row becomes a
#     "verified AI inference" no one examined as one.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update evidence_items set evidence_class='AI_INFERENCE' where id='$EV1';
rollback;")
printf '%s' "$OUT" | grep -q 'frozen once a determination'
# (b) A real client cannot silently UNLINK case evidence (RLS: the case-bound
#     row is untargetable for a client update — 0 rows, still linked).
curl -sS -X PATCH "$API_URL/rest/v1/evidence_items?id=eq.$EV1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TECH" \
  -H 'Content-Type: application/json' -d '{"development_case_id":null}' >/dev/null
test "$(psqlc "select development_case_id::text from evidence_items where id='$EV1'")" = "$CASE"
test "$(psqlc "select evidence_class from evidence_items where id='$EV1'")" = "MEASURED"
# (c) A real client cannot detach AND edit a case decision (the hijack): the
#     link and the question both survive.
curl -sS -X PATCH "$API_URL/rest/v1/decisions?id=eq.$DEC" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TECH" \
  -H 'Content-Type: application/json' -d '{"development_case_id":null,"decision_question":"HIJACKED"}' >/dev/null
test "$(psqlc "select development_case_id::text from decisions where id='$DEC'")" = "$CASE"
test "$(psqlc "select decision_question like 'SMOKE1 %' from decisions where id='$DEC'")" = "t"
# (d) A real client cannot pull an option off its decision (decision-linked
#     option untargetable — the selected option stays put).
curl -sS -X PATCH "$API_URL/rest/v1/scenarios?id=eq.$OPT1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TECH" \
  -H 'Content-Type: application/json' -d '{"decision_id":null}' >/dev/null
test "$(psqlc "select decision_id::text from scenarios where id='$OPT1'")" = "$DEC"
# (e) A case-bound action cannot be silently unbound. The column-scoped
#     provenance trigger refuses a direct link change (RLS-bypassed too),
#     naming the audited RPC; the binding survives.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='planner@syncai.ca'), true);
update recommendations set development_case_id=null where id='$REC';
rollback;")
printf '%s' "$OUT" | grep -q 'bind_recommendation_to_case'
curl -sS -X PATCH "$API_URL/rest/v1/recommendations?id=eq.$REC" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TECH" \
  -H 'Content-Type: application/json' -d '{"development_case_id":null}' >/dev/null
test "$(psqlc "select development_case_id::text from recommendations where id='$REC'")" = "$CASE"
# The AUTHORIZED links still stand and still round-trip through the workspace
# read (a non-link edit and the bind RPC were never in question — steps 11–16).

echo '— 18. baselines: six types, human approval, prior versions immutable —'
R=$(rpc "$PLANNER" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"QUALITY\",\"p_description\":\"a type outside the six must be refused\"}")
expect_err "$R" 'SCOPE, COST, SCHEDULE'
R=$(rpc "$TECH" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"COST\",\"p_description\":\"technician draft must be refused\"}")
expect_err "$R" 'planning'
R=$(rpc "$PLANNER" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"COST\",\"p_description\":\"thin\"}")
expect_err "$R" '10 characters'
R=$(rpc "$PLANNER" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"COST\",\"p_description\":\"SMOKE1 class-3 estimate as the sanction cost reference\",\"p_content\":{\"total_cost\":4500000,\"currency\":\"CAD\"}}")
noerr "$R"
BL1=$(printf '%s' "$R"|field baseline_id); test -n "$BL1"
test "$(printf '%s' "$R"|field version)" = "1"
R=$(rpc "$PLANNER" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"COST\",\"p_description\":\"a second concurrent draft must be refused\"}")
expect_err "$R" 'already exists'
R=$(rpc "$AIBOT" approve_case_baseline "{\"p_baseline_id\":\"$BL1\",\"p_note\":\"the AI-operator identity must be refused by name\"}")
expect_err "$R" 'AI-operator identity'
R=$(rpc "$TECH" approve_case_baseline "{\"p_baseline_id\":\"$BL1\",\"p_note\":\"technician approval must also be refused outright\"}")
expect_err "$R" 'governance or engineering'
R=$(rpc "$MANAGER" approve_case_baseline "{\"p_baseline_id\":\"$BL1\",\"p_note\":\"too thin\"}")
expect_err "$R" '20 characters'
R=$(rpc "$MANAGER" approve_case_baseline "{\"p_baseline_id\":\"$BL1\",\"p_note\":\"Approved as the sanction cost reference for the CI transcript.\"}")
noerr "$R"
test "$(psqlc "select status from development_baselines where id='$BL1'")" = "approved"
test "$(psqlc "select approved_by is not null and approved_at is not null from development_baselines where id='$BL1'")" = "t"
R=$(rpc "$MANAGER" approve_case_baseline "{\"p_baseline_id\":\"$BL1\",\"p_note\":\"a second approval of the same version must be refused\"}")
expect_err "$R" 'only a draft'
# (a) real client via PostgREST: no write policy — the approved row is untouched.
curl -sS -X PATCH "$API_URL/rest/v1/development_baselines?id=eq.$BL1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLANNER" \
  -H 'Content-Type: application/json' -d '{"description":"MUTATED"}' >/dev/null
test "$(psqlc "select description like 'SMOKE1 %' from development_baselines where id='$BL1'")" = "t"
# (b) simulated client with RLS bypassed: the immutability trigger refuses.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update development_baselines set description='MUTATED AFTER APPROVAL' where id='$BL1';
rollback;")
printf '%s' "$OUT" | grep -q 'immutable'
# (c) a client cannot forge an approval by inserting a row born approved.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
insert into development_baselines (organization_id, development_case_id, baseline_type, version, status, description, approved_by, approved_at, approval_note)
values ('$ORG','$CASE','SCHEDULE',1,'approved','forged approval must be refused',(select id from auth.users where email='manager@syncai.ca'),now(),'forged approval note of twenty characters');
rollback;")
printf '%s' "$OUT" | grep -q 'immutable'
# (d) nor delete the approved record.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
delete from development_baselines where id='$BL1';
rollback;")
printf '%s' "$OUT" | grep -q 'immutable'
# (e) the service path is admitted AND audited (probe, then restore — two rows).
BLA_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Approved-baseline content on development_baselines%'")
psqlc "update development_baselines set approval_note=approval_note||' (service probe)' where id='$BL1'" >/dev/null
psqlc "update development_baselines set approval_note=replace(approval_note,' (service probe)','') where id='$BL1'" >/dev/null
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Approved-baseline content on development_baselines%'")" = "$((BLA_B+2))"
# (f) version 2 supersedes version 1 on approval; the prior stays readable.
R=$(rpc "$PLANNER" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"COST\",\"p_description\":\"SMOKE1 revised estimate after the liner trial commitment\"}")
noerr "$R"
BL2=$(printf '%s' "$R"|field baseline_id)
test "$(printf '%s' "$R"|field version)" = "2"
R=$(rpc "$MANAGER" approve_case_baseline "{\"p_baseline_id\":\"$BL2\",\"p_note\":\"Approved v2 as the current cost reference for the transcript.\"}")
noerr "$R"
test "$(psqlc "select status from development_baselines where id='$BL1'")" = "superseded"
test "$(psqlc "select status from development_baselines where id='$BL2'")" = "approved"
WS=$(rpc "$PLANNER" get_development_case "{\"p_case_id\":\"$CASE\"}")
BODY="$WS" python3 - <<'PY18'
import json,os
w=json.loads(os.environ['BODY'])
bl=[b for b in w['baselines'] if b['baselineType']=='COST']
assert len(bl)==2, bl
assert {b['version']: b['status'] for b in bl} == {1:'superseded',2:'approved'}, bl
assert all(b['approval'] and b['approval']['by'] for b in bl), bl
print('baselines render: v1 superseded (immutable), v2 approved')
PY18

echo '— 19. gate readiness: §45 calculation, named blockers, honest projection —'
G4=$(psqlc "select id from stage_gates where framework_id='$FW' and name like 'G4%'")
# (a) G3 on the sanctioned case: 4 of 5 equal-weight criteria met → 80%, not
#     blocked; the open HIGH risk and the open G2 condition are NAMED.
READY=$(rpc "$PLANNER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G3}")
BODY="$READY" python3 - <<'PY19A'
import json,os
r=json.loads(os.environ['BODY'])
assert r.get('error') is None, r
assert r['blocked'] is False, r['blocked']
assert r['readinessPct']==80.0, r['readinessPct']
assert r['mandatoryMet']==4 and r['mandatoryTotal']==4
cats={c['category']: c for c in r['categories']}
assert cats['supply']['readinessPct']==0.0, cats.get('supply')
assert cats['technical']['readinessPct']==100.0
kinds=[b['type'] for b in r['blockers']]
assert 'mandatory_criterion' not in kinds, kinds
risk=[b for b in r['blockers'] if b['type']=='open_risk']
assert len(risk)==1 and 'single-source' in risk[0]['name'] and risk[0]['level']=='High', risk
cond=[b for b in r['blockers'] if b['type']=='open_condition']
assert len(cond)==1 and 'liner wear trial' in cond[0]['name'], cond
dlv=[c for c in r['criteria'] if c['deliverables']['accepted']>0]
assert len(dlv)==1, dlv  # the accepted estimate-basis memo rides its criterion
# projection: 4 closure events landed in ONE review — sub-day span refusal.
p=r['projection']
assert p['available'] is False and 'sub-day' in p['reason'], p
print('G3 readiness: 80%, not blocked, risk+condition named, sub-day refusal')
PY19A
# (b) G4 never assessed: BLOCKED at 0%%, both mandatories named, projection
#     refuses with the spec sentence — and the §80 headline count is 4
#     (2 mandatory + 1 risk + 1 condition).
READY=$(rpc "$PLANNER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G4}")
BODY="$READY" python3 - <<'PY19B'
import json,os
r=json.loads(os.environ['BODY'])
assert r['blocked'] is True
assert r['readinessPct']==0.0, r['readinessPct']
mand=[b for b in r['blockers'] if b['type']=='mandatory_criterion']
assert len(mand)==2 and all(b['status']=='never_assessed' for b in mand), mand
assert len(r['blockers'])==4, [b['type'] for b in r['blockers']]
p=r['projection']
assert p['available'] is False and 'not yet: 0 of 3 closure events recorded' in p['reason'], p
print('G4 readiness: BLOCKED, blockers named (4), refusal verbatim')
PY19B
# (c) a criterion with NO category rolls up as uncategorized — visibly.
#     (Service write onto the adopted framework: admitted AND audited by the
#     requirement-immutability backstop — the audit rows are the trigger
#     working, and the probe is removed right after.)
psqlc "insert into stage_gate_criteria (organization_id, stage_key, gate_id, criterion, is_mandatory, sort_order) select '$ORG', g.stage_key, g.id, 'SMOKE1 uncategorized advisory probe', false, 900 from stage_gates g where g.id=$G4" >/dev/null
READY=$(rpc "$PLANNER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G4}")
BODY="$READY" python3 - <<'PY19C'
import json,os
r=json.loads(os.environ['BODY'])
cats=[c['category'] for c in r['categories']]
assert 'uncategorized' in cats, cats
assert cats[-1]=='uncategorized', cats  # ranked last, never dropped
print('uncategorized criterion visible in the rollup:', cats)
PY19C
psqlc "delete from stage_gate_criteria where organization_id='$ORG' and criterion='SMOKE1 uncategorized advisory probe'" >/dev/null
# (d) weight is configuration with an authoring path: on a DRAFT clone only.
R=$(rpc "$EXEC" create_project_framework_version "{\"p_source_id\":\"$FW2\"}")
noerr "$R"
FW3=$(printf '%s' "$R"|field framework_id)
G1V3=$(psqlc "select id from stage_gates where framework_id='$FW3' and name like 'G1%'")
R=$(rpc "$EXEC" set_gate_requirement "{\"p_gate_id\":$G1V3,\"p_criterion\":\"SMOKE1 weighted probe criterion\",\"p_is_mandatory\":false,\"p_source_authority\":\"BEST_PRACTICE\",\"p_weight\":0}")
expect_err "$R" 'positive'
R=$(rpc "$EXEC" set_gate_requirement "{\"p_gate_id\":$G1V3,\"p_criterion\":\"SMOKE1 weighted probe criterion\",\"p_is_mandatory\":false,\"p_source_authority\":\"BEST_PRACTICE\",\"p_weight\":3}")
noerr "$R"
test "$(psqlc "select weight::text from stage_gate_criteria where gate_id=$G1V3 and criterion='SMOKE1 weighted probe criterion'")" = "3"
# the clone carried the configured weights forward (v2 defaults were 1.0).
test "$(psqlc "select count(distinct weight) from stage_gate_criteria sc join stage_gates g on g.id=sc.gate_id where g.framework_id='$FW3'")" = "2"
psqlc "delete from project_frameworks where id='$FW3'" >/dev/null
# (e) the projection with a real history: three closures across 13 days on a
#     fresh case → 3 events, 13-day span, rate 2/13/day, 2 remaining → +13d.
# (FW v1 is superseded by now — a case is created under the ADOPTED v2, and
#  the reviews land on v2's G3, whose criteria texts are the cloned same.)
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE1 projection case\",\"p_problem_statement\":\"A case whose gate closure history is long enough to carry a defensible rate.\",\"p_lifecycle_type\":\"sustaining_capital\",\"p_framework_id\":\"$FW2\"}")
noerr "$R"
CASE4=$(printf '%s' "$R"|field case_id); test -n "$CASE4"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
do \$seed\$
declare v_r bigint;
begin
  insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_at, note)
  values ('$ORG','$CASE4',$G3V2,'design','hold', now()-interval '14 days','SMOKE1 projection seed A') returning id into v_r;
  insert into stage_gate_findings (organization_id, review_id, criterion_text, status)
  values ('$ORG', v_r, '$C31','met');
  insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_at, note)
  values ('$ORG','$CASE4',$G3V2,'design','hold', now()-interval '7 days','SMOKE1 projection seed B') returning id into v_r;
  insert into stage_gate_findings (organization_id, review_id, criterion_text, status)
  values ('$ORG', v_r, '$C31','met'), ('$ORG', v_r, '$C32','met');
  insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_at, note)
  values ('$ORG','$CASE4',$G3V2,'design','hold', now()-interval '1 day','SMOKE1 projection seed C') returning id into v_r;
  insert into stage_gate_findings (organization_id, review_id, criterion_text, status)
  values ('$ORG', v_r, '$C31','met'), ('$ORG', v_r, '$C32','met'), ('$ORG', v_r, '$C33','met');
end \$seed\$;
PSQL
# Expected from the DB's own clock (the projection is timezone-of-the-DB;
# the host's local date can sit a calendar day behind UTC in the evening).
EXPECTED_DATE=$(psqlc "select (now() + interval '13 days')::date")
READY=$(rpc "$PLANNER" get_gate_readiness "{\"p_case_id\":\"$CASE4\",\"p_gate_id\":$G3V2}")
BODY="$READY" EXPECTED_DATE="$EXPECTED_DATE" python3 - <<'PY19E'
import json,os
r=json.loads(os.environ['BODY'])
p=r['projection']
assert p['available'] is True, p
assert p['closureEvents']==3 and p['remaining']==2, p
assert abs(p['spanDays']-13.0) < 0.02, p
assert p['projectedDate']==os.environ['EXPECTED_DATE'], (p['projectedDate'], os.environ['EXPECTED_DATE'])
assert r['blocked'] is True  # two criteria still unmet — the date is a rate, not permission
print('projection: 3 closures / 13 days -> projected', p['projectedDate'])
PY19E

echo '— 20. operational readiness: one catalog, §30 categories, named hard blockers —'
# The 13 §30 categories are all represented in the ONE catalog.
test "$(psqlc "select count(distinct ori_category) from onboarding_requirements where ori_category is not null")" = "13"
# Case scope: honest empty before any asset is bound.
OPS=$(rpc "$PLANNER" get_case_operational_readiness "{\"p_case_id\":\"$CASE\"}")
BODY="$OPS" python3 - <<'PY20A'
import json,os
r=json.loads(os.environ['BODY'])
assert r['assetCount']==0 and 'no assets are bound' in r['note'], r
print('empty scope answered honestly')
PY20A
R=$(rpc "$TECH" bind_asset_to_development_case "{\"p_asset_id\":\"$DEMO_ASSET\",\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'planning'
R=$(rpc "$PLANNER" bind_asset_to_development_case "{\"p_asset_id\":\"$DEMO_ASSET\",\"p_case_id\":\"$CASE\"}")
noerr "$R"
R=$(rpc "$PLANNER" bind_asset_to_development_case "{\"p_asset_id\":\"$DEMO_ASSET\",\"p_case_id\":\"$CASE\"}")
expect_err "$R" 'already in'
R=$(rpc "$PLANNER" bind_asset_to_development_case "{\"p_asset_id\":\"$DEMO_ASSET\",\"p_case_id\":\"$CASE\",\"p_unbind\":true}")
expect_err "$R" 'records why'
OPS=$(rpc "$PLANNER" get_case_operational_readiness "{\"p_case_id\":\"$CASE\"}")
BODY="$OPS" python3 - <<'PY20B'
import json,os
r=json.loads(os.environ['BODY'])
assert r['assetCount']==1, r['assetCount']
cats={c['category']: c for c in r['categories']}
for needed in ['asset_master','bom','spares','pm','task_list','procedure','training',
               'inspection','condition_monitoring','vendor_support','documentation',
               'cyber','emergency_response','uncategorized']:
    assert needed in cats, (needed, sorted(cats))
er=cats['emergency_response']
assert er['satisfied']==0 and er['total']==2 and er['safetyOpen']==2, er
assert cats['uncategorized']['total']>0  # platform sections visible, never dropped
hard=r['hardBlockers']
assert any(b['kind']=='safety_mission_critical' and 'Emergency response procedures' in b['item'] for b in hard), \
    [b['item'] for b in hard][:10]
assert r['overall']['safetyOpenCount']>=3, r['overall']
assert len(hard)>0 and r['overall']['hardBlockerCount']>=len(hard), r['overall']
a=r['assets'][0]
assert a['required']>0 and 'ready' in a, a
print('per-category counts honest: emergency_response %s/%s, %s hard blockers' %
      (er['satisfied'], er['total'], r['overall']['hardBlockerCount']))
PY20B
# a missing item row counts as OPEN: drop one new-key item and the totals hold.
psqlc "delete from asset_onboarding_items where asset_id='$DEMO_ASSET' and requirement_key='s36_emergency_drill'" >/dev/null
OPS=$(rpc "$PLANNER" get_case_operational_readiness "{\"p_case_id\":\"$CASE\"}")
BODY="$OPS" python3 - <<'PY20C'
import json,os
r=json.loads(os.environ['BODY'])
er=[c for c in r['categories'] if c['category']=='emergency_response'][0]
assert er['total']==2 and er['satisfied']==0, er  # absence is not a pass
assert any(b['item']=='Emergency response walkthrough completed' and b['status']=='missing'
           for b in r['hardBlockers'])
print('absent item still counted OPEN and named (status: missing)')
PY20C
psqlc "insert into asset_onboarding_items (organization_id, asset_id, requirement_key) values ('$ORG','$DEMO_ASSET','s36_emergency_drill') on conflict do nothing" >/dev/null

echo '— 21. evidence-agent boundary: retrieval rail live; AI output moves nothing —'
# (a) the retrieval rail the agent reads: a classed tenant document answers an
#     org-scoped claim query (the same retrieve_kb_context the agent calls).
R=$(rpc "$RE" kb_ingest_document "{\"p_source_id\":\"smoke1-risk-register-practice\",\"p_title\":\"SMOKE1 Execution risk register practice note\",\"p_document_class\":\"engineering_standard\",\"p_chunks\":[{\"chunk_index\":0,\"content\":\"Execution risk register practice: every HIGH risk carries a treatment with an owner; registers are reviewed at each gate and treatments verified before sanction.\"}]}")
noerr "$R"
KB=$(rpc "$PLANNER" retrieve_kb_context "{\"p_query\":\"execution risk register treatments\",\"p_claim_type\":\"analysis_method\",\"p_limit\":4}")
BODY="$KB" python3 - <<'PY21A'
import json,os
rows=json.loads(os.environ['BODY'])
assert isinstance(rows,list) and any('SMOKE1 Execution risk register practice' in r['title'] for r in rows), \
    [r.get('title') for r in rows][:5]
print('retrieval rail answered with the tenant document')
PY21A
# (b) §70 structurally: an AI_INFERENCE evidence write (the agent'"'"'s ONLY
#     write path, via the governed RPC) changes NO readiness number and NO
#     blocker — only the honestly-labelled AI counter moves.
C31ID=$(psqlc "select id from stage_gate_criteria where gate_id=$G3 and sort_order=10")
BEFORE=$(rpc "$PLANNER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G3}")
R=$(rpc "$PLANNER" record_case_evidence "{\"p_case_id\":\"$CASE\",\"p_evidence\":{\"evidence_class\":\"AI_INFERENCE\",\"description\":\"SMOKE1 agent finding: execution risk register coverage inferred from case documents\",\"source_system\":\"develop-evidence-agent\",\"source_reference\":\"criterion:$C31ID\"}}")
noerr "$R"
AFTER=$(rpc "$PLANNER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G3}")
BEFORE="$BEFORE" AFTER="$AFTER" python3 - <<'PY21B'
import json,os
b=json.loads(os.environ['BEFORE']); a=json.loads(os.environ['AFTER'])
assert a['readinessPct']==b['readinessPct']==80.0
assert a['blocked']==b['blocked']==False
assert [x['type'] for x in a['blockers']]==[x['type'] for x in b['blockers']]
assert a['categories']==b['categories']
assert a['evidenceSummary']['aiInferenceUnverified']==b['evidenceSummary']['aiInferenceUnverified']+1
print('AI_INFERENCE write moved nothing: %s%% before and after; AI counter %s -> %s' %
      (a['readinessPct'], b['evidenceSummary']['aiInferenceUnverified'], a['evidenceSummary']['aiInferenceUnverified']))
PY21B

echo '— 22. readiness integrity: duplicate findings refused / never fan out; adopted weight immutable —'
# (a) the record RPC refuses a review carrying two findings for one criterion
#     (btrim-matched — whitespace does not smuggle a duplicate past it).
CRIT22=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G3 and is_mandatory order by sort_order limit 1")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G3,\"p_outcome\":\"hold\",\"p_note\":\"Duplicate-finding refusal probe, twenty characters plus.\",\"p_findings\":[{\"criterion_text\":\"$CRIT22\",\"status\":\"met\"},{\"criterion_text\":\" $CRIT22 \",\"status\":\"not_met\"}]}")
expect_err "$R" 'duplicate finding'
# (b) a duplicate landed through the admitted-and-audited service path cannot
#     fan out the displayed numbers: the LATERAL collapses to the LATEST
#     finding per criterion. Baseline 80.0%/not blocked (step 21); a service
#     not_met duplicate on a met mandatory flips THAT criterion honestly
#     (3 of 4 mandatory, 60%, BLOCKED, named once) — denominators never grow.
REV22=$(psqlc "select id from stage_gate_reviews where development_case_id='$CASE' and gate_id=$G3 order by reviewed_at desc, id desc limit 1")
psqlc "insert into stage_gate_findings (organization_id, review_id, criterion_text, status) values ('$ORG', $REV22, '$CRIT22', 'not_met')" >/dev/null
DUP=$(rpc "$PLANNER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G3}")
BODY="$DUP" CRIT22="$CRIT22" python3 - <<'PY22B'
import json,os
r=json.loads(os.environ['BODY']); crit=os.environ['CRIT22']
assert r['criteriaTotal']==5 and r['mandatoryTotal']==4, (r['criteriaTotal'], r['mandatoryTotal'])
assert len(r['criteria'])==5, len(r['criteria'])
assert float(r['weightSum'])==5.0, r['weightSum']
rows=[c for c in r['criteria'] if c['criterion']==crit]
assert len(rows)==1 and rows[0]['status']=='not_met', rows  # once, latest finding wins
assert r['mandatoryMet']==3 and r['readinessPct']==60.0, (r['mandatoryMet'], r['readinessPct'])
assert r['blocked'] is True
named=[b for b in r['blockers'] if b['type']=='mandatory_criterion']
assert len(named)==1 and named[0]['name']==crit, named
assert sum(c['criteriaTotal'] for c in r['categories'])==5, r['categories']
print('service-path duplicate collapsed, not fanned out: 5 criteria, 3/4 mandatory, 60.0%, BLOCKED, named once')
PY22B
psqlc "delete from stage_gate_findings sf using stage_gate_reviews sr where sf.review_id=sr.id and sr.id=$REV22 and sf.criterion_text='$CRIT22' and sf.status='not_met'" >/dev/null
RESTORED=$(rpc "$PLANNER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G3}")
BODY="$RESTORED" python3 - <<'PY22C'
import json,os
r=json.loads(os.environ['BODY'])
assert r['readinessPct']==80.0 and r['blocked'] is False and r['mandatoryMet']==4, \
    (r['readinessPct'], r['blocked'], r['mandatoryMet'])
print('duplicate removed: back to 80.0%, not blocked')
PY22C
# (c) weight is inside the adopted-framework immutability wall: a client
#     cannot re-weight an adopted (or superseded) version even with RLS
#     bypassed; the service path is admitted AND audited, both ways.
SC22=$(psqlc "select id from stage_gate_criteria where gate_id=$G3 and criterion='$CRIT22'")
W22=$(psqlc "select weight::text from stage_gate_criteria where id=$SC22")
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='manager@syncai.ca'), true);
update stage_gate_criteria set weight=0.0001 where id=$SC22;
rollback;")
printf '%s' "$OUT" | grep -q 'immutable'
test "$(psqlc "select weight::text from stage_gate_criteria where id=$SC22")" = "$W22"
WAUD_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Adopted-framework requirement content%'")
psqlc "update stage_gate_criteria set weight=2.5 where id=$SC22" >/dev/null
psqlc "update stage_gate_criteria set weight=$W22 where id=$SC22" >/dev/null
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Adopted-framework requirement content%'")" = "$((WAUD_B+2))"
test "$(psqlc "select weight::text from stage_gate_criteria where id=$SC22")" = "$W22"
echo 'adopted weight: client refused, service audited both ways, value restored'

echo 'DEVELOP SLICE 1 SMOKE: ALL TRANSCRIPT STEPS PASSED'


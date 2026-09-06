#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 3D — the gate review, three agents, and the assurance
# case. Every step is a live transcript against a real local database.
#
# Steps:
#   1  gate review workflow (D3.31): the pack pre-assembles the RECORDED
#      evidence per requirement and says so when there is none; the blocker
#      list is get_gate_readiness' own; the SoD position is stated BEFORE the
#      form and matches what the act site does; opening is a governed act with
#      one open review per gate; the recorder delegates to the ONE act site so
#      every shipped refusal still fires; abandoning keeps the record.
#   2  §70 at the gate, four ways (D3.31/D12.08): the AI-operator identity
#      cannot open a review, cannot record an outcome, cannot record a gate
#      decision directly, and cannot be the recorder of a review even with RLS
#      bypassed — the persistence boundary refuses it for every writer.
#   3  the methodology agent (D12.06): a framework proposal materializes a
#      DRAFT through the shipped authoring RPCs with EVERY requirement stamped
#      AI_SUGGESTION; the AI-operator identity may propose and may NOT adopt;
#      a human adopts; proposals cannot be written or deleted directly; a
#      malformed proposal is refused whole, leaving nothing behind.
#   4  the gate agent (D12.08): the report's readiness comes from the
#      evaluator, not the caller; the risk family is counted without being
#      named; the report is immutable; the AI-operator identity may write one.
#   5  the risk agent (D12.12): advice binds to the SHIPPED advisory agent and
#      is refused when that agent could approve or accept; the AI-operator
#      identity may recommend, may NOT adopt, may NOT dismiss, and may NOT
#      accept the risk at any level; a non-finite residual is refused by name.
#   6  the assurance case (D13.06): a claim cannot be marked supported with
#      nothing linked to it, at the RPC AND at the persistence boundary; the
#      §46 confidence spread is reported without an invented aggregate;
#      contradicting evidence is a first-class link; the AI-operator identity
#      cannot rule on a claim; the last support cannot be pulled out from
#      under a supported claim.
#   8  the repair pass: every §70 door now has a wall behind it (framework
#      adoption, case sanction, gate condition closure, the lifecycle
#      decision, advice dismissal); the AI-operator identity is capped at the
#      AI_SUGGESTION tier; a planner-opened review is decidable by a manager;
#      the risk ladder survives every definer hop; a technician cannot author
#      agent output; caller JSON never raises a raw 22P02; TRUNCATE is refused;
#      a case with 3D artifacts can still be deleted; and the JWT-verified
#      edge functions refuse every unauthenticated shape.
#
#   7  the demoted-row sweep (D3.02/D3.03/D3.14/D3.24/D3.35): adopt a
#      framework, version an adopted one, add a gate to a draft, state a
#      requirement with its tier and weight, author a tailoring rule and move
#      a value threshold — every one of them from a real caller.
#   8  the repair pass: every §70 door now has a wall behind it (framework
#      adoption, case sanction, gate condition closure, the lifecycle
#      decision, advice dismissal); the AI-operator identity is capped at the
#      AI_SUGGESTION tier; a planner-opened review is decidable by a manager;
#      the risk ladder survives every definer hop; a technician cannot author
#      agent output; caller JSON never raises a raw 22P02; TRUNCATE is refused;
#      a case with 3D artifacts can still be deleted; and the JWT-verified
#      edge functions refuse every unauthenticated shape.
#
# Run: supabase start && scripts/ci-develop-slice3d-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-3d smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
RE=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$EXEC"; test -n "$RE"; test -n "$TECH"

MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
EXEC_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='executive@syncai.ca'")
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
RE_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='demo@syncai.ca'")
test -n "$MANAGER_ID"; test -n "$RE_ID"; test -n "$EXEC_ID"; test -n "$PLANNER_ID"

# The AI-operator identity, seeded exactly as the 3B/3C transcripts seed it
# (same uuid, same email), so the three smokes share one fixture in CI and
# each still stands alone.
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
AIBOT_ID='99999999-9999-4999-8999-999999999999'
AIBOT=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#')
test -n "$AIBOT"

# Idempotent re-run: clear this smoke's own artifacts (service context — the
# provenance triggers admit and audit the service path by design).
psqlc "select set_config('app.assurance_claim_write','granted',true);
       delete from assurance_claim_evidence where organization_id='$ORG'
         and claim_id in (select id from assurance_case_claims where organization_id='$ORG' and claim_ref like 'SMOKE3D%');
       delete from assurance_case_claims where organization_id='$ORG' and claim_ref like 'SMOKE3D%';" >/dev/null
psqlc "select set_config('app.treatment_advice_write','granted',true);
       delete from risk_treatment_advice where organization_id='$ORG'
         and risk_id in (select id from risks where organization_id='$ORG' and title like 'SMOKE3D %');" >/dev/null
psqlc "select set_config('app.framework_proposal_write','granted',true);
       delete from framework_proposals where organization_id='$ORG'
         and framework_id in (select id from project_frameworks where organization_id='$ORG' and name like 'SMOKE3D%');" >/dev/null
psqlc "select set_config('app.gate_agent_report_write','granted',true);
       delete from gate_agent_reports where organization_id='$ORG'
         and development_case_id in (select id from development_cases where organization_id='$ORG' and title like 'SMOKE3D %');" >/dev/null
psqlc "select set_config('app.gate_review_session_write','granted',true);
       delete from gate_review_sessions where organization_id='$ORG'
         and development_case_id in (select id from development_cases where organization_id='$ORG' and title like 'SMOKE3D %');" >/dev/null
psqlc "select set_config('app.framework_write','granted',true);
       delete from project_frameworks where organization_id='$ORG' and name like 'SMOKE3D%';" >/dev/null
# Idempotent re-run: step 7 drafts version 2 of the sustaining framework and
# step 8 reads its supersession, so a second run would find two drafts of one
# name. Stage gates/criteria cascade from the framework row.
psqlc "select set_config('app.framework_write','granted',true);
       delete from project_frameworks where organization_id='$ORG'
         and name='Sustaining Capital — Light Governance' and version > 1;" >/dev/null
psqlc "delete from development_cases where organization_id='$ORG' and title='SMOKE3D planner-opened case';" >/dev/null
psqlc "delete from development_cases where organization_id='$ORG' and title like 'SMOKE3D %';" >/dev/null
psqlc "delete from evidence_items where organization_id='$ORG' and description like 'SMOKE3D %';" >/dev/null
psqlc "delete from risks where organization_id='$ORG' and title like 'SMOKE3D %';" >/dev/null
psqlc "delete from governance_tailoring_rule_sets where organization_id='$ORG' and name like 'SMOKE3D%';" >/dev/null
psqlc "delete from kb_intake_documents where organization_id='$ORG' and source_id='smoke3d-delivery-manual';" >/dev/null

# Shared arming: one adopted framework whose G1 has requirements. The
# reference library is seeded as drafts per org (D3.02); adopting one is the
# executive act this slice makes reachable.
psqlc "select set_config('app.framework_write','granted',true);
       update project_frameworks set status='draft', adopted_by=null, adopted_at=null, superseded_by=null
       where organization_id='$ORG' and name='Sustaining Capital — Light Governance';" >/dev/null
FWID=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Sustaining Capital — Light Governance' and status='draft' order by version desc limit 1")
test -n "$FWID"

echo '— 7a. D3.02: adoption is reachable, and §70 refuses the machine —'
# §70 first, so the refusal is proven against a framework that then really is
# adopted by a human — not against one nobody could adopt anyway.
R=$(rpc "$AIBOT" adopt_project_framework "{\"p_framework_id\":\"$FWID\",\"p_note\":\"AI operator attempting to arm the governance model.\"}")
expect_err "$R" 'AI-operator identity cannot record'
R=$(rpc "$EXEC" adopt_project_framework "{\"p_framework_id\":\"$FWID\",\"p_note\":\"Adopted for the slice-3d CI transcript as demo governance.\"}")
noerr "$R"
SUSTAIN=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Sustaining Capital — Light Governance' and status='adopted' limit 1")
test -n "$SUSTAIN"
G1=$(psqlc "select id from stage_gates where framework_id='$SUSTAIN' order by sequence, id limit 1")
test -n "$G1"
G1_NAME=$(psqlc "select name from stage_gates where id=$G1")
CRIT=$(psqlc "select count(*) from stage_gate_criteria where gate_id=$G1")
test "$CRIT" -ge 1
CID=$(psqlc "select id from stage_gate_criteria where gate_id=$G1 order by sort_order, criterion limit 1")
CTEXT=$(psqlc "select criterion from stage_gate_criteria where id=$CID")

echo '— 1. the gate review workflow (D3.31) —'
# The case is created by the PLANNER, so the planner is its creator and the
# sponsor. The manager is independent of it.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3D gate review case\",\"p_problem_statement\":\"The east conveyor gearbox has failed twice in eighteen months and spares are single-sourced.\",\"p_lifecycle_type\":\"sustaining_capital\",\"p_estimated_capex\":2500000,\"p_framework_id\":\"$SUSTAIN\",\"p_sponsor_id\":\"$PLANNER_ID\"}")
noerr "$R"; CASE=$(printf '%s' "$R"|field case_id); test -n "$CASE"

# The pack: readiness is get_gate_readiness' own payload, and the per-
# requirement assembly says plainly that nothing is linked yet.
R=$(rpc "$MANAGER" get_gate_review_pack "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
noerr "$R"
test "$(jqp "$R" "x['gateName']")" = "$G1_NAME"
test "$(jqp "$R" "x['readiness']['blocked']")" = "True"
test "$(jqp "$R" "len(x['requirements'])")" -ge 1
test "$(jqp "$R" "'No deliverable and no evidence is linked' in x['requirements'][0]['assembled']['statement']")" = "True"
# The blocker list is the evaluator's, not a second query: every blocker the
# pack shows is a blocker get_gate_readiness shows.
RD=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "len(x['readiness']['blockers'])")" = "$(jqp "$RD" "len(x['blockers'])")"

# Evidence pre-assembly, once something is actually recorded and linked.
# One document through the GOVERNED intake door (the methodology agent reads
# it in step 3, and the deliverable/evidence assembly uses it here). The
# reliability_engineer role is the one kb_ingest_document admits.
R=$(rpc "$RE" kb_ingest_document '{"p_source_id":"smoke3d-delivery-manual","p_title":"SMOKE3D Delivery Manual","p_document_class":"client_supplied","p_document_type":"procedure","p_page_count":2,"p_chunks":[{"chunk_index":0,"content":"Stage 1 Identify: the problem statement is agreed with operations before any option is priced. Gate PG1 Framing closes the stage.","page_start":1,"page_end":1},{"chunk_index":1,"content":"Stage 2 Select: alternatives are compared on whole-life cost and the selected option is recorded with its basis before design begins.","page_start":2,"page_end":2}]}')
noerr "$R"
DOC=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='smoke3d-delivery-manual'")
R=$(rpc "$PLANNER" create_case_deliverable "{\"p_case_id\":\"$CASE\",\"p_title\":\"SMOKE3D gearbox failure history pack\",\"p_type\":\"study\",\"p_owner_id\":\"$PLANNER_ID\",\"p_requirement_id\":$CID}")
noerr "$R"; DELIV=$(printf '%s' "$R"|field deliverable_id); test -n "$DELIV"
R=$(rpc "$PLANNER" record_case_evidence "{\"p_case_id\":\"$CASE\",\"p_evidence\":{\"evidence_class\":\"HISTORICAL\",\"description\":\"SMOKE3D eighteen-month failure history for the east conveyor gearbox\",\"source_system\":\"CMMS\",\"source_reference\":\"criterion:$CID\"}}")
noerr "$R"; EV1=$(printf '%s' "$R"|field evidence_id); test -n "$EV1"

R=$(rpc "$MANAGER" gate_requirement_evidence "{\"p_case_id\":\"$CASE\",\"p_criterion_id\":$CID}")
noerr "$R"
test "$(jqp "$R" "x['evidenceCount']")" = "1"
test "$(jqp "$R" "len(x['deliverables'])")" = "1"
test "$(jqp "$R" "x['evidence'][0]['link']")" = "recorded against this requirement"
# The §46 composite rides along, computed or REFUSED by name — never a
# substituted default.
test "$(jqp "$R" "('evidenceConfidence' in x['evidence'][0]['confidence']) or ('error' in x['evidence'][0]['confidence'])")" = "True"

# The SoD position, stated before the form. The planner created AND sponsors
# this case; the manager is independent. On a gate that does not demand
# independence both may record, and the predicate says exactly that.
R=$(rpc "$PLANNER" get_gate_review_pack "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "x['sod']['isSponsorOrCreator']")" = "True"
test "$(jqp "$R" "x['sod']['actorRole']")" = "planner"
# A planner may frame a case and may not decide its gates — the same rule
# record_case_gate_review applies, reported before the attempt.
test "$(jqp "$R" "x['sod']['mayRecord']")" = "False"
test "$(jqp "$R" "'recorder_authority' in x['sod']['blockedBy']")" = "True"
R=$(rpc "$MANAGER" get_gate_review_pack "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "x['sod']['mayRecord']")" = "True"

# Opening is a governed act, and there is exactly one open review per gate.
R=$(rpc "$MANAGER" open_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
noerr "$R"; SESSION=$(printf '%s' "$R"|field session_id); test -n "$SESSION"
test "$(printf '%s' "$R"|field may_record)" = "True"
R=$(rpc "$RE" open_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
expect_err "$R" 'already open'

# The recorder is the ONE act site behind an SoD check: the mandatory block
# is still the shipped one, word for word.
R=$(rpc "$MANAGER" record_gate_review_outcome "{\"p_session_id\":$SESSION,\"p_outcome\":\"proceed\",\"p_note\":\"Everything the gate demands has been established and evidenced.\",\"p_findings\":[]}")
expect_err "$R" 'not explicitly met'

# A planner cannot record through the session either — the position the pack
# reported is the position the act site takes.
R=$(rpc "$PLANNER" record_gate_review_outcome "{\"p_session_id\":$SESSION,\"p_outcome\":\"hold\",\"p_note\":\"Planner attempting to record a gate outcome through the session.\",\"p_findings\":[]}")
expect_err "$R" 'cannot record this gate decision'

# A non-passing outcome needs no findings and is recorded; the session closes
# and links the review it produced.
R=$(rpc "$MANAGER" record_gate_review_outcome "{\"p_session_id\":$SESSION,\"p_outcome\":\"hold\",\"p_note\":\"Held: the failure history is recorded but the spares single-source exposure is unresolved.\",\"p_findings\":[{\"criterion_id\":$CID,\"criterion_text\":\"$CTEXT\",\"status\":\"not_met\",\"evidence\":\"SMOKE3D history pack recorded, single-source risk open\"}]}")
noerr "$R"; REVIEW=$(printf '%s' "$R"|field review_id); test -n "$REVIEW"
test "$(printf '%s' "$R"|field session_status)" = "decided"
test "$(psqlc "select status from gate_review_sessions where id=$SESSION")" = "decided"
test "$(psqlc "select review_id from gate_review_sessions where id=$SESSION")" = "$REVIEW"
# A decided session cannot record again.
R=$(rpc "$MANAGER" record_gate_review_outcome "{\"p_session_id\":$SESSION,\"p_outcome\":\"hold\",\"p_note\":\"Second decision through a closed session.\"}")
expect_err "$R" 'already decided'

# Abandoning keeps the record of an attempt, and needs a reason.
R=$(rpc "$MANAGER" open_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
noerr "$R"; SESSION2=$(printf '%s' "$R"|field session_id)
R=$(rpc "$MANAGER" abandon_gate_review "{\"p_session_id\":$SESSION2,\"p_reason\":\"no\"}")
expect_err "$R" 'state why'
R=$(rpc "$MANAGER" abandon_gate_review "{\"p_session_id\":$SESSION2,\"p_reason\":\"Deferred to the November board meeting.\"}")
noerr "$R"
test "$(psqlc "select status from gate_review_sessions where id=$SESSION2")" = "abandoned"

# A session is never written directly, and never deleted.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
insert into gate_review_sessions (organization_id, development_case_id, gate_id, opened_by)
values ('$ORG','$CASE',$G1,'$MANAGER_ID');
rollback;")
grep -qi 'cannot be written directly' <<<"$OUT"
OUT=$(sql_must_fail "begin;
delete from gate_review_sessions where id=$SESSION;
rollback;")
grep -qi 'not deleted' <<<"$OUT"

echo '— 2. §70 at the gate, four ways (D3.31/D12.08) —'
R=$(rpc "$AIBOT" open_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
expect_err "$R" 'AI-operator identity'
R=$(rpc "$AIBOT" record_case_gate_review "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"AI operator recording a gate decision directly.\"}")
expect_err "$R" 'AI-operator identity cannot record'
# The SoD predicate reports the same thing to the screen it enforces at the act.
R=$(rpc "$AIBOT" gate_review_sod_position "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_actor\":\"$AIBOT_ID\"}")
noerr "$R"
test "$(jqp "$R" "x['mayRecord']")" = "False"
test "$(jqp "$R" "'ai_operator_identity' in x['blockedBy']")" = "True"
# THE WALL BEHIND THE DOOR: even RLS-bypassed, with the governed marker set,
# a review attributed to the AI-operator identity is refused for EVERY writer.
OUT=$(sql_must_fail "begin;
select set_config('app.gate_review_write','granted',true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_by, reviewed_at, note)
select '$ORG','$CASE',$G1, g.stage_key, 'hold', '$AIBOT_ID', now(), 'service-path review attributed to the AI operator'
from stage_gates g where g.id = $G1;
rollback;")
grep -qi 'cannot be attributed to the AI-operator identity' <<<"$OUT"
# The same write with a HUMAN recorder passes that wall (the trigger refuses
# the identity, not the path) — proving the refusal is targeted, not a blanket
# service-path block that would have looked identical.
psqlc "begin;
select set_config('app.gate_review_write','granted',true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_by, reviewed_at, note)
select '$ORG','$CASE',$G1, g.stage_key, 'hold', '$MANAGER_ID', now(), 'SMOKE3D control: human recorder on the same path'
from stage_gates g where g.id = $G1;
rollback;" >/dev/null

echo '— 3. the methodology agent (D12.06) —'
test -n "$DOC"
PROPOSAL="{\"name\":\"SMOKE3D Proposed Delivery Framework\",\"basis\":\"Drawn from sections 3 and 4 of the ingested delivery manual for the CI transcript.\",\"summary\":\"A two-stage model with one decision gate, proposed by the methodology agent.\",\"project_classes\":[],\"stages\":[{\"stage_key\":\"need_identification\",\"sequence\":1,\"display_name\":\"Identify\"},{\"stage_key\":\"options_analysis\",\"sequence\":2,\"display_name\":\"Select\"}],\"gates\":[{\"stage_key\":\"need_identification\",\"name\":\"PG1 Framing\",\"sequence\":1,\"decision_type\":\"gate\"}],\"requirements\":[{\"gate\":\"PG1 Framing\",\"criterion\":\"The problem statement is agreed with operations\",\"is_mandatory\":false,\"category\":\"business\"}]}"
# The AI-operator identity MAY propose. That is the act §56 describes.
R=$(rpc "$AIBOT" propose_framework_from_document "{\"p_document_id\":\"$DOC\",\"p_proposal\":$PROPOSAL}")
noerr "$R"
PROP_FW=$(printf '%s' "$R"|field framework_id); test -n "$PROP_FW"
PROP_ID=$(printf '%s' "$R"|field proposal_id); test -n "$PROP_ID"
test "$(printf '%s' "$R"|field framework_status)" = "draft"
test "$(printf '%s' "$R"|field source_authority)" = "AI_SUGGESTION"
# EVERY requirement is stamped AI_SUGGESTION — the tier is not the agent's to
# choose, and the proposal never named one.
test "$(psqlc "select count(*) from stage_gate_criteria sc join stage_gates g on g.id=sc.gate_id where g.framework_id='$PROP_FW' and sc.source_authority<>'AI_SUGGESTION'")" = "0"
test "$(psqlc "select count(*) from stage_gate_criteria sc join stage_gates g on g.id=sc.gate_id where g.framework_id='$PROP_FW'")" -ge 1
# ...and none of them arrived MANDATORY by default.
test "$(psqlc "select count(*) from stage_gate_criteria sc join stage_gates g on g.id=sc.gate_id where g.framework_id='$PROP_FW' and sc.is_mandatory")" = "0"

# A DRAFT governs nothing, and the machine cannot put it in force.
R=$(rpc "$AIBOT" adopt_project_framework "{\"p_framework_id\":\"$PROP_FW\",\"p_note\":\"The agent adopting the framework it just wrote.\"}")
expect_err "$R" 'AI-operator identity cannot record'
R=$(rpc "$EXEC" adopt_project_framework "{\"p_framework_id\":\"$PROP_FW\",\"p_note\":\"Reviewed the machine proposal and adopted it for the CI transcript.\"}")
noerr "$R"
test "$(psqlc "select status from project_frameworks where id='$PROP_FW'")" = "adopted"
# The shelf reads adoption from the FRAMEWORK, never from the proposal row.
R=$(rpc "$EXEC" get_framework_shelf '{}')
noerr "$R"
test "$(jqp "$R" "[p['framework']['status'] for p in x['proposals'] if p['id']=='$PROP_ID'][0]")" = "adopted"

# A malformed proposal is refused WHOLE — no half-built framework survives.
BEFORE=$(psqlc "select count(*) from project_frameworks where organization_id='$ORG' and name='SMOKE3D Orphan Framework'")
BAD="{\"name\":\"SMOKE3D Orphan Framework\",\"basis\":\"A proposal whose requirement names a gate it never defined, for the CI transcript.\",\"summary\":\"Deliberately inconsistent, to prove the whole thing is refused.\",\"stages\":[{\"stage_key\":\"need_identification\",\"sequence\":1,\"display_name\":\"Identify\"}],\"gates\":[{\"stage_key\":\"need_identification\",\"name\":\"PG1\",\"sequence\":1}],\"requirements\":[{\"gate\":\"PG9\",\"criterion\":\"A requirement on a gate nobody proposed\"}]}"
R=$(rpc "$AIBOT" propose_framework_from_document "{\"p_document_id\":\"$DOC\",\"p_proposal\":$BAD}")
expect_err "$R" 'does not define'
test "$(psqlc "select count(*) from project_frameworks where organization_id='$ORG' and name='SMOKE3D Orphan Framework'")" = "$BEFORE"

# A proposal is never written or deleted directly.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
update framework_proposals set summary='tampered' where id='$PROP_ID';
rollback;")
grep -qi 'cannot be written directly' <<<"$OUT"
OUT=$(sql_must_fail "begin;
delete from framework_proposals where id='$PROP_ID';
rollback;")
grep -qi 'not deleted' <<<"$OUT"

echo '— 4. the gate agent (D12.08) —'
# The AI-operator identity MAY write a reading. Its numbers come from the
# evaluator, not from the caller: nothing in the argument list can move them.
R=$(rpc "$AIBOT" record_gate_agent_report "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_narrative\":\"Two mandatory requirements remain unevidenced; the spares exposure is the long pole.\"}")
noerr "$R"
REPORT=$(printf '%s' "$R"|field report_id); test -n "$REPORT"
test "$(printf '%s' "$R"|field advisory)" = "True"
RD=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
test "$(psqlc "select blocked from gate_agent_reports where id=$REPORT")" = "$(jqp "$RD" "'t' if x['blocked'] else 'f'")"
# The risk family is COUNTED, not named: a report row is org-readable and the
# risk-sensitivity ladder is not.
test "$(psqlc "select count(*) from gate_agent_reports r, jsonb_array_elements(r.blockers) b where r.id=$REPORT and b->>'type'='open_risk' and b->>'name' not like '%identity withheld%'")" = "0"
# The table has no column that could hold a decision, and the reading is
# immutable — a second reading dated now is honest, an edited one is not.
test "$(psqlc "select count(*) from information_schema.columns where table_name='gate_agent_reports' and column_name in ('outcome','decision','approved','approval','verdict','recommendation')")" = "0"
OUT=$(sql_must_fail "begin;
select set_config('app.gate_agent_report_write','granted',true);
update gate_agent_reports set narrative='revised after the fact' where id=$REPORT;
rollback;")
grep -qi 'immutable' <<<"$OUT"
R=$(rpc "$MANAGER" get_gate_agent_reports "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
noerr "$R"
test "$(jqp "$R" "len(x['reports'])")" -ge 1
test "$(jqp "$R" "x['reports'][0]['advisory']")" = "True"

echo '— 5. the risk agent (D12.12) —'
# The shipped advisory agents, provisioned by the shipped RPC — this file
# arms nothing itself, and says so by refusing when they are absent.
# provision_risk_advisory_agents is an admin/ai_admin act (the shipped role
# gate, unchanged) — the AI operator provisions its own advisory fleet and
# every agent is born unable to approve or accept anything.
R=$(rpc "$AIBOT" provision_risk_advisory_agents '{}')
noerr "$R"
test "$(jqp "$R" "x['may_accept']")" = "False"
test "$(jqp "$R" "x['may_approve']")" = "False"
TREAT_AGENT=$(psqlc "select id from ai_agents where organization_id='$ORG' and risk_engine_key='treatment' and status='active' order by created_at limit 1")
test -n "$TREAT_AGENT"

# The risk rides the ONE risk register, through its shipped write path — the
# same fixtures the slice-3c transcript builds, because a second risk-creation
# path would be a second risk store.
CTX=$(psqlc "insert into risk_context_nodes (organization_id, scope_kind, name, status)
             values ('$ORG','site','SMOKE3D context','adopted') returning id" | head -1)
CRP=$(psqlc "insert into risk_criteria_profiles (organization_id, context_id, name, status, basis)
             values ('$ORG','$CTX','SMOKE3D criteria','adopted','SMOKE3D transcript fixture') returning id" | head -1)
R=$(rpc "$RE" upsert_risk_objective "{\"p_objective\":{\"description\":\"SMOKE3D keep the east conveyor available through the campaign\",\"target\":\"> 97.5% availability\",\"measurement\":\"Monthly availability from the historian\",\"timeframe\":\"Every month\",\"tolerance\":\"No month below 95%\",\"objective_level\":\"site\",\"owner_id\":\"$MANAGER_ID\",\"context_id\":\"$CTX\"}}")
noerr "$R"; OBJ=$(printf '%s' "$R"|field objective_id); test -n "$OBJ"
R=$(rpc "$EXEC" adopt_risk_objective "{\"p_objective_id\":\"$OBJ\",\"p_note\":\"Adopted for the slice-3d transcript.\"}")
noerr "$R"
R=$(rpc "$RE" create_risk_assessment "{\"p_assessment\":{\"context_id\":\"$CTX\",\"criteria_profile_id\":\"$CRP\",\"title\":\"SMOKE3D single-source gearbox spares\",\"objective_id\":\"$OBJ\",\"event_description\":\"The only qualified gearbox supplier goes to a 40-week lead time\",\"current_risk_score\":72,\"current_risk_level\":\"High\",\"risk_owner_id\":\"$MANAGER_ID\",\"status\":\"identified\"}}")
noerr "$R"; RISK=$(printf '%s' "$R"|field risk_id); test -n "$RISK"
R=$(rpc "$MANAGER" bind_risk_to_development_case "{\"p_risk_id\":\"$RISK\",\"p_case_id\":\"$CASE\",\"p_reason\":\"SMOKE3D transcript: the spares exposure belongs to this case.\"}")
noerr "$R"

ADVICE_BODY="{\"workflow_step\":\"treatment\",\"recommended_strategy\":\"share\",\"label\":\"Qualify a second gearbox supplier and hold a consignment unit\",\"rationale\":\"Splitting the supply between two qualified vendors removes the single point of failure on the critical path.\",\"expected_residual\":35,\"expected_introduced\":8,\"limitations\":\"Assumes the second vendor can be qualified inside the study window; no qualification plan exists yet.\"}"
# The AI-operator identity MAY recommend.
R=$(rpc "$AIBOT" record_risk_treatment_advice "{\"p_risk_id\":\"$RISK\",\"p_advice\":$ADVICE_BODY}")
noerr "$R"; ADVICE=$(printf '%s' "$R"|field advice_id); test -n "$ADVICE"
test "$(psqlc "select agent_id from risk_treatment_advice where id='$ADVICE'")" = "$TREAT_AGENT"
# ...and may NOT act on its own recommendation, either way.
R=$(rpc "$AIBOT" adopt_risk_treatment_advice "{\"p_advice_id\":\"$ADVICE\",\"p_option\":{\"introduced_risks\":[]}}")
expect_err "$R" 'human determination'
R=$(rpc "$AIBOT" dismiss_risk_treatment_advice "{\"p_advice_id\":\"$ADVICE\",\"p_reason\":\"The agent retracting its own advice.\"}")
expect_err "$R" 'cannot dismiss its own recommendation'
# ...and may NOT accept the risk, at ANY consequence level (§62 read strictly).
R=$(rpc "$AIBOT" accept_risk "{\"p_subject_type\":\"risk\",\"p_subject_id\":\"$RISK\",\"p_risk_level\":\"High\",\"p_rationale\":\"The AI operator judging the residual acceptable for the transcript.\",\"p_compensating_controls\":\"Consignment stock and a qualified alternate supplier under contract.\",\"p_expires_at\":\"$(psqlc "select (now() + interval '90 days')::text")\",\"p_reassessment_trigger\":\"Lead time exceeds 30 weeks\"}")
expect_err "$R" 'human determination'

# A non-finite residual is refused by name, never rendered.
R=$(rpc "$AIBOT" record_risk_treatment_advice "{\"p_risk_id\":\"$RISK\",\"p_advice\":{\"workflow_step\":\"treatment\",\"recommended_strategy\":\"retain\",\"label\":\"Retain the exposure\",\"rationale\":\"Testing that a non-finite residual is refused rather than stored.\",\"expected_residual\":\"NaN\",\"limitations\":\"This advice exists only to prove the refusal.\"}}")
expect_err "$R" 'finite'
# Advice with no stated limitations is refused — §62's agent exposes uncertainty.
R=$(rpc "$AIBOT" record_risk_treatment_advice "{\"p_risk_id\":\"$RISK\",\"p_advice\":{\"workflow_step\":\"treatment\",\"recommended_strategy\":\"retain\",\"label\":\"Retain the exposure\",\"rationale\":\"Testing that missing limitations are refused rather than defaulted.\",\"expected_residual\":40,\"limitations\":\"none\"}}")
expect_err "$R" 'limitations'
# Advice cannot be written directly, and cannot be deleted.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
update risk_treatment_advice set status='adopted' where id='$ADVICE';
rollback;")
grep -qi 'cannot be written directly' <<<"$OUT"
# THE CROSS-TABLE WALL: an adoption attributed to the AI-operator identity is
# refused for EVERY writer, marker and all.
OUT=$(sql_must_fail "begin;
select set_config('app.treatment_advice_write','granted',true);
update risk_treatment_advice set adopted_by='$AIBOT_ID' where id='$ADVICE';
rollback;")
grep -qi 'Adopting a treatment is a human act' <<<"$OUT"
# A human dismisses it with a stated reason, and the record survives.
R=$(rpc "$MANAGER" dismiss_risk_treatment_advice "{\"p_advice_id\":\"$ADVICE\",\"p_reason\":\"Consignment stock is already contracted; the second-vendor qualification is out of scope this year.\"}")
noerr "$R"
test "$(psqlc "select status from risk_treatment_advice where id='$ADVICE'")" = "dismissed"
R=$(rpc "$MANAGER" get_case_treatment_advice "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(jqp "$R" "len(x['advice'])")" -ge 1
test "$(jqp "$R" "x['advice'][0]['advisory']")" = "True"

echo '— 6. the assurance case (D13.06) —'
R=$(rpc "$MANAGER" record_assurance_claim "{\"p_case_id\":\"$CASE\",\"p_claim\":{\"claim_ref\":\"SMOKE3D-C1\",\"statement\":\"The replacement gearbox arrangement can meet 97.5% availability\",\"claim_type\":\"standalone\",\"owner_id\":\"$MANAGER_ID\"}}")
noerr "$R"; CLAIM=$(printf '%s' "$R"|field claim_id); test -n "$CLAIM"
test "$(printf '%s' "$R"|field position)" = "open"

# The screen says the honest thing before anything is linked.
R=$(rpc "$MANAGER" get_case_assurance_case "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(jqp "$R" "x['claimCount']")" -ge 1
test "$(jqp "$R" "'it is an assertion' in [c for c in x['claims'] if c['claimRef']=='SMOKE3D-C1'][0]['confidence']['statement']")" = "True"

# FAIL CLOSED: supported with nothing linked, refused at the RPC...
R=$(rpc "$MANAGER" set_assurance_claim_position "{\"p_claim_id\":\"$CLAIM\",\"p_position\":\"supported\",\"p_basis\":\"Marking it supported before any evidence exists at all.\"}")
expect_err "$R" 'no evidence linked'
# ...and at the persistence boundary, marker and all.
OUT=$(sql_must_fail "begin;
select set_config('app.assurance_claim_write','granted',true);
update assurance_case_claims set claim_position='supported', position_by='$MANAGER_ID', position_at=now(),
  position_basis='Direct write marking the claim supported with nothing behind it.' where id='$CLAIM';
rollback;")
grep -qi 'cannot be marked supported' <<<"$OUT"

# A recorded link carries the basis somebody is accountable for.
R=$(rpc "$MANAGER" link_assurance_claim_evidence "{\"p_claim_id\":\"$CLAIM\",\"p_evidence_id\":\"$EV1\",\"p_basis\":\"short\",\"p_bearing\":\"supports\"}")
expect_err "$R" 'state HOW'
R=$(rpc "$MANAGER" link_assurance_claim_evidence "{\"p_claim_id\":\"$CLAIM\",\"p_evidence_id\":\"$EV1\",\"p_basis\":\"The failure history establishes the observed MTBF the availability figure is derived from.\",\"p_bearing\":\"supports\"}")
noerr "$R"; LINK=$(printf '%s' "$R"|field link_id); test -n "$LINK"

# Contradicting evidence is first class.
R=$(rpc "$PLANNER" record_case_evidence "{\"p_case_id\":\"$CASE\",\"p_evidence\":{\"evidence_class\":\"EXPERT_JUDGEMENT\",\"description\":\"SMOKE3D vendor states the 97.5% figure assumes a spares holding the site does not have\",\"source_system\":\"Vendor correspondence\"}}")
noerr "$R"; EV2=$(printf '%s' "$R"|field evidence_id)
R=$(rpc "$MANAGER" link_assurance_claim_evidence "{\"p_claim_id\":\"$CLAIM\",\"p_evidence_id\":\"$EV2\",\"p_basis\":\"The vendor's stated precondition is not met on this site today.\",\"p_bearing\":\"contradicts\"}")
noerr "$R"

# §70: the machine cannot rule on a claim.
R=$(rpc "$AIBOT" set_assurance_claim_position "{\"p_claim_id\":\"$CLAIM\",\"p_position\":\"supported\",\"p_basis\":\"The agent ruling that its own assembled evidence settles the claim.\"}")
expect_err "$R" 'human determination'

# A human rules, with a basis.
R=$(rpc "$MANAGER" set_assurance_claim_position "{\"p_claim_id\":\"$CLAIM\",\"p_position\":\"supported\",\"p_basis\":\"The failure history supports the derivation; the vendor precondition is carried as an open action.\"}")
noerr "$R"
# ...and the last support cannot then be pulled out from under it silently.
R=$(rpc "$MANAGER" unlink_assurance_claim_evidence "{\"p_link_id\":\"$LINK\",\"p_reason\":\"Removing the only supporting evidence under a supported claim.\"}")
expect_err "$R" 'last evidence behind it'

# The read: claim → evidence → confidence, with the spread and NO invented
# aggregate.
R=$(rpc "$MANAGER" get_case_assurance_case "{\"p_case_id\":\"$CASE\"}")
noerr "$R"
test "$(jqp "$R" "[c for c in x['claims'] if c['claimRef']=='SMOKE3D-C1'][0]['supportingCount']")" = "1"
test "$(jqp "$R" "[c for c in x['claims'] if c['claimRef']=='SMOKE3D-C1'][0]['contradictingCount']")" = "1"
test "$(jqp "$R" "[c for c in x['claims'] if c['claimRef']=='SMOKE3D-C1'][0]['position']")" = "supported"
test "$(jqp "$R" "'meanConfidence' in [c for c in x['claims'] if c['claimRef']=='SMOKE3D-C1'][0]['confidence']")" = "False"
test "$(jqp "$R" "set(['scoredCount','unscoredCount','highest','lowest','statement']) <= set([c for c in x['claims'] if c['claimRef']=='SMOKE3D-C1'][0]['confidence'].keys())")" = "True"
# Evidence from another case cannot be borrowed into this one's claims.
OTHER_EV=$(psqlc "select id from evidence_items where organization_id='$ORG' and (development_case_id is null or development_case_id <> '$CASE') limit 1")
if [ -n "$OTHER_EV" ]; then
  R=$(rpc "$MANAGER" link_assurance_claim_evidence "{\"p_claim_id\":\"$CLAIM\",\"p_evidence_id\":\"$OTHER_EV\",\"p_basis\":\"Borrowing another case's evidence to support this claim.\",\"p_bearing\":\"supports\"}")
  expect_err "$R" 'different development case'
fi

echo '— 7. the demoted-row sweep (D3.03/D3.14/D3.24/D3.35) —'
# D3.35: an adopted framework is immutable, so changing it means drafting the
# next version — and the clone carries stages, gates, requirements and weights.
R=$(rpc "$MANAGER" create_project_framework_version "{\"p_source_id\":\"$SUSTAIN\"}")
noerr "$R"; NEXTFW=$(printf '%s' "$R"|field framework_id); test -n "$NEXTFW"
test "$(psqlc "select status from project_frameworks where id='$NEXTFW'")" = "draft"
test "$(psqlc "select count(*) from stage_gates where framework_id='$NEXTFW'")" -ge 1

# D3.24: a gate on the draft.
NEXTSTAGE=$(psqlc "select stage_key from project_framework_stages where framework_id='$NEXTFW' order by sequence limit 1")
test -n "$NEXTSTAGE"
R=$(rpc "$MANAGER" add_framework_gate "{\"p_framework_id\":\"$NEXTFW\",\"p_stage_key\":\"$NEXTSTAGE\",\"p_name\":\"SMOKE3D Added Gate\",\"p_sequence\":9,\"p_decision_type\":\"checkpoint\"}")
noerr "$R"; NEWGATE=$(printf '%s' "$R"|field gate_id); test -n "$NEWGATE"
test "$(printf '%s' "$R"|field decision_type)" = "checkpoint"

# D3.14 / D3.35: a requirement with its provenance tier and a configured
# weight — the two links the gate found dead.
R=$(rpc "$MANAGER" set_gate_requirement "{\"p_gate_id\":$NEWGATE,\"p_criterion\":\"SMOKE3D spares strategy is agreed with operations\",\"p_is_mandatory\":true,\"p_source_authority\":\"CORPORATE_STANDARD\",\"p_category\":\"supply\",\"p_weight\":2.5}")
expect_err "$R" 'names the instrument'
R=$(rpc "$MANAGER" set_gate_requirement "{\"p_gate_id\":$NEWGATE,\"p_criterion\":\"SMOKE3D spares strategy is agreed with operations\",\"p_is_mandatory\":true,\"p_source_authority\":\"CORPORATE_STANDARD\",\"p_category\":\"supply\",\"p_guidance\":\"Corporate Materials Standard MS-14, clause 6.2 (spares strategy at sanction).\",\"p_weight\":2.5}")
noerr "$R"; NEWREQ=$(printf '%s' "$R"|field criterion_id); test -n "$NEWREQ"
test "$(psqlc "select weight from stage_gate_criteria where id=$NEWREQ")" = "2.5"
test "$(psqlc "select source_authority from stage_gate_criteria where id=$NEWREQ")" = "CORPORATE_STANDARD"
# An adopted framework refuses the same edit by name.
ADOPTED_GATE=$(psqlc "select id from stage_gates where framework_id='$SUSTAIN' limit 1")
R=$(rpc "$MANAGER" set_gate_requirement "{\"p_gate_id\":$ADOPTED_GATE,\"p_criterion\":\"SMOKE3D edit of an adopted framework\",\"p_is_mandatory\":false,\"p_source_authority\":\"BEST_PRACTICE\"}")
expect_err "$R" 'immutable'

# D3.03: rule and threshold authoring on a DRAFT rule set.
DRAFTSET=$(psqlc "select id from governance_tailoring_rule_sets where organization_id='$ORG' and status='draft' order by created_at limit 1")
test -n "$DRAFTSET"
R=$(rpc "$MANAGER" set_rule_set_thresholds "{\"p_rule_set_id\":\"$DRAFTSET\",\"p_value_thresholds\":{\"standard_from_usd\":5000000,\"elevated_from_usd\":1000000,\"full_from_usd\":100000000}}")
expect_err "$R" 'must ascend'
R=$(rpc "$MANAGER" set_rule_set_thresholds "{\"p_rule_set_id\":\"$DRAFTSET\",\"p_value_thresholds\":{\"standard_from_usd\":5000000,\"elevated_from_usd\":25000000,\"full_from_usd\":100000000}}")
noerr "$R"
test "$(psqlc "select value_thresholds->>'elevated_from_usd' from governance_tailoring_rule_sets where id='$DRAFTSET'")" = "25000000"
R=$(rpc "$MANAGER" add_tailoring_rule "{\"p_rule_set_id\":\"$DRAFTSET\",\"p_priority\":95,\"p_description\":\"SMOKE3D sustaining capital under five million takes the three-gate model\",\"p_framework_name\":\"Sustaining Capital — Light Governance\",\"p_lifecycle_types\":[\"sustaining_capital\"],\"p_max_value_usd\":5000000}")
noerr "$R"; NEWRULE=$(printf '%s' "$R"|field rule_id); test -n "$NEWRULE"
test "$(psqlc "select priority from governance_tailoring_rules where id=$NEWRULE")" = "95"

echo '— 8. the repair pass —'

echo '  8a. §70: every door now has a wall behind it, service path included'
# FRAMEWORK ADOPTION. enforce_framework_immutability has an AUDITED SERVICE
# PATH that returns `new`, and it never looked at adopted_by — so a service-key
# holder could write an adopted, immutable, machine-attributed framework. The
# RPC refusal (step 7a) was the only thing in the way.
OUT=$(sql_must_fail "begin; set local role service_role;
update project_frameworks set status='adopted', adopted_by='$AIBOT_ID', adopted_at=now()
where id='$NEXTFW';
rollback;")
grep -qi 'cannot be adopted by the AI-operator identity' <<<"$OUT"
# The SAME write with a human adopter passes: the refusal is targeted, not a
# blanket service-path block that would look identical from outside.
psqlc "begin; set local role service_role;
update project_frameworks set adopted_by='$EXEC_ID' where id='$NEXTFW';
rollback;" >/dev/null

# PROJECT SANCTION — §70's own words ("the LLM never determines … project
# sanctioned"). sanction_development_case refused it; nothing behind it did.
OUT=$(sql_must_fail "begin; set local role service_role;
update development_cases set status='sanctioned', sanctioned_by='$AIBOT_ID' where id='$CASE';
rollback;")
grep -qi 'cannot be sanctioned by the AI-operator identity' <<<"$OUT"

# GATE CONDITION CLOSURE — the unfinished half of a gate decision.
COND=$(psqlc "select id from gate_conditions where organization_id='$ORG' limit 1")
if [ -n "$COND" ]; then
  OUT=$(sql_must_fail "begin; set local role service_role;
  select set_config('app.gate_condition_write','granted',true);
  update gate_conditions set closed_by='$AIBOT_ID' where id=$COND;
  rollback;")
  grep -qi 'cannot be closed by the AI-operator identity' <<<"$OUT"
fi

# THE LIFECYCLE DECISION — the one RPC in the codebase that listed ai_admin on
# the PERMISSIVE side of a decision (accepting a HIGH-uncertainty evaluation).
ASSET=$(psqlc "select id from assets where organization_id='$ORG' limit 1")
if [ -n "$ASSET" ]; then
  LCE=$(psqlc "insert into lifecycle_evaluations (organization_id, asset_id, recommended, uncertainty_level, rationale, inputs, options)
               values ('$ORG','$ASSET','replace','high','SMOKE3D transcript fixture: a high-uncertainty evaluation.','{}'::jsonb,'[]'::jsonb) returning id" | head -1)
  R=$(rpc "$AIBOT" decide_lifecycle_evaluation "{\"p_id\":\"$LCE\",\"p_decision\":\"accepted\",\"p_note\":\"The AI operator accepting a high-uncertainty recommendation.\"}")
  expect_err "$R" '§70 human determination'
  OUT=$(sql_must_fail "begin; set local role service_role;
  update lifecycle_evaluations set decision='accepted', decided_by='$AIBOT_ID', decided_at=now() where id='$LCE';
  rollback;")
  grep -qi 'cannot be decided by the AI-operator identity' <<<"$OUT"
  psqlc "delete from lifecycle_evaluations where id='$LCE'" >/dev/null
fi

# ADVICE DISMISSAL — the RPC refused it and nothing was behind that either.
# The dismissals are the only honest signal of whether the agent is any good.
OUT=$(sql_must_fail "begin;
select set_config('app.treatment_advice_write','granted',true);
update risk_treatment_advice set dismissed_by='$AIBOT_ID' where id='$ADVICE';
rollback;")
grep -qi 'human judgement about a machine' <<<"$OUT"

echo '  8b. the AI-operator identity states requirements at AI_SUGGESTION only'
# It could mint a MANDATORY requirement at the REGULATION tier from scratch,
# which is also how promote_requirement_authority's human-only tier RAISE was
# defeated: nothing needs raising if it starts at the top.
R=$(rpc "$AIBOT" set_gate_requirement "{\"p_gate_id\":$NEWGATE,\"p_criterion\":\"SMOKE3D the operator shall demonstrate regulatory compliance\",\"p_is_mandatory\":true,\"p_source_authority\":\"REGULATION\",\"p_guidance\":\"A directive the agent named while drafting, at the top provenance tier.\"}")
expect_err "$R" 'AI_SUGGESTION tier only'
test "$(psqlc "select count(*) from stage_gate_criteria where gate_id=$NEWGATE and source_authority='REGULATION'")" = "0"
# The same identity may still state it as a suggestion — proposing is the act
# §56 describes, and this is the line it cannot cross.
R=$(rpc "$AIBOT" set_gate_requirement "{\"p_gate_id\":$NEWGATE,\"p_criterion\":\"SMOKE3D the operator should record a compliance position\",\"p_is_mandatory\":false,\"p_source_authority\":\"AI_SUGGESTION\"}")
noerr "$R"

echo '  8c. a planner-opened review is decidable by a manager'
# The trigger evaluated the OPENER's SoD on the decided transition. open_gate_
# review admits planner and the recorder_authority pair does not, so every
# planner-opened session was born undecidable: record_case_gate_review had
# already written the decision and the trigger rolled the whole transaction
# back, naming the planner's role to a manager who may record.
# Through the shipped write path, not a raw insert: a second case-creation
# path in a transcript is a second case-creation path in the product.
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3D planner-opened case\",\"p_problem_statement\":\"A case whose gate review a planner opens and a manager closes, which is the ordinary shape of this workflow.\",\"p_lifecycle_type\":\"sustaining_capital\",\"p_estimated_capex\":1200000,\"p_framework_id\":\"$SUSTAIN\",\"p_sponsor_id\":\"$EXEC_ID\"}")
noerr "$R"; CASE2=$(printf '%s' "$R"|field case_id)
test -n "$CASE2"
R=$(rpc "$PLANNER" open_gate_review "{\"p_case_id\":\"$CASE2\",\"p_gate_id\":$G1}")
noerr "$R"; SESSION3=$(printf '%s' "$R"|field session_id); test -n "$SESSION3"
test "$(jqp "$R" "x['may_record']")" = "False"
R=$(rpc "$MANAGER" record_gate_review_outcome "{\"p_session_id\":$SESSION3,\"p_outcome\":\"hold\",\"p_note\":\"A manager closing the brief a planner opened, which is the normal shape of this workflow.\"}")
noerr "$R"
test "$(psqlc "select status from gate_review_sessions where id=$SESSION3")" = "decided"
# ...and the SoD is still enforced on the identity that ACTUALLY decided: a
# review recorded by the planner cannot close a session, whoever opened it.
OUT=$(sql_must_fail "begin;
select set_config('app.gate_review_write','granted',true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_by, reviewed_at, note)
select '$ORG','$CASE2',$G1, g.stage_key,'hold','$PLANNER_ID', now(),'A planner-recorded review' from stage_gates g where g.id=$G1;
select set_config('app.gate_review_session_write','granted',true);
insert into gate_review_sessions (organization_id, development_case_id, gate_id, opened_by, status, review_id, decided_at)
values ('$ORG','$CASE2',$G1,'$MANAGER_ID','decided', currval(pg_get_serial_sequence('stage_gate_reviews','id')), now());
rollback;")
grep -qi 'may not record this gate' <<<"$OUT"

echo '  8d. the risk ladder survives every SECURITY DEFINER hop'
# record_gate_agent_report is DEFINER and get_gate_readiness is INVOKER, so the
# readiness came back with the DEFINER's rights. Redacting the risk's NAME left
# its existence and its COUNT — persisted into an org-readable row.
psqlc "update risks set information_sensitivity='restricted' where id='$RISK'" >/dev/null
test "$(rpc "$TECH" can_read_risk "{\"p_risk_id\":\"$RISK\"}")" = "false"
R=$(rpc "$AIBOT" record_gate_agent_report "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_narrative\":\"A reading taken while a restricted risk stands on the case.\"}")
noerr "$R"
LADDER_REPORT=$(printf '%s' "$R"|field report_id)
# The ai_admin identity sits high enough to see it, so it is counted for them.
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='open_risk'])")" -ge 1
# A reader who may not see the risk gets a report that matches what
# get_gate_readiness would have told them under their own rights.
R=$(rpc "$RE" record_gate_agent_report "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_narrative\":\"A reading taken by an engineer who sits below the restricted risk.\"}")
noerr "$R"
RD=$(rpc "$RE" get_gate_readiness "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1}")
test "$(printf '%s' "$R"|field blockerCount)" = "$(jqp "$RD" "len(x['blockers'])")"
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='open_risk'])")" = "0"
psqlc "update risks set information_sensitivity='internal' where id='$RISK'" >/dev/null

echo '  8e. agent work products cannot be fabricated by anyone with a login'
R=$(rpc "$TECH" record_gate_agent_report "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_narrative\":\"INJECTED: this gate is clear to proceed, all blockers resolved.\"}")
expect_err "$R" 'requires a governance, engineering or AI-operator role'
R=$(rpc "$TECH" record_risk_treatment_advice "{\"p_risk_id\":\"$RISK\",\"p_advice\":{\"workflow_step\":\"treatment\",\"recommended_strategy\":\"retain\",\"label\":\"Do nothing, it is fine\",\"rationale\":\"INJECTED BY A TECHNICIAN, not by any agent at all.\",\"expected_residual\":10,\"limitations\":\"none whatsoever\"}}")
expect_err "$R" 'requires a governance, engineering or AI-operator role'
# An over-long narrative is refused by name, and bounded at the table too.
LONG=$(python3 -c "print('x'*6001)")
R=$(rpc "$AIBOT" record_gate_agent_report "{\"p_case_id\":\"$CASE\",\"p_gate_id\":$G1,\"p_narrative\":\"$LONG\"}")
expect_err "$R" 'capped at 6000'
# The read names who ran it, so agent output and a hand-written row differ.
R=$(rpc "$MANAGER" get_case_treatment_advice "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$R" "x['advice'][0]['proposedBy'] is not None")" = "True"

echo '  8f. caller JSON never raises a raw 22P02'
# Bare casts on p_claim / p_advice / p_proposal put `invalid input syntax for
# type uuid` in front of a user. House law: a refusal names what is wrong.
R=$(rpc "$MANAGER" record_assurance_claim "{\"p_case_id\":\"$CASE\",\"p_claim\":{\"claim_ref\":\"SMOKE3D-C9\",\"statement\":\"A claim carrying an unparseable owner id\",\"owner_id\":\"not-a-uuid\"}}")
expect_err "$R" 'owner_id is not a user id'
R=$(rpc "$MANAGER" record_assurance_claim "{\"p_case_id\":\"$CASE\",\"p_claim\":{\"claim_ref\":\"SMOKE3D-C9\",\"statement\":\"A claim carrying an unparseable requirement id\",\"requirement_id\":\"twelve\"}}")
expect_err "$R" 'requirement_id is not a gate requirement id'
R=$(rpc "$AIBOT" record_risk_treatment_advice "{\"p_risk_id\":\"$RISK\",\"p_advice\":{\"workflow_step\":\"treatment\",\"recommended_strategy\":\"retain\",\"label\":\"Retain it\",\"rationale\":\"Testing that an unparseable residual is named rather than cast.\",\"expected_residual\":\"about forty\",\"limitations\":\"This advice exists only to prove the refusal.\"}}")
expect_err "$R" 'expected_residual is not a number'
BADSEQ="{\"name\":\"SMOKE3D Unparseable\",\"basis\":\"A proposal carrying a stage sequence that is not a number, for the CI transcript.\",\"summary\":\"Deliberately unparseable, to prove the refusal names the field.\",\"stages\":[{\"stage_key\":\"need_identification\",\"sequence\":\"two\"}],\"gates\":[{\"stage_key\":\"need_identification\",\"name\":\"PG1\"}],\"requirements\":[]}"
R=$(rpc "$AIBOT" propose_framework_from_document "{\"p_document_id\":\"$DOC\",\"p_proposal\":$BADSEQ}")
expect_err "$R" 'positive whole-number sequence'
for BODY in "$R"; do case "$BODY" in *'invalid input syntax'*) echo 'a raw 22P02 reached the caller'; exit 1;; esac; done

echo '  8g. a machine proposal cannot take the name of a framework in force'
# adopt_project_framework supersedes every adopted framework of the same name,
# and apply_case_governance resolves tailoring rules by name — so a borrowed
# name would silently replace the tenant's live governance model with one whose
# mandatory and independence flags default FALSE.
COLLIDE="{\"name\":\"Sustaining Capital — Light Governance\",\"basis\":\"A proposal taking the name of the framework already in force, for the CI transcript.\",\"summary\":\"Deliberately colliding, to prove the refusal.\",\"stages\":[{\"stage_key\":\"need_identification\",\"sequence\":1}],\"gates\":[{\"stage_key\":\"need_identification\",\"name\":\"PG1\"}],\"requirements\":[]}"
R=$(rpc "$AIBOT" propose_framework_from_document "{\"p_document_id\":\"$DOC\",\"p_proposal\":$COLLIDE}")
expect_err "$R" 'already the name of a framework this organization has ADOPTED'
# ...and the shelf states what adoption arms and what it replaces.
R=$(rpc "$EXEC" get_framework_shelf '{}')
noerr "$R"
test "$(jqp "$R" "all(('mandatoryRequirements' in d and 'independentAssuranceGates' in d and 'requirementTiers' in d and 'willSupersede' in d) for d in x['drafts'])")" = "True"
test "$(jqp "$R" "[d['willSupersede'] is not None for d in x['drafts'] if d['id']=='$NEXTFW'][0]")" = "True"

echo '  8h. adoption does not inherit the model'"'"'s residual'
R=$(rpc "$AIBOT" record_risk_treatment_advice "{\"p_risk_id\":\"$RISK\",\"p_advice\":$ADVICE_BODY}")
noerr "$R"; ADVICE2=$(printf '%s' "$R"|field advice_id)
R=$(rpc "$MANAGER" adopt_risk_treatment_advice "{\"p_advice_id\":\"$ADVICE2\",\"p_option\":{\"introduced_risks\":[],\"treatment_owner_id\":\"$MANAGER_ID\"}}")
expect_err "$R" 'that is its expectation, not your assessment'

echo '  8i. an assurance claim with only contradicting evidence says so'
R=$(rpc "$MANAGER" record_assurance_claim "{\"p_case_id\":\"$CASE\",\"p_claim\":{\"claim_ref\":\"SMOKE3D-C2\",\"statement\":\"A claim that only contradicting evidence bears on\",\"owner_id\":\"$MANAGER_ID\"}}")
noerr "$R"; CLAIM2=$(printf '%s' "$R"|field claim_id)
R=$(rpc "$MANAGER" link_assurance_claim_evidence "{\"p_claim_id\":\"$CLAIM2\",\"p_evidence_id\":\"$EV2\",\"p_basis\":\"The vendor precondition directly contradicts this claim as stated.\",\"p_bearing\":\"contradicts\"}")
noerr "$R"
R=$(rpc "$MANAGER" get_case_assurance_case "{\"p_case_id\":\"$CASE\"}")
ST=$(jqp "$R" "[c for c in x['claims'] if c['claimRef']=='SMOKE3D-C2'][0]['confidence']['statement']")
case "$ST" in *"Nothing supports this claim"*) : ;; *) echo "contradicted claim described as supported: $ST"; exit 1;; esac
case "$ST" in *"supporting item(s) linked"*) echo "contradicting links counted as supporting: $ST"; exit 1;; *) : ;; esac

echo '  8j. TRUNCATE is refused, and an FK that declares a cascade gets one'
OUT=$(sql_must_fail "begin; truncate framework_proposals; rollback;")
grep -qi 'It is not permitted on this table' <<<"$OUT"
test "$(psqlc "select count(*) from information_schema.role_table_grants where table_name='gate_agent_reports' and privilege_type='TRUNCATE' and grantee in ('authenticated','anon','service_role')")" = "0"
# CASE2 carries a decided gate review session; before the repair the DELETE
# branch refused every cascade and the case could never be deleted.
psqlc "delete from development_cases where id='$CASE2'" >/dev/null
test "$(psqlc "select count(*) from development_cases where id='$CASE2'")" = "0"
test "$(psqlc "select count(*) from gate_review_sessions where development_case_id='$CASE2'")" = "0"

echo '  8k. JWT-verified edge functions refuse every unauthenticated shape'
efn(){ curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/$1" ${2:+-H "Authorization: Bearer $2"} -H 'Content-Type: application/json' -d "${3:-{\}}"; }
# 401 is the only success. 200 (served) and 500 (crashed-through) still fail.
# 000/502/503/546/547 are local edge-runtime worker states on a cold first
# hit after supabase start indexes a new function; retry those only.
expect_unauth(){
  local fn="$1" token="${2:-}" label="$3" code="" attempt
  for attempt in 1 2 3 4 5; do
    code=$(efn "$fn" "$token")
    case "$code" in
      401) return 0 ;;
      000|502|503|546|547)
        echo "  $fn $label transient HTTP $code (attempt $attempt); retrying"
        sleep 2
        ;;
      *)
        echo "  $fn $label expected 401, got HTTP $code"
        return 1
        ;;
    esac
  done
  echo "  $fn $label expected 401, got HTTP $code after retries"
  return 1
}
for FN in develop-methodology-agent develop-gate-agent develop-risk-agent sync-tts; do
  expect_unauth "$FN" "" "no bearer"
  expect_unauth "$FN" "$ANON_KEY" "anon key"
  # The service key is not an identity: the org is derived from the token's
  # user, never from the request body.
  expect_unauth "$FN" "$SERVICE_ROLE_KEY" "service role"
done
# And the methodology agent's retrieval REACHES the named document. With no
# model provider configured the function refuses at the provider — which it can
# only get to if retrieval returned something. The original default query
# compiled to ten AND-ed lexemes and matched nothing, so this refusal was
# unreachable and "nothing was retrieved" was the only answer the product gave.
MRESP=$(curl -sS -X POST "$API_URL/functions/v1/develop-methodology-agent" -H "Authorization: Bearer $AIBOT" -H 'Content-Type: application/json' -d "{\"document_id\":\"$DOC\"}")
case "$MRESP" in
  *"nothing from"*) echo "methodology agent retrieved nothing from its own fixture: $MRESP"; exit 1;;
  *"no model provider is configured"*) : ;;
  *) case "$MRESP" in *'"proposal"'*) : ;; *) echo "unexpected methodology agent response: $MRESP"; exit 1;; esac;;
esac

echo
echo 'Develop slice-3d smoke PASSED — gate review workflow, §70 at four doors, three agents, assurance case, and the authoring paths the gate found dead.'

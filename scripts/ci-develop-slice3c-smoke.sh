#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 3C — the chains, held to account.
#
# Steps (each a live transcript against a real local database):
#   1  commitments (D3.08/D3.09): a commitment is recorded against the ONE
#      stakeholder registry with all seven spec-I.18 fields; the coverage
#      detector names it as uncovered; linking it to a project requirement on
#      the ONE requirement table closes the gap; a client cannot edit or
#      delete a commitment even RLS-bypassed; the AI-operator identity cannot
#      discharge one; discharge demands case-scoped evidence; an overdue
#      uncovered commitment BLOCKS gate readiness by name AND is REFUSED at
#      record_case_gate_review for every writer, the sweep breaches it with
#      the stakeholder named, a breached commitment stays remediable (it is
#      late, not closed) and withdrawal is a governed act with a stated
#      reason that §70 refuses the AI-operator identity.
#   2  the regulatory chain (D3.10): requirement → application → information
#      request → approval → conditions as real rows; a statutory duty cannot
#      be recorded below REGULATION; a conditional grant with no conditions
#      is refused at the RPC AND at commit for the raw path; a condition
#      missing any born-complete field is refused; §70 refuses the
#      AI-operator identity as the recorder of an approval, at the RPC and
#      at the persistence boundary; expiry must be stated or declared
#      perpetual.
#   3  propagation (D3.11): with no asset bound the propagation FAILS CLOSED
#      naming the condition and the fix; bound, it lands engineering
#      conditions on design_requirements and operational conditions on
#      work_orders, records where each went, and is idempotent; it is
#      role-gated like every sibling act; one application carries one
#      decision; duplicate condition references are named, never a raw 23505;
#      the landing and the permit itself cannot be deleted out from under the
#      record; discharge is evidence-gated and a recurring condition RE-ARMS
#      to its next period AND re-lands in operations carrying that period.
#   4  breach visibility (D3.11/D3.10/D3.08): the ONE sweep escalates overdue
#      permit conditions, lapsed permits ("NO LONGER AUTHORIZED"), overdue
#      RFIs and breached commitments — audit_events with prev/new state and
#      security_events naming permit, regulator, owner and consequence.
#   5  assurance (D3.16): a review naming a competency the reviewer does not
#      hold is REFUSED by name AT EVERY LEVEL; a missing conflicts
#      declaration is refused; a declared conflict without a mitigation is
#      refused; a gate of another framework is refused; §70 refuses the
#      AI-operator identity as the reviewer at every level, not only
#      'independent'; and with an ADOPTED intensity binding the demand is
#      real — it is the higher of the binding's two fields, a line-1
#      self-review does not discharge it, and the review releases it at the
#      gate it names and at no other.
#   6  control assessment (D5.24): design and operating effectiveness are two
#      answers; effective operation over an ineffective design is refused at
#      the RPC and at the persistence boundary; the control rating is capped
#      DOWNWARD by an ineffective design; a non-finite confidence is refused.
#   7  treatment secondary risk (D5.25): an unrated new risk refuses the whole
#      treatment before anything is written; a rated one creates a REAL,
#      linked, audited risk in the same transaction inheriting the parent's
#      objective; the rating ENTERS net_risk_change rather than being demanded
#      and ignored; the §15 strategy enum is enforced at the database; the
#      read applies the risk sensitivity ladder and the provenance link
#      cannot be severed.
#   8  evidence confidence (D11.22): with no adopted weight set EC REFUSES
#      rather than defaulting; ungraded evidence refuses NAMING the factors;
#      after grading and adoption EC = Q×A×F×V computes and carries its
#      weights; a rejected item scores zero (a position, not a refusal —
#      asserted, not merely claimed by this header); and the weights are a
#      tenant's to CHANGE: a new version is copied forward, edited, refused
#      by name when a weight is not a number, and adopted, superseding the
#      last — with a draft seeded for every organization, including ones
#      created after the migration ran.
#
# Run: supabase start && scripts/ci-develop-slice3c-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-3c smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
RE=$(token 'demo@syncai.ca' 'Demo123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$EXEC"; test -n "$RE"; test -n "$TECH"

MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
EXEC_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='executive@syncai.ca'")
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
RE_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='demo@syncai.ca'")
test -n "$MANAGER_ID"; test -n "$RE_ID"; test -n "$EXEC_ID"; test -n "$PLANNER_ID"

# The AI-operator identity, for the §70 refusals. Seeded exactly as the
# slice-3b transcript seeds it (same uuid, same email), so the two smokes
# share one fixture in CI and either one still stands alone.
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

# Idempotent re-run: clear this smoke's artifacts (service context — the
# provenance triggers admit and audit the service path by design).
psqlc "select set_config('app.stakeholder_commitment_write','granted',true);
       delete from stakeholder_commitments where organization_id='$ORG' and commitment_ref like 'SMOKE3C-%';" >/dev/null
psqlc "delete from regulatory_requirements where organization_id='$ORG' and requirement_ref like 'SMOKE3C-%';" >/dev/null
psqlc "delete from work_orders where organization_id='$ORG' and wo_number like 'REG-SMOKE3C-%';" >/dev/null
psqlc "delete from design_requirements where organization_id='$ORG' and requirement_ref like 'SMOKE3C%' or requirement_ref like 'REG-SMOKE3C-%';" >/dev/null
psqlc "delete from risk_assurance_reviews where organization_id='$ORG' and scope like 'SMOKE3C %';" >/dev/null
psqlc "delete from development_cases where organization_id='$ORG' and title like 'SMOKE3C %';" >/dev/null
psqlc "delete from evidence_items where organization_id='$ORG' and description like 'SMOKE3C %';" >/dev/null
psqlc "delete from risks where organization_id='$ORG' and title like 'SMOKE3C %';" >/dev/null
psqlc "delete from recommendations where organization_id='$ORG' and title like 'SMOKE3C %';" >/dev/null
psqlc "delete from risk_objectives where organization_id='$ORG' and description like 'SMOKE3C %';" >/dev/null
psqlc "delete from risk_stakeholders where organization_id='$ORG' and name like 'SMOKE3C %';" >/dev/null
psqlc "delete from member_competencies where organization_id='$ORG' and member_id in (select id from workforce_members where organization_id='$ORG' and employee_ref like 'SMOKE3C%');" >/dev/null
psqlc "delete from workforce_members where organization_id='$ORG' and employee_ref like 'SMOKE3C%';" >/dev/null
psqlc "delete from competencies where organization_id='$ORG' and competency_key like 'smoke3c%';" >/dev/null
psqlc "update evidence_confidence_profiles set status='draft', adopted_by=null, adopted_at=null, superseded_by=null where organization_id='$ORG';" >/dev/null
psqlc "update project_frameworks set status='draft', adopted_by=null, adopted_at=null, superseded_by=null where organization_id='$ORG' and name='Brownfield Modification — Operating Site';" >/dev/null

# Shared arming: one adopted framework for the case's gates.
FWID=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Brownfield Modification — Operating Site' and status='draft' order by version desc limit 1")
test -n "$FWID"
R=$(rpc "$EXEC" adopt_project_framework "{\"p_framework_id\":\"$FWID\",\"p_note\":\"Adopted for the slice-3c CI transcript as demo governance.\"}")
noerr "$R"
BROWN=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Brownfield Modification — Operating Site' and status='adopted' limit 1")
test -n "$BROWN"
G1=$(psqlc "select g.id from stage_gates g where g.framework_id='$BROWN' and g.name='G1 — Framing'")
test -n "$G1"

echo '— 1. stakeholder commitments and the coverage detector (D3.08/D3.09) —'
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3C commitment case\",\"p_problem_statement\":\"Tailings dust complaints from the neighbouring community recur every dry season.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":4000000,\"p_framework_id\":\"$BROWN\"}")
noerr "$R"; CASE_A=$(printf '%s' "$R"|field case_id); test -n "$CASE_A"

# The stakeholder lands on the ONE registry (upsert_risk_stakeholder), not a
# new project-stakeholder table.
# The ONE stakeholder registry's own write path (upsert_risk_stakeholder)
# admits governance and engineering roles, not the planner role — so the
# workspace gates the "register a stakeholder" affordance on the same set.
R=$(rpc "$MANAGER" upsert_risk_stakeholder '{"p_stakeholder":{"name":"SMOKE3C Riverbend community council","stakeholder_type":"external","role_or_relationship":"Adjacent community affected by dust and noise","external_organization":"Riverbend Council"}}')
noerr "$R"; SH=$(printf '%s' "$R"|field stakeholder_id); test -n "$SH"

DUE_PAST=$(psqlc "select (current_date - 2)::text")
DUE_FUT=$(psqlc "select (current_date + 60)::text")

# Recorded WITHOUT a requirement — the gap is representable, which is the
# whole point of D3.09.
R=$(rpc "$PLANNER" record_stakeholder_commitment "{\"p_case_id\":\"$CASE_A\",\"p_commitment\":{\"stakeholder_id\":\"$SH\",\"commitment_ref\":\"SMOKE3C-C42\",\"concern\":\"Dust reaching homes on the east boundary\",\"commitment\":\"Install and operate boundary dust monitoring with quarterly public reporting\",\"owner_id\":\"$MANAGER_ID\",\"due_date\":\"$DUE_PAST\",\"commitment_kind\":\"community\"}}")
noerr "$R"
C42=$(printf '%s' "$R"|field commitment_id); test -n "$C42"
test "$(printf '%s' "$R"|field covered)" = "False"

R=$(rpc "$PLANNER" get_case_commitment_coverage "{\"p_case_id\":\"$CASE_A\"}")
noerr "$R"
test "$(jqp "$R" "x['uncoveredCount']")" = "1"
test "$(jqp "$R" "x['coveragePct']")" = "0.0"
test "$(jqp "$R" "x['uncoveredCommitments'][0]['commitmentRef']")" = "SMOKE3C-C42"

# OVERDUE AND UNCOVERED blocks gate readiness BY NAME — checked here, while
# C-42 still has nothing in the project delivering it. Once a requirement
# carries it the blocker correctly disappears, which is the point: the gate
# refuses the gap, not the commitment.
R=$(rpc "$PLANNER" get_gate_readiness "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G1}")
noerr "$R"
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='uncovered_commitment'])")" -ge 1
test "$(jqp "$R" "[b['name'] for b in x['blockers'] if b['type']=='uncovered_commitment'][0].startswith('SMOKE3C-C42')")" = "True"

# A commitment is not free-form data: no client write path exists, even with
# RLS bypassed by an authenticated claim.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
update stakeholder_commitments set due_date = current_date + 400 where id=$C42;
rollback;")
grep -qi 'governed acts' <<<"$OUT"
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
delete from stakeholder_commitments where id=$C42;
rollback;")
grep -qi 'governed acts' <<<"$OUT"

# §70: the AI-operator identity may PREPARE a commitment and may not DISCHARGE one.
R=$(rpc "$AIBOT" record_stakeholder_commitment "{\"p_case_id\":\"$CASE_A\",\"p_commitment\":{\"stakeholder_id\":\"$SH\",\"commitment_ref\":\"SMOKE3C-C99\",\"concern\":\"Night haulage noise\",\"commitment\":\"Restrict night haulage to the western route until the berm is complete\",\"owner_id\":\"$MANAGER_ID\",\"due_date\":\"$DUE_FUT\"}}")
noerr "$R"
C99=$(printf '%s' "$R"|field commitment_id); test -n "$C99"
R=$(rpc "$AIBOT" close_stakeholder_commitment "{\"p_commitment_id\":$C99,\"p_evidence_id\":null}")
expect_err "$R" 'AI-operator identity cannot record'

# The requirement lands on the ONE project requirement table, case-scoped.
R=$(rpc "$PLANNER" record_case_requirement "{\"p_case_id\":\"$CASE_A\",\"p_requirement\":{\"requirement_ref\":\"SMOKE3C-PR-01\",\"category\":\"instrumentation\",\"requirement\":\"Boundary dust monitors at four stations, telemetered, with quarterly public reporting\",\"source\":\"regulatory\",\"verification_method\":\"inspection\"}}")
noerr "$R"; PR1=$(printf '%s' "$R"|field requirement_id); test -n "$PR1"
test "$(psqlc "select development_case_id from design_requirements where id=$PR1")" = "$CASE_A"

# A client cannot write a case-scoped requirement row directly either. The
# three restrictive per-command policies (the evidence_items idiom) make the
# INSERT an error and the UPDATE a no-op: the case-linked row is INVISIBLE to
# a client mutation, so tampering matches nothing rather than being rejected
# row by row. Both are asserted, because "0 rows changed" is the actual
# protection for update/delete and an error is the protection for insert.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$PLANNER_ID', true);
set local role authenticated;
insert into design_requirements (organization_id, development_case_id, requirement_ref, category, requirement)
values ('$ORG','$CASE_A','SMOKE3C-PR-RAW','safety','client-written case requirement');
rollback;")
grep -qi 'row-level security' <<<"$OUT"
CHANGED=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tA <<SQL
begin;
select set_config('request.jwt.claim.sub', '$PLANNER_ID', true);
set local role authenticated;
with u as (update design_requirements set requirement='tampered' where id=$PR1 returning 1)
select 'ROWS=' || count(*) from u;
with d as (delete from design_requirements where id=$PR1 returning 1)
select 'DELETED=' || count(*) from d;
rollback;
SQL
)
grep -q 'ROWS=0' <<<"$CHANGED"
grep -q 'DELETED=0' <<<"$CHANGED"
test "$(psqlc "select requirement from design_requirements where id=$PR1")" != "tampered"

# Coverage closes when the link is made.
R=$(rpc "$PLANNER" link_commitment_to_requirement "{\"p_commitment_id\":$C42,\"p_requirement_id\":$PR1}")
noerr "$R"; test "$(printf '%s' "$R"|field covered)" = "True"
R=$(rpc "$PLANNER" get_case_commitment_coverage "{\"p_case_id\":\"$CASE_A\"}")
test "$(jqp "$R" "x['uncoveredCount']")" = "1"   # C99 remains uncovered
test "$(jqp "$R" "x['uncoveredCommitments'][0]['commitmentRef']")" = "SMOKE3C-C99"
# ... and the gate blocker clears with it: C-99 is uncovered but not yet due,
# so it is a coverage gap to work, not a gate refusal.
R=$(rpc "$PLANNER" get_gate_readiness "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='uncovered_commitment'])")" = "0"
# Clearing a link is not offered — a severed link silently re-opens a gap.
R=$(rpc "$PLANNER" link_commitment_to_requirement "{\"p_commitment_id\":$C99,\"p_requirement_id\":null}")
expect_err "$R" 'clearing the link is not offered'

# Discharge is evidence-gated and case-scoped.
R=$(rpc "$RE" close_stakeholder_commitment "{\"p_commitment_id\":$C42,\"p_evidence_id\":null}")
expect_err "$R" 'requires the evidence'
R=$(rpc "$RE" record_case_evidence "{\"p_case_id\":\"$CASE_A\",\"p_evidence\":{\"evidence_class\":\"MEASURED\",\"description\":\"SMOKE3C boundary dust monitoring commissioning record and first public report\",\"source_system\":\"ci-transcript\"}}")
noerr "$R"; EV_A=$(printf '%s' "$R"|field evidence_id); test -n "$EV_A"
echo '   recorded on the one registry, uncovered detected, linked, client writes refused, §70 discharge refused'

echo '— 1b. the ONE sweep breaches the overdue commitment, naming the stakeholder —'
SEC_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'STAKEHOLDER COMMITMENT BREACHED%'")
R=$(psqlc "select public.expire_governance_instruments()")
test "$(jqp "$R" "x['stakeholder_commitments_breached']")" -ge 1
test "$(psqlc "select status from stakeholder_commitments where id=$C42")" = "breached"
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'STAKEHOLDER COMMITMENT BREACHED%'")" -gt "$SEC_B"
psqlc "select 1 from security_events where organization_id='$ORG' and detail like '%SMOKE3C-C42 to SMOKE3C Riverbend community council%' limit 1" | grep -q 1
psqlc "select 1 from audit_events where organization_id='$ORG' and entity_type='stakeholder_commitment' and event_data->>'action'='escalated_overdue' and previous_state->>'status'='open' and new_state->>'status'='breached' limit 1" | grep -q 1

# A BREACHED COMMITMENT IS LATE, NOT CLOSED — remediation is still possible.
# The first draft refused the link once the sweep had run ("not rewritten
# after it closed"), which made the D3.09 gate blocker permanently unclearable
# from the moment it started firing: the whole detect -> link -> clear loop
# worked only in the window before the hourly sweep.
R=$(rpc "$PLANNER" record_stakeholder_commitment "{\"p_case_id\":\"$CASE_A\",\"p_commitment\":{\"commitment_ref\":\"SMOKE3C-C77\",\"stakeholder_id\":\"$SH\",\"concern\":\"Night haulage noise at the north fence\",\"commitment\":\"Publish a monthly night-noise summary for the first year\",\"owner_id\":\"$MANAGER_ID\",\"due_date\":\"$DUE_PAST\"}}")
noerr "$R"; C77=$(printf '%s' "$R"|field commitment_id); test -n "$C77"
R=$(psqlc "select public.expire_governance_instruments()")
test "$(psqlc "select status from stakeholder_commitments where id=$C77")" = "breached"
# THE GATE REFUSES over it — the blocker is consequential, not a label.
R=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='uncovered_commitment'])")" = "1"
FIND3C=$(psqlc "select coalesce(jsonb_agg(jsonb_build_object('criterion_text', sc.criterion, 'status', 'met')), '[]'::jsonb)::text from stage_gate_criteria sc where sc.gate_id=$G1 and sc.organization_id='$ORG'")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"A proceed recorded over a broken community promise must be refused.\",\"p_findings\":$FIND3C}")
grep -qi 'cannot pass while' <<<"$R"
grep -qi 'SMOKE3C-C77' <<<"$R"
# ... and remediation clears it, because the commitment is still live.
R=$(rpc "$PLANNER" link_commitment_to_requirement "{\"p_commitment_id\":$C77,\"p_requirement_id\":$PR1}")
noerr "$R"; test "$(printf '%s' "$R"|field covered)" = "True"
R=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='uncovered_commitment'])")" = "0"

# WITHDRAWAL IS AN ACT, not a status nothing can reach. §70 refuses the AI
# identity, and a reason is mandatory.
R=$(rpc "$AIBOT" withdraw_stakeholder_commitment "{\"p_commitment_id\":$C99,\"p_reason\":\"The AI identity attempts to retire a community promise.\"}")
expect_err "$R" 'AI-operator identity cannot record'
R=$(rpc "$RE" withdraw_stakeholder_commitment "{\"p_commitment_id\":$C99,\"p_reason\":\"too short\"}")
expect_err "$R" 'state why this commitment is withdrawn'

# Late discharge keeps the breach on the record.
R=$(rpc "$RE" close_stakeholder_commitment "{\"p_commitment_id\":$C42,\"p_evidence_id\":\"$EV_A\",\"p_note\":\"Monitors commissioned; first report published.\"}")
noerr "$R"; test "$(printf '%s' "$R"|field closed_late)" = "True"
test -n "$(psqlc "select breached_at from stakeholder_commitments where id=$C42")"
echo '   blocked the gate by name AND REFUSED AT THE ACT SITE, breached through the ONE sweep naming the stakeholder, remediable while breached, withdrawal governed, discharged late with the breach preserved'

echo '— 2. the regulatory approval chain as real objects (D3.10) —'
# A statutory duty cannot be recorded below REGULATION.
R=$(rpc "$PLANNER" record_regulatory_requirement "{\"p_case_id\":\"$CASE_A\",\"p_requirement\":{\"requirement_ref\":\"SMOKE3C-REG-BAD\",\"regulator\":\"Provincial regulator\",\"jurisdiction\":\"Alberta\",\"instrument\":\"Environmental Protection and Enhancement Act\",\"permit_type\":\"Air approval\",\"description\":\"Approval to operate the dust suppression system\",\"trigger_condition\":\"Any change to the emission source\",\"expected_lead_time_days\":120,\"source_authority\":\"BEST_PRACTICE\"}}")
expect_err "$R" 'LAW or REGULATION'
# Lead time is mandatory: without it the permit cannot sit on the critical path.
R=$(rpc "$PLANNER" record_regulatory_requirement "{\"p_case_id\":\"$CASE_A\",\"p_requirement\":{\"requirement_ref\":\"SMOKE3C-REG-BAD\",\"regulator\":\"Provincial regulator\",\"jurisdiction\":\"Alberta\",\"instrument\":\"Environmental Protection and Enhancement Act\",\"permit_type\":\"Air approval\",\"description\":\"Approval to operate the dust suppression system\",\"trigger_condition\":\"Any change to the emission source\",\"expected_lead_time_days\":0}}")
expect_err "$R" 'expected regulator lead time'

R=$(rpc "$PLANNER" record_regulatory_requirement "{\"p_case_id\":\"$CASE_A\",\"p_requirement\":{\"requirement_ref\":\"SMOKE3C-REG-01\",\"regulator\":\"Provincial regulator\",\"jurisdiction\":\"Alberta\",\"instrument\":\"Environmental Protection and Enhancement Act\",\"permit_type\":\"Air approval amendment\",\"description\":\"Amendment to the air approval covering the new dust suppression and monitoring system\",\"trigger_condition\":\"Any change to a permitted emission source\",\"expected_lead_time_days\":120,\"required_by_date\":\"$DUE_FUT\"}}")
noerr "$R"; REG1=$(printf '%s' "$R"|field requirement_id); test -n "$REG1"

R=$(rpc "$PLANNER" submit_regulatory_application "{\"p_requirement_id\":$REG1,\"p_application\":{\"application_ref\":\"SMOKE3C-APP-01\",\"scope_description\":\"Amendment application covering four boundary monitors and the suppression upgrade\"}}")
noerr "$R"; APP1=$(printf '%s' "$R"|field application_id); test -n "$APP1"
test "$(psqlc "select status from regulatory_requirements where id=$REG1")" = "applied"

# The information request — the link where permits actually die.
RFI_ASKED=$(psqlc "select (current_date - 10)::text")
RFI_DUE=$(psqlc "select (current_date - 1)::text")
# A due date before the request date is refused — an RFI cannot be answered
# before it was raised.
R=$(rpc "$PLANNER" record_regulatory_information_request "{\"p_application_id\":$APP1,\"p_request\":{\"request_ref\":\"SMOKE3C-RFI-BAD\",\"request_detail\":\"Dispersion modelling for the revised stack height\",\"owner_id\":\"$MANAGER_ID\",\"requested_at\":\"$RFI_DUE\",\"response_due\":\"$RFI_ASKED\"}}")
expect_err "$R" 'cannot precede the request date'
R=$(rpc "$PLANNER" record_regulatory_information_request "{\"p_application_id\":$APP1,\"p_request\":{\"request_ref\":\"SMOKE3C-RFI-01\",\"request_detail\":\"Dispersion modelling for the revised stack height\",\"owner_id\":\"$MANAGER_ID\",\"requested_at\":\"$RFI_ASKED\",\"response_due\":\"$RFI_DUE\"}}")
noerr "$R"; RFI1=$(printf '%s' "$R"|field request_id); test -n "$RFI1"
test "$(psqlc "select status from regulatory_applications where id=$APP1")" = "information_requested"

# §70 at the RPC: the AI-operator identity cannot record a regulator's decision.
R=$(rpc "$AIBOT" record_regulatory_approval "{\"p_application_id\":$APP1,\"p_approval\":{\"permit_number\":\"SMOKE3C-P-1\",\"deciding_authority\":\"Provincial regulator\",\"decision\":\"granted\",\"expires_at\":\"$DUE_FUT\"},\"p_conditions\":[]}")
expect_err "$R" 'AI-operator identity cannot record'
# ... and at the persistence boundary, for every writer.
OUT=$(sql_must_fail "insert into regulatory_approvals (organization_id, application_id, permit_number, deciding_authority, decision, decision_date, expires_at, recorded_by)
values ('$ORG',$APP1,'SMOKE3C-P-RAW','Provincial regulator','granted',current_date,current_date+365,'$AIBOT_ID');")
grep -qi 'AI-operator identity cannot stand as the recorder' <<<"$OUT"
# An approval nobody stands behind is not a record.
OUT=$(sql_must_fail "insert into regulatory_approvals (organization_id, application_id, permit_number, deciding_authority, decision, decision_date, expires_at, recorded_by)
values ('$ORG',$APP1,'SMOKE3C-P-RAW','Provincial regulator','granted',current_date,current_date+365,null);")
grep -qi 'records WHO entered' <<<"$OUT"
# Expiry must be stated or perpetual declared.
R=$(rpc "$MANAGER" record_regulatory_approval "{\"p_application_id\":$APP1,\"p_approval\":{\"permit_number\":\"SMOKE3C-P-1\",\"deciding_authority\":\"Provincial regulator\",\"decision\":\"granted\"},\"p_conditions\":[]}")
expect_err "$R" 'permanent authorization nobody decided to grant'
# A conditional grant with no conditions is refused at the RPC...
R=$(rpc "$MANAGER" record_regulatory_approval "{\"p_application_id\":$APP1,\"p_approval\":{\"permit_number\":\"SMOKE3C-P-1\",\"deciding_authority\":\"Provincial regulator\",\"decision\":\"granted_with_conditions\",\"expires_at\":\"$DUE_FUT\"},\"p_conditions\":[]}")
expect_err "$R" 'carries its conditions as first-class rows'
# ... and at COMMIT for the raw path (deferred constraint trigger).
OUT=$(sql_must_fail "insert into regulatory_approvals (organization_id, application_id, permit_number, deciding_authority, decision, decision_date, expires_at, recorded_by)
values ('$ORG',$APP1,'SMOKE3C-P-RAW2','Provincial regulator','granted_with_conditions',current_date,current_date+365,'$MANAGER_ID');")
grep -qi 'at least one first-class condition' <<<"$OUT"
# A condition missing any born-complete field is refused.
R=$(rpc "$MANAGER" record_regulatory_approval "{\"p_application_id\":$APP1,\"p_approval\":{\"permit_number\":\"SMOKE3C-P-1\",\"deciding_authority\":\"Provincial regulator\",\"decision\":\"granted_with_conditions\",\"expires_at\":\"$DUE_FUT\"},\"p_conditions\":[{\"condition_ref\":\"C-1\",\"description\":\"Report quarterly to the regulator on boundary readings\",\"obligation_domain\":\"reporting\",\"owner_id\":\"$MANAGER_ID\",\"due_date\":\"$DUE_FUT\",\"evidence_requirement\":\"\",\"consequence_if_missed\":\"Approval suspension\"}]}")
expect_err "$R" 'born complete'
echo '   five links as rows; tier narrowed to LAW/REGULATION; lead time mandatory; §70 refused at RPC and boundary; conditional grant needs conditions at both doors'

echo '— 3. propagation into delivery AND operations (D3.11) —'
COND_DUE=$(psqlc "select (current_date - 1)::text")
CONDS="[
 {\"condition_ref\":\"SMOKE3C-C-ENG\",\"description\":\"Stack height increased to 42 m before commissioning\",\"obligation_domain\":\"engineering\",\"owner_id\":\"$MANAGER_ID\",\"due_date\":\"$DUE_FUT\",\"evidence_requirement\":\"As-built survey of the stack\",\"consequence_if_missed\":\"Approval is void and the source may not operate\"},
 {\"condition_ref\":\"SMOKE3C-C-MON\",\"description\":\"Boundary monitoring reported to the regulator every quarter\",\"obligation_domain\":\"monitoring\",\"owner_id\":\"$MANAGER_ID\",\"due_date\":\"$COND_DUE\",\"evidence_requirement\":\"Quarterly monitoring return\",\"consequence_if_missed\":\"Enforcement order and possible suspension\",\"recurrence\":\"quarterly\"}]"

# FAIL CLOSED: the operational condition has nowhere in operations to land.
test "$(psqlc "select count(*) from development_case_assets where development_case_id='$CASE_A'")" = "0"
R=$(rpc "$MANAGER" record_regulatory_approval "{\"p_application_id\":$APP1,\"p_approval\":{\"permit_number\":\"SMOKE3C-P-1\",\"deciding_authority\":\"Provincial regulator\",\"decision\":\"granted_with_conditions\",\"expires_at\":\"$DUE_FUT\"},\"p_conditions\":$CONDS}")
expect_err "$R" 'nowhere in operations to land'
test "$(psqlc "select count(*) from regulatory_approvals where organization_id='$ORG' and permit_number='SMOKE3C-P-1'")" = "0"

# Bind the delivered asset, then the same act succeeds and LANDS.
ASSET=$(psqlc "select id from assets where organization_id='$ORG' order by created_at limit 1")
test -n "$ASSET"
R=$(rpc "$PLANNER" bind_asset_to_development_case "{\"p_case_id\":\"$CASE_A\",\"p_asset_id\":\"$ASSET\",\"p_reason\":\"SMOKE3C operational scope for the permit conditions\"}")
noerr "$R"
R=$(rpc "$MANAGER" record_regulatory_approval "{\"p_application_id\":$APP1,\"p_approval\":{\"permit_number\":\"SMOKE3C-P-1\",\"deciding_authority\":\"Provincial regulator\",\"decision\":\"granted_with_conditions\",\"expires_at\":\"$DUE_FUT\"},\"p_conditions\":$CONDS}")
noerr "$R"
AP1=$(printf '%s' "$R"|field approval_id); test -n "$AP1"
test "$(printf '%s' "$R"|field conditions_created)" = "2"
test "$(psqlc "select status from regulatory_requirements where id=$REG1")" = "granted"
test "$(psqlc "select status from regulatory_applications where id=$APP1")" = "decided"

# Engineering → the ONE project requirement table. Monitoring → the ONE work
# identity, against the bound asset.
test "$(psqlc "select count(*) from design_requirements where organization_id='$ORG' and requirement_ref='REG-SMOKE3C-P-1-SMOKE3C-C-ENG' and development_case_id='$CASE_A' and source='regulatory'")" = "1"
WO=$(psqlc "select propagated_work_order_id from regulatory_conditions where organization_id='$ORG' and condition_ref='SMOKE3C-C-MON'")
test -n "$WO"
test "$(psqlc "select asset_id from work_orders where id='$WO'")" = "$ASSET"
psqlc "select 1 from work_orders where id='$WO' and description like '%Regulatory obligation propagated from permit SMOKE3C-P-1%' limit 1" | grep -q 1
# Both landings are recorded ON the condition row.
test -n "$(psqlc "select propagated_requirement_id from regulatory_conditions where organization_id='$ORG' and condition_ref='SMOKE3C-C-ENG'")"
# Idempotent: a second run lands nothing twice.
R=$(rpc "$MANAGER" propagate_regulatory_conditions "{\"p_approval_id\":$AP1}")
noerr "$R"
test "$(printf '%s' "$R"|field requirements_created)" = "0"
test "$(printf '%s' "$R"|field work_orders_created)" = "0"
test "$(printf '%s' "$R"|field already_propagated)" = "2"

# ROLE-GATED like every sibling act. This function shipped with NO role check
# at all while writing design_requirements at source 'regulatory' and creating
# work orders: the same technician refused at record_case_requirement was
# admitted here, which made the UI's button-gating the whole authorization.
R=$(rpc "$TECH" record_case_requirement "{\"p_case_id\":\"$CASE_A\",\"p_requirement\":{\"requirement_ref\":\"SMOKE3C-PR-TECH\",\"category\":\"safety\",\"requirement\":\"A technician-authored requirement must be refused on role\"}}")
expect_err "$R" 'planning, engineering or governance role'
R=$(rpc "$TECH" propagate_regulatory_conditions "{\"p_approval_id\":$AP1}")
expect_err "$R" 'governance or engineering role'
R=$(rpc "$AIBOT" propagate_regulatory_conditions "{\"p_approval_id\":$AP1}")
expect_err "$R" 'governance or engineering role'

# ONE APPLICATION, ONE DECISION: a second approval on a decided application
# would leave the case surface rendering one permit while gate readiness
# refused over another.
R=$(rpc "$MANAGER" record_regulatory_approval "{\"p_application_id\":$APP1,\"p_approval\":{\"permit_number\":\"SMOKE3C-P-SECOND\",\"deciding_authority\":\"Provincial regulator\",\"decision\":\"granted\",\"expires_at\":\"$DUE_FUT\"},\"p_conditions\":[]}")
expect_err "$R" 'already carries a decision'

# A DUPLICATE CONDITION REFERENCE IS NAMED, never a raw 23505.
R=$(rpc "$PLANNER" submit_regulatory_application "{\"p_requirement_id\":$REG1,\"p_application\":{\"application_ref\":\"SMOKE3C-APP-DUP\",\"scope_description\":\"A second application used only for the duplicate-reference probe\"}}")
noerr "$R"; APP_DUP=$(printf '%s' "$R"|field application_id)
R=$(rpc "$MANAGER" record_regulatory_approval "{\"p_application_id\":$APP_DUP,\"p_approval\":{\"permit_number\":\"SMOKE3C-P-DUP\",\"deciding_authority\":\"Provincial regulator\",\"decision\":\"granted_with_conditions\",\"expires_at\":\"$DUE_FUT\"},\"p_conditions\":[{\"condition_ref\":\"SMOKE3C-C-ENG\",\"description\":\"A condition reusing a reference already recorded\",\"obligation_domain\":\"engineering\",\"owner_id\":\"$MANAGER_ID\",\"due_date\":\"$DUE_FUT\",\"evidence_requirement\":\"As-built drawing\",\"consequence_if_missed\":\"Enforcement order\"}]}")
expect_err "$R" 'is already recorded in this organization'
# An instrument with no expiry says PERPETUAL explicitly, or it is refused.
R=$(rpc "$MANAGER" record_regulatory_approval "{\"p_application_id\":$APP_DUP,\"p_approval\":{\"permit_number\":\"SMOKE3C-P-NOEXP\",\"deciding_authority\":\"Provincial regulator\",\"decision\":\"granted\"},\"p_conditions\":[]}")
expect_err "$R" 'record it as perpetual explicitly'
R=$(rpc "$MANAGER" record_regulatory_approval "{\"p_application_id\":$APP_DUP,\"p_approval\":{\"permit_number\":\"SMOKE3C-P-PERP\",\"deciding_authority\":\"Provincial regulator\",\"decision\":\"granted\",\"perpetual\":true},\"p_conditions\":[]}")
noerr "$R"
test "$(psqlc "select perpetual and expires_at is null from regulatory_approvals where organization_id='$ORG' and permit_number='SMOKE3C-P-PERP'")" = "t"

# THE OPERATIONS TERMINUS CANNOT BE SEVERED, and the regulatory family is
# provenance-backstopped on DELETE — a permit is 'expired' or 'revoked', never
# erased with its conditions and its gate blockers.
CHANGED=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tA <<SQL
begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
set local role authenticated;
with d as (delete from work_orders where id='$WO' returning 1) select 'WO_DELETED=' || count(*) from d;
rollback;
SQL
)
grep -q 'WO_DELETED=0' <<<"$CHANGED"
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
delete from regulatory_approvals where id=$AP1;
rollback;")
grep -qi 'recorded, decided, discharged and escalated only' <<<"$OUT"
echo '   failed closed with no operational scope; bound, landed on design_requirements AND work_orders; recorded on the row; idempotent; role-gated; one decision per application; duplicate references and unstated expiry named; the landing and the permit undeletable'

echo '— 4. breach visibility through the ONE sweep (D3.11/D3.10) —'
SEC_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'REGULATORY CONDITION BREACHED%'")
R=$(psqlc "select public.expire_governance_instruments()")
test "$(jqp "$R" "x['regulatory_conditions_escalated']")" -ge 1
test "$(jqp "$R" "x['information_requests_overdue']")" -ge 1
test "$(psqlc "select status from regulatory_conditions where organization_id='$ORG' and condition_ref='SMOKE3C-C-MON'")" = "missed"
test "$(psqlc "select status from regulatory_information_requests where id=$RFI1")" = "overdue"
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'REGULATORY CONDITION BREACHED%'")" -gt "$SEC_B"
psqlc "select 1 from security_events where organization_id='$ORG' and detail like '%permit SMOKE3C-P-1%Recorded consequence if missed: Enforcement order and possible suspension%' limit 1" | grep -q 1
psqlc "select 1 from audit_events where organization_id='$ORG' and entity_type='regulatory_condition' and event_data->>'action'='escalated_overdue' and previous_state->>'status'='open' and new_state->>'status'='missed' limit 1" | grep -q 1

# A LAPSED permit says the activity is no longer authorized.
psqlc "update regulatory_approvals set expires_at = current_date - 1 where id=$AP1;" >/dev/null
R=$(psqlc "select public.expire_governance_instruments()")
test "$(jqp "$R" "x['permits_expired']")" -ge 1
test "$(psqlc "select status from regulatory_approvals where id=$AP1")" = "expired"
psqlc "select 1 from security_events where organization_id='$ORG' and detail like '%PERMIT LAPSED: SMOKE3C-P-1%NO LONGER AUTHORIZED%' limit 1" | grep -q 1

# The RFI is answered with evidence of THIS case; the overdue mark survives.
R=$(rpc "$PLANNER" respond_regulatory_information_request "{\"p_request_id\":$RFI1,\"p_evidence_id\":\"$EV_A\"}")
noerr "$R"; test "$(printf '%s' "$R"|field answered_late)" = "True"

# A permit condition is discharged with case-scoped evidence, and the
# RECURRING one re-arms to its next period rather than closing for good.
MON=$(psqlc "select id from regulatory_conditions where organization_id='$ORG' and condition_ref='SMOKE3C-C-MON'")
R=$(rpc "$AIBOT" close_regulatory_condition "{\"p_condition_id\":$MON,\"p_evidence_id\":\"$EV_A\"}")
expect_err "$R" 'AI-operator identity cannot record'
# AN OUTSTANDING PERMIT CONDITION REFUSES A PASSING GATE. The blocker the
# readiness screen names is the one the act site refuses over — the first
# draft named all three and refused over none, so `proceed` was recorded with
# an open permit condition displayed beside it.
R=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='regulatory_condition'])")" -ge 1
FIND3C=$(psqlc "select coalesce(jsonb_agg(jsonb_build_object('criterion_text', sc.criterion, 'status', 'met')), '[]'::jsonb)::text from stage_gate_criteria sc where sc.gate_id=$G1 and sc.organization_id='$ORG'")
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"A proceed recorded over a breached permit condition must be refused.\",\"p_findings\":$FIND3C}")
grep -qi 'cannot pass while' <<<"$R"
grep -qi 'SMOKE3C-C-MON' <<<"$R"
# ... and for EVERY writer, not only through the RPC.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
select set_config('app.gate_review_write','granted',true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_by, reviewed_at, note)
values ('$ORG','$CASE_A',$G1,'need_identification','proceed','$MANAGER_ID',now(),'bypass attempt over an outstanding permit condition');
rollback;")
grep -qi 'cannot pass while' <<<"$OUT"

R=$(rpc "$RE" close_regulatory_condition "{\"p_condition_id\":$MON,\"p_evidence_id\":\"$EV_A\",\"p_note\":\"Q3 return filed.\"}")
noerr "$R"
test "$(printf '%s' "$R"|field recurring)" = "True"
test "$(printf '%s' "$R"|field status)" = "open"
test "$(psqlc "select due_date > current_date from regulatory_conditions where id=$MON")" = "t"
# The permit has lapsed, so the re-armed period mints NO new work: a permit
# that no longer authorizes the activity does not create new obligations.
test "$(printf '%s' "$R"|field permit_status)" = "expired"
test "$(psqlc "select propagated_work_order_id is null from regulatory_conditions where id=$MON")" = "t"
# On a LIVE permit the next period lands in operations, as its own work order
# carrying its own period. Leaving the landing set made the propagation skip
# the condition forever, so a quarterly obligation over a 25-year permit
# reached operations exactly once.
psqlc "update regulatory_approvals set status='active', expires_at=current_date + 400 where id=$AP1;" >/dev/null
R=$(rpc "$RE" record_case_evidence "{\"p_case_id\":\"$CASE_A\",\"p_evidence\":{\"evidence_class\":\"DOCUMENTED\",\"description\":\"SMOKE3C next-period monitoring return\",\"source_system\":\"ci-transcript\"}}")
noerr "$R"; EV_P2=$(printf '%s' "$R"|field evidence_id)
WO_BEFORE=$(psqlc "select count(*) from work_orders where organization_id='$ORG' and wo_number like 'REG-SMOKE3C-P-1-SMOKE3C-C-MON%'")
R=$(rpc "$RE" close_regulatory_condition "{\"p_condition_id\":$MON,\"p_evidence_id\":\"$EV_P2\",\"p_note\":\"Q4 return filed.\"}")
noerr "$R"
test "$(printf '%s' "$R"|field next_period_propagated)" = "True"
test "$(psqlc "select count(*) from work_orders where organization_id='$ORG' and wo_number like 'REG-SMOKE3C-P-1-SMOKE3C-C-MON%'")" -gt "$WO_BEFORE"
test -n "$(psqlc "select propagated_work_order_id from regulatory_conditions where id=$MON")"
# The discharged period's evidence stays ON the row, not only in the ledger.
test "$(psqlc "select closure_evidence_id from regulatory_conditions where id=$MON")" = "$EV_P2"
echo '   conditions breached and REFUSED at the gate for every writer, permit lapse announced, RFI answered late, recurring obligation re-armed AND re-landed in operations with its period'

echo '— 5. assurance with verified competency and declared conflicts (D3.16) —'
psqlc "insert into competencies (organization_id, competency_key, title, kind)
       values ('$ORG','smoke3c_assurance','SMOKE3C independent assurance','skill')
       on conflict do nothing;" >/dev/null
COMP=$(psqlc "select id from competencies where organization_id='$ORG' and competency_key='smoke3c_assurance'")
test -n "$COMP"

# The reviewer does not hold it yet: fail CLOSED, naming the competency.
R=$(rpc "$RE" record_case_assurance_review "{\"p_case_id\":\"$CASE_A\",\"p_review\":{\"assurance_level\":\"independent\",\"scope\":\"SMOKE3C independent review of the dust case framing and its permit chain\",\"reviewer_competency_keys\":[\"smoke3c_assurance\"],\"conflicts_declaration_made\":true}}")
expect_err "$R" 'does not hold on the roster'

# Put the reviewer on the roster with the current competency.
psqlc "insert into workforce_members (organization_id, employee_ref, display_name, employment_type, user_id, active)
       values ('$ORG','SMOKE3C-RE','SMOKE3C reviewer','employee','$RE_ID',true)
       on conflict do nothing;" >/dev/null
WM=$(psqlc "select id from workforce_members where organization_id='$ORG' and employee_ref='SMOKE3C-RE'")
test -n "$WM"
psqlc "insert into member_competencies (organization_id, member_id, competency_id, granted_on, expires_on)
       values ('$ORG','$WM',$COMP, current_date - 30, current_date + 365) on conflict do nothing;" >/dev/null

# Silence is not a declaration.
R=$(rpc "$RE" record_case_assurance_review "{\"p_case_id\":\"$CASE_A\",\"p_review\":{\"assurance_level\":\"independent\",\"scope\":\"SMOKE3C independent review of the dust case framing and its permit chain\",\"reviewer_competency_keys\":[\"smoke3c_assurance\"]}}")
expect_err "$R" 'declare conflicts of interest'
# A conflict noticed and left unmitigated is refused at the boundary.
OUT=$(sql_must_fail "insert into risk_assurance_reviews (organization_id, subject_type, subject_id, assurance_level, subject_owner_id, reviewer_id, scope, status, reviewer_competency_keys, conflicts_declared, conflicts_declared_at)
values ('$ORG','development_case','$CASE_A','independent','$PLANNER_ID','$RE_ID','SMOKE3C raw review','planned','[\"smoke3c_assurance\"]'::jsonb,'[{\"conflict\":\"Advised the vendor in 2024\"}]'::jsonb, now());")
grep -qi 'conflict AND its mitigation' <<<"$OUT"
# The case sponsor cannot independently assure their own case (the 3B wall,
# still standing). A second case created BY a governance role, so the refusal
# is the SoD rule and not the role check.
R=$(rpc "$MANAGER" create_development_case "{\"p_title\":\"SMOKE3C self-assurance case\",\"p_problem_statement\":\"A second case whose sponsor will try to assure it themselves.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":500000,\"p_framework_id\":\"$BROWN\"}")
noerr "$R"; CASE_B=$(printf '%s' "$R"|field case_id); test -n "$CASE_B"
test "$(psqlc "select sponsor_id from development_cases where id='$CASE_B'")" = "$MANAGER_ID"
R=$(rpc "$MANAGER" record_case_assurance_review "{\"p_case_id\":\"$CASE_B\",\"p_review\":{\"assurance_level\":\"independent\",\"scope\":\"SMOKE3C sponsor tries to assure their own case\",\"reviewer_competency_keys\":[\"smoke3c_assurance\"],\"conflicts_declaration_made\":true}}")
expect_err "$R" 'cannot independently assure their own case'
# A gate of another framework tells the readiness screen nothing.
OTHER_GATE=$(psqlc "select g.id from stage_gates g join project_frameworks f on f.id=g.framework_id where f.organization_id='$ORG' and f.id<>'$BROWN' limit 1")
if [ -n "$OTHER_GATE" ]; then
  R=$(rpc "$RE" record_case_assurance_review "{\"p_case_id\":\"$CASE_A\",\"p_review\":{\"assurance_level\":\"independent\",\"scope\":\"SMOKE3C review bound to an unrelated gate\",\"gate_id\":$OTHER_GATE,\"reviewer_competency_keys\":[\"smoke3c_assurance\"],\"conflicts_declaration_made\":true}}")
  expect_err "$R" 'does not belong to this case'
fi

# The good path: an explicit NIL conflicts return, verified competency, bound
# to the gate whose readiness it informs.
R=$(rpc "$RE" record_case_assurance_review "{\"p_case_id\":\"$CASE_A\",\"p_review\":{\"assurance_level\":\"independent\",\"scope\":\"SMOKE3C independent review of the dust case framing and its permit chain\",\"gate_id\":$G1,\"reviewer_competency_keys\":[\"smoke3c_assurance\"],\"reviewer_competency_basis\":\"Chartered engineer, no commercial interest in the vendor\",\"conflicts_declaration_made\":true}}")
noerr "$R"; AR1=$(printf '%s' "$R"|field review_id); test -n "$AR1"
# The declaration is an ACT with a time, distinct from its (empty) contents.
test -n "$(psqlc "select conflicts_declared_at from risk_assurance_reviews where id='$AR1'")"
test "$(psqlc "select jsonb_array_length(conflicts_declared) from risk_assurance_reviews where id='$AR1'")" = "0"
test "$(psqlc "select gate_id from risk_assurance_reviews where id='$AR1'")" = "$G1"

# THE CONSUMPTION IS WHERE COMPLETENESS BITES. The older risk-family RPC can
# still record an independent case review with no competency and no conflicts
# declaration (its form has no fields for them, and breaking that live path to
# make this row green would be the wrong trade). Such a review satisfies
# NOTHING here: get_case_assurance_position counts only II.15-complete
# reviews, so "satisfied" on the readiness screen means II.15-complete.
R=$(rpc "$RE" record_risk_assurance_review "{\"p_review\":{\"subject_type\":\"development_case\",\"subject_id\":\"$CASE_B\",\"assurance_level\":\"independent\",\"scope\":\"SMOKE3C legacy-path review with no competency and no declaration\",\"status\":\"completed\",\"conclusion\":\"acceptable\",\"evidence_item_ids\":[\"$EV_A\"]}}")
noerr "$R"
R=$(rpc "$RE" get_case_assurance_position "{\"p_case_id\":\"$CASE_B\"}")
noerr "$R"
test "$(jqp "$R" "x['satisfied']")" = "False"
test "$(jqp "$R" "len(x['reviews'])")" -ge 1
test "$(jqp "$R" "x['reviews'][0]['competencies']")" = "[]"
test "$(jqp "$R" "x['reviews'][0]['conflictsDeclaredAt'] is None")" = "True"

# §70 AT EVERY LEVEL. This slice made a completed line-1/line-2 review
# release a gate's assurance demand, so the AI-operator identity is refused as
# the reviewer at every level, not only 'independent' (Slice 3B's wall covers
# that one and still speaks first).
R=$(rpc "$AIBOT" record_case_assurance_review "{\"p_case_id\":\"$CASE_A\",\"p_review\":{\"assurance_level\":\"line_1\",\"scope\":\"SMOKE3C AI identity attempts a line-1 self review\"}}")
expect_err "$R" 'cannot record at any independence level'
OUT=$(sql_must_fail "insert into risk_assurance_reviews (organization_id, subject_type, subject_id, assurance_level, subject_owner_id, reviewer_id, scope, status)
values ('$ORG','development_case','$CASE_A','line_2','$PLANNER_ID','$AIBOT_ID','SMOKE3C raw line-2 by the AI identity','planned');")
grep -qi 'cannot stand as the reviewer at any independence level' <<<"$OUT"

# COMPETENCY IS VERIFIED AT EVERY LEVEL IT IS STATED. A line-2 review naming a
# key the roster does not recognise is refused by name — the roster check is
# not reserved for independent reviews while the consumption counts every
# level the same.
OUT=$(sql_must_fail "insert into risk_assurance_reviews (organization_id, subject_type, subject_id, assurance_level, subject_owner_id, reviewer_id, scope, status, reviewer_competency_keys)
values ('$ORG','development_case','$CASE_A','line_2','$PLANNER_ID','$RE_ID','SMOKE3C line-2 with a fabricated competency','planned','[\"NOT-A-REAL-COMPETENCY-XYZ\"]'::jsonb);")
grep -qi 'not defined in this organization' <<<"$OUT"

# THE DEMAND IS ARMED, so the blocker is provable rather than vacuous. The
# first draft of this transcript asserted the blocker was ABSENT after
# completing a review, with nothing proving it had ever been present — and it
# never had been, because no intensity binding was adopted in this
# organization, so `required` was false for every case the transcript touched
# and the assertion passed over an empty list.
R=$(rpc "$MANAGER" apply_case_governance "{\"p_case_id\":\"$CASE_A\",\"p_risk\":\"high\",\"p_complexity\":\"medium\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"permit_required\",\"p_interfaces\":\"multiple\",\"p_basis\":\"SMOKE3C classification so the assurance demand is real, not hypothetical.\"}")
noerr "$R"; test "$(printf '%s' "$R"|field intensity_level)" = "elevated"
BIND3C=$(psqlc "select id from governance_intensity_bindings where organization_id='$ORG' and intensity_level='elevated' and status='adopted' order by version desc limit 1")
if [ -z "$BIND3C" ]; then
  BIND3C=$(psqlc "select id from governance_intensity_bindings where organization_id='$ORG' and intensity_level='elevated' and status='draft' order by version desc limit 1")
  R=$(rpc "$EXEC" adopt_intensity_binding "{\"p_binding_id\":\"$BIND3C\",\"p_note\":\"Adopted for the slice-3C assurance transcript: the demand must be real for the blocker to be provable.\"}")
  noerr "$R"
fi
test -n "$BIND3C"
R=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G1}")
noerr "$R"
test "$(jqp "$R" "x['assurance']['required']")" = "True"
# The binding says line_2 AND independent_assurance_required: the demand is
# the HIGHER of the two, not whichever field is read last.
test "$(jqp "$R" "x['assurance']['bindingLevel']")" = "line_2"
test "$(jqp "$R" "x['assurance']['demandedLevel']")" = "independent"
test "$(jqp "$R" "x['assurance']['satisfied']")" = "False"
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='assurance_not_satisfied'])")" = "1"
test "$(jqp "$R" "len(x['assurance']['reviews'])")" -ge 1
test "$(jqp "$R" "x['assurance']['reviews'][0]['competencies']")" = "['smoke3c_assurance']"

# A LINE-1 SELF-REVIEW DOES NOT DISCHARGE A HIGHER DEMAND. Completed,
# acceptable, competency-verified, conflicts declared, bound to this gate —
# and still below the demanded level, so the blocker stands.
R=$(rpc "$MANAGER" record_case_assurance_review "{\"p_case_id\":\"$CASE_A\",\"p_review\":{\"assurance_level\":\"line_1\",\"scope\":\"SMOKE3C line-1 self review of the dust case\",\"gate_id\":$G1,\"reviewer_competency_keys\":[\"smoke3c_assurance\"],\"conflicts_declaration_made\":true}}")
noerr "$R"; AR_L1=$(printf '%s' "$R"|field review_id)
psqlc "insert into member_competencies (organization_id, member_id, competency_id, granted_on, expires_on)
       select '$ORG', wm.id, $COMP, current_date - 30, current_date + 365 from workforce_members wm
       where wm.organization_id='$ORG' and wm.user_id='$MANAGER_ID' on conflict do nothing;" >/dev/null
R=$(rpc "$MANAGER" complete_case_assurance_review "{\"p_review_id\":\"$AR_L1\",\"p_conclusion\":\"acceptable\",\"p_evidence_item_ids\":[\"$EV_A\"]}")
noerr "$R"
R=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "x['assurance']['satisfied']")" = "False"
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='assurance_not_satisfied'])")" = "1"

# The completing reviewer's conclusion is the reviewer's: the RPC accepts all
# four II.15 conclusions, not the one the first draft's button hardcoded.
R=$(rpc "$RE" complete_case_assurance_review "{\"p_review_id\":\"$AR1\",\"p_conclusion\":\"acceptable_with_actions\",\"p_evidence_item_ids\":[\"$EV_A\"]}")
noerr "$R"
test "$(printf '%s' "$R"|field conclusion)" = "acceptable_with_actions"
R=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G1}")
test "$(jqp "$R" "x['assurance']['satisfied']")" = "True"
test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='assurance_not_satisfied'])")" = "0"

# THE GATE BINDING IS LOAD-BEARING: the same review releases NOTHING at a
# different gate of the same case.
G_OTHER=$(psqlc "select id from stage_gates where framework_id='$BROWN' and id<>$G1 order by id limit 1")
if [ -n "$G_OTHER" ]; then
  R=$(rpc "$MANAGER" get_gate_readiness "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G_OTHER}")
  noerr "$R"
  test "$(jqp "$R" "x['assurance']['satisfied']")" = "False"
  test "$(jqp "$R" "len([b for b in x['blockers'] if b['type']=='assurance_not_satisfied'])")" = "1"
fi

# One case's evidence cannot complete another case's assurance review.
R=$(rpc "$RE" record_case_assurance_review "{\"p_case_id\":\"$CASE_B\",\"p_review\":{\"assurance_level\":\"line_2\",\"scope\":\"SMOKE3C cross-case evidence probe\",\"reviewer_competency_keys\":[\"smoke3c_assurance\"],\"conflicts_declaration_made\":true,\"evidence_item_ids\":[\"$EV_A\"]}}")
expect_err "$R" 'not recorded against this case'

# A completed conclusion is not overwritable.
R=$(rpc "$RE" complete_case_assurance_review "{\"p_review_id\":\"$AR1\",\"p_conclusion\":\"not_acceptable\",\"p_evidence_item_ids\":[\"$EV_A\"]}")
expect_err "$R" 'not overwritable'
echo '   competency verified at EVERY level and fail-closed; §70 refuses the AI identity at every level; the demand is the higher of the binding fields; a line-1 review does not discharge it; the gate binding scopes what a review releases'

echo '— 6. control assessment: design vs operating (D5.24) —'
# Fixtures: a context, a criteria profile, an adopted objective, a risk, a control.
# `-tAc` prints the command tag as well as the row, so the id is taken from
# the first line only.
CTX=$(psqlc "insert into risk_context_nodes (organization_id, scope_kind, name, status)
             values ('$ORG','site','SMOKE3C context','adopted') returning id" | head -1)
CRP=$(psqlc "insert into risk_criteria_profiles (organization_id, context_id, name, status, basis)
             values ('$ORG','$CTX','SMOKE3C criteria','adopted','SMOKE3C transcript fixture') returning id" | head -1)
R=$(rpc "$RE" upsert_risk_objective "{\"p_objective\":{\"description\":\"SMOKE3C keep boundary dust within the permitted limit\",\"target\":\"< 80 ug/m3\",\"measurement\":\"Boundary monitors, 24h mean\",\"timeframe\":\"Every quarter\",\"tolerance\":\"No exceedance\",\"objective_level\":\"site\",\"owner_id\":\"$MANAGER_ID\",\"context_id\":\"$CTX\"}}")
noerr "$R"; OBJ=$(printf '%s' "$R"|field objective_id); test -n "$OBJ"
R=$(rpc "$EXEC" adopt_risk_objective "{\"p_objective_id\":\"$OBJ\",\"p_note\":\"Adopted for the slice-3c transcript.\"}")
noerr "$R"
R=$(rpc "$RE" create_risk_assessment "{\"p_assessment\":{\"context_id\":\"$CTX\",\"criteria_profile_id\":\"$CRP\",\"title\":\"SMOKE3C dust exceedance during dry season\",\"objective_id\":\"$OBJ\",\"event_description\":\"Boundary dust exceeds the permitted limit during dry, windy periods\",\"current_risk_score\":70,\"current_risk_level\":\"High\",\"risk_owner_id\":\"$MANAGER_ID\",\"status\":\"identified\"}}")
noerr "$R"; RISK=$(printf '%s' "$R"|field risk_id); test -n "$RISK"
R=$(rpc "$RE" configure_risk_control "{\"p_risk_id\":\"$RISK\",\"p_control\":{\"name\":\"SMOKE3C water cart suppression rounds\",\"control_type\":\"preventive\",\"intended_effect\":\"Suppress road dust before it reaches the boundary\",\"intended_modifier\":\"likelihood\",\"control_owner_id\":\"$MANAGER_ID\",\"design_status\":\"implemented\",\"test_frequency_days\":90}}")
noerr "$R"; CTRL=$(printf '%s' "$R"|field control_id); test -n "$CTRL"

# Effective operation over an ineffective design is refused at the RPC...
R=$(rpc "$RE" record_risk_control_test "{\"p_control_id\":\"$CTRL\",\"p_test\":{\"test_method\":\"Route audit\",\"result\":\"passed\",\"intended_effect_observed\":true,\"failures_despite_control\":0,\"note\":\"Rounds completed on every audited shift.\",\"design_effectiveness\":\"ineffective\",\"operating_effectiveness\":\"effective\"}}")
expect_err "$R" 'design is ineffective cannot be recorded as operating effectively'
# ... and at the persistence boundary, for every writer.
OUT=$(sql_must_fail "insert into risk_control_tests (organization_id, control_id, test_method, result, note, design_effectiveness, operating_effectiveness)
values ('$ORG','$CTRL','raw','passed','raw write must be refused','ineffective','effective');")
grep -qi 'cannot be recorded as operating effectively' <<<"$OUT"
# A non-finite confidence is refused explicitly.
R=$(rpc "$RE" record_risk_control_test "{\"p_control_id\":\"$CTRL\",\"p_test\":{\"test_method\":\"Route audit\",\"result\":\"passed\",\"intended_effect_observed\":true,\"failures_despite_control\":0,\"note\":\"Rounds completed on every audited shift.\",\"design_effectiveness\":\"effective\",\"operating_effectiveness\":\"effective\",\"assessment_confidence\":\"NaN\"}}")
expect_err "$R" 'finite percentage'

# The two dimensions are recorded as two answers.
R=$(rpc "$RE" record_risk_control_test "{\"p_control_id\":\"$CTRL\",\"p_test\":{\"test_method\":\"Route audit and coverage check\",\"result\":\"passed\",\"intended_effect_observed\":true,\"failures_despite_control\":0,\"note\":\"Rounds completed on every audited shift; coverage matched the plan.\",\"design_effectiveness\":\"effective\",\"operating_effectiveness\":\"partially_effective\",\"assessment_confidence\":70}}")
noerr "$R"
test "$(printf '%s' "$R"|field design_effectiveness)" = "effective"
test "$(printf '%s' "$R"|field operating_effectiveness)" = "partially_effective"
test "$(psqlc "select effectiveness_rating from risk_controls where id='$CTRL'")" = "effective"

# The cap only NARROWS: a later ineffective DESIGN drives the control rating
# to ineffective however well it has been passing.
R=$(rpc "$RE" record_risk_control_test "{\"p_control_id\":\"$CTRL\",\"p_test\":{\"test_method\":\"Design review against the dispersion model\",\"result\":\"passed\",\"intended_effect_observed\":true,\"failures_despite_control\":0,\"note\":\"Suppression cannot reach the elevated release point at all.\",\"design_effectiveness\":\"ineffective\",\"operating_effectiveness\":\"not_assessed\"}}")
noerr "$R"
test "$(printf '%s' "$R"|field rating)" = "ineffective"
test "$(psqlc "select effectiveness_rating from risk_controls where id='$CTRL'")" = "ineffective"
R=$(rpc "$RE" get_control_assessment_history "{\"p_control_id\":\"$CTRL\"}")
noerr "$R"
test "$(jqp "$R" "x['latestDesignEffectiveness']")" = "ineffective"
# The latest review deliberately did not assess operation, and the read says
# so rather than presenting the older judgement as current — while still
# carrying that judgement, with its date, beside it.
test "$(jqp "$R" "x['latestOperatingEffectiveness']")" = "not_assessed"
test "$(jqp "$R" "x['lastJudgedOperatingEffectiveness']['value']")" = "partially_effective"
test "$(jqp "$R" "x['lastJudgedDesignEffectiveness']['value']")" = "ineffective"
# §70: the AI identity may record a test result; it does not judge design or
# operation.
R=$(rpc "$AIBOT" record_risk_control_test "{\"p_control_id\":\"$CTRL\",\"p_test\":{\"test_method\":\"Automated walkthrough\",\"result\":\"passed\",\"intended_effect_observed\":true,\"note\":\"The AI identity attempts a §14 conclusion.\",\"design_effectiveness\":\"effective\"}}")
expect_err "$R" '§70 human determination'

# THE CAP READS THE CONTROL'S STANDING JUDGEMENT, not this call's payload. The
# ROS form defaults design_effectiveness to 'not_assessed' and always submits
# it, so capping on the payload let one routine walkthrough restore
# 'effective' on a control whose last real design judgement was 'ineffective'
# — while the read this slice ships went on reporting that judgement.
R=$(rpc "$RE" record_risk_control_test "{\"p_control_id\":\"$CTRL\",\"p_test\":{\"test_method\":\"Routine walkthrough\",\"result\":\"passed\",\"intended_effect_observed\":true,\"failures_despite_control\":0,\"note\":\"Routine walkthrough with the §14 dropdowns untouched.\",\"design_effectiveness\":\"not_assessed\",\"operating_effectiveness\":\"not_assessed\"}}")
noerr "$R"
test "$(printf '%s' "$R"|field rating)" = "ineffective"
test "$(psqlc "select effectiveness_rating from risk_controls where id='$CTRL'")" = "ineffective"
# And the two surfaces agree: the read cannot assemble design=ineffective with
# operating=effective across two rows, because both come from ONE assessment.
R=$(rpc "$RE" get_control_assessment_history "{\"p_control_id\":\"$CTRL\"}")
noerr "$R"
test "$(jqp "$R" "x['latestAssessment']['designEffectiveness']")" = "not_assessed"
test "$(jqp "$R" "x['latestDesignEffectiveness']")" = "not_assessed"
test "$(jqp "$R" "x['latestOperatingEffectiveness']")" = "not_assessed"
test "$(jqp "$R" "x['lastJudgedDesignEffectiveness']['value']")" = "ineffective"
# A malformed confidence is NAMED, not raised as a raw Postgres cast error.
R=$(rpc "$RE" record_risk_control_test "{\"p_control_id\":\"$CTRL\",\"p_test\":{\"test_method\":\"Walkthrough\",\"result\":\"passed\",\"note\":\"Malformed confidence probe.\",\"assessment_confidence\":\"quite sure\"}}")
expect_err "$R" 'is not one'
echo '   two dimensions recorded separately; incoherent claim refused at both doors; the rating cap reads the STANDING design judgement; §70 refuses an AI-recorded §14 conclusion; the read cannot assemble the forbidden pair'

echo '— 7. a treatment that creates a risk creates a LINKED risk (D5.25) —'
# An unrated secondary risk refuses the WHOLE treatment before anything is written.
SCN_B=$(psqlc "select count(*) from scenarios where organization_id='$ORG' and risk_id='$RISK'")
R=$(rpc "$RE" create_risk_treatment "{\"p_risk_id\":\"$RISK\",\"p_option\":{\"key\":\"suppress\",\"label\":\"SMOKE3C enclose the transfer point\",\"strategy\":\"change_likelihood\",\"residual_risk\":30,\"introduced_risks\":[\"confined space entry for cleaning\"],\"new_risk_created\":[{\"title\":\"SMOKE3C confined space entry for enclosure cleaning\",\"event_description\":\"A cleaner is overcome inside the enclosure\"}]}}")
expect_err "$R" 'is unrated'
test "$(psqlc "select count(*) from scenarios where organization_id='$ORG' and risk_id='$RISK'")" = "$SCN_B"
# A contradiction is refused: nothing introduced, yet something created.
R=$(rpc "$RE" create_risk_treatment "{\"p_risk_id\":\"$RISK\",\"p_option\":{\"key\":\"suppress\",\"label\":\"SMOKE3C enclose the transfer point\",\"strategy\":\"change_likelihood\",\"residual_risk\":30,\"introduced_risks\":[],\"new_risk_created\":[{\"title\":\"SMOKE3C confined space entry\",\"event_description\":\"A cleaner is overcome inside the enclosure\",\"current_risk_score\":55,\"current_risk_level\":\"High\"}]}}")
expect_err "$R" 'introduce nothing and introduce something'
# An invalid strategy is refused; the DB now enforces the enum too.
OUT=$(sql_must_fail "insert into scenarios (organization_id, risk_id, key, label, treatment_strategy) values ('$ORG','$RISK','x','raw','mitigate_somehow');")
grep -qi 'scenarios_treatment_strategy_check' <<<"$OUT"
# THE RATING ENTERS THE ARITHMETIC. A treatment claiming it introduces
# nothing while creating a risk rated 55 is refused by name: net_risk_change
# would otherwise report an improvement the treatment's own hazard contradicts.
R=$(rpc "$RE" create_risk_treatment "{\"p_risk_id\":\"$RISK\",\"p_option\":{\"key\":\"enclose\",\"label\":\"SMOKE3C enclose the transfer point\",\"strategy\":\"change_likelihood\",\"residual_risk\":30,\"introduced_risk\":10,\"introduced_risks\":[\"confined space entry for cleaning\"],\"new_risk_created\":[{\"title\":\"SMOKE3C confined space entry for enclosure cleaning\",\"event_description\":\"A cleaner is overcome by dust or oxygen deficiency inside the enclosure\",\"current_risk_score\":55,\"current_risk_level\":\"High\",\"risk_owner_id\":\"$MANAGER_ID\"}]}}")
expect_err "$R" 'must be at least the greatest secondary-risk score'
test "$(psqlc "select count(*) from scenarios where organization_id='$ORG' and risk_id='$RISK'")" = "$SCN_B"

# The good path: the secondary risk becomes a real, linked, audited risk.
R=$(rpc "$RE" create_risk_treatment "{\"p_risk_id\":\"$RISK\",\"p_option\":{\"key\":\"enclose\",\"label\":\"SMOKE3C enclose the transfer point\",\"strategy\":\"change_likelihood\",\"residual_risk\":30,\"introduced_risk\":55,\"introduced_risks\":[\"confined space entry for cleaning\"],\"new_risk_created\":[{\"title\":\"SMOKE3C confined space entry for enclosure cleaning\",\"event_description\":\"A cleaner is overcome by dust or oxygen deficiency inside the enclosure\",\"current_risk_score\":55,\"current_risk_level\":\"High\",\"risk_owner_id\":\"$MANAGER_ID\"}]}}")
noerr "$R"
SCN=$(printf '%s' "$R"|field scenario_id); test -n "$SCN"
SEC_RISK=$(jqp "$R" "x['secondary_risks'][0]['risk_id']"); test -n "$SEC_RISK"
test "$(psqlc "select secondary_to_risk_id from risks where id='$SEC_RISK'")" = "$RISK"
test "$(psqlc "select arising_from_scenario_id from risks where id='$SEC_RISK'")" = "$SCN"
# It inherits the parent's objective — it threatens what the parent threatens.
test "$(psqlc "select objective_id from risks where id='$SEC_RISK'")" = "$OBJ"
test "$(psqlc "select current_risk_level from risks where id='$SEC_RISK'")" = "High"
psqlc "select 1 from audit_events where organization_id='$ORG' and entity_type='risk_secondary_created' and event_data->>'risk_id'='$SEC_RISK' and event_data->>'parent_risk_id'='$RISK' limit 1" | grep -q 1
R=$(rpc "$RE" get_risk_secondary_risks "{\"p_risk_id\":\"$RISK\"}")
noerr "$R"
test "$(jqp "$R" "len(x['createdRisks'])")" = "1"
test "$(jqp "$R" "x['createdRisks'][0]['strategy']")" = "change_likelihood"
# A cycle is refused.
OUT=$(sql_must_fail "update risks set secondary_to_risk_id='$SEC_RISK' where id='$RISK';")
grep -qi 'cycle' <<<"$OUT"
# THE SENSITIVITY LADDER APPLIES TO THE DEFINER READ. A restricted risk is
# invisible to a technician through RLS; it must be invisible through this
# function too, along with every child risk's title, score, owner and
# treatment.
psqlc "update risks set information_sensitivity='restricted' where id='$RISK';" >/dev/null
R=$(rpc "$TECH" get_risk_secondary_risks "{\"p_risk_id\":\"$RISK\"}")
expect_err "$R" 'risk not found in this organization'
psqlc "update risks set information_sensitivity='internal' where id='$RISK';" >/dev/null
R=$(rpc "$RE" get_risk_secondary_risks "{\"p_risk_id\":\"$RISK\"}")
noerr "$R"
# The secondary risk's provenance cannot be silently severed.
CHANGED=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tA <<SQL
begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
set local role authenticated;
with d as (delete from scenarios where id='$SCN' returning 1) select 'SCN_DELETED=' || count(*) from d;
rollback;
SQL
)
grep -q 'SCN_DELETED=0' <<<"$CHANGED"
echo '   unrated secondary risk refused before any write; the rating enters net_risk_change; rated one created, linked both ways, inheriting the objective, audited; cycle refused; the read applies the sensitivity ladder and the provenance is unseverable'

echo '— 8. evidence confidence, computed or refused by name (D11.22) —'
# Re-runnable from the state a previous run left: the versioning probe at the
# end of this step adopts a v2, so the transcript starts by restoring the
# shipped position (one DRAFT v1, nothing adopted) exactly as the slice-3
# transcript restores its intensity bindings.
psqlc "delete from evidence_confidence_profiles where organization_id='$ORG' and version > 1;
       update evidence_confidence_profiles set status='draft', adopted_by=null, adopted_at=null, superseded_by=null
       where organization_id='$ORG';" >/dev/null
# No adopted weight set: a REFUSAL, never a built-in default.
test "$(psqlc "select count(*) from evidence_confidence_profiles where organization_id='$ORG' and status='adopted'")" = "0"
R=$(rpc "$RE" compute_evidence_confidence "{\"p_evidence_id\":\"$EV_A\"}")
expect_err "$R" 'no built-in default to fall back to'
test "$(jqp "$R" "x['refusal']")" = "no_adopted_profile"

PROF=$(psqlc "select id from evidence_confidence_profiles where organization_id='$ORG' and status='draft' order by version desc limit 1")
test -n "$PROF"
# An incomplete weight set cannot be adopted.
R=$(rpc "$EXEC" set_evidence_confidence_weights "{\"p_profile_id\":\"$PROF\",\"p_weights\":{\"quality_weights\":{\"high\":1.0}}}")
noerr "$R"
R=$(rpc "$EXEC" adopt_evidence_confidence_profile "{\"p_profile_id\":\"$PROF\"}")
expect_err "$R" 'cannot be adopted'
# Restore the full set and adopt it.
R=$(rpc "$EXEC" set_evidence_confidence_weights "{\"p_profile_id\":\"$PROF\",\"p_weights\":{\"quality_weights\":{\"high\":1.0,\"moderate\":0.7,\"low\":0.4}}}")
noerr "$R"
R=$(rpc "$EXEC" adopt_evidence_confidence_profile "{\"p_profile_id\":\"$PROF\"}")
noerr "$R"; test "$(printf '%s' "$R"|field status)" = "adopted"

# Ungraded evidence REFUSES, naming every missing factor — no midpoint.
R=$(rpc "$RE" compute_evidence_confidence "{\"p_evidence_id\":\"$EV_A\"}")
expect_err "$R" 'cannot be computed'
test "$(jqp "$R" "x['refusal']")" = "missing_factors"
test "$(jqp "$R" "len(x['missingFactors'])")" = "2"
test "$(jqp "$R" "'quality (Q)' in ' '.join(x['missingFactors'])")" = "True"
test "$(jqp "$R" "'applicability (A)' in ' '.join(x['missingFactors'])")" = "True"

# Graded, it computes — and carries the weights that produced it.
R=$(rpc "$RE" grade_evidence_item "{\"p_evidence_id\":\"$EV_A\",\"p_quality_grade\":\"high\",\"p_applicability_grade\":\"direct\"}")
noerr "$R"
R=$(rpc "$RE" compute_evidence_confidence "{\"p_evidence_id\":\"$EV_A\"}")
noerr "$R"
test "$(jqp "$R" "x['factors']['quality']['weight'] == 1.0")" = "True"
test "$(jqp "$R" "x['factors']['applicability']['weight'] == 1.0")" = "True"
test "$(jqp "$R" "x['factors']['verification']['status']")" = "unverified"
test "$(jqp "$R" "0 < x['evidenceConfidence'] <= 1")" = "True"
test "$(jqp "$R" "x['profile']['version']")" = "1"
test "$(jqp "$R" "len(x['profile']['basis']) > 20")" = "True"
EC_UNVERIFIED=$(jqp "$R" "x['evidenceConfidence']")

# Verifying the evidence RAISES V, so EC rises — the factor is live, not a label.
R=$(rpc "$RE" verify_evidence_item "{\"p_evidence_id\":\"$EV_A\",\"p_method\":\"Independent check of the commissioning record against the monitor serial numbers\",\"p_outcome\":\"verified\"}")
noerr "$R"
R=$(rpc "$RE" compute_evidence_confidence "{\"p_evidence_id\":\"$EV_A\"}")
noerr "$R"
test "$(jqp "$R" "x['evidenceConfidence'] > $EC_UNVERIFIED")" = "True"

# The case read surfaces EC beside every evidence item, refusals included.
R=$(rpc "$RE" record_case_evidence "{\"p_case_id\":\"$CASE_A\",\"p_evidence\":{\"evidence_class\":\"EXPERT_JUDGEMENT\",\"description\":\"SMOKE3C ungraded expert opinion on likely dry-season exceedance\",\"source_system\":\"ci-transcript\"}}")
noerr "$R"
R=$(rpc "$RE" get_case_chains "{\"p_case_id\":\"$CASE_A\"}")
noerr "$R"
test "$(jqp "$R" "x['evidenceConfidence']['scoredCount']")" -ge 1
test "$(jqp "$R" "x['evidenceConfidence']['refusedCount']")" -ge 1
test "$(jqp "$R" "x['evidenceConfidence']['profile']['name']")" = "Default evidence confidence"
# Every item carries its raw §46 inputs, refused ones included, so the surface
# can PREVIEW what a grade would produce with the tenant's own weights
# (src/lib/develop/chains.ts:evidenceConfidence) instead of grading blind.
test "$(jqp "$R" "all('verificationStatus' in i and 'evidenceClass' in i and 'observedAt' in i for i in x['evidenceConfidence']['items'])")" = "True"
# The chains read composes the SAME coverage function the gate blocker uses.
test "$(jqp "$R" "x['coverage']['uncoveredCount']")" -ge 1
test "$(jqp "$R" "len(x['regulatory'])")" = "1"
test "$(jqp "$R" "x['regulatory'][0]['applications'][0]['approval']['conditions'][0]['propagation'] is not None")" = "True"
test "$(jqp "$R" "len(x['assurance'])")" -ge 1
test "$(jqp "$R" "len(x['commitments'])")" = "3"
# A REJECTED ITEM SCORES ZERO — a position, not a refusal. The transcript
# header claimed this and asserted it nowhere; it is the one place in Q×A×F×V
# where a legitimate 0 and a refusal are easy to conflate.
R=$(rpc "$RE" record_case_evidence "{\"p_case_id\":\"$CASE_A\",\"p_evidence\":{\"evidence_class\":\"MEASURED\",\"description\":\"SMOKE3C rejected reading kept for the zero-score transcript\",\"source_system\":\"ci-transcript\"}}")
noerr "$R"; EV_REJ=$(printf '%s' "$R"|field evidence_id)
R=$(rpc "$RE" grade_evidence_item "{\"p_evidence_id\":\"$EV_REJ\",\"p_quality_grade\":\"high\",\"p_applicability_grade\":\"direct\"}")
noerr "$R"
R=$(rpc "$RE" verify_evidence_item "{\"p_evidence_id\":\"$EV_REJ\",\"p_method\":\"Independent check against the instrument log\",\"p_outcome\":\"rejected\",\"p_note\":\"The reading could not be reproduced from the instrument log.\"}")
noerr "$R"
R=$(rpc "$RE" compute_evidence_confidence "{\"p_evidence_id\":\"$EV_REJ\"}")
noerr "$R"
test "$(jqp "$R" "float(x['evidenceConfidence'])")" = "0.0"
test "$(jqp "$R" "'refusal' in x")" = "False"
test "$(jqp "$R" "x['factors']['verification']['weight']")" = "0.0"

# THE WEIGHTS ARE THE TENANT'S, WHICH MEANS THE TENANT CAN CHANGE THEM. The
# first draft shipped no way to create a new version, so a tenant's weights
# froze permanently on first adoption and the refusal below named a remedy the
# system did not have.
ADOPTED_P=$(psqlc "select id from evidence_confidence_profiles where organization_id='$ORG' and status='adopted'")
test -n "$ADOPTED_P"
R=$(rpc "$EXEC" set_evidence_confidence_weights "{\"p_profile_id\":\"$ADOPTED_P\",\"p_weights\":{\"quality_weights\":{\"high\":0.9}}}")
expect_err "$R" 'create a new version and adopt it'
R=$(rpc "$EXEC" create_evidence_confidence_profile_version "{\"p_from_profile_id\":\"$ADOPTED_P\"}")
noerr "$R"; P_V2=$(printf '%s' "$R"|field profile_id)
test "$(printf '%s' "$R"|field version)" = "2"
test "$(printf '%s' "$R"|field status)" = "draft"
# A second unadopted version of the same set is refused by name.
R=$(rpc "$EXEC" create_evidence_confidence_profile_version "{\"p_from_profile_id\":\"$ADOPTED_P\"}")
expect_err "$R" 'a draft of'
# A non-numeric weight is NAMED at adoption, not raised as a raw 22P02.
R=$(rpc "$EXEC" set_evidence_confidence_weights "{\"p_profile_id\":\"$P_V2\",\"p_weights\":{\"quality_weights\":{\"high\":\"very high\",\"moderate\":0.7,\"low\":0.4}}}")
noerr "$R"
R=$(rpc "$EXEC" adopt_evidence_confidence_profile "{\"p_profile_id\":\"$P_V2\"}")
expect_err "$R" 'quality.high'
R=$(rpc "$EXEC" set_evidence_confidence_weights "{\"p_profile_id\":\"$P_V2\",\"p_weights\":{\"quality_weights\":{\"high\":0.9,\"moderate\":0.6,\"low\":0.3}}}")
noerr "$R"
R=$(rpc "$EXEC" adopt_evidence_confidence_profile "{\"p_profile_id\":\"$P_V2\"}")
noerr "$R"; test "$(printf '%s' "$R"|field status)" = "adopted"
test "$(psqlc "select status from evidence_confidence_profiles where id='$ADOPTED_P'")" = "superseded"
# EVERY organization gets a draft, including ones created after this migration.
NEWORG=$(psqlc "insert into organizations (name) values ('SMOKE3C late tenant') returning id" | head -1)
test "$(psqlc "select count(*) from evidence_confidence_profiles where organization_id='$NEWORG' and status='draft'")" = "1"
psqlc "delete from evidence_confidence_profiles where organization_id='$NEWORG'; delete from organizations where id='$NEWORG';" >/dev/null

echo '   refused with no adopted set; refused naming the ungraded factors; computed with its weights; verification moved it; a rejected item scores ZERO; the weights are versionable, adoptable and seeded for every tenant; surfaced on the case read'

echo
echo 'Develop slice-3c smoke PASSED: commitments and coverage, the regulatory chain with propagation into delivery AND operations, breach visibility through the ONE sweep, assurance with verified competency and declared conflicts, design-vs-operating control assessment, treatment secondary risk, and evidence confidence computed or refused by name.'

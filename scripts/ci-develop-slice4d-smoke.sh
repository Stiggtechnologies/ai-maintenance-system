#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 4D — Contingency as a ledger, change control on the
# existing MOC engine, decision latency and decision debt, and the two screens
# that compose it all. Every step is a live transcript against a real local
# database.
#
# THE THING THIS TRANSCRIPT EXISTS TO PROVE: this is the first Sync Develop
# feature that SPENDS A BUDGET, so the refusals are watched harder than the
# successes. Money is watched NOT moving — through a non-finite amount, a
# negative one, a cause nobody named, a fund with nothing left, a role nobody
# delegated to, a delegation with a blank ceiling, an amount above the ceiling
# and an AI identity — and then moving exactly once, inside somebody's recorded
# authority, attributed to a named cause.
#
# Steps:
#   1  the fund: refused before it exists, established against an APPROVED
#      COST baseline only, immutable once established.
#   2  the drawdown door's refusals (D5.18): NaN, Infinity, negative, zero, no
#      cause, `unattributed` chosen by hand, a realized-risk draw citing no
#      risk, more than remains, and §70's AI identity.
#   3  authority (R1/R2): no adopted ladder REFUSES (it does not pass), a null
#      ceiling REFUSES (it is not unlimited), and an amount over the ceiling is
#      refused BY NAME with the ceiling and the escalation in the sentence.
#   4  the spend, and the ledger: balance recorded, entry immutable, TRUNCATE
#      refused at statement level, the pool wall closed, and a release that
#      cannot exceed what was taken.
#   5  consumption by cause (D5.19): every class always reported, the
#      `unattributed` bucket present and empty, then a service-inserted
#      unattributed row SHOWN rather than dropped.
#   6  change control (D5.27/D5.30): raised against a baseline, assessed with a
#      complete impact vector, refused for a missing engineering sign-off, for
#      segregation of duties, and for an undelegated approver; then approved,
#      propagated over the hops Sync OWNS, and refused implementation while an
#      obligation is outstanding.
#   7  the change→contingency hop: a drawdown attributed to an approved change,
#      refused against a proposal and refused for the requester.
#   8  decision latency (D3.12/D3.36): refused on an empty register, per
#      decision once there are decisions, with unmeasurable ones NAMED.
#   9  critical-path exposure (D3.13): refused with no imported float, then
#      answered from P6's own float.
#  10  decision debt (D3.21): refused on an empty set, refused when nothing is
#      quantified, a probability outside [0,1] refused rather than clamped.
#  11  the two screens (D13.08/D13.02): every dimension composed from a
#      RECORDED RUN, "no run recorded" where there is none, procurement shown
#      empty and named, and the per-user queue with its three new columns.
#  12  lineage (D11.29): every 4D calculation records a run including its
#      refusals; the ledger is immutable; TRUNCATE refused on all three new
#      tables.
#  13  tenancy: every client-callable 4D read and act probed as a REAL
#      provisioned FOREIGN TENANT and as an ORPHAN JWT holder.
#
# Run: supabase start && scripts/ci-develop-slice4d-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-4d smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
ENGINEER=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$TECH"; test -n "$EXEC"; test -n "$ENGINEER"

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

# The FOREIGN tenant, provisioned exactly as the 4A/4B/4C transcripts provision
# it: a real organization with a real member, so step 13 probes tenancy with a
# JWT that has an org rather than only with an orphan.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
-- Its OWN uuid. 4A, 4B and 4C each seed a foreign tenant, and reusing one
-- of their ids collides on auth.users' primary key the moment two smokes run
-- in the same database — which is exactly what CI does.
declare v_uid uuid := '8d8d8d8d-8888-4888-8888-8d8d8d8d8d8d';
        v_org uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into organizations (id, name) values (v_org, 'S4D foreign tenant')
    on conflict (id) do nothing;
  if not exists (select 1 from auth.users where email = 'smoke4d-foreign@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke4d-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', 'S4D foreign member'),
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
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke4d-foreign@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  insert into user_profiles (id, organization_id, email, role)
  values (v_uid, v_org, 'smoke4d-foreign@syncai.ca', 'maintenance_manager')
  on conflict (id) do update set role = 'maintenance_manager', organization_id = v_org;
end $seed$;
PSQL
FOREIGN_T=$(token 'smoke4d-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGN_T"

# Idempotent re-run. The 4D ledgers refuse client deletes by design, so the
# service path is used and the triggers audit it — which is the posture, not a
# workaround.
CLEAN="select id from development_cases where title like 'SMOKE4D %'"
# THE FUND AND ITS LEDGER DISAPPEAR ONLY WITH THE CASE (4D-R10). A targeted
# delete of a recorded spend is refused for EVERY caller, service paths
# included — the balance is derived from the entries, so removing one hands
# back money that was already committed. Deleting the case removes both by
# cascade, which is the one admitted disappearance and is itself audited, so
# the cleanup deletes the CASE first and the rest of the fixture after it.
psqlc "delete from development_cases where title like 'SMOKE4D %';" >/dev/null
psqlc "delete from project_change_propagation where change_id in (select id from project_changes where development_case_id in ($CLEAN));" >/dev/null
psqlc "delete from project_changes where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from decision_delay_exposures where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from decision_schedule_links where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from decisions where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from calculation_runs where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_scope_changes where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_wbs_elements where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from shutdown_task_dependencies where event_id in (select id from shutdown_events where organization_id='$ORG' and development_case_id in ($CLEAN));" >/dev/null
psqlc "delete from shutdown_tasks where event_id in (select id from shutdown_events where organization_id='$ORG' and development_case_id in ($CLEAN));" >/dev/null
psqlc "delete from shutdown_events where organization_id='$ORG' and development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from project_cost_items where development_case_id in ($CLEAN);" >/dev/null
psqlc "delete from development_baselines where development_case_id in ($CLEAN);" >/dev/null
# The ladders go back to how the migration seeded them: ONE DRAFT per act, with
# the money ceiling blank. Both halves matter — step 3 proves that an unadopted
# ladder refuses AND that an adopted one with no stated number refuses.
#
# An adopted money delegation is SUPERSEDED, never un-adopted: the wall added in
# 20261203090400 refuses returning one to draft for every caller, because
# recorded drawdowns quote the instrument they were checked against. A pure
# DRAFT enforces nothing and is referenced by nothing, so a leftover one from a
# failed run is deleted. Both halves of the reset are the product's own rules.
psqlc "update authority_limits set status='superseded' where organization_id='$ORG' and action_type in ('contingency_drawdown','change_approval') and status='adopted';" >/dev/null
psqlc "delete from authority_limits where organization_id='$ORG' and action_type in ('contingency_drawdown','change_approval') and status='draft';" >/dev/null
psqlc "insert into authority_limits (organization_id, role_key, tier_label, action_type, max_commitment_usd, escalates_to_role, basis, status) select '$ORG', v.rk, v.tl, v.at, null, v.esc, v.b, 'draft' from (values ('maintenance_manager','Project manager','contingency_drawdown','executive','Reseeded for the slice-4D transcript: the amount is deliberately null so a null ceiling refuses.'),('executive','Executive','contingency_drawdown','board','Reseeded for the slice-4D transcript: the executive rung, left blank so self-adoption and the null ceiling can both be probed.'),('maintenance_manager','Project manager','change_approval','executive','Reseeded for the slice-4D transcript: the amount is deliberately null so a null ceiling refuses.')) as v(rk,tl,at,esc,b);" >/dev/null

BODY=$(rpc "$PLANNER" create_development_case '{"p_title":"SMOKE4D controls case","p_problem_statement":"Contingency is drawn down in a spreadsheet nobody can audit and the change log is an email thread.","p_lifecycle_type":"reliability_improvement"}')
noerr "$BODY"; CASE=$(printf '%s' "$BODY" | field case_id); test -n "$CASE"

echo "── 1. the fund: no pool is not a balance of zero ────────────────────────"

BODY=$(rpc "$PLANNER" get_case_contingency "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['poolCount']")" = "0"
grep -qi 'no contingency fund is established' <<<"$(printf '%s' "$BODY" | field refusal)"
grep -qi 'different fact from a fund with nothing left' <<<"$(printf '%s' "$BODY" | field refusal)"
# ...and the CALCULATION refuses too, rather than recording 0% consumed.
BODY=$(rpc "$MANAGER" compute_case_contingency_consumption "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(psqlc "select status from calculation_runs where development_case_id='$CASE' and calculation_key='case_contingency_consumption' order by computed_at desc limit 1")" = "refused"
echo "   an absent fund refuses; the refusal is recorded as a run"

# A DRAFT baseline cannot hold a fund: it still changes by being edited.
BODY=$(rpc "$MANAGER" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"COST\",\"p_description\":\"Class 3 estimate for the SMOKE4D scope, priced from the last comparable unit.\"}")
noerr "$BODY"; BL=$(printf '%s' "$BODY" | field baseline_id); test -n "$BL"
BODY=$(rpc "$MANAGER" establish_contingency_pool "{\"p_case_id\":\"$CASE\",\"p_pool\":{\"baseline_id\":\"$BL\",\"original_amount\":\"1000000\",\"currency\":\"CAD\",\"basis\":\"Ten percent of the Class 3 estimate, per the capital procedure.\"}}")
expect_err "$BODY" 'is draft'

# A SCOPE baseline cannot hold a cost reserve either.
BODY=$(rpc "$MANAGER" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"SCOPE\",\"p_description\":\"Scope baseline for the SMOKE4D case at the end of definition.\"}")
noerr "$BODY"; SCOPE_BL=$(printf '%s' "$BODY" | field baseline_id)
BODY=$(rpc "$MANAGER" approve_case_baseline "{\"p_baseline_id\":\"$SCOPE_BL\",\"p_note\":\"Scope frozen at the end of definition; approved by the project manager.\"}")
noerr "$BODY"
BODY=$(rpc "$MANAGER" establish_contingency_pool "{\"p_case_id\":\"$CASE\",\"p_pool\":{\"baseline_id\":\"$SCOPE_BL\",\"original_amount\":\"1000000\",\"currency\":\"CAD\",\"basis\":\"Ten percent of the Class 3 estimate, per the capital procedure.\"}}")
expect_err "$BODY" 'contingency is held against a COST baseline'

BODY=$(rpc "$MANAGER" approve_case_baseline "{\"p_baseline_id\":\"$BL\",\"p_note\":\"Class 3 estimate approved as the cost baseline for this case.\"}")
noerr "$BODY"

# §70: the AI identity cannot establish the fund.
BODY=$(rpc "$AIBOT" establish_contingency_pool "{\"p_case_id\":\"$CASE\",\"p_pool\":{\"baseline_id\":\"$BL\",\"original_amount\":\"1000000\",\"currency\":\"CAD\",\"basis\":\"Ten percent of the Class 3 estimate, per the capital procedure.\"}}")
expect_err "$BODY" 'no AI or system identity may make that determination'

# An amount that is not a finite positive number is refused at the door.
for BAD in NaN Infinity -1 0; do
  BODY=$(rpc "$MANAGER" establish_contingency_pool "{\"p_case_id\":\"$CASE\",\"p_pool\":{\"baseline_id\":\"$BL\",\"original_amount\":\"$BAD\",\"currency\":\"CAD\",\"basis\":\"Ten percent of the Class 3 estimate, per the capital procedure.\"}}")
  expect_err "$BODY" 'finite amount greater than zero'
done
# ...and an amount with no stated basis is the slush fund II.8 names.
BODY=$(rpc "$MANAGER" establish_contingency_pool "{\"p_case_id\":\"$CASE\",\"p_pool\":{\"baseline_id\":\"$BL\",\"original_amount\":\"1000000\",\"currency\":\"CAD\",\"basis\":\"ten percent\"}}")
expect_err "$BODY" 'not an invisible slush fund'

BODY=$(rpc "$MANAGER" establish_contingency_pool "{\"p_case_id\":\"$CASE\",\"p_pool\":{\"baseline_id\":\"$BL\",\"original_amount\":\"1000000\",\"currency\":\"CAD\",\"basis\":\"Ten percent of the Class 3 estimate, per the capital procedure.\"}}")
noerr "$BODY"; POOL=$(printf '%s' "$BODY" | field pool_id); test -n "$POOL"
test "$(printf '%s' "$BODY" | field remaining)" = "1000000"
echo "   the fund exists only against an APPROVED COST baseline, with a stated basis"

# One pool per baseline: the original amount is fixed when it is established.
BODY=$(rpc "$MANAGER" establish_contingency_pool "{\"p_case_id\":\"$CASE\",\"p_pool\":{\"baseline_id\":\"$BL\",\"original_amount\":\"2000000\",\"currency\":\"CAD\",\"basis\":\"Ten percent of the Class 3 estimate, per the capital procedure.\"}}")
expect_err "$BODY" 'already exists against this baseline'
# ...and the pool row itself cannot be edited into a bigger one.
sql_must_fail "update project_contingency_pools set original_amount = 9000000 where id = '$POOL';" >/dev/null
echo "   the original amount is fixed at establishment for every caller"

echo "── 2. the drawdown door: money does not move on a malformed request ─────"

DRAW(){ rpc "$2" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":$1}"; }
J='"justification":"Weld repair on the skid nozzle discovered during fit-up."'

# R4: NaN and Infinity are LEGAL numerics in Postgres and pass every inequality
# vacuously. They are refused before any balance arithmetic sees them.
for BAD in NaN Infinity -Infinity; do
  BODY=$(DRAW "{\"amount\":\"$BAD\",\"cause_class\":\"scope_maturation\",$J}" "$MANAGER")
  expect_err "$BODY" 'must be a finite number'
done
BODY=$(DRAW "{\"amount\":\"-5000\",\"cause_class\":\"scope_maturation\",$J}" "$MANAGER")
expect_err "$BODY" 'must be greater than zero'
grep -qi 'unaudited credit' <<<"$BODY"
BODY=$(DRAW "{\"amount\":\"0\",\"cause_class\":\"scope_maturation\",$J}" "$MANAGER")
expect_err "$BODY" 'must be greater than zero'
echo "   NaN, infinity, negative and zero amounts are refused before the balance is touched"

# D5.19: a drawdown with no cause makes the II.8 report a guess.
BODY=$(DRAW "{\"amount\":\"5000\",$J}" "$MANAGER")
expect_err "$BODY" 'name the cause of this drawdown'
# ...and `unattributed` is in the vocabulary so it can be SHOWN, never chosen.
BODY=$(DRAW "{\"amount\":\"5000\",\"cause_class\":\"unattributed\",$J}" "$MANAGER")
expect_err "$BODY" 'cannot be recorded as unattributed'
grep -qi 'not a class you may choose' <<<"$BODY"
BODY=$(DRAW "{\"amount\":\"5000\",\"cause_class\":\"because_i_said_so\",$J}" "$MANAGER")
expect_err "$BODY" 'is not a contingency cause class'
# A LINKED class must cite its subject in the canonical store.
BODY=$(DRAW "{\"amount\":\"5000\",\"cause_class\":\"realized_risk\",$J}" "$MANAGER")
expect_err "$BODY" 'must cite the risk that was realized'
BODY=$(DRAW "{\"amount\":\"5000\",\"cause_class\":\"realized_risk\",\"risk_id\":\"33333333-3333-4333-8333-333333333333\",$J}" "$MANAGER")
expect_err "$BODY" 'not in this organization'
# A spend with no stated reason is the slush fund II.8 names.
BODY=$(DRAW "{\"amount\":\"5000\",\"cause_class\":\"scope_maturation\",\"justification\":\"stuff\"}" "$MANAGER")
expect_err "$BODY" 'explicable line by line'
echo "   every drawdown names a cause from the spec's own taxonomy, or it is refused"

# §70, in the door.
BODY=$(DRAW "{\"amount\":\"5000\",\"cause_class\":\"scope_maturation\",$J}" "$AIBOT")
expect_err "$BODY" 'no AI or system identity may commit funds'
echo "   §70: the AI identity cannot spend"

echo "── 3. authority (R1/R2): absence refuses, a blank ceiling refuses ───────"

# R1. The seeded ladders are DRAFTS, and a draft delegates nothing. This is the
# deliberate difference from enforce_authority_limit, whose "the organization
# has not delegated in amounts yet" pass is right for a recommendation and
# wrong for a fund.
BODY=$(DRAW "{\"amount\":\"5000\",\"cause_class\":\"scope_maturation\",$J}" "$MANAGER")
expect_err "$BODY" 'no adopted contingency-drawdown delegation exists'
grep -qi 'is not permission to spend' <<<"$BODY"
echo "   nobody has said how much you may spend != spend what you like"

# R2. Adopt the seeded ladder AS SEEDED — with a null ceiling — and it still
# refuses. A blank ceiling is an unfinished delegation, not an unlimited one.
LIMIT_ID=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='maintenance_manager' and action_type='contingency_drawdown' and status='draft' order by version desc limit 1")
test -n "$LIMIT_ID"
# ADOPTION ITSELF REFUSES A BLANK CEILING (4D-R29/R2 at the instrument): an
# adopted null-ceiling ladder would install a delegation under which every
# drawdown refuses, which reads to an organization as the feature being broken.
BODY=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$LIMIT_ID\",\"p_note\":\"Adopted from the capital delegation instrument dated this year.\"}")
expect_err "$BODY" 'states no money ceiling'
echo "   a null ceiling refuses AT ADOPTION — it means unstated, not unlimited"

# Now give the ladder a real number — THROUGH THE PRODUCT (4D-R29). Until
# state_authority_ceiling existed the only way to enable the feature was a raw
# psql UPDATE by a DBA, which is what this smoke used to do: the one number
# standing between a delegated role and the whole fund was authored entirely
# outside every wall the slice builds.
BODY=$(rpc "$AIBOT" state_authority_ceiling "{\"p_id\":\"$LIMIT_ID\",\"p_ceiling\":{\"max_commitment\":\"250000\",\"currency\":\"CAD\",\"basis\":\"The capital delegation instrument dated this year.\"}}")
expect_err "$BODY" 'forbids an AI or system identity from making that determination'
echo "   §70: the AI identity cannot state how much a role may commit"

BODY=$(rpc "$MANAGER" state_authority_ceiling "{\"p_id\":\"$LIMIT_ID\",\"p_ceiling\":{\"max_commitment\":\"250000\",\"currency\":\"CAD\",\"basis\":\"The capital delegation instrument dated this year.\"}}")
expect_err "$BODY" 'requires an executive or administrator'

BODY=$(rpc "$EXEC" state_authority_ceiling "{\"p_id\":\"$LIMIT_ID\",\"p_ceiling\":{\"max_commitment\":\"NaN\",\"currency\":\"CAD\",\"basis\":\"The capital delegation instrument dated this year.\"}}")
expect_err "$BODY" 'must be a finite amount'
echo "   NaN is refused before it can reach a ceiling test it would pass vacuously"

BODY=$(rpc "$EXEC" state_authority_ceiling "{\"p_id\":\"$LIMIT_ID\",\"p_ceiling\":{\"max_commitment\":\"250000\",\"currency\":\"CAD\",\"basis\":\"The capital delegation instrument dated this year, section 4.2.\"}}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field ceiling)" = "250000"
BODY=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$LIMIT_ID\",\"p_note\":\"Adopted from the capital delegation instrument dated this year.\"}")
noerr "$BODY"
echo "   the ceiling is stated and adopted THROUGH THE PRODUCT, not by a DBA"

# 4D-R30. The adopted ceiling is walled against every caller, service included.
sql_must_fail "update authority_limits set max_commitment_usd = 250000000 where id='$LIMIT_ID';" | grep -qi 'cannot be rewritten by ANY caller'
sql_must_fail "update authority_limits set status='draft' where id='$LIMIT_ID';" | grep -qi 'never returned to draft'
sql_must_fail "delete from authority_limits where id='$LIMIT_ID';" | grep -qi 'is not deleted'
test "$(psqlc "select max_commitment_usd from authority_limits where id='$LIMIT_ID'")" = "250000"
# ...and the read the screen renders says which delegations exist, which state
# no ceiling (and therefore refuse), and which the caller may not touch because
# they grant the role the caller holds.
BODY=$(rpc "$EXEC" get_authority_delegations '{"p_action_type":"contingency_drawdown"}')
noerr "$BODY"
test "$(jqp "$BODY" "x['canState']")" = "True"
test "$(jqp "$BODY" "len([d for d in x['delegations'] if d['id']=='$LIMIT_ID' and d['status']=='adopted' and d['maxCommitment']==250000 and d['maxCommitmentCurrency']=='CAD'])")" = "1"
test "$(jqp "$BODY" "all((d['ceilingRefusal'] is not None) == (d['maxCommitment'] is None) for d in x['delegations'])")" = "True"
jqp "$BODY" "[d for d in x['delegations'] if d['roleKey']=='executive'][0]['selfAdoptionRefusal']" | grep -qi 'nobody delegated it'
# §70 and self-adoption, at the adoption door.
EX_DRAFT=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='executive' and action_type='contingency_drawdown' and status='draft' order by version desc limit 1")
BODY=$(rpc "$EXEC" state_authority_ceiling "{\"p_id\":\"$EX_DRAFT\",\"p_ceiling\":{\"max_commitment\":\"5000000\",\"currency\":\"CAD\",\"basis\":\"An executive stating their own spending ceiling.\"}}")
expect_err "$BODY" 'Stating your own ceiling is not a delegation'
BODY=$(rpc "$AIBOT" adopt_authority_limit "{\"p_id\":\"$EX_DRAFT\",\"p_note\":\"AI identity adopting the contingency delegation instrument.\"}")
expect_err "$BODY" 'forbids an AI or system identity from committing funds'
echo "   the ceiling itself is immutable once adopted — the third number in the same arithmetic"
echo "   §70 and self-adoption are refused at the instrument that decides who may spend"

BODY=$(DRAW "{\"amount\":\"400000\",\"cause_class\":\"scope_maturation\",$J}" "$MANAGER")
expect_err "$BODY" 'exceeds the Project manager contingency ceiling of $250000'
grep -qi 'escalate to executive' <<<"$BODY"
echo "   above the ceiling is refused BY NAME, with the ceiling and the escalation in the sentence"

# R3. More than remains is refused, and the refusal quotes the remainder.
BODY=$(DRAW "{\"amount\":\"1500000\",\"cause_class\":\"scope_maturation\",$J}" "$MANAGER")
expect_err "$BODY" 'exceeds what remains'
grep -qi 'cannot go negative' <<<"$BODY"
echo "   a fund cannot go negative; the overspend is a cost overrun, not a drawdown"

echo "── 4. the spend, and the ledger it leaves ───────────────────────────────"

BODY=$(DRAW "{\"amount\":\"120000\",\"cause_class\":\"scope_maturation\",\"justification\":\"Additional pipe supports found necessary during detailed design.\"}" "$MANAGER")
noerr "$BODY"
ENTRY1=$(printf '%s' "$BODY" | field entry_id); test -n "$ENTRY1"
test "$(printf '%s' "$BODY" | field remaining)" = "880000"
# The ceiling the spend was CHECKED AGAINST is on the row, so raising the
# ceiling later cannot rewrite what this spend was approved under.
test "$(psqlc "select approver_ceiling_usd from contingency_ledger_entries where id='$ENTRY1'")" = "250000"
test "$(psqlc "select balance_after from contingency_ledger_entries where id='$ENTRY1'")" = "880000"
echo "   the spend records its cause, its approver, the ceiling checked and the balance left"

# Immutable to a client, and the MONEY FIELDS immutable to everyone.
sql_must_fail "update contingency_ledger_entries set amount = 1 where id = '$ENTRY1';" | grep -qi 'cannot be rewritten by ANY caller'
sql_must_fail "update contingency_ledger_entries set balance_after = 999999 where id = '$ENTRY1';" >/dev/null
sql_must_fail "truncate contingency_ledger_entries;" | grep -qi 'append-only for every caller'
sql_must_fail "truncate project_contingency_pools;" >/dev/null
test "$(psqlc "select has_table_privilege('authenticated','contingency_ledger_entries','TRUNCATE')")" = "f"
test "$(psqlc "select has_table_privilege('service_role','contingency_ledger_entries','TRUNCATE')")" = "f"
echo "   the ledger is append-only, its money fields unwritable, TRUNCATE refused and revoked"

# A release cannot exceed what was taken, and reverses a DRAWDOWN.
BODY=$(rpc "$MANAGER" release_contingency "{\"p_entry_id\":\"$ENTRY1\",\"p_release\":{\"amount\":\"200000\",\"justification\":\"Supports came in under the drawn amount; returning the balance.\"}}")
expect_err "$BODY" 'exceeds the un-released part'
BODY=$(rpc "$MANAGER" release_contingency "{\"p_entry_id\":\"$ENTRY1\",\"p_release\":{\"amount\":\"20000\",\"justification\":\"Supports came in under the drawn amount; returning the balance.\"}}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field remaining)" = "900000"
echo "   a spend made in error is REVERSED, never edited away"

echo "── 5. consumption by cause (D5.19): the unattributed bucket is never hidden"

BODY=$(rpc "$MANAGER" compute_case_contingency_consumption "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
# All seven classes, always — an empty bucket is a fact, an absent one is an
# invitation to assume.
test "$(jqp "$BODY" "len(x['byCause'])")" = "7"
test "$(jqp "$BODY" "[c for c in x['byCause'] if c['causeClass']=='unattributed'][0]['net']")" = "0"
test "$(jqp "$BODY" "[c for c in x['byCause'] if c['causeClass']=='scope_maturation'][0]['net']")" = "100000"
RUN=$(psqlc "select id from calculation_runs where development_case_id='$CASE' and calculation_key='case_contingency_consumption' order by computed_at desc limit 1")
test "$(psqlc "select status from calculation_runs where id='$RUN'")" = "computed"
test "$(psqlc "select outputs->>'largestCause' from calculation_runs where id='$RUN'")" = "scope_maturation"
echo "   every class reported, consumption attributed, the run recorded"

# An unattributed spend that arrives by another path is SHOWN, not dropped.
# This is the ONLY way one can exist: the door refuses to mint it.
psqlc "insert into contingency_ledger_entries (organization_id, development_case_id, pool_id, entry_no, entry_type, amount, cause_class, justification, approver_id, approver_role, balance_after, recorded_by) select '$ORG','$CASE','$POOL', coalesce(max(entry_no),0)+1, 'drawdown', 5000, 'unattributed', 'Imported from the legacy cost ledger with no cause recorded.', (select id from user_profiles where email='manager@syncai.ca'), 'maintenance_manager', 895000, (select id from user_profiles where email='manager@syncai.ca') from contingency_ledger_entries where pool_id='$POOL';" >/dev/null
BODY=$(rpc "$MANAGER" compute_case_contingency_consumption "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "[c for c in x['byCause'] if c['causeClass']=='unattributed'][0]['net']")" = "5000"
psqlc "select refusals::text from calculation_runs where development_case_id='$CASE' and calculation_key='case_contingency_consumption' order by computed_at desc limit 1" | grep -qi 'UNATTRIBUTED'
psqlc "select status from calculation_runs where development_case_id='$CASE' and calculation_key='case_contingency_consumption' order by computed_at desc limit 1" | grep -q 'computed_with_refusals'
echo "   an unattributed spend is counted in the total and NAMED, never reassigned or dropped"

echo "── 6. change control on the EXISTING MOC engine (D5.27/D5.30) ───────────"

# The class vocabulary is engineering_approval_rules — the MOC engine — and a
# class outside it has no competence requirement attached.
BODY=$(rpc "$PLANNER" raise_project_change "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"S4D-C1\",\"change_class\":\"invented_class\",\"baseline_id\":\"$BL\",\"proposed_change\":\"Upsize the pump to handle the revised duty point.\",\"reason\":\"The process data sheet moved after the baseline was approved.\"}}")
expect_err "$BODY" 'has no engineering approval rule'
# A change must be anchored to a baseline (Workflow 3's first step).
BODY=$(rpc "$PLANNER" raise_project_change "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"S4D-C1\",\"change_class\":\"project_cost_change\",\"proposed_change\":\"Upsize the pump to handle the revised duty point.\",\"reason\":\"The process data sheet moved after the baseline was approved.\"}}")
expect_err "$BODY" 'IDENTIFY BASELINE'

BODY=$(rpc "$PLANNER" raise_project_change "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"S4D-C1\",\"change_class\":\"project_cost_change\",\"baseline_id\":\"$BL\",\"proposed_change\":\"Upsize the pump to handle the revised duty point.\",\"reason\":\"The process data sheet moved after the baseline was approved.\"}}")
noerr "$BODY"; CH1=$(printf '%s' "$BODY" | field change_id); test -n "$CH1"

# An unassessed change cannot be decided: the authority is routed on the cost
# effect, and there is no cost effect.
BODY=$(rpc "$MANAGER" decide_project_change "{\"p_change_id\":\"$CH1\",\"p_decision\":{\"outcome\":\"approved\",\"note\":\"Approved on the basis of the revised process data sheet.\"}}")
expect_err "$BODY" 'has not been assessed'
echo "   an unassessed change cannot be decided — the authority routes on a number nobody stated"

# §70: the AI cannot write the impact vector, because writing the cost effect
# chooses who is allowed to approve.
BODY=$(rpc "$AIBOT" assess_project_change "{\"p_change_id\":\"$CH1\",\"p_impact\":{\"technical_effect\":\"Larger pump\",\"cost_effect\":\"1\",\"schedule_effect_days\":\"0\",\"risk_effect\":\"Low\",\"currency\":\"CAD\",\"impact_basis\":\"Vendor quotation received this week for the larger frame.\"}}")
expect_err "$BODY" 'deciding the change by deciding who decides it'

# The impact vector is complete or it is not an assessment.
BODY=$(rpc "$PLANNER" assess_project_change "{\"p_change_id\":\"$CH1\",\"p_impact\":{\"technical_effect\":\"Larger pump frame\",\"schedule_effect_days\":\"5\",\"risk_effect\":\"Low\",\"currency\":\"CAD\",\"impact_basis\":\"Vendor quotation received this week for the larger frame.\"}}")
expect_err "$BODY" 'state the cost effect'
grep -qi 'an unstated cost routes to nobody' <<<"$BODY"
BODY=$(rpc "$PLANNER" assess_project_change "{\"p_change_id\":\"$CH1\",\"p_impact\":{\"technical_effect\":\"Larger pump frame\",\"cost_effect\":\"NaN\",\"schedule_effect_days\":\"5\",\"risk_effect\":\"Low\",\"currency\":\"CAD\",\"impact_basis\":\"Vendor quotation received this week for the larger frame.\"}}")
expect_err "$BODY" 'state the cost effect'
BODY=$(rpc "$PLANNER" assess_project_change "{\"p_change_id\":\"$CH1\",\"p_impact\":{\"technical_effect\":\"Larger pump frame\",\"cost_effect\":\"180000\",\"schedule_effect_days\":\"5\",\"currency\":\"CAD\",\"impact_basis\":\"Vendor quotation received this week for the larger frame.\"}}")
expect_err "$BODY" 'residual risk effect'

BODY=$(rpc "$PLANNER" assess_project_change "{\"p_change_id\":\"$CH1\",\"p_impact\":{\"technical_effect\":\"Larger pump frame and a revised baseplate\",\"cost_effect\":\"180000\",\"schedule_effect_days\":\"5\",\"risk_effect\":\"Medium\",\"contingency_effect\":\"180000\",\"currency\":\"CAD\",\"impact_basis\":\"Vendor quotation received this week for the larger frame, plus the planner's re-sequence.\"}}")
noerr "$BODY"
# THREE, not four: cost, schedule and contingency all moved, and a MEDIUM
# residual risk does not create a risk-reassessment obligation. Workflow 3's
# risk-reassessment step is raised for High and Critical only — raising one for
# every change would make the outstanding-obligation count meaningless, which is
# the same failure as never raising one.
test "$(printf '%s' "$BODY" | field propagation_rows)" = "3"
test "$(psqlc "select count(*) from project_change_propagation p join project_changes c on c.id=p.change_id where c.id='$CH1' and p.target_kind='risk'")" = "0"
test "$(psqlc "select sync_owned from project_change_propagation p where p.change_id='$CH1' and p.target_kind='contingency'")" = "t"
test "$(psqlc "select sync_owned from project_change_propagation p where p.change_id='$CH1' and p.target_kind='schedule'")" = "f"
echo "   the impact vector is complete or refused; the propagation chain is built from it"

# The MOC competence gate: an approval without engineering sign-off is refused
# by the door AND by the trigger.
BODY=$(rpc "$MANAGER" decide_project_change "{\"p_change_id\":\"$CH1\",\"p_decision\":{\"outcome\":\"approved\",\"note\":\"Approved on the basis of the revised process data sheet.\"}}")
expect_err "$BODY" 'requires sign-off by the reliability_engineer role'
sql_must_fail "update project_changes set status='approved', decided_at=now(), approver_id=(select id from user_profiles where email='manager@syncai.ca'), approver_role='maintenance_manager', decision_note='forced through by a service caller with no engineering sign-off' where id='$CH1';" | grep -qi 'requires sign-off by the reliability_engineer role'
echo "   the MOC competence gate holds for the door AND for a raw service write"

# ...and only the competent role may sign.
BODY=$(rpc "$PLANNER" sign_project_change_engineering "{\"p_change_id\":\"$CH1\",\"p_note\":\"Frame change is within the baseplate envelope; no foundation rework.\"}")
expect_err "$BODY" 'requires sign-off by the reliability_engineer role'
BODY=$(rpc "$ENGINEER" sign_project_change_engineering "{\"p_change_id\":\"$CH1\",\"p_note\":\"Frame change is within the baseplate envelope; no foundation rework needed.\"}")
noerr "$BODY"

# §42 segregation of duties: the requester cannot be the final approver.
BODY=$(rpc "$PLANNER" decide_project_change "{\"p_change_id\":\"$CH1\",\"p_decision\":{\"outcome\":\"approved\",\"note\":\"Approved on the basis of the revised process data sheet.\"}}")
expect_err "$BODY" 'you raised this change'
# ...and the trigger says the same thing to a service caller.
sql_must_fail "update project_changes set status='approved', decided_at=now(), approver_id=requester_id, approver_role='planner', decision_note='the requester approving their own change request' where id='$CH1';" | grep -qi 'segregation of duties'
echo "   §42: the requester cannot approve their own change, at the door or beneath it"

# R1 again, on the change ladder: no adopted delegation refuses.
BODY=$(rpc "$MANAGER" decide_project_change "{\"p_change_id\":\"$CH1\",\"p_decision\":{\"outcome\":\"approved\",\"note\":\"Approved on the basis of the revised process data sheet.\"}}")
expect_err "$BODY" 'no adopted change-approval delegation exists'
CLIMIT=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='maintenance_manager' and action_type='change_approval' and status='draft' order by version desc limit 1")
BODY=$(rpc "$EXEC" state_authority_ceiling "{\"p_id\":\"$CLIMIT\",\"p_ceiling\":{\"max_commitment\":\"100000\",\"currency\":\"CAD\",\"max_risk_level\":\"Medium\",\"basis\":\"The capital delegation instrument dated this year, section 5.1.\"}}")
noerr "$BODY"
BODY=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$CLIMIT\",\"p_note\":\"Adopted from the capital delegation instrument dated this year.\"}")
noerr "$BODY"
BODY=$(rpc "$MANAGER" decide_project_change "{\"p_change_id\":\"$CH1\",\"p_decision\":{\"outcome\":\"approved\",\"note\":\"Approved on the basis of the revised process data sheet.\"}}")
expect_err "$BODY" 'exceeds the Project manager ceiling of $100000'
# A LIVE CEILING IS RAISED BY REDRAFTING AND ADOPTING, never by editing the
# adopted row: adoption supersedes, so the instrument each recorded approval was
# checked against stays readable.
BODY=$(rpc "$EXEC" draft_authority_ceiling "{\"p_id\":\"$CLIMIT\",\"p_note\":\"Redrafted to raise the change-approval ceiling for the transcript.\"}")
noerr "$BODY"
CDRAFT=$(printf '%s' "$BODY" | field draft_id)
test -n "$CDRAFT"
BODY=$(rpc "$EXEC" state_authority_ceiling "{\"p_id\":\"$CDRAFT\",\"p_ceiling\":{\"max_commitment\":\"500000\",\"currency\":\"CAD\",\"max_risk_level\":\"Medium\",\"basis\":\"The capital delegation instrument dated this year, section 5.2.\"}}")
noerr "$BODY"
BODY=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$CDRAFT\",\"p_note\":\"Adopted from the capital delegation instrument dated this year.\"}")
noerr "$BODY"
test "$(psqlc "select status from authority_limits where id='$CLIMIT'")" = "superseded"
echo "   the change ladder is the SAME authority store with a new action_type; a raise SUPERSEDES rather than rewrites"

# §70 at the decision.
BODY=$(rpc "$AIBOT" decide_project_change "{\"p_change_id\":\"$CH1\",\"p_decision\":{\"outcome\":\"approved\",\"note\":\"Approved on the basis of the revised process data sheet.\"}}")
expect_err "$BODY" 'no AI or system identity may approve a change'

BODY=$(rpc "$MANAGER" decide_project_change "{\"p_change_id\":\"$CH1\",\"p_decision\":{\"outcome\":\"approved\",\"note\":\"Approved on the basis of the revised process data sheet and the vendor quotation.\"}}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field status)" = "approved"
test "$(printf '%s' "$BODY" | field outstanding_propagation)" = "3"
echo "   approved inside a stated delegation, with three obligations still outstanding"

# A decided change does not un-decide.
BODY=$(rpc "$MANAGER" decide_project_change "{\"p_change_id\":\"$CH1\",\"p_decision\":{\"outcome\":\"rejected\",\"note\":\"Changing my mind after the fact about the pump upsizing.\"}}")
expect_err "$BODY" 'was already approved'
# ...and its impact vector cannot be rewritten under the decision.
BODY=$(rpc "$PLANNER" assess_project_change "{\"p_change_id\":\"$CH1\",\"p_impact\":{\"technical_effect\":\"Larger pump frame\",\"cost_effect\":\"10\",\"schedule_effect_days\":\"0\",\"risk_effect\":\"Low\",\"currency\":\"CAD\",\"impact_basis\":\"Retrospectively shrinking the impact after the approval was granted.\"}}")
expect_err "$BODY" 'cannot be rewritten afterwards'
echo "   the assessment a decision was taken on cannot be rewritten under it"

echo "── 7. propagation: the hops Sync OWNS, and the ones it will not claim ───"

# Sync-owned hops cannot be asserted by hand. The whole point of the flag is
# that these two are closed by the record that PROVES them.
CONT_PROP=$(psqlc "select id from project_change_propagation where change_id='$CH1' and target_kind='contingency'")
BODY=$(rpc "$MANAGER" close_change_propagation "{\"p_propagation_id\":\"$CONT_PROP\",\"p_close\":{\"outcome\":\"applied\",\"note\":\"Saying it happened without a drawdown behind it.\"}}")
expect_err "$BODY" 'closed by the record that proves it'

# Propagating with no drawdown attributed leaves the contingency hop OPEN and
# says why. It cannot draw the money: that is an authority-gated act with its
# own approver.
BODY=$(rpc "$MANAGER" propagate_project_change "{\"p_change_id\":\"$CH1\"}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field applied)" = "0"
grep -qi 'propagation cannot draw the money' <<<"$(printf '%s' "$BODY" | field blocked)"
echo "   Sync will not mark a hop applied in a system it does not own"

# An approved change cannot be marked implemented while it still has to move
# something. This is the one place the chain does work rather than describing it.
BODY=$(rpc "$MANAGER" implement_project_change "{\"p_change_id\":\"$CH1\"}")
expect_err "$BODY" 'propagation obligation(s) outstanding'

# The change → contingency hop. A drawdown attributed to a PROPOSAL is refused.
BODY=$(rpc "$PLANNER" raise_project_change "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"S4D-C2\",\"change_class\":\"project_scope_change\",\"baseline_id\":\"$SCOPE_BL\",\"proposed_change\":\"Add the second isolation valve requested by operations.\",\"reason\":\"Operations raised it after the scope baseline was approved.\"}}")
noerr "$BODY"; CH2=$(printf '%s' "$BODY" | field change_id)
BODY=$(rpc "$MANAGER" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":{\"amount\":\"10000\",\"cause_class\":\"approved_change\",\"change_id\":\"$CH2\",\"justification\":\"Funding the second isolation valve out of contingency.\"}}")
expect_err "$BODY" 'Contingency funds an APPROVED change'
# ...and one citing no change at all is the unattributed spend under a label.
BODY=$(rpc "$MANAGER" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":{\"amount\":\"10000\",\"cause_class\":\"approved_change\",\"justification\":\"Funding the second isolation valve out of contingency.\"}}")
expect_err "$BODY" 'must cite the change it funds'

# §42 rides along: the person who RAISED the change cannot fund it. PLANNER
# raised S4D-C1, so a planner-approved drawdown against it is refused.
BODY=$(rpc "$PLANNER" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":{\"amount\":\"10000\",\"cause_class\":\"approved_change\",\"change_id\":\"$CH1\",\"justification\":\"Funding the pump upsizing out of contingency.\"}}")
expect_err "$BODY" 'you raised change S4D-C1'

# 4D-R8. THE CEILING IS CUMULATIVE AGAINST THIS FUND, NOT PER TRANSACTION.
# The manager has already committed $105,000 of a $250,000 delegation, so a
# further $180,000 is refused NAMING what is already committed — a ceiling that
# can be defeated by pressing the button twice is not a ceiling.
BODY=$(rpc "$MANAGER" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":{\"amount\":\"180000\",\"cause_class\":\"approved_change\",\"change_id\":\"$CH1\",\"justification\":\"Funding the approved pump upsizing out of project contingency.\"}}")
expect_err "$BODY" 'you have already committed $105000'
grep -qi 'not what you may commit per transaction' <<<"$BODY"
test "$(printf '%s' "$BODY" | field alreadyCommitted)" = "105000"
echo "   the ceiling is cumulative against one fund — splitting a spend does not defeat it"

# The organization raises the delegation the way the instrument says: a NEW
# draft, adopted. The adopted row is never edited, so what each earlier spend
# was checked against stays readable.
BODY=$(rpc "$EXEC" draft_authority_ceiling "{\"p_id\":\"$LIMIT_ID\",\"p_note\":\"Redrafted to raise the project manager contingency ceiling for the transcript.\"}")
noerr "$BODY"
LIMIT2=$(printf '%s' "$BODY" | field draft_id); test -n "$LIMIT2"
BODY=$(rpc "$EXEC" state_authority_ceiling "{\"p_id\":\"$LIMIT2\",\"p_ceiling\":{\"max_commitment\":\"500000\",\"currency\":\"CAD\",\"basis\":\"The capital delegation instrument dated this year, revision B.\"}}")
noerr "$BODY"
BODY=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$LIMIT2\",\"p_note\":\"Adopted from the capital delegation instrument revision B.\"}")
noerr "$BODY"
test "$(psqlc "select status from authority_limits where id='$LIMIT_ID'")" = "superseded"
# The earlier entries still quote the ceiling they were ACTUALLY checked
# against; raising it afterwards cannot rewrite what was approved under what.
test "$(psqlc "select approver_ceiling_usd from contingency_ledger_entries where id='$ENTRY1'")" = "250000"

BODY=$(rpc "$MANAGER" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":{\"amount\":\"180000\",\"cause_class\":\"approved_change\",\"change_id\":\"$CH1\",\"justification\":\"Funding the approved pump upsizing out of project contingency.\"}}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field remaining)" = "715000"

# 4D-R19. The draw cannot exceed what the change was APPROVED to commit: the
# assessed contingency effect is the figure the approver's ceiling was checked
# against, and drawing past it spends under an authority nobody granted.
BODY=$(rpc "$MANAGER" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":{\"amount\":\"20000\",\"cause_class\":\"approved_change\",\"change_id\":\"$CH1\",\"justification\":\"Attempting to over-draw against the approved pump upsizing.\"}}")
expect_err "$BODY" 'exceed the approved commitment'
echo "   a drawdown cannot exceed the contingency the change was approved to commit"

# 4D-R20. An approved-change drawdown can be RELEASED. It could not be before:
# release_contingency copied the cause class without the change subject, so the
# only reversal path for this cause raised a raw constraint violation.
BODY=$(rpc "$MANAGER" release_contingency "{\"p_entry_id\":\"$(printf '%s' "$BODY" | field entry_id)\",\"p_release\":{\"amount\":\"1000\",\"justification\":\"Reversing part of the approved-change draw for the transcript.\"}}")
CHG_ENTRY=$(psqlc "select id from contingency_ledger_entries where cause_change_id='$CH1' and entry_type='drawdown' order by entry_no desc limit 1")
BODY=$(rpc "$MANAGER" release_contingency "{\"p_entry_id\":\"$CHG_ENTRY\",\"p_release\":{\"amount\":\"1000\",\"justification\":\"Reversing part of the approved-change draw for the transcript.\"}}")
noerr "$BODY"
test "$(psqlc "select cause_change_id from contingency_ledger_entries where reverses_entry_id='$CHG_ENTRY'")" = "$CH1"
BODY=$(rpc "$MANAGER" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":{\"amount\":\"1000\",\"cause_class\":\"approved_change\",\"change_id\":\"$CH1\",\"justification\":\"Re-drawing the released part of the approved pump upsizing.\"}}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field remaining)" = "715000"
echo "   an approved-change spend can be REVERSED — the release carries the change it reverses"

# NOW the Sync-owned hop closes, because the record that proves it exists.
BODY=$(rpc "$MANAGER" propagate_project_change "{\"p_change_id\":\"$CH1\"}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field applied)" = "1"
test "$(psqlc "select status from project_change_propagation where change_id='$CH1' and target_kind='contingency'")" = "applied"
echo "   the contingency hop closes on the LEDGER ENTRY, not on somebody's word"

# The two hops Sync does not own are closed by a human with a note.
for K in cost schedule; do
  PID=$(psqlc "select id from project_change_propagation where change_id='$CH1' and target_kind='$K'")
  BODY=$(rpc "$MANAGER" close_change_propagation "{\"p_propagation_id\":\"$PID\",\"p_close\":{\"outcome\":\"applied\",\"note\":\"Re-issued in the estimate and the P6 export dated this week.\"}}")
  noerr "$BODY"
done
BODY=$(rpc "$MANAGER" implement_project_change "{\"p_change_id\":\"$CH1\"}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field status)" = "implemented"
echo "   a change is implemented only when nothing it moves is still outstanding"

# The aggregate change position, recorded. S4D-C2 is still a PROPOSAL with no
# assessment, so its cost and schedule effects are UNKNOWN — excluded from the
# totals and named, never counted as zero effect.
BODY=$(rpc "$MANAGER" compute_case_change_control "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
CRUN=$(psqlc "select id from calculation_runs where development_case_id='$CASE' and calculation_key='case_change_control' order by computed_at desc limit 1")
test "$(psqlc "select status from calculation_runs where id='$CRUN'")" = "computed_with_refusals"
test "$(psqlc "select outputs->>'approvedCostEffect' from calculation_runs where id='$CRUN'")" = "180000"
test "$(psqlc "select outputs->>'unassessedCount' from calculation_runs where id='$CRUN'")" = "1"
# 180,000 drawn against S4D-C1 plus the 1,000 re-draw after the release probe.
test "$(psqlc "select outputs->>'contingencyDrawnAgainstChange' from calculation_runs where id='$CRUN'")" = "181000"
test "$(psqlc "select outputs->>'currency' from calculation_runs where id='$CRUN'")" = "CAD"
psqlc "select refusals::text from calculation_runs where id='$CRUN'" | grep -qi 'carry NO impact assessment'
psqlc "select refusals::text from calculation_runs where id='$CRUN'" | grep -qi 'no engineering competence sign-off'
echo "   the change position excludes unassessed changes and NAMES them, rather than counting them as zero"

echo "── 8. decision latency (D3.12/D3.36): an empty register REFUSES ─────────"

BODY=$(rpc "$PLANNER" get_case_decision_latency "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['decisionCount']")" = "0"
grep -qi 'this is a refusal, not a score of zero' <<<"$(printf '%s' "$BODY" | field refusal)"
BODY=$(rpc "$MANAGER" compute_case_decision_latency "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(psqlc "select status from calculation_runs where development_case_id='$CASE' and calculation_key='case_decision_latency' order by computed_at desc limit 1")" = "refused"
echo "   no decision record refuses rather than reporting 0 days"

MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
BODY=$(rpc "$PLANNER" create_case_decision "{\"p_case_id\":\"$CASE\",\"p_question\":\"Which pump vendor is selected for the revised duty point?\",\"p_required_date\":\"2026-06-01\",\"p_owner_id\":\"$MANAGER_ID\"}")
noerr "$BODY"; DEC1=$(printf '%s' "$BODY" | field decision_id); test -n "$DEC1"
BODY=$(rpc "$PLANNER" create_case_decision "{\"p_case_id\":\"$CASE\",\"p_question\":\"Do we accept the vendor's shorter warranty in exchange for the earlier delivery?\",\"p_owner_id\":\"$MANAGER_ID\"}")
noerr "$BODY"; DEC2=$(printf '%s' "$BODY" | field decision_id)

BODY=$(rpc "$PLANNER" get_case_decision_latency "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['decisionCount']")" = "2"
test "$(jqp "$BODY" "x['undatedCount']")" = "1"
# The undated one is EXCLUDED and NAMED, never counted as on time.
jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC2'][0]['latencyKind']" | grep -q unmeasurable
jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC2'][0]['latencyRefusal']" | grep -qi 'nothing to measure latency FROM'
# The dated one has a RUNNING latency against its required date.
test "$(jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC1'][0]['latencyKind']")" = "running"
test "$(jqp "$BODY" "float(json.loads(json.dumps([d for d in x['decisions'] if d['decisionId']=='$DEC1'][0]['latencyDays']))) > 0")" = "True"
# The AVERAGE is withheld below the published floor of closed decisions.
grep -qi 'no average latency can be published' <<<"$(printf '%s' "$BODY" | field averageRefusal)"
echo "   an undated decision is excluded and named; the average is withheld below the floor"

echo "── 9. critical-path exposure (D3.13): P6's float, or a refusal ──────────"

grep -qi 'no schedule activities' <<<"$(printf '%s' "$BODY" | field criticalPathRefusal)"

# A schedule with NO imported float still refuses: Sync does not recompute the
# network, so criticality is not answerable from a Sync-authored schedule.
for A in "S4D-A1:Procure pump:400:2027-01-04T06:00:00Z:2027-02-01T06:00:00Z" \
         "S4D-A2:Install pump:300:2027-02-01T06:00:00Z:2027-03-01T06:00:00Z"; do
  IFS=: read -r K L D S1 S2 S3 F1 F2 F3 <<<"$A"
  BODY=$(rpc "$PLANNER" record_local_schedule_activity "{\"p_case_id\":\"$CASE\",\"p_activity\":{\"activity_id\":\"$K\",\"description\":\"$L\",\"duration_hours\":\"$D\",\"planned_start\":\"$S1:$S2:$S3\",\"planned_finish\":\"$F1:$F2:$F3\"}}")
  noerr "$BODY"
done
BODY=$(rpc "$PLANNER" link_decision_to_activity "{\"p_decision_id\":\"$DEC1\",\"p_link\":{\"activity_key\":\"S4D-A1\",\"basis\":\"The pump cannot be ordered until the vendor is selected.\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_decision_latency "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
grep -qi 'no activity on this case carries a total float' <<<"$(printf '%s' "$BODY" | field criticalPathRefusal)"
grep -qi 'does not recompute the network' <<<"$(printf '%s' "$BODY" | field criticalPathRefusal)"
test "$(jqp "$BODY" "x['criticalPathExposureDays'] is None")" = "True"
echo "   with no imported float the exposure REFUSES — it never falls back to a second CPM"

# P6 exports its own float. NOW the question is answerable.
psqlc "update shutdown_tasks set total_float_hours = 0 where task_key='S4D-A1';" >/dev/null
psqlc "update shutdown_tasks set total_float_hours = 240 where task_key='S4D-A2';" >/dev/null
BODY=$(rpc "$PLANNER" get_case_decision_latency "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['criticalPathRefusal'] is None")" = "True"
test "$(jqp "$BODY" "x['criticalPathDecisionCount']")" = "1"
test "$(jqp "$BODY" "float(x['criticalPathExposureDays']) > 0")" = "True"
BODY=$(rpc "$MANAGER" compute_case_decision_latency "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(psqlc "select status from calculation_runs where development_case_id='$CASE' and calculation_key='case_decision_latency' order by computed_at desc limit 1")" = "computed_with_refusals"
psqlc "select refusals::text from calculation_runs where development_case_id='$CASE' and calculation_key='case_decision_latency' order by computed_at desc limit 1" | grep -qi 'nothing to measure latency FROM'
echo "   §54's critical-path exposure comes off P6's OWN float, and the run records the exclusions"

echo "── 10. decision debt (D3.21): nothing quantified is not a debt of zero ──"

BODY=$(rpc "$PLANNER" get_case_decision_debt "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['outstandingCount']")" = "2"
test "$(jqp "$BODY" "x['totalDebt'] is None")" = "True"
grep -qi 'NONE of them carries a stated delay exposure' <<<"$(printf '%s' "$BODY" | field refusal)"
grep -qi 'will not manufacture either' <<<"$(printf '%s' "$BODY" | field refusal)"
BODY=$(rpc "$MANAGER" compute_case_decision_debt "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(psqlc "select status from calculation_runs where development_case_id='$CASE' and calculation_key='case_decision_debt' order by computed_at desc limit 1")" = "refused"
echo "   an unquantified set refuses; the refusal is recorded"

# A probability is a probability. Outside [0,1] it is REFUSED, not clamped —
# clamping 4.0 to 1.0 turns a typo into a certainty.
for BAD in 4 -0.5 NaN; do
  BODY=$(rpc "$PLANNER" record_decision_delay_exposure "{\"p_decision_id\":\"$DEC1\",\"p_exposure\":{\"expected_impact\":\"400000\",\"probability_of_delay\":\"$BAD\",\"currency\":\"CAD\",\"basis\":\"Vendor lead time against the fabrication window in the current schedule.\"}}")
  BODY_ERR=$(printf '%s' "$BODY" | field error)
  test -n "$BODY_ERR"
done
BODY=$(rpc "$PLANNER" record_decision_delay_exposure "{\"p_decision_id\":\"$DEC1\",\"p_exposure\":{\"expected_impact\":\"400000\",\"probability_of_delay\":\"4\",\"currency\":\"CAD\",\"basis\":\"Vendor lead time against the fabrication window in the current schedule.\"}}")
expect_err "$BODY" 'refused rather than clamped'
# §70: the AI cannot state the two numbers a decision-debt figure IS.
BODY=$(rpc "$AIBOT" record_decision_delay_exposure "{\"p_decision_id\":\"$DEC1\",\"p_exposure\":{\"expected_impact\":\"400000\",\"probability_of_delay\":\"0.6\",\"currency\":\"CAD\",\"basis\":\"Vendor lead time against the fabrication window in the current schedule.\"}}")
expect_err "$BODY" 'forbids an AI or system identity from stating them'

BODY=$(rpc "$PLANNER" record_decision_delay_exposure "{\"p_decision_id\":\"$DEC1\",\"p_exposure\":{\"expected_impact\":\"400000\",\"probability_of_delay\":\"0.6\",\"currency\":\"CAD\",\"basis\":\"Vendor lead time against the fabrication window in the current schedule.\"}}")
noerr "$BODY"
test "$(printf '%s' "$BODY" | field debt)" = "240000.0"

BODY=$(rpc "$PLANNER" get_case_decision_debt "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['quantifiedCount']")" = "1"
test "$(jqp "$BODY" "x['unquantifiedCount']")" = "1"
test "$(jqp "$BODY" "float(x['totalDebt'])")" = "240000.0"
# The unquantified one is NAMED, never counted as zero.
jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC2'][0]['debtRefusal']" | grep -qi 'UNQUANTIFIED'
BODY=$(rpc "$MANAGER" compute_case_decision_debt "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(psqlc "select status from calculation_runs where development_case_id='$CASE' and calculation_key='case_decision_debt' order by computed_at desc limit 1")" = "computed_with_refusals"
test "$(psqlc "select outputs->>'coveragePercent' from calculation_runs where development_case_id='$CASE' and calculation_key='case_decision_debt' order by computed_at desc limit 1")" = "50.0"
echo "   II.17's formula runs on STATED numbers, and the unquantified remainder is named"

# Two currencies are not summed: adding CAD to USD produces a number in no
# currency at all.
BODY=$(rpc "$PLANNER" record_decision_delay_exposure "{\"p_decision_id\":\"$DEC2\",\"p_exposure\":{\"expected_impact\":\"100000\",\"probability_of_delay\":\"0.4\",\"currency\":\"USD\",\"basis\":\"Warranty exposure priced by the supply team in the vendor's own currency.\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_decision_debt "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['totalDebt'] is None")" = "True"
grep -qi 'They are NOT summed' <<<"$(printf '%s' "$BODY" | field refusal)"
echo "   two currencies refuse rather than adding up to a number in neither"

echo "── 11. the two screens (D13.08 / D13.02): composed, never recomputed ────"

BODY=$(rpc "$PLANNER" get_case_integrated_controls "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "len(x['dimensions'])")" = "7"
test "$(jqp "$BODY" "[d['key'] for d in x['dimensions']]")" = "['scope', 'schedule', 'cost', 'risk', 'change', 'contingency', 'procurement']"
# PROCUREMENT is shown EMPTY AND NAMED. A five-tile "integrated" view would
# quietly redefine what integrated means.
jqp "$BODY" "[d for d in x['dimensions'] if d['key']=='procurement'][0]['refusal']" | grep -qi 'NO procurement calculation exists'
# A dimension with no run says so, and does NOT fall back to the live read.
jqp "$BODY" "[d for d in x['dimensions'] if d['key']=='cost'][0]['run'] is None" | grep -q True
jqp "$BODY" "[d for d in x['dimensions'] if d['key']=='cost'][0]['refusal']" | grep -qi 'has been recorded for this case, so there is nothing to show'
jqp "$BODY" "[d for d in x['dimensions'] if d['key']=='cost'][0]['refusal']" | grep -qi 'live read is deliberately not used as a fallback'
# The dimensions that DO have runs carry the recorded run and its code version.
test "$(jqp "$BODY" "[d for d in x['dimensions'] if d['key']=='contingency'][0]['run']['codeVersion']")" = "develop-change/4D/2026-12-03"
test "$(jqp "$BODY" "[d for d in x['dimensions'] if d['key']=='change'][0]['run']['codeVersion']")" = "develop-change/4D/2026-12-03"
echo "   seven dimensions, each a recorded run or a sentence — never a blank tile"

# THE SCREEN RECORDS NOTHING. A composition performs no calculation, and a
# lineage row minted by one would put a method and a version behind numbers it
# did not produce.
BEFORE=$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE'")
rpc "$PLANNER" get_case_integrated_controls "{\"p_case_id\":\"$CASE\"}" >/dev/null
rpc "$PLANNER" get_case_assurance_engine "{\"p_case_id\":\"$CASE\"}" >/dev/null
rpc "$PLANNER" get_my_decisions '{"p_limit":50}' >/dev/null
AFTER=$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE'")
test "$BEFORE" = "$AFTER"
echo "   the screens read the lineage ledger and never write to it"

# Staleness: the recorded contingency run's ledger digest must match the live
# one. Draw again and it must not. The run is recomputed first, because the
# change→contingency drawdown in step 7 has already moved the ledger under the
# step-5 run — which is the mechanism, demonstrated in passing.
STALE_RECORDED=$(psqlc "select inputs->>'ledgerDigest' from calculation_runs where development_case_id='$CASE' and calculation_key='case_contingency_consumption' order by computed_at desc limit 1")
BODY=$(rpc "$PLANNER" get_case_integrated_controls "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['currentFingerprints']['ledgerDigest']")" != "$STALE_RECORDED"
rpc "$MANAGER" compute_case_contingency_consumption "{\"p_case_id\":\"$CASE\"}" >/dev/null
BODY=$(rpc "$PLANNER" get_case_integrated_controls "{\"p_case_id\":\"$CASE\"}")
LIVE=$(jqp "$BODY" "x['currentFingerprints']['ledgerDigest']")
RECORDED=$(psqlc "select inputs->>'ledgerDigest' from calculation_runs where development_case_id='$CASE' and calculation_key='case_contingency_consumption' order by computed_at desc limit 1")
test "$LIVE" = "$RECORDED"
BODY=$(rpc "$MANAGER" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":{\"amount\":\"1000\",\"cause_class\":\"market_escalation\",\"justification\":\"Steel escalation on the baseplate since the estimate was priced.\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_integrated_controls "{\"p_case_id\":\"$CASE\"}")
LIVE2=$(jqp "$BODY" "x['currentFingerprints']['ledgerDigest']")
test "$LIVE2" != "$RECORDED"
echo "   a spend after the run was recorded makes the published figure STALE, by digest and not by count"

# D5.21 — the composed assurance engine.
BODY=$(rpc "$PLANNER" get_case_assurance_engine "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(jqp "$BODY" "x['constituentsTotal']")" = "4"
test "$(jqp "$BODY" "len(x['missing']) > 0")" = "True"
grep -qi 'publishes no single assurance score' <<<"$(printf '%s' "$BODY" | field compositeRefusal)"
echo "   Sync Assurance composes four constituents and refuses to average them into one"

# D13.02 — the per-user queue, cross-domain, with the three columns the
# register named as missing.
BODY=$(rpc "$MANAGER" get_my_decisions '{"p_limit":50}')
noerr "$BODY"
test "$(jqp "$BODY" "x['scope']")" = "mine"
test "$(jqp "$BODY" "len([d for d in x['decisions'] if d['decisionId']=='$DEC1'])")" = "1"
jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC1'][0]['dueDate']" | grep -q 2026-06-01
test "$(jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC1'][0]['overdue']")" = "True"
test "$(jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC1'][0]['onCriticalPath']")" = "True"
jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC2'][0]['dueRefusal']" | grep -qi 'no required date'
jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC2'][0]['recommendationRefusal']" | grep -qi 'No recommendation is attached'
jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC2'][0]['valueRefusal']" | grep -qi 'a decision worth nothing and a decision nobody has valued'
# An executive sees the whole queue, and the payload SAYS which scope it is.
BODY=$(rpc "$EXEC" get_my_decisions '{"p_limit":50}')
noerr "$BODY"
test "$(jqp "$BODY" "x['scope']")" = "organization"
# A technician who owns nothing sees an empty queue with the reason, not a zero.
BODY=$(rpc "$TECH" get_my_decisions '{"p_limit":50}')
noerr "$BODY"
test "$(jqp "$BODY" "x['count']")" = "0"
grep -qi 'a fact about your queue, not about the organization' <<<"$(printf '%s' "$BODY" | field refusal)"
echo "   the queue is personal, says whose it is, and names every absent column"

echo "── 12. lineage (D11.29): four keys, every one recorded by a compute fn ──"

for K in case_contingency_consumption case_change_control case_decision_latency case_decision_debt; do
  test "$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE' and calculation_key='$K'")" -gt 0
  test "$(psqlc "select sync_calculation_code_version('$K')")" = "develop-change/4D/2026-12-03"
done
# The 4A/4B/4C keys KEEP their own versions: bumping a version on unchanged
# code makes the version stop meaning anything.
test "$(psqlc "select sync_calculation_code_version('case_scope_growth')")" = "develop-controls/4A/2026-11-24"
test "$(psqlc "select sync_calculation_code_version('case_earned_value')")" = "develop-performance/4B/2026-12-01"
test "$(psqlc "select sync_calculation_code_version('case_schedule_quality')")" = "develop-schedule/4C/2026-12-02"
# A REFUSED run exists for each of the three that can refuse, so a refusal is
# in the ledger rather than only on a screen.
test "$(psqlc "select count(*) from calculation_runs where development_case_id='$CASE' and status='refused' and calculation_key in ('case_contingency_consumption','case_decision_latency','case_decision_debt')")" -ge 3
# The recorder stays revoked from `authenticated`.
test "$(psqlc "select has_function_privilege('authenticated','record_calculation_run(uuid,text,text,jsonb,jsonb,jsonb,jsonb)','EXECUTE')")" = "f"
# Runs are immutable; TRUNCATE refused on all three new 4D tables.
sql_must_fail "truncate decision_delay_exposures;" | grep -qi 'unfalsifiable in a single statement'
sql_must_fail "truncate decision_schedule_links;" >/dev/null
# project_changes is additionally protected by the ledger's foreign key, so a
# bare TRUNCATE is refused before the statement trigger is reached. The trigger
# is asserted to EXIST rather than assumed, and its sentence is proven on
# project_change_propagation, which has no inbound reference to hide behind.
sql_must_fail "truncate project_changes;" >/dev/null
test "$(psqlc "select count(*) from pg_trigger where tgrelid='project_changes'::regclass and tgname='trg_project_change_no_truncate'")" = "1"
sql_must_fail "truncate project_change_propagation;" | grep -qi 'every change look fully propagated'
for T in contingency_ledger_entries project_contingency_pools project_changes project_change_propagation decision_delay_exposures decision_schedule_links; do
  test "$(psqlc "select has_table_privilege('authenticated','$T','TRUNCATE')")" = "f"
  test "$(psqlc "select has_table_privilege('service_role','$T','TRUNCATE')")" = "f"
  # ...and no client write policy exists on any of them: every mutation is a
  # definer RPC.
  test "$(psqlc "select count(*) from pg_policies where tablename='$T' and cmd in ('INSERT','UPDATE','DELETE') and 'authenticated' = any(roles)")" = "0"
  test "$(psqlc "select relrowsecurity from pg_class where relname='$T'")" = "t"
done
# A stated exposure is superseded, never edited.
sql_must_fail "update decision_delay_exposures set probability_of_delay = 1 where decision_id = '$DEC1';" | grep -qi 'cannot be rewritten by ANY caller'
echo "   four new keys, each recorded; refusals in the ledger; every 4D table RLS'd and TRUNCATE-proof"

echo "── 13. tenancy: a foreign tenant and an orphan JWT see and do nothing ───"

for T in "$FOREIGN_T"; do
  for R in get_case_contingency get_case_change_control get_case_decision_latency \
           get_case_decision_debt get_case_integrated_controls get_case_assurance_engine; do
    BODY=$(rpc "$T" "$R" "{\"p_case_id\":\"$CASE\"}")
    expect_err "$BODY" 'not found'
  done
  BODY=$(rpc "$T" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":{\"amount\":\"1000\",\"cause_class\":\"productivity\",\"justification\":\"A foreign tenant reaching into another organization's fund.\"}}")
  expect_err "$BODY" 'not found'
  BODY=$(rpc "$T" establish_contingency_pool "{\"p_case_id\":\"$CASE\",\"p_pool\":{\"baseline_id\":\"$BL\",\"original_amount\":\"1\",\"currency\":\"CAD\",\"basis\":\"A foreign tenant establishing a fund on somebody else's case.\"}}")
  expect_err "$BODY" 'not found'
  BODY=$(rpc "$T" raise_project_change "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"S4D-X\",\"change_class\":\"project_cost_change\",\"baseline_id\":\"$BL\",\"proposed_change\":\"A change raised by a foreign tenant on another organization's case.\",\"reason\":\"Proving the tenancy wall on the change door as well as the reads.\"}}")
  expect_err "$BODY" 'not found'
  BODY=$(rpc "$T" decide_project_change "{\"p_change_id\":\"$CH1\",\"p_decision\":{\"outcome\":\"approved\",\"note\":\"A foreign tenant approving another organization's change.\"}}")
  expect_err "$BODY" 'not found'
  BODY=$(rpc "$T" compute_case_contingency_consumption "{\"p_case_id\":\"$CASE\"}")
  expect_err "$BODY" 'not found'
  BODY=$(rpc "$T" link_decision_to_activity "{\"p_decision_id\":\"$DEC1\",\"p_link\":{\"activity_key\":\"S4D-A1\",\"basis\":\"A foreign tenant linking another organization's decision.\"}}")
  expect_err "$BODY" 'not found'
  BODY=$(rpc "$T" record_decision_delay_exposure "{\"p_decision_id\":\"$DEC1\",\"p_exposure\":{\"expected_impact\":\"1\",\"probability_of_delay\":\"1\",\"currency\":\"CAD\",\"basis\":\"A foreign tenant stating another organization's exposure.\"}}")
  expect_err "$BODY" 'not found'
  # ...and the foreign tenant's own My Decisions queue is empty rather than
  # leaking the seeded organization's decisions.
  BODY=$(rpc "$T" get_my_decisions '{"p_limit":50}')
  noerr "$BODY"
  test "$(jqp "$BODY" "x['count']")" = "0"
  # ...and the RLS read policies return nothing across the wall.
  test "$(jqp "$BODY" "len(x['decisions'])")" = "0"
done
echo "   a real foreign tenant reads nothing and writes nothing across the wall"

# ORPHAN: a signed-in identity with NO user_profiles row at all. app_current_org()
# returns null, and every 4D read and act must refuse rather than treating a
# missing tenant as a wildcard.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
declare v_uid uuid := '7d7d7d7d-7777-4777-8777-7d7d7d7d7d7d';
begin
  if not exists (select 1 from auth.users where email = 'smoke4d-orphan@syncai.ca') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', 'smoke4d-orphan@syncai.ca',
      extensions.crypt('Orphan123!@#', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}'::jsonb,
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
      jsonb_build_object('sub', v_uid::text, 'email', 'smoke4d-orphan@syncai.ca'),
      'email', now(), now(), now()
    );
  end if;
  delete from user_profiles where id = v_uid;
end $seed$;
PSQL
ORPHAN=$(token 'smoke4d-orphan@syncai.ca' 'Orphan123!@#')
test -n "$ORPHAN"
for R in get_case_contingency get_case_change_control get_case_decision_latency \
         get_case_decision_debt get_case_integrated_controls get_case_assurance_engine \
         compute_case_contingency_consumption compute_case_change_control \
         compute_case_decision_latency compute_case_decision_debt; do
  BODY=$(rpc "$ORPHAN" "$R" "{\"p_case_id\":\"$CASE\"}")
  expect_err "$BODY" 'forbidden'
done
BODY=$(rpc "$ORPHAN" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":{\"amount\":\"1000\",\"cause_class\":\"productivity\",\"justification\":\"An orphan JWT holder reaching into a project fund.\"}}")
expect_err "$BODY" 'forbidden'
BODY=$(rpc "$ORPHAN" get_my_decisions '{"p_limit":50}')
expect_err "$BODY" 'forbidden'
echo "   an orphan JWT holder is refused everywhere — a missing tenant is never a wildcard"

# The anonymous key holds no execute on any 4D act or read.
for F in "get_case_contingency(uuid)" "compute_case_contingency_consumption(uuid)" \
         "establish_contingency_pool(uuid,jsonb)" "draw_down_contingency(uuid,jsonb)" \
         "release_contingency(uuid,jsonb)" "raise_project_change(uuid,jsonb)" \
         "assess_project_change(uuid,jsonb)" "decide_project_change(uuid,jsonb)" \
         "propagate_project_change(uuid)" "implement_project_change(uuid)" \
         "get_case_change_control(uuid)" "compute_case_change_control(uuid)" \
         "get_case_decision_latency(uuid)" "compute_case_decision_latency(uuid)" \
         "get_case_decision_debt(uuid)" "compute_case_decision_debt(uuid)" \
         "get_case_integrated_controls(uuid)" "get_case_assurance_engine(uuid)" \
         "get_my_decisions(integer)"; do
  test "$(psqlc "select has_function_privilege('anon','$F','EXECUTE')")" = "f"
done
# ...and the acts are revoked from service_role too: a spend needs a signed-in
# human, so a service key is not a way around §70.
for F in "establish_contingency_pool(uuid,jsonb)" "draw_down_contingency(uuid,jsonb)" \
         "release_contingency(uuid,jsonb)" "decide_project_change(uuid,jsonb)" \
         "assess_project_change(uuid,jsonb)" "propagate_project_change(uuid)" \
         "record_decision_delay_exposure(uuid,jsonb)" "link_decision_to_activity(uuid,jsonb)"; do
  test "$(psqlc "select has_function_privilege('service_role','$F','EXECUTE')")" = "f"
done
echo "   anon holds nothing; the money and change acts are revoked from service_role too"


echo "── 14. the repair probes: every defect adversarial review found ─────────"

# 4D-R24. The latest-run helper was DEFINER, granted to `authenticated`, took an
# arbitrary case uuid and never resolved the caller's organization — so any
# signed-in identity could read every recorded calculation in the product.
test "$(psqlc "select has_function_privilege('authenticated','sync_latest_calculation_run(uuid,text)','EXECUTE')")" = "f"
test "$(psqlc "select has_function_privilege('service_role','sync_latest_calculation_run(uuid,text)','EXECUTE')")" = "f"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/sync_latest_calculation_run" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $FOREIGN_T" -H 'Content-Type: application/json' \
  -d "{\"p_case_id\":\"$CASE\",\"p_key\":\"case_contingency_consumption\"}")
test "$CODE" = "404" -o "$CODE" = "403"
echo "   the lineage helper is org-gated in its body AND not client-callable at all"

# A SECOND approved COST baseline — a re-baseline, which is what mints a second
# pool. The prior pool keeps being reported beside it (20261130090400's rule).
BODY=$(rpc "$MANAGER" create_case_baseline "{\"p_case_id\":\"$CASE\",\"p_type\":\"COST\",\"p_description\":\"Re-baselined Class 3 estimate for the SMOKE4D scope after the approved change.\"}")
noerr "$BODY"; COST_BL2=$(printf '%s' "$BODY" | field baseline_id); test -n "$COST_BL2"
BODY=$(rpc "$MANAGER" approve_case_baseline "{\"p_baseline_id\":\"$COST_BL2\",\"p_note\":\"Re-baselined estimate approved as the current cost baseline.\"}")
noerr "$BODY"

# 4D-R8a. The pool had no INSERT wall: a fund could be minted against another
# case's baseline, established by the AI identity, unaudited.
AIBOT_ID=$(psqlc "select id from user_profiles where email='smoke-aibot@syncai.ca'")
sql_must_fail "insert into project_contingency_pools (organization_id, development_case_id, baseline_id, pool_ref, original_amount, currency, basis, established_by) values ('$ORG','$CASE','$SCOPE_BL','S4D-BAD',9000000,'CAD','A fund anchored to the scope baseline rather than a cost one.','$AIBOT_ID');" | grep -qi 'is a SCOPE baseline'
sql_must_fail "insert into project_contingency_pools (organization_id, development_case_id, baseline_id, pool_ref, original_amount, currency, basis, established_by) values ('$ORG','$CASE','$COST_BL2','S4D-AI',9000000,'CAD','A fund established by the AI-operator identity.','$AIBOT_ID');" | grep -qi 'AI-operator identity'
echo "   the pool carries the same INSERT provenance backstop the ledger has"

# 4D-R10. A recorded spend cannot be deleted while its case exists.
sql_must_fail "delete from contingency_ledger_entries where id='$ENTRY1';" | grep -qi 'hands back money that was already committed'
sql_must_fail "delete from project_contingency_pools where id='$POOL';" | grep -qi 'is not deleted while its development case exists'
test "$(psqlc "select sync_contingency_remaining('$POOL')")" = "714000"
echo "   deleting a spend would CREATE spendable authority — refused for every caller"

# 4D-R9. The cause SUBJECT and the delegation are frozen with the amount.
sql_must_fail "update contingency_ledger_entries set cause_change_id='$CH2' where id='$CHG_ENTRY';" | grep -qi 'cannot be rewritten by ANY caller'
sql_must_fail "update contingency_ledger_entries set authority_limit_id=null where id='$ENTRY1';" | grep -qi 'cannot be rewritten by ANY caller'
echo "   attribution and the delegation behind a spend are as immutable as the amount"

# 4D-R17. An implemented change cannot be un-decided and re-approved under a
# lower ceiling — and the attempt is audited.
sql_must_fail "update project_changes set status='proposed', decided_at=null, approver_id=null where id='$CH1';" | grep -qi 'already been decided'
sql_must_fail "update project_changes set cost_effect=1000 where id='$CH1';" | grep -qi 'already been decided'
test "$(psqlc "select status from project_changes where id='$CH1'")" = "implemented"
echo "   un-deciding a decided change, or re-assessing what it was routed on, is refused for every caller"

# 4D-R33. A refusing path writes NO security_events row, because it cannot: a
# BEFORE trigger that inserts and then raises loses the insert with the
# statement. The refusal is total, and no dead audit call is left implying a
# trail that does not exist. An ADMITTED service write DOES land one.
SEV_BEFORE=$(psqlc "select count(*) from security_events where organization_id='$ORG'")
sql_must_fail "update contingency_ledger_entries set amount = amount + 1 where id='$ENTRY1';" >/dev/null
test "$(psqlc "select count(*) from security_events where organization_id='$ORG'")" = "$SEV_BEFORE"
psqlc "update contingency_ledger_entries set cause_note='an admitted service annotation' where id='$ENTRY1';" >/dev/null
test "$(psqlc "select count(*) from security_events where organization_id='$ORG'")" -gt "$SEV_BEFORE"
echo "   the refusal is the enforcement; the audit rows that land are the ADMITTED writes"

# 4D-R18. A closed propagation obligation does not reopen, and Sync-ownership
# does not flip.
PID_C=$(psqlc "select id from project_change_propagation where change_id='$CH1' and target_kind='contingency'")
sql_must_fail "update project_change_propagation set status='pending', closed_at=null where id='$PID_C';" | grep -qi 'does not reopen'
sql_must_fail "update project_change_propagation set sync_owned=false where id='$PID_C';" | grep -qi 'not editable'
echo "   an obligation that can be reopened and re-closed makes fully-propagated unfalsifiable"

# 4D-R23. The exposure trigger's §70 and provenance checks cover UPDATE too.
EXP_ID=$(psqlc "select id from decision_delay_exposures where development_case_id='$CASE' limit 1")
# The §70 check now runs on UPDATE, so the AI identity is refused BY NAME
# rather than walking past an INSERT-only branch.
sql_must_fail "update decision_delay_exposures set recorded_by='$AIBOT_ID' where id='$EXP_ID';" | grep -qi 'AI-operator identity'
# ...and the two numbers stay refused for every caller.
sql_must_fail "update decision_delay_exposures set expected_impact = expected_impact + 1 where id='$EXP_ID';" | grep -qi 'cannot be rewritten by ANY caller'
# ...as does re-filing it under another case, which the INSERT-only trigger
# never checked at all.
sql_must_fail "update decision_delay_exposures set development_case_id='$CASE' , decision_id='$DEC2' where id='$EXP_ID';" | grep -qi 'cannot be rewritten by ANY caller'
echo "   a §70-reserved statement cannot be re-attributed to the AI identity by an UPDATE"

# 4D-R16. A change is anchored to a baseline that still governs.
# $BL is the FIRST cost baseline; approving the re-baselined one superseded it.
# A change anchored there would move a document that no longer governs, and
# propagate_project_change would stamp its reference onto attribution measured
# against the newer one.
test "$(psqlc "select status from development_baselines where id='$BL'")" = "superseded"
BODY=$(rpc "$PLANNER" raise_project_change "{\"p_case_id\":\"$CASE\",\"p_change\":{\"change_ref\":\"S4D-C9\",\"change_class\":\"project_cost_change\",\"baseline_id\":\"$BL\",\"proposed_change\":\"A change raised against a baseline that no longer governs.\",\"reason\":\"Proving the anchor is re-checked rather than assumed.\"}}")
expect_err "$BODY" 'not an APPROVED baseline of this case'
# ...and the row refuses the same thing to a service caller.
sql_must_fail "insert into project_changes (organization_id, development_case_id, baseline_id, change_ref, change_class, proposed_change, reason, requester_id) values ('$ORG','$CASE','$BL','S4D-C8','project_cost_change','A change written straight to the table against a superseded baseline.','Proving the row refuses what the door refuses.','$(psqlc "select id from user_profiles where email='planner@syncai.ca'")');" | grep -qi 'no longer governs'
echo "   a superseded anchor is refused: a change modifies a document currently in force"

# 4D-R21. A decision recorded as decided with no selection is not OPEN, is not
# clocked from now(), and does not inflate the §54 headline.
BODY=$(rpc "$PLANNER" get_case_decision_latency "{\"p_case_id\":\"$CASE\"}")
OPEN_BEFORE=$(jqp "$BODY" "x['openCount']")
CPD_BEFORE=$(jqp "$BODY" "x['criticalPathExposureDays']")
psqlc "update decisions set approval_status='approved' where id='$DEC1';" >/dev/null
BODY=$(rpc "$PLANNER" get_case_decision_latency "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['openCount']")" -lt "$OPEN_BEFORE"
test "$(jqp "$BODY" "x['unmeasurableCloseCount']")" = "1"
test "$(jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC1'][0]['isOpen']")" = "False"
test "$(jqp "$BODY" "[d for d in x['decisions'] if d['decisionId']=='$DEC1'][0]['latencyDays'] is None")" = "True"
test "$(jqp "$BODY" "x['criticalPathExposureDays'] != $CPD_BEFORE")" = "True"
psqlc "update decisions set approval_status='pending' where id='$DEC1';" >/dev/null
echo "   a decision that was TAKEN stops counting as open, and stops accruing exposure for ever"

# 4D-R22. RISK VISIBILITY. Both case-level decision reads dropped the
# `can_read_risk` predicate get_my_decisions applies — so a planner read the
# question, the owner, the restricted risk id, the value at stake and the
# delay-exposure money of a decision hung off a RESTRICTED risk, and the
# compute functions persisted those figures into calculation_runs.
ADMIN_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and role in ('admin','executive') order by role limit 1")
RISK_R=$(psqlv "insert into risks (organization_id, title, information_sensitivity) values ('$ORG','S4D-R restricted risk','restricted') returning id")
test -n "$RISK_R"
psqlc "update decisions set risk_id='$RISK_R' where id='$DEC1';" >/dev/null
test "$(psqlc "select set_config('request.jwt.claim.sub', (select id::text from user_profiles where email='planner@syncai.ca'), false) is not null; select can_read_risk('$RISK_R')" | tail -1)" = "f"

BODY=$(rpc "$PLANNER" get_case_decision_latency "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "len([d for d in x['decisions'] if d['decisionId']=='$DEC1'])")" = "0"
BODY=$(rpc "$PLANNER" get_case_decision_debt "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "len([d for d in x['decisions'] if d['decisionId']=='$DEC1'])")" = "0"
BODY=$(rpc "$PLANNER" get_my_decisions '{"p_limit":50}')
test "$(jqp "$BODY" "len([d for d in x['decisions'] if d['decisionId']=='$DEC1'])")" = "0"
# ...and an executive, who MAY read it, still sees it.
BODY=$(rpc "$EXEC" get_case_decision_latency "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "len([d for d in x['decisions'] if d['decisionId']=='$DEC1'])")" = "1"
psqlc "update decisions set risk_id=null where id='$DEC1';" >/dev/null
psqlc "delete from risks where id='$RISK_R';" >/dev/null
echo "   a restricted risk's decision is withheld from every case read, not just the queue"

# 4D-R28. The queue's counts are over the whole queue, not the page.
BODY=$(rpc "$EXEC" get_my_decisions '{"p_limit":1}')
noerr "$BODY"
test "$(jqp "$BODY" "x['returned']")" = "1"
test "$(jqp "$BODY" "x['count'] > x['returned']")" = "True"
test "$(jqp "$BODY" "x['truncated']")" = "True"
grep -qi 'the counts above are over ALL' <<<"$(printf '%s' "$BODY" | field truncationNote)"
echo "   a total that silently equalled the page size is a fabricated number"

# 4D-R27. The queue does not re-derive II.17's DecisionDebt formula.
BODY=$(rpc "$MANAGER" get_my_decisions '{"p_limit":50}')
test "$(jqp "$BODY" "'delayDebt' in x['decisions'][0]")" = "False"
echo "   the queue carries the STATED numbers, not a second derivation of the debt"

# 4D-R14. Money in two currencies is refused, never summed.
BODY=$(rpc "$MANAGER" establish_contingency_pool "{\"p_case_id\":\"$CASE\",\"p_pool\":{\"baseline_id\":\"$COST_BL2\",\"original_amount\":\"500000\",\"currency\":\"USD\",\"basis\":\"A second fund held in another currency, to prove the totals refuse.\"}}")
noerr "$BODY"
BODY=$(rpc "$PLANNER" get_case_contingency "{\"p_case_id\":\"$CASE\"}")
test "$(jqp "$BODY" "x['originalTotal'] is None")" = "True"
test "$(jqp "$BODY" "x['remainingTotal'] is None")" = "True"
test "$(jqp "$BODY" "sorted(x['poolCurrencies'])")" = "['CAD', 'USD']"
grep -qi 'produces a number in no currency at all' <<<"$(printf '%s' "$BODY" | field currencyRefusal)"
# ...and the per-pool figures, which ARE exact, are still there.
test "$(jqp "$BODY" "len(x['pools'])")" = "2"
BODY=$(rpc "$MANAGER" compute_case_contingency_consumption "{\"p_case_id\":\"$CASE\"}")
noerr "$BODY"
test "$(psqlc "select status from calculation_runs where development_case_id='$CASE' and calculation_key='case_contingency_consumption' order by computed_at desc limit 1")" = "refused"
echo "   two currencies refuse a total rather than adding CAD to USD under one label"

# 4D-R7. A ceiling is an amount IN A CURRENCY: a fund in another one refuses.
USD_POOL=$(psqlc "select id from project_contingency_pools where development_case_id='$CASE' and currency='USD'")
BODY=$(rpc "$MANAGER" draw_down_contingency "{\"p_pool_id\":\"$USD_POOL\",\"p_draw\":{\"amount\":\"1000\",\"cause_class\":\"market_escalation\",\"justification\":\"A draw in a currency the delegation ceiling is not stated in.\"}}")
expect_err "$BODY" 'Sync holds no exchange rate'
echo "   a CAD ceiling is not compared to a USD fund — the comparison is wrong in both directions"

# 4D-R11. Malformed uuid text refuses as data, not as a Postgres error string.
BODY=$(rpc "$MANAGER" draw_down_contingency "{\"p_pool_id\":\"$POOL\",\"p_draw\":{\"amount\":\"1000\",\"cause_class\":\"realized_risk\",\"risk_id\":\"not-a-uuid\",\"justification\":\"A drawdown citing a risk id that is not a uuid at all.\"}}")
expect_err "$BODY" 'must cite the risk that was realized'
echo "   a malformed id is refused with a sentence, like every other bad input here"

echo
echo "Develop slice-4d smoke PASSED — contingency is a ledger, change rides the MOC engine,"
echo "decisions are measured or refused, and both screens compose recorded runs."

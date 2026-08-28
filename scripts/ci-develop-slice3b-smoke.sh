#!/usr/bin/env bash
# ============================================================================
# Sync Develop Slice 3B — instruments of exception, held to account.
#
# Steps (each a live transcript against a real local database):
#   1  ledger (D11.31): audit_events UPDATE and DELETE are refused for the
#      SERVICE path itself — the append-only trigger has no admit branch.
#   2  conditions (D3.18): a proceed_with_conditions births first-class
#      condition rows; a client edit is refused; a service evidence-free
#      closure is refused at the boundary; the hourly sweep escalates an
#      overdue condition (missed + breach + security event naming the
#      recorded consequence); closure demands case-scoped evidence and a
#      late closure keeps the breach on the record, prev/new in the ledger.
#   3  zero-based funding (D3.07): at a sanction-stage gate a passing
#      outcome without the I.5 answer is refused; with it, the answer is
#      stored on the review row. Sanction of that case then records the
#      D11.31 snapshot with the exercised authority as approval_reference.
#   4  waivers (D3.19/D3.20): a mandatory-unmet proceed is refused; the
#      waiver request demands its risk link; decide is FAIL-CLOSED on the
#      adopted gate_requirement_waiver delegation; the requester cannot
#      decide their own; an APPROVED waiver stands in for the criterion
#      (waived_mandatory named); expiry via the sweep REVERTS enforcement —
#      the same recording is refused again, and advance/sanction refuse on
#      the lapsed-waiver arm until a fresh waiver re-arms; the reversion is
#      a security_events + audit record, not just a predicate outcome.
#   5  SoD (D3.17/D3.33): all four pairs refused at the database — case
#      sponsor/creator cannot independently assure their case (RPC and raw
#      write); the case requester cannot sanction it (RPC and CHECK); the
#      deliverable producer cannot be its acceptor (CHECK under the review
#      marker); the treatment owner cannot accept the residual (RPC and
#      trigger); and the extended-authority ceiling on that same table refuses
#      BOTH the direct Critical acceptance and the accept-low-then-escalate
#      UPDATE that used to slip past its INSERT-only trigger.
#   6  composite rules (D11.28/D3.34): a composite conjunction (value band
#      4 AND risk >= high -> independent assurance) is authored on the DRAFT
#      rule set, armed by adoption, and REFUSES a gate pass at the RPC and
#      the persistence boundary until a completed, acceptable, INDEPENDENT
#      assurance review of the case exists — then the same pass proceeds
#      and advance follows. get_case_governance renders the armed rules.
#   7  ABAC (D3.32): a node-scoped adopted limit refuses approval outside
#      its subtree; a competency-scoped limit refuses an approver who does
#      not hold the current competency and admits them once the roster does.
#
# Run: supabase start && scripts/ci-develop-slice3b-smoke.sh
# ============================================================================
set -euo pipefail
trap 'echo "Develop slice-3b smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

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

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
RE=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$PLANNER"; test -n "$MANAGER"; test -n "$EXEC"; test -n "$RE"

MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
EXEC_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='executive@syncai.ca'")
PLANNER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='planner@syncai.ca'")
RE_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and role='reliability_engineer' limit 1")
test -n "$MANAGER_ID"; test -n "$RE_ID"; test -n "$EXEC_ID"; test -n "$PLANNER_ID"

# Idempotent re-run: clear this smoke's artifacts and return shared arming
# state to draft (the slice-1/3 cleanup discipline; service context — the
# provenance triggers admit and audit the service path by design).
psqlc "delete from risk_acceptances where organization_id='$ORG' and rationale like 'SMOKE3B %';" >/dev/null
psqlc "delete from development_cases where organization_id='$ORG' and title like 'SMOKE3B %';" >/dev/null
psqlc "delete from evidence_items where organization_id='$ORG' and description like 'SMOKE3B %';" >/dev/null
psqlc "delete from risks where organization_id='$ORG' and title like 'SMOKE3B %';" >/dev/null
psqlc "delete from recommendations where organization_id='$ORG' and title like 'SMOKE3B %';" >/dev/null
psqlc "delete from kb_intake_documents where organization_id='$ORG' and source_id like 'smoke3b-%';" >/dev/null
psqlc "delete from member_competencies where organization_id='$ORG' and member_id in (select id from workforce_members where organization_id='$ORG' and employee_ref like 'SMOKE3B%');" >/dev/null
psqlc "delete from workforce_members where organization_id='$ORG' and employee_ref like 'SMOKE3B%';" >/dev/null
psqlc "delete from competencies where organization_id='$ORG' and competency_key like 'smoke3b%';" >/dev/null
psqlc "update authority_limits set org_node_id=null where organization_id='$ORG' and basis like 'SMOKE3B%';" >/dev/null
psqlc "delete from authority_limits where organization_id='$ORG' and basis like 'SMOKE3B%';" >/dev/null
psqlc "update authority_limits set status='draft', adopted_by=null, adopted_at=null where organization_id='$ORG' and action_type in ('sanction','gate_requirement_waiver') and status='adopted';" >/dev/null
psqlc "delete from organizations where name like 'SMOKE3B %';" >/dev/null
psqlc "update governance_tailoring_rule_sets set status='draft', adopted_by=null, adopted_at=null, superseded_by=null where organization_id='$ORG' and version = 1;" >/dev/null
psqlc "update governance_intensity_bindings set status='draft', adopted_by=null, adopted_at=null, superseded_by=null where organization_id='$ORG';" >/dev/null
psqlc "select set_config('app.governance_config_write','granted',true); delete from governance_composite_rules where organization_id='$ORG';" >/dev/null
# Later versions: unreferenced ones go; versions still pinned by another
# transcript's determinations step aside as superseded — exactly one DRAFT
# (v1) remains, so versioning never refuses on a stale parallel draft.
psqlc "select set_config('app.governance_config_write','granted',true); delete from governance_tailoring_rule_sets where organization_id='$ORG' and version > 1 and not exists (select 1 from development_case_governance g where g.rule_set_id = governance_tailoring_rule_sets.id);" >/dev/null
psqlc "update governance_tailoring_rule_sets set status='superseded', adopted_by=null, adopted_at=null where organization_id='$ORG' and version > 1;" >/dev/null
psqlc "update project_frameworks set status='draft', adopted_by=null, adopted_at=null, superseded_by=null where organization_id='$ORG' and name in ('Major Capital Projects — Mining & Metals','Sustaining Capital — Light Governance','Turnaround & Shutdown Delivery','Brownfield Modification — Operating Site','Digital & IT Delivery','Exploration & Study Phase');" >/dev/null
psqlc "delete from project_frameworks where organization_id='$ORG' and name='SMOKE3B Sanction Frame';" >/dev/null

echo '— 1. the ledger cannot be rewritten, service path included (D11.31) —'
AUD=$(psqlc "select id from audit_events where organization_id='$ORG' order by created_at asc limit 1")
test -n "$AUD"
OUT=$(sql_must_fail "update audit_events set actor='rewritten' where id='$AUD';")
grep -qi 'append-only for every caller' <<<"$OUT"
OUT=$(sql_must_fail "delete from audit_events where id='$AUD';")
grep -qi 'append-only for every caller' <<<"$OUT"
# TRUNCATE is the erase-everything verb: no row-level trigger fires for it
# and RLS does not gate it, so it needs (and has) its own statement trigger.
OUT=$(sql_must_fail "truncate table audit_events;")
grep -qi 'append-only for every caller' <<<"$OUT"
OUT=$(sql_must_fail "set role service_role; truncate table audit_events;")
grep -qi 'append-only for every caller\|permission denied' <<<"$OUT"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG'")" -ge 1
test "$(psqlc "select has_table_privilege('service_role','public.audit_events','TRUNCATE')")" = "f"
test "$(psqlc "select has_table_privilege('authenticated','public.audit_events','TRUNCATE')")" = "f"
test "$(psqlc "select count(*) from information_schema.columns where table_name='audit_events' and column_name in ('previous_state','new_state','approval_reference')")" = "3"
echo '   UPDATE, DELETE and TRUNCATE refused, service path included; TRUNCATE also revoked; snapshot columns present'

# Shared arming: adopt the three library frameworks the reference rules name.
for FWN in 'Major Capital Projects — Mining & Metals' 'Sustaining Capital — Light Governance' 'Brownfield Modification — Operating Site'; do
  FWID=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='$FWN' and status='draft' order by version desc limit 1")
  test -n "$FWID"
  R=$(rpc "$EXEC" adopt_project_framework "{\"p_framework_id\":\"$FWID\",\"p_note\":\"Adopted for the slice-3b CI transcript as demo governance.\"}")
  noerr "$R"
done
BROWN=$(psqlc "select id from project_frameworks where organization_id='$ORG' and name='Brownfield Modification — Operating Site' and status='adopted' limit 1")
test -n "$BROWN"
G1=$(psqlc "select g.id from stage_gates g where g.framework_id='$BROWN' and g.name='G1 — Framing'")
CRIT=$(psqlc "select criterion from stage_gate_criteria where gate_id=$G1 and is_mandatory")
CRIT_ID=$(psqlc "select id from stage_gate_criteria where gate_id=$G1 and is_mandatory")
test -n "$G1"; test -n "$CRIT"

echo '— 2. conditions are instruments, not prose (D3.18) —'
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3B condition case\",\"p_problem_statement\":\"Screen deck failures repeat quarterly and consume the maintenance window.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":1000000,\"p_framework_id\":\"$BROWN\"}")
noerr "$R"; CASE_A=$(printf '%s' "$R"|field case_id); test -n "$CASE_A"
DUE=$(psqlc "select (current_date + 1)::text")
FIND_A="[{\"criterion_text\":\"$CRIT\",\"status\":\"met\",\"evidence\":\"Impact reviewed in the CI transcript.\"}]"
COND_A="[{\"description\":\"Deliver the liner trial report\",\"owner_id\":\"$MANAGER_ID\",\"due_date\":\"$DUE\",\"evidence_requirement\":\"Trial report with wear data\",\"consequence_if_missed\":\"Gate decision reverts to hold at the next review\"}]"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_A\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed_with_conditions\",\"p_note\":\"Framing passes conditionally; the liner trial evidence is still owed.\",\"p_findings\":$FIND_A,\"p_conditions\":$COND_A}")
noerr "$R"
CND=$(psqlc "select gc.id from gate_conditions gc join stage_gate_reviews r on r.id=gc.review_id where r.development_case_id='$CASE_A' and gc.status='open'")
test -n "$CND"
# (a) client edit refused even RLS-bypassed
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
update gate_conditions set status='satisfied', closed_by='$MANAGER_ID', closed_at=now() where id=$CND;
rollback;")
grep -qi 'condition lifecycle' <<<"$OUT"
# (b) service evidence-free closure refused at the boundary
OUT=$(sql_must_fail "update gate_conditions set status='satisfied', closed_by='$MANAGER_ID', closed_at=now() where id=$CND;")
grep -qi 'closed by linked evidence' <<<"$OUT"
# (b2) BORN COMPLETE binds the raw/service path too: a conditional review
# with prose conditions and ZERO first-class condition rows dies at commit
# (deferred constraint trigger), not only at the RPC door.
OUT=$(sql_must_fail "insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, conditions, reviewed_by, reviewed_at, note)
values ('$ORG','$CASE_A',$G1,'need_identification','proceed_with_conditions','prose-only condition, no child rows','$MANAGER_ID',now(),'raw conditional review without children must be refused');")
grep -qi 'at least one first-class gate condition' <<<"$OUT"
# (c) overdue -> the sweep escalates: missed + breach + the consequence read back
psqlc "update gate_conditions set due_date = current_date - 1 where id=$CND;" >/dev/null
SEC_B=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Gate condition OVERDUE and escalated%'")
R=$(psqlc "select public.expire_governance_instruments()")
test "$(printf '%s' "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["gate_conditions_escalated"])')" -ge 1
test "$(psqlc "select status from gate_conditions where id=$CND")" = "missed"
test -n "$(psqlc "select breached_at from gate_conditions where id=$CND")"
SEC_AFTER=$(psqlc "select count(*) from security_events where organization_id='$ORG' and detail like 'Gate condition OVERDUE and escalated%'")
test "$SEC_AFTER" -gt "$SEC_B"
psqlc "select 1 from security_events where organization_id='$ORG' and detail like '%Recorded consequence if missed: Gate decision reverts to hold%' limit 1" | grep -q 1
# (d) closure demands evidence of THIS case; a late closure keeps the breach
R=$(rpc "$RE" close_gate_condition "{\"p_condition_id\":$CND,\"p_evidence_id\":null,\"p_note\":\"no evidence attached\"}")
expect_err "$R" 'requires the evidence'
R=$(rpc "$RE" record_case_evidence "{\"p_case_id\":\"$CASE_A\",\"p_evidence\":{\"evidence_class\":\"TESTED\",\"description\":\"SMOKE3B liner trial report with wear data\",\"source_system\":\"ci-transcript\"}}")
noerr "$R"; EV_A=$(printf '%s' "$R"|field evidence_id); test -n "$EV_A"
R=$(rpc "$RE" close_gate_condition "{\"p_condition_id\":$CND,\"p_evidence_id\":\"$EV_A\",\"p_note\":\"Trial report reviewed; wear inside allowance.\"}")
noerr "$R"; test "$(printf '%s' "$R"|field closed_late)" = "True"
test "$(psqlc "select status from gate_conditions where id=$CND")" = "satisfied"
test -n "$(psqlc "select breached_at from gate_conditions where id=$CND")"
psqlc "select 1 from audit_events where organization_id='$ORG' and entity_type='gate_condition' and event_data->>'action'='satisfied' and previous_state->>'status'='missed' and new_state->>'status'='satisfied' limit 1" | grep -q 1
echo '   born with the review; client edit refused; evidence-free closure refused; escalated when overdue; closed late WITH evidence, breach preserved'

echo '— 3. the zero-based funding question at a sanction-type gate (D3.07) —'
R=$(rpc "$EXEC" create_project_framework '{"p_name":"SMOKE3B Sanction Frame","p_source":"CI transcript single-stage sanction framework","p_basis":"Slice-3b transcript fixture"}')
noerr "$R"; SFW=$(printf '%s' "$R"|field framework_id); test -n "$SFW"
R=$(rpc "$EXEC" add_framework_stage "{\"p_framework_id\":\"$SFW\",\"p_stage_key\":\"sanction\",\"p_sequence\":1,\"p_display_name\":\"Sanction\"}")
noerr "$R"
R=$(rpc "$EXEC" add_framework_gate "{\"p_framework_id\":\"$SFW\",\"p_stage_key\":\"sanction\",\"p_name\":\"FID\",\"p_sequence\":1,\"p_decision_type\":\"gate\"}")
noerr "$R"; FIDG=$(printf '%s' "$R"|field gate_id); test -n "$FIDG"
R=$(rpc "$EXEC" set_gate_requirement "{\"p_gate_id\":$FIDG,\"p_criterion\":\"Funding readiness is evidenced\",\"p_is_mandatory\":true,\"p_source_authority\":\"BEST_PRACTICE\"}")
noerr "$R"
R=$(rpc "$EXEC" adopt_project_framework "{\"p_framework_id\":\"$SFW\",\"p_note\":\"Adopted for the funding-question transcript.\"}")
noerr "$R"
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3B funding case\",\"p_problem_statement\":\"Concentrator debottlenecking is ready for the capital commitment decision.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":4500000,\"p_framework_id\":\"$SFW\"}")
noerr "$R"; CASE_F=$(printf '%s' "$R"|field case_id)
test "$(printf '%s' "$R"|field current_stage_key)" = "sanction"
# design-or-later gates need the success contract first (slice-2 rule, kept)
R=$(rpc "$PLANNER" draft_success_contract "{\"p_case_id\":\"$CASE_F\"}")
noerr "$R"; SCON=$(printf '%s' "$R"|field contract_id)
R=$(rpc "$PLANNER" set_success_outcome "{\"p_contract_id\":\"$SCON\",\"p_dimension\":\"business\",\"p_outcome_statement\":\"Recover 40kt per year of lost throughput\",\"p_basis\":\"Loss accounting in the FY26 production ledger\",\"p_owner_id\":\"$MANAGER_ID\",\"p_target_value\":40000,\"p_unit\":\"t/a\"}")
noerr "$R"
R=$(rpc "$MANAGER" record_success_contract "{\"p_contract_id\":\"$SCON\",\"p_note\":\"Recorded from stated loss accounting for the transcript.\"}")
noerr "$R"
FIND_F='[{"criterion_text":"Funding readiness is evidenced","status":"met","evidence":"Board pack appendix reviewed."}]'
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_F\",\"p_gate_id\":$FIDG,\"p_outcome\":\"proceed\",\"p_note\":\"FID gate held with every mandatory met; funding answer deliberately omitted.\",\"p_findings\":$FIND_F}")
expect_err "$R" 'sanction-type gate'
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_F\",\"p_gate_id\":$FIDG,\"p_outcome\":\"proceed\",\"p_note\":\"FID gate held with every mandatory met and the I.5 answer recorded.\",\"p_findings\":$FIND_F,\"p_funding_answer\":\"Yes — proposed today on current knowledge this still clears the hurdle rate.\"}")
noerr "$R"
test -n "$(psqlc "select funding_continuation_answer from stage_gate_reviews where development_case_id='$CASE_F' and gate_id=$FIDG and outcome='proceed'")"
# sanction under the adopted delegation records snapshot + approval linkage
SANC_DRAFT=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='executive' and action_type='sanction' and status='draft' order by version desc limit 1")
test -n "$SANC_DRAFT"
R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$SANC_DRAFT\",\"p_note\":\"Adopted for the slice-3b transcript from the demo delegation.\"}")
noerr "$R"
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE_F\",\"p_note\":\"Sanctioned inside the adopted executive delegation for the transcript.\",\"p_sanctioned_value\":4500000}")
noerr "$R"
psqlc "select 1 from audit_events where organization_id='$ORG' and entity_type='development_case' and event_data->>'action'='sanctioned' and event_data->>'case_id'='$CASE_F' and approval_reference is not null and previous_state->>'status'='active' and new_state->>'status'='sanctioned' limit 1" | grep -q 1
echo '   unanswered refused; answered stored on the review; sanction ledger row carries prev/new + the exercised delegation'

echo '— 4. waivers: governed, expiring, and NEVER silently permanent (D3.19/D3.20) —'
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3B waiver case\",\"p_problem_statement\":\"Crusher bay modification beside the operating line, framing underway.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":2000000,\"p_framework_id\":\"$BROWN\"}")
noerr "$R"; CASE_W=$(printf '%s' "$R"|field case_id); test -n "$CASE_W"
FIND_W="[{\"criterion_text\":\"$CRIT\",\"status\":\"not_assessed\",\"evidence\":null}]"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_W\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Mandatory deliberately not met — the block must hold before any waiver.\",\"p_findings\":$FIND_W}")
expect_err "$R" 'not explicitly met'
R=$(rpc "$PLANNER" request_gate_requirement_waiver "{\"p_case_id\":\"$CASE_W\",\"p_requirement_id\":$CRIT_ID,\"p_justification\":\"Impact statement depends on vendor data due next month.\",\"p_compensating_controls\":\"Interim manual assessment by the area engineer weekly.\",\"p_risk_id\":null,\"p_expires_at\":\"$(psqlc "select (now() + interval '1 day')::text")\"}")
expect_err "$R" 'risk assessment'
RISK_W=$(psqlc "with r as (insert into risks (organization_id, title, current_risk_level, status) values ('$ORG','SMOKE3B waiver exposure','Medium','draft') returning id) select id from r")
EXP1=$(psqlc "select (now() + interval '1 day')::timestamptz::text")
R=$(rpc "$PLANNER" request_gate_requirement_waiver "{\"p_case_id\":\"$CASE_W\",\"p_requirement_id\":$CRIT_ID,\"p_justification\":\"Impact statement depends on vendor data due next month.\",\"p_compensating_controls\":\"Interim manual assessment by the area engineer weekly.\",\"p_risk_id\":\"$RISK_W\",\"p_expires_at\":\"$EXP1\"}")
noerr "$R"; WVR=$(printf '%s' "$R"|field waiver_id); test -n "$WVR"
# fail-closed: no adopted waiver delegation for the manager role
R=$(rpc "$MANAGER" decide_gate_requirement_waiver "{\"p_waiver_id\":\"$WVR\",\"p_approve\":true,\"p_note\":\"Manager decision must be refused fail-closed.\"}")
expect_err "$R" 'no ADOPTED gate-requirement-waiver authority'
WDRAFT=$(psqlc "select id from authority_limits where organization_id='$ORG' and role_key='executive' and action_type='gate_requirement_waiver' and status='draft' order by version desc limit 1")
test -n "$WDRAFT"
R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$WDRAFT\",\"p_note\":\"Adopted for the slice-3b waiver transcript.\"}")
noerr "$R"
# the requester cannot decide their own request (probe on a second pending)
EXP2=$(psqlc "select (now() + interval '2 days')::timestamptz::text")
R=$(rpc "$EXEC" request_gate_requirement_waiver "{\"p_case_id\":\"$CASE_W\",\"p_requirement_id\":$CRIT_ID,\"p_justification\":\"Requester-SoD probe request for the transcript record.\",\"p_compensating_controls\":\"Weekly interim assessment continues under this probe too.\",\"p_risk_id\":\"$RISK_W\",\"p_expires_at\":\"$EXP2\"}")
noerr "$R"; WVR2=$(printf '%s' "$R"|field waiver_id)
R=$(rpc "$EXEC" decide_gate_requirement_waiver "{\"p_waiver_id\":\"$WVR2\",\"p_approve\":false,\"p_note\":\"Deciding my own request must be refused.\"}")
expect_err "$R" 'you requested this waiver'
R=$(rpc "$EXEC" decide_gate_requirement_waiver "{\"p_waiver_id\":\"$WVR\",\"p_approve\":true,\"p_note\":\"Approved under the adopted delegation; expiry re-arms the rule.\"}")
noerr "$R"
psqlc "select 1 from audit_events where organization_id='$ORG' and entity_type='gate_requirement_waiver' and event_data->>'action'='approved' and approval_reference is not null and previous_state->>'status'='pending' and new_state->>'status'='approved' limit 1" | grep -q 1
# the approved waiver stands in for the criterion — the SAME recording passes
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_W\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Proceeding under the approved waiver; mandatory stands waived not met.\",\"p_findings\":$FIND_W}")
noerr "$R"
test "$(printf '%s' "$R"|field waived_mandatory)" = "[\"$CRIT\"]"
# expiry: the sweep flips it, records the reversion, and the block returns
psqlc "update standard_site_variances set expires_at = now() - interval '1 hour' where id='$WVR';" >/dev/null
R=$(psqlc "select public.expire_governance_instruments()")
test "$(printf '%s' "$R" | python3 -c 'import json,sys; print(json.load(sys.stdin)["variances_expired"])')" -ge 1
test "$(psqlc "select status from standard_site_variances where id='$WVR'")" = "expired"
psqlc "select 1 from security_events where organization_id='$ORG' and detail like '%ENFORCEMENT REVERTED%' limit 1" | grep -q 1
psqlc "select 1 from audit_events where organization_id='$ORG' and entity_type='gate_requirement_waiver' and event_data->>'action'='expired' and event_data->>'waiver_id'='$WVR' limit 1" | grep -q 1
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_W\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Same recording after expiry must be blocked again — no silent permanence.\",\"p_findings\":$FIND_W}")
expect_err "$R" 'not explicitly met'
# act-time reversion: the stored waived pass no longer carries advance/sanction
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE_W\",\"p_to_stage_key\":\"options_analysis\"}")
expect_err "$R" 'LAPSED'
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE_W\",\"p_note\":\"Sanction over a lapsed-waiver pass must be refused at the act.\",\"p_sanctioned_value\":2000000}")
expect_err "$R" 'LAPSED'
# a fresh waiver re-arms the stand-in and the act proceeds
EXP3=$(psqlc "select (now() + interval '3 days')::timestamptz::text")
R=$(rpc "$PLANNER" request_gate_requirement_waiver "{\"p_case_id\":\"$CASE_W\",\"p_requirement_id\":$CRIT_ID,\"p_justification\":\"Vendor data still outstanding; re-waiving with the same controls.\",\"p_compensating_controls\":\"Interim manual assessment by the area engineer weekly.\",\"p_risk_id\":\"$RISK_W\",\"p_expires_at\":\"$EXP3\"}")
noerr "$R"; WVR3=$(printf '%s' "$R"|field waiver_id)
R=$(rpc "$EXEC" decide_gate_requirement_waiver "{\"p_waiver_id\":\"$WVR3\",\"p_approve\":true,\"p_note\":\"Re-approved under the adopted delegation for the reversion proof.\"}")
noerr "$R"
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE_W\",\"p_to_stage_key\":\"options_analysis\"}")
noerr "$R"; test "$(printf '%s' "$R"|field current_stage_key)" = "options_analysis"
# RENEWAL INSIDE THE SWEEP WINDOW: time-expire the active waiver WITHOUT
# running the sweep — its unique-index slot still reads 'approved'. A
# renewal must land as a NAMED outcome (the decide act expires the lapsed
# slot itself), never as a raw duplicate-key error.
psqlc "update standard_site_variances set expires_at = now() - interval '5 minutes' where id='$WVR3';" >/dev/null
EXP4=$(psqlc "select (now() + interval '4 days')::timestamptz::text")
R=$(rpc "$PLANNER" request_gate_requirement_waiver "{\"p_case_id\":\"$CASE_W\",\"p_requirement_id\":$CRIT_ID,\"p_justification\":\"Renewal requested inside the pre-sweep window for the transcript.\",\"p_compensating_controls\":\"Interim manual assessment by the area engineer weekly.\",\"p_risk_id\":\"$RISK_W\",\"p_expires_at\":\"$EXP4\"}")
noerr "$R"; WVR4=$(printf '%s' "$R"|field waiver_id)
R=$(rpc "$EXEC" decide_gate_requirement_waiver "{\"p_waiver_id\":\"$WVR4\",\"p_approve\":true,\"p_note\":\"Renewal approved; the lapsed predecessor is expired at this act.\"}")
noerr "$R"; test "$(printf '%s' "$R"|field status)" = "approved"
test "$(psqlc "select status from standard_site_variances where id='$WVR3'")" = "expired"
psqlc "select 1 from audit_events where organization_id='$ORG' and entity_type='gate_requirement_waiver' and event_data->>'action'='expired' and event_data->>'waiver_id'='$WVR3' limit 1" | grep -q 1
# THE RISK LINK IS LOAD-BEARING: the anchoring risk is not deletable, the
# link is not severable, and a ceiling that cannot be verified fails CLOSED.
OUT=$(sql_must_fail "delete from risks where id='$RISK_W';")
grep -qi 'violates foreign key' <<<"$OUT"
OUT=$(sql_must_fail "update standard_site_variances set risk_id=null where id='$WVR4';")
grep -qi 'ssv_subject_shape' <<<"$OUT"
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3B ceiling case\",\"p_problem_statement\":\"Thickener rake upgrade framing for the waiver-ceiling probes.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":1500000,\"p_framework_id\":\"$BROWN\"}")
noerr "$R"; CASE_U=$(printf '%s' "$R"|field case_id)
RISK_U=$(psqlc "with r as (insert into risks (organization_id, title, status) values ('$ORG','SMOKE3B unrated exposure','draft') returning id) select id from r")
RISK_C=$(psqlc "with r as (insert into risks (organization_id, title, current_risk_level, status) values ('$ORG','SMOKE3B critical exposure','Critical','draft') returning id) select id from r")
EXP5=$(psqlc "select (now() + interval '5 days')::timestamptz::text")
R=$(rpc "$PLANNER" request_gate_requirement_waiver "{\"p_case_id\":\"$CASE_U\",\"p_requirement_id\":$CRIT_ID,\"p_justification\":\"Unrated-risk ceiling probe request for the transcript.\",\"p_compensating_controls\":\"Weekly interim assessment stands during this probe as well.\",\"p_risk_id\":\"$RISK_U\",\"p_expires_at\":\"$EXP5\"}")
noerr "$R"; WVA=$(printf '%s' "$R"|field waiver_id)
R=$(rpc "$PLANNER" request_gate_requirement_waiver "{\"p_case_id\":\"$CASE_U\",\"p_requirement_id\":$CRIT_ID,\"p_justification\":\"Critical-risk ceiling probe request for the transcript.\",\"p_compensating_controls\":\"Weekly interim assessment stands during this probe as well.\",\"p_risk_id\":\"$RISK_C\",\"p_expires_at\":\"$EXP5\"}")
noerr "$R"; WVB=$(printf '%s' "$R"|field waiver_id)
R=$(rpc "$PLANNER" request_gate_requirement_waiver "{\"p_case_id\":\"$CASE_U\",\"p_requirement_id\":$CRIT_ID,\"p_justification\":\"Medium-risk approval probe request for the transcript.\",\"p_compensating_controls\":\"Weekly interim assessment stands during this probe as well.\",\"p_risk_id\":\"$RISK_W\",\"p_expires_at\":\"$EXP5\"}")
noerr "$R"; WVC=$(printf '%s' "$R"|field waiver_id)
R=$(rpc "$PLANNER" request_gate_requirement_waiver "{\"p_case_id\":\"$CASE_U\",\"p_requirement_id\":$CRIT_ID,\"p_justification\":\"Second pending request racing the first for the conflict probe.\",\"p_compensating_controls\":\"Weekly interim assessment stands during this probe as well.\",\"p_risk_id\":\"$RISK_W\",\"p_expires_at\":\"$EXP5\"}")
noerr "$R"; WVD=$(printf '%s' "$R"|field waiver_id)
R=$(rpc "$EXEC" decide_gate_requirement_waiver "{\"p_waiver_id\":\"$WVA\",\"p_approve\":true,\"p_note\":\"Approving over an unrated risk must be refused fail-closed.\"}")
expect_err "$R" 'carries no rated level'
R=$(rpc "$EXEC" decide_gate_requirement_waiver "{\"p_waiver_id\":\"$WVB\",\"p_approve\":true,\"p_note\":\"Approving over a Critical risk must exceed the executive ceiling.\"}")
expect_err "$R" 'exceeds the'
R=$(rpc "$EXEC" decide_gate_requirement_waiver "{\"p_waiver_id\":\"$WVC\",\"p_approve\":true,\"p_note\":\"Medium risk sits inside the executive High ceiling; approve.\"}")
noerr "$R"; test "$(printf '%s' "$R"|field status)" = "approved"
R=$(rpc "$EXEC" decide_gate_requirement_waiver "{\"p_waiver_id\":\"$WVD\",\"p_approve\":true,\"p_note\":\"Second approval into an occupied slot must be refused by name.\"}")
expect_err "$R" 'already covers this requirement'
echo '   blocked -> waived (named) -> expired -> BLOCKED AGAIN at record, advance and sanction -> re-armed by a fresh governed waiver; pre-sweep renewal lands as a NAMED act; risk link undeletable/unseverable; unrated and over-ceiling risks refused fail-closed; slot conflict refused by name'

echo '— 5. the four SoD pairs refuse at the database (D3.17/D3.33) —'
# pair 1, project scope: the case creator cannot independently assure it
R=$(rpc "$MANAGER" create_development_case "{\"p_title\":\"SMOKE3B assurance case\",\"p_problem_statement\":\"Conveyor drive replacement framing for the assurance probe.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":3000000,\"p_framework_id\":\"$BROWN\"}")
noerr "$R"; CASE_S=$(printf '%s' "$R"|field case_id)
R=$(rpc "$MANAGER" record_risk_assurance_review "{\"p_review\":{\"subject_type\":\"development_case\",\"subject_id\":\"$CASE_S\",\"assurance_level\":\"independent\",\"scope\":\"Framing assurance of the SMOKE3B case\",\"status\":\"planned\"}}")
expect_err "$R" 'cannot independently assure their own case'
R=$(rpc "$RE" record_risk_assurance_review "{\"p_review\":{\"subject_type\":\"development_case\",\"subject_id\":\"$CASE_S\",\"assurance_level\":\"independent\",\"scope\":\"Framing assurance of the SMOKE3B case\",\"status\":\"planned\"}}")
noerr "$R"
OUT=$(sql_must_fail "insert into risk_assurance_reviews (organization_id, subject_type, subject_id, assurance_level, reviewer_id, subject_owner_id, scope) values ('$ORG','development_case','$CASE_S','independent','$MANAGER_ID','$RE_ID','raw write must be stopped');")
grep -qi 'cannot independently assure their own case' <<<"$OUT"
# pair 2: requester != final approver (RPC + CHECK)
R=$(rpc "$EXEC" create_development_case "{\"p_title\":\"SMOKE3B self-sanction case\",\"p_problem_statement\":\"Executive-raised case for the requester-SoD probe transcript.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":1000000,\"p_framework_id\":\"$BROWN\"}")
noerr "$R"; CASE_R=$(printf '%s' "$R"|field case_id)
# every other door passes first (gate held by a manager review) — the
# conflict rule is the LAST refusal, so it is provably the operative one
FIND_R="[{\"criterion_text\":\"$CRIT\",\"status\":\"met\",\"evidence\":\"Framing reviewed for the requester-SoD probe.\"}]"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_R\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Framing gate held by the manager for the requester-SoD probe.\",\"p_findings\":$FIND_R}")
noerr "$R"
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE_R\",\"p_note\":\"Sanctioning my own raised case must be refused.\",\"p_sanctioned_value\":1000000}")
expect_err "$R" 'cannot also record its sanction'
OUT=$(sql_must_fail "select set_config('app.development_sanction_write','granted',true);
update development_cases set status='sanctioned', sanctioned_at=now(), sanctioned_by=created_by, sanctioned_value=1 where id='$CASE_R';")
grep -qi 'dc_sanction_requester_sod' <<<"$OUT"
# pair 3: producer != acceptor (CHECK holds even under the review marker)
R=$(rpc "$PLANNER" create_case_deliverable "{\"p_case_id\":\"$CASE_W\",\"p_title\":\"SMOKE3B impact statement\",\"p_type\":\"report\",\"p_owner_id\":\"$RE_ID\"}")
noerr "$R"; DLV=$(printf '%s' "$R"|field deliverable_id)
OUT=$(sql_must_fail "select set_config('app.deliverable_review_write','granted',true);
update develop_deliverables set status='accepted', accepted_by='$RE_ID', accepted_at=now() where id='$DLV';")
grep -qi 'dd_producer_not_acceptor_sod' <<<"$OUT"
# pair 4: treatment owner != risk acceptor (RPC + trigger)
REC=$(psqlc "with r as (insert into recommendations (organization_id, title, status, treatment_owner_id) values ('$ORG','SMOKE3B seal replacement treatment','pending','$RE_ID') returning id) select id from r")
EXPR=$(psqlc "select (now() + interval '90 days')::timestamptz::text")
R=$(rpc "$RE" accept_risk "{\"p_subject_type\":\"recommendation\",\"p_subject_id\":\"$REC\",\"p_risk_level\":\"Low\",\"p_rationale\":\"Residual after treatment is tolerable for one quarter.\",\"p_compensating_controls\":\"Weekly seal inspection until the treatment lands.\",\"p_expires_at\":\"$EXPR\"}")
expect_err "$R" 'cannot also accept its residual risk'
OUT=$(sql_must_fail "insert into risk_acceptances (organization_id, subject_type, subject_id, risk_level, rationale, compensating_controls, accepted_by, accepted_role, expires_at) values ('$ORG','recommendation','$REC','Low','raw write must be stopped by the trigger','none worth naming here','$RE_ID','reliability_engineer', now() + interval '1 day');")
grep -qi 'cannot accept the risk their own treatment answers for' <<<"$OUT"
# pair 4, the other verb: a legitimate acceptance cannot be RE-POINTED onto
# the treatment owner (or the AI identity) by an UPDATE — same wall.
ACC_P=$(psqlc "with r as (insert into risk_acceptances (organization_id, subject_type, subject_id, risk_level, rationale, compensating_controls, accepted_by, accepted_role, expires_at) values ('$ORG','recommendation','$REC','Low','SMOKE3B legitimate acceptance by a non-owner for the update probe','Weekly seal inspection until the treatment lands.','$MANAGER_ID','maintenance_manager', now() + interval '1 day') returning id) select id from r")
OUT=$(sql_must_fail "update risk_acceptances set accepted_by='$RE_ID' where id='$ACC_P';")
grep -qi 'cannot accept the risk their own treatment answers for' <<<"$OUT"
test "$(psqlc "select accepted_by from risk_acceptances where id='$ACC_P'")" = "$MANAGER_ID"
# §70: the AI-operator identity cannot accept a risk or stand as the
# INDEPENDENT assurer of a case — RPC and raw write alike.
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
AIBOT_ID='99999999-9999-4999-8999-999999999999'
R=$(rpc "$AIBOT" accept_risk "{\"p_subject_type\":\"recommendation\",\"p_subject_id\":\"$REC\",\"p_risk_level\":\"Low\",\"p_rationale\":\"the AI-operator identity must be refused by name\",\"p_compensating_controls\":\"the AI-operator identity must be refused by name\",\"p_expires_at\":\"$EXPR\"}")
expect_err "$R" 'AI-operator identity cannot record'
OUT=$(sql_must_fail "update risk_acceptances set accepted_by='$AIBOT_ID' where id='$ACC_P';")
grep -qi 'cannot stand as the recorded acceptor' <<<"$OUT"
OUT=$(sql_must_fail "insert into risk_acceptances (organization_id, subject_type, subject_id, risk_level, rationale, compensating_controls, accepted_by, accepted_role, expires_at) values ('$ORG','risk','$RISK_W','Low','SMOKE3B raw ai acceptance must be stopped','none worth naming here','$AIBOT_ID','ai_admin', now() + interval '1 day');")
grep -qi 'cannot stand as the recorded acceptor' <<<"$OUT"
R=$(rpc "$AIBOT" record_risk_assurance_review "{\"p_review\":{\"subject_type\":\"development_case\",\"subject_id\":\"$CASE_S\",\"assurance_level\":\"independent\",\"scope\":\"the AI-operator identity must be refused by name\",\"status\":\"planned\"}}")
expect_err "$R" 'AI-operator identity cannot record'
OUT=$(sql_must_fail "insert into risk_assurance_reviews (organization_id, subject_type, subject_id, assurance_level, reviewer_id, subject_owner_id, scope) values ('$ORG','development_case','$CASE_S','independent','$AIBOT_ID','$MANAGER_ID','raw ai assurance write must be stopped');")
grep -qi 'cannot stand as the reviewer' <<<"$OUT"
psqlc "delete from risk_acceptances where id='$ACC_P';" >/dev/null
# The ceiling trigger one trigger over on the SAME table. Hardening pair 4 to
# INSERT OR UPDATE left trg_extended_risk_acceptance_authority firing on INSERT
# only, so the ceiling could be dodged by accepting LOW and escalating the row:
# a direct 'Critical' insert is refused, but insert-low-then-update was not.
# Arm the ladder with an independent-assurance threshold and prove BOTH verbs.
LADJ=$(psqlc "with r as (insert into authority_limits (organization_id, role_key, tier_label, action_type, basis, status, version, independent_assurance_above_level) values ('$ORG','reliability_engineer','SMOKE3B Ceiling Probe','general','SMOKE3B extended-authority ceiling probe','adopted',7005,'High') returning id) select id from r")
# Positive control: the guard is armed — a direct Critical acceptance is refused.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$RE_ID', true);
insert into risk_acceptances (organization_id, subject_type, subject_id, risk_level, rationale, compensating_controls, accepted_by, accepted_role, expires_at, reassessment_trigger) values ('$ORG','risk','$RISK_W','Critical','SMOKE3B ceiling control','none worth naming here','$RE_ID','reliability_engineer', now() + interval '1 day','SMOKE3B reassessment trigger');
rollback;")
grep -qi 'independent assurance by a different person is required' <<<"$OUT"
# The escalation itself: accept LOW (passes), then raise the row to Critical.
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$RE_ID', true);
insert into risk_acceptances (organization_id, subject_type, subject_id, risk_level, rationale, compensating_controls, accepted_by, accepted_role, expires_at, reassessment_trigger) values ('$ORG','risk','$RISK_W','Low','SMOKE3B ceiling escalation probe','none worth naming here','$RE_ID','reliability_engineer', now() + interval '1 day','SMOKE3B reassessment trigger');
update risk_acceptances set risk_level='Critical' where organization_id='$ORG' and rationale='SMOKE3B ceiling escalation probe';
rollback;")
grep -qi 'independent assurance by a different person is required' <<<"$OUT"
psqlc "delete from authority_limits where id='$LADJ';" >/dev/null
echo '   author!=assurer (project scope), requester!=final approver, producer!=acceptor, treatment owner!=risk acceptor — each at the DB, INSERT and UPDATE; the AI identity can neither accept a risk nor stand as independent case assurer'

echo '— 6. composite authority rules: value band 4 AND high risk demand independent assurance (D3.34/D11.28) —'
RS=$(psqlc "select id from governance_tailoring_rule_sets where organization_id='$ORG' and name='Reference Tailoring Rules' and status='draft' and version=1 limit 1")
test -n "$RS"
R=$(rpc "$EXEC" adopt_governance_rule_set "{\"p_rule_set_id\":\"$RS\",\"p_note\":\"Adopted v1 (no composite rules yet) for the ordering-bypass probe.\"}")
noerr "$R"
R=$(rpc "$PLANNER" create_development_case "{\"p_title\":\"SMOKE3B composite case\",\"p_problem_statement\":\"Ore handling expansion beside the operating train at full band value.\",\"p_lifecycle_type\":\"brownfield\",\"p_estimated_capex\":300000000,\"p_framework_id\":\"$BROWN\"}")
noerr "$R"; CASE_C=$(printf '%s' "$R"|field case_id)
R=$(rpc "$RE" apply_case_governance "{\"p_case_id\":\"$CASE_C\",\"p_risk\":\"high\",\"p_complexity\":\"medium\",\"p_novelty\":\"proven\",\"p_regulatory_exposure\":\"permit_required\",\"p_interfaces\":\"multiple\",\"p_basis\":\"Classified for the composite-rule transcript probe.\"}")
noerr "$R"; test "$(printf '%s' "$R"|field intensity_level)" = "full"
FIND_C="[{\"criterion_text\":\"$CRIT\",\"status\":\"met\",\"evidence\":\"Impact statement reviewed for the composite probe.\"}]"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_C\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Passes BEFORE any composite rule exists — the act-time probe depends on it.\",\"p_findings\":$FIND_C}")
noerr "$R"
# the composite conjunction arrives as data on the NEXT rule-set version
R=$(rpc "$EXEC" create_governance_rule_set_version "{\"p_rule_set_id\":\"$RS\"}")
noerr "$R"; RS2=$(printf '%s' "$R"|field rule_set_id); test -n "$RS2"
R=$(rpc "$EXEC" add_composite_authority_rule "{\"p_rule_set_id\":\"$RS2\",\"p_priority\":10,\"p_description\":\"SMOKE3B flagship: top value band and high risk require independent assurance before any gate passes\",\"p_consequence\":\"independent_assurance_required\",\"p_min_value_level\":4,\"p_min_risk_rating\":\"high\"}")
noerr "$R"
R=$(rpc "$EXEC" add_composite_authority_rule "{\"p_rule_set_id\":\"$RS2\",\"p_priority\":11,\"p_description\":\"An unconditional composite rule must be refused as a binding in disguise\",\"p_consequence\":\"independent_assurance_required\"}")
expect_err "$R" 'at least one condition'
R=$(rpc "$EXEC" add_composite_authority_rule "{\"p_rule_set_id\":\"$RS2\",\"p_priority\":12,\"p_description\":\"A consequence nothing enforces must be refused by the vocabulary\",\"p_consequence\":\"display_only\",\"p_min_value_level\":4}")
expect_err "$R" 'ENFORCES'
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$EXEC_ID', true);
insert into governance_composite_rules (organization_id, rule_set_id, priority, description, min_value_level, consequence) values ('$ORG','$RS2',99,'client bypass probe',4,'independent_assurance_required');
rollback;")
grep -qi 'authoring RPCs' <<<"$OUT"
R=$(rpc "$EXEC" adopt_governance_rule_set "{\"p_rule_set_id\":\"$RS2\",\"p_note\":\"Adopted v2 with the flagship composite rule for the transcript.\"}")
noerr "$R"
# the armed demand shows on the governance read the panel renders
GOV=$(rpc "$MANAGER" get_case_governance "{\"p_case_id\":\"$CASE_C\"}")
BODY="$GOV" python3 - <<'PYEOF'
import json,os
x=json.loads(os.environ['BODY'])
ars=x.get('adoptedRuleSet') or {}
crs=ars.get('compositeRules') or []
assert len(crs)==1 and crs[0]['consequence']=='independent_assurance_required', crs
assert crs[0]['minValueLevel']==4 and crs[0]['minRiskRating']=='high', crs
bu=x.get('bindingUnmet') or {}
assert len(bu.get('composite_unmet') or [])==1, bu
PYEOF
# act-time: the pass recorded BEFORE adoption cannot carry the case out
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE_C\",\"p_to_stage_key\":\"options_analysis\"}")
expect_err "$R" 'composite authority rule'
# and a NEW pass is refused at the RPC and at the persistence boundary
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_C\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Every mandatory met, but the composite demand is not — must refuse.\",\"p_findings\":$FIND_C}")
expect_err "$R" 'composite authority rule'
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
select set_config('app.gate_review_write','granted',true);
insert into stage_gate_reviews (organization_id, development_case_id, gate_id, stage_key, outcome, reviewed_by, reviewed_at, note)
values ('$ORG','$CASE_C',$G1,'need_identification','proceed','$MANAGER_ID',now(),'bypass attempt: composite arm must stop this');
rollback;")
grep -qi 'Composite authority rule' <<<"$OUT"
# only a COMPLETED, acceptable, INDEPENDENT review satisfies the demand
R=$(rpc "$RE" record_case_evidence "{\"p_case_id\":\"$CASE_C\",\"p_evidence\":{\"evidence_class\":\"DOCUMENTED\",\"description\":\"SMOKE3B independent assurance working papers\",\"source_system\":\"ci-transcript\"}}")
noerr "$R"; EV_C=$(printf '%s' "$R"|field evidence_id)
# §70: the ONE act that RELEASES the demand is human-only. The AI-operator
# identity is refused at the RPC and at the raw write — the demand cannot
# be dissolved by the machine it governs.
R=$(rpc "$AIBOT" record_risk_assurance_review "{\"p_review\":{\"subject_type\":\"development_case\",\"subject_id\":\"$CASE_C\",\"assurance_level\":\"independent\",\"scope\":\"AI release of the composite demand must be refused\",\"status\":\"completed\",\"conclusion\":\"acceptable\",\"evidence_item_ids\":[\"$EV_C\"]}}")
expect_err "$R" 'AI-operator identity cannot record'
OUT=$(sql_must_fail "insert into risk_assurance_reviews (organization_id, subject_type, subject_id, assurance_level, reviewer_id, subject_owner_id, scope, conclusion, status, evidence_item_ids, completed_at) values ('$ORG','development_case','$CASE_C','independent','$AIBOT_ID','$MANAGER_ID','raw ai release of the composite demand must be stopped','acceptable','completed','[]'::jsonb, now());")
grep -qi 'cannot stand as the reviewer' <<<"$OUT"
R=$(rpc "$RE" record_risk_assurance_review "{\"p_review\":{\"subject_type\":\"development_case\",\"subject_id\":\"$CASE_C\",\"assurance_level\":\"independent\",\"scope\":\"Independent assurance of the composite-rule case\",\"status\":\"completed\",\"conclusion\":\"acceptable\",\"evidence_item_ids\":[\"$EV_C\"]}}")
noerr "$R"
R=$(rpc "$MANAGER" record_case_gate_review "{\"p_case_id\":\"$CASE_C\",\"p_gate_id\":$G1,\"p_outcome\":\"proceed\",\"p_note\":\"Composite demand met by the completed independent assurance review.\",\"p_findings\":$FIND_C}")
noerr "$R"; test "$(printf '%s' "$R"|field outcome)" = "proceed"
R=$(rpc "$MANAGER" advance_development_case_stage "{\"p_case_id\":\"$CASE_C\",\"p_to_stage_key\":\"options_analysis\"}")
noerr "$R"
echo '   armed by versioned adoption; a pre-adoption pass cannot carry the case (act-time); refused at RPC + boundary; satisfied ONLY by completed independent assurance; rendered by the governance read'

echo '— 7. ABAC on the one authority store (D3.32) —'
R=$(rpc "$EXEC" create_sub_organization "{\"p_name\":\"SMOKE3B North Site\",\"p_node_level\":\"site\",\"p_parent_node_id\":\"$ORG\"}")
noerr "$R"; NODE=$(printf '%s' "$R"|field node_id); test -n "$NODE"
# Arming: this transcript's scope proofs need the manager's general ladder
# to hold EXACTLY the rows it creates (service posture, like the cleanup).
psqlc "update authority_limits set status='superseded' where organization_id='$ORG' and role_key='maintenance_manager' and action_type='general' and status='adopted';" >/dev/null
L1=$(psqlc "with r as (insert into authority_limits (organization_id, role_key, tier_label, action_type, max_commitment_usd, basis, status, version) values ('$ORG','maintenance_manager','SMOKE3B Site Scope','general',100000,'SMOKE3B node-scoped ladder for the transcript','draft',7001) returning id) select id from r")
R=$(rpc "$EXEC" configure_risk_authority_scope "{\"p_authority_limit_id\":\"$L1\",\"p_scope\":{\"org_node_id\":\"deadbeef-dead-4bad-8bad-deadbeefdead\"}}")
expect_err "$R" 'inside its own tree'
R=$(rpc "$EXEC" configure_risk_authority_scope "{\"p_authority_limit_id\":\"$L1\",\"p_scope\":{\"org_node_id\":\"$NODE\"}}")
noerr "$R"
R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$L1\",\"p_note\":\"SMOKE3B scoped delegation adopted for the transcript.\"}")
noerr "$R"
ASSET=$(psqlc "select id from assets where organization_id='$ORG' limit 1")
test -n "$ASSET"
REC2=$(psqlc "with r as (insert into recommendations (organization_id, title, status, estimated_cost_usd, asset_id, issue, rationale, action, confidence, consequence_summary, alternatives_considered, required_completion_date, required_approver_role, verification_method, impact, urgency) values ('$ORG','SMOKE3B pump overhaul approval probe','pending',5000,'$ASSET','Seal leak rate trending above alarm on the duty pump.','Vibration and seal-pot level trends over 6 weeks.','Overhaul the duty pump seal at the next window.',80,'Production: 4h outage risk if run to failure; no safety consequence identified.','Considered run-to-failure and monthly top-up; both extend exposure.',current_date + 30,'maintenance_manager','Post-overhaul seal-pot level trend over 30 days.','Avoids an unplanned 4h line stop.','action') returning id) select id from r")
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
update recommendations set status='approved' where id='$REC2';
rollback;")
grep -qi 'scoped to one organization node' <<<"$OUT"
# an org-wide limit with a competency requirement supersedes nothing scoped;
# the SCOPE-AWARE selection governs the act by the covering org-wide ladder
# (the site row keeps refusing nothing it does not cover), and the roster
# decides
L2=$(psqlc "with r as (insert into authority_limits (organization_id, role_key, tier_label, action_type, max_commitment_usd, required_competency_keys, basis, status, version) values ('$ORG','maintenance_manager','SMOKE3B Competency Ladder','general',100000,'[\"smoke3b_authority\"]'::jsonb,'SMOKE3B competency-scoped ladder for the transcript','draft',7002) returning id) select id from r")
R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$L2\",\"p_note\":\"SMOKE3B competency delegation adopted for the transcript.\"}")
noerr "$R"
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
update recommendations set status='approved' where id='$REC2';
rollback;")
grep -qi 'competency' <<<"$OUT"
CMP=$(psqlc "with r as (insert into competencies (organization_id, competency_key, title, kind) values ('$ORG','smoke3b_authority','SMOKE3B approval authority','certification') returning id) select id from r")
WM=$(psqlc "with r as (insert into workforce_members (organization_id, employee_ref, display_name, user_id) values ('$ORG','SMOKE3B-MM','SMOKE3B Manager','$MANAGER_ID') returning id) select id from r")
psqlc "insert into member_competencies (organization_id, member_id, competency_id, granted_on, expires_on) values ('$ORG',$WM,$CMP,current_date, current_date + 365);" >/dev/null
psqlc "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
update recommendations set status='approved' where id='$REC2';
commit;" >/dev/null
test "$(psqlc "select status from recommendations where id='$REC2'")" = "approved"
test "$(psqlc "select authority_cleared_by from recommendations where id='$REC2'")" = "$MANAGER_ID"
# THE VERSION RACE, closed: a NEWER adopted row scoped to a non-covering
# node must not shadow the org-wide ladder into blanket refusal — the
# covering ladder governs, whatever the version order.
REC3=$(psqlc "with r as (insert into recommendations (organization_id, title, status, estimated_cost_usd, asset_id, issue, rationale, action, confidence, consequence_summary, alternatives_considered, required_completion_date, required_approver_role, verification_method, impact, urgency) values ('$ORG','SMOKE3B version-race approval probe','pending',5000,'$ASSET','Bearing temperature trending on the standby pump.','Thermography trend over 4 weeks.','Replace the standby pump bearing at the next window.',80,'Production: standby unavailable if run to failure; no safety consequence identified.','Considered run-to-failure; extends exposure.',current_date + 30,'maintenance_manager','Post-replacement thermography trend over 30 days.','Restores standby cover.','action') returning id) select id from r")
L3=$(psqlc "with r as (insert into authority_limits (organization_id, role_key, tier_label, action_type, max_commitment_usd, basis, status, version) values ('$ORG','maintenance_manager','SMOKE3B Newest Site Scope','general',100000,'SMOKE3B newest node-scoped ladder for the version-race probe','draft',7003) returning id) select id from r")
R=$(rpc "$EXEC" configure_risk_authority_scope "{\"p_authority_limit_id\":\"$L3\",\"p_scope\":{\"org_node_id\":\"$NODE\"}}")
noerr "$R"
R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$L3\",\"p_note\":\"SMOKE3B newest scoped delegation adopted for the version-race probe.\"}")
noerr "$R"
psqlc "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
update recommendations set status='approved' where id='$REC3';
commit;" >/dev/null
test "$(psqlc "select status from recommendations where id='$REC3'")" = "approved"
# SUBTREE PERMIT-SIDE, live: a covering node scope (the root itself) is
# SELECTED over the org-wide row and its ceilings BIND — scope is
# enforcement data, not decoration.
REC4=$(psqlc "with r as (insert into recommendations (organization_id, title, status, estimated_cost_usd, asset_id, issue, rationale, action, confidence, consequence_summary, alternatives_considered, required_completion_date, required_approver_role, verification_method, impact, urgency) values ('$ORG','SMOKE3B covering-scope ceiling probe','pending',5000,'$ASSET','Gearbox oil particulate count rising on the apron feeder.','Oil analysis trend over 3 samples.','Flush and refill the apron feeder gearbox.',80,'Production: 2h outage risk if run to failure; no safety consequence identified.','Considered extended sampling; extends exposure.',current_date + 30,'maintenance_manager','Post-flush oil analysis at 30 days.','Avoids an unplanned 2h stop.','action') returning id) select id from r")
L4=$(psqlc "with r as (insert into authority_limits (organization_id, role_key, tier_label, action_type, max_commitment_usd, basis, status, version) values ('$ORG','maintenance_manager','SMOKE3B Root Scope','general',1000,'SMOKE3B root-scoped ladder for the covering-scope probe','draft',7004) returning id) select id from r")
R=$(rpc "$EXEC" configure_risk_authority_scope "{\"p_authority_limit_id\":\"$L4\",\"p_scope\":{\"org_node_id\":\"$ORG\"}}")
noerr "$R"
R=$(rpc "$EXEC" adopt_authority_limit "{\"p_id\":\"$L4\",\"p_note\":\"SMOKE3B root-scoped delegation adopted for the covering-scope probe.\"}")
noerr "$R"
OUT=$(sql_must_fail "begin;
select set_config('request.jwt.claim.sub', '$MANAGER_ID', true);
update recommendations set status='approved' where id='$REC4';
rollback;")
grep -qi 'SMOKE3B Root Scope ceiling' <<<"$OUT"
# A RECORDED SCOPE IS CONSUMED AT EVERY ACT SITE that cites the ladder:
# sanction and waiver decision refuse when their delegation's scope does
# not cover the case's organization — never authority exercised outside
# its recorded scope with the audit row citing that very delegation.
psqlc "update authority_limits set org_node_id='$NODE' where organization_id='$ORG' and role_key='executive' and action_type='sanction' and status='adopted';" >/dev/null
R=$(rpc "$EXEC" sanction_development_case "{\"p_case_id\":\"$CASE_R\",\"p_note\":\"Sanction under a non-covering scoped delegation must be refused.\",\"p_sanctioned_value\":1000}")
expect_err "$R" 'does not cover'
psqlc "update authority_limits set org_node_id=null where organization_id='$ORG' and role_key='executive' and action_type='sanction' and status='adopted';" >/dev/null
psqlc "update authority_limits set org_node_id='$NODE' where organization_id='$ORG' and role_key='executive' and action_type='gate_requirement_waiver' and status='adopted';" >/dev/null
R=$(rpc "$EXEC" decide_gate_requirement_waiver "{\"p_waiver_id\":\"$WVB\",\"p_approve\":true,\"p_note\":\"Waiver decision under a non-covering scoped delegation must be refused.\"}")
expect_err "$R" 'does not cover'
psqlc "update authority_limits set org_node_id=null where organization_id='$ORG' and role_key='executive' and action_type='gate_requirement_waiver' and status='adopted';" >/dev/null
# De-arm this transcript's ladders so interleaved runs of other smokes see
# the state they armed for themselves.
psqlc "update authority_limits set org_node_id=null, status='superseded' where organization_id='$ORG' and basis like 'SMOKE3B%' and status='adopted';" >/dev/null
echo '   outside every adopted subtree refused BY NAME; covering org-wide ladder governs (newest non-covering row cannot shadow it); a covering node scope is selected and its ceiling binds; sanction and waiver decisions refuse under non-covering scopes; competency refused then admitted by the roster'

echo
echo 'Develop slice-3b smoke PASSED: the ledger cannot be rewritten; conditions escalate and close on evidence; the funding question binds at sanction gates; waivers expire loudly and enforcement reverts at every act; all four SoD pairs refuse at the DB; composite authority rules demand independent assurance from data; ABAC scope and competency bind the general approval path.'

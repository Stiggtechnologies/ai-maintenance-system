#!/usr/bin/env bash
# E6.02 / E6.04 / E6.07 — live workforce-governance transcript.
set -euo pipefail
trap 'echo "Workforce-governance smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
RUN_KEY="wfg-$(date +%s)-$$"

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; v=json.loads(os.environ['BODY']).get(os.environ['KEY']); print('' if v is None else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); bad=isinstance(x,dict) and (x.get('answered') is False or x.get('error')); sys.exit(1) if bad else None"; }
expect_refusal(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('refusal') or x.get('error') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected refusal',os.environ['WANT'],'got',x) or sys.exit(1))"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
ENGINEER=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$MANAGER"; test -n "$EXEC"; test -n "$ENGINEER"

# Provision an independent foreign tenant in this transcript. Cross-tenant
# negatives must not pass merely because a second tenant happened not to exist.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
declare
  v_org uuid := 'e6040700-0000-4000-8000-000000000001';
  v_uid uuid := 'e6040700-0000-4000-8000-000000000002';
begin
  insert into organizations(id,name) values(v_org,'E6 workforce foreign tenant')
    on conflict(id) do nothing;
  if not exists(select 1 from auth.users where email='wfg-foreign@syncai.ca') then
    insert into auth.users(
      instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
      confirmation_token,recovery_token,email_change,email_change_token_new,
      email_change_token_current,phone_change,phone_change_token,reauthentication_token
    ) values(
      '00000000-0000-0000-0000-000000000000',v_uid,'authenticated','authenticated',
      'wfg-foreign@syncai.ca',extensions.crypt('Foreign123!@#',extensions.gen_salt('bf')),
      now(),now(),now(),'{"provider":"email","providers":["email"]}',
      '{"full_name":"E6 foreign manager"}','','','','','','','',''
    );
  end if;
  if not exists(select 1 from auth.identities where user_id=v_uid) then
    insert into auth.identities(
      id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at
    ) values(
      gen_random_uuid(),v_uid,v_uid,
      jsonb_build_object('sub',v_uid::text,'email','wfg-foreign@syncai.ca'),
      'email',now(),now(),now()
    );
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values(v_uid,v_org,'wfg-foreign@syncai.ca','E6 foreign manager','maintenance_manager')
  on conflict(id) do update set organization_id=v_org,role='maintenance_manager';
end $seed$;
PSQL
FOREIGN=$(token 'wfg-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGN"

SITE=$(psqlc "select id from sites where organization_id='$ORG' order by created_at,id limit 1")
TODAY=$(psqlc "select current_date::text")
FUTURE=$(psqlc "select (current_date+30)::text")
test -n "$SITE"

COMPETENCY=$(rpc "$MANAGER" record_competency "{\"p_payload\":{\"competencyKey\":\"$RUN_KEY\",\"title\":\"Governed training lifecycle competency\",\"kind\":\"skill\",\"isStatutory\":false}}")
noerr "$COMPETENCY"
COMPETENCY_ID=$(field "$COMPETENCY" competencyId)
MEMBER=$(rpc "$MANAGER" record_workforce_member "{\"p_payload\":{\"employeeRef\":\"$RUN_KEY\",\"displayName\":\"Governance Smoke Technician\",\"craft\":\"Millwright\",\"employmentType\":\"employee\",\"fte\":\"1\",\"siteId\":\"$SITE\"}}")
noerr "$MEMBER"
MEMBER_ID=$(field "$MEMBER" memberId)
test -n "$COMPETENCY_ID"; test -n "$MEMBER_ID"

make_plan(){
  local kind="$1" driver="$2" response
  response=$(rpc "$MANAGER" record_site_training_plan "{\"p_site_id\":\"$SITE\",\"p_member_id\":$MEMBER_ID,\"p_competency_id\":$COMPETENCY_ID,\"p_plan_kind\":\"$kind\",\"p_target_date\":\"$FUTURE\",\"p_driver\":\"$driver\"}")
  BODY="$response" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); sys.exit(0) if x.get('trainingPlanId') and x.get('status')=='planned' else (print(x) or sys.exit(1))"
  field "$response" trainingPlanId
}

# Completion is closed-loop evidence, but it must never create a qualification.
PLAN=$(make_plan requalification 'Renew role training before the scheduled work window')
QUAL_BEFORE=$(psqlc "select count(*) from member_competencies where organization_id='$ORG' and member_id=$MEMBER_ID and competency_id=$COMPETENCY_ID")
STARTED=$(rpc "$MANAGER" transition_training_plan "{\"p_plan_id\":$PLAN,\"p_action\":\"start\",\"p_basis\":\"Instructor confirmed the governed training cohort started.\",\"p_evidence_reference\":null,\"p_replacement_target_date\":null,\"p_replacement_driver\":null,\"p_expected_version\":1}")
noerr "$STARTED"; test "$(field "$STARTED" version)" = '2'
STALE=$(rpc "$MANAGER" transition_training_plan "{\"p_plan_id\":$PLAN,\"p_action\":\"complete\",\"p_basis\":\"A stale operator view must not overwrite a newer lifecycle act.\",\"p_evidence_reference\":\"LMS-STALE\",\"p_replacement_target_date\":null,\"p_replacement_driver\":null,\"p_expected_version\":1}")
expect_refusal "$STALE" 'changed after it was loaded'
COMPLETED=$(rpc "$EXEC" transition_training_plan "{\"p_plan_id\":$PLAN,\"p_action\":\"complete\",\"p_basis\":\"Supervisor reconciled attendance and the delivered assessment record.\",\"p_evidence_reference\":\"LMS-$RUN_KEY\",\"p_replacement_target_date\":null,\"p_replacement_driver\":null,\"p_expected_version\":2}")
noerr "$COMPLETED"
test "$(field "$COMPLETED" status)" = 'complete'
test "$(field "$COMPLETED" competencyGranted)" = 'False'
QUAL_AFTER=$(psqlc "select count(*) from member_competencies where organization_id='$ORG' and member_id=$MEMBER_ID and competency_id=$COMPETENCY_ID")
test "$QUAL_BEFORE" = "$QUAL_AFTER"

CANCEL_PLAN=$(make_plan cross_training 'Cross-training demand was recorded for the next work window')
CANCELLED=$(rpc "$MANAGER" transition_training_plan "{\"p_plan_id\":$CANCEL_PLAN,\"p_action\":\"cancel\",\"p_basis\":\"The approved work scope removed the stated cross-training demand.\",\"p_evidence_reference\":null,\"p_replacement_target_date\":null,\"p_replacement_driver\":null,\"p_expected_version\":1}")
noerr "$CANCELLED"; test "$(field "$CANCELLED" status)" = 'cancelled'

SUPERSEDE_PLAN=$(make_plan succession 'Succession exposure requires a dated governed development plan')
SUPERSEDED=$(rpc "$EXEC" transition_training_plan "{\"p_plan_id\":$SUPERSEDE_PLAN,\"p_action\":\"supersede\",\"p_basis\":\"The approved delivery sequence changed and requires a linked replacement.\",\"p_evidence_reference\":null,\"p_replacement_target_date\":\"$FUTURE\",\"p_replacement_driver\":\"Revised delivery sequence from the approved workforce review\",\"p_expected_version\":1}")
noerr "$SUPERSEDED"
REPLACEMENT=$(field "$SUPERSEDED" replacementPlanId)
test -n "$REPLACEMENT"
test "$(psqlc "select count(*) from training_plans where id=$SUPERSEDE_PLAN and status='superseded' and superseded_by_plan_id=$REPLACEMENT")" = '1'
test "$(psqlc "select count(*) from training_plans where id=$REPLACEMENT and status='planned' and supersedes_plan_id=$SUPERSEDE_PLAN")" = '1'

UNAUTHORIZED=$(rpc "$ENGINEER" transition_training_plan "{\"p_plan_id\":$REPLACEMENT,\"p_action\":\"start\",\"p_basis\":\"An unassigned engineering role cannot operate this training lifecycle.\",\"p_evidence_reference\":null,\"p_replacement_target_date\":null,\"p_replacement_driver\":null,\"p_expected_version\":1}")
expect_refusal "$UNAUTHORIZED" 'human planning, supervisory or governance role'
CROSS_PLAN=$(rpc "$FOREIGN" transition_training_plan "{\"p_plan_id\":$REPLACEMENT,\"p_action\":\"start\",\"p_basis\":\"A foreign organization cannot operate another tenant training plan.\",\"p_evidence_reference\":null,\"p_replacement_target_date\":null,\"p_replacement_driver\":null,\"p_expected_version\":1}")
expect_refusal "$CROSS_PLAN" 'training plan not found'

# Labour limits are immutable drafts until a different authorized person adopts
# them; only the current effective adopted version can reach fatigue analysis.
RULE_KEY="$RUN_KEY-rest"
RULE1=$(rpc "$MANAGER" record_labour_rule "{\"p_payload\":{\"ruleKey\":\"$RULE_KEY\",\"title\":\"Governed minimum rest window\",\"source\":\"labour_agreement\",\"limitKind\":\"min_rest_hours_between_shifts\",\"limitValue\":\"10\",\"basis\":\"The ratified agreement establishes this minimum rest window.\",\"evidenceReference\":\"CBA-$RUN_KEY\",\"effectiveFrom\":\"$TODAY\"}}")
noerr "$RULE1"; RULE1_ID=$(field "$RULE1" labourRuleId)
SELF=$(rpc "$MANAGER" decide_labour_rule "{\"p_rule_id\":$RULE1_ID,\"p_decision\":\"adopt\",\"p_note\":\"The author must not be able to adopt their own drafted rule.\"}")
expect_refusal "$SELF" 'different named human'
ADOPT1=$(rpc "$EXEC" decide_labour_rule "{\"p_rule_id\":$RULE1_ID,\"p_decision\":\"adopt\",\"p_note\":\"Independent agreement review confirms the effective minimum rest window.\"}")
noerr "$ADOPT1"

ROSTER=$(rpc "$MANAGER" get_roster_window '{"p_days":21}')
BODY="$ROSTER" RULE="$RULE_KEY" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert any(r.get('ruleKey')==os.environ['RULE'] for r in x['rules']),x"

RULE2=$(rpc "$MANAGER" record_labour_rule "{\"p_payload\":{\"ruleKey\":\"$RULE_KEY\",\"title\":\"Governed minimum rest window revision\",\"source\":\"labour_agreement\",\"limitKind\":\"min_rest_hours_between_shifts\",\"limitValue\":\"12\",\"basis\":\"The amended agreement increases the governed minimum rest window.\",\"evidenceReference\":\"CBA2-$RUN_KEY\",\"effectiveFrom\":\"$TODAY\"}}")
noerr "$RULE2"; RULE2_ID=$(field "$RULE2" labourRuleId)
ADOPT2=$(rpc "$EXEC" decide_labour_rule "{\"p_rule_id\":$RULE2_ID,\"p_decision\":\"adopt\",\"p_note\":\"Independent review confirms the amended agreement and effective date.\"}")
noerr "$ADOPT2"
test "$(psqlc "select count(*) from labour_rules where id=$RULE1_ID and status='superseded'")" = '1'
test "$(psqlc "select count(*) from labour_rules where id=$RULE2_ID and status='adopted'")" = '1'

LEGACY=$(psqlc "select id from labour_rules where organization_id='$ORG' and status='draft' and recorded_by is null order by id limit 1")
if test -n "$LEGACY"; then
  LEGACY_RESULT=$(rpc "$EXEC" decide_labour_rule "{\"p_rule_id\":$LEGACY,\"p_decision\":\"adopt\",\"p_note\":\"Legacy fixture content cannot become a governing labour rule without evidence.\"}")
  expect_refusal "$LEGACY_RESULT" 'governed draft'
fi

CROSS_RULE=$(rpc "$FOREIGN" decide_labour_rule "{\"p_rule_id\":$RULE2_ID,\"p_decision\":\"retire\",\"p_note\":\"A foreign tenant cannot retire another organization labour rule.\"}")
expect_refusal "$CROSS_RULE" 'labour rule not found'
FOREIGN_WORKSPACE=$(rpc "$FOREIGN" get_workforce_governance_workspace '{}')
BODY="$FOREIGN_WORKSPACE" RID="$RULE2_ID" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('answered') and all(str(r.get('ruleId'))!=os.environ['RID'] for r in x['labourRules']),x"

OUT=$(sql_must_fail "update training_plans set status='complete' where id=$REPLACEMENT;")
grep -qi 'governed named-human workflow' <<<"$OUT"
OUT=$(sql_must_fail "delete from labour_rules where id=$RULE2_ID;")
grep -qi 'cannot be deleted' <<<"$OUT"

RETIRED=$(rpc "$MANAGER" decide_labour_rule "{\"p_rule_id\":$RULE2_ID,\"p_decision\":\"retire\",\"p_note\":\"The governed agreement version was formally withdrawn and replaced.\"}")
noerr "$RETIRED"
ROSTER_AFTER=$(rpc "$MANAGER" get_roster_window '{"p_days":21}')
BODY="$ROSTER_AFTER" RULE="$RULE_KEY" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert all(r.get('ruleKey')!=os.environ['RULE'] for r in x['rules']),x"

WORKSPACE=$(rpc "$MANAGER" get_workforce_governance_workspace '{}')
BODY="$WORKSPACE" PLAN="$PLAN" RULE="$RULE2_ID" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('answered'); assert any(str(p.get('planId'))==os.environ['PLAN'] and p.get('status')=='complete' for p in x['trainingPlans']); assert any(str(r.get('ruleId'))==os.environ['RULE'] and r.get('status')=='retired' for r in x['labourRules'])"

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_workforce_governance_workspace" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='training_plan' and event_data->>'action' in ('start','complete','cancel','supersede')")" -ge 4
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='labour_rule' and event_data->>'action' in ('drafted','adopt','retire')")" -ge 5

echo 'Workforce-governance smoke passed: training=closed-loop competency=separate rules=independently-adopted effective-only=true tenant-wall=true immutable=true'

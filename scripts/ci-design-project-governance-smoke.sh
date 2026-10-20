#!/usr/bin/env bash
# E8.01/E8.03/E8.06/E8.13 — governed reliability-by-design activation.
set -euo pipefail
trap 'echo "Design-project governance smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
FOREIGN_ORG='e8011300-0000-4000-8000-000000000001'
FOREIGN_UID='e8011300-0000-4000-8000-000000000002'
EVIDENCE='e8011300-0000-4000-8000-000000000003'
FOREIGN_EVIDENCE='e8011300-0000-4000-8000-000000000004'
RUN_KEY="design-project-$(date +%s)-$$"

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; v=json.loads(os.environ['BODY']).get(os.environ['KEY']); print('' if v is None else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); bad=isinstance(x,dict) and (x.get('answered') is False or x.get('error')); sys.exit(1) if bad else None"; }
expect_refusal(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('refusal') or x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected refusal',os.environ['WANT'],'got',x) or sys.exit(1))"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
MANAGER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca'")
test -n "$MANAGER"; test -n "$ADMIN"; test -n "$MANAGER_ID"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
begin
  insert into organizations(id,name) values('e8011300-0000-4000-8000-000000000001','E8 design foreign tenant')
    on conflict(id) do nothing;
  if not exists(select 1 from auth.users where email='design-foreign@syncai.ca') then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
      recovery_token,email_change,email_change_token_new,email_change_token_current,
      phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000','e8011300-0000-4000-8000-000000000002',
      'authenticated','authenticated','design-foreign@syncai.ca',
      extensions.crypt('ForeignDesign123!@#',extensions.gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{"full_name":"E8 foreign admin"}',
      '','','','','','','','');
  end if;
  if not exists(select 1 from auth.identities where user_id='e8011300-0000-4000-8000-000000000002') then
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
    values(gen_random_uuid(),'e8011300-0000-4000-8000-000000000002',
      'e8011300-0000-4000-8000-000000000002',
      '{"sub":"e8011300-0000-4000-8000-000000000002","email":"design-foreign@syncai.ca"}',
      'email',now(),now(),now());
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values('e8011300-0000-4000-8000-000000000002','e8011300-0000-4000-8000-000000000001',
    'design-foreign@syncai.ca','E8 foreign admin','admin')
  on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role;
end $seed$;
PSQL
FOREIGN=$(token 'design-foreign@syncai.ca' 'ForeignDesign123!@#')
test -n "$FOREIGN"

CASE=$(psqlc "select dc.id from development_cases dc join development_case_assets ca on ca.development_case_id=dc.id and ca.organization_id=dc.organization_id join capital_projects cp on cp.id=dc.capital_project_id and cp.organization_id=dc.organization_id where dc.organization_id='$ORG' order by dc.created_at,dc.id limit 1")
ASSET=$(psqlc "select asset_id from development_case_assets where organization_id='$ORG' and development_case_id='$CASE' order by asset_id limit 1")
PROJECT=$(psqlc "select capital_project_id from development_cases where id='$CASE'")
test -n "$CASE"; test -n "$ASSET"; test -n "$PROJECT"

psqlc "insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class,source_reference) values('$EVIDENCE','$ORG','ci-design-project','inspection','Verified early-life inspection and corrective design evidence.','INSPECTED','$RUN_KEY') on conflict(id) do nothing; insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class,source_reference) values('$FOREIGN_EVIDENCE','$FOREIGN_ORG','ci-design-project','inspection','Foreign tenant design evidence.','INSPECTED','$RUN_KEY-foreign') on conflict(id) do nothing" >/dev/null
VERIFIED=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent inspection-record and design-package review\",\"p_outcome\":\"verified\",\"p_note\":\"A named reviewer reconciled the observation with the controlled design evidence.\"}")
noerr "$VERIFIED"
FOREIGN_VERIFIED=$(rpc "$FOREIGN" verify_evidence_item "{\"p_evidence_id\":\"$FOREIGN_EVIDENCE\",\"p_method\":\"Independent foreign-tenant record review\",\"p_outcome\":\"verified\",\"p_note\":\"Foreign evidence stays inside its own tenant.\"}")
noerr "$FOREIGN_VERIFIED"

REQ_BODY=$(rpc "$MANAGER" record_case_requirement "{\"p_case_id\":\"$CASE\",\"p_requirement\":{\"requirement_ref\":\"$RUN_KEY-REQ\",\"category\":\"reliability\",\"requirement\":\"The revised equipment design shall prevent recurrence of the observed startup seal failure.\",\"acceptance_criteria\":\"Five representative cold starts without seal leakage.\"}}")
noerr "$REQ_BODY"; REQUIREMENT=$(field "$REQ_BODY" requirement_id); test -n "$REQUIREMENT"

FAILURE_BODY=$(rpc "$MANAGER" record_case_early_life_failure "{\"p_case_id\":\"$CASE\",\"p_asset_id\":\"$ASSET\",\"p_occurred_at\":\"2026-09-15T12:00:00Z\",\"p_months_since_handover\":2,\"p_failure_mode\":\"Startup seal leakage after handover\",\"p_attributed_to\":\"design\",\"p_preventable_by\":\"Revised seal and startup acceptance requirement\",\"p_source_reference\":\"$RUN_KEY-WO\",\"p_evidence_class\":\"INSPECTED\",\"p_assessment_basis\":\"Independent inspection linked the startup leak to the delivered seal arrangement.\"}")
noerr "$FAILURE_BODY"; FAILURE=$(field "$FAILURE_BODY" id); test -n "$FAILURE"
test "$(psqlc "select fed_back_to_design from early_life_failures where id=$FAILURE")" = 'f'

LINK=$(rpc "$MANAGER" link_case_early_life_failure "{\"p_case_id\":\"$CASE\",\"p_failure_id\":$FAILURE,\"p_requirement_id\":$REQUIREMENT,\"p_evidence_item_id\":\"$EVIDENCE\",\"p_basis\":\"The retained inspection evidence ties this observed failure to the corrective design requirement.\"}")
noerr "$LINK"; LINK_ID=$(field "$LINK" linkId); test "$(field "$LINK" eliminationStatus)" = 'feedback_linked'
test "$(psqlc "select fed_back_to_design from early_life_failures where id=$FAILURE")" = 'f'

OPEN_WORKSPACE=$(rpc "$MANAGER" get_case_early_life_feedback_workspace "{\"p_case_id\":\"$CASE\"}")
BODY="$OPEN_WORKSPACE" LINK="$LINK_ID" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('answered'); row=next(v for v in x['links'] if str(v['id'])==os.environ['LINK']); assert row['eliminationStatus']=='feedback_linked' and row['verificationStatus']=='open'"

OBL_BODY=$(rpc "$MANAGER" create_requirement_verification "{\"p_requirement_id\":$REQUIREMENT,\"p_verification\":{\"method_code\":\"test\",\"acceptance_criteria\":\"Five representative cold starts without seal leakage.\"}}")
noerr "$OBL_BODY"; OBLIGATION=$(field "$OBL_BODY" obligation_id); test -n "$OBLIGATION"
RESULT=$(rpc "$ADMIN" record_verification_result "{\"p_obligation_id\":\"$OBLIGATION\",\"p_result\":\"achieved\",\"p_measured_note\":\"Five representative cold starts completed without observed seal leakage.\",\"p_evidence_id\":\"$EVIDENCE\"}")
BODY="$RESULT" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x[0]['outcome']=='recorded'"
test "$(psqlc "select verification_status from design_requirements where id=$REQUIREMENT")" = 'verified'
test "$(psqlc "select fed_back_to_design from early_life_failures where id=$FAILURE")" = 't'

CLOSED_WORKSPACE=$(rpc "$MANAGER" get_case_early_life_feedback_workspace "{\"p_case_id\":\"$CASE\"}")
BODY="$CLOSED_WORKSPACE" LINK="$LINK_ID" python3 -c "import json,os; x=json.loads(os.environ['BODY']); row=next(v for v in x['links'] if str(v['id'])==os.environ['LINK']); assert row['eliminationStatus']=='verified_eliminated' and row['verificationStatus']=='verified'; assert 'Only a linked requirement' in x['boundary']"

CROSS_EVIDENCE=$(rpc "$MANAGER" link_case_early_life_failure "{\"p_case_id\":\"$CASE\",\"p_failure_id\":$FAILURE,\"p_requirement_id\":$REQUIREMENT,\"p_evidence_item_id\":\"$FOREIGN_EVIDENCE\",\"p_basis\":\"A foreign tenant evidence row must not cross the design-feedback wall.\"}")
expect_refusal "$CROSS_EVIDENCE" 'same-tenant independently verified'
FOREIGN_READ=$(rpc "$FOREIGN" get_case_early_life_feedback_workspace "{\"p_case_id\":\"$CASE\"}")
expect_refusal "$FOREIGN_READ" 'development case not found'

OUT=$(sql_must_fail "insert into early_life_failures(organization_id,asset_id,project_id,development_case_id,occurred_at,months_since_handover,failure_mode,attributed_to,fed_back_to_design,recorded_by) values('$ORG','$ASSET',$PROJECT,'$CASE',now(),2,'direct bypass','design',false,'$MANAGER_ID');")
grep -qi 'governed named-human case workflow' <<<"$OUT"
OUT=$(sql_must_fail "update early_life_failures set fed_back_to_design=false where id=$FAILURE;")
grep -qi 'governed named-human requirement link' <<<"$OUT"
OUT=$(sql_must_fail "delete from early_life_failure_requirements where id=$LINK_ID;")
grep -qi 'retained and cannot be deleted' <<<"$OUT"

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_case_early_life_feedback_workspace" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"p_case_id\":\"$CASE\"}")
test "$NOAUTH" = '401'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('early_life_failure','early_life_failure_feedback','requirement_verification_result') and (event_data->>'failure_id'='$FAILURE' or event_data->>'requirement_id'='$REQUIREMENT')")" -ge 3

echo 'Design-project governance smoke passed: named-human observation=true retained-link=true verified-elimination=true direct-write-refused=true tenant-wall=true'

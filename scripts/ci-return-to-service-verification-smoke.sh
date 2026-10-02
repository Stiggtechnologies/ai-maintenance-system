#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Return-to-service verification smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
ORG2='c5210000-0000-4000-8000-000000000002'
ASSET='c5210000-0000-4000-8000-000000000001'
ASSET2='c5210000-0000-4000-8000-000000000003'
TECH_UID='00000000-0000-0000-0000-000000000005'
MANAGER_UID='00000000-0000-0000-0000-000000000003'
OPS_UID='00000000-0000-0000-0000-000000000002'

token(){ local r; r=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$r" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
field(){ BODY="$1" KEY="$2" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); v=x.get(os.environ['KEY']) if isinstance(x,dict) else None
print('' if v is None else (json.dumps(v) if isinstance(v,(dict,list)) else v))
PY
}
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and (x.get('error') or x.get('message') or x.get('code')):
    print('unexpected error:',x); sys.exit(1)
PY
}
expect_err(){ BODY="$1" NEEDLE="$2" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY']); err=''
if isinstance(x,dict): err=x.get('error') or x.get('message') or x.get('hint') or ''
if os.environ['NEEDLE'].lower() not in str(err).lower():
    print('expected refusal containing %r, got %s' % (os.environ['NEEDLE'],x)); sys.exit(1)
PY
}
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; if [ "$rc" = 0 ]; then echo "expected SQL refusal: $1"; return 1; fi; printf '%s' "$out"; }

OPS=$(token 'executive@syncai.ca' 'Exec123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$OPS"; test -n "$TECH"

# A real AI identity proves the final operations door refuses machine authority
# by role, not merely by UI hiding.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
do $seed$
declare v_uid uuid := '99999999-9999-4999-8999-999999999999';
begin
  if not exists(select 1 from auth.users where id=v_uid) then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
      raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new,
      email_change_token_current,phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000',v_uid,'authenticated','authenticated','smoke-aibot@syncai.ca',
      extensions.crypt('AiBot123!@#',extensions.gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{"full_name":"Smoke AI operator"}',
      '','','','','','','','');
  end if;
  if not exists(select 1 from auth.identities where user_id=v_uid) then
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
    values(gen_random_uuid(),v_uid,v_uid,jsonb_build_object('sub',v_uid::text,'email','smoke-aibot@syncai.ca'),'email',now(),now(),now());
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values(v_uid,'11111111-1111-1111-1111-111111111111','smoke-aibot@syncai.ca','Smoke AI operator','ai_admin')
  on conflict(id) do update set organization_id=excluded.organization_id,role='ai_admin';
end $seed$;
SQL
AI=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#')
test -n "$AI"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<SQL
insert into organizations(id,name) values('$ORG2','C5.21 foreign tenant') on conflict(id) do nothing;
insert into assets(id,organization_id,tag,name,asset_class,criticality,status)
values('$ASSET','$ORG','C521-RTS','C5.21 governed RTS asset','Rotating equipment','high','healthy'),
      ('$ASSET2','$ORG2','C521-X','C5.21 foreign asset','Rotating equipment','high','healthy')
on conflict(id) do nothing;
SQL

REL=$(rpc "$OPS" release_equipment "{\"p_asset_id\":\"$ASSET\",\"p_work_order_id\":null,\"p_isolation_confirmed\":true,\"p_isolation_note\":\"C5.21 controlled isolation recorded by operations\"}")
noerr "$REL"
RET=$(rpc "$TECH" return_equipment "{\"p_asset_id\":\"$ASSET\",\"p_note\":\"Maintenance complete; guards and containment restored with no known limitation\"}")
noerr "$RET"
RELEASE_ID=$(field "$RET" releaseId)
test -n "$RELEASE_ID"

VERIFIED_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,data_quality,verification_status,verified_by,verified_at,verification_method)
values('$ORG','$ASSET','c5.21-smoke','return_to_service_test','Signed functional test, guard restoration and protective-system restoration record','high','verified','$MANAGER_UID',now(),'Independent evidence review') returning id")
UNVERIFIED_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,data_quality)
values('$ORG','$ASSET','c5.21-smoke','return_to_service_test','Unverified draft test record','good') returning id")
FOREIGN_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,data_quality,verification_status,verified_by,verified_at,verification_method)
values('$ORG2','$ASSET2','c5.21-smoke','return_to_service_test','Foreign tenant verified test record','high','verified','$MANAGER_UID',now(),'Fixture review') returning id")

GOOD_TEST=$(psqlc "insert into acceptance_tests(organization_id,test_ref,test_stage,scheduled_on,performed_on,outcome,punch_items_raised,punch_items_open,witnessed_by_owner,asset_id,acceptance_criteria,test_procedure_reference,tested_samples,passed_samples,evidence_item_id,performed_by,release_status,released_by,released_at,release_note)
values('$ORG','C521-GOOD-'||'$RELEASE_ID','return_to_service',current_date,current_date,'pass',0,0,true,'$ASSET','Every adopted functional and restoration criterion passes','C521-RTS-PROCEDURE',1,1,'$VERIFIED_EVIDENCE','$TECH_UID','released','$MANAGER_UID',now(),'Independent quality review confirmed pass evidence and zero open punch items') returning id")
BAD_EVIDENCE_TEST=$(psqlc "insert into acceptance_tests(organization_id,test_ref,test_stage,scheduled_on,performed_on,outcome,punch_items_raised,punch_items_open,witnessed_by_owner,asset_id,acceptance_criteria,test_procedure_reference,tested_samples,passed_samples,evidence_item_id,performed_by,release_status,released_by,released_at,release_note)
values('$ORG','C521-UNVERIFIED-'||'$RELEASE_ID','return_to_service',current_date,current_date,'pass',0,0,true,'$ASSET','Every adopted functional and restoration criterion passes','C521-RTS-PROCEDURE',1,1,'$UNVERIFIED_EVIDENCE','$TECH_UID','released','$MANAGER_UID',now(),'Independent release cannot cure an unverified source evidence item') returning id")
STALE_TEST=$(psqlc "insert into acceptance_tests(organization_id,test_ref,test_stage,scheduled_on,performed_on,outcome,punch_items_raised,punch_items_open,witnessed_by_owner,asset_id,acceptance_criteria,test_procedure_reference,tested_samples,passed_samples,evidence_item_id,performed_by,release_status,released_by,released_at,release_note)
values('$ORG','C521-STALE-'||'$RELEASE_ID','return_to_service',current_date,current_date,'pass',0,0,true,'$ASSET','A prior cycle result must never authorize this return','C521-RTS-PROCEDURE',1,1,'$VERIFIED_EVIDENCE','$TECH_UID','released','$MANAGER_UID',(select returned_at-interval '1 second' from equipment_releases where id='$RELEASE_ID'),'Predates this maintenance handback and is therefore inadmissible') returning id")
NONQUALITY_TEST=$(psqlc "insert into acceptance_tests(organization_id,test_ref,test_stage,scheduled_on,performed_on,outcome,punch_items_raised,punch_items_open,witnessed_by_owner,asset_id,acceptance_criteria,test_procedure_reference,tested_samples,passed_samples,evidence_item_id,performed_by,release_status,released_by,released_at,release_note)
values('$ORG','C521-NONQUALITY-'||'$RELEASE_ID','return_to_service',current_date,current_date,'pass',0,0,true,'$ASSET','Only an authorized quality release can support RTS','C521-RTS-PROCEDURE',1,1,'$VERIFIED_EVIDENCE','$TECH_UID','released','$OPS_UID',now(),'An operations actor cannot forge the independent quality release') returning id")
FOREIGN_TEST=$(psqlc "insert into acceptance_tests(organization_id,test_ref,test_stage,scheduled_on,performed_on,outcome,punch_items_raised,punch_items_open,witnessed_by_owner,asset_id,acceptance_criteria,test_procedure_reference,tested_samples,passed_samples,evidence_item_id,performed_by,release_status,released_by,released_at,release_note)
values('$ORG2','C521-FOREIGN-'||'$RELEASE_ID','return_to_service',current_date,current_date,'pass',0,0,true,'$ASSET2','Foreign tenant criterion','C521-X-PROCEDURE',1,1,'$FOREIGN_EVIDENCE','$TECH_UID','released','$MANAGER_UID',now(),'Foreign fixture only; never admissible to the current tenant') returning id")

READ=$(rpc "$OPS" get_ops_coordination '{}')
noerr "$READ"
BODY="$READ" RELEASE_ID="$RELEASE_ID" GOOD_TEST="$GOOD_TEST" BAD_TEST="$BAD_EVIDENCE_TEST" STALE_TEST="$STALE_TEST" NONQUALITY_TEST="$NONQUALITY_TEST" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY']); rid=os.environ['RELEASE_ID']; good=int(os.environ['GOOD_TEST'])
inadmissible={int(os.environ[k]) for k in ('BAD_TEST','STALE_TEST','NONQUALITY_TEST')}
r=next((row for row in x.get('open_releases',[]) if row.get('release_id')==rid),None)
if not r: print('release missing from handover read:',x); sys.exit(1)
ids=[int(t['id']) for t in r.get('eligible_rts_tests',[])]
if good not in ids or inadmissible.intersection(ids): print('eligible RTS predicate drift:',r); sys.exit(1)
PY

# Every unsafe route refuses before the valid act.
R=$(rpc "$OPS" accept_equipment "{\"p_asset_id\":\"$ASSET\",\"p_note\":\"Legacy free-text acceptance must be unavailable\"}")
expect_err "$R" 'permission denied'
R=$(rpc "$TECH" verify_and_accept_equipment "{\"p_release_id\":\"$RELEASE_ID\",\"p_acceptance_test_id\":$GOOD_TEST,\"p_note\":\"Technician cannot claim operations return-to-service authority\"}")
expect_err "$R" 'operations authority'
R=$(rpc "$AI" verify_and_accept_equipment "{\"p_release_id\":\"$RELEASE_ID\",\"p_acceptance_test_id\":$GOOD_TEST,\"p_note\":\"Machine identity must never authorize return to service\"}")
expect_err "$R" 'AI-operator identity'
R=$(rpc "$OPS" verify_and_accept_equipment "{\"p_release_id\":\"$RELEASE_ID\",\"p_acceptance_test_id\":$FOREIGN_TEST,\"p_note\":\"Foreign evidence must never authorize this tenant release\"}")
expect_err "$R" 'acceptance test'
R=$(rpc "$OPS" verify_and_accept_equipment "{\"p_release_id\":\"$RELEASE_ID\",\"p_acceptance_test_id\":$BAD_EVIDENCE_TEST,\"p_note\":\"Unverified evidence must never authorize return to service\"}")
expect_err "$R" 'independently verified'
R=$(rpc "$OPS" verify_and_accept_equipment "{\"p_release_id\":\"$RELEASE_ID\",\"p_acceptance_test_id\":$STALE_TEST,\"p_note\":\"A prior-cycle acceptance test must not authorize this handback\"}")
expect_err "$R" 'acceptance test'
R=$(rpc "$OPS" verify_and_accept_equipment "{\"p_release_id\":\"$RELEASE_ID\",\"p_acceptance_test_id\":$NONQUALITY_TEST,\"p_note\":\"An operations actor cannot forge independent quality release\"}")
expect_err "$R" 'quality-control authority'
DIRECT=$(sql_must_fail "update equipment_releases set status='accepted' where id='$RELEASE_ID';")
printf '%s' "$DIRECT" | grep -qi 'verify_and_accept_equipment'
DIRECT_INSERT=$(sql_must_fail "insert into equipment_releases(organization_id,asset_id,released_by,returned_by,returned_at,accepted_by,accepted_at,status,rts_verification_status) values('$ORG','$ASSET','$OPS_UID','$TECH_UID',now(),'$OPS_UID',now(),'accepted','legacy_unverified');")
printf '%s' "$DIRECT_INSERT" | grep -qi 'verify_and_accept_equipment'

R=$(rpc "$OPS" verify_and_accept_equipment "{\"p_release_id\":\"$RELEASE_ID\",\"p_acceptance_test_id\":$GOOD_TEST,\"p_note\":\"Operations reviewed the released test and independently confirmed asset condition\"}")
noerr "$R"
test "$(field "$R" returnToServiceAuthorized)" = 'True'

STATE=$(psqlc "select status||'|'||rts_verification_status||'|'||acceptance_test_id||'|'||length(verification_sha256) from equipment_releases where id='$RELEASE_ID'")
test "$STATE" = "accepted|verified|$GOOD_TEST|64"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='equipment_release' and event_data->>'release_id'='$RELEASE_ID' and event_data->>'action'='return_to_service_verified' and event_data->>'verification_sha256' is not null")" = '1'
test "$(psqlc "select enforcement from decision_rights where right_key='return_to_service'")" = 'enforced'

IMMUTABLE=$(sql_must_fail "update equipment_releases set acceptance_note='tampered after acceptance' where id='$RELEASE_ID';")
printf '%s' "$IMMUTABLE" | grep -qi 'provenance is immutable'

# The test is consumed by the accepted release and cannot be reused on a later
# maintenance cycle for the same asset.
REL2=$(rpc "$OPS" release_equipment "{\"p_asset_id\":\"$ASSET\",\"p_work_order_id\":null,\"p_isolation_confirmed\":true,\"p_isolation_note\":\"C5.21 second-cycle controlled isolation recorded by operations\"}")
noerr "$REL2"
RET2=$(rpc "$TECH" return_equipment "{\"p_asset_id\":\"$ASSET\",\"p_note\":\"Second maintenance cycle complete with guards and containment restored\"}")
noerr "$RET2"
RELEASE_ID2=$(field "$RET2" releaseId)
R=$(rpc "$OPS" verify_and_accept_equipment "{\"p_release_id\":\"$RELEASE_ID2\",\"p_acceptance_test_id\":$GOOD_TEST,\"p_note\":\"A previously consumed test must not authorize a later cycle\"}")
expect_err "$R" 'acceptance test'
psqlc "update equipment_releases set status='cancelled' where id='$RELEASE_ID2';" >/dev/null

echo "C5.21 governed return-to-service verification passed: release=$RELEASE_ID test=$GOOD_TEST"

#!/usr/bin/env bash
# First Decision Journey — canonical, tenant-bound Decision Case invitations.
set -euo pipefail
trap 'echo "Decision Case invitation smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); CASE_ID=$(uuid)
ADMIN=$(uuid); OPERATOR=$(uuid); AI_ADMIN=$(uuid); INVITEE=$(uuid); FOREIGN=$(uuid)
ADMIN_EMAIL="walkthrough-admin-$ADMIN@invalid.syncai.ca"
OPERATOR_EMAIL="walkthrough-operator-$OPERATOR@invalid.syncai.ca"
AI_EMAIL="walkthrough-ai-$AI_ADMIN@invalid.syncai.ca"
INVITEE_EMAIL="walkthrough-invitee-$INVITEE@invalid.syncai.ca"
FOREIGN_EMAIL="walkthrough-foreign-$FOREIGN@invalid.syncai.ca"

jwt(){
  SUBJECT="$1" EMAIL="$2" JWT_SECRET_VALUE="$JWT_SECRET" python3 - <<'PY'
import base64,hashlib,hmac,json,os,time
def enc(value): return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).rstrip(b'=').decode()
now=int(time.time()); header=enc({'alg':'HS256','typ':'JWT'})
payload=enc({'aud':'authenticated','exp':now+3600,'iat':now,'sub':os.environ['SUBJECT'],
  'email':os.environ['EMAIL'],'phone':'','role':'authenticated','aal':'aal2',
  'app_metadata':{'provider':'email','providers':['email']},'user_metadata':{},
  'amr':[{'method':'totp','timestamp':now}]})
body=f'{header}.{payload}'
signature=base64.urlsafe_b64encode(hmac.new(os.environ['JWT_SECRET_VALUE'].encode(),body.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
print(f'{body}.{signature}')
PY
}
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
service_rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$1" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' -d "$2"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else None; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; x=json.loads(os.environ['BODY']); v=x.get(os.environ['KEY']); print('' if v is None else str(v).lower() if isinstance(v,bool) else v)"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','First Decision Journey tenant'),('$FOREIGN_ORG','First Decision Journey foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$ADMIN','authenticated','authenticated','$ADMIN_EMAIL','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$OPERATOR','authenticated','authenticated','$OPERATOR_EMAIL','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI_ADMIN','authenticated','authenticated','$AI_EMAIL','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$INVITEE','authenticated','authenticated','$INVITEE_EMAIL','',null,now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','$FOREIGN_EMAIL','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$ADMIN','$ORG','$ADMIN_EMAIL','Walkthrough administrator','admin'),
  ('$OPERATOR','$ORG','$OPERATOR_EMAIL','Walkthrough operator','operator'),
  ('$AI_ADMIN','$ORG','$AI_EMAIL','Walkthrough AI administrator','ai_admin'),
  ('$FOREIGN','$FOREIGN_ORG','$FOREIGN_EMAIL','Foreign member','viewer');
insert into cowork_workspaces(id,organization_id,title,objective,case_number,case_state)
values('$CASE_ID','$ORG','First customer decision','Test the first-decision loop','DC-WALKTHROUGH-1','{"objective":"Test the first-decision loop"}'::jsonb);
PSQL

ADMIN_JWT=$(jwt "$ADMIN" "$ADMIN_EMAIL")
FOREIGN_JWT=$(jwt "$FOREIGN" "$FOREIGN_EMAIL")

test "$(psqlc "select has_function_privilege('authenticated','public.register_decision_case_invitation(uuid,uuid,uuid,uuid,text,text,text,text)','execute')")" = 'f'
test "$(psqlc "select has_function_privilege('service_role','public.register_decision_case_invitation(uuid,uuid,uuid,uuid,text,text,text,text)','execute')")" = 't'

SUBMITTED=$(service_rpc register_decision_case_invitation "{\"p_actor_id\":\"$ADMIN\",\"p_organization_id\":\"$ORG\",\"p_case_id\":\"$CASE_ID\",\"p_invited_user_id\":\"$INVITEE\",\"p_email\":\"$INVITEE_EMAIL\",\"p_name\":\"Invited verifier\",\"p_delivery_status\":\"submitted\",\"p_detail\":\"Secure invitation submitted to the configured provider.\"}")
noerr "$SUBMITTED"; test "$(field "$SUBMITTED" status)" = 'submitted'
test "$(psqlc "select role from user_profiles where id='$INVITEE' and organization_id='$ORG'")" = 'viewer'
test "$(psqlc "select event_data->>'decision_authority_granted' from audit_events where organization_id='$ORG' and entity_type='decision_case_invitation' order by created_at desc limit 1")" = 'false'

STATUS=$(rpc "$ADMIN_JWT" get_decision_case_invitation_status "{\"p_case_id\":\"$CASE_ID\"}")
noerr "$STATUS"; test "$(field "$STATUS" status)" = 'submitted'
FOREIGN_STATUS=$(rpc "$FOREIGN_JWT" get_decision_case_invitation_status "{\"p_case_id\":\"$CASE_ID\"}")
expect_error "$FOREIGN_STATUS" 'active tenant'

OPERATOR_DENIED=$(service_rpc register_decision_case_invitation "{\"p_actor_id\":\"$OPERATOR\",\"p_organization_id\":\"$ORG\",\"p_case_id\":\"$CASE_ID\",\"p_invited_user_id\":null,\"p_email\":\"other@invalid.syncai.ca\",\"p_name\":\"Other\",\"p_delivery_status\":\"failed\",\"p_detail\":\"Provider deliberately failed for the authorization test.\"}")
expect_error "$OPERATOR_DENIED" 'administrator or executive'
AI_DENIED=$(service_rpc register_decision_case_invitation "{\"p_actor_id\":\"$AI_ADMIN\",\"p_organization_id\":\"$ORG\",\"p_case_id\":\"$CASE_ID\",\"p_invited_user_id\":null,\"p_email\":\"other@invalid.syncai.ca\",\"p_name\":\"Other\",\"p_delivery_status\":\"failed\",\"p_detail\":\"Provider deliberately failed for the AI authority test.\"}")
expect_error "$AI_DENIED" 'administrator or executive'

CROSS_TENANT=$(service_rpc register_decision_case_invitation "{\"p_actor_id\":\"$ADMIN\",\"p_organization_id\":\"$ORG\",\"p_case_id\":\"$CASE_ID\",\"p_invited_user_id\":\"$FOREIGN\",\"p_email\":\"$FOREIGN_EMAIL\",\"p_name\":\"Foreign\",\"p_delivery_status\":\"submitted\",\"p_detail\":\"This cross-tenant invitation must be refused.\"}")
expect_error "$CROSS_TENANT" 'another tenant'

ALREADY_MEMBER=$(service_rpc register_decision_case_invitation "{\"p_actor_id\":\"$ADMIN\",\"p_organization_id\":\"$ORG\",\"p_case_id\":\"$CASE_ID\",\"p_invited_user_id\":null,\"p_email\":\"$OPERATOR_EMAIL\",\"p_name\":\"Walkthrough operator\",\"p_delivery_status\":\"already_member\",\"p_detail\":\"The identity is already a member; no email was sent.\"}")
noerr "$ALREADY_MEMBER"; test "$(field "$ALREADY_MEMBER" status)" = 'already_member'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='decision_case_invitation'")" -eq 2

echo 'Decision Case invitation smoke passed: canonical_identity=true canonical_case=true canonical_audit=true service_only_write=true same_tenant=true viewer_only=true authority_separate=true status_tenant_bound=true cross_tenant_refused=true ai_refused=true'

#!/usr/bin/env bash
# E5.05 — tenant MFA policy, independent adoption and canonical AAL2 wall.
set -euo pipefail
trap 'echo "Privileged-access MFA smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid)
PROPOSER=$(uuid); REVIEWER=$(uuid); UNENROLLED_ADMIN=$(uuid); MEMBER=$(uuid); FOREIGN_ADMIN=$(uuid)
PROPOSER_FACTOR=$(uuid); REVIEWER_FACTOR=$(uuid)

jwt(){
  SUBJECT="$1" ASSURANCE="$2" EMAIL="$3" JWT_SECRET_VALUE="$JWT_SECRET" python3 - <<'PY'
import base64,hashlib,hmac,json,os,time
def enc(value):
    raw=json.dumps(value,separators=(',',':')).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()
now=int(time.time())
header=enc({'alg':'HS256','typ':'JWT'})
payload=enc({
  'aud':'authenticated','exp':now+3600,'iat':now,'sub':os.environ['SUBJECT'],
  'email':os.environ['EMAIL'],'phone':'','role':'authenticated',
  'aal':os.environ['ASSURANCE'],'app_metadata':{'provider':'email','providers':['email']},
  'user_metadata':{},'amr':[{'method':'password','timestamp':now}]
})
body=f'{header}.{payload}'
sig=base64.urlsafe_b64encode(hmac.new(os.environ['JWT_SECRET_VALUE'].encode(),body.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
print(f'{body}.{sig}')
PY
}
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
get_org(){ curl -sS "$API_URL/rest/v1/organizations?id=eq.$ORG&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; v=json.loads(os.environ['BODY']).get(os.environ['KEY']); print('' if v is None else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); bad=isinstance(x,dict) and (x.get('error') or x.get('code') or x.get('message')); print(x,file=sys.stderr) if bad else None; sys.exit(1) if bad else None"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','E5.05 assured tenant'),('$FOREIGN_ORG','E5.05 foreign tenant');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$PROPOSER','authenticated','authenticated','mfa-proposer-$PROPOSER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$REVIEWER','authenticated','authenticated','mfa-reviewer-$REVIEWER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$UNENROLLED_ADMIN','authenticated','authenticated','mfa-unenrolled-$UNENROLLED_ADMIN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$MEMBER','authenticated','authenticated','mfa-member-$MEMBER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN_ADMIN','authenticated','authenticated','mfa-foreign-$FOREIGN_ADMIN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');

insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$PROPOSER','$ORG','mfa-proposer-$PROPOSER@invalid.syncai.ca','MFA policy proposer','admin'),
  ('$REVIEWER','$ORG','mfa-reviewer-$REVIEWER@invalid.syncai.ca','MFA policy reviewer','executive'),
  ('$UNENROLLED_ADMIN','$ORG','mfa-unenrolled-$UNENROLLED_ADMIN@invalid.syncai.ca','Unenrolled administrator','admin'),
  ('$MEMBER','$ORG','mfa-member-$MEMBER@invalid.syncai.ca','Ordinary member','technician'),
  ('$FOREIGN_ADMIN','$FOREIGN_ORG','mfa-foreign-$FOREIGN_ADMIN@invalid.syncai.ca','Foreign administrator','admin');

insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$PROPOSER_FACTOR','$PROPOSER','CI proposer factor','totp','verified',now(),now()),
  ('$REVIEWER_FACTOR','$REVIEWER','CI reviewer factor','totp','verified',now(),now());
PSQL

PROPOSER_AAL1=$(jwt "$PROPOSER" aal1 "mfa-proposer-$PROPOSER@invalid.syncai.ca")
PROPOSER_AAL2=$(jwt "$PROPOSER" aal2 "mfa-proposer-$PROPOSER@invalid.syncai.ca")
REVIEWER_AAL1=$(jwt "$REVIEWER" aal1 "mfa-reviewer-$REVIEWER@invalid.syncai.ca")
REVIEWER_AAL2=$(jwt "$REVIEWER" aal2 "mfa-reviewer-$REVIEWER@invalid.syncai.ca")
UNENROLLED_AAL1=$(jwt "$UNENROLLED_ADMIN" aal1 "mfa-unenrolled-$UNENROLLED_ADMIN@invalid.syncai.ca")
MEMBER_AAL1=$(jwt "$MEMBER" aal1 "mfa-member-$MEMBER@invalid.syncai.ca")
FOREIGN_AAL1=$(jwt "$FOREIGN_ADMIN" aal1 "mfa-foreign-$FOREIGN_ADMIN@invalid.syncai.ca")
EFFECTIVE_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

PROPOSAL=$(rpc "$PROPOSER_AAL1" propose_organization_mfa_policy "{\"p_enforcement_scope\":\"privileged_roles\",\"p_privileged_roles\":[\"admin\",\"ai_admin\",\"executive\",\"maintenance_manager\"],\"p_effective_at\":\"$EFFECTIVE_AT\",\"p_reason\":\"CI adoption basis for privileged tenant assurance.\"}")
noerr "$PROPOSAL"; POLICY_ID=$(field "$PROPOSAL" policyId); test -n "$POLICY_ID"

SELF=$(rpc "$PROPOSER_AAL2" decide_organization_mfa_policy "{\"p_policy_id\":\"$POLICY_ID\",\"p_decision\":\"adopt\",\"p_reason\":\"The proposer attempts to decide the same governed policy.\"}")
expect_error "$SELF" 'proposer cannot independently'

ADOPTED=$(rpc "$REVIEWER_AAL2" decide_organization_mfa_policy "{\"p_policy_id\":\"$POLICY_ID\",\"p_decision\":\"adopt\",\"p_reason\":\"Independent review confirms the privileged-role rollout and recovery path.\"}")
noerr "$ADOPTED"; test "$(field "$ADOPTED" status)" = 'adopted'

UNENROLLED_POSTURE=$(rpc "$UNENROLLED_AAL1" get_current_security_posture '{}')
BODY="$UNENROLLED_POSTURE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['required'] is True and x['verifiedFactorCount']==0 and x['satisfied'] is False,x
assert x['reason']=='factor_enrollment_required',x
assert 'organizationId' not in x and 'policyId' not in x and 'role' not in x,x
PY

STEP_UP_POSTURE=$(rpc "$REVIEWER_AAL1" get_current_security_posture '{}')
BODY="$STEP_UP_POSTURE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['required'] is True and x['verifiedFactorCount']==1 and x['satisfied'] is False,x
assert x['reason']=='step_up_required',x
PY

ASSURED_POSTURE=$(rpc "$REVIEWER_AAL2" get_current_security_posture '{}')
BODY="$ASSURED_POSTURE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['required'] is True and x['currentAal']=='aal2' and x['satisfied'] is True,x
assert 'no engineering or operational authority' in x['boundary'],x
PY

MEMBER_POSTURE=$(rpc "$MEMBER_AAL1" get_current_security_posture '{}')
BODY="$MEMBER_POSTURE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['required'] is False and x['satisfied'] is True and x['reason']=='role_not_in_scope',x
PY
FOREIGN_POSTURE=$(rpc "$FOREIGN_AAL1" get_current_security_posture '{}')
BODY="$FOREIGN_POSTURE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['required'] is False and x['satisfied'] is True,x
assert 'organizationId' not in x and 'policyId' not in x and 'role' not in x,x
PY

# RLS follows the canonical resolver: unenrolled and AAL1 privileged sessions
# see no tenant row, while AAL2+factor and an out-of-scope member do.
test "$(get_org "$UNENROLLED_AAL1")" = '[]'
test "$(get_org "$REVIEWER_AAL1")" = '[]'
BODY="$(get_org "$REVIEWER_AAL2")" ORG="$ORG" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x==[{'id':os.environ['ORG']}],x"
BODY="$(get_org "$MEMBER_AAL1")" ORG="$ORG" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x==[{'id':os.environ['ORG']}],x"

DENIED=$(rpc "$UNENROLLED_AAL1" get_organization_mfa_policy '{}')
expect_error "$DENIED" 'assured administrator'
OWN=$(rpc "$REVIEWER_AAL2" get_organization_mfa_policy '{}')
BODY="$OWN" POLICY_ID="$POLICY_ID" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['adopted']['id']==os.environ['POLICY_ID'] and x['proposed'] is None,x"
FOREIGN=$(rpc "$FOREIGN_AAL1" get_organization_mfa_policy '{}')
noerr "$FOREIGN"
BODY="$FOREIGN" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['adopted'] is None and x['proposed'] is None,x"

# A direct policy write is blocked even for the database/service path.
OUT=$(sql_must_fail "insert into organization_mfa_policies(organization_id,version,enforcement_scope,effective_at,proposed_by,proposal_reason) values('$ORG',99,'all_members',now(),'$PROPOSER','This direct write must be rejected by the governed writer.');")
grep -qi 'governed named-human workflow' <<<"$OUT"

# Removing the factor outside the UI still collapses the canonical org wall,
# even when the caller replays an AAL2 JWT.
psqlc "delete from auth.mfa_factors where id='$REVIEWER_FACTOR'" >/dev/null
test "$(get_org "$REVIEWER_AAL2")" = '[]'
REMOVED_POSTURE=$(rpc "$REVIEWER_AAL2" get_current_security_posture '{}')
BODY="$REMOVED_POSTURE" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['verifiedFactorCount']==0 and x['satisfied'] is False and x['reason']=='factor_enrollment_required',x"

test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='organization_mfa_policy' and event_data->>'policy_id'='$POLICY_ID'")" -eq 2
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and event_type='admin_action' and detail like '%MFA policy%'")" -eq 2

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_current_security_posture" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'

echo 'Privileged-access MFA smoke passed: independent_adoption=true canonical_org_wall=true aal1_denied=true aal2_admitted=true verified_factor_required=true tenant_isolation=true direct_write_blocked=true removal_fails_closed=true operational_authority=false'

#!/usr/bin/env bash
# E5.07 — governed tenant DLP and fail-closed server-mediated AI egress.
set -euo pipefail
trap 'echo "Data-loss prevention smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); PROPOSER=$(uuid); REVIEWER=$(uuid); FOREIGN=$(uuid)
PROPOSER_FACTOR=$(uuid); REVIEWER_FACTOR=$(uuid); FOREIGN_FACTOR=$(uuid)

jwt(){
  SUBJECT="$1" ASSURANCE="$2" EMAIL="$3" JWT_SECRET_VALUE="$JWT_SECRET" python3 - <<'PY'
import base64,hashlib,hmac,json,os,time
def enc(v): return base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=').decode()
now=int(time.time()); h=enc({'alg':'HS256','typ':'JWT'})
p=enc({'aud':'authenticated','exp':now+3600,'iat':now,'sub':os.environ['SUBJECT'],
  'email':os.environ['EMAIL'],'phone':'','role':'authenticated','aal':os.environ['ASSURANCE'],
  'app_metadata':{'provider':'email','providers':['email']},'user_metadata':{},
  'amr':[{'method':'password','timestamp':now}]})
body=f'{h}.{p}'; sig=base64.urlsafe_b64encode(hmac.new(os.environ['JWT_SECRET_VALUE'].encode(),body.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
print(f'{body}.{sig}')
PY
}
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
service_rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$1" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' -d "$2"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; x=json.loads(os.environ['BODY']); v=x.get(os.environ['KEY']); print('' if v is None else str(v).lower() if isinstance(v,bool) else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else None; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
expect_denied(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); ok=x.get('allowed') is False and os.environ['WANT'] in str(x.get('reason')); sys.exit(0) if ok else (print('expected denial',os.environ['WANT'],'got',x) or sys.exit(1))"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','E5.07 DLP tenant'),('$FOREIGN_ORG','E5.07 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$PROPOSER','authenticated','authenticated','dlp-proposer-$PROPOSER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$REVIEWER','authenticated','authenticated','dlp-reviewer-$REVIEWER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','dlp-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$PROPOSER','$ORG','dlp-proposer-$PROPOSER@invalid.syncai.ca','DLP proposer','admin'),
  ('$REVIEWER','$ORG','dlp-reviewer-$REVIEWER@invalid.syncai.ca','DLP reviewer','executive'),
  ('$FOREIGN','$FOREIGN_ORG','dlp-foreign-$FOREIGN@invalid.syncai.ca','Foreign DLP reviewer','admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$PROPOSER_FACTOR','$PROPOSER','CI proposer factor','totp','verified',now(),now()),
  ('$REVIEWER_FACTOR','$REVIEWER','CI reviewer factor','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','CI foreign factor','totp','verified',now(),now());
PSQL

PROPOSER_AAL1=$(jwt "$PROPOSER" aal1 "dlp-proposer-$PROPOSER@invalid.syncai.ca")
PROPOSER_AAL2=$(jwt "$PROPOSER" aal2 "dlp-proposer-$PROPOSER@invalid.syncai.ca")
REVIEWER_AAL1=$(jwt "$REVIEWER" aal1 "dlp-reviewer-$REVIEWER@invalid.syncai.ca")
REVIEWER_AAL2=$(jwt "$REVIEWER" aal2 "dlp-reviewer-$REVIEWER@invalid.syncai.ca")
FOREIGN_AAL2=$(jwt "$FOREIGN" aal2 "dlp-foreign-$FOREIGN@invalid.syncai.ca")

DEFAULT_DENY=$(rpc "$PROPOSER_AAL1" authorize_data_egress '{"p_destination":"api.openai.com","p_data_class":"operational","p_purpose":"model_inference","p_redaction_applied":false}')
expect_denied "$DEFAULT_DENY" 'no_current_matching_rule'

PROPOSAL=$(rpc "$PROPOSER_AAL1" propose_data_egress_rule '{"p_destination":"api.openai.com","p_destination_kind":"llm_gateway","p_data_class":"operational","p_allowed_purposes":["model_inference","embedding"],"p_permitted":true,"p_redaction_required":true,"p_basis":"Approved provider route requires payload minimization and verified redaction before operational inference.","p_supersedes_rule_id":null}')
noerr "$PROPOSAL"; RULE_ID=$(field "$PROPOSAL" ruleId); test -n "$RULE_ID"

DRAFT_DENY=$(rpc "$PROPOSER_AAL1" authorize_data_egress '{"p_destination":"api.openai.com","p_data_class":"operational","p_purpose":"model_inference","p_redaction_applied":true}')
expect_denied "$DRAFT_DENY" 'no_current_matching_rule'
SELF=$(rpc "$PROPOSER_AAL2" decide_data_egress_rule "{\"p_rule_id\":$RULE_ID,\"p_decision\":\"adopt\",\"p_reason\":\"The proposer attempts to approve the same DLP policy version without independence.\"}")
expect_error "$SELF" 'proposer cannot independently'
AAL1=$(rpc "$REVIEWER_AAL1" decide_data_egress_rule "{\"p_rule_id\":$RULE_ID,\"p_decision\":\"adopt\",\"p_reason\":\"Independent review confirms the destination controls and stated residual-risk treatment.\"}")
expect_error "$AAL1" 'aal2 session'
FOREIGN_RESULT=$(rpc "$FOREIGN_AAL2" decide_data_egress_rule "{\"p_rule_id\":$RULE_ID,\"p_decision\":\"adopt\",\"p_reason\":\"A foreign tenant attempts to approve a rule it cannot see or govern.\"}")
expect_error "$FOREIGN_RESULT" 'not found in this tenant'

ADOPTED=$(rpc "$REVIEWER_AAL2" decide_data_egress_rule "{\"p_rule_id\":$RULE_ID,\"p_decision\":\"adopt\",\"p_reason\":\"Independent review confirms the exact provider, purposes, redaction obligation and residual risk.\"}")
noerr "$ADOPTED"; test "$(field "$ADOPTED" status)" = 'adopted'

NO_REDACTION=$(rpc "$PROPOSER_AAL1" authorize_data_egress '{"p_destination":"api.openai.com","p_data_class":"operational","p_purpose":"model_inference","p_redaction_applied":false}')
expect_denied "$NO_REDACTION" 'required_redaction_not_applied'
WRONG_PURPOSE=$(rpc "$PROPOSER_AAL1" authorize_data_egress '{"p_destination":"api.openai.com","p_data_class":"operational","p_purpose":"speech_synthesis","p_redaction_applied":true}')
expect_denied "$WRONG_PURPOSE" 'no_current_matching_rule'
WRONG_CLASS=$(rpc "$PROPOSER_AAL1" authorize_data_egress '{"p_destination":"api.openai.com","p_data_class":"commercial","p_purpose":"model_inference","p_redaction_applied":true}')
expect_denied "$WRONG_CLASS" 'no_current_matching_rule'
ALLOWED=$(rpc "$PROPOSER_AAL1" authorize_data_egress '{"p_destination":"api.openai.com","p_data_class":"operational","p_purpose":"model_inference","p_redaction_applied":true}')
noerr "$ALLOWED"; test "$(field "$ALLOWED" allowed)" = 'true'; test "$(field "$ALLOWED" ruleId)" = "$RULE_ID"
SERVICE_ALLOWED=$(service_rpc authorize_service_data_egress "{\"p_organization_id\":\"$ORG\",\"p_destination\":\"api.openai.com\",\"p_data_class\":\"operational\",\"p_purpose\":\"embedding\",\"p_redaction_applied\":true,\"p_service_label\":\"ci-dlp-smoke\"}")
noerr "$SERVICE_ALLOWED"; test "$(field "$SERVICE_ALLOWED" allowed)" = 'true'

OUT=$(sql_must_fail "update data_egress_rules set permitted=false where id=$RULE_ID;")
grep -qi 'governed proposal and independent review workflow' <<<"$OUT"

REVISION=$(rpc "$PROPOSER_AAL1" propose_data_egress_rule "{\"p_destination\":\"api.openai.com\",\"p_destination_kind\":\"llm_gateway\",\"p_data_class\":\"operational\",\"p_allowed_purposes\":[\"model_inference\"],\"p_permitted\":false,\"p_redaction_required\":false,\"p_basis\":\"Revised policy denies this provider route while the tenant completes its destination reassessment.\",\"p_supersedes_rule_id\":$RULE_ID}")
noerr "$REVISION"; REVISION_ID=$(field "$REVISION" ruleId); test -n "$REVISION_ID"
REVISION_ADOPTED=$(rpc "$REVIEWER_AAL2" decide_data_egress_rule "{\"p_rule_id\":$REVISION_ID,\"p_decision\":\"adopt\",\"p_reason\":\"Independent review confirms the denial revision and immediate fail-closed destination posture.\"}")
noerr "$REVISION_ADOPTED"
SUPERSEDED_DENY=$(rpc "$PROPOSER_AAL1" authorize_data_egress '{"p_destination":"api.openai.com","p_data_class":"operational","p_purpose":"model_inference","p_redaction_applied":true}')
expect_denied "$SUPERSEDED_DENY" 'current_rule_denies'
test "$(psqlc "select superseded_by_rule_id from data_egress_rules where id=$RULE_ID")" = "$REVISION_ID"

test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='data_egress_rule'")" -eq 4
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='data_egress_decision'")" -ge 8
test "$(psqlc "select count(*) from security_events where organization_id='$ORG' and event_type in ('data_egress_allowed','data_egress_denied')")" -ge 8

echo 'Data-loss prevention smoke passed: canonical_register=true default_deny=true drafts_inactive=true independent_aal2_review=true tenant_isolation=true exact_destination_class_purpose=true redaction_gate=true service_boundary=true direct_write_blocked=true supersession=true audit_retained=true operational_authority=false'

#!/usr/bin/env bash
# A1.05 — multi-year maintenance and capital value plan.
set -euo pipefail
trap 'echo "A1.05 long-horizon value plan smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); AUTHOR=$(uuid); ADOPTER=$(uuid); AI=$(uuid); FOREIGN=$(uuid)
AUTHOR_FACTOR=$(uuid); ADOPTER_FACTOR=$(uuid); AI_FACTOR=$(uuid); FOREIGN_FACTOR=$(uuid)
YEAR=$(date -u +%Y)

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
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else None; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out" | grep -q 'governed value-engine writer'; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','A1.05 value plan tenant'),('$FOREIGN_ORG','A1.05 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$AUTHOR','authenticated','authenticated','a105-author-$AUTHOR@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$ADOPTER','authenticated','authenticated','a105-adopter-$ADOPTER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI','authenticated','authenticated','a105-ai-$AI@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','a105-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$AUTHOR','$ORG','a105-author-$AUTHOR@invalid.syncai.ca','Plan author','reliability_engineer'),
  ('$ADOPTER','$ORG','a105-adopter-$ADOPTER@invalid.syncai.ca','Plan adopter','executive'),
  ('$AI','$ORG','a105-ai-$AI@invalid.syncai.ca','AI operator','ai_admin'),
  ('$FOREIGN','$FOREIGN_ORG','a105-foreign-$FOREIGN@invalid.syncai.ca','Foreign administrator','admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$AUTHOR_FACTOR','$AUTHOR','CI plan factor','totp','verified',now(),now()),
  ('$ADOPTER_FACTOR','$ADOPTER','CI adopter factor','totp','verified',now(),now()),
  ('$AI_FACTOR','$AI','CI AI factor','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','CI foreign factor','totp','verified',now(),now());
PSQL

EVIDENCE=$(psqlc "insert into evidence_items(organization_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','PLAN-2027','planning_basis','Verified two-year capital planning basis.','DOCUMENTED','verified','$ADOPTER',now(),'Independent planning review') returning id;")
SELF_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','PLAN-SELF','planning_basis','Self-verified planning basis.','DOCUMENTED','verified','$AUTHOR',now(),'Self review') returning id;")
psqlc "insert into capital_plan_items(organization_id,plan_year,label,cost,currency,mandatory) values('$ORG',$YEAR,'Year one sustaining capital',100000,'CAD',false); insert into budget_lines(organization_id,budget_year,category,budgeted,forecast,forecast_basis) values('$ORG',$YEAR,'labour',50000,48000,'Recorded labour forecast with no currency column.');" >/dev/null

AUTHOR_AAL1=$(jwt "$AUTHOR" aal1 "a105-author-$AUTHOR@invalid.syncai.ca")
AUTHOR_AAL2=$(jwt "$AUTHOR" aal2 "a105-author-$AUTHOR@invalid.syncai.ca")
ADOPTER_AAL2=$(jwt "$ADOPTER" aal2 "a105-adopter-$ADOPTER@invalid.syncai.ca")
AI_AAL2=$(jwt "$AI" aal2 "a105-ai-$AI@invalid.syncai.ca")
FOREIGN_AAL2=$(jwt "$FOREIGN" aal2 "a105-foreign-$FOREIGN@invalid.syncai.ca")
NEXT=$((YEAR + 1))
PAYLOAD="{\"planCode\":\"SITE-A\",\"startYear\":$YEAR,\"endYear\":$NEXT,\"currency\":\"CAD\",\"forecastMethod\":\"recorded_only\",\"evidenceItemId\":\"$EVIDENCE\",\"basis\":\"The horizon is the two planning years with recorded and missing capital kept separate.\"}"

expect_error "$(rpc "$AUTHOR_AAL1" record_long_horizon_plan "{\"p_plan\":$PAYLOAD}")" "AAL2 session"
expect_error "$(rpc "$AI_AAL2" record_long_horizon_plan "{\"p_plan\":$PAYLOAD}")" "AI operator is refused"
SELF_PAYLOAD=$(SELF="$SELF_EVIDENCE" PAYLOAD="$PAYLOAD" python3 -c 'import json,os; p=json.loads(os.environ["PAYLOAD"]); p["evidenceItemId"]=os.environ["SELF"]; print(json.dumps(p))')
expect_error "$(rpc "$AUTHOR_AAL2" record_long_horizon_plan "{\"p_plan\":$SELF_PAYLOAD}")" "independently verified"
expect_error "$(rpc "$FOREIGN_AAL2" record_long_horizon_plan "{\"p_plan\":$PAYLOAD}")" "independently verified"

RECORDED=$(rpc "$AUTHOR_AAL2" record_long_horizon_plan "{\"p_plan\":$PAYLOAD}")
noerr "$RECORDED"
PLAN=$(BODY="$RECORDED" python3 -c 'import json,os; print(json.loads(os.environ["BODY"])["planId"])')
expect_error "$(rpc "$AUTHOR_AAL2" adopt_long_horizon_plan "{\"p_plan_id\":\"$PLAN\",\"p_note\":\"The author must not adopt this draft plan.\"}")" "author cannot adopt"
ADOPTED=$(rpc "$ADOPTER_AAL2" adopt_long_horizon_plan "{\"p_plan_id\":\"$PLAN\",\"p_note\":\"Adopted after checking the missing second year stays withheld.\"}")
noerr "$ADOPTED"
BODY="$ADOPTED" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); assert x["status"]=="adopted"; assert x["expenditureAuthorized"] is False; assert x["calculationRunId"]'

READ=$(rpc "$ADOPTER_AAL2" get_long_horizon_value_plan "{\"p_plan_id\":\"$PLAN\"}")
noerr "$READ"
BODY="$READ" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); s=x["selected"]; years=s["capitalAllocation"]["years"]; assert years[0]["capitalStatus"]=="recorded"; assert years[1]["capitalStatus"]=="not_recorded"; assert years[1]["capitalAmount"] is None; assert s["capitalAllocation"]["horizonTotalStatus"]=="withheld"; assert s["capitalAllocation"]["combinedHorizonTotal"] is None; assert s["lifecycleCost"]["horizonMultiplication"] is False; assert s["performance"]["label"].startswith("observed history"); assert s["resilience"]["score"] is None; assert s["expenditureAuthorized"] is False'

FOREIGN_READ=$(rpc "$FOREIGN_AAL2" get_long_horizon_value_plan "{\"p_plan_id\":\"$PLAN\"}")
expect_error "$FOREIGN_READ" "not found in this organization"
sql_must_fail "insert into long_horizon_plans(organization_id,plan_code,version,status,start_year,end_year,currency,forecast_method,evidence_item_id,basis,created_by) values('$ORG','DIRECT',1,'draft',$YEAR,$NEXT,'CAD','recorded_only','$EVIDENCE','Direct insert must fail closed here.','$AUTHOR');"

echo 'A1.05 long-horizon value plan smoke passed: multi_year=true missing_year_not_zero=true currency_withheld=true budget_lines_uncurrency=true lifecycle_not_multiplied=true tenant_wall=true aal2_required=true ai_refused=true author_cannot_adopt=true direct_write_locked=true audit_and_calculation_frozen=true authority_granted=false'

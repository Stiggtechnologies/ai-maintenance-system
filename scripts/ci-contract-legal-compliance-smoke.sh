#!/usr/bin/env bash
# D11.24 — the seventh §70 determination: contract legally compliant.
set -euo pipefail
trap 'echo "Contract legal-compliance smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); CASE_ID=$(uuid)
HUMAN=$(uuid); AI=$(uuid); FOREIGN=$(uuid)
HUMAN_FACTOR=$(uuid); AI_FACTOR=$(uuid); FOREIGN_FACTOR=$(uuid)
LEGAL_EVIDENCE=$(uuid); BAD_EVIDENCE=$(uuid)

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
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; x=json.loads(os.environ['BODY']); v=x.get(os.environ['KEY']); print('' if v is None else str(v).lower() if isinstance(v,bool) else v)"; }
json_path(){ BODY="$1" PATH_VALUE="$2" python3 -c "import json,os; x=json.loads(os.environ['BODY']);
for k in os.environ['PATH_VALUE'].split('.'): x=x.get(k) if isinstance(x,dict) else None
print('' if x is None else str(x).lower() if isinstance(x,bool) else x)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else None; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','D11.24 contract legal tenant'),('$FOREIGN_ORG','D11.24 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$HUMAN','authenticated','authenticated','legal-human-$HUMAN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI','authenticated','authenticated','legal-ai-$AI@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','legal-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$HUMAN','$ORG','legal-human-$HUMAN@invalid.syncai.ca','Contract authority','executive'),
  ('$AI','$ORG','legal-ai-$AI@invalid.syncai.ca','AI operator','ai_admin'),
  ('$FOREIGN','$FOREIGN_ORG','legal-foreign-$FOREIGN@invalid.syncai.ca','Foreign authority','executive');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$HUMAN_FACTOR','$HUMAN','CI legal human','totp','verified',now(),now()),
  ('$AI_FACTOR','$AI','CI legal AI','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','CI legal foreign','totp','verified',now(),now());
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,created_by)
values('$CASE_ID','$ORG','D11.24 contract case','sustaining_capital','Replace the failed drive under a governed commercial package.','$HUMAN');
insert into suppliers(organization_id,supplier_code,name,supplier_kind)
values('$ORG','D1124-SUP','D11.24 Supplier','oem');
insert into contract_packages(organization_id,package_code,title,development_case_id,equipment_or_scope,recorded_by)
values('$ORG','D1124-PKG','D11.24 governed contract','$CASE_ID','Replacement drive and field acceptance scope','$HUMAN');
insert into contract_bids(organization_id,package_id,supplier_id,price,bid_ref,currency,price_basis)
select '$ORG',p.id,s.id,125000,'D1124-BID','CAD','Firm lump-sum offer for the stated replacement scope'
from contract_packages p join suppliers s on s.organization_id=p.organization_id
where p.organization_id='$ORG' and p.package_code='D1124-PKG' and s.supplier_code='D1124-SUP';
begin;
select set_config('app.procurement_package_write','granted',true);
update contract_packages p set
  awarded_at=now(),awarded_by='$HUMAN',awarded_bid_id=b.id,
  awarded_supplier_id=b.supplier_id,awarded_value=b.price,contract_currency='CAD',
  contract_type='lump_sum',contract_start_date=current_date,
  contract_completion_date=current_date+90,
  performance_requirements='Deliver, install and pass the recorded field acceptance criteria.',
  award_basis='Only fully evaluated offer meeting the recorded technical requirements.',
  commercial_status='awarded',status_updated_at=now()
from contract_bids b where b.package_id=p.id and p.organization_id='$ORG' and p.package_code='D1124-PKG';
commit;
begin;
select set_config('app.evidence_verification_write','granted',true);
insert into evidence_items(id,organization_id,development_case_id,evidence_class,description,
  verification_status,verified_by,verified_at,verification_method,revision,applicability)
values
('$LEGAL_EVIDENCE','$ORG','$CASE_ID','DOCUMENTED','Executed contract and legal review memorandum','verified','$HUMAN',now(),'Reviewed against the executed terms and governing law','rev-1','Directly applicable to D1124-PKG'),
('$BAD_EVIDENCE','$ORG','$CASE_ID','AI_INFERENCE','Model summary of possible contract clauses','verified','$HUMAN',now(),'Human checked the summary text only','model-1','Advisory context only');
commit;
PSQL

PACKAGE_ID=$(psqlc "select id from contract_packages where organization_id='$ORG' and package_code='D1124-PKG'")
test -n "$PACKAGE_ID"
HUMAN_AAL1=$(jwt "$HUMAN" aal1 "legal-human-$HUMAN@invalid.syncai.ca")
HUMAN_AAL2=$(jwt "$HUMAN" aal2 "legal-human-$HUMAN@invalid.syncai.ca")
AI_AAL2=$(jwt "$AI" aal2 "legal-ai-$AI@invalid.syncai.ca")
FOREIGN_AAL2=$(jwt "$FOREIGN" aal2 "legal-foreign-$FOREIGN@invalid.syncai.ca")
VALID_UNTIL=$(date -u -v+365d +%F 2>/dev/null || date -u -d '+365 days' +%F)

BEFORE=$(rpc "$HUMAN_AAL1" contract_legal_compliance_position "{\"p_package_id\":$PACKAGE_ID}")
test "$(field "$BEFORE" answered)" = 'false'; test "$(field "$BEFORE" status)" = 'unassessed'

AAL1=$(rpc "$HUMAN_AAL1" record_contract_legal_compliance "{\"p_package_id\":$PACKAGE_ID,\"p_attestation\":{\"determination\":\"compliant\",\"jurisdiction\":\"Alberta, Canada\",\"legal_scope\":\"Executed terms, governing law, remedies and signatures\",\"evidence_item_id\":\"$LEGAL_EVIDENCE\",\"basis\":\"The executed agreement and legal review memorandum confirm the recorded scope.\",\"valid_until\":\"$VALID_UNTIL\"}}")
expect_error "$AAL1" 'aal2 session'
AI_RESULT=$(rpc "$AI_AAL2" record_contract_legal_compliance "{\"p_package_id\":$PACKAGE_ID,\"p_attestation\":{\"determination\":\"compliant\",\"jurisdiction\":\"Alberta, Canada\",\"legal_scope\":\"Executed terms, governing law, remedies and signatures\",\"evidence_item_id\":\"$LEGAL_EVIDENCE\",\"basis\":\"A model attempts to make the legal determination reserved to a person.\",\"valid_until\":\"$VALID_UNTIL\"}}")
expect_error "$AI_RESULT" 'AI-operator identity cannot attest'
FOREIGN_RESULT=$(rpc "$FOREIGN_AAL2" record_contract_legal_compliance "{\"p_package_id\":$PACKAGE_ID,\"p_attestation\":{\"determination\":\"compliant\",\"jurisdiction\":\"Alberta, Canada\",\"legal_scope\":\"Executed terms, governing law, remedies and signatures\",\"evidence_item_id\":\"$LEGAL_EVIDENCE\",\"basis\":\"A foreign tenant attempts to attest against a contract it does not own.\",\"valid_until\":\"$VALID_UNTIL\"}}")
expect_error "$FOREIGN_RESULT" 'not found in this tenant'
BAD=$(rpc "$HUMAN_AAL2" record_contract_legal_compliance "{\"p_package_id\":$PACKAGE_ID,\"p_attestation\":{\"determination\":\"compliant\",\"jurisdiction\":\"Alberta, Canada\",\"legal_scope\":\"Executed terms, governing law, remedies and signatures\",\"evidence_item_id\":\"$BAD_EVIDENCE\",\"basis\":\"An AI inference cannot carry the legal determination even when human verified.\",\"valid_until\":\"$VALID_UNTIL\"}}")
expect_error "$BAD" 'VERIFIED DOCUMENTED evidence'

FIRST=$(rpc "$HUMAN_AAL2" record_contract_legal_compliance "{\"p_package_id\":$PACKAGE_ID,\"p_attestation\":{\"determination\":\"compliant\",\"jurisdiction\":\"Alberta, Canada\",\"legal_scope\":\"Executed terms, governing law, remedies and signatures\",\"evidence_item_id\":\"$LEGAL_EVIDENCE\",\"basis\":\"The executed agreement and legal review memorandum confirm the recorded scope.\",\"valid_until\":\"$VALID_UNTIL\"}}")
noerr "$FIRST"; test "$(field "$FIRST" version)" = '1'; test "$(field "$FIRST" determination)" = 'compliant'
COMMERCIAL=$(rpc "$HUMAN_AAL1" get_contract_commercial "{\"p_package_id\":$PACKAGE_ID}")
noerr "$COMMERCIAL"; test "$(json_path "$COMMERCIAL" legalCompliance.compliant)" = 'true'; test "$(json_path "$COMMERCIAL" legalCompliance.version)" = '1'

OUT=$(sql_must_fail "insert into contract_legal_compliance_attestations(organization_id,package_id,version,determination,jurisdiction,legal_scope,evidence_item_id,basis,valid_until,attested_by) values('$ORG',$PACKAGE_ID,2,'compliant','Alberta, Canada','Direct write attempts to bypass the governed path','$LEGAL_EVIDENCE','This direct insert is deliberately refused before it can become legal truth.','$VALID_UNTIL','$HUMAN');")
grep -qi 'governed named-human workflow' <<<"$OUT"
ATTESTATION_ID=$(psqlc "select id from contract_legal_compliance_attestations where package_id=$PACKAGE_ID and version=1")
OUT=$(sql_must_fail "update contract_legal_compliance_attestations set basis='A direct rewrite attempts to replace the evidence basis after attestation.' where id='$ATTESTATION_ID';")
grep -qi 'immutable' <<<"$OUT"
OUT=$(sql_must_fail "delete from contract_legal_compliance_attestations where id='$ATTESTATION_ID';")
grep -qi 'immutable' <<<"$OUT"

SECOND=$(rpc "$HUMAN_AAL2" record_contract_legal_compliance "{\"p_package_id\":$PACKAGE_ID,\"p_attestation\":{\"determination\":\"not_compliant\",\"jurisdiction\":\"Alberta, Canada\",\"legal_scope\":\"Executed terms, governing law, remedies and signatures\",\"evidence_item_id\":\"$LEGAL_EVIDENCE\",\"basis\":\"A newly identified contract defect means the prior conclusion is no longer current.\",\"valid_until\":\"$VALID_UNTIL\",\"supersession_reason\":\"New review identified a legal defect in the executed terms.\"}}")
noerr "$SECOND"; test "$(field "$SECOND" version)" = '2'; test "$(field "$SECOND" determination)" = 'not_compliant'
POSITION=$(rpc "$HUMAN_AAL1" contract_legal_compliance_position "{\"p_package_id\":$PACKAGE_ID}")
test "$(field "$POSITION" answered)" = 'true'; test "$(field "$POSITION" compliant)" = 'false'; test "$(field "$POSITION" version)" = '2'
test "$(psqlc "select count(*) from contract_legal_compliance_attestations where package_id=$PACKAGE_ID")" -eq 2
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='contract_legal_compliance'")" -eq 2

echo 'Contract legal-compliance smoke passed: canonical_contract=true immutable_versions=true verified_documented_evidence=true tenant_isolation=true ai_refused=true direct_write_refused=true aal2=true current_position=true supersession=true audit=true'

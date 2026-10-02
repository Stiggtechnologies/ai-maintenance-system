#!/usr/bin/env bash
# C2.11 — safety-critical equipment and exact-version regulatory obligations.
set -euo pipefail
trap 'echo "C2.11 safety-critical regulatory smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); WRITER=$(uuid); VERIFIER=$(uuid); AI=$(uuid); FOREIGN=$(uuid); FOREIGN_VERIFIER=$(uuid)
ASSET=$(uuid); FOREIGN_ASSET=$(uuid); WRITER_FACTOR=$(uuid); AI_FACTOR=$(uuid); FOREIGN_FACTOR=$(uuid)
LAYER=$(uuid); FOREIGN_LAYER=$(uuid)
EFFECTIVE=$(python3 -c 'from datetime import date; print(date.today().isoformat())')
LAST_TEST=$(python3 -c 'from datetime import date,timedelta; print((date.today()-timedelta(days=400)).isoformat())')
REVIEW=$(python3 -c 'from datetime import date,timedelta; print((date.today()+timedelta(days=365)).isoformat())')

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
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else None; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name,jurisdiction) values
  ('$ORG','C2.11 safety tenant','Alberta'),
  ('$FOREIGN_ORG','C2.11 foreign tenant','Alberta');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$WRITER','authenticated','authenticated','c211-writer-$WRITER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$VERIFIER','authenticated','authenticated','c211-verifier-$VERIFIER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI','authenticated','authenticated','c211-ai-$AI@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','c211-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN_VERIFIER','authenticated','authenticated','c211-foreign-verifier-$FOREIGN_VERIFIER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$WRITER','$ORG','c211-writer-$WRITER@invalid.syncai.ca','Safety register writer','reliability_engineer'),
  ('$VERIFIER','$ORG','c211-verifier-$VERIFIER@invalid.syncai.ca','Safety evidence verifier','admin'),
  ('$AI','$ORG','c211-ai-$AI@invalid.syncai.ca','AI operator','ai_admin'),
  ('$FOREIGN','$FOREIGN_ORG','c211-foreign-$FOREIGN@invalid.syncai.ca','Foreign administrator','admin'),
  ('$FOREIGN_VERIFIER','$FOREIGN_ORG','c211-foreign-verifier-$FOREIGN_VERIFIER@invalid.syncai.ca','Foreign verifier','reliability_engineer');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$WRITER_FACTOR','$WRITER','CI safety factor','totp','verified',now(),now()),
  ('$AI_FACTOR','$AI','CI AI factor','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','CI foreign factor','totp','verified',now(),now());
insert into assets(id,organization_id,name,tag,asset_class,criticality) values
  ('$ASSET','$ORG','C2.11 pressure pump','C211-P-101','pump','high'),
  ('$FOREIGN_ASSET','$FOREIGN_ORG','Foreign pressure pump','X-C211-P','pump','high');
insert into capability_pack_layers(
  id,organization_id,layer_kind,scope_key,title,jurisdiction,configuration,
  evidence_basis,status,version,created_by,adopted_by,adopted_at,adoption_note
) values
  ('$LAYER','$ORG','jurisdiction','jurisdiction:Alberta','Alberta safety obligations','Alberta',
   '{"jurisdiction_requirements":[{"key":"pressure_shutdown_test","title":"Pressure shutdown functional test","domain":"pressure_regulation","requirement_class":"regulatory","applicability":"applicable","obligation":"mandatory","authority_reference":"AB-PR-101","applicability_basis":"Registered pressure equipment and its protective shutdown are in scope.","mandatory_basis":"The Alberta pressure requirement makes this functional test mandatory."},{"key":"inspection_retention_review","title":"Inspection retention applicability review","domain":"retention","requirement_class":"regulatory","applicability":"undetermined","obligation":"advisory","authority_reference":"AB-RET-20","applicability_basis":"Named legal review is still required before applicability can be decided."}]}',
   'Controlled jurisdiction register reviewed by the accountable site authority.','adopted',1,'$WRITER','$VERIFIER',now(),'Independent adoption of the typed jurisdiction obligations.'),
  ('$FOREIGN_LAYER','$FOREIGN_ORG','jurisdiction','jurisdiction:Alberta','Foreign Alberta obligations','Alberta',
   '{"jurisdiction_requirements":[{"key":"foreign_pressure_test","title":"Foreign pressure test","domain":"pressure_regulation","requirement_class":"regulatory","applicability":"applicable","obligation":"mandatory","authority_reference":"X-PR-1","applicability_basis":"Foreign registered pressure equipment is in scope for this tenant only.","mandatory_basis":"The foreign regulation makes the test mandatory for that tenant."}]}',
   'Foreign controlled jurisdiction register reviewed inside the foreign tenant.','adopted',1,'$FOREIGN','$FOREIGN_VERIFIER',now(),'Foreign independent adoption.');
PSQL

WRITER_AAL1=$(jwt "$WRITER" aal1 "c211-writer-$WRITER@invalid.syncai.ca")
WRITER_AAL2=$(jwt "$WRITER" aal2 "c211-writer-$WRITER@invalid.syncai.ca")
AI_AAL2=$(jwt "$AI" aal2 "c211-ai-$AI@invalid.syncai.ca")
FOREIGN_AAL2=$(jwt "$FOREIGN" aal2 "c211-foreign-$FOREIGN@invalid.syncai.ca")

EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','PSM-REGISTER','inspection','Verified shutdown performance standard and proof-test basis.','DOCUMENTED','verified','$VERIFIER',now(),'Independent engineering review') returning id;")
LINK_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','LEGAL-REGISTER','regulatory','Verified applicability of AB-PR-101 to the shutdown barrier.','DOCUMENTED','verified','$VERIFIER',now(),'Independent legal and engineering review') returning id;")
SELF_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','SELF','inspection','Self-verified barrier basis.','DOCUMENTED','verified','$WRITER',now(),'Self review') returning id;")
FOREIGN_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$FOREIGN_ORG','$FOREIGN_ASSET','FOREIGN-PSM','inspection','Foreign barrier basis.','DOCUMENTED','verified','$FOREIGN_VERIFIER',now(),'Foreign review') returning id;")

PAYLOAD="{\"id\":null,\"asset_id\":\"$ASSET\",\"sce_ref\":\"SCE-P-101\",\"label\":\"Emergency shutdown valve\",\"barrier_kind\":\"mechanical\",\"barrier_role\":\"preventive\",\"performance_standard\":\"Close within five seconds and retain leak-tight isolation.\",\"test_interval_months\":12,\"last_tested_on\":\"$LAST_TEST\",\"evidence_item_id\":\"$EVIDENCE\",\"effective_from\":\"$EFFECTIVE\",\"review_due\":\"$REVIEW\",\"expected_version\":0}"

AAL1=$(rpc "$WRITER_AAL1" record_safety_critical_element "{\"p_record\":$PAYLOAD}")
expect_error "$AAL1" 'AAL2 session'
AI_DENIED=$(rpc "$AI_AAL2" record_safety_critical_element "{\"p_record\":$PAYLOAD}")
expect_error "$AI_DENIED" 'AI cannot record'
SELF_PAYLOAD="${PAYLOAD//$EVIDENCE/$SELF_EVIDENCE}"
SELF_DENIED=$(rpc "$WRITER_AAL2" record_safety_critical_element "{\"p_record\":$SELF_PAYLOAD}")
expect_error "$SELF_DENIED" 'independently verified'
FOREIGN_PAYLOAD="${PAYLOAD//$ASSET/$FOREIGN_ASSET}"
FOREIGN_PAYLOAD="${FOREIGN_PAYLOAD//$EVIDENCE/$FOREIGN_EVIDENCE}"
FOREIGN_DENIED=$(rpc "$WRITER_AAL2" record_safety_critical_element "{\"p_record\":$FOREIGN_PAYLOAD}")
expect_error "$FOREIGN_DENIED" 'outside the active tenant'

CREATED=$(rpc "$WRITER_AAL2" record_safety_critical_element "{\"p_record\":$PAYLOAD}")
noerr "$CREATED"; ELEMENT=$(field "$CREATED" id)
test "$(field "$CREATED" version)" = '1'
test "$(field "$CREATED" complianceEstablished)" = 'false'
test "$(field "$CREATED" workAuthorized)" = 'false'
STALE=$(rpc "$WRITER_AAL2" record_safety_critical_element "{\"p_record\":${PAYLOAD/\"id\":null/\"id\":$ELEMENT}}")
expect_error "$STALE" 'changed after it was loaded'

V2="${PAYLOAD/\"id\":null/\"id\":$ELEMENT}"
V2="${V2/\"label\":\"Emergency shutdown valve\"/\"label\":\"Emergency shutdown isolation valve\"}"
V2="${V2/\"expected_version\":0/\"expected_version\":1}"
UPDATED=$(rpc "$WRITER_AAL2" record_safety_critical_element "{\"p_record\":$V2}")
noerr "$UPDATED"; test "$(field "$UPDATED" version)" = '2'

LINK="{\"safety_critical_element_id\":$ELEMENT,\"capability_pack_layer_id\":\"$LAYER\",\"requirement_key\":\"pressure_shutdown_test\",\"evidence_item_id\":\"$LINK_EVIDENCE\",\"basis\":\"AB-PR-101 applies to this exact registered pressure shutdown barrier.\"}"
ADVISORY="${LINK/pressure_shutdown_test/inspection_retention_review}"
ADVISORY_DENIED=$(rpc "$WRITER_AAL2" link_safety_critical_regulatory_obligation "{\"p_link\":$ADVISORY}")
expect_error "$ADVISORY_DENIED" 'applicable mandatory'
FOREIGN_LAYER_LINK="${LINK//$LAYER/$FOREIGN_LAYER}"
FOREIGN_LAYER_DENIED=$(rpc "$WRITER_AAL2" link_safety_critical_regulatory_obligation "{\"p_link\":$FOREIGN_LAYER_LINK}")
expect_error "$FOREIGN_LAYER_DENIED" 'same-tenant jurisdiction layer'
LINKED=$(rpc "$WRITER_AAL2" link_safety_critical_regulatory_obligation "{\"p_link\":$LINK}")
noerr "$LINKED"
test "$(field "$LINKED" elementVersion)" = '2'
test "$(field "$LINKED" layerVersion)" = '1'
test "$(field "$LINKED" complianceEstablished)" = 'false'

V3="${V2/\"expected_version\":1/\"expected_version\":2}"
V3="${V3/retain leak-tight isolation/retain leak-tight isolation at the approved differential pressure}"
UPDATED3=$(rpc "$WRITER_AAL2" record_safety_critical_element "{\"p_record\":$V3}")
noerr "$UPDATED3"; test "$(field "$UPDATED3" version)" = '3'

STALE_WORKSPACE=$(rpc "$WRITER_AAL2" get_safety_critical_regulatory_workspace '{}')
noerr "$STALE_WORKSPACE"
BODY="$STALE_WORKSPACE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['coverage']['elements']==1,x
assert x['coverage']['elementsWithVerifiedEvidence']==1,x
assert x['coverage']['overdueOrUntested']==1,x
assert x['coverage']['mandatoryRegulatoryObligations']==1,x
assert x['coverage']['currentBindings']==0 and x['coverage']['staleBindings']==1,x
assert x['bindings'][0]['current'] is False,x
assert 'not a compliance finding' in x['decisionBoundary'],x
PY

RELINKED=$(rpc "$WRITER_AAL2" link_safety_critical_regulatory_obligation "{\"p_link\":$LINK}")
noerr "$RELINKED"; test "$(field "$RELINKED" elementVersion)" = '3'
WORKSPACE=$(rpc "$WRITER_AAL2" get_safety_critical_regulatory_workspace '{}')
BODY="$WORKSPACE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['coverage']['currentBindings']==1 and x['coverage']['staleBindings']==1,x
assert sum(1 for b in x['bindings'] if b['current'])==1,x
PY

POSTURE=$(rpc "$WRITER_AAL2" get_process_safety_posture '{}')
BODY="$POSTURE" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x[0]['barriers_total']==1,x"

DIRECT=$(curl -sS -o /tmp/c211-direct.txt -w '%{http_code}' -X PATCH "$API_URL/rest/v1/safety_critical_elements?id=eq.$ELEMENT" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $WRITER_AAL2" -H 'Content-Type: application/json' -d '{"label":"forged"}')
case "$DIRECT" in 401|403) ;; *) cat /tmp/c211-direct.txt; false ;; esac
OUT=$(sql_must_fail "update safety_critical_elements set label='forged' where id=$ELEMENT;")
grep -qi 'governed C2.11 writer' <<<"$OUT"
OUT=$(sql_must_fail "update safety_critical_element_obligations set requirement_key='forged' where safety_critical_element_id=$ELEMENT;")
grep -qi 'immutable' <<<"$OUT"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('safety_critical_element','safety_critical_regulatory_obligation');")" = '5'

FOREIGN_CREATED=$(rpc "$FOREIGN_AAL2" record_safety_critical_element "{\"p_record\":{\"id\":null,\"asset_id\":\"$FOREIGN_ASSET\",\"sce_ref\":\"X-SCE-1\",\"label\":\"Foreign shutdown\",\"barrier_kind\":\"mechanical\",\"barrier_role\":\"preventive\",\"performance_standard\":\"Close within the foreign approved functional-test response time.\",\"test_interval_months\":12,\"last_tested_on\":\"$EFFECTIVE\",\"evidence_item_id\":\"$FOREIGN_EVIDENCE\",\"effective_from\":\"$EFFECTIVE\",\"review_due\":\"$REVIEW\",\"expected_version\":0}}")
noerr "$FOREIGN_CREATED"
FOREIGN_ELEMENT=$(field "$FOREIGN_CREATED" id)
CROSS_LINK="${LINK/$ELEMENT/$FOREIGN_ELEMENT}"
CROSS_DENIED=$(rpc "$WRITER_AAL2" link_safety_critical_regulatory_obligation "{\"p_link\":$CROSS_LINK}")
expect_error "$CROSS_DENIED" 'outside the active tenant'

echo 'C2.11 safety-critical regulatory smoke passed: canonical_element_register=true canonical_jurisdiction_obligations=true aal2_required=true ai_operator_refused=true independent_verified_evidence=true tenant_wall=true optimistic_version=true exact_version_binding=true stale_binding_visible=true direct_write_locked=true compliance_established=false operational_authority=false'

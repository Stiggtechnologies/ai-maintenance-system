#!/usr/bin/env bash
# C2.09 — controlled drawings, P&IDs, manuals, procedures, inspection records
# and engineering standards on the canonical KB intake record.
set -euo pipefail
trap 'echo "C2.09 controlled technical-document smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); CONTROLLER=$(uuid); REVIEWER=$(uuid); TECH=$(uuid); FOREIGN=$(uuid)
CONTROLLER_FACTOR=$(uuid); REVIEWER_FACTOR=$(uuid); FOREIGN_FACTOR=$(uuid)

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
ingest(){ rpc "$CONTROLLER_AAL1" kb_ingest_document "{\"p_source_id\":\"$1\",\"p_title\":\"$2\",\"p_document_class\":\"client_supplied\",\"p_chunks\":[{\"chunk_index\":0,\"content\":\"Controlled technical content for $1 with verified source context and no executable instructions.\"}]}"; }
register_doc(){ rpc "$CONTROLLER_AAL1" register_controlled_technical_document "{\"p_document_id\":\"$1\",\"p_record\":$2}"; }
review_doc(){ rpc "$REVIEWER_AAL2" review_controlled_technical_document "{\"p_document_id\":\"$1\",\"p_decision\":\"effective\",\"p_basis\":\"Independent AAL2 review against the named canonical evidence and applicability.\"}"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','C2.09 controlled document tenant'),('$FOREIGN_ORG','C2.09 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$CONTROLLER','authenticated','authenticated','c209-controller-$CONTROLLER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$REVIEWER','authenticated','authenticated','c209-reviewer-$REVIEWER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$TECH','authenticated','authenticated','c209-tech-$TECH@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','c209-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$CONTROLLER','$ORG','c209-controller-$CONTROLLER@invalid.syncai.ca','Document controller','reliability_engineer'),
  ('$REVIEWER','$ORG','c209-reviewer-$REVIEWER@invalid.syncai.ca','Independent document reviewer','admin'),
  ('$TECH','$ORG','c209-tech-$TECH@invalid.syncai.ca','Document technician','technician'),
  ('$FOREIGN','$FOREIGN_ORG','c209-foreign-$FOREIGN@invalid.syncai.ca','Foreign reviewer','admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$CONTROLLER_FACTOR','$CONTROLLER','CI controller factor','totp','verified',now(),now()),
  ('$REVIEWER_FACTOR','$REVIEWER','CI reviewer factor','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','CI foreign factor','totp','verified',now(),now());
PSQL

CONTROLLER_AAL1=$(jwt "$CONTROLLER" aal1 "c209-controller-$CONTROLLER@invalid.syncai.ca")
CONTROLLER_AAL2=$(jwt "$CONTROLLER" aal2 "c209-controller-$CONTROLLER@invalid.syncai.ca")
REVIEWER_AAL1=$(jwt "$REVIEWER" aal1 "c209-reviewer-$REVIEWER@invalid.syncai.ca")
REVIEWER_AAL2=$(jwt "$REVIEWER" aal2 "c209-reviewer-$REVIEWER@invalid.syncai.ca")
TECH_AAL1=$(jwt "$TECH" aal1 "c209-tech-$TECH@invalid.syncai.ca")
FOREIGN_AAL2=$(jwt "$FOREIGN" aal2 "c209-foreign-$FOREIGN@invalid.syncai.ca")

for spec in \
  'drawing-a|Arrangement drawing revision A' \
  'drawing-b|Arrangement drawing revision B' \
  'pid-a|Process water P and ID' \
  'manual-a|Pump service manual' \
  'procedure-a|Lubrication standard procedure' \
  'inspection-a|Pump inspection record' \
  'standard-a|Engineering piping standard'
do
  source=${spec%%|*}; title=${spec#*|}; result=$(ingest "$source" "$title"); noerr "$result"; test "$(field "$result" security_status)" = 'cleared'
done

DRAWING_A=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='drawing-a';")
DRAWING_B=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='drawing-b';")
PID=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='pid-a';")
MANUAL=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='manual-a';")
PROCEDURE=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='procedure-a';")
INSPECTION=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='inspection-a';")
STANDARD=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='standard-a';")

STANDARD_WORK=$(psqlc "insert into standard_work(organization_id,work_key,title,basis,version) values('$ORG','C209-LUBE','C2.09 lubrication procedure','Approved procedure baseline evidence.',1) returning id;")
psqlc "insert into procedure_translations(organization_id,standard_work_id,language_code,content,translation_status,verified_by,verified_at) values('$ORG',$STANDARD_WORK,'en','Verified lubrication procedure content for the C2.09 runtime proof.','human_verified','$CONTROLLER',now());" >/dev/null
GOVERNANCE_STANDARD=$(psqlc "insert into governance_standards(organization_id,standard_key,title,requirement,owner_role,variance_approver_role,basis,status,version,adopted_by,adopted_at) values('$ORG','C209-PIPE','C2.09 piping standard','Apply the adopted piping requirements to the named scope.','reliability_engineer','maintenance_manager','Approved engineering-standard source evidence.','adopted',1,'$CONTROLLER',now()) returning id;")
EVIDENCE=$(psqlc "insert into evidence_items(organization_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method,document_id) values('$ORG','C209-SMOKE','inspection_record','Verified exact inspection record.','INSPECTED','verified','$CONTROLLER',now(),'Independent inspection record verification','$INSPECTION') returning id;")

# Registration authority, tenant isolation and canonical-source gates fail closed.
TECH_DENIED=$(rpc "$TECH_AAL1" register_controlled_technical_document "{\"p_document_id\":\"$DRAWING_A\",\"p_record\":{\"kind\":\"drawing\",\"documentNumber\":\"DWG-100\",\"revisionLabel\":\"A\",\"applicability\":\"North plant process-water system.\",\"basis\":\"Technician must not control technical revisions.\"}}")
expect_error "$TECH_DENIED" 'named same-tenant human role'
psqlc "update user_profiles set role='ai_admin' where id='$TECH';" >/dev/null
AI_DENIED=$(rpc "$TECH_AAL1" register_controlled_technical_document "{\"p_document_id\":\"$DRAWING_A\",\"p_record\":{\"kind\":\"drawing\",\"documentNumber\":\"DWG-100\",\"revisionLabel\":\"A\",\"applicability\":\"North plant process-water system.\",\"basis\":\"AI operator must not control technical revisions.\"}}")
expect_error "$AI_DENIED" 'AI operator is refused'

FOREIGN_DOC=$(psqlc "insert into kb_intake_documents(organization_id,source_id,title,document_class,status,chunk_count,uploaded_by,security_status,security_findings,security_scan_version,security_scanned_at) values('$FOREIGN_ORG','foreign-drawing','Foreign drawing','client_supplied','indexed',1,'$FOREIGN','cleared','[]','deterministic-v1',now()) returning id;")
FOREIGN_DENIED=$(rpc "$CONTROLLER_AAL1" register_controlled_technical_document "{\"p_document_id\":\"$FOREIGN_DOC\",\"p_record\":{\"kind\":\"drawing\",\"documentNumber\":\"F-DWG\",\"revisionLabel\":\"A\",\"applicability\":\"Foreign tenant drawing must remain isolated.\",\"basis\":\"Foreign document registration must fail closed.\"}}")
expect_error "$FOREIGN_DENIED" 'outside the active tenant'

MISSING_PROCEDURE=$(register_doc "$PROCEDURE" '{"kind":"procedure","documentNumber":"SOP-100","revisionLabel":"A","applicability":"North plant lubrication route and named equipment.","basis":"Exact uploaded procedure proposed for document control."}')
expect_error "$MISSING_PROCEDURE" 'canonical same-tenant standard_work'
MISSING_STANDARD=$(register_doc "$STANDARD" '{"kind":"engineering_standard","documentNumber":"STD-100","revisionLabel":"1","applicability":"All named piping within the process-water system.","basis":"Exact adopted engineering standard proposed for control."}')
expect_error "$MISSING_STANDARD" 'canonical same-tenant governance_standards'
MISSING_INSPECTION=$(register_doc "$INSPECTION" '{"kind":"inspection_record","documentNumber":"INSP-100","revisionLabel":"1","applicability":"Pump P-100 inspection at the recorded inspection date.","basis":"Exact inspection record proposed for controlled standing."}')
expect_error "$MISSING_INSPECTION" 'canonical same-tenant evidence'

R_DRAWING=$(register_doc "$DRAWING_A" '{"kind":"drawing","documentNumber":"DWG-100","revisionLabel":"A","applicability":"North plant process-water system and installed pump train.","basis":"Approved issue and field redline establish this exact revision."}')
R_PID=$(register_doc "$PID" '{"kind":"pid","documentNumber":"PID-100","revisionLabel":"A","applicability":"North plant process-water flow path and isolation boundary.","basis":"Approved issue and field walkdown establish this exact revision."}')
R_MANUAL=$(register_doc "$MANUAL" '{"kind":"manual","documentNumber":"MAN-100","revisionLabel":"A","applicability":"Pump P-100 make model and installed configuration only.","basis":"OEM issue and equipment nameplate establish applicability."}')
R_PROCEDURE=$(register_doc "$PROCEDURE" "{\"kind\":\"procedure\",\"documentNumber\":\"SOP-100\",\"revisionLabel\":\"A\",\"applicability\":\"North plant lubrication route and named equipment.\",\"basis\":\"Human-verified standard work and exact upload establish the revision.\",\"standardWorkId\":$STANDARD_WORK}")
R_STANDARD=$(register_doc "$STANDARD" "{\"kind\":\"engineering_standard\",\"documentNumber\":\"STD-100\",\"revisionLabel\":\"1\",\"applicability\":\"All named piping within the process-water system.\",\"basis\":\"Adopted governance standard and exact upload establish the revision.\",\"governanceStandardId\":\"$GOVERNANCE_STANDARD\"}")
R_INSPECTION=$(register_doc "$INSPECTION" "{\"kind\":\"inspection_record\",\"documentNumber\":\"INSP-100\",\"revisionLabel\":\"1\",\"applicability\":\"Pump P-100 inspection at the recorded inspection date.\",\"basis\":\"Verified exact evidence item establishes controlled inspection standing.\",\"evidenceItemId\":\"$EVIDENCE\"}")
for result in "$R_DRAWING" "$R_PID" "$R_MANUAL" "$R_PROCEDURE" "$R_STANDARD" "$R_INSPECTION"; do noerr "$result"; test "$(field "$result" controlStatus)" = 'under_review'; test "$(field "$result" operationalAuthorization)" = 'false'; done

SELF=$(rpc "$CONTROLLER_AAL2" review_controlled_technical_document "{\"p_document_id\":\"$DRAWING_A\",\"p_decision\":\"effective\",\"p_basis\":\"The document controller attempts to review their own revision.\"}")
expect_error "$SELF" 'cannot review their own'
AAL1=$(rpc "$REVIEWER_AAL1" review_controlled_technical_document "{\"p_document_id\":\"$DRAWING_A\",\"p_decision\":\"effective\",\"p_basis\":\"Independent reviewer has not completed the required step-up.\"}")
expect_error "$AAL1" 'AAL2 session'
FOREIGN_REVIEW=$(rpc "$FOREIGN_AAL2" review_controlled_technical_document "{\"p_document_id\":\"$DRAWING_A\",\"p_decision\":\"effective\",\"p_basis\":\"Foreign reviewer must not see or decide this document.\"}")
expect_error "$FOREIGN_REVIEW" 'outside the active tenant'

for document in "$DRAWING_A" "$PID" "$MANUAL" "$PROCEDURE" "$STANDARD" "$INSPECTION"; do result=$(review_doc "$document"); noerr "$result"; test "$(field "$result" controlStatus)" = 'effective'; test "$(field "$result" segregationOfDuties)" = 'true'; test "$(field "$result" operationalAuthorization)" = 'false'; done

# Revision B names and atomically supersedes the current effective revision.
R_DRAWING_B=$(register_doc "$DRAWING_B" "{\"kind\":\"drawing\",\"documentNumber\":\"DWG-100\",\"revisionLabel\":\"B\",\"applicability\":\"North plant process-water system and installed pump train.\",\"basis\":\"Approved field change package establishes the replacement revision.\",\"supersedesDocumentId\":\"$DRAWING_A\"}")
noerr "$R_DRAWING_B"
DRAWING_B_REVIEW=$(review_doc "$DRAWING_B"); noerr "$DRAWING_B_REVIEW"; test "$(field "$DRAWING_B_REVIEW" supersededDocumentId)" = "$DRAWING_A"
test "$(psqlc "select string_agg(revision_label||':'||control_status,',' order by revision_label) from kb_intake_documents where organization_id='$ORG' and document_number='DWG-100';")" = 'A:superseded,B:effective'

REGISTER=$(rpc "$REVIEWER_AAL2" get_controlled_technical_document_register '{}')
noerr "$REGISTER"
BODY="$REGISTER" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['missingEffectiveKinds']==[],x
assert all(x['coverage'][kind]>=1 for kind in ('drawing','pid','manual','procedure','inspection_record','engineering_standard')),x
assert 'does not approve work' in x['decisionBoundary'],x
PY

# Direct client rewrites, database tenant moves and re-upload overwrite paths stay closed.
DIRECT=$(curl -sS -o /tmp/c209-direct.txt -w '%{http_code}' -X PATCH "$API_URL/rest/v1/kb_intake_documents?id=eq.$DRAWING_B" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $CONTROLLER_AAL1" -H 'Content-Type: application/json' -d '{"revision_label":"forged"}')
case "$DIRECT" in 401|403) ;; *) false ;; esac
OUT=$(sql_must_fail "update kb_intake_documents set organization_id='$FOREIGN_ORG' where id='$DRAWING_B';")
grep -qi 'immutable outside the governed review workflow' <<<"$OUT"
REUPLOAD_CODE=$(curl -sS -o /tmp/c209-reupload.txt -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/kb_ingest_document" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $CONTROLLER_AAL1" -H 'Content-Type: application/json' -d '{"p_source_id":"drawing-b","p_title":"Overwrite attempt","p_document_class":"client_supplied","p_chunks":[{"chunk_index":0,"content":"A controlled revision cannot be replaced by reusing its source identifier."}]}')
case "$REUPLOAD_CODE" in 400|409) ;; *) cat /tmp/c209-reupload.txt; false ;; esac
test "$(psqlc "select has_function_privilege('anon','public.guard_controlled_technical_document()','EXECUTE');")" = 'f'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='controlled_technical_document';")" = '14'

echo 'C2.09 controlled technical-document smoke passed: canonical_upload_register=true six_document_families=true named_human_only=true ai_operator_refused=true tenant_wall=true independent_aal2_effectivity=true canonical_procedure_gate=true canonical_standard_gate=true canonical_inspection_gate=true one_effective_revision=true atomic_supersession=true direct_write_locked=true reupload_locked=true audit_history=true operational_authority=false'

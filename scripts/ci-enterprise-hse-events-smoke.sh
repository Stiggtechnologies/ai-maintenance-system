#!/usr/bin/env bash
# C6.01 — governed enterprise safety and environmental event measures.
set -euo pipefail
trap 'echo "C6.01 enterprise HSE smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); WRITER=$(uuid); VERIFIER=$(uuid); AI=$(uuid); FOREIGN=$(uuid)
SITE=$(uuid); ASSET=$(uuid); FOREIGN_ASSET=$(uuid)
WRITER_FACTOR=$(uuid); VERIFIER_FACTOR=$(uuid); AI_FACTOR=$(uuid); FOREIGN_FACTOR=$(uuid)

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
insert into organizations(id,name) values
  ('$ORG','C6.01 HSE tenant'),('$FOREIGN_ORG','C6.01 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$WRITER','authenticated','authenticated','c601-writer-$WRITER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$VERIFIER','authenticated','authenticated','c601-verifier-$VERIFIER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI','authenticated','authenticated','c601-ai-$AI@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','c601-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$WRITER','$ORG','c601-writer-$WRITER@invalid.syncai.ca','HSE recorder','reliability_engineer'),
  ('$VERIFIER','$ORG','c601-verifier-$VERIFIER@invalid.syncai.ca','Independent HSE verifier','admin'),
  ('$AI','$ORG','c601-ai-$AI@invalid.syncai.ca','AI operator','ai_admin'),
  ('$FOREIGN','$FOREIGN_ORG','c601-foreign-$FOREIGN@invalid.syncai.ca','Foreign HSE recorder','admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$WRITER_FACTOR','$WRITER','CI HSE writer factor','totp','verified',now(),now()),
  ('$VERIFIER_FACTOR','$VERIFIER','CI HSE verifier factor','totp','verified',now(),now()),
  ('$AI_FACTOR','$AI','CI HSE AI factor','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','CI HSE foreign factor','totp','verified',now(),now());
insert into sites(id,organization_id,name,location) values ('$SITE','$ORG','C6.01 plant','Alberta');
insert into assets(id,organization_id,site_id,name,tag,asset_class,criticality) values
  ('$ASSET','$ORG','$SITE','C6.01 process pump','C601-P-101','pump','high'),
  ('$FOREIGN_ASSET','$FOREIGN_ORG',null,'Foreign process pump','X-C601-P','pump','high');
PSQL

WRITER_AAL1=$(jwt "$WRITER" aal1 "c601-writer-$WRITER@invalid.syncai.ca")
WRITER_AAL2=$(jwt "$WRITER" aal2 "c601-writer-$WRITER@invalid.syncai.ca")
VERIFIER_AAL2=$(jwt "$VERIFIER" aal2 "c601-verifier-$VERIFIER@invalid.syncai.ca")
AI_AAL2=$(jwt "$AI" aal2 "c601-ai-$AI@invalid.syncai.ca")
FOREIGN_AAL2=$(jwt "$FOREIGN" aal2 "c601-foreign-$FOREIGN@invalid.syncai.ca")

SOURCE_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','HSE-REGISTER','reporting_coverage','Independent confirmation that the HSE register covers the enterprise reporting period.','DOCUMENTED','verified','$VERIFIER',now(),'Independent HSE register reconciliation') returning id;")
EVENT_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','HSE-INVESTIGATION','inspection','Independent event evidence and classification review.','DOCUMENTED','verified','$VERIFIER',now(),'Independent HSE investigation review') returning id;")
FOREIGN_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$FOREIGN_ORG','$FOREIGN_ASSET','FOREIGN-HSE','inspection','Foreign tenant event evidence.','DOCUMENTED','verified','$FOREIGN',now(),'Foreign review') returning id;")
LOSS=$(psqlc "insert into containment_losses(organization_id,asset_id,occurred_at,substance,quantity,quantity_unit,tier,reached_environment,investigation_reference) values('$ORG','$ASSET',now()-interval '2 days','hydraulic oil',12,'L','tier_2',true,'C601-LOSS-1') returning id;")

OCC_EVENT="{\"eventRef\":\"C601-OCC-1\",\"expectedVersion\":0,\"status\":\"active\",\"domain\":\"occupational_safety\",\"eventType\":\"unsafe_condition\",\"actuality\":\"actual\",\"occurredAt\":\"$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ)\",\"siteId\":\"$SITE\",\"assetId\":\"$ASSET\",\"recordability\":\"pending_determination\",\"regulatoryReportability\":\"not_applicable\",\"description\":\"Observed unsafe condition at the pump coupling guard during the field inspection.\",\"sourceReference\":\"HSE-LOG-2026-001\",\"basis\":\"Named human classification from the field observation and controlled HSE log.\"}"

AAL1=$(rpc "$WRITER_AAL1" record_hse_event "{\"p_event\":$OCC_EVENT}")
expect_error "$AAL1" 'AAL2 session'
AI_DENIED=$(rpc "$AI_AAL2" record_hse_event "{\"p_event\":$OCC_EVENT}")
expect_error "$AI_DENIED" 'named human'
FOREIGN_ASSET_EVENT="${OCC_EVENT//$ASSET/$FOREIGN_ASSET}"
FOREIGN_ASSET_DENIED=$(rpc "$WRITER_AAL2" record_hse_event "{\"p_event\":$FOREIGN_ASSET_EVENT}")
expect_error "$FOREIGN_ASSET_DENIED" 'outside the active tenant'

CREATED=$(rpc "$WRITER_AAL2" record_hse_event "{\"p_event\":$OCC_EVENT}")
noerr "$CREATED"; OCC_ID=$(field "$CREATED" id)
test "$(field "$CREATED" version)" = '1'
test "$(field "$CREATED" incidentClosed)" = 'false'
test "$(field "$CREATED" workAuthorized)" = 'false'

STALE=$(rpc "$WRITER_AAL2" record_hse_event "{\"p_event\":$OCC_EVENT}")
expect_error "$STALE" 'changed after it was loaded'
OCC_V2="${OCC_EVENT/\"expectedVersion\":0/\"expectedVersion\":1}"
OCC_V2="${OCC_V2/Observed unsafe condition/Confirmed unsafe condition}"
UPDATED=$(rpc "$WRITER_AAL2" record_hse_event "{\"p_event\":$OCC_V2}")
noerr "$UPDATED"; OCC_ID=$(field "$UPDATED" id)
test "$(field "$UPDATED" version)" = '2'

ENV_EVENT="{\"eventRef\":\"C601-ENV-1\",\"expectedVersion\":0,\"status\":\"active\",\"domain\":\"environmental\",\"eventType\":\"spill_release\",\"actuality\":\"actual\",\"occurredAt\":\"$(date -u -v-2d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '2 days ago' +%Y-%m-%dT%H:%M:%SZ)\",\"siteId\":\"$SITE\",\"assetId\":\"$ASSET\",\"containmentLossId\":$LOSS,\"recordability\":\"not_applicable\",\"regulatoryReportability\":\"pending_determination\",\"description\":\"Hydraulic oil release reached the environment and is linked to the canonical loss record.\",\"sourceReference\":\"C601-LOSS-1\",\"basis\":\"Named human classification links the event to the canonical containment-loss investigation.\"}"
ENV_CREATED=$(rpc "$WRITER_AAL2" record_hse_event "{\"p_event\":$ENV_EVENT}")
noerr "$ENV_CREATED"

BEFORE=$(rpc "$WRITER_AAL2" get_enterprise_hse_workspace '{"p_window_days":30}')
BODY="$BEFORE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['metrics']['safety']['reportingCoverageComplete'] is False,x
assert x['metrics']['safety']['actualEvents'] is None,x
assert x['metrics']['environmental']['actualEvents'] is None,x
PY

START=$(date -u -v-60d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '60 days ago' +%Y-%m-%dT%H:%M:%SZ)
attest(){
  local domain="$1" ref="$2"
  rpc "$WRITER_AAL2" record_hse_reporting_source "{\"p_source\":{\"sourceRef\":\"$ref\",\"expectedVersion\":0,\"domain\":\"$domain\",\"scope\":\"enterprise\",\"sourceName\":\"Controlled enterprise HSE register\",\"sourceKind\":\"manual_register\",\"status\":\"active\",\"coverageStart\":\"$START\",\"sourceReference\":\"HSE-REGISTER-2026\",\"evidenceItemId\":\"$SOURCE_EVIDENCE\",\"basis\":\"Independent reconciliation confirms complete enterprise reporting coverage for this domain.\"}}"
}
for pair in 'occupational_safety|C601-SAFETY' 'process_safety|C601-PROCESS' 'environmental|C601-ENV'; do
  result=$(attest "${pair%%|*}" "${pair#*|}"); noerr "$result"
done

VERIFIED=$(rpc "$VERIFIER_AAL2" verify_hse_event "{\"p_event_id\":\"$OCC_ID\",\"p_evidence_item_id\":\"$EVENT_EVIDENCE\",\"p_note\":\"Independent review confirms the recorded occurrence and governed classification basis.\"}")
noerr "$VERIFIED"; test "$(field "$VERIFIED" verified)" = 'true'

AFTER=$(rpc "$WRITER_AAL2" get_enterprise_hse_workspace '{"p_window_days":30}')
BODY="$AFTER" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); m=x['metrics']
assert m['safety']['reportingCoverageComplete'] is True,m
assert m['environmental']['reportingCoverageComplete'] is True,m
assert m['safety']['actualEvents']==2,m
assert m['environmental']['actualEvents']==1,m
assert m['safety']['pendingClassification']==1,m
assert 'do not close incidents' in m['decisionBoundary'].lower(),m
PY

COMPUTED=$(psqlc "select public.compute_enterprise_hse_kpi_snapshot();")
BODY="$COMPUTED" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['kpi_values_written']>=2,x"
test "$(psqlc "select count(*) from kpi_values where organization_id='$ORG' and kpi_key in ('enterprise_safety_events_30d','enterprise_environmental_events_30d');")" = '2'
test "$(psqlc "select count(*) from kpi_catalog where kpi_key='asset_safety_incidents';")" = '0'

DIRECT=$(curl -sS -o /tmp/c601-direct.txt -w '%{http_code}' -X PATCH "$API_URL/rest/v1/hse_events?id=eq.$OCC_ID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $WRITER_AAL2" -H 'Content-Type: application/json' -d '{"description":"forged"}')
case "$DIRECT" in 401|403) ;; *) cat /tmp/c601-direct.txt; false ;; esac
OUT=$(sql_must_fail "update hse_events set description='forged' where id='$OCC_ID';")
grep -qi 'governed C6.01 functions' <<<"$OUT"
test "$(psqlc "select count(*) from hse_events where organization_id='$ORG' and event_ref='C601-OCC-1';")" = '2'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('hse_event','hse_reporting_source');")" = '7'

FOREIGN_WORKSPACE=$(rpc "$FOREIGN_AAL2" get_enterprise_hse_workspace '{"p_window_days":30}')
BODY="$FOREIGN_WORKSPACE" FOREIGN_ASSET="$FOREIGN_ASSET" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert len(x['assets'])==1 and x['assets'][0]['id']==os.environ['FOREIGN_ASSET'],x"

echo 'C6.01 enterprise HSE smoke passed: tenant_wall=true aal2_required=true ai_refused=true version_history=true independent_verification=true coverage_required_for_zero=true containment_loss_counted_once=true safety_environment_separate=true direct_write_locked=true no_operational_authority=true'

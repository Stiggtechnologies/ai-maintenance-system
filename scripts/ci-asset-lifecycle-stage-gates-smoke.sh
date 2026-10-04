#!/usr/bin/env bash
# U4.11 / U4.12 / U4.14 — governed asset lifecycle gates and disposal.
set -euo pipefail
trap 'echo "U4 lifecycle stage-gate smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); OWNER=$(uuid); VERIFIER=$(uuid); AI=$(uuid); FOREIGN=$(uuid)
SITE=$(uuid); ASSET=$(uuid); FOREIGN_ASSET=$(uuid); EVALUATION=$(uuid)
OWNER_FACTOR=$(uuid); VERIFIER_FACTOR=$(uuid); AI_FACTOR=$(uuid); FOREIGN_FACTOR=$(uuid)

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
rpc(){
  local body='{}'; if [ "$#" -ge 3 ]; then body="$3"; fi
  curl -sS -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d "$body"
}
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else None; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','U4 governed lifecycle tenant'),('$FOREIGN_ORG','U4 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$OWNER','authenticated','authenticated','u4-owner-$OWNER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$VERIFIER','authenticated','authenticated','u4-verifier-$VERIFIER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI','authenticated','authenticated','u4-ai-$AI@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','u4-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$OWNER','$ORG','u4-owner-$OWNER@invalid.syncai.ca','Lifecycle owner','admin'),
  ('$VERIFIER','$ORG','u4-verifier-$VERIFIER@invalid.syncai.ca','Independent verifier','reliability_engineer'),
  ('$AI','$ORG','u4-ai-$AI@invalid.syncai.ca','Lifecycle AI','ai_admin'),
  ('$FOREIGN','$FOREIGN_ORG','u4-foreign-$FOREIGN@invalid.syncai.ca','Foreign owner','admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$OWNER_FACTOR','$OWNER','U4 owner factor','totp','verified',now(),now()),
  ('$VERIFIER_FACTOR','$VERIFIER','U4 verifier factor','totp','verified',now(),now()),
  ('$AI_FACTOR','$AI','U4 AI factor','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','U4 foreign factor','totp','verified',now(),now());
insert into sites(id,organization_id,name,location) values('$SITE','$ORG','U4 plant','Alberta');
insert into assets(id,organization_id,site_id,name,tag,asset_class,criticality,lifecycle_status) values
  ('$ASSET','$ORG','$SITE','U4 process pump','U4-P-101','pump','high','active'),
  ('$FOREIGN_ASSET','$FOREIGN_ORG',null,'Foreign U4 pump','X-U4','pump','low','active');
insert into stage_gate_criteria(organization_id,stage_key,criterion,is_mandatory,guidance,sort_order) values
  ('$ORG','operation','A current evaluation supports leaving normal service',true,'Use accepted economic and condition evidence.',10),
  ('$ORG','life_extension','A condition assessment supports the remaining-life estimate',true,'Use current independently verified condition evidence.',10),
  ('$ORG','decommissioning','Stored energy, process inventory and hazardous materials are addressed',true,'Use make-safe and decontamination evidence.',10);
insert into lifecycle_evaluations(id,organization_id,asset_id,inputs,options,recommended,
  uncertainty_level,uncertainty_reasons,rationale,engine_version,evaluated_by,evaluated_at,
  decision,decided_by,decided_at,decision_note,register_ref)
values('$EVALUATION','$ORG','$ASSET','{"condition":"verified"}','[{"option":"repair"}]','repair',
  'moderate','["bounded history"]','Accepted life-extension basis backed by the governed asset evidence.','lifecycle/1',
  '$VERIFIER',now(),'accepted','$VERIFIER',now(),'Named human accepted the bounded life-extension evaluation.','C8.09');
PSQL

OWNER_AAL1=$(jwt "$OWNER" aal1 "u4-owner-$OWNER@invalid.syncai.ca")
OWNER_TOKEN=$(jwt "$OWNER" aal2 "u4-owner-$OWNER@invalid.syncai.ca")
AI_TOKEN=$(jwt "$AI" aal2 "u4-ai-$AI@invalid.syncai.ca")
FOREIGN_TOKEN=$(jwt "$FOREIGN" aal2 "u4-foreign-$FOREIGN@invalid.syncai.ca")

EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','U4-SMOKE','condition_assessment','Independent condition, make-safe and disposal evidence for the U4 smoke asset.','INSPECTED','verified','$VERIFIER',now(),'Independent engineering verification') returning id;")
FOREIGN_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$FOREIGN_ORG','$FOREIGN_ASSET','U4-SMOKE','condition_assessment','Foreign tenant evidence must not cross the tenant wall.','INSPECTED','verified','$FOREIGN',now(),'Foreign verification') returning id;")

INITIAL="{\"p_asset_id\":\"$ASSET\",\"p_stage_key\":\"operation\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_basis\":\"Independent evidence establishes the asset in normal operating service.\"}"
RECORDED=$(rpc "$OWNER_TOKEN" record_initial_asset_lifecycle_state "$INITIAL"); noerr "$RECORDED"

WORKSPACE=$(rpc "$OWNER_TOKEN" get_asset_lifecycle_gate_workspace "{\"p_asset_id\":\"$ASSET\"}")
BODY="$WORKSPACE" ASSET="$ASSET" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['authority']['canAct'] is True and x['authority']['requiredAal']=='aal2',x
assert len(x['assets'])==1 and x['assets'][0]['id']==os.environ['ASSET'],x
assert x['assets'][0]['stageKey']=='operation' and len(x['criteria'])==1,x
assert len(x['evidence'])==1 and len(x['evaluations'])==1,x
assert x['authority']['operationalAuthority'] is False,x
PY
FOREIGN_SCOPE=$(rpc "$OWNER_TOKEN" get_asset_lifecycle_gate_workspace "{\"p_asset_id\":\"$FOREIGN_ASSET\"}")
expect_error "$FOREIGN_SCOPE" 'outside the active tenant'
OP_CRITERION=$(psqlc "select id from stage_gate_criteria where organization_id='$ORG' and stage_key='operation';")

FINDING="[{\"criterion_id\":$OP_CRITERION,\"status\":\"met\",\"evidence_item_id\":\"$EVIDENCE\"}]"
REVIEW="{\"p_asset_id\":\"$ASSET\",\"p_to_stage\":\"life_extension\",\"p_outcome\":\"pass\",\"p_note\":\"The accepted evaluation and independent evidence support controlled life extension.\",\"p_findings\":$FINDING,\"p_evaluation_id\":\"$EVALUATION\"}"
AAL1_DENIED=$(rpc "$OWNER_AAL1" record_asset_lifecycle_gate_review "$REVIEW"); expect_error "$AAL1_DENIED" 'AAL2 session'
AI_DENIED=$(rpc "$AI_TOKEN" record_asset_lifecycle_gate_review "$REVIEW"); expect_error "$AI_DENIED" 'named lifecycle authority'
BAD_EVIDENCE="[{\"criterion_id\":$OP_CRITERION,\"status\":\"met\",\"evidence_item_id\":\"$FOREIGN_EVIDENCE\"}]"
FOREIGN_DENIED=$(rpc "$OWNER_TOKEN" record_asset_lifecycle_gate_review "{\"p_asset_id\":\"$ASSET\",\"p_to_stage\":\"life_extension\",\"p_outcome\":\"pass\",\"p_note\":\"Foreign proof must never support this tenant lifecycle decision.\",\"p_findings\":$BAD_EVIDENCE,\"p_evaluation_id\":\"$EVALUATION\"}")
expect_error "$FOREIGN_DENIED" 'independently verified'
EMPTY_DENIED=$(rpc "$OWNER_TOKEN" record_asset_lifecycle_gate_review "{\"p_asset_id\":\"$ASSET\",\"p_to_stage\":\"life_extension\",\"p_outcome\":\"pass\",\"p_note\":\"An omitted criterion must fail closed before any lifecycle movement.\",\"p_findings\":[],\"p_evaluation_id\":\"$EVALUATION\"}")
expect_error "$EMPTY_DENIED" 'every current-stage criterion exactly once'
PASSED=$(rpc "$OWNER_TOKEN" record_asset_lifecycle_gate_review "$REVIEW"); noerr "$PASSED"
BODY="$PASSED" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['mayAdvance'] is True and x['operationalAuthority'] is False and x['financialAuthority'] is False,x"

MOVED=$(rpc "$OWNER_TOKEN" advance_lifecycle_stage "{\"p_asset_id\":\"$ASSET\",\"p_to_stage\":\"life_extension\",\"p_reason\":\"The named human advances the asset against the fresh passing gate record.\"}")
BODY="$MOVED" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x[0]['outcome']=='moved',x"

LIFE_CRITERION=$(psqlc "select id from stage_gate_criteria where organization_id='$ORG' and stage_key='life_extension';")
LIFE_FINDING="[{\"criterion_id\":$LIFE_CRITERION,\"status\":\"met\",\"evidence_item_id\":\"$EVIDENCE\"}]"
LIFE_REVIEW=$(rpc "$OWNER_TOKEN" record_asset_lifecycle_gate_review "{\"p_asset_id\":\"$ASSET\",\"p_to_stage\":\"decommissioning\",\"p_outcome\":\"pass\",\"p_note\":\"Independent condition evidence supports the controlled end of extended service.\",\"p_findings\":$LIFE_FINDING,\"p_evaluation_id\":null}"); noerr "$LIFE_REVIEW"
TO_DECOM=$(rpc "$OWNER_TOKEN" advance_lifecycle_stage "{\"p_asset_id\":\"$ASSET\",\"p_to_stage\":\"decommissioning\",\"p_reason\":\"The approved lifecycle gate moves the asset into controlled decommissioning.\"}")
BODY="$TO_DECOM" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x[0]['outcome']=='moved',x"

DECOM_CRITERION=$(psqlc "select id from stage_gate_criteria where organization_id='$ORG' and stage_key='decommissioning';")
DECOM_FINDING="[{\"criterion_id\":$DECOM_CRITERION,\"status\":\"met\",\"evidence_item_id\":\"$EVIDENCE\"}]"
DECOM_REVIEW=$(rpc "$OWNER_TOKEN" record_asset_lifecycle_gate_review "{\"p_asset_id\":\"$ASSET\",\"p_to_stage\":\"disposal\",\"p_outcome\":\"pass\",\"p_note\":\"Independent make-safe evidence confirms readiness for governed disposal closeout.\",\"p_findings\":$DECOM_FINDING,\"p_evaluation_id\":null}"); noerr "$DECOM_REVIEW"
TO_DISPOSAL=$(rpc "$OWNER_TOKEN" advance_lifecycle_stage "{\"p_asset_id\":\"$ASSET\",\"p_to_stage\":\"disposal\",\"p_reason\":\"The fresh decommissioning gate supports movement into physical disposal closeout.\"}")
BODY="$TO_DISPOSAL" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x[0]['outcome']=='moved',x"

DIRECT=$(sql_must_fail "insert into disposal_records(asset_id,organization_id,disposal_route) values('$ASSET','$ORG','scrap_recycle');")
grep -qi 'RPC-only' <<<"$DIRECT"
DISPOSAL="{\"p_asset_id\":\"$ASSET\",\"p_disposal_route\":\"scrap_recycle\",\"p_disposed_at\":\"$(date +%F)\",\"p_recovered_value\":1200,\"p_disposal_cost\":300,\"p_currency\":\"CAD\",\"p_site_restoration_required\":true,\"p_site_restoration_complete\":false,\"p_restoration_obligation\":\"Remove the concrete pad and verify clean soil conditions.\",\"p_hazardous_materials_removed\":true,\"p_certificate_reference\":\"CERT-U4-001\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_expected_version\":0}"
DISPOSAL_AAL1=$(rpc "$OWNER_AAL1" record_asset_disposal "$DISPOSAL"); expect_error "$DISPOSAL_AAL1" 'AAL2 session'
RECORDED_DISPOSAL=$(rpc "$OWNER_TOKEN" record_asset_disposal "$DISPOSAL"); noerr "$RECORDED_DISPOSAL"
BODY="$RECORDED_DISPOSAL" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['version']==1 and x['operationalAuthority'] is False and x['financialAuthority'] is False,x"
STALE=$(rpc "$OWNER_TOKEN" record_asset_disposal "$DISPOSAL"); expect_error "$STALE" 'Expected version does not match'

DISPOSAL_V2="${DISPOSAL/\"p_expected_version\":0/\"p_expected_version\":1}"
UPDATED=$(rpc "$OWNER_TOKEN" record_asset_disposal "$DISPOSAL_V2"); noerr "$UPDATED"
BODY="$UPDATED" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['version']==2,x"
test "$(psqlc "select version||':'||currency||':'||site_restoration_complete from disposal_records where asset_id='$ASSET';")" = '2:CAD:false'
test "$(psqlc "select count(*) from asset_lifecycle_transitions where organization_id='$ORG' and asset_id='$ASSET' and gate_review_id is not null;")" = '3'

echo 'U4 lifecycle stage-gate smoke passed: tenant_wall=true aal2_required=true ai_operator_refused=true exact_criteria_coverage=true independent_verified_evidence=true accepted_evaluation_required=true direct_write_locked=true optimistic_disposal_version=true operational_authority=false financial_authority=false'

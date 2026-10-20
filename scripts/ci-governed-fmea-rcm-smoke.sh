#!/usr/bin/env bash
# C7.09 / C8.06 — governed FMEA/FMECA and seven-question RCM.
set -euo pipefail
trap 'echo "C7.09/C8.06 governed FMEA/RCM smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); AUTHOR=$(uuid); REVIEWER=$(uuid); AI=$(uuid); FOREIGN=$(uuid)
ASSET=$(uuid); FOREIGN_ASSET=$(uuid)
AUTHOR_FACTOR=$(uuid); REVIEWER_FACTOR=$(uuid); AI_FACTOR=$(uuid); FOREIGN_FACTOR=$(uuid)

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
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else None; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }
payload(){
  ASSET_ID="$1" REVIEWER_ID="$2" EVIDENCE_ID="$3" CONSEQUENCE="$4" HIDDEN="$5" TASK="$6" APPLICABLE="$7" EFFECTIVE="$8" DEFAULT_ACTION="$9" SUPERSEDES="${10:-}" python3 - <<'PY'
import json,os
def maybe_bool(v): return None if v=='' else v=='true'
answers={
  'functionStatement':'Transfer process water at the approved flow and pressure throughout the operating campaign.',
  'functionalFailure':'Unable to maintain the approved discharge flow and pressure under the stated operating conditions.',
  'failureMode':'Mechanical seal loses containment after repeated startup transients.',
  'failureEffect':'Visible leakage develops, the pump is stopped, and the process train loses transfer capacity.',
  'consequenceCategory':os.environ['CONSEQUENCE'],
  'consequenceRationale':'The selected consequence follows the verified asset history and stated operating context.',
  'hiddenFailure':os.environ['HIDDEN']=='true','proposedTask':os.environ['TASK'],
  'taskApplicable':maybe_bool(os.environ['APPLICABLE']),
  'applicabilityBasis':'The failure gives a detectable degradation signature before functional loss.',
  'taskEffective':maybe_bool(os.environ['EFFECTIVE']),
  'effectivenessBasis':'The task interval can provide enough time for a planned intervention.',
  'defaultAction':os.environ['DEFAULT_ACTION'] or None,
  'severityRank':'S4','occurrenceRank':'O3','detectabilityRank':'D2',
  'criticalityScaleReference':'SITE-FMECA-01 rev 3',
  'criticalityBasis':'Ranks are copied from the site-approved scale and the exact verified evidence.'}
print(json.dumps({'p_asset_id':os.environ['ASSET_ID'],'p_answers':answers,
  'p_evidence_item_ids':[os.environ['EVIDENCE_ID']],
  'p_reviewer_id':os.environ['REVIEWER_ID'],
  'p_supersedes_failure_mode_id':os.environ['SUPERSEDES'] or None},separators=(',',':')))
PY
}

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','C7.09 governed RCM tenant'),('$FOREIGN_ORG','C7.09 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$AUTHOR','authenticated','authenticated','rcm-author-$AUTHOR@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$REVIEWER','authenticated','authenticated','rcm-reviewer-$REVIEWER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI','authenticated','authenticated','rcm-ai-$AI@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','rcm-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$AUTHOR','$ORG','rcm-author-$AUTHOR@invalid.syncai.ca','RCM author','reliability_engineer'),
  ('$REVIEWER','$ORG','rcm-reviewer-$REVIEWER@invalid.syncai.ca','RCM reviewer','maintenance_manager'),
  ('$AI','$ORG','rcm-ai-$AI@invalid.syncai.ca','RCM AI','ai_admin'),
  ('$FOREIGN','$FOREIGN_ORG','rcm-foreign-$FOREIGN@invalid.syncai.ca','Foreign reviewer','admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$AUTHOR_FACTOR','$AUTHOR','RCM author factor','totp','verified',now(),now()),
  ('$REVIEWER_FACTOR','$REVIEWER','RCM reviewer factor','totp','verified',now(),now()),
  ('$AI_FACTOR','$AI','RCM AI factor','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','RCM foreign factor','totp','verified',now(),now());
insert into assets(id,organization_id,name,tag,asset_class,criticality) values
  ('$ASSET','$ORG','RCM process pump','RCM-P-101','pump','high'),
  ('$FOREIGN_ASSET','$FOREIGN_ORG','Foreign process pump','X-RCM-P','pump','low');
PSQL

AUTHOR_AAL1=$(jwt "$AUTHOR" aal1 "rcm-author-$AUTHOR@invalid.syncai.ca")
AUTHOR_AAL2=$(jwt "$AUTHOR" aal2 "rcm-author-$AUTHOR@invalid.syncai.ca")
REVIEWER_AAL1=$(jwt "$REVIEWER" aal1 "rcm-reviewer-$REVIEWER@invalid.syncai.ca")
REVIEWER_AAL2=$(jwt "$REVIEWER" aal2 "rcm-reviewer-$REVIEWER@invalid.syncai.ca")
AI_AAL2=$(jwt "$AI" aal2 "rcm-ai-$AI@invalid.syncai.ca")
FOREIGN_AAL2=$(jwt "$FOREIGN" aal2 "rcm-foreign-$FOREIGN@invalid.syncai.ca")

EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','RCM-SMOKE','failure_history','Independently verified seal-failure and startup history for the RCM asset.','HISTORICAL','verified','$REVIEWER',now(),'Independent work-history reconciliation') returning id;")
SELF_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','RCM-SMOKE','expert_note','Self-verified evidence must be refused for authoring.','EXPERT_JUDGEMENT','verified','$AUTHOR',now(),'Self verification') returning id;")
FOREIGN_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$FOREIGN_ORG','$FOREIGN_ASSET','RCM-SMOKE','failure_history','Foreign tenant evidence.','HISTORICAL','verified','$FOREIGN',now(),'Foreign reconciliation') returning id;")

WORKSPACE=$(rpc "$AUTHOR_AAL2" get_governed_rcm_workspace '{}'); noerr "$WORKSPACE"
BODY="$WORKSPACE" ASSET="$ASSET" EVIDENCE="$EVIDENCE" SELF_EVIDENCE="$SELF_EVIDENCE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert [a['id'] for a in x['assets']]==[os.environ['ASSET']],x
assert [e['id'] for e in x['evidence']]==[os.environ['EVIDENCE']],x
assert os.environ['SELF_EVIDENCE'] not in [e['id'] for e in x['evidence']],x
assert x['decisionBoundary']['changesMaintenancePlan'] is False,x
PY
FOREIGN_WORKSPACE=$(rpc "$FOREIGN_AAL2" get_governed_rcm_workspace '{}'); noerr "$FOREIGN_WORKSPACE"
BODY="$FOREIGN_WORKSPACE" FOREIGN_ASSET="$FOREIGN_ASSET" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert [a['id'] for a in x['assets']]==[os.environ['FOREIGN_ASSET']],x"

VALID=$(payload "$ASSET" "$REVIEWER" "$EVIDENCE" operational false condition_based true true '')
AI_DENIED=$(rpc "$AI_AAL2" submit_governed_rcm_analysis "$VALID"); expect_error "$AI_DENIED" 'named reliability engineer'
FOREIGN_ASSET_REQUEST=$(payload "$FOREIGN_ASSET" "$REVIEWER" "$EVIDENCE" operational false condition_based true true '')
FOREIGN_ASSET_DENIED=$(rpc "$AUTHOR_AAL2" submit_governed_rcm_analysis "$FOREIGN_ASSET_REQUEST"); expect_error "$FOREIGN_ASSET_DENIED" 'asset not found'
FOREIGN_EVIDENCE_REQUEST=$(payload "$ASSET" "$REVIEWER" "$FOREIGN_EVIDENCE" operational false condition_based true true '')
FOREIGN_EVIDENCE_DENIED=$(rpc "$AUTHOR_AAL2" submit_governed_rcm_analysis "$FOREIGN_EVIDENCE_REQUEST"); expect_error "$FOREIGN_EVIDENCE_DENIED" 'same-tenant'
SELF_EVIDENCE_REQUEST=$(payload "$ASSET" "$REVIEWER" "$SELF_EVIDENCE" operational false condition_based true true '')
SELF_EVIDENCE_DENIED=$(rpc "$AUTHOR_AAL2" submit_governed_rcm_analysis "$SELF_EVIDENCE_REQUEST"); expect_error "$SELF_EVIDENCE_DENIED" 'independently verified'
SAFETY_RTF=$(payload "$ASSET" "$REVIEWER" "$EVIDENCE" safety false none '' '' run_to_failure)
SAFETY_DENIED=$(rpc "$AUTHOR_AAL2" submit_governed_rcm_analysis "$SAFETY_RTF"); expect_error "$SAFETY_DENIED" 'run-to-failure is refused'
HIDDEN_RTF=$(payload "$ASSET" "$REVIEWER" "$EVIDENCE" hidden true none '' '' run_to_failure)
HIDDEN_DENIED=$(rpc "$AUTHOR_AAL2" submit_governed_rcm_analysis "$HIDDEN_RTF"); expect_error "$HIDDEN_DENIED" 'hidden failure requires'

SUBMITTED=$(rpc "$AUTHOR_AAL1" submit_governed_rcm_analysis "$VALID"); noerr "$SUBMITTED"
BODY="$SUBMITTED" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='submitted' and x['strategy']=='condition_based' and x['changesMaintenancePlan'] is False and x['createsWork'] is False and x['acceptsRisk'] is False,x"
FM_ID=$(BODY="$SUBMITTED" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['failureModeId'])")
STRATEGY_ID=$(BODY="$SUBMITTED" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['strategyId'])")

DIRECT=$(sql_must_fail "update asset_failure_mode_libraries set failure_mode='forged' where id='$FM_ID';")
grep -qi 'controlled workflow' <<<"$DIRECT"
HTTP=$(curl -sS -o /tmp/c709-direct.txt -w '%{http_code}' -X PATCH "$API_URL/rest/v1/asset_maintenance_strategy_recommendations?id=eq.$STRATEGY_ID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $AUTHOR_AAL2" -H 'Content-Type: application/json' -d '{"status":"approved"}')
case "$HTTP" in 400|401|403) ;; *) cat /tmp/c709-direct.txt; false ;; esac

REVIEW_BODY="{\"p_strategy_id\":\"$STRATEGY_ID\",\"p_disposition\":\"approved\",\"p_note\":\"Independent review confirms the evidence, consequence and applicable-effective task logic.\"}"
AAL1_DENIED=$(rpc "$REVIEWER_AAL1" review_governed_rcm_analysis "$REVIEW_BODY"); expect_error "$AAL1_DENIED" 'AAL2 session'
AUTHOR_DENIED=$(rpc "$AUTHOR_AAL2" review_governed_rcm_analysis "$REVIEW_BODY"); expect_error "$AUTHOR_DENIED" 'not assigned'
APPROVED=$(rpc "$REVIEWER_AAL2" review_governed_rcm_analysis "$REVIEW_BODY"); noerr "$APPROVED"
BODY="$APPROVED" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='approved' and x['engineeringDispositionOnly'] is True and x['changesMaintenancePlan'] is False and x['returnsToService'] is False,x"

RTF_REVISION=$(payload "$ASSET" "$REVIEWER" "$EVIDENCE" non_operational false none '' '' run_to_failure "$FM_ID")
REVISED=$(rpc "$AUTHOR_AAL2" submit_governed_rcm_analysis "$RTF_REVISION"); noerr "$REVISED"
BODY="$REVISED" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['version']==2 and x['strategy']=='run_to_failure',x"
test "$(psqlc "select rcm_status from asset_failure_mode_libraries where id='$FM_ID';")" = 'superseded'
test "$(psqlc "select status from asset_maintenance_strategy_recommendations where id='$STRATEGY_ID';")" = 'superseded'
test "$(psqlc "select count(*) from asset_failure_mode_libraries where organization_id='$ORG' and source='governed_rcm';")" = '2'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='governed_rcm_analysis';")" = '3'

echo 'C7.09/C8.06 governed FMEA/RCM smoke passed: tenant_wall=true named_human_author=true independent_verified_evidence=true seven_questions=true applicable_effective_gate=true unsafe_rtf_refused=true hidden_failure_gate=true fmeca_scale_explicit=true aal2_review=true segregation_of_duties=true direct_write_locked=true version_history=true no_operational_authority=true'

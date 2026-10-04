#!/usr/bin/env bash
# C6.05 — governed enterprise asset lifecycle risk.
set -euo pipefail
trap 'echo "C6.05 enterprise asset lifecycle-risk smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); OWNER=$(uuid); VERIFIER=$(uuid); VIEWER=$(uuid); AI=$(uuid); FOREIGN=$(uuid)
SITE=$(uuid); ASSET_ONE=$(uuid); ASSET_TWO=$(uuid); FOREIGN_ASSET=$(uuid)
CONTEXT=$(uuid); PROFILE_ONE=$(uuid); PROFILE_TWO=$(uuid); OBJECTIVE=$(uuid)
RISK_ONE=$(uuid); RISK_TWO=$(uuid)
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
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "${3:-{}}"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else None; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','C6.05 lifecycle-risk tenant'),
  ('$FOREIGN_ORG','C6.05 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$OWNER','authenticated','authenticated','c605-owner-$OWNER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$VERIFIER','authenticated','authenticated','c605-verifier-$VERIFIER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$VIEWER','authenticated','authenticated','c605-viewer-$VIEWER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI','authenticated','authenticated','c605-ai-$AI@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','c605-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$OWNER','$ORG','c605-owner-$OWNER@invalid.syncai.ca','Lifecycle risk owner','admin'),
  ('$VERIFIER','$ORG','c605-verifier-$VERIFIER@invalid.syncai.ca','Independent lifecycle verifier','reliability_engineer'),
  ('$VIEWER','$ORG','c605-viewer-$VIEWER@invalid.syncai.ca','Aggregate posture viewer','operator'),
  ('$AI','$ORG','c605-ai-$AI@invalid.syncai.ca','Lifecycle AI operator','ai_admin'),
  ('$FOREIGN','$FOREIGN_ORG','c605-foreign-$FOREIGN@invalid.syncai.ca','Foreign lifecycle owner','admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$OWNER_FACTOR','$OWNER','CI lifecycle owner factor','totp','verified',now(),now()),
  ('$VERIFIER_FACTOR','$VERIFIER','CI lifecycle verifier factor','totp','verified',now(),now()),
  ('$AI_FACTOR','$AI','CI lifecycle AI factor','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','CI lifecycle foreign factor','totp','verified',now(),now());
insert into sites(id,organization_id,name,location)
values('$SITE','$ORG','C6.05 plant','Alberta');
insert into assets(id,organization_id,site_id,name,tag,asset_class,criticality,lifecycle_status) values
  ('$ASSET_ONE','$ORG','$SITE','C6.05 process pump','C605-P-101','pump','high','active'),
  ('$ASSET_TWO','$ORG','$SITE','C6.05 compressor','C605-C-201','compressor','critical','active'),
  ('$FOREIGN_ASSET','$FOREIGN_ORG',null,'Foreign C6.05 asset','X-C605','pump','low','active');
insert into risk_context_nodes(id,organization_id,scope_kind,site_id,name,mission_or_service,
  objectives,stakeholders,status,version,review_date,created_by,adopted_by,adopted_at)
values('$CONTEXT','$ORG','site','$SITE','C6.05 asset lifecycle context','Sustained safe production',
  '["safe and reliable service"]','["operations","maintenance"]','adopted',1,current_date+90,'$OWNER','$OWNER',now());
insert into risk_criteria_profiles(id,organization_id,context_id,name,version,status,
  consequence_dimensions,likelihood_scale,thresholds,scoring_weights,decision_thresholds,
  risk_capacity,aggregate_rules,time_factors,tolerance_statements,basis,adopted_by,adopted_at,review_date)
values
  ('$PROFILE_ONE','$ORG','$CONTEXT','C6.05 common criteria',1,'adopted','["safety","production"]','[1,2,3,4,5]',
   '{"Very Low":20,"Low":40,"Medium":60,"High":80,"Critical":100}',
   '{"inherent":0.5,"exposure":0.1,"uncertainty":0.1,"connectivity":0.1,"velocity":0.1,"capacity":0.1}',
   '{}','{}','{"asset_aggregation":"maximum per asset then mean"}','{}','[]',
   'Named human adopted asset lifecycle-risk criteria for the bounded smoke tenant.','$OWNER',now(),current_date+90),
  ('$PROFILE_TWO','$ORG','$CONTEXT','C6.05 alternate criteria',1,'adopted','["safety","production"]','[1,2,3,4,5]',
   '{"Very Low":20,"Low":40,"Medium":60,"High":80,"Critical":100}',
   '{"inherent":0.5,"exposure":0.1,"uncertainty":0.1,"connectivity":0.1,"velocity":0.1,"capacity":0.1}',
   '{}','{}','{"asset_aggregation":"maximum per asset then mean"}','{}','[]',
   'Deliberately different adopted criteria used to prove cross-profile refusal.','$OWNER',now(),current_date+90);
insert into risk_objectives(id,organization_id,context_id,owner_id,objective_level,
  description,target,measurement,timeframe,tolerance,status,version,adopted_by,adopted_at,review_date,created_by)
values('$OBJECTIVE','$ORG','$CONTEXT','$OWNER','site',
  'Protect safe reliable lifecycle service for the governed asset population.',
  'Maintain risk within the adopted criteria and named authority.',
  'Current asset-linked risk position with complete review coverage.',
  'Asset lifecycle','No unreviewed critical lifecycle exposure.','adopted',1,'$OWNER',now(),current_date+90,'$OWNER');

insert into risks(id,organization_id,context_id,criteria_profile_id,site_id,asset_id,
  objective_id,title,kind,objective_at_risk,risk_source,event_description,causes,
  consequences,likelihood,existing_controls_summary,analysis_level,analysis_method,
  analysis_model_reference,control_effectiveness,uncertainty,confidence,complexity,
  connectivity,exposure,capacity_load,risk_velocity,time_to_unacceptable,
  inherent_risk_score,current_risk_score,current_risk_level,decision_action,
  risk_owner_id,decision_owner_id,stakeholders,review_date,scope_decision,
  scope_expected_outcome,scope_inclusions,scope_exclusions,time_horizon,location_scope,
  resource_scope,responsibility_scope,relationship_scope,assumptions,biases,
  bias_review_complete,method_limitations,data_quality,reporting_profile,
  information_sensitivity,status,source_kind,created_by)
values('$RISK_ONE','$ORG','$CONTEXT','$PROFILE_ONE','$SITE','$ASSET_ONE','$OBJECTIVE',
  'Pump lifecycle loss of service','threat','Safe reliable production service',
  'Governed condition and work-history evidence','Loss of pump function during required service.',
  '["degradation","control failure"]','{"safety":4,"production":4}',3,
  'Current inspection and maintenance controls are recorded and subject to review.',
  'semi_quantitative','adopted risk matrix','C6.05-SMOKE-MODEL',65,20,80,40,30,60,10,10,
  interval '180 days',78,72,'High','TREAT','$OWNER','$OWNER','["operations","maintenance"]',
  current_date+30,'Decide whether lifecycle treatment is required.',
  'Maintain service within adopted risk criteria.','["asset lifecycle"]','["portfolio opportunities"]',
  'Remaining operating life','C6.05 plant','["maintenance capacity"]','["risk owner"]',
  '["operation","maintenance","replacement"]','["recorded duty remains representative"]',
  '["availability bias reviewed"]',true,'["semi-quantitative model"]','controlled',
  '{"audiences":["executive"],"frequency":"monthly","method":"in-app","timeliness":"current","cost_limit":0}',
  'restricted','evaluated','human','$OWNER');
PSQL

OWNER_AAL1=$(jwt "$OWNER" aal1 "c605-owner-$OWNER@invalid.syncai.ca")
OWNER_TOKEN=$(jwt "$OWNER" aal2 "c605-owner-$OWNER@invalid.syncai.ca")
VIEWER_TOKEN=$(jwt "$VIEWER" aal1 "c605-viewer-$VIEWER@invalid.syncai.ca")
AI_TOKEN=$(jwt "$AI" aal2 "c605-ai-$AI@invalid.syncai.ca")
FOREIGN_TOKEN=$(jwt "$FOREIGN" aal2 "c605-foreign-$FOREIGN@invalid.syncai.ca")

EVIDENCE_ONE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET_ONE','ASSET-REGISTER','commissioning','Independent commissioning dossier establishes the pump lifecycle state.','DOCUMENTED','verified','$VERIFIER',now(),'Independent asset-register reconciliation') returning id;")
EVIDENCE_TWO=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET_TWO','ASSET-REGISTER','operating_record','Independent operating record establishes the compressor lifecycle state.','DOCUMENTED','verified','$VERIFIER',now(),'Independent asset-register reconciliation') returning id;")

OPTIONS=$(rpc "$OWNER_TOKEN" get_initial_asset_lifecycle_state_options)
BODY="$OPTIONS" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['canRecord'] is True and x['requiredAal']=='aal2',x
assert len(x['assets'])==2 and len(x['evidence'])==2,x
assert any(s['stageKey']=='operation' for s in x['stages']),x
PY

INITIAL_ONE="{\"p_asset_id\":\"$ASSET_ONE\",\"p_stage_key\":\"operation\",\"p_evidence_item_id\":\"$EVIDENCE_ONE\",\"p_basis\":\"Independent commissioning evidence establishes current operation for this asset.\"}"
AAL1_DENIED=$(rpc "$OWNER_AAL1" record_initial_asset_lifecycle_state "$INITIAL_ONE")
expect_error "$AAL1_DENIED" 'AAL2 session'
AI_DENIED=$(rpc "$AI_TOKEN" record_initial_asset_lifecycle_state "$INITIAL_ONE")
expect_error "$AI_DENIED" 'named administrator'
FOREIGN_DENIED="{\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_stage_key\":\"operation\",\"p_evidence_item_id\":\"$EVIDENCE_ONE\",\"p_basis\":\"Attempted foreign asset lifecycle state must remain outside this tenant.\"}"
FOREIGN_SCOPE=$(rpc "$OWNER_TOKEN" record_initial_asset_lifecycle_state "$FOREIGN_DENIED")
expect_error "$FOREIGN_SCOPE" 'outside the active tenant'
DIRECT=$(sql_must_fail "insert into asset_lifecycle_state(asset_id,organization_id,stage_key) values('$ASSET_ONE','$ORG','operation');")
grep -qi 'RPC-only' <<<"$DIRECT"

RECORDED_ONE=$(rpc "$OWNER_TOKEN" record_initial_asset_lifecycle_state "$INITIAL_ONE")
noerr "$RECORDED_ONE"
test "$(psqlc "select basis_evidence_item_id from asset_lifecycle_state where asset_id='$ASSET_ONE';")" = "$EVIDENCE_ONE"

PARTIAL=$(rpc "$OWNER_TOKEN" get_enterprise_asset_lifecycle_risk)
BODY="$PARTIAL" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['detailAccess'] is True,x
assert x['index']['indexComputable'] is False,x
assert x['index']['value'] is None,x
assert x['coverage']['assets']==2,x
assert x['coverage']['assetsWithoutCurrentLifecycle']==1,x
assert x['coverage']['assetsWithoutCurrentRisk']==1,x
PY

AGGREGATE=$(rpc "$VIEWER_TOKEN" get_enterprise_asset_lifecycle_risk)
BODY="$AGGREGATE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['detailAccess'] is False,x
assert x['assets']==[],x
assert 'aggregate lifecycle-risk posture only' in x['detailRestriction'].lower(),x
PY

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into risks(id,organization_id,context_id,criteria_profile_id,site_id,asset_id,
  objective_id,title,kind,objective_at_risk,risk_source,event_description,causes,
  consequences,likelihood,existing_controls_summary,analysis_level,analysis_method,
  analysis_model_reference,control_effectiveness,uncertainty,confidence,complexity,
  connectivity,exposure,capacity_load,risk_velocity,time_to_unacceptable,
  inherent_risk_score,current_risk_score,current_risk_level,decision_action,
  risk_owner_id,decision_owner_id,stakeholders,review_date,scope_decision,
  scope_expected_outcome,scope_inclusions,scope_exclusions,time_horizon,location_scope,
  resource_scope,responsibility_scope,relationship_scope,assumptions,biases,
  bias_review_complete,method_limitations,data_quality,reporting_profile,
  information_sensitivity,status,source_kind,created_by)
values('$RISK_TWO','$ORG','$CONTEXT','$PROFILE_ONE','$SITE','$ASSET_TWO','$OBJECTIVE',
  'Compressor lifecycle loss of service','threat','Safe reliable production service',
  'Governed inspection and work-history evidence','Loss of compressor function during required service.',
  '["degradation","duty excursion"]','{"safety":2,"production":3}',2,
  'Current inspection and maintenance controls are recorded and subject to review.',
  'semi_quantitative','adopted risk matrix','C6.05-SMOKE-MODEL',70,15,85,30,20,40,5,5,
  interval '365 days',50,44,'Medium','MONITOR','$OWNER','$OWNER','["operations","maintenance"]',
  current_date+30,'Decide whether lifecycle treatment is required.',
  'Maintain service within adopted risk criteria.','["asset lifecycle"]','["portfolio opportunities"]',
  'Remaining operating life','C6.05 plant','["maintenance capacity"]','["risk owner"]',
  '["operation","maintenance","replacement"]','["recorded duty remains representative"]',
  '["availability bias reviewed"]',true,'["semi-quantitative model"]','controlled',
  '{"audiences":["executive"],"frequency":"monthly","method":"in-app","timeliness":"current","cost_limit":0}',
  'internal','evaluated','human','$OWNER');
PSQL

INITIAL_TWO="{\"p_asset_id\":\"$ASSET_TWO\",\"p_stage_key\":\"operation\",\"p_evidence_item_id\":\"$EVIDENCE_TWO\",\"p_basis\":\"Independent operating evidence establishes current operation for this asset.\"}"
RECORDED_TWO=$(rpc "$OWNER_TOKEN" record_initial_asset_lifecycle_state "$INITIAL_TWO")
noerr "$RECORDED_TWO"
REPEAT_DENIED=$(rpc "$OWNER_TOKEN" record_initial_asset_lifecycle_state "$INITIAL_TWO")
expect_error "$REPEAT_DENIED" 'already exists'

COMPLETE=$(rpc "$OWNER_TOKEN" get_enterprise_asset_lifecycle_risk)
BODY="$COMPLETE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['index']['indexComputable'] is True,x
assert float(x['index']['value'])==58.0,x
assert x['coverage']['assetsWithoutCurrentRisk']==0,x
assert x['coverage']['distinctCriteriaProfiles']==1,x
assert len(x['assets'])==2,x
second=next(a for a in x['assets'] if a['name']=='C6.05 compressor')
assert second['condition'] is None and second['economics'] is None,x
assert 'current independently verified condition evidence missing' in second['evidenceGaps'],x
assert 'governed economic evidence missing' in second['evidenceGaps'],x
assert 'accept risk' in x['decisionBoundary'].lower(),x
PY

psqlc "update risks set criteria_profile_id='$PROFILE_TWO' where id='$RISK_TWO';" >/dev/null
CROSS_PROFILE=$(rpc "$OWNER_TOKEN" get_enterprise_asset_lifecycle_risk)
BODY="$CROSS_PROFILE" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['index']['indexComputable'] is False and x['coverage']['distinctCriteriaProfiles']==2,x"
psqlc "update risks set criteria_profile_id='$PROFILE_ONE' where id='$RISK_TWO';" >/dev/null

FIRST_KPI=$(psqlc "select public.compute_enterprise_asset_lifecycle_risk_kpi_snapshot();")
BODY="$FIRST_KPI" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['kpi_values_written']>=1,x"
test "$(psqlc "select value from kpi_values where organization_id='$ORG' and kpi_key='asset_risk_index';")" = '58.0'

psqlc "update risks set review_date=current_date-1 where id='$RISK_ONE';" >/dev/null
STALE=$(rpc "$OWNER_TOKEN" get_enterprise_asset_lifecycle_risk)
BODY="$STALE" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['index']['indexComputable'] is False and x['coverage']['staleOrUndatedRiskRecords']==1,x"
SECOND_KPI=$(psqlc "select public.compute_enterprise_asset_lifecycle_risk_kpi_snapshot();")
BODY="$SECOND_KPI" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['kpi_values_written']==0,x"
test "$(psqlc "select count(*) from kpi_values where organization_id='$ORG' and kpi_key='asset_risk_index';")" = '0'

FOREIGN_POSITION=$(rpc "$FOREIGN_TOKEN" get_enterprise_asset_lifecycle_risk)
BODY="$FOREIGN_POSITION" FOREIGN_ASSET="$FOREIGN_ASSET" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['coverage']['assets']==1,x
assert len(x['assets'])==1 and x['assets'][0]['id']==os.environ['FOREIGN_ASSET'],x
assert all(a['name']!='C6.05 process pump' for a in x['assets']),x
PY

test "$(psqlc "select count(*) from lifecycle_evaluations where organization_id='$ORG';")" = '0'
test "$(psqlc "select count(*) from risk_acceptances where organization_id='$ORG';")" = '0'

echo 'C6.05 enterprise asset lifecycle-risk smoke passed: tenant_wall=true full_coverage_required=true common_criteria_required=true fresh_review_required=true canonical_risk_score_reused=true unknowns_preserved=true sensitive_detail_restricted=true stale_snapshot_removed=true governed_lifecycle_writer=true independent_evidence_required=true aal2_required=true ai_refused=true direct_write_locked=true no_decision_authority=true'

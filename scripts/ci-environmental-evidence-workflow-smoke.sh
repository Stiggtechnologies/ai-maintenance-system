#!/usr/bin/env bash
# E10.01/E10.07/E10.08 — governed environmental evidence workflow.
set -euo pipefail
trap 'echo "E10 environmental evidence smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); WRITER=$(uuid); VERIFIER=$(uuid); AI=$(uuid); FOREIGN=$(uuid)
ASSET=$(uuid); FOREIGN_ASSET=$(uuid); SITE=$(uuid); WRITER_FACTOR=$(uuid); AI_FACTOR=$(uuid); FOREIGN_FACTOR=$(uuid)
TODAY=$(python3 -c 'from datetime import date; print(date.today().isoformat())')
YESTERDAY=$(python3 -c 'from datetime import date,timedelta; print((date.today()-timedelta(days=1)).isoformat())')

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
  ('$ORG','E10 environmental tenant'),('$FOREIGN_ORG','E10 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$WRITER','authenticated','authenticated','e10-writer-$WRITER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$VERIFIER','authenticated','authenticated','e10-verifier-$VERIFIER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI','authenticated','authenticated','e10-ai-$AI@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','e10-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$WRITER','$ORG','e10-writer-$WRITER@invalid.syncai.ca','Environmental evidence writer','reliability_engineer'),
  ('$VERIFIER','$ORG','e10-verifier-$VERIFIER@invalid.syncai.ca','Environmental evidence verifier','admin'),
  ('$AI','$ORG','e10-ai-$AI@invalid.syncai.ca','AI operator','ai_admin'),
  ('$FOREIGN','$FOREIGN_ORG','e10-foreign-$FOREIGN@invalid.syncai.ca','Foreign administrator','admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$WRITER_FACTOR','$WRITER','CI environment factor','totp','verified',now(),now()),
  ('$AI_FACTOR','$AI','CI AI factor','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','CI foreign factor','totp','verified',now(),now());
insert into sites(id,organization_id,name,location) values('$SITE','$ORG','North plant','Alberta');
insert into assets(id,organization_id,site_id,name,tag,asset_class,criticality) values
  ('$ASSET','$ORG','$SITE','Process pump P-101','E10-P-101','pump','high'),
  ('$FOREIGN_ASSET','$FOREIGN_ORG',null,'Foreign process pump','X-E10-P','pump','high');
PSQL

WRITER_AAL1=$(jwt "$WRITER" aal1 "e10-writer-$WRITER@invalid.syncai.ca")
WRITER_AAL2=$(jwt "$WRITER" aal2 "e10-writer-$WRITER@invalid.syncai.ca")
AI_AAL2=$(jwt "$AI" aal2 "e10-ai-$AI@invalid.syncai.ca")
FOREIGN_AAL2=$(jwt "$FOREIGN" aal2 "e10-foreign-$FOREIGN@invalid.syncai.ca")

GLOBAL_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','REGULATOR-2026','environmental_factor','Published stationary-diesel factor reviewed for exact units and period.','DOCUMENTED','verified','$VERIFIER',now(),'Independent environmental review') returning id;")
ASSET_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','FIELD-SHEET-2026','environmental_measurement','Verified clean test, meter reading and seal-loss field sheet.','OBSERVED','verified','$VERIFIER',now(),'Independent field-sheet review') returning id;")
SELF_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','SELF','environmental_measurement','Self-verified environmental evidence.','OBSERVED','verified','$WRITER',now(),'Self review') returning id;")
AI_VERIFIED_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','AI-VERIFY','environmental_measurement','Evidence marked verified by the AI operator.','OBSERVED','verified','$AI',now(),'AI review must not grant authority') returning id;")
FOREIGN_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$FOREIGN_ORG','$FOREIGN_ASSET','FOREIGN','environmental_measurement','Foreign environmental evidence.','OBSERVED','verified','$FOREIGN',now(),'Foreign review') returning id;")

BASELINE="{\"assetId\":\"$ASSET\",\"metric\":\"specific energy\",\"unit\":\"kWh/m3\",\"designValue\":1.2,\"establishedOn\":\"$YESTERDAY\",\"interventionCost\":5000,\"energyCostPerDay\":120,\"expectedVersion\":0,\"basis\":\"Verified clean-condition test at the approved stable production duty.\",\"sourceReference\":\"TEST-E10-001\",\"evidenceItemId\":\"$ASSET_EVIDENCE\"}"

AAL1=$(rpc "$WRITER_AAL1" record_environmental_evidence "{\"p_kind\":\"efficiency_baseline\",\"p_record\":$BASELINE}")
expect_error "$AAL1" 'AAL2 session'
AI_DENIED=$(rpc "$AI_AAL2" record_environmental_evidence "{\"p_kind\":\"efficiency_baseline\",\"p_record\":$BASELINE}")
expect_error "$AI_DENIED" 'ai_admin'
SELF_PAYLOAD="${BASELINE//$ASSET_EVIDENCE/$SELF_EVIDENCE}"
SELF_DENIED=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"efficiency_baseline\",\"p_record\":$SELF_PAYLOAD}")
expect_error "$SELF_DENIED" 'independently verified'
AI_VERIFIED_PAYLOAD="${BASELINE//$ASSET_EVIDENCE/$AI_VERIFIED_EVIDENCE}"
AI_VERIFIER_DENIED=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"efficiency_baseline\",\"p_record\":$AI_VERIFIED_PAYLOAD}")
expect_error "$AI_VERIFIER_DENIED" 'independently verified'
FOREIGN_PAYLOAD="${BASELINE//$ASSET/$FOREIGN_ASSET}"
FOREIGN_PAYLOAD="${FOREIGN_PAYLOAD//$ASSET_EVIDENCE/$FOREIGN_EVIDENCE}"
FOREIGN_DENIED=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"efficiency_baseline\",\"p_record\":$FOREIGN_PAYLOAD}")
expect_error "$FOREIGN_DENIED" 'outside the active tenant'

FACTOR=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"emission_factor\",\"p_record\":{\"factorKey\":\"diesel_stationary\",\"label\":\"Stationary diesel combustion\",\"activityUnit\":\"L\",\"factor\":2.7,\"factorUnit\":\"kg CO2e/L\",\"validFrom\":\"$YESTERDAY\",\"gwp\":null,\"basis\":\"Published factor transcribed exactly for the governed reporting period.\",\"sourceReference\":\"REGULATOR-2026\",\"evidenceItemId\":\"$GLOBAL_EVIDENCE\"}}")
noerr "$FACTOR"
BASE_CREATED=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"efficiency_baseline\",\"p_record\":$BASELINE}")
noerr "$BASE_CREATED"; BASELINE_ID=$(field "$BASE_CREATED" id); test "$(field "$BASE_CREATED" version)" = '1'
READING=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"efficiency_reading\",\"p_record\":{\"baselineId\":$BASELINE_ID,\"measuredOn\":\"$TODAY\",\"value\":1.35,\"basis\":\"Meter total and throughput were reconciled for the completed operating day.\",\"sourceReference\":\"METER-E10-001\",\"evidenceItemId\":\"$ASSET_EVIDENCE\"}}")
noerr "$READING"
LOSS=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"environmental_activity\",\"p_record\":{\"siteId\":\"$SITE\",\"assetId\":\"$ASSET\",\"activityKind\":\"lubricant_loss\",\"periodStart\":\"$TODAY\",\"periodEnd\":\"$TODAY\",\"quantity\":18,\"unit\":\"L\",\"substance\":\"ISO VG 46 hydraulic oil\",\"factorKey\":null,\"scope\":null,\"maintenanceAttributable\":true,\"note\":\"Seal leak recovered and top-up reconciled.\",\"basis\":\"Measured recovered volume and reservoir top-up after the verified seal leak.\",\"sourceReference\":\"INC-E10-001\",\"evidenceItemId\":\"$ASSET_EVIDENCE\"}}")
noerr "$LOSS"; test "$(field "$LOSS" complianceCertified)" = 'false'; test "$(field "$LOSS" workAuthorized)" = 'false'
HAZARD=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"hazardous_inventory\",\"p_record\":{\"inventoryRef\":\"BAT-E10-001\",\"expectedVersion\":0,\"assetId\":\"$ASSET\",\"substance\":\"Lithium iron phosphate battery\",\"category\":\"battery\",\"quantity\":2,\"unit\":\"each\",\"location\":\"Electrical room ER-1\",\"handlingRequirements\":\"Isolate terminals, prevent short circuit and use the approved fire-response procedure.\",\"emergencyResponseReference\":\"ERP-BAT-04\",\"regulatoryReference\":\"TDG-BATTERY\",\"disposalRouteRequired\":\"Approved battery recycler\",\"endOfLifePlanned\":true,\"basis\":\"Verified equipment register and controlled handling procedure for installed batteries.\",\"sourceReference\":\"BAT-REGISTER-2026\",\"evidenceItemId\":\"$ASSET_EVIDENCE\"}}")
noerr "$HAZARD"; test "$(field "$HAZARD" version)" = '1'; test "$(field "$HAZARD" reportableInventory)" = 'false'

STALE=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"efficiency_baseline\",\"p_record\":$BASELINE}")
expect_error "$STALE" 'changed after it was loaded'
FACTOR_SCOPE=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"environmental_activity\",\"p_record\":{\"activityKind\":\"fuel_burn\",\"periodStart\":\"$TODAY\",\"periodEnd\":\"$TODAY\",\"quantity\":10,\"unit\":\"L\",\"factorKey\":\"diesel_stationary\",\"scope\":null,\"basis\":\"Verified fuel issue for the governed stationary equipment operating period.\",\"sourceReference\":\"FUEL-E10-001\",\"evidenceItemId\":\"$GLOBAL_EVIDENCE\"}}")
expect_error "$FACTOR_SCOPE" 'explicit scope'
FACTOR_UNIT=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"environmental_activity\",\"p_record\":{\"activityKind\":\"fuel_burn\",\"periodStart\":\"$TODAY\",\"periodEnd\":\"$TODAY\",\"quantity\":10,\"unit\":\"kg\",\"factorKey\":\"diesel_stationary\",\"scope\":\"scope_1\",\"basis\":\"Verified fuel issue deliberately expressed in a mismatched activity unit.\",\"sourceReference\":\"FUEL-E10-002\",\"evidenceItemId\":\"$GLOBAL_EVIDENCE\"}}")
expect_error "$FACTOR_UNIT" 'same activity unit'
INCOMPLETE_HAZARD=$(rpc "$WRITER_AAL2" record_environmental_evidence "{\"p_kind\":\"hazardous_inventory\",\"p_record\":{\"inventoryRef\":\"BAT-E10-002\",\"expectedVersion\":0,\"assetId\":\"$ASSET\",\"substance\":\"Lithium battery\",\"category\":\"battery\",\"quantity\":1,\"unit\":\"each\",\"location\":\"\",\"handlingRequirements\":\"Isolate terminals and follow the controlled handling procedure.\",\"emergencyResponseReference\":\"\",\"regulatoryReference\":\"\",\"disposalRouteRequired\":\"\",\"endOfLifePlanned\":false,\"basis\":\"Deliberately incomplete hazardous-material control record for refusal proof.\",\"sourceReference\":\"BAT-REGISTER-2026\",\"evidenceItemId\":\"$ASSET_EVIDENCE\"}}")
expect_error "$INCOMPLETE_HAZARD" 'controlled location'

WORKSPACE=$(rpc "$WRITER_AAL2" get_environmental_evidence_workspace '{}')
noerr "$WORKSPACE"
BODY="$WORKSPACE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['canRecord'] is True,x
assert len(x['baselines'])==1,x
assert len(x['emissionFactors'])==1,x
assert len(x['hazardousInventory'])==1,x
assert 'do not certify compliance' in x['decisionBoundary'],x
PY
LOSSES=$(rpc "$WRITER_AAL2" get_environmental_loss_records '{}')
BODY="$LOSSES" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert len(x)==1 and x[0]['substance']=='ISO VG 46 hydraulic oil' and x[0]['attributedToMaintenance'] is True,x"

OUT=$(sql_must_fail "insert into environmental_activities(organization_id,activity_kind,period_start,period_end,quantity,unit) values('$ORG','chemical_loss',current_date,current_date,1,'L');")
grep -qi 'governed E10 writer' <<<"$OUT"
OUT=$(sql_must_fail "update efficiency_baselines set design_value=1 where id=$BASELINE_ID;")
grep -qi 'governed E10 writer' <<<"$OUT"
OUT=$(sql_must_fail "truncate environmental_activities;")
grep -qi 'cannot be truncated' <<<"$OUT"
test "$(psqlc "select has_function_privilege('authenticated','public.guard_environmental_evidence_write()','EXECUTE');")" = 'f'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='environmental_evidence';")" = '5'

# A foreign actor can use the same governed door only for the foreign tenant.
FOREIGN_RESULT=$(rpc "$FOREIGN_AAL2" get_environmental_evidence_workspace '{}')
BODY="$FOREIGN_RESULT" FOREIGN_ASSET="$FOREIGN_ASSET" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert len(x['assets'])==1 and x['assets'][0]['id']==os.environ['FOREIGN_ASSET'],x"

echo 'E10 environmental evidence smoke passed: canonical_tables=true tenant_wall=true aal2_required=true ai_operator_refused=true ai_verifier_refused=true independent_evidence=true factor_unit_locked=true hazardous_controls_complete=true optimistic_version=true append_only_history=true direct_write_locked=true loss_summary_reachable=true compliance_certified=false reportable_inventory=false authority_granted=false'

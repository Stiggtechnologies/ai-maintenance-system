#!/usr/bin/env bash
# C2.10 — governed asset economics and canonical lifecycle capital plans.
set -euo pipefail
trap 'echo "C2.10 asset-economics smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" "${JWT_SECRET:?missing JWT_SECRET}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid); WRITER=$(uuid); VERIFIER=$(uuid); AI=$(uuid); FOREIGN=$(uuid)
ASSET=$(uuid); ASSET_TWO=$(uuid); FOREIGN_ASSET=$(uuid); WRITER_FACTOR=$(uuid); AI_FACTOR=$(uuid); FOREIGN_FACTOR=$(uuid)
EFFECTIVE=$(python3 -c 'from datetime import date; print(date.today().isoformat())')
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
insert into organizations(id,name) values
  ('$ORG','C2.10 economics tenant'),('$FOREIGN_ORG','C2.10 foreign tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$WRITER','authenticated','authenticated','c210-writer-$WRITER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$VERIFIER','authenticated','authenticated','c210-verifier-$VERIFIER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI','authenticated','authenticated','c210-ai-$AI@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','c210-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$WRITER','$ORG','c210-writer-$WRITER@invalid.syncai.ca','Economics writer','reliability_engineer'),
  ('$VERIFIER','$ORG','c210-verifier-$VERIFIER@invalid.syncai.ca','Evidence verifier','admin'),
  ('$AI','$ORG','c210-ai-$AI@invalid.syncai.ca','AI operator','ai_admin'),
  ('$FOREIGN','$FOREIGN_ORG','c210-foreign-$FOREIGN@invalid.syncai.ca','Foreign administrator','admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$WRITER_FACTOR','$WRITER','CI economics factor','totp','verified',now(),now()),
  ('$AI_FACTOR','$AI','CI AI factor','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','CI foreign factor','totp','verified',now(),now());
insert into assets(id,organization_id,name,tag,asset_class,criticality) values
  ('$ASSET','$ORG','Process pump P-101','C210-P-101','Process Pump','high'),
  ('$ASSET_TWO','$ORG','Process pump P-102','C210-P-102','Process Pump','medium'),
  ('$FOREIGN_ASSET','$FOREIGN_ORG','Foreign process pump','X-C210-P','Process Pump','high');
PSQL

WRITER_AAL1=$(jwt "$WRITER" aal1 "c210-writer-$WRITER@invalid.syncai.ca")
WRITER_AAL2=$(jwt "$WRITER" aal2 "c210-writer-$WRITER@invalid.syncai.ca")
AI_AAL2=$(jwt "$AI" aal2 "c210-ai-$AI@invalid.syncai.ca")
FOREIGN_AAL2=$(jwt "$FOREIGN" aal2 "c210-foreign-$FOREIGN@invalid.syncai.ca")

EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','ERP-2026','economic_estimate','Verified asset replacement and maintenance estimate.','DOCUMENTED','verified','$VERIFIER',now(),'Independent finance and engineering review') returning id;")
SELF_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','$ASSET','ERP-SELF','economic_estimate','Self-verified economics evidence.','DOCUMENTED','verified','$WRITER',now(),'Self review') returning id;")
CLASS_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$ORG','ERP-CLASS','economic_estimate','Verified pump-class maintenance estimate.','DOCUMENTED','verified','$VERIFIER',now(),'Independent class estimate review') returning id;")
FOREIGN_EVIDENCE=$(psqlc "insert into evidence_items(organization_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method) values('$FOREIGN_ORG','$FOREIGN_ASSET','ERP-FOREIGN','economic_estimate','Foreign economics evidence.','DOCUMENTED','verified','$FOREIGN',now(),'Foreign review') returning id;")
psqlc "insert into capital_plan_items(organization_id,plan_year,label,cost,mandatory,mandatory_basis) values('$ORG',extract(year from current_date)::int+1,'P-101 lifecycle renewal',2000000,true,'Statutory and reliability renewal basis.');" >/dev/null

PAYLOAD="{\"assetId\":\"$ASSET\",\"assetClass\":null,\"replacementValueUsd\":1200000,\"annualMaintenanceCostUsd\":95000,\"downtimeCostPerHourUsd\":null,\"expectedRepairCostUsd\":70000,\"expectedRepairHours\":36,\"expectedRemainingLifeYears\":8,\"basis\":\"Approved lifecycle estimate tied to the verified canonical evidence.\",\"sourceSystem\":\"ERP-2026\",\"evidenceItemId\":\"$EVIDENCE\",\"effectiveFrom\":\"$EFFECTIVE\",\"reviewDue\":\"$REVIEW\",\"expectedVersion\":0}"

AAL1=$(rpc "$WRITER_AAL1" record_asset_economics_snapshot "{\"p_snapshot\":$PAYLOAD}")
expect_error "$AAL1" 'AAL2 session'
AI_DENIED=$(rpc "$AI_AAL2" record_asset_economics_snapshot "{\"p_snapshot\":$PAYLOAD}")
expect_error "$AI_DENIED" 'AI operator is refused'
FOREIGN_DENIED=$(rpc "$FOREIGN_AAL2" record_asset_economics_snapshot "{\"p_snapshot\":$PAYLOAD}")
expect_error "$FOREIGN_DENIED" 'outside the active tenant'

SELF_PAYLOAD="${PAYLOAD//$EVIDENCE/$SELF_EVIDENCE}"
SELF_DENIED=$(rpc "$WRITER_AAL2" record_asset_economics_snapshot "{\"p_snapshot\":$SELF_PAYLOAD}")
expect_error "$SELF_DENIED" 'independently verified'
FOREIGN_PAYLOAD="${PAYLOAD//$EVIDENCE/$FOREIGN_EVIDENCE}"
FOREIGN_EVIDENCE_DENIED=$(rpc "$WRITER_AAL2" record_asset_economics_snapshot "{\"p_snapshot\":$FOREIGN_PAYLOAD}")
expect_error "$FOREIGN_EVIDENCE_DENIED" 'same-tenant verified canonical evidence'
EMPTY=$(rpc "$WRITER_AAL2" record_asset_economics_snapshot "{\"p_snapshot\":{\"assetId\":\"$ASSET\",\"basis\":\"Unknown values must remain explicit rather than becoming zero.\",\"sourceSystem\":\"ERP\",\"evidenceItemId\":\"$EVIDENCE\",\"effectiveFrom\":\"$EFFECTIVE\",\"expectedVersion\":0}}")
expect_error "$EMPTY" 'at least one known economic input'

CREATED=$(rpc "$WRITER_AAL2" record_asset_economics_snapshot "{\"p_snapshot\":$PAYLOAD}")
noerr "$CREATED"
test "$(field "$CREATED" version)" = '1'
test "$(field "$CREATED" expenditureAuthorized)" = 'false'
test "$(field "$CREATED" workAuthorized)" = 'false'
test "$(psqlc "select case when downtime_cost_per_hour_usd is null then 'unknown' else 'invented' end from asset_economics where organization_id='$ORG' and asset_id='$ASSET';")" = 'unknown'

STALE=$(rpc "$WRITER_AAL2" record_asset_economics_snapshot "{\"p_snapshot\":$PAYLOAD}")
expect_error "$STALE" 'changed after it was loaded'
UPDATED_PAYLOAD="${PAYLOAD/\"downtimeCostPerHourUsd\":null/\"downtimeCostPerHourUsd\":4500}"
UPDATED_PAYLOAD="${UPDATED_PAYLOAD/\"expectedVersion\":0/\"expectedVersion\":1}"
UPDATED=$(rpc "$WRITER_AAL2" record_asset_economics_snapshot "{\"p_snapshot\":$UPDATED_PAYLOAD}")
noerr "$UPDATED"; test "$(field "$UPDATED" version)" = '2'

CLASS_PAYLOAD="{\"assetId\":null,\"assetClass\":\"Process Pump\",\"replacementValueUsd\":null,\"annualMaintenanceCostUsd\":50000,\"downtimeCostPerHourUsd\":null,\"expectedRepairCostUsd\":null,\"expectedRepairHours\":null,\"expectedRemainingLifeYears\":null,\"basis\":\"Approved pump-class maintenance estimate for fallback coverage only.\",\"sourceSystem\":\"ERP-CLASS\",\"evidenceItemId\":\"$CLASS_EVIDENCE\",\"effectiveFrom\":\"$EFFECTIVE\",\"reviewDue\":null,\"expectedVersion\":0}"
CLASS_CREATED=$(rpc "$WRITER_AAL2" record_asset_economics_snapshot "{\"p_snapshot\":$CLASS_PAYLOAD}")
noerr "$CLASS_CREATED"; test "$(field "$CLASS_CREATED" scope)" = 'asset_class'

# Prove the governed class snapshot is not merely visible in the new workspace:
# the pre-existing lifecycle engine must consume it under the exact canonical
# class identity too.
LIFECYCLE=$(rpc "$WRITER_AAL2" get_lifecycle_inputs "{\"p_asset_id\":\"$ASSET_TWO\"}")
noerr "$LIFECYCLE"
BODY="$LIFECYCLE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['economics']['annualMaintenanceCostUsd']==50000,x
assert x['economics_basis'].startswith('Approved pump-class'),x
PY

WORKSPACE=$(rpc "$WRITER_AAL2" get_asset_economics_workspace '{}')
noerr "$WORKSPACE"
BODY="$WORKSPACE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['coverage']['assets']==2,x
assert x['coverage']['assetsWithEconomics']==2,x
assert x['coverage']['assetsWithCompleteEconomics']==1,x
assert x['coverage']['snapshots']==2,x
assert len(x['capitalPlans'])==1 and x['capitalPlans'][0]['itemCount']==1,x
assert x['currency']=='USD',x
assert 'does not authorize expenditure' in x['decisionBoundary'],x
PY

DIRECT=$(curl -sS -o /tmp/c210-direct.txt -w '%{http_code}' -X PATCH "$API_URL/rest/v1/asset_economics?asset_id=eq.$ASSET" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $WRITER_AAL2" -H 'Content-Type: application/json' -d '{"replacement_value_usd":1}')
case "$DIRECT" in 401|403) ;; *) cat /tmp/c210-direct.txt; false ;; esac
OUT=$(sql_must_fail "update asset_economics set organization_id='$FOREIGN_ORG' where asset_id='$ASSET';")
grep -qi 'governed C2.10 writer' <<<"$OUT"
test "$(psqlc "select has_function_privilege('authenticated','public.guard_asset_economics_governed_write()','EXECUTE');")" = 'f'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='asset_economics_snapshot';")" = '3'

echo 'C2.10 asset economics smoke passed: canonical_economics=true canonical_capital_plans=true named_human_only=true ai_operator_refused=true aal2_required=true independent_verified_evidence=true tenant_wall=true unknowns_preserved=true optimistic_version=true direct_write_locked=true audit_history=true authority_granted=false'

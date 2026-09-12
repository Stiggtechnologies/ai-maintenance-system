#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Domain specialist smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"
: "${ANON_KEY:?missing ANON_KEY}"
: "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
RISK='d0400000-0000-4000-8000-000000000001'
EVIDENCE='d0400000-0000-4000-8000-000000000002'
AUTHOR='00000000-0000-0000-0000-000000000001'
REVIEWER='00000000-0000-0000-0000-000000000006'

token(){ local response; response=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $3" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$4"; }
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if isinstance(x,dict) and x.get('error'):
    print('unexpected domain specialist error:',x); sys.exit(1)
PY
}

DEMO=$(token 'demo@syncai.ca' 'Demo123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$DEMO"; test -n "$ADMIN"

# U5.05: prove the deployed SQL registry accepts every operational Buildings
# and Facilities method and exposes a non-empty server-owned evidence contract.
BUILDINGS_REGISTRY=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "
with methods(method_key) as (values
  ('occupant-environment'),
  ('bas-control-integrity'),
  ('energy-water-performance'),
  ('facility-renewal-priority')
)
select bool_and(
  domain_specialist_method_is_registered('buildings-infrastructure',method_key)
  and cardinality(domain_specialist_required_evidence(method_key)) > 0
) from methods;")

# U5.06: every Healthcare method is registered and carries a non-empty,
# server-owned evidence contract before any run can persist.
HEALTHCARE_REGISTRY=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "
with methods(method_key) as (values
 ('clinical-criticality'),('device-availability'),('calibration-assurance'),
 ('infection-control-readiness'),('patient-risk'),('device-traceability')
)
select bool_and(
 domain_specialist_method_is_registered('healthcare-clinical-engineering',method_key)
 and cardinality(domain_specialist_required_evidence(method_key)) > 0
) from methods;")
if [ "$HEALTHCARE_REGISTRY" != "t" ]; then
  echo "Healthcare specialist registry/evidence contract is incomplete" >&2
  exit 1
fi

# U5.07: every Civil Infrastructure method is registered and carries a
# non-empty server-owned evidence contract.
CIVIL_REGISTRY=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "
with methods(method_key) as (values
 ('structural-condition'),('inspection-rating'),('deterioration-forecast'),
 ('load-restriction'),('geographic-risk'),('renewal-planning')
)
select bool_and(
 domain_specialist_method_is_registered('civil-infrastructure',method_key)
 and cardinality(domain_specialist_required_evidence(method_key)) > 0
) from methods;")
if [ "$CIVIL_REGISTRY" != "t" ]; then
  echo "Civil Infrastructure specialist registry/evidence contract is incomplete" >&2
  exit 1
fi
test "$BUILDINGS_REGISTRY" = 't'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from domain_specialist_runs where risk_id='$RISK';
delete from user_role_assignments assignment using roles role
where assignment.role_id=role.id and role.organization_id='$ORG'
  and role.key='domain_rbi_reviewer' and assignment.user_id in ('$AUTHOR','$REVIEWER');
delete from evidence_items where id='$EVIDENCE';
delete from risks where id='$RISK';
delete from model_register where organization_id='$ORG' and model_key='domain.petrochemical-rbi.rbi-corrosion-loop';
insert into risks(id,organization_id,title,kind,status)
values('$RISK','$ORG','CI corrosion-loop specialist boundary','threat','draft');
insert into evidence_items(id,organization_id,risk_id,source_system,evidence_type,description,data_quality)
values('$EVIDENCE','$ORG','$RISK','CI inspection export','condition_monitoring','Controlled thickness and approved RBI input evidence','good');
insert into user_role_assignments(organization_id,user_id,role_id)
select '$ORG','$AUTHOR',id from roles where organization_id='$ORG' and key='domain_rbi_reviewer' limit 1;
SQL

RUN=$(python3 - <<'PY'
import json
result={
  'moduleKey':'petrochemical-rbi','methodKey':'rbi-corrosion-loop',
  'modelKey':'domain.petrochemical-rbi.rbi-corrosion-loop','modelVersion':'1.0.0',
  'status':'draft','authoritative':False,'humanApprovalRequired':True,
  'requiredApproverRoleKey':'domain_rbi_reviewer',
  'inputs':{
    'parameters':{'inspectionFraction':0.5,'riskMatrix':{'3:C':'high'},'circuits':[{'id':'CL-CI','previousThickness':9.2,'currentThickness':8.8,'elapsedYears':2,'minimumThickness':6.5,'probabilityCategory':'3','consequenceCategory':'C'}]},
    'evidenceBindings':[
      {'key':key,'sourceReference':'CI controlled '+key,'evidenceItemId':'d0400000-0000-4000-8000-000000000002'}
      for key in ['inspection-data','minimum-thickness-basis','damage-mechanism-review','approved-rbi-matrix']
    ]
  },
  'result':{
    'moduleKey':'petrochemical-rbi','methodKey':'rbi-corrosion-loop',
    'modelKey':'domain.petrochemical-rbi.rbi-corrosion-loop','modelVersion':'1.0.0',
    'requiredApproverRoleKey':'domain_rbi_reviewer','status':'draft',
    'summary':'CI server-calculated contract fixture','authoritative':False,
    'humanApprovalRequired':True,'gaps':[]
  }
}
print(json.dumps({'p_organization_id':'11111111-1111-1111-1111-111111111111','p_actor_id':'00000000-0000-0000-0000-000000000001','p_risk_id':'d0400000-0000-4000-8000-000000000001','p_run':result,'p_evidence_item_ids':['d0400000-0000-4000-8000-000000000002']}))
PY
)

# Authenticated browsers cannot persist a fabricated result by calling the RPC.
DIRECT_STATUS=$(curl -sS -o /tmp/domain-specialist-direct.txt -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/record_domain_specialist_run" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $DEMO" -H 'Content-Type: application/json' -d "$RUN")
test "$DIRECT_STATUS" = '401' -o "$DIRECT_STATUS" = '403' -o "$DIRECT_STATUS" = '404'

# The Edge service boundary may persist the result on behalf of the verified actor.
RECORDED=$(rpc "$SERVICE_ROLE_KEY" record_domain_specialist_run "$SERVICE_ROLE_KEY" "$RUN")
noerr "$RECORDED"
RUN_ID=$(BODY="$RECORDED" python3 -c "import json,os; print(json.loads(os.environ['BODY']).get('run_id',''))")
test -n "$RUN_ID"

STATE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "select run_status||':'||authoritative::text||':'||human_approval_required::text||':'||(created_by='$AUTHOR')::text||':'||cardinality(evidence_item_ids) from domain_specialist_runs where id='$RUN_ID';")
test "$STATE" = 'draft:false:true:true:1'
MODEL=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "select approved_on is null and human_in_loop from model_register where organization_id='$ORG' and model_key='domain.petrochemical-rbi.rbi-corrosion-loop' and version='1.0.0';")
test "$MODEL" = 't'

# The run author cannot independently review their own calculation.
SELF=$(rpc "$DEMO" review_domain_specialist_run "$ANON_KEY" "{\"p_run_id\":\"$RUN_ID\",\"p_outcome\":\"reviewed\",\"p_note\":\"CI author attempts to approve their own specialist calculation.\"}")
BODY="$SELF" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if 'independent review' not in x.get('error',''):
    print('self review was not refused',x); sys.exit(1)
PY

# A generic administrator cannot review a specialist method without its exact
# canonical role assignment.
UNASSIGNED=$(rpc "$ADMIN" review_domain_specialist_run "$ANON_KEY" "{\"p_run_id\":\"$RUN_ID\",\"p_outcome\":\"reviewed\",\"p_note\":\"CI generic administrator attempts specialist review without the assigned role.\"}")
BODY="$UNASSIGNED" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if 'assigned role domain_rbi_reviewer' not in x.get('error',''):
    print('unassigned domain reviewer was not refused',x); sys.exit(1)
PY

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
insert into user_role_assignments(organization_id,user_id,role_id)
select '$ORG','$REVIEWER',id from roles where organization_id='$ORG' and key='domain_rbi_reviewer' limit 1;
SQL

REVIEW=$(rpc "$ADMIN" review_domain_specialist_run "$ANON_KEY" "{\"p_run_id\":\"$RUN_ID\",\"p_outcome\":\"reviewed\",\"p_note\":\"CI independent reviewer confirms the calculation envelope and evidence linkage only.\"}")
noerr "$REVIEW"
FINAL=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc "select run_status||':'||authoritative::text||':'||human_approval_required::text||':'||(reviewed_by is not null)::text from domain_specialist_runs where id='$RUN_ID';")
test "$FINAL" = 'reviewed:false:true:true'

# A service caller still cannot cross tenant membership boundaries.
CROSS=$(BODY="$RUN" python3 -c "import json,os; x=json.loads(os.environ['BODY']); x['p_organization_id']='22222222-2222-2222-2222-222222222222'; print(json.dumps(x))")
CROSS_RESULT=$(rpc "$SERVICE_ROLE_KEY" record_domain_specialist_run "$SERVICE_ROLE_KEY" "$CROSS")
BODY="$CROSS_RESULT" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if 'organization member' not in x.get('error',''):
    print('cross-tenant actor binding was not refused',x); sys.exit(1)
PY

echo "Domain specialist smoke passed: run=$RUN_ID service_only=true independent_review=true authoritative=false"

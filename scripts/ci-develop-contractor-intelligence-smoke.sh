#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D6.02 contractor-intelligence smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
ORG='11111111-1111-1111-1111-111111111111'
E1='d6020000-0000-4000-8000-000000000001'
E2='d6020000-0000-4000-8000-000000000002'

token(){ local response; response=$(curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"); printf '%s' "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); sys.exit(1) if isinstance(x,dict) and x.get('error') else None"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error','') if isinstance(x,dict) else ''; sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected refusal',os.environ['WANT'],'got',x) or sys.exit(1))"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; v=json.loads(os.environ['BODY']).get(os.environ['KEY']); print('' if v is None else v)"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
FOREIGN=$(token 'foreign.viewer@syncai.ca' 'Foreign123!@#')
test -n "$PLANNER"; test -n "$FOREIGN"

# Slice 6B runs before this transcript and leaves one fully opened, awarded
# package whose supplier has warranty and performance history. Reuse that
# canonical project thread rather than arranging a second procurement model.
PACKAGE=$(psqlc "select id from contract_packages where organization_id='$ORG' and package_code='S6B-P1'")
SUPPLIER=$(psqlc "select awarded_supplier_id from contract_packages where id=$PACKAGE")
CASE=$(psqlc "select development_case_id from contract_packages where id=$PACKAGE")
test -n "$PACKAGE"; test -n "$SUPPLIER"; test -n "$CASE"

psqlc "delete from evidence_items where id in ('$E1','$E2');" >/dev/null
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into evidence_items(id,organization_id,development_case_id,source_system,evidence_type,description,data_quality)
values
('$E1','$ORG','$CASE','engineering-transmittal','DOCUMENTED','Timestamped engineering request transmittal used for D6.02.','good'),
('$E2','$ORG','$CASE','engineering-transmittal','DOCUMENTED','Timestamped engineering response transmittal used for D6.02.','good');
SQL

SEALED=$(rpc "$PLANNER" get_package_contractor_intelligence "{\"p_package_id\":$(psqlc "select id from contract_packages where organization_id='$ORG' and package_code='S6B-P2'")}")
test "$(field "$SEALED" answered)" = "False"
grep -Eqi 'not been issued|until the bids are opened' <<<"$SEALED"

BAD=$(rpc "$PLANNER" record_contractor_engineering_response "{\"p_package_id\":$PACKAGE,\"p_supplier_id\":$SUPPLIER,\"p_measurement\":{\"responseRef\":\"D602-BAD\",\"requestedAt\":\"$(psqlc "select (now()-interval '1 day')::text")\",\"respondedAt\":\"$(psqlc "select (now()-interval '2 days')::text")\",\"requestSummary\":\"Request for certified drawing update\",\"responseSummary\":\"Returned certified drawing update\",\"basis\":\"Timestamped transmittal comparison\",\"requestEvidenceItemId\":\"$E1\",\"responseEvidenceItemId\":\"$E2\"}}")
expect_error "$BAD" 'cannot be negative'

RECORDED=$(rpc "$PLANNER" record_contractor_engineering_response "{\"p_package_id\":$PACKAGE,\"p_supplier_id\":$SUPPLIER,\"p_measurement\":{\"responseRef\":\"D602-ENG-1\",\"requestedAt\":\"$(psqlc "select (now()-interval '2 days')::text")\",\"respondedAt\":\"$(psqlc "select (now()-interval '1 day')::text")\",\"requestSummary\":\"Request for certified drawing update\",\"responseSummary\":\"Returned certified drawing update\",\"basis\":\"Timestamped transmittal comparison\",\"requestEvidenceItemId\":\"$E1\",\"responseEvidenceItemId\":\"$E2\"}}")
noerr "$RECORDED"
test "$(field "$RECORDED" elapsedHours)" = "24.00"
MEASUREMENT=$(field "$RECORDED" measurementId)

EVIDENCE=$(rpc "$PLANNER" get_contractor_performance_evidence "{\"p_supplier_id\":$SUPPLIER}")
noerr "$EVIDENCE"
BODY="$EVIDENCE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
d=x['dimensions']
assert set(d)=={'scheduleReliability','ncrRate','engineeringResponse','reworkRate','warrantyClaims'},d
assert d['engineeringResponse']['answered'] and d['engineeringResponse']['value']==24.00,d
assert d['engineeringResponse']['denominator']==1 and d['engineeringResponse']['projectCount']==1,d
for v in d.values():
    assert 'numerator' in v and 'denominator' in v and 'projectCount' in v and 'formula' in v,v
assert 'does not score, rank, recommend or award' in x['basis'],x
PY

PROCUREMENT=$(rpc "$PLANNER" get_package_contractor_intelligence "{\"p_package_id\":$PACKAGE}")
noerr "$PROCUREMENT"
BODY="$PROCUREMENT" SUPPLIER="$SUPPLIER" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['answered'] and len(x['suppliers'])==2,x
s=next(v for v in x['suppliers'] if str(v['supplierId'])==os.environ['SUPPLIER'])
assert s['evidence']['dimensions']['engineeringResponse']['value']==24.00,s
assert 'not a bid score' in x['basis'],x
PY

FOREIGN_READ=$(rpc "$FOREIGN" get_contractor_performance_evidence "{\"p_supplier_id\":$SUPPLIER}")
expect_error "$FOREIGN_READ" 'supplier not found'

OUT=$(sql_must_fail "update contractor_engineering_responses set responded_at=responded_at+interval '1 hour' where id=$MEASUREMENT;")
grep -qi 'immutable' <<<"$OUT"
OUT=$(sql_must_fail "delete from contractor_engineering_responses where id=$MEASUREMENT;")
grep -qi 'immutable' <<<"$OUT"

test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='contractor_engineering_response' and event_data->>'action'='recorded'")" -ge 1

echo 'D6.02 contractor-intelligence smoke passed: five_dimensions=true cross_project=true engineering_evidence=true sealed_boundary=true tenant_wall=true immutable=true no_auto_award=true'

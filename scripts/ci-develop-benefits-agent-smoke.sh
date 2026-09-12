#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Benefits Agent smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
CASE='8e000000-0000-4000-8000-000000000001'
OTHER_CASE='8e000000-0000-4000-8000-000000000099'
OTHER_ORG='22222222-2222-2222-2222-222222222222'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
call(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/functions/v1/develop-benefits-agent" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "{\"case_id\":\"$2\"}"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$AUTHOR"

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/develop-benefits-agent" -H 'Content-Type: application/json' -d "{\"case_id\":\"$CASE\"}")
test "$NOAUTH" = '401'

OTHER_USER=$(psqlc "select id from user_profiles where organization_id='$OTHER_ORG' order by id limit 1")
test -n "$OTHER_USER"
psqlc "insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,created_by) values('$OTHER_CASE','$OTHER_ORG','Other tenant benefit case','brownfield','Must not cross the tenant boundary.','$OTHER_USER') on conflict(id) do nothing"

DENIED=$(call "$AUTHOR" "$OTHER_CASE")
DENIED_STATUS=${DENIED##*$'\n'}
DENIED_BODY=${DENIED%$'\n'*}
test "$DENIED_STATUS" = '404'
BODY="$DENIED_BODY" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['error']=='development case not found',x
PY

RESULT=$(call "$AUTHOR" "$CASE")
STATUS=${RESULT##*$'\n'}
BODY=${RESULT%$'\n'*}
test "$STATUS" = '200'
BODY="$BODY" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); a=x['analysis']
assert x['advisory'] and x['narrativeSource']=='deterministic_governed_records',x
assert a['verdict']=='shortfall' and a['benefitCount']==1 and a['verifiedActualCount']==1,x
assert float(a['leakage']['approved'])==90 and float(a['leakage']['realized'])==64,x
assert float(a['leakage']['shortfall'])==26 and len(a['leakage']['recordedAttributions'])==7,x
assert float(a['leakage']['unattributedResidual'])==0 and a['leakage']['valid'],x
assert any(r.startswith('value_metrics:') for r in a['evidenceRefs']),x
assert any(r.startswith('evidence_items:') for r in a['evidenceRefs']),x
assert 'not proof of causation' in x['disclaimer'] and 'named human' in x['disclaimer'],x
PY

echo 'Benefits Agent smoke passed: deterministic=true benefit=1 shortfall=26 buckets=7 traceable=true tenant_wall=true advisory_only=true'


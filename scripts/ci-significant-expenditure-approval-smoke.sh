#!/usr/bin/env bash
set -euo pipefail
trap 'echo "C5.16 expenditure approval smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }; status(){ printf '%s' "${1##*$'\n'}"; }

REQUESTER=$(token 'demo@syncai.ca' 'Demo123!@#')
EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$REQUESTER" && test -n "$EXEC" && test -n "$ADMIN"
COST_BEFORE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select count(*) from project_cost_items where organization_id='$ORG'")
REQUESTER_ROLE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select role from user_profiles where organization_id='$ORG' and email='demo@syncai.ca'")

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_expenditure_approval_workspace" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'

DRAFT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select id from authority_limits where organization_id='$ORG' and role_key='executive' and action_type='commit_expenditure' and status='draft' order by version desc limit 1")
test -n "$DRAFT"

STATED=$(rpc "$ADMIN" state_authority_ceiling "{\"p_id\":\"$DRAFT\",\"p_ceiling\":{\"max_commitment\":\"100000\",\"currency\":\"CAD\",\"basis\":\"Board-approved 2026 delegation instrument\"}}")
test "$(status "$STATED")" = '200'
BODY="$(body "$STATED")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['ceiling']==100000 and x['currency']=='CAD',x"
ADOPTED=$(rpc "$ADMIN" adopt_authority_limit "{\"p_id\":\"$DRAFT\",\"p_note\":\"Adopted under the board-approved 2026 delegation instrument.\"}")
BODY="$(body "$ADOPTED")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['adopted'],x"

make_request(){ rpc "$1" request_expenditure_commitment "{\"p_request\":{\"title\":\"$2\",\"amount\":\"$3\",\"currency\":\"$4\",\"purpose\":\"Replace production equipment under the approved reliability plan.\",\"evidence_basis\":\"Condition history and engineering review support the bounded request.\",\"consequence_of_wrong\":\"A wrong decision could waste capital and extend production exposure.\"}}"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "update user_profiles set role='ai_admin' where organization_id='$ORG' and email='demo@syncai.ca'"
AI=$(make_request "$REQUESTER" 'AI forbidden request' 1000 CAD)
BODY="$(body "$AI")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert 'AI or system identity' in x.get('error',''),x"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "update user_profiles set role='$REQUESTER_ROLE' where organization_id='$ORG' and email='demo@syncai.ca'"

WITHIN=$(make_request "$REQUESTER" 'Critical pump replacement' 75000 CAD)
test "$(status "$WITHIN")" = '200'
WITHIN_ID=$(BODY="$(body "$WITHIN")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='pending' and 'No purchase' in x['execution'],x; print(x['commitment_id'])")

SELF=$(rpc "$REQUESTER" decide_expenditure_commitment "{\"p_id\":\"$WITHIN_ID\",\"p_outcome\":\"approved\",\"p_note\":\"The requester attempts to approve their own expenditure request.\"}")
BODY="$(body "$SELF")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert 'may not approve or reject their own' in x.get('error',''),x"

APPROVED=$(rpc "$EXEC" decide_expenditure_commitment "{\"p_id\":\"$WITHIN_ID\",\"p_outcome\":\"approved\",\"p_note\":\"Approved against the engineering evidence and adopted CAD delegation.\"}")
BODY="$(body "$APPROVED")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='approved' and x['authority']['ceiling']==100000 and 'No purchase' in x['execution'],x"

OVER=$(make_request "$REQUESTER" 'Major plant replacement' 125000 CAD)
OVER_ID=$(BODY="$(body "$OVER")" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['commitment_id'])")
REFUSED=$(rpc "$EXEC" decide_expenditure_commitment "{\"p_id\":\"$OVER_ID\",\"p_outcome\":\"approved\",\"p_note\":\"Attempt must refuse above the exact adopted delegation ceiling.\"}")
BODY="$(body "$REFUSED")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert 'exceeds' in x.get('error','') and x.get('escalatesTo')=='board',x"

USD=$(make_request "$REQUESTER" 'USD equipment replacement' 1000 USD)
USD_ID=$(BODY="$(body "$USD")" python3 -c "import json,os; print(json.loads(os.environ['BODY'])['commitment_id'])")
MISMATCH=$(rpc "$EXEC" decide_expenditure_commitment "{\"p_id\":\"$USD_ID\",\"p_outcome\":\"approved\",\"p_note\":\"Attempt must refuse because unlike currencies cannot be compared.\"}")
BODY="$(body "$MISMATCH")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert 'no exchange rate' in x.get('error','').lower(),x"

FOREIGN=$(rpc "$EXEC" decide_expenditure_commitment '{"p_id":"99999999-9999-9999-9999-999999999999","p_outcome":"approved","p_note":"Cross-tenant and unknown identifiers must resolve to the same refusal."}')
BODY="$(body "$FOREIGN")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert 'not found' in x.get('error',''),x"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx "approved|approved|100000|CAD|enforced|$COST_BEFORE"
select c.status,a.status,c.authority_ceiling,c.authority_currency,dr.enforcement,
  (select count(*) from project_cost_items where organization_id='$ORG')
from expenditure_commitments c join approvals a on a.id=c.approval_id
join decision_rights dr on dr.right_key='commit_expenditure'
where c.id='$WITHIN_ID';
SQL

echo 'C5.16 expenditure approval smoke passed: amount_ceiling=true currency_exact=true independent_human=true ai_refused=true canonical_approval=true tenant_wall=true no_financial_execution=true'

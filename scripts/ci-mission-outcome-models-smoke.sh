#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U1.01 mission/outcome models smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }; status(){ printf '%s' "${1##*$'\n'}"; }

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
APPROVER=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$AUTHOR" && test -n "$APPROVER"
ADMIN_ROLE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select role from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_mission_outcome_workspace" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'

WORKSPACE=$(rpc "$AUTHOR" get_mission_outcome_workspace '{}')
test "$(status "$WORKSPACE")" = '200'
BODY="$(body "$WORKSPACE")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert len(x['templates'])==12,x; assert len(x['models'])==0,x; assert 'starting points' in x['control'],x"

make_model(){ rpc "$AUTHOR" author_mission_outcome_model "{\"p_model\":{\"organization_type\":\"$1\",\"title\":\"$2\",\"mission_statement\":\"$3\",\"evidence_basis\":\"Board strategy and approved annual operating plan dated 2026.\",\"applicability_notes\":\"Applies across the organization for the current planning cycle.\"}}"; }

FIRST=$(make_model mining 'Mine mission outcome model' 'Deliver safe and predictable mineral production within approved operating limits.')
test "$(status "$FIRST")" = '200'
FIRST_ID=$(BODY="$(body "$FIRST")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='draft' and 'Draft only' in x['authority'],x; print(x['model_id'])")

SELF=$(rpc "$AUTHOR" decide_mission_outcome_model "{\"p_id\":\"$FIRST_ID\",\"p_outcome\":\"approved\",\"p_note\":\"Author attempts to adopt the organization model themselves.\"}")
BODY="$(body "$SELF")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert 'author may not approve' in x.get('error',''),x"

ADOPTED=$(rpc "$APPROVER" decide_mission_outcome_model "{\"p_id\":\"$FIRST_ID\",\"p_outcome\":\"approved\",\"p_note\":\"Confirmed against board strategy and the approved operating plan.\"}")
BODY="$(body "$ADOPTED")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='adopted' and 'does not authorize work' in x['authority'],x"

RESOLVED=$(rpc "$AUTHOR" resolve_mission_outcome_model '{}')
BODY="$(body "$RESOLVED")" FIRST_ID="$FIRST_ID" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['modelId']==os.environ['FIRST_ID']; assert x['organizationType']=='mining'; assert 'Separate governed evidence' in x['authority'],x"

SECOND=$(make_model utility 'Utility service outcome model' 'Deliver safe reliable and affordable utility service while protecting people and environment.')
SECOND_ID=$(BODY="$(body "$SECOND")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['version']==2,x; print(x['model_id'])")

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "update user_profiles set role='ai_admin' where organization_id='$ORG' and email='admin@syncai.ca'"
AI=$(rpc "$APPROVER" decide_mission_outcome_model "{\"p_id\":\"$SECOND_ID\",\"p_outcome\":\"approved\",\"p_note\":\"AI identity attempts to adopt the organization mission model.\"}")
BODY="$(body "$AI")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert 'AI may prepare' in x.get('error',''),x"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "update user_profiles set role='$ADMIN_ROLE' where organization_id='$ORG' and email='admin@syncai.ca'"

SECOND_ADOPTED=$(rpc "$APPROVER" decide_mission_outcome_model "{\"p_id\":\"$SECOND_ID\",\"p_outcome\":\"approved\",\"p_note\":\"Confirmed against the approved utility charter and service obligations.\"}")
BODY="$(body "$SECOND_ADOPTED")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='adopted',x"

FOREIGN=$(rpc "$APPROVER" decide_mission_outcome_model '{"p_id":"99999999-9999-9999-9999-999999999999","p_outcome":"approved","p_note":"Cross-tenant and unknown identifiers must resolve identically."}')
BODY="$(body "$FOREIGN")" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert 'not found in this tenant' in x.get('error',''),x"

DIRECT=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$API_URL/rest/v1/organization_mission_outcome_models?id=eq.$SECOND_ID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $APPROVER" -H 'Content-Type: application/json' -d '{"status":"rejected"}')
test "$DIRECT" = '403'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx '12|superseded|adopted|approved|2'
select (select count(*) from mission_outcome_model_templates where active),
  f.status,s.status,a.status,s.version
from organization_mission_outcome_models f
join organization_mission_outcome_models s on s.id='$SECOND_ID'
join approvals a on a.id=s.approval_id
where f.id='$FIRST_ID';
SQL

echo 'U1.01 mission/outcome models smoke passed: twelve_types=true tenant_wall=true canonical_approval=true independent_human=true ai_refused=true supersession=true evidence_boundary=true guarded_writes=true'

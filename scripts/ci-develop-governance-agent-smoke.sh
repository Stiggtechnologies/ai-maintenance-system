#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Governance Agent smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='22222222-2222-2222-2222-222222222222'
OWN_DETAIL='governance-agent-smoke-own-control-attempt'
FOREIGN_DETAIL='governance-agent-smoke-foreign-control-attempt'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
call(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/functions/v1/develop-governance-agent" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d '{"lookback_days":30}'; }
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#'); PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
test -n "$ADMIN"; test -n "$PLANNER"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
delete from security_events where detail in ('$OWN_DETAIL','$FOREIGN_DETAIL');
insert into security_events(organization_id,event_type,severity,detail,actor_label) values
('$ORG','access_denied','critical','$OWN_DETAIL','smoke-admin'),
('$OTHER_ORG','access_denied','critical','$FOREIGN_DETAIL','foreign-smoke');
SQL
NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/develop-governance-agent" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'
DENIED=$(call "$PLANNER"); test "${DENIED##*$'\n'}" = '403'
BODY="${DENIED%$'\n'*}" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); assert x['error']=='forbidden',x; assert 'administrator' in x['reason'].lower(),x
PY
RESULT=$(call "$ADMIN"); test "${RESULT##*$'\n'}" = '200'
BODY="${RESULT%$'\n'*}" OWN_DETAIL="$OWN_DETAIL" FOREIGN_DETAIL="$FOREIGN_DETAIL" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); a=x['analysis']; own=os.environ['OWN_DETAIL']; foreign=os.environ['FOREIGN_DETAIL']
assert x['advisory'] is True and x['narrativeSource']=='deterministic_governed_records',x
matches=[f for f in a['findings'] if own in f['detail']]; assert len(matches)==1,matches
f=matches[0]; assert f['kind']=='blocked_control_attempt' and f['severity']=='critical',f
assert f['sourceRefs'][0].startswith('security_events:'),f
assert all(foreign not in item['detail'] for item in a['findings']),a['findings']
assert 'administrator' in f['humanAction'].lower(),f
assert any('cannot approve' in note for note in a['limitations']),a['limitations']
assert 'named authorized human' in x['disclaimer'].lower(),x
PY
echo 'Governance Agent smoke passed: noauth=401 role_wall=403 tenant_wall=true committed_attempt=true provenance=true detection_only=true'

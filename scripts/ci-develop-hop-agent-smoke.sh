#!/usr/bin/env bash
set -euo pipefail
trap 'echo "HOP Agent smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999919'
OWN='hop-smoke-system-condition-with-ambiguous-task-sequencing'
FOREIGN='hop-smoke-foreign-condition-must-never-cross-the-tenant-wall'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
agent(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/functions/v1/develop-hop-agent" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d '{"lookback_days":90}'; }
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#'); TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$ADMIN"; test -n "$TECH"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','HOP smoke foreign tenant','testing') on conflict(id) do nothing;
delete from human_performance_events where contributing_conditions in ('$OWN','$FOREIGN');
insert into human_performance_events(organization_id,error_type,outcome_severity,contributing_conditions,
  condition_categories,observation_basis,evidence_refs)
values('$OTHER_ORG','lapse','near_miss','$FOREIGN',array['task_complexity'],
  'Foreign tenant evidence basis for isolation testing only.','["foreign:evidence"]'::jsonb);
SQL

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/develop-hop-agent" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'
DENIED=$(agent "$TECH"); test "${DENIED##*$'\n'}" = '403'

PERSON=$(rpc "$ADMIN" record_hop_system_condition '{"p_record":{"workerId":"00000000-0000-0000-0000-000000000001","conditionCategories":["task_complexity"],"errorType":"lapse","contributingConditions":"The work sequence created an avoidable error trap.","observationBasis":"Observed during the controlled HOP smoke review."}}')
test "${PERSON##*$'\n'}" = '400'; grep -qi 'individual-attribution' <<<"${PERSON%$'\n'*}"
ROLE=$(rpc "$TECH" record_hop_system_condition '{"p_record":{"conditionCategories":["task_complexity"],"errorType":"lapse","contributingConditions":"The work sequence created an avoidable error trap.","observationBasis":"Observed during the controlled HOP smoke review."}}')
test "${ROLE##*$'\n'}" = '400'; grep -qi 'authorized human' <<<"${ROLE%$'\n'*}"

REC=$(rpc "$ADMIN" record_hop_system_condition "{\"p_record\":{\"conditionCategories\":[\"task_complexity\",\"error_provoking_conditions\"],\"errorType\":\"lapse\",\"outcomeSeverity\":\"near_miss\",\"contributingConditions\":\"$OWN\",\"observationBasis\":\"Observed during the controlled HOP smoke review.\",\"evidenceRefs\":[\"smoke:evidence:1\"]}}")
test "${REC##*$'\n'}" = '200'
BEFORE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atqc "select count(*) from human_performance_events where organization_id='$ORG'")
RESULT=$(agent "$ADMIN"); test "${RESULT##*$'\n'}" = '200'
AFTER=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atqc "select count(*) from human_performance_events where organization_id='$ORG'")
test "$BEFORE" = "$AFTER"
BODY="${RESULT%$'\n'*}" OWN="$OWN" FOREIGN="$FOREIGN" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); a=x['analysis']; own=os.environ['OWN']; foreign=os.environ['FOREIGN']
assert x['advisory'] is True and x['narrativeSource']=='deterministic_governed_records',x
assert len(a['categoryCounts'])==9,a['categoryCounts']
matches=[f for f in a['findings'] if own in f['detail']]; assert len(matches)==2,matches
assert all(foreign not in f['detail'] for f in a['findings']),a['findings']
assert all(f['sourceRefs'][0].startswith('human_performance_events:') for f in matches),matches
assert all('human' in f['humanAction'].lower() for f in matches),matches
blob=json.dumps(x).lower()
for forbidden in ('workerid','memberid','personid','employeeid','ownerid'): assert forbidden not in blob,forbidden
assert any('not worker surveillance' in note.lower() for note in a['limitations']),a['limitations']
assert any('cannot assign blame' in note.lower() for note in a['limitations']),a['limitations']
PY
echo 'HOP Agent smoke passed: noauth=401 role_wall=403 writer_role_wall=true tenant_wall=true no_person=true provenance=true read_only=true nine_categories=true'

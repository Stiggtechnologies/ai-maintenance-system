#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Lessons Agent smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"; : "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='22222222-2222-2222-2222-222222222222'
SOURCE_CASE='8f000000-0000-4000-8000-000000000001'
TARGET_CASE='8f000000-0000-4000-8000-000000000002'
FOREIGN_CASE='8f000000-0000-4000-8000-000000000099'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
call(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/functions/v1/develop-lessons-agent" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "{\"case_id\":\"$2\"}"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
AUTHOR_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='demo@syncai.ca'")
FOREIGN_USER=$(psqlc "select id from user_profiles where organization_id='$OTHER_ORG' order by id limit 1")
test -n "$AUTHOR"; test -n "$AUTHOR_ID"; test -n "$FOREIGN_USER"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
delete from learning_events where development_case_id in ('$SOURCE_CASE','$TARGET_CASE','$FOREIGN_CASE');
delete from development_cases where id in ('$SOURCE_CASE','$TARGET_CASE','$FOREIGN_CASE');
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,created_by) values
('$SOURCE_CASE','$ORG','Completed brownfield pump upgrade','brownfield','Vendor data arrived after the design release.','$AUTHOR_ID'),
('$TARGET_CASE','$ORG','New brownfield compressor upgrade','brownfield','Prevent late vendor information and interface rework.','$AUTHOR_ID'),
('$FOREIGN_CASE','$OTHER_ORG','Other tenant brownfield work','brownfield','This project must stay outside the caller tenant.','$FOREIGN_USER');
insert into learning_events(organization_id,development_case_id,event_type,title,failure_mode_key,cause,corrective_action,applicability,detail)
values('$ORG','$SOURCE_CASE','lesson_learned','Freeze vendor data before IFC issue','project_delivery.poor_vendor_data',
'Vendor data dates were not tied to the engineering release plan.',
'Add vendor-data dates and acceptance owners to the release plan.',
'Brownfield rotating-equipment projects with vendor interfaces.',
'Captured and reviewed at project closeout.');
SQL

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/develop-lessons-agent" -H 'Content-Type: application/json' -d "{\"case_id\":\"$TARGET_CASE\"}")
test "$NOAUTH" = '401'

DENIED=$(call "$AUTHOR" "$FOREIGN_CASE")
DENIED_STATUS=${DENIED##*$'\n'}
DENIED_BODY=${DENIED%$'\n'*}
test "$DENIED_STATUS" = '404'
BODY="$DENIED_BODY" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['error']=='development case not found',x
PY

RESULT=$(call "$AUTHOR" "$TARGET_CASE")
STATUS=${RESULT##*$'\n'}
BODY=${RESULT%$'\n'*}
test "$STATUS" = '200'
BODY="$BODY" SOURCE_CASE="$SOURCE_CASE" TARGET_CASE="$TARGET_CASE" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); a=x['analysis']; f=a['findings'][0]
assert x['advisory'] and x['narrativeSource']=='deterministic_governed_records',x
assert a['verdict']=='applicable_lessons_identified' and a['lessonCount']==1,x
assert f['title']=='Freeze vendor data before IFC issue',x
assert f['failureModeKey']=='project_delivery.poor_vendor_data',x
assert f['matchReason']=='source case shares this lifecycle type',x
assert any(r.startswith('learning_events:') for r in f['sourceRefs']),x
assert 'development_cases:'+os.environ['SOURCE_CASE'] in f['sourceRefs'],x
assert 'development_cases:'+os.environ['TARGET_CASE'] in a['evidenceRefs'],x
assert 'named human' in x['disclaimer'].lower(),x
assert any('cannot create or modify' in note for note in a['limitations']),x
PY

echo 'Lessons Agent smoke passed: deterministic_history=true applicable=1 traceable=true tenant_wall=true advisory_only=true'

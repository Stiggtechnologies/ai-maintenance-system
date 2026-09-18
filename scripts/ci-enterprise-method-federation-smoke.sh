#!/usr/bin/env bash
set -euo pipefail
trap 'echo "C9.06 enterprise federation smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"
: "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999918'
SITE='88888888-0000-0000-0000-000000000061'
OTHER_SITE='88888888-0000-0000-0000-000000000062'
FOREIGN_STANDARD='88888888-0000-0000-0000-000000000063'
WO='88888888-0000-0000-0000-000000000064'
VARIANCE='88888888-0000-0000-0000-000000000065'

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"
}

rpc() {
  curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d "$3"
}

TOKEN=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$TOKEN"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry)
values('$OTHER_ORG','C9.06 foreign smoke tenant','testing') on conflict(id) do nothing;
insert into sites(id,organization_id,name,location)
values
  ('$SITE','$ORG','C9.06 North Plant','North'),
  ('$OTHER_SITE','$OTHER_ORG','C9.06 foreign site','Elsewhere')
on conflict(id) do update set name=excluded.name;
insert into governance_standards(
  id,organization_id,standard_key,title,requirement,mandatory,owner_role,
  variance_approver_role,basis,status,version,standard_kind,applicability,register_ref
) values (
  '$FOREIGN_STANDARD','$OTHER_ORG','foreign_method','Foreign tenant method',
  'This method must never appear in the demo tenant federation response.',true,
  'reliability_engineer','reliability_engineer','Foreign tenant evidence basis for isolation.',
  'adopted',1,'reliability_method','Foreign tenant equipment only.','C9.06'
) on conflict(id) do nothing;
insert into work_orders(id,organization_id,wo_number,title,status,priority,type)
values('$WO','$ORG','C906-WO','Must remain pending after federation resolution','pending','medium','human_created')
on conflict(id) do update set status='pending';
SQL

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/get_enterprise_method_federation" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'

AUTHORED=$(rpc "$TOKEN" upsert_enterprise_reliability_method \
  '{"p_method":{"standard_key":"c906","title":"C9.06 failure elimination method","requirement":"Review coded recurrence, causal evidence and verified corrective-action outcomes before changing strategy.","mandatory":true,"owner_role":"reliability_engineer","variance_approver_role":"reliability_engineer","basis":"C9.06 smoke evidence basis reviewed for controlled federation.","applicability":"Critical maintainable equipment with coded work history."}}')
test "${AUTHORED##*$'\n'}" = '200'
METHOD_ID=$(BODY="${AUTHORED%$'\n'*}" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='draft'; print(x['standard_id'])")

ADOPTED=$(rpc "$TOKEN" adopt_enterprise_reliability_method \
  "{\"p_standard_id\":\"$METHOD_ID\",\"p_note\":\"Named-human enterprise review completed against the stated evidence basis.\"}")
test "${ADOPTED##*$'\n'}" = '200'
ADOPT_BODY="${ADOPTED%$'\n'*}" python3 -c "import json,os; x=json.loads(os.environ['ADOPT_BODY']); assert x['status']=='adopted',x"

ALIGNED=$(rpc "$TOKEN" author_site_standard_strategy \
  "{\"p_strategy\":{\"standard_id\":\"$METHOD_ID\",\"site_id\":\"$SITE\",\"strategy_key\":\"north_aligned\",\"title\":\"North aligned implementation\",\"local_context\":\"Cold-weather duty and a quarterly planned shutdown cycle.\",\"implementation_method\":\"Screen coded recurrence weekly and align intrusive corrective work with the planned outage.\",\"evidence_basis\":\"Two years of coded local work history plus the approved shutdown plan.\",\"conformance\":\"aligned\"}}")
test "${ALIGNED##*$'\n'}" = '200'
ALIGNED_ID=$(BODY="${ALIGNED%$'\n'*}" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x['status']=='draft'; print(x['strategy_id'])")
ALIGNED_ADOPT=$(rpc "$TOKEN" adopt_site_standard_strategy \
  "{\"p_strategy_id\":\"$ALIGNED_ID\",\"p_note\":\"Site reliability review confirms alignment with the enterprise method and evidence.\"}")
test "${ALIGNED_ADOPT##*$'\n'}" = '200'
ALIGNED_BODY="${ALIGNED_ADOPT%$'\n'*}" python3 -c "import json,os; x=json.loads(os.environ['ALIGNED_BODY']); assert x['status']=='adopted',x"

VARIANT=$(rpc "$TOKEN" author_site_standard_strategy \
  "{\"p_strategy\":{\"standard_id\":\"$METHOD_ID\",\"site_id\":\"$SITE\",\"strategy_key\":\"north_variant\",\"title\":\"North non-conforming implementation\",\"local_context\":\"A temporary outage constraint prevents the enterprise sequence.\",\"implementation_method\":\"Use an alternate sequence with independent verification until the next outage.\",\"evidence_basis\":\"Temporary operating constraint documented by the site reliability review.\",\"conformance\":\"variance\"}}")
test "${VARIANT##*$'\n'}" = '200'
VARIANT_ID=$(BODY="${VARIANT%$'\n'*}" python3 -c "import json,os; x=json.loads(os.environ['BODY']); print(x['strategy_id'])")
REFUSED=$(rpc "$TOKEN" adopt_site_standard_strategy \
  "{\"p_strategy_id\":\"$VARIANT_ID\",\"p_note\":\"Attempted adoption without approved variance must remain refused.\"}")
test "${REFUSED##*$'\n'}" = '200'
REFUSED_BODY="${REFUSED%$'\n'*}" python3 -c "import json,os; x=json.loads(os.environ['REFUSED_BODY']); assert 'approved variance' in x.get('error',''),x"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into standard_site_variances(
  id,organization_id,standard_id,site_id,subject_type,justification,
  compensating_controls,status,expires_at,decision_note,decided_at
) values (
  '$VARIANCE','$ORG','$METHOD_ID','$SITE','standard',
  'Temporary outage constraint prevents use of the enterprise sequence.',
  'Independent verification plus weekly condition review until the outage.',
  'approved',now()+interval '30 days','Approved for the bounded smoke scenario.',now()
);
SQL

COVERED=$(rpc "$TOKEN" author_site_standard_strategy \
  "{\"p_strategy\":{\"standard_id\":\"$METHOD_ID\",\"site_id\":\"$SITE\",\"strategy_key\":\"north_variance_covered\",\"title\":\"North approved-variance implementation\",\"local_context\":\"A temporary outage constraint prevents the enterprise sequence.\",\"implementation_method\":\"Use an alternate sequence with independent verification until the next outage.\",\"evidence_basis\":\"Approved site variance plus the documented temporary operating constraint.\",\"conformance\":\"variance\",\"variance_id\":\"$VARIANCE\"}}")
test "${COVERED##*$'\n'}" = '200'
COVERED_ID=$(BODY="${COVERED%$'\n'*}" python3 -c "import json,os; x=json.loads(os.environ['BODY']); print(x['strategy_id'])")
COVERED_ADOPT=$(rpc "$TOKEN" adopt_site_standard_strategy \
  "{\"p_strategy_id\":\"$COVERED_ID\",\"p_note\":\"Site reliability review confirmed the approved variance and compensating controls.\"}")
test "${COVERED_ADOPT##*$'\n'}" = '200'
COVERED_BODY="${COVERED_ADOPT%$'\n'*}" python3 -c "import json,os; x=json.loads(os.environ['COVERED_BODY']); assert x['status']=='adopted',x"

READ=$(rpc "$TOKEN" get_enterprise_method_federation '{}')
test "${READ##*$'\n'}" = '200'
BODY="${READ%$'\n'*}" METHOD_ID="$METHOD_ID" SITE="$SITE" FOREIGN_STANDARD="$FOREIGN_STANDARD" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
method=next(m for m in x['methods'] if m['id']==os.environ['METHOD_ID'])
assert method['status']=='adopted',method
resolved=next(r for r in x['effective_site_methods'] if r['standard_id']==os.environ['METHOD_ID'] and r['site_id']==os.environ['SITE'])
assert resolved['resolution']=='site_strategy' and resolved['conformance']=='variance',resolved
assert resolved['variance_status']=='approved',resolved
assert 'no work' in resolved['authority'],resolved
assert os.environ['FOREIGN_STANDARD'] not in json.dumps(x),x
assert 'approved, unexpired variance' in x['controls']['variance'],x
PY

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
  -c "update standard_site_variances set status='expired',expires_at=now()-interval '1 minute' where id='$VARIANCE';"
EXPIRED=$(rpc "$TOKEN" get_enterprise_method_federation '{}')
test "${EXPIRED##*$'\n'}" = '200'
BODY="${EXPIRED%$'\n'*}" METHOD_ID="$METHOD_ID" SITE="$SITE" COVERED_ID="$COVERED_ID" python3 - <<'PY'
import json, os
x=json.loads(os.environ['BODY'])
resolved=next(r for r in x['effective_site_methods'] if r['standard_id']==os.environ['METHOD_ID'] and r['site_id']==os.environ['SITE'])
assert resolved['resolution']=='enterprise_standard' and resolved['conformance']=='inherited',resolved
blocked=next(r for r in x['blocked_site_strategies'] if r['id']==os.environ['COVERED_ID'])
assert 'enterprise method applies' in blocked['reason'],blocked
PY

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx 'pending|1|1|superseded'
select status,
  (select count(*) from governance_standards where id='$METHOD_ID' and organization_id='$ORG' and status='adopted'),
  (select count(*) from site_standard_strategies where standard_id='$METHOD_ID' and site_id='$SITE' and status='adopted'),
  (select status from site_standard_strategies where id='$ALIGNED_ID')
from work_orders where id='$WO';
SQL

echo 'C9.06 enterprise federation smoke passed: auth=true tenant_wall=true enterprise_adoption=true inherited_resolution=true site_strategy=true variance_fail_closed=true expiry_fallback=true no_auto_execution=true'

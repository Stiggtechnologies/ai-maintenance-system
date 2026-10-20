#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Engineering relationship backfill smoke failed at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"

psql_exec() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "$1"
}

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))"
}

TOKEN=$(token "demo@syncai.ca" "Demo123!@#")
TECH=$(token "technician@syncai.ca" "Tech123!@#")
test -n "$TOKEN"
test -n "$TECH"
ORG=$(psql_exec "select organization_id from public.user_profiles where lower(email)='demo@syncai.ca' limit 1" | grep -E '^[0-9a-f-]{36}$' | head -n 1)

EDGE='{"p_edges":[{"relationshipCode":"EKG-BACKFILL-1","relationshipType":"may_fail_by","fromEntityType":"component","fromCanonicalId":"PUMP-WET-END","toEntityType":"failure_mode","toCanonicalId":"PUMP-WET-END-CAVITATION","provenanceCanonicalIds":["ROT-CENT-PUMP"]}]}'

TECH_HTTP=$(curl -sS -o /tmp/ekg-backfill-tech.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/backfill_engineering_relationships" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TECH" -H "Content-Type: application/json" -d "$EDGE")
test "$TECH_HTTP" -ge 400

ANON=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/backfill_engineering_relationships" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d "$EDGE")
test "$ANON" = "401"

FIRST=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/backfill_engineering_relationships" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$EDGE")
python3 - <<PY
import json
body=json.loads('''$FIRST''')
assert body["inserted"]==1 and body["reviewState"]=="draft"
assert body["grantsAuthority"] is False and body["grantsWorkRelease"] is False and body["grantsApproval"] is False
PY

SECOND=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/backfill_engineering_relationships" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$EDGE")
python3 - <<PY
import json
body=json.loads('''$SECOND''')
assert body["inserted"]==0 and body["alreadyPresent"]==1
PY

COPY=$(curl -sS -o /tmp/ekg-backfill-copy.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/backfill_engineering_relationships" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_edges":[{"relationshipCode":"EKG-COPY","relationshipType":"contains","fromEntityType":"asset_class","fromCanonicalId":"A","toEntityType":"component","toCanonicalId":"B","provenanceCanonicalIds":["A"],"content":"copied body"}]}')
test "$COPY" -ge 400

SEEN=$(curl -fsS "$API_URL/rest/v1/engineering_knowledge_relationships?select=review_state,to_canonical_id&relationship_code=eq.EKG-BACKFILL-1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN")
python3 - <<PY
import json
rows=json.loads('''$SEEN''')
assert rows==[{"review_state":"draft","to_canonical_id":"PUMP-WET-END-CAVITATION"}]
PY

INSERT_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/engineering_knowledge_relationships" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"organization_id\":\"$ORG\",\"relationship_code\":\"direct\",\"relationship_type\":\"contains\",\"from_entity_type\":\"asset_class\",\"from_canonical_id\":\"A\",\"to_entity_type\":\"component\",\"to_canonical_id\":\"B\",\"provenance_canonical_ids\":[\"A\"],\"created_by_kind\":\"human\"}")
test "$INSERT_HTTP" -ge 400

psql_exec "insert into public.reliability_kb_chunks(chunk_id,source_id,title,document_type,document_class,page_start,page_end,chunk_index,content,organization_id,provenance) values ('EKG-BACKFILL-CHUNK','EKG-BACKFILL-SRC','Backfill','note','client_supplied',1,1,1,'benign backfill note','$ORG','{\"componentCodes\":[\"PUMP-EKG-BACKFILL\"],\"failureModeCodes\":[\"not a code\"]}'::jsonb)" >/dev/null
OTHER_ORG=$(psql_exec "insert into public.organizations(name,industry) values ('EKG backfill other','synthetic') returning id" | grep -E '^[0-9a-f-]{36}$' | head -n 1)
psql_exec "insert into public.reliability_kb_chunks(chunk_id,source_id,title,document_type,document_class,page_start,page_end,chunk_index,content,organization_id,provenance) values ('EKG-BACKFILL-OTHER','EKG-BACKFILL-OTHER','Other','note','client_supplied',1,1,1,'other backfill note','$OTHER_ORG','{\"componentCodes\":[\"OTHER-ONLY-COMPONENT\"]}'::jsonb)" >/dev/null
psql_exec "insert into public.engineering_knowledge_relationships(organization_id,relationship_code,relationship_type,from_entity_type,from_canonical_id,to_entity_type,to_canonical_id,provenance_canonical_ids,created_by_kind) values ('$OTHER_ORG','EKG-OTHER-EDGE','contains','asset_class','OTHER','component','OTHER-ONLY-COMPONENT',array['OTHER'],'migration')" >/dev/null

CHUNK_FILL=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/backfill_relationships_from_knowledge_chunks" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}')
python3 - <<PY
import json
body=json.loads('''$CHUNK_FILL''')
assert body["inserted"]>=1 and body["grantsAuthority"] is False and body["reviewState"]=="draft"
PY

MINE=$(curl -fsS "$API_URL/rest/v1/engineering_knowledge_relationships?select=to_canonical_id&to_canonical_id=eq.PUMP-EKG-BACKFILL" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN")
FOREIGN=$(curl -fsS "$API_URL/rest/v1/engineering_knowledge_relationships?select=to_canonical_id&to_canonical_id=eq.OTHER-ONLY-COMPONENT" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN")
test "$(echo "$MINE" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")" = "1"
test "$(echo "$FOREIGN" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")" = "0"

AGAIN=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/backfill_relationships_from_knowledge_chunks" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}')
python3 - <<PY
import json
body=json.loads('''$AGAIN''')
assert body["inserted"]==0
PY

echo "Engineering relationship backfill smoke passed: draft edges, idempotent, copied body refused, direct insert refused, chunk codes referenced, cross-tenant hidden, no authority."

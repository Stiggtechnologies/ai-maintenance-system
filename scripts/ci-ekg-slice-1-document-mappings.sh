#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Document engineering mapping smoke failed at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"

psql_uuid() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -Atc "$1" \
    | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
    | head -n 1
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

ORG=$(psql_uuid "select organization_id from public.user_profiles where lower(email)='demo@syncai.ca' limit 1")
test -n "$ORG"

SOURCE_ID=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/register_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"p_source_key":"EKG-DOC-MAP-R1","p_title":"Synthetic document mapping manual","p_document_type":"manual","p_document_class":"client_supplied","p_authority_level":"customer_approved","p_confidentiality":"customer_confidential","p_source_checksum":"sha256:ekg-doc-map-r1"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin))")
test -n "$SOURCE_ID"

CHUNK_BODY=$(python3 - <<PY
import json
print(json.dumps({
  "chunk_id":"EKG-DOC-MAP-R1-001","source_id":"EKG-DOC-MAP-R1","title":"Synthetic document mapping manual",
  "document_type":"manual","document_class":"client_supplied","page_start":1,"page_end":1,"chunk_index":1,
  "content":"ekgdocmapalpha synthetic applicability note for a centrifugal pump twin",
  "organization_id":"$ORG","governed_source_id":"$SOURCE_ID","content_checksum":"sha256:ekg-doc-map-chunk",
  "provenance":{"file":"ekg-doc-map-r1.pdf","page":1,"synthetic":True}
}))
PY
)
CHUNK_ID=$(curl -fsS -X POST "$API_URL/rest/v1/reliability_kb_chunks?select=id" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" -d "$CHUNK_BODY" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
test -n "$CHUNK_ID"

PAYLOAD=$(python3 - <<PY
import json
print(json.dumps({
  "p_source_id": "$SOURCE_ID",
  "p_mappings": [
    {"entityType":"asset_twin","canonicalId":"twin-ekg-pump-1","relationship":"applies_to","reviewState":"draft","provenanceChunkIds":["$CHUNK_ID"]},
    {"entityType":"physics_capability","canonicalId":"PHYS-EKG-PUMP","relationship":"explained_by","reviewState":"draft","provenanceChunkIds":["$CHUNK_ID"]}
  ]
}))
PY
)

HTTP=$(curl -sS -o /tmp/ekg-map-tech.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TECH" -H "Content-Type: application/json" -d "$PAYLOAD")
test "$HTTP" -ge 400
python3 - <<'PY'
import json
body=json.load(open("/tmp/ekg-map-tech.json"))
text=body if isinstance(body,str) else json.dumps(body)
assert "steward" in text.lower(), body
PY

ANON=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d "$PAYLOAD")
test "$ANON" = "401"

RESULT=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$PAYLOAD")
python3 - <<PY
import json
body=json.loads('''$RESULT''')
assert body["grantsAuthority"] is False
assert body["grantsWorkRelease"] is False
assert body["grantsApproval"] is False
assert body["count"]==2
assert "permission" in body["decisionBoundary"]
PY

AGAIN=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$PAYLOAD")
python3 - <<PY
import json
body=json.loads('''$AGAIN''')
assert body["count"]==2
PY

ROWS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select count(*) from public.engineering_knowledge_mappings where source_id='$SOURCE_ID'")
test "$ROWS" = "2"

SEEN=$(curl -fsS "$API_URL/rest/v1/engineering_knowledge_mappings?select=canonical_id,entity_type&canonical_id=eq.twin-ekg-pump-1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN")
python3 - <<PY
import json
rows=json.loads('''$SEEN''')
assert len(rows)==1 and rows[0]["entity_type"]=="asset_twin"
PY

INSERT_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/engineering_knowledge_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"organization_id\":\"$ORG\",\"source_id\":\"$SOURCE_ID\",\"entity_type\":\"component\",\"canonical_id\":\"direct-insert\",\"relationship\":\"applies_to\"}")
test "$INSERT_HTTP" -ge 400

OTHER_ORG=$(psql_uuid "insert into public.organizations(name,industry) values ('EKG mapping other tenant','synthetic') returning id")
OTHER_SOURCE=$(psql_uuid "insert into public.engineering_knowledge_sources(organization_id,source_key,title,document_class,authority_level,review_state,confidentiality) values ('$OTHER_ORG','EKG-OTHER-MAP','Other mapping source','client_supplied','customer_approved','draft','customer_confidential') returning id")
OTHER_CHUNK=$(psql_uuid "insert into public.reliability_kb_chunks(chunk_id,source_id,title,document_type,document_class,page_start,page_end,chunk_index,content,organization_id,governed_source_id,content_checksum,provenance) values ('EKG-OTHER-MAP-001','EKG-OTHER-MAP','Other mapping source','manual','client_supplied',1,1,1,'other tenant mapping note','$OTHER_ORG','$OTHER_SOURCE','sha256:other-map','{\"synthetic\":true}'::jsonb) returning id")
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "insert into public.engineering_knowledge_mappings(organization_id,source_id,entity_type,canonical_id,relationship,provenance_chunk_ids) values ('$OTHER_ORG','$OTHER_SOURCE','asset_twin','twin-other-tenant','applies_to',array['$OTHER_CHUNK']::uuid[])" >/dev/null

FOREIGN=$(curl -fsS "$API_URL/rest/v1/engineering_knowledge_mappings?select=canonical_id&canonical_id=eq.twin-other-tenant" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN")
test "$(echo "$FOREIGN" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")" = "0"

CROSS=$(curl -sS -o /tmp/ekg-map-cross.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$OTHER_SOURCE\",\"p_mappings\":[{\"entityType\":\"asset_class\",\"canonicalId\":\"SHOULD-NOT\",\"relationship\":\"applies_to\",\"reviewState\":\"draft\",\"provenanceChunkIds\":[\"$CHUNK_ID\"]}]}")
test "$CROSS" -ge 400
python3 - <<'PY'
import json
body=json.load(open("/tmp/ekg-map-cross.json"))
text=body if isinstance(body,str) else json.dumps(body)
assert "current organization" in text.lower(), body
PY

AI_SOURCE=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/register_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_source_key":"EKG-DOC-MAP-AI","p_title":"Synthetic AI mapping","p_document_type":"analysis","p_document_class":"client_supplied","p_authority_level":"ai_generated","p_confidentiality":"internal","p_source_checksum":"sha256:ekg-doc-map-ai"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin))")
AI_CHUNK=$(psql_uuid "insert into public.reliability_kb_chunks(chunk_id,source_id,title,document_type,document_class,page_start,page_end,chunk_index,content,organization_id,governed_source_id,content_checksum,provenance) values ('EKG-DOC-MAP-AI-001','EKG-DOC-MAP-AI','Synthetic AI mapping','analysis','client_supplied',1,1,1,'synthetic ai mapping note','$ORG','$AI_SOURCE','sha256:ekg-ai-map','{\"synthetic\":true}'::jsonb) returning id")
AI_HTTP=$(curl -sS -o /tmp/ekg-map-ai.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$AI_SOURCE\",\"p_mappings\":[{\"entityType\":\"asset_class\",\"canonicalId\":\"ROT-CENT-PUMP\",\"relationship\":\"applies_to\",\"reviewState\":\"approved\",\"provenanceChunkIds\":[\"$AI_CHUNK\"]}]}")
test "$AI_HTTP" -ge 400
python3 - <<'PY'
import json
body=json.load(open("/tmp/ekg-map-ai.json"))
text=body if isinstance(body,str) else json.dumps(body)
assert "AI-generated" in text, body
PY

echo "Document engineering mapping smoke passed: ontology targets persisted, idempotent, steward-only, tenant wall held, direct insert refused, AI approval refused, no authority granted."

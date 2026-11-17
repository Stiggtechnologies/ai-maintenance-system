#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Engineering knowledge conflict smoke failed at line $LINENO: $BASH_COMMAND"' ERR

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
test -n "$TOKEN"
ORG=$(psql_exec "select organization_id from public.user_profiles where lower(email)='demo@syncai.ca' limit 1" | grep -E '^[0-9a-f-]{36}$' | head -n 1)

register_source() {
  local key="$1" title="$2" authority="$3" revision="$4"
  curl -fsS -X POST "$API_URL/rest/v1/rpc/register_engineering_knowledge_source" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"p_source_key\":\"$key\",\"p_title\":\"$title\",\"p_document_type\":\"manual\",\"p_document_class\":\"client_supplied\",\"p_authority_level\":\"$authority\",\"p_confidentiality\":\"customer_confidential\",\"p_revision\":\"$revision\",\"p_source_checksum\":\"sha256:$key\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin))"
}

add_chunk_and_approve() {
  local key="$1" source_id="$2" canonical="$3"
  local body
  body=$(python3 - <<PY
import json
print(json.dumps({
  "chunk_id":"$key-001","source_id":"$key","title":"$key","document_type":"manual",
  "document_class":"client_supplied","page_start":1,"page_end":1,"chunk_index":1,
  "content":"$key synthetic conflict note","organization_id":"$ORG",
  "governed_source_id":"$source_id","content_checksum":"sha256:$key-chunk",
  "provenance":{"synthetic":True,"file":"$key.pdf"}
}))
PY
)
  local chunk_id
  chunk_id=$(curl -fsS -X POST "$API_URL/rest/v1/reliability_kb_chunks?select=id" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" -d "$body" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
  curl -fsS -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"p_source_id\":\"$source_id\",\"p_entity_type\":\"asset_class\",\"p_canonical_id\":\"$canonical\",\"p_review_state\":\"approved\",\"p_provenance_chunk_ids\":[\"$chunk_id\"]}" >/dev/null
  curl -fsS -X POST "$API_URL/rest/v1/rpc/approve_engineering_knowledge_source" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"p_source_id\":\"$source_id\"}" >/dev/null
}

A=$(register_source "EKG-CONFLICT-A" "Conflict source A" "oem_authorized" "1")
B=$(register_source "EKG-CONFLICT-B" "Conflict source B" "internal_approved" "2")
add_chunk_and_approve "EKG-CONFLICT-A" "$A" "ROT-EKG-CONFLICT"
add_chunk_and_approve "EKG-CONFLICT-B" "$B" "ROT-EKG-CONFLICT"

REPORT=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/detect_engineering_knowledge_conflicts" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_entity_type":"asset_class","p_canonical_id":"ROT-EKG-CONFLICT"}')
python3 - <<PY
import json
body=json.loads('''$REPORT''')
kinds={item["kind"] for item in body["findings"]}
assert "revision_conflict" in kinds, body
assert "authority_conflict" in kinds, body
assert body["grantsAuthority"] is False and body["grantsWorkRelease"] is False and body["grantsApproval"] is False
ids=set()
for item in body["findings"]:
    ids.update(item["sourceIds"])
assert "$A" in ids and "$B" in ids
PY

STATE_BEFORE=$(psql_exec "select review_state from public.engineering_knowledge_sources where id='$A'")
curl -fsS -X POST "$API_URL/rest/v1/rpc/detect_engineering_knowledge_conflicts" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_entity_type":"asset_class","p_canonical_id":"ROT-EKG-CONFLICT"}' >/dev/null
STATE_AFTER=$(psql_exec "select review_state from public.engineering_knowledge_sources where id='$A'")
test "$STATE_BEFORE" = "$STATE_AFTER"

curl -fsS -X POST "$API_URL/rest/v1/rpc/supersede_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$A\",\"p_replacement_source_id\":\"$B\"}" >/dev/null
AFTER=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/detect_engineering_knowledge_conflicts" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_entity_type":"asset_class","p_canonical_id":"ROT-EKG-CONFLICT"}')
python3 - <<PY
import json
body=json.loads('''$AFTER''')
kinds={item["kind"] for item in body["findings"]}
assert "revision_conflict" not in kinds, body
assert "superseded_mapping_still_approved" in kinds, body
PY

GAP=$(register_source "EKG-CONFLICT-GAP" "Conflict gap" "customer_approved" "9")
GAP_CHUNK=$(psql_exec "insert into public.reliability_kb_chunks(chunk_id,source_id,title,document_type,document_class,page_start,page_end,chunk_index,content,organization_id,governed_source_id,content_checksum,provenance) values ('EKG-CONFLICT-GAP-001','EKG-CONFLICT-GAP','Conflict gap','manual','client_supplied',1,1,1,'gap note','$ORG','$GAP','sha256:gap','{\"synthetic\":true}'::jsonb) returning id" | grep -E '^[0-9a-f-]{36}$' | head -n 1)
psql_exec "insert into public.engineering_knowledge_mappings(organization_id,source_id,entity_type,canonical_id,relationship,review_state,provenance_chunk_ids) values ('$ORG','$GAP','asset_class','ROT-EKG-CONFLICT','applies_to','draft',array['$GAP_CHUNK']::uuid[])" >/dev/null
psql_exec "update public.engineering_knowledge_sources set review_state='superseded', superseded_by_source_id=null where id='$GAP'" >/dev/null
GAP_REPORT=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/detect_engineering_knowledge_conflicts" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_entity_type":"asset_class","p_canonical_id":"ROT-EKG-CONFLICT"}')
python3 - <<PY
import json
body=json.loads('''$GAP_REPORT''')
assert any(item["kind"]=="supersession_gap" and "$GAP" in item["sourceIds"] for item in body["findings"]), body
PY

OTHER_ORG=$(psql_exec "insert into public.organizations(name,industry) values ('EKG conflict other','synthetic') returning id" | grep -E '^[0-9a-f-]{36}$' | head -n 1)
OTHER_SOURCE=$(psql_exec "insert into public.engineering_knowledge_sources(organization_id,source_key,title,document_class,authority_level,review_state,confidentiality,revision,approved_at) values ('$OTHER_ORG','EKG-CONFLICT-OTHER','Other','client_supplied','oem_authorized','approved','customer_confidential','7',now()) returning id" | grep -E '^[0-9a-f-]{36}$' | head -n 1)
OTHER_CHUNK=$(psql_exec "insert into public.reliability_kb_chunks(chunk_id,source_id,title,document_type,document_class,page_start,page_end,chunk_index,content,organization_id,governed_source_id,content_checksum,provenance) values ('EKG-CONFLICT-OTHER-001','EKG-CONFLICT-OTHER','Other','manual','client_supplied',1,1,1,'other conflict','$OTHER_ORG','$OTHER_SOURCE','sha256:other-conflict','{\"synthetic\":true}'::jsonb) returning id" | grep -E '^[0-9a-f-]{36}$' | head -n 1)
psql_exec "insert into public.engineering_knowledge_mappings(organization_id,source_id,entity_type,canonical_id,relationship,review_state,provenance_chunk_ids) values ('$OTHER_ORG','$OTHER_SOURCE','asset_class','ROT-EKG-FOREIGN','applies_to','approved',array['$OTHER_CHUNK']::uuid[])" >/dev/null
FOREIGN=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/detect_engineering_knowledge_conflicts" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_entity_type":"asset_class","p_canonical_id":"ROT-EKG-FOREIGN"}')
python3 - <<PY
import json
body=json.loads('''$FOREIGN''')
assert body["findings"]==[], body
assert "$OTHER_SOURCE" not in json.dumps(body)
PY

ANON=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/detect_engineering_knowledge_conflicts" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_entity_type":"asset_class","p_canonical_id":"ROT-EKG-CONFLICT"}')
test "$ANON" = "401"

echo "Engineering knowledge conflict smoke passed: revision and authority conflicts named, supersession recorded without a silent winner, gap reported, cross-tenant hidden, detection did not change review state."

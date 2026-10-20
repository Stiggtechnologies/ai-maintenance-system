#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Hybrid engineering retrieval smoke failed at line $LINENO: $BASH_COMMAND"' ERR

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
test -n "$ORG"

SOURCE_ID=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/register_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_source_key":"EKG-HYBRID-R1","p_title":"Synthetic hybrid retrieval manual","p_document_type":"manual","p_document_class":"client_supplied","p_authority_level":"customer_approved","p_confidentiality":"customer_confidential","p_asset_class":"ROT-EKG-HYBRID","p_source_checksum":"sha256:ekg-hybrid-r1"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin))")

CHUNK_BODY=$(python3 - <<PY
import json
print(json.dumps({
  "chunk_id":"EKG-HYBRID-001","source_id":"EKG-HYBRID-R1","title":"Synthetic hybrid retrieval manual",
  "document_type":"manual","document_class":"client_supplied","page_start":1,"page_end":1,"chunk_index":1,
  "content":"ekghybridalphaqz cavitation check on the synthetic hybrid pump",
  "organization_id":"$ORG","governed_source_id":"$SOURCE_ID","content_checksum":"sha256:ekg-hybrid-chunk",
  "provenance":{"file":"ekg-hybrid-r1.pdf","page":1,"synthetic":True}
}))
PY
)
CHUNK_ID=$(curl -fsS -X POST "$API_URL/rest/v1/reliability_kb_chunks?select=id" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" -d "$CHUNK_BODY" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

psql_exec "update public.reliability_kb_chunks set embedding = (select ('[' || string_agg(case when i = 1 then '1' else '0' end, ',') || ']')::vector from generate_series(1,768) i) where id = '$CHUNK_ID'" >/dev/null

EMBED=$(python3 - <<'PY'
print('[' + ','.join(['1' if i == 0 else '0' for i in range(768)]) + ']')
PY
)

hits() {
  curl -fsS -X POST "$API_URL/rest/v1/rpc/retrieve_engineering_knowledge_hybrid" \
    -H "apikey: $1" -H "Authorization: Bearer $2" -H "Content-Type: application/json" -d "$3"
}

BEFORE=$(hits "$ANON_KEY" "$TOKEN" '{"p_claim_type":"failure_behaviour","p_query":"ekghybridalphaqz","p_limit":8}')
test "$(echo "$BEFORE" | python3 -c "import sys,json; print(sum(1 for x in json.load(sys.stdin) if x.get('chunk_id')=='EKG-HYBRID-001'))")" = "0"

curl -fsS -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\",\"p_entity_type\":\"asset_class\",\"p_canonical_id\":\"ROT-EKG-HYBRID\",\"p_relationship\":\"applies_to\",\"p_review_state\":\"approved\",\"p_provenance_chunk_ids\":[\"$CHUNK_ID\"]}" >/dev/null
curl -fsS -X POST "$API_URL/rest/v1/rpc/approve_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\"}" >/dev/null

LEX=$(hits "$ANON_KEY" "$TOKEN" '{"p_claim_type":"failure_behaviour","p_query":"ekghybridalphaqz","p_entity_type":"asset_class","p_canonical_id":"ROT-EKG-HYBRID","p_asset_class":"ROT-EKG-HYBRID","p_limit":8}')
python3 - <<PY
import json
rows=json.loads('''$LEX''')
hit=[x for x in rows if x.get("chunk_id")=="EKG-HYBRID-001"]
assert len(hit)==1, rows
assert hit[0]["matchedCanonicalId"]=="ROT-EKG-HYBRID"
assert "UNTRUSTED RETRIEVED EVIDENCE" in hit[0]["content"]
assert hit[0]["combinedScore"]>0
PY

VEC=$(hits "$ANON_KEY" "$TOKEN" "{\"p_claim_type\":\"failure_behaviour\",\"p_query\":\"ekghybridalphaqz\",\"p_query_embedding\":\"$EMBED\",\"p_limit\":8}")
test "$(echo "$VEC" | python3 -c "import sys,json; print(sum(1 for x in json.load(sys.stdin) if x.get('chunk_id')=='EKG-HYBRID-001'))")" = "1"

MISS=$(hits "$ANON_KEY" "$TOKEN" '{"p_claim_type":"failure_behaviour","p_query":"ekghybridalphaqz","p_entity_type":"asset_class","p_canonical_id":"NOT-THIS-CLASS","p_limit":8}')
test "$(echo "$MISS" | python3 -c "import sys,json; print(sum(1 for x in json.load(sys.stdin) if x.get('chunk_id')=='EKG-HYBRID-001'))")" = "0"

EMPTY=$(hits "$ANON_KEY" "$TOKEN" '{"p_claim_type":"failure_behaviour","p_query":"","p_limit":8}')
test "$(echo "$EMPTY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")" = "0"

BAD=$(curl -sS -o /tmp/ekg-hybrid-bad.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/retrieve_engineering_knowledge_hybrid" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_claim_type":"failure_behaviour","p_query":"ekghybridalphaqz","p_minimum_semantic_score":2}')
test "$BAD" -ge 400

OTHER_ORG=$(psql_exec "insert into public.organizations(name,industry) values ('EKG hybrid other','synthetic') returning id" | grep -E '^[0-9a-f-]{36}$' | head -n 1)
OTHER_SOURCE=$(psql_exec "insert into public.engineering_knowledge_sources(organization_id,source_key,title,document_class,authority_level,review_state,confidentiality,asset_class,approved_at) values ('$OTHER_ORG','EKG-HYBRID-OTHER','Other hybrid','client_supplied','customer_approved','approved','customer_confidential','ROT-EKG-HYBRID',now()) returning id" | grep -E '^[0-9a-f-]{36}$' | head -n 1)
psql_exec "insert into public.reliability_kb_chunks(chunk_id,source_id,title,document_type,document_class,page_start,page_end,chunk_index,content,organization_id,governed_source_id,content_checksum,provenance,embedding) select 'EKG-HYBRID-OTHER-001','EKG-HYBRID-OTHER','Other hybrid','manual','client_supplied',1,1,1,'ekghybridalphaqz other tenant','$OTHER_ORG','$OTHER_SOURCE','sha256:other-hybrid','{\"synthetic\":true}'::jsonb, embedding from public.reliability_kb_chunks where id='$CHUNK_ID'" >/dev/null

CROSS=$(hits "$ANON_KEY" "$TOKEN" '{"p_claim_type":"failure_behaviour","p_query":"ekghybridalphaqz","p_limit":20}')
test "$(echo "$CROSS" | python3 -c "import sys,json; print(sum(1 for x in json.load(sys.stdin) if x.get('chunk_id')=='EKG-HYBRID-OTHER-001'))")" = "0"

SERVICE=$(hits "$SERVICE_ROLE_KEY" "$SERVICE_ROLE_KEY" '{"p_claim_type":"failure_behaviour","p_query":"ekghybridalphaqz","p_limit":20}')
test "$(echo "$SERVICE" | python3 -c "import sys,json; print(sum(1 for x in json.load(sys.stdin) if x.get('chunk_id')=='EKG-HYBRID-001'))")" = "0"

echo "Hybrid engineering retrieval smoke passed: draft hidden, lexical and vector hits, canonical filter, empty query refused, cross-tenant hidden, service role cannot name a tenant."

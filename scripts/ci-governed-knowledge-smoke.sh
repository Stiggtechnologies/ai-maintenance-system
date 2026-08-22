#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Governed knowledge smoke failed at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"

RESP=$(curl -s "$API_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"demo@syncai.ca","password":"Demo123!@#"}')
TOKEN=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
test -n "$TOKEN"

ORG=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select organization_id from public.user_profiles where lower(email)='demo@syncai.ca' limit 1")
test -n "$ORG"

SOURCE_ID=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/register_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"p_source_key":"SYNTH-PUMP-MANUAL-R1","p_title":"Synthetic Pump Manual R1","p_document_type":"manual","p_document_class":"client_supplied","p_authority_level":"customer_approved","p_confidentiality":"customer_confidential","p_source_checksum":"sha256:synthetic-pump-manual-r1"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin))")
test -n "$SOURCE_ID"

CHUNK_BODY=$(python3 - <<PY
import json
print(json.dumps({
  "chunk_id":"SYNTH-PUMP-MANUAL-R1-001","source_id":"SYNTH-PUMP-MANUAL-R1","title":"Synthetic Pump Manual R1",
  "document_type":"manual","document_class":"client_supplied","page_start":12,"page_end":12,"chunk_index":1,
  "domain_tags":["synthetic","pump"],
  "content":"synthetic cavitation verification datum alphaqz: inspect suction restriction and operating point before attributing impeller damage",
  "organization_id":"$ORG","governed_source_id":"$SOURCE_ID","content_checksum":"sha256:synthetic-chunk-alphaqz",
  "provenance":{"file":"synthetic-pump-manual-r1.pdf","page":12,"synthetic":True}
}))
PY
)
CHUNK_ID=$(curl -fsS -X POST "$API_URL/rest/v1/reliability_kb_chunks?select=id" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" -d "$CHUNK_BODY" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
test -n "$CHUNK_ID"

BEFORE=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/retrieve_kb_context" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d "{\"p_query\":\"alphaqz cavitation\",\"p_claim_type\":\"failure_behaviour\",\"p_limit\":10,\"p_organization_id\":\"$ORG\"}")
test "$(echo "$BEFORE" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")" = "0"

curl -fsS -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\",\"p_entity_type\":\"asset_class\",\"p_canonical_id\":\"synthetic-centrifugal-pump\",\"p_relationship\":\"applies_to\",\"p_confidence\":1,\"p_review_state\":\"approved\",\"p_provenance_chunk_ids\":[\"$CHUNK_ID\"]}" >/dev/null
curl -fsS -X POST "$API_URL/rest/v1/rpc/approve_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\"}" >/dev/null

AFTER=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/retrieve_kb_context" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d "{\"p_query\":\"alphaqz cavitation\",\"p_claim_type\":\"failure_behaviour\",\"p_limit\":10,\"p_organization_id\":\"$ORG\"}")
test "$(echo "$AFTER" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for x in d if x.get('chunk_id')=='SYNTH-PUMP-MANUAL-R1-001'))")" = "1"

OTHER_ORG=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "insert into public.organizations(name,industry) values ('Synthetic Other Tenant','synthetic') returning id")
OTHER_SOURCE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "insert into public.engineering_knowledge_sources(organization_id,source_key,title,document_class,authority_level,review_state,confidentiality,approved_at) values ('$OTHER_ORG','OTHER-SOURCE','Other Tenant Synthetic Source','client_supplied','customer_approved','approved','customer_confidential',now()) returning id")
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "insert into public.reliability_kb_chunks(chunk_id,source_id,title,document_type,document_class,page_start,page_end,chunk_index,content,organization_id,governed_source_id,content_checksum,provenance) values ('OTHER-TENANT-001','OTHER-SOURCE','Other Tenant Synthetic Source','manual','client_supplied',1,1,1,'uniquebetaqz other tenant restricted reliability datum','$OTHER_ORG','$OTHER_SOURCE','sha256:other-tenant','{\"synthetic\":true}'::jsonb)" >/dev/null
CROSS=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/retrieve_kb_context" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_query\":\"uniquebetaqz\",\"p_claim_type\":\"failure_behaviour\",\"p_limit\":10,\"p_organization_id\":\"$OTHER_ORG\"}")
test "$(echo "$CROSS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")" = "0"

AI_SOURCE=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/register_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_source_key":"SYNTH-AI-DRAFT","p_title":"Synthetic AI Draft","p_document_type":"analysis","p_document_class":"client_supplied","p_authority_level":"ai_generated","p_confidentiality":"internal","p_source_checksum":"sha256:synthetic-ai-draft"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin))")
AI_CHUNK_BODY=$(python3 - <<PY
import json
print(json.dumps({"chunk_id":"SYNTH-AI-DRAFT-001","source_id":"SYNTH-AI-DRAFT","title":"Synthetic AI Draft","document_type":"analysis","document_class":"client_supplied","page_start":1,"page_end":1,"chunk_index":1,"content":"synthetic AI generated draft omegaqz","organization_id":"$ORG","governed_source_id":"$AI_SOURCE","content_checksum":"sha256:synthetic-ai-chunk","provenance":{"synthetic":True,"generated":True}}))
PY
)
AI_CHUNK_ID=$(curl -fsS -X POST "$API_URL/rest/v1/reliability_kb_chunks?select=id" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "$AI_CHUNK_BODY" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
curl -fsS -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$AI_SOURCE\",\"p_entity_type\":\"asset_class\",\"p_canonical_id\":\"synthetic-ai-only\",\"p_review_state\":\"approved\",\"p_provenance_chunk_ids\":[\"$AI_CHUNK_ID\"]}" >/dev/null
HTTP=$(curl -s -o /tmp/ai-knowledge-approval.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/approve_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"p_source_id\":\"$AI_SOURCE\"}")
test "$HTTP" -ge 400

echo "Governed knowledge smoke passed: draft hidden, approved source retrieved, cross-tenant denied, AI authority refused."

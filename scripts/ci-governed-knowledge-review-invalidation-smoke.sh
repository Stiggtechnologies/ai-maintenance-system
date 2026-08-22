#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Governed knowledge review-invalidation smoke failed at line $LINENO: $BASH_COMMAND"' ERR

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
  -d '{"p_source_key":"SYNTH-REREVIEW-R1","p_title":"Synthetic Re-review Source","p_document_type":"manual","p_document_class":"client_supplied","p_authority_level":"customer_approved","p_confidentiality":"customer_confidential","p_source_checksum":"sha256:rereview-source-v1"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin))")
test -n "$SOURCE_ID"

CHUNK_BODY=$(python3 - <<PY
import json
print(json.dumps({
  "chunk_id":"SYNTH-REREVIEW-R1-001",
  "source_id":"SYNTH-REREVIEW-R1",
  "title":"Synthetic Re-review Source",
  "document_type":"manual",
  "document_class":"client_supplied",
  "page_start":21,
  "page_end":21,
  "chunk_index":1,
  "domain_tags":["synthetic","governance"],
  "content":"rereviewalphaqz gearcase inspection datum: preserve source approval only while reviewed content is unchanged",
  "organization_id":"$ORG",
  "governed_source_id":"$SOURCE_ID",
  "content_checksum":"sha256:rereview-chunk-v1",
  "provenance":{"file":"synthetic-rereview-r1.pdf","page":21,"synthetic":True}
}))
PY
)
CHUNK_ID=$(curl -fsS -X POST "$API_URL/rest/v1/reliability_kb_chunks?select=id" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" -d "$CHUNK_BODY" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
test -n "$CHUNK_ID"

curl -fsS -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\",\"p_entity_type\":\"asset_class\",\"p_canonical_id\":\"synthetic-rereview-gearcase\",\"p_relationship\":\"applies_to\",\"p_confidence\":1,\"p_review_state\":\"approved\",\"p_provenance_chunk_ids\":[\"$CHUNK_ID\"]}" >/dev/null
curl -fsS -X POST "$API_URL/rest/v1/rpc/approve_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\"}" >/dev/null

state() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
    "select review_state || ':' || (approved_by is null)::text || ':' || (approved_at is null)::text from public.engineering_knowledge_sources where id='$SOURCE_ID'"
}

service_count() {
  local query="$1"
  curl -fsS -X POST "$API_URL/rest/v1/rpc/retrieve_kb_context" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"p_query\":\"$query\",\"p_claim_type\":\"failure_behaviour\",\"p_limit\":10,\"p_organization_id\":\"$ORG\"}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for x in d if x.get('chunk_id')=='SYNTH-REREVIEW-R1-001'))"
}

test "$(state)" = "approved:false:false"
# OR retrieval: one term matches and the second is deliberately impossible.
test "$(service_count 'rereviewalphaqz impossibletermzz')" = "1"

# An authenticated principal with no user-profile/org context cannot substitute
# the explicit service-role organization parameter.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '8b000000-0000-4000-8000-000000000099', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub','8b000000-0000-4000-8000-000000000099','role','authenticated')::text,
  true
);
do \$\$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.retrieve_kb_context(
    'rereviewalphaqz impossibletermzz',
    'failure_behaviour',
    10,
    '$ORG'::uuid
  );
  if v_count <> 0 then
    raise exception 'profile-less authenticated caller escaped governed tenant scope';
  end if;
end
\$\$;
rollback;
SQL

# Material source metadata/checksum changes invalidate approval and hide retrieval.
curl -fsS -X POST "$API_URL/rest/v1/rpc/register_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"p_source_key":"SYNTH-REREVIEW-R1","p_title":"Synthetic Re-review Source Revised","p_document_type":"manual","p_document_class":"client_supplied","p_authority_level":"customer_approved","p_confidentiality":"customer_confidential","p_source_checksum":"sha256:rereview-source-v2"}' >/dev/null
test "$(state)" = "in_review:true:true"
test "$(service_count 'rereviewalphaqz')" = "0"

curl -fsS -X POST "$API_URL/rest/v1/rpc/approve_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\"}" >/dev/null
test "$(service_count 'rereviewalphaqz')" = "1"

# A material applicability change also invalidates the approved source.
curl -fsS -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\",\"p_entity_type\":\"asset_class\",\"p_canonical_id\":\"synthetic-rereview-gearcase\",\"p_relationship\":\"applies_to\",\"p_confidence\":0.9,\"p_review_state\":\"approved\",\"p_provenance_chunk_ids\":[\"$CHUNK_ID\"]}" >/dev/null
test "$(state)" = "in_review:true:true"
test "$(service_count 'rereviewalphaqz')" = "0"

curl -fsS -X POST "$API_URL/rest/v1/rpc/approve_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\"}" >/dev/null

# A canonical chunk/provenance revision invalidates approval before retrieval.
curl -fsS -X PATCH "$API_URL/rest/v1/reliability_kb_chunks?id=eq.$CHUNK_ID" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"rereviewalphaqz gearcase inspection datum revised after controlled source review","content_checksum":"sha256:rereview-chunk-v2","provenance":{"file":"synthetic-rereview-r1.pdf","page":21,"revision":"v2","synthetic":true}}' >/dev/null
test "$(state)" = "in_review:true:true"
test "$(service_count 'rereviewalphaqz')" = "0"

curl -fsS -X POST "$API_URL/rest/v1/rpc/approve_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\"}" >/dev/null
test "$(service_count 'rereviewalphaqz impossibletermzz')" = "1"

# Idempotent re-registration with identical reviewed material must not churn approval.
curl -fsS -X POST "$API_URL/rest/v1/rpc/register_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"p_source_key":"SYNTH-REREVIEW-R1","p_title":"Synthetic Re-review Source Revised","p_document_type":"manual","p_document_class":"client_supplied","p_authority_level":"customer_approved","p_confidentiality":"customer_confidential","p_source_checksum":"sha256:rereview-source-v2"}' >/dev/null
test "$(state)" = "approved:false:false"

echo "Governed knowledge re-review smoke passed: OR retrieval preserved; profile-less scope denied; source, mapping, and chunk mutations invalidate approval."

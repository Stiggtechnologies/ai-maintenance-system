#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Governed engineering context smoke failed at line $LINENO: $BASH_COMMAND"' ERR

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

register_source() {
  local key="$1" title="$2" authority="$3" revision="$4"
  curl -fsS -X POST "$API_URL/rest/v1/rpc/register_engineering_knowledge_source" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"p_source_key\":\"$key\",\"p_title\":\"$title\",\"p_document_type\":\"manual\",\"p_document_class\":\"client_supplied\",\"p_authority_level\":\"$authority\",\"p_confidentiality\":\"customer_confidential\",\"p_asset_class\":\"ROT-EKG-CONTEXT\",\"p_revision\":\"$revision\",\"p_source_checksum\":\"sha256:$key\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin))"
}

add_chunk() {
  local key="$1" source_id="$2"
  local body
  body=$(python3 - <<PY
import json
print(json.dumps({
  "chunk_id":"$key-001","source_id":"$key","title":"$key","document_type":"manual",
  "document_class":"client_supplied","page_start":1,"page_end":1,"chunk_index":1,
  "content":"$key approved source note","organization_id":"$ORG",
  "governed_source_id":"$source_id","content_checksum":"sha256:$key-chunk",
  "provenance":{"synthetic":True,"file":"$key.pdf"}
}))
PY
)
  curl -fsS -X POST "$API_URL/rest/v1/reliability_kb_chunks?select=id" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" -d "$body" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])"
}

A=$(register_source "EKG-CONTEXT-A" "Context source A" "oem_authorized" "1")
B=$(register_source "EKG-CONTEXT-B" "Context source B" "internal_approved" "2")
CHUNK_A=$(add_chunk "EKG-CONTEXT-A" "$A")
CHUNK_B=$(add_chunk "EKG-CONTEXT-B" "$B")
curl -fsS -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$A\",\"p_entity_type\":\"asset_class\",\"p_canonical_id\":\"ROT-EKG-CONTEXT\",\"p_review_state\":\"approved\",\"p_provenance_chunk_ids\":[\"$CHUNK_A\"]}" >/dev/null
curl -fsS -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$A\",\"p_entity_type\":\"component\",\"p_canonical_id\":\"PUMP-EKG-MAPPED\",\"p_review_state\":\"approved\",\"p_provenance_chunk_ids\":[\"$CHUNK_A\"]}" >/dev/null
curl -fsS -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$B\",\"p_entity_type\":\"asset_class\",\"p_canonical_id\":\"ROT-EKG-CONTEXT\",\"p_review_state\":\"approved\",\"p_provenance_chunk_ids\":[\"$CHUNK_B\"]}" >/dev/null
curl -fsS -X POST "$API_URL/rest/v1/rpc/approve_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$A\"}" >/dev/null
curl -fsS -X POST "$API_URL/rest/v1/rpc/approve_engineering_knowledge_source" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$B\"}" >/dev/null

psql_exec "insert into public.reliability_kb_chunks(chunk_id,source_id,title,document_type,document_class,page_start,page_end,chunk_index,content,organization_id) values ('EKG-CONTEXT-PASSAGE','EKG-CONTEXT-PASSAGE','Context passage','note','client_supplied',1,1,1,'ekgcontextalphaqz cavitation note','$ORG')" >/dev/null
OTHER_ORG=$(psql_exec "insert into public.organizations(name,industry) values ('EKG context other','synthetic') returning id" | grep -E '^[0-9a-f-]{36}$' | head -n 1)
psql_exec "insert into public.reliability_kb_chunks(chunk_id,source_id,title,document_type,document_class,page_start,page_end,chunk_index,content,organization_id) values ('EKG-CONTEXT-FOREIGN','EKG-CONTEXT-FOREIGN','Foreign passage','note','client_supplied',1,1,1,'ekgcontextalphaqz other-tenant-ekg-context-secret','$OTHER_ORG')" >/dev/null
EVIDENCE=$(psql_exec "insert into public.evidence_items(organization_id,source_system,evidence_type,description) values ('$ORG','ekg-context','note','ekg-context-evidence-body-should-stay-out') returning id" | grep -E '^[0-9a-f-]{36}$' | head -n 1)
FOREIGN_EVIDENCE=$(psql_exec "insert into public.evidence_items(organization_id,source_system,evidence_type,description) values ('$OTHER_ORG','ekg-context','note','foreign-evidence-body') returning id" | grep -E '^[0-9a-f-]{36}$' | head -n 1)

STATE_BEFORE=$(psql_exec "select review_state from public.engineering_knowledge_sources where id='$A'")
curl -fsS -X POST "$API_URL/rest/v1/rpc/build_governed_engineering_context" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_claim_type\":\"failure_behaviour\",\"p_query\":\"ekgcontextalphaqz\",\"p_asset_class\":\"ROT-EKG-CONTEXT\",\"p_asset_twin_id\":\"twin-ekg-context\",\"p_component_codes\":[\"PUMP-EKG-MAPPED\",\"PUMP-EKG-NOMAP\"],\"p_failure_mode_codes\":[\"EKG-NOMAP-FAIL\"],\"p_physics_capability_codes\":[\"PHYS-EKG-NOCALC\"],\"p_retrieved_chunk_ids\":[\"EKG-CONTEXT-FOREIGN\"],\"p_physics_results\":[{\"capabilityCode\":\"PHYS-EKG-REF\",\"resultRef\":\"RESULT-EKG-1\"}],\"p_evidence_ids\":[\"$EVIDENCE\",\"$FOREIGN_EVIDENCE\"]}" \
  -o /tmp/ekg-context-package.json
python3 - <<PY
import json
body=json.load(open("/tmp/ekg-context-package.json"))
assert body["humanApprovalRequired"] is True
assert body["autonomousOperationalActionAllowed"] is False
assert body["grantsWorkRelease"] is False
assert body["grantsApprovalAuthority"] is False
assert body["grantsApproval"] is False
assert body["tenantId"]=="$ORG"
assert body["assetTwinId"]=="twin-ekg-context"
blob=json.dumps(body)
assert "ekgcontextalphaqz" in blob
assert "UNTRUSTED RETRIEVED EVIDENCE" in blob
assert "other-tenant-ekg-context-secret" not in blob
assert "ekg-context-evidence-body-should-stay-out" not in blob
assert "foreign-evidence-body" not in blob
assert body["unverifiedChunkIds"]==["EKG-CONTEXT-FOREIGN"]
assert "$EVIDENCE" in body["evidenceIds"]
assert "$FOREIGN_EVIDENCE" in body["unverifiedEvidenceIds"]
assert "$EVIDENCE" not in body["unverifiedEvidenceIds"]
assert "component:PUMP-EKG-NOMAP" in body["missingEvidence"]
assert "failure_mode:EKG-NOMAP-FAIL" in body["missingEvidence"]
assert "physics_capability:PHYS-EKG-NOCALC" in body["missingEvidence"]
assert "component:PUMP-EKG-MAPPED" not in body["missingEvidence"]
kinds={item["kind"] for item in body["conflicts"]}
assert kinds=={"revision_conflict","authority_conflict"}
assert "$A" in body["sourceConflictIds"] and "$B" in body["sourceConflictIds"]
assert body["physicsResults"]==[{"capabilityCode":"PHYS-EKG-REF","resultRef":"RESULT-EKG-1","unverified":True}]
assert "confidence" not in body
PY
STATE_AFTER=$(psql_exec "select review_state from public.engineering_knowledge_sources where id='$A'")
test "$STATE_BEFORE" = "$STATE_AFTER"
test "$STATE_AFTER" = "approved"

curl -fsS -X POST "$API_URL/rest/v1/rpc/build_governed_engineering_context" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TECH" -H "Content-Type: application/json" \
  -d '{"p_claim_type":"failure_behaviour","p_query":"ekgcontextalphaqz","p_asset_class":"ROT-EKG-CONTEXT"}' \
  -o /tmp/ekg-context-tech.json
python3 - <<PY
import json
body=json.load(open("/tmp/ekg-context-tech.json"))
assert body["grantsApproval"] is False
assert "ekgcontextalphaqz" in json.dumps(body)
assert "other-tenant-ekg-context-secret" not in json.dumps(body)
PY

curl -fsS -X POST "$API_URL/rest/v1/rpc/build_governed_engineering_context" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"p_claim_type":"failure_behaviour","p_query":"ekgcontextalphaqz"}' \
  -o /tmp/ekg-context-forbidden.json
python3 - <<PY
import json
body=json.load(open("/tmp/ekg-context-forbidden.json"))
assert body.get("error")=="forbidden"
assert "ekgcontextalphaqz" not in json.dumps(body)
assert body["grantsApproval"] is False
PY

COPY=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/build_governed_engineering_context" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_claim_type":"failure_behaviour","p_query":"ekgcontextalphaqz","p_physics_results":[{"capabilityCode":"PHYS-EKG-REF","resultRef":"RESULT-EKG-1","value":12.5}]}')
test "$COPY" -ge 400

NUMBER=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/build_governed_engineering_context" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_claim_type":"failure_behaviour","p_query":"ekgcontextalphaqz","p_physics_results":[{"capabilityCode":"PHYS-EKG-REF","resultRef":"12.5"}]}')
test "$NUMBER" -ge 400

ANON=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/build_governed_engineering_context" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_claim_type":"failure_behaviour","p_query":"ekgcontextalphaqz"}')
test "$ANON" = "401"

echo "Governed engineering context smoke passed: passage enveloped, foreign chunk and evidence withheld, conflicts named, missing codes listed, physics kept as a reference, no authority."

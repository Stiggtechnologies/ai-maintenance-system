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
test "$ORG" = "11111111-1111-1111-1111-111111111111"
DEMO_UID=$(psql_uuid "select id from public.user_profiles where lower(email)='demo@syncai.ca' limit 1")
test -n "$DEMO_UID"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_user record;
begin
  for v_user in
    select *
    from (values
      ('99999999-9999-4999-8999-999999999999'::uuid, 'smoke-aibot@syncai.ca', 'Smoke AI operator', 'ai_admin', 'AiBot123!@#'),
      ('99999999-9999-4999-8999-999999999998'::uuid, 'smoke-steward@syncai.ca', 'Smoke human steward', 'reliability_engineer', 'Steward123!@#')
    ) as seeded(uid, email, full_name, role_name, password)
  loop
    if not exists (select 1 from auth.users where id = v_user.uid) then
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change, email_change_token_new,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000', v_user.uid,
        'authenticated', 'authenticated', v_user.email,
        extensions.crypt(v_user.password, extensions.gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('full_name', v_user.full_name),
        '', '', '', '', '', '', '', ''
      );
    end if;
    update auth.users set
      confirmation_token = coalesce(confirmation_token, ''),
      recovery_token = coalesce(recovery_token, ''),
      email_change = coalesce(email_change, ''),
      email_change_token_new = coalesce(email_change_token_new, ''),
      email_change_token_current = coalesce(email_change_token_current, ''),
      phone_change = coalesce(phone_change, ''),
      phone_change_token = coalesce(phone_change_token, ''),
      reauthentication_token = coalesce(reauthentication_token, '')
    where id = v_user.uid;
    if not exists (select 1 from auth.identities where user_id = v_user.uid) then
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
      ) values (
        gen_random_uuid(), v_user.uid, v_user.uid,
        jsonb_build_object('sub', v_user.uid::text, 'email', v_user.email),
        'email', now(), now(), now()
      );
    end if;
    insert into public.user_profiles (id, organization_id, email, role)
    values (v_user.uid, v_org, v_user.email, v_user.role_name)
    on conflict (id) do update
      set role = excluded.role,
          organization_id = excluded.organization_id,
          email = excluded.email;
  end loop;
end $seed$;
PSQL
AIBOT=$(token "smoke-aibot@syncai.ca" "AiBot123!@#")
STEWARD=$(token "smoke-steward@syncai.ca" "Steward123!@#")
test -n "$AIBOT"
test -n "$STEWARD"
STEWARD_UID=$(psql_uuid "select id from public.user_profiles where lower(email)='smoke-steward@syncai.ca' limit 1")
test "$STEWARD_UID" = "99999999-9999-4999-8999-999999999998"

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

APPROVE=$(python3 - <<PY
import json
print(json.dumps({
  "p_source_id": "$SOURCE_ID",
  "p_mappings": [{
    "entityType": "asset_twin",
    "canonicalId": "twin-ekg-pump-1",
    "relationship": "applies_to",
    "reviewState": "approved",
    "provenanceChunkIds": ["$CHUNK_ID"]
  }]
}))
PY
)
curl -fsS -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$APPROVE" >/dev/null
STATE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select review_state || '|' || coalesce(reviewed_by::text,'') from public.engineering_knowledge_mappings where source_id='$SOURCE_ID' and canonical_id='twin-ekg-pump-1'")
test "$STATE" = "approved|$DEMO_UID"

DEMOTE=$(python3 - <<PY
import json
print(json.dumps({
  "p_source_id": "$SOURCE_ID",
  "p_mappings": [{
    "entityType": "asset_twin",
    "canonicalId": "twin-ekg-pump-1",
    "relationship": "applies_to",
    "reviewState": "draft",
    "provenanceChunkIds": ["$CHUNK_ID"]
  }]
}))
PY
)
DEMOTE_HTTP=$(curl -sS -o /tmp/ekg-map-demote.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$DEMOTE")
test "$DEMOTE_HTTP" -ge 400
python3 - <<'PY'
import json
body=json.load(open("/tmp/ekg-map-demote.json"))
text=body if isinstance(body,str) else json.dumps(body)
assert "explicit reason" in text.lower(), body
PY
STATE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select review_state || '|' || coalesce(reviewed_by::text,'') || '|' || coalesce(review_change_reason,'') from public.engineering_knowledge_mappings where source_id='$SOURCE_ID' and canonical_id='twin-ekg-pump-1'")
test "$STATE" = "approved|$DEMO_UID|"

TAKEOVER=$(python3 - <<PY
import json
print(json.dumps({
  "p_source_id": "$SOURCE_ID",
  "p_mappings": [{
    "entityType": "asset_twin",
    "canonicalId": "twin-ekg-pump-1",
    "relationship": "applies_to",
    "reviewState": "approved",
    "provenanceChunkIds": ["$CHUNK_ID"]
  }]
}))
PY
)
TAKE_HTTP=$(curl -sS -o /tmp/ekg-map-takeover.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STEWARD" -H "Content-Type: application/json" -d "$TAKEOVER")
test "$TAKE_HTTP" -ge 400
python3 - <<'PY'
import json
body=json.load(open("/tmp/ekg-map-takeover.json"))
text=body if isinstance(body,str) else json.dumps(body)
assert "explicit reason" in text.lower(), body
PY
STATE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select reviewed_by::text from public.engineering_knowledge_mappings where source_id='$SOURCE_ID' and canonical_id='twin-ekg-pump-1'")
test "$STATE" = "$DEMO_UID"

TAKE_REASON=$(python3 - <<PY
import json
print(json.dumps({
  "p_source_id": "$SOURCE_ID",
  "p_mappings": [{
    "entityType": "asset_twin",
    "canonicalId": "twin-ekg-pump-1",
    "relationship": "applies_to",
    "reviewState": "approved",
    "reason": "Second human steward accepts the same applicability.",
    "provenanceChunkIds": ["$CHUNK_ID"]
  }]
}))
PY
)
curl -fsS -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $STEWARD" -H "Content-Type: application/json" \
  -d "$TAKE_REASON" >/dev/null
STATE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select review_state || '|' || reviewed_by::text from public.engineering_knowledge_mappings where source_id='$SOURCE_ID' and canonical_id='twin-ekg-pump-1'")
test "$STATE" = "approved|$STEWARD_UID"

AI_APPROVE=$(python3 - <<PY
import json
print(json.dumps({
  "p_source_id": "$SOURCE_ID",
  "p_mappings": [{
    "entityType": "sensor",
    "canonicalId": "sensor-ekg-ai-approve",
    "relationship": "detected_by",
    "reviewState": "approved",
    "provenanceChunkIds": ["$CHUNK_ID"]
  }]
}))
PY
)
AI_APPROVE_HTTP=$(curl -sS -o /tmp/ekg-map-ai-approve.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $AIBOT" -H "Content-Type: application/json" -d "$AI_APPROVE")
test "$AI_APPROVE_HTTP" -ge 400
python3 - <<'PY'
import json
body=json.load(open("/tmp/ekg-map-ai-approve.json"))
text=body if isinstance(body,str) else json.dumps(body)
assert "ai_admin" in text, body
PY

AI_SUPER=$(python3 - <<PY
import json
print(json.dumps({
  "p_source_id": "$SOURCE_ID",
  "p_mappings": [{
    "entityType": "sensor",
    "canonicalId": "sensor-ekg-ai-super",
    "relationship": "detected_by",
    "reviewState": "superseded",
    "provenanceChunkIds": ["$CHUNK_ID"]
  }]
}))
PY
)
AI_SUPER_HTTP=$(curl -sS -o /tmp/ekg-map-ai-super.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $AIBOT" -H "Content-Type: application/json" -d "$AI_SUPER")
test "$AI_SUPER_HTTP" -ge 400
python3 - <<'PY'
import json
body=json.load(open("/tmp/ekg-map-ai-super.json"))
text=body if isinstance(body,str) else json.dumps(body)
assert "ai_admin" in text, body
PY

AI_UPSERT_HTTP=$(curl -sS -o /tmp/ekg-map-ai-upsert.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $AIBOT" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\",\"p_entity_type\":\"asset_class\",\"p_canonical_id\":\"upsert-ai-admin-approve\",\"p_relationship\":\"applies_to\",\"p_review_state\":\"approved\",\"p_provenance_chunk_ids\":[\"$CHUNK_ID\"]}")
test "$AI_UPSERT_HTTP" -ge 400
python3 - <<'PY'
import json
body=json.load(open("/tmp/ekg-map-ai-upsert.json"))
text=body if isinstance(body,str) else json.dumps(body)
assert "ai_admin" in text, body
PY
ABSENT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select count(*) from public.engineering_knowledge_mappings where canonical_id in ('sensor-ekg-ai-approve','sensor-ekg-ai-super','upsert-ai-admin-approve')")
test "$ABSENT" = "0"

AI_DRAFT=$(python3 - <<PY
import json
print(json.dumps({
  "p_source_id": "$SOURCE_ID",
  "p_mappings": [{
    "entityType": "sensor",
    "canonicalId": "sensor-ekg-ai-draft",
    "relationship": "detected_by",
    "reviewState": "draft",
    "provenanceChunkIds": ["$CHUNK_ID"]
  }]
}))
PY
)
curl -fsS -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $AIBOT" -H "Content-Type: application/json" \
  -d "$AI_DRAFT" >/dev/null
DRAFT_STATE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select review_state from public.engineering_knowledge_mappings where source_id='$SOURCE_ID' and canonical_id='sensor-ekg-ai-draft'")
test "$DRAFT_STATE" = "draft"

HUMAN_UPSERT=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\",\"p_entity_type\":\"asset_class\",\"p_canonical_id\":\"upsert-human-approved\",\"p_relationship\":\"applies_to\",\"p_review_state\":\"approved\",\"p_provenance_chunk_ids\":[\"$CHUNK_ID\"]}")
test -n "$HUMAN_UPSERT"
AI_DEMOTE_UPSERT=$(curl -sS -o /tmp/ekg-map-ai-demote-upsert.json -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/upsert_engineering_knowledge_mapping" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $AIBOT" -H "Content-Type: application/json" \
  -d "{\"p_source_id\":\"$SOURCE_ID\",\"p_entity_type\":\"asset_class\",\"p_canonical_id\":\"upsert-human-approved\",\"p_relationship\":\"applies_to\",\"p_review_state\":\"draft\",\"p_provenance_chunk_ids\":[\"$CHUNK_ID\"]}")
test "$AI_DEMOTE_UPSERT" -ge 400
python3 - <<'PY'
import json
body=json.load(open("/tmp/ekg-map-ai-demote-upsert.json"))
text=body if isinstance(body,str) else json.dumps(body)
assert "explicit reason" in text.lower(), body
PY
STILL=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select review_state || '|' || reviewed_by::text from public.engineering_knowledge_mappings where source_id='$SOURCE_ID' and canonical_id='upsert-human-approved'")
test "$STILL" = "approved|$DEMO_UID"

REASONED=$(python3 - <<PY
import json
print(json.dumps({
  "p_source_id": "$SOURCE_ID",
  "p_mappings": [{
    "entityType": "asset_twin",
    "canonicalId": "twin-ekg-pump-1",
    "relationship": "applies_to",
    "reviewState": "superseded",
    "reason": "Human steward retired this applicability.",
    "provenanceChunkIds": ["$CHUNK_ID"]
  }]
}))
PY
)
curl -fsS -X POST "$API_URL/rest/v1/rpc/persist_document_engineering_mappings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$REASONED" >/dev/null
RETIRED=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select review_state || '|' || review_change_reason from public.engineering_knowledge_mappings where source_id='$SOURCE_ID' and canonical_id='twin-ekg-pump-1'")
test "$RETIRED" = "superseded|Human steward retired this applicability."

echo "Document engineering mapping smoke passed: ontology targets persisted, idempotent, steward-only, tenant wall held, direct insert refused, AI approval refused, ai_admin cannot approve or supersede, approved mappings keep their reviewer without a reason, no authority granted."

#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Failure detection path smoke failed at line $LINENO: $BASH_COMMAND"' ERR

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

psql_exec "insert into public.engineering_knowledge_relationships(organization_id,relationship_code,relationship_type,from_entity_type,from_canonical_id,to_entity_type,to_canonical_id,provenance_canonical_ids,review_state,created_by_kind) values
('$ORG','EKG-PATH-FAIL','may_fail_by','component','PUMP-EKG-PATH','failure_mode','EKG-PATH-CAV',array['ROT-CENT-PUMP'],'draft','migration'),
('$ORG','EKG-PATH-DETECT','detected_by','failure_mode','EKG-PATH-CAV','inspection_method','vibration',array['ROT-CENT-PUMP'],'draft','migration'),
('$ORG','EKG-PATH-REJECTED','may_fail_by','component','PUMP-EKG-PATH','failure_mode','EKG-PATH-HIDDEN',array['ROT-CENT-PUMP'],'rejected','migration'),
('$ORG','EKG-CYCLE-A','composed_of','component','EKG-CYCLE-A','component','EKG-CYCLE-B',array['ROT-CENT-PUMP'],'approved','migration'),
('$ORG','EKG-CYCLE-B','composed_of','component','EKG-CYCLE-B','component','EKG-CYCLE-A',array['ROT-CENT-PUMP'],'approved','migration')" >/dev/null

OTHER_ORG=$(psql_exec "insert into public.organizations(name,industry) values ('EKG path other','synthetic') returning id" | grep -E '^[0-9a-f-]{36}$' | head -n 1)
psql_exec "insert into public.engineering_knowledge_relationships(organization_id,relationship_code,relationship_type,from_entity_type,from_canonical_id,to_entity_type,to_canonical_id,provenance_canonical_ids,review_state,created_by_kind) values ('$OTHER_ORG','EKG-PATH-FOREIGN','may_fail_by','component','OTHER-EKG-SECRET','failure_mode','OTHER-EKG-SECRET-FAIL',array['OTHER'],'approved','migration')" >/dev/null

PATHS=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/query_failure_detection_paths" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_root_canonical_id":"PUMP-EKG-PATH","p_max_depth":4}')
python3 - <<PY
import json
body=json.loads('''$PATHS''')
assert body["grantsAuthority"] is False and body["grantsWorkRelease"] is False and body["grantsApproval"] is False
assert body["truncated"] is False
blob=json.dumps(body)
assert "EKG-PATH-CAV" in blob and "vibration" in blob
assert "EKG-PATH-HIDDEN" not in blob
assert "OTHER-EKG-SECRET" not in blob
assert "propagationProbability" not in blob
found=False
for path in body["paths"]:
    kinds=[step["relationshipType"] for step in path["steps"]]
    if kinds[:2]==["may_fail_by","detected_by"]:
        found=True
        assert path["steps"][0]["reviewState"]=="draft"
assert found, body
PY

SHALLOW=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/query_failure_detection_paths" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_root_canonical_id":"PUMP-EKG-PATH","p_max_depth":1}')
python3 - <<PY
import json
body=json.loads('''$SHALLOW''')
assert all(len(path["steps"])==1 for path in body["paths"])
assert all(step["relationshipType"]!="detected_by" for path in body["paths"] for step in path["steps"])
PY

CYCLE=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/query_failure_detection_paths" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_root_canonical_id":"EKG-CYCLE-A","p_max_depth":8}')
python3 - <<PY
import json
body=json.loads('''$CYCLE''')
assert body["truncated"] is False
assert len(body["paths"])==1
codes=[step["relationshipCode"] for step in body["paths"][0]["steps"]]
assert codes==["EKG-CYCLE-A"]
assert all(step["toCanonicalId"]!="EKG-CYCLE-A" for step in body["paths"][0]["steps"])
PY

FOREIGN=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/query_failure_detection_paths" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_root_canonical_id":"OTHER-EKG-SECRET"}')
python3 - <<PY
import json
body=json.loads('''$FOREIGN''')
assert body["paths"]==[]
assert "OTHER-EKG-SECRET-FAIL" not in json.dumps(body)
PY

TECH_PATHS=$(curl -fsS -X POST "$API_URL/rest/v1/rpc/query_failure_detection_paths" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TECH" -H "Content-Type: application/json" \
  -d '{"p_root_canonical_id":"PUMP-EKG-PATH","p_max_depth":2}')
python3 - <<PY
import json
body=json.loads('''$TECH_PATHS''')
assert body["grantsApproval"] is False
assert "EKG-PATH-CAV" in json.dumps(body)
PY

DEEP=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/query_failure_detection_paths" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_root_canonical_id":"PUMP-EKG-PATH","p_max_depth":9}')
test "$DEEP" -ge 400

ANON=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/rpc/query_failure_detection_paths" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_root_canonical_id":"PUMP-EKG-PATH"}')
test "$ANON" = "401"

INSERT_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/engineering_knowledge_relationships" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"organization_id\":\"$ORG\",\"relationship_code\":\"direct-path\",\"relationship_type\":\"contains\",\"from_entity_type\":\"asset_class\",\"from_canonical_id\":\"A\",\"to_entity_type\":\"component\",\"to_canonical_id\":\"B\",\"provenance_canonical_ids\":[\"A\"],\"created_by_kind\":\"human\"}")
test "$INSERT_HTTP" -ge 400

echo "Failure detection path smoke passed: draft path walked, depth capped, cycle stopped, rejected and cross-tenant edges hidden, no authority."

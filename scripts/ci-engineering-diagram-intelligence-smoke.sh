#!/usr/bin/env bash
# C2.09 extension — governed Engineering Diagram Intelligence.
set -euo pipefail
trap 'echo "Engineering Diagram Intelligence smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|JWT_SECRET|SERVICE_ROLE_KEY)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}" \
  "${JWT_SECRET:?missing JWT_SECRET}" "${SERVICE_ROLE_KEY:?missing SERVICE_ROLE_KEY}"

uuid(){ python3 -c 'import uuid; print(uuid.uuid4())'; }
ORG=$(uuid); FOREIGN_ORG=$(uuid)
CONTROLLER=$(uuid); REVIEWER=$(uuid); GRAPH_REVIEWER=$(uuid); FOREIGN=$(uuid); AI_USER=$(uuid)
CONTROLLER_FACTOR=$(uuid); REVIEWER_FACTOR=$(uuid); GRAPH_FACTOR=$(uuid); FOREIGN_FACTOR=$(uuid)
ASSET_A=$(uuid); ASSET_B=$(uuid); FOREIGN_ASSET=$(uuid)

jwt(){
  SUBJECT="$1" ASSURANCE="$2" EMAIL="$3" JWT_SECRET_VALUE="$JWT_SECRET" python3 - <<'PY'
import base64,hashlib,hmac,json,os,time
def enc(v): return base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=').decode()
now=int(time.time()); h=enc({'alg':'HS256','typ':'JWT'})
p=enc({'aud':'authenticated','exp':now+3600,'iat':now,'sub':os.environ['SUBJECT'],
  'email':os.environ['EMAIL'],'phone':'','role':'authenticated','aal':os.environ['ASSURANCE'],
  'app_metadata':{'provider':'email','providers':['email']},'user_metadata':{},
  'amr':[{'method':'password','timestamp':now}]})
body=f'{h}.{p}'; sig=base64.urlsafe_b64encode(hmac.new(os.environ['JWT_SECRET_VALUE'].encode(),body.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
print(f'{body}.{sig}')
PY
}
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
service_rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$1" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' -d "$2"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; x=json.loads(os.environ['BODY']); v=x.get(os.environ['KEY']); print('' if v is None else str(v).lower() if isinstance(v,bool) else v)"; }
table_field(){ BODY="$1" KEY="$2" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert isinstance(x,list) and x; print(x[0][os.environ['KEY']])"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=x.get('error') if isinstance(x,dict) else None; print(x,file=sys.stderr) if e else None; sys.exit(1 if e else 0)"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('message') or '') if isinstance(x,dict) else str(x); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
ingest(){ rpc "$CONTROLLER_AAL1" kb_ingest_document "{\"p_source_id\":\"$1\",\"p_title\":\"$2\",\"p_document_class\":\"client_supplied\",\"p_chunks\":[{\"chunk_index\":0,\"content\":\"Controlled P and ID evidence for $1. The exact revision is retained for governed engineering review.\"}]}"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<PSQL
insert into organizations(id,name) values
  ('$ORG','Diagram Intelligence tenant'),('$FOREIGN_ORG','Foreign diagram tenant');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
  recovery_token,email_change,email_change_token_new,email_change_token_current,
  phone_change,phone_change_token,reauthentication_token) values
('00000000-0000-0000-0000-000000000000','$CONTROLLER','authenticated','authenticated','diagram-controller-$CONTROLLER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$REVIEWER','authenticated','authenticated','diagram-reviewer-$REVIEWER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$GRAPH_REVIEWER','authenticated','authenticated','diagram-graph-$GRAPH_REVIEWER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN','authenticated','authenticated','diagram-foreign-$FOREIGN@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$AI_USER','authenticated','authenticated','diagram-ai-$AI_USER@invalid.syncai.ca','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','','','','','');
insert into user_profiles(id,organization_id,email,full_name,role) values
  ('$CONTROLLER','$ORG','diagram-controller-$CONTROLLER@invalid.syncai.ca','Diagram controller','reliability_engineer'),
  ('$REVIEWER','$ORG','diagram-reviewer-$REVIEWER@invalid.syncai.ca','Independent mapping reviewer','admin'),
  ('$GRAPH_REVIEWER','$ORG','diagram-graph-$GRAPH_REVIEWER@invalid.syncai.ca','Independent graph reviewer','maintenance_manager'),
  ('$FOREIGN','$FOREIGN_ORG','diagram-foreign-$FOREIGN@invalid.syncai.ca','Foreign reviewer','admin'),
  ('$AI_USER','$ORG','diagram-ai-$AI_USER@invalid.syncai.ca','AI operator','ai_admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at) values
  ('$CONTROLLER_FACTOR','$CONTROLLER','Controller factor','totp','verified',now(),now()),
  ('$REVIEWER_FACTOR','$REVIEWER','Mapping reviewer factor','totp','verified',now(),now()),
  ('$GRAPH_FACTOR','$GRAPH_REVIEWER','Graph reviewer factor','totp','verified',now(),now()),
  ('$FOREIGN_FACTOR','$FOREIGN','Foreign factor','totp','verified',now(),now());
insert into assets(id,organization_id,tag,name,asset_class) values
  ('$ASSET_A','$ORG','P-100','Process-water pump P-100','pump'),
  ('$ASSET_B','$ORG','TK-100','Process-water tank TK-100','tank'),
  ('$FOREIGN_ASSET','$FOREIGN_ORG','F-100','Foreign asset','pump');
PSQL

CONTROLLER_AAL1=$(jwt "$CONTROLLER" aal1 "diagram-controller-$CONTROLLER@invalid.syncai.ca")
CONTROLLER_AAL2=$(jwt "$CONTROLLER" aal2 "diagram-controller-$CONTROLLER@invalid.syncai.ca")
REVIEWER_AAL1=$(jwt "$REVIEWER" aal1 "diagram-reviewer-$REVIEWER@invalid.syncai.ca")
REVIEWER_AAL2=$(jwt "$REVIEWER" aal2 "diagram-reviewer-$REVIEWER@invalid.syncai.ca")
GRAPH_AAL2=$(jwt "$GRAPH_REVIEWER" aal2 "diagram-graph-$GRAPH_REVIEWER@invalid.syncai.ca")
FOREIGN_AAL2=$(jwt "$FOREIGN" aal2 "diagram-foreign-$FOREIGN@invalid.syncai.ca")
AI_AAL1=$(jwt "$AI_USER" aal1 "diagram-ai-$AI_USER@invalid.syncai.ca")

# Create the one canonical controlled source revision and make it effective
# through an independent AAL2 decision.
INGESTED=$(ingest 'diagram-pid-a' 'Process-water P and ID revision A'); noerr "$INGESTED"
DOCUMENT=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='diagram-pid-a';")
REGISTERED=$(rpc "$CONTROLLER_AAL1" register_controlled_technical_document "{\"p_document_id\":\"$DOCUMENT\",\"p_record\":{\"kind\":\"pid\",\"documentNumber\":\"PID-DI-100\",\"revisionLabel\":\"A\",\"applicability\":\"Process-water pump and tank flow path.\",\"basis\":\"Approved issue and field walkdown establish this exact source revision.\"}}")
noerr "$REGISTERED"
EFFECTIVE=$(rpc "$REVIEWER_AAL2" review_controlled_technical_document "{\"p_document_id\":\"$DOCUMENT\",\"p_decision\":\"effective\",\"p_basis\":\"Independent AAL2 comparison against the approved issue and installed flow path.\"}")
noerr "$EFFECTIVE"; test "$(field "$EFFECTIVE" controlStatus)" = 'effective'

# Prepare and upload real private bytes through the storage API. The database
# run cannot be created from metadata-only or missing-object claims.
SOURCE_FILE=$(mktemp)
RETRY_FILE=$(mktemp)
DIRECT_BODY=$(mktemp)
trap 'rm -f "$SOURCE_FILE" "$RETRY_FILE" "$DIRECT_BODY"' EXIT
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' | base64 --decode > "$SOURCE_FILE"
SOURCE_SIZE=$(wc -c < "$SOURCE_FILE" | tr -d ' ')
SOURCE_SHA=$(sha256sum "$SOURCE_FILE" | awk '{print $1}')
PREPARED=$(rpc "$CONTROLLER_AAL1" prepare_engineering_diagram_upload "{\"p_document_id\":\"$DOCUMENT\",\"p_filename\":\"pid-di-100-a.png\",\"p_mime_type\":\"image/png\",\"p_size_bytes\":$SOURCE_SIZE,\"p_input_sha256\":\"$SOURCE_SHA\"}")
noerr "$PREPARED"; test "$(field "$PREPARED" immutable)" = 'true'; test "$(field "$PREPARED" operationalAuthorization)" = 'false'
OBJECT_PATH=$(field "$PREPARED" objectPath)
UPLOAD_CODE=$(curl -sS -o "$DIRECT_BODY" -w '%{http_code}' -X POST "$API_URL/storage/v1/object/engineering-diagrams/$OBJECT_PATH" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $CONTROLLER_AAL1" -H 'Content-Type: image/png' --data-binary "@$SOURCE_FILE")
case "$UPLOAD_CODE" in 200|201) ;; *) cat "$DIRECT_BODY"; false ;; esac
test "$(psqlc "select public::text from storage.buckets where id='engineering-diagrams';")" = 'false'
ANON_OBJECT=$(curl -sS -o "$DIRECT_BODY" -w '%{http_code}' "$API_URL/storage/v1/object/engineering-diagrams/$OBJECT_PATH" -H "apikey: $ANON_KEY")
test "$ANON_OBJECT" != '200'
FOREIGN_OBJECT=$(curl -sS -o "$DIRECT_BODY" -w '%{http_code}' "$API_URL/storage/v1/object/authenticated/engineering-diagrams/$OBJECT_PATH" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $FOREIGN_AAL2")
test "$FOREIGN_OBJECT" != '200'

AI_PREPARE=$(rpc "$AI_AAL1" prepare_engineering_diagram_upload "{\"p_document_id\":\"$DOCUMENT\",\"p_filename\":\"forbidden.png\",\"p_mime_type\":\"image/png\",\"p_size_bytes\":1,\"p_input_sha256\":\"$SOURCE_SHA\"}")
expect_error "$AI_PREPARE" 'named same-tenant engineering authority'
MISSING_SHA='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
MISSING=$(rpc "$CONTROLLER_AAL1" create_engineering_diagram_run "{\"p_document_id\":\"$DOCUMENT\",\"p_object_path\":\"$ORG/$DOCUMENT/$MISSING_SHA/missing.png\",\"p_input_sha256\":\"$MISSING_SHA\",\"p_idempotency_key\":\"missing-object-proof\"}")
expect_error "$MISSING" 'private source object is missing'

CREATED=$(rpc "$CONTROLLER_AAL1" create_engineering_diagram_run "{\"p_document_id\":\"$DOCUMENT\",\"p_object_path\":\"$OBJECT_PATH\",\"p_input_sha256\":\"$SOURCE_SHA\",\"p_idempotency_key\":\"$DOCUMENT:$SOURCE_SHA\"}")
noerr "$CREATED"; RUN=$(field "$CREATED" runId); test "$(field "$CREATED" operationalAuthorization)" = 'false'
REPLAY=$(rpc "$CONTROLLER_AAL1" create_engineering_diagram_run "{\"p_document_id\":\"$DOCUMENT\",\"p_object_path\":\"$OBJECT_PATH\",\"p_input_sha256\":\"$SOURCE_SHA\",\"p_idempotency_key\":\"$DOCUMENT:$SOURCE_SHA\"}")
noerr "$REPLAY"; test "$(field "$REPLAY" runId)" = "$RUN"; test "$(field "$REPLAY" idempotentReplay)" = 'true'

# A failed provider attempt is audited and can be re-queued only by an
# authorized same-tenant human with a stated basis. The immutable source and
# run identity remain unchanged while each worker claim increments the attempt.
cp "$SOURCE_FILE" "$RETRY_FILE"; printf '%s' 'retry-proof' >> "$RETRY_FILE"
RETRY_SIZE=$(wc -c < "$RETRY_FILE" | tr -d ' ')
RETRY_SHA=$(sha256sum "$RETRY_FILE" | awk '{print $1}')
RETRY_PREPARED=$(rpc "$CONTROLLER_AAL1" prepare_engineering_diagram_upload "{\"p_document_id\":\"$DOCUMENT\",\"p_filename\":\"pid-di-100-retry.png\",\"p_mime_type\":\"image/png\",\"p_size_bytes\":$RETRY_SIZE,\"p_input_sha256\":\"$RETRY_SHA\"}")
noerr "$RETRY_PREPARED"; RETRY_OBJECT_PATH=$(field "$RETRY_PREPARED" objectPath)
RETRY_UPLOAD_CODE=$(curl -sS -o "$DIRECT_BODY" -w '%{http_code}' -X POST "$API_URL/storage/v1/object/engineering-diagrams/$RETRY_OBJECT_PATH" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $CONTROLLER_AAL1" -H 'Content-Type: image/png' --data-binary "@$RETRY_FILE")
case "$RETRY_UPLOAD_CODE" in 200|201) ;; *) cat "$DIRECT_BODY"; false ;; esac
RETRY_CREATED=$(rpc "$CONTROLLER_AAL1" create_engineering_diagram_run "{\"p_document_id\":\"$DOCUMENT\",\"p_object_path\":\"$RETRY_OBJECT_PATH\",\"p_input_sha256\":\"$RETRY_SHA\",\"p_idempotency_key\":\"$DOCUMENT:$RETRY_SHA\"}")
noerr "$RETRY_CREATED"; RETRY_RUN=$(field "$RETRY_CREATED" runId)
RETRY_CLAIMED=$(service_rpc claim_engineering_diagram_run "{\"p_run_id\":\"$RETRY_RUN\"}")
noerr "$RETRY_CLAIMED"; test "$(field "$RETRY_CLAIMED" attemptCount)" = '1'
service_rpc fail_engineering_diagram_run "{\"p_run_id\":\"$RETRY_RUN\",\"p_error_code\":\"provider_timeout\",\"p_error_detail\":\"The controlled retry proof simulates a transient provider timeout.\"}" >/dev/null
test "$(psqlc "select status||'|'||attempt_count from engineering_diagram_runs where id='$RETRY_RUN';")" = 'failed|1'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='engineering_diagram_run' and event_data->>'action'='provider_failed' and event_data->>'runId'='$RETRY_RUN';")" = '1'
AI_RETRY=$(rpc "$AI_AAL1" retry_engineering_diagram_run "{\"p_run_id\":\"$RETRY_RUN\",\"p_basis\":\"The AI operator must not requeue a provider failure.\"}")
expect_error "$AI_RETRY" 'named same-tenant engineering authority'
FOREIGN_RETRY=$(rpc "$FOREIGN_AAL2" retry_engineering_diagram_run "{\"p_run_id\":\"$RETRY_RUN\",\"p_basis\":\"A foreign tenant must never requeue this provider failure.\"}")
expect_error "$FOREIGN_RETRY" 'outside the active tenant'
SHORT_RETRY=$(rpc "$CONTROLLER_AAL1" retry_engineering_diagram_run "{\"p_run_id\":\"$RETRY_RUN\",\"p_basis\":\"too short\"}")
expect_error "$SHORT_RETRY" '20-8000 characters'
REQUEUED=$(rpc "$CONTROLLER_AAL1" retry_engineering_diagram_run "{\"p_run_id\":\"$RETRY_RUN\",\"p_basis\":\"Human review confirms the timeout was transient and the immutable input remains valid.\"}")
noerr "$REQUEUED"; test "$(field "$REQUEUED" status)" = 'queued'; test "$(field "$REQUEUED" nextAttempt)" = '2'
RETRY_CLAIMED_AGAIN=$(service_rpc claim_engineering_diagram_run "{\"p_run_id\":\"$RETRY_RUN\"}")
noerr "$RETRY_CLAIMED_AGAIN"; test "$(field "$RETRY_CLAIMED_AGAIN" attemptCount)" = '2'
service_rpc fail_engineering_diagram_run "{\"p_run_id\":\"$RETRY_RUN\",\"p_error_code\":\"retry_proof_complete\",\"p_error_detail\":\"The governed retry path completed its second claimed attempt.\"}" >/dev/null
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='engineering_diagram_run' and event_data->>'action'='retry_queued' and event_data->>'runId'='$RETRY_RUN';")" = '1'

# Authenticated callers cannot invoke the service-only inference boundary.
AUTH_CLAIM_CODE=$(curl -sS -o "$DIRECT_BODY" -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/claim_engineering_diagram_run" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $CONTROLLER_AAL1" -H 'Content-Type: application/json' -d "{\"p_run_id\":\"$RUN\"}")
case "$AUTH_CLAIM_CODE" in 401|403|404) ;; *) cat "$DIRECT_BODY"; false ;; esac
CLAIMED=$(service_rpc claim_engineering_diagram_run "{\"p_run_id\":\"$RUN\"}")
noerr "$CLAIMED"; test "$(field "$CLAIMED" status)" = 'extracting'

# Malformed provider geometry fails as one transaction; bounded normalized
# output then records two nodes and two distinct candidate connections.
BAD=$(service_rpc record_engineering_diagram_inference "{\"p_run_id\":\"$RUN\",\"p_raw_result_sha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"p_nodes\":[{\"externalId\":\"n1\",\"pageNumber\":1,\"nodeKind\":\"equipment\",\"symbolClass\":\"equipment/pump\",\"bbox\":{\"topX\":0,\"topY\":0,\"bottomX\":2,\"bottomY\":1},\"confidence\":0.9}],\"p_edges\":[],\"p_manifest\":{}}")
expect_error "$BAD" 'invalid node'
RECORDED=$(service_rpc record_engineering_diagram_inference "{\"p_run_id\":\"$RUN\",\"p_raw_result_sha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"p_nodes\":[{\"externalId\":\"n1\",\"pageNumber\":1,\"nodeKind\":\"equipment\",\"symbolClass\":\"equipment/pump\",\"label\":\"Pump\",\"tag\":\"P-100\",\"bbox\":{\"topX\":0.1,\"topY\":0.1,\"bottomX\":0.3,\"bottomY\":0.3},\"confidence\":0.93,\"providerPayload\":{\"providerNodeId\":\"n1\"}},{\"externalId\":\"n2\",\"pageNumber\":1,\"nodeKind\":\"equipment\",\"symbolClass\":\"equipment/tank\",\"label\":\"Tank\",\"tag\":\"TK-100\",\"bbox\":{\"topX\":0.6,\"topY\":0.1,\"bottomX\":0.9,\"bottomY\":0.5},\"confidence\":0.91,\"providerPayload\":{\"providerNodeId\":\"n2\"}}],\"p_edges\":[{\"externalId\":\"e1\",\"sourceExternalId\":\"n1\",\"targetExternalId\":\"n2\",\"flowDirection\":\"downstream\",\"relationKind\":\"process_connection\",\"confidence\":0.91,\"segments\":[]},{\"externalId\":\"e2\",\"sourceExternalId\":\"n1\",\"targetExternalId\":\"n2\",\"flowDirection\":\"unknown\",\"relationKind\":\"process_connection\",\"confidence\":0.72,\"segments\":[]}],\"p_manifest\":{\"runtimeProof\":true}}")
noerr "$RECORDED"; test "$(field "$RECORDED" nodeCount)" = '2'; test "$(field "$RECORDED" edgeCount)" = '2'; test "$(field "$RECORDED" machineGenerated)" = 'true'; test "$(field "$RECORDED" operationalAuthorization)" = 'false'
NODE_A=$(psqlc "select id from engineering_diagram_nodes where run_id='$RUN' and external_id='n1';")
NODE_B=$(psqlc "select id from engineering_diagram_nodes where run_id='$RUN' and external_id='n2';")
EDGE_A=$(psqlc "select id from engineering_diagram_edges where run_id='$RUN' and external_id='e1';")
EDGE_B=$(psqlc "select id from engineering_diagram_edges where run_id='$RUN' and external_id='e2';")

# Tenant and canonical-asset walls remain enforced before independent review.
FOREIGN_ROWS=$(curl -sS "$API_URL/rest/v1/engineering_diagram_runs?select=id&id=eq.$RUN" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $FOREIGN_AAL2")
test "$FOREIGN_ROWS" = '[]'
FOREIGN_MAP=$(rpc "$CONTROLLER_AAL1" propose_engineering_diagram_asset_mapping "{\"p_node_id\":\"$NODE_A\",\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_basis\":\"A foreign asset must never satisfy a diagram mapping proposal.\"}")
expect_error "$FOREIGN_MAP" 'asset is outside the active tenant'
MAP_A_JSON=$(rpc "$CONTROLLER_AAL1" propose_engineering_diagram_asset_mapping "{\"p_node_id\":\"$NODE_A\",\"p_asset_id\":\"$ASSET_A\",\"p_basis\":\"The P-100 tag and pump symbol match the canonical pump identity.\"}")
MAP_B_JSON=$(rpc "$CONTROLLER_AAL1" propose_engineering_diagram_asset_mapping "{\"p_node_id\":\"$NODE_B\",\"p_asset_id\":\"$ASSET_B\",\"p_basis\":\"The TK-100 tag and tank symbol match the canonical tank identity.\"}")
noerr "$MAP_A_JSON"; noerr "$MAP_B_JSON"; MAP_A=$(field "$MAP_A_JSON" mappingId); MAP_B=$(field "$MAP_B_JSON" mappingId)
SELF_MAP=$(rpc "$CONTROLLER_AAL2" review_engineering_diagram_asset_mapping "{\"p_mapping_id\":\"$MAP_A\",\"p_decision\":\"accepted\",\"p_basis\":\"The proposer attempts to approve their own asset mapping.\"}")
expect_error "$SELF_MAP" 'proposer cannot review'
AAL1_MAP=$(rpc "$REVIEWER_AAL1" review_engineering_diagram_asset_mapping "{\"p_mapping_id\":\"$MAP_A\",\"p_decision\":\"accepted\",\"p_basis\":\"Independent reviewer has not completed the required step-up.\"}")
expect_error "$AAL1_MAP" 'AAL2 session'
FOREIGN_REVIEW=$(rpc "$FOREIGN_AAL2" review_engineering_diagram_asset_mapping "{\"p_mapping_id\":\"$MAP_A\",\"p_decision\":\"accepted\",\"p_basis\":\"Foreign tenant review must remain outside this mapping.\"}")
expect_error "$FOREIGN_REVIEW" 'outside the active tenant'
for mapping in "$MAP_A" "$MAP_B"; do
  ACCEPTED=$(rpc "$REVIEWER_AAL2" review_engineering_diagram_asset_mapping "{\"p_mapping_id\":\"$mapping\",\"p_decision\":\"accepted\",\"p_basis\":\"Independent AAL2 review confirms the drawing tag, symbol and canonical asset identity.\"}")
  noerr "$ACCEPTED"; test "$(field "$ACCEPTED" status)" = 'accepted'; test "$(field "$ACCEPTED" segregationOfDuties)" = 'true'
done

# Only an AAL2 human may publish an explicit orientation, and publication
# creates a candidate—not a graph edge. A mixed valid/invalid batch must roll
# back the valid first insert before returning its error.
ATOMIC_PAYLOAD="{\"p_run_id\":\"$RUN\",\"p_candidates\":[{\"edgeId\":\"$EDGE_A\",\"dependentAssetId\":\"$ASSET_B\",\"supplierAssetId\":\"$ASSET_A\",\"dependencyKind\":\"topological\",\"basis\":\"The first valid relationship must roll back when the following candidate is invalid.\"},{\"edgeId\":\"00000000-0000-4000-8000-000000000099\",\"dependentAssetId\":\"$ASSET_B\",\"supplierAssetId\":\"$ASSET_A\",\"dependencyKind\":\"topological\",\"basis\":\"This deliberately invalid edge proves that batch publication remains atomic.\"}]}"
ATOMIC_REFUSAL=$(rpc "$CONTROLLER_AAL2" publish_engineering_diagram_dependency_candidates "$ATOMIC_PAYLOAD")
expect_error "$ATOMIC_REFUSAL" 'candidate edge is outside the selected run'
test "$(psqlc "select count(*) from dependency_candidates where organization_id='$ORG' and source_kind='engineering_diagram';")" = '0'

PAYLOAD_A="{\"p_run_id\":\"$RUN\",\"p_candidates\":[{\"edgeId\":\"$EDGE_A\",\"dependentAssetId\":\"$ASSET_B\",\"supplierAssetId\":\"$ASSET_A\",\"dependencyKind\":\"topological\",\"basis\":\"Human review confirms that TK-100 depends on the mapped P-100 flow path.\"}]}"
AAL1_PUBLISH=$(rpc "$CONTROLLER_AAL1" publish_engineering_diagram_dependency_candidates "$PAYLOAD_A")
expect_error "$AAL1_PUBLISH" 'AAL2 session'
PUBLISHED_A=$(rpc "$CONTROLLER_AAL2" publish_engineering_diagram_dependency_candidates "$PAYLOAD_A")
noerr "$PUBLISHED_A"; test "$(field "$PUBLISHED_A" published)" = '1'; test "$(field "$PUBLISHED_A" destination)" = 'dependency_candidates'; test "$(field "$PUBLISHED_A" operationalAuthorization)" = 'false'
test "$(psqlc "select count(*) from asset_dependencies where organization_id='$ORG';")" = '0'

DIRECT_GRAPH=$(curl -sS -o "$DIRECT_BODY" -w '%{http_code}' -X POST "$API_URL/rest/v1/asset_dependencies" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $CONTROLLER_AAL2" -H 'Content-Type: application/json' -d "{\"organization_id\":\"$ORG\",\"dependent_asset_id\":\"$ASSET_B\",\"supplier_asset_id\":\"$ASSET_A\",\"dependency_kind\":\"topological\"}")
case "$DIRECT_GRAPH" in 401|403|404) ;; *) cat "$DIRECT_BODY"; false ;; esac
GROUP_A="diagram:$RUN:$EDGE_A"
SELF_GRAPH=$(rpc "$CONTROLLER_AAL2" review_dependency_candidate_group "{\"p_group_key\":\"$GROUP_A\",\"p_decision\":\"confirmed\"}")
expect_error "$SELF_GRAPH" 'proposer cannot review'
GRAPH_RESULT=$(rpc "$GRAPH_AAL2" review_dependency_candidate_group "{\"p_group_key\":\"$GROUP_A\",\"p_decision\":\"confirmed\"}")
test "$(table_field "$GRAPH_RESULT" outcome)" = 'applied'
test "$(psqlc "select count(*) from asset_dependencies where organization_id='$ORG' and dependent_asset_id='$ASSET_B' and supplier_asset_id='$ASSET_A' and dependency_kind='topological' and confirmed_by='$GRAPH_REVIEWER' and evidence like 'Confirmed from candidate #%';")" = '1'

# A second open relationship candidate becomes unreviewable when the exact
# source revision is legitimately superseded after publication.
PAYLOAD_B="{\"p_run_id\":\"$RUN\",\"p_candidates\":[{\"edgeId\":\"$EDGE_B\",\"dependentAssetId\":\"$ASSET_B\",\"supplierAssetId\":\"$ASSET_A\",\"dependencyKind\":\"functional\",\"basis\":\"Human review records a second relationship solely to prove source effectivity at final review.\"}]}"
PUBLISHED_B=$(rpc "$CONTROLLER_AAL2" publish_engineering_diagram_dependency_candidates "$PAYLOAD_B"); noerr "$PUBLISHED_B"; test "$(field "$PUBLISHED_B" published)" = '1'
INGESTED_B=$(ingest 'diagram-pid-b' 'Process-water P and ID revision B'); noerr "$INGESTED_B"
DOCUMENT_B=$(psqlc "select id from kb_intake_documents where organization_id='$ORG' and source_id='diagram-pid-b';")
REGISTERED_B=$(rpc "$CONTROLLER_AAL1" register_controlled_technical_document "{\"p_document_id\":\"$DOCUMENT_B\",\"p_record\":{\"kind\":\"pid\",\"documentNumber\":\"PID-DI-100\",\"revisionLabel\":\"B\",\"applicability\":\"Process-water pump and tank flow path.\",\"basis\":\"Approved field change establishes the replacement source revision.\",\"supersedesDocumentId\":\"$DOCUMENT\"}}")
noerr "$REGISTERED_B"
EFFECTIVE_B=$(rpc "$REVIEWER_AAL2" review_controlled_technical_document "{\"p_document_id\":\"$DOCUMENT_B\",\"p_decision\":\"effective\",\"p_basis\":\"Independent AAL2 review confirms revision B supersedes the extraction source.\"}")
noerr "$EFFECTIVE_B"; test "$(psqlc "select control_status from kb_intake_documents where id='$DOCUMENT';")" = 'superseded'
GROUP_B="diagram:$RUN:$EDGE_B"
STALE_REVIEW=$(rpc "$GRAPH_AAL2" review_dependency_candidate_group "{\"p_group_key\":\"$GROUP_B\",\"p_decision\":\"confirmed\"}")
expect_error "$STALE_REVIEW" 'source revision is no longer effective'
test "$(psqlc "select status from dependency_candidates where organization_id='$ORG' and group_key='$GROUP_B';")" = 'open'
test "$(psqlc "select count(*) from asset_dependencies where organization_id='$ORG';")" = '1'

# Authenticated direct writes remain closed across every machine-evidence table.
for table in engineering_diagram_runs engineering_diagram_nodes engineering_diagram_edges engineering_diagram_asset_mappings; do
  code=$(curl -sS -o "$DIRECT_BODY" -w '%{http_code}' -X POST "$API_URL/rest/v1/$table" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $CONTROLLER_AAL1" -H 'Content-Type: application/json' -d '{}')
  case "$code" in 401|403|404) ;; *) cat "$DIRECT_BODY"; false ;; esac
done
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in('engineering_diagram_run','engineering_diagram_asset_mapping','engineering_diagram_publication');")" -ge '6'

echo 'Engineering Diagram Intelligence smoke passed: canonical_document=true private_source_object=true tenant_wall=true service_only_inference=true governed_retry=true bounded_geometry=true independent_mapping_review=true atomic_candidate_publication=true effective_revision_rechecked=true candidate_only_publication=true independent_graph_review=true direct_graph_write=false operational_authority=false'

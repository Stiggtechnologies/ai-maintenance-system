#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Edge Evidence Contract smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-4999-8999-999999999926'
ASSET='91310000-0000-4000-8000-000000000001'
OTHER_ASSET='91310000-0000-4000-8000-000000000002'
FOREIGN_ASSET='91310000-0000-4000-8000-000000000003'
SENSOR='91310000-0000-4000-8000-000000000011'
OTHER_SENSOR='91310000-0000-4000-8000-000000000012'
FOREIGN_USER='91310000-0000-4000-8000-000000000099'
KEY_ONE='edge-key-2026-01'
KEY_TWO='edge-key-2026-02'
DIGEST='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

KEY_MATERIAL_ONE=$(node scripts/edge-evidence-crypto.mjs generate)
KEY_MATERIAL_TWO=$(node scripts/edge-evidence-crypto.mjs generate)
JWK_ONE=$(KEY_MATERIAL="$KEY_MATERIAL_ONE" node -e \
  'const k=JSON.parse(process.env.KEY_MATERIAL);process.stdout.write(JSON.stringify(k.publicJwk))')
PRIVATE_JWK_ONE=$(KEY_MATERIAL="$KEY_MATERIAL_ONE" node -e \
  'const k=JSON.parse(process.env.KEY_MATERIAL);process.stdout.write(JSON.stringify(k.privateJwk))')
JWK_TWO=$(KEY_MATERIAL="$KEY_MATERIAL_TWO" node -e \
  'const k=JSON.parse(process.env.KEY_MATERIAL);process.stdout.write(JSON.stringify(k.publicJwk))')

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" |
    python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}
rpc() {
  curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" \
    -H 'content-type: application/json' -d "$3"
}
service_rpc() {
  curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$1" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'content-type: application/json' -d "$2"
}
body() { printf '%s' "${1%$'\n'*}"; }
status() { printf '%s' "${1##*$'\n'}"; }
ok() {
  test "$(status "$1")" = 200
  BODY="$(body "$1")" python3 -c \
    "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"
}
created() {
  test "$(status "$1")" = 201
  BODY="$(body "$1")" python3 -c \
    "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"
}
err() {
  test "$(status "$1")" = 200
  BODY="$(body "$1")" NEEDLE="$2" python3 -c \
    "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"
}
psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -qAt -F ' ' -v ON_ERROR_STOP=1 -c "$1"
}
ingest_payload() {
  NODE="$NODE" KEY_ID="$1" SEQUENCE="$2" OBSERVATION_ID="$3" \
    ASSET_ID="$4" SENSOR_ID="$5" MODEL_ID="$6" DIGEST="$DIGEST" \
    python3 -c 'import json,os
sensor=os.environ["SENSOR_ID"] or None
print(json.dumps({
  "p_edge_node_id":os.environ["NODE"],"p_key_id":os.environ["KEY_ID"],
  "p_sequence":int(os.environ["SEQUENCE"]),"p_observation_id":os.environ["OBSERVATION_ID"],
  "p_captured_at":"2026-09-29T08:00:00Z","p_asset_id":os.environ["ASSET_ID"],
  "p_sensor_id":sensor,"p_model_register_id":int(os.environ["MODEL_ID"]),
  "p_confidence":0.91,"p_payload_sha256":os.environ["DIGEST"],
  "p_observation":{"summary":"Edge vibration model detected a repeatable bearing anomaly.","dataQuality":"good","score":0.91}
}))'
}

ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
REVIEWER=$(token 'executive@syncai.ca' 'Exec123!@#')
test -n "$ADMIN" && test -n "$REVIEWER"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -q -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry)
values('$OTHER_ORG','Edge Contract Foreign Tenant','utilities') on conflict(id) do nothing;
insert into assets(id,organization_id,name,tag,asset_class) values
  ('$ASSET','$ORG','Edge Contract Pump','EDGE-P-101','pump'),
  ('$OTHER_ASSET','$ORG','Edge Contract Compressor','EDGE-C-201','compressor'),
  ('$FOREIGN_ASSET','$OTHER_ORG','Foreign Edge Asset','FOREIGN-EDGE-01','pump')
on conflict(id) do nothing;
insert into sensors(id,organization_id,asset_id,name,signal_type,unit) values
  ('$SENSOR','$ORG','$ASSET','Edge accelerometer','vibration','mm/s'),
  ('$OTHER_SENSOR','$ORG','$OTHER_ASSET','Other accelerometer','vibration','mm/s')
on conflict(id) do nothing;

do \$seed\$
begin
  if not exists (select 1 from auth.users where id='$FOREIGN_USER') then
    insert into auth.users(
      instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
      confirmation_token,recovery_token,email_change,email_change_token_new,
      email_change_token_current,phone_change,phone_change_token,reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000','$FOREIGN_USER',
      'authenticated','authenticated','edge-contract-foreign@syncai.ca',
      extensions.crypt('Foreign123!@#',extensions.gen_salt('bf')),
      now(),now(),now(),'{"provider":"email","providers":["email"]}',
      '{"full_name":"Edge Contract Foreign Admin"}','', '', '', '', '', '', '', ''
    );
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values('$FOREIGN_USER','$OTHER_ORG','edge-contract-foreign@syncai.ca',
    'Edge Contract Foreign Admin','admin')
  on conflict(id) do update set organization_id=excluded.organization_id,role='admin';
end
\$seed\$;
SQL

FOREIGN=$(token 'edge-contract-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGN"
read -r OLD_MODEL CURRENT_MODEL <<<"$(psqlc "select
  (select id from model_register where organization_id='$ORG' and model_key='ci.decision.model' and version='1.0.0'),
  (select id from model_register where organization_id='$ORG' and model_key='ci.decision.model' and version='2.0.0')")"
test -n "$OLD_MODEL" && test -n "$CURRENT_MODEL"

ENROLL_PAYLOAD=$(JWK="$JWK_ONE" python3 -c 'import json,os;print(json.dumps({
  "p_node_name":"Edge Contract Node 01","p_hardware_family":"hardware-neutral",
  "p_runtime_name":"syncai-edge-adapter","p_runtime_version":"1.0.0",
  "p_firmware_version":"ci-fixture","p_key_id":"edge-key-2026-01",
  "p_public_key_jwk":json.loads(os.environ["JWK"]),"p_site_id":None,
  "p_basis":"Controlled CI enrollment fixture bound to the canonical tenant and evidence contract."
}))')
ENROLL=$(rpc "$ADMIN" request_edge_node_enrollment "$ENROLL_PAYLOAD")
ok "$ENROLL"
NODE=$(BODY="$(body "$ENROLL")" python3 -c \
  'import json,os;x=json.loads(os.environ["BODY"]);assert x["status"]=="pending_review" and x["operationalAuthorization"] is False;print(x["edgeNodeId"])')

SELF_REVIEW=$(rpc "$ADMIN" review_edge_node_enrollment \
  "{\"p_edge_node_id\":\"$NODE\",\"p_decision\":\"approved\",\"p_basis\":\"Requester must never approve the same device enrollment request independently.\"}")
err "$SELF_REVIEW" 'requester cannot independently review'
FOREIGN_REVIEW=$(rpc "$FOREIGN" review_edge_node_enrollment \
  "{\"p_edge_node_id\":\"$NODE\",\"p_decision\":\"approved\",\"p_basis\":\"A foreign tenant must never discover or approve this device enrollment record.\"}")
err "$FOREIGN_REVIEW" 'not found in this organization'
APPROVE=$(rpc "$REVIEWER" review_edge_node_enrollment \
  "{\"p_edge_node_id\":\"$NODE\",\"p_decision\":\"approved\",\"p_basis\":\"Independent review confirmed tenant, device identity, purpose, and public key fingerprint.\"}")
ok "$APPROVE"

CLONED_KEY_PAYLOAD=$(JWK="$JWK_ONE" python3 -c 'import json,os;print(json.dumps({
  "p_node_name":"Edge Contract Cloned Credential","p_hardware_family":"hardware-neutral",
  "p_runtime_name":"syncai-edge-adapter","p_runtime_version":"1.0.0",
  "p_firmware_version":"ci-fixture","p_key_id":"edge-key-clone-2026-01",
  "p_public_key_jwk":json.loads(os.environ["JWK"]),"p_site_id":None,
  "p_basis":"This deliberately attempts to clone public key material across two tenant devices."
}))')
CLONED_KEY=$(rpc "$ADMIN" request_edge_node_enrollment "$CLONED_KEY_PAYLOAD")
err "$CLONED_KEY" 'cannot be reused within an organization'

# Neither direct credential enrollment nor forged edge provenance may bypass the governed paths.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -qAt -v ON_ERROR_STOP=1 <<SQL
do \$test\$
begin
  begin
    insert into edge_nodes(organization_id,node_name,hardware_family,runtime_name,current_key_id,current_public_key_jwk,enrollment_basis,registered_by)
    select '$ORG','Forged Node','forged','forged','forged-key-01','$JWK_ONE'::jsonb,
      'This direct insert must be rejected by the governed device identity wall.',id
    from user_profiles where organization_id='$ORG' and email='admin@syncai.ca';
    raise exception 'direct edge-node enrollment was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%only through governed edge-node functions%' then raise; end if;
  end;
  begin
    insert into evidence_items(
      organization_id,asset_id,source_system,evidence_type,description,evidence_class,
      edge_node_id,edge_model_register_id,edge_observation_id,edge_sequence,
      edge_payload_sha256,edge_signature_key_id,edge_signature_verified_at,edge_observation
    ) values (
      '$ORG','$ASSET','forged','edge_inference','Forged edge evidence must be rejected.',
      'AI_INFERENCE','$NODE',$CURRENT_MODEL,'forged-observation-01',1,'$DIGEST',
      '$KEY_ONE',now(),'{"summary":"forged"}'::jsonb
    );
    raise exception 'direct edge-evidence insertion was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%only be inserted after device-signature verification%' then raise; end if;
  end;
  begin
    insert into evidence_items(
      organization_id,asset_id,source_system,evidence_type,description,evidence_class,
      edge_model_register_id,edge_observation_id,edge_sequence,
      edge_payload_sha256,edge_signature_key_id,edge_signature_verified_at,edge_observation
    ) values (
      '$ORG','$ASSET','forged','edge_inference','Node-free forged edge provenance must be rejected.',
      'AI_INFERENCE',$CURRENT_MODEL,'forged-node-free-01',1,'$DIGEST',
      '$KEY_ONE',now(),'{"summary":"forged without a signed node identity"}'::jsonb
    );
    raise exception 'node-free edge provenance was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%evidence_edge_contract_complete%' then raise; end if;
  end;
end
\$test\$;
SQL

FINGERPRINTS=$(psqlc "select
  edge_public_key_fingerprint('$JWK_ONE'::jsonb)=
  edge_public_key_fingerprint((('$JWK_ONE'::jsonb)-'alg'-'key_ops'-'ext')||'{\"use\":\"sig\"}'::jsonb)")
test "$FINGERPRINTS" = 't'

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/ingest_verified_edge_evidence" \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')
test "$NOAUTH" = 401 || test "$NOAUTH" = 403

STALE=$(service_rpc ingest_verified_edge_evidence \
  "$(ingest_payload "$KEY_ONE" 1 edge-observation-stale "$ASSET" "$SENSOR" "$OLD_MODEL")")
err "$STALE" 'not independently approved and current'
FOREIGN_ASSET_RESULT=$(service_rpc ingest_verified_edge_evidence \
  "$(ingest_payload "$KEY_ONE" 1 edge-observation-foreign "$FOREIGN_ASSET" '' "$CURRENT_MODEL")")
err "$FOREIGN_ASSET_RESULT" 'asset is not bound to this edge node tenant'
WRONG_SENSOR=$(service_rpc ingest_verified_edge_evidence \
  "$(ingest_payload "$KEY_ONE" 1 edge-observation-sensor "$ASSET" "$OTHER_SENSOR" "$CURRENT_MODEL")")
err "$WRONG_SENSOR" 'sensor is not bound to the same tenant and asset'

BEFORE=$(psqlc "select count(*)||'|'||(select count(*) from work_orders)||'|'||(select count(*) from decisions) from recommendations")
SIGNED_AT=$(python3 -c 'from datetime import datetime,timezone;print(datetime.now(timezone.utc).isoformat().replace("+00:00","Z"))')
EDGE_BODY=$(NODE="$NODE" KEY_ID="$KEY_ONE" SIGNED_AT="$SIGNED_AT" ASSET="$ASSET" \
  SENSOR="$SENSOR" MODEL="$CURRENT_MODEL" python3 -c 'import json,os;print(json.dumps({
    "nodeId":os.environ["NODE"],"keyId":os.environ["KEY_ID"],"sequence":1,
    "signedAt":os.environ["SIGNED_AT"],"observationId":"edge-observation-0001",
    "capturedAt":os.environ["SIGNED_AT"],"assetId":os.environ["ASSET"],
    "sensorId":os.environ["SENSOR"],"modelRegisterId":int(os.environ["MODEL"]),
    "confidence":0.91,"observation":{"summary":"Edge vibration model detected a repeatable bearing anomaly.","dataQuality":"good","score":0.91}
  },separators=(",",":")))')
EDGE_SIGNATURE=$(EDGE_BODY="$EDGE_BODY" EDGE_PRIVATE_JWK="$PRIVATE_JWK_ONE" \
  node scripts/edge-evidence-crypto.mjs sign)
TAMPERED_BODY=$(EDGE_BODY="$EDGE_BODY" python3 -c \
  'import json,os;x=json.loads(os.environ["EDGE_BODY"]);x["confidence"]=0.12;print(json.dumps(x,separators=(",",":")))')
TAMPERED=$(curl -sS -w '\n%{http_code}' -X POST \
  "$API_URL/functions/v1/edge-evidence-ingest" \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
  -H "x-syncai-edge-signature: $EDGE_SIGNATURE" --data-binary "$TAMPERED_BODY")
test "$(status "$TAMPERED")" = 401
FIRST=$(curl -sS -w '\n%{http_code}' -X POST \
  "$API_URL/functions/v1/edge-evidence-ingest" \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
  -H "x-syncai-edge-signature: $EDGE_SIGNATURE" --data-binary "$EDGE_BODY")
created "$FIRST"
EVIDENCE_ONE=$(BODY="$(body "$FIRST")" python3 -c \
  'import json,os;x=json.loads(os.environ["BODY"]);assert x["verificationStatus"]=="unverified" and x["evidenceClass"]=="AI_INFERENCE" and x["operationalAuthorization"] is False;print(x["evidenceItemId"])')
AFTER=$(psqlc "select count(*)||'|'||(select count(*) from work_orders)||'|'||(select count(*) from decisions) from recommendations")
test "$BEFORE" = "$AFTER"

REPLAY=$(service_rpc ingest_verified_edge_evidence \
  "$(ingest_payload "$KEY_ONE" 1 edge-observation-0002 "$ASSET" "$SENSOR" "$CURRENT_MODEL")")
err "$REPLAY" 'replayed or out-of-order edge sequence'
DUPLICATE=$(service_rpc ingest_verified_edge_evidence \
  "$(ingest_payload "$KEY_ONE" 2 edge-observation-0001 "$ASSET" "$SENSOR" "$CURRENT_MODEL")")
err "$DUPLICATE" 'already recorded'

FOREIGN_NODE_READ=$(curl -sS "$API_URL/rest/v1/edge_nodes?select=id&id=eq.$NODE" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $FOREIGN")
FOREIGN_EVIDENCE_READ=$(curl -sS "$API_URL/rest/v1/evidence_items?select=id&id=eq.$EVIDENCE_ONE" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $FOREIGN")
test "$FOREIGN_NODE_READ" = '[]' && test "$FOREIGN_EVIDENCE_READ" = '[]'

# Canonical human verification is the only allowed mutation of signed evidence.
VERIFIED=$(rpc "$REVIEWER" verify_evidence_item \
  "{\"p_evidence_id\":\"$EVIDENCE_ONE\",\"p_method\":\"Independent review of the signed payload, sensor binding, and approved model version\",\"p_outcome\":\"verified\",\"p_note\":\"The human accepted this observation as evidence, not as operational authorization.\"}")
ok "$VERIFIED"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -qAt -v ON_ERROR_STOP=1 <<SQL
do \$test\$
begin
  begin
    update evidence_items set description='Mutated signed meaning' where id='$EVIDENCE_ONE';
    raise exception 'signed edge evidence mutation was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%signed edge evidence is immutable%' then raise; end if;
  end;
end
\$test\$;
SQL

ROTATION_PAYLOAD=$(NODE="$NODE" JWK="$JWK_TWO" python3 -c 'import json,os;print(json.dumps({
  "p_edge_node_id":os.environ["NODE"],"p_new_key_id":"edge-key-2026-02",
  "p_new_public_key_jwk":json.loads(os.environ["JWK"]),
  "p_basis":"Scheduled key rotation after controlled custody transfer and fingerprint comparison."
}))')
ROTATE=$(rpc "$ADMIN" request_edge_node_key_rotation "$ROTATION_PAYLOAD")
ok "$ROTATE"
SELF_ROTATION=$(rpc "$ADMIN" review_edge_node_key_rotation \
  "{\"p_edge_node_id\":\"$NODE\",\"p_decision\":\"approved\",\"p_basis\":\"The key rotation requester must not independently approve the same credential change.\"}")
err "$SELF_ROTATION" 'requester cannot independently review'
APPROVE_ROTATION=$(rpc "$REVIEWER" review_edge_node_key_rotation \
  "{\"p_edge_node_id\":\"$NODE\",\"p_decision\":\"approved\",\"p_basis\":\"Independent custody review matched the new public key fingerprint and node identity.\"}")
ok "$APPROVE_ROTATION"

OLD_KEY=$(service_rpc ingest_verified_edge_evidence \
  "$(ingest_payload "$KEY_ONE" 2 edge-observation-old-key "$ASSET" "$SENSOR" "$CURRENT_MODEL")")
err "$OLD_KEY" 'edge key unavailable'
SECOND=$(service_rpc ingest_verified_edge_evidence \
  "$(ingest_payload "$KEY_TWO" 1 edge-observation-0003 "$ASSET" "$SENSOR" "$CURRENT_MODEL")")
ok "$SECOND"
EVIDENCE_TWO=$(BODY="$(body "$SECOND")" python3 -c \
  'import json,os;x=json.loads(os.environ["BODY"]);assert x["verificationStatus"]=="unverified";print(x["evidenceItemId"])')

REUSE_KEY_ID=$(JWK="$JWK_ONE" NODE="$NODE" python3 -c 'import json,os;print(json.dumps({
  "p_edge_node_id":os.environ["NODE"],"p_new_key_id":"edge-key-2026-01",
  "p_new_public_key_jwk":json.loads(os.environ["JWK"]),
  "p_basis":"This deliberately attempts to reuse a retired device credential and must be refused."
}))')
REUSE=$(rpc "$ADMIN" request_edge_node_key_rotation "$REUSE_KEY_ID")
err "$REUSE" 'cannot be reused'

SUSPEND=$(rpc "$REVIEWER" restrict_edge_node \
  "{\"p_edge_node_id\":\"$NODE\",\"p_state\":\"suspended\",\"p_basis\":\"Controlled CI suspension proves evidence intake stops without granting a reactivation backdoor.\"}")
ok "$SUSPEND"
SUSPENDED_INGEST=$(service_rpc ingest_verified_edge_evidence \
  "$(ingest_payload "$KEY_TWO" 2 edge-observation-suspended "$ASSET" "$SENSOR" "$CURRENT_MODEL")")
err "$SUSPENDED_INGEST" 'edge node unavailable'

COUNTS=$(psqlc "select
  (select count(*) from edge_nodes where id='$NODE' and organization_id='$ORG' and status='suspended' and current_key_id='$KEY_TWO' and last_sequence=1),
  (select count(*) from evidence_items where id='$EVIDENCE_ONE' and organization_id='$ORG' and edge_node_id='$NODE' and edge_signature_key_id='$KEY_ONE' and edge_sequence=1 and evidence_class='AI_INFERENCE' and verification_status='verified' and verified_by is not null and provenance->>'operationalAuthorization'='false'),
  (select count(*) from evidence_items where id='$EVIDENCE_TWO' and organization_id='$ORG' and edge_node_id='$NODE' and edge_signature_key_id='$KEY_TWO' and edge_sequence=1 and evidence_class='AI_INFERENCE' and verification_status='unverified' and provenance->>'operationalAuthorization'='false'),
  (select count(*) from approvals where organization_id='$ORG' and approval_scope->>'edgeNodeId'='$NODE' and status='approved' and approval_scope->>'operationalAuthorization'='false'),
  (select count(*) from audit_events where organization_id='$ORG' and event_data->>'edgeNodeId'='$NODE' and entity_type in ('edge_node_enrollment_requested','edge_node_enrollment_reviewed','edge_evidence_ingested','edge_node_key_rotation_requested','edge_node_key_rotation_reviewed','edge_node_restricted'))")
echo "Edge Evidence Contract ledger counts node|verified_old_key|unverified_new_key|approvals|audit=$COUNTS"
test "$COUNTS" = '1|1|1|2|7'

echo 'Edge Evidence Contract smoke passed: tenant_isolation=true independent_enrollment=true ed25519_identity=true replay_wall=true exact_approved_model=true canonical_evidence=true human_verification=true immutable_provenance=true rotation_dual_control=true no_operational_authority=true'

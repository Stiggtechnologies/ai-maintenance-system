#!/usr/bin/env bash
set -euo pipefail
trap 'echo "E12.14 data residency smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
DEPLOYMENT=$(python3 -c 'import uuid; print(uuid.uuid4())')
FOREIGN_DEPLOYMENT=$(python3 -c 'import uuid; print(uuid.uuid4())')
OTHER_ORG=$(python3 -c 'import uuid; print(uuid.uuid4())')

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

EXEC=$(token 'executive@syncai.ca' 'Exec123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
DEMO=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$EXEC" && test -n "$ADMIN" && test -n "$DEMO"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','Foreign residency tenant','utilities') on conflict(id) do nothing;
insert into deployment_instances(id,organization_id,name,status,created_by) values
('$DEPLOYMENT','11111111-1111-1111-1111-111111111111','Residency smoke deployment','active','00000000-0000-0000-0000-000000000002'),
('$FOREIGN_DEPLOYMENT','$OTHER_ORG','Foreign residency deployment','active','00000000-0000-0000-0000-000000000002') on conflict(id) do nothing;
SQL

UNAUTHORIZED=$(rpc "$DEMO" configure_deployment_residency "{\"p_deployment_id\":\"$DEPLOYMENT\",\"p_policy\":{}}")
err "$UNAUTHORIZED" 'named human administrator'
FOREIGN=$(rpc "$EXEC" configure_deployment_residency "{\"p_deployment_id\":\"$FOREIGN_DEPLOYMENT\",\"p_policy\":{}}")
err "$FOREIGN" 'not found in this tenant'
MULTI_COUNTRY=$(rpc "$EXEC" configure_deployment_residency "{\"p_deployment_id\":\"$DEPLOYMENT\",\"p_policy\":{\"jurisdictions\":[\"Canada\",\"United States\"],\"permitted_countries\":[\"CA\",\"US\"],\"permitted_regions\":[\"canadacentral\",\"eastus\"],\"data_classes\":[\"operational\"],\"authority_reference\":\"MSA-DPA-014\",\"evidence_basis\":\"Executed data processing agreement and provider regional service evidence were reviewed.\"}}")
err "$MULTI_COUNTRY" 'cross-border transfer basis'

POLICY=$(rpc "$EXEC" configure_deployment_residency "{\"p_deployment_id\":\"$DEPLOYMENT\",\"p_policy\":{\"jurisdictions\":[\"Canada\"],\"permitted_countries\":[\"CA\"],\"permitted_regions\":[\"canadacentral\"],\"data_classes\":[\"operational\",\"identity\"],\"authority_reference\":\"MSA-DPA-014\",\"evidence_basis\":\"Executed data processing agreement and provider regional service evidence were reviewed.\"}}")
ok "$POLICY"

DIRECT=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/deployment_data_locations" -H "apikey: $ANON_KEY" -H "authorization: Bearer $EXEC" -H 'content-type: application/json' -d "{\"organization_id\":\"11111111-1111-1111-1111-111111111111\",\"deployment_id\":\"$DEPLOYMENT\"}")
test "$(status "$DIRECT")" = 403

BAD_COUNTRY=$(rpc "$EXEC" record_deployment_data_location "{\"p_deployment_id\":\"$DEPLOYMENT\",\"p_location\":{\"location_key\":\"bad\",\"data_plane\":\"application\",\"provider\":\"Azure\",\"service\":\"App Service\",\"region_code\":\"eastus\",\"country_code\":\"US\",\"processing_activities\":[\"process\"],\"data_classes\":[\"operational\"],\"evidence_reference\":\"portal-1\",\"evidence_basis\":\"Provider portal evidence for the deployed regional application resource.\"}}")
err "$BAD_COUNTRY" 'country is not permitted'

INCOMPLETE=$(rpc "$ADMIN" verify_deployment_residency "{\"p_deployment_id\":\"$DEPLOYMENT\",\"p_basis\":\"Independent review of the current evidence register and contract boundary.\"}")
err "$INCOMPLETE" 'required verified data planes are incomplete'

for PLANE in application database object_storage backup logging ai_inference; do
  LOCATION=$(rpc "$EXEC" record_deployment_data_location "{\"p_deployment_id\":\"$DEPLOYMENT\",\"p_location\":{\"location_key\":\"$PLANE-ca\",\"data_plane\":\"$PLANE\",\"provider\":\"Azure\",\"service\":\"$PLANE service\",\"region_code\":\"canadacentral\",\"country_code\":\"CA\",\"processing_activities\":[\"store\",\"process\"],\"data_classes\":[\"operational\"],\"evidence_reference\":\"portal-$PLANE\",\"evidence_basis\":\"Dated provider control-plane evidence identifies the service and Canadian region.\"}}")
  ok "$LOCATION"
  if [ "$PLANE" = application ]; then
    LOCATION=$(rpc "$EXEC" record_deployment_data_location "{\"p_deployment_id\":\"$DEPLOYMENT\",\"p_location\":{\"location_key\":\"$PLANE-ca\",\"data_plane\":\"$PLANE\",\"provider\":\"Azure\",\"service\":\"$PLANE service\",\"region_code\":\"canadacentral\",\"country_code\":\"CA\",\"processing_activities\":[\"store\",\"process\"],\"data_classes\":[\"operational\"],\"evidence_reference\":\"portal-$PLANE-revised\",\"evidence_basis\":\"Revised dated provider evidence supersedes the prior declaration without overwriting it.\"}}")
    ok "$LOCATION"
  fi
  LOCATION_ID=$(BODY="$(body "$LOCATION")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['location_id'])")
  SELF=$(rpc "$EXEC" verify_deployment_data_location "{\"p_location_id\":\"$LOCATION_ID\",\"p_decision\":\"verified\",\"p_basis\":\"Independent comparison to provider evidence and the approved policy boundary.\"}")
  err "$SELF" 'verifier other than the declarer'
  REVIEW=$(rpc "$ADMIN" verify_deployment_data_location "{\"p_location_id\":\"$LOCATION_ID\",\"p_decision\":\"verified\",\"p_basis\":\"Independent comparison to provider evidence and the approved policy boundary.\"}")
  ok "$REVIEW"
done

VERIFIED=$(rpc "$ADMIN" verify_deployment_residency "{\"p_deployment_id\":\"$DEPLOYMENT\",\"p_basis\":\"Independent review confirmed all six required data planes against approved evidence.\"}")
ok "$VERIFIED"
PRODUCTION=$(rpc "$ADMIN" set_deployment_environment "{\"p_deployment_id\":\"$DEPLOYMENT\",\"p_environment\":\"production\",\"p_basis\":\"Production promotion is supported by the independently verified current topology.\"}")
ok "$PRODUCTION"

REVISION=$(rpc "$EXEC" configure_deployment_residency "{\"p_deployment_id\":\"$DEPLOYMENT\",\"p_policy\":{\"jurisdictions\":[\"Canada\"],\"permitted_countries\":[\"CA\"],\"permitted_regions\":[\"canadacentral\"],\"data_classes\":[\"operational\",\"identity\"],\"authority_reference\":\"MSA-DPA-014-R2\",\"evidence_basis\":\"Revised executed agreement and current provider regional service evidence were reviewed.\"}}")
ok "$REVISION"
BLOCKED=$(rpc "$ADMIN" set_deployment_environment "{\"p_deployment_id\":\"$DEPLOYMENT\",\"p_environment\":\"pilot\",\"p_basis\":\"Attempted transition after the policy revision invalidated prior evidence review.\"}")
err "$BLOCKED" 'verified residency posture is required'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx '2|draft|production|17|1'
select residency_policy_revision,residency_status,deployment_environment,
  (select count(*) from audit_events where organization_id='11111111-1111-1111-1111-111111111111' and entity_type like 'deployment_%' and event_data->>'deployment_id'='$DEPLOYMENT' and event_time>=deployment_instances.created_at),
  (select count(*) from deployment_data_locations where deployment_id='$DEPLOYMENT' and policy_revision=1 and location_key='application-ca' and status='superseded')
from deployment_instances where id='$DEPLOYMENT';
SQL

echo 'E12.14 data residency smoke passed: tenant_wall=true named_human=true direct_write_closed=true country_gate=true six_planes=true independent_review=true supersession=true revision_invalidation=true production_gate=true honest_boundary=true'

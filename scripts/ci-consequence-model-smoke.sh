#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U9 consequence model smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999918'
RISK='98900000-0000-0000-0000-000000000001'
FOREIGN='98900000-0000-0000-0000-000000000002'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200 || { echo "expected HTTP 200, got $(status "$1")"; return 1; }; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200 || { echo "expected controlled HTTP 200 refusal, got $(status "$1")"; return 1; }; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$AUTHOR" && test -n "$ADMIN"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','U9 foreign','utilities') on conflict(id) do nothing;
insert into risks(id,organization_id,title,kind,created_by)
values('$RISK','$ORG','Loss of regional pumping service','threat','00000000-0000-0000-0000-000000000001'),
('$FOREIGN','$OTHER_ORG','Foreign risk','threat',null) on conflict(id) do nothing;
SQL

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_risk_consequence_model" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"p_risk_id\":\"$RISK\"}")
test "$NOAUTH" = 401

FOREIGN_RESULT=$(rpc "$AUTHOR" get_risk_consequence_model "{\"p_risk_id\":\"$FOREIGN\"}")
err "$FOREIGN_RESULT" 'risk not found in this organization'

NO_UNIT=$(rpc "$AUTHOR" record_risk_analysis_element "{\"p_risk_id\":\"$RISK\",\"p_kind\":\"consequence\",\"p_element\":{\"dimension\":\"customer_interruption\",\"description\":\"Regional customers may lose service\",\"effect_type\":\"direct\",\"assessment_state\":\"estimated\",\"magnitude\":120,\"evidence_basis\":\"Service-area records support the stated customer consequence.\"}}")
err "$NO_UNIT" 'magnitude and magnitude unit'

UNKNOWN_MAG=$(rpc "$AUTHOR" record_risk_analysis_element "{\"p_risk_id\":\"$RISK\",\"p_kind\":\"consequence\",\"p_element\":{\"dimension\":\"public_health\",\"description\":\"Public-health consequence remains unknown\",\"effect_type\":\"cascading\",\"assessment_state\":\"unknown\",\"magnitude\":1,\"magnitude_unit\":\"population\",\"evidence_basis\":\"No health authority assessment has yet been provided for this scenario.\"}}")
err "$UNKNOWN_MAG" 'unknown consequence cannot carry a magnitude'

DIMENSIONS=(fatality injury environmental_damage customer_interruption vulnerable_populations public_health transportation_disruption community_trust infrastructure_impact reputation political_regulatory)
FIRST=''
for DIMENSION in "${DIMENSIONS[@]}"; do
  RESULT=$(rpc "$AUTHOR" record_risk_analysis_element "{\"p_risk_id\":\"$RISK\",\"p_kind\":\"consequence\",\"p_element\":{\"dimension\":\"$DIMENSION\",\"description\":\"Controlled assessment for $DIMENSION consequence\",\"effect_type\":\"direct\",\"assessment_state\":\"unknown\",\"evidence_basis\":\"The consequence workshop recorded this dimension as unknown pending source evidence.\"}}")
  ok "$RESULT"
  test -n "$FIRST" || FIRST=$(BODY="$(body "$RESULT")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['element_id'])")
done

SELF=$(rpc "$AUTHOR" verify_risk_consequence "{\"p_consequence_id\":\"$FIRST\",\"p_decision\":\"verified\",\"p_note\":\"The author must not verify their own assessment record.\"}")
err "$SELF" 'author cannot verify their own'
REVIEW=$(rpc "$ADMIN" verify_risk_consequence "{\"p_consequence_id\":\"$FIRST\",\"p_decision\":\"verified\",\"p_note\":\"Independent review confirms the unknown state and documented evidence gap.\"}")
ok "$REVIEW"

MODEL=$(rpc "$AUTHOR" get_risk_consequence_model "{\"p_risk_id\":\"$RISK\"}")
ok "$MODEL"
BODY="$(body "$MODEL")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['coverage_complete'] is True,x;assert len(x['consequences'])==11,x;assert x['missing_dimensions']==[],x;assert 'No aggregate consequence score' in x['basis'],x"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx '11|1|12'
select count(*),count(*) filter(where status='verified'),
 (select count(*) from audit_events where organization_id='$ORG' and entity_type in ('risk_analysis_element','risk_consequence_review'))
from risk_consequences where organization_id='$ORG' and risk_id='$RISK' and status in ('draft','verified');
SQL

echo 'U9 consequence model smoke passed: tenant_wall=true dimensions=11 epistemic_state=true unit_pair=true independent_review=true no_aggregate=true no_acceptance=true'

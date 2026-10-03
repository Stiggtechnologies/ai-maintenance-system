#!/usr/bin/env bash
set -euo pipefail
trap 'echo "E12.01/E12.02 asset-master smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ASSET=$(python3 -c 'import uuid; print(uuid.uuid4())')
MISMATCH_ASSET=$(python3 -c 'import uuid; print(uuid.uuid4())')
FOREIGN_ORG=$(python3 -c 'import uuid; print(uuid.uuid4())')
FOREIGN_TEMPLATE=$(python3 -c 'import uuid; print(uuid.uuid4())')
SUFFIX=$(python3 -c 'import uuid; print(uuid.uuid4().hex[:8].upper())')
TEMPLATE_KEY="SYNC-SMOKE-$SUFFIX"
FOREIGN_KEY="FOREIGN-SMOKE-$SUFFIX"
PREFIX=$(python3 -c 'import random; print(random.randint(9100,9799))')
LOCAL_CLASS="Governed Pump $SUFFIX"

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
REVIEWER=$(token 'manager@syncai.ca' 'Manager123!@#')
EXECUTIVE=$(token 'executive@syncai.ca' 'Exec123!@#')
TECH=$(token 'technician@syncai.ca' 'Tech123!@#')
test -n "$AUTHOR" && test -n "$REVIEWER" && test -n "$EXECUTIVE" && test -n "$TECH"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$FOREIGN_ORG','Foreign asset-master tenant','utilities');
insert into asset_twin_templates(id,template_key,version,asset_family,asset_class,title,maturity,template,evidence,owner_organization_id,sharing_scope)
values('$FOREIGN_TEMPLATE','$FOREIGN_KEY','1.0','foreign','Foreign pump','Foreign private template','engineer_reviewed','{"components":[{"name":"private component"}]}','[]','$FOREIGN_ORG','tenant_private');
insert into assets(id,organization_id,name,asset_class,criticality,status) values
('$ASSET','11111111-1111-1111-1111-111111111111','$PREFIX' || '01 Governed Pump','$LOCAL_CLASS','medium','healthy'),
('$MISMATCH_ASSET','11111111-1111-1111-1111-111111111111','$PREFIX' || '02 Mismatch Pump','Different Class $SUFFIX','medium','healthy');
SQL

UNAUTHORIZED=$(rpc "$TECH" record_tenant_asset_twin_template "{\"p_record\":{\"template_key\":\"$TEMPLATE_KEY\"}}")
err "$UNAUTHORIZED" 'named asset-master human'

DIRECT=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/asset_twin_templates" -H "apikey: $ANON_KEY" -H "authorization: Bearer $AUTHOR" -H 'content-type: application/json' -d "{\"template_key\":\"DIRECT-$SUFFIX\",\"version\":\"1\",\"asset_family\":\"x\",\"asset_class\":\"x\",\"title\":\"x\",\"template\":{}}")
test "$(status "$DIRECT")" = 403

FOREIGN_READ=$(curl -sS "$API_URL/rest/v1/asset_twin_templates?id=eq.$FOREIGN_TEMPLATE&select=id" -H "apikey: $ANON_KEY" -H "authorization: Bearer $AUTHOR")
test "$FOREIGN_READ" = '[]'

TEMPLATE=$(rpc "$AUTHOR" record_tenant_asset_twin_template "{\"p_record\":{\"template_key\":\"$TEMPLATE_KEY\",\"version\":\"1.0\",\"asset_family\":\"Rotating equipment\",\"asset_class\":\"$LOCAL_CLASS\",\"title\":\"Governed pump class\",\"description\":\"Tenant-private canonical structure for the governed smoke asset class.\",\"template\":{\"components\":[{\"name\":\"bearing assembly\",\"function\":\"support the rotating element\"}]},\"evidence_reference\":\"ENG-CLASS-$SUFFIX\",\"evidence_basis\":\"Controlled engineering class breakdown reviewed against the tenant asset taxonomy.\"}}")
ok "$TEMPLATE"
TEMPLATE_ID=$(BODY="$(body "$TEMPLATE")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['template_id'])")
SELF=$(rpc "$AUTHOR" review_tenant_asset_twin_template "{\"p_template_id\":\"$TEMPLATE_ID\",\"p_decision\":\"engineer_reviewed\",\"p_basis\":\"Independent engineering basis cannot be supplied by the original author.\"}")
err "$SELF" 'reviewer other than the author'
EXEC_REVIEW=$(rpc "$EXECUTIVE" review_tenant_asset_twin_template "{\"p_template_id\":\"$TEMPLATE_ID\",\"p_decision\":\"engineer_reviewed\",\"p_basis\":\"Executive authority alone is not an accountable engineering review credential.\"}")
err "$EXEC_REVIEW" 'accountable engineering authority'
REVIEW=$(rpc "$REVIEWER" review_tenant_asset_twin_template "{\"p_template_id\":\"$TEMPLATE_ID\",\"p_decision\":\"engineer_reviewed\",\"p_basis\":\"Independent engineering review confirmed the component structure and class boundary.\"}")
ok "$REVIEW"

DRAFT_V2=$(rpc "$AUTHOR" record_tenant_asset_twin_template "{\"p_record\":{\"template_key\":\"$TEMPLATE_KEY\",\"version\":\"2.0\",\"asset_family\":\"Rotating equipment\",\"asset_class\":\"$LOCAL_CLASS\",\"title\":\"Unreviewed successor\",\"template\":{\"components\":[{\"name\":\"unreviewed component\"}]},\"evidence_reference\":\"ENG-DRAFT-$SUFFIX\",\"evidence_basis\":\"Draft successor evidence remains pending independent engineering review.\"}}")
ok "$DRAFT_V2"

NO_MAKE=$(rpc "$AUTHOR" record_unit_numbering_rule "{\"p_record\":{\"number_prefix\":\"$PREFIX\",\"expected_class\":\"$LOCAL_CLASS\",\"model\":\"Invented model\",\"source\":\"NAMING-$SUFFIX\",\"evidence_basis\":\"Controlled equipment numbering standard reviewed by the named asset-master owner.\"}}")
err "$NO_MAKE" 'without a manufacturer'
RULE=$(rpc "$AUTHOR" record_unit_numbering_rule "{\"p_record\":{\"number_prefix\":\"$PREFIX\",\"expected_class\":\"$LOCAL_CLASS\",\"ambiguity_note\":\"The prefix establishes class only; manufacturer and model remain unknown.\",\"source\":\"NAMING-$SUFFIX\",\"evidence_basis\":\"Controlled equipment numbering standard reviewed by the named asset-master owner.\"}}")
ok "$RULE"

MAPPING=$(rpc "$AUTHOR" record_asset_class_governance "{\"p_record\":{\"local_class\":\"$LOCAL_CLASS\",\"catalogue_class\":\"Centrifugal Pump\",\"template_key\":\"$TEMPLATE_KEY\",\"fit\":\"direct\",\"rationale\":\"The controlled class definition and component boundary directly match this tenant class.\",\"source\":\"CLASS-MAP-$SUFFIX\",\"evidence_basis\":\"Named engineering review compared the local vocabulary with the canonical class definition.\"}}")
ok "$MAPPING"

PREVIEW=$(rpc "$AUTHOR" run_governed_unit_numbering '{"p_apply":false,"p_basis":""}')
ok "$PREVIEW"
APPLY=$(rpc "$AUTHOR" run_governed_unit_numbering "{\"p_apply\":true,\"p_basis\":\"Named-human review approved filling blank unit identity fields from controlled rule $SUFFIX.\"}")
ok "$APPLY"
BODY="$(body "$APPLY")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['tags_set']>=2 and x['class_mismatches']>=1,x"

TWIN_PREVIEW=$(rpc "$AUTHOR" run_governed_twin_provisioning '{"p_apply":false,"p_basis":""}')
ok "$TWIN_PREVIEW"
TWIN_APPLY=$(rpc "$AUTHOR" run_governed_twin_provisioning "{\"p_apply\":true,\"p_basis\":\"Named-human review approved draft twin creation from reviewed class mappings only $SUFFIX.\"}")
ok "$TWIN_APPLY"

EXPECTED="${PREFIX}01||${LOCAL_CLASS}|${TEMPLATE_KEY}@1.0+template-only|draft|2|7"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL | grep -Fqx "$EXPECTED"
select a.tag,coalesce(a.manufacturer,''),a.asset_class,i.compiled_version,i.status,
 (select count(*) from derived_asset_attributes d where d.asset_id in ('$ASSET','$MISMATCH_ASSET') and d.attribute='tag'),
 (select count(*) from audit_events e where e.organization_id='11111111-1111-1111-1111-111111111111'
   and (coalesce(e.event_data::text,'') || coalesce(e.previous_state::text,'') || coalesce(e.new_state::text,'')) like '%$SUFFIX%')
from assets a join asset_twin_instances i on i.asset_id=a.id where a.id='$ASSET';
SQL

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx "Different Class $SUFFIX|"
select asset_class,coalesce(manufacturer,'') from assets where id='$MISMATCH_ASSET';
SQL

echo 'E12.01/E12.02 asset-master smoke passed: tenant_wall=true direct_write_closed=true named_human=true independent_review=true engineering_authority=true private_template=true class_mapping=true numbering_fill_only=true mismatch_not_corrected=true draft_twins=true no_oem_invention=true audit_provenance=true'

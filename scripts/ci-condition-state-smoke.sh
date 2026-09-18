#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U18 condition-state smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999917'
FOREIGN_ASSET='98180000-0000-0000-0000-000000000002'
EVIDENCE_VERIFIED='98180000-0000-0000-0000-000000000011'
EVIDENCE_OTHER='98180000-0000-0000-0000-000000000012'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$AUTHOR" && test -n "$ADMIN"
ASSET=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select id from assets where organization_id='$ORG' order by created_at limit 1")
test -n "$ASSET"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','U18 foreign','utilities') on conflict(id) do nothing;
insert into assets(id,organization_id,name) values('$FOREIGN_ASSET','$OTHER_ORG','Foreign asset') on conflict(id) do nothing;
insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,description,evidence_class)
values ('$EVIDENCE_VERIFIED','$ORG','$ASSET','ci','inspection','Verified field condition inspection','INSPECTED'),
('$EVIDENCE_OTHER','$ORG','$ASSET','ci','calculation','Unverified condition calculation','CALCULATED') on conflict(id) do nothing;
SQL
VERIFY_EVIDENCE=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE_VERIFIED\",\"p_method\":\"Independent CI inspection review\",\"p_outcome\":\"verified\",\"p_note\":\"Verified for U18 condition-state acceptance.\"}")
ok "$VERIFY_EVIDENCE"
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_asset_condition_states" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')" = 401
FOREIGN=$(rpc "$AUTHOR" record_asset_condition_state "{\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_knowledge_state\":\"unknown\",\"p_basis\":\"Foreign tenant state must remain inaccessible.\"}")
err "$FOREIGN" 'asset not found'
UNPAIRED=$(rpc "$AUTHOR" record_asset_condition_state "{\"p_asset_id\":\"$ASSET\",\"p_knowledge_state\":\"estimated\",\"p_basis\":\"Calculation estimates condition from bounded evidence.\",\"p_assessed_value\":42}")
err "$UNPAIRED" 'value and unit'
FALSE_UNKNOWN=$(rpc "$AUTHOR" record_asset_condition_state "{\"p_asset_id\":\"$ASSET\",\"p_knowledge_state\":\"unknown\",\"p_basis\":\"Available evidence does not establish current condition.\",\"p_assessed_value\":1,\"p_value_unit\":\"index\"}")
err "$FALSE_UNKNOWN" 'unknown condition'
UNVERIFIED_KNOWN=$(rpc "$AUTHOR" record_asset_condition_state "{\"p_asset_id\":\"$ASSET\",\"p_knowledge_state\":\"known\",\"p_basis\":\"Only unverified calculation evidence is currently attached.\",\"p_evidence_item_ids\":[\"$EVIDENCE_OTHER\"],\"p_observed_at\":\"2026-09-14T10:00:00Z\"}")
err "$UNVERIFIED_KNOWN" 'independently verified evidence'
UNBOUNDED_PREDICTION=$(rpc "$AUTHOR" record_asset_condition_state "{\"p_asset_id\":\"$ASSET\",\"p_knowledge_state\":\"predicted\",\"p_basis\":\"A prediction without a validity horizon must be refused.\"}")
err "$UNBOUNDED_PREDICTION" 'validity horizon'
SINGLE_CONFLICT=$(rpc "$AUTHOR" record_asset_condition_state "{\"p_asset_id\":\"$ASSET\",\"p_knowledge_state\":\"conflicting\",\"p_basis\":\"One item cannot establish a conflict between evidence sources.\",\"p_evidence_item_ids\":[\"$EVIDENCE_VERIFIED\"]}")
err "$SINGLE_CONFLICT" 'at least two canonical'
UNKNOWN=$(rpc "$AUTHOR" record_asset_condition_state "{\"p_asset_id\":\"$ASSET\",\"p_knowledge_state\":\"unknown\",\"p_basis\":\"Current evidence does not establish condition; inspection is required.\"}")
ok "$UNKNOWN"
ASSESSMENT=$(BODY="$(body "$UNKNOWN")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['assessment_id'])")
SELF_REVIEW=$(rpc "$AUTHOR" verify_asset_condition_state "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_decision\":\"verified\",\"p_note\":\"The author must not verify this same assessment record.\"}")
err "$SELF_REVIEW" 'author cannot independently verify'
INDEPENDENT_REVIEW=$(rpc "$ADMIN" verify_asset_condition_state "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_decision\":\"verified\",\"p_note\":\"Independent review confirms unknown is the honest present state.\"}")
ok "$INDEPENDENT_REVIEW"
KNOWN=$(rpc "$AUTHOR" record_asset_condition_state "{\"p_asset_id\":\"$ASSET\",\"p_knowledge_state\":\"known\",\"p_basis\":\"Verified field inspection establishes the stated current condition.\",\"p_assessed_value\":72,\"p_value_unit\":\"condition_index\",\"p_evidence_item_ids\":[\"$EVIDENCE_VERIFIED\"],\"p_observed_at\":\"2026-09-14T10:00:00Z\"}")
ok "$KNOWN"
MODEL=$(rpc "$AUTHOR" get_asset_condition_states '{}')
ok "$MODEL"
BODY="$(body "$MODEL")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['states']==['known','estimated','predicted','unknown','conflicting'];assert len(x['assessments'])==1;assert x['assessments'][0]['knowledge_state']=='known';assert 'no state authorizes' in x['basis']"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx '1|1|3'
select count(*) filter(where status='draft'),count(*) filter(where status='superseded'),
(select count(*) from audit_events where organization_id='$ORG' and entity_type='asset_condition_assessment')
from asset_condition_assessments where organization_id='$ORG' and asset_id='$ASSET';
SQL
echo 'U18 condition-state smoke passed: tenant_wall=true states=5 false_precision_refused=true verified_evidence=true independent_review=true authority_unchanged=true'

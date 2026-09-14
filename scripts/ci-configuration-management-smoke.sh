#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U7 configuration activation smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999917'
ASSET='88700000-0000-0000-0000-000000000001'
FOREIGN='88700000-0000-0000-0000-000000000002'
M1='88700000-0000-0000-0000-000000000003'
M2='88700000-0000-0000-0000-000000000004'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200 || { echo "expected HTTP 200, got $(status "$1")"; return 1; }; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200 || { echo "expected controlled HTTP 200 refusal, got $(status "$1")"; return 1; }; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$AUTHOR" || { echo 'demo author authentication failed'; exit 1; }
test -n "$ADMIN" || { echo 'administrator authentication failed'; exit 1; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','U7 foreign','utilities') on conflict(id) do nothing;
insert into assets(id,organization_id,name,tag,asset_class) values('$ASSET','$ORG','U7 Pump','U7-P-101','pump'),('$FOREIGN','$OTHER_ORG','Foreign U7 Pump','X-U7','pump') on conflict(id) do nothing;
insert into materials(id,organization_id,material_code,description,is_template) values('$M1','$ORG','U7-SEAL-A','Specified seal',false),('$M2','$ORG','U7-SEAL-B','Candidate seal',false) on conflict(id) do nothing;
SQL

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_configuration_authoring_workspace" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')
test "$NOAUTH" = 401

echo 'U7 smoke: authentication and anonymous boundary passed'

FOREIGN_RESULT=$(rpc "$AUTHOR" record_configuration_baseline "{\"p_record\":{\"asset_id\":\"$FOREIGN\",\"baseline_kind\":\"as_maintained\",\"source_reference\":\"walkdown\",\"evidence_basis\":\"Named field walkdown evidence for a foreign tenant asset.\",\"items\":[{\"position_ref\":\"DE bearing\",\"quantity\":1}]}}")
err "$FOREIGN_RESULT" 'not found in this tenant'

BASE=$(rpc "$AUTHOR" record_configuration_baseline "{\"p_record\":{\"asset_id\":\"$ASSET\",\"baseline_kind\":\"as_maintained\",\"source_reference\":\"walkdown U7-001\",\"evidence_basis\":\"Named field walkdown and equipment nameplate evidence were reviewed.\",\"items\":[{\"position_ref\":\"drive end bearing\",\"part_number\":\"BRG-101\",\"quantity\":1,\"serial_number\":\"SN-U7-001\",\"firmware_version\":\"1.2.0\",\"safety_critical\":true,\"safety_basis\":\"Protective train bearing position\"}]}}")
ok "$BASE"
NO_CHANGE=$(rpc "$AUTHOR" record_configuration_baseline "{\"p_record\":{\"asset_id\":\"$ASSET\",\"baseline_kind\":\"as_maintained\",\"source_reference\":\"walkdown U7-002\",\"evidence_basis\":\"Second field walkdown evidence for a controlled revision attempt.\",\"items\":[{\"position_ref\":\"drive end bearing\",\"part_number\":\"BRG-102\",\"quantity\":1}]}}")
err "$NO_CHANGE" 'engineering change reference'
REV=$(rpc "$AUTHOR" record_configuration_baseline "{\"p_record\":{\"asset_id\":\"$ASSET\",\"baseline_kind\":\"as_maintained\",\"source_reference\":\"walkdown U7-002\",\"evidence_basis\":\"Second field walkdown evidence tied to the engineering change record.\",\"engineering_change_reference\":\"MOC-U7-001\",\"items\":[{\"position_ref\":\"drive end bearing\",\"part_number\":\"BRG-102\",\"quantity\":1,\"serial_number\":\"SN-U7-002\"}]}}")
ok "$REV"

V1=$(rpc "$AUTHOR" record_model_variant '{"p_record":{"manufacturer":"Sync Pumps","model":"SP-100","variant_code":"A","distinguishing_attributes":"Standard pressure casing and 50 Hz motor","evidence_basis":"Controlled manufacturer data sheet SP-100-A was reviewed."}}'); ok "$V1"
V1_ID=$(BODY="$(body "$V1")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['variant_id'])")
V2=$(rpc "$AUTHOR" record_model_variant '{"p_record":{"manufacturer":"Sync Pumps","model":"SP-100","variant_code":"B","distinguishing_attributes":"High pressure casing and 60 Hz motor","evidence_basis":"Controlled manufacturer data sheet SP-100-B was reviewed."}}'); ok "$V2"
V2_ID=$(BODY="$(body "$V2")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['variant_id'])")

SUB=$(rpc "$AUTHOR" propose_configuration_authority "{\"p_kind\":\"substitution\",\"p_record\":{\"specified_material_id\":\"$M1\",\"substitute_material_id\":\"$M2\",\"conditions\":\"Only for clean-water duty below the stated pressure limit\",\"expires_at\":\"2027-09-14T00:00:00Z\",\"is_bidirectional\":false,\"evidence_basis\":\"Engineering comparison of ratings, interfaces and service duty was reviewed.\"}}")
ok "$SUB"; SUB_ID=$(BODY="$(body "$SUB")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['record_id'])")
SELF=$(rpc "$AUTHOR" decide_configuration_authority "{\"p_kind\":\"substitution\",\"p_record_id\":$SUB_ID,\"p_outcome\":\"approved\",\"p_note\":\"The proposer must not approve their own engineering authority.\"}"); err "$SELF" 'cannot approve their own'
SUB_OK=$(rpc "$ADMIN" decide_configuration_authority "{\"p_kind\":\"substitution\",\"p_record_id\":$SUB_ID,\"p_outcome\":\"approved\",\"p_note\":\"Independent review confirmed ratings, interfaces, duty and expiry.\"}"); ok "$SUB_OK"

INT=$(rpc "$AUTHOR" propose_configuration_authority "{\"p_kind\":\"interchangeability\",\"p_record\":{\"from_variant_id\":$V1_ID,\"to_variant_id\":$V2_ID,\"interchange_kind\":\"conditional\",\"conditions\":\"Requires motor, voltage and pressure-envelope verification\",\"evidence_basis\":\"Manufacturer variant comparison and engineering interface evidence were reviewed.\"}}")
ok "$INT"; INT_ID=$(BODY="$(body "$INT")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['record_id'])")
INT_OK=$(rpc "$ADMIN" decide_configuration_authority "{\"p_kind\":\"interchangeability\",\"p_record_id\":$INT_ID,\"p_outcome\":\"approved\",\"p_note\":\"Independent review confirmed the stated conditional interchangeability boundary.\"}"); ok "$INT_OK"

RED=$(rpc "$AUTHOR" record_red_line "{\"p_record\":{\"asset_id\":\"$ASSET\",\"drawing_reference\":\"P&ID-U7-001\",\"drawing_revision\":\"3\",\"change_description\":\"Field routing differs at the drive-end lubrication branch\",\"evidence_basis\":\"Dated field photograph and marked controlled drawing were reviewed.\"}}")
ok "$RED"; RED_ID=$(BODY="$(body "$RED")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['red_line_id'])")
SELF_RED=$(rpc "$AUTHOR" dispose_red_line "{\"p_red_line_id\":$RED_ID,\"p_outcome\":\"incorporated\",\"p_incorporated_revision\":\"4\",\"p_note\":\"The author must not close their own controlled red-line markup.\"}"); err "$SELF_RED" 'cannot close their own'
RED_OK=$(rpc "$ADMIN" dispose_red_line "{\"p_red_line_id\":$RED_ID,\"p_outcome\":\"incorporated\",\"p_incorporated_revision\":\"4\",\"p_note\":\"Independent document-control review verified incorporation in revision four.\"}"); ok "$RED_OK"

NO_MOC=$(rpc "$AUTHOR" record_configuration_reconciliation "{\"p_record\":{\"asset_id\":\"$ASSET\",\"trigger\":\"outage\",\"differences_found\":1,\"safety_critical_differences\":0,\"summary\":\"One controlled difference was found during the outage walkdown.\",\"evidence_basis\":\"Signed outage walkdown sheet and configuration photographs were reviewed.\"}}")
err "$NO_MOC" 'engineering change reference'
RECON=$(rpc "$AUTHOR" record_configuration_reconciliation "{\"p_record\":{\"asset_id\":\"$ASSET\",\"trigger\":\"outage\",\"differences_found\":1,\"safety_critical_differences\":0,\"summary\":\"One controlled difference was found during the outage walkdown.\",\"evidence_basis\":\"Signed outage walkdown sheet and configuration photographs were reviewed.\",\"engineering_change_reference\":\"MOC-U7-002\"}}")
ok "$RECON"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx '2|1|1|1|1'
select (select max(revision) from configuration_baselines where asset_id='$ASSET'),
 (select count(*) from configuration_items where organization_id='$ORG' and serial_number='SN-U7-002'),
 (select count(*) from approved_substitutions where organization_id='$ORG' and status='approved'),
 (select count(*) from interchangeability_rules where organization_id='$ORG' and status='approved'),
 (select count(*) from configuration_reconciliations where organization_id='$ORG' and engineering_change_reference='MOC-U7-002');
SQL

echo 'U7 configuration activation smoke passed: tenant_wall=true serial_trace=true baseline_revision_change_control=true canonical_approval=true independent_review=true red_line_control=true variant_interchangeability=true reconciliation=true no_execution=true'

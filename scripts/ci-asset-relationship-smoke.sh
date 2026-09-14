#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U12 asset-relationship smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999916'
FOREIGN_ASSET='98120000-0000-0000-0000-000000000002'
STAKEHOLDER='98120000-0000-0000-0000-000000000011'
FOREIGN_STAKEHOLDER='98120000-0000-0000-0000-000000000012'
EVIDENCE='98120000-0000-0000-0000-000000000021'
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
AUTHORITY_BEFORE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')")
AUDIT_BEFORE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('asset_tenure','asset_party_role_assignment')")
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','U12 foreign','utilities') on conflict(id) do nothing;
insert into assets(id,organization_id,name) values('$FOREIGN_ASSET','$OTHER_ORG','Foreign relationship asset') on conflict(id) do nothing;
insert into risk_stakeholders(id,organization_id,stakeholder_type,name,external_organization,role_or_relationship)
values('$STAKEHOLDER','$ORG','external','Equipment partner','Equipment Partner Ltd','Lease counterparty and maintenance provider'),
('$FOREIGN_STAKEHOLDER','$OTHER_ORG','external','Foreign counterparty','Foreign Ltd','Foreign owner') on conflict(id) do nothing;
insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,description,evidence_class)
values('$EVIDENCE','$ORG','$ASSET','ci','contract','Executed lease and maintenance responsibility schedule','DOCUMENTARY') on conflict(id) do nothing;
SQL
VERIFY_EVIDENCE=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent CI review of executed agreement\",\"p_outcome\":\"verified\",\"p_note\":\"Agreement evidence verified for U12 accountability acceptance.\"}")
ok "$VERIFY_EVIDENCE"

test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_asset_relationship_workspace" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')" = 401
FOREIGN_ASSET_RESULT=$(rpc "$AUTHOR" record_asset_relationship "{\"p_asset_id\":\"$FOREIGN_ASSET\",\"p_tenure\":\"owned\",\"p_relationship_basis\":\"Foreign tenant asset must remain inaccessible.\"}")
err "$FOREIGN_ASSET_RESULT" 'asset not found'
FOREIGN_PARTY_RESULT=$(rpc "$AUTHOR" record_asset_relationship "{\"p_asset_id\":\"$ASSET\",\"p_tenure\":\"leased\",\"p_relationship_basis\":\"A foreign counterparty must remain inaccessible.\",\"p_counterparty_stakeholder_id\":\"$FOREIGN_STAKEHOLDER\"}")
err "$FOREIGN_PARTY_RESULT" 'counterparty stakeholder not found'
NO_PARTY=$(rpc "$AUTHOR" record_asset_relationship "{\"p_asset_id\":\"$ASSET\",\"p_tenure\":\"leased\",\"p_relationship_basis\":\"A non-owned relationship must name its counterparty.\"}")
err "$NO_PARTY" 'requires a canonical stakeholder'
NO_RENT_END=$(rpc "$AUTHOR" record_asset_relationship "{\"p_asset_id\":\"$ASSET\",\"p_tenure\":\"rented\",\"p_relationship_basis\":\"A rental must carry a bounded effective period.\",\"p_counterparty_stakeholder_id\":\"$STAKEHOLDER\"}")
err "$NO_RENT_END" 'requires an end date'

RELATIONSHIP=$(rpc "$AUTHOR" record_asset_relationship "{\"p_asset_id\":\"$ASSET\",\"p_tenure\":\"leased\",\"p_relationship_basis\":\"Executed agreement makes the counterparty responsible for major maintenance while the site operates the asset.\",\"p_counterparty_stakeholder_id\":\"$STAKEHOLDER\",\"p_agreement_reference\":\"LEASE-2026-12\",\"p_maintenance_responsibility\":\"counterparty\",\"p_history_visible_to_site\":false,\"p_strategy_constraint\":\"Major maintenance requires counterparty coordination.\",\"p_starts_on\":\"2026-01-01\",\"p_ends_on\":\"2028-12-31\",\"p_evidence_item_ids\":[\"$EVIDENCE\"]}")
ok "$RELATIONSHIP"
SELF_RELATIONSHIP=$(rpc "$AUTHOR" verify_asset_relationship "{\"p_asset_id\":\"$ASSET\",\"p_decision\":\"verified\",\"p_note\":\"The author must not verify this same relationship.\"}")
err "$SELF_RELATIONSHIP" 'author cannot independently verify'
VERIFY_RELATIONSHIP=$(rpc "$ADMIN" verify_asset_relationship "{\"p_asset_id\":\"$ASSET\",\"p_decision\":\"verified\",\"p_note\":\"Independent review confirms the executed lease and responsibility schedule.\"}")
ok "$VERIFY_RELATIONSHIP"

PARTY_ROLE=$(rpc "$AUTHOR" record_asset_party_role "{\"p_asset_id\":\"$ASSET\",\"p_stakeholder_id\":\"$STAKEHOLDER\",\"p_party_role\":\"engineering_authority\",\"p_responsibility_scope\":\"Reviews engineering changes under the agreement but receives no SyncAI permission or work-release authority.\",\"p_effective_from\":\"2026-01-01\",\"p_effective_to\":\"2028-12-31\",\"p_agreement_reference\":\"LEASE-2026-12\",\"p_evidence_item_ids\":[\"$EVIDENCE\"]}")
ok "$PARTY_ROLE"
ASSIGNMENT=$(BODY="$(body "$PARTY_ROLE")" python3 -c "import json,os;print(json.loads(os.environ['BODY'])['assignment_id'])")
SELF_PARTY=$(rpc "$AUTHOR" verify_asset_party_role "{\"p_assignment_id\":\"$ASSIGNMENT\",\"p_decision\":\"verified\",\"p_note\":\"The author must not verify this same party role.\"}")
err "$SELF_PARTY" 'author cannot independently verify'
VERIFY_PARTY=$(rpc "$ADMIN" verify_asset_party_role "{\"p_assignment_id\":\"$ASSIGNMENT\",\"p_decision\":\"verified\",\"p_note\":\"Independent review confirms the bounded engineering responsibility.\"}")
ok "$VERIFY_PARTY"

MODEL=$(rpc "$AUTHOR" get_asset_relationship_workspace '{}')
ok "$MODEL"
BODY="$(body "$MODEL")" ASSET="$ASSET" python3 -c "import json,os;x=json.loads(os.environ['BODY']);r=next(i for i in x['relationships'] if i['asset_id']==os.environ['ASSET']);a=next(i for i in x['assignments'] if i['asset_id']==os.environ['ASSET']);assert len(x['relationship_types'])==10;assert len(x['party_roles'])==9;assert r['status']=='verified';assert a['status']=='verified';assert 'do not grant' in x['basis']"
AUTHORITY_AFTER=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')")
test "$AUTHORITY_AFTER" = "$AUTHORITY_BEFORE"
AUDIT_AFTER=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('asset_tenure','asset_party_role_assignment')")
test "$AUDIT_AFTER" -eq "$((AUDIT_BEFORE + 4))"
echo 'U12 asset-relationship smoke passed: tenant_wall=true relationships=10 roles=9 evidence=true independent_review=true authority_unchanged=true'

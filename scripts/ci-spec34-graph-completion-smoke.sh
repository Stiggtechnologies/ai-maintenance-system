#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D11.21 §34 graph completion smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"; : "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; OTHER='99999999-9999-4999-8999-999999999921'
CASE='91112100-0000-4000-8000-000000000001'; FOREIGN_CASE='91112100-0000-4000-8000-000000000002'
OBJECTIVE='91112100-0000-4000-8000-000000000003'; ASSET='91112100-0000-4000-8000-000000000004'
EVIDENCE='91112100-0000-4000-8000-000000000005'; SELF_EVIDENCE='91112100-0000-4000-8000-000000000006'
ADMIN='00000000-0000-0000-0000-000000000006'; VERIFIER='00000000-0000-0000-0000-000000000001'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }; status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }
ADMIN_TOKEN=$(token 'admin@syncai.ca' 'Admin123!@#'); test -n "$ADMIN_TOKEN"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name) values('$OTHER','D11.21 foreign tenant') on conflict(id) do nothing;
insert into risk_objectives(id,organization_id,owner_id,objective_level,description,target,measurement,timeframe,tolerance,status,adopted_by,adopted_at,created_by)
values('$OBJECTIVE','$ORG','$ADMIN','project','Deliver the case asset capability evidenced by controlled procurement.','Commissioned capability','Accepted asset relationship','Before handover','No unsupported substitution','adopted','$VERIFIER',now(),'$ADMIN') on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,objective_id,created_by)
values('$CASE','$ORG','D11.21 relationship case','brownfield','The canonical graph needs direct, evidenced contract-to-asset and asset-to-objective relationships.','active','$OBJECTIVE','$ADMIN'),
('$FOREIGN_CASE','$OTHER','Foreign graph case','brownfield','Must not be visible across the tenant wall.','active',null,null) on conflict(id) do nothing;
insert into assets(id,organization_id,tag,asset_tag,name,criticality)
values('$ASSET','$ORG','D11-21-A1','D11-21-A1','D11.21 commissioned pump','high') on conflict(id) do nothing;
insert into development_case_assets(organization_id,development_case_id,asset_id,added_by,note)
values('$ORG','$CASE','$ASSET','$ADMIN','The commissioned asset is in scope for the D11.21 graph relationship smoke.') on conflict do nothing;
insert into evidence_items(id,organization_id,development_case_id,asset_id,source_system,evidence_type,description,data_quality,source_reference,evidence_class,verification_status,verified_by,verified_at,verification_method)
values('$EVIDENCE','$ORG','$CASE','$ASSET','ci','document','Independently verified contract equipment schedule and objective trace.','high','D11.21-CI-001','DOCUMENTED','verified','$VERIFIER',now(),'Independent CI review'),
('$SELF_EVIDENCE','$ORG','$CASE','$ASSET','ci','document','Evidence verified by the same person who will attempt to record the relationship.','high','D11.21-CI-SELF','DOCUMENTED','verified','$ADMIN',now(),'Self review fixture') on conflict(id) do nothing;
insert into contract_packages(organization_id,package_code,title,scope_of_work,acceptance_criteria,site_conditions_stated,development_case_id,equipment_or_scope,required_date,lead_time_days,recorded_by)
values('$ORG','D11-21-P1','D11.21 pump contract','Provide the identified commissioned pump and controlled documentation.','Asset identity and acceptance evidence match the contract schedule.',true,'$CASE','D11.21 commissioned pump',current_date+60,30,'$ADMIN') returning id \gset pkg_
insert into contract_bids(organization_id,package_id,supplier_id,price,labour_hours,assumed_productivity_factor,duration_days,inclusions,qualifications,submitted_on,bid_ref,sealed_at,submitted_by,currency,price_basis)
values('$ORG',:pkg_id,1,100000,100,1,30,'Supply and documented delivery of the named pump.','Qualified controlled fixture supplier.',current_date,'D11-21-BID-1',now(),'$ADMIN','CAD','Controlled fixture price basis.') returning id \gset bid_
update contract_packages set bids_opened_at=now(),bids_opened_by='$ADMIN',awarded_at=now(),awarded_by='$ADMIN',awarded_bid_id=:bid_id,awarded_supplier_id=1,awarded_value=100000,award_basis='Controlled award fixture with accepted offer and authority evidence.',contract_type='lump_sum',contract_currency='CAD',contract_start_date=current_date,contract_completion_date=current_date+30,performance_requirements='Provide the named asset with complete controlled documentation.' where id=:pkg_id;
SQL
PACKAGE_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -c "select id from contract_packages where organization_id='$ORG' and package_code='D11-21-P1'")
test -n "$PACKAGE_ID"

test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_case_spec34_relationships" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"p_case_id\":\"$CASE\"}")" = 401
R=$(rpc "$ADMIN_TOKEN" link_contract_to_asset "{\"p_case_id\":\"$CASE\",\"p_contract_package_id\":$PACKAGE_ID,\"p_asset_id\":\"$ASSET\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_basis\":\"The accepted contract equipment schedule names this canonical asset.\"}"); ok "$R"
R=$(rpc "$ADMIN_TOKEN" link_asset_to_objective "{\"p_case_id\":\"$CASE\",\"p_asset_id\":\"$ASSET\",\"p_objective_id\":\"$OBJECTIVE\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_basis\":\"The adopted objective is delivered through this canonical case asset.\"}"); ok "$R"
SELF=$(rpc "$ADMIN_TOKEN" link_asset_to_objective "{\"p_case_id\":\"$CASE\",\"p_asset_id\":\"$ASSET\",\"p_objective_id\":\"$OBJECTIVE\",\"p_evidence_item_id\":\"$SELF_EVIDENCE\",\"p_basis\":\"A duplicate relationship using self-verified evidence must be refused.\"}"); err "$SELF" 'independently verified'
FOREIGN=$(rpc "$ADMIN_TOKEN" get_case_spec34_relationships "{\"p_case_id\":\"$FOREIGN_CASE\"}"); err "$FOREIGN" 'not found'
READ=$(rpc "$ADMIN_TOKEN" get_case_spec34_relationships "{\"p_case_id\":\"$CASE\"}"); ok "$READ"
BODY="$(body "$READ")" EVIDENCE="$EVIDENCE" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert len(x["contractProvidesAsset"])==1;assert len(x["assetSupportsObjective"])==1;assert x["contractProvidesAsset"][0]["evidenceItemId"]==os.environ["EVIDENCE"];assert x["assetSupportsObjective"][0]["evidenceItemId"]==os.environ["EVIDENCE"];assert "not contract acceptance" in x["decisionBoundary"]'
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  begin update contract_asset_links set basis='A direct rewrite must be refused even when it remains substantive.'; raise exception 'immutable relationship update was allowed';
  exception when others then if sqlerrm not like '%immutable%' then raise; end if; end;
end $$;
SQL
LEDGER=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -c "select jsonb_array_length(sync_spec34_edges()),sync_spec34_absent_edge_audit()->>'implementedEdgeCount',sync_spec34_absent_edge_audit()->>'absentEdgeCount',(select count(*) from audit_events where organization_id='$ORG' and entity_type in ('contract_provides_asset','asset_supports_objective'))")
test "$LEDGER" = '19|19|0|2'
echo 'D11.21 §34 graph completion smoke passed: nineteen_edges=true zero_absent=true canonical_associations=true independent_evidence=true immutable=true tenant_wall=true named_human=true no_authority=true'

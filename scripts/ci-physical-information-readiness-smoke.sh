#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D11.08 physical/information readiness smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"; : "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; OTHER_ORG='99999999-9999-9999-9999-999999999927'
CASE='91110800-0000-4000-8000-000000000001'; FOREIGN_CASE='91110800-0000-4000-8000-000000000002'; EVIDENCE='91110800-0000-4000-8000-000000000003'; SYSTEM=911108001
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }; status(){ printf '%s' "${1##*$'\n'}"; }
USER_TOKEN=$(token 'admin@syncai.ca' 'Admin123!@#'); test -n "$USER_TOKEN"
USER_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -c "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
ASSET_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -c "select id from assets where organization_id='$ORG' order by created_at limit 1")
PROJECT_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -c "select id from capital_projects where organization_id='$ORG' order by id limit 1")
test -n "$USER_ID"; test -n "$ASSET_ID"; test -n "$PROJECT_ID"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','D11.08 foreign','utilities') on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,created_by,capital_project_id)
values
('$CASE','$ORG','Separate readiness case','brownfield','Prove physical and information evidence remain independent.','active','$USER_ID','$PROJECT_ID'),
('$FOREIGN_CASE','$OTHER_ORG','Foreign readiness case','brownfield','Foreign tenant data must remain inaccessible.','active',null,null)
on conflict(id) do nothing;
insert into evidence_items(id,organization_id,development_case_id,asset_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method)
values('$EVIDENCE','$ORG','$CASE','$ASSET_ID','ci','document','Verified D11.08 physical and information acceptance evidence.','DOCUMENTED','verified','$USER_ID',now(),'Controlled acceptance review') on conflict(id) do nothing;
insert into commissioning_systems(id,organization_id,development_case_id,project_id,system_ref,title,description,owner_id,created_by,commissioning_state,state_changed_at,state_changed_by)
values('$SYSTEM','$ORG','$CASE','$PROJECT_ID','D11.08-SYS','Readiness proof system','A controlled commissioning system proving distinct evidence positions.','$USER_ID','$USER_ID','PERFORMANCE_VERIFIED',now(),'$USER_ID') on conflict(id) do nothing;
insert into commissioning_system_assets(organization_id,commissioning_system_id,asset_id,required_energy_types,basis,evidence_item_id,bound_by)
values('$ORG','$SYSTEM','$ASSET_ID',array['mechanical']::text[],'Asset belongs to the controlled D11.08 commissioning scope.','$EVIDENCE','$USER_ID') on conflict do nothing;
insert into asset_onboarding_items(organization_id,asset_id,requirement_key,status,value,source,confidence,note,filled_at,provided_by,evidence_item_id)
values('$ORG','$ASSET_ID','s14_bom','human_provided',jsonb_build_object('summary','Verified BOM'),'D11.08 acceptance','high','Evidence-backed information readiness fixture.',now(),'$USER_ID','$EVIDENCE')
on conflict(asset_id,requirement_key) do update set status='human_provided',evidence_item_id=excluded.evidence_item_id,note=excluded.note;
insert into commissioning_system_readiness_scope(organization_id,commissioning_system_id,onboarding_item_id,owner_id,required_before,basis,basis_evidence_item_id,assigned_by)
select '$ORG','$SYSTEM',id,'$USER_ID',current_date,'Information item is required before controlled system handover.','$EVIDENCE','$USER_ID'
from asset_onboarding_items where organization_id='$ORG' and asset_id='$ASSET_ID' and requirement_key='s14_bom'
on conflict do nothing;
insert into acceptance_tests(organization_id,test_ref,test_stage,performed_on,outcome,punch_items_raised,punch_items_open,witnessed_by_owner,asset_id,acceptance_criteria,test_procedure_reference,tested_samples,passed_samples,evidence_item_id,performed_by,release_status,released_by,released_at,release_note,commissioning_system_id)
values('$ORG','D11.08-AT','performance_test',current_date,'pass',0,0,true,'$ASSET_ID','System meets controlled performance acceptance criteria.','PROC-D11.08',1,1,'$EVIDENCE','$USER_ID','released','$USER_ID',now(),'Independently released for D11.08 acceptance proof.','$SYSTEM') on conflict do nothing;
SQL
ANON=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_case_physical_information_readiness" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"p_case_id\":\"$CASE\"}")
test "$(status "$ANON")" = 400; body "$ANON" | grep -q 'authentication required'
RESULT=$(rpc "$USER_TOKEN" get_case_physical_information_readiness "{\"p_case_id\":\"$CASE\"}"); test "$(status "$RESULT")" = 200
BODY="$(body "$RESULT")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["systemCount"]==1;assert x["project"]["physical"]["percent"]==100;assert x["project"]["information"]["percent"]==100;assert x["systems"][0]["physical"]["source"]=="acceptance_tests + commissioning_systems";assert "does not accept handover" in x["decisionBoundary"]'
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "update asset_onboarding_items set status='pending', evidence_item_id=null where organization_id='$ORG' and asset_id='$ASSET_ID' and requirement_key='s14_bom';"
SPLIT=$(rpc "$USER_TOKEN" get_case_physical_information_readiness "{\"p_case_id\":\"$CASE\"}"); test "$(status "$SPLIT")" = 200
BODY="$(body "$SPLIT")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["project"]["physical"]["percent"]==100;assert x["project"]["information"]["percent"]==0;assert x["project"]["physical"]["status"]=="READY";assert x["project"]["information"]["status"]=="NOT_READY";assert len(x["systems"][0]["information"]["gaps"])==1'
FOREIGN=$(rpc "$USER_TOKEN" get_case_physical_information_readiness "{\"p_case_id\":\"$FOREIGN_CASE\"}"); test "$(status "$FOREIGN")" = 400; body "$FOREIGN" | grep -q 'not found in current tenant'
! grep -Eiq 'create[[:space:]]+table|synthetic[[:space:]]+score' supabase/migrations/20261220040000_physical_information_readiness.sql
echo 'D11.08 physical/information readiness smoke passed: project_rollup=true system_drilldown=true independent_positions=true evidence_required=true tenant_wall=true human_authority=true'

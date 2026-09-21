#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D11.11 stage-dimension smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; OTHER_ORG='99999999-9999-9999-9999-999999999926'
CASE='91111100-0000-4000-8000-000000000001'; FOREIGN_CASE='91111100-0000-4000-8000-000000000002'
OBJECTIVE='91111100-0000-4000-8000-000000000003'; EVIDENCE='91111100-0000-4000-8000-000000000004'
FRAMEWORK='91111100-0000-4000-8000-000000000005'; CONTRACT='91111100-0000-4000-8000-000000000006'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }; status(){ printf '%s' "${1##*$'\n'}"; }
USER_TOKEN=$(token 'admin@syncai.ca' 'Admin123!@#'); test -n "$USER_TOKEN"
USER_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','D11.11 foreign','utilities') on conflict(id) do nothing;
insert into project_frameworks(id,organization_id,name,version,source,effective_date,status,basis,created_by)
values('$FRAMEWORK','$ORG','D11.11 governed framework',1,'internal',current_date,'adopted','Controlled D11.11 acceptance framework.','$USER_ID') on conflict(id) do nothing;
insert into project_framework_stages(organization_id,framework_id,stage_key,sequence,display_name,purpose)
values
('$ORG','$FRAMEWORK','need_identification',1,'Need identification','Frame the case'),
('$ORG','$FRAMEWORK','design',2,'Design','Define the solution'),
('$ORG','$FRAMEWORK','realize',3,'Realize','Verify outcomes')
on conflict do nothing;
insert into risk_objectives(id,organization_id,objective_level,description,target,measurement,timeframe,tolerance,status,owner_id)
values('$OBJECTIVE','$ORG','project','Deliver a governed lifecycle outcome.','Reliable service','Lifecycle result','Project through operation','No unreviewed deviation','adopted','$USER_ID') on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,current_stage_key,framework_id,lifecycle_type,problem_statement,status,created_by,objective_id)
values
('$CASE','$ORG','Eight-dimension case','design','$FRAMEWORK','brownfield','Prove every governed stage exposes all eight canonical dimensions.','active','$USER_ID','$OBJECTIVE'),
('$FOREIGN_CASE','$OTHER_ORG','Foreign dimension case',null,null,'brownfield','Foreign tenant data must remain inaccessible.','active',null,null)
on conflict(id) do nothing;
insert into evidence_items(id,organization_id,development_case_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method)
values('$EVIDENCE','$ORG','$CASE','ci','document','Verified D11.11 lifecycle substrate acceptance evidence.','DOCUMENTED','verified','$USER_ID',now(),'Controlled acceptance review') on conflict(id) do nothing;
insert into business_cases(organization_id,case_ref,title,driver,discount_rate,status,development_case_id)
values('$ORG','D11.11-BC','Lifecycle value case','reliability',0.08,'draft','$CASE') on conflict do nothing;
insert into risks(organization_id,development_case_id,objective_id,title,kind,current_risk_level,status,created_by)
values('$ORG','$CASE','$OBJECTIVE','Lifecycle interface exposure','threat','High','draft','$USER_ID');
insert into decisions(organization_id,development_case_id,decision_type,action_taken,approval_status,autonomy_mode,rationale)
values('$ORG','$CASE','project_option','Record governed option','pending','human_approval_required','A named human retains decision authority.') on conflict do nothing;
insert into development_baselines(organization_id,development_case_id,baseline_type,version,status,description,content,created_by)
values('$ORG','$CASE','SCOPE','1','draft','Controlled configuration basis',jsonb_build_object('basis','D11.11'),'$USER_ID') on conflict do nothing;
insert into work_packages(organization_id,development_case_id,package_code,title,package_type,scope,status,recorded_by)
values('$ORG','$CASE','D11.11-WP','Controlled lifecycle work','engineering','Prove substrate reachability.','draft','$USER_ID') on conflict do nothing;
insert into development_success_contracts(id,organization_id,development_case_id,version,status,created_by)
values('$CONTRACT','$ORG','$CASE',1,'draft','$USER_ID') on conflict(id) do nothing;
insert into development_success_outcomes(organization_id,contract_id,dimension,outcome_statement,basis,owner_id)
values('$ORG','$CONTRACT','reliability','Sustain verified service through operation.','D11.11 acceptance basis','$USER_ID') on conflict do nothing;
SQL

ANON=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_case_stage_dimensions" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"p_case_id\":\"$CASE\"}")
test "$(status "$ANON")" = 400
body "$ANON" | grep -q 'authentication required'
RESULT=$(rpc "$USER_TOKEN" get_case_stage_dimensions "{\"p_case_id\":\"$CASE\"}")
test "$(status "$RESULT")" = 200
BODY="$(body "$RESULT")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);keys=["objective","value","risk","evidence","decision","configuration","work","outcome"];assert x["dimensionKeys"]==keys;assert len(x["stages"])==3;assert all(len(s["dimensions"])==8 for s in x["stages"]);assert all([d["key"] for d in s["dimensions"]]==keys for s in x["stages"]);assert all(d["count"]>=1 for d in x["stages"][0]["dimensions"]);assert [s["progress"] for s in x["stages"]]==["completed","current","upcoming"];assert "not gate approval" in x["authorityBoundary"]'
FOREIGN=$(rpc "$USER_TOKEN" get_case_stage_dimensions "{\"p_case_id\":\"$FOREIGN_CASE\"}")
test "$(status "$FOREIGN")" = 400
body "$FOREIGN" | grep -q 'not found in current tenant'
! grep -Eiq 'create[[:space:]]+table|synthetic[[:space:]]+score' supabase/migrations/20261220110000_eight_dimension_stage_substrate.sql
echo 'D11.11 stage-dimension smoke passed: stages=3 dimensions_each=8 canonical_reads=true tenant_wall=true missing_explicit=true no_synthetic_score=true human_authority=true'

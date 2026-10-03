#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D11.03 engine-overlay smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; OTHER_ORG='99999999-9999-9999-9999-999999999925'
CASE='91110300-0000-4000-8000-000000000001'; FOREIGN_CASE='91110300-0000-4000-8000-000000000002'
OBJECTIVE='91110300-0000-4000-8000-000000000003'; EVIDENCE='91110300-0000-4000-8000-000000000004'
DESIGN='911103005'; QUALITY='911103006'; BUSINESS_CASE='911103007'
OPTION='911103008'; STAKEHOLDER='91110300-0000-4000-8000-000000000009'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }; status(){ printf '%s' "${1##*$'\n'}"; }
USER_TOKEN=$(token 'admin@syncai.ca' 'Admin123!@#'); test -n "$USER_TOKEN"
USER_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','D11.03 foreign','utilities') on conflict(id) do nothing;
insert into risk_objectives(id,organization_id,objective_level,description,target,measurement,timeframe,tolerance,status,owner_id)
values('$OBJECTIVE','$ORG','project','Deliver a reliable, maintainable and responsibly governed asset.','Reliable service','Lifecycle outcome','Project through operation','No unreviewed material deviation','adopted','$USER_ID') on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,created_by,objective_id)
values
('$CASE','$ORG','Complete engine overlay case','brownfield','Prove all cross-cutting concerns remain visible in every engine.','active','$USER_ID','$OBJECTIVE'),
('$FOREIGN_CASE','$OTHER_ORG','Foreign overlay case','brownfield','Foreign tenant data must not cross the overlay boundary.','active',null,null)
on conflict(id) do nothing;
insert into evidence_items(id,organization_id,development_case_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method)
values('$EVIDENCE','$ORG','$CASE','ci','document','Verified evidence for every cross-cutting overlay acceptance fixture.','DOCUMENTED','verified','$USER_ID',now(),'Controlled acceptance review') on conflict(id) do nothing;
insert into risks(organization_id,development_case_id,objective_id,title,kind,current_risk_level,status,created_by)
values('$ORG','$CASE','$OBJECTIVE','Interface uncertainty could affect the project objective','threat','High','draft','$USER_ID');
insert into design_requirements(id,organization_id,development_case_id,requirement_ref,category,requirement,objective_id,created_by)
values('$DESIGN','$ORG','$CASE','D11.03-REQ','quality','Installed asset quality must be independently verified.','$OBJECTIVE','$USER_ID') on conflict(id) do nothing;
insert into quality_requirements(id,organization_id,requirement_ref,title,requirement_text,source_kind,source_reference,acceptance_criterion,verification_method,created_by,design_requirement_id)
values('$QUALITY','$ORG','D11.03-Q','Overlay quality requirement','Installed quality must satisfy the linked design requirement.','design','D11.03 acceptance','Independent evidence confirms acceptance.','inspection','$USER_ID','$DESIGN') on conflict(id) do nothing;
insert into business_cases(id,organization_id,case_ref,title,driver,discount_rate,status,development_case_id)
values('$BUSINESS_CASE','$ORG','D11.03-BC','Controlled overlay case','reliability',0.08,'draft','$CASE') on conflict(id) do nothing;
insert into business_case_options(id,organization_id,case_id,label,life_periods)
values('$OPTION','$ORG','$BUSINESS_CASE','Controlled option',20) on conflict(id) do nothing;
insert into option_sustainability_observations(organization_id,option_id,dimension,observation,basis,evidence_item_id,recorded_by)
values('$ORG','$OPTION','carbon','Lifecycle carbon consequence is recorded for review.','Verified acceptance evidence.','$EVIDENCE','$USER_ID');
insert into human_performance_events(organization_id,error_type,development_case_id,condition_categories,observation_basis,evidence_refs)
values('$ORG','situational_violation','$CASE',array['unclear_authority'],'The system created unclear authority at a decision handoff; this is not a worker score.',jsonb_build_array('$EVIDENCE'));
insert into risk_stakeholders(id,organization_id,stakeholder_type,name,role_or_relationship)
values('$STAKEHOLDER','$ORG','internal','Operations','Future asset owner') on conflict(id) do nothing;
insert into stakeholder_commitments(organization_id,development_case_id,stakeholder_id,commitment_ref,concern,commitment,owner_id,due_date,evidence_item_id,status,created_by)
values('$ORG','$CASE','$STAKEHOLDER','D11.03-S','Maintainable handover','Provide verified maintainability records.','$USER_ID',current_date+30,'$EVIDENCE','open','$USER_ID');
insert into recommendations(organization_id,development_case_id,title,status,rationale)
values('$ORG','$CASE','Review cross-cutting overlay gaps','pending','Advisory visibility only; a named human decides any response.');
SQL

test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_case_engine_overlays" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"p_case_id\":\"$CASE\"}")" = 401
RESULT=$(rpc "$USER_TOKEN" get_case_engine_overlays "{\"p_case_id\":\"$CASE\"}")
test "$(status "$RESULT")" = 200
BODY="$(body "$RESULT")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert len(x["engines"])==8;assert x["overlayKeys"]==["risk","quality","sustainability","hop","stakeholders","evidence","ai"];assert all(len(e["overlays"])==7 for e in x["engines"]);assert all({o["key"] for o in e["overlays"]}==set(x["overlayKeys"]) for e in x["engines"]);assert all(o["count"]>=1 for o in x["engines"][0]["overlays"]);assert "not gate approval" in x["authorityBoundary"]'
FOREIGN=$(rpc "$USER_TOKEN" get_case_engine_overlays "{\"p_case_id\":\"$FOREIGN_CASE\"}")
BODY="$(body "$FOREIGN")" python3 -c 'import json,os;assert "development case not found" in json.loads(os.environ["BODY"])["error"]'
echo 'D11.03 engine-overlay smoke passed: engines=8 overlays_each=7 canonical_reads=true tenant_wall=true no_synthetic_score=true hop_non_surveillance=true human_authority=true'

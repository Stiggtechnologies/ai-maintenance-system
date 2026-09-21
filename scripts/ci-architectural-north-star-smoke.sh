#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D11.36 architectural north-star smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER='99999999-9999-4999-8999-999999999936'
SOURCE_CASE='91113600-0000-4000-8000-000000000001'
NEXT_CASE='91113600-0000-4000-8000-000000000002'
FOREIGN_CASE='91113600-0000-4000-8000-000000000003'
OBJECTIVE='91113600-0000-4000-8000-000000000004'
ASSET='91113600-0000-4000-8000-000000000005'
EVIDENCE='91113600-0000-4000-8000-000000000006'
SELF_EVIDENCE='91113600-0000-4000-8000-000000000007'
OTHER_EVIDENCE='91113600-0000-4000-8000-000000000008'
ADMIN_ID='00000000-0000-0000-0000-000000000006'
VERIFIER_ID='00000000-0000-0000-0000-000000000001'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'].lower() in x.get('error','').lower(),x"; }
field(){ BODY="$(body "$1")" KEY="$2" python3 -c "import json,os;print(json.loads(os.environ['BODY'])[os.environ['KEY']])"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }

ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$ADMIN"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name) values('$OTHER','D11.36 foreign tenant') on conflict(id) do nothing;
insert into risk_objectives(id,organization_id,owner_id,objective_level,description,target,measurement,timeframe,tolerance,status,adopted_by,adopted_at,created_by)
values('$OBJECTIVE','$ORG','$ADMIN_ID','project','Deliver a maintainable pump train whose evidence survives into the next investment decision.','Commissioned maintainable pump train','Verified operating and outcome evidence','Before handover','No unsupported readiness claim','adopted','$VERIFIER_ID',now(),'$ADMIN_ID') on conflict(id) do nothing;
insert into development_cases(id,organization_id,title,lifecycle_type,problem_statement,status,objective_id,created_by)
values
('$SOURCE_CASE','$ORG','D11.36 completed pump project','brownfield','Prove one governed path from an adopted objective through delivery, operation, outcome and learning.','active','$OBJECTIVE','$ADMIN_ID'),
('$NEXT_CASE','$ORG','D11.36 later pump decision','brownfield','Use verified learning from the completed project in a later canonical decision.','active','$OBJECTIVE','$ADMIN_ID'),
('$FOREIGN_CASE','$OTHER','D11.36 foreign case','brownfield','This case must never be traversable by the source tenant.','active',null,null)
on conflict(id) do nothing;
insert into assets(id,organization_id,tag,asset_tag,name,criticality)
values('$ASSET','$ORG','D11-36-P101','D11-36-P101','D11.36 process pump','high') on conflict(id) do nothing;
insert into development_case_assets(organization_id,development_case_id,asset_id,added_by,note)
values('$ORG','$SOURCE_CASE','$ASSET','$ADMIN_ID','The delivered pump is the source case asset and carries the operational work evidence.') on conflict do nothing;
insert into evidence_items(id,organization_id,development_case_id,asset_id,source_system,evidence_type,description,data_quality,source_reference,evidence_class,verification_status,verified_by,verified_at,verification_method)
values
('$EVIDENCE','$ORG','$SOURCE_CASE','$ASSET','ci','document','Independent completion, startup and outcome record for the D11.36 project.','high','D11.36-CI-001','DOCUMENTED','verified','$VERIFIER_ID',now(),'Independent CI review'),
('$SELF_EVIDENCE','$ORG','$SOURCE_CASE','$ASSET','ci','document','Evidence deliberately self-verified by the relationship recorder.','high','D11.36-CI-SELF','DOCUMENTED','verified','$ADMIN_ID',now(),'Self review fixture'),
('$OTHER_EVIDENCE','$ORG','$SOURCE_CASE','$ASSET','ci','document','Independent evidence that is not the evidence carried by the project outcome.','high','D11.36-CI-OTHER','DOCUMENTED','verified','$VERIFIER_ID',now(),'Independent alternate record')
on conflict(id) do nothing;
insert into risk_context_nodes(organization_id,scope_kind,name,status)
select '$ORG','project','D11.36 project context','adopted' where not exists(select 1 from risk_context_nodes where organization_id='$ORG' and name='D11.36 project context');
insert into risk_criteria_profiles(organization_id,name,status,basis)
select '$ORG','D11.36 criteria','adopted','Controlled architectural traversal fixture criteria.' where not exists(select 1 from risk_criteria_profiles where organization_id='$ORG' and name='D11.36 criteria');
SQL

CTX=$(psqlc "select id from risk_context_nodes where organization_id='$ORG' and name='D11.36 project context'")
CRIT=$(psqlc "select id from risk_criteria_profiles where organization_id='$ORG' and name='D11.36 criteria'")

# Objective → Requirement.
R=$(rpc "$ADMIN" record_case_requirement "{\"p_case_id\":\"$SOURCE_CASE\",\"p_requirement\":{\"requirement_ref\":\"D11-36-R1\",\"category\":\"reliability\",\"requirement\":\"The delivered pump train shall demonstrate stable startup and maintainable seal performance.\",\"owner_id\":\"$ADMIN_ID\"}}")
ok "$R"; REQUIREMENT=$(field "$R" requirement_id)

# Requirement/objective → Risk / opportunity.
R=$(rpc "$ADMIN" create_risk_assessment "{\"p_assessment\":{\"title\":\"D11.36 startup seal exposure\",\"context_id\":\"$CTX\",\"criteria_profile_id\":\"$CRIT\",\"objective_id\":\"$OBJECTIVE\",\"current_risk_level\":\"High\"}}")
ok "$R"; RISK=$(field "$R" risk_id)
R=$(rpc "$ADMIN" bind_risk_to_development_case "{\"p_risk_id\":\"$RISK\",\"p_case_id\":\"$SOURCE_CASE\",\"p_reason\":\"The startup seal exposure belongs to the pump delivery case and its adopted objective.\"}")
ok "$R"

# Risk → Decision, and an earlier decision on the later case that must NOT be
# offered as learning-informed because it predates the lesson.
R=$(rpc "$ADMIN" create_case_decision "{\"p_case_id\":\"$SOURCE_CASE\",\"p_question\":\"Which pump and seal design should deliver the adopted objective?\",\"p_objective_id\":\"$OBJECTIVE\",\"p_owner_id\":\"$ADMIN_ID\"}")
ok "$R"; SOURCE_DECISION=$(field "$R" decision_id)
R=$(rpc "$ADMIN" create_case_decision "{\"p_case_id\":\"$NEXT_CASE\",\"p_question\":\"What work should begin before verified project learning is available?\",\"p_objective_id\":\"$OBJECTIVE\",\"p_owner_id\":\"$ADMIN_ID\"}")
ok "$R"; EARLY_DECISION=$(field "$R" decision_id)

# Decision → Design: register the canonical requirement and a design object,
# then make the directed thread hop rather than copying either object.
R=$(rpc "$ADMIN" register_thread_object "{\"p_case_id\":\"$SOURCE_CASE\",\"p_object\":{\"object_kind\":\"requirement\",\"object_ref\":\"D11-36-R1\",\"title\":\"Stable pump startup requirement\",\"anchor_asset_id\":\"$ASSET\",\"requirement_id\":$REQUIREMENT}}")
ok "$R"; REQUIREMENT_OBJECT=$(field "$R" object_id)
R=$(rpc "$ADMIN" register_thread_object "{\"p_case_id\":\"$SOURCE_CASE\",\"p_object\":{\"object_kind\":\"equipment_specification\",\"object_ref\":\"D11-36-ES1\",\"title\":\"Pump and seal equipment specification\",\"anchor_asset_id\":\"$ASSET\"}}")
ok "$R"; DESIGN_OBJECT=$(field "$R" object_id)
R=$(rpc "$ADMIN" link_thread_objects "{\"p_upstream_id\":$REQUIREMENT_OBJECT,\"p_downstream_id\":$DESIGN_OBJECT,\"p_link_type\":\"specifies\",\"p_basis\":\"The equipment specification implements the stable-startup and seal-performance requirement.\"}")
ok "$R"

# Design → Project work → Asset → Operation.
R=$(rpc "$ADMIN" record_work_package "{\"p_case_id\":\"$SOURCE_CASE\",\"p_package\":{\"package_code\":\"D11-36-E1\",\"title\":\"Pump engineering and commissioning\",\"package_type\":\"engineering\",\"scope\":\"Issue the pump design, complete installation support and capture the operating result.\"}}")
ok "$R"; PACKAGE=$(field "$R" work_package_id)
WORK_ORDER=$(psqlc "with r as (insert into work_orders(organization_id,asset_id,wo_number,title,status,type) values('$ORG','$ASSET','D11-36-W1','Commission and operate D11.36 pump','completed','human_created') returning id) select id from r")
R=$(rpc "$ADMIN" assign_work_to_package "{\"p_package_id\":$PACKAGE,\"p_work_order_id\":\"$WORK_ORDER\",\"p_basis\":\"The completed commissioning and operating work is the execution evidence for this package.\"}")
ok "$R"
R=$(rpc "$ADMIN" link_asset_to_objective "{\"p_case_id\":\"$SOURCE_CASE\",\"p_asset_id\":\"$ASSET\",\"p_objective_id\":\"$OBJECTIVE\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_basis\":\"The commissioned pump is the canonical asset delivered to support the adopted objective.\"}")
ok "$R"

# The source project is now complete; outcome and lesson remain separate
# canonical learning events with their own governance.
psqlc "update development_cases set status='completed' where id='$SOURCE_CASE' and organization_id='$ORG'" >/dev/null
R=$(rpc "$ADMIN" record_verified_project_outcome "{\"p_case_id\":\"$SOURCE_CASE\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_outcome\":{\"baselineCost\":1000000,\"actualCost\":980000,\"baselineDurationDays\":120,\"actualDurationDays\":116,\"currency\":\"CAD\",\"complexityRating\":3,\"geography\":\"Alberta\",\"technologyNoveltyRating\":2,\"executionStrategy\":\"EPCM\",\"engineeringMaturityAtExecutionPct\":88,\"unresolvedVendorDataAtGate\":0,\"commissioningDefects\":1,\"startupDelayDays\":0,\"safetyIncidentRate\":0,\"startupReliabilityPct\":98,\"engineeringHours\":6200}}")
ok "$R"; OUTCOME=$(field "$R" learningEventId)
R=$(rpc "$ADMIN" record_project_lesson "{\"p_case_id\":\"$SOURCE_CASE\",\"p_failure_mode_key\":\"project_delivery.interface_failure\",\"p_title\":\"Startup flushing protects seal life\",\"p_cause\":\"Residual construction solids entered the seal system during the first startup.\",\"p_corrective_action\":\"Require a witnessed flushing hold point before every initial startup.\",\"p_applicability\":\"Future process-water pumps exposed to construction debris and intermittent solids.\",\"p_detail\":\"Verified outcome evidence showed stable operation after the controlled flush.\"}")
ok "$R"; LESSON=$(field "$R" lesson_id)

# Before the later decision is associated, all ten earlier legs are visible and
# completeness is refused with the one precise remaining gap.
READ=$(rpc "$ADMIN" get_case_architectural_north_star "{\"p_case_id\":\"$SOURCE_CASE\"}")
ok "$READ"
BODY="$(body "$READ")" EARLY="$EARLY_DECISION" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["complete"] is False;assert x["gaps"]==["later decision explicitly informed by outcome and learning"],x["gaps"];assert len(x["legs"])==11 and sum(1 for p in x["legs"] if p["complete"])==10;assert all(d["id"]!=os.environ["EARLY"] for d in x["candidateNextDecisions"]);assert x["relationshipCount"]==11'

# The genuine later decision is created after the lesson and becomes the only
# valid candidate. A same-case decision, self-verified evidence and unrelated
# evidence are each refused before the valid named-human association.
R=$(rpc "$ADMIN" create_case_decision "{\"p_case_id\":\"$NEXT_CASE\",\"p_question\":\"Should future pump projects mandate a witnessed pre-start flushing hold point?\",\"p_objective_id\":\"$OBJECTIVE\",\"p_owner_id\":\"$ADMIN_ID\"}")
ok "$R"; NEXT_DECISION=$(field "$R" decision_id)
R=$(rpc "$ADMIN" link_case_learning_to_next_decision "{\"p_case_id\":\"$SOURCE_CASE\",\"p_outcome_event_id\":\"$OUTCOME\",\"p_lesson_event_id\":\"$LESSON\",\"p_next_decision_id\":\"$SOURCE_DECISION\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_basis\":\"A source-case decision cannot masquerade as the next governed decision.\"}")
err "$R" 'later case'
R=$(rpc "$ADMIN" link_case_learning_to_next_decision "{\"p_case_id\":\"$SOURCE_CASE\",\"p_outcome_event_id\":\"$OUTCOME\",\"p_lesson_event_id\":\"$LESSON\",\"p_next_decision_id\":\"$NEXT_DECISION\",\"p_evidence_item_id\":\"$SELF_EVIDENCE\",\"p_basis\":\"Self-verified evidence cannot support a learning-to-decision relationship.\"}")
err "$R" 'independently verified'
R=$(rpc "$ADMIN" link_case_learning_to_next_decision "{\"p_case_id\":\"$SOURCE_CASE\",\"p_outcome_event_id\":\"$OUTCOME\",\"p_lesson_event_id\":\"$LESSON\",\"p_next_decision_id\":\"$NEXT_DECISION\",\"p_evidence_item_id\":\"$OTHER_EVIDENCE\",\"p_basis\":\"An unrelated evidence item cannot replace the verified outcome evidence.\"}")
err "$R" 'evidence carried by the verified project outcome'
R=$(rpc "$ADMIN" link_case_learning_to_next_decision "{\"p_case_id\":\"$SOURCE_CASE\",\"p_outcome_event_id\":\"$OUTCOME\",\"p_lesson_event_id\":\"$LESSON\",\"p_next_decision_id\":\"$NEXT_DECISION\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_basis\":\"The verified outcome and recorded lesson are explicit evidence for the later flushing decision.\"}")
ok "$R"; LINK=$(field "$R" linkId)

READ=$(rpc "$ADMIN" get_case_architectural_north_star "{\"p_case_id\":\"$SOURCE_CASE\"}")
ok "$READ"
BODY="$(body "$READ")" NEXT="$NEXT_DECISION" LINK="$LINK" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["complete"] is True and x["gaps"]==[];assert len(x["legs"])==11 and all(p["complete"] for p in x["legs"]);assert len(x["learningDecisionLinks"])==1 and x["learningDecisionLinks"][0]["id"]==os.environ["LINK"];assert all(d["id"]!=os.environ["NEXT"] for d in x["candidateNextDecisions"]);assert len(x["canonicalGraph"])==19;assert "named-human" in x["decisionBoundary"]'

# Tenant wall, unauthenticated wall, immutability and audit provenance.
R=$(rpc "$ADMIN" get_case_architectural_north_star "{\"p_case_id\":\"$FOREIGN_CASE\"}")
err "$R" 'not found'
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_case_architectural_north_star" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"p_case_id\":\"$SOURCE_CASE\"}")" = 401
UPDATE_OUT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "update decision_learning_event_links set basis='A direct rewrite must be refused even when the replacement text is substantive.' where id='$LINK'" 2>&1 || true)
printf '%s' "$UPDATE_OUT" | grep -q 'immutable'
DELETE_OUT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "delete from decision_learning_event_links where id='$LINK'" 2>&1 || true)
printf '%s' "$DELETE_OUT" | grep -q 'cannot be deleted directly'
COUNTS=$(psqlc "select (select count(*) from decision_learning_event_links where id='$LINK'),(select count(*) from audit_events where organization_id='$ORG' and entity_type='learning_informs_next_decision' and event_data->>'link_id'='$LINK')")
test "$COUNTS" = '1|1'

echo 'D11.36 architectural north-star smoke passed: eleven_legs=true canonical_stores=true incomplete_refused=true later_decision=true candidate_time_filter=true independent_evidence=true exact_outcome_evidence=true immutable=true tenant_wall=true named_human=true no_authority=true'

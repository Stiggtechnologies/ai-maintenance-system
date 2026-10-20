#!/usr/bin/env bash
# E6.05 / E6.08 / E6.09 / E6.11 / E6.12 — live execution-governance transcript.
set -euo pipefail
trap 'echo "Workforce-execution governance smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
FOREIGN_ORG='e6051200-0000-4000-8000-000000000001'
FOREIGN_UID='e6051200-0000-4000-8000-000000000002'
EVIDENCE='e6051200-0000-4000-8000-000000000003'
RUN_KEY="wfx-$(date +%s)-$$"

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; v=json.loads(os.environ['BODY']).get(os.environ['KEY']); print('' if v is None else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); bad=isinstance(x,dict) and (x.get('answered') is False or x.get('error')); sys.exit(1) if bad else None"; }
expect_refusal(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('refusal') or x.get('error') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected refusal',os.environ['WANT'],'got',x) or sys.exit(1))"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$MANAGER"; test -n "$ADMIN"

# Independent second tenant for explicit identifier-wall negatives.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
begin
  insert into organizations(id,name) values('e6051200-0000-4000-8000-000000000001','E6 execution foreign tenant')
    on conflict(id) do nothing;
  if not exists(select 1 from auth.users where email='wfx-foreign@syncai.ca') then
    insert into auth.users(
      instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
      confirmation_token,recovery_token,email_change,email_change_token_new,
      email_change_token_current,phone_change,phone_change_token,reauthentication_token
    ) values(
      '00000000-0000-0000-0000-000000000000','e6051200-0000-4000-8000-000000000002',
      'authenticated','authenticated','wfx-foreign@syncai.ca',
      extensions.crypt('ForeignExec123!@#',extensions.gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{"full_name":"E6 execution foreign manager"}',
      '','','','','','','',''
    );
  end if;
  if not exists(select 1 from auth.identities where user_id='e6051200-0000-4000-8000-000000000002') then
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
    values(gen_random_uuid(),'e6051200-0000-4000-8000-000000000002',
      'e6051200-0000-4000-8000-000000000002',
      '{"sub":"e6051200-0000-4000-8000-000000000002","email":"wfx-foreign@syncai.ca"}',
      'email',now(),now(),now());
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values('e6051200-0000-4000-8000-000000000002','e6051200-0000-4000-8000-000000000001',
    'wfx-foreign@syncai.ca','E6 execution foreign manager','maintenance_manager')
  on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role;
end $seed$;
PSQL
FOREIGN=$(token 'wfx-foreign@syncai.ca' 'ForeignExec123!@#')
test -n "$FOREIGN"

# Canonical verified evidence fixture: authored source and independent human review.
psqlc "insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class,source_reference) values('$EVIDENCE','$ORG','ci-workforce-execution','controlled_document','Verified crew, tool, knowledge and procedure source package.','DOCUMENTED','$RUN_KEY') on conflict(id) do nothing" >/dev/null
VERIFIED=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent workforce source and applicability review\",\"p_outcome\":\"verified\",\"p_note\":\"Crew analysis, tool count, knowledge assessment and controlled procedure revision were independently checked.\"}")
noerr "$VERIFIED"

SITE=$(psqlc "select id from sites where organization_id='$ORG' order by created_at,id limit 1")
FUTURE=$(psqlc "select (current_date+45)::text")
test -n "$SITE"
COMPETENCY_RESULT=$(rpc "$MANAGER" record_competency "{\"p_payload\":{\"competencyKey\":\"$RUN_KEY\",\"title\":\"Governed execution competency\",\"kind\":\"skill\",\"isStatutory\":false}}")
noerr "$COMPETENCY_RESULT"; COMPETENCY=$(field "$COMPETENCY_RESULT" competencyId)
MEMBER_RESULT=$(rpc "$MANAGER" record_workforce_member "{\"p_payload\":{\"employeeRef\":\"$RUN_KEY\",\"displayName\":\"Execution Governance Technician\",\"craft\":\"Millwright\",\"employmentType\":\"employee\",\"fte\":\"1\",\"siteId\":\"$SITE\"}}")
noerr "$MEMBER_RESULT"; MEMBER=$(field "$MEMBER_RESULT" memberId)
test -n "$COMPETENCY"; test -n "$MEMBER"

# Versioned crew composition with exact canonical competency reference.
CREW1=$(rpc "$MANAGER" record_crew_template "{\"p_payload\":{\"templateKey\":\"$RUN_KEY-crew\",\"title\":\"Governed execution crew\",\"description\":\"Evidence-backed minimum crew for the governed task.\",\"basis\":\"Approved task analysis defines the minimum crew composition.\",\"evidenceItemId\":\"$EVIDENCE\",\"roles\":[{\"roleLabel\":\"Lead millwright\",\"craft\":\"Millwright\",\"headcount\":2,\"requiredCompetencyId\":\"$COMPETENCY\",\"isMandatory\":true}]}}")
noerr "$CREW1"; CREW1_ID=$(field "$CREW1" crewTemplateId); test "$(field "$CREW1" version)" = '1'
CREW2=$(rpc "$MANAGER" record_crew_template "{\"p_payload\":{\"templateKey\":\"$RUN_KEY-crew\",\"title\":\"Governed execution crew revision\",\"description\":\"Retained replacement after the approved task review.\",\"basis\":\"Updated task analysis added a mandatory safety attendant role.\",\"evidenceItemId\":\"$EVIDENCE\",\"roles\":[{\"roleLabel\":\"Lead millwright\",\"craft\":\"Millwright\",\"headcount\":2,\"requiredCompetencyId\":\"$COMPETENCY\",\"isMandatory\":true},{\"roleLabel\":\"Safety attendant\",\"headcount\":1,\"isMandatory\":true}]}}")
noerr "$CREW2"; CREW2_ID=$(field "$CREW2" crewTemplateId); test "$(field "$CREW2" version)" = '2'
test "$(psqlc "select count(*) from crew_templates where id=$CREW1_ID and not active")" = '1'
test "$(psqlc "select count(*) from crew_templates where id=$CREW2_ID and active")" = '1'

# Versioned tool availability records observed quantity; it never grants authorization.
TOOL1=$(rpc "$MANAGER" record_specialised_tool "{\"p_payload\":{\"toolKey\":\"$RUN_KEY-tool\",\"title\":\"Hydraulic bolt tensioner\",\"quantityAvailable\":\"1\",\"requiredCompetencyId\":\"$COMPETENCY\",\"leadTimeDays\":\"14\",\"ownedBy\":\"Central tool crib\",\"basis\":\"Verified tool crib count and current calibration record.\",\"evidenceItemId\":\"$EVIDENCE\"}}")
noerr "$TOOL1"; TOOL1_ID=$(field "$TOOL1" toolId)
TOOL2=$(rpc "$MANAGER" record_specialised_tool "{\"p_payload\":{\"toolKey\":\"$RUN_KEY-tool\",\"title\":\"Hydraulic bolt tensioner\",\"quantityAvailable\":\"2\",\"requiredCompetencyId\":\"$COMPETENCY\",\"leadTimeDays\":\"14\",\"ownedBy\":\"Central tool crib\",\"basis\":\"Verified receipt and tool crib count establish two available units.\",\"evidenceItemId\":\"$EVIDENCE\"}}")
noerr "$TOOL2"; TOOL2_ID=$(field "$TOOL2" toolId); test "$(field "$TOOL2" version)" = '2'
test "$(psqlc "select count(*) from specialised_tools where id=$TOOL1_ID and not active")" = '1'
test "$(psqlc "select count(*) from specialised_tools where id=$TOOL2_ID and active and quantity_available=2")" = '1'

# Critical knowledge uses optimistic updates, explicit holders and a correlated canonical plan.
AREA1=$(rpc "$MANAGER" record_knowledge_area "{\"p_payload\":{\"areaKey\":\"$RUN_KEY-knowledge\",\"title\":\"Compressor trip recovery\",\"consequenceIfLost\":\"The train cannot be restarted safely after an unplanned trip.\",\"criticality\":\"critical\",\"documentedWhere\":\"OPS-TRIP-RECOVERY\",\"basis\":\"Verified operating procedure and field assessment define this knowledge.\",\"evidenceItemId\":\"$EVIDENCE\"}}")
noerr "$AREA1"; AREA=$(field "$AREA1" knowledgeAreaId); test "$(field "$AREA1" version)" = '1'
STALE=$(rpc "$MANAGER" record_knowledge_area "{\"p_payload\":{\"areaKey\":\"$RUN_KEY-knowledge\",\"title\":\"Compressor trip recovery\",\"consequenceIfLost\":\"The train cannot be restarted safely after an unplanned trip.\",\"criticality\":\"critical\",\"basis\":\"A stale reviewed copy must not replace the current definition.\",\"evidenceItemId\":\"$EVIDENCE\",\"expectedVersion\":0}}")
expect_refusal "$STALE" 'changed after review'
AREA2=$(rpc "$MANAGER" record_knowledge_area "{\"p_payload\":{\"areaKey\":\"$RUN_KEY-knowledge\",\"title\":\"Compressor trip and black-start recovery\",\"consequenceIfLost\":\"The train cannot be restarted safely after a trip or site blackout.\",\"criticality\":\"critical\",\"documentedWhere\":\"OPS-TRIP-RECOVERY-R2\",\"basis\":\"Annual review added the approved black-start recovery sequence.\",\"evidenceItemId\":\"$EVIDENCE\",\"expectedVersion\":1}}")
noerr "$AREA2"; test "$(field "$AREA2" version)" = '2'
HOLDER=$(rpc "$MANAGER" record_knowledge_holder "{\"p_area_id\":$AREA,\"p_member_id\":$MEMBER,\"p_action\":\"assign\",\"p_depth\":\"expert\",\"p_basis\":\"Observed field execution and approved supervisor assessment.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
noerr "$HOLDER"
PLAN=$(rpc "$MANAGER" record_knowledge_transfer_plan "{\"p_payload\":{\"knowledgeAreaId\":\"$AREA\",\"memberId\":\"$MEMBER\",\"competencyId\":\"$COMPETENCY\",\"planKind\":\"succession\",\"targetDate\":\"$FUTURE\",\"driver\":\"Named critical-knowledge exposure requires a verified transfer plan.\"}}")
noerr "$PLAN"; PLAN_ID=$(field "$PLAN" trainingPlanId); test "$(field "$PLAN" competencyGranted)" = 'False'
test "$(psqlc "select count(*) from training_plans where id=$PLAN_ID and knowledge_area_id=$AREA and status='planned'")" = '1'
RISK=$(rpc "$MANAGER" get_knowledge_risk '{}')
BODY="$RISK" AREA="$AREA" python3 -c "import json,os; x=json.loads(os.environ['BODY']); row=next(r for r in x if str(r['area_id'])==os.environ['AREA']); assert row['has_succession_plan'] is True,row"
HOLDER_END=$(rpc "$MANAGER" record_knowledge_holder "{\"p_area_id\":$AREA,\"p_member_id\":$MEMBER,\"p_action\":\"end\",\"p_depth\":\"aware\",\"p_basis\":\"Named-human review confirms this holder assignment has ended.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
noerr "$HOLDER_END"
test "$(psqlc "select count(*) from knowledge_holders where area_id=$AREA and member_id=$MEMBER and not active and depth='expert' and ended_by is not null and ended_at is not null")" = '1'

# Existing controlled content may carry multiple named-human verified languages.
STD_KEY="$RUN_KEY-standard"
STD_EN=$(rpc "$MANAGER" register_standard_work_baseline "{\"p_work_key\":\"$STD_KEY\",\"p_title\":\"Compressor controlled startup\",\"p_language\":\"en-CA\",\"p_content\":\"Existing controlled English startup procedure content.\",\"p_basis\":\"Controlled revision verified by the procedure owner.\",\"p_evidence_id\":\"$EVIDENCE\"}")
noerr "$STD_EN"; STANDARD=$(field "$STD_EN" standardWorkId)
STD_FR=$(rpc "$MANAGER" register_standard_work_baseline "{\"p_work_key\":\"$STD_KEY\",\"p_title\":\"Compressor controlled startup\",\"p_language\":\"fr-CA\",\"p_content\":\"Contenu français existant de la procédure contrôlée.\",\"p_basis\":\"Controlled translation revision verified by the procedure owner.\",\"p_evidence_id\":\"$EVIDENCE\"}")
noerr "$STD_FR"; test "$(field "$STD_FR" standardWorkId)" = "$STANDARD"
test "$(psqlc "select count(*) from procedure_translations where standard_work_id=$STANDARD and translation_status='human_verified' and verified_by is not null")" = '2'
DUPLICATE_LANGUAGE=$(rpc "$MANAGER" register_standard_work_baseline "{\"p_work_key\":\"$STD_KEY\",\"p_title\":\"Compressor controlled startup\",\"p_language\":\"fr-CA\",\"p_content\":\"Overwrite attempt.\",\"p_basis\":\"Existing content cannot be silently overwritten by another registration.\",\"p_evidence_id\":\"$EVIDENCE\"}")
expect_refusal "$DUPLICATE_LANGUAGE" 'cannot overwrite'

# Explicit tenant walls and direct mutation guards.
CROSS_HOLDER=$(rpc "$FOREIGN" record_knowledge_holder "{\"p_area_id\":$AREA,\"p_member_id\":$MEMBER,\"p_action\":\"assign\",\"p_depth\":\"expert\",\"p_basis\":\"A foreign tenant cannot assign another tenant knowledge holder.\",\"p_evidence_item_id\":\"$EVIDENCE\"}")
expect_refusal "$CROSS_HOLDER" 'knowledge area not found'
CROSS_TOOL=$(rpc "$FOREIGN" record_specialised_tool "{\"p_payload\":{\"toolKey\":\"foreign-tool\",\"title\":\"Foreign tool attempt\",\"quantityAvailable\":\"1\",\"requiredCompetencyId\":\"$COMPETENCY\",\"basis\":\"A foreign tenant cannot reuse another tenant competency identity.\",\"evidenceItemId\":\"$EVIDENCE\"}}")
expect_refusal "$CROSS_TOOL" 'verified evidence'
FOREIGN_WORKSPACE=$(rpc "$FOREIGN" get_workforce_execution_workspace '{}')
BODY="$FOREIGN_WORKSPACE" CREW="$CREW2_ID" TOOL="$TOOL2_ID" AREA="$AREA" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('answered'); assert all(str(v.get('id'))!=os.environ['CREW'] for v in x['crewTemplates']); assert all(str(v.get('id'))!=os.environ['TOOL'] for v in x['tools']); assert all(str(v.get('id'))!=os.environ['AREA'] for v in x['knowledgeAreas'])"
OUT=$(sql_must_fail "update crew_templates set title='bypass' where id=$CREW2_ID;"); grep -qi 'governed named-human workflow' <<<"$OUT"
OUT=$(sql_must_fail "delete from specialised_tools where id=$TOOL2_ID;"); grep -qi 'cannot be deleted' <<<"$OUT"
OUT=$(sql_must_fail "update knowledge_areas set title='bypass' where id=$AREA;"); grep -qi 'governed named-human workflow' <<<"$OUT"

WORKSPACE=$(rpc "$MANAGER" get_workforce_execution_workspace '{}')
BODY="$WORKSPACE" CREW="$CREW2_ID" TOOL="$TOOL2_ID" AREA="$AREA" STANDARD="$STANDARD" python3 -c "import json,os; x=json.loads(os.environ['BODY']); assert x.get('answered'); assert any(str(v.get('id'))==os.environ['CREW'] and v.get('active') for v in x['crewTemplates']); assert any(str(v.get('id'))==os.environ['TOOL'] and v.get('active') for v in x['tools']); assert any(str(v.get('id'))==os.environ['AREA'] for v in x['knowledgeAreas']); assert any(str(v.get('id'))==os.environ['STANDARD'] and len(v.get('procedures',[]))==2 for v in x['standards'])"
NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_workforce_execution_workspace" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('crew_template','specialised_tool','knowledge_area','knowledge_holder','knowledge_transfer_plan') and event_data->>'humanRecorded'='true'")" -ge 8

echo 'Workforce-execution governance smoke passed: crew=versioned tools=versioned knowledge=correlated standards=multilingual tenant-wall=true immutable=true'

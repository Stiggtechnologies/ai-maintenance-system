#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U19 model-applicability smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'; OTHER_ORG='99999999-9999-9999-9999-999999999919'; EVIDENCE='98190000-0000-4000-8000-000000000001'
MECH_STARTUP='fixture_a'
MECH_CONTINUOUS='fixture_b'
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }; status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }
AUTHOR=$(token 'demo@syncai.ca' 'Demo123!@#'); ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#'); test -n "$AUTHOR" && test -n "$ADMIN"
read -r AUTHOR_ID ADMIN_ID ASSET_ID <<<"$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F ' ' -v ON_ERROR_STOP=1 -c "select (select id from user_profiles where organization_id='$ORG' and email='demo@syncai.ca'),(select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'),(select id from assets where organization_id='$ORG' order by created_at limit 1)")"
test -n "$AUTHOR_ID" && test -n "$ADMIN_ID" && test -n "$ASSET_ID"
MODEL_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','U19 foreign','utilities') on conflict(id) do nothing;
insert into damage_mechanisms(organization_id,mechanism_key,name,description) values
('$ORG','$MECH_STARTUP','U19 startup fixture','Deterministic U19 acceptance fixture for startup duty.'),
('$ORG','$MECH_CONTINUOUS','U19 continuous fixture','Deterministic U19 acceptance fixture for continuous duty.')
on conflict(organization_id,mechanism_key) do update set description=excluded.description;
insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,description,evidence_class) values('$EVIDENCE','$ORG','$ASSET_ID','ci','calculation','Verified applicability and data-quality basis','CALCULATED') on conflict(id) do nothing;
insert into model_register(organization_id,model_key,version,model_kind,purpose,human_in_loop,is_engineering_model,lifecycle_state,production_eligible,manifest,manifest_checksum,applicability_envelope,verification_contract,required_reviewer_role_key,source_rights_confirmed,runtime_mode,calculation_key,author_id)
values('$ORG','ci.u19.applicability','1.0.0','deterministic_physics','U19 acceptance model',true,true,'engineering_approved',false,'{}',repeat('0',64),'{"assetFamilies":["pump"]}','{}','model_reviewer_vibration_and_rotordynamics',true,'allowlisted_deterministic','ci_u19_calculation','$AUTHOR_ID') returning id;
SQL
); test -n "$MODEL_ID"
FOREIGN_MODEL_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into model_register(organization_id,model_key,version,model_kind,purpose,human_in_loop,is_engineering_model,lifecycle_state,production_eligible,manifest,manifest_checksum,applicability_envelope,verification_contract,required_reviewer_role_key,source_rights_confirmed,runtime_mode,calculation_key)
values('$OTHER_ORG','ci.u19.foreign','1.0.0','deterministic_physics','Foreign-tenant U19 acceptance model',true,true,'engineering_approved',false,'{}',repeat('2',64),'{"assetFamilies":["pump"]}','{}','model_reviewer_vibration_and_rotordynamics',true,'allowlisted_deterministic','ci_u19_foreign_calculation') returning id;
SQL
); test -n "$FOREIGN_MODEL_ID"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
delete from user_role_assignments a using roles r
where a.role_id=r.id and a.organization_id='$ORG' and a.user_id='$ADMIN_ID'
  and r.organization_id='$ORG' and r.key='model_reviewer_vibration_and_rotordynamics';
SQL
NO_COMPETENCY=$(rpc "$ADMIN" review_engineering_model_applicability "{\"p_model_register_id\":$MODEL_ID,\"p_decision\":\"approved\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_review_note\":\"Reviewers without the model-specific competency assignment must be refused.\"}"); err "$NO_COMPETENCY" 'assigned competency role'
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into user_role_assignments(organization_id,user_id,role_id)
select '$ORG','$ADMIN_ID',id from roles r where r.organization_id='$ORG' and r.key='model_reviewer_vibration_and_rotordynamics'
and not exists(select 1 from user_role_assignments a where a.organization_id='$ORG' and a.user_id='$ADMIN_ID' and a.role_id=r.id);
SQL
VERIFY=$(rpc "$ADMIN" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent U19 envelope evidence review\",\"p_outcome\":\"verified\",\"p_note\":\"Evidence is fit for U19 applicability acceptance.\"}"); ok "$VERIFY"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into engineering_model_evidence_bindings(organization_id,model_register_id,evidence_item_id,requirement_key,purpose,evidence_grade,source_rights,bound_by) values('$ORG',$MODEL_ID,'$EVIDENCE','u19-applicability','applicability','A','CI-owned acceptance evidence','$AUTHOR_ID');
insert into engineering_model_mechanisms(organization_id,model_register_id,mechanism_id) select '$ORG',$MODEL_ID,id from damage_mechanisms where organization_id='$ORG' and mechanism_key in ('$MECH_STARTUP','$MECH_CONTINUOUS');
SQL
INCOMPLETE=$(rpc "$ADMIN" review_engineering_model_applicability "{\"p_model_register_id\":$MODEL_ID,\"p_decision\":\"approved\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_review_note\":\"Incomplete envelopes must be refused by the independent review gate.\"}"); err "$INCOMPLETE" 'incomplete'
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
update model_register set manifest_checksum=repeat('1',64), applicability_envelope=jsonb_build_object('assetTypes',jsonb_build_array((select asset_class from assets where id='$ASSET_ID')),'assetFamilies',jsonb_build_array('pump'),'makeModel',jsonb_build_object('mode','manufacturer_neutral','basis','The deterministic method uses measured physical inputs rather than an OEM curve.'),'mechanismScope',jsonb_build_object('mode','canonical_model_bindings','basis','Mechanisms resolve from canonical bindings for this exact model version.'),'dutyClasses',jsonb_build_array('continuous_steady'),'environmentClasses',jsonb_build_array('indoor_industrial'),'componentCategories',jsonb_build_array('shaft'),'operatingStates',jsonb_build_array('running_steady'),'rules',jsonb_build_array(jsonb_build_object('inputCode','rpm','description','positive speed','range',jsonb_build_object('min',0),'evidenceRequired',true)),'excludedConditionCodes','[]'::jsonb,'configurationBaselineRequired',false,'measurementQualityRequired',true,'maximumMissingFraction',0.05,'dataQuality',jsonb_build_object('minimumState','fit_for_use','verifiedEvidenceRequired',true,'maximumMissingFraction',0.05),'trainingPopulation',jsonb_build_object('status','not_applicable_deterministic','basis','This deterministic method has no trained statistical population.'),'validationPeriod',jsonb_build_object('validFrom',current_date::text,'validThrough',(current_date+365)::text,'revalidationTriggers',jsonb_build_array('manifest change','contradictory field outcome')),'limitations',jsonb_build_array('Screening only; no operating or maintenance authority is granted.')) where id=$MODEL_ID;
do \$\$ begin begin update model_register set production_eligible=true,lifecycle_state='production_eligible' where id=$MODEL_ID; raise exception 'eligibility was incorrectly allowed'; exception when others then if sqlerrm not like '%current independently approved applicability envelope%' then raise; end if; end; end \$\$;
SQL
SELF=$(rpc "$AUTHOR" review_engineering_model_applicability "{\"p_model_register_id\":$MODEL_ID,\"p_decision\":\"approved\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_review_note\":\"The author must not approve the envelope they authored.\"}"); err "$SELF" 'author cannot independently review'
FOREIGN=$(rpc "$ADMIN" review_engineering_model_applicability "{\"p_model_register_id\":$FOREIGN_MODEL_ID,\"p_decision\":\"approved\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_review_note\":\"A real foreign-tenant model identity must refuse closed.\"}"); err "$FOREIGN" 'not found in this organization'
APPROVED=$(rpc "$ADMIN" review_engineering_model_applicability "{\"p_model_register_id\":$MODEL_ID,\"p_decision\":\"approved\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_review_note\":\"Independent review confirms every declared applicability dimension and limitation.\"}"); ok "$APPROVED"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
update model_register set production_eligible=true,lifecycle_state='production_eligible',approved_on=current_date,approved_by='$ADMIN_ID' where id=$MODEL_ID;
insert into calculation_runs(organization_id,calculation_key,method,code_version,inputs,outputs,refusals,status,computed_by,model_register_id,asset_id) values('$ORG','ci_u19_calculation','U19 context enforcement harness','1.0.0',jsonb_build_object('context',jsonb_build_object('mechanismKey','$MECH_STARTUP','dutyClass','startup_transient','environmentClasses',jsonb_build_array('indoor_industrial'),'dataQuality',jsonb_build_object('state','fit_for_use','evidenceItemId','$EVIDENCE'))),'{}','[]','computed','$AUTHOR_ID',$MODEL_ID,'$ASSET_ID');
insert into calculation_runs(organization_id,calculation_key,method,code_version,inputs,outputs,refusals,status,computed_by,model_register_id,asset_id) values('$ORG','ci_u19_calculation','U19 context enforcement harness','1.0.0',jsonb_build_object('context',jsonb_build_object('mechanismKey','$MECH_CONTINUOUS','dutyClass','continuous_steady','environmentClasses',jsonb_build_array('indoor_industrial'),'dataQuality',jsonb_build_object('state','fit_for_use','evidenceItemId','$EVIDENCE'))),'{}','[]','computed','$AUTHOR_ID',$MODEL_ID,'$ASSET_ID');
SQL
WORKSPACE=$(rpc "$ADMIN" get_engineering_model_applicability_workspace '{}'); ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" MODEL_ID="$MODEL_ID" python3 -c "import json,os;x=json.loads(os.environ['BODY']);m=next(y for y in x['models'] if str(y['modelRegisterId'])==os.environ['MODEL_ID']);assert len(x['dimensions'])==10;assert m['reviewStatus']=='approved';assert m['gaps']==[];assert m['operationalAuthorization'] is False"
COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
select count(*) filter(where status='refused' and refusals @> '[{"code":"duty_outside_envelope"}]'),count(*) filter(where status='computed'),(select count(*) from approvals where model_register_id=$MODEL_ID and approval_scope->>'kind'='applicability_envelope'),(select count(*) from audit_events where organization_id='$ORG' and entity_type='engineering_model_applicability_review') from calculation_runs where model_register_id=$MODEL_ID;
SQL
)
test "$COUNTS" = '1|1|1|1' || { echo "U19 envelope counts expected 1|1|1|1 (duty_refuse|computed|approval|audit), got $COUNTS"; exit 1; }
echo 'U19 model-applicability smoke passed: dimensions=10 tenant_wall=true author_separation=true evidence_bound=true eligibility_gate=true context_refusal=true authority_unchanged=true'

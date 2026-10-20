#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U14.01 degradation-library smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
EVIDENCE='a1410000-0000-4000-8000-000000000001'
UNVERIFIED='a1410000-0000-4000-8000-000000000002'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

AUTHOR=$(token 'admin@syncai.ca' 'Admin123!@#')
REVIEWER=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$AUTHOR" && test -n "$REVIEWER"
read -r AUTHOR_ID REVIEWER_ID VERIFIER_ID <<<"$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F ' ' -v ON_ERROR_STOP=1 -c "select (select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'),(select id from user_profiles where organization_id='$ORG' and email='demo@syncai.ca'),(select id from user_profiles where organization_id='$ORG' and email='executive@syncai.ca')")"
test -n "$AUTHOR_ID" && test -n "$REVIEWER_ID" && test -n "$VERIFIER_ID"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method,quality_grade)
values
('$EVIDENCE','$ORG','ci','document','Independent U14 corrosion profile source and applicability evidence.','DOCUMENTED','verified','$VERIFIER_ID',now(),'Independent degradation-profile evidence review','high'),
('$UNVERIFIED','$ORG','ci','document','Unverified U14 source material must not support a governed revision.','DOCUMENTED','unverified',null,null,null,'moderate')
on conflict(id) do nothing;
SQL

WORKSPACE=$(rpc "$AUTHOR" get_degradation_library_workspace '{}')
ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['coverage']=={'requiredFamilies':16,'representedFamilies':16,'approvedFamilies':0,'familiesWithLinkedModels':0},x['coverage'];assert len(x['families'])==16;assert {f['familyKey'] for f in x['families']}=={'corrosion','fatigue','creep','erosion','wear','embrittlement','chemical','concrete','timber','insulation_ageing','battery','cable','semiconductor','lubricant','coating','soil_foundation'};assert all(f['operationalAuthorization'] is False for f in x['families']);assert 'no engineering limit' in x['boundary']"

payload(){ EVIDENCE_ID="$1" python3 -c 'import json,os;print(json.dumps({"p_family_key":"corrosion","p_title":"Site corrosion evidence profile","p_description":"Site-specific corrosion profile bounded to the verified inspection and environment evidence.","p_stressor_requirements":["material identity and environment chemistry","temperature and exposure history"],"p_damage_state_requirements":["mapped thickness and localized damage state","measurement uncertainty and baseline"],"p_observation_requirements":["traceable inspection method and coverage","dated comparable measurement locations"],"p_candidate_model_kinds":["standards_method","deterministic_physics"],"p_applicability_questions":["Is the evidenced corrosion mechanism applicable?","Are material, environment and coverage controlled?"],"p_limitations":"This profile supplies no corrosion rate, retirement thickness, remaining life or inspection interval.","p_evidence_item_id":os.environ["EVIDENCE_ID"]}))'; }

UNVERIFIED_RESULT=$(rpc "$AUTHOR" propose_degradation_profile_revision "$(payload "$UNVERIFIED")")
err "$UNVERIFIED_RESULT" 'same-tenant verified source evidence is required'
PROPOSED=$(rpc "$AUTHOR" propose_degradation_profile_revision "$(payload "$EVIDENCE")")
ok "$PROPOSED"
PROFILE_ID=$(BODY="$(body "$PROPOSED")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['familyKey']=='corrosion' and x['version']==2 and x['status']=='pending_review' and x['operationalAuthorization'] is False;print(x['profileId'])")

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  begin
    update degradation_profiles set title='Owner-mutated pending profile' where id='$PROFILE_ID';
    raise exception 'pending profile owner mutation was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%pending degradation profiles move only through independent review%' then raise; end if;
  end;
end \$\$;
SQL

SELF=$(rpc "$AUTHOR" review_degradation_profile "{\"p_profile_id\":\"$PROFILE_ID\",\"p_decision\":\"approved\",\"p_review_note\":\"The author must never approve their own degradation profile revision.\"}")
err "$SELF" 'profile author cannot independently review'
APPROVED=$(rpc "$REVIEWER" review_degradation_profile "{\"p_profile_id\":\"$PROFILE_ID\",\"p_decision\":\"approved\",\"p_review_note\":\"Independent engineering review confirms the exact evidence profile is bounded and suitable.\"}")
ok "$APPROVED"

MODEL_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into model_register(organization_id,model_key,version,model_kind,purpose,human_in_loop,
  is_engineering_model,lifecycle_state,production_eligible,manifest,manifest_checksum,
  applicability_envelope,verification_contract,required_reviewer_role_key,
  source_rights_confirmed,runtime_mode,calculation_key,author_id,limitations,
  training_data,validation_summary,applicability_summary,approval_status,submitted_by,submitted_at)
values('$ORG','ci.u14.corrosion','1.0.0','standards_method',
  'U14 exact-version corrosion assessment integration fixture.',true,true,'draft',false,'{}',repeat('4',64),
  '{}','{}','reliability_engineer',true,'allowlisted_deterministic','ci_u14_corrosion',
  '$AUTHOR_ID','Acceptance fixture only; no engineering limit or operational authorization.',
  '{"status":"not_applicable","basis":"Standards method; no trained population."}',
  '{"status":"recorded","basis":"U14 integration contract only."}',
  '{"status":"recorded","basis":"Bound to the canonical corrosion mechanism."}',
  'pending_review','$AUTHOR_ID',now()) returning id;
SQL
)
test -n "$MODEL_ID"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "insert into engineering_model_mechanisms(organization_id,model_register_id,mechanism_id) select '$ORG',$MODEL_ID,id from damage_mechanisms where organization_id='$ORG' and degradation_family_key='corrosion';" >/dev/null

FINAL=$(rpc "$REVIEWER" get_degradation_library_workspace '{}')
ok "$FINAL"
BODY="$(body "$FINAL")" PROFILE_ID="$PROFILE_ID" MODEL_ID="$MODEL_ID" python3 -c "import json,os;x=json.loads(os.environ['BODY']);c=next(f for f in x['families'] if f['familyKey']=='corrosion');assert c['profileId']==os.environ['PROFILE_ID'] and c['status']=='approved' and c['sourceEvidenceItemId']=='$EVIDENCE';assert [str(m['modelRegisterId']) for m in c['linkedModels']]==[os.environ['MODEL_ID']];assert x['coverage']['approvedFamilies']==1 and x['coverage']['familiesWithLinkedModels']==1"

FUTURE_ORG=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select (provision_organization('U14 future tenant','$ORG'::uuid)->>'organization_id');")
test -n "$FUTURE_ORG"
FUTURE_COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(*) from damage_mechanisms where organization_id='$FUTURE_ORG' and degradation_family_key is not null),(select count(*) from degradation_profiles where organization_id='$FUTURE_ORG' and status='reference_draft');")
test "$FUTURE_COUNTS" = '16|16'

PRIVILEGES=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select has_table_privilege('service_role','public.degradation_profiles','INSERT'),has_table_privilege('service_role','public.degradation_profiles','UPDATE'),has_table_privilege('service_role','public.degradation_profiles','DELETE'),has_table_privilege('service_role','public.degradation_profiles','TRUNCATE');")
test "$PRIVILEGES" = 'f|f|f|f'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  begin
    update degradation_profiles set limitations='silently changed' where id='$PROFILE_ID';
    raise exception 'approved profile mutation was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%approved degradation profiles may only be superseded intact%' then raise; end if;
  end;
  begin
    update degradation_profiles set created_at=created_at+interval '1 second' where id='$PROFILE_ID';
    raise exception 'approved profile metadata mutation was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%approved degradation profiles may only be superseded intact%' then raise; end if;
  end;
  begin
    update degradation_profiles set status='superseded' where id='$PROFILE_ID';
    raise exception 'approved profile owner supersession was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%approved degradation profiles may only be superseded intact%' then raise; end if;
  end;
  begin
    truncate table degradation_profiles;
    raise exception 'degradation profile truncate was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%truncate refused%' then raise; end if;
  end;
end \$\$;
SQL

COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(*) from degradation_profiles where organization_id='$ORG' and id='$PROFILE_ID' and status='approved' and reviewed_by='$REVIEWER_ID' and source_evidence_item_id='$EVIDENCE' and not operational_authorization),(select count(*) from approvals where organization_id='$ORG' and approver_user_id='$REVIEWER_ID' and approval_scope->>'kind'='degradation_profile' and approval_scope->>'operationalAuthorization'='false'),(select count(*) from audit_events where organization_id='$ORG' and entity_type in ('degradation_profile_revision_proposed','degradation_profile_reviewed'));")
echo "U14.01 ledger counts approved_profile|canonical_approval|audit=$COUNTS"
test "$COUNTS" = '1|1|2'
echo 'U14.01 degradation-library smoke passed: families=16 canonical_mechanisms=true canonical_models=true verified_evidence=true independent_review=true tenant_wall=true future_tenant_seed=true service_role_mutation_refused=true pending_owner_mutation_refused=true approved_owner_content_metadata_supersession_refused=true owner_truncate_refused=true authority_unchanged=true'

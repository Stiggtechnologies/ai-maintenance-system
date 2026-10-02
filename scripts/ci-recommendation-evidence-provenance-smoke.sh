#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U17.01/U17.02 recommendation-evidence smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
FOREIGN_ORG='27170000-0000-4000-8000-000000000001'
FOREIGN_ID='27170000-0000-4000-8000-000000000002'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

AUTHOR=$(token 'admin@syncai.ca' 'Admin123!@#')
REVIEWER=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$AUTHOR" && test -n "$REVIEWER"
read -r AUTHOR_ID REVIEWER_ID <<<"$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F ' ' -v ON_ERROR_STOP=1 -c "select (select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'),(select id from user_profiles where organization_id='$ORG' and email='demo@syncai.ca')")"

UUIDS=($(python3 -c 'import uuid; print(" ".join(str(uuid.uuid4()) for _ in range(10)))'))
RECOMMENDATION_ID=${UUIDS[0]}
EVIDENCE_IDS=("${UUIDS[@]:1}")
LEVELS=(verified_measurement approved_inspection confirmed_history engineering_calculation oem_recommendation industry_reference similar_asset_inference expert_judgment ai_hypothesis)

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into recommendations(id,organization_id,title,issue,action,status)
values('$RECOMMENDATION_ID','$ORG','U17 governed recommendation evidence fixture','A recommendation needs explicit provenance, conflicts and gaps.','Keep authority pending while the exact evidence packet is reviewed.','pending');
$(for i in {0..8}; do printf "insert into evidence_items(id,organization_id,recommendation_id,source_system,evidence_type,description,evidence_class,verification_status,quality_grade,applicability_grade,ts) values('%s','%s','%s','U17-CI','%s','U17 evidence item %s with an independently classified recommendation-support basis.','%s','unverified','high','direct',now()-interval '%s days');\n" "${EVIDENCE_IDS[$i]}" "$ORG" "$RECOMMENDATION_ID" "${LEVELS[$i]}" "$((i+1))" "$([ "$i" = 0 ] && echo MEASURED || echo DOCUMENTED)" "$((i+1))"; done)
SQL

for i in {0..8}; do
  ROLE=supporting
  test "$i" = 1 && ROLE=contradicting
  test "$i" = 2 && ROLE=context
  PAYLOAD=$(EVIDENCE_ID="${EVIDENCE_IDS[$i]}" LEVEL="${LEVELS[$i]}" ROLE="$ROLE" INDEX="$i" python3 -c 'import json,os; print(json.dumps({"p_evidence_id":os.environ["EVIDENCE_ID"],"p_evidence_level":os.environ["LEVEL"],"p_claim_role":os.environ["ROLE"],"p_source_reference":"U17-SOURCE-"+os.environ["INDEX"],"p_revision":"R"+os.environ["INDEX"],"p_source_date":"2026-09-01","p_applicability":"Applicable to the exact U17 recommendation and bounded acceptance fixture."}))')
  PROPOSED=$(rpc "$AUTHOR" propose_recommendation_evidence_classification "$PAYLOAD")
  ok "$PROPOSED"
done

SELF=$(rpc "$AUTHOR" review_recommendation_evidence_classification "{\"p_evidence_id\":\"${EVIDENCE_IDS[0]}\",\"p_decision\":\"validated\",\"p_review_note\":\"The classification author must not review their own evidence classification.\"}")
err "$SELF" 'classification author cannot independently review'

for id in "${EVIDENCE_IDS[@]}"; do
  REVIEWED=$(rpc "$REVIEWER" review_recommendation_evidence_classification "{\"p_evidence_id\":\"$id\",\"p_decision\":\"validated\",\"p_review_note\":\"Independent review confirms the exact level, claim role, source revision and applicability.\"}")
  ok "$REVIEWED"
done

PACKET=$(rpc "$AUTHOR" set_recommendation_missing_evidence "{\"p_recommendation_id\":\"$RECOMMENDATION_ID\",\"p_missing_evidence\":[\"OEM operating-envelope confirmation\",\"Post-maintenance condition measurement\"],\"p_basis\":\"The linked evidence was checked against the decision claim, known conflict and required validation inputs.\"}")
ok "$PACKET"
SELF_PACKET=$(rpc "$AUTHOR" review_recommendation_evidence_packet "{\"p_recommendation_id\":\"$RECOMMENDATION_ID\",\"p_decision\":\"validated\",\"p_review_note\":\"The packet author must not independently review the same exact evidence digest.\"}")
err "$SELF_PACKET" 'packet author cannot independently review'
VALIDATED=$(rpc "$REVIEWER" review_recommendation_evidence_packet "{\"p_recommendation_id\":\"$RECOMMENDATION_ID\",\"p_decision\":\"validated\",\"p_review_note\":\"Independent review confirms the conflicts, gaps and exact evidence digest are visible.\"}")
ok "$VALIDATED"

WORKSPACE=$(rpc "$AUTHOR" get_recommendation_evidence_workspace "{\"p_recommendation_id\":\"$RECOMMENDATION_ID\"}")
ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['recommendation']['status']=='pending';assert len(x['evidence'])==9;assert set(e['evidenceLevel'] for e in x['evidence'])==set('${LEVELS[*]}'.split());assert x['posture']=={'linkedEvidence':9,'validatedClassifications':9,'supporting':7,'contradicting':1,'context':1,'unclassified':0,'missingCount':2};assert x['packet']['validationStatus']=='validated';assert all(e['verificationStatus']=='unverified' for e in x['evidence']);assert all(('evidenceConfidencePct' in e['confidence']) or ('refusal' in e['confidence']) for e in x['evidence']);assert x['operationalAuthorization'] is False"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  begin
    update evidence_items set recommendation_claim_role='context' where id='${EVIDENCE_IDS[0]}';
    raise exception 'validated evidence provenance mutation was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%validated recommendation evidence provenance is immutable%' then raise; end if;
  end;
  begin
    update recommendations set missing_evidence='{}' where id='$RECOMMENDATION_ID';
    raise exception 'governed evidence packet mutation was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%governed packet functions%' then raise; end if;
  end;
  begin
    truncate table evidence_items;
    raise exception 'evidence history truncate was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%truncate refused%' then raise; end if;
  end;
end \$\$;
SQL

SERVICE_MUTATION=$(curl -sS -w '\n%{http_code}' -X PATCH "$API_URL/rest/v1/evidence_items?id=eq.${EVIDENCE_IDS[0]}" -H "apikey: $SERVICE_ROLE_KEY" -H "authorization: Bearer $SERVICE_ROLE_KEY" -H 'content-type: application/json' -d '{"recommendation_claim_role":"context"}')
test "$(status "$SERVICE_MUTATION")" != 200
BODY="$(body "$SERVICE_MUTATION")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'immutable' in (x.get('message') or ''),x"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$seed\$
begin
  insert into organizations(id,name) values('$FOREIGN_ORG','U17 tenant-isolation fixture') on conflict(id) do nothing;
  if not exists(select 1 from auth.users where id='$FOREIGN_ID') then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000','$FOREIGN_ID','authenticated','authenticated','u17-foreign@syncai.ca',extensions.crypt('Foreign123!@#',extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{"full_name":"U17 foreign reviewer"}','','','','','','','','');
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
    values(gen_random_uuid(),'$FOREIGN_ID','$FOREIGN_ID',jsonb_build_object('sub','$FOREIGN_ID','email','u17-foreign@syncai.ca'),'email',now(),now(),now());
  end if;
  insert into user_profiles(id,organization_id,email,role) values('$FOREIGN_ID','$FOREIGN_ORG','u17-foreign@syncai.ca','reliability_engineer') on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role;
end \$seed\$;
SQL
FOREIGN=$(token 'u17-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGN"
CROSS=$(rpc "$FOREIGN" get_recommendation_evidence_workspace "{\"p_recommendation_id\":\"$RECOMMENDATION_ID\"}")
err "$CROSS" 'recommendation not found in this organization'

# Obtain a fresh linked item to prove exact-digest staleness without mutating history.
NEW_EVIDENCE=$(python3 -c 'import uuid;print(uuid.uuid4())')
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "insert into evidence_items(id,organization_id,recommendation_id,source_system,evidence_type,description) values('$NEW_EVIDENCE','$ORG','$RECOMMENDATION_ID','U17-CI','late_evidence','New evidence after validation must make the exact packet digest stale.');" >/dev/null
STALE=$(rpc "$AUTHOR" get_recommendation_evidence_workspace "{\"p_recommendation_id\":\"$RECOMMENDATION_ID\"}")
ok "$STALE"
BODY="$(body "$STALE")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['packet']['validationStatus']=='stale';assert x['posture']['linkedEvidence']==10 and x['posture']['unclassified']==1"

COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(*) from approvals where organization_id='$ORG' and recommendation_id='$RECOMMENDATION_ID' and approval_scope->>'kind'='recommendation_evidence_classification'),(select count(*) from approvals where organization_id='$ORG' and recommendation_id='$RECOMMENDATION_ID' and approval_scope->>'kind'='recommendation_evidence_packet'),(select count(*) from audit_events where organization_id='$ORG' and event_data->>'recommendation_id'='$RECOMMENDATION_ID'),(select count(*) from work_orders where organization_id='$ORG' and recommendation_id='$RECOMMENDATION_ID');")
echo "U17.01/U17.02 ledger counts classification_approvals|packet_approvals|audit|work_orders=$COUNTS"
test "$COUNTS" = '9|1|20|0'
echo 'U17.01/U17.02 recommendation-evidence smoke passed: nine_levels=true canonical_evidence=true confidence_or_named_refusal=true conflict_visible=true missing_evidence=true independent_review=true exact_digest=true staleness=true tenant_wall=true service_role_mutation_refused=true truncate_refused=true authority_unchanged=true'

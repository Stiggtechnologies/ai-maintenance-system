#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U24.01 ethical-boundaries smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999924'
REVIEWER_ID='98240000-0000-4000-8000-000000000001'
FOREIGN_OWNER_ID='98240000-0000-4000-8000-000000000002'
EVIDENCE='98240000-0000-4000-8000-000000000011'
SELF_EVIDENCE='98240000-0000-4000-8000-000000000012'
FOREIGN_EVIDENCE_ID='98240000-0000-4000-8000-000000000013'
BOUNDARIES='uncertainty_visibility,metric_integrity,safe_staffing,nondiscrimination,verified_surveillance,individual_due_process,safety_over_finance,named_accountability,no_fabricated_authority'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','U24 foreign','utilities') on conflict(id) do nothing;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
  raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new,
  email_change_token_current,phone_change,phone_change_token,reauthentication_token)
values
('00000000-0000-0000-0000-000000000000','$REVIEWER_ID','authenticated','authenticated','reviewer-u24@syncai.test',
  extensions.crypt('Reviewer123!@#',extensions.gen_salt('bf')),now(),now(),now(),
  '{"provider":"email","providers":["email"]}','{"full_name":"U24 Independent Reviewer"}','','','','','','','',''),
('00000000-0000-0000-0000-000000000000','$FOREIGN_OWNER_ID','authenticated','authenticated','foreign-u24@syncai.test',
  extensions.crypt('Foreign123!@#',extensions.gen_salt('bf')),now(),now(),now(),
  '{"provider":"email","providers":["email"]}','{"full_name":"U24 Foreign Owner"}','','','','','','','','')
on conflict(id) do nothing;

insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
values(gen_random_uuid(),'$REVIEWER_ID','$REVIEWER_ID',jsonb_build_object('sub','$REVIEWER_ID','email','reviewer-u24@syncai.test'),'email',now(),now(),now())
on conflict do nothing;

insert into user_profiles(id,organization_id,email,full_name,role) values
('$REVIEWER_ID','$ORG','reviewer-u24@syncai.test','U24 Independent Reviewer','admin'),
('$FOREIGN_OWNER_ID','$OTHER_ORG','foreign-u24@syncai.test','U24 Foreign Owner','admin')
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,full_name=excluded.full_name;

insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class) values
('$EVIDENCE','$ORG','ci','document','Independently verified U24 control evidence used by the acceptance workflow.','DOCUMENTED'),
('$SELF_EVIDENCE','$ORG','ci','document','Self-verified evidence that must be refused for an assessor determination.','DOCUMENTED'),
('$FOREIGN_EVIDENCE_ID','$OTHER_ORG','ci','document','Foreign-tenant evidence that must remain unavailable to the SyncAI tenant.','DOCUMENTED')
on conflict(id) do nothing;
SQL

AUTHOR=$(token 'admin@syncai.ca' 'Admin123!@#')
VERIFIER=$(token 'demo@syncai.ca' 'Demo123!@#')
EXECUTIVE=$(token 'executive@syncai.ca' 'Exec123!@#')
REVIEWER=$(token 'reviewer-u24@syncai.test' 'Reviewer123!@#')
test -n "$AUTHOR" && test -n "$VERIFIER" && test -n "$EXECUTIVE" && test -n "$REVIEWER"

read -r AUTHOR_ID OWNER_ID <<<"$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F ' ' -v ON_ERROR_STOP=1 -c "select (select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'),(select id from user_profiles where organization_id='$ORG' and email='manager@syncai.ca')")"
test -n "$AUTHOR_ID" && test -n "$OWNER_ID"

VERIFY=$(rpc "$VERIFIER" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent U24 control review\",\"p_outcome\":\"verified\",\"p_note\":\"The supplied control record is fit for the explicit ethical-boundary acceptance workflow.\"}")
ok "$VERIFY"
SELF_VERIFY=$(rpc "$AUTHOR" verify_evidence_item "{\"p_evidence_id\":\"$SELF_EVIDENCE\",\"p_method\":\"Self verification fixture\",\"p_outcome\":\"verified\",\"p_note\":\"This evidence is deliberately self verified so the determination boundary can refuse it.\"}")
ok "$SELF_VERIFY"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "update evidence_items set verification_status='verified',verified_by='$REVIEWER_ID',verified_at=now(),verification_method='Foreign fixture verification',verification_note='Foreign evidence exists only to prove tenant isolation.' where id='$FOREIGN_EVIDENCE_ID';"

CREATE=$(rpc "$AUTHOR" create_ethical_boundary_review '{"p_review":{"title":"Annual explicit ethical-boundary review","scope":"All SyncAI production recommendations, agent outputs, human decisions and governed integrations.","purpose":"Prove the nine explicit prohibitions are implemented, evidenced, owned and independently reviewed.","effectiveOn":"2026-10-03","nextReviewOn":"2027-10-03"}}')
ok "$CREATE"
REVIEW_ID=$(BODY="$(body "$CREATE")" python3 -c 'import json,os;print(json.loads(os.environ["BODY"])["reviewId"])')
test -n "$REVIEW_ID"

determination_payload(){
  REVIEW_ID="$1" KEY="$2" OUTCOME="$3" EVIDENCE_ID="$4" OWNER_ID_VALUE="$5" python3 -c 'import json,os; outcome=os.environ["OUTCOME"]; key=os.environ["KEY"]; print(json.dumps({"p_review_id":os.environ["REVIEW_ID"],"p_determination":{"boundaryKey":key,"outcome":outcome,"controlDescription":"The governed acceptance fixture records and enforces the implemented control for "+key+" across the stated production scope.","verificationProcedure":"Reproduce the tenant, evidence, separation-of-duties and direct-write refusal checks for "+key+" before adoption.","evidenceItemId":os.environ["EVIDENCE_ID"],"accountableOwnerId":os.environ["OWNER_ID_VALUE"],"remediation":"Close the evidenced control gap for "+key+" and repeat independent verification before resubmission." if outcome=="gap" else ""}}))'
}

FOREIGN_EVIDENCE=$(rpc "$AUTHOR" set_ethical_boundary_determination "$(determination_payload "$REVIEW_ID" uncertainty_visibility enforced "$FOREIGN_EVIDENCE_ID" "$OWNER_ID")")
err "$FOREIGN_EVIDENCE" 'same-tenant canonical evidence'
SELF_VERIFIED=$(rpc "$AUTHOR" set_ethical_boundary_determination "$(determination_payload "$REVIEW_ID" uncertainty_visibility enforced "$SELF_EVIDENCE" "$OWNER_ID")")
err "$SELF_VERIFIED" 'independently verified by someone other than the assessor'
FOREIGN_OWNER=$(rpc "$AUTHOR" set_ethical_boundary_determination "$(determination_payload "$REVIEW_ID" uncertainty_visibility enforced "$EVIDENCE" "$FOREIGN_OWNER_ID")")
err "$FOREIGN_OWNER" 'accountable owner must belong to this organization'

IFS=',' read -r -a KEYS <<<"$BOUNDARIES"
for key in "${KEYS[@]}"; do
  outcome='enforced'
  if [ "$key" = 'uncertainty_visibility' ]; then outcome='gap'; fi
  SAVED=$(rpc "$AUTHOR" set_ethical_boundary_determination "$(determination_payload "$REVIEW_ID" "$key" "$outcome" "$EVIDENCE" "$OWNER_ID")")
  ok "$SAVED"
done

INCOMPLETE_CHECK=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select count(*) from ethical_boundary_determinations where review_id='$REVIEW_ID';")
test "$INCOMPLETE_CHECK" = '9'

GAP_SUBMIT=$(rpc "$AUTHOR" submit_ethical_boundary_review "{\"p_review_id\":\"$REVIEW_ID\",\"p_basis\":\"All nine boundaries were assessed; one evidenced gap requires controlled remediation before independent adoption.\"}")
ok "$GAP_SUBMIT"
BODY="$(body "$GAP_SUBMIT")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["status"]=="remediation_required" and x["gapCount"]==1,x'

GAP_RECOMMENDATIONS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "select count(*) from recommendations where ethical_boundary_review_id='$REVIEW_ID' and ethical_boundary_key='uncertainty_visibility' and status='pending';")
test "$GAP_RECOMMENDATIONS" = '1'

CLOSED=$(rpc "$AUTHOR" set_ethical_boundary_determination "$(determination_payload "$REVIEW_ID" uncertainty_visibility enforced "$EVIDENCE" "$OWNER_ID")")
ok "$CLOSED"
# Make the executive a determination assessor without making them the author or submitter.
EXEC_ASSESS=$(rpc "$EXECUTIVE" set_ethical_boundary_determination "$(determination_payload "$REVIEW_ID" metric_integrity enforced "$EVIDENCE" "$OWNER_ID")")
ok "$EXEC_ASSESS"

SUBMITTED=$(rpc "$AUTHOR" submit_ethical_boundary_review "{\"p_review_id\":\"$REVIEW_ID\",\"p_basis\":\"All nine controls now have independently verified evidence, named owners and reproducible verification procedures.\"}")
ok "$SUBMITTED"
BODY="$(body "$SUBMITTED")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["status"]=="review_pending" and x["boundaryCount"]==9,x'

ASSESSOR_REVIEW=$(rpc "$EXECUTIVE" review_ethical_boundaries "{\"p_review_id\":\"$REVIEW_ID\",\"p_decision\":\"approved\",\"p_review_note\":\"An assessor must remain separated from final independent adoption.\"}")
err "$ASSESSOR_REVIEW" 'determination assessor cannot perform'

DIRECT_WRITE=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  begin update ethical_boundary_reviews set status='adopted' where id='$REVIEW_ID';
    raise exception 'direct mutation was incorrectly allowed';
  exception when others then if sqlerrm not like '%governed functions%' then raise; end if; end;
end \$\$;
select 'refused';
SQL
)
test "$DIRECT_WRITE" = 'refused'

DIRECT_LINK=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  begin insert into recommendations(organization_id,title,status,ethical_boundary_review_id,ethical_boundary_key)
    values('$ORG','Fabricated ethical link','pending','$REVIEW_ID','safe_staffing');
    raise exception 'direct link was incorrectly allowed';
  exception when others then if sqlerrm not like '%governed functions%' then raise; end if; end;
end \$\$;
select 'refused';
SQL
)
test "$DIRECT_LINK" = 'refused'

ADOPTED=$(rpc "$REVIEWER" review_ethical_boundaries "{\"p_review_id\":\"$REVIEW_ID\",\"p_decision\":\"approved\",\"p_review_note\":\"Independent review confirms all nine prohibitions, evidence sources, named owners and verification procedures.\"}")
ok "$ADOPTED"

WORKSPACE=$(rpc "$REVIEWER" get_ethical_boundary_workspace '{}')
ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" REVIEW_ID="$REVIEW_ID" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);r=next(v for v in x["reviews"] if v["id"]==os.environ["REVIEW_ID"]);assert len(x["boundaries"])==9 and len(r["determinations"])==9 and r["status"]=="adopted" and r["current"] is True;assert "automated authority" in x["basis"]'

# An expired review can be complete but can never become the current adopted posture.
EXPIRED_CREATE=$(rpc "$AUTHOR" create_ethical_boundary_review '{"p_review":{"title":"Expired ethical-boundary fixture","scope":"An expired acceptance scope used only to prove review-date refusal.","purpose":"Prove a complete but stale review cannot become the current ethical posture.","effectiveOn":"2025-01-01","nextReviewOn":"2026-01-01"}}')
ok "$EXPIRED_CREATE"
EXPIRED_ID=$(BODY="$(body "$EXPIRED_CREATE")" python3 -c 'import json,os;print(json.loads(os.environ["BODY"])["reviewId"])')
for key in "${KEYS[@]}"; do
  SAVED=$(rpc "$AUTHOR" set_ethical_boundary_determination "$(determination_payload "$EXPIRED_ID" "$key" enforced "$EVIDENCE" "$OWNER_ID")")
  ok "$SAVED"
done
EXPIRED_SUBMIT=$(rpc "$AUTHOR" submit_ethical_boundary_review "{\"p_review_id\":\"$EXPIRED_ID\",\"p_basis\":\"All nine stale controls are present so the date boundary, rather than completeness, must refuse adoption.\"}")
ok "$EXPIRED_SUBMIT"
EXPIRED_ADOPT=$(rpc "$REVIEWER" review_ethical_boundaries "{\"p_review_id\":\"$EXPIRED_ID\",\"p_decision\":\"approved\",\"p_review_note\":\"A stale review must not displace the current independently adopted ethical posture.\"}")
err "$EXPIRED_ADOPT" 'future review date'

COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(*) from ethical_boundary_determinations where review_id='$REVIEW_ID'),(select count(*) from recommendations where ethical_boundary_review_id='$REVIEW_ID' and status='dismissed'),(select count(*) from approvals where ethical_boundary_review_id='$REVIEW_ID' and status='approved'),(select count(*) from audit_events where organization_id='$ORG' and event_data->>'review_id'='$REVIEW_ID');")
echo "U24.01 ledger counts determinations|closed_remediation|approval|audit=$COUNTS"
test "$COUNTS" = '9|1|1|15'
echo 'U24.01 ethical-boundaries smoke passed: boundaries=9 verified_evidence=true assessor_verifier_separation=true tenant_wall=true owner_wall=true remediation=true assessor_review_refused=true direct_write_refused=true human_adoption=true expiry_refused=true automation_authority=false'

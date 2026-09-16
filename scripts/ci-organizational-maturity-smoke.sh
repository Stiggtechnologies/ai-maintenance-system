#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U22 organizational-maturity smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999922'
EVIDENCE='98220000-0000-4000-8000-000000000001'
UNVERIFIED_EVIDENCE='98220000-0000-4000-8000-000000000002'
DOMAINS='leadership,hierarchy,work_management,planning_scheduling,failure_coding,pm_quality,condition_monitoring,materials,engineering_governance,data_quality,workforce,financial_integration,ai_governance'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

ASSESSOR=$(token 'admin@syncai.ca' 'Admin123!@#')
VERIFIER=$(token 'demo@syncai.ca' 'Demo123!@#')
REVIEWER=$(token 'executive@syncai.ca' 'Exec123!@#')
test -n "$ASSESSOR" && test -n "$VERIFIER" && test -n "$REVIEWER"
read -r ASSESSOR_ID REVIEWER_ID <<<"$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F ' ' -v ON_ERROR_STOP=1 -c "select (select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'),(select id from user_profiles where organization_id='$ORG' and email='executive@syncai.ca')")"
test -n "$ASSESSOR_ID" && test -n "$REVIEWER_ID"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','U22 foreign','utilities') on conflict(id) do nothing;
insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class)
values
('$EVIDENCE','$ORG','ci','document','Verified cross-domain U22 acceptance evidence','DOCUMENTED'),
('$UNVERIFIED_EVIDENCE','$ORG','ci','document','Unverified U22 acceptance evidence','DOCUMENTED')
on conflict(id) do nothing;
SQL

INCOMPLETE=$(rpc "$ASSESSOR" record_organizational_maturity_assessment '{"p_assessment":{"title":"U22 incomplete","scope":"Acceptance test scope","evidenceSummary":"Incomplete input must refuse explicitly.","domains":[]}}')
err "$INCOMPLETE" 'each of the 13 canonical maturity domains'

UNVERIFIED_PAYLOAD=$(DOMAINS="$DOMAINS" EVIDENCE="$UNVERIFIED_EVIDENCE" python3 -c 'import json,os; ds=os.environ["DOMAINS"].split(","); print(json.dumps({"p_assessment":{"title":"U22 unverified","scope":"Acceptance test organization","evidenceSummary":"Unverified evidence must never support a score.","domains":[{"domainKey":d,"score":2,"finding":"A specific acceptance finding exists for "+d+".","evidenceItemId":os.environ["EVIDENCE"]} for d in ds]}}))')
UNVERIFIED=$(rpc "$ASSESSOR" record_organizational_maturity_assessment "$UNVERIFIED_PAYLOAD")
err "$UNVERIFIED" 'requires same-tenant verified canonical evidence'

VERIFY=$(rpc "$VERIFIER" verify_evidence_item "{\"p_evidence_id\":\"$EVIDENCE\",\"p_method\":\"Independent U22 evidence review\",\"p_outcome\":\"verified\",\"p_note\":\"The supplied record is fit to support the organizational maturity acceptance test.\"}")
ok "$VERIFY"
ASSESSMENT_PAYLOAD=$(DOMAINS="$DOMAINS" EVIDENCE="$EVIDENCE" python3 -c 'import json,os; ds=os.environ["DOMAINS"].split(","); print(json.dumps({"p_assessment":{"title":"Annual reliability maturity baseline","scope":"The full acceptance-test organization and all maintenance functions.","evidenceSummary":"A controlled acceptance fixture proves evidence, review, recommendation, tenancy and authority boundaries.","domains":[{"domainKey":d,"score":i%6,"finding":"Verified acceptance evidence identifies the current practice and gap for "+d+".","evidenceItemId":os.environ["EVIDENCE"]} for i,d in enumerate(ds)]}}))')
RECORDED=$(rpc "$ASSESSOR" record_organizational_maturity_assessment "$ASSESSMENT_PAYLOAD")
ok "$RECORDED"
ASSESSMENT_ID=$(BODY="$(body "$RECORDED")" python3 -c 'import json,os;print(json.loads(os.environ["BODY"])["assessmentId"])')
test -n "$ASSESSMENT_ID"

FOREIGN_ID=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizational_maturity_assessments(organization_id,title,scope,evidence_summary,overall_level,minimum_level,assessed_by)
values('$OTHER_ORG','Foreign maturity','A foreign tenant assessment','Foreign tenant evidence basis for the isolation test.',2,2,'$ASSESSOR_ID') returning id;
SQL
)
test -n "$FOREIGN_ID"
FOREIGN_REVIEW=$(rpc "$REVIEWER" review_organizational_maturity_assessment "{\"p_assessment_id\":\"$FOREIGN_ID\",\"p_decision\":\"approved\",\"p_review_note\":\"A foreign-tenant record must remain invisible to this reviewer.\"}")
err "$FOREIGN_REVIEW" 'assessment not found in this organization'
SELF_REVIEW=$(rpc "$ASSESSOR" review_organizational_maturity_assessment "{\"p_assessment_id\":\"$ASSESSMENT_ID\",\"p_decision\":\"approved\",\"p_review_note\":\"The original assessor cannot independently approve this record.\"}")
err "$SELF_REVIEW" 'assessor cannot independently review'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  begin update organizational_maturity_assessments set status='approved',reviewed_by='$REVIEWER_ID',reviewed_at=now(),review_note='Direct mutation must be refused even when all fields are supplied.' where id='$ASSESSMENT_ID';
    raise exception 'direct mutation was incorrectly allowed';
  exception when others then if sqlerrm not like '%governed review function%' then raise; end if; end;
end \$\$;
SQL

APPROVED=$(rpc "$REVIEWER" review_organizational_maturity_assessment "{\"p_assessment_id\":\"$ASSESSMENT_ID\",\"p_decision\":\"approved\",\"p_review_note\":\"Independent review confirms the complete evidence-backed maturity baseline.\"}")
ok "$APPROVED"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  begin insert into recommendations(organization_id,title,status,organizational_maturity_assessment_id,maturity_domain_key)
    values('$ORG','Fabricated maturity link','pending','$ASSESSMENT_ID','leadership');
    raise exception 'direct maturity link was incorrectly allowed';
  exception when others then if sqlerrm not like '%governed review function%' then raise; end if; end;
end \$\$;
SQL
WORKSPACE=$(rpc "$REVIEWER" get_organizational_maturity_workspace '{}')
ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" ASSESSMENT_ID="$ASSESSMENT_ID" python3 -c 'import json,os; x=json.loads(os.environ["BODY"]); a=next(v for v in x["assessments"] if v["id"]==os.environ["ASSESSMENT_ID"]); assert len(x["dimensions"])==13; assert len(a["domains"])==13; assert a["status"]=="approved"; assert len(a["recommendations"])==9; assert a["operationalAuthorization"] is False; assert a["certificationClaim"] is False'

COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(*) from organizational_maturity_domains where assessment_id='$ASSESSMENT_ID'),(select count(*) from recommendations where organizational_maturity_assessment_id='$ASSESSMENT_ID' and status='pending' and confidence is null),(select count(*) from approvals where organizational_maturity_assessment_id='$ASSESSMENT_ID' and status='approved'),(select count(*) from audit_events where organization_id='$ORG' and entity_type in ('organizational_maturity_assessment_submitted','organizational_maturity_assessment_reviewed') and event_data->>'assessment_id'='$ASSESSMENT_ID');")
echo "U22 ledger counts domains|pending_recommendations|approval|audit=$COUNTS"
test "$COUNTS" = '13|9|1|2'
echo 'U22 organizational-maturity smoke passed: dimensions=13 evidence_verified=true tenant_wall=true author_separation=true immutable_submission=true canonical_recommendations=true human_final=true'

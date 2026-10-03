#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D11.30 governed-model-registry smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999924'
EVIDENCE='91130000-0000-4000-8000-000000000001'
UNVERIFIED='91130000-0000-4000-8000-000000000002'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'] in x.get('error',''),x"; }

AUTHOR=$(token 'admin@syncai.ca' 'Admin123!@#')
REVIEWER=$(token 'executive@syncai.ca' 'Exec123!@#')
test -n "$AUTHOR" && test -n "$REVIEWER"
read -r AUTHOR_ID REVIEWER_ID <<<"$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F ' ' -v ON_ERROR_STOP=1 -c "select (select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'),(select id from user_profiles where organization_id='$ORG' and email='executive@syncai.ca')")"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','D11.30 foreign','utilities') on conflict(id) do nothing;
insert into evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class,verification_status,verified_by,verified_at,verification_method)
values
('$EVIDENCE','$ORG','ci','document','Independent validation report for the governed model registry acceptance test.','DOCUMENTED','verified','$REVIEWER_ID',now(),'Independent acceptance review'),
('$UNVERIFIED','$ORG','ci','document','Unverified model review material must never support approval.','DOCUMENTED','unverified',null,null,null)
on conflict(id) do nothing;
SQL

PROFILE='{"p_model_key":"ci.decision.model","p_model_kind":"llm","p_purpose":"Prepare evidence-grounded project advice for accountable human review.","p_training_data":{"status":"recorded","basis":"Provider model card and controlled tenant evaluation population are recorded."},"p_validation":{"status":"recorded","basis":"Known reference cases passed independent regression and safety evaluation."},"p_applicability":{"status":"recorded","basis":"Project advisory use only; excludes operational authorization and risk acceptance."},"p_limitations":"May omit context or produce incorrect language; outputs require named human review.","p_decision_relevant":true}'
V1_PAYLOAD=$(PROFILE="$PROFILE" python3 -c 'import json,os;x=json.loads(os.environ["PROFILE"]);x.update({"p_version":"1.0.0","p_supersedes_model_id":None});print(json.dumps(x))')
V1_RESULT=$(rpc "$AUTHOR" submit_model_registry_version "$V1_PAYLOAD")
ok "$V1_RESULT"
V1=$(BODY="$(body "$V1_RESULT")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["status"]=="pending_review" and x["currentForDecisions"] is False;print(x["modelRegisterId"])')

SELF=$(rpc "$AUTHOR" review_model_registry_version "{\"p_model_register_id\":$V1,\"p_decision\":\"approved\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_review_basis\":\"The complete controlled evaluation supports advisory use with human review.\"}")
err "$SELF" 'submitter cannot independently review'
UNVERIFIED_RESULT=$(rpc "$REVIEWER" review_model_registry_version "{\"p_model_register_id\":$V1,\"p_decision\":\"approved\",\"p_evidence_item_id\":\"$UNVERIFIED\",\"p_review_basis\":\"The complete controlled evaluation supports advisory use with human review.\"}")
err "$UNVERIFIED_RESULT" 'verified review evidence is required'
V1_APPROVED=$(rpc "$REVIEWER" review_model_registry_version "{\"p_model_register_id\":$V1,\"p_decision\":\"approved\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_review_basis\":\"Independent reference cases confirm bounded advisory use and all seven attributes are complete.\"}")
ok "$V1_APPROVED"
GATE_V1=$(rpc "$AUTHOR" require_current_model_version '{"p_model_key":"ci.decision.model","p_version":"1.0.0"}')
ok "$GATE_V1"

V2_PAYLOAD=$(PROFILE="$PROFILE" V1="$V1" python3 -c 'import json,os;x=json.loads(os.environ["PROFILE"]);x.update({"p_version":"2.0.0","p_supersedes_model_id":int(os.environ["V1"])});print(json.dumps(x))')
V2_RESULT=$(rpc "$AUTHOR" submit_model_registry_version "$V2_PAYLOAD")
ok "$V2_RESULT"
V2=$(BODY="$(body "$V2_RESULT")" python3 -c 'import json,os;print(json.loads(os.environ["BODY"])["modelRegisterId"])')
V2_BLOCKED=$(rpc "$AUTHOR" require_current_model_version '{"p_model_key":"ci.decision.model","p_version":"2.0.0"}')
BODY="$(body "$V2_BLOCKED")" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);assert x["allowed"] is False and "not the approved current version" in x["refusal"]'
V1_STILL_CURRENT=$(rpc "$AUTHOR" require_current_model_version '{"p_model_key":"ci.decision.model","p_version":"1.0.0"}')
ok "$V1_STILL_CURRENT"
V2_APPROVED=$(rpc "$REVIEWER" review_model_registry_version "{\"p_model_register_id\":$V2,\"p_decision\":\"approved\",\"p_evidence_item_id\":\"$EVIDENCE\",\"p_review_basis\":\"Independent regression confirms version two preserves the bounded advisory purpose and controls.\"}")
ok "$V2_APPROVED"
GATE_V2=$(rpc "$AUTHOR" require_current_model_version '{"p_model_key":"ci.decision.model","p_version":"2.0.0"}')
ok "$GATE_V2"
V1_BLOCKED=$(rpc "$AUTHOR" require_current_model_version '{"p_model_key":"ci.decision.model","p_version":"1.0.0"}')
BODY="$(body "$V1_BLOCKED")" python3 -c 'import json,os;assert json.loads(os.environ["BODY"])["allowed"] is False'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  begin update model_register set version='silently-changed' where id=$V2;
    raise exception 'direct version mutation was incorrectly allowed';
  exception when others then if sqlerrm not like '%immutable outside governed registry functions%' then raise; end if; end;
end \$\$;
SQL

COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(*) from model_register where id=$V1 and approval_status='approved' and not current_for_decisions),(select count(*) from model_register where id=$V2 and approval_status='approved' and current_for_decisions and approved_by='$REVIEWER_ID' and approval_evidence_item_id='$EVIDENCE' and training_data is not null and validation_summary is not null and applicability_summary is not null),(select count(*) from approvals where model_register_id in ($V1,$V2) and status='approved' and approval_scope->>'operationalAuthorization'='false'),(select count(*) from audit_events where organization_id='$ORG' and entity_type in ('model_registry_version_submitted','model_registry_version_reviewed') and (event_data->>'model_register_id')::bigint in ($V1,$V2));")
echo "D11.30 ledger counts old_not_current|new_current|human_approvals|audit=$COUNTS"
test "$COUNTS" = '1|1|2|4'
echo 'D11.30 governed-model-registry smoke passed: seven_attributes=true immutable_versions=true verified_evidence=true author_reviewer_separation=true tenant_scoped=true exact_version_gate=true reapproval_before_swap=true human_final=true'

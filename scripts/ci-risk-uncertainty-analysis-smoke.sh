#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U18.02 risk-uncertainty smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
CRITERIA='a1820000-0000-4000-8000-000000000001'
RISK='a1820000-0000-4000-8000-000000000002'
OTHER_RISK='a1820000-0000-4000-8000-000000000003'
VERIFIED='a1820000-0000-4000-8000-000000000004'
UNVERIFIED='a1820000-0000-4000-8000-000000000005'
WRONG_RISK='a1820000-0000-4000-8000-000000000006'
FOREIGN_ORG='a1820000-0000-4000-8000-000000000007'
FOREIGN_USER='a1820000-0000-4000-8000-000000000008'

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
test -n "$AUTHOR_ID" && test -n "$REVIEWER_ID"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
insert into risk_criteria_profiles(id,organization_id,name,version,status,decision_thresholds,basis,adopted_by,adopted_at)
values('$CRITERIA','$ORG','U18 governed uncertainty criteria',1,'adopted','{"escalateAbove":16,"stopAbove":24}',
  'Adopted acceptance fixture for exact threshold provenance.','$REVIEWER_ID',now())
on conflict(id) do nothing;
-- These acceptance risks intentionally omit the full ISO 31000 identification
-- contract, so they must remain draft fixtures. The U18 workflow independently
-- refuses archived risks and does not promote canonical risk lifecycle state.
insert into risks(id,organization_id,criteria_profile_id,title,status,value_currency,created_by)
values
('$RISK','$ORG','$CRITERIA','U18 loss of cooling uncertainty','draft','CAD','$AUTHOR_ID'),
('$OTHER_RISK','$ORG','$CRITERIA','U18 unrelated risk','draft','CAD','$AUTHOR_ID')
on conflict(id) do nothing;
insert into evidence_items(id,organization_id,risk_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method,quality_grade,applicability_grade,revision)
values
('$VERIFIED','$ORG','$RISK','CMMS','inspection','Verified inspection and operating-history extract for the exact U18 risk.','INSPECTED','verified','$REVIEWER_ID',now(),'Independent inspection and lineage review','high','direct','R2'),
('$UNVERIFIED','$ORG','$RISK','interview','recollection','Unverified recollection cannot enter a governed U18 packet.','EXPERT_JUDGEMENT','unverified',null,null,null,'moderate','indirect','R1'),
('$WRONG_RISK','$ORG','$OTHER_RISK','CMMS','inspection','Verified evidence from another risk cannot enter this packet.','INSPECTED','verified','$REVIEWER_ID',now(),'Independent inspection and lineage review','high','direct','R1')
on conflict(id) do nothing;
SQL

payload(){ MODE="$1" EVIDENCE="$2" python3 -c '
import json,os
p={
 "method":"Three-point bounded estimate",
 "basis":"The range is derived from the cited inspection, operating history and explicit bounded assumptions.",
 "probability_lower":0.15,"probability_central":0.30,"probability_upper":0.55,
 "confidence_level":0.90,"confidence_interval_lower":0.10,"confidence_interval_upper":0.60,
 "best_case_loss":10000,"expected_case_loss":60000,"worst_case_loss":250000,"currency":"CAD",
 "sensitivity":[{"name":"Startup exposure","basis":"Verified startup and inspection history for the exact risk.","low_input":2,"base_input":5,"high_input":8,"low_output":10000,"base_output":60000,"high_output":180000}],
 "reassessment_triggers":["Two startups occur inside one operating shift"],"review_due_at":"2099-01-01T00:00:00Z",
 "voi_action":"Inspect the seal system during the next planned outage",
 "voi_information_cost":10000,"voi_decision_cost_if_wrong":250000,
 "voi_uncertainty_reduction":0.5,"voi_probability_decision_changes":0.3
}
if os.environ["MODE"]=="bad_order": p.update(probability_lower=0.7,probability_central=0.3,probability_upper=0.5)
print(json.dumps({"p_risk_id":"a1820000-0000-4000-8000-000000000002","p_analysis":p,"p_evidence_item_ids":[os.environ["EVIDENCE"]]}))
'; }

BAD_ORDER=$(rpc "$AUTHOR" submit_risk_uncertainty_analysis "$(payload bad_order "$VERIFIED")")
err "$BAD_ORDER" 'probability range must satisfy'
UNVERIFIED_RESULT=$(rpc "$AUTHOR" submit_risk_uncertainty_analysis "$(payload valid "$UNVERIFIED")")
err "$UNVERIFIED_RESULT" 'verified evidence linked to this exact risk'
WRONG_RISK_RESULT=$(rpc "$AUTHOR" submit_risk_uncertainty_analysis "$(payload valid "$WRONG_RISK")")
err "$WRONG_RISK_RESULT" 'verified evidence linked to this exact risk'

SUBMITTED=$(rpc "$AUTHOR" submit_risk_uncertainty_analysis "$(payload valid "$VERIFIED")")
ok "$SUBMITTED"
ANALYSIS_ID=$(BODY="$(body "$SUBMITTED")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['validationStatus']=='pending_review' and x['operationalAuthorization'] is False;assert x['valueOfInformation']=={'expectedValue':37500.00,'netValue':27500.00,'recommendation':'GATHER_INFORMATION'};print(x['analysisId'])")
test -n "$ANALYSIS_ID"

SELF=$(rpc "$AUTHOR" review_risk_uncertainty_analysis "{\"p_analysis_id\":\"$ANALYSIS_ID\",\"p_decision\":\"validated\",\"p_review_note\":\"The analysis author must not review their own uncertainty packet.\"}")
err "$SELF" 'analysis author cannot independently review'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  begin
    update risk_uncertainty_analyses set method='Owner-mutated method' where id='$ANALYSIS_ID';
    raise exception 'direct uncertainty mutation was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%governed submit and review functions%' then raise; end if;
  end;
end \$\$;
SQL

SERVICE=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_risk_uncertainty_workspace" -H "apikey: $SERVICE_ROLE_KEY" -H "authorization: Bearer $SERVICE_ROLE_KEY" -H 'content-type: application/json' -d "{\"p_risk_id\":\"$RISK\"}")
test "$(status "$SERVICE")" != 200

VALIDATED=$(rpc "$REVIEWER" review_risk_uncertainty_analysis "{\"p_analysis_id\":\"$ANALYSIS_ID\",\"p_decision\":\"validated\",\"p_review_note\":\"Independent review confirms the frozen inputs, evidence, thresholds, derivations and limitations.\"}")
ok "$VALIDATED"

WORKSPACE=$(rpc "$AUTHOR" get_risk_uncertainty_workspace "{\"p_risk_id\":\"$RISK\"}")
ok "$WORKSPACE"
BODY="$(body "$WORKSPACE")" ANALYSIS_ID="$ANALYSIS_ID" python3 -c 'import json,os;x=json.loads(os.environ["BODY"]);a=next(v for v in x["analyses"] if v["id"]==os.environ["ANALYSIS_ID"]);assert a["validationStatus"]=="validated";assert a["decisionThresholds"]=={"escalateAbove":16,"stopAbove":24};assert a["probability"]=={"lower":0.15,"central":0.30,"upper":0.55};assert a["sensitivityResults"][0]["name"]=="Startup exposure" and a["sensitivityResults"][0]["swing"]==170000;assert a["valueOfInformation"]["netValue"]==27500;assert a["derivedEvidenceItemId"];assert x["operationalAuthorization"] is False;assert "does not verify an unverified source" in x["boundary"]'

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL
update evidence_items set quality_grade='moderate' where id='$VERIFIED';
do \$\$ begin
  begin
    truncate table risk_uncertainty_analyses cascade;
    raise exception 'risk uncertainty truncate was incorrectly allowed';
  exception when others then
    if sqlerrm not like '%truncate refused%' then raise; end if;
  end;
end \$\$;
do \$seed\$ begin
  insert into organizations(id,name) values('$FOREIGN_ORG','U18 tenant-isolation fixture') on conflict(id) do nothing;
  if not exists(select 1 from auth.users where id='$FOREIGN_USER') then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000','$FOREIGN_USER','authenticated','authenticated','u18-foreign@syncai.ca',extensions.crypt('Foreign123!@#',extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{"full_name":"U18 foreign reviewer"}','','','','','','','','');
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
    values(gen_random_uuid(),'$FOREIGN_USER','$FOREIGN_USER',jsonb_build_object('sub','$FOREIGN_USER','email','u18-foreign@syncai.ca'),'email',now(),now(),now());
  end if;
  insert into user_profiles(id,organization_id,email,role) values('$FOREIGN_USER','$FOREIGN_ORG','u18-foreign@syncai.ca','reliability_engineer') on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role;
end \$seed\$;
SQL

STALE=$(rpc "$AUTHOR" get_risk_uncertainty_workspace "{\"p_risk_id\":\"$RISK\"}")
ok "$STALE"
BODY="$(body "$STALE")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['analyses'][0]['validationStatus']=='stale';assert x['analyses'][0]['analysisDigest']!=x['analyses'][0]['currentDigest']"

FOREIGN=$(token 'u18-foreign@syncai.ca' 'Foreign123!@#')
test -n "$FOREIGN"
CROSS=$(rpc "$FOREIGN" get_risk_uncertainty_workspace "{\"p_risk_id\":\"$RISK\"}")
err "$CROSS" 'risk not found in this organization'

COUNTS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -F '|' -v ON_ERROR_STOP=1 -c "select (select count(*) from approvals where organization_id='$ORG' and risk_id='$RISK' and approval_scope->>'kind'='risk_uncertainty_analysis' and status='approved'),(select count(*) from audit_events where organization_id='$ORG' and entity_type in ('risk_uncertainty_analysis_submitted','risk_uncertainty_analysis_reviewed') and event_data->>'analysis_id'='$ANALYSIS_ID'),(select count(*) from evidence_items where id=(select derived_evidence_item_id from risk_uncertainty_analyses where id='$ANALYSIS_ID') and evidence_class='CALCULATED' and verification_status='unverified'),(select count(*) from decisions where organization_id='$ORG' and risk_id='$RISK'),(select count(*) from work_orders where organization_id='$ORG' and risk_id='$RISK');")
echo "U18.02 ledger counts approval|audit|unverified_derived_evidence|decisions|work_orders=$COUNTS"
test "$COUNTS" = '1|2|1|0|0'
echo 'U18.02 risk-uncertainty smoke passed: canonical_risk=true adopted_threshold_snapshot=true verified_exact_risk_evidence=true ordering_refusal=true server_sensitivity=true server_voi=true independent_review=true digest_staleness=true tenant_wall=true service_role_rpc_refused=true direct_mutation_refused=true truncate_refused=true derived_evidence_unverified=true authority_unchanged=true'

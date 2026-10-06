#!/usr/bin/env bash
# C4.08 — real-Postgres proof for the evidence-linked verification loop.
# Proves explicit human planning, tenant/AI boundaries, exact-one governed
# evidence, CMMS read lineage, legacy re-planning, immutable closure, learning,
# audit, and the absence of plant/write-back authority.
set -euo pipefail
trap 'echo "C4.08 verification-evidence smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
FOREIGN_ORG='c4080000-0000-4000-8000-000000000901'
ADMIN_ID='c4080000-0000-4000-8000-000000000902'
FOREIGN_OWNER='c4080000-0000-4000-8000-000000000903'
AI_ID='99999999-9999-4999-8999-999999999999'
ASSET='c4080000-0000-4000-8000-000000000001'
OTHER_ASSET='c4080000-0000-4000-8000-000000000002'
REC_NOPLAN='c4080000-0000-4000-8000-000000000011'
REC_EVIDENCE='c4080000-0000-4000-8000-000000000012'
REC_CMMS='c4080000-0000-4000-8000-000000000013'
REC_LEGACY='c4080000-0000-4000-8000-000000000014'
FOREIGN_REC='c4080000-0000-4000-8000-000000000015'
EVIDENCE_VALID='c4080000-0000-4000-8000-000000000021'
EVIDENCE_UNVALIDATED='c4080000-0000-4000-8000-000000000022'
EVIDENCE_FOREIGN='c4080000-0000-4000-8000-000000000023'
CONNECTOR_KEY='c408-cmms'
IMPORTED_WO_EXTERNAL='C408-WO-IMPORTED-1'
STALE_WO_EXTERNAL='C408-WO-STALE-1'
OPEN_WO_EXTERNAL='C408-WO-OPEN-1'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
field(){ BODY="$1" KEY="$2" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
if isinstance(x,list): x=x[0] if x else {}
v=x.get(os.environ['KEY']) if isinstance(x,dict) else None
print('' if v is None else ('true' if v is True else 'false' if v is False else v))
PY
}
expect_contains(){ BODY="$1" NEEDLE="$2" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if os.environ['NEEDLE'].lower() not in json.dumps(x,sort_keys=True).lower():
    print('expected %r in %s' % (os.environ['NEEDLE'],x)); sys.exit(1)
PY
}
noerr(){ BODY="$1" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
y=x[0] if isinstance(x,list) and x else x
if isinstance(y,dict) and (y.get('error') or y.get('outcome') in ('error','refused')):
    print('unexpected refusal:',x); sys.exit(1)
PY
}
sql_must_fail(){ local out
  out=$( { PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 <<<"$1"; } || true )
  if PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<<"$1"; then
    echo "expected SQL refusal, got success: $1"; return 1
  fi
  printf '%s' "$out"
}

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<SQL
do \$seed\$
declare p record;
begin
  insert into public.organizations(id,name,industry)
  values('$FOREIGN_ORG','C4.08 foreign tenant','utilities') on conflict(id) do nothing;
  for p in select * from (values
    ('$ADMIN_ID'::uuid,'c408-admin@syncai.ca','C408Admin123!@#','C4.08 Human Administrator','admin','$ORG'::uuid),
    ('$FOREIGN_OWNER'::uuid,'c408-foreign@syncai.ca','C408Foreign123!@#','C4.08 Foreign Owner','reliability_engineer','$FOREIGN_ORG'::uuid),
    ('$AI_ID'::uuid,'smoke-aibot@syncai.ca','AiBot123!@#','Smoke AI operator','ai_admin','$ORG'::uuid)
  ) as t(uid,email,pw,full_name,app_role,org_id)
  loop
    if not exists(select 1 from auth.users where id=p.uid) then
      insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
        email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
        confirmation_token,recovery_token,email_change,email_change_token_new,
        email_change_token_current,phone_change,phone_change_token,reauthentication_token)
      values('00000000-0000-0000-0000-000000000000',p.uid,'authenticated','authenticated',p.email,
        extensions.crypt(p.pw,extensions.gen_salt('bf')),now(),now(),now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name',p.full_name),'','','','','','','','');
    end if;
    if not exists(select 1 from auth.identities where user_id=p.uid) then
      insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
      values(gen_random_uuid(),p.uid,p.uid,jsonb_build_object('sub',p.uid::text,'email',p.email),'email',now(),now(),now());
    end if;
    insert into public.user_profiles(id,organization_id,email,full_name,role)
    values(p.uid,p.org_id,p.email,p.full_name,p.app_role)
    on conflict(id) do update set organization_id=excluded.organization_id,
      email=excluded.email,full_name=excluded.full_name,role=excluded.role;
  end loop;
end \$seed\$;
SQL

RE=$(token 'demo@syncai.ca' 'Demo123!@#')
MANAGER=$(token 'manager@syncai.ca' 'Manager123!@#')
ADMIN=$(token 'c408-admin@syncai.ca' 'C408Admin123!@#')
AIBOT=$(token 'smoke-aibot@syncai.ca' 'AiBot123!@#')
test -n "$RE"; test -n "$MANAGER"; test -n "$ADMIN"; test -n "$AIBOT"
RE_ID='00000000-0000-0000-0000-000000000001'
DUE=$(psqlc "select (current_date+60)::text")

echo '— seed exact-tenant recommendations and assets —'
psqlc "insert into public.assets(id,organization_id,name,tag,criticality,source_system,external_id)
values
('$ASSET','$ORG','C4.08 governed pump','C408-P-101','high','$CONNECTOR_KEY','C408-ASSET-1'),
('$OTHER_ASSET','$ORG','C4.08 other pump','C408-P-202','medium','$CONNECTOR_KEY','C408-ASSET-2')
on conflict(id) do update set source_system=excluded.source_system,external_id=excluded.external_id;
insert into public.assets(id,organization_id,name,tag,criticality)
values('c4080000-0000-4000-8000-000000000099','$FOREIGN_ORG','C4.08 foreign asset','C408-X-1','high')
on conflict(id) do nothing;
insert into public.recommendations(id,organization_id,asset_id,title,issue,action,impact,confidence,urgency,status,rationale,consequence_summary,alternatives_considered,required_completion_date,required_approver_role,verification_method,risk_impact,financial_impact)
values
('$REC_NOPLAN','$ORG','$ASSET','C4.08 missing plan refusal','Seal leakage recurs after solids-heavy startup.','Inspect and correct the seal failure mechanism.','Avoid repeated leakage and production interruption.',82,'action','pending','The exact-asset work history supports a bounded intervention.','A wrong intervention preserves leakage and process exposure.','Retain controls and gather evidence, or execute the bounded inspection.',current_date+30,'maintenance_manager','Measure seal leakage and vibration after the bounded intervention.','Medium','\$120k'),
('$REC_EVIDENCE','$ORG','$ASSET','C4.08 evidence outcome','Seal leakage recurs after solids-heavy startup.','Correct the verified startup seal mechanism.','Avoid repeated leakage and production interruption.',84,'action','pending','Exact-asset evidence supports bounded correction and explicit verification.','A wrong mechanism preserves the repeat failure and downtime.','Continue monitoring or inspect before changing the strategy.',current_date+30,'maintenance_manager','Compare leakage and vibration with the accepted baseline after repair.','Medium','\$140k'),
('$REC_CMMS','$ORG','$ASSET','C4.08 CMMS outcome','Completed inspection must be tied to governed source history.','Verify the completed exact-asset inspection outcome.','Close the loop without granting write-back authority.',80,'action','pending','The governed CMMS import provides exact completed-work evidence.','Wrong-asset or unaudited history could falsely close the loop.','Keep the obligation open until exact-asset work evidence exists.',current_date+30,'maintenance_manager','Confirm the imported completed inspection and acceptance result.','Low','\$80k'),
('$REC_LEGACY','$ORG','$ASSET','C4.08 legacy open debt','An older approved action has an assumed verification date.','Replan the open obligation before recording its result.','Prevent inherited assumptions from becoming fabricated assurance.',75,'advisory','approved','The historical obligation must become explicit before it closes.','Closing without a named plan would manufacture confidence.','Keep the obligation open until a human owner replans it.',current_date+20,'maintenance_manager','Historical placeholder method requiring explicit replan.','Low','\$40k'),
('$FOREIGN_REC','$FOREIGN_ORG','c4080000-0000-4000-8000-000000000099','C4.08 foreign recommendation','Foreign issue.','Foreign action.','Foreign impact.',70,'advisory','pending','Foreign rationale.','Foreign consequence is intentionally substantive.','Foreign alternative is intentionally substantive.',current_date+20,'reliability_engineer','Foreign verification statement is deliberately substantive.','Low','\$10k');" >/dev/null

R=$(rpc "$MANAGER" record_recommendation_assumptions "{\"p_recommendation_id\":\"$REC_NOPLAN\",\"p_packet\":{\"disposition\":\"none_identified\",\"basis\":\"The evidence, alternatives, consequence and validation scope were reviewed for material assumptions before release.\",\"items\":[]},\"p_note\":\"C4.08 independent assumption review for the exact recommendation.\"}")
noerr "$R"

echo '— approval fails closed until a complete named-human plan exists —'
R=$(rpc "$MANAGER" approve_operating_recommendation "{\"p_recommendation_id\":\"$REC_NOPLAN\"}")
expect_contains "$R" 'approval requires an explicit verification method'
test "$(psqlc "select status from recommendations where id='$REC_NOPLAN'")" = 'pending'

R=$(rpc "$MANAGER" record_recommendation_verification_plan "{\"p_recommendation_id\":\"$REC_EVIDENCE\",\"p_method\":\"Compare post-repair leakage and vibration against the accepted baseline.\",\"p_acceptance_criteria\":\"No visible leakage and overall vibration remains below 3.0 mm/s through 72 operating hours.\",\"p_intended_outcome\":\"The repeat startup seal-failure pattern is removed.\",\"p_due_date\":\"$DUE\",\"p_owner_id\":\"$FOREIGN_OWNER\"}")
expect_contains "$R" 'same-tenant human verification owner'
R=$(rpc "$AIBOT" record_recommendation_verification_plan "{\"p_recommendation_id\":\"$REC_EVIDENCE\",\"p_method\":\"Compare post-repair leakage and vibration against the accepted baseline.\",\"p_acceptance_criteria\":\"No visible leakage and overall vibration remains below 3.0 mm/s through 72 operating hours.\",\"p_intended_outcome\":\"The repeat startup seal-failure pattern is removed.\",\"p_due_date\":\"$DUE\",\"p_owner_id\":\"$RE_ID\"}")
expect_contains "$R" 'named human act'
SUPERVISOR_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and role='supervisor' limit 1")
test -n "$SUPERVISOR_ID"
R=$(rpc "$MANAGER" record_recommendation_verification_plan "{\"p_recommendation_id\":\"$REC_EVIDENCE\",\"p_method\":\"Compare post-repair leakage and vibration against the accepted baseline.\",\"p_acceptance_criteria\":\"No visible leakage and overall vibration remains below 3.0 mm/s through 72 operating hours.\",\"p_intended_outcome\":\"The repeat startup seal-failure pattern is removed.\",\"p_due_date\":\"$DUE\",\"p_owner_id\":\"$SUPERVISOR_ID\"}")
expect_contains "$R" 'same-tenant human verification owner'

for REC in "$REC_EVIDENCE" "$REC_CMMS"; do
  R=$(rpc "$MANAGER" record_recommendation_verification_plan "{\"p_recommendation_id\":\"$REC\",\"p_method\":\"Compare the measured post-action condition with the accepted exact-asset baseline.\",\"p_acceptance_criteria\":\"The measured result remains inside the approved condition limit for at least 72 operating hours.\",\"p_intended_outcome\":\"The approved action removes the bounded repeat-failure condition.\",\"p_due_date\":\"$DUE\",\"p_owner_id\":\"$RE_ID\"}")
  noerr "$R"
  test "$(field "$R" dueDateAssumed)" = 'false'
  test "$(field "$R" operationalAuthorization)" = 'false'
  R=$(rpc "$MANAGER" record_recommendation_assumptions "{\"p_recommendation_id\":\"$REC\",\"p_packet\":{\"disposition\":\"none_identified\",\"basis\":\"The final evidence, alternatives, consequence and verification plan were reviewed for material assumptions before release.\",\"items\":[]},\"p_note\":\"C4.08 independent assumption review after the final verification plan was recorded.\"}")
  noerr "$R"
  A=$(rpc "$MANAGER" approve_operating_recommendation "{\"p_recommendation_id\":\"$REC\"}")
  noerr "$A"
done

for REC in "$REC_EVIDENCE" "$REC_CMMS"; do
  OBL=$(psqlc "select id from verification_obligations where recommendation_id='$REC'")
  test -n "$OBL"
  test "$(psqlc "select (due_date='$DUE'::date and not due_date_assumed and evidence_required and verification_owner_id='$RE_ID' and planned_by is not null and planned_at is not null)::text from verification_obligations where id='$OBL'")" = 'true'
done

echo '— legacy open debt cannot close until a human explicitly replans it —'
psqlc "insert into public.verification_obligations(organization_id,recommendation_id,asset_id,method,intended_outcome,due_date,due_date_assumed,acceptance_criteria,evidence_required)
values('$ORG','$REC_LEGACY','$ASSET','Historical placeholder method','Historical placeholder outcome',current_date+30,true,null,false);" >/dev/null
LEGACY_OBL=$(psqlc "select id from verification_obligations where recommendation_id='$REC_LEGACY'")
test "$(psqlc "select evidence_required::text from verification_obligations where id='$LEGACY_OBL'")" = 'true'
R=$(rpc "$RE" record_verification_result "{\"p_obligation_id\":\"$LEGACY_OBL\",\"p_result\":\"achieved\",\"p_measured_note\":\"Measured result was inside the historical placeholder threshold.\",\"p_evidence_id\":null,\"p_work_order_id\":null}")
expect_contains "$R" 'predates the governed verification plan'
R=$(rpc "$MANAGER" record_recommendation_verification_plan "{\"p_recommendation_id\":\"$REC_LEGACY\",\"p_method\":\"Compare the completed exact-asset inspection with the accepted condition threshold.\",\"p_acceptance_criteria\":\"The completed inspection records no visible leakage and no unresolved repeat-failure indication.\",\"p_intended_outcome\":\"The older approved action is shown to have removed the repeat condition.\",\"p_due_date\":\"$DUE\",\"p_owner_id\":\"$RE_ID\"}")
noerr "$R"
test "$(psqlc "select public.verification_obligation_plan_valid('$LEGACY_OBL')::text")" = 'true'

echo '— independently reviewed exact-recommendation evidence is the only evidence-item path —'
psqlc "insert into public.evidence_items(id,organization_id,recommendation_id,source_system,evidence_type,description,evidence_class,verification_status,quality_grade,applicability_grade,ts)
values
('$EVIDENCE_VALID','$ORG','$REC_EVIDENCE','C4.08 condition route','post_action_measurement','Post-action leakage and vibration measurement for the exact recommendation.','MEASURED','unverified','high','direct',now()),
('$EVIDENCE_UNVALIDATED','$ORG','$REC_EVIDENCE','C4.08 condition route','post_action_measurement','Unreviewed measurement must not close the outcome loop.','MEASURED','unverified','moderate','direct',now()),
('$EVIDENCE_FOREIGN','$FOREIGN_ORG','$FOREIGN_REC','C4.08 foreign route','post_action_measurement','Foreign-tenant measurement cannot close this tenant outcome.','MEASURED','unverified','high','direct',now());" >/dev/null
R=$(rpc "$RE" propose_recommendation_evidence_classification "{\"p_evidence_id\":\"$EVIDENCE_VALID\",\"p_evidence_level\":\"verified_measurement\",\"p_claim_role\":\"supporting\",\"p_source_reference\":\"C408-MEASURE-001\",\"p_revision\":\"R1\",\"p_source_date\":\"2026-01-01\",\"p_applicability\":\"Exact asset and post-action window for the bounded recommendation outcome.\"}")
noerr "$R"
R=$(rpc "$MANAGER" review_recommendation_evidence_classification "{\"p_evidence_id\":\"$EVIDENCE_VALID\",\"p_decision\":\"validated\",\"p_review_note\":\"Independent review confirms the exact source, revision, asset, window and recommendation applicability.\"}")
noerr "$R"

OUT=$(sql_must_fail "update evidence_items set ts=now()+interval '1 day' where id='$EVIDENCE_VALID';")
grep -q 'observations are immutable' <<<"$OUT"
OUT=$(sql_must_fail "update evidence_items set description='Substituted measurement after independent review' where id='$EVIDENCE_VALID';")
grep -q 'observations are immutable' <<<"$OUT"

EVIDENCE_OBL=$(psqlc "select id from verification_obligations where recommendation_id='$REC_EVIDENCE'")
EVIDENCE_NOT_BEFORE=$(psqlc "select created_at::text from verification_obligations where id='$EVIDENCE_OBL'")
test "$(psqlc "select public.verification_evidence_item_eligible('$ORG','$REC_EVIDENCE','$EVIDENCE_VALID','$EVIDENCE_NOT_BEFORE'::timestamptz)::text")" = 'true'
test "$(psqlc "select public.verification_evidence_item_eligible('$ORG','$REC_EVIDENCE','$EVIDENCE_VALID',now()+interval '1 day')::text")" = 'false'
R=$(rpc "$RE" record_verification_result "{\"p_obligation_id\":\"$EVIDENCE_OBL\",\"p_result\":null,\"p_measured_note\":\"Leakage measured 2.1 mm/s through 72 hours.\",\"p_evidence_id\":\"$EVIDENCE_VALID\",\"p_work_order_id\":null}")
expect_contains "$R" 'result must be'
R=$(rpc "$MANAGER" record_verification_result "{\"p_obligation_id\":\"$EVIDENCE_OBL\",\"p_result\":\"achieved\",\"p_measured_note\":\"Leakage was zero and vibration measured 2.1 mm/s through 72 hours.\",\"p_evidence_id\":\"$EVIDENCE_VALID\",\"p_work_order_id\":null}")
expect_contains "$R" 'only the named verification owner'
R=$(rpc "$RE" record_verification_result "{\"p_obligation_id\":\"$EVIDENCE_OBL\",\"p_result\":\"achieved\",\"p_measured_note\":\"Leakage was zero and vibration measured 2.1 mm/s through 72 hours.\",\"p_evidence_id\":null,\"p_work_order_id\":null}")
expect_contains "$R" 'exactly one governed source'
R=$(rpc "$RE" record_verification_result "{\"p_obligation_id\":\"$EVIDENCE_OBL\",\"p_result\":\"achieved\",\"p_measured_note\":\"Leakage was zero and vibration measured 2.1 mm/s through 72 hours.\",\"p_evidence_id\":\"$EVIDENCE_UNVALIDATED\",\"p_work_order_id\":null}")
expect_contains "$R" 'not independently validated'
R=$(rpc "$RE" record_verification_result "{\"p_obligation_id\":\"$EVIDENCE_OBL\",\"p_result\":\"achieved\",\"p_measured_note\":\"Leakage was zero and vibration measured 2.1 mm/s through 72 hours.\",\"p_evidence_id\":\"$EVIDENCE_FOREIGN\",\"p_work_order_id\":null}")
expect_contains "$R" 'not independently validated'
GENERATED_STATUS_BEFORE=$(psqlc "select coalesce(string_agg(status,',' order by id),'') from work_orders where recommendation_id='$REC_EVIDENCE'")
R=$(rpc "$RE" record_verification_result "{\"p_obligation_id\":\"$EVIDENCE_OBL\",\"p_result\":\"not_achieved\",\"p_measured_note\":\"Leakage recurred at 4 drops per minute after 36 operating hours.\",\"p_evidence_id\":\"$EVIDENCE_VALID\",\"p_work_order_id\":null}")
noerr "$R"; test "$(field "$R" outcome)" = 'recorded'; test -n "$(field "$R" learningEventId)"
test "$(psqlc "select coalesce(string_agg(status,',' order by id),'') from work_orders where recommendation_id='$REC_EVIDENCE'")" = "$GENERATED_STATUS_BEFORE"

echo '— exact-asset CMMS evidence must carry the complete governed read lineage —'
sleep 1
COMPLETED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
R=$(rpc "$ADMIN" configure_cmms_read_source "{\"p_key\":\"$CONNECTOR_KEY\",\"p_name\":\"C4.08 CMMS proof\",\"p_system_kind\":\"generic_cmms\",\"p_endpoint_url\":\"https://example.com/cmms\",\"p_expected_interval_minutes\":60,\"p_credential_binding_ref\":\"vault://syncai/c408-cmms\",\"p_pagination_mode\":\"none\",\"p_pagination_next_path\":null,\"p_pagination_max_pages\":1,\"p_enabled\":false,\"p_basis\":\"C4.08 bounded read-only verification evidence source approved for this smoke.\"}")
noerr "$R"
R=$(rpc "$ADMIN" save_cmms_work_order_mapping "{\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_source_array_path\":\"\",\"p_column_mapping\":{\"external_id\":\"external_id\",\"title\":\"title\",\"asset_external_id\":\"asset_external_id\",\"wo_number\":\"wo_number\",\"status\":\"status\",\"completed_at\":\"completed_at\"},\"p_approve\":true,\"p_basis\":\"Named human administrator reviewed the exact work-order source mapping for C4.08.\"}")
noerr "$R"
R=$(rpc "$ADMIN" configure_cmms_read_source "{\"p_key\":\"$CONNECTOR_KEY\",\"p_name\":\"C4.08 CMMS proof\",\"p_system_kind\":\"generic_cmms\",\"p_endpoint_url\":\"https://example.com/cmms\",\"p_expected_interval_minutes\":60,\"p_credential_binding_ref\":\"vault://syncai/c408-cmms\",\"p_pagination_mode\":\"none\",\"p_pagination_next_path\":null,\"p_pagination_max_pages\":1,\"p_enabled\":true,\"p_basis\":\"C4.08 bounded read-only verification evidence source activated after mapping approval.\"}")
noerr "$R"
SOURCE=$(rpc "$ADMIN" get_cmms_read_source "{\"p_connector_key\":\"$CONNECTOR_KEY\"}")
HASH=$(field "$SOURCE" contract_hash); test -n "$HASH"
R=$(rpc "$ADMIN" begin_cmms_read_run "{\"p_connector_key\":\"$CONNECTOR_KEY\",\"p_expected_contract_hash\":\"$HASH\"}")
noerr "$R"; RUN_ID=$(field "$R" run_id); test -n "$RUN_ID"
R=$(rpc "$ADMIN" ingest_cmms_read_batch "{\"p_run_id\":\"$RUN_ID\",\"p_rows\":[{\"external_id\":\"$IMPORTED_WO_EXTERNAL\",\"title\":\"C4.08 completed seal inspection\",\"asset_external_id\":\"C408-ASSET-1\",\"wo_number\":\"C408-WO-001\",\"status\":\"completed\",\"completed_at\":\"$COMPLETED_AT\"},{\"external_id\":\"$STALE_WO_EXTERNAL\",\"title\":\"C4.08 stale historical inspection\",\"asset_external_id\":\"C408-ASSET-1\",\"wo_number\":\"C408-WO-STALE\",\"status\":\"completed\",\"completed_at\":\"2000-01-01T00:00:00Z\"},{\"external_id\":\"$OPEN_WO_EXTERNAL\",\"title\":\"C4.08 unfinished inspection\",\"asset_external_id\":\"C408-ASSET-1\",\"wo_number\":\"C408-WO-OPEN\",\"status\":\"in_progress\",\"completed_at\":\"$COMPLETED_AT\"}]}" )
noerr "$R"; test "$(field "$R" accepted)" = '3'
R=$(rpc "$ADMIN" finish_connector_run "{\"p_run_id\":\"$RUN_ID\",\"p_status\":\"success\",\"p_error\":null}")
noerr "$R"
IMPORTED_WO=$(psqlc "select id from work_orders where organization_id='$ORG' and source_system='$CONNECTOR_KEY' and external_id='$IMPORTED_WO_EXTERNAL'")
STALE_WO=$(psqlc "select id from work_orders where organization_id='$ORG' and source_system='$CONNECTOR_KEY' and external_id='$STALE_WO_EXTERNAL'")
OPEN_WO=$(psqlc "select id from work_orders where organization_id='$ORG' and source_system='$CONNECTOR_KEY' and external_id='$OPEN_WO_EXTERNAL'")
test -n "$IMPORTED_WO"
CMMS_OBL=$(psqlc "select id from verification_obligations where recommendation_id='$REC_CMMS'")
CMMS_NOT_BEFORE=$(psqlc "select created_at::text from verification_obligations where id='$CMMS_OBL'")
test "$(psqlc "select public.verification_work_order_eligible('$ORG','$ASSET','$IMPORTED_WO','$CMMS_NOT_BEFORE'::timestamptz)::text")" = 'true'
test "$(psqlc "select public.verification_work_order_eligible('$ORG','$ASSET','$STALE_WO','$CMMS_NOT_BEFORE'::timestamptz)::text")" = 'false'
test "$(psqlc "select public.verification_work_order_eligible('$ORG','$ASSET','$OPEN_WO','$CMMS_NOT_BEFORE'::timestamptz)::text")" = 'false'

# A manual completion of an imported open order cannot borrow its old accepted
# receipt. The source must itself have reported the completed-work facts.
psqlc "update work_orders set status='completed' where id='$OPEN_WO'" >/dev/null
test "$(psqlc "select public.verification_work_order_eligible('$ORG','$ASSET','$OPEN_WO','$CMMS_NOT_BEFORE'::timestamptz)::text")" = 'false'
psqlc "update work_orders set status='in_progress' where id='$OPEN_WO'; update work_orders set completed_at=completed_at+interval '1 second' where id='$IMPORTED_WO'" >/dev/null
test "$(psqlc "select public.verification_work_order_eligible('$ORG','$ASSET','$IMPORTED_WO','$CMMS_NOT_BEFORE'::timestamptz)::text")" = 'false'
psqlc "update work_orders set completed_at=completed_at-interval '1 second' where id='$IMPORTED_WO'" >/dev/null

CONNECTOR_ID=$(psqlc "select id from connectors where organization_id='$ORG' and connector_key='$CONNECTOR_KEY'")
MAPPING_ID=$(psqlc "select id from connector_entity_mappings where connector_id='$CONNECTOR_ID' and entity_type='work_order'")
psqlc "update connectors set enabled=false where id='$CONNECTOR_ID'" >/dev/null
test "$(psqlc "select public.verification_work_order_eligible('$ORG','$ASSET','$IMPORTED_WO','$CMMS_NOT_BEFORE'::timestamptz)::text")" = 'false'
psqlc "update connectors set enabled=true where id='$CONNECTOR_ID'; update connector_entity_mappings set status='draft' where id='$MAPPING_ID'" >/dev/null
test "$(psqlc "select public.verification_work_order_eligible('$ORG','$ASSET','$IMPORTED_WO','$CMMS_NOT_BEFORE'::timestamptz)::text")" = 'false'
psqlc "update connector_entity_mappings set status='approved' where id='$MAPPING_ID'; update connectors set direction='read_write',write_enabled=true where id='$CONNECTOR_ID'" >/dev/null
test "$(psqlc "select public.verification_work_order_eligible('$ORG','$ASSET','$IMPORTED_WO','$CMMS_NOT_BEFORE'::timestamptz)::text")" = 'false'
psqlc "update connectors set direction='read_only',write_enabled=false where id='$CONNECTOR_ID'" >/dev/null
test "$(psqlc "select public.verification_work_order_eligible('$ORG','$OTHER_ASSET','$IMPORTED_WO','$CMMS_NOT_BEFORE'::timestamptz)::text")" = 'false'

R=$(rpc "$RE" record_verification_result "{\"p_obligation_id\":\"$CMMS_OBL\",\"p_result\":\"achieved\",\"p_measured_note\":\"Completed inspection recorded zero visible leakage on the exact asset.\",\"p_evidence_id\":\"$EVIDENCE_VALID\",\"p_work_order_id\":\"$IMPORTED_WO\"}")
expect_contains "$R" 'exactly one governed source'
R=$(rpc "$RE" record_verification_result "{\"p_obligation_id\":\"$CMMS_OBL\",\"p_result\":\"achieved\",\"p_measured_note\":\"Completed inspection recorded zero visible leakage on the exact asset.\",\"p_evidence_id\":null,\"p_work_order_id\":\"$IMPORTED_WO\"}")
noerr "$R"; test "$(field "$R" outcome)" = 'recorded'

R=$(rpc "$RE" record_verification_result "{\"p_obligation_id\":\"$LEGACY_OBL\",\"p_result\":\"achieved\",\"p_measured_note\":\"Exact-asset completed inspection recorded zero visible leakage.\",\"p_evidence_id\":null,\"p_work_order_id\":\"$IMPORTED_WO\"}")
noerr "$R"

echo '— persistence walls refuse direct plan, evidence-link and result forgery —'
OUT=$(sql_must_fail "update recommendations set verification_due_date=current_date+90 where id='$REC_NOPLAN';")
grep -q 'record_recommendation_verification_plan' <<<"$OUT"
OUT=$(sql_must_fail "update verification_obligations set evidence_id='$EVIDENCE_VALID' where id='$CMMS_OBL';")
grep -q 'record_verification_result' <<<"$OUT"
OUT=$(sql_must_fail "update verification_obligations set measured_note='forged replacement measurement' where id='$EVIDENCE_OBL';")
grep -q 'frozen once' <<<"$OUT"

test "$(psqlc "select count(*) from learning_events where recommendation_id='$REC_EVIDENCE' and event_type='verification_failed'")" = '1'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='verification_result' and event_data->>'recommendation_id' in ('$REC_EVIDENCE','$REC_CMMS','$REC_LEGACY') and event_data->>'operational_authorization'='false'")" = '3'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='recommendation_verification_plan' and event_data->>'operational_authorization'='false'")" -ge 3
test "$(psqlc "select (direction='read_only' and not write_enabled)::text from connectors where id='$CONNECTOR_ID'")" = 'true'
test "$(psqlc "select count(*) from verification_obligations where id in ('$EVIDENCE_OBL','$CMMS_OBL','$LEGACY_OBL') and status='completed' and ((evidence_id is not null)::int+(work_order_id is not null)::int)=1")" = '3'
POSTURE=$(rpc "$RE" get_verification_posture '{}')
test "$(field "$POSTURE" evidenceBackedCompleted)" -ge 3
echo 'C4.08 verification-evidence smoke passed: explicit_plan=true no_assumed_date=true named_owner=true tenant_wall=true ai_refused=true exact_one_source=true independent_evidence=true governed_cmms_lineage=true legacy_replanned=true immutable_result=true learning=true audit=true no_write_authority=true'

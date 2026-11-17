#!/usr/bin/env bash
# E5.08/E5.10/E5.11 — governed exact-version model monitoring.
set -euo pipefail
trap 'echo "Model-performance governance smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}" "${ANON_KEY:?missing ANON_KEY}"

ORG='11111111-1111-1111-1111-111111111111'
FOREIGN_ORG='e5081100-0000-4000-8000-000000000001'
FOREIGN_UID='e5081100-0000-4000-8000-000000000002'
REF_EVIDENCE='e5081100-0000-4000-8000-000000000003'
CURRENT_EVIDENCE='e5081100-0000-4000-8000-000000000004'
REVIEW_EVIDENCE='e5081100-0000-4000-8000-000000000005'
FOREIGN_EVIDENCE='e5081100-0000-4000-8000-000000000006'
RUN_KEY="model-monitoring-$(date +%s)-$$"

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
field(){ BODY="$1" KEY="$2" python3 -c "import json,os; v=json.loads(os.environ['BODY']).get(os.environ['KEY']); print('' if v is None else v)"; }
noerr(){ BODY="$1" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); bad=isinstance(x,dict) and (x.get('error') or x.get('code') or x.get('message') or x.get('answered') is False); print(x,file=sys.stderr) if bad else None; sys.exit(1) if bad else None"; }
expect_error(){ BODY="$1" WANT="$2" python3 -c "import json,os,sys; x=json.loads(os.environ['BODY']); e=str(x.get('error') or x.get('refusal') or ''); sys.exit(0) if os.environ['WANT'].lower() in e.lower() else (print('expected',os.environ['WANT'],'got',x) or sys.exit(1))"; }
sql_must_fail(){ local out rc; set +e; out=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>&1); rc=$?; set -e; test "$rc" != 0; printf '%s' "$out"; }

ASSESSOR=$(token 'demo@syncai.ca' 'Demo123!@#')
REVIEWER=$(token 'admin@syncai.ca' 'Admin123!@#')
test -n "$ASSESSOR"; test -n "$REVIEWER"
ASSESSOR_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='demo@syncai.ca'")
REVIEWER_ID=$(psqlc "select id from user_profiles where organization_id='$ORG' and email='admin@syncai.ca'")
test -n "$ASSESSOR_ID"; test -n "$REVIEWER_ID"; test "$ASSESSOR_ID" != "$REVIEWER_ID"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'PSQL'
do $seed$
begin
  insert into organizations(id,name) values('e5081100-0000-4000-8000-000000000001','E5 model-monitoring foreign tenant')
    on conflict(id) do nothing;
  if not exists(select 1 from auth.users where email='model-monitoring-foreign@syncai.ca') then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
      recovery_token,email_change,email_change_token_new,email_change_token_current,
      phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000','e5081100-0000-4000-8000-000000000002',
      'authenticated','authenticated','model-monitoring-foreign@syncai.ca',
      extensions.crypt('ForeignModel123!@#',extensions.gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{"full_name":"E5 foreign admin"}',
      '','','','','','','','');
  end if;
  if not exists(select 1 from auth.identities where user_id='e5081100-0000-4000-8000-000000000002') then
    insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
    values(gen_random_uuid(),'e5081100-0000-4000-8000-000000000002',
      'e5081100-0000-4000-8000-000000000002',
      '{"sub":"e5081100-0000-4000-8000-000000000002","email":"model-monitoring-foreign@syncai.ca"}',
      'email',now(),now(),now());
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values('e5081100-0000-4000-8000-000000000002','e5081100-0000-4000-8000-000000000001',
    'model-monitoring-foreign@syncai.ca','E5 foreign admin','admin')
  on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role;
end $seed$;
PSQL
FOREIGN=$(token 'model-monitoring-foreign@syncai.ca' 'ForeignModel123!@#')
test -n "$FOREIGN"

# A dedicated non-engineering statistical model keeps this smoke from changing
# a product model that later tests may consume.
MODEL=$(psqlc "
  insert into model_register(organization_id,model_key,version,model_kind,purpose,
    approved_for,approved_on,approved_by,review_due,human_in_loop,
    verification_reference,limitations,lifecycle_state,production_eligible,
    training_data,validation_summary,applicability_summary,approval_status,
    decision_relevant,current_for_decisions,submitted_by,submitted_at,reviewed_at,review_basis)
  values('$ORG','$RUN_KEY','1.0.0','statistical',
    'CI exact-version model monitoring and independent disposition fixture.',
    array['model monitoring'],current_date,'$REVIEWER_ID',current_date+365,true,
    'scripts/ci-model-performance-governance-smoke.sh',
    'CI-only model; it has no operational authority.','production_eligible',true,
    '{\"status\":\"recorded\",\"population\":\"CI operational cohorts\"}',
    '{\"status\":\"recorded\",\"method\":\"held-out CI evidence\"}',
    '{\"approvedFor\":[\"model monitoring\"]}','approved',true,true,
    '$ASSESSOR_ID',now(),now(),'Dedicated CI model approved only for monitoring control proof.')
  returning id")
test -n "$MODEL"

psqlc "
  insert into evidence_items(id,organization_id,source_system,evidence_type,
    description,evidence_class,source_reference) values
    ('$REF_EVIDENCE','$ORG','ci-model-monitoring','dataset',
      'Verified reference population extract.','MEASURED','$RUN_KEY-reference'),
    ('$CURRENT_EVIDENCE','$ORG','ci-model-monitoring','dataset',
      'Verified current population extract.','MEASURED','$RUN_KEY-current'),
    ('$REVIEW_EVIDENCE','$ORG','ci-model-monitoring','review',
      'Verified independent model monitoring review package.','DOCUMENTED','$RUN_KEY-review'),
    ('$FOREIGN_EVIDENCE','$FOREIGN_ORG','ci-model-monitoring','dataset',
      'Foreign tenant population evidence.','MEASURED','$RUN_KEY-foreign')
  on conflict(id) do nothing;
" >/dev/null
for item in "$REF_EVIDENCE" "$CURRENT_EVIDENCE" "$REVIEW_EVIDENCE"; do
  VERIFIED=$(rpc "$REVIEWER" verify_evidence_item "{\"p_evidence_id\":\"$item\",\"p_method\":\"Independent source reconciliation\",\"p_outcome\":\"verified\",\"p_note\":\"A named reviewer reconciled the retained monitoring source and its stated population window.\"}")
  noerr "$VERIFIED"
done
FOREIGN_VERIFIED=$(rpc "$FOREIGN" verify_evidence_item "{\"p_evidence_id\":\"$FOREIGN_EVIDENCE\",\"p_method\":\"Independent foreign source reconciliation\",\"p_outcome\":\"verified\",\"p_note\":\"Foreign evidence remains inside the foreign tenant boundary.\"}")
noerr "$FOREIGN_VERIFIED"

# Exact-version field outcomes: 30 outcomes across two operational cohorts.
# One cohort is deliberately badly calibrated so the screen must escalate.
psqlc "
  insert into model_predictions(organization_id,model_key,model_version,
    predicted_at,predicted_probability,horizon_days,outcome,outcome_recorded_at,
    model_register_id,cohort_context,counterfactual_review)
  select '$ORG','$RUN_KEY','1.0.0','2026-05-15 12:00:00+00'::timestamptz,
    case when g<=15 then 0.1 else 0.9 end,30,
    case when g=1 then true else false end,now(),$MODEL,
    jsonb_build_object('monitoringCohort',case when g<=15 then 'steady' else 'cycling' end),
    jsonb_build_object('observedBasis','CI retained outcome','predictionAssessment','CI comparison','designFeedback','CI monitoring only')
  from generate_series(1,30) g;
" >/dev/null

REF=$(rpc "$ASSESSOR" capture_model_input_snapshot "{\"p_model_register_id\":$MODEL,\"p_feature\":\"operating_regime\",\"p_snapshot_label\":\"$RUN_KEY-reference\",\"p_window_start\":\"2026-01-01\",\"p_window_end\":\"2026-03-31\",\"p_distribution\":{\"steady\":80,\"cycling\":20},\"p_is_reference\":true,\"p_evidence_item_id\":\"$REF_EVIDENCE\"}")
noerr "$REF"; REF_ID=$(field "$REF" snapshotId); test -n "$REF_ID"
CURRENT=$(rpc "$ASSESSOR" capture_model_input_snapshot "{\"p_model_register_id\":$MODEL,\"p_feature\":\"operating_regime\",\"p_snapshot_label\":\"$RUN_KEY-current\",\"p_window_start\":\"2026-04-01\",\"p_window_end\":\"2026-06-30\",\"p_distribution\":{\"steady\":50,\"cycling\":50},\"p_is_reference\":false,\"p_evidence_item_id\":\"$CURRENT_EVIDENCE\"}")
noerr "$CURRENT"; CURRENT_ID=$(field "$CURRENT" snapshotId); test -n "$CURRENT_ID"

CROSS=$(rpc "$ASSESSOR" capture_model_input_snapshot "{\"p_model_register_id\":$MODEL,\"p_feature\":\"operating_regime\",\"p_snapshot_label\":\"$RUN_KEY-cross\",\"p_window_start\":\"2026-07-01\",\"p_window_end\":\"2026-07-31\",\"p_distribution\":{\"steady\":1,\"cycling\":1},\"p_is_reference\":false,\"p_evidence_item_id\":\"$FOREIGN_EVIDENCE\"}")
expect_error "$CROSS" 'same-tenant independently verified'

ASSESSMENT=$(rpc "$ASSESSOR" run_model_performance_assessment "{\"p_model_register_id\":$MODEL,\"p_reference_snapshot_id\":$REF_ID,\"p_current_snapshot_id\":$CURRENT_ID,\"p_assessment_basis\":\"The same operational-state taxonomy and verified extraction method cover both non-overlapping periods.\"}")
noerr "$ASSESSMENT"; ASSESSMENT_ID=$(field "$ASSESSMENT" assessmentId); test -n "$ASSESSMENT_ID"
BODY="$ASSESSMENT" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY'])
assert x['driftStatus']=='significant' and float(x['psi'])>=0.25,x
assert x['calibrationStatus']=='underperforming',x
assert x['biasScreenStatus']=='review_required',x
assert x['alertStatus']=='review_required' and x['humanReviewRequired'] is True,x
assert x['operationalAuthorization'] is False,x
PY

SELF=$(rpc "$ASSESSOR" review_model_performance_assessment "{\"p_assessment_id\":\"$ASSESSMENT_ID\",\"p_decision\":\"require_revalidation\",\"p_review_note\":\"The assessor must not independently disposition the same retained result.\",\"p_evidence_item_id\":\"$REVIEW_EVIDENCE\"}")
expect_error "$SELF" 'assessor cannot independently disposition'
REVIEW=$(rpc "$REVIEWER" review_model_performance_assessment "{\"p_assessment_id\":\"$ASSESSMENT_ID\",\"p_decision\":\"require_revalidation\",\"p_review_note\":\"Independent review confirms material drift and cohort performance disparity require model revalidation.\",\"p_evidence_item_id\":\"$REVIEW_EVIDENCE\"}")
noerr "$REVIEW"
test "$(field "$REVIEW" lifecycleState)" = 'revalidation_required'
test "$(psqlc "select lifecycle_state||'|'||production_eligible||'|'||current_for_decisions from model_register where id=$MODEL")" = 'revalidation_required|false|false'

WORKSPACE=$(rpc "$REVIEWER" get_model_monitoring_workspace '{}')
BODY="$WORKSPACE" MODEL="$MODEL" ASSESSMENT_ID="$ASSESSMENT_ID" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); mid=int(os.environ['MODEL'])
assert 'screening alerts' in x['boundary'] and 'different named human' in x['boundary']
assert any(m['id']==mid and m['lifecycleState']=='revalidation_required' for m in x['models'])
a=next(a for a in x['assessments'] if a['id']==os.environ['ASSESSMENT_ID'])
assert a['review']['decision']=='require_revalidation'
assert a['predictionCount']==30 and a['outcomeCount']==30 and a['cohortCount']==2
PY
FOREIGN_WORKSPACE=$(rpc "$FOREIGN" get_model_monitoring_workspace '{}')
BODY="$FOREIGN_WORKSPACE" MODEL="$MODEL" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); mid=int(os.environ['MODEL'])
assert all(m['id']!=mid for m in x['models'])
assert all(s['modelRegisterId']!=mid for s in x['snapshots'])
assert all(a['modelRegisterId']!=mid for a in x['assessments'])
PY

OUT=$(sql_must_fail "insert into model_input_snapshots(organization_id,model_key,feature,snapshot_label,distribution,is_reference,model_register_id) values('$ORG','$RUN_KEY','bypass','bypass','{\"a\":1,\"b\":1}',false,$MODEL);")
grep -qi 'governed named-human workflow' <<<"$OUT"
OUT=$(sql_must_fail "update model_monitoring_assessments set alert_status='no_alert' where id='$ASSESSMENT_ID';")
grep -qi 'governed named-human workflow' <<<"$OUT"
OUT=$(sql_must_fail "delete from model_monitoring_reviews where assessment_id='$ASSESSMENT_ID';")
grep -qi 'retained and cannot be deleted' <<<"$OUT"

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_model_monitoring_workspace" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type in ('model_input_snapshot','model_performance_assessment','model_performance_review') and (event_data->>'modelRegisterId')::bigint=$MODEL")" -ge 4

echo 'Model-performance governance smoke passed: exact_version=true outcomes=30 drift=significant calibration=underperforming cohort_screen=review_required independent_review=true revalidation=true tenant_wall=true immutable=true operational_authority=false'

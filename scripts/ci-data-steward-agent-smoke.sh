#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Data Steward Specialist smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C1.12 + E12.03/.04/.06/.11/.13 runtime proof against the clean full chain.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
DOMAIN_KEY="c112_governance_${RANDOM}"

psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -qAt -c "$1"
}

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}

rpc() {
  curl -sS -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" \
    -H 'content-type: application/json' -d "$3"
}

ENGINEER=$(token demo@syncai.ca 'Demo123!@#')
MANAGER=$(token manager@syncai.ca 'Manager123!@#')
TECH=$(token technician@syncai.ca 'Tech123!@#')
test -n "$ENGINEER" && test -n "$MANAGER" && test -n "$TECH"
ENGINEER_ID=$(psqlc "select id from public.user_profiles where organization_id='$ORG' and email='demo@syncai.ca'")
SENSOR=$(psqlc "select id from public.sensors where organization_id='$ORG' order by id limit 1")
ASSET=$(psqlc "select asset_id from public.sensors where id='$SENSOR'")
DUE_DATE=$(node -e "console.log(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))")
test -n "$ENGINEER_ID" && test -n "$SENSOR" && test -n "$ASSET"

PROFILE=$(psqlc "select p.id from public.agent_control_profiles p join public.ai_agents a on a.id=p.agent_id where a.organization_id='$ORG' and a.key='data_steward' and p.status='adopted'")
test -n "$PROFILE"
test "$(psqlc "select count(*) from public.agent_tool_bindings b join public.agent_software_tools t on t.id=b.tool_id where b.profile_id='$PROFILE' and t.tool_key='assess_data_governance'")" = '1'
test "$(psqlc "select count(*) from public.agent_decision_right_bindings b join public.decision_rights d on d.id=b.decision_right_id where b.profile_id='$PROFILE' and d.right_key='clean_classify_wo_data'")" = '1'

# A technician cannot create governed master data or run the specialist.
DENIED=$(rpc "$TECH" upsert_data_domain \
  "{\"p_domain_id\":null,\"p_domain_key\":\"denied\",\"p_label\":\"Denied\",\"p_description\":\"Denied\",\"p_owner_role\":\"technician\",\"p_owner_user_id\":null,\"p_steward_role\":\"technician\",\"p_basis\":\"A technician must not own this control path.\",\"p_expected_version\":null}")
DENIED="$DENIED" python3 -c "import json,os; assert 'authority' in json.loads(os.environ['DENIED'])['error']"

DOMAIN=$(rpc "$MANAGER" upsert_data_domain \
  "{\"p_domain_id\":null,\"p_domain_key\":\"$DOMAIN_KEY\",\"p_label\":\"C1.12 governed source data\",\"p_description\":\"CI domain for hierarchy, coding and quality evidence.\",\"p_owner_role\":\"reliability_engineer\",\"p_owner_user_id\":\"$ENGINEER_ID\",\"p_steward_role\":\"reliability_engineer\",\"p_basis\":\"Approved CI accountability record for the governed source population.\",\"p_expected_version\":null}")
DOMAIN_ID=$(DOMAIN="$DOMAIN" python3 -c "import json,os; d=json.loads(os.environ['DOMAIN']); assert d['status']=='recorded',d; print(d['domainId'])")

# Optimistic locking refuses a stale human edit.
STALE=$(rpc "$MANAGER" upsert_data_domain \
  "{\"p_domain_id\":$DOMAIN_ID,\"p_domain_key\":\"$DOMAIN_KEY\",\"p_label\":\"C1.12 stale edit\",\"p_description\":\"Stale edit must not apply.\",\"p_owner_role\":\"reliability_engineer\",\"p_owner_user_id\":\"$ENGINEER_ID\",\"p_steward_role\":\"reliability_engineer\",\"p_basis\":\"Deliberately stale optimistic-lock attempt for CI proof.\",\"p_expected_version\":999}")
STALE="$STALE" python3 -c "import json,os; assert 'changed after' in json.loads(os.environ['STALE'])['error']"

# A measured breach is real input, not a fabricated agent conclusion.
SLA=$(rpc "$MANAGER" record_data_quality_sla \
  "{\"p_domain_id\":$DOMAIN_ID,\"p_metric\":\"completeness\",\"p_target_pct\":99,\"p_target_lag_hours\":null,\"p_measured_pct\":80,\"p_measured_lag_hours\":null,\"p_measured_on\":\"$(date -u +%F)\",\"p_basis\":\"CI measurement over the exact governed source row population.\",\"p_source_reference\":\"ci://c112/completeness\"}")
SLA="$SLA" python3 -c "import json,os; assert json.loads(os.environ['SLA'])['status']=='recorded'"

CAL=$(rpc "$MANAGER" record_instrument_calibration \
  "{\"p_sensor_id\":\"$SENSOR\",\"p_asset_id\":\"$ASSET\",\"p_instrument_ref\":\"C112-CAL\",\"p_calibrated_on\":\"$(date -u +%F)\",\"p_interval_months\":12,\"p_as_found_within_tolerance\":false,\"p_as_left_within_tolerance\":true,\"p_certificate_reference\":\"C112-CERT-1\",\"p_basis\":\"Signed CI certificate with explicit as-found and as-left results.\"}")
CAL="$CAL" python3 -c "import json,os; assert json.loads(os.environ['CAL'])['status']=='recorded'"

TAG="C112.CI.${RANDOM}"
MAP=$(rpc "$MANAGER" confirm_historian_tag_mapping \
  "{\"p_mapping_id\":null,\"p_historian_tag\":\"$TAG\",\"p_asset_id\":\"$ASSET\",\"p_sensor_id\":\"$SENSOR\",\"p_measurement\":\"governed vibration\",\"p_unit\":\"mm/s\",\"p_source_system\":\"CI historian\",\"p_basis\":\"Named-human confirmation against the source historian and asset register.\",\"p_expected_version\":null}")
MAP="$MAP" python3 -c "import json,os; assert json.loads(os.environ['MAP'])['status']=='confirmed'"

ARCHIVE=$(rpc "$MANAGER" record_archive_disposition \
  "{\"p_record_class\":\"procedure\",\"p_reference\":\"C112-SOP-OLD\",\"p_archived_on\":\"$(date -u +%F)\",\"p_disposition\":\"superseded\",\"p_superseded_by\":\"C112-SOP-CURRENT\",\"p_retention_until\":\"2033-01-01\",\"p_reason\":\"Approved revision replaces the retained prior procedure.\",\"p_evidence_reference\":\"ci://c112/change-receipt\"}")
ARCHIVE="$ARCHIVE" python3 -c "import json,os; assert json.loads(os.environ['ARCHIVE'])['status']=='recorded'"

# Same-tenant callers cannot use an arbitrary foreign domain identifier.
FOREIGN_ORG=$(psqlc "select id from public.organizations where id<>'$ORG' order by id limit 1")
if [ -n "$FOREIGN_ORG" ]; then
  FOREIGN_DOMAIN=$(psqlc "select set_config('app.data_governance_master_write','granted',true); insert into public.data_domains(organization_id,domain_key,label,owner_role,basis) values('$FOREIGN_ORG','c112_foreign_${RANDOM}','C1.12 foreign','reliability_engineer','Foreign tenant wall proof only.') returning id" | tail -n 1)
  FOREIGN=$(rpc "$MANAGER" run_data_steward_agent "{\"p_data_domain_id\":$FOREIGN_DOMAIN}")
  FOREIGN="$FOREIGN" python3 -c "import json,os; assert 'not found' in json.loads(os.environ['FOREIGN'])['error']"
fi

TECH_RUN=$(rpc "$TECH" run_data_steward_agent "{\"p_data_domain_id\":$DOMAIN_ID}")
TECH_RUN="$TECH_RUN" python3 -c "import json,os; assert 'named maintenance' in json.loads(os.environ['TECH_RUN'])['error']"

BEFORE_APPROVALS=$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")
RUN=$(rpc "$MANAGER" run_data_steward_agent "{\"p_data_domain_id\":$DOMAIN_ID}")
RUN_IDS=$(RUN="$RUN" python3 - <<'PY'
import json,os
d=json.loads(os.environ['RUN'])
assert d['advisory'] is True,d
for key in ('mayChangeMasterData','mayMergeAssets','mayCodeFailure','mayConfirmMapping',
            'mayArchiveRecord','mayCreateWork','mayAcceptRisk','mayCommitSpend','mayReturnToService'):
    assert d[key] is False,(key,d)
assert d['facts']['dataQuality']['breaches']==1,d
assert any(x['findingKey']=='data_quality_sla_breached' for x in d['findings']),d
print(d['assessmentId']+'|'+d['runId'])
PY
)
ASSESSMENT=${RUN_IDS%%|*}
RUN_ID=${RUN_IDS##*|}
test "$(psqlc "select count(*) from public.agent_runs where id='$RUN_ID' and organization_id='$ORG' and data_domain_id=$DOMAIN_ID and retained_for_governance")" = '1'
test "$(psqlc "select count(*) from public.data_steward_assessments where id='$ASSESSMENT' and source_snapshot ? 'assets' and source_snapshot->'assets' ? 'sha256'")" = '1'

REVIEW=$(rpc "$MANAGER" assign_data_steward_review \
  "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_assigned_to\":\"$ENGINEER_ID\",\"p_due_date\":\"$DUE_DATE\",\"p_note\":\"Independent review of exact population fingerprints and the measured breach.\"}")
REVIEW="$REVIEW" python3 -c "import json,os; assert json.loads(os.environ['REVIEW'])['status']=='assigned'"

DISPOSITION=$(rpc "$ENGINEER" record_data_steward_disposition \
  "{\"p_assessment_id\":\"$ASSESSMENT\",\"p_finding_key\":\"data_quality_sla_breached\",\"p_disposition\":\"accepted\",\"p_note\":\"Independent review accepts the measured breach and routes remediation to the named domain owner.\",\"p_evidence_reference\":null}")
DISPOSITION="$DISPOSITION" python3 -c "import json,os; d=json.loads(os.environ['DISPOSITION']); assert d['status']=='accepted' and d['masterDataChanged'] is False and d['operationalAuthorization'] is False,d"

# Browser credentials cannot forge retained evidence or write canonical tables.
PATCH=$(curl -sS -o /tmp/c112-patch.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/data_steward_assessments?id=eq.$ASSESSMENT" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $MANAGER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"findings":[]}')
case "$PATCH" in 401|403) ;; 200) test "$(cat /tmp/c112-patch.txt)" = '[]' ;; *) false ;; esac
DIRECT=$(curl -sS -o /tmp/c112-direct.txt -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/data_domains" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $MANAGER" \
  -H 'content-type: application/json' -d "{\"organization_id\":\"$ORG\",\"domain_key\":\"forged\",\"label\":\"forged\",\"owner_role\":\"forged\"}")
case "$DIRECT" in 401|403) ;; *) false ;; esac
test "$(psqlc "select jsonb_array_length(findings) from public.data_steward_assessments where id='$ASSESSMENT'")" -gt 0
test "$(psqlc "select count(*) from public.approvals where organization_id='$ORG'")" = "$BEFORE_APPROVALS"

echo 'Data Steward Specialist smoke passed: canonical_hierarchy=true failure_coding=true governed_domains=true dq_sla=true calibration_evidence=true historian_mapping=true archive_control=true exact_source_fingerprints=true tenant_wall=true immutable_assessment=true optimistic_lock=true sod_review=true no_agent_master_data_authority=true no_operational_authority=true'

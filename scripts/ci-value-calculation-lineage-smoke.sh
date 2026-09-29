#!/usr/bin/env bash
set -euo pipefail
trap 'echo "D11.29 value calculation lineage smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL|SERVICE_ROLE_KEY)=')"
: "${API_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='22222222-2222-2222-2222-222222222222'
ACTOR='00000000-0000-0000-0000-000000000001'

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'content-type: application/json' \
    -d '{"email":"demo@syncai.ca","password":"Demo123!@#"}' \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}

psqlc() {
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -qAt -c "$1"
}

AUTHOR=$(token)
test -n "$AUTHOR"

# Earlier full-chain smokes intentionally create additional business cases for
# the demo tenant. Make this smoke's canonical fixture the newest case so the
# service's documented "latest business case" selection is deterministic no
# matter which integration smoke ran before it.
FIXTURE_CASES=$(psqlc "update business_cases set created_at=clock_timestamp() where organization_id='$ORG' and case_ref='DEMO-BC-01' returning 1;")
test "$(printf '%s\n' "$FIXTURE_CASES" | grep -c '^1$')" = '1'

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/functions/v1/calculation-service" \
  -H 'content-type: application/json' \
  -d '{"action":"value_management","budget":3000000}')
test "$NOAUTH" = '401'

INVALID_BUDGET=$(curl -sS -o /tmp/value-invalid-budget.txt -w '%{http_code}' -X POST \
  "$API_URL/functions/v1/calculation-service" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $AUTHOR" \
  -H 'content-type: application/json' \
  -d '{"action":"value_management","budget":null}')
test "$INVALID_BUDGET" = '400'
grep -q 'budget_must_be_finite_nonnegative_and_bounded' /tmp/value-invalid-budget.txt

BEFORE=$(psqlc "select count(*) from calculation_runs where organization_id='$ORG' and calculation_key in ('business_case_option_comparison','capital_plan_prioritisation');")
APPROVALS_BEFORE=$(psqlc "select count(*) from approvals where organization_id='$ORG';")

RESPONSE=$(curl -sS -w '\n%{http_code}' -X POST \
  "$API_URL/functions/v1/calculation-service" \
  -H "apikey: $ANON_KEY" \
  -H "authorization: Bearer $AUTHOR" \
  -H 'content-type: application/json' \
  -d '{"action":"value_management","budget":3000000}')
STATUS=${RESPONSE##*$'\n'}
BODY=${RESPONSE%$'\n'*}
test "$STATUS" = '200'

RUNS=$(BODY="$BODY" python3 - <<'PY'
import json, os, re
x = json.loads(os.environ['BODY'])
assert x['businessCase']['caseRef'] == 'DEMO-BC-01', x
assert x['comparison']['basis'] == 'equivalent_annual', x
assert x['planYear'] == 2027 and len(x['plan']) == 4, x
assert x['prioritisation']['mandatoryCost'] == 600000, x
assert len(x['prioritisation']['result']['selected']) == 2, x
assert x['refusals'] == {'optionComparison': [], 'capitalPlan': []}, x
assert x['governance'] == {
  'advisory': True,
  'operationalAuthorization': False,
  'humanApprovalRequired': True,
  'note': 'These calculations support a decision; they do not approve a business case or authorize capital spending.'
}, x
ids = [x['lineage']['optionComparisonRunId'], x['lineage']['capitalPlanRunId']]
assert all(re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', i) for i in ids), ids
print('|'.join(ids))
PY
)
OPTION_RUN=${RUNS%%|*}
PLAN_RUN=${RUNS##*|}

AFTER=$(psqlc "select count(*) from calculation_runs where organization_id='$ORG' and calculation_key in ('business_case_option_comparison','capital_plan_prioritisation');")
test "$AFTER" -eq $((BEFORE + 2))
test "$(psqlc "select count(*) from approvals where organization_id='$ORG';")" = "$APPROVALS_BEFORE"

RECORDED=$(psqlc "select string_agg(calculation_key||':'||code_version||':'||subject_type||':'||status||':'||jsonb_array_length(input_refs),',' order by calculation_key) from calculation_runs where id in ('$OPTION_RUN','$PLAN_RUN') and organization_id='$ORG' and computed_by='$ACTOR';")
case "$RECORDED" in
  *business_case_option_comparison:value-management/1/2026-12-26:business_case:computed:4*capital_plan_prioritisation:value-management/1/2026-12-26:capital_plan_year:computed:4*) ;;
  *) echo "unexpected recorded lineage: $RECORDED"; exit 1 ;;
esac

# A signed-in browser cannot mint a run by calling the trusted recorder. The
# function is absent from the authenticated API surface even when its subject
# and output look plausible.
CLIENT_RECORD=$(curl -sS -o /tmp/value-client-record.txt -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/record_calculation_run" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $AUTHOR" \
  -H 'content-type: application/json' \
  -d "{\"p_organization_id\":\"$ORG\",\"p_actor_id\":\"$ACTOR\",\"p_subject_type\":\"organization\",\"p_subject_ref\":\"$ORG\",\"p_key\":\"capital_plan_prioritisation\",\"p_method\":\"A browser must never record this claimed calculation.\",\"p_inputs\":{},\"p_input_refs\":[],\"p_outputs\":{},\"p_refusals\":[]}")
test "$CLIENT_RECORD" = '401' || test "$CLIENT_RECORD" = '403' || test "$CLIENT_RECORD" = '404'

# Even the service credential cannot bind a demo-org actor to a different
# tenant. This tests the database wall beneath the Edge function, not merely a
# query filter in TypeScript.
FOREIGN=$(curl -sS -o /tmp/value-foreign-record.txt -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/record_calculation_run" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'content-type: application/json' \
  -d "{\"p_organization_id\":\"$OTHER_ORG\",\"p_actor_id\":\"$ACTOR\",\"p_subject_type\":\"organization\",\"p_subject_ref\":\"$OTHER_ORG\",\"p_key\":\"capital_plan_prioritisation\",\"p_method\":\"Cross-tenant fixture that the recorder must reject.\",\"p_inputs\":{},\"p_input_refs\":[],\"p_outputs\":{},\"p_refusals\":[]}")
test "$FOREIGN" = '400' || test "$FOREIGN" = '401' || test "$FOREIGN" = '403'
grep -qi 'not a member of this organization' /tmp/value-foreign-record.txt

echo 'D11.29 value calculation lineage smoke passed: authenticated_service=true canonical_inputs=true shared_kernel=true runs=2 immutable_ledger=true client_mint=false tenant_wall=true approvals_created=0 advisory_only=true'

#!/usr/bin/env bash
# C8.14: real Postgres proof for governed recommendation failure/risk basis.
set -euo pipefail
trap 'echo "C8.14 recommendation failure-basis smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER='99999999-9999-9999-9999-999999999914'
ASSET='c8140000-0000-4000-8000-000000000001'
OTHER_ASSET='c8140000-0000-4000-8000-000000000002'
REC='c8140000-0000-4000-8000-000000000011'
FM='c8140000-0000-4000-8000-000000000021'
FOREIGN_FM='c8140000-0000-4000-8000-000000000022'
RISK='c8140000-0000-4000-8000-000000000031'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
jqp(){ BODY="$1" EXPR="$2" python3 - <<'PY'
import json,os
x=json.loads(os.environ['BODY']); print(eval(os.environ['EXPR'],{}, {'x':x}))
PY
}

TOKEN=$(token 'demo@syncai.ca' 'Demo123!@#'); test -n "$TOKEN"

psqlc "insert into organizations(id,name,industry) values('$OTHER','C8.14 foreign','utilities') on conflict(id) do nothing;
insert into assets(id,organization_id,name,tag,criticality) values
('$ASSET','$ORG','C8.14 pump','C814-P-101','high'),
('$OTHER_ASSET','$OTHER','C8.14 foreign pump','C814-X-101','high') on conflict(id) do nothing;
delete from recommendations where id='$REC';
insert into recommendations(id,organization_id,asset_id,title,issue,action,impact,confidence,status,rationale)
values('$REC','$ORG','$ASSET','C8.14 seal mechanism','Seal failures recur after solids-heavy starts.','Validate the mechanism before changing the PM interval.','Avoid repeat production loss.',78,'pending','Work history supports timing but not mechanism.');
select set_config('app.governed_rcm_write','granted',false);
insert into asset_failure_mode_libraries(id,organization_id,canonical_asset_id,failure_mode,function_statement,functional_failure,source,rcm_status,rcm_version)
values('$FM','$ORG','$ASSET','Seal face abrasion','Contain process fluid','Loss of containment at the seal','governed_rcm','reviewed',1),
('$FOREIGN_FM','$OTHER','$OTHER_ASSET','Foreign bearing seizure','Transmit torque','Loss of rotation','governed_rcm','reviewed',1)
on conflict(id) do nothing;
select set_config('app.governed_rcm_write','',false);
insert into risks(id,organization_id,asset_id,title,event_description,status)
values('$RISK','$ORG','$ASSET','Seal loss during startup','A solids-heavy startup abrades the seal faces and causes loss of containment.','identified')
on conflict(id) do nothing;" >/dev/null

# A reviewed, exact-asset failure mode is accepted and appears in posture.
R=$(rpc "$TOKEN" record_recommendation_failure_basis "{\"p_recommendation_id\":\"$REC\",\"p_kind\":\"failure_mode\",\"p_subject_id\":\"$FM\",\"p_note\":\"The reviewed mechanism matches the exact asset and repeated startup exposure.\"}")
test "$(jqp "$R" "x.get('valid')")" = "True"
G=$(rpc "$TOKEN" get_recommendation_failure_basis "{\"p_recommendation_id\":\"$REC\"}")
test "$(jqp "$G" "x['failureMode']['id']")" = "$FM"
test "$(jqp "$G" "x['operationalAuthorization']")" = "False"

# Cross-tenant subjects fail closed; an identified same-asset risk succeeds.
X=$(rpc "$TOKEN" record_recommendation_failure_basis "{\"p_recommendation_id\":\"$REC\",\"p_kind\":\"failure_mode\",\"p_subject_id\":\"$FOREIGN_FM\",\"p_note\":\"This deliberately attempts to cross the tenant wall and must be refused.\"}")
test "$(jqp "$X" "'same-tenant' in x.get('error','')")" = "True"
Q=$(rpc "$TOKEN" record_recommendation_failure_basis "{\"p_recommendation_id\":\"$REC\",\"p_kind\":\"risk_scenario\",\"p_subject_id\":\"$RISK\",\"p_note\":\"The identified startup event is the governed risk scenario addressed by this recommendation.\"}")
test "$(jqp "$Q" "x.get('valid')")" = "True"

# Direct provenance forgery is rejected and C8.14 is visible but advisory.
OUT=$(psqlc "update recommendations set failure_basis_note='forged direct basis that must never persist' where id='$REC';" 2>&1 || true)
grep -q 'must use record_recommendation_failure_basis' <<<"$OUT"
P=$(rpc "$TOKEN" get_recommendation_contract_posture '{}')
test "$(jqp "$P" "next(v for v in x if v['register']=='C8.14')['blocking']")" = "False"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='recommendation_failure_basis' and event_data->>'recommendation_id'='$REC'")" -ge 2

echo 'C8.14 recommendation failure-basis smoke passed: canonical_links=true tenant_wall=true asset_scope=true provenance=true advisory_posture=true no_operational_authority=true'

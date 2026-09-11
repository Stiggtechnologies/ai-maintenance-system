#!/usr/bin/env bash
# D7.09 — live Project Flow Efficiency transcript.
set -euo pipefail
trap 'echo "Project-flow smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?missing API_URL}"; : "${ANON_KEY:?missing ANON_KEY}"
ORG='11111111-1111-1111-1111-111111111111'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }

PLANNER=$(token 'planner@syncai.ca' 'Planner123!@#')
test -n "$PLANNER"
CASE=$(psqlc "select id from development_cases where organization_id='$ORG' order by created_at limit 1")
ASSET=$(psqlc "select id from assets where organization_id='$ORG' order by created_at limit 1")
test -n "$CASE"; test -n "$ASSET"
psqlc "insert into development_case_assets(organization_id,development_case_id,asset_id,note) values('$ORG','$CASE','$ASSET','D7.09 smoke scope') on conflict(development_case_id,asset_id) do nothing" >/dev/null

# Ten elapsed hours: 2 pending + 4 in progress + 4 blocked = 40% efficiency.
WO='79090000-0000-4000-8000-000000000001'
BAD='79090000-0000-4000-8000-000000000002'
psqlc "insert into work_orders(id,organization_id,asset_id,wo_number,title,status,created_at,completed_at) values('$WO','$ORG','$ASSET','FLOW-001','Evidenced project work','completed','2026-01-01 00:00:00+00','2026-01-01 10:00:00+00'),('$BAD','$ORG','$ASSET','FLOW-002','Uninstrumented project work','blocked','2026-01-01 00:00:00+00',null) on conflict(id) do nothing" >/dev/null
psqlc "insert into work_order_status_history(work_order_id,status_from,status_to,changed_at,comments) values('$WO','pending','in_progress','2026-01-01 02:00:00+00','D7.09 smoke'),('$WO','in_progress','blocked','2026-01-01 06:00:00+00','D7.09 smoke'),('$WO','blocked','completed','2026-01-01 10:00:00+00','D7.09 smoke')" >/dev/null

FLOW=$(rpc "$PLANNER" get_project_flow_efficiency "{\"p_case_id\":\"$CASE\",\"p_as_of\":\"2026-01-01T10:00:00Z\"}")
BODY="$FLOW" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if x.get('error') or not x.get('computable') or not x.get('partial'):
    print('expected computable partial metric, got:',x); sys.exit(1)
if float(x.get('flowEfficiencyPct',-1)) != 40 or float(x.get('activeHours',-1)) != 4 or float(x.get('waitingHours',-1)) != 6:
    print('expected exact 4/10 = 40% split, got:',x); sys.exit(1)
if x.get('measuredWorkOrders') != 1 or x.get('excludedWorkOrders') != 1:
    print('expected one measured and one excluded work order, got:',x); sys.exit(1)
reasons=[e.get('reason') for e in x.get('exclusions',[])]
if 'status changed without transition evidence' not in reasons:
    print('expected named missing-history exclusion, got:',x); sys.exit(1)
PY

# A case in another tenant is indistinguishable from absent through the read door.
OTHER_CASE=$(psqlc "select id from development_cases where organization_id<>'$ORG' order by created_at limit 1")
if test -n "$OTHER_CASE"; then
  CROSS=$(rpc "$PLANNER" get_project_flow_efficiency "{\"p_case_id\":\"$OTHER_CASE\"}")
  BODY="$CROSS" python3 - <<'PY'
import json,os,sys
x=json.loads(os.environ['BODY'])
if 'not found' not in str(x.get('error','')).lower():
    print('expected cross-tenant not-found refusal, got:',x); sys.exit(1)
PY
fi

echo "Project-flow smoke passed: case=$CASE active=4h waiting=6h efficiency=40% incomplete_evidence=refused"

#!/usr/bin/env bash
set -euo pipefail
trap 'echo "C9.05 loss/backlog/outage smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"
: "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999917'
OWN_ASSET='88888888-0000-0000-0000-000000000051'
FOREIGN_ASSET='88888888-0000-0000-0000-000000000052'
OWN_WO='88888888-0000-0000-0000-000000000053'
FOREIGN_WO='88888888-0000-0000-0000-000000000054'
OWN_WINDOW='88888888-0000-0000-0000-000000000055'

token() {
  curl -sS "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"
}

rpc() {
  curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d "$3"
}

TOKEN=$(token 'demo@syncai.ca' 'Demo123!@#')
test -n "$TOKEN"

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry)
values('$OTHER_ORG','C9.05 foreign smoke tenant','testing') on conflict(id) do nothing;

insert into assets(id,organization_id,name,tag,criticality)
values
  ('$OWN_ASSET','$ORG','C9.05 forecast compressor','C9-05-A','critical'),
  ('$FOREIGN_ASSET','$OTHER_ORG','C9.05 foreign compressor','C9-05-X','critical')
on conflict(id) do update set name=excluded.name,tag=excluded.tag,criticality=excluded.criticality;

delete from operating_states where asset_id in ('$OWN_ASSET','$FOREIGN_ASSET');
delete from production_records where asset_id in ('$OWN_ASSET','$FOREIGN_ASSET');
delete from outage_work where work_order_id in ('$OWN_WO','$FOREIGN_WO');
delete from work_orders where id in ('$OWN_WO','$FOREIGN_WO');
delete from outage_windows where id='$OWN_WINDOW';

insert into operating_states(organization_id,asset_id,state,started_at,ended_at,source_system)
values
  ('$ORG','$OWN_ASSET','running',now()-interval '170 days',now()-interval '100 days','c905-history'),
  ('$ORG','$OWN_ASSET','down_unplanned',now()-interval '90 days',now()-interval '89 days 20 hours','c905-history'),
  ('$ORG','$OWN_ASSET','running',now()-interval '89 days 20 hours',now()-interval '40 days','c905-history'),
  ('$ORG','$OWN_ASSET','down_unplanned',now()-interval '30 days',now()-interval '29 days 18 hours','c905-history'),
  ('$ORG','$OWN_ASSET','running',now()-interval '29 days 18 hours',now(),'c905-history'),
  ('$OTHER_ORG','$FOREIGN_ASSET','running',now()-interval '170 days',now(),'foreign-c905'),
  ('$OTHER_ORG','$FOREIGN_ASSET','down_unplanned',now()-interval '10 days',now()-interval '9 days','foreign-c905');

insert into production_records(organization_id,asset_id,period_start,period_end,units_produced,unit_of_measure,source_system)
values
  ('$ORG','$OWN_ASSET',now()-interval '170 days',now()-interval '100 days',7000,'tonnes','c905-history'),
  ('$ORG','$OWN_ASSET',now()-interval '89 days',now()-interval '40 days',4900,'tonnes','c905-history'),
  ('$ORG','$OWN_ASSET',now()-interval '29 days',now(),2900,'tonnes','c905-history'),
  ('$OTHER_ORG','$FOREIGN_ASSET',now()-interval '170 days',now()-interval '80 days',999999,'foreign-units','foreign-c905'),
  ('$OTHER_ORG','$FOREIGN_ASSET',now()-interval '79 days',now(),999999,'foreign-units','foreign-c905');

insert into work_orders(
  id,organization_id,asset_id,wo_number,title,status,priority,type,
  estimated_hours,planned_hours,risk_score,safety_flag,created_at
) values
  ('$OWN_WO','$ORG','$OWN_ASSET','C905-WO','Inspect compressor seal system','pending','critical','human_created',4,4,82,false,now()-interval '45 days'),
  ('$FOREIGN_WO','$OTHER_ORG','$FOREIGN_ASSET','C905-X','Foreign tenant work must not cross','pending','critical','human_created',1,1,99,false,now()-interval '300 days');

insert into outage_windows(
  id,organization_id,window_key,title,kind,starts_at,ends_at,status,scope
) values (
  '$OWN_WINDOW','$ORG','C905-OPP','C9.05 opportunity window','opportunity',
  now()+interval '10 days',now()+interval '11 days','planned','Controlled maintenance opportunity'
);

delete from maintenance_optimization_runs where organization_id in ('$ORG','$OTHER_ORG');
SQL

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/generate_maintenance_optimization_run" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'

RESULT=$(rpc "$TOKEN" generate_maintenance_optimization_run \
  '{"p_history_days":180,"p_horizon_days":90,"p_limit":50}')
test "${RESULT##*$'\n'}" = '200'
BODY="${RESULT%$'\n'*}" OWN_ASSET="$OWN_ASSET" OWN_WO="$OWN_WO" \
  FOREIGN_ASSET="$FOREIGN_ASSET" FOREIGN_WO="$FOREIGN_WO" python3 - <<'PY'
import json, os
x = json.loads(os.environ['BODY'])
assert x['status'] == 'draft' and x.get('run_id'), x
r = x['result']
assert r['register_ref'] == 'C9.05'
forecast = next(row for row in r['loss_forecast'] if row['asset_id'] == os.environ['OWN_ASSET'])
assert forecast['status'] == 'forecast', forecast
assert float(forecast['expected_unplanned_hours']) > 0, forecast
assert float(forecast['expected_units_at_risk']) > 0, forecast
backlog = next(row for row in r['risk_backlog'] if row['work_order_id'] == os.environ['OWN_WO'])
assert backlog['risk_basis'] == 'recorded_work_order_risk', backlog
window = next(row for row in r['outage_options'] if row['window_key'] == 'C905-OPP')
assert any(c['work_order_id'] == os.environ['OWN_WO'] for c in window['candidates']), window
serialized = json.dumps(r)
assert os.environ['FOREIGN_ASSET'] not in serialized, serialized
assert os.environ['FOREIGN_WO'] not in serialized, serialized
assert 'never summed' in r['controls']['mixed_units']
assert 'candidate options only' in r['controls']['outage']
PY

READ=$(rpc "$TOKEN" get_latest_maintenance_optimization_run '{}')
test "${READ##*$'\n'}" = '200'
READ_BODY="${READ%$'\n'*}" python3 - <<'PY'
import json, os
x = json.loads(os.environ['READ_BODY'])
assert x['status'] == 'draft' and x.get('run_id'), x
assert x['result']['register_ref'] == 'C9.05', x
PY

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 <<SQL | grep -qx '1|0|pending'
select count(*),
  (select count(*) from outage_work where outage_window_id='$OWN_WINDOW'),
  (select status from work_orders where id='$OWN_WO')
from maintenance_optimization_runs where organization_id='$ORG' and status='draft';
SQL

echo 'C9.05 loss/backlog/outage smoke passed: auth=true tenant_wall=true persisted_run=true forecast_refusal_controls=true risk_basis=true constrained_candidates=true no_auto_release=true'

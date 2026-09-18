#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Contextual condition-monitoring smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}"
: "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-9999-9999-999999999918'
OWN_ASSET='88888888-0000-0000-0000-000000000041'
OWN_SENSOR='88888888-0000-0000-0000-000000000042'
FOREIGN_ASSET='88888888-0000-0000-0000-000000000043'
FOREIGN_SENSOR='88888888-0000-0000-0000-000000000044'
SOURCE='c904-smoke-historian'
FOREIGN_SOURCE='c904-foreign-must-not-cross'

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
values('$OTHER_ORG','C9.04 foreign smoke tenant','testing') on conflict(id) do nothing;
insert into assets(id,organization_id,name,criticality)
values
  ('$OWN_ASSET','$ORG','C9.04 contextual pump','critical'),
  ('$FOREIGN_ASSET','$OTHER_ORG','C9.04 foreign pump','critical')
on conflict(id) do nothing;
insert into sensors(id,organization_id,asset_id,name,signal_type,unit)
values
  ('$OWN_SENSOR','$ORG','$OWN_ASSET','C9.04 drive-end vibration','vibration','mm/s'),
  ('$FOREIGN_SENSOR','$OTHER_ORG','$FOREIGN_ASSET','C9.04 foreign vibration','vibration','mm/s')
on conflict(id) do nothing;
delete from condition_readings where sensor_id in ('$OWN_SENSOR','$FOREIGN_SENSOR');
delete from operating_states where asset_id in ('$OWN_ASSET','$FOREIGN_ASSET');
delete from connectors where organization_id='$ORG' and connector_key='$SOURCE';
insert into connectors(
  organization_id,connector_type,name,status,last_success_at,connector_key,
  system_kind,direction,write_enabled,enabled,endpoint_hint,
  expected_interval_minutes,credential_binding_ref,contract_note,register_ref
) values (
  '$ORG','plant_historian','C9.04 smoke historian','active',now(),'$SOURCE',
  'historian','read_only',false,true,'https://historian.example.invalid/readings',
  5,'vault://tenant/c904-smoke','Read-only C9.04 smoke source.','C9.04'
);
insert into operating_states(
  organization_id,asset_id,state,load_pct,started_at,ended_at,reason_code,source_system
) values
  ('$ORG','$OWN_ASSET','running',83,now()-interval '3 minutes',now()-interval '1 minute','normal-duty','dispatch'),
  ('$OTHER_ORG','$FOREIGN_ASSET','running',99,now()-interval '5 minutes',null,'foreign-duty','$FOREIGN_SOURCE');
insert into condition_readings(
  organization_id,sensor_id,asset_id,value,quality,taken_at,source_system
) values
  ('$ORG','$OWN_SENSOR','$OWN_ASSET',4.2,'good',now()-interval '2 minutes','$SOURCE'),
  ('$ORG','$OWN_SENSOR','$OWN_ASSET',4.8,'suspect',now()-interval '30 seconds','manual-import'),
  ('$OTHER_ORG','$FOREIGN_SENSOR','$FOREIGN_ASSET',99.9,'good',now(),'$FOREIGN_SOURCE');
SQL

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API_URL/rest/v1/rpc/get_contextual_condition_monitoring" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}')
test "$NOAUTH" = '401'
RESULT=$(rpc "$TOKEN" get_contextual_condition_monitoring '{"p_window_days":30,"p_limit":24}')
test "${RESULT##*$'\n'}" = '200'
BODY="${RESULT%$'\n'*}" OWN_SOURCE="$SOURCE" FOREIGN_SOURCE="$FOREIGN_SOURCE" python3 - <<'PY'
import json, os
x = json.loads(os.environ['BODY'])
own = os.environ['OWN_SOURCE']
foreign = os.environ['FOREIGN_SOURCE']
rows = [r for r in x['readings'] if r.get('source_system') in (own, 'manual-import')]
assert len(rows) == 2, rows
known = next(r for r in rows if r['source_system'] == own)
unknown = next(r for r in rows if r['source_system'] == 'manual-import')
assert known['context_known'] is True and known['operating_state'] == 'running', known
assert float(known['load_pct']) == 83 and known['source_posture'] == 'connector_backed', known
assert unknown['context_known'] is False and unknown['operating_state'] is None, unknown
assert unknown['source_posture'] == 'seed_sim_or_import', unknown
assert foreign not in json.dumps(x), x
assert x['summary']['context_unknown'] >= 1, x['summary']
assert 'will not infer' in x['basis'].lower() or 'unknown context remains explicit' in x['basis'].lower(), x['basis']
PY
echo 'Contextual condition-monitoring smoke passed: auth=true tenant_wall=true exact_interval=true unknown_explicit=true source_posture=true read_only=true'

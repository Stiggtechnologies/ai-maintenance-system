#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Reliability segmentation smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

# C6.26 runtime proof against a clean, fully migrated local stack.
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
ASSET='aaaaaaaa-0000-0000-0000-000000000002'
WO1='c6260000-0000-4000-8000-000000000001'
WO2='c6260000-0000-4000-8000-000000000002'
WO3='c6260000-0000-4000-8000-000000000003'
WO4='c6260000-0000-4000-8000-000000000004'

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
test -n "$ENGINEER"

MECHANISM_ROW=$(psqlc "select mechanism_key||'|'||name from public.damage_mechanisms where organization_id='$ORG' order by name limit 1")
MECHANISM_KEY=${MECHANISM_ROW%%|*}
MECHANISM_NAME=${MECHANISM_ROW#*|}
test -n "$MECHANISM_KEY" && test -n "$MECHANISM_NAME"

OBS1=$(psqlc "select to_char((now()-interval '9 days') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
OBS2=$(psqlc "select to_char((now()-interval '8 days') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
OBS3=$(psqlc "select to_char((now()-interval '7 days') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
OBS4=$(psqlc "select to_char((now()-interval '3 days') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")

psqlc "
  delete from public.failure_mechanism_coding_events
  where organization_id='$ORG'
    and work_order_id in ('$WO1','$WO2','$WO3','$WO4');
  delete from public.operating_states
  where organization_id='$ORG' and source_system='c626-ci';
  insert into public.operating_states(
    organization_id,asset_id,state,load_pct,started_at,ended_at,reason_code,source_system,external_id
  ) values (
    '$ORG','$ASSET','running',92,now()-interval '10 days',now()-interval '5 days',
    'C6.26 governed high-duty evidence','c626-ci','c626-high-duty'
  );
  insert into public.work_orders(
    id,organization_id,asset_id,wo_number,title,status,work_type,completed_at,
    actual_failure_mode,system_group,downtime_hours
  ) values
    ('$WO1','$ORG','$ASSET','C626-1','C6.26 observed failure one','completed','corrective',now()-interval '8 days 20 hours','Engine Group','Engine Group',2),
    ('$WO2','$ORG','$ASSET','C626-2','C6.26 observed failure two','completed','corrective',now()-interval '7 days 20 hours','Engine Group','Engine Group',3),
    ('$WO3','$ORG','$ASSET','C626-3','C6.26 observed failure three','completed','corrective',now()-interval '6 days 20 hours','Engine Group','Engine Group',4),
    ('$WO4','$ORG','$ASSET','C626-4','C6.26 failure without matching state','completed','corrective',now()-interval '2 days 20 hours','Engine Group','Engine Group',1)
  on conflict(id) do update set
    status='completed',work_type='corrective',completed_at=excluded.completed_at,
    actual_failure_mode=excluded.actual_failure_mode,system_group=excluded.system_group,
    downtime_hours=excluded.downtime_hours,failure_mechanism_id=null,
    failure_observed_at=null,mechanism_coded_by=null,mechanism_coded_at=null,
    mechanism_note=null;
" >/dev/null

MISSING=$(rpc "$ENGINEER" code_failure_mechanism \
  "{\"p_work_order_id\":\"$WO1\",\"p_mechanism_key\":\"$MECHANISM_KEY\",\"p_note\":\"CI teardown evidence identifies the governed mechanism.\",\"p_failure_observed_at\":null}")
MISSING="$MISSING" python3 -c "import json,os; assert 'record when the failure was observed' in json.loads(os.environ['MISSING'])['error']"

FUTURE=$(rpc "$ENGINEER" code_failure_mechanism \
  "{\"p_work_order_id\":\"$WO1\",\"p_mechanism_key\":\"$MECHANISM_KEY\",\"p_note\":\"CI teardown evidence identifies the governed mechanism.\",\"p_failure_observed_at\":\"2999-01-01T00:00:00Z\"}")
FUTURE="$FUTURE" python3 -c "import json,os; assert 'cannot be in the future' in json.loads(os.environ['FUTURE'])['error']"

code_failure() {
  local wo="$1" observed="$2"
  rpc "$ENGINEER" code_failure_mechanism \
    "{\"p_work_order_id\":\"$wo\",\"p_mechanism_key\":\"$MECHANISM_KEY\",\"p_note\":\"CI teardown and inspection evidence identifies this governed failure mechanism.\",\"p_failure_observed_at\":\"$observed\"}"
}

for pair in "$WO1|$OBS1" "$WO2|$OBS2" "$WO3|$OBS3" "$WO4|$OBS4"; do
  WO=${pair%%|*}
  OBS=${pair#*|}
  CODED=$(code_failure "$WO" "$OBS")
  CODED="$CODED" OBS="$OBS" python3 -c "import json,os; d=json.loads(os.environ['CODED']); assert d.get('coded') and d.get('failureObservedAt').startswith(os.environ['OBS'][:19]),d"
done

test "$(psqlc "select count(*) from public.failure_mechanism_coding_events where organization_id='$ORG' and work_order_id in ('$WO1','$WO2','$WO3','$WO4') and failure_observed_at is not null")" = '4'

MECHANISM=$(rpc "$ENGINEER" get_segmented_reliability \
  '{"p_dimension":"mechanism","p_window_days":null,"p_min_failures":1}')
MECHANISM="$MECHANISM" MECHANISM_NAME="$MECHANISM_NAME" python3 - <<'PY'
import json,os
d=json.loads(os.environ['MECHANISM'])
assert d['dimension']=='mechanism',d
row=next((x for x in d['segments'] if x['segment']==os.environ['MECHANISM_NAME']),None)
assert row and row['failures']>=4,(row,d)
assert 'Human-coded failure mechanisms' in d['basis'],d
PY

REGIME=$(rpc "$ENGINEER" get_segmented_reliability \
  '{"p_dimension":"operating_regime","p_window_days":null,"p_min_failures":1}')
REGIME="$REGIME" python3 - <<'PY'
import json,os
d=json.loads(os.environ['REGIME'])
assert d['dimension']=='operating_regime',d
rows={x['segment']:x for x in d['segments']}
assert rows['High duty']['failures']>=3,rows
assert rows['Unknown duty — no matching state']['failures']>=1,rows
assert 'Exact-time match' in d['basis'] and 'not substituted' in d['basis'],d
PY

FOREIGN=$(rpc "$ENGINEER" code_failure_mechanism \
  "{\"p_work_order_id\":\"c6260000-0000-4000-8000-000000000099\",\"p_mechanism_key\":\"$MECHANISM_KEY\",\"p_note\":\"A foreign or unknown work order must not cross the tenant boundary.\",\"p_failure_observed_at\":\"$OBS1\"}")
FOREIGN="$FOREIGN" python3 -c "import json,os; assert json.loads(os.environ['FOREIGN'])['error']=='work order not found'"

PATCH=$(curl -sS -o /tmp/c626-patch.txt -w '%{http_code}' -X PATCH \
  "$API_URL/rest/v1/work_orders?id=eq.$WO1" \
  -H "apikey: $ANON_KEY" -H "authorization: Bearer $ENGINEER" \
  -H 'content-type: application/json' -H 'Prefer: return=representation' \
  -d '{"failure_observed_at":"2000-01-01T00:00:00Z"}')
case "$PATCH" in 400|401|403) ;; 200) test "$(cat /tmp/c626-patch.txt)" = '[]' ;; *) false ;; esac
test "$(psqlc "select count(*) from public.work_orders where id='$WO1' and failure_observed_at='2000-01-01T00:00:00Z'")" = '0'

echo 'Reliability segmentation smoke passed: observed_time_required=true direct_write_refused=true mechanism_axis=true regime_axis=true unknown_duty_honest=true tenant_wall=true'

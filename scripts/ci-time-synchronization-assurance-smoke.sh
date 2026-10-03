#!/usr/bin/env bash
set -euo pipefail
trap 'echo "E12.07 time-synchronization assurance smoke FAILED at line $LINENO"' ERR

eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-4999-8999-999999999761'
OTHER_USER='99999999-9999-4999-8999-999999999762'
LOCAL_KEY='e12-time-local'
FOREIGN_KEY='e12-time-foreign'
PASSWORD='TimeSync123!@#'

psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
service_rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$1" -H "apikey: $SERVICE_ROLE_KEY" -H "authorization: Bearer $SERVICE_ROLE_KEY" -H 'content-type: application/json' -d "$2"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'].lower() in x.get('error','').lower(),x"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry)
values('$OTHER_ORG','E12.07 foreign tenant','utilities') on conflict(id) do nothing;
do \$seed\$
begin
  if not exists(select 1 from auth.users where id='$OTHER_USER') then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
      recovery_token,email_change,email_change_token_new,email_change_token_current,
      phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000','$OTHER_USER','authenticated','authenticated',
      'time-sync-foreign@syncai.ca',extensions.crypt('$PASSWORD',extensions.gen_salt('bf')),
      now(),now(),now(),'{"provider":"email","providers":["email"]}',
      '{"full_name":"E12.07 Foreign Admin"}','','','','','','','','');
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values('$OTHER_USER','$OTHER_ORG','time-sync-foreign@syncai.ca','E12.07 Foreign Admin','admin')
  on conflict(id) do update set organization_id=excluded.organization_id,role='admin';
end
\$seed\$;
delete from connector_time_observations where connector_id in
  (select id from connectors where connector_key in ('$LOCAL_KEY','$FOREIGN_KEY'));
delete from connectors where connector_key in ('$LOCAL_KEY','$FOREIGN_KEY');
insert into connectors(organization_id,connector_key,name,connector_type,system_kind,status,enabled,direction,write_enabled)
values
  ('$ORG','$LOCAL_KEY','E12.07 local OPC UA','OPC-UA','historian','active',true,'read_only',false),
  ('$OTHER_ORG','$FOREIGN_KEY','E12.07 foreign OPC UA','OPC-UA','historian','active',true,'read_only',false);
SQL

ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
FOREIGN=$(token 'time-sync-foreign@syncai.ca' "$PASSWORD")
test -n "$ADMIN" && test -n "$FOREIGN"
LOCAL_ID=$(psqlc "select id from connectors where organization_id='$ORG' and connector_key='$LOCAL_KEY'")
FOREIGN_ID=$(psqlc "select id from connectors where organization_id='$OTHER_ORG' and connector_key='$FOREIGN_KEY'")

CROSS=$(rpc "$ADMIN" configure_connector_time_assurance "{\"p_connector_id\":\"$FOREIGN_ID\",\"p_protocol\":\"ptp\",\"p_reference_authority\":\"Foreign grandmaster\",\"p_tolerance_ms\":20,\"p_max_observation_age_minutes\":15,\"p_evidence_reference\":\"E12-FOREIGN-STD\",\"p_basis\":\"A local administrator must never configure a clock source owned by another tenant.\"}")
err "$CROSS" 'not found in this organization'

CONFIG=$(rpc "$ADMIN" configure_connector_time_assurance "{\"p_connector_id\":\"$LOCAL_ID\",\"p_protocol\":\"ptp\",\"p_reference_authority\":\"Site A PTP grandmaster\",\"p_tolerance_ms\":20,\"p_max_observation_age_minutes\":1,\"p_evidence_reference\":\"ENG-TIME-STD-004\",\"p_basis\":\"Approved site engineering standard establishes the clock authority, tolerance and freshness interval.\"}")
ok "$CONFIG"
FOREIGN_CONFIG=$(rpc "$FOREIGN" configure_connector_time_assurance "{\"p_connector_id\":\"$FOREIGN_ID\",\"p_protocol\":\"ntp\",\"p_reference_authority\":\"Foreign tenant NTP\",\"p_tolerance_ms\":100,\"p_max_observation_age_minutes\":5,\"p_evidence_reference\":\"FOREIGN-TIME-STD\",\"p_basis\":\"Foreign tenant engineering standard controls its own clock authority and evidence freshness.\"}")
ok "$FOREIGN_CONFIG"

INITIAL=$(rpc "$ADMIN" get_connector_time_assurance '{}'); ok "$INITIAL"
BODY="$(body "$INITIAL")" LOCAL_ID="$LOCAL_ID" FOREIGN_ID="$FOREIGN_ID" python3 -c "import json,os;x=json.loads(os.environ['BODY']);row=next(v for v in x['connectors'] if v['connectorId']==os.environ['LOCAL_ID']);assert row['state']=='unproven' and not row['eligibleForTimeSensitiveEvidence'];assert all(v['connectorId']!=os.environ['FOREIGN_ID'] for v in x['connectors']);assert x['operationalAuthority'] is False and x['setsSourceClocks'] is False"

# Authenticated callers have neither direct configuration nor observation writes.
RAW_PATCH=$(curl -sS -w '\n%{http_code}' -X PATCH "$API_URL/rest/v1/connectors?id=eq.$LOCAL_ID" -H "apikey: $ANON_KEY" -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -H 'prefer: return=representation' -d '{"time_tolerance_ms":999}')
test "$(status "$RAW_PATCH")" != 200 || test "$(body "$RAW_PATCH")" = '[]'
test "$(psqlc "select time_tolerance_ms from connectors where id='$LOCAL_ID'")" = '20'
RAW_INSERT=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/connector_time_observations" -H "apikey: $ANON_KEY" -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d "{\"organization_id\":\"$ORG\",\"connector_id\":\"$LOCAL_ID\",\"configuration_revision\":1,\"delivery_id\":\"raw-write\",\"source_clock_at\":\"2026-01-01T00:00:00Z\",\"reference_clock_at\":\"2026-01-01T00:00:00Z\",\"offset_ms\":0,\"measurement_uncertainty_ms\":0,\"evidence_reference\":\"RAW-DENIED\",\"payload_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"recorded_by\":\"human\"}")
test "$(status "$RAW_INSERT")" != 200 && test "$(status "$RAW_INSERT")" != 201
HUMAN_SERVICE=$(rpc "$ADMIN" record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"human-denied\",\"p_source_clock_at\":\"2026-01-01T00:00:00Z\",\"p_reference_clock_at\":\"2026-01-01T00:00:00Z\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"HUMAN-DENIED\",\"p_payload_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")
test "$(status "$HUMAN_SERVICE")" != 200

REFERENCE=$(psqlc "select to_char((clock_timestamp()-interval '2 seconds') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
SOURCE=$(psqlc "select to_char(('$REFERENCE'::timestamptz+interval '10 milliseconds') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
GOOD=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"good-001\",\"p_source_clock_at\":\"$SOURCE\",\"p_reference_clock_at\":\"$REFERENCE\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"AIO-PTP-OBS-0001\",\"p_payload_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")
ok "$GOOD"
BODY="$(body "$GOOD")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['offset_ms']==10 and x['worst_case_offset_ms']==12 and x['state']=='synchronized' and x['replay'] is False"

REPLAY=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"good-001\",\"p_source_clock_at\":\"$SOURCE\",\"p_reference_clock_at\":\"$REFERENCE\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"AIO-PTP-OBS-0001\",\"p_payload_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")
ok "$REPLAY"
BODY="$(body "$REPLAY")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['replay'] is True"
test "$(psqlc "select count(*) from connector_time_observations where connector_id='$LOCAL_ID' and delivery_id='good-001'")" = 1

CONFLICT=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"good-001\",\"p_source_clock_at\":\"$SOURCE\",\"p_reference_clock_at\":\"$REFERENCE\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"AIO-PTP-OBS-0001\",\"p_payload_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}")
err "$CONFLICT" 'different payload digest'
UNDERSTATED=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"bad-uncertainty\",\"p_source_clock_at\":\"$SOURCE\",\"p_reference_clock_at\":\"$REFERENCE\",\"p_round_trip_delay_ms\":10,\"p_measurement_uncertainty_ms\":4,\"p_evidence_reference\":\"AIO-PTP-OBS-0002\",\"p_payload_sha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"}")
err "$UNDERSTATED" 'half the observed round-trip delay'

CURRENT=$(rpc "$ADMIN" get_connector_time_assurance '{}'); ok "$CURRENT"
BODY="$(body "$CURRENT")" LOCAL_ID="$LOCAL_ID" python3 -c "import json,os;x=json.loads(os.environ['BODY']);row=next(v for v in x['connectors'] if v['connectorId']==os.environ['LOCAL_ID']);assert row['state']=='synchronized' and row['eligibleForTimeSensitiveEvidence'];assert row['offsetMs']==10 and row['worstCaseOffsetMs']==12"

FUTURE_EVENT=$(psqlc "select to_char(('$REFERENCE'::timestamptz+interval '2 minutes') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
STALE=$(rpc "$ADMIN" evaluate_connector_event_time "{\"p_connector_id\":\"$LOCAL_ID\",\"p_event_time\":\"$FUTURE_EVENT\"}"); ok "$STALE"
BODY="$(body "$STALE")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['state']=='stale' and not x['eligible_for_time_sensitive_evidence']"

REFERENCE2=$(psqlc "select to_char((clock_timestamp()-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
SOURCE2=$(psqlc "select to_char(('$REFERENCE2'::timestamptz+interval '50 milliseconds') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
BAD_OFFSET=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"skew-001\",\"p_source_clock_at\":\"$SOURCE2\",\"p_reference_clock_at\":\"$REFERENCE2\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"AIO-PTP-OBS-0003\",\"p_payload_sha256\":\"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\"}")
ok "$BAD_OFFSET"
BODY="$(body "$BAD_OFFSET")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['state']=='untrusted' and x['worst_case_offset_ms']==52"

RECONFIG=$(rpc "$ADMIN" configure_connector_time_assurance "{\"p_connector_id\":\"$LOCAL_ID\",\"p_protocol\":\"ptp\",\"p_reference_authority\":\"Site A PTP grandmaster\",\"p_tolerance_ms\":20,\"p_max_observation_age_minutes\":1,\"p_evidence_reference\":\"ENG-TIME-STD-005\",\"p_basis\":\"Annual engineering review reconfirmed clock authority, tolerance and freshness; new observations are required.\"}")
ok "$RECONFIG"
BODY="$(body "$RECONFIG")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['configuration_revision']==2 and x['state']=='unproven'"
AFTER_RECONFIG=$(rpc "$ADMIN" get_connector_time_assurance '{}'); ok "$AFTER_RECONFIG"
BODY="$(body "$AFTER_RECONFIG")" LOCAL_ID="$LOCAL_ID" python3 -c "import json,os;x=json.loads(os.environ['BODY']);row=next(v for v in x['connectors'] if v['connectorId']==os.environ['LOCAL_ID']);assert row['state']=='unproven' and not row['eligibleForTimeSensitiveEvidence'] and row['observationId'] is None"
SUPERSEDED_REPLAY=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"good-001\",\"p_source_clock_at\":\"$SOURCE\",\"p_reference_clock_at\":\"$REFERENCE\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"AIO-PTP-OBS-0001\",\"p_payload_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")
err "$SUPERSEDED_REPLAY" 'superseded clock-contract revision'

# Give the foreign tenant one service observation, then prove authenticated
# direct reads retain only the caller's tenant.
FREF=$(psqlc "select to_char((clock_timestamp()-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
FOREIGN_OBS=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$OTHER_ORG\",\"p_connector_key\":\"$FOREIGN_KEY\",\"p_delivery_id\":\"foreign-001\",\"p_source_clock_at\":\"$FREF\",\"p_reference_clock_at\":\"$FREF\",\"p_round_trip_delay_ms\":2,\"p_measurement_uncertainty_ms\":1,\"p_evidence_reference\":\"FOREIGN-OBS-0001\",\"p_payload_sha256\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\"}")
ok "$FOREIGN_OBS"
VISIBLE=$(curl -sS -w '\n%{http_code}' "$API_URL/rest/v1/connector_time_observations?select=organization_id" -H "apikey: $ANON_KEY" -H "authorization: Bearer $ADMIN")
test "$(status "$VISIBLE")" = 200
BODY="$(body "$VISIBLE")" ORG="$ORG" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert len(x)>=2 and all(v['organization_id']==os.environ['ORG'] for v in x)"

echo "Time synchronization assurance smoke passed: canonical_connector=true named_human=true service_only=true tenant_wall=true exact_offset=true uncertainty=true replay_safe=true revisioned=true stale_fail_closed=true operational_authority=false"

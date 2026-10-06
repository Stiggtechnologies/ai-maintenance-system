#!/usr/bin/env bash
set -euo pipefail
trap 'echo "E12.07 time-synchronization assurance smoke FAILED at line $LINENO"' ERR

# Synthetic profile transitions and concurrent writes are CI loopback fixtures,
# never production administration or permission to enable a customer feed.
test "${GITHUB_ACTIONS:-}" = true

eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"

ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-4999-8999-999999999761'
OTHER_USER='99999999-9999-4999-8999-999999999762'
FIXTURE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
LOCAL_KEY="e12-time-local-$FIXTURE_ID"
FOREIGN_KEY="e12-time-foreign-$FIXTURE_ID"
PASSWORD='TimeSync123!@#'
# The disposable collector fixture captures its expected revision, not receipt-time inference.
CLOCK_REVISION=1

psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
# One key per deliberate configuration act; reconciliation passes the SAME key.
config_rpc(){ rpc "$1" configure_connector_time_assurance "{\"p_idempotency_key\":\"$2\",${3#\{}"; }
service_rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$1" -H "apikey: $SERVICE_ROLE_KEY" -H "authorization: Bearer $SERVICE_ROLE_KEY" -H 'content-type: application/json' -d "{\"p_configuration_revision\":$CLOCK_REVISION,${2#\{}"; }
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

CROSS=$(config_rpc "$ADMIN" "$(uuidgen | tr "[:upper:]" "[:lower:]")" "{\"p_connector_id\":\"$FOREIGN_ID\",\"p_protocol\":\"ptp\",\"p_reference_authority\":\"Foreign grandmaster\",\"p_tolerance_ms\":20,\"p_max_observation_age_minutes\":15,\"p_evidence_reference\":\"E12-FOREIGN-STD\",\"p_basis\":\"A local administrator must never configure a clock source owned by another tenant.\"}")
err "$CROSS" 'not found in this organization'

CONFIG_INPUT="{\"p_connector_id\":\"$LOCAL_ID\",\"p_protocol\":\"ptp\",\"p_reference_authority\":\"Site A PTP grandmaster\",\"p_tolerance_ms\":20,\"p_max_observation_age_minutes\":1,\"p_evidence_reference\":\"ENG-TIME-STD-004\",\"p_basis\":\"Approved site engineering standard establishes the clock authority, tolerance and freshness interval.\"}"
CONFIG=$(config_rpc "$ADMIN" "$FIXTURE_ID" "$CONFIG_INPUT")
ok "$CONFIG"
BODY="$(body "$CONFIG")" LOCAL_ID="$LOCAL_ID" INTENT="$FIXTURE_ID" python3 -c "import json,os,uuid;x=json.loads(os.environ['BODY']);assert x['ok'] is True and x['replay'] is False and x['connector_id']==os.environ['LOCAL_ID'] and x['idempotency_key']==os.environ['INTENT'];uuid.UUID(x['audit_id']);assert x['configuration_revision']==x['current_configuration_revision']==1 and x['state']=='unproven';assert x['operational_authority'] is False and x['configuration_evidence_verified'] is False and x['eligible_for_time_sensitive_evidence'] is False"
CONFIG_REPLAY=$(config_rpc "$ADMIN" "$FIXTURE_ID" "$CONFIG_INPUT"); ok "$CONFIG_REPLAY"
BODY="$(body "$CONFIG_REPLAY")" ORIGINAL="$(body "$CONFIG")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);old=json.loads(os.environ['ORIGINAL']);assert x['replay'] is True and x['audit_id']==old['audit_id'] and x['configuration_revision']==x['current_configuration_revision']==1"
UNCHANGED_NEW_KEY=$(config_rpc "$ADMIN" "$(uuidgen | tr '[:upper:]' '[:lower:]')" "$CONFIG_INPUT")
err "$UNCHANGED_NEW_KEY" 'exact clock contract is already current'
for FIELD in p_protocol p_reference_authority p_tolerance_ms p_max_observation_age_minutes p_evidence_reference p_basis; do
  CHANGED_INPUT=$(INPUT="$CONFIG_INPUT" FIELD="$FIELD" python3 -c "import json,os;x=json.loads(os.environ['INPUT']);f=os.environ['FIELD'];x[f]={'p_protocol':'ntp','p_reference_authority':'Different site reference','p_tolerance_ms':21,'p_max_observation_age_minutes':2,'p_evidence_reference':'ENG-TIME-STD-OTHER','p_basis':x['p_basis']+' Changed recorded basis.'}[f];print(json.dumps(x))")
  CONFLICT=$(config_rpc "$ADMIN" "$FIXTURE_ID" "$CHANGED_INPUT")
  err "$CONFLICT" 'different actor, connector or contract'
done
FOREIGN_CONFIG=$(config_rpc "$FOREIGN" "$(uuidgen | tr "[:upper:]" "[:lower:]")" "{\"p_connector_id\":\"$FOREIGN_ID\",\"p_protocol\":\"ntp\",\"p_reference_authority\":\"Foreign tenant NTP\",\"p_tolerance_ms\":100,\"p_max_observation_age_minutes\":5,\"p_evidence_reference\":\"FOREIGN-TIME-STD\",\"p_basis\":\"Foreign tenant engineering standard controls its own clock authority and evidence freshness.\"}")
ok "$FOREIGN_CONFIG"

# Service bypass of RLS does not grant authority to fabricate a clock-history receipt.
FORGED_RECEIPT=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/audit_events" -H "apikey: $SERVICE_ROLE_KEY" -H "authorization: Bearer $SERVICE_ROLE_KEY" -H 'content-type: application/json' -d "{\"organization_id\":\"$ORG\",\"entity_type\":\"connector_time_assurance_configuration\",\"actor\":\"forged-service\",\"event_data\":{\"connector_id\":\"$LOCAL_ID\"},\"new_state\":{}}")
test "$(status "$FORGED_RECEIPT")" != 200 && test "$(status "$FORGED_RECEIPT")" != 201
BODY="$(body "$FORGED_RECEIPT")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'governed configuration RPC' in x.get('message',''),x"
test "$(psqlc "select count(*) from audit_events where organization_id='$ORG' and entity_type='connector_time_assurance_configuration' and event_data->>'connector_id'='$LOCAL_ID'")" = 1

# Owner statements exercise the row/statement guards, not just PostgREST ACLs.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
do \$guards\$
begin
  begin
    insert into connectors(organization_id,connector_key,name,connector_type,system_kind,status,enabled,direction,write_enabled,time_tolerance_ms)
    values('$ORG','raw-$FIXTURE_ID','Raw configured clock','OPC-UA','historian','active',true,'read_only',false,20);
    raise exception 'test failed: raw initial clock configuration accepted';
  exception when others then
    if sqlerrm not like '%initial connector clock configuration%' then raise; end if;
  end;
  begin
    update connectors set time_tolerance_ms=999 where id='$LOCAL_ID';
    raise exception 'test failed: owner raw configuration accepted';
  exception when others then
    if sqlerrm not like '%governed configuration RPC%' then raise; end if;
  end;
  begin
    perform set_config('app.time_assurance_config_write','granted',true);
    update connectors set time_reference_authority=null where id='$LOCAL_ID';
    raise exception 'test failed: NULL-incomplete contract accepted';
  exception when check_violation then null;
  end;
  begin
    update connectors set organization_id='$OTHER_ORG' where id='$LOCAL_ID';
    raise exception 'test failed: configured source tenant rebound';
  exception when others then
    if sqlerrm not like '%original tenant and source identity%' then raise; end if;
  end;
  begin
    delete from connectors where id='$LOCAL_ID';
    raise exception 'test failed: clock history deleted';
  exception when others then
    if sqlerrm not like '%connector clock history is retained%' then raise; end if;
  end;
end
\$guards\$;
SQL

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
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
do \$retention\$
begin
  begin
    delete from connector_time_observations where connector_id='$LOCAL_ID';
    raise exception 'test failed: immutable observation deleted';
  exception when others then
    if sqlerrm not like '%immutable evidence%' then raise; end if;
  end;
  begin
    truncate connector_time_observations;
    raise exception 'test failed: immutable observation history truncated';
  exception when others then
    if sqlerrm not like '%immutable evidence%' then raise; end if;
  end;
end
\$retention\$;
SQL

CONFLICT=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"good-001\",\"p_source_clock_at\":\"$SOURCE\",\"p_reference_clock_at\":\"$REFERENCE\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"AIO-PTP-OBS-0001\",\"p_payload_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}")
err "$CONFLICT" 'different payload digest'
UNDERSTATED=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"bad-uncertainty\",\"p_source_clock_at\":\"$SOURCE\",\"p_reference_clock_at\":\"$REFERENCE\",\"p_round_trip_delay_ms\":10,\"p_measurement_uncertainty_ms\":4,\"p_evidence_reference\":\"AIO-PTP-OBS-0002\",\"p_payload_sha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"}")
err "$UNDERSTATED" 'half the observed round-trip delay'

CURRENT=$(rpc "$ADMIN" get_connector_time_assurance '{}'); ok "$CURRENT"
BODY="$(body "$CURRENT")" LOCAL_ID="$LOCAL_ID" python3 -c "import json,os;x=json.loads(os.environ['BODY']);row=next(v for v in x['connectors'] if v['connectorId']==os.environ['LOCAL_ID']);assert row['state']=='synchronized' and row['withinClockContract'];assert not row['configurationEvidenceVerified'] and not row['eligibleForTimeSensitiveEvidence'];assert row['offsetMs']==10 and row['worstCaseOffsetMs']==12"

# A repeated hash cannot launder a changed decoded observation envelope.
ENVELOPE_CONFLICT=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"good-001\",\"p_source_clock_at\":\"$SOURCE\",\"p_reference_clock_at\":\"$REFERENCE\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":3,\"p_evidence_reference\":\"AIO-PTP-OBS-0001\",\"p_payload_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")
err "$ENVELOPE_CONFLICT" 'same digest but a different observation envelope'

HINDSIGHT=$(rpc "$ADMIN" evaluate_connector_event_time "{\"p_connector_id\":\"$LOCAL_ID\",\"p_event_time\":\"$REFERENCE\"}"); ok "$HINDSIGHT"
BODY="$(body "$HINDSIGHT")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['state']=='unproven' and x['observation_id'] is None and not x['eligible_for_time_sensitive_evidence'];assert x['contract_scope']=='recorded_contract_at_event'"

EVENT_NOW=$(psqlc "select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
EVENT_CURRENT=$(rpc "$ADMIN" evaluate_connector_event_time "{\"p_connector_id\":\"$LOCAL_ID\",\"p_event_time\":\"$EVENT_NOW\"}"); ok "$EVENT_CURRENT"
BODY="$(body "$EVENT_CURRENT")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['state']=='synchronized' and x['within_clock_contract'];assert x['history_integrity']=='verified_recorded_chain' and x['configuration_revision']==1 and x['configuration_audit_id'];assert not x['configuration_evidence_verified'] and not x['eligible_for_time_sensitive_evidence']"

FUTURE_EVENT=$(psqlc "select to_char(('$REFERENCE'::timestamptz+interval '2 minutes') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
FUTURE=$(rpc "$ADMIN" evaluate_connector_event_time "{\"p_connector_id\":\"$LOCAL_ID\",\"p_event_time\":\"$FUTURE_EVENT\"}"); err "$FUTURE" 'future event time'

REFERENCE2=$(psqlc "select to_char((clock_timestamp()-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
SOURCE2=$(psqlc "select to_char(('$REFERENCE2'::timestamptz+interval '50 milliseconds') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
BAD_OFFSET=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"skew-001\",\"p_source_clock_at\":\"$SOURCE2\",\"p_reference_clock_at\":\"$REFERENCE2\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"AIO-PTP-OBS-0003\",\"p_payload_sha256\":\"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\"}")
ok "$BAD_OFFSET"
BODY="$(body "$BAD_OFFSET")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['state']=='untrusted' and x['worst_case_offset_ms']==52"

RECONFIG=$(config_rpc "$ADMIN" "$(uuidgen | tr "[:upper:]" "[:lower:]")" "{\"p_connector_id\":\"$LOCAL_ID\",\"p_protocol\":\"ptp\",\"p_reference_authority\":\"Site A PTP grandmaster\",\"p_tolerance_ms\":20,\"p_max_observation_age_minutes\":1,\"p_evidence_reference\":\"ENG-TIME-STD-005\",\"p_basis\":\"Annual engineering review reconfirmed clock authority, tolerance and freshness; new observations are required.\"}")
ok "$RECONFIG"
BODY="$(body "$RECONFIG")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['configuration_revision']==2 and x['state']=='unproven'"
HISTORICAL_REPLAY=$(config_rpc "$ADMIN" "$FIXTURE_ID" "$CONFIG_INPUT"); ok "$HISTORICAL_REPLAY"
BODY="$(body "$HISTORICAL_REPLAY")" ORIGINAL="$(body "$CONFIG")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);old=json.loads(os.environ['ORIGINAL']);assert x['replay'] is True and x['audit_id']==old['audit_id'] and x['configuration_revision']==1 and x['current_configuration_revision']==2;assert x['configuration_evidence_verified'] is False and x['eligible_for_time_sensitive_evidence'] is False"
CLOCK_REVISION=2
AFTER_RECONFIG=$(rpc "$ADMIN" get_connector_time_assurance '{}'); ok "$AFTER_RECONFIG"
BODY="$(body "$AFTER_RECONFIG")" LOCAL_ID="$LOCAL_ID" python3 -c "import json,os;x=json.loads(os.environ['BODY']);row=next(v for v in x['connectors'] if v['connectorId']==os.environ['LOCAL_ID']);assert row['state']=='unproven' and not row['eligibleForTimeSensitiveEvidence'] and row['observationId'] is None"
SUPERSEDED_REPLAY=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"good-001\",\"p_source_clock_at\":\"$SOURCE\",\"p_reference_clock_at\":\"$REFERENCE\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"AIO-PTP-OBS-0001\",\"p_payload_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")
err "$SUPERSEDED_REPLAY" 'superseded clock-contract revision'

# A new delivery ID must not rebind a measurement collected under revision 1.
COUNT_BEFORE_LATE=$(psqlc "select count(*) from connector_time_observations where connector_id='$LOCAL_ID'")
LATE_EXPECTED=$(CLOCK_REVISION=1 service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"late-new-delivery\",\"p_source_clock_at\":\"$SOURCE\",\"p_reference_clock_at\":\"$REFERENCE\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"AIO-PTP-OBS-0001\",\"p_payload_sha256\":\"9999999999999999999999999999999999999999999999999999999999999999\"}")
err "$LATE_EXPECTED" 'observation names a superseded clock-contract revision'
test "$(psqlc "select count(*) from connector_time_observations where connector_id='$LOCAL_ID'")" = "$COUNT_BEFORE_LATE"
MISSING_EXPECTED=$(CLOCK_REVISION=null service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"missing-revision\",\"p_source_clock_at\":\"$SOURCE\",\"p_reference_clock_at\":\"$REFERENCE\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"AIO-PTP-OBS-0001\",\"p_payload_sha256\":\"9999999999999999999999999999999999999999999999999999999999999999\"}")
err "$MISSING_EXPECTED" 'expected clock-contract revision is required'

OLD_EVENT=$(rpc "$ADMIN" evaluate_connector_event_time "{\"p_connector_id\":\"$LOCAL_ID\",\"p_event_time\":\"$EVENT_NOW\"}"); ok "$OLD_EVENT"
BODY="$(body "$OLD_EVENT")" BEFORE="$(body "$EVENT_CURRENT")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);before=json.loads(os.environ['BEFORE']);assert x['state']=='synchronized' and x['within_clock_contract'];assert x['configuration_revision']==1 and x['configuration_audit_id']==before['configuration_audit_id'] and x['observation_id']==before['observation_id'];assert not x['configuration_evidence_verified'] and not x['eligible_for_time_sensitive_evidence']"
STALE_REF=$(psqlc "select to_char((clock_timestamp()-interval '2 minutes') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
STALE_OBS=$(service_rpc record_connector_time_observation "{\"p_organization_id\":\"$ORG\",\"p_connector_key\":\"$LOCAL_KEY\",\"p_delivery_id\":\"stale-002\",\"p_source_clock_at\":\"$STALE_REF\",\"p_reference_clock_at\":\"$STALE_REF\",\"p_round_trip_delay_ms\":4,\"p_measurement_uncertainty_ms\":2,\"p_evidence_reference\":\"AIO-PTP-OBS-STALE\",\"p_payload_sha256\":\"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"}"); ok "$STALE_OBS"
BODY="$(body "$STALE_OBS")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['state']=='stale' and not x['eligible_for_time_sensitive_evidence']"
STALE_NOW=$(psqlc "select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
STALE=$(rpc "$ADMIN" evaluate_connector_event_time "{\"p_connector_id\":\"$LOCAL_ID\",\"p_event_time\":\"$STALE_NOW\"}"); ok "$STALE"
BODY="$(body "$STALE")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['state']=='stale' and not x['within_clock_contract'] and not x['eligible_for_time_sensitive_evidence']"

# Give the foreign tenant one service observation, then prove authenticated
# direct reads retain only the caller's tenant.
FREF=$(psqlc "select to_char((clock_timestamp()-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
FOREIGN_OBS=$(CLOCK_REVISION=1 service_rpc record_connector_time_observation "{\"p_organization_id\":\"$OTHER_ORG\",\"p_connector_key\":\"$FOREIGN_KEY\",\"p_delivery_id\":\"foreign-001\",\"p_source_clock_at\":\"$FREF\",\"p_reference_clock_at\":\"$FREF\",\"p_round_trip_delay_ms\":2,\"p_measurement_uncertainty_ms\":1,\"p_evidence_reference\":\"FOREIGN-OBS-0001\",\"p_payload_sha256\":\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\"}")
ok "$FOREIGN_OBS"
VISIBLE=$(curl -sS -w '\n%{http_code}' "$API_URL/rest/v1/connector_time_observations?select=organization_id" -H "apikey: $ANON_KEY" -H "authorization: Bearer $ADMIN")
test "$(status "$VISIBLE")" = 200
BODY="$(body "$VISIBLE")" ORG="$ORG" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert len(x)>=2 and all(v['organization_id']==os.environ['ORG'] for v in x)"

# An actual two-session clean-chain witness, not a mocked lock assertion. The
# helper independently restricts this mode to GHA + loopback54322 + this fixture.
node scripts/tests/time-assurance-concurrency-postgres.mjs --ci-clock-fixture 127.0.0.1 54322 postgres "$LOCAL_ID" "$LOCAL_KEY"

# Current B can revoke rights and record unavailability after historical A loses
# authority. All profile/classification changes roll back in this CI transaction.
ADMIN_ID=$(psqlc "select time_configured_by from connectors where id='$LOCAL_ID'")
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
begin;
select set_config('request.jwt.claims','{"sub":"$ADMIN_ID","role":"authenticated"}',true);
set local role authenticated;
do \$classify\$
declare r jsonb;
begin
  r:=register_context_source('$LOCAL_ID','customer_operational','context_only',
    'CI-only clock/source revocation regression','unreviewed',null,
    'Synthetic disposable source remains unreviewed; no live data or engineering approval is asserted.');
  assert r->>'status'='registered',r::text;
end
\$classify\$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do \$service_profile_fixture\$ begin
  assert auth.uid() is null,'profile changes require the controlled service fixture, not a client privilege bypass';
end \$service_profile_fixture\$;
update user_profiles set organization_id='$ORG' where id='$OTHER_USER';
update user_profiles set role='planner' where id='$ADMIN_ID';
do \$changed_profiles\$ begin
  assert (select role='planner' from user_profiles where id='$ADMIN_ID');
  assert (select organization_id='$ORG' and role='admin' from user_profiles where id='$OTHER_USER');
end \$changed_profiles\$;
select set_config('request.jwt.claims','{"sub":"$OTHER_USER","role":"authenticated"}',true);
set local role authenticated;
do \$revoke\$
declare r jsonb;
begin
  r:=record_context_source_health('$LOCAL_ID','unavailable',clock_timestamp(),null,
    'Synthetic source unavailable after historical clock administrator demotion.');
  assert r->>'state'='unavailable',r::text;
  r:=transition_context_source_rights('$LOCAL_ID','blocked','CI-E12-REVOKED',
    'Current named administrator revokes this synthetic source after its historical clock administrator was demoted.');
  assert r->>'rights_state'='blocked' and r->>'display_as_live'='false',r::text;
end
\$revoke\$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update user_profiles set organization_id='$OTHER_ORG' where id='$ADMIN_ID';
do \$transferred_profile\$ begin
  assert (select organization_id='$OTHER_ORG' from user_profiles where id='$ADMIN_ID');
end \$transferred_profile\$;
select set_config('request.jwt.claims','{"sub":"$OTHER_USER","role":"authenticated"}',true);
set local role authenticated;
do \$transfer\$
declare r jsonb;
begin
  r:=record_context_source_health('$LOCAL_ID','unavailable',clock_timestamp(),null,
    'Synthetic source remains unavailable after historical clock administrator transfer.');
  assert r->>'state'='unavailable',r::text;
end
\$transfer\$;
reset role;
do \$retained\$
begin
  update connectors set enabled=false where id='$LOCAL_ID';
  assert (select time_configured_by='$ADMIN_ID' and not enabled from connectors where id='$LOCAL_ID'),
    'unrelated disable must preserve historical clock identity';
  begin
    update connectors set time_tolerance_ms=999 where id='$LOCAL_ID';
    raise exception 'test failed: raw clock change accepted after historical administrator transfer';
  exception when others then
    if sqlerrm not like '%governed configuration RPC%' then raise; end if;
  end;
end
\$retained\$;
rollback;
SQL

echo "Time synchronization assurance smoke passed: canonical_connector=true named_human=true service_only=true tenant_wall=true exact_offset=true uncertainty=true replay_safe=true envelope_match=true initial_config_guard=true complete_contract_guard=true owner_write_guard=true identity_retained=true immutable_history=true truncate_refused=true hindsight_refused=true future_refused=true revisioned=true historical_contract=true audit_receipt_guard=true concurrent_intent_replay=true cross_connector_collision_refused=true rollback_retry=true historical_admin_revocation=true historical_admin_transfer=true stale_fail_closed=true canonical_evidence_approval=false operational_authority=false"

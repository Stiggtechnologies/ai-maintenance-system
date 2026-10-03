#!/usr/bin/env bash
set -euo pipefail
trap 'echo "SC-01 canonical Context smoke FAILED at line $LINENO"' ERR

psqlc(){ PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
eval "$(supabase status -o env | grep -E '^(ANON_KEY|API_URL)=')"
: "${API_URL:?}" "${ANON_KEY:?}"
ORG='11111111-1111-1111-1111-111111111111'
OTHER_ORG='99999999-9999-4999-8999-999999999931'
FOREIGN_USER='99999999-9999-4999-8999-999999999932'
AI_ADMIN_USER='99999999-9999-4999-8999-999999999933'
TECH_USER='99999999-9999-4999-8999-999999999934'
EVENT_REC='99999999-9999-4999-8999-999999999941'
EVENT_WORK='99999999-9999-4999-8999-999999999942'
OTHER_REC='99999999-9999-4999-8999-999999999943'
OTHER_WORK='99999999-9999-4999-8999-999999999944'
EVENT_APPROVAL='99999999-9999-4999-8999-999999999945'
OTHER_APPROVAL='99999999-9999-4999-8999-999999999946'

token(){ curl -sS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"; }
rpc(){ curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$2" -H "apikey: $ANON_KEY" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
body(){ printf '%s' "${1%$'\n'*}"; }
status(){ printf '%s' "${1##*$'\n'}"; }
ok(){ test "$(status "$1")" = 200; BODY="$(body "$1")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert 'error' not in x,x"; }
err(){ test "$(status "$1")" = 200; BODY="$(body "$1")" NEEDLE="$2" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert os.environ['NEEDLE'].lower() in x.get('error','').lower(),x"; }
field(){ BODY="$(body "$1")" KEY="$2" python3 -c "import json,os;print(json.loads(os.environ['BODY'])[os.environ['KEY']])"; }

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into organizations(id,name,industry) values('$OTHER_ORG','SC-01 foreign tenant','utilities') on conflict(id) do nothing;
do \$seed\$
begin
  if not exists(select 1 from auth.users where id='$FOREIGN_USER') then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
      raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new,
      email_change_token_current,phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000','$FOREIGN_USER','authenticated','authenticated',
      'sync-context-foreign@syncai.ca',extensions.crypt('Foreign123!@#',extensions.gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{"full_name":"SC-01 Foreign Admin"}','','','','','','','','');
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values('$FOREIGN_USER','$OTHER_ORG','sync-context-foreign@syncai.ca','SC-01 Foreign Admin','admin')
  on conflict(id) do update set organization_id=excluded.organization_id,role='admin';
  if not exists(select 1 from auth.users where id='$AI_ADMIN_USER') then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
      raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new,
      email_change_token_current,phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000','$AI_ADMIN_USER','authenticated','authenticated',
      'sync-context-ai-admin@syncai.ca',extensions.crypt('AiAdmin123!@#',extensions.gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{"full_name":"SC-01 AI Admin"}','','','','','','','','');
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values('$AI_ADMIN_USER','$ORG','sync-context-ai-admin@syncai.ca','SC-01 AI Admin','ai_admin')
  on conflict(id) do update set organization_id=excluded.organization_id,role='ai_admin';
  if not exists(select 1 from auth.users where id='$TECH_USER') then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
      raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new,
      email_change_token_current,phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000','$TECH_USER','authenticated','authenticated',
      'sync-context-tech@syncai.ca',extensions.crypt('Tech123!@#',extensions.gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{"full_name":"SC-01 Technician"}','','','','','','','','');
  end if;
  insert into user_profiles(id,organization_id,email,full_name,role)
  values('$TECH_USER','$ORG','sync-context-tech@syncai.ca','SC-01 Technician','technician')
  on conflict(id) do update set organization_id=excluded.organization_id,role='technician';
end
\$seed\$;
SQL

ADMIN=$(token 'admin@syncai.ca' 'Admin123!@#')
FOREIGN=$(token 'sync-context-foreign@syncai.ca' 'Foreign123!@#')
AI_ADMIN=$(token 'sync-context-ai-admin@syncai.ca' 'AiAdmin123!@#')
TECH=$(token 'sync-context-tech@syncai.ca' 'Tech123!@#')
test -n "$ADMIN" && test -n "$FOREIGN" && test -n "$AI_ADMIN" && test -n "$TECH"
ADMIN_USER=$(psqlc "select id from auth.users where email='admin@syncai.ca' limit 1")
ASSET_ID=$(psqlc "select id from assets where organization_id='$ORG' order by created_at limit 1")

LOCAL_CONNECTOR=$(psqlc "insert into connectors(organization_id,connector_key,name,connector_type,status) values('$ORG','sc01-customer-gis','SC-01 customer GIS','gis','active') on conflict(organization_id,connector_key) where connector_key is not null do update set name=excluded.name returning id")
FOREIGN_CONNECTOR=$(psqlc "insert into connectors(organization_id,connector_key,name,connector_type,status) values('$OTHER_ORG','sc01-simulation','SC-01 foreign simulation','simulation','active') on conflict(organization_id,connector_key) where connector_key is not null do update set name=excluded.name returning id")
AI_CONNECTOR=$(psqlc "insert into connectors(organization_id,connector_key,name,connector_type,status) values('$ORG','sc01-ai-rights-refusal','SC-01 AI rights refusal','gis','active') on conflict(organization_id,connector_key) where connector_key is not null do update set name=excluded.name returning id")
NO_INTERVAL_CONNECTOR=$(psqlc "insert into connectors(organization_id,connector_key,name,connector_type,status,expected_interval_minutes) values('$ORG','sc01-no-interval','SC-01 no interval','gis','active',null) on conflict(organization_id,connector_key) where connector_key is not null do update set expected_interval_minutes=null returning id")
psqlc "delete from geospatial_subject_links where organization_id='$ORG' and feature_id in (select f.id from geospatial_features f join connectors c on c.id=f.source_connector_id where c.organization_id='$ORG' and c.connector_key='revoked'); delete from geospatial_features where organization_id='$ORG' and source_connector_id in (select id from connectors where organization_id='$ORG' and connector_key='revoked')" >/dev/null
psqlc "delete from connectors where organization_id='$ORG' and connector_key='revoked'" >/dev/null
REVOKE_CONNECTOR=$(psqlc "insert into connectors(organization_id,connector_key,name,connector_type,status,expected_interval_minutes) values('$ORG','revoked','SC-01 revocation','gis','active',15) on conflict(organization_id,connector_key) where connector_key is not null do update set expected_interval_minutes=15 returning id")
psqlc "update connectors set expected_interval_minutes=15 where id='$LOCAL_CONNECTOR'" >/dev/null

if [[ "$(psqlc "select context_source_class is null from connectors where id='$LOCAL_CONNECTOR'")" = t ]]; then
  REGISTER_LOCAL=$(rpc "$ADMIN" register_context_source "{\"p_connector_id\":\"$LOCAL_CONNECTOR\",\"p_source_class\":\"customer_operational\",\"p_authority\":\"tenant_authorized\",\"p_purpose\":\"Customer-authorized GIS geometry for governed maintenance context.\",\"p_rights_state\":\"customer_authorized\",\"p_rights_reference\":\"SC01-CUSTOMER-AUTH\",\"p_basis\":\"Named tenant administrator reviewed source ownership and bounded Context purpose.\"}")
  ok "$REGISTER_LOCAL"
fi
if [[ "$(psqlc "select context_source_class is null from connectors where id='$FOREIGN_CONNECTOR'")" = t ]]; then
  REGISTER_FOREIGN=$(rpc "$FOREIGN" register_context_source "{\"p_connector_id\":\"$FOREIGN_CONNECTOR\",\"p_source_class\":\"simulated_industrial\",\"p_authority\":\"context_only\",\"p_purpose\":\"Synthetic geometry used only for isolated Context conformance testing.\",\"p_rights_state\":\"not_required\",\"p_rights_reference\":null,\"p_basis\":\"Foreign tenant administrator confirms this source is synthetic and never live.\"}")
  ok "$REGISTER_FOREIGN"
fi

AI_RIGHTS=$(rpc "$AI_ADMIN" register_context_source "{\"p_connector_id\":\"$AI_CONNECTOR\",\"p_source_class\":\"customer_operational\",\"p_authority\":\"tenant_authorized\",\"p_purpose\":\"AI identity must never classify customer source rights.\",\"p_rights_state\":\"customer_authorized\",\"p_rights_reference\":\"SC01-AI-DENY\",\"p_basis\":\"This substantive basis exists only to prove that AI legal-rights classification is refused.\"}")
err "$AI_RIGHTS" 'human administrator'

for connector in "$NO_INTERVAL_CONNECTOR" "$REVOKE_CONNECTOR"; do
  if [[ "$(psqlc "select context_source_class is null from connectors where id='$connector'")" = t ]]; then
    REGISTER_EXTRA=$(rpc "$ADMIN" register_context_source "{\"p_connector_id\":\"$connector\",\"p_source_class\":\"customer_operational\",\"p_authority\":\"tenant_authorized\",\"p_purpose\":\"Customer-authorized source for freshness and revocation contract testing.\",\"p_rights_state\":\"customer_authorized\",\"p_rights_reference\":\"SC01-RIGHTS-TEST\",\"p_basis\":\"Named tenant administrator reviewed source ownership, purpose, freshness and revocation behavior.\"}")
    ok "$REGISTER_EXTRA"
  fi
done

CROSS_REGISTER=$(rpc "$ADMIN" register_context_source "{\"p_connector_id\":\"$FOREIGN_CONNECTOR\",\"p_source_class\":\"live_external\",\"p_authority\":\"context_only\",\"p_purpose\":\"This must be refused at the tenant boundary.\",\"p_rights_state\":\"unreviewed\",\"p_rights_reference\":null,\"p_basis\":\"Cross-tenant source classification must never be accepted by the server.\"}")
err "$CROSS_REGISTER" 'not found in this organization'
RECLASSIFY=$(rpc "$FOREIGN" register_context_source "{\"p_connector_id\":\"$FOREIGN_CONNECTOR\",\"p_source_class\":\"live_external\",\"p_authority\":\"context_only\",\"p_purpose\":\"This must be refused because source identity is immutable.\",\"p_rights_state\":\"unreviewed\",\"p_rights_reference\":null,\"p_basis\":\"An existing simulation cannot be relabeled as a live external source.\"}")
err "$RECLASSIFY" 'immutable'

CHECKED_AT=$(psqlc "select to_char(greatest(clock_timestamp(),context_checked_at+interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from connectors where id='$LOCAL_CONNECTOR'")
OBSERVED_AT=$(psqlc "select to_char(('$CHECKED_AT'::timestamptz-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
OLDER_CHECK=$(psqlc "select to_char(('$CHECKED_AT'::timestamptz-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
FOREIGN_CHECKED_AT=$(psqlc "select to_char(greatest(clock_timestamp(),context_checked_at+interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from connectors where id='$FOREIGN_CONNECTOR'")
FOREIGN_OBSERVED_AT=$(psqlc "select to_char(('$FOREIGN_CHECKED_AT'::timestamptz-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")

HEALTH_LOCAL=$(rpc "$ADMIN" record_context_source_health "{\"p_connector_id\":\"$LOCAL_CONNECTOR\",\"p_state\":\"live\",\"p_checked_at\":\"$CHECKED_AT\",\"p_observed_at\":\"$OBSERVED_AT\",\"p_detail\":\"CI customer-authorized observation.\"}")
ok "$HEALTH_LOCAL"
NO_INTERVAL_CHECK=$(psqlc "select to_char(greatest(clock_timestamp(),context_checked_at+interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from connectors where id='$NO_INTERVAL_CONNECTOR'")
NO_INTERVAL_OBS=$(psqlc "select to_char(('$NO_INTERVAL_CHECK'::timestamptz-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
NO_INTERVAL_LIVE=$(rpc "$ADMIN" record_context_source_health "{\"p_connector_id\":\"$NO_INTERVAL_CONNECTOR\",\"p_state\":\"live\",\"p_checked_at\":\"$NO_INTERVAL_CHECK\",\"p_observed_at\":\"$NO_INTERVAL_OBS\",\"p_detail\":\"Must fail without a freshness interval.\"}")
err "$NO_INTERVAL_LIVE" 'freshness interval'
REGRESSION_CHECK=$(psqlc "select to_char(('$CHECKED_AT'::timestamptz+interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
REGRESSION_OBS=$(psqlc "select to_char(('$OBSERVED_AT'::timestamptz-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
REGRESSION=$(rpc "$ADMIN" record_context_source_health "{\"p_connector_id\":\"$LOCAL_CONNECTOR\",\"p_state\":\"live\",\"p_checked_at\":\"$REGRESSION_CHECK\",\"p_observed_at\":\"$REGRESSION_OBS\",\"p_detail\":\"Must not regress live observation time.\"}")
err "$REGRESSION" 'cannot regress'
DELAYED_CHECK=$(psqlc "select to_char(('$CHECKED_AT'::timestamptz+interval '2 seconds') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
DELAYED=$(rpc "$ADMIN" record_context_source_health "{\"p_connector_id\":\"$LOCAL_CONNECTOR\",\"p_state\":\"delayed\",\"p_checked_at\":\"$DELAYED_CHECK\",\"p_observed_at\":\"$REGRESSION_OBS\",\"p_detail\":\"Explicit delayed evidence must not regress the canonical observation.\"}")
ok "$DELAYED"
BODY="$(body "$DELAYED")" OBSERVED_AT="$OBSERVED_AT" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['observed_at'].startswith(os.environ['OBSERVED_AT'][:19])"
STALE_CHECK=$(psqlc "select to_char(('$CHECKED_AT'::timestamptz+interval '3 seconds') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
MISLABELED_STALE=$(rpc "$ADMIN" record_context_source_health "{\"p_connector_id\":\"$LOCAL_CONNECTOR\",\"p_state\":\"stale\",\"p_checked_at\":\"$STALE_CHECK\",\"p_observed_at\":\"$REGRESSION_OBS\",\"p_detail\":\"Out-of-order evidence must be labeled delayed or conflicting.\"}")
err "$MISLABELED_STALE" 'delayed or conflicting'
RESTORE_CHECK=$(psqlc "select to_char(('$CHECKED_AT'::timestamptz+interval '4 seconds') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
RESTORED_LIVE=$(rpc "$ADMIN" record_context_source_health "{\"p_connector_id\":\"$LOCAL_CONNECTOR\",\"p_state\":\"live\",\"p_checked_at\":\"$RESTORE_CHECK\",\"p_observed_at\":\"$OBSERVED_AT\",\"p_detail\":\"Current canonical observation restored to live display.\"}")
ok "$RESTORED_LIVE"
OLDER_HEALTH=$(rpc "$ADMIN" record_context_source_health "{\"p_connector_id\":\"$LOCAL_CONNECTOR\",\"p_state\":\"stale\",\"p_checked_at\":\"$OLDER_CHECK\",\"p_observed_at\":\"$OLDER_CHECK\",\"p_detail\":\"An older check must never overwrite newer health.\"}")
err "$OLDER_HEALTH" 'advance monotonically'
SIM_AS_LIVE=$(rpc "$FOREIGN" record_context_source_health "{\"p_connector_id\":\"$FOREIGN_CONNECTOR\",\"p_state\":\"live\",\"p_checked_at\":\"$FOREIGN_CHECKED_AT\",\"p_observed_at\":\"$FOREIGN_OBSERVED_AT\",\"p_detail\":\"Must be refused.\"}")
err "$SIM_AS_LIVE" 'cannot be relabeled live'

REVOKE_CHECK=$(psqlc "select to_char(greatest(clock_timestamp(),context_checked_at+interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from connectors where id='$REVOKE_CONNECTOR'")
REVOKE_OBS=$(psqlc "select to_char(('$REVOKE_CHECK'::timestamptz-interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
REVOKE_LIVE=$(rpc "$ADMIN" record_context_source_health "{\"p_connector_id\":\"$REVOKE_CONNECTOR\",\"p_state\":\"live\",\"p_checked_at\":\"$REVOKE_CHECK\",\"p_observed_at\":\"$REVOKE_OBS\",\"p_detail\":\"Live immediately before governed revocation.\"}")
ok "$REVOKE_LIVE"
REVOKE_FEATURE=$(rpc "$ADMIN" record_geospatial_feature "{\"p_feature\":{\"feature_type\":\"asset\",\"feature_key\":\"sc01-revoked-object\",\"name\":\"SC-01 rights-revoked object\",\"geometry_type\":\"Point\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[3,3]},\"source_connector_id\":\"$REVOKE_CONNECTOR\",\"source_reference\":\"SC01-REVOKE-1\",\"observed_at\":\"$REVOKE_OBS\",\"validity_kind\":\"permanent\",\"data_quality\":\"good\",\"missing_evidence\":[\"Independent coordinate survey remains required before operational use\"]}}")
ok "$REVOKE_FEATURE"
REVOKE_ID=$(field "$REVOKE_FEATURE" feature_id)
psqlc "update geospatial_features set status='verified',data_quality='verified',verified_by='$AI_ADMIN_USER',verified_at=now(),verification_note='Independent CI verification before governed source-rights revocation.' where id='$REVOKE_ID'; insert into geospatial_subject_links(organization_id,feature_id,relationship_type,asset_id,basis,evidence_item_ids,recorded_by) values('$ORG','$REVOKE_ID','located_at','$ASSET_ID','CI proves verified geometry is visible only while source rights permit it.','{}','$AI_ADMIN_USER') on conflict do nothing" >/dev/null
BEFORE_REVOKE_VIEW=$(rpc "$ADMIN" get_sync_context_snapshot '{}'); ok "$BEFORE_REVOKE_VIEW"
BEFORE_REVOKE_LEGACY=$(rpc "$ADMIN" get_geospatial_operational_workspace '{}'); ok "$BEFORE_REVOKE_LEGACY"
BODY="$(body "$BEFORE_REVOKE_VIEW")" REVOKE_ID="$REVOKE_ID" REVOKE_CONNECTOR="$REVOKE_CONNECTOR" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert any(o['id']==os.environ['REVOKE_ID'] for o in x['objects']);assert any(e['id']=='feature:'+os.environ['REVOKE_ID'] for e in x['events']);assert any(os.environ['REVOKE_CONNECTOR'] in l['sourceDependencies'] for l in x['layers'])"
BODY="$(body "$BEFORE_REVOKE_LEGACY")" REVOKE_ID="$REVOKE_ID" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert any(f['id']==os.environ['REVOKE_ID'] for f in x['features']);assert any(l['feature_id']==os.environ['REVOKE_ID'] for l in x['links'])"
AI_REVOKE=$(rpc "$AI_ADMIN" transition_context_source_rights "{\"p_connector_id\":\"$REVOKE_CONNECTOR\",\"p_rights_state\":\"blocked\",\"p_rights_reference\":\"SC01-AI-REVOKE\",\"p_basis\":\"AI identity must not revoke or classify legal source rights for the customer tenant.\"}")
err "$AI_REVOKE" 'human administrator'
REVOKED=$(rpc "$ADMIN" transition_context_source_rights "{\"p_connector_id\":\"$REVOKE_CONNECTOR\",\"p_rights_state\":\"blocked\",\"p_rights_reference\":\"SC01-REVOKED-001\",\"p_basis\":\"Named tenant administrator revoked this source after the governed rights review was withdrawn.\"}")
ok "$REVOKED"
BODY="$(body "$REVOKED")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['rights_state']=='blocked' and x['display_as_live'] is False"

LOCAL_FEATURE=$(rpc "$ADMIN" record_geospatial_feature "{\"p_feature\":{\"feature_type\":\"hazard_zone\",\"feature_key\":\"sc01-local-zone\",\"name\":\"SC-01 supplied zone\",\"geometry_type\":\"Polygon\",\"geometry\":{\"type\":\"Polygon\",\"coordinates\":[[[0,0],[1,0],[0,1],[0,0]]]},\"source_connector_id\":\"$LOCAL_CONNECTOR\",\"source_reference\":\"SC01-LOCAL-1\",\"observed_at\":\"$OBSERVED_AT\",\"validity_kind\":\"permanent\",\"data_quality\":\"good\",\"missing_evidence\":[\"Independent coordinate survey remains required before operational use\"]}}")
ok "$LOCAL_FEATURE"
FOREIGN_FEATURE=$(rpc "$FOREIGN" record_geospatial_feature "{\"p_feature\":{\"feature_type\":\"asset\",\"feature_key\":\"sc01-foreign-object\",\"name\":\"SC-01 simulated foreign object\",\"geometry_type\":\"Point\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[2,2]},\"source_connector_id\":\"$FOREIGN_CONNECTOR\",\"source_reference\":\"SC01-SIM-1\",\"observed_at\":\"$FOREIGN_OBSERVED_AT\",\"validity_kind\":\"permanent\",\"data_quality\":\"good\",\"missing_evidence\":[\"Synthetic fixture has no operational evidence\"]}}")
ok "$FOREIGN_FEATURE"
LOCAL_ID=$(field "$LOCAL_FEATURE" feature_id)
FOREIGN_ID=$(field "$FOREIGN_FEATURE" feature_id)
psqlc "update geospatial_features set status='verified',data_quality='verified',verified_by='$AI_ADMIN_USER',verified_at=now(),verification_note='Independent CI verification of governed provenance and canonical link behavior.' where id='$LOCAL_ID'; insert into geospatial_subject_links(organization_id,feature_id,relationship_type,asset_id,basis,evidence_item_ids,recorded_by) values('$ORG','$LOCAL_ID','exposed_to','$ASSET_ID','CI binds the supplied feature to an existing canonical asset.','{}','$AI_ADMIN_USER') on conflict do nothing" >/dev/null

# Legacy rows without classified source/owner/validity cannot be promoted or
# reused as verified assessment evidence.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
do \$legacy\$
declare legacy_id uuid;
begin
  update geospatial_features set status='superseded' where organization_id='$ORG'
    and feature_key='legacy' and status in ('draft','verified');
  insert into geospatial_features(organization_id,feature_key,feature_type,name,geometry_type,geometry,source_system,
    source_reference,observed_at,data_quality,missing_evidence,recorded_by)
  values('$ORG','legacy','hazard_zone','SC-01 legacy row','Polygon',
    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[0,1],[0,0]]]}','legacy','legacy-row',now(),'good',
    array['Legacy provenance is incomplete'],'$ADMIN_USER'::uuid) returning id into legacy_id;
  begin
    update geospatial_features set status='verified',data_quality='verified',verified_by='$AI_ADMIN_USER',verified_at=now(),
      verification_note='This promotion must fail because legacy provenance remains incomplete.' where id=legacy_id;
    raise exception 'legacy feature promotion unexpectedly succeeded';
  exception when others then
    if sqlerrm='legacy feature promotion unexpectedly succeeded'
      or position('verified Context features require' in sqlerrm)=0 then raise; end if;
  end;
end
\$legacy\$;
SQL

# A linked approval must govern the same canonical work/recommendation. Approval
# history is then evaluated at each work-event timestamp, not from current state.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL
delete from audit_events where event_data->>'approval_id' in ('$EVENT_APPROVAL','$OTHER_APPROVAL');
delete from approvals where id in ('$EVENT_APPROVAL','$OTHER_APPROVAL');
delete from work_orders where id in ('$EVENT_WORK','$OTHER_WORK');
delete from recommendations where id in ('$EVENT_REC','$OTHER_REC');
insert into recommendations(id,organization_id,title,status) values
  ('$EVENT_REC','$ORG','SC-01 event-time recommendation','pending'),
  ('$OTHER_REC','$ORG','SC-01 unrelated recommendation','pending');
insert into work_orders(id,organization_id,recommendation_id,title,status,source_system) values
  ('$EVENT_WORK','$ORG','$EVENT_REC','SC-01 event-time work','scheduled','sc01-customer-gis'),
  ('$OTHER_WORK','$ORG','$OTHER_REC','SC-01 unrelated work','scheduled','sc01-customer-gis');
insert into approvals(id,organization_id,recommendation_id,work_order_id,status,approver,decided_at) values
  ('$EVENT_APPROVAL','$ORG','$EVENT_REC','$EVENT_WORK','approved','SC-01 human approver','2026-01-01T10:00:00Z'),
  ('$OTHER_APPROVAL','$ORG','$OTHER_REC','$OTHER_WORK','approved','SC-01 other approver','2026-01-01T10:00:00Z');
insert into work_order_status_history(work_order_id,status_from,status_to,changed_at,comments) values
  ('$EVENT_WORK','pending','scheduled','2026-01-01T09:00:00Z','Before approval'),
  ('$EVENT_WORK','pending','scheduled','2026-01-01T11:00:00Z','After approval');
do \$mismatch\$
begin
  begin
    insert into geospatial_subject_links(organization_id,feature_id,relationship_type,work_order_id,approval_id,basis,evidence_item_ids,recorded_by)
    values('$ORG','$LOCAL_ID','served_by','$EVENT_WORK','$OTHER_APPROVAL','This mismatched approval and work link must be rejected by the database.','{}','$ADMIN_USER');
    raise exception 'mismatched approval/work unexpectedly linked';
  exception when others then
    if sqlerrm='mismatched approval/work unexpectedly linked'
      or position('approval does not govern the linked work order' in sqlerrm)=0 then raise; end if;
  end;
end
\$mismatch\$;
update approvals set status='rejected',decided_at='2026-01-01T12:00:00Z',reason='Later rejection must not rewrite prior work-event history.' where id='$EVENT_APPROVAL';
SQL

AUTHORITY_BEFORE=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')")

LOCAL_VIEW=$(rpc "$ADMIN" get_sync_context_snapshot '{}'); ok "$LOCAL_VIEW"
FOREIGN_VIEW=$(rpc "$FOREIGN" get_sync_context_snapshot '{}'); ok "$FOREIGN_VIEW"
LEGACY_VIEW=$(rpc "$ADMIN" get_geospatial_operational_workspace '{}'); ok "$LEGACY_VIEW"
BODY="$(body "$LEGACY_VIEW")" REVOKE_ID="$REVOKE_ID" python3 -c "import json,os;x=json.loads(os.environ['BODY']);private={'context_owner_id','recorded_by','verified_by'};subjects={'work_order_id','evidence_item_id','recommendation_id','decision_id','approval_id','risk_id','restoration_event_id','development_case_id','capital_project_id','audit_event_id'};assert all(not(private & set(v)) for v in x['features']);assert all(not(private & set(v)) for v in x['assessments']);assert all(not((private|subjects) & set(v)) for v in x['links']);assert all(f['id']!=os.environ['REVOKE_ID'] for f in x['features']);assert all(l['feature_id']!=os.environ['REVOKE_ID'] for l in x['links'])"
BODY="$(body "$LOCAL_VIEW")" ORG="$ORG" LOCAL_ID="$LOCAL_ID" FOREIGN_ID="$FOREIGN_ID" REVOKE_ID="$REVOKE_ID" LOCAL_CONNECTOR="$LOCAL_CONNECTOR" REVOKE_CONNECTOR="$REVOKE_CONNECTOR" python3 -c "import json,os;x=json.loads(os.environ['BODY']); assert x['operationalAuthority'] is False; assert any(o['id']==os.environ['LOCAL_ID'] for o in x['objects']); assert all(o['id'] not in (os.environ['FOREIGN_ID'],os.environ['REVOKE_ID']) for o in x['objects']);assert all(e['id']!='feature:'+os.environ['REVOKE_ID'] for e in x['events']); assert any(s['id']==os.environ['LOCAL_CONNECTOR'] and s['organizationId']==os.environ['ORG'] and s['class']=='customer_operational' and s['displayAsLive'] for s in x['sources']); revoked=next(s for s in x['sources'] if s['id']==os.environ['REVOKE_CONNECTOR']);assert revoked['rightsState']=='blocked' and revoked['state']=='unavailable' and not revoked['displayAsLive'];assert all(os.environ['REVOKE_CONNECTOR'] not in l['sourceDependencies'] for l in x['layers']);layer=next(l for l in x['layers'] if l['id']=='hazards_geofences'); assert os.environ['LOCAL_CONNECTOR'] in layer['sourceDependencies'] and layer['recordCount']>0 and not layer['empty']"
BODY="$(body "$LOCAL_VIEW")" EVENT_WORK="$EVENT_WORK" EVENT_APPROVAL="$EVENT_APPROVAL" python3 -c "import json,os;x=json.loads(os.environ['BODY']);e=[v for v in x['events'] if v['canonicalRecord']['id']==os.environ['EVENT_WORK']];before=next(v for v in e if v['occurredAt'].startswith('2026-01-01T09:00:00'));after=next(v for v in e if v['occurredAt'].startswith('2026-01-01T11:00:00'));assert before['governanceState']=='recommended' and before['approvalId'] is None;assert after['governanceState']=='approved' and after['approvalId']==os.environ['EVENT_APPROVAL']"
BODY="$(body "$FOREIGN_VIEW")" OTHER_ORG="$OTHER_ORG" LOCAL_ID="$LOCAL_ID" FOREIGN_ID="$FOREIGN_ID" FOREIGN_CONNECTOR="$FOREIGN_CONNECTOR" python3 -c "import json,os;x=json.loads(os.environ['BODY']); assert all(o['id']!=os.environ['FOREIGN_ID'] for o in x['objects']); assert all(o['id']!=os.environ['LOCAL_ID'] for o in x['objects']); assert any(s['id']==os.environ['FOREIGN_CONNECTOR'] and s['organizationId']==os.environ['OTHER_ORG'] and s['class']=='simulated_industrial' and s['state']=='simulated' and not s['displayAsLive'] for s in x['sources']); layer=next(l for l in x['layers'] if l['id']=='assets_sites'); assert layer['recordCount']==0 and layer['empty']"
ADMIN_REVOKED_FEATURE=$(curl -sS "$API_URL/rest/v1/geospatial_features?select=id&id=eq.$REVOKE_ID" -H "apikey: $ANON_KEY" -H "authorization: Bearer $ADMIN")
test "$ADMIN_REVOKED_FEATURE" = '[]'

TECH_VIEW=$(rpc "$TECH" get_sync_context_snapshot '{}'); ok "$TECH_VIEW"
BODY="$(body "$TECH_VIEW")" python3 -c "import json,os;x=json.loads(os.environ['BODY']);assert x['sources']==[] and x['objects']==[] and x['events']==[];assert all(not layer['authorized'] for layer in x['layers'])"
TECH_CONNECTORS=$(curl -sS "$API_URL/rest/v1/connectors?select=id,context_health_detail" -H "apikey: $ANON_KEY" -H "authorization: Bearer $TECH")
test "$TECH_CONNECTORS" = '[]'
TECH_LINKS=$(curl -sS "$API_URL/rest/v1/geospatial_subject_links?select=work_order_id,decision_id,approval_id,risk_id" -H "apikey: $ANON_KEY" -H "authorization: Bearer $TECH")
test "$TECH_LINKS" = '[]'
TECH_FEATURES=$(curl -sS "$API_URL/rest/v1/geospatial_features?select=id,source_connector_id,recorded_by,verified_by" -H "apikey: $ANON_KEY" -H "authorization: Bearer $TECH")
test "$TECH_FEATURES" = '[]'
TECH_ASSESSMENTS=$(curl -sS "$API_URL/rest/v1/geospatial_operational_assessments?select=id,recorded_by,verified_by" -H "apikey: $ANON_KEY" -H "authorization: Bearer $TECH")
test "$TECH_ASSESSMENTS" = '[]'
AUTHORITY_AFTER=$(psqlc "select (select count(*) from approvals where organization_id='$ORG')||'|'||(select count(*) from work_orders where organization_id='$ORG')")
test "$AUTHORITY_AFTER" = "$AUTHORITY_BEFORE"

NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/get_sync_context_snapshot" -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}')
test "$NOAUTH" = 401
echo 'SC-01 canonical Context smoke passed: two_tenants=true source_identity_immutable=true monotonic_health=true rights_gated=true revocation_hides_prior_geometry=true simulated_not_live=true layer_health=true canonical_projection=true authority_unchanged=true'

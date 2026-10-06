-- Actual migration/receipt/replay assertions in the owned synthetic database.
-- No real identity, collector, engineering approval or production claim.
do $$ begin
  if to_regclass('auth.users') is not null
    or pg_get_functiondef('auth.uid()'::regprocedure) not like '%test.uid%' then
    raise exception 'configuration-intent tests require the isolated synthetic bootstrap';
  end if;
end $$;
select set_config('test.org','11111111-1111-4111-8111-111111111111',false),
  set_config('test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false),
  set_config('test.profile_role','admin',false),set_config('test.jwt_role','authenticated',false);
insert into user_profiles values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','admin');
insert into connectors(id,organization_id,connector_key,name) values
  ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','intent-first','Intent first'),
  ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','intent-second','Intent second');
do $$
declare
  key uuid:=gen_random_uuid(); r jsonb; first_receipt jsonb; status jsonb;
  observed uuid; field text; target uuid; protocol text; authority text;
  tolerance numeric; max_age integer; evidence text; basis text;
  original_basis text:='Synthetic intent replay must not advance the recorded contract or invalidate measurements.';
  configured_at timestamptz; receipt_count bigint; ref timestamptz;
begin
  assert to_regprocedure('public.configure_connector_time_assurance(uuid,text,text,numeric,integer,text,text)') is null,
    'obsolete non-idempotent configuration overload remains reachable';
  assert has_function_privilege('authenticated',
    'public.configure_connector_time_assurance(uuid,text,text,numeric,integer,text,text,uuid)','execute');
  assert not has_function_privilege('anon',
    'public.configure_connector_time_assurance(uuid,text,text,numeric,integer,text,text,uuid)','execute');
  assert not has_function_privilege('service_role',
    'public.configure_connector_time_assurance(uuid,text,text,numeric,integer,text,text,uuid)','execute');
  r:=configure_connector_time_assurance('77777777-7777-4777-8777-777777777777',
    'ptp','Synthetic reference',20,10,'SYNTHETIC-INTENT-REF',original_basis);
  assert r->>'error' like '%stable configuration intent identity%',r::text;
  assert (select time_assurance_revision=0 from connectors where connector_key='intent-first');
  first_receipt:=configure_connector_time_assurance('77777777-7777-4777-8777-777777777777',
    'ptp','Synthetic reference',20,10,'SYNTHETIC-INTENT-REF',original_basis,key);
  assert first_receipt->>'ok'='true' and first_receipt->>'replay'='false',first_receipt::text;
  assert first_receipt->>'idempotency_key'=key::text and first_receipt->>'audit_id' is not null,first_receipt::text;
  assert first_receipt->>'configuration_revision'='1' and first_receipt->>'current_configuration_revision'='1',first_receipt::text;
  assert first_receipt->>'operational_authority'='false' and first_receipt->>'configuration_evidence_verified'='false'
    and first_receipt->>'eligible_for_time_sensitive_evidence'='false',first_receipt::text;
  select time_configured_at into configured_at from connectors where connector_key='intent-first';
  select count(*) into receipt_count from audit_events;
  perform set_config('test.jwt_role','service_role',true);
  ref:=clock_timestamp();
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','intent-first',
    'intent-observation-one',ref,ref,0,0,'SYNTHETIC-INTENT-OBS',repeat('7',64),1);
  observed:=(r->>'observation_id')::uuid;
  assert observed is not null,r::text;
  perform set_config('test.jwt_role','authenticated',true);
  -- Model commit followed by a lost response: exact normalized retry reconciles.
  r:=configure_connector_time_assurance('77777777-7777-4777-8777-777777777777',
    ' PTP ',' Synthetic reference ',20.0,10,' SYNTHETIC-INTENT-REF ',' '||original_basis||' ',key);
  assert r->>'replay'='true' and r->>'audit_id'=first_receipt->>'audit_id',r::text;
  assert r->>'configuration_revision'='1' and r->>'current_configuration_revision'='1',r::text;
  assert (select time_assurance_revision=1 and time_configured_at=configured_at from connectors where connector_key='intent-first');
  assert (select count(*)=receipt_count+1 from audit_events),'retry must not append a new configuration receipt';
  r:=configure_connector_time_assurance('77777777-7777-4777-8777-777777777777',
    'ptp','Synthetic reference',20,10,'SYNTHETIC-INTENT-REF',original_basis,gen_random_uuid());
  assert r->>'error' like '%exact clock contract is already current%',r::text;
  assert (select time_assurance_revision=1 and time_configured_at=configured_at from connectors where connector_key='intent-first');
  assert (select count(*)=receipt_count+1 from audit_events),'new-key unchanged contract must not invalidate observations';
  status:=get_connector_time_assurance();
  assert exists(select 1 from jsonb_array_elements(status->'connectors') x
    where x->>'connectorId'='77777777-7777-4777-8777-777777777777'
      and x->>'observationId'=observed::text and x->>'state'='synchronized');
  foreach field in array array['connector','protocol','authority','tolerance','age','evidence','basis'] loop
    target:='77777777-7777-4777-8777-777777777777'; protocol:='ptp'; authority:='Synthetic reference';
    tolerance:=20; max_age:=10; evidence:='SYNTHETIC-INTENT-REF'; basis:=original_basis;
    if field='connector' then target:='88888888-8888-4888-8888-888888888888'; end if;
    if field='protocol' then protocol:='ntp'; end if;
    if field='authority' then authority:='Different reference'; end if;
    if field='tolerance' then tolerance:=21; end if;
    if field='age' then max_age:=11; end if;
    if field='evidence' then evidence:='SYNTHETIC-OTHER-REF'; end if;
    if field='basis' then basis:=original_basis||' Changed.'; end if;
    r:=configure_connector_time_assurance(target,protocol,authority,tolerance,max_age,evidence,basis,key);
    assert r->>'error' like '%different actor, connector or contract%',field||': '||r::text;
  end loop;
  perform set_config('test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
  r:=configure_connector_time_assurance('77777777-7777-4777-8777-777777777777',
    'ptp','Synthetic reference',20,10,'SYNTHETIC-INTENT-REF',original_basis,key);
  assert r->>'error' like '%different actor, connector or contract%',r::text;
  perform set_config('test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  assert (select time_assurance_revision=0 from connectors where connector_key='intent-second');
  assert (select count(*)=receipt_count+1 from audit_events),'collisions must not append any history';
  -- A separate deliberate act advances the revision. Original replay stays historical.
  r:=configure_connector_time_assurance('77777777-7777-4777-8777-777777777777',
    'ntp','New synthetic reference',5,10,'SYNTHETIC-SECOND-REF',original_basis,gen_random_uuid());
  assert r->>'configuration_revision'='2',r::text;
  perform set_config('test.jwt_role','service_role',true);
  ref:=clock_timestamp();
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','intent-first',
    'intent-observation-two',ref,ref,0,0,'SYNTHETIC-INTENT-OBS',repeat('8',64),2);
  observed:=(r->>'observation_id')::uuid;
  perform set_config('test.jwt_role','authenticated',true);
  select time_configured_at into configured_at from connectors where connector_key='intent-first';
  select count(*) into receipt_count from audit_events;
  r:=configure_connector_time_assurance('77777777-7777-4777-8777-777777777777',
    'ptp','Synthetic reference',20,10,'SYNTHETIC-INTENT-REF',original_basis,key);
  assert r->>'audit_id'=first_receipt->>'audit_id' and r->>'configuration_revision'='1'
    and r->>'current_configuration_revision'='2' and r->>'replay'='true',r::text;
  assert (select time_assurance_revision=2 and time_configured_at=configured_at from connectors where connector_key='intent-first');
  assert (select count(*)=receipt_count from audit_events);
  status:=get_connector_time_assurance();
  assert exists(select 1 from jsonb_array_elements(status->'connectors') x
    where x->>'connectorId'='77777777-7777-4777-8777-777777777777' and x->>'observationId'=observed::text);
  -- Historical A demotion must not block B's unrelated source changes.
  update user_profiles set role='planner' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  r:=configure_connector_time_assurance('77777777-7777-4777-8777-777777777777',
    'ptp','Synthetic reference',20,10,'SYNTHETIC-INTENT-REF',original_basis,key);
  assert r->>'error' like '%named same-tenant human administrator%',r::text;
  perform set_config('test.uid','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
  update connectors set enabled=false,name='Disabled by current administrator' where connector_key='intent-first';
  assert (select not enabled and time_assurance_revision=2 from connectors where connector_key='intent-first');
  begin
    update connectors set time_tolerance_ms=999 where connector_key='intent-first';
    raise exception 'test failed: unauthorized clock fields changed';
  exception when others then
    if sqlerrm not like '%governed configuration RPC%' then raise; end if;
  end;
  begin
    perform set_config('app.time_assurance_config_write','granted',true);
    update connectors set time_tolerance_ms=999 where connector_key='intent-first';
    raise exception 'test failed: demoted historical actor retained clock-write authority';
  exception when others then
    if sqlerrm not like '%named human administrator%' then raise; end if;
  end;
  update user_profiles set role='admin',organization_id='22222222-2222-4222-8222-222222222222'
    where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  update connectors set name='Historical actor transferred safely' where connector_key='intent-first';
  assert (select time_configured_by='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and time_assurance_revision=2
    from connectors where connector_key='intent-first');
  update user_profiles set organization_id='11111111-1111-4111-8111-111111111111'
    where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  -- An equal UUID in another tenant is independent and discloses no local receipt.
  perform set_config('test.org','22222222-2222-4222-8222-222222222222',true);
  perform set_config('test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  r:=configure_connector_time_assurance('44444444-4444-4444-8444-444444444444',
    'ptp','Synthetic reference',20,10,'SYNTHETIC-INTENT-REF',original_basis,key);
  assert r->>'ok'='true' and r->>'replay'='false' and r->>'audit_id'<>first_receipt->>'audit_id',r::text;
end $$;
select 'configuration intent/replay/authority assertions passed; real identity and production remain unproven' as result;

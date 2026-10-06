-- Run AFTER the existing adversarial fixtures in a disposable database only.
-- Uses the actual audit append-only migration, not a second history store.
select set_config('test.org','11111111-1111-4111-8111-111111111111',false),
  set_config('test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false),
  set_config('test.profile_role','admin',false),set_config('test.jwt_role','authenticated',false);
do $$
declare r jsonb; event_at timestamptz; receipt jsonb; old_id uuid;
begin
  select received_at into event_at from connector_time_observations where delivery_id='good-001';
  r:=evaluate_connector_event_time('33333333-3333-4333-8333-333333333333',event_at);
  assert r->>'state'='synchronized' and r->>'configuration_revision'='1',r::text;
  assert r->>'tolerance_ms'='20' and r->>'configuration_audit_id' is not null,r::text;
  assert not (r->>'configuration_evidence_verified')::boolean and not (r->>'eligible_for_time_sensitive_evidence')::boolean,r::text;
  old_id:=(r->>'configuration_audit_id')::uuid;
  select new_state into receipt from audit_events where id=old_id;
  assert receipt->>'configuration_basis' is not null and receipt->>'configured_by'='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',receipt::text;
  assert receipt->>'configured_at' is not null and receipt->>'clock_contract_version'='1',receipt::text;
  r:=configure_connector_time_assurance('33333333-3333-4333-8333-333333333333','ntp','Another reference',1,60,'DRAFT-TIME-REF3','Synthetic tighter tolerance cannot change an already recorded historical verdict.');
  assert r->>'configuration_revision'='3',r::text;
  -- The same instant must not invalidate history when the reader's session zone changes.
  perform set_config('TimeZone','America/Edmonton',true);
  r:=evaluate_connector_event_time('33333333-3333-4333-8333-333333333333',event_at);
  assert r->>'state'='synchronized' and r->>'configuration_revision'='1' and (r->>'configuration_audit_id')::uuid=old_id,r::text;
  assert r->>'tolerance_ms'='20',r::text;
  perform set_config('TimeZone','UTC',true);
  r:=evaluate_connector_event_time('33333333-3333-4333-8333-333333333333',clock_timestamp());
  assert r->>'state'='unproven' and r->>'configuration_revision'='3' and r->>'observation_id' is null,r::text;
  select received_at into event_at from connector_time_observations where delivery_id='stale-002';
  r:=evaluate_connector_event_time('33333333-3333-4333-8333-333333333333',event_at);
  assert r->>'state'='stale' and r->>'configuration_revision'='2' and r->>'max_observation_age_minutes'='1',r::text;
  -- An ordinary owner or service insert must not be able to fabricate a clock receipt.
  begin
    insert into audit_events(organization_id,entity_type,actor,event_data,new_state)
      values('11111111-1111-4111-8111-111111111111','connector_time_assurance_configuration',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',jsonb_build_object('connector_id','33333333-3333-4333-8333-333333333333'),receipt);
    raise exception 'test failed: forged clock audit receipt accepted';
  exception when others then
    if sqlerrm not like '%governed configuration RPC%' then raise; end if;
  end;
  begin
    perform set_config('app.time_assurance_audit_write','granted',true);
    insert into audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
      select organization_id,entity_type,actor,event_data,previous_state,new_state
      from audit_events where entity_type='connector_time_assurance_configuration'
        and event_data->>'connector_id'='33333333-3333-4333-8333-333333333333' and new_state->>'revision'='3';
    raise exception 'test failed: duplicate complete clock receipt accepted';
  exception when others then
    if sqlerrm not like '%receipt already exists%' then raise; end if;
  end;
  -- The shared append-only protection is preserved; no history rewrite exemption.
  begin
    update audit_events set new_state='{}'::jsonb where id=old_id;
    raise exception 'test failed: canonical clock receipt rewrite accepted';
  exception when insufficient_privilege then null;
  end;
  insert into audit_events(organization_id,entity_type,actor,event_data)
    values('11111111-1111-4111-8111-111111111111','unrelated_test_event','test','{}');
  -- Simulate a pre-receipt legacy contract without inventing missing history.
  insert into connectors(id,organization_id,connector_key,name) values(
    '55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','legacy-gap','Historical gap');
  perform set_config('app.time_assurance_config_write','granted',true);
  update connectors set time_sync_protocol='ntp',time_reference_authority='Legacy reference',
    time_tolerance_ms=20,time_observation_max_age_minutes=1,time_evidence_reference='DRAFT-LEGACY-REF',
    time_configuration_basis='Synthetic legacy contract intentionally has no immutable complete receipt.',
    time_configured_by='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',time_configured_at=clock_timestamp(),time_assurance_revision=1
    where connector_key='legacy-gap';
  perform set_config('app.time_assurance_config_write','',true);
  r:=evaluate_connector_event_time('55555555-5555-4555-8555-555555555555',clock_timestamp());
  assert r->>'state'='unproven' and r->>'history_integrity'='unproven' and not (r->>'within_clock_contract')::boolean,r::text;
  r:=configure_connector_time_assurance('66666666-6666-4666-8666-666666666666','ntp','Legacy reference',20,1,'DRAFT-LEGACY-REF','A new valid receipt cannot silently erase malformed prior configuration claims.');
  assert r->>'ok'='true',r::text;
  r:=evaluate_connector_event_time('66666666-6666-4666-8666-666666666666',clock_timestamp());
  assert r->>'state'='unproven' and r->>'history_integrity'='unproven' and r->>'configuration_audit_id' is null,r::text;
end $$;
select 'historical clock-contract assertions passed; approval, GoTrue and production remain unproven' as result;

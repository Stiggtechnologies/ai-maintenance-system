-- Real migration/trigger/RPC behavior with synthetic identity helpers.
-- This does NOT prove the complete migration chain, JWT validation or production deployment.
select set_config('test.org','11111111-1111-4111-8111-111111111111',false),
  set_config('test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false),
  set_config('test.profile_role','admin',false),set_config('test.jwt_role','authenticated',false);
do $$
declare r jsonb; t timestamptz:=clock_timestamp();
begin
  r:=configure_connector_time_assurance('33333333-3333-4333-8333-333333333333','ptp','Site grandmaster',20,1,'DRAFT-TIME-REF','Synthetic clock contract; no canonical source approval is claimed.');
  assert r->>'state'='unproven',r::text;
  r:=evaluate_connector_event_time('33333333-3333-4333-8333-333333333333',t);
  assert r->>'state'='unproven' and r->>'observation_id' is null,r::text;
  r:=configure_connector_time_assurance('44444444-4444-4444-8444-444444444444','ptp','Foreign grandmaster',20,1,'DRAFT-TIME-REF','A local administrator cannot configure a foreign tenant source.');
  assert r->>'error' like '%not found%',r::text;
  begin
    insert into connectors(organization_id,connector_key,name,time_tolerance_ms)
      values('11111111-1111-4111-8111-111111111111','raw-clock','Raw clock',20);
    raise exception 'test failed: raw initial configuration accepted';
  exception when others then
    if sqlerrm not like '%initial connector clock configuration%' then raise; end if;
  end;
  begin
    update connectors set time_tolerance_ms=999 where connector_key='local';
    raise exception 'test failed: owner raw update accepted';
  exception when others then
    if sqlerrm not like '%governed configuration RPC%' then raise; end if;
  end;
  begin
    perform set_config('app.time_assurance_config_write','granted',true);
    update connectors set time_reference_authority=null where connector_key='local';
    raise exception 'test failed: incomplete clock contract accepted';
  exception when check_violation then null;
  end;
  begin
    update connectors set organization_id='22222222-2222-4222-8222-222222222222' where connector_key='local';
    raise exception 'test failed: tenant rebinding accepted';
  exception when others then
    if sqlerrm not like '%original tenant and source identity%' then raise; end if;
  end;
  begin
    delete from connectors where connector_key='local';
    raise exception 'test failed: configured connector deletion accepted';
  exception when others then
    if sqlerrm not like '%connector clock history is retained%' then raise; end if;
  end;
end $$;
select set_config('test.jwt_role','service_role',false);
do $$
declare r jsonb; obs uuid; ref timestamptz:=clock_timestamp()-interval '2 seconds';
  field text; src timestamptz; rt numeric; uncert numeric; evidence text;
begin
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local','good-001',ref+interval '10 milliseconds',ref,4,2,'OBS-DRAFT-0001',repeat('a',64));
  assert r->>'state'='synchronized' and (r->>'offset_ms')::numeric=10 and (r->>'worst_case_offset_ms')::numeric=12,r::text;
  assert (r->>'eligible_for_time_sensitive_evidence')::boolean=false,r::text;
  obs:=(r->>'observation_id')::uuid;
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local','good-001',ref+interval '10 milliseconds',ref,4,2,'OBS-DRAFT-0001',repeat('a',64));
  assert (r->>'replay')::boolean and (r->>'observation_id')::uuid=obs,r::text;
  foreach field in array array['source','reference','roundtrip','uncertainty','evidence'] loop
    src:=ref+interval '10 milliseconds'; rt:=4; uncert:=2; evidence:='OBS-DRAFT-0001';
    if field='source' then src:=src+interval '1 millisecond'; end if;
    if field='roundtrip' then rt:=3; end if;
    if field='uncertainty' then uncert:=3; end if;
    if field='evidence' then evidence:='OBS-DRAFT-0002'; end if;
    r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local','good-001',src,
      ref+case when field='reference' then interval '1 millisecond' else interval '0' end,rt,uncert,evidence,repeat('a',64));
    assert r->>'error' like '%same digest but a different observation envelope%',field||': '||r::text;
  end loop;
  assert (select count(*)=1 from connector_time_observations where delivery_id='good-001');
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local','bad-uncertainty',ref,ref,10,4,'OBS-DRAFT-0003',repeat('b',64));
  assert r->>'error' like '%half the observed%',r::text;
  begin
    delete from connector_time_observations where id=obs;
    raise exception 'test failed: evidence deletion accepted';
  exception when others then
    if sqlerrm not like '%immutable evidence%' then raise; end if;
  end;
  begin
    truncate connector_time_observations;
    raise exception 'test failed: evidence truncation accepted';
  exception when others then
    if sqlerrm not like '%immutable evidence%' then raise; end if;
  end;
  r:=evaluate_connector_event_time('33333333-3333-4333-8333-333333333333',ref);
  assert r->>'state'='unproven' and r->>'observation_id' is null,r::text;
  r:=evaluate_connector_event_time('33333333-3333-4333-8333-333333333333',clock_timestamp()+interval '1 minute');
  assert r->>'error' like '%future event%',r::text;
  r:=evaluate_connector_event_time('33333333-3333-4333-8333-333333333333',clock_timestamp());
  assert r->>'state'='synchronized' and (r->>'within_clock_contract')::boolean,r::text;
  assert not (r->>'eligible_for_time_sensitive_evidence')::boolean and r->>'contract_scope'='current_contract_only',r::text;
  r:=configure_connector_time_assurance('33333333-3333-4333-8333-333333333333','ptp','Site grandmaster',20,1,'DRAFT-TIME-REF2','Synthetic revision invalidates earlier observations, not customer authority.');
  assert r->>'configuration_revision'='2',r::text;
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local','good-001',ref+interval '10 milliseconds',ref,4,2,'OBS-DRAFT-0001',repeat('a',64));
  assert r->>'error' like '%superseded%',r::text;
  ref:=clock_timestamp()-interval '2 minutes';
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local','stale-002',ref,ref,4,2,'OBS-DRAFT-STALE',repeat('c',64));
  assert r->>'state'='stale',r::text;
  r:=evaluate_connector_event_time('33333333-3333-4333-8333-333333333333',clock_timestamp());
  assert r->>'state'='stale' and not (r->>'within_clock_contract')::boolean,r::text;
  ref:=clock_timestamp()+interval '2 seconds';
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local','future-ref',ref,ref,4,3000,'OBS-DRAFT-FUTURE',repeat('d',64));
  assert r->>'state'='unproven',r::text;
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local','huge-uncertainty',ref,ref,4,1e20,'OBS-DRAFT-HUGE',repeat('e',64));
  assert r->>'state'='unproven' and not (r->>'eligible_for_time_sensitive_evidence')::boolean,r::text;
  ref:=clock_timestamp()+interval '1 minute';
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local','future-outside-uncertainty',ref,ref,4,2,'OBS-DRAFT-FUTURE-REFUSED',repeat('f',64));
  assert r->>'error' like '%later than receipt beyond its stated uncertainty%',r::text;
end $$;
-- Non-owner role actually exercises RLS; the foreign tenant has no access to local history.
select set_config('test.org','22222222-2222-4222-8222-222222222222',false),
  set_config('test.uid','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false),set_config('test.jwt_role','authenticated',false);
set role authenticated;
do $$ declare r jsonb; begin
  assert (select count(*)=0 from connector_time_observations);
  r:=evaluate_connector_event_time('33333333-3333-4333-8333-333333333333',clock_timestamp());
  assert r->>'error' like '%not found%',r::text;
end $$;
reset role;
select 'time-assurance isolated PostgreSQL adversarial assertions passed; full Supabase chain, GoTrue and production are unproven' as result;

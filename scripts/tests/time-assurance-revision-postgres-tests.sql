-- Run after history assertions in the owned disposable database only.
-- Actual RPC/row-lock contract; synthetic identity, not JWT or production proof.
select set_config('test.org','11111111-1111-4111-8111-111111111111',false),
  set_config('test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false),
  set_config('test.profile_role','admin',false),set_config('test.jwt_role','service_role',false);
do $$
declare r jsonb; ref timestamptz; n bigint;
begin
  assert not has_function_privilege('authenticated',
    'public.record_connector_time_observation(uuid,text,text,timestamptz,timestamptz,numeric,numeric,text,text,integer)','execute');
  assert not has_function_privilege('anon',
    'public.record_connector_time_observation(uuid,text,text,timestamptz,timestamptz,numeric,numeric,text,text,integer)','execute');
  assert has_function_privilege('service_role',
    'public.record_connector_time_observation(uuid,text,text,timestamptz,timestamptz,numeric,numeric,text,text,integer)','execute');
  select reference_clock_at into ref from connector_time_observations where delivery_id='good-001';
  select count(*) into n from connector_time_observations;
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local',
    'late-omitted-revision',ref,ref,0,0,'OLD-REFERENCE-MEASUREMENT',repeat('9',64));
  assert r->>'error' like '%expected clock-contract revision is required%',r::text;
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local',
    'late-null-revision',ref,ref,0,0,'OLD-REFERENCE-MEASUREMENT',repeat('9',64),null);
  assert r->>'error' like '%expected clock-contract revision is required%',r::text;
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local',
    'late-invalid-revision',ref,ref,0,0,'OLD-REFERENCE-MEASUREMENT',repeat('9',64),0);
  assert r->>'error' like '%expected clock-contract revision is required%',r::text;
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local',
    'late-original-revision',ref,ref,0,0,'OLD-REFERENCE-MEASUREMENT',repeat('9',64),1);
  assert r->>'error' like '%observation names a superseded clock-contract revision%',r::text;
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local',
    'unrecorded-revision',ref,ref,0,0,'OLD-REFERENCE-MEASUREMENT',repeat('9',64),4);
  assert r->>'error' like '%revision is not active%',r::text;
  assert (select count(*)=n from connector_time_observations),'refused observations must not append history';
  ref:=clock_timestamp();
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local',
    'revision-three-current',ref,ref,0,0,'CURRENT-REFERENCE-MEASUREMENT',repeat('8',64),3);
  assert r->>'state'='synchronized' and r->>'configuration_revision'='3',r::text;
  assert not (r->>'eligible_for_time_sensitive_evidence')::boolean,r::text;
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local',
    'revision-three-current',ref,ref,0,0,'CURRENT-REFERENCE-MEASUREMENT',repeat('8',64),3);
  assert (r->>'replay')::boolean,r::text;
  perform set_config('test.jwt_role','authenticated',true);
  r:=configure_connector_time_assurance('33333333-3333-4333-8333-333333333333',
    'ntp','Fourth reference',5,10,'DRAFT-TIME-REF4',
    'Synthetic reconfiguration tests a collection already in flight; approval is not claimed.',gen_random_uuid());
  assert r->>'configuration_revision'='4',r::text;
  perform set_config('test.jwt_role','service_role',true);
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local',
    'revision-three-current',ref,ref,0,0,'CURRENT-REFERENCE-MEASUREMENT',repeat('8',64),3);
  assert r->>'error' like '%observation names a superseded clock-contract revision%',r::text;
  assert (select configuration_revision=3 from connector_time_observations where delivery_id='revision-three-current');
  r:=record_connector_time_observation('11111111-1111-4111-8111-111111111111','local',
    'revision-three-current',ref,ref,0,0,'CURRENT-REFERENCE-MEASUREMENT',repeat('8',64),4);
  assert r->>'error' like '%delivery identifier belongs to a superseded clock-contract revision%',r::text;
  assert (select count(*)=n+1 from connector_time_observations);
end $$;
select 'expected-revision binding assertions passed; collectors, approved evidence and production remain unproven' as result;

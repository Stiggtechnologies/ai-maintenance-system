\set ON_ERROR_STOP on
-- Deliberately synthetic setup. No assertion below represents a real customer result.
insert into organizations values ('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into user_profiles values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','admin','Fixture Administrator'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','reliability_engineer','Fixture Engineer'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','admin','Other Administrator');
insert into billing_subscriptions values
 ('10000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','paid','active','azure_marketplace','Subscribed','purchase',now()+interval '1 day'),
 ('10000000-0000-4000-8000-000000000002','33333333-3333-4333-8333-333333333333','paid','active','direct',null,null,now()+interval '1 day');
insert into marketplace_fulfillment_resolutions values
 ('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','purchase','active','Subscribed','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into assets values
 ('20000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222',null,'FIX-1','Synthetic test asset','Pump',null),
 ('20000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','Starter Pack','SIM-1','Excluded starter','Pump',null),
 ('20000000-0000-4000-8000-000000000003','33333333-3333-4333-8333-333333333333',null,'OTHER-1','Other tenant','Pump',null);
insert into asset_twin_templates values ('30000000-0000-4000-8000-000000000001','approved','Pump','1','{"draft":true}');
insert into evidence_items values
 ('40000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','20000000-0000-4000-8000-000000000001','mapping','verified','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),'DOCUMENTED','Fixture mapping review',null),
 ('40000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','20000000-0000-4000-8000-000000000001','first_result','verified','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),'TESTED','Fixture first result',null),
 ('40000000-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222',null,'customer_acceptance','verified','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),'DOCUMENTED','Fixture acceptance',null),
 ('40000000-0000-4000-8000-000000000004','22222222-2222-4222-8222-222222222222',null,'training_completion','verified','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),'DOCUMENTED','Fixture training',null),
 ('40000000-0000-4000-8000-000000000005','22222222-2222-4222-8222-222222222222',null,'support_handoff','verified','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),'DOCUMENTED','Fixture handoff',null),
 ('40000000-0000-4000-8000-000000000006','33333333-3333-4333-8333-333333333333',null,'mapping','verified','cccccccc-cccc-4ccc-8ccc-cccccccccccc',now(),'DOCUMENTED','Other tenant evidence',null);
insert into connector_runs values ('50000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','success',0,1,now());
insert into asset_onboarding_state values ('20000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','in_progress',null,null);
create function test_assert(p boolean, note text) returns void language plpgsql as $$ begin if p is distinct from true then raise exception 'ASSERT: %',note; end if; end $$;
create function test_refusal(q text, note text) returns void language plpgsql as $$ begin
 begin execute q; exception when others then return; end;
 raise exception 'EXPECTED REFUSAL: %',note;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
select test_refusal($q$select command_implementation(gen_random_uuid(),'10000000-0000-4000-8000-000000000001',null,0,'start','{"outcome":"Test outcome"}')$q$,'non-admin');
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
select test_refusal($q$select command_implementation(gen_random_uuid(),'10000000-0000-4000-8000-000000000002',null,0,'start','{"outcome":"Test outcome"}')$q$,'cross-tenant purchase');
select test_refusal($q$select implementation_evidence('40000000-0000-4000-8000-000000000001',null)$q$,'private evidence helper');
select test_refusal($q$select command_implementation(gen_random_uuid(),'10000000-0000-4000-8000-000000000001',null,0,null,'{}')$q$,'null action');
do $$
declare b uuid := '10000000-0000-4000-8000-000000000001'; c uuid := gen_random_uuid(); j uuid; r jsonb; s jsonb; v integer;
begin
 r := command_implementation(c,b,null,0,'start','{"outcome":"Test outcome"}'); j := (r->>'instanceId')::uuid;
 perform test_assert(command_implementation(c,b,null,0,'start','{"outcome":"Test outcome"}')->>'replayed'='true','exact start replay');
 perform test_refusal(format('select command_implementation(%L,%L,null,0,''start'',''{"outcome":"Changed"}'')',c,b),'conflicting replay');
 r := command_implementation(gen_random_uuid(),b,null,0,'start','{"outcome":"Test outcome"}');
 perform test_assert((r->>'instanceId')::uuid=j,'duplicate billing start reuses journey');
 perform test_assert((select count(*) from deployment_instances)=1,'one deployment per purchase');
 perform test_refusal(format('update deployment_instances set implementation=''{}'' where id=%L',j),'direct metadata forgery');
 perform set_config('syncai.implementation_command','on',true);
 perform test_refusal(format('update deployment_instances set implementation=''{}'' where id=%L',j),'GUC cannot impersonate owner');
 perform test_refusal(format('update deployment_instances set status=''active'' where id=%L',j),'starter provision forbidden');
 perform test_refusal(format('delete from deployment_instances where id=%L',j),'retain journey');
 perform test_refusal($q$insert into audit_events(organization_id,entity_type,event_data) values('22222222-2222-4222-8222-222222222222','implementation_command','{}')$q$,'receipt injection');
 s := '{"assets":[{"assetId":"20000000-0000-4000-8000-000000000001","templateId":"30000000-0000-4000-8000-000000000001","mappingEvidenceId":"40000000-0000-4000-8000-000000000001"}],"runIds":["50000000-0000-4000-8000-000000000001"]}';
 r := command_implementation(gen_random_uuid(),b,j,0,'configure',s,true);
 perform test_assert(r->>'writesPerformed'='false' and (select implementation->>'revision' from deployment_instances where id=j)='0','dry run has no writes');
 perform test_refusal(format('select command_implementation(gen_random_uuid(),%L,%L,0,''configure'',%L)',b,j,replace(s::text,'20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003')),'cross-tenant asset');
 perform test_refusal(format('select command_implementation(gen_random_uuid(),%L,%L,0,''configure'',%L)',b,j,replace(s::text,'20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')),'starter assets excluded');
 perform test_refusal(format('select command_implementation(gen_random_uuid(),%L,%L,0,''configure'',%L)',b,j,replace(s::text,'40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000006')),'cross-tenant evidence');
 r := command_implementation(gen_random_uuid(),b,j,0,'configure',s);
 perform test_refusal(format('select command_implementation(gen_random_uuid(),%L,%L,0,''prepare'',''{}'')',b,j),'out-of-order revision');
 c := gen_random_uuid(); perform set_config('test.fail_onboarding','on',true);
 r := command_implementation(c,b,j,1,'prepare','{}');
 perform test_assert(r->>'phase'='failed','durable failure checkpoint');
 perform test_assert((select count(*) from asset_twin_instances)=0,'compiler writes rollback with failed onboarding');
 perform test_assert(command_implementation(c,b,j,1,'prepare','{}')->>'replayed'='true','failed pass not rerun on replay');
 perform set_config('test.fail_onboarding','off',true);
 r := command_implementation(gen_random_uuid(),b,j,2,'resume','{}');
 r := command_implementation(gen_random_uuid(),b,j,3,'prepare','{}',true);
 perform test_assert((select count(*) from asset_twin_instances)=0,'dry preparation never compiles');
 c := gen_random_uuid(); r := command_implementation(c,b,j,3,'prepare','{}');
 perform test_assert(r->>'phase'='prepared','successful preparation');
 perform test_assert((select count(*) from assets)=3,'no assets seeded');
 perform test_assert((select count(*) from asset_twin_instances)=1,'one canonical twin');
 r := command_implementation(c,b,j,3,'prepare','{}');
 perform test_assert((select count(*) from asset_twin_instances)=1,'replay does not recompile');
 perform test_refusal(format('select command_implementation(gen_random_uuid(),%L,%L,4,''result'',''{"evidenceId":"40000000-0000-4000-8000-000000000002","statement":"Observed first result"}'')',b,j),'readiness is not approval');
 -- Synthetic gate state setup, not evidence that the existing go-live service works.
 update asset_onboarding_state set status='live',approved_by='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',approved_at=now();
 r := command_implementation(gen_random_uuid(),b,j,4,'result','{"evidenceId":"40000000-0000-4000-8000-000000000002","statement":"Observed first result"}');
 perform test_assert(r->>'phase'='result_reviewed','human first-result review');
 perform test_refusal(format('select command_implementation(gen_random_uuid(),%L,%L,5,''accept'',''{"acceptanceEvidenceId":"40000000-0000-4000-8000-000000000003","trainingEvidenceId":"40000000-0000-4000-8000-000000000003","supportEvidenceId":"40000000-0000-4000-8000-000000000005","statement":"Accepted"}'')',b,j),'distinct handoff proof');
 r := command_implementation(gen_random_uuid(),b,j,5,'accept','{"acceptanceEvidenceId":"40000000-0000-4000-8000-000000000003","trainingEvidenceId":"40000000-0000-4000-8000-000000000004","supportEvidenceId":"40000000-0000-4000-8000-000000000005","statement":"Customer accepts this outcome and handoff"}');
 perform test_assert(r->>'phase'='accepted','explicit customer acceptance');
 perform test_assert(get_implementation_workspace()->'journeys'->0->>'current'='true','current acceptance standing');
 update evidence_items set description='Fixture source corrected' where id='40000000-0000-4000-8000-000000000002';
 perform test_assert(get_implementation_workspace()->'journeys'->0->>'current'='false','changed evidence invalidates current completion');
 r := command_implementation(gen_random_uuid(),b,j,6,'pause','{}');
 perform test_assert((select count(*) from asset_twin_instances)=1 and (select count(*) from evidence_items)=6,'pause retains all records');
 r := command_implementation(gen_random_uuid(),b,j,7,'resume','{}');
 perform test_assert(r->>'phase'='planning','resume requires fresh review');
 perform test_refusal($q$update audit_events set event_data='{}' where entity_type='implementation_command'$q$,'immutable receipts');
 perform test_refusal($q$delete from audit_events where entity_type='implementation_command'$q$,'retained receipts');
end $$;
-- Lifecycle state is canonical; the journey never writes it or handles webhook payloads.
update billing_subscriptions set status='suspended',marketplace_status='Suspended' where id='10000000-0000-4000-8000-000000000001';
select test_refusal($q$select command_implementation(gen_random_uuid(),'10000000-0000-4000-8000-000000000001',null,0,'start','{"outcome":"Test outcome"}')$q$,'suspension cannot resume entitlement');
update billing_subscriptions set status='active',marketplace_status='Subscribed' where id='10000000-0000-4000-8000-000000000001';
update marketplace_fulfillment_resolutions set internal_status='activation_pending';
select test_refusal($q$select command_implementation(gen_random_uuid(),'10000000-0000-4000-8000-000000000001',null,0,'start','{"outcome":"Test outcome"}')$q$,'pending binding cannot claim active implementation');
select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
select test_assert(jsonb_array_length(get_implementation_workspace()->'journeys')=0,'tenant wall on reads');
reset role;
select test_refusal('truncate audit_events','truncate receipts');
select test_refusal('truncate deployment_instances','truncate implementation');
select 'native implementation runtime controls passed' as result;

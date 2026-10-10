\set ON_ERROR_STOP on
-- Entirely synthetic qualification records. Never customer completion evidence.
insert into organizations(id,name) values
 ('22222222-2222-4222-8222-222222222222','Disposable integration tenant'),
 ('33333333-3333-4333-8333-333333333333','Other integration tenant');
insert into auth.users(id,email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin@example.invalid'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','engineer@example.invalid'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','other@example.invalid');
insert into user_profiles(id,organization_id,role,full_name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','admin','Synthetic admin'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','reliability_engineer','Synthetic reviewer'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','admin','Other admin');
insert into billing_subscriptions(id,organization_id,plan,status,billing_source) values
 ('10000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','paid','active','direct');
insert into assets(id,organization_id,tag,name,asset_class,area) values
 ('20000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','FIX-01','Synthetic integration asset','Pump','Fixture area');
insert into asset_twin_templates(id,template_key,version,asset_family,asset_class,title,maturity,template) values
 ('30000000-0000-4000-8000-000000000001','synthetic-integration','1','Rotating','Pump','Synthetic template','approved','{"synthetic":true}');
insert into evidence_items(id,organization_id,asset_id,evidence_type,verification_status,verified_by,verified_at,evidence_class,description,risk_id) values
 ('40000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','20000000-0000-4000-8000-000000000001','mapping','verified','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),'DOCUMENTED','RESTRICTED_CANONICAL_MAPPING_MARKER',null),
 ('40000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','20000000-0000-4000-8000-000000000001','first_result','verified','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),'TESTED','RESTRICTED_CANONICAL_RESULT_MARKER',null);
create function test_assert(p boolean, note text) returns void language plpgsql as $$ begin if p is distinct from true then raise exception 'ASSERT: %',note; end if; end $$;
create function test_refusal(q text, note text) returns void language plpgsql as $$ begin
 begin execute q; exception when others then return; end;
 raise exception 'EXPECTED REFUSAL: %',note;
end $$;
-- Fault injection at a database write, leaving both canonical services unchanged.
create function test_onboarding_fault() returns trigger language plpgsql as $$ begin
 if current_setting('test.fail_onboarding',true)='on' then raise exception 'synthetic write failure'; end if;
 return new;
end $$;
create trigger test_onboarding_fault before insert on asset_onboarding_runs for each row execute function test_onboarding_fault();
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $$
declare b uuid := '10000000-0000-4000-8000-000000000001'; a uuid := '20000000-0000-4000-8000-000000000001';
 j uuid; c uuid; r jsonb; item record; runs int; twin uuid; saved jsonb;
 s jsonb := '{"assets":[{"assetId":"20000000-0000-4000-8000-000000000001","templateId":"30000000-0000-4000-8000-000000000001","mappingEvidenceId":"40000000-0000-4000-8000-000000000001"}],"runIds":[]}';
begin
 perform test_assert((select count(*) from asset_onboarding_items where asset_id=a)>100,'real requirements seeded by canonical asset trigger');
 perform test_assert(not (get_golive_readiness(a)->>'ready')::boolean,'real readiness refuses incomplete checklist');
 r := command_implementation(gen_random_uuid(),b,null,0,'start','{"outcome":"Synthetic integration qualification"}'); j := (r->>'instanceId')::uuid;
 r := command_implementation(gen_random_uuid(),b,j,0,'configure',s);
 insert into asset_twin_instances(organization_id,asset_id,template_id,compiled_version,compiled_twin)
 values('22222222-2222-4222-8222-222222222222',a,'30000000-0000-4000-8000-000000000001','1+customer','{"conflicting":true}');
 perform test_refusal(format('select command_implementation(gen_random_uuid(),%L,%L,1,''prepare'',''{}'',true)',b,j),'dry run rejects conflicting real twin');
 delete from asset_twin_instances where asset_id=a;
 select count(*) into runs from asset_onboarding_runs;
 r := command_implementation(gen_random_uuid(),b,j,1,'prepare','{}',true);
 perform test_assert((select count(*) from asset_twin_instances)=0 and (select count(*) from asset_onboarding_runs)=runs,'dry run has no real compiler/autofill writes');
 perform set_config('test.fail_onboarding','on',true);
 c := gen_random_uuid(); r := command_implementation(c,b,j,1,'prepare','{}');
 perform test_assert(r->>'phase'='failed' and (select count(*) from asset_twin_instances)=0,'real compiler rolled back after actual onboarding write failure');
 perform test_assert(command_implementation(c,b,j,1,'prepare','{}')->>'replayed'='true','failed receipt survives retry');
 perform set_config('test.fail_onboarding','off',true);
 r := command_implementation(gen_random_uuid(),b,j,2,'resume','{}');
 c := gen_random_uuid(); r := command_implementation(c,b,j,3,'prepare','{}');
 perform test_assert(r->>'phase'='prepared','unchanged canonical services complete preparation');
 select id,compilation_log into twin,saved from asset_twin_instances where asset_id=a;
 perform test_assert(jsonb_array_length(saved)=1 and saved->0->>'actor'=auth.uid()::text,'actual compiler lineage names authenticated actor');
 perform test_assert((select count(*) from assets)=1 and (select count(*) from sensors)=0,'no synthetic assets or sensors added by journey');
 perform test_assert((select count(*) from asset_onboarding_runs)>runs,'actual autofill run persisted');
 r := command_implementation(c,b,j,3,'prepare','{}');
 perform test_assert((select compilation_log from asset_twin_instances where id=twin)=saved,'duplicate retry does not recompile');
 perform test_refusal(format('select command_implementation(gen_random_uuid(),%L,%L,4,''result'',''{"evidenceId":"40000000-0000-4000-8000-000000000002","statement":"Synthetic review"}'')',b,j),'actual readiness blocks first result');
 -- Exercise existing human-input and approval services with explicitly synthetic answers.
 perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
 for item in select i.id from asset_onboarding_items i join onboarding_requirements q on q.key=i.requirement_key
   where i.asset_id=a and q.required_for_golive and i.status not in ('auto_filled','deduced','human_provided','not_applicable') loop
   perform test_assert(provide_onboarding_item(item.id,'{"synthetic_qualification_only":true}','Synthetic test input; no customer claim',false)->>'updated'='true','real human-input service');
 end loop;
 perform test_assert((get_golive_readiness(a)->>'ready')::boolean,'canonical checklist ready after explicit test input');
 perform test_assert(approve_asset_golive(a)->>'approved'='true','canonical human approval gate');
 perform test_assert(exists(select 1 from decisions where asset_id=a and decision_type='onboarding_gate'),'canonical approval decision retained');
 perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
 perform test_refusal(format('select command_implementation(gen_random_uuid(),%L,%L,4,''result'',''{"evidenceId":"40000000-0000-4000-8000-000000000002","statement":"Synthetic review only"}'')',b,j),'even canonical approval cannot substitute for immutable evidence provenance');
 -- A real re-autofill must preserve human answers; changed source content invalidates standing.
 perform run_asset_onboarding(a);
 perform test_assert((select count(*) from asset_onboarding_items where asset_id=a and provided_by='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')>0,'canonical autofill preserves human inputs');
 update evidence_items set description='Changed synthetic qualification source' where id='40000000-0000-4000-8000-000000000002';
 perform test_assert(get_implementation_workspace()->'journeys'->0->>'current'='false','mutable legacy evidence never qualifies completion');
 perform set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
 perform test_assert(jsonb_array_length(get_implementation_workspace()->'journeys')=0,'tenant switch hides durable state');
 perform test_refusal(format('select command_implementation(gen_random_uuid(),%L,%L,5,''pause'',''{}'')',b,j),'other tenant cannot mutate');
 perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
 perform test_assert(get_implementation_workspace()->'journeys'->0->>'id'=j::text,'returning session resumes same durable journey');
end $$;
reset role;
-- Same-tenant broadly readable deployment/audit tables cannot expose source text.
insert into user_profiles(id,organization_id,role,full_name) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222','planner','Synthetic unauthorized planner');
create or replace function can_read_risk(uuid) returns boolean language sql stable as $$
 select exists(select 1 from user_profiles where id=auth.uid() and role='admin') $$;
alter table evidence_items enable row level security;
create policy integration_restricted_evidence on evidence_items as restrictive for select to authenticated
 using(risk_id is null or can_read_risk(risk_id));
update evidence_items set risk_id='90000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false);
select test_assert((select count(*) from evidence_items)=0,'same-company planner cannot read restricted source evidence');
select test_assert((select count(*) from deployment_instances)=1,'test exercises direct same-company deployment read');
select test_assert(not exists(select 1 from deployment_instances where implementation::text like '%RESTRICTED_CANONICAL%'),'direct deployment read contains no copied restricted evidence');
select test_assert((select count(*) from audit_events where entity_type='implementation_command')>0,'test exercises direct same-company audit read');
select test_assert(not exists(select 1 from audit_events where entity_type='implementation_command' and event_data::text like '%RESTRICTED_CANONICAL%'),'direct audit read contains no copied restricted evidence');
select test_refusal('select get_implementation_workspace()','non-admin workspace refusal');
select test_refusal('select implementation_evidence(''40000000-0000-4000-8000-000000000001'')','private evidence helper refusal');
reset role;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
delete from asset_onboarding_items where asset_id='20000000-0000-4000-8000-000000000001' and requirement_key='s1_asset_name';
select test_assert((implementation_manifest((select implementation->'scope' from deployment_instances limit 1))->'assets'->0->'readiness'->>'catalogIncomplete')::boolean,'deleted required item is compared to full catalog and cannot disappear');
select 'unchanged canonical compiler, onboarding, readiness and human approval integration passed' as result;

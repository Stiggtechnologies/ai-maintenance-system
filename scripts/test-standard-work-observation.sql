\set ON_ERROR_STOP on
-- Rollback-only subject fixture. Not authenticated RLS or full-chain proof.
begin;
create schema auth;
create table auth.users(id uuid primary key);
create table standard_work(id bigint primary key, title text);
create table procedure_translations(id bigint primary key, standard_work_id bigint, content text);
create table work_orders(id uuid primary key);
create table evidence_items(id uuid primary key);
create function sync_delivery_failure_types() returns text[] language sql as $$
 select array['project_delivery.bad_estimate']::text[]
$$;
create table learning_events (
 id uuid primary key default gen_random_uuid(), event_type text not null,
 development_case_id uuid, failure_mode_key text, cause text, corrective_action text,
 title text, detail text, applicability text, expected_value numeric,
 verified_value numeric, model_confidence int,
 constraint learning_events_case_lesson_complete check (true)
);
\ir ../supabase/migrations/20261225190000_standard_work_observation_subject.sql
insert into auth.users values('00000000-0000-0000-0000-000000000001');
insert into work_orders values('00000000-0000-0000-0000-000000000002');
insert into evidence_items values('00000000-0000-0000-0000-000000000003');
insert into standard_work values(1,'Original standard'),(2,'Unreferenced standard');
insert into procedure_translations values(1,1,'Original content'),(2,2,'Unreferenced content');
do $$ begin
 begin
  insert into learning_events(event_type) values('standard_work_observation');
  raise exception 'capture unexpectedly enabled';
 exception when raise_exception then
  if sqlerrm not like 'standard-work observations require%' then raise; end if;
 end;
end $$;
-- Isolated constraint inspection only: bypass the temporary capture lock to
-- seed a complete historical observation, then restore it before mutation tests.
alter table learning_events disable trigger standard_work_observation_guard;
insert into learning_events(id,event_type,title,detail,applicability,
 standard_procedure_id,standard_execution_work_order_id,standard_execution_evidence_id,
 standard_execution_observed_at,standard_execution_recorded_by,standard_execution_description,
 standard_variation_kind,standard_variation_basis,standard_outcome_description,standard_outcome_evidence_id)
values('00000000-0000-0000-0000-000000000004','standard_work_observation',
 'Observed execution','Observed work and retained learning','Applicable to similar installations',
 1,'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',
 now(),'00000000-0000-0000-0000-000000000001','Sequence observed in field',
 'undetermined','Missing view of intermediate steps','Observed outcome; causality not established',
 '00000000-0000-0000-0000-000000000003');
do $$ declare col text; begin
 foreach col in array array['standard_procedure_id','standard_execution_work_order_id',
  'standard_execution_evidence_id','standard_execution_observed_at','standard_execution_recorded_by',
  'standard_execution_description','standard_variation_kind','standard_variation_basis',
  'standard_outcome_description','standard_outcome_evidence_id','title','detail','applicability'] loop
  begin
   execute format('update learning_events set %I=null',col);
   raise exception 'missing field accepted: %',col;
  exception when check_violation then null; end;
 end loop;
 begin
  update learning_events set verified_value=100;
  raise exception 'unverified financial benefit accepted';
 exception when check_violation then null; end;
 begin
  update learning_events set standard_variation_kind='improved';
  raise exception 'unsupported variation kind accepted';
 exception when check_violation then null; end;
 begin
  update learning_events set event_type='lesson_learned';
  raise exception 'observation columns accepted on unrelated type';
 exception when check_violation then null; end;
end $$;
alter table learning_events enable trigger standard_work_observation_guard;
do $$ declare statement text; begin
 foreach statement in array array[
  'update procedure_translations set content=''Rewritten'' where id=1',
  'update procedure_translations set standard_work_id=2 where id=1',
  'delete from procedure_translations where id=1',
  'update standard_work set title=''Rewritten'' where id=1',
  'delete from standard_work where id=1'
 ] loop
  begin
   execute statement;
   raise exception 'observed source mutation accepted';
  exception when raise_exception then
   if sqlerrm not like 'Observed standard/procedure history is immutable%' then raise; end if;
  end;
 end loop;
end $$;
-- No-op writes and genuinely unreferenced content retain existing semantics.
update procedure_translations set content=content where id=1;
update procedure_translations set content='Updated unreferenced content' where id=2;
delete from procedure_translations where id=2;
update standard_work set title='Updated unreferenced standard' where id=2;
delete from standard_work where id=2;
do $$ begin
 begin
  update learning_events set title='Rewrite';
  raise exception 'history mutation accepted';
 exception when raise_exception then
  if sqlerrm not like 'standard-work observations are immutable%' then raise; end if;
 end;
 begin
  delete from learning_events;
  raise exception 'history deletion accepted';
 exception when raise_exception then
  if sqlerrm not like 'standard-work observations are immutable%' then raise; end if;
 end;
end $$;
-- Recorder fixture: real SQL implementation, stubbed session identity only.
create function auth.uid() returns uuid language sql as $$
 select '00000000-0000-0000-0000-000000000001'::uuid
$$;
create function app_current_org() returns uuid language sql as $$
 select '00000000-0000-0000-0000-000000000010'::uuid
$$;
create table user_profiles(id uuid,organization_id uuid,role text);
insert into user_profiles values(auth.uid(),app_current_org(),'planner');
alter table learning_events add column organization_id uuid;
alter table standard_work add column organization_id uuid,
 add column source_project_ca_id uuid,add column revision_approval_id uuid;
alter table procedure_translations add column organization_id uuid,
 add column translation_status text,add column verified_by uuid,add column verified_at timestamptz;
alter table work_orders add column organization_id uuid;
alter table evidence_items add column organization_id uuid;
create unique index on evidence_items(organization_id,id);
create table approvals(id uuid,standard_work_revision_id bigint,organization_id uuid,status text);
create table work_packages(id bigint,organization_id uuid,development_case_id uuid);
create table work_package_work(work_package_id bigint,organization_id uuid,work_order_id uuid);
create table audit_events(organization_id uuid,entity_type text,actor text,event_data jsonb,new_state jsonb);
insert into standard_work(id,title,organization_id) values(3,'Verified procedure baseline',app_current_org());
insert into procedure_translations values(3,3,'Verified original steps',app_current_org(),
 'human_verified',auth.uid(),now());
update work_orders set organization_id=app_current_org();
update evidence_items set organization_id=app_current_org();
insert into evidence_items values('00000000-0000-0000-0000-000000000099',
 '00000000-0000-0000-0000-000000000099');
insert into work_packages values(1,app_current_org(),'00000000-0000-0000-0000-000000000020');
insert into work_package_work values(1,app_current_org(),'00000000-0000-0000-0000-000000000002');
\ir ../supabase/migrations/20261225190100_record_standard_work_observation.sql
create function test_observation(payload jsonb, evidence uuid default '00000000-0000-0000-0000-000000000003',
 observed timestamptz default now()) returns jsonb language sql as $$
 select record_standard_work_observation('00000000-0000-0000-0000-000000000020',3,
  '00000000-0000-0000-0000-000000000002',evidence,evidence,observed,payload)
$$;
do $$ declare payload jsonb:=jsonb_build_object('title','Observed installation',
 'learning','Retain the witnessed sequence','applicability','Similar installation work',
 'execution','Witnessed the installation sequence','variationKind','conforming',
 'variationBasis','Compared with the verified procedure','outcome','Installation observed; improvement not established');
 result jsonb; field text; begin
 result:=test_observation(payload);
 if result->>'id' is null or result ? 'error' then raise exception 'capture failed: %',result; end if;
 if not exists(select 1 from learning_events where id=(result->>'id')::uuid
   and organization_id=app_current_org() and standard_execution_recorded_by=auth.uid()
   and verified_value is null and failure_mode_key is null) then raise exception 'incorrect capture'; end if;
 if (select count(*) from audit_events where entity_type='standard_work_observation')<>1 then
  raise exception 'missing capture audit'; end if;
 foreach field in array array['title','learning','applicability','execution','variationKind','variationBasis','outcome'] loop
  result:=test_observation(payload-field);
  if not result ? 'error' then raise exception 'missing field accepted: %',field; end if;
 end loop;
 result:=test_observation(payload,'00000000-0000-0000-0000-000000000099');
 if not result ? 'error' then raise exception 'foreign evidence accepted'; end if;
 result:=test_observation(payload,observed=>now()+interval '1 day');
 if not result ? 'error' then raise exception 'future observation accepted'; end if;
 result:=test_observation(payload,observed=>'infinity'::timestamptz);
 if not result ? 'error' then raise exception 'infinite observation accepted'; end if;
 update user_profiles set role='ai_admin';
 result:=test_observation(payload);
 if not result ? 'error' then raise exception 'AI recorder accepted'; end if;
 update user_profiles set role='planner';
 delete from work_package_work;
 result:=test_observation(payload);
 if not result ? 'error' then raise exception 'unlinked project work accepted'; end if;
 if (select count(*) from audit_events)<>1 then raise exception 'failed write left audit residue'; end if;
 if coalesce(current_setting('syncai.standard_observation_write',true),'')<>'' then
  raise exception 'recorder leaked write capability'; end if;
 begin
  update evidence_items set organization_id='00000000-0000-0000-0000-000000000099'
   where id='00000000-0000-0000-0000-000000000003';
  raise exception 'referenced evidence tenant reassignment accepted';
 exception when foreign_key_violation then null; end;
 begin
  update work_orders set organization_id='00000000-0000-0000-0000-000000000099'
   where id='00000000-0000-0000-0000-000000000002';
  raise exception 'referenced work tenant reassignment accepted';
 exception when foreign_key_violation then null; end;
end $$;
rollback;
\echo 'Standard-work observation subject boundaries passed (isolated fixture only).'

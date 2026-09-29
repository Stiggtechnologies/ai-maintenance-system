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
rollback;
\echo 'Standard-work observation subject boundaries passed (isolated fixture only).'

\set ON_ERROR_STOP on
-- Isolated schema fixture; full authenticated migration-chain tests remain due.
begin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$
 select '00000000-0000-0000-0000-000000000002'::uuid
$$;
create function app_current_org() returns uuid language sql as $$
 select '00000000-0000-0000-0000-000000000001'::uuid
$$;
create table user_profiles(id uuid, organization_id uuid, role text);
insert into auth.users values(auth.uid());
insert into user_profiles values(auth.uid(),app_current_org(),'planner');
create table learning_events (
 id uuid primary key, organization_id uuid, development_case_id uuid,
 failure_mode_key text, cause text, corrective_action text
);
insert into learning_events values
 ('00000000-0000-0000-0000-000000000003',app_current_org(),
  '00000000-0000-0000-0000-000000000004',
  'project_delivery.bad_estimate','Missing scope review','Revise estimating procedure');
create table audit_events (
 organization_id uuid,entity_type text,actor text,event_data jsonb,new_state jsonb
);
create table ca_verifications (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 work_order_id uuid not null, asset_id uuid not null,
 observation_start timestamptz not null default now(),
 observation_days int not null default 90,
 effectiveness text not null default 'observing',
 effectiveness_evaluated_at timestamptz, recurrence_wo_id uuid,
 similar_assets_screened_at timestamptz, similar_exposure jsonb,
 status text default 'open',
 physical_verified_at timestamptz, physical_verified_by uuid, physical_note text,
 causal_addressed_at timestamptz, causal_addressed_by uuid, causal_note text,
 strategy_updated_at timestamptz, strategy_updated_by uuid, strategy_note text
);
\ir ../supabase/migrations/20261225180100_project_fracas_subject.sql
\ir ../supabase/migrations/20261225180200_start_project_fracas.sql
do $$
declare result jsonb;
begin
 result := start_project_ca_verification('00000000-0000-0000-0000-000000000003',' ');
 if result->>'error' is null then raise exception 'Empty basis accepted'; end if;
 update user_profiles set role='ai_admin';
 result := start_project_ca_verification('00000000-0000-0000-0000-000000000003','AI attempt');
 if result->>'error' is null then raise exception 'AI start accepted'; end if;
 update user_profiles set role='planner';
 result := start_project_ca_verification('00000000-0000-0000-0000-000000000003','Source review');
 if result->>'id' is null then raise exception 'Human start failed: %',result; end if;
 result := start_project_ca_verification('00000000-0000-0000-0000-000000000003','Duplicate');
 if result->>'error' is null then raise exception 'Duplicate start accepted'; end if;
 if (select count(*) from audit_events where event_data->>'basis'='Source review'
     and event_data->>'actorId'=auth.uid()::text) <> 1 then
   raise exception 'Expected one attributed audit receipt';
 end if;
end $$;
-- Separate schema-boundary fixture after exercising the RPC.
delete from ca_verifications;
insert into ca_verifications (
 id,organization_id,project_lesson_id,project_started_by,project_start_basis,
 observation_start,observation_days,effectiveness
) values (
 '00000000-0000-0000-0000-000000000005',app_current_org(),
 '00000000-0000-0000-0000-000000000003',auth.uid(),'Reviewed estimate variance',
 null,null,null
);
do $$
declare v_id uuid := '00000000-0000-0000-0000-000000000005'; result jsonb;
begin
 result := attest_ca_stage(v_id,'physical','Invalid asset path');
 if result->>'error' is null then raise exception 'Project used asset attestation'; end if;
 result := screen_similar_assets(v_id);
 if result->>'error' is null then raise exception 'Project used asset screening'; end if;
 begin
   update ca_verifications set observation_days=90 where id=v_id;
   raise exception 'Unexpected observation default accepted';
 exception when check_violation then null; end;
 begin
   update ca_verifications set effectiveness='effective' where id=v_id;
   raise exception 'Unexpected effectiveness accepted';
 exception when check_violation then null; end;
 begin
   update ca_verifications set organization_id='00000000-0000-0000-0000-000000000099' where id=v_id;
   raise exception 'Unexpected subject mutation accepted';
 exception when raise_exception then
   if sqlerrm <> 'Corrective-action subject identity is immutable' then raise; end if;
 end;
 begin
   update learning_events set cause='Rewritten cause';
   raise exception 'Unexpected source mutation accepted';
 exception when raise_exception then
   if sqlerrm <> 'A lesson used by corrective-action closure retains its source facts' then raise; end if;
 end;
 begin
   insert into ca_verifications (
     id,organization_id,project_lesson_id,project_started_by,project_start_basis,
     observation_start,observation_days,effectiveness
   ) values (
     '00000000-0000-0000-0000-000000000006',
     '00000000-0000-0000-0000-000000000099',
     '00000000-0000-0000-0000-000000000003',auth.uid(),'Foreign source',null,null,null
   );
   raise exception 'Unexpected foreign lesson accepted';
 exception when raise_exception then
   if sqlerrm <> 'A complete same-tenant project lesson is required' then raise; end if;
 end;
end $$;
rollback;

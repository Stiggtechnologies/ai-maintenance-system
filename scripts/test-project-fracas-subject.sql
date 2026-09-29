\set ON_ERROR_STOP on
-- Isolated schema fixture; full authenticated migration-chain tests remain due.
begin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$
 select coalesce(nullif(current_setting('test.actor',true),''),
   '00000000-0000-0000-0000-000000000002')::uuid
$$;
create function app_current_org() returns uuid language sql as $$
 select '00000000-0000-0000-0000-000000000001'::uuid
$$;
create table user_profiles(id uuid, organization_id uuid, role text);
insert into auth.users values(auth.uid());
insert into user_profiles values(auth.uid(),app_current_org(),'planner');
insert into auth.users values('00000000-0000-0000-0000-000000000009');
insert into user_profiles values('00000000-0000-0000-0000-000000000009',app_current_org(),'reliability_engineer');
create function app_has_approval_authority() returns boolean language sql as $$
 select exists(select 1 from user_profiles where id=auth.uid() and role='reliability_engineer')
$$;
create table learning_events (
 id uuid primary key, organization_id uuid, development_case_id uuid,
 failure_mode_key text, cause text, corrective_action text, applicability text
);
insert into learning_events values
 ('00000000-0000-0000-0000-000000000003',app_current_org(),
  '00000000-0000-0000-0000-000000000004',
  'project_delivery.bad_estimate','Missing scope review','Revise estimating procedure','All capital projects');
create table development_cases (
 id uuid primary key,organization_id uuid,lifecycle_type text,title text,problem_statement text
);
insert into development_cases values
 ('00000000-0000-0000-0000-000000000004',app_current_org(),'capital_project','Source','Estimate'),
 ('00000000-0000-0000-0000-000000000014',app_current_org(),'capital_project','Future','Estimate'),
 ('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000099','capital_project','Foreign','Estimate');
-- Deliberately permissive matcher dependency: this fixture proves screening
-- population isolation, not the canonical applicability algorithm itself.
create function sync_lesson_applies_to_case(uuid,text,text,uuid,text,text,text)
 returns boolean language sql immutable as $$ select true $$;
create table audit_events (
 organization_id uuid,entity_type text,actor text,event_data jsonb,new_state jsonb
);
create table evidence_items(id uuid primary key,organization_id uuid,unique(organization_id,id));
create table approvals (
 id uuid primary key default gen_random_uuid(),organization_id uuid,status text,
 owner_role text,reason text,required_validation text,approver text,
 approver_user_id uuid,decided_at timestamptz,approval_scope jsonb
);
alter table approvals enable row level security;
create table standard_work (
 id bigserial primary key,organization_id uuid,work_key text,version int,
 title text,basis text,craft text,standard_minutes numeric,crew_template_id bigint,
 unique(organization_id,work_key,version)
);
insert into standard_work(organization_id,work_key,version,title,basis)
 values(app_current_org(),'estimating',1,'Estimate review','Original procedure');
create table procedure_translations (
 organization_id uuid,standard_work_id bigint,language_code text,content text,
 translation_status text,verified_by uuid,verified_at timestamptz
);
insert into procedure_translations values(app_current_org(),1,'en','Review estimate',
 'human_verified',auth.uid(),now());
insert into evidence_items values('00000000-0000-0000-0000-000000000008',app_current_org());
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
\ir ../supabase/migrations/20261225180300_project_fracas_attestation.sql
\ir ../supabase/migrations/20261225180400_project_standard_revision.sql
\ir ../supabase/migrations/20261225180500_request_project_standard_revision.sql
\ir ../supabase/migrations/20261225180600_decide_project_standard_revision.sql
\ir ../supabase/migrations/20261225180700_project_fracas_screening.sql
\ir ../supabase/migrations/20261225180900_register_standard_work_baseline.sql
\ir ../supabase/migrations/20261225181000_project_standard_history_guard.sql
do $$
declare result jsonb; baseline_id bigint;
begin
 result:=register_standard_work_baseline('new-procedure','New procedure','en','Existing controlled content','Source review','00000000-0000-0000-0000-000000000008');
 if result->>'error' is null then raise exception 'Planner registered verified baseline without authority'; end if;
 perform set_config('test.actor','00000000-0000-0000-0000-000000000009',true);
 result:=register_standard_work_baseline('new-procedure','New procedure','en','Existing controlled content','Source review',null);
 if result->>'error' is null then raise exception 'Evidence-free baseline accepted'; end if;
 result:=register_standard_work_baseline('new-procedure','New procedure','en','Existing controlled content','Source review','00000000-0000-0000-0000-000000000008');
 if result->>'status' <> 'human_verified' then raise exception 'Baseline registration failed: %',result; end if;
 baseline_id:=(result->>'standardWorkId')::bigint;
 if not exists(select 1 from standard_work where id=baseline_id and standard_minutes is null) then
   raise exception 'Baseline invented a measured time';
 end if;
 result:=register_standard_work_baseline('new-procedure','New procedure','en','Changed content','Overwrite','00000000-0000-0000-0000-000000000008');
 if result->>'error' is null then raise exception 'Baseline overwritten'; end if;
 if not exists(select 1 from procedure_translations where standard_work_id=baseline_id
   and content='Existing controlled content' and verified_by=auth.uid()) then
   raise exception 'Original content or named verifier lost';
 end if;
 perform set_config('test.actor','',true);
end $$;
-- The history trigger must not accidentally suppress unrelated DELETEs by
-- returning NEW (null for DELETE) from a BEFORE trigger.
insert into procedure_translations values(app_current_org(),999,'en','Disposable unrelated draft','draft',null,null);
delete from procedure_translations where standard_work_id=999;
do $$ begin
 if exists(select 1 from procedure_translations where standard_work_id=999) then
   raise exception 'History guard suppressed an unrelated procedure deletion';
 end if;
end $$;
do $$
declare result jsonb; closure_id uuid; revision_id bigint; rejected_id bigint;
begin
 result := start_project_ca_verification('00000000-0000-0000-0000-000000000003',' ');
 if result->>'error' is null then raise exception 'Empty basis accepted'; end if;
 update user_profiles set role='ai_admin' where id=auth.uid();
 result := start_project_ca_verification('00000000-0000-0000-0000-000000000003','AI attempt');
 if result->>'error' is null then raise exception 'AI start accepted'; end if;
 update user_profiles set role='planner' where id=auth.uid();
 result := start_project_ca_verification('00000000-0000-0000-0000-000000000003','Source review');
 if result->>'id' is null then raise exception 'Human start failed: %',result; end if;
 closure_id := (result->>'id')::uuid;
 result := attest_project_ca_stage(closure_id,'causal','Premature','00000000-0000-0000-0000-000000000008');
 if result->>'error' is null then raise exception 'Out-of-order causal stage accepted'; end if;
 result := attest_project_ca_stage(closure_id,'implementation','Verified',null);
 if result->>'error' is null then raise exception 'Evidence-free stage accepted'; end if;
 result := attest_project_ca_stage(closure_id,'implementation','Verified','00000000-0000-0000-0000-000000000008');
 if result->>'ok' <> 'true' then raise exception 'Implementation failed: %',result; end if;
 result := attest_project_ca_stage(closure_id,'implementation','Overwrite','00000000-0000-0000-0000-000000000008');
 if result->>'error' is null then raise exception 'Overwrite accepted'; end if;
 result := attest_project_ca_stage(closure_id,'causal','Cause addressed','00000000-0000-0000-0000-000000000008');
 if result->>'ok' <> 'true' then raise exception 'Causal stage failed: %',result; end if;
 result := request_project_standard_revision(closure_id,1,'en','Review estimate','No change','Review basis');
 if result->>'error' is null then raise exception 'Unchanged content accepted'; end if;
 result := request_project_standard_revision(closure_id,1,'en','Review estimate and scope completeness','Add scope review','Variance evidence');
 if result->>'status' <> 'draft' or result->>'revisionId' is null then
   raise exception 'Draft revision failed: %',result;
 end if;
 revision_id := (result->>'revisionId')::bigint;
 result := screen_project_ca_exposure(closure_id,'Premature screen');
 if result->>'error' is null then raise exception 'Screening accepted before adoption'; end if;
 if not exists(select 1 from approvals where
   standard_work_revision_id=revision_id and status='required') then
   raise exception 'Canonical pending approval missing';
 end if;
 if not exists(select 1 from procedure_translations where standard_work_id=revision_id
   and translation_status='draft' and verified_at is null) then
   raise exception 'Draft procedure was not preserved as unverified';
 end if;
 begin
   update standard_work set revision_approval_id=null where id=revision_id;
   raise exception 'Canonical approval detached';
 exception when raise_exception then
   if sqlerrm <> 'Project standard revision content and source identity are immutable' then raise; end if;
 end;
 begin
   update standard_work set standard_minutes=999 where id=revision_id;
   raise exception 'Unreviewed standard duration rewrite accepted';
 exception when raise_exception then
   if sqlerrm <> 'Project standard revision content and source identity are immutable' then raise; end if;
 end;
 result := request_project_standard_revision(closure_id,1,'en','Another change','Repeat','Review basis');
 if result->>'error' is null then raise exception 'Stale prior version accepted'; end if;
 begin
   update approvals set status='approved' where standard_work_revision_id=revision_id;
   raise exception 'Generic approval bypass accepted';
 exception when raise_exception then
   if sqlerrm <> 'Use the governed standard revision decision' then raise; end if;
 end;
 update user_profiles set role='reliability_engineer' where id=auth.uid();
 result := decide_project_standard_revision(revision_id,'approved','Self approval');
 if result->>'error' is distinct from 'The revision requester cannot decide their own adoption' then
   raise exception 'Self approval not refused: %',result;
 end if;
 update user_profiles set role='planner' where id=auth.uid();
 perform set_config('test.actor','00000000-0000-0000-0000-000000000009',true);
 result := decide_project_standard_revision(revision_id,'rejected','Scope review needs acceptance criteria');
 if result->>'status' <> 'rejected' then raise exception 'Rejection failed: %',result; end if;
 rejected_id := revision_id;
 perform set_config('test.actor','',true);
 result := request_project_standard_revision(closure_id,1,'en',
   'Review estimate and scope completeness against signed acceptance criteria',
   'Address reviewer feedback','Variance evidence and reviewer feedback');
 if result->>'revisionId' is null then raise exception 'Rejected revision stranded baseline: %',result; end if;
 revision_id := (result->>'revisionId')::bigint;
 if not exists(select 1 from standard_work where id=revision_id and version=3
   and previous_standard_work_id=1) or not exists(select 1 from approvals
   where standard_work_revision_id=rejected_id and status='rejected') then
   raise exception 'Retry did not preserve rejected history and adopted baseline';
 end if;
 perform set_config('test.actor','00000000-0000-0000-0000-000000000009',true);
 result := decide_project_standard_revision(revision_id,'approved','Reviewed exact procedure and supporting evidence');
 if result->>'status' <> 'approved' then raise exception 'Adoption failed: %',result; end if;
 begin
   update procedure_translations set content='Silent rewrite' where standard_work_id=revision_id;
   raise exception 'Approved procedure rewrite accepted';
 exception when raise_exception then
   if sqlerrm <> 'Referenced project procedure content is immutable; request a new revision' then raise; end if;
 end;
 begin
   update standard_work set work_key='different-key' where id=1;
   raise exception 'Prior standard identity rewrite accepted';
 exception when raise_exception then
   if sqlerrm <> 'A referenced prior standard retains its identity and source facts' then raise; end if;
 end;
 if not exists(select 1 from ca_verifications where id=closure_id
   and project_adopted_standard_id=revision_id and strategy_updated_by=auth.uid()
   and effectiveness is null and status='open') then
   raise exception 'Adoption receipt or non-effectiveness boundary failed';
 end if;
 result := decide_project_standard_revision(revision_id,'approved','Repeat');
 if result->>'error' is null then raise exception 'Duplicate adoption accepted'; end if;
 perform set_config('test.actor','',true);
 result := screen_project_ca_exposure(closure_id,'Screened all current candidates');
 if result->>'populationCount' <> '1' or result->>'matchCount' <> '1'
    or result->'population' <> '["00000000-0000-0000-0000-000000000014"]'::jsonb then
   raise exception 'Screen included source or foreign project: %',result;
 end if;
 delete from development_cases where id='00000000-0000-0000-0000-000000000014';
 result := screen_project_ca_exposure(closure_id,'No remaining candidates');
 if result->>'populationCount' <> '0' or result->>'matchCount' <> '0'
    or result->>'limitation' is null then
   raise exception 'Empty population was not disclosed: %',result;
 end if;
 if (select count(*) from audit_events where entity_type='project_ca_screening') <> 2 then
   raise exception 'Rescreening did not retain both audit receipts';
 end if;
 begin
   update standard_work set source_project_ca_id=null where id=revision_id;
   raise exception 'Revision source was detached';
 exception when raise_exception then
   if sqlerrm <> 'Project standard revision content and source identity are immutable' then raise; end if;
 end;
 begin
   insert into standard_work(organization_id,work_key,version,title,basis,
     source_project_ca_id,previous_standard_work_id,change_summary,revision_requested_by)
   values(app_current_org(),'unrelated',2,'Wrong standard','Review',
     closure_id,1,'Different identity',auth.uid());
   raise exception 'Unrelated standard accepted';
 exception when raise_exception then
   if sqlerrm <> 'Revision must retain the same-tenant standard identity and next version' then raise; end if;
 end;
 result := start_project_ca_verification('00000000-0000-0000-0000-000000000003','Duplicate');
 if result->>'error' is null then raise exception 'Duplicate start accepted'; end if;
 if (select count(*) from audit_events where event_data->>'basis'='Source review'
     and event_data->>'actorId'=auth.uid()::text) <> 1 then
   raise exception 'Expected one attributed audit receipt';
 end if;
end $$;
-- Separate schema-boundary fixture after exercising the RPC.
-- The cyclic approval back-reference is deliberately immutable in production.
-- Remove this trigger only for teardown inside this rolled-back test transaction.
drop trigger project_standard_revision_guard on standard_work;
update ca_verifications set project_adopted_standard_id=null;
-- Tear down newest first: a later retry still depends on the rejected
-- predecessor's canonical decision until its own back-reference is detached.
do $$ declare r record; begin
 for r in select id from standard_work where source_project_ca_id is not null order by version desc loop
   update standard_work set revision_approval_id=null where id=r.id;
 end loop;
end $$;
delete from approvals;
delete from standard_work where source_project_ca_id is not null;
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

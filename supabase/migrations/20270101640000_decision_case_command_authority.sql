-- Decision Case command authority
--
-- cowork_workspaces.case_state remains canonical. Every mutation below starts
-- from the tenant-locked canonical row and applies one narrow command payload.
-- No command releases ACTION, creates work, or claims invitation delivery.

alter table public.cowork_workspaces
  add column if not exists case_version integer not null default 0;

alter table public.cowork_workspaces
  drop constraint if exists cowork_workspaces_case_version_nonnegative;
alter table public.cowork_workspaces
  add constraint cowork_workspaces_case_version_nonnegative
  check (case_version >= 0);

update public.cowork_workspaces
set case_version = case
  when coalesce(case_state, '{}'::jsonb) = '{}'::jsonb then 0
  when coalesce(case_state->>'revision', '') ~ '^[0-9]+$'
    then greatest((case_state->>'revision')::integer, 1)
  else 1
end
where case_version = 0;

-- Legacy evidence is fail-closed. Only already-explicit embedded content or a
-- same-tenant canonical evidence_items id survives as supplied evidence. The
-- old browser-only "File ... selected/attached ... Text was not extracted"
-- artifact and every ambiguous legacy row are downgraded to pending/missing.
-- Normalization is itself a replayable revision, not a silent data rewrite.
select set_config('syncai.decision_case_command','on',false);
with candidate as materialized (
  select w.id,w.organization_id,w.case_version,w.case_state previous_state,
    jsonb_set(w.case_state,'{evidence}',coalesce((select jsonb_agg(
      case
        when item->>'persistence'='embedded'
          and length(btrim(coalesce(item->>'finding','')))>=12
          and coalesce(item->>'finding','') !~* '^File .+ (selected|attached).+Text was not extracted'
          then item
        when item->>'persistence'='governed_reference'
          and coalesce(item->>'durableReference','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and exists(select 1 from public.evidence_items e where e.id=case
            when coalesce(item->>'durableReference','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (item->>'durableReference')::uuid else null end and e.organization_id=w.organization_id)
          then item
        else (item-'durableReference') || jsonb_build_object(
          'persistence','pending','quality','missing','state','Pending durable evidence','sourceSystem','Not persisted')
      end order by ordinality)
      from jsonb_array_elements(w.case_state->'evidence') with ordinality x(item,ordinality)),'[]'::jsonb),false
    ) normalized_state
  from public.cowork_workspaces w
  where w.workspace_kind<>'sync' and jsonb_typeof(w.case_state->'evidence')='array'
), changed as materialized (
  select c.*,(c.case_version+1) next_version,clock_timestamp() normalized_at
  from candidate c where c.normalized_state->'evidence' is distinct from c.previous_state->'evidence'
), updated as (
  update public.cowork_workspaces w set case_version=c.next_version,
    case_state=jsonb_set(jsonb_set(c.normalized_state,'{revision}',to_jsonb(c.next_version),true),
      '{updatedAt}',to_jsonb(c.normalized_at),true),updated_at=c.normalized_at
  from changed c where w.id=c.id returning w.id,w.organization_id,w.case_version,w.case_state
)
insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
select u.organization_id,'decision_case_legacy_normalization','migration',
  jsonb_build_object('workspaceId',u.id,'reason','Fail-closed legacy evidence normalization','version',u.case_version),
  c.previous_state,u.case_state from updated u join changed c on c.id=u.id;
select set_config('syncai.decision_case_command','off',false);

create or replace function public.decision_case_authority_role_allowed(p_role text)
returns boolean language sql immutable set search_path=pg_catalog,public as $$
  select coalesce(p_role,'') in ('admin','executive','maintenance_manager','reliability_engineer','planner')
$$;
revoke all on function public.decision_case_authority_role_allowed(text) from public;

create or replace function public.decision_case_contributor_role_allowed(p_role text)
returns boolean language sql immutable set search_path=pg_catalog,public as $$
  select coalesce(p_role,'') in ('admin','executive','maintenance_manager','reliability_engineer','planner','operator','technician')
$$;
revoke all on function public.decision_case_contributor_role_allowed(text) from public;

-- Approval covers only the decision basis. Conversation and a later measured
-- verification outcome are deliberately excluded; the scheduled verification
-- plan and its owner are included and therefore cannot change after approval.
create or replace function public.decision_case_approval_basis(p_state jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'caseId',p_state->'id',
    'caseNumber',p_state->'caseNumber',
    'recommendation',jsonb_build_object(
      'summary',p_state->'recommendation',
      'detail',p_state->'recommendationDetail',
      'metrics',coalesce(p_state->'decisionMetrics','[]'::jsonb),
      'evidenceScore',p_state->'evidenceScore'),
    'evidence',coalesce(p_state->'evidence','[]'::jsonb),
    'humanDecision',coalesce(p_state->'humanDecision','null'::jsonb),
    'verificationPlan',jsonb_build_object(
      'expected',(select item->'baseline' from jsonb_array_elements(
        case when jsonb_typeof(p_state->'valueMetrics')='array' then p_state->'valueMetrics' else '[]'::jsonb end
        ) with ordinality x(item,ordinality) where item->>'id'='verify-expected' order by ordinality desc limit 1),
      'scheduledFor',(select item->'baseline' from jsonb_array_elements(
        case when jsonb_typeof(p_state->'valueMetrics')='array' then p_state->'valueMetrics' else '[]'::jsonb end
        ) with ordinality x(item,ordinality) where item->>'id'='verify-evidence' order by ordinality desc limit 1),
      'question',(select item->'target' from jsonb_array_elements(
        case when jsonb_typeof(p_state->'valueMetrics')='array' then p_state->'valueMetrics' else '[]'::jsonb end
        ) with ordinality x(item,ordinality) where item->>'id'='verify-evidence' order by ordinality desc limit 1),
      'owner',coalesce((select item from jsonb_array_elements(
        case when jsonb_typeof(p_state->'comments')='array' then p_state->'comments' else '[]'::jsonb end
        ) with ordinality x(item,ordinality) where item->>'author'='Verification Owner' order by ordinality desc limit 1),'null'::jsonb)),
    'requiredPerson',coalesce(p_state->'requiredPerson','null'::jsonb),
    'sourceCheck',coalesce((select item from jsonb_array_elements(
      case when jsonb_typeof(p_state->'messages')='array' then p_state->'messages' else '[]'::jsonb end
      ) with ordinality x(item,ordinality) where item->>'meta'='Source connection check' order by ordinality desc limit 1),'null'::jsonb)
  )
$$;
revoke all on function public.decision_case_approval_basis(jsonb) from public;

create or replace function public.decision_case_approval_basis_sha256(p_state jsonb)
returns text language sql immutable set search_path=pg_catalog,public,extensions as $$
  select encode(extensions.digest(public.decision_case_approval_basis(p_state)::text,'sha256'),'hex')
$$;
revoke all on function public.decision_case_approval_basis_sha256(jsonb) from public;

create or replace function public.guard_decision_case_command_write()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='INSERT' and new.workspace_kind<>'sync' and
    (coalesce(new.case_state,'{}'::jsonb)<>'{}'::jsonb or coalesce(new.case_version,0)<>0) then
    raise exception using errcode='42501',message='A new Decision Case workspace must start empty';
  elsif tg_op='UPDATE' and (old.workspace_kind<>'sync' or new.workspace_kind<>'sync') and
    (new.case_state is distinct from old.case_state or new.case_version is distinct from old.case_version) and
    coalesce(current_setting('syncai.decision_case_command',true),'')<>'on' then
    raise exception using errcode='42501',message='Decision Case state must be changed through apply_decision_case_command';
  end if;
  return new;
end $$;
revoke all on function public.guard_decision_case_command_write() from public;

drop trigger if exists cowork_workspace_decision_case_command_guard on public.cowork_workspaces;
create trigger cowork_workspace_decision_case_command_guard before insert or update on public.cowork_workspaces
for each row execute function public.guard_decision_case_command_write();

create or replace function public.get_decision_case_authority_directory()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if v_org is null or v_actor is null or not public.decision_case_contributor_role_allowed(v_role) then
    raise exception using errcode='42501',message='Internal tenant membership is required';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'userId',p.id,'name',coalesce(nullif(btrim(p.full_name),''),p.email),'email',p.email,'role',p.role)
    order by coalesce(nullif(btrim(p.full_name),''),p.email)) from public.user_profiles p
    where p.organization_id=v_org and p.id<>v_actor and public.decision_case_authority_role_allowed(p.role)),'[]'::jsonb);
end $$;
revoke all on function public.get_decision_case_authority_directory() from public,anon;
grant execute on function public.get_decision_case_authority_directory() to authenticated;

create or replace function public.apply_decision_case_command(
  p_workspace_id uuid,p_expected_version integer,p_command text,p_case_state jsonb
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid();
  v_actor_name text; v_actor_role text; v_workspace public.cowork_workspaces%rowtype;
  v_previous jsonb; v_state jsonb; v_payload jsonb:=coalesce(p_case_state,'{}'::jsonb);
  v_now timestamptz:=clock_timestamp(); v_next_version integer; v_allowed text[];
  v_required_user uuid; v_required_name text; v_required_email text; v_required_role text;
  v_decision text; v_reason text; v_delegated_to uuid; v_plan jsonb; v_new_messages jsonb; v_key text; v_person_label text;
  v_approval jsonb; v_basis_digest text; v_existing_expected text; v_existing_scheduled text;
  v_existing_question text; v_post_approval_outcome boolean:=false;
begin
  if v_org is null or v_actor is null then
    raise exception using errcode='42501',message='Authentication and tenant context are required'; end if;
  select coalesce(nullif(btrim(full_name),''),nullif(btrim(email),''),id::text),role
    into v_actor_name,v_actor_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if v_actor_name is null or not public.decision_case_contributor_role_allowed(v_actor_role) then
    raise exception using errcode='42501',message='An authorized internal human profile is required'; end if;

  select * into v_workspace from public.cowork_workspaces
  where id=p_workspace_id and organization_id=v_org and workspace_kind<>'sync' for update;
  if not found then raise exception using errcode='P0002',message='Decision Case workspace was not found in this tenant'; end if;
  if p_expected_version is null or p_expected_version<0 then
    raise exception using errcode='22023',message='Expected Decision Case version is required'; end if;
  if v_workspace.case_version<>p_expected_version then
    -- This is an application-level optimistic concurrency refusal, not a
    -- PostgreSQL serialization failure. 40001 is retryable and the local
    -- PostgREST/Supavisor path will keep retrying it until the gateway times
    -- out. PT409 produces the intended immediate HTTP 409 response.
    raise exception using errcode='PT409',message=format(
      'Decision Case conflict: expected version %s but current version is %s',p_expected_version,v_workspace.case_version); end if;
  if p_command is null or p_command not in ('initialize','record_conversation','add_evidence','record_disposition',
    'define_verification','record_required_person','record_source_check','record_approval') then
    raise exception using errcode='22023',message='Unsupported Decision Case command'; end if;
  if jsonb_typeof(v_payload)<>'object' then
    raise exception using errcode='22023',message='Command payload must be an object'; end if;

  if p_command='initialize' then
    if v_workspace.case_version<>0 or coalesce(v_workspace.case_state,'{}'::jsonb)<>'{}'::jsonb then
      raise exception using errcode='23505',message='Decision Case is already initialized'; end if;
    if jsonb_typeof(v_payload->'messages')<>'array' or jsonb_typeof(v_payload->'evidence')<>'array' or
      jsonb_typeof(v_payload->'comments')<>'array' or jsonb_typeof(v_payload->'approvals')<>'array' or
      jsonb_typeof(v_payload->'valueMetrics')<>'array' then
      raise exception using errcode='23514',message='Decision Case initialization requires canonical collection fields'; end if;
    if v_payload ?| array['humanDecision','requiredPerson','humanApproval','learningRecord'] or
      coalesce(jsonb_array_length(case when jsonb_typeof(v_payload->'approvals')='array' then v_payload->'approvals' else '[]'::jsonb end),0)>0 or
      exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v_payload->'messages')='array' then v_payload->'messages' else '[]'::jsonb end) m
        where m ?| array['actorId','actorRole'] or m->>'meta' in
          ('Human disposition','Required person recorded','Source connection check','Verification obligation')) or
      exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v_payload->'comments')='array' then v_payload->'comments' else '[]'::jsonb end) c
        where c->>'author' in ('Verification Owner','Outcome attribution')) or
      exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v_payload->'valueMetrics')='array' then v_payload->'valueMetrics' else '[]'::jsonb end) m
        where m->>'id' in ('verify-expected','verify-evidence')) then
      raise exception using errcode='42501',message='Initialization may not pre-seed governed Decision Case records'; end if;
    v_state:=v_payload;
  else
    if coalesce(v_workspace.case_state,'{}'::jsonb)='{}'::jsonb then
      raise exception using errcode='55000',message='Decision Case must be initialized first'; end if;
    v_state:=v_workspace.case_state;
    v_allowed:=case p_command
      when 'record_conversation' then array['messages','tokensUsed']
      when 'add_evidence' then array['evidence','evidenceScore','stage','recommendation','recommendationDetail','decisionMetrics']
      when 'record_disposition' then array['humanDecision','people']
      when 'define_verification' then array['verification']
      when 'record_required_person' then array['requiredPerson']
      when 'record_source_check' then array['sourceCheck']
      when 'record_approval' then array['decision','reason','delegatedTo'] else array[]::text[] end;
    if exists(select 1 from jsonb_object_keys(v_payload) k where not(k=any(v_allowed))) then
      raise exception using errcode='42501',message=format('%s payload contains unrelated Decision Case fields',p_command); end if;
    v_approval:=v_state->'humanApproval';
    if coalesce(v_approval,'null'::jsonb)<>'null'::jsonb then
      v_basis_digest:=public.decision_case_approval_basis_sha256(v_state);
      if coalesce(v_approval->>'basisSha256','') !~ '^[0-9a-f]{64}$' or
        v_approval->>'basisSha256' is distinct from v_basis_digest or
        coalesce(v_approval->>'basisVersion','') !~ '^[0-9]+$' then
        raise exception using errcode='55000',message='Decision Case approval basis is stale or unverifiable'; end if;
      if p_command in ('add_evidence','record_disposition','record_required_person','record_source_check') then
        raise exception using errcode='42501',message='Decision Case approval basis is locked; a governed reopen path is required'; end if;
      if p_command='define_verification' and v_approval->>'decision'<>'approved' then
        raise exception using errcode='42501',message='Only an approved case may record the one-time post-approval verification outcome'; end if;
    end if;
  end if;

  if v_state->>'id' is distinct from p_workspace_id::text then
    raise exception using errcode='22023',message='Decision Case id must match its workspace'; end if;
  if v_state#>>'{workPackage,status}' is distinct from 'locked' or
    coalesce(v_state#>'{workPackage,receipt}','null'::jsonb)<>'null'::jsonb then
    raise exception using errcode='42501',message='ACTION must remain locked and unreleased'; end if;

  if p_command='record_conversation' then
    v_new_messages:=v_payload->'messages';
    if jsonb_typeof(v_new_messages)<>'array' or
      jsonb_array_length(v_new_messages)<jsonb_array_length(coalesce(v_state->'messages','[]'::jsonb)) or
      exists(select 1 from generate_series(0,jsonb_array_length(coalesce(v_state->'messages','[]'::jsonb))-1) i
        where v_new_messages->i is distinct from v_state->'messages'->i) or
      exists(select 1 from jsonb_array_elements(v_new_messages) with ordinality m(item,ordinality)
        where item->>'role' not in ('user','assistant','system') or length(btrim(coalesce(item->>'text','')))=0 or
          (ordinality>jsonb_array_length(coalesce(v_state->'messages','[]'::jsonb)) and
            (item ?| array['actorId','actorRole'] or item->>'meta' in
              ('Human disposition','Required person recorded','Source connection check','Verification obligation')))) then
      raise exception using errcode='23514',message='Conversation command may append valid messages but may not rewrite history'; end if;
    v_state:=jsonb_set(v_state,'{messages}',v_new_messages,true);
    v_state:=jsonb_set(v_state,'{tokensUsed}',to_jsonb(greatest(coalesce((v_payload->>'tokensUsed')::integer,0),0)),true);

  elsif p_command='add_evidence' then
    if jsonb_typeof(v_payload->'evidence')<>'array' or not exists(
      select 1 from jsonb_array_elements(v_payload->'evidence') n where not exists(
        select 1 from jsonb_array_elements(coalesce(v_state->'evidence','[]'::jsonb)) o where o->>'id'=n->>'id')) then
      raise exception using errcode='23514',message='Evidence command must add a new evidence identity'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(v_state->'evidence','[]'::jsonb)) o
      where o->>'quality' in ('high','medium') and not exists(
        select 1 from jsonb_array_elements(v_payload->'evidence') n where n=o)) then
      raise exception using errcode='42501',message='Evidence command may not rewrite existing supplied evidence'; end if;
    if exists(select 1 from jsonb_array_elements(v_payload->'evidence') e
      where e->>'quality' in ('high','medium') and not(
        (e->>'persistence'='embedded' and length(btrim(coalesce(e->>'finding','')))>=12
          and coalesce(e->>'finding','') !~* '^File .+ (selected|attached).+Text was not extracted') or
        (e->>'persistence'='governed_reference'
          and coalesce(e->>'durableReference','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and exists(select 1 from public.evidence_items canonical where canonical.id=case
            when coalesce(e->>'durableReference','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (e->>'durableReference')::uuid else null end and canonical.organization_id=v_org)))) then
      raise exception using errcode='23514',message='Supplied evidence requires embedded substantive content or a same-tenant canonical evidence item'; end if;
    foreach v_key in array array['evidence','evidenceScore','stage','recommendation','recommendationDetail','decisionMetrics'] loop
      if v_payload ? v_key then v_state:=jsonb_set(v_state,array[v_key],v_payload->v_key,true); end if;
    end loop;
    v_state:=jsonb_set(v_state,'{messages}',coalesce(v_state->'messages','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
      'id','evidence-'||(v_workspace.case_version+1)::text,'role','system','author',v_actor_name,'actorId',v_actor,'actorRole',v_actor_role,
      'text','Evidence was added through the governed Decision Case command. Supplied status depends on persisted content or canonical evidence identity.',
      'createdAt',v_now,'meta','Evidence recorded')),true);

  elsif p_command='record_disposition' then
    if not public.decision_case_authority_role_allowed(v_actor_role) then
      raise exception using errcode='42501',message='Your role may not record a Decision Case disposition'; end if;
    if jsonb_typeof(v_payload->'humanDecision')<>'object' or exists(
      select 1 from jsonb_object_keys(v_payload->'humanDecision') k
      where k not in ('disposition','rationale','counterfactual','expiresOn')) then
      raise exception using errcode='42501',message='Disposition actor and record metadata are server-owned'; end if;
    if v_payload#>>'{humanDecision,disposition}' not in ('accept','reject','need_more_evidence','park','escalate') or
      length(btrim(coalesce(v_payload#>>'{humanDecision,rationale}','')))=0 then
      raise exception using errcode='23514',message='Disposition and rationale are required'; end if;
    if v_payload#>>'{humanDecision,disposition}'='accept' and
      length(btrim(coalesce(v_payload#>>'{humanDecision,counterfactual}','')))=0 then
      raise exception using errcode='23514',message='Accept requires a counterfactual'; end if;
    if v_payload ? 'people' and (jsonb_typeof(v_payload->'people')<>'object' or exists(
      select 1 from jsonb_each(v_payload->'people') p(key,value)
      where key not in ('decisionOwner','recommendationAuthor','verificationOwner') or
        jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}'))>200)) then
      raise exception using errcode='23514',message='Disposition people must be bounded informational role labels'; end if;
    v_state:=jsonb_set(v_state,'{humanDecision}',((v_payload->'humanDecision')-'actor'-'recordedAt') || jsonb_build_object(
      'actor',jsonb_build_object('id',v_actor,'name',v_actor_name,'role',v_actor_role),'recordedAt',v_now),true);
    v_state:=jsonb_set(v_state,'{comments}',coalesce((select jsonb_agg(c order by ordinality)
      from jsonb_array_elements(coalesce(v_state->'comments','[]'::jsonb)) with ordinality x(c,ordinality)
      where c->>'author' not in ('Decision Owner','Recommendation Author','Required Approver','Verification Owner')),'[]'::jsonb),true);
    foreach v_key in array array['decisionOwner','recommendationAuthor','verificationOwner'] loop
      if length(btrim(coalesce(v_payload#>>array['people',v_key],'')))>0 then
        v_person_label:=case v_key when 'decisionOwner' then 'Decision Owner'
          when 'recommendationAuthor' then 'Recommendation Author' else 'Verification Owner' end;
        v_state:=jsonb_set(v_state,'{comments}',coalesce(v_state->'comments','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
          'id','people-'||v_key||'-'||(v_workspace.case_version+1)::text,'author',v_person_label,
          'text',btrim(v_payload#>>array['people',v_key]),'actorId',v_actor,'actorRole',v_actor_role,'createdAt',v_now)),true);
      end if;
    end loop;
    if length(btrim(coalesce(v_payload#>>'{people,decisionOwner}','')))>0 then
      v_state:=jsonb_set(v_state,'{financeSponsor}',to_jsonb(btrim(v_payload#>>'{people,decisionOwner}')),true); end if;
    v_state:=jsonb_set(v_state,'{stage}',to_jsonb(case when v_payload#>>'{humanDecision,disposition}'='accept' then 'outcomes' else 'authority' end),true);
    v_state:=jsonb_set(v_state,'{statusLabel}',to_jsonb((v_payload#>>'{humanDecision,disposition}')||' · not plant execute'),true);
    v_state:=jsonb_set(v_state,'{messages}',coalesce(v_state->'messages','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
      'id','disposition-'||(v_workspace.case_version+1)::text,'role','system','author',v_actor_name,'actorId',v_actor,'actorRole',v_actor_role,
      'text',format('Disposition %s: %s. Recommend is not authorize. Plant execute stays disabled.',
      v_payload#>>'{humanDecision,disposition}',v_payload#>>'{humanDecision,rationale}'),'createdAt',v_now,'meta','Human disposition')),true);

  elsif p_command='define_verification' then
    if length(btrim(coalesce(v_state#>>'{humanDecision,actor,id}','')))=0 then
      raise exception using errcode='55000',message='Record a governed human disposition before defining verification'; end if;
    v_plan:=v_payload->'verification';
    if jsonb_typeof(v_plan)<>'object' or exists(select 1 from jsonb_object_keys(v_plan) k where k not in
      ('question','expected','actual','evidence','scheduledFor','effectiveness')) or
      length(btrim(coalesce(v_plan->>'expected','')))=0 or
      length(btrim(coalesce(v_plan->>'scheduledFor','')))=0 then
      raise exception using errcode='23514',message='Verification requires expected outcome and scheduled date'; end if;
    begin perform (v_plan->>'scheduledFor')::date; exception when others then
      raise exception using errcode='22023',message='Verification scheduled date is invalid'; end;
    if (length(btrim(coalesce(v_plan->>'effectiveness','')))>0 or length(btrim(coalesce(v_plan->>'actual','')))>0 or
      length(btrim(coalesce(v_plan->>'evidence','')))>0) and
      (v_plan->>'effectiveness' not in ('effective','partially_effective','ineffective','inconclusive') or
       length(btrim(coalesce(v_plan->>'actual','')))=0 or length(btrim(coalesce(v_plan->>'evidence','')))=0) then
      raise exception using errcode='23514',message='Recorded verification requires effectiveness, actual result, and evidence'; end if;
    if coalesce(v_approval,'null'::jsonb)<>'null'::jsonb then
      select item->>'baseline' into v_existing_expected from jsonb_array_elements(v_state->'valueMetrics') item
        where item->>'id'='verify-expected' limit 1;
      select item->>'baseline',item->>'target' into v_existing_scheduled,v_existing_question
        from jsonb_array_elements(v_state->'valueMetrics') item where item->>'id'='verify-evidence' limit 1;
      if v_existing_expected is null or v_existing_scheduled is null or
        btrim(v_plan->>'expected') is distinct from v_existing_expected or
        btrim(v_plan->>'scheduledFor') is distinct from v_existing_scheduled or
        coalesce(nullif(btrim(v_plan->>'question'),''),'How will we know this worked?') is distinct from
          coalesce(nullif(btrim(v_existing_question),''),'How will we know this worked?') then
        raise exception using errcode='42501',message='Post-approval verification must preserve the approved expected and scheduled plan'; end if;
      if exists(select 1 from jsonb_array_elements(v_state->'valueMetrics') item where
        (item->>'id'='verify-expected' and length(btrim(coalesce(item->>'actual','')))>0) or
        (item->>'id'='verify-evidence' and (length(btrim(coalesce(item->>'actual','')))>0 or
          coalesce(nullif(btrim(item->>'detail'),''),'Not yet attached')<>'Not yet attached'))) then
        raise exception using errcode='42501',message='Post-approval verification outcome is one-time and already recorded'; end if;
      if length(btrim(coalesce(v_plan->>'effectiveness','')))=0 then
        raise exception using errcode='23514',message='Post-approval verification requires a complete measured outcome'; end if;
      v_post_approval_outcome:=true;
    end if;
    v_state:=jsonb_set(v_state,'{stage}',to_jsonb(case when nullif(btrim(coalesce(v_plan->>'effectiveness','')),'') is null then 'outcomes' else 'learning' end),true);
    v_state:=jsonb_set(v_state,'{statusLabel}',to_jsonb(case when nullif(btrim(coalesce(v_plan->>'effectiveness','')),'') is null
      then 'Verification scheduled · '||(v_plan->>'scheduledFor') else 'Verification recorded · '||(v_plan->>'effectiveness') end),true);
    v_state:=jsonb_set(v_state,'{valueMetrics}',coalesce((select jsonb_agg(item order by ordinality)
      from jsonb_array_elements(v_state->'valueMetrics') with ordinality x(item,ordinality)
      where item->>'id' not in ('verify-expected','verify-evidence')),'[]'::jsonb)||jsonb_build_array(
      jsonb_build_object('id','verify-expected','label','Expected','detail','How we will know this worked','baseline',btrim(v_plan->>'expected'),
        'target',btrim(v_plan->>'expected'),'actual',nullif(btrim(coalesce(v_plan->>'actual','')),''),'verifiedActual',coalesce(nullif(btrim(v_plan->>'actual'),''),'Pending')),
      jsonb_build_object('id','verify-evidence','label','Verification evidence','detail',coalesce(nullif(btrim(v_plan->>'evidence'),''),'Not yet attached'),
        'baseline',v_plan->>'scheduledFor','target',coalesce(nullif(btrim(v_plan->>'question'),''),'How will we know this worked?'),
        'actual',nullif(btrim(coalesce(v_plan->>'effectiveness','')),''),'verifiedActual',coalesce(nullif(btrim(v_plan->>'effectiveness'),''),'Scheduled'))),true);
    v_state:=jsonb_set(v_state,'{comments}',coalesce((select jsonb_agg(c order by ordinality)
      from jsonb_array_elements(coalesce(v_state->'comments','[]'::jsonb)) with ordinality x(c,ordinality)
      where c->>'id'<>'outcome-attribution' and (v_post_approval_outcome or c->>'author'<>'Verification Owner')),'[]'::jsonb)||
      case when v_post_approval_outcome then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
        'id','verification-owner-'||(v_workspace.case_version+1)::text,'author','Verification Owner','text',v_actor_name,
        'actorId',v_actor,'actorRole',v_actor_role,'createdAt',v_now)) end||
      case when nullif(btrim(coalesce(v_plan->>'effectiveness','')),'') is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
        'id','outcome-attribution','author','Outcome attribution','text',format(
          'Outcome, evidence, and effectiveness were recorded by %s. Association is recorded; causality is not asserted.',v_actor_name),
        'actorId',v_actor,'actorRole',v_actor_role,'createdAt',v_now)) end,true);
    if nullif(btrim(coalesce(v_plan->>'effectiveness','')),'') is not null then
      v_state:=jsonb_set(v_state,'{learningRecord}',jsonb_build_object(
        'id','learn-'||coalesce(nullif(v_state->>'caseNumber',''),'case'), 'status','candidate',
        'summary',format('%s: expected %s; actual %s; evidence %s. Recorded by %s; attribution remains unproven.',
          v_plan->>'effectiveness',btrim(v_plan->>'expected'),btrim(v_plan->>'actual'),btrim(v_plan->>'evidence'),v_actor_name),
        'recordedBy',jsonb_build_object('id',v_actor,'name',v_actor_name,'role',v_actor_role),'recordedAt',v_now),true);
    end if;
    v_state:=jsonb_set(v_state,'{messages}',coalesce(v_state->'messages','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
      'id','verification-'||(v_workspace.case_version+1)::text,'role','system','author',v_actor_name,'actorId',v_actor,'actorRole',v_actor_role,
      'text',format('Verification %s for %s. Expected: %s.',case when nullif(btrim(coalesce(v_plan->>'effectiveness','')),'') is null then 'scheduled' else 'recorded' end,
      v_plan->>'scheduledFor',v_plan->>'expected'),'createdAt',v_now,'meta','Verification obligation')),true);

  elsif p_command='record_required_person' then
    if not public.decision_case_authority_role_allowed(v_actor_role) then
      raise exception using errcode='42501',message='Your role may not assign required Decision Case authority'; end if;
    if length(btrim(coalesce(v_state#>>'{humanDecision,actor,id}','')))=0 then
      raise exception using errcode='55000',message='Record a governed human disposition before assigning required authority'; end if;
    if coalesce(v_state->'humanApproval','null'::jsonb)<>'null'::jsonb then
      raise exception using errcode='42501',message='A decided approval is immutable; no governed reopen path exists'; end if;
    if length(btrim(coalesce(v_payload#>>'{requiredPerson,userId}','')))=0 then
      raise exception using errcode='23514',message='Required person must be bound to a tenant user id'; end if;
    if jsonb_typeof(v_payload->'requiredPerson')<>'object' or exists(
      select 1 from jsonb_object_keys(v_payload->'requiredPerson') k where k<>'userId') then
      raise exception using errcode='42501',message='Required person identity and role are server-owned'; end if;
    begin v_required_user:=(v_payload#>>'{requiredPerson,userId}')::uuid; exception when invalid_text_representation then
      raise exception using errcode='22023',message='Required person user id is invalid'; end;
    if v_required_user=v_actor then
      raise exception using errcode='42501',message='A person may not bind themselves as required authority'; end if;
    select coalesce(nullif(btrim(full_name),''),email),email,role into v_required_name,v_required_email,v_required_role
      from public.user_profiles where id=v_required_user and organization_id=v_org;
    if v_required_name is null or not public.decision_case_authority_role_allowed(v_required_role) then
      raise exception using errcode='42501',message='Required person must be an authorized same-tenant human authority'; end if;
    v_state:=jsonb_set(v_state,'{requiredPerson}',jsonb_build_object('userId',v_required_user,'name',v_required_name,
      'email',v_required_email,'authorityRole',v_required_role,'invitationStatus','not_sent',
      'recordedBy',jsonb_build_object('id',v_actor,'name',v_actor_name,'role',v_actor_role),'recordedAt',v_now),true);
    v_plan:=jsonb_build_object('id','required-approver','initials','',
      'name',v_required_name,'role',v_required_role,'responsibility','Required person recorded; invitation not sent','status','reviewing');
    v_state:=jsonb_set(v_state,'{approvals}',coalesce((select jsonb_agg(
      case when a->>'id'='required-approver' then v_plan else a end order by ordinality)
      from jsonb_array_elements(coalesce(v_state->'approvals','[]'::jsonb)) with ordinality x(a,ordinality)),'[]'::jsonb)||
      case when exists(select 1 from jsonb_array_elements(coalesce(v_state->'approvals','[]'::jsonb)) a
        where a->>'id'='required-approver') then '[]'::jsonb else jsonb_build_array(v_plan) end,true);
    v_state:=jsonb_set(v_state,'{messages}',coalesce(v_state->'messages','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
      'id','required-person-'||(v_workspace.case_version+1)::text,'role','system','author',v_actor_name,'actorId',v_actor,'actorRole',v_actor_role,
      'text',format('Required person recorded as %s (%s). No email or workspace invitation was sent.',v_required_name,v_required_role),
      'createdAt',v_now,'meta','Required person recorded')),true);

  elsif p_command='record_source_check' then
    if length(btrim(coalesce(v_state#>>'{humanDecision,actor,id}','')))=0 then
      raise exception using errcode='55000',message='Record a governed human disposition before checking sources'; end if;
    if length(btrim(coalesce(v_state#>>'{requiredPerson,userId}','')))=0 then
      raise exception using errcode='55000',message='Record a bound required person before checking sources'; end if;
    if length(btrim(coalesce(v_payload#>>'{sourceCheck,detail}','')))<8 then
      raise exception using errcode='23514',message='Source check detail is required'; end if;
    v_state:=jsonb_set(v_state,'{messages}',coalesce((select jsonb_agg(m) from jsonb_array_elements(coalesce(v_state->'messages','[]'::jsonb)) m
      where coalesce(m->>'meta','')<>'Source connection check'),'[]'::jsonb)||jsonb_build_array(jsonb_build_object(
      'id','source-check-'||(v_workspace.case_version+1)::text,'role','system','author',v_actor_name,'actorId',v_actor,'actorRole',v_actor_role,
      'text',btrim(v_payload#>>'{sourceCheck,detail}')||' This check is not a data pull and supplies no case evidence.',
      'createdAt',v_now,'meta','Source connection check')),true);

  elsif p_command='record_approval' then
    if coalesce(v_state->'humanApproval','null'::jsonb)<>'null'::jsonb then
      raise exception using errcode='42501',message='Decision Case approval is immutable; no governed reopen path exists'; end if;
    if v_state#>>'{requiredPerson,userId}' is distinct from v_actor::text then
      raise exception using errcode='42501',message='Only the bound required person may record approval'; end if;
    if not public.decision_case_authority_role_allowed(v_actor_role) or
      v_state#>>'{requiredPerson,authorityRole}' is distinct from v_actor_role then
      raise exception using errcode='42501',message='Bound authority role no longer matches the canonical user profile'; end if;
    v_decision:=v_payload->>'decision'; v_reason:=btrim(coalesce(v_payload->>'reason',''));
    if v_decision not in ('approved','rejected','changes_requested','delegated') or length(v_reason)<8 then
      raise exception using errcode='23514',message='A governed approval decision and reason are required'; end if;
    v_plan:=public.decision_case_approval_basis(v_state);
    if length(btrim(coalesce(v_state#>>'{humanDecision,actor,id}','')))=0 then
      raise exception using errcode='55000',message='Approval requires a governed human disposition'; end if;
    if v_decision='approved' and v_state#>>'{humanDecision,disposition}'<>'accept' then
      raise exception using errcode='55000',message='Approval requires an accepted governed disposition'; end if;
    if length(btrim(coalesce(v_plan#>>'{verificationPlan,expected}','')))=0 or
      length(btrim(coalesce(v_plan#>>'{verificationPlan,scheduledFor}','')))=0 or
      length(btrim(coalesce(v_plan#>>'{verificationPlan,owner,actorId}','')))=0 then
      raise exception using errcode='55000',message='Approval requires a server-stamped scheduled verification plan'; end if;
    if coalesce(v_plan->'sourceCheck','null'::jsonb)='null'::jsonb then
      raise exception using errcode='55000',message='Approval requires a server-stamped source check'; end if;
    if v_decision='delegated' then
      begin v_delegated_to:=(v_payload->>'delegatedTo')::uuid; exception when invalid_text_representation or null_value_not_allowed then
        raise exception using errcode='22023',message='Delegation requires a valid target user id'; end;
      if v_delegated_to=v_actor or not exists(select 1 from public.user_profiles p where p.id=v_delegated_to and p.organization_id=v_org
        and public.decision_case_authority_role_allowed(p.role)) then
        raise exception using errcode='42501',message='Delegation target must be another authorized same-tenant human'; end if;
    end if;
    v_basis_digest:=public.decision_case_approval_basis_sha256(v_state);
    v_state:=jsonb_set(v_state,'{humanApproval}',jsonb_build_object('decision',v_decision,'reason',v_reason,
      'delegatedTo',v_delegated_to,'actor',jsonb_build_object('id',v_actor,'name',v_actor_name,'role',v_actor_role),
      'recordedAt',v_now,'basisVersion',v_workspace.case_version,'basisSha256',v_basis_digest,
      'approvalVersion',v_workspace.case_version+1),true);
    v_state:=jsonb_set(v_state,'{approvals}',coalesce((select jsonb_agg(case when a->>'id'='required-approver'
      then jsonb_set(jsonb_set(a,'{status}',to_jsonb(v_decision),true),'{decidedAt}',to_jsonb(v_now),true) else a end order by ordinality)
      from jsonb_array_elements(coalesce(v_state->'approvals','[]'::jsonb)) with ordinality x(a,ordinality)),'[]'::jsonb),true);
  end if;

  if exists(select 1 from jsonb_array_elements(coalesce(v_state->'evidence','[]'::jsonb)) e
    where (e->>'persistence'='governed_reference' and not(
      coalesce(e->>'durableReference','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and
      exists(select 1 from public.evidence_items canonical where canonical.id=case
        when coalesce(e->>'durableReference','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (e->>'durableReference')::uuid else null end and canonical.organization_id=v_org))) or
    (e->>'quality' in ('high','medium') and not(
      (e->>'persistence'='embedded' and length(btrim(coalesce(e->>'finding','')))>=12
        and coalesce(e->>'finding','') !~* '^File .+ (selected|attached).+Text was not extracted') or
      (e->>'persistence'='governed_reference'
        and coalesce(e->>'durableReference','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and exists(select 1 from public.evidence_items canonical where canonical.id=case
          when coalesce(e->>'durableReference','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (e->>'durableReference')::uuid else null end and canonical.organization_id=v_org))))) then
    raise exception using errcode='23514',message='Decision Case contains unproven supplied evidence'; end if;
  if v_state#>>'{workPackage,status}' is distinct from 'locked' or
    coalesce(v_state#>'{workPackage,receipt}','null'::jsonb)<>'null'::jsonb then
    raise exception using errcode='42501',message='ACTION must remain locked and unreleased'; end if;
  if coalesce(v_state->'humanApproval','null'::jsonb)<>'null'::jsonb and
    v_state#>>'{humanApproval,basisSha256}' is distinct from public.decision_case_approval_basis_sha256(v_state) then
    raise exception using errcode='55000',message='Decision Case approval basis became stale during the command'; end if;
  v_previous:=v_workspace.case_state; v_next_version:=v_workspace.case_version+1;
  v_state:=jsonb_set(v_state,'{revision}',to_jsonb(v_next_version),true);
  v_state:=jsonb_set(v_state,'{updatedAt}',to_jsonb(v_now),true);
  perform set_config('syncai.decision_case_command','on',true);
  update public.cowork_workspaces set case_state=v_state,case_version=v_next_version,
    usage_tokens=greatest(coalesce((v_state->>'tokensUsed')::integer,0),0),
    progress=case coalesce(v_state->>'stage','intent') when 'intent' then 10 when 'asset_truth' then 20 when 'evidence' then 35
      when 'analysis' then 50 when 'authority' then 65 when 'execution' then 78 when 'outcomes' then 90 when 'learning' then 100 else 0 end,
    status=case when v_state->>'stage'='learning' then 'complete' else 'active' end,
    next_action=v_state->>'statusLabel',updated_at=v_now where id=p_workspace_id and organization_id=v_org;
  perform set_config('syncai.decision_case_command','off',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'decision_case_command',v_actor::text,jsonb_build_object('workspaceId',p_workspace_id,'command',p_command,
    'version',v_next_version,'actorName',v_actor_name,'actorRole',v_actor_role,'reason',nullif(v_reason,''),'delegatedTo',v_delegated_to,
    'approvalBasisVersion',v_state#>'{humanApproval,basisVersion}','approvalBasisSha256',v_state#>'{humanApproval,basisSha256}',
    'postApprovalVerificationOutcome',v_post_approval_outcome),
    v_previous,v_state);
  return jsonb_build_object('caseState',v_state,'version',v_next_version);
end $$;

revoke all on function public.apply_decision_case_command(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.apply_decision_case_command(uuid,integer,text,jsonb) to authenticated;
comment on function public.apply_decision_case_command(uuid,integer,text,jsonb) is
  'Tenant-scoped, actor-stamped, optimistic command reducer for canonical Decision Cases. Never executes work or sends invitations.';

notify pgrst,'reload schema';

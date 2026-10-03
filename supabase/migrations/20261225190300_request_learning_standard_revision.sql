-- Positive/conforming learning uses the same standard and approval identities.
create or replace function public.request_learning_standard_revision(
  p_observation_id uuid,p_content text,p_change_summary text,p_basis text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  obs public.learning_events%rowtype; proc public.procedure_translations%rowtype;
  prior public.standard_work%rowtype; v_id bigint; v_approval uuid; v_version int;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if v_actor is null or v_org is null or coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','A named authorized human must request the revision');
  end if;
  if nullif(btrim(p_content),'') is null or nullif(btrim(p_change_summary),'') is null
    or nullif(btrim(p_basis),'') is null or length(p_content)>100000
    or length(p_change_summary)>10000 or length(p_basis)>10000 then
    return jsonb_build_object('error','Changed content, change summary and evidence basis are required within size limits');
  end if;
  -- Source is immutable. Read its parent identity, then follow parent-first
  -- locking used by observation capture and standard adoption.
  select * into obs from public.learning_events where id=p_observation_id
    and organization_id=v_org and event_type='standard_work_observation';
  if not found then return jsonb_build_object('error','Same-tenant standard-work observation not found'); end if;
  select * into proc from public.procedure_translations where id=obs.standard_procedure_id
    and organization_id=v_org;
  if not found then return jsonb_build_object('error','Observed procedure not found'); end if;
  select * into prior from public.standard_work where id=proc.standard_work_id
    and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','Observed standard not found'); end if;
  select * into proc from public.procedure_translations where id=obs.standard_procedure_id
    and organization_id=v_org for share;
  if not found or proc.standard_work_id is distinct from prior.id
    or proc.translation_status is distinct from 'human_verified'
    or proc.verified_by is null or proc.verified_at is null then
    return jsonb_build_object('error','Exact human-verified observed procedure required');
  end if;
  if prior.previous_standard_work_id is not null and not exists (
    select 1 from public.approvals a where a.id=prior.revision_approval_id
      and a.organization_id=v_org and a.standard_work_revision_id=prior.id and a.status='approved'
  ) then return jsonb_build_object('error','Observed predecessor has not been adopted'); end if;
  if exists(select 1 from public.standard_work s where s.organization_id=v_org
    and s.work_key=prior.work_key and s.version>prior.version
    and not exists(select 1 from public.approvals a where a.id=s.revision_approval_id
      and a.organization_id=v_org and a.standard_work_revision_id=s.id and a.status='rejected')) then
    return jsonb_build_object('error','A newer revision exists; review it before requesting another');
  end if;
  if btrim(proc.content)=btrim(p_content) then
    return jsonb_build_object('error','Unchanged procedure content is not a standard change');
  end if;
  select coalesce(max(s.version),prior.version)+1 into v_version from public.standard_work s
    where s.organization_id=v_org and s.work_key=prior.work_key;
  perform set_config('syncai.learning_revision_write','on',true);
  insert into public.standard_work(organization_id,work_key,title,craft,standard_minutes,basis,
    crew_template_id,version,source_learning_observation_id,previous_standard_work_id,
    change_summary,revision_requested_by)
  values(v_org,prior.work_key,prior.title,prior.craft,prior.standard_minutes,btrim(p_basis),
    prior.crew_template_id,v_version,obs.id,prior.id,btrim(p_change_summary),v_actor)
  returning id into v_id;
  perform set_config('syncai.learning_revision_write','',true);
  insert into public.procedure_translations(organization_id,standard_work_id,language_code,content,translation_status)
  values(v_org,v_id,proc.language_code,btrim(p_content),'draft');
  insert into public.approvals(organization_id,status,owner_role,reason,required_validation,standard_work_revision_id)
  values(v_org,'required','authorized standard-work approver',btrim(p_change_summary),
    'Review exact observed procedure, execution evidence, outcome, applicability and proposed change. Separate-human approval does not establish measured improvement.',v_id)
  returning id into v_approval;
  update public.standard_work set revision_approval_id=v_approval where id=v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'learning_standard_revision',v_role,
    jsonb_build_object('action','requested','actorId',v_actor,'observationId',obs.id,
      'previousId',prior.id,'revisionId',v_id,'approvalId',v_approval,'basis',btrim(p_basis)),
    jsonb_build_object('version',v_version,'status','draft','improvementEstablished',false));
  return jsonb_build_object('revisionId',v_id,'approvalId',v_approval,'status','draft');
end $$;
revoke all on function public.request_learning_standard_revision(uuid,text,text,text) from public,anon,service_role;
grant execute on function public.request_learning_standard_revision(uuid,text,text,text) to authenticated;
notify pgrst, 'reload schema';

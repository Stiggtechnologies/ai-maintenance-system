create or replace function public.request_project_standard_revision(
  p_verification_id uuid, p_previous_id bigint, p_language text,
  p_content text, p_change_summary text, p_basis text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  v_ca public.ca_verifications%rowtype; prior public.standard_work%rowtype;
  v_content text; v_id bigint; v_approval uuid; v_version integer;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if v_actor is null or v_org is null or coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','A named authorized human must request the revision');
  end if;
  if nullif(btrim(p_language),'') is null or nullif(btrim(p_content),'') is null
     or nullif(btrim(p_change_summary),'') is null or nullif(btrim(p_basis),'') is null
     or length(p_content)>100000 or length(p_change_summary)>10000 or length(p_basis)>10000 then
    return jsonb_build_object('error','Language, changed procedure content, change summary and source basis are required within their size limits');
  end if;
  select * into v_ca from public.ca_verifications
    where id=p_verification_id and organization_id=v_org and project_lesson_id is not null for update;
  if not found or v_ca.causal_addressed_at is null or v_ca.project_causal_evidence_id is null then
    return jsonb_build_object('error','Complete evidenced implementation and causal attestation first');
  end if;
  select * into prior from public.standard_work
    where id=p_previous_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','Previous standard not found'); end if;
  -- Rejected attempts remain immutable history, but must not strand the
  -- last adopted baseline. Pending, missing and approved decisions still block.
  if exists(select 1 from public.standard_work s where s.organization_id=v_org
    and s.work_key=prior.work_key and s.version>prior.version
    and not exists(select 1 from public.approvals a where a.id=s.revision_approval_id
      and a.organization_id=v_org and a.standard_work_revision_id=s.id and a.status='rejected')) then
    return jsonb_build_object('error','A newer revision exists; review it before requesting another');
  end if;
  if prior.source_project_ca_id is not null and not exists (
    select 1 from public.approvals a where a.id=prior.revision_approval_id
      and a.organization_id=v_org and a.standard_work_revision_id=prior.id and a.status='approved'
  ) then return jsonb_build_object('error','Previous project revision is not adopted'); end if;
  select content into v_content from public.procedure_translations
    where standard_work_id=prior.id and organization_id=v_org and language_code=btrim(p_language)
      and translation_status='human_verified' and verified_by is not null and verified_at is not null
    for share;
  if not found then return jsonb_build_object('error','A human-verified previous procedure in this language is required'); end if;
  if btrim(v_content)=btrim(p_content) then
    return jsonb_build_object('error','Unchanged procedure content is not a standard change');
  end if;
  select coalesce(max(s.version),prior.version)+1 into v_version
    from public.standard_work s where s.organization_id=v_org and s.work_key=prior.work_key;
  insert into public.standard_work(organization_id,work_key,title,craft,standard_minutes,basis,
    crew_template_id,version,source_project_ca_id,previous_standard_work_id,
    change_summary,revision_requested_by)
  values(v_org,prior.work_key,prior.title,prior.craft,prior.standard_minutes,btrim(p_basis),
    prior.crew_template_id,v_version,v_ca.id,prior.id,btrim(p_change_summary),v_actor)
  returning id into v_id;
  insert into public.procedure_translations(organization_id,standard_work_id,language_code,
    content,translation_status) values(v_org,v_id,btrim(p_language),btrim(p_content),'draft');
  insert into public.approvals(organization_id,status,owner_role,reason,required_validation,
    standard_work_revision_id)
  values(v_org,'required','authorized standard-work approver',btrim(p_change_summary),
    'Review the exact procedure change, source evidence, applicability and current prior version; approval is a named human act.',v_id)
  returning id into v_approval;
  update public.standard_work set revision_approval_id=v_approval where id=v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'project_standard_revision',v_role,
    jsonb_build_object('action','requested','actorId',v_actor,'verificationId',v_ca.id,
      'previousId',prior.id,'revisionId',v_id,'approvalId',v_approval,'basis',btrim(p_basis)),
    jsonb_build_object('version',v_version,'status','draft','changeSummary',btrim(p_change_summary)));
  return jsonb_build_object('revisionId',v_id,'approvalId',v_approval,'status','draft');
end $$;
revoke all on function public.request_project_standard_revision(uuid,bigint,text,text,text,text)
  from public,anon,service_role;
grant execute on function public.request_project_standard_revision(uuid,bigint,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';

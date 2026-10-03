-- Extend canonical revision provenance; learning request/decision RPCs follow.
alter table public.standard_work add column source_learning_observation_id uuid
  references public.learning_events(id) on delete restrict;
create unique index if not exists learning_events_org_identity on public.learning_events(organization_id,id);
alter table public.standard_work add constraint standard_revision_learning_tenant
  foreign key (organization_id,source_learning_observation_id)
  references public.learning_events(organization_id,id) on delete restrict;
alter table public.standard_work drop constraint project_standard_revision_complete;
alter table public.standard_work add constraint project_standard_revision_complete check (
  (source_project_ca_id is null and source_learning_observation_id is null
    and previous_standard_work_id is null and change_summary is null
    and revision_requested_by is null and revision_approval_id is null)
  or
  (num_nonnulls(source_project_ca_id,source_learning_observation_id)=1
    and previous_standard_work_id is not null
    and nullif(btrim(change_summary),'') is not null and revision_requested_by is not null)
);

create or replace function public.guard_project_standard_revision()
returns trigger language plpgsql security definer set search_path = public as $$
declare prior public.standard_work%rowtype;
begin
  if tg_op='UPDATE' and old.previous_standard_work_id is not null and
     (new.source_learning_observation_id is distinct from old.source_learning_observation_id
      or new.source_project_ca_id is distinct from old.source_project_ca_id
      or new.previous_standard_work_id is distinct from old.previous_standard_work_id
      or new.organization_id is distinct from old.organization_id
      or new.work_key is distinct from old.work_key
      or new.version is distinct from old.version
      or new.change_summary is distinct from old.change_summary
      or new.revision_requested_by is distinct from old.revision_requested_by
      or new.title is distinct from old.title
      or new.craft is distinct from old.craft
      or new.standard_minutes is distinct from old.standard_minutes
      or new.crew_template_id is distinct from old.crew_template_id
      or (old.revision_approval_id is not null and
          new.revision_approval_id is distinct from old.revision_approval_id)
      or new.basis is distinct from old.basis) then
    raise exception 'Project standard revision content and source identity are immutable';
  end if;
  if new.previous_standard_work_id is null then return new; end if;
  if tg_op='INSERT' and new.source_learning_observation_id is not null and
    (current_setting('syncai.learning_revision_write',true) is distinct from 'on'
     or auth.uid() is null or new.revision_requested_by is distinct from auth.uid()
     or new.organization_id is distinct from public.app_current_org()) then
    raise exception 'Learning revisions require the governed named-human request';
  end if;
  select * into prior from public.standard_work
    where id=new.previous_standard_work_id and organization_id=new.organization_id for share;
  if not found or prior.work_key is distinct from new.work_key
     or new.version <= prior.version or exists (
       select 1 from public.standard_work s where s.organization_id=new.organization_id
         and s.work_key=new.work_key and s.version>prior.version and s.version<new.version
         and not exists(select 1 from public.approvals a where a.id=s.revision_approval_id
           and a.organization_id=new.organization_id and a.standard_work_revision_id=s.id
           and a.status='rejected')
     ) then
    raise exception 'Revision must retain the same-tenant standard identity and next version';
  end if;
  if tg_op='INSERT' and new.version <> (
    select coalesce(max(s.version),prior.version)+1 from public.standard_work s
      where s.organization_id=new.organization_id and s.work_key=new.work_key
  ) then
    raise exception 'Revision must retain the same-tenant standard identity and next version';
  end if;
  if new.source_project_ca_id is not null then
  perform 1 from public.ca_verifications c
    where c.id=new.source_project_ca_id and c.organization_id=new.organization_id
      and c.project_lesson_id is not null and c.causal_addressed_at is not null
      and c.project_causal_evidence_id is not null for share;
  if not found then raise exception 'Revision requires evidenced project causal attestation'; end if;
  else
    perform 1 from public.learning_events l join public.procedure_translations p
      on p.id=l.standard_procedure_id and p.organization_id=l.organization_id
      where l.id=new.source_learning_observation_id
        and l.organization_id=new.organization_id
        and l.event_type='standard_work_observation'
        and p.standard_work_id=new.previous_standard_work_id for share of l,p;
    if not found then raise exception 'Learning revision requires the exact observed prior procedure'; end if;
  end if;
  -- Authorization is checked at creation, not retroactively after a human's
  -- role changes. The recorded actor is immutable historical provenance.
  if tg_op='INSERT' and not exists(select 1 from public.user_profiles p
    where p.id=new.revision_requested_by and p.organization_id=new.organization_id
      and p.role in ('admin','executive','maintenance_manager','reliability_engineer','planner')) then
    raise exception 'Revision requires a named same-tenant human';
  end if;
  if new.revision_approval_id is not null and not exists (
    select 1 from public.approvals a where a.id=new.revision_approval_id
      and a.organization_id=new.organization_id and a.standard_work_revision_id=new.id
  ) then raise exception 'Revision requires its canonical same-tenant approval'; end if;
  return new;
end $$;

create or replace function public.guard_project_procedure_history()
returns trigger language plpgsql security definer set search_path=public as $$
declare parent public.standard_work%rowtype;
begin
  if tg_op='INSERT' then
    select * into parent from public.standard_work where id=new.standard_work_id for share;
    if found and parent.previous_standard_work_id is not null then
      if new.organization_id is distinct from parent.organization_id
         or parent.revision_approval_id is not null
         or new.translation_status is distinct from 'draft'
         or new.verified_by is not null or new.verified_at is not null
         or exists(select 1 from public.procedure_translations p where p.standard_work_id=parent.id) then
        raise exception 'Project revision accepts one same-tenant unverified draft before approval submission';
      end if;
    end if;
    return new;
  end if;
  if exists(select 1 from public.standard_work s where s.id=old.standard_work_id
    and (s.previous_standard_work_id is not null or exists(select 1 from public.standard_work r
      where r.previous_standard_work_id=s.id))) then
    if tg_op='DELETE' then raise exception 'Referenced project procedure content cannot be deleted'; end if;
    if new.organization_id is distinct from old.organization_id
       or new.standard_work_id is distinct from old.standard_work_id
       or new.language_code is distinct from old.language_code
       or new.content is distinct from old.content then
      raise exception 'Referenced project procedure content is immutable; request a new revision';
    end if;
    if old.translation_status='human_verified' and
       (new.translation_status is distinct from old.translation_status
        or new.verified_by is distinct from old.verified_by
        or new.verified_at is distinct from old.verified_at) then
      raise exception 'Recorded procedure verification cannot be overwritten';
    end if;
    if new.translation_status='human_verified' and old.translation_status is distinct from 'human_verified'
       and exists(select 1 from public.standard_work s where s.id=old.standard_work_id
         and s.previous_standard_work_id is not null)
       and not exists(select 1 from public.standard_work s join public.approvals a
         on a.id=s.revision_approval_id and a.standard_work_revision_id=s.id
           and a.organization_id=s.organization_id
         where s.id=old.standard_work_id and s.organization_id=new.organization_id
           and a.status='approved' and a.approver_user_id=new.verified_by
           and a.decided_at=new.verified_at and new.verified_by is not null
           and new.verified_at is not null) then
      raise exception 'Project procedure verification requires its recorded adoption decision';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

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
     or length(p_language)>30 or length(p_content)>100000 or length(p_change_summary)>10000 or length(p_basis)>10000 then
    return jsonb_build_object('error','Language, changed procedure content, change summary and source basis are required within their size limits');
  end if;
  select * into v_ca from public.ca_verifications
    where id=p_verification_id and organization_id=v_org and project_lesson_id is not null for update;
  if not found or v_ca.causal_addressed_at is null or v_ca.project_causal_evidence_id is null then
    return jsonb_build_object('error','Complete evidenced implementation and causal attestation first');
  end if;
  if v_ca.project_adopted_standard_id is not null then
    return jsonb_build_object('error','This closure already records an adopted standard');
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
  if prior.previous_standard_work_id is not null and not exists (
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

create or replace function public.guard_standard_work_observation()
returns trigger language plpgsql security definer set search_path=public as $$
declare p public.procedure_translations%rowtype; s public.standard_work%rowtype;
begin
  if tg_op in ('UPDATE','DELETE') and old.event_type='standard_work_observation' then
    raise exception 'standard-work observations are immutable; retain corrections as new evidence';
  end if;
  if tg_op<>'DELETE' and new.event_type='standard_work_observation' then
    if tg_op<>'INSERT' or coalesce(current_setting('syncai.standard_observation_write',true),'')<>'on'
      or auth.uid() is null or new.standard_execution_recorded_by is distinct from auth.uid()
      or new.organization_id is distinct from public.app_current_org()
      or not exists(select 1 from public.user_profiles where id=auth.uid()
        and organization_id=new.organization_id and role in
        ('admin','executive','maintenance_manager','reliability_engineer','planner')) then
      raise exception 'standard-work observations require the named-human recorder';
    end if;
    -- Match the revision/adoption parent-before-procedure lock order.
    select * into p from public.procedure_translations where id=new.standard_procedure_id;
    select * into s from public.standard_work where id=p.standard_work_id for share;
    select * into p from public.procedure_translations where id=new.standard_procedure_id for share;
    if p.id is null or s.id is null or p.standard_work_id is distinct from s.id
      or p.organization_id is distinct from new.organization_id
      or s.organization_id is distinct from new.organization_id
      or p.translation_status is distinct from 'human_verified'
      or p.verified_by is null or p.verified_at is null
      or (s.previous_standard_work_id is not null and not exists(select 1 from public.approvals a
        where a.id=s.revision_approval_id and a.standard_work_revision_id=s.id
          and a.organization_id=new.organization_id and a.status='approved')) then
      raise exception 'Observation requires the exact same-tenant human-verified adopted procedure';
    end if;
    perform 1 from public.work_orders where id=new.standard_execution_work_order_id
      and organization_id=new.organization_id for share;
    if not found then raise exception 'Observation requires same-tenant actual work'; end if;
    if new.development_case_id is null or not exists(select 1 from public.work_package_work m
      join public.work_packages w on w.id=m.work_package_id
      where m.organization_id=new.organization_id and w.organization_id=new.organization_id
        and w.development_case_id=new.development_case_id
        and m.work_order_id=new.standard_execution_work_order_id) then
      raise exception 'Observed work must belong to the selected project through its work package';
    end if;
    perform 1 from public.evidence_items where id=new.standard_execution_evidence_id
      and organization_id=new.organization_id for share;
    if not found then raise exception 'Same-tenant execution evidence is required'; end if;
    perform 1 from public.evidence_items where id=new.standard_outcome_evidence_id
      and organization_id=new.organization_id for share;
    if not found then raise exception 'Same-tenant outcome evidence is required'; end if;
    if not isfinite(new.standard_execution_observed_at)
      or new.standard_execution_observed_at>now() then
      raise exception 'Observation time must be finite and not in the future';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.guard_standard_work_observation() from public,anon,authenticated;


notify pgrst, 'reload schema';


create or replace function public.decide_learning_standard_revision(
  p_revision_id bigint,p_outcome text,p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  r public.standard_work%rowtype; a public.approvals%rowtype; v_count int;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if v_actor is null or v_org is null or v_role is null or v_role='ai_admin'
    or not coalesce(public.app_has_approval_authority(),false) then
    return jsonb_build_object('error','A named human with approval authority must decide adoption');
  end if;
  if p_outcome is null or p_outcome not in ('approved','rejected')
    or nullif(btrim(p_note),'') is null or length(p_note)>10000 then
    return jsonb_build_object('error','Choose approved or rejected and record the decision basis');
  end if;
  select * into r from public.standard_work where id=p_revision_id and organization_id=v_org
    and source_learning_observation_id is not null;
  if not found then return jsonb_build_object('error','Learning revision not found'); end if;
  -- Serialize with requests on the same predecessor, then lock the decision.
  perform 1 from public.standard_work where id=r.previous_standard_work_id
    and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','Prior standard not found'); end if;
  select * into r from public.standard_work where id=p_revision_id and organization_id=v_org for update;
  if r.revision_requested_by=v_actor then
    return jsonb_build_object('error','The revision requester cannot decide their own adoption');
  end if;
  perform 1 from public.learning_events l join public.procedure_translations p
    on p.id=l.standard_procedure_id and p.organization_id=l.organization_id
    where l.id=r.source_learning_observation_id and l.organization_id=v_org
      and l.event_type='standard_work_observation' and p.standard_work_id=r.previous_standard_work_id
    for share of l,p;
  if not found then return jsonb_build_object('error','Exact observed source procedure required'); end if;
  select * into a from public.approvals where id=r.revision_approval_id
    and organization_id=v_org and standard_work_revision_id=r.id for update;
  if not found or a.status is null or a.status not in ('required','pending') then
    return jsonb_build_object('error','Canonical approval is missing or already decided');
  end if;
  if p_outcome='approved' then
    if exists(select 1 from public.standard_work s where s.organization_id=v_org
      and s.work_key=r.work_key and s.version>r.version) then
      return jsonb_build_object('error','Revision is stale; review the newer version');
    end if;
    select count(*) into v_count from public.procedure_translations
      where standard_work_id=r.id and organization_id=v_org and translation_status='draft';
    if v_count<>1 then return jsonb_build_object('error','Exactly one reviewed draft procedure is required'); end if;
  end if;
  perform set_config('syncai.standard_revision_decision','1',true);
  update public.approvals set status=p_outcome,approver=v_actor::text,
    approver_user_id=v_actor,decided_at=now(),
    approval_scope=jsonb_build_object('standardWorkRevisionId',r.id,'observationId',r.source_learning_observation_id,'decisionNote',btrim(p_note))
    where id=a.id;
  perform set_config('syncai.standard_revision_decision','',true);
  if p_outcome='approved' then
    update public.procedure_translations set translation_status='human_verified',verified_by=v_actor,verified_at=now()
      where standard_work_id=r.id and organization_id=v_org and translation_status='draft';
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'learning_standard_adoption',v_role,
    jsonb_build_object('actorId',v_actor,'revisionId',r.id,'approvalId',a.id,
      'observationId',r.source_learning_observation_id,'basis',btrim(p_note)),
    jsonb_build_object('status',p_outcome,'improvementEstablished',false));
  return jsonb_build_object('revisionId',r.id,'status',p_outcome,
    'detail','Standard decision recorded. Measured outcome improvement remains a separate evidence requirement.');
end $$;
revoke all on function public.decide_learning_standard_revision(bigint,text,text) from public,anon,service_role;
grant execute on function public.decide_learning_standard_revision(bigint,text,text) to authenticated;
notify pgrst, 'reload schema';

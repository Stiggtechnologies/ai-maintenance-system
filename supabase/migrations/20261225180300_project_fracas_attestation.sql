alter table public.ca_verifications
  add column project_implementation_evidence_id uuid references public.evidence_items(id) on delete restrict,
  add column project_causal_evidence_id uuid references public.evidence_items(id) on delete restrict,
  add constraint project_ca_implementation_evidence_tenant
    foreign key (organization_id,project_implementation_evidence_id)
    references public.evidence_items(organization_id,id),
  add constraint project_ca_causal_evidence_tenant
    foreign key (organization_id,project_causal_evidence_id)
    references public.evidence_items(organization_id,id);

create or replace function public.attest_project_ca_stage(
  p_verification_id uuid, p_stage text, p_note text, p_evidence_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  v public.ca_verifications%rowtype;
begin
  select role into v_role from public.user_profiles
    where id=v_actor and organization_id=v_org;
  if v_actor is null or v_org is null or coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','Project attestation requires a named authorized human');
  end if;
  if p_stage is null or p_stage not in ('implementation','causal') then
    return jsonb_build_object('error','Expected implementation or causal stage');
  end if;
  if nullif(btrim(p_note),'') is null or length(p_note)>10000 then
    return jsonb_build_object('error','State what was verified (1–10000 characters)');
  end if;
  select * into v from public.ca_verifications
    where id=p_verification_id and organization_id=v_org
      and project_lesson_id is not null for update;
  if not found then return jsonb_build_object('error','Project closure not found'); end if;
  perform 1 from public.evidence_items
    where id=p_evidence_id and organization_id=v_org for share;
  if not found then return jsonb_build_object('error','Same-tenant evidence is required'); end if;
  if p_stage='implementation' then
    if v.physical_verified_at is not null then
      return jsonb_build_object('error','Implementation already attested; evidence cannot be overwritten');
    end if;
    update public.ca_verifications set physical_verified_at=now(),
      physical_verified_by=v_actor,physical_note=btrim(p_note),
      project_implementation_evidence_id=p_evidence_id where id=v.id;
  else
    if v.physical_verified_at is null then
      return jsonb_build_object('error','Verify implementation before causal closure');
    end if;
    if v.causal_addressed_at is not null then
      return jsonb_build_object('error','Causal stage already attested; evidence cannot be overwritten');
    end if;
    update public.ca_verifications set causal_addressed_at=now(),
      causal_addressed_by=v_actor,causal_note=btrim(p_note),
      project_causal_evidence_id=p_evidence_id where id=v.id;
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'project_ca_attestation',v_role,
    jsonb_build_object('verificationId',v.id,'lessonId',v.project_lesson_id,
      'actorId',v_actor,'stage',p_stage,'evidenceId',p_evidence_id,'basis',btrim(p_note)),
    jsonb_build_object('stage',p_stage,'attested',true));
  return jsonb_build_object('ok',true,'stage',p_stage,
    'detail','Human attestation recorded. Standard adoption and future-project screening remain separate.');
end $$;
revoke all on function public.attest_project_ca_stage(uuid,text,text,uuid)
  from public,anon,service_role;
grant execute on function public.attest_project_ca_stage(uuid,text,text,uuid) to authenticated;
notify pgrst, 'reload schema';
